import { Router, Response } from 'express';
import { Role, TicketStatus } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../db';
import { resiFixStore, MaterialItem, TicketRepairCost } from '../data/resifix_store';

const router = Router();

const getParamAsString = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || '';
  return String(param || '');
};

// ============================================================================
// 1. KỸ THUẬT VIÊN & CƯ DÂN: XEM VÀ ĐỀ XUẤT CHI PHÍ SỬA CHỮA THEO TICKET
// ============================================================================

// GET /api/costs/ticket/:ticketId - Xem chi phí gắn với sự cố
router.get(
  '/ticket/:ticketId',
  authenticateJWT,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.ticketId);
      const userRole = req.user?.role;
      const userId = req.user?.userId;

      const ticket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          ticketCode: true,
          residentId: true,
          assignedTechId: true,
          status: true,
        },
      });

      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy sự cố.' });
        return;
      }

      // Kiểm tra phân quyền:
      // - BMB: Toàn quyền
      // - TECHNICIAN: Phải là KTV được phân công ticket này
      // - RESIDENT: Phải là người báo cáo ticket này
      if (userRole === Role.TECHNICIAN && ticket.assignedTechId !== userId) {
        res.status(403).json({ success: false, message: 'Kỹ thuật viên chỉ được xem chi phí của sự cố được giao.' });
        return;
      }
      if (userRole === Role.RESIDENT && ticket.residentId !== userId) {
        res.status(403).json({ success: false, message: 'Bạn không có quyền xem chi phí của sự cố này.' });
        return;
      }

      const store = resiFixStore.get();
      const costRecord = store.repairCosts.find((c) => c.ticketId === ticketId);

      // Nếu là cư dân: Chỉ hiển thị chi phí khi đã được BMB duyệt (APPROVED)
      if (userRole === Role.RESIDENT && costRecord && costRecord.status !== 'APPROVED') {
        res.status(200).json({
          success: true,
          isPublic: false,
          message: 'Chi phí đang được Ban Quản Lý thẩm định và duyệt, chưa công khai.',
          cost: null,
        });
        return;
      }

      res.status(200).json({
        success: true,
        isPublic: true,
        cost: costRecord || null,
      });
    } catch (error) {
      console.error('Lỗi khi lấy chi phí sự cố:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải chi phí sự cố.' });
    }
  }
);

// POST /api/costs/ticket/:ticketId - KTV đề xuất chi phí vật tư & nhân công cho sự cố
router.post(
  '/ticket/:ticketId',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.ticketId);
      const techId = req.user!.userId;
      const { items, otherCost, receiptProofUrl, submitForApproval } = req.body || {};

      const ticket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        select: { id: true, ticketCode: true, assignedTechId: true, status: true },
      });

      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy sự cố.' });
        return;
      }

      if (ticket.assignedTechId !== techId) {
        res.status(403).json({ success: false, message: 'Bạn chỉ được đề xuất chi phí cho sự cố được giao cho bạn.' });
        return;
      }

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, message: 'Danh sách vật tư không được để trống.' });
        return;
      }

      // Validate và tính toán tiền chính xác ở Backend (VND không có số lẻ)
      const sanitizedItems: MaterialItem[] = [];
      const seenCodes = new Set<string>();

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const code = typeof it.materialCode === 'string' ? it.materialCode.trim().toUpperCase() : `VT-${i + 1}`;
        const name = typeof it.materialName === 'string' ? it.materialName.trim() : '';
        const unit = typeof it.unit === 'string' ? it.unit.trim() : 'Cái';
        const qty = Number(it.quantity);
        const price = Math.round(Number(it.unitPrice));

        if (!name || name.length < 2) {
          res.status(400).json({ success: false, message: `Tên vật tư ở dòng ${i + 1} không hợp lệ.` });
          return;
        }
        if (isNaN(qty) || qty <= 0 || qty > 1000) {
          res.status(400).json({ success: false, message: `Số lượng vật tư "${name}" phải từ 1 đến 1000.` });
          return;
        }
        if (isNaN(price) || price < 0 || price > 500000000) {
          res.status(400).json({ success: false, message: `Đơn giá vật tư "${name}" không hợp lệ (VND).` });
          return;
        }
        if (seenCodes.has(code)) {
          res.status(400).json({ success: false, message: `Trùng lặp mã vật tư "${code}" trong cùng một đề xuất.` });
          return;
        }
        seenCodes.add(code);

        sanitizedItems.push({
          id: `item-${Date.now()}-${i}`,
          materialCode: code,
          materialName: name,
          unit,
          quantity: qty,
          unitPrice: price,
          totalPrice: qty * price,
          notes: typeof it.notes === 'string' ? it.notes.trim() : null,
        });
      }

      const numOtherCost = Math.max(0, Math.round(Number(otherCost) || 0));
      const itemsTotal = sanitizedItems.reduce((sum, it) => sum + it.totalPrice, 0);
      const totalCost = itemsTotal + numOtherCost;

      const tech = await prisma.user.findUnique({
        where: { id: techId },
        select: { fullName: true },
      });

      const store = resiFixStore.get();
      let costRecord = store.repairCosts.find((c) => c.ticketId === ticketId);

      const isSubmitting = Boolean(submitForApproval);
      const nowIso = new Date().toISOString();

      // Kiểm tra yêu cầu hóa đơn chứng từ theo ngưỡng cấu hình BMB
      const receiptThreshold = store.costConfig?.requireReceiptThresholdVnd || 500000;
      if (isSubmitting && totalCost >= receiptThreshold && !receiptProofUrl) {
        res.status(400).json({
          success: false,
          message: `Chi phí từ ${receiptThreshold.toLocaleString('vi-VN')} VND bắt buộc phải đính kèm ảnh chụp hóa đơn/chứng từ hợp lệ.`,
        });
        return;
      }

      if (costRecord) {
        if (costRecord.status === 'APPROVED') {
          res.status(400).json({ success: false, message: 'Chi phí sự cố này đã được duyệt, không thể chỉnh sửa thêm.' });
          return;
        }
        costRecord.items = sanitizedItems;
        costRecord.otherCost = numOtherCost;
        costRecord.totalCost = totalCost;
        if (receiptProofUrl) costRecord.receiptProofUrl = String(receiptProofUrl);
        costRecord.status = isSubmitting ? 'PENDING' : 'DRAFT';
        costRecord.updatedAt = nowIso;
      } else {
        costRecord = {
          id: `cost-${Date.now()}`,
          ticketId,
          ticketCode: ticket.ticketCode,
          proposedById: techId,
          proposedByName: tech?.fullName || 'KTV',
          status: isSubmitting ? 'PENDING' : 'DRAFT',
          items: sanitizedItems,
          otherCost: numOtherCost,
          totalCost,
          receiptProofUrl: receiptProofUrl ? String(receiptProofUrl) : null,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        store.repairCosts.push(costRecord);
      }

      resiFixStore.save(store);

      console.log(`[COST] KTV ${costRecord.proposedByName} cập nhật chi phí cho ticket ${ticket.ticketCode}: ${totalCost.toLocaleString('vi-VN')} VND (Trạng thái: ${costRecord.status})`);

      res.status(200).json({
        success: true,
        message: isSubmitting
          ? `Đã gửi bảng dự toán chi phí (${totalCost.toLocaleString('vi-VN')} VND) tới BMB để phê duyệt.`
          : 'Đã lưu bản nháp chi phí thành công.',
        cost: costRecord,
      });
    } catch (error) {
      console.error('Lỗi khi đề xuất chi phí:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đề xuất chi phí.' });
    }
  }
);

// ============================================================================
// 2. BAN QUẢN LÝ (BMB): PHÊ DUYỆT & BÁO CÁO TỔNG HỢP CHI PHÍ
// ============================================================================

// PATCH /api/costs/admin/ticket/:ticketId/review - BMB phê duyệt / điều chỉnh chi phí
router.patch(
  '/admin/ticket/:ticketId/review',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.ticketId);
      const { status, reviewNote, adjustedTotalCost } = req.body || {};

      if (!['APPROVED', 'REJECTED'].includes(status)) {
        res.status(400).json({ success: false, message: 'Trạng thái xét duyệt phải là APPROVED hoặc REJECTED.' });
        return;
      }
      if (status === 'REJECTED' && (!reviewNote || typeof reviewNote !== 'string' || reviewNote.trim().length < 5)) {
        res.status(400).json({ success: false, message: 'Bắt buộc nêu rõ lý do từ chối chi phí (tối thiểu 5 ký tự).' });
        return;
      }

      const store = resiFixStore.get();
      const target = store.repairCosts.find((c) => c.ticketId === ticketId);

      if (!target) {
        res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ chi phí của sự cố này.' });
        return;
      }

      // Chống duyệt trùng lặp
      if (target.status === 'APPROVED') {
        res.status(400).json({
          success: false,
          message: `Chi phí sự cố này đã được phê duyệt trước đó (${target.totalCost.toLocaleString('vi-VN')} VND bởi ${target.reviewedBy}), không thể duyệt lại.`,
        });
        return;
      }

      target.status = status;
      if (status === 'APPROVED' && typeof adjustedTotalCost === 'number' && adjustedTotalCost > 0) {
        target.totalCost = Math.round(adjustedTotalCost);
      }
      target.reviewNote = typeof reviewNote === 'string' ? reviewNote.trim() : null;
      target.reviewedBy = req.user?.fullName || 'BMB Admin';
      target.reviewedAt = new Date().toISOString();
      target.updatedAt = target.reviewedAt;

      resiFixStore.save(store);

      // Ghi nhận Audit Log vào vòng đời sự cố (ticketStatusLog) để lưu trữ vĩnh viễn
      const currentTicket = await prisma.incidentTicket.findUnique({
        where: { id: target.ticketId },
        select: { status: true },
      });
      await prisma.ticketStatusLog.create({
        data: {
          ticketId: target.ticketId,
          toStatus: currentTicket?.status || TicketStatus.IN_PROGRESS,
          title: status === 'APPROVED' ? 'BMB phê duyệt chi phí sửa chữa' : 'BMB từ chối chi phí sửa chữa',
          note: `Tổng chi phí: ${target.totalCost.toLocaleString('vi-VN')} VND. ${target.reviewNote ? `Ghi chú: ${target.reviewNote}` : ''} (Người duyệt: ${target.reviewedBy})`,
          changedById: req.user!.userId,
        },
      }).catch((err) => console.warn('[COST_AUDIT_LOG_ERROR]', err?.message));

      console.log(`[AUDIT_LOG] BMB (${target.reviewedBy}) đã ${status} chi phí cho ticket ${target.ticketCode}: ${target.totalCost.toLocaleString('vi-VN')} VND`);

      res.status(200).json({
        success: true,
        message: status === 'APPROVED'
          ? `Đã phê duyệt chi phí sửa chữa (${target.totalCost.toLocaleString('vi-VN')} VND).`
          : 'Đã từ chối chi phí sửa chữa.',
        cost: target,
      });
    } catch (error) {
      console.error('Lỗi khi duyệt chi phí:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi duyệt chi phí.' });
    }
  }
);

// GET /api/costs/admin/config - BMB xem cấu hình ngưỡng cảnh báo chi phí
router.get(
  '/admin/config',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const store = resiFixStore.get();
      res.status(200).json({
        success: true,
        config: store.costConfig || { anomalyThresholdVnd: 5000000, requireReceiptThresholdVnd: 500000 },
      });
    } catch (error) {
      console.error('Lỗi lấy cấu hình chi phí:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tải cấu hình chi phí.' });
    }
  }
);

// PATCH /api/costs/admin/config - BMB tùy chỉnh ngưỡng cảnh báo chi phí bất thường
router.patch(
  '/admin/config',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { anomalyThresholdVnd, requireReceiptThresholdVnd } = req.body || {};
      const store = resiFixStore.get();

      if (!store.costConfig) {
        store.costConfig = { anomalyThresholdVnd: 5000000, requireReceiptThresholdVnd: 500000 };
      }

      if (typeof anomalyThresholdVnd === 'number' && anomalyThresholdVnd >= 500000 && anomalyThresholdVnd <= 100000000) {
        store.costConfig.anomalyThresholdVnd = Math.round(anomalyThresholdVnd);
      }
      if (typeof requireReceiptThresholdVnd === 'number' && requireReceiptThresholdVnd >= 0 && requireReceiptThresholdVnd <= 50000000) {
        store.costConfig.requireReceiptThresholdVnd = Math.round(requireReceiptThresholdVnd);
      }

      resiFixStore.save(store);

      console.log(`[AUDIT] BMB (${req.user?.fullName}) đã cập nhật cấu hình chi phí:`, store.costConfig);

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật cấu hình ngưỡng chi phí thành công.',
        config: store.costConfig,
      });
    } catch (error) {
      console.error('Lỗi khi cập nhật cấu hình chi phí:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lưu cấu hình chi phí.' });
    }
  }
);

// GET /api/costs/admin/report - BMB xem báo cáo chi phí tổng hợp theo ngày/tháng/tòa/vật tư
router.get(
  '/admin/report',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : '';
      const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : '';

      const store = resiFixStore.get();
      let costs = store.repairCosts.slice();

      if (fromDate) costs = costs.filter((c) => c.createdAt.slice(0, 10) >= fromDate);
      if (toDate) costs = costs.filter((c) => c.createdAt.slice(0, 10) <= toDate);

      const approvedCosts = costs.filter((c) => c.status === 'APPROVED');
      const totalApprovedAmount = approvedCosts.reduce((sum, c) => sum + c.totalCost, 0);

      // Cảnh báo chi phí bất thường theo cấu hình động của BMB (không hardcode)
      const anomalyThreshold = store.costConfig?.anomalyThresholdVnd || 5000000;
      const anomalies = approvedCosts
        .filter((c) => c.totalCost > anomalyThreshold)
        .map((c) => `Ticket ${c.ticketCode} có chi phí cao bất thường (${c.totalCost.toLocaleString('vi-VN')} VND > ${anomalyThreshold.toLocaleString('vi-VN')} VND), cần kiểm tra hóa đơn gốc`);

      res.status(200).json({
        success: true,
        filter: { fromDate, toDate },
        totalRecords: costs.length,
        approvedRecords: approvedCosts.length,
        totalApprovedAmount,
        anomalies,
        costs,
      });
    } catch (error) {
      console.error('Lỗi khi tải báo cáo chi phí:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải báo cáo chi phí.' });
    }
  }
);

export default router;

