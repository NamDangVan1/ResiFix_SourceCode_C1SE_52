import { Router, Response } from 'express';
import { Role, TicketStatus } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../db';

const router = Router();

const getParamAsString = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || '';
  return String(param || '');
};

function formatCostRecord(c: any) {
  if (!c) return null;
  return {
    id: c.id,
    ticketId: c.ticketId,
    ticketCode: c.ticketCode,
    proposedById: c.proposedById,
    proposedByName: c.proposedByName,
    status: c.status,
    otherCost: Number(c.otherCost || 0),
    totalCost: Number(c.totalCost || 0),
    receiptProofUrl: c.receiptProofUrl || null,
    reviewNote: c.reviewNote || null,
    reviewedBy: c.reviewedByName || (c.reviewedBy ? c.reviewedBy.fullName : null),
    reviewedAt: c.reviewedAt ? new Date(c.reviewedAt).toISOString() : null,
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : new Date().toISOString(),
    items: (c.items || []).map((it: any) => ({
      id: it.id,
      materialCode: it.materialCode,
      materialName: it.materialName,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice || 0),
      totalPrice: Number(it.totalPrice || 0),
      notes: it.notes || null,
    })),
  };
}

async function getCostConfig(): Promise<{ anomalyThresholdVnd: number; requireReceiptThresholdVnd: number }> {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'cost_config' } });
    if (setting?.value && typeof setting.value === 'object') {
      const val = setting.value as any;
      return {
        anomalyThresholdVnd: Number(val.anomalyThresholdVnd) || 5000000,
        requireReceiptThresholdVnd: Number(val.requireReceiptThresholdVnd) || 500000,
      };
    }
  } catch (err) {
    console.warn('[COST_CONFIG_READ_ERROR]', err);
  }
  return { anomalyThresholdVnd: 5000000, requireReceiptThresholdVnd: 500000 };
}

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

      const dbCost = await prisma.repairMaterialCost.findUnique({
        where: { ticketId },
        include: { items: true },
      });

      const costRecord = formatCostRecord(dbCost);

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

      // Validate chi tiết từng vật tư
      const sanitizedItems: Array<{
        materialCode: string;
        materialName: string;
        unit: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        notes: string | null;
      }> = [];

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it || typeof it !== 'object') continue;
        const name = typeof it.materialName === 'string' ? it.materialName.trim() : '';
        const code = typeof it.materialCode === 'string' && it.materialCode.trim() ? it.materialCode.trim().toUpperCase() : `VT-${i + 1}`;
        const unit = typeof it.unit === 'string' && it.unit.trim() ? it.unit.trim() : 'Cái';
        const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
        const price = Math.max(0, Math.round(Number(it.unitPrice) || 0));

        if (!name || name.length < 2) {
          res.status(400).json({ success: false, message: `Vật tư dòng ${i + 1} phải có tên hợp lệ (tối thiểu 2 ký tự).` });
          return;
        }

        sanitizedItems.push({
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

      const isSubmitting = Boolean(submitForApproval);

      // Kiểm tra yêu cầu hóa đơn chứng từ theo ngưỡng cấu hình BMB
      const costConfig = await getCostConfig();
      const receiptThreshold = costConfig.requireReceiptThresholdVnd;
      if (isSubmitting && totalCost >= receiptThreshold && !receiptProofUrl) {
        res.status(400).json({
          success: false,
          message: `Chi phí từ ${receiptThreshold.toLocaleString('vi-VN')} VND bắt buộc phải đính kèm ảnh chụp hóa đơn/chứng từ hợp lệ.`,
        });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.repairMaterialCost.findUnique({
          where: { ticketId },
          include: { items: true },
        });

        if (existing && existing.status === 'APPROVED') {
          throw new Error('APPROVED_CANNOT_EDIT');
        }

        if (existing) {
          // Xóa các vật tư cũ để tạo lại đúng bộ mới
          await tx.materialItem.deleteMany({ where: { costId: existing.id } });

          const updated = await tx.repairMaterialCost.update({
            where: { id: existing.id },
            data: {
              otherCost: BigInt(numOtherCost),
              totalCost: BigInt(totalCost),
              receiptProofUrl: receiptProofUrl ? String(receiptProofUrl) : existing.receiptProofUrl,
              status: isSubmitting ? 'PENDING' : 'DRAFT',
              items: {
                create: sanitizedItems.map((it) => ({
                  materialCode: it.materialCode,
                  materialName: it.materialName,
                  unit: it.unit,
                  quantity: it.quantity,
                  unitPrice: BigInt(it.unitPrice),
                  totalPrice: BigInt(it.totalPrice),
                  notes: it.notes,
                })),
              },
            },
            include: { items: true },
          });
          return updated;
        } else {
          const created = await tx.repairMaterialCost.create({
            data: {
              ticketId,
              ticketCode: ticket.ticketCode,
              proposedById: techId,
              proposedByName: tech?.fullName || 'KTV',
              status: isSubmitting ? 'PENDING' : 'DRAFT',
              otherCost: BigInt(numOtherCost),
              totalCost: BigInt(totalCost),
              receiptProofUrl: receiptProofUrl ? String(receiptProofUrl) : null,
              items: {
                create: sanitizedItems.map((it) => ({
                  materialCode: it.materialCode,
                  materialName: it.materialName,
                  unit: it.unit,
                  quantity: it.quantity,
                  unitPrice: BigInt(it.unitPrice),
                  totalPrice: BigInt(it.totalPrice),
                  notes: it.notes,
                })),
              },
            },
            include: { items: true },
          });
          return created;
        }
      });

      console.log(`[COST] KTV ${result.proposedByName} cập nhật chi phí cho ticket ${ticket.ticketCode}: ${totalCost.toLocaleString('vi-VN')} VND (Trạng thái: ${result.status})`);

      res.status(200).json({
        success: true,
        message: isSubmitting
          ? `Đã gửi bảng dự toán chi phí (${totalCost.toLocaleString('vi-VN')} VND) tới BMB để phê duyệt.`
          : 'Đã lưu bản nháp chi phí thành công.',
        cost: formatCostRecord(result),
      });
    } catch (error: any) {
      if (error?.message === 'APPROVED_CANNOT_EDIT') {
        res.status(400).json({ success: false, message: 'Chi phí sự cố này đã được duyệt, không thể chỉnh sửa thêm.' });
        return;
      }
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

      const target = await prisma.repairMaterialCost.findUnique({
        where: { ticketId },
        include: { items: true },
      });

      if (!target) {
        res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ chi phí của sự cố này.' });
        return;
      }

      // Chống duyệt trùng lặp
      if (target.status === 'APPROVED') {
        res.status(400).json({
          success: false,
          message: `Chi phí sự cố này đã được phê duyệt trước đó (${Number(target.totalCost).toLocaleString('vi-VN')} VND bởi ${target.reviewedByName || 'BMB'}), không thể duyệt lại.`,
        });
        return;
      }

      const finalTotalCost = (status === 'APPROVED' && typeof adjustedTotalCost === 'number' && adjustedTotalCost > 0)
        ? BigInt(Math.round(adjustedTotalCost))
        : target.totalCost;

      const reviewerName = req.user?.fullName || 'BMB Admin';

      const updated = await prisma.repairMaterialCost.update({
        where: { id: target.id },
        data: {
          status,
          totalCost: finalTotalCost,
          reviewNote: typeof reviewNote === 'string' ? reviewNote.trim() : null,
          reviewedById: req.user!.userId,
          reviewedByName: reviewerName,
          reviewedAt: new Date(),
        },
        include: { items: true },
      });

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
          note: `Tổng chi phí: ${Number(finalTotalCost).toLocaleString('vi-VN')} VND. ${updated.reviewNote ? `Ghi chú: ${updated.reviewNote}` : ''} (Người duyệt: ${reviewerName})`,
          changedById: req.user!.userId,
        },
      }).catch((err) => console.warn('[COST_AUDIT_LOG_ERROR]', err?.message));

      console.log(`[AUDIT_LOG] BMB (${reviewerName}) đã ${status} chi phí cho ticket ${target.ticketCode}: ${Number(finalTotalCost).toLocaleString('vi-VN')} VND`);

      res.status(200).json({
        success: true,
        message: status === 'APPROVED'
          ? `Đã phê duyệt chi phí sửa chữa (${Number(finalTotalCost).toLocaleString('vi-VN')} VND).`
          : 'Đã từ chối chi phí sửa chữa.',
        cost: formatCostRecord(updated),
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
      const cfg = await getCostConfig();
      res.status(200).json({
        success: true,
        config: cfg,
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
      const currentConfig = await getCostConfig();

      if (typeof anomalyThresholdVnd === 'number' && anomalyThresholdVnd >= 500000 && anomalyThresholdVnd <= 100000000) {
        currentConfig.anomalyThresholdVnd = Math.round(anomalyThresholdVnd);
      }
      if (typeof requireReceiptThresholdVnd === 'number' && requireReceiptThresholdVnd >= 0 && requireReceiptThresholdVnd <= 50000000) {
        currentConfig.requireReceiptThresholdVnd = Math.round(requireReceiptThresholdVnd);
      }

      await prisma.systemSetting.upsert({
        where: { key: 'cost_config' },
        create: { key: 'cost_config', value: currentConfig as any },
        update: { value: currentConfig as any },
      });

      console.log(`[AUDIT] BMB (${req.user?.fullName}) đã cập nhật cấu hình chi phí:`, currentConfig);

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật cấu hình ngưỡng chi phí thành công.',
        config: currentConfig,
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

      const dbCosts = await prisma.repairMaterialCost.findMany({
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      });

      let costs = dbCosts.map(formatCostRecord);

      if (fromDate) costs = costs.filter((c: any) => c.createdAt.slice(0, 10) >= fromDate);
      if (toDate) costs = costs.filter((c: any) => c.createdAt.slice(0, 10) <= toDate);

      const approvedCosts = costs.filter((c: any) => c.status === 'APPROVED');
      const totalApprovedAmount = approvedCosts.reduce((sum: number, c: any) => sum + c.totalCost, 0);

      // Cảnh báo chi phí bất thường theo cấu hình động của BMB (không hardcode)
      const costConfig = await getCostConfig();
      const anomalyThreshold = costConfig.anomalyThresholdVnd;
      const anomalies = approvedCosts
        .filter((c: any) => c.totalCost > anomalyThreshold)
        .map((c: any) => `Ticket ${c.ticketCode} có chi phí cao bất thường (${c.totalCost.toLocaleString('vi-VN')} VND > ${anomalyThreshold.toLocaleString('vi-VN')} VND), cần kiểm tra hóa đơn gốc`);

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
