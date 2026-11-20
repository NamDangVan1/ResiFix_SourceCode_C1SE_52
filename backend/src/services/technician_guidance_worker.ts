import { prisma } from '../config/database';
import {
  generateTechnicianGuidance,
  detectSafetyHazard,
  TechnicianGuidanceInput,
  TechnicianGuidanceResult
} from './technician_guidance.service';

export const GUIDANCE_STATUS = {
  GENERATING: 'GENERATING',
  READY: 'READY',
  UNAVAILABLE: 'UNAVAILABLE'
} as const;
export type GuidanceStatus = (typeof GUIDANCE_STATUS)[keyof typeof GUIDANCE_STATUS];

const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 10000;
const LOCK_LEASE_MS = 120000; // 2 phút lease lock

class TechnicianGuidanceWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private isProcessingPoll: boolean = false;
  private readonly workerId = `tech-worker-${process.pid}-${Math.random().toString(36).substring(2, 8)}`;

  public start(): void {
    if (this.intervalId) return;
    console.log(`🤖 [Technician Guidance Worker] Khởi động tiến trình trợ lý AI cho KTV (Worker ID: ${this.workerId})...`);

    // Quét ngay khi khởi động để khôi phục các tác vụ dở dang từ trước khi restart
    this.pollPendingTasks().catch((err) =>
      console.error('[Technician Guidance Worker Init Poll Error]', err?.message || err)
    );

    this.intervalId = setInterval(() => {
      this.pollPendingTasks().catch((err) =>
        console.error('[Technician Guidance Worker Poll Error]', err?.message || err)
      );
    }, POLL_INTERVAL_MS);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Kích hoạt xử lý tác vụ trợ lý ngay lập tức (không chặn luồng HTTP response)
   */
  public triggerGuidance(ticketId: string): void {
    setImmediate(() => {
      this.processTicket(ticketId).catch((err) =>
        console.error(`[Technician Guidance Worker Immediate Error ${ticketId}]`, err?.message || err)
      );
    });
  }

  /**
   * Polling định kỳ quét các tác vụ GENERATING bị tồn đọng hoặc do server restart
   */
  public async pollPendingTasks(): Promise<void> {
    if (this.isProcessingPoll) return;
    this.isProcessingPoll = true;

    try {
      const now = new Date();

      // Tìm các tác vụ GENERATING mà quyền xử lý đã hết hạn (hoặc chưa từng có lock) và chưa vượt quá số lần thử lại tối đa
      const pendingList = await prisma.technicianAiGuidance.findMany({
        where: {
          status: GUIDANCE_STATUS.GENERATING,
          retryCount: { lt: MAX_RETRIES },
          OR: [
            { lockExpiresAt: null },
            { lockExpiresAt: { lt: now } }
          ]
        },
        select: { ticketId: true },
        take: 20,
        orderBy: { createdAt: 'asc' }
      });

      for (const item of pendingList) {
        await this.processTicket(item.ticketId);
      }

      // Xử lý các tác vụ GENERATING đã vượt quá số lần thử lại tối đa nhưng chưa được đánh dấu UNAVAILABLE
      const deadTasks = await prisma.technicianAiGuidance.findMany({
        where: {
          status: GUIDANCE_STATUS.GENERATING,
          retryCount: { gte: MAX_RETRIES }
        },
        include: {
          ticket: {
            select: {
              id: true,
              ticketCode: true,
              title: true,
              description: true,
              finalCategory: true,
              aiSuggestedCategory: true,
              finalPriority: true,
              aiSuggestedPriority: true,
              locationNote: true
            }
          }
        },
        take: 10
      });

      for (const dead of deadTasks) {
        const hazard = dead.ticket
          ? detectSafetyHazard({
              ticketId: dead.ticket.id,
              ticketCode: dead.ticket.ticketCode,
              title: dead.ticket.title,
              rawDescription: dead.ticket.description,
              category: dead.ticket.finalCategory || dead.ticket.aiSuggestedCategory || null,
              priority: dead.ticket.finalPriority || dead.ticket.aiSuggestedPriority || null,
              locationLabel: dead.ticket.locationNote
            })
          : { isHazard: false, hazardType: null, hazardWarning: null, forcedStopConditions: [], forcedSafeSteps: [] };

        await prisma.technicianAiGuidance.update({
          where: { id: dead.id },
          data: {
            status: GUIDANCE_STATUS.UNAVAILABLE,
            lastErrorCode: 'MAX_RETRIES_EXCEEDED',
            isSafetyHazard: hazard.isHazard,
            hazardType: hazard.hazardType,
            hazardWarning: hazard.hazardWarning,
            stopAndEscalateWhen: hazard.forcedStopConditions.length > 0 ? (hazard.forcedStopConditions as any) : null,
            safeHandlingSteps: hazard.forcedSafeSteps.length > 0 ? (hazard.forcedSafeSteps as any) : null,
            lockedAt: null,
            lockedBy: null,
            lockExpiresAt: null
          }
        });
      }
    } catch (err: any) {
      console.warn('[Technician Guidance Worker Poll Warning]', err?.message || err);
    } finally {
      this.isProcessingPoll = false;
    }
  }

  /**
   * Xử lý một tác vụ với phân tán lock và cập nhật kết quả
   */
  public async processTicket(ticketId: string): Promise<void> {
    const now = new Date();
    const lockExpiresAt = new Date(now.getTime() + LOCK_LEASE_MS);

    // Khóa nguyên tử ở cấp cơ sở dữ liệu để chống xung đột giữa 2 tiến trình hoặc 2 lần gọi đồng thời
    const lockResult = await prisma.technicianAiGuidance.updateMany({
      where: {
        ticketId,
        status: GUIDANCE_STATUS.GENERATING,
        retryCount: { lt: MAX_RETRIES },
        OR: [
          { lockExpiresAt: null },
          { lockExpiresAt: { lt: now } }
        ]
      },
      data: {
        lockedAt: now,
        lockedBy: this.workerId,
        lockExpiresAt,
        retryCount: { increment: 1 }
      }
    });

    if (lockResult.count === 0) {
      // Đã có worker khác đang xử lý hoặc tác vụ không ở trạng thái GENERATING đủ điều kiện
      return;
    }

    // Lấy thông tin ticket từ database
    const ticket = await prisma.incidentTicket.findUnique({
      where: { id: ticketId },
      include: {
        area: true,
        aiGuidance: true
      }
    });

    if (!ticket) {
      await prisma.technicianAiGuidance.updateMany({
        where: { ticketId },
        data: {
          status: GUIDANCE_STATUS.UNAVAILABLE,
          lastErrorCode: 'TICKET_NOT_FOUND',
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null
        }
      });
      return;
    }

    const currentRetryCount = ticket.aiGuidance?.retryCount ?? 1;

    // Chuẩn bị dữ liệu đầu vào cho Gemini (ưu tiên finalCategory/finalPriority của BMB)
    const category = ticket.finalCategory || ticket.aiSuggestedCategory || null;
    const priority = ticket.finalPriority || ticket.aiSuggestedPriority || null;

    const guidanceInput: TechnicianGuidanceInput = {
      ticketId: ticket.id,
      ticketCode: ticket.ticketCode,
      title: ticket.title,
      rawDescription: ticket.description,
      category,
      priority,
      areaName: ticket.area?.areaName || null,
      locationLabel: ticket.locationNote || ticket.area?.locationLabel || null,
      discrepancyNotes: ticket.aiDiscrepancyNotes || null
    };

    try {
      const guidanceResult: TechnicianGuidanceResult = await generateTechnicianGuidance(guidanceInput);

      // Lưu kết quả thành công vào Neon DB
      await prisma.technicianAiGuidance.update({
        where: { ticketId },
        data: {
          status: GUIDANCE_STATUS.READY,
          possibleCauses: guidanceResult.possibleCauses as any,
          inspectionChecklist: guidanceResult.inspectionChecklist as any,
          estimatedMaterials: guidanceResult.estimatedMaterials as any,
          safeHandlingSteps: guidanceResult.safeHandlingSteps as any,
          stopAndEscalateWhen: guidanceResult.stopAndEscalateWhen as any,
          uncertaintyNote: guidanceResult.uncertaintyNote,
          isSafetyHazard: guidanceResult.isSafetyHazard,
          hazardType: guidanceResult.hazardType,
          hazardWarning: guidanceResult.hazardWarning,
          lastErrorCode: null,
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null
        }
      });
    } catch (err: any) {
      console.error(`[Technician Guidance Worker Error ${ticketId}] Attempt ${currentRetryCount}:`, err?.message || err);

      const hazard = detectSafetyHazard(guidanceInput);

      if (currentRetryCount >= MAX_RETRIES) {
        // Đã hết số lần thử lại tối đa -> chuyển sang UNAVAILABLE vĩnh viễn cho tác vụ này
        await prisma.technicianAiGuidance.update({
          where: { ticketId },
          data: {
            status: GUIDANCE_STATUS.UNAVAILABLE,
            lastErrorCode: err?.code || 'GENERATION_FAILED',
            isSafetyHazard: hazard.isHazard,
            hazardType: hazard.hazardType,
            hazardWarning: hazard.hazardWarning,
            stopAndEscalateWhen: hazard.forcedStopConditions.length > 0 ? (hazard.forcedStopConditions as any) : null,
            safeHandlingSteps: hazard.forcedSafeSteps.length > 0 ? (hazard.forcedSafeSteps as any) : null,
            lockedAt: null,
            lockedBy: null,
            lockExpiresAt: null
          }
        });
      } else {
        // Còn số lần thử lại -> nhả lock để lần sau thử lại
        await prisma.technicianAiGuidance.update({
          where: { ticketId },
          data: {
            lastErrorCode: err?.code || 'TRANSIENT_ERROR',
            lockedAt: null,
            lockedBy: null,
            lockExpiresAt: null
          }
        });
      }
    }
  }
}

export const technicianGuidanceWorker = new TechnicianGuidanceWorker();
