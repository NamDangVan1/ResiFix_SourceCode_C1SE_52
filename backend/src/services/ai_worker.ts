import { MediaType, NotificationType, PriorityLevel, Role, TicketStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { analyzeIncidentWithGemini, AiAnalysisResult } from './gemini.service';

export const AI_STATUS = {
  ANALYZING: 'ANALYZING',
  COMPLETED: 'COMPLETED',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
} as const;
export type AiStatus = (typeof AI_STATUS)[keyof typeof AI_STATUS];

const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 10000; // 10 giây quét 1 lần

class AiWorkerService {
  private intervalId: NodeJS.Timeout | null = null;
  private isProcessingPoll: boolean = false;
  private inFlightTicketIds: Set<string> = new Set();

  public async reconcileLegacyTickets(): Promise<void> {
    try {
      await prisma.incidentTicket.updateMany({
        where: {
          aiStatus: AI_STATUS.ANALYZING,
          aiSuggestedCategory: { not: null },
          isAiFallbackManual: false,
        },
        data: { aiStatus: AI_STATUS.COMPLETED },
      });

      await prisma.incidentTicket.updateMany({
        where: {
          aiStatus: AI_STATUS.ANALYZING,
          isAiFallbackManual: true,
        },
        data: { aiStatus: AI_STATUS.MANUAL_REVIEW },
      });
    } catch (err: any) {
      console.warn('[AI Worker Legacy Reconcile Warning]', err?.message || err);
    }
  }

  public start(): void {
    if (this.intervalId) return;
    console.log('🤖 [AI Worker] Khởi động tiến trình đánh giá sự cố nền AI (Neon PostgreSQL persistence)...');

    // Đồng bộ ticket cũ và quét ngay lập tức khi khởi động server để phục hồi các tác vụ dở dang từ trước khi restart
    this.reconcileLegacyTickets()
      .then(() => this.pollPendingTickets())
      .catch((err) => console.error('[AI Worker Init Poll Error]', err?.message || err));

    this.intervalId = setInterval(() => {
      this.pollPendingTickets().catch((err) =>
        console.error('[AI Worker Poll Error]', err?.message || err)
      );
    }, POLL_INTERVAL_MS);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Kích hoạt phân tích ngay lập tức mà không chặn luồng HTTP response
  public triggerAiAnalysis(ticketId: string): void {
    setImmediate(() => {
      this.processTicket(ticketId).catch((err) =>
        console.error(`[AI Worker Immediate Error ${ticketId}]`, err?.message || err)
      );
    });
  }

  public async pollPendingTickets(): Promise<void> {
    if (this.isProcessingPoll) return;
    this.isProcessingPoll = true;
    try {
      // Tìm các ticket đang ở trạng thái ANALYZING và chưa vượt quá số lần thử lại tối đa
      const pendingTickets = await prisma.incidentTicket.findMany({
        where: {
          aiStatus: AI_STATUS.ANALYZING,
          aiRetryCount: { lt: MAX_RETRIES },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 25,
      });

      for (const t of pendingTickets) {
        if (!this.inFlightTicketIds.has(t.id)) {
          await this.processTicket(t.id);
        }
      }
    } catch (err: any) {
      console.warn('[AI Worker Poll Query Warning]', err?.message || err);
    } finally {
      this.isProcessingPoll = false;
    }
  }

  public async processTicket(ticketId: string): Promise<void> {
    if (this.inFlightTicketIds.has(ticketId)) return;
    this.inFlightTicketIds.add(ticketId);

    try {
      const ticket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        include: {
          media: {
            where: { mediaType: MediaType.SCENE_BEFORE },
            select: { imageUrl: true },
          },
        },
      });

      if (!ticket || ticket.aiStatus !== AI_STATUS.ANALYZING) {
        return;
      }

      // Kiểm tra nếu đã vượt quá số lần thử lại
      if (ticket.aiRetryCount >= MAX_RETRIES) {
        await this.markTicketForManualReview(
          ticket.id,
          ticket.ticketCode,
          `Đã thử lại ${ticket.aiRetryCount} lần nhưng không nhận được kết quả hợp lệ từ AI.`
        );
        return;
      }

      // Tăng số lần thử lại trước khi gọi Gemini để đảm bảo lưu bền vững trên Neon
      const currentAttempt = ticket.aiRetryCount + 1;
      await prisma.incidentTicket.update({
        where: { id: ticketId },
        data: { aiRetryCount: currentAttempt },
      });

      const imageUrls = ticket.media.map((m) => m.imageUrl);
      const aiResult: AiAnalysisResult = await analyzeIncidentWithGemini(
        ticket.description,
        ticket.locationNote,
        imageUrls
      );

      // Nếu Gemini trả về fallback do lỗi hoặc timeout và đã hết số lần thử lại
      if (aiResult.isFallbackManual) {
        if (currentAttempt >= MAX_RETRIES) {
          await this.markTicketForManualReview(
            ticket.id,
            ticket.ticketCode,
            `Gemini phản hồi không thành công (${aiResult.rawResponse?.reason || 'TIMEOUT'}). Chuyển BMB duyệt thủ công.`,
            aiResult
          );
        } else {
          // Còn cơ hội thử lại ở chu kỳ poll tiếp theo
          await prisma.incidentTicket.update({
            where: { id: ticketId },
            data: {
              aiError: `Lần thử ${currentAttempt}/${MAX_RETRIES} thất bại: ${aiResult.rawResponse?.reason || 'GEMINI_FALLBACK'}`,
            },
          });
        }
        return;
      }

      // Xử lý thành công: Cập nhật gợi ý AI vào ticket
      // Quan trọng: Kiểm tra xem Ban quản lý (BMB) đã tự phân loại / phê duyệt trước đó chưa
      const freshTicket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        select: {
          finalCategory: true,
          finalPriority: true,
          bmbApprovedById: true,
          status: true,
        },
      });

      const isAlreadyClassifiedByBmb = Boolean(
        freshTicket?.finalCategory ||
        freshTicket?.finalPriority ||
        freshTicket?.bmbApprovedById ||
        freshTicket?.status !== TicketStatus.PENDING
      );

      // KHÔNG ghi đè finalCategory hoặc finalPriority nếu BMB đã xác nhận
      await prisma.incidentTicket.update({
        where: { id: ticketId },
        data: {
          aiStatus: AI_STATUS.COMPLETED,
          aiSummary: aiResult.summary,
          aiSuggestedCategory: aiResult.category,
          aiSuggestedPriority: aiResult.priority,
          aiDiscrepancyNotes: aiResult.discrepancyNotes || null,
          aiLatencyMs: aiResult.latencyMs,
          isAiValidJson: aiResult.isValidJson,
          isAiFallbackManual: false,
          aiRawResponse: aiResult.rawResponse,
          aiError: null,
        },
      });

      // Ghi nhật ký tiến trình (StatusLog)
      await prisma.ticketStatusLog.create({
        data: {
          ticketId: ticket.id,
          fromStatus: freshTicket?.status || TicketStatus.PENDING,
          toStatus: freshTicket?.status || TicketStatus.PENDING,
          title: 'AI đã hoàn tất đánh giá',
          note: `Gemini phân tích (${aiResult.latencyMs}ms): Gợi ý ${aiResult.category} • Ưu tiên ${aiResult.priority}.${
            aiResult.discrepancyNotes ? ` [Lưu ý kiểm tra: ${aiResult.discrepancyNotes}]` : ''
          }${isAlreadyClassifiedByBmb ? ' (Ban quản lý đã phân loại trước đó, giữ nguyên phân loại của BMB).' : ''}`,
          changedById: null,
        },
      });

      // Gửi thông báo cho BMB (chống gửi lặp thông báo nếu đã có thông báo NEW_INCIDENT_AI hoặc hoàn tất)
      const existingNoti = await prisma.notification.findFirst({
        where: {
          ticketId: ticket.id,
          type: NotificationType.NEW_INCIDENT_AI,
        },
      });

      if (!existingNoti) {
        const managers = await prisma.user.findMany({
          where: { role: Role.BMB, isActive: true },
          select: { id: true },
        });

        if (managers.length > 0) {
          await prisma.notification.createMany({
            data: managers.map((m) => ({
              userId: m.id,
              ticketId: ticket.id,
              type: NotificationType.NEW_INCIDENT_AI,
              title: `[AI gợi ý: ${aiResult.category}] Sự cố ${ticket.ticketCode}`,
              message: `${aiResult.summary} • ${ticket.locationNote}${
                aiResult.discrepancyNotes ? ` (⚠️ ${aiResult.discrepancyNotes})` : ''
              }`,
              fcmSent: false,
            })),
          });
        }
      }
    } catch (err: any) {
      console.error(`[AI Worker Process Error ${ticketId}]`, err?.message || err);
    } finally {
      this.inFlightTicketIds.delete(ticketId);
    }
  }

  private async markTicketForManualReview(
    ticketId: string,
    ticketCode: string,
    reason: string,
    fallbackResult?: AiAnalysisResult
  ): Promise<void> {
    try {
      await prisma.incidentTicket.update({
        where: { id: ticketId },
        data: {
          aiStatus: AI_STATUS.MANUAL_REVIEW,
          isAiFallbackManual: true,
          aiError: reason,
          ...(fallbackResult
            ? {
                aiSummary: fallbackResult.summary,
                aiSuggestedCategory: fallbackResult.category,
                aiSuggestedPriority: fallbackResult.priority,
                aiDiscrepancyNotes: fallbackResult.discrepancyNotes || null,
                aiLatencyMs: fallbackResult.latencyMs,
                aiRawResponse: fallbackResult.rawResponse,
              }
            : {}),
        },
      });

      await prisma.ticketStatusLog.create({
        data: {
          ticketId,
          toStatus: TicketStatus.PENDING,
          title: 'Cần đánh giá thủ công',
          note: `AI không thể hoàn tất phân loại tự động (${reason}). Chuyển Ban quản lý xử lý thủ công.`,
          changedById: null,
        },
      });

      // Thông báo cho BMB một lần duy nhất
      const existingAlert = await prisma.notification.findFirst({
        where: {
          ticketId,
          type: NotificationType.AI_TIMEOUT_ALERT,
        },
      });

      if (!existingAlert) {
        const managers = await prisma.user.findMany({
          where: { role: Role.BMB, isActive: true },
          select: { id: true },
        });

        if (managers.length > 0) {
          await prisma.notification.createMany({
            data: managers.map((m) => ({
              userId: m.id,
              ticketId,
              type: NotificationType.AI_TIMEOUT_ALERT,
              title: `[Cần đánh giá thủ công] Sự cố ${ticketCode}`,
              message: `AI không thể phân loại tự động sau nhiều lần thử. Vui lòng Ban quản lý kiểm tra và phân công trực tiếp.`,
              fcmSent: false,
            })),
          });
        }
      }
    } catch (err: any) {
      console.error(`[AI Worker Manual Review Mark Error ${ticketId}]`, err?.message || err);
    }
  }
}

export const aiWorker = new AiWorkerService();
