import { Router, Response } from 'express';
import {
  PrismaClient,
  Role,
  TicketStatus,
  MediaType,
  NotificationType,
  IncidentCategory,
  PriorityLevel,
} from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { analyzeIncidentWithGemini } from '../services/gemini.service';

const router = Router();
const prisma = new PrismaClient();

// Hàm ép kiểu an toàn cho req.params của Express để không bao giờ bị lỗi TS2339 / TS2322
const getParamAsString = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || '';
  return String(param || '');
};

// ============================================================================
// 1. GET /api/tickets/assets/qr/:qrCode - Quét mã QR thiết bị tự điền vị trí (FR05, US-09)
// ============================================================================
router.get('/assets/qr/:qrCode', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const qrCode = getParamAsString(req.params.qrCode).trim().toUpperCase();
    const asset = await prisma.equipmentAsset.findUnique({
      where: { qrCode },
    });

    if (!asset) {
      res.status(404).json({
        success: false,
        message: `Không tìm thấy thiết bị nào khớp với mã QR [${qrCode}]. Vui lòng nhập vị trí thủ công!`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Đã nhận diện từ mã QR: ${asset.assetName}`,
      asset,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi khi tra cứu mã QR thiết bị', error });
  }
});

// ============================================================================
// 2. GET /api/tickets/technicians/on-duty - Lấy danh sách KTV ca trực & tải công việc (FR06, Task 2.3.2.4)
// ============================================================================
router.get(
  '/technicians/on-duty',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const technicians = await prisma.user.findMany({
        where: { role: Role.TECHNICIAN, isActive: true },
        select: {
          id: true,
          fullName: true,
          phone: true,
          specialty: true,
          specialtyLabel: true,
          shiftName: true,
          isOnDuty: true,
          assignedTickets: {
            where: { status: { in: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS] } },
            select: { id: true, ticketCode: true, title: true, status: true, locationNote: true },
          },
        },
        orderBy: { isOnDuty: 'desc' },
      });

      res.status(200).json({ success: true, technicians });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách Kỹ thuật viên ca trực', error });
    }
  }
);

// ============================================================================
// 3. GET /api/tickets - Lấy danh sách Sự cố tự lọc theo Vai trò RBAC (US-13, US-21, US-29, US-39)
// ============================================================================
router.get('/', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const statusQuery = req.query.status ? String(req.query.status) : undefined;
    const whereClause: any = {};

    if (req.user?.role === Role.RESIDENT) {
      whereClause.residentId = req.user.userId;
    } else if (req.user?.role === Role.TECHNICIAN) {
      whereClause.assignedTechId = req.user.userId;
    }

    if (statusQuery && Object.values(TicketStatus).includes(statusQuery as TicketStatus)) {
      whereClause.status = statusQuery as TicketStatus;
    }

    const tickets = await prisma.incidentTicket.findMany({
      where: whereClause,
      include: {
        resident: { select: { fullName: true, apartmentCode: true, buildingBlock: true, phone: true } },
        assignedTech: { select: { fullName: true, specialtyLabel: true, phone: true, isOnDuty: true } },
        asset: true,
        media: true,
        statusLogs: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ success: true, count: tickets.length, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách sự cố', error });
  }
});

// ============================================================================
// 4. POST /api/tickets - Cư dân gửi báo cáo sự cố + Tự động gọi Gemini AI (FR03, FR04, US-06..US-19)
// ============================================================================
router.post(
  '/',
  authenticateJWT,
  authorizeRoles(Role.RESIDENT, Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { title, description, locationNote, qrCode, isVoiceInput, imageUrls } = req.body;

      // Ràng buộc Risk R2 & US-07, US-44: Mô tả tối thiểu 10 ký tự
      if (!description || String(description).trim().length < 10) {
        res.status(400).json({
          success: false,
          message: 'Mô tả sự cố phải có tối thiểu 10 ký tự để Trợ lý Gemini AI phân tích chính xác (Risk R2)!',
        });
        return;
      }

      const cleanDesc = String(description).trim();
      const photos: string[] = Array.isArray(imageUrls) ? imageUrls.slice(0, 3) : [];

      let asset = null;
      if (qrCode) {
        asset = await prisma.equipmentAsset.findUnique({
          where: { qrCode: String(qrCode).trim().toUpperCase() },
        });
      }

      // Tự sinh mã Ticket duy nhất (#RF-2026-xxx - US-12)
      const totalCount = await prisma.incidentTicket.count();
      const ticketCode = `#RF-2026-${String(totalCount + 15).padStart(3, '0')}`;

      const finalLocation =
        locationNote || (asset ? `${asset.locationLabel} • Thiết bị: ${asset.qrCode}` : 'Khu vực chung tòa nhà');

      // Gọi Trợ lý Gemini Flash AI phân tích câu tiếng Việt (FR04, US-14..US-19)
      const aiResult = await analyzeIncidentWithGemini(cleanDesc, finalLocation);

      const autoTitle =
        (title && String(title).trim()) ||
        (cleanDesc.length > 48 ? cleanDesc.substring(0, 45) + '...' : cleanDesc);

      const newTicket = await prisma.incidentTicket.create({
        data: {
          ticketCode,
          title: autoTitle,
          description: cleanDesc,
          isVoiceInput: Boolean(isVoiceInput),
          locationNote: finalLocation,
          assetId: asset?.id || null,
          isQrScannedByRes: Boolean(asset),
          aiSummary: aiResult.summary,
          aiSuggestedCategory: aiResult.category,
          aiSuggestedPriority: aiResult.priority,
          aiLatencyMs: aiResult.latencyMs,
          isAiValidJson: aiResult.isValidJson,
          isAiFallbackManual: aiResult.isFallbackManual,
          aiRawResponse: aiResult.rawResponse,
          status: TicketStatus.PENDING,
          residentId: req.user!.userId,
          media: {
            create: photos.map((url, idx) => ({
              imageUrl: String(url),
              mediaType: MediaType.SCENE_BEFORE,
              caption: `Ảnh hiện trường ${idx + 1}`,
              uploadedById: req.user!.userId,
            })),
          },
          statusLogs: {
            create: {
              toStatus: TicketStatus.PENDING,
              title: 'Đã tiếp nhận (Chờ duyệt)',
              note: aiResult.isFallbackManual
                ? '⚠️ AI chuyển luồng dự phòng - Đang chờ BMB duyệt phân loại (US-19)'
                : `✨ Gemini AI gợi ý: ${aiResult.category} • Ưu tiên: ${aiResult.priority} (${aiResult.latencyMs}ms)`,
              changedById: req.user!.userId,
            },
          },
        },
        include: { asset: true, media: true, statusLogs: true },
      });

      res.status(201).json({
        success: true,
        message: `Đã gửi báo cáo sự cố ${ticketCode} thành công! Gemini AI đã phân tích trong ${aiResult.latencyMs}ms.`,
        ticket: newTicket,
      });
    } catch (error) {
      console.error('Lỗi tạo sự cố:', error);
      res.status(500).json({ success: false, message: 'Lỗi hệ thống khi tạo báo cáo sự cố', error });
    }
  }
);

// ============================================================================
// 5. PATCH /api/tickets/:id/approve-assign - BMB duyệt/sửa gợi ý AI & Giao việc KTV (FR06, US-23..US-28)
// ============================================================================
router.patch(
  '/:id/approve-assign',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.id);
      const { finalCategory, finalPriority, assignedTechId, bmbAdminNote } = req.body;

      const ticket = await prisma.incidentTicket.findUnique({ where: { id: ticketId } });
      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy phiếu sự cố!' });
        return;
      }

      const tech = await prisma.user.findUnique({ where: { id: String(assignedTechId || '') } });
      if (!tech || tech.role !== Role.TECHNICIAN || !tech.isOnDuty) {
        res.status(400).json({
          success: false,
          message: 'Kỹ thuật viên không tồn tại hoặc đang ngoài ca trực (Off-duty). Vui lòng chọn KTV đang trực!',
        });
        return;
      }

      const categoryToSave: IncidentCategory = finalCategory || ticket.aiSuggestedCategory || IncidentCategory.OTHER;
      const priorityToSave: PriorityLevel = finalPriority || ticket.aiSuggestedPriority || PriorityLevel.MEDIUM;

      const updatedTicket = await prisma.incidentTicket.update({
        where: { id: ticketId },
        data: {
          finalCategory: categoryToSave,
          finalPriority: priorityToSave,
          assignedTechId: tech.id,
          bmbApprovedById: req.user!.userId,
          bmbAdminNote: bmbAdminNote ? String(bmbAdminNote) : null,
          assignedAt: new Date(),
          status: TicketStatus.ASSIGNED,
          statusLogs: {
            create: {
              fromStatus: ticket.status,
              toStatus: TicketStatus.ASSIGNED,
              title: 'Đã phân công (Assigned)',
              note: `BMB (${req.user!.fullName}) đã duyệt [${categoryToSave} - ${priorityToSave}] và giao cho KTV ${tech.fullName}`,
              changedById: req.user!.userId,
            },
          },
          notifications: {
            create: [
              {
                userId: tech.id,
                type: NotificationType.TASK_ASSIGNED,
                title: `🔥 MỚI PHÂN CÔNG: ${ticket.ticketCode}`,
                message: `Ban quản lý vừa giao cho bạn sự cố "${ticket.title}" tại ${ticket.locationNote}.`,
                fcmSent: true,
              },
              {
                userId: ticket.residentId,
                type: NotificationType.STATUS_UPDATED,
                title: `👷 Đã phân công Kỹ thuật viên cho ${ticket.ticketCode}`,
                message: `KTV ${tech.fullName} (${tech.specialtyLabel}) đã được phân công xử lý sự cố của bạn.`,
                fcmSent: true,
              },
            ],
          },
        },
        include: { assignedTech: true, statusLogs: { orderBy: { createdAt: 'desc' } } },
      });

      res.status(200).json({
        success: true,
        message: `Đã duyệt phân loại và giao việc cho KTV ${tech.fullName} thành công!`,
        ticket: updatedTicket,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi khi duyệt và giao việc', error });
    }
  }
);

// ============================================================================
// 6. PATCH /api/tickets/:id/acknowledge - KTV bấm "Nhận việc ngay" (Assigned -> In Progress | FR07, US-31, US-32)
// ============================================================================
router.patch(
  '/:id/acknowledge',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.id);
      const ticket = await prisma.incidentTicket.findUnique({ where: { id: ticketId } });

      if (!ticket || ticket.assignedTechId !== req.user!.userId) {
        res.status(403).json({ success: false, message: 'Bạn không được phân công xử lý sự cố này!' });
        return;
      }

      const updatedTicket = await prisma.incidentTicket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.IN_PROGRESS,
          acknowledgedAt: new Date(),
          statusLogs: {
            create: {
              fromStatus: ticket.status,
              toStatus: TicketStatus.IN_PROGRESS,
              title: 'Đang xử lý (In Progress)',
              note: `KTV ${req.user!.fullName} đã xác nhận nhận việc và bắt đầu xử lý.`,
              changedById: req.user!.userId,
            },
          },
          notifications: {
            create: {
              userId: ticket.residentId,
              type: NotificationType.STATUS_UPDATED,
              title: `🛠️ Sự cố ${ticket.ticketCode} đang được xử lý`,
              message: `KTV ${req.user!.fullName} đã nhận việc và đang tiến hành khắc phục.`,
              fcmSent: true,
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: 'Đã xác nhận nhận việc! Trạng thái chuyển sang Đang xử lý (IN_PROGRESS).',
        ticket: updatedTicket,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi khi nhận việc', error });
    }
  }
);

// ============================================================================
// 7. PATCH /api/tickets/:id/complete - KTV tải ảnh nghiệm thu & Hoàn thành (In Progress -> Completed | FR07, US-33, US-34)
// ============================================================================
router.patch(
  '/:id/complete',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.id);
      const { proofImageUrls, techRepairNote, isQrVerifiedByTech } = req.body;

      const proofPhotos: string[] = Array.isArray(proofImageUrls) ? proofImageUrls : [];
      if (proofPhotos.length === 0) {
        res.status(400).json({
          success: false,
          message: 'Bắt buộc phải đính kèm ít nhất 1 ảnh nghiệm thu sau khi sửa chữa (FR07, US-33)!',
        });
        return;
      }

      const ticket = await prisma.incidentTicket.findUnique({ where: { id: ticketId } });
      if (!ticket || ticket.assignedTechId !== req.user!.userId) {
        res.status(403).json({ success: false, message: 'Không tìm thấy sự cố hoặc bạn không có quyền!' });
        return;
      }

      const updatedTicket = await prisma.incidentTicket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.COMPLETED,
          completedAt: new Date(),
          isQrVerifiedByTech: Boolean(isQrVerifiedByTech),
          techRepairNote: techRepairNote
            ? String(techRepairNote)
            : 'Đã hoàn thành khắc phục sự cố và kiểm tra hoạt động ổn định.',
          media: {
            create: proofPhotos.map((url, idx) => ({
              imageUrl: String(url),
              mediaType: MediaType.REPAIR_PROOF,
              caption: `Ảnh nghiệm thu sau khi sửa ${idx + 1}`,
              uploadedById: req.user!.userId,
            })),
          },
          statusLogs: {
            create: {
              fromStatus: ticket.status,
              toStatus: TicketStatus.COMPLETED,
              title: 'Hoàn thành sửa chữa (Completed)',
              note: `KTV ${req.user!.fullName} đã gửi ${proofPhotos.length} ảnh nghiệm thu.`,
              changedById: req.user!.userId,
            },
          },
          notifications: {
            create: {
              userId: ticket.residentId,
              type: NotificationType.STATUS_UPDATED,
              title: `📸 Sự cố ${ticket.ticketCode} đã hoàn thành!`,
              message: `KTV ${req.user!.fullName} đã gửi ảnh nghiệm thu. Vui lòng kiểm tra và xác nhận Đã giải quyết!`,
              fcmSent: true,
            },
          },
        },
        include: { media: true, statusLogs: { orderBy: { createdAt: 'desc' } } },
      });

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật Hoàn thành và gửi ảnh nghiệm thu cho Cư dân!',
        ticket: updatedTicket,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi khi hoàn thành công việc', error });
    }
  }
);

// ============================================================================
// 8. PATCH /api/tickets/:id/close - Cư dân nghiệm thu Đã giải quyết & Đánh giá 1-5 sao (FR09, US-38, US-40)
// ============================================================================
router.patch(
  '/:id/close',
  authenticateJWT,
  authorizeRoles(Role.RESIDENT, Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.id);
      const { ratingStars, ratingComment } = req.body;

      const ticket = await prisma.incidentTicket.findUnique({ where: { id: ticketId } });
      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy sự cố!' });
        return;
      }

      if (ticket.status !== TicketStatus.COMPLETED) {
        res.status(400).json({
          success: false,
          message: 'Chỉ có thể xác nhận Đã giải quyết khi Kỹ thuật viên đã Hoàn thành sửa chữa!',
        });
        return;
      }

      const stars = ratingStars ? Math.min(5, Math.max(1, Number(ratingStars))) : 5;

      const closedTicket = await prisma.incidentTicket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.CLOSED,
          resolvedConfirmedAt: new Date(),
          ratingStars: stars,
          ratingComment: ratingComment ? String(ratingComment) : null,
          statusLogs: {
            create: {
              fromStatus: TicketStatus.COMPLETED,
              toStatus: TicketStatus.CLOSED,
              title: 'Đã đóng sự cố (Closed)',
              note: `Cư dân đã nghiệm thu ảnh và xác nhận Đã giải quyết (Đánh giá: ${stars} ⭐).`,
              changedById: req.user!.userId,
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: `Cảm ơn bạn đã nghiệm thu! Sự cố ${ticket.ticketCode} đã chính thức đóng.`,
        ticket: closedTicket,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi khi đóng sự cố', error });
    }
  }
);

export default router;