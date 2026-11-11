import { Router, Response } from 'express';
import { Role, TicketStatus } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../db';

const router = Router();

const getParamAsString = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || '';
  return String(param || '');
};

function formatScheduleRequest(r: any) {
  return {
    id: r.id,
    type: r.type,
    techId: r.techId,
    techName: r.techName,
    specialty: r.tech?.specialtyLabel || r.tech?.specialty || null,
    date: r.date,
    endDate: r.endDate || r.date,
    leaveType: r.leaveType,
    shiftName: r.shiftName,
    targetTechId: r.targetTechId,
    targetTechName: r.targetTechName,
    reason: r.reason,
    status: r.status,
    reviewNote: r.reviewNote,
    reviewedBy: r.reviewedByName || (r.reviewedBy ? r.reviewedBy.fullName : null),
    reviewedAt: r.reviewedAt ? new Date(r.reviewedAt).toISOString() : null,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
  };
}

// ============================================================================
// 1. KỸ THUẬT VIÊN: XEM LỊCH TRỰC, GỬI / HỦY YÊU CẦU ĐỔI CA & NGHỈ PHÉP
// ============================================================================

// GET /api/schedule/my-schedule - KTV xem lịch làm việc theo ngày/tuần/tháng
router.get(
  '/my-schedule',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;
      const tech = await prisma.user.findUnique({
        where: { id: techId },
        select: { id: true, fullName: true, shiftName: true, specialtyLabel: true, isOnDuty: true },
      });

      if (!tech) {
        res.status(404).json({ success: false, message: 'Không tìm thấy kỹ thuật viên.' });
        return;
      }

      // Danh sách ngày nghỉ đã được BMB duyệt
      const approvedLeaves = await prisma.shiftScheduleRequest.findMany({
        where: { techId, type: 'LEAVE', status: 'APPROVED' },
        include: { tech: { select: { specialty: true, specialtyLabel: true } } },
        orderBy: { createdAt: 'desc' },
      });

      // Danh sách ca trực đã đổi thành công (cả đổi cho người khác và nhận từ người khác)
      const approvedSwaps = await prisma.shiftScheduleRequest.findMany({
        where: {
          type: 'SHIFT_SWAP',
          status: 'APPROVED',
          OR: [{ techId }, { targetTechId: techId }],
        },
        include: { tech: { select: { specialty: true, specialtyLabel: true } } },
        orderBy: { createdAt: 'desc' },
      });

      res.status(200).json({
        success: true,
        technician: tech,
        baseShift: tech.shiftName || '08:00 - 17:00',
        approvedLeaves: approvedLeaves.map(formatScheduleRequest),
        approvedSwaps: approvedSwaps.map(formatScheduleRequest),
      });
    } catch (error) {
      console.error('Lỗi khi lấy lịch làm việc KTV:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải lịch làm việc.' });
    }
  }
);

// GET /api/schedule/my-requests - KTV xem các yêu cầu đổi ca / xin nghỉ của bản thân
router.get(
  '/my-requests',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;

      const myRequests = await prisma.shiftScheduleRequest.findMany({
        where: {
          OR: [{ techId }, { targetTechId: techId }],
        },
        include: { tech: { select: { specialty: true, specialtyLabel: true } } },
        orderBy: { createdAt: 'desc' },
      });

      res.status(200).json({ success: true, requests: myRequests.map(formatScheduleRequest) });
    } catch (error) {
      console.error('Lỗi tải danh sách yêu cầu KTV:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách yêu cầu.' });
    }
  }
);

// POST /api/schedule/leave - KTV gửi yêu cầu xin nghỉ phép (Nghỉ phép năm, ốm, không lương)
router.post(
  '/leave',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;
      const { date, endDate, leaveType, reason } = req.body || {};

      const cleanDate = typeof date === 'string' ? date.trim() : '';
      const cleanReason = typeof reason === 'string' ? reason.trim() : '';
      const validLeaveType = ['ANNUAL', 'SICK', 'UNPAID'].includes(leaveType) ? leaveType : 'ANNUAL';

      if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
        res.status(400).json({ success: false, message: 'Ngày bắt đầu nghỉ không đúng định dạng YYYY-MM-DD.' });
        return;
      }
      if (cleanReason.length < 5) {
        res.status(400).json({ success: false, message: 'Vui lòng nêu rõ lý do xin nghỉ (tối thiểu 5 ký tự).' });
        return;
      }

      const tech = await prisma.user.findUnique({
        where: { id: techId },
        select: { fullName: true, specialty: true, specialtyLabel: true },
      });

      // Kiểm tra trùng lặp yêu cầu nghỉ cùng ngày đang chờ duyệt hoặc đã duyệt
      const existing = await prisma.shiftScheduleRequest.findFirst({
        where: {
          techId,
          type: 'LEAVE',
          date: cleanDate,
          status: { notIn: ['REJECTED', 'CANCELLED'] },
        },
      });
      if (existing) {
        res.status(409).json({ success: false, message: `Bạn đã có yêu cầu nghỉ phép cho ngày ${cleanDate} (${existing.status}).` });
        return;
      }

      const created = await prisma.shiftScheduleRequest.create({
        data: {
          id: `leave-${Date.now()}`,
          type: 'LEAVE',
          techId,
          techName: tech?.fullName || 'KTV',
          date: cleanDate,
          endDate: typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : cleanDate,
          leaveType: validLeaveType,
          reason: cleanReason,
          status: 'PENDING',
        },
        include: { tech: { select: { specialty: true, specialtyLabel: true } } },
      });

      console.log(`[SCHEDULE] KTV ${created.techName} gửi đơn xin nghỉ ngày ${cleanDate} (${validLeaveType}): ${cleanReason}`);

      res.status(201).json({
        success: true,
        message: 'Đã gửi đơn xin nghỉ phép tới Ban Quản Lý (BMB) để xét duyệt.',
        request: formatScheduleRequest(created),
      });
    } catch (error) {
      console.error('Lỗi khi gửi đơn xin nghỉ:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi gửi đơn xin nghỉ.' });
    }
  }
);

// POST /api/schedule/swap - KTV gửi yêu cầu đổi ca trực với KTV khác
router.post(
  '/swap',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;
      const { date, shiftName, targetTechId, reason } = req.body || {};

      const cleanDate = typeof date === 'string' ? date.trim() : '';
      const cleanShift = typeof shiftName === 'string' ? shiftName.trim() : '08:00 - 17:00';
      const cleanTargetId = typeof targetTechId === 'string' ? targetTechId.trim() : '';
      const cleanReason = typeof reason === 'string' ? reason.trim() : '';

      if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
        res.status(400).json({ success: false, message: 'Ngày đổi ca không đúng định dạng YYYY-MM-DD.' });
        return;
      }
      if (!cleanTargetId || cleanTargetId === techId) {
        res.status(400).json({ success: false, message: 'Vui lòng chọn kỹ thuật viên khác để đổi ca.' });
        return;
      }
      if (cleanReason.length < 5) {
        res.status(400).json({ success: false, message: 'Vui lòng nêu rõ lý do đổi ca (tối thiểu 5 ký tự).' });
        return;
      }

      // Xác minh người gửi và người được đề nghị đổi ca
      const [requester, targetTech] = await Promise.all([
        prisma.user.findUnique({ where: { id: techId } }),
        prisma.user.findUnique({ where: { id: cleanTargetId } }),
      ]);

      if (!targetTech || targetTech.role !== Role.TECHNICIAN || !targetTech.isActive) {
        res.status(400).json({ success: false, message: 'Kỹ thuật viên được đề nghị không tồn tại hoặc đã ngừng hoạt động.' });
        return;
      }

      // Kiểm tra tính tương thích chuyên môn giữa 2 KTV
      if (requester?.specialty && targetTech.specialty && requester.specialty !== targetTech.specialty) {
        res.status(400).json({
          success: false,
          message: `KTV ${targetTech.fullName} có chuyên môn (${targetTech.specialtyLabel || targetTech.specialty}) không khớp với chuyên môn của bạn (${requester.specialtyLabel || requester.specialty}).`,
        });
        return;
      }

      // Kiểm tra KTV đích có đang nghỉ phép vào ngày đó không
      const targetOnLeave = await prisma.shiftScheduleRequest.findFirst({
        where: {
          techId: cleanTargetId,
          type: 'LEAVE',
          status: 'APPROVED',
          date: { lte: cleanDate },
          OR: [
            { endDate: null, date: cleanDate },
            { endDate: { gte: cleanDate } },
          ],
        },
      });
      if (targetOnLeave) {
        res.status(400).json({ success: false, message: `KTV ${targetTech.fullName} đã có lịch nghỉ phép vào ngày ${cleanDate}.` });
        return;
      }

      const created = await prisma.shiftScheduleRequest.create({
        data: {
          id: `swap-${Date.now()}`,
          type: 'SHIFT_SWAP',
          techId,
          techName: requester?.fullName || 'KTV',
          date: cleanDate,
          shiftName: cleanShift,
          targetTechId: cleanTargetId,
          targetTechName: targetTech.fullName,
          reason: cleanReason,
          status: 'PENDING',
        },
        include: { tech: { select: { specialty: true, specialtyLabel: true } } },
      });

      console.log(`[SCHEDULE] KTV ${created.techName} xin đổi ca ngày ${cleanDate} với KTV ${targetTech.fullName}`);

      res.status(201).json({
        success: true,
        message: `Đã gửi yêu cầu đổi ca với KTV ${targetTech.fullName} tới BMB để phê duyệt.`,
        request: formatScheduleRequest(created),
      });
    } catch (error) {
      console.error('Lỗi khi gửi yêu cầu đổi ca:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi gửi yêu cầu đổi ca.' });
    }
  }
);

// POST / PATCH /api/schedule/requests/:id/cancel - KTV tự hủy yêu cầu khi còn PENDING
const handleCancelScheduleRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reqId = getParamAsString(req.params.id);
    const techId = req.user!.userId;

    const target = await prisma.shiftScheduleRequest.findUnique({
      where: { id: reqId },
      include: { tech: { select: { specialty: true, specialtyLabel: true } } },
    });

    if (!target) {
      res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu.' });
      return;
    }
    if (target.techId !== techId) {
      res.status(403).json({ success: false, message: 'Bạn không có quyền hủy yêu cầu của người khác.' });
      return;
    }
    if (target.status !== 'PENDING') {
      res.status(400).json({ success: false, message: `Yêu cầu đã ở trạng thái ${target.status}, không thể hủy.` });
      return;
    }

    const updated = await prisma.shiftScheduleRequest.update({
      where: { id: reqId },
      data: { status: 'CANCELLED' },
      include: { tech: { select: { specialty: true, specialtyLabel: true } } },
    });

    res.status(200).json({ success: true, message: 'Đã hủy yêu cầu thành công.', request: formatScheduleRequest(updated) });
  } catch (error) {
    console.error('Lỗi khi hủy yêu cầu:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi hủy yêu cầu.' });
  }
};

router.post('/requests/:id/cancel', authenticateJWT, authorizeRoles(Role.TECHNICIAN), handleCancelScheduleRequest);
router.patch('/requests/:id/cancel', authenticateJWT, authorizeRoles(Role.TECHNICIAN), handleCancelScheduleRequest);

// ============================================================================
// 2. BAN QUẢN LÝ (BMB): XÉT DUYỆT ĐỔI CA / NGHỈ PHÉP & BÀN GIAO CÔNG VIỆC
// ============================================================================

// GET /api/schedule/admin/requests - BMB xem toàn bộ danh sách yêu cầu
router.get(
  '/admin/requests',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const type = typeof req.query.type === 'string' ? req.query.type : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;

      const where: any = {};
      if (type) where.type = type;
      if (status) where.status = status;

      const list = await prisma.shiftScheduleRequest.findMany({
        where,
        include: { tech: { select: { specialty: true, specialtyLabel: true } } },
        orderBy: { createdAt: 'desc' },
      });

      res.status(200).json({ success: true, requests: list.map(formatScheduleRequest) });
    } catch (error) {
      console.error('Lỗi BMB lấy yêu cầu lịch:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách yêu cầu.' });
    }
  }
);

// PATCH /api/schedule/admin/requests/:id - BMB duyệt / từ chối yêu cầu
router.patch(
  '/admin/requests/:id',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const reqId = getParamAsString(req.params.id);
      const { status, reviewNote, handoverTechId } = req.body || {};

      if (!['APPROVED', 'REJECTED'].includes(status)) {
        res.status(400).json({ success: false, message: 'Trạng thái xét duyệt phải là APPROVED hoặc REJECTED.' });
        return;
      }
      if (status === 'REJECTED' && (!reviewNote || typeof reviewNote !== 'string' || reviewNote.trim().length < 5)) {
        res.status(400).json({ success: false, message: 'Bắt buộc nhập lý do từ chối (tối thiểu 5 ký tự).' });
        return;
      }

      const target = await prisma.shiftScheduleRequest.findUnique({
        where: { id: reqId },
        include: { tech: { select: { specialty: true, specialtyLabel: true } } },
      });

      if (!target) {
        res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu.' });
        return;
      }
      if (target.status !== 'PENDING') {
        res.status(400).json({ success: false, message: `Yêu cầu đã được xử lý trước đó (${target.status}).` });
        return;
      }

      // NẾU DUYỆT NGHỈ PHÉP: Kiểm tra xem KTV có ticket đang xử lý không
      if (status === 'APPROVED' && target.type === 'LEAVE') {
        const activeTickets = await prisma.incidentTicket.findMany({
          where: {
            assignedTechId: target.techId,
            status: { in: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS] },
          },
          select: { id: true, ticketCode: true, title: true, status: true },
        });

        // Nếu còn ticket đang xử lý mà chưa chọn KTV bàn giao -> Cảnh báo yêu cầu bàn giao
        if (activeTickets.length > 0) {
          if (!handoverTechId) {
            res.status(400).json({
              success: false,
              requireHandover: true,
              message: `KTV ${target.techName} hiện còn ${activeTickets.length} sự cố đang xử lý. Vui lòng chọn KTV bàn giao trước khi duyệt nghỉ phép!`,
              activeTickets,
            });
            return;
          }

          // Bàn giao các ticket này sang KTV thay thế qua transaction
          const handoverTech = await prisma.user.findUnique({
            where: { id: handoverTechId },
            select: { id: true, fullName: true, isActive: true },
          });

          if (!handoverTech || !handoverTech.isActive) {
            res.status(400).json({ success: false, message: 'KTV nhận bàn giao không hợp lệ hoặc đã ngừng hoạt động.' });
            return;
          }

          await prisma.$transaction(async (tx) => {
            for (const ticket of activeTickets) {
              await tx.incidentTicket.update({
                where: { id: ticket.id },
                data: { assignedTechId: handoverTech.id },
                select: { id: true },
              });
              await tx.ticketStatusLog.create({
                data: {
                  ticketId: ticket.id,
                  fromStatus: ticket.status,
                  toStatus: ticket.status,
                  title: 'Bàn giao nhiệm vụ do KTV nghỉ phép',
                  note: `BMB duyệt đơn nghỉ phép của KTV ${target.techName}. Bàn giao xử lý sang KTV ${handoverTech.fullName}.`,
                  changedById: req.user!.userId,
                },
              });
            }
          });

          console.log(`[HANDOVER] Đã bàn giao ${activeTickets.length} sự cố từ ${target.techName} sang ${handoverTech.fullName} do nghỉ phép.`);
        }
      }

      const updated = await prisma.shiftScheduleRequest.update({
        where: { id: reqId },
        data: {
          status,
          reviewNote: typeof reviewNote === 'string' ? reviewNote.trim() : null,
          reviewedById: req.user!.userId,
          reviewedByName: req.user?.fullName || 'BMB Admin',
          reviewedAt: new Date(),
        },
        include: { tech: { select: { specialty: true, specialtyLabel: true } } },
      });

      console.log(`[AUDIT_LOG] BMB (${updated.reviewedByName}) đã ${status} yêu cầu ${updated.type} của ${updated.techName}`);

      res.status(200).json({
        success: true,
        message: status === 'APPROVED' ? 'Đã phê duyệt yêu cầu thành công.' : 'Đã từ chối yêu cầu.',
        request: formatScheduleRequest(updated),
      });
    } catch (error) {
      console.error('Lỗi khi duyệt yêu cầu lịch:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi duyệt yêu cầu.' });
    }
  }
);

export default router;
