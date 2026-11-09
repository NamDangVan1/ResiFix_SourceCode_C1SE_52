/**
 * BACKGROUND SERVICE: SLA TRACKING & ESCALATION WORKER
 * - Tính toán thời hạn SLA dựa trên thời gian máy chủ (Server time).
 * - Cập nhật trạng thái ON_TRACK, AT_RISK (>= 80%), BREACHED (quá hạn).
 * - Tự động kích hoạt các cấp độ leo thang (Escalation Tiers 1, 2, 3).
 * - Hỗ trợ tạm dừng (Pause SLA) khi chờ vật tư hoặc hẹn giờ với cư dân.
 * - Chống gửi lặp thông báo (Debounce / Cooldown).
 */

import { TicketStatus, PriorityLevel, Role, NotificationType } from '@prisma/client';
import { prisma } from '../db';
import { resiFixStore, SlaTicketStatus, SlaTierConfig } from '../data/resifix_store';

class SlaWorkerService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  // Tính toán thời hạn theo mức ưu tiên
  public calculateDeadlines(createdAt: Date, priority: PriorityLevel | string): {
    responseDeadline: string;
    assignmentDeadline: string;
    resolutionDeadline: string;
  } {
    const store = resiFixStore.get();
    const cfg = store.slaConfig;

    let tier: SlaTierConfig = cfg.mediumPriority;
    if (priority === PriorityLevel.HIGH || priority === 'HIGH') tier = cfg.highPriority;
    else if (priority === PriorityLevel.LOW || priority === 'LOW') tier = cfg.lowPriority;

    const createdTime = createdAt.getTime();
    const responseDeadline = new Date(createdTime + tier.responseMinutes * 60 * 1000).toISOString();
    const assignmentDeadline = new Date(createdTime + tier.assignmentMinutes * 60 * 1000).toISOString();
    const resolutionDeadline = new Date(createdTime + tier.resolutionHours * 60 * 60 * 1000).toISOString();

    return { responseDeadline, assignmentDeadline, resolutionDeadline };
  }

  // Đánh giá trạng thái SLA của một ticket
  public evaluateTicketSla(ticket: {
    id: string;
    ticketCode: string;
    createdAt: Date;
    status: TicketStatus | string;
    finalPriority?: PriorityLevel | null;
    aiSuggestedPriority?: PriorityLevel | null;
  }): SlaTicketStatus {
    const store = resiFixStore.get();
    const now = Date.now();
    const priority = ticket.finalPriority || ticket.aiSuggestedPriority || PriorityLevel.MEDIUM;

    let tracking = store.slaTrackings.find((s) => s.ticketId === ticket.id);

    if (!tracking) {
      const deadlines = this.calculateDeadlines(ticket.createdAt, priority);
      tracking = {
        ticketId: ticket.id,
        ticketCode: ticket.ticketCode,
        priority: priority as any,
        status: ticket.status,
        ...deadlines,
        slaStatus: 'ON_TRACK',
        isResponseBreached: false,
        isAssignmentBreached: false,
        isResolutionBreached: false,
        isPaused: false,
        escalationTier: 0,
      };
      store.slaTrackings.push(tracking);
      resiFixStore.save(store);
    }

    // Nếu ticket đã hoàn thành hoặc đang tạm dừng SLA
    if (ticket.status === TicketStatus.COMPLETED || ticket.status === TicketStatus.CLOSED) {
      tracking.slaStatus = tracking.isResolutionBreached ? 'BREACHED' : 'ON_TRACK';
      return tracking;
    }

    if (tracking.isPaused) {
      return tracking;
    }

    // 1. Kiểm tra Response SLA (Tiếp nhận ban đầu)
    const responseDeadlineMs = new Date(tracking.responseDeadline).getTime();
    if (ticket.status === TicketStatus.PENDING && now > responseDeadlineMs) {
      tracking.isResponseBreached = true;
    }

    // 2. Kiểm tra Assignment SLA (Phân công kỹ thuật viên)
    const assignmentDeadlineMs = new Date(tracking.assignmentDeadline).getTime();
    if ((ticket.status === TicketStatus.PENDING || ticket.status === TicketStatus.ASSIGNED) && now > assignmentDeadlineMs) {
      tracking.isAssignmentBreached = true;
    }

    // 3. Kiểm tra Resolution SLA (Hoàn tất khắc phục sự cố)
    const resolutionDeadlineMs = new Date(tracking.resolutionDeadline).getTime();
    if (now > resolutionDeadlineMs) {
      tracking.isResolutionBreached = true;
    }

    // Xác định deadline đang áp dụng theo giai đoạn
    let targetDeadlineMs = resolutionDeadlineMs;
    if (ticket.status === TicketStatus.PENDING) {
      targetDeadlineMs = responseDeadlineMs;
    } else if (ticket.status === TicketStatus.ASSIGNED) {
      targetDeadlineMs = assignmentDeadlineMs;
    }

    const totalWindowMs = targetDeadlineMs - new Date(ticket.createdAt).getTime();
    const elapsedMs = now - new Date(ticket.createdAt).getTime();
    const ratio = totalWindowMs > 0 ? elapsedMs / totalWindowMs : 1.0;

    const hasAnyBreach = tracking.isResponseBreached || tracking.isAssignmentBreached || tracking.isResolutionBreached || ratio >= 1.0;

    if (hasAnyBreach) {
      tracking.slaStatus = 'BREACHED';
      // Tính toán cấp độ leo thang (Escalation)
      const hoursOverdue = (now - targetDeadlineMs) / (1000 * 60 * 60);
      if (hoursOverdue > store.slaConfig.autoEscalationHours) {
        tracking.escalationTier = 3; // Leo thang lên Ban Giám Đốc tòa nhà
      } else {
        tracking.escalationTier = 2; // Báo động BMB điều phối
      }
    } else if (ratio >= store.slaConfig.warningThresholdPercent / 100) {
      tracking.slaStatus = 'AT_RISK';
      tracking.escalationTier = 1; // Nhắc nhở KTV/BMB
    } else {
      tracking.slaStatus = 'ON_TRACK';
      tracking.escalationTier = 0;
    }

    return tracking;
  }

  // Quét định kỳ kiểm tra các ticket đang xử lý (Hỗ trợ phân tán nhiều instance Node.js)
  public async runCheckCycle(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    let dbLocked = false;

    try {
      // Cơ chế chống gửi trùng nhiều instance: Dùng PostgreSQL Advisory Lock
      try {
        const lockRes = await prisma.$queryRaw<[{ locked: boolean }]>`SELECT pg_try_advisory_lock(888123) as locked`;
        if (lockRes && lockRes[0] && lockRes[0].locked === false) {
          return; // Instance khác đang xử lý chu kỳ này
        }
        dbLocked = true;
      } catch {
        // Fallback khi DB sandbox offline
      }

      const activeTickets = await prisma.incidentTicket.findMany({
        where: {
          status: { in: [TicketStatus.PENDING, TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS] },
        },
        select: {
          id: true,
          ticketCode: true,
          createdAt: true,
          status: true,
          finalPriority: true,
          aiSuggestedPriority: true,
          assignedTechId: true,
          assignedTech: { select: { fullName: true } },
        },
      });

      const store = resiFixStore.get();
      const debounceMs = (store.slaConfig.alertDebounceMinutes || 15) * 60 * 1000;

      for (const t of activeTickets) {
        const sla = this.evaluateTicketSla(t);
        if (sla.slaStatus === 'BREACHED' && sla.escalationTier >= 2) {
          const nowStr = new Date().toISOString();
          if (!sla.lastAlertSentAt || Date.now() - new Date(sla.lastAlertSentAt).getTime() > debounceMs) {
            console.warn(`[SLA_BREACH_ALERT] Sự cố ${t.ticketCode} đã QUÁ HẠN SLA! Cấp độ leo thang: Tier ${sla.escalationTier}. Phụ trách: ${t.assignedTech?.fullName || 'Chưa phân công'}`);
            sla.lastAlertSentAt = nowStr;

            // Ghi nhận thông báo thực tế vào bảng Notification
            try {
              const bmbUsers = await prisma.user.findMany({
                where: { role: Role.BMB, isActive: true },
                select: { id: true },
              });
              for (const bmb of bmbUsers) {
                await prisma.notification.create({
                  data: {
                    userId: bmb.id,
                    ticketId: t.id,
                    type: NotificationType.STATUS_UPDATED,
                    title: `🚨 Báo động SLA Tier ${sla.escalationTier}: Sự cố ${t.ticketCode} quá hạn`,
                    message: `Sự cố ${t.ticketCode} đã vượt quá hạn cam kết dịch vụ SLA. Cấp độ leo thang: Cấp ${sla.escalationTier}.`,
                  },
                });
              }
              if (t.assignedTechId) {
                await prisma.notification.create({
                  data: {
                    userId: t.assignedTechId,
                    ticketId: t.id,
                    type: NotificationType.STATUS_UPDATED,
                    title: `🚨 Cảnh báo quá hạn SLA sự cố ${t.ticketCode}`,
                    message: `Công việc được giao cho bạn đã quá hạn cam kết SLA. Đang kích hoạt leo thang cấp ${sla.escalationTier}.`,
                  },
                });
              }
            } catch {
              // Bắt lỗi khi database offline trong môi trường sandbox
            }
          }
        }
      }

      resiFixStore.save();
    } catch (err: any) {
      // Trong môi trường offline/sandbox hoặc lỗi mạng, bắt lỗi nhẹ không gây crash
      // console.warn('[SLA_CYCLE_OFFLINE]', err.message?.slice(0, 50));
    } finally {
      if (dbLocked) {
        try {
          await prisma.$queryRaw`SELECT pg_advisory_unlock(888123)`;
        } catch {
          // Bắt lỗi khi DB sandbox offline
        }
      }
      this.isRunning = false;
    }
  }

  // Khởi động Worker nền an toàn
  public start(intervalMs: number = 60000): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.runCheckCycle().catch(() => {});
    }, intervalMs);
    console.log(`⏱️ SLA Escalation Worker đã khởi động (chu kỳ ${Math.round(intervalMs / 1000)}s)`);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const slaWorker = new SlaWorkerService();

