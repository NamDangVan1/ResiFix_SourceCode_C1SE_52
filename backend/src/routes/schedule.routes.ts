import { Router, Response } from 'express';
import { Role, TicketStatus } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../db';
import { resiFixStore, ScheduleRequest } from '../data/resifix_store';

const router = Router();

const getParamAsString = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || '';
  return String(param || '');
};

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

      const store = resiFixStore.get();

      // Danh sách ngày nghỉ đã được BMB duyệt
      const approvedLeaves = store.scheduleRequests.filter(
        (r) => r.techId === techId && r.type === 'LEAVE' && r.status === 'APPROVED'
      );

      // Danh sách ca trực đã đổi thành công (cả đổi cho người khác và nhận từ người khác)
      const approvedSwaps = store.scheduleRequests.filter(
        (r) => (r.techId === techId || r.targetTechId === techId) && r.type === 'SHIFT_SWAP' && r.status === 'APPROVED'
      );

      res.status(200).json({
        success: true,
        technician: tech,
        baseShift: tech.shiftName || '08:00 - 17:00',
        approvedLeaves,
        approvedSwaps,
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
      const store = resiFixStore.get();

      const myRequests = store.scheduleRequests
        .filter((r) => r.techId === techId || r.targetTechId === techId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.status(200).json({ success: true, requests: myRequests });
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

      const store = resiFixStore.get();

      // Kiểm tra trùng lặp yêu cầu nghỉ cùng ngày đang chờ duyệt hoặc đã duyệt
      const existing = store.scheduleRequests.find(
        (r) => r.techId === techId && r.type === 'LEAVE' && r.date === cleanDate && r.status !== 'REJECTED' && r.status !== 'CANCELLED'
      );
      if (existing) {
        res.status(409).json({ success: false, message: `Bạn đã có yêu cầu nghỉ phép cho ngày ${cleanDate} (${existing.status}).` });
        return;
      }

      const newReq: ScheduleRequest = {
        id: `leave-${Date.now()}`,
        type: 'LEAVE',
        techId,
        techName: tech?.fullName || 'KTV',
        specialty: tech?.specialtyLabel || tech?.specialty || null,
        date: cleanDate,
        endDate: typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : cleanDate,
        leaveType: validLeaveType,
        reason: cleanReason,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      store.scheduleRequests.push(newReq);
      resiFixStore.save(store);

      console.log(`[SCHEDULE] KTV ${newReq.techName} gửi đơn xin nghỉ ngày ${cleanDate} (${validLeaveType}): ${cleanReason}`);

      res.status(201).json({
        success: true,
        message: 'Đã gửi đơn xin nghỉ phép tới Ban Quản Lý (BMB) để xét duyệt.',
        request: newReq,
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

      const store = resiFixStore.get();

      // Kiểm tra KTV đích có đang nghỉ phép vào ngày đó không
      const targetOnLeave = store.scheduleRequests.some(
        (r) => r.techId === cleanTargetId && r.type === 'LEAVE' && r.status === 'APPROVED' && r.date <= cleanDate && (r.endDate || r.date) >= cleanDate
      );
      if (targetOnLeave) {
        res.status(400).json({ success: false, message: `KTV ${targetTech.fullName} đã có lịch nghỉ phép vào ngày ${cleanDate}.` });
        return;
      }

      const newReq: ScheduleRequest = {
        id: `swap-${Date.now()}`,
        type: 'SHIFT_SWAP',
        techId,
        techName: requester?.fullName || 'KTV',
        specialty: requester?.specialtyLabel || requester?.specialty || null,
        date: cleanDate,
        shiftName: cleanShift,
        targetTechId: cleanTargetId,
        targetTechName: targetTech.fullName,
        reason: cleanReason,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      store.scheduleRequests.push(newReq);
      resiFixStore.save(store);

      console.log(`[SCHEDULE] KTV ${newReq.techName} xin đổi ca ngày ${cleanDate} với KTV ${targetTech.fullName}`);

      res.status(201).json({
        success: true,
        message: `Đã gửi yêu cầu đổi ca với KTV ${targetTech.fullName} tới BMB để phê duyệt.`,
        request: newReq,
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

    const store = resiFixStore.get();
    const target = store.scheduleRequests.find((r) => r.id === reqId);

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

    target.status = 'CANCELLED';
    resiFixStore.save(store);

    res.status(200).json({ success: true, message: 'Đã hủy yêu cầu thành công.', request: target });
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

      const store = resiFixStore.get();
      let list = store.scheduleRequests.slice().reverse();

      if (type) list = list.filter((r) => r.type === type);
      if (status) list = list.filter((r) => r.status === status);

      res.status(200).json({ success: true, requests: list });
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

      const store = resiFixStore.get();
      const target = store.scheduleRequests.find((r) => r.id === reqId);

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

      target.status = status;
      target.reviewNote = typeof reviewNote === 'string' ? reviewNote.trim() : null;
      target.reviewedBy = req.user?.fullName || 'BMB Admin';
      target.reviewedAt = new Date().toISOString();

      resiFixStore.save(store);

      console.log(`[AUDIT_LOG] BMB (${target.reviewedBy}) đã ${status} yêu cầu ${target.type} của ${target.techName}`);

      res.status(200).json({
        success: true,
        message: status === 'APPROVED' ? 'Đã phê duyệt yêu cầu thành công.' : 'Đã từ chối yêu cầu.',
        request: target,
      });
    } catch (error) {
      console.error('Lỗi khi duyệt yêu cầu lịch:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi duyệt yêu cầu.' });
    }
  }
);

export default router;

