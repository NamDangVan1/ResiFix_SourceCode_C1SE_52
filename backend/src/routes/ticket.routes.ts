import { Router, Response } from 'express';
import { randomInt } from 'crypto';
import {
  Prisma,
  Role,
  TicketStatus,
  MediaType,
  NotificationType,
  IncidentCategory,
  PriorityLevel,
} from '@prisma/client';
import bcrypt from 'bcrypt';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { analyzeIncidentWithGemini } from '../services/gemini.service';
import { prisma } from '../db';

const router = Router();

const TECHNICIAN_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  specialty: true,
  specialtyLabel: true,
  shiftName: true,
  isOnDuty: true,
  isActive: true,
  assignedTickets: {
    where: { status: { in: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS] } },
    select: { id: true, ticketCode: true, title: true, status: true, locationNote: true },
  },
} satisfies Prisma.UserSelect;

const TECHNICIAN_SPECIALTY_LABELS: Record<IncidentCategory, string> = {
  [IncidentCategory.PLUMBING]: 'Điện - Nước',
  [IncidentCategory.ELECTRICAL]: 'Điện & Chiếu sáng',
  [IncidentCategory.ELEVATOR]: 'Thang máy & Cơ khí',
  [IncidentCategory.HVAC]: 'Điều hòa & Thông gió',
  [IncidentCategory.ACCESS_SECURITY]: 'Điện tử & An ninh',
  [IncidentCategory.OTHER]: 'Khác',
};

const isIncidentCategory = (value: unknown): value is IncidentCategory =>
  typeof value === 'string' && Object.values(IncidentCategory).includes(value as IncidentCategory);

const isPriorityLevel = (value: unknown): value is PriorityLevel =>
  typeof value === 'string' && Object.values(PriorityLevel).includes(value as PriorityLevel);

const isHttpImageUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

class RouteError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'RouteError';
  }
}

// Hàm ép kiểu an toàn cho req.params của Express để không bao giờ bị lỗi TS2339 / TS2322
const getParamAsString = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || '';
  return String(param || '');
};

// ============================================================================
// 1. GET /api/tickets/assets/qr/:qrCode - Quét mã QR thiết bị tự điền vị trí (FR05, US-09)
// ============================================================================
router.get(
  '/assets/qr/:qrCode',
  authenticateJWT,
  authorizeRoles(Role.RESIDENT),
  async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawParam = getParamAsString(req.params.qrCode).trim();
    let qrCode = rawParam;
    try {
      const parsedUrl = new URL(rawParam);
      qrCode = parsedUrl.searchParams.get('data') || parsedUrl.searchParams.get('qrCode') || parsedUrl.pathname.split('/').filter(Boolean).pop() || '';
    } catch {
      const queryCode = rawParam.match(/[?&](?:data|qrcode|code)=([^&#]+)/i)?.[1];
      if (queryCode) qrCode = decodeURIComponent(queryCode);
    }
    qrCode = qrCode.trim().toUpperCase();
    if (!qrCode || qrCode.length > 128) {
      res.status(400).json({ success: false, message: 'Mã QR không hợp lệ.' });
      return;
    }

    const asset = await prisma.equipmentAsset.findFirst({
      where: { qrCode, isActive: true },
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
    console.error('Lỗi khi tra cứu mã QR thiết bị:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi tra cứu mã QR thiết bị.' });
  }
  }
);

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
        select: TECHNICIAN_SELECT,
        orderBy: { isOnDuty: 'desc' },
      });

      res.status(200).json({ success: true, technicians });
    } catch (error) {
      console.error('Lỗi khi tải danh sách Kỹ thuật viên ca trực:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách Kỹ thuật viên ca trực.' });
    }
  }
);

// ============================================================================
// 3. POST /api/tickets/technicians - Tạo tài khoản Kỹ thuật viên (BMB only)
// ============================================================================
router.post(
  '/technicians',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const body = req.body ?? {};
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const specialty = body.specialty;

    if (fullName.length < 2 || fullName.length > 100 || phone.length < 8 || phone.length > 32) {
      res.status(400).json({ success: false, message: 'Vui lòng nhập họ tên và số điện thoại hợp lệ.' });
      return;
    }
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
      res.status(400).json({ success: false, message: 'Email không hợp lệ.' });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ success: false, message: 'Mật khẩu ban đầu phải có từ 6 đến 128 ký tự.' });
      return;
    }
    if (!isIncidentCategory(specialty)) {
      res.status(400).json({ success: false, message: 'Vui lòng chọn chuyên môn hợp lệ.' });
      return;
    }
    if (body.isOnDuty !== undefined && typeof body.isOnDuty !== 'boolean') {
      res.status(400).json({ success: false, message: 'Trạng thái ca trực không hợp lệ.' });
      return;
    }

    try {
      const technician = await prisma.user.create({
        data: {
          fullName,
          phone,
          email: email || null,
          passwordHash: await bcrypt.hash(password, 10),
          role: Role.TECHNICIAN,
          specialty,
          specialtyLabel: TECHNICIAN_SPECIALTY_LABELS[specialty],
          shiftName: typeof body.shiftName === 'string' ? body.shiftName.trim() || null : null,
          isOnDuty: body.isOnDuty ?? false,
          isActive: true,
        },
        select: TECHNICIAN_SELECT,
      });

      res.status(201).json({ success: true, technician });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        res.status(409).json({ success: false, message: 'Số điện thoại hoặc email đã được sử dụng.' });
        return;
      }
      res.status(500).json({ success: false, message: 'Không thể tạo kỹ thuật viên.' });
    }
  }
);

// ============================================================================
// 4. PATCH /api/tickets/technicians/:technicianId - Cập nhật hồ sơ KTV (BMB only)
// ============================================================================
router.patch(
  '/technicians/:technicianId',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const technicianId = getParamAsString(req.params.technicianId);
    const body = req.body ?? {};
    const data: Prisma.UserUpdateInput = {};

    if (body.fullName !== undefined) {
      const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
      if (fullName.length < 2 || fullName.length > 100) {
        res.status(400).json({ success: false, message: 'Họ tên phải có từ 2 đến 100 ký tự.' });
        return;
      }
      data.fullName = fullName;
    }
    if (body.phone !== undefined) {
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
      if (phone.length < 8 || phone.length > 32) {
        res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ.' });
        return;
      }
      data.phone = phone;
    }
    if (body.email !== undefined) {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
        res.status(400).json({ success: false, message: 'Email không hợp lệ.' });
        return;
      }
      data.email = email || null;
    }
    if (body.specialty !== undefined) {
      const specialty = body.specialty as unknown;
      if (!isIncidentCategory(specialty)) {
        res.status(400).json({ success: false, message: 'Vui lòng chọn chuyên môn hợp lệ.' });
        return;
      }
      data.specialty = specialty;
      data.specialtyLabel = TECHNICIAN_SPECIALTY_LABELS[specialty];
    }
    if (body.shiftName !== undefined) {
      data.shiftName = typeof body.shiftName === 'string' ? body.shiftName.trim() || null : null;
    }
    if (body.isOnDuty !== undefined) {
      if (typeof body.isOnDuty !== 'boolean') {
        res.status(400).json({ success: false, message: 'Trạng thái ca trực không hợp lệ.' });
        return;
      }
      data.isOnDuty = body.isOnDuty;
    }
    if (body.password !== undefined && body.password !== '') {
      if (typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 128) {
        res.status(400).json({ success: false, message: 'Mật khẩu phải có từ 6 đến 128 ký tự.' });
        return;
      }
      data.passwordHash = await bcrypt.hash(body.password, 10);
    }
    if (Object.keys(data).length === 0) {
      res.status(400).json({ success: false, message: 'Không có thông tin nào để cập nhật.' });
      return;
    }

    try {
      const existingTechnician = await prisma.user.findFirst({
        where: { id: technicianId, role: Role.TECHNICIAN, isActive: true },
        select: { id: true },
      });
      if (!existingTechnician) {
        res.status(404).json({ success: false, message: 'Không tìm thấy kỹ thuật viên.' });
        return;
      }

      const technician = await prisma.user.update({
        where: { id: technicianId },
        data,
        select: TECHNICIAN_SELECT,
      });
      res.status(200).json({ success: true, technician });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        res.status(409).json({ success: false, message: 'Số điện thoại hoặc email đã được sử dụng.' });
        return;
      }
      res.status(500).json({ success: false, message: 'Không thể cập nhật kỹ thuật viên.' });
    }
  }
);

// ============================================================================
// 5. DELETE /api/tickets/technicians/:technicianId - Vô hiệu hóa tài khoản KTV
// Xóa mềm để giữ lại lịch sử ticket và quan hệ dữ liệu.
// ============================================================================
router.delete(
  '/technicians/:technicianId',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const technicianId = getParamAsString(req.params.technicianId);

    try {
      await prisma.$transaction(async (tx) => {
        const technician = await tx.user.findFirst({
          where: { id: technicianId, role: Role.TECHNICIAN, isActive: true },
          select: { id: true },
        });
        if (!technician) throw new RouteError(404, 'Không tìm thấy kỹ thuật viên.');

        const activeAssignments = await tx.incidentTicket.count({
          where: {
            assignedTechId: technicianId,
            status: { in: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS] },
          },
        });
        if (activeAssignments > 0) {
          throw new RouteError(409, 'Không thể vô hiệu hóa kỹ thuật viên đang có công việc. Hãy điều phối lại trước.');
        }

        const result = await tx.user.updateMany({
          where: { id: technicianId, role: Role.TECHNICIAN, isActive: true },
          data: { isActive: false, isOnDuty: false, fcmToken: null },
        });
        if (result.count !== 1) throw new RouteError(409, 'Tài khoản kỹ thuật viên đã được cập nhật.');
      });
      res.status(200).json({ success: true, message: 'Đã vô hiệu hóa kỹ thuật viên.' });
    } catch (error) {
      if (error instanceof RouteError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error('Lỗi khi vô hiệu hóa kỹ thuật viên:', error);
      res.status(500).json({ success: false, message: 'Không thể xóa kỹ thuật viên.' });
    }
  }
);

// ============================================================================
// 3. GET /api/tickets - Lấy danh sách Sự cố tự lọc theo Vai trò RBAC (US-13, US-21, US-29, US-39)
// ============================================================================
router.get('/', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const statusQuery = req.query.status ? String(req.query.status) : undefined;
    if (statusQuery && !Object.values(TicketStatus).includes(statusQuery as TicketStatus)) {
      res.status(400).json({ success: false, message: 'Bộ lọc trạng thái không hợp lệ.' });
      return;
    }

    const whereClause: Prisma.IncidentTicketWhereInput = {};

    if (req.user?.role === Role.RESIDENT) {
      whereClause.residentId = req.user.userId;
    } else if (req.user?.role === Role.TECHNICIAN) {
      whereClause.assignedTechId = req.user.userId;
    }

    if (statusQuery) {
      whereClause.status = statusQuery as TicketStatus;
    }

    const tickets = await prisma.incidentTicket.findMany({
      where: whereClause,
      include: {
        resident: { select: { fullName: true, apartmentCode: true, buildingBlock: true, phone: true } },
        assignedTech: { select: { fullName: true, specialtyLabel: true, phone: true, isOnDuty: true } },
        asset: true,
        media: true,
        statusLogs: {
          include: { changedBy: { select: { fullName: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ success: true, count: tickets.length, tickets });
  } catch (error) {
    console.error('Lỗi khi tải danh sách sự cố:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách sự cố.' });
  }
});

// ============================================================================
// 4. POST /api/tickets - Cư dân gửi báo cáo sự cố + Tự động gọi Gemini AI (FR03, FR04, US-06..US-19)
// ============================================================================
router.post(
  '/',
  authenticateJWT,
  authorizeRoles(Role.RESIDENT),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { title, description, locationNote, qrCode, isVoiceInput, imageUrls } = body;
      if (typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 5000) {
        res.status(400).json({
          success: false,
          message: 'Mô tả sự cố phải có từ 10 đến 5.000 ký tự.',
        });
        return;
      }
      if (title !== undefined && (typeof title !== 'string' || title.trim().length > 160)) {
        res.status(400).json({ success: false, message: 'Tiêu đề sự cố không hợp lệ.' });
        return;
      }
      if (isVoiceInput !== undefined && typeof isVoiceInput !== 'boolean') {
        res.status(400).json({ success: false, message: 'Thông tin nhập bằng giọng nói không hợp lệ.' });
        return;
      }
      if (imageUrls !== undefined && !Array.isArray(imageUrls)) {
        res.status(400).json({ success: false, message: 'Danh sách ảnh không hợp lệ.' });
        return;
      }
      const photos: unknown[] = imageUrls ?? [];
      if (photos.length > 3 || photos.some((url) => !isHttpImageUrl(url))) {
        res.status(400).json({ success: false, message: 'Mỗi báo cáo được đính kèm tối đa 3 ảnh HTTPS hợp lệ.' });
        return;
      }
      const cleanDesc = description.trim();

      let asset = null;
      if (qrCode) {
        if (typeof qrCode !== 'string' || qrCode.trim().length > 128) {
          res.status(400).json({ success: false, message: 'Mã QR thiết bị không hợp lệ.' });
          return;
        }
        asset = await prisma.equipmentAsset.findFirst({
          where: { qrCode: qrCode.trim().toUpperCase(), isActive: true },
        });
        if (!asset) {
          res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị đang hoạt động với mã QR này.' });
          return;
        }
      }

      const resident = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { apartmentCode: true, buildingBlock: true, floorNumber: true },
      });
      const submittedLocation = typeof locationNote === 'string' ? locationNote.trim() : '';
      const profileLocation = [
        resident?.apartmentCode ? `Căn hộ ${resident.apartmentCode}` : '',
        resident?.buildingBlock || '',
        resident?.floorNumber ? `Tầng ${resident.floorNumber}` : '',
      ].filter(Boolean).join(' • ');
      const finalLocation = asset
        ? `${asset.locationLabel} • Thiết bị: ${asset.qrCode}`
        : submittedLocation || profileLocation;
      if (!finalLocation || finalLocation.length > 300) {
        res.status(400).json({ success: false, message: 'Vui lòng nhập vị trí sự cố hợp lệ.' });
        return;
      }

      const aiResult = await analyzeIncidentWithGemini(cleanDesc, finalLocation);
      const autoTitle =
        (typeof title === 'string' && title.trim()) ||
        (cleanDesc.length > 48 ? cleanDesc.substring(0, 45) + '...' : cleanDesc);

      const managers = await prisma.user.findMany({
        where: { role: Role.BMB, isActive: true, id: { not: req.user!.userId } },
        select: { id: true },
      });

      const createTicketCode = () => `#RF-${new Date().getFullYear()}-${randomInt(100000, 1000000)}`;
      let ticketCode = createTicketCode();
      let newTicket;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          newTicket = await prisma.incidentTicket.create({
            data: {
              ticketCode,
              title: autoTitle,
              description: cleanDesc,
              isVoiceInput: isVoiceInput === true,
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
                  imageUrl: url as string,
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
                    ? 'Không có kết quả phân loại tự động; đang chờ BMB duyệt thủ công.'
                    : `Gemini gợi ý: ${aiResult.category} • Ưu tiên: ${aiResult.priority}`,
                  changedById: req.user!.userId,
                },
              },
              ...(managers.length > 0 ? {
                notifications: {
                  create: managers.map((manager) => ({
                    userId: manager.id,
                    type: aiResult.isFallbackManual
                      ? NotificationType.AI_TIMEOUT_ALERT
                      : NotificationType.NEW_INCIDENT_AI,
                    title: `${aiResult.isFallbackManual ? 'Cần phân loại thủ công' : 'Sự cố mới'}: ${ticketCode}`,
                    message: `${autoTitle} • ${finalLocation}`,
                    fcmSent: false,
                  })),
                },
              } : {}),
            },
            include: { asset: true, media: true, statusLogs: { include: { changedBy: { select: { fullName: true } } } } },
          });
          break;
        } catch (error) {
          if (!isUniqueConstraintError(error) || attempt === 4) throw error;
          ticketCode = createTicketCode();
        }
      }
      if (!newTicket) throw new Error('Unable to create unique ticket code.');

      res.status(201).json({
        success: true,
        message: aiResult.isFallbackManual
          ? `Đã gửi báo cáo sự cố ${ticketCode}. Báo cáo đang chờ Ban quản lý phân loại.`
          : `Đã gửi báo cáo sự cố ${ticketCode}.`,
        ticket: newTicket,
      });
    } catch (error) {
      console.error('Lỗi tạo sự cố:', error);
      res.status(500).json({ success: false, message: 'Lỗi hệ thống khi tạo báo cáo sự cố.' });
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
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { finalCategory, finalPriority, assignedTechId, bmbAdminNote } = body;
      if (finalCategory !== undefined && !isIncidentCategory(finalCategory)) {
        res.status(400).json({ success: false, message: 'Danh mục sự cố không hợp lệ.' });
        return;
      }
      if (finalPriority !== undefined && !isPriorityLevel(finalPriority)) {
        res.status(400).json({ success: false, message: 'Mức độ ưu tiên không hợp lệ.' });
        return;
      }
      if (typeof assignedTechId !== 'string' || !assignedTechId.trim()) {
        res.status(400).json({ success: false, message: 'Vui lòng chọn kỹ thuật viên.' });
        return;
      }
      if (bmbAdminNote !== undefined && (typeof bmbAdminNote !== 'string' || bmbAdminNote.length > 2000)) {
        res.status(400).json({ success: false, message: 'Ghi chú điều phối không hợp lệ.' });
        return;
      }

      const ticket = await prisma.incidentTicket.findUnique({ where: { id: ticketId } });
      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy phiếu sự cố!' });
        return;
      }
      if (ticket.status !== TicketStatus.PENDING) {
        res.status(409).json({ success: false, message: 'Sự cố đã được xử lý hoặc phân công trước đó.' });
        return;
      }

      const tech = await prisma.user.findFirst({
        where: { id: assignedTechId.trim(), role: Role.TECHNICIAN, isActive: true, isOnDuty: true },
        select: { id: true, fullName: true, specialtyLabel: true },
      });
      if (!tech) {
        res.status(400).json({
          success: false,
          message: 'Kỹ thuật viên không tồn tại hoặc đang ngoài ca trực (Off-duty). Vui lòng chọn KTV đang trực!',
        });
        return;
      }

      const categoryToSave = finalCategory ?? ticket.aiSuggestedCategory ?? IncidentCategory.OTHER;
      const priorityToSave = finalPriority ?? ticket.aiSuggestedPriority ?? PriorityLevel.MEDIUM;
      const updatedTicket = await prisma.$transaction(async (tx) => {
        const currentTech = await tx.user.findFirst({
          where: { id: tech.id, role: Role.TECHNICIAN, isActive: true, isOnDuty: true },
          select: { id: true, fullName: true, specialtyLabel: true },
        });
        if (!currentTech) throw new RouteError(409, 'Kỹ thuật viên hiện không còn trong ca trực.');

        const updateResult = await tx.incidentTicket.updateMany({
          where: { id: ticketId, status: TicketStatus.PENDING },
          data: {
            finalCategory: categoryToSave,
            finalPriority: priorityToSave,
            assignedTechId: currentTech.id,
            bmbApprovedById: req.user!.userId,
            bmbAdminNote: typeof bmbAdminNote === 'string' ? bmbAdminNote.trim() || null : null,
            assignedAt: new Date(),
            status: TicketStatus.ASSIGNED,
          },
        });
        if (updateResult.count !== 1) throw new RouteError(409, 'Sự cố đã được xử lý hoặc phân công trước đó.');

        await tx.ticketStatusLog.create({
          data: {
            ticketId,
            fromStatus: TicketStatus.PENDING,
            toStatus: TicketStatus.ASSIGNED,
            title: 'Đã phân công (Assigned)',
            note: `BMB (${req.user!.fullName}) đã duyệt [${categoryToSave} - ${priorityToSave}] và giao cho KTV ${currentTech.fullName}`,
            changedById: req.user!.userId,
          },
        });
        await tx.notification.createMany({
          data: [
            {
              userId: currentTech.id,
              ticketId,
              type: NotificationType.TASK_ASSIGNED,
              title: `Mới phân công: ${ticket.ticketCode}`,
              message: `Ban quản lý vừa giao cho bạn sự cố "${ticket.title}" tại ${ticket.locationNote}.`,
              fcmSent: false,
            },
            {
              userId: ticket.residentId,
              ticketId,
              type: NotificationType.STATUS_UPDATED,
              title: `Đã phân công kỹ thuật viên cho ${ticket.ticketCode}`,
              message: `KTV ${currentTech.fullName} đã được phân công xử lý sự cố của bạn.`,
              fcmSent: false,
            },
          ],
        });
        return tx.incidentTicket.findUniqueOrThrow({
          where: { id: ticketId },
          include: {
            assignedTech: { select: { fullName: true, specialtyLabel: true } },
            statusLogs: {
              include: { changedBy: { select: { fullName: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        });
      });

      res.status(200).json({
        success: true,
        message: `Đã duyệt phân loại và giao việc cho KTV ${tech.fullName}.`,
        ticket: updatedTicket,
      });
    } catch (error) {
      if (error instanceof RouteError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error('Lỗi khi duyệt và giao việc:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi duyệt và giao việc.' });
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

      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy sự cố.' });
        return;
      }
      if (ticket.assignedTechId !== req.user!.userId) {
        res.status(403).json({ success: false, message: 'Bạn không được phân công xử lý sự cố này!' });
        return;
      }
      if (ticket.status !== TicketStatus.ASSIGNED) {
        res.status(409).json({ success: false, message: 'Sự cố không còn ở trạng thái chờ nhận việc.' });
        return;
      }

      const updatedTicket = await prisma.$transaction(async (tx) => {
        const result = await tx.incidentTicket.updateMany({
          where: { id: ticketId, assignedTechId: req.user!.userId, status: TicketStatus.ASSIGNED },
          data: { status: TicketStatus.IN_PROGRESS, acknowledgedAt: new Date() },
        });
        if (result.count !== 1) throw new RouteError(409, 'Sự cố đã được nhận hoặc cập nhật trước đó.');
        await tx.ticketStatusLog.create({
          data: {
            ticketId,
            fromStatus: TicketStatus.ASSIGNED,
            toStatus: TicketStatus.IN_PROGRESS,
            title: 'Đang xử lý (In Progress)',
            note: `KTV ${req.user!.fullName} đã xác nhận nhận việc và bắt đầu xử lý.`,
            changedById: req.user!.userId,
          },
        });
        await tx.notification.create({
          data: {
            userId: ticket.residentId,
            ticketId,
            type: NotificationType.STATUS_UPDATED,
            title: `Sự cố ${ticket.ticketCode} đang được xử lý`,
            message: `KTV ${req.user!.fullName} đã nhận việc và đang tiến hành khắc phục.`,
            fcmSent: false,
          },
        });
        return tx.incidentTicket.findUniqueOrThrow({
          where: { id: ticketId },
          include: { statusLogs: { orderBy: { createdAt: 'asc' } } },
        });
      });

      res.status(200).json({
        success: true,
        message: 'Đã xác nhận nhận việc! Trạng thái chuyển sang Đang xử lý (IN_PROGRESS).',
        ticket: updatedTicket,
      });
    } catch (error) {
      if (error instanceof RouteError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error('Lỗi khi nhận việc:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi nhận việc.' });
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
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { proofImageUrls, techRepairNote, isQrVerifiedByTech } = body;
      const proofPhotos: unknown[] = Array.isArray(proofImageUrls) ? proofImageUrls : [];
      if (proofPhotos.length === 0 || proofPhotos.length > 3 || proofPhotos.some((url) => !isHttpImageUrl(url))) {
        res.status(400).json({
          success: false,
          message: 'Cần đính kèm từ 1 đến 3 ảnh nghiệm thu HTTPS hợp lệ.',
        });
        return;
      }
      if (techRepairNote !== undefined && (typeof techRepairNote !== 'string' || techRepairNote.length > 5000)) {
        res.status(400).json({ success: false, message: 'Ghi chú kết quả xử lý không hợp lệ.' });
        return;
      }
      if (isQrVerifiedByTech !== undefined && typeof isQrVerifiedByTech !== 'boolean') {
        res.status(400).json({ success: false, message: 'Trạng thái xác thực QR không hợp lệ.' });
        return;
      }

      const ticket = await prisma.incidentTicket.findUnique({ where: { id: ticketId } });
      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy sự cố.' });
        return;
      }
      if (ticket.assignedTechId !== req.user!.userId) {
        res.status(403).json({ success: false, message: 'Bạn không có quyền cập nhật sự cố này.' });
        return;
      }
      if (ticket.status !== TicketStatus.IN_PROGRESS) {
        res.status(409).json({ success: false, message: 'Chỉ có thể hoàn tất sự cố đang được xử lý.' });
        return;
      }

      const updatedTicket = await prisma.$transaction(async (tx) => {
        const result = await tx.incidentTicket.updateMany({
          where: { id: ticketId, assignedTechId: req.user!.userId, status: TicketStatus.IN_PROGRESS },
          data: {
            status: TicketStatus.COMPLETED,
            completedAt: new Date(),
            isQrVerifiedByTech: isQrVerifiedByTech === true,
            techRepairNote: typeof techRepairNote === 'string' ? techRepairNote.trim() || null : null,
          },
        });
        if (result.count !== 1) throw new RouteError(409, 'Sự cố đã được hoàn tất hoặc cập nhật trước đó.');
        await tx.ticketMedia.createMany({
          data: proofPhotos.map((url, idx) => ({
            ticketId,
            imageUrl: url as string,
            mediaType: MediaType.REPAIR_PROOF,
            caption: `Ảnh nghiệm thu sau khi sửa ${idx + 1}`,
            uploadedById: req.user!.userId,
          })),
        });
        await tx.ticketStatusLog.create({
          data: {
            ticketId,
            fromStatus: TicketStatus.IN_PROGRESS,
            toStatus: TicketStatus.COMPLETED,
            title: 'Hoàn thành sửa chữa (Completed)',
            note: `KTV ${req.user!.fullName} đã gửi ${proofPhotos.length} ảnh nghiệm thu.`,
            changedById: req.user!.userId,
          },
        });
        await tx.notification.create({
          data: {
            userId: ticket.residentId,
            ticketId,
            type: NotificationType.STATUS_UPDATED,
            title: `Sự cố ${ticket.ticketCode} đã hoàn thành`,
            message: `KTV ${req.user!.fullName} đã gửi ảnh nghiệm thu. Vui lòng kiểm tra và xác nhận đã giải quyết.`,
            fcmSent: false,
          },
        });
        return tx.incidentTicket.findUniqueOrThrow({
          where: { id: ticketId },
          include: {
            media: { orderBy: { createdAt: 'asc' } },
            statusLogs: {
              include: { changedBy: { select: { fullName: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        });
      });

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật Hoàn thành và gửi ảnh nghiệm thu cho Cư dân!',
        ticket: updatedTicket,
      });
    } catch (error) {
      if (error instanceof RouteError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error('Lỗi khi hoàn thành công việc:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi hoàn thành công việc.' });
    }
  }
);

// ============================================================================
// 8. PATCH /api/tickets/:id/close - Cư dân nghiệm thu Đã giải quyết & Đánh giá 1-5 sao (FR09, US-38, US-40)
// ============================================================================
router.patch(
  '/:id/close',
  authenticateJWT,
  authorizeRoles(Role.RESIDENT),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.id);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { ratingStars, ratingComment } = body;
      if (!Number.isInteger(ratingStars) || ratingStars < 1 || ratingStars > 5) {
        res.status(400).json({ success: false, message: 'Đánh giá phải từ 1 đến 5 sao.' });
        return;
      }
      if (ratingComment !== undefined && (typeof ratingComment !== 'string' || ratingComment.length > 5000)) {
        res.status(400).json({ success: false, message: 'Nhận xét đánh giá không hợp lệ.' });
        return;
      }

      const ticket = await prisma.incidentTicket.findUnique({ where: { id: ticketId } });
      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy sự cố!' });
        return;
      }
      if (ticket.residentId !== req.user!.userId) {
        res.status(403).json({ success: false, message: 'Bạn không có quyền nghiệm thu sự cố này.' });
        return;
      }

      if (ticket.status !== TicketStatus.COMPLETED) {
        res.status(400).json({
          success: false,
          message: 'Chỉ có thể xác nhận Đã giải quyết khi Kỹ thuật viên đã Hoàn thành sửa chữa!',
        });
        return;
      }

      const stars = ratingStars as number;
      const closedTicket = await prisma.$transaction(async (tx) => {
        const result = await tx.incidentTicket.updateMany({
          where: { id: ticketId, residentId: req.user!.userId, status: TicketStatus.COMPLETED },
          data: {
            status: TicketStatus.CLOSED,
            resolvedConfirmedAt: new Date(),
            ratingStars: stars,
            ratingComment: typeof ratingComment === 'string' ? ratingComment.trim() || null : null,
          },
        });
        if (result.count !== 1) throw new RouteError(409, 'Sự cố đã được nghiệm thu hoặc cập nhật trước đó.');
        await tx.ticketStatusLog.create({
          data: {
            ticketId,
            fromStatus: TicketStatus.COMPLETED,
            toStatus: TicketStatus.CLOSED,
            title: 'Đã đóng sự cố (Closed)',
            note: `Cư dân đã nghiệm thu và đánh giá ${stars} sao.`,
            changedById: req.user!.userId,
          },
        });
        if (ticket.assignedTechId) {
          await tx.notification.create({
            data: {
              userId: ticket.assignedTechId,
              ticketId,
              type: NotificationType.TICKET_CLOSED,
              title: `Cư dân đã nghiệm thu ${ticket.ticketCode}`,
              message: `Cư dân đã đóng sự cố và đánh giá ${stars} sao.`,
              fcmSent: false,
            },
          });
        }
        return tx.incidentTicket.findUniqueOrThrow({
          where: { id: ticketId },
          include: { statusLogs: { orderBy: { createdAt: 'asc' } } },
        });
      });

      res.status(200).json({
        success: true,
        message: `Cảm ơn bạn đã nghiệm thu! Sự cố ${ticket.ticketCode} đã chính thức đóng.`,
        ticket: closedTicket,
      });
    } catch (error) {
      if (error instanceof RouteError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error('Lỗi khi đóng sự cố:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi đóng sự cố.' });
    }
  }
);

export default router;
