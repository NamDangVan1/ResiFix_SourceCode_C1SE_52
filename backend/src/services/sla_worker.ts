/**
 * BACKGROUND SERVICE: SLA TRACKING & ESCALATION WORKER
 * - Tính toán thời hạn SLA dựa trên thời gian máy chủ (Server time).
 * - Cập nhật trạng thái ON_TRACK, AT_RISK (>= 80%), BREACHED (quá hạn).
 * - Tự động kích hoạt các cấp độ leo thang (Escalation Tiers 1, 2, 3).
 * - Hỗ trợ tạm dừng (Pause SLA) khi chờ vật tư hoặc hẹn giờ với cư dân.
 * - Chống gửi lặp thông báo (Debounce / Cooldown).
 * - 100% PERSISTENCE TRÊN NEON POSTGRESQL (Prisma SlaTracking & SystemSetting).
 */

import { TicketStatus, PriorityLevel, Role, NotificationType } from '@prisma/client';
import { prisma } from '../db';
import { SlaTicketStatus, SlaTierConfig, SlaConfig } from '../data/resifix_store';

const DEFAULT_SLA_CONFIG: SlaConfig = {
  highPriority: { responseMinutes: 15, assignmentMinutes: 30, resolutionHours: 4 },
  mediumPriority: { responseMinutes: 30, assignmentMinutes: 60, resolutionHours: 12 },
  lowPriority: { responseMinutes: 60, assignmentMinutes: 120, resolutionHours: 24 },
  warningThresholdPercent: 80,
  autoEscalationHours: 2,
  alertDebounceMinutes: 15,
};

class SlaWorkerService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private cachedConfig: SlaConfig = DEFAULT_SLA_CONFIG;
  private lastConfigLoadTime: number = 0;

  // Lấy cấu hình SLA từ SystemSetting (có cache 30 giây giảm tải query)
  public async getSlaConfig(): Promise<SlaConfig> {
    const now = Date.now();
    if (now - this.lastConfigLoadTime < 30000) {
      return this.cachedConfig;
    }
    try {
      const setting = await prisma.systemSetting.findUnique({ where: { key: 'sla_config' } });
      if (setting?.value && typeof setting.value === 'object') {
        this.cachedConfig = setting.value as any;
        this.lastConfigLoadTime = now;
      }
    } catch {
      // Dùng cấu hình hiện tại nếu có lỗi tạm thời
    }
    return this.cachedConfig;
  }

  // Tính toán thời hạn theo mức ưu tiên
  public calculateDeadlinesWithConfig(
    createdAt: Date,
    priority: PriorityLevel | string,
    cfg: SlaConfig
  ): {
    responseDeadline: string;
    assignmentDeadline: string;
    resolutionDeadline: string;
  } {
    let tier: SlaTierConfig = cfg.mediumPriority;
    if (priority === PriorityLevel.HIGH || priority === 'HIGH') tier = cfg.highPriority;
    else if (priority === PriorityLevel.LOW || priority === 'LOW') tier = cfg.lowPriority;

    const createdTime = createdAt.getTime();
    const responseDeadline = new Date(createdTime + tier.responseMinutes * 60 * 1000).toISOString();
    const assignmentDeadline = new Date(createdTime + tier.assignmentMinutes * 60 * 1000).toISOString();
    const resolutionDeadline = new Date(createdTime + tier.resolutionHours * 60 * 60 * 1000).toISOString();

    return { responseDeadline, assignmentDeadline, resolutionDeadline };
  }

  // Format Prisma SlaTracking sang SlaTicketStatus interface
  public formatSlaTracking(t: any): SlaTicketStatus {
    const now = Date.now();
    const respMs = new Date(t.responseDeadline).getTime();
    const assignMs = new Date(t.assignmentDeadline).getTime();
    const resMs = new Date(t.resolutionDeadline).getTime();

    return {
      ticketId: t.ticketId,
      ticketCode: t.ticketCode,
      priority: t.priority as any,
      status: t.status,
      responseDeadline: new Date(t.responseDeadline).toISOString(),
      assignmentDeadline: new Date(t.assignmentDeadline).toISOString(),
      resolutionDeadline: new Date(t.resolutionDeadline).toISOString(),
      slaStatus: t.slaStatus as any,
      isResponseBreached: now > respMs,
      isAssignmentBreached: now > assignMs,
      isResolutionBreached: now > resMs,
      isPaused: Boolean(t.isPaused),
      pausedAt: t.pausedAt ? new Date(t.pausedAt).toISOString() : null,
      pauseReason: t.pauseReason || null,
      escalationTier: t.escalationTier || 0,
      lastAlertSentAt: t.lastAlertSentAt ? new Date(t.lastAlertSentAt).toISOString() : null,
    };
  }

  // Đánh giá và lưu trạng thái SLA của một ticket vào PostgreSQL
  public async evaluateTicketSla(ticket: {
    id: string;
    ticketCode: string;
    createdAt: Date;
    status: TicketStatus | string;
    finalPriority?: PriorityLevel | null;
    aiSuggestedPriority?: PriorityLevel | null;
  }): Promise<SlaTicketStatus> {
    const cfg = await this.getSlaConfig();
    const now = Date.now();
    const priority = ticket.finalPriority || ticket.aiSuggestedPriority || PriorityLevel.MEDIUM;

    let dbTracking = await prisma.slaTracking.findUnique({
      where: { ticketId: ticket.id },
    });

    if (!dbTracking) {
      const deadlines = this.calculateDeadlinesWithConfig(ticket.createdAt, priority, cfg);
      dbTracking = await prisma.slaTracking.create({
        data: {
          ticketId: ticket.id,
          ticketCode: ticket.ticketCode,
          priority: String(priority),
          status: String(ticket.status),
          responseDeadline: new Date(deadlines.responseDeadline),
          assignmentDeadline: new Date(deadlines.assignmentDeadline),
          resolutionDeadline: new Date(deadlines.resolutionDeadline),
          slaStatus: 'ON_TRACK',
          isPaused: false,
          escalationTier: 0,
        },
      });
    }

    // Nếu ticket đã hoàn thành hoặc đóng
    if (ticket.status === TicketStatus.COMPLETED || ticket.status === TicketStatus.CLOSED) {
      const isResBreached = now > new Date(dbTracking.resolutionDeadline).getTime();
      const finalStatus = isResBreached ? 'BREACHED' : 'ON_TRACK';
      if (dbTracking.slaStatus !== finalStatus || dbTracking.status !== ticket.status) {
        dbTracking = await prisma.slaTracking.update({
          where: { ticketId: ticket.id },
          data: { slaStatus: finalStatus, status: String(ticket.status) },
        });
      }
      return this.formatSlaTracking(dbTracking);
    }

    if (dbTracking.isPaused) {
      if (dbTracking.status !== ticket.status) {
        dbTracking = await prisma.slaTracking.update({
          where: { ticketId: ticket.id },
          data: { status: String(ticket.status) },
        });
      }
      return this.formatSlaTracking(dbTracking);
    }

    // Kiểm tra các mốc deadline
    const responseDeadlineMs = new Date(dbTracking.responseDeadline).getTime();
    const assignmentDeadlineMs = new Date(dbTracking.assignmentDeadline).getTime();
    const resolutionDeadlineMs = new Date(dbTracking.resolutionDeadline).getTime();

    const isRespBreached = ticket.status === TicketStatus.PENDING && now > responseDeadlineMs;
    const isAssignBreached = (ticket.status === TicketStatus.PENDING || ticket.status === TicketStatus.ASSIGNED) && now > assignmentDeadlineMs;
    const isResBreached = now > resolutionDeadlineMs;

    let targetDeadlineMs = resolutionDeadlineMs;
    if (ticket.status === TicketStatus.PENDING) {
      targetDeadlineMs = responseDeadlineMs;
    } else if (ticket.status === TicketStatus.ASSIGNED) {
      targetDeadlineMs = assignmentDeadlineMs;
    }

    const totalWindowMs = targetDeadlineMs - new Date(ticket.createdAt).getTime();
    const elapsedMs = now - new Date(ticket.createdAt).getTime();
    const ratio = totalWindowMs > 0 ? elapsedMs / totalWindowMs : 1.0;

    const hasAnyBreach = isRespBreached || isAssignBreached || isResBreached || ratio >= 1.0;

    let newSlaStatus: 'ON_TRACK' | 'AT_RISK' | 'BREACHED' = 'ON_TRACK';
    let newTier = 0;

    if (hasAnyBreach) {
      newSlaStatus = 'BREACHED';
      const hoursOverdue = (now - targetDeadlineMs) / (1000 * 60 * 60);
      if (hoursOverdue > cfg.autoEscalationHours) {
        newTier = 3; // Leo thang lên Ban Giám Đốc
      } else {
        newTier = 2; // Báo động BMB điều phối
      }
    } else if (ratio >= cfg.warningThresholdPercent / 100) {
      newSlaStatus = 'AT_RISK';
      newTier = 1; // Nhắc nhở KTV/BMB
    } else {
      newSlaStatus = 'ON_TRACK';
      newTier = 0;
    }

    if (dbTracking.slaStatus !== newSlaStatus || dbTracking.escalationTier !== newTier || dbTracking.status !== ticket.status) {
      dbTracking = await prisma.slaTracking.update({
        where: { ticketId: ticket.id },
        data: {
          slaStatus: newSlaStatus,
          escalationTier: newTier,
          status: String(ticket.status),
        },
      });
    }

    return this.formatSlaTracking(dbTracking);
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
        // Tiếp tục nếu DB không hỗ trợ pg_try_advisory_lock
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

      const cfg = await this.getSlaConfig();
      const debounceMs = (cfg.alertDebounceMinutes || 15) * 60 * 1000;

      for (const t of activeTickets) {
        const sla = await this.evaluateTicketSla(t);
        if (sla.slaStatus === 'BREACHED' && sla.escalationTier >= 2) {
          const nowMs = Date.now();
          const lastAlertMs = sla.lastAlertSentAt ? new Date(sla.lastAlertSentAt).getTime() : 0;

          if (!sla.lastAlertSentAt || nowMs - lastAlertMs > debounceMs) {
            console.warn(`[SLA_BREACH_ALERT] Sự cố ${t.ticketCode} đã QUÁ HẠN SLA! Cấp độ leo thang: Tier ${sla.escalationTier}. Phụ trách: ${t.assignedTech?.fullName || 'Chưa phân công'}`);
            
            const now = new Date();
            await prisma.slaTracking.update({
              where: { ticketId: t.id },
              data: { lastAlertSentAt: now },
            });

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
              // Bắt lỗi nhẹ khi tạo thông báo
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[SLA_CYCLE_ERROR]', err?.message?.slice(0, 80));
    } finally {
      if (dbLocked) {
        try {
          await prisma.$queryRaw`SELECT pg_advisory_unlock(888123)`;
        } catch {
          // Bắt lỗi khi unlock
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
