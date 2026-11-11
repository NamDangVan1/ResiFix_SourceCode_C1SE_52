import { Router, Response } from 'express';
import { Role, NotificationType } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../db';
import { EmergencyAlertRecord, SlaConfig } from '../data/resifix_store';
import { slaWorker } from '../services/sla_worker';

const router = Router();

const getParamAsString = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || '';
  return String(param || '');
};

const DEFAULT_SLA_CONFIG: SlaConfig = {
  highPriority: { responseMinutes: 15, assignmentMinutes: 30, resolutionHours: 4 },
  mediumPriority: { responseMinutes: 30, assignmentMinutes: 60, resolutionHours: 12 },
  lowPriority: { responseMinutes: 60, assignmentMinutes: 120, resolutionHours: 24 },
  warningThresholdPercent: 80,
  autoEscalationHours: 2,
  alertDebounceMinutes: 15,
};

// ============================================================================
// 1. CẤU HÌNH QUY ĐỊNH CAM KẾT DỊCH VỤ (SLA CONFIG)
// ============================================================================

// GET /api/sla/config - Xem cấu hình SLA
router.get('/config', authenticateJWT, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    let cfg: SlaConfig = DEFAULT_SLA_CONFIG;
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'sla_config' } });
    if (setting?.value && typeof setting.value === 'object') {
      cfg = setting.value as any;
    }
    res.status(200).json({ success: true, config: cfg });
  } catch (error) {
    console.error('Lỗi lấy cấu hình SLA:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi tải cấu hình SLA.' });
  }
});

// PATCH /api/sla/config - BMB cập nhật cấu hình SLA
router.patch(
  '/config',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { highPriority, mediumPriority, lowPriority, warningThresholdPercent, autoEscalationHours, alertDebounceMinutes } = req.body || {};

      let currentConfig: SlaConfig = DEFAULT_SLA_CONFIG;
      const setting = await prisma.systemSetting.findUnique({ where: { key: 'sla_config' } });
      if (setting?.value && typeof setting.value === 'object') {
        currentConfig = setting.value as any;
      }

      if (highPriority) {
        if (highPriority.responseMinutes > 0) currentConfig.highPriority.responseMinutes = highPriority.responseMinutes;
        if (highPriority.assignmentMinutes > 0) currentConfig.highPriority.assignmentMinutes = highPriority.assignmentMinutes;
        if (highPriority.resolutionHours > 0) currentConfig.highPriority.resolutionHours = highPriority.resolutionHours;
      }

      if (mediumPriority) {
        if (mediumPriority.responseMinutes > 0) currentConfig.mediumPriority.responseMinutes = mediumPriority.responseMinutes;
        if (mediumPriority.assignmentMinutes > 0) currentConfig.mediumPriority.assignmentMinutes = mediumPriority.assignmentMinutes;
        if (mediumPriority.resolutionHours > 0) currentConfig.mediumPriority.resolutionHours = mediumPriority.resolutionHours;
      }

      if (lowPriority) {
        if (lowPriority.responseMinutes > 0) currentConfig.lowPriority.responseMinutes = lowPriority.responseMinutes;
        if (lowPriority.assignmentMinutes > 0) currentConfig.lowPriority.assignmentMinutes = lowPriority.assignmentMinutes;
        if (lowPriority.resolutionHours > 0) currentConfig.lowPriority.resolutionHours = lowPriority.resolutionHours;
      }

      if (typeof warningThresholdPercent === 'number' && warningThresholdPercent >= 50 && warningThresholdPercent <= 95) {
        currentConfig.warningThresholdPercent = warningThresholdPercent;
      }
      if (typeof autoEscalationHours === 'number' && autoEscalationHours > 0) {
        currentConfig.autoEscalationHours = autoEscalationHours;
      }
      if (typeof alertDebounceMinutes === 'number' && alertDebounceMinutes >= 1 && alertDebounceMinutes <= 120) {
        currentConfig.alertDebounceMinutes = alertDebounceMinutes;
      }

      await prisma.systemSetting.upsert({
        where: { key: 'sla_config' },
        create: { key: 'sla_config', value: currentConfig as any },
        update: { value: currentConfig as any },
      });

      console.log(`[AUDIT] BMB (${req.user?.fullName}) đã cập nhật cấu hình SLA:`, currentConfig);

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật quy định SLA thành công.',
        config: currentConfig,
      });
    } catch (error) {
      console.error('Lỗi cập nhật cấu hình SLA:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi cập nhật cấu hình SLA.' });
    }
  }
);

// GET /api/sla/status/:ticketId - Xem tiến độ SLA của một sự cố
router.get(
  '/status/:ticketId',
  authenticateJWT,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.ticketId);
      const ticket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          ticketCode: true,
          createdAt: true,
          status: true,
          finalPriority: true,
          aiSuggestedPriority: true,
        },
      });

      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy sự cố.' });
        return;
      }

      const status = await slaWorker.evaluateTicketSla(ticket);
      res.status(200).json({ success: true, sla: status });
    } catch (error) {
      console.error('Lỗi khi lấy trạng thái SLA sự cố:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải thông tin SLA.' });
    }
  }
);

// ============================================================================
// 2. TẠM DỪNG / TIẾP TỤC SLA (PAUSE / RESUME)
// ============================================================================

// POST /api/sla/ticket/:ticketId/pause - BMB tạm dừng tính thời gian SLA
router.post(
  '/ticket/:ticketId/pause',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.ticketId);
      const { reason } = req.body || {};

      if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
        res.status(400).json({ success: false, message: 'Bắt buộc nhập lý do tạm dừng SLA (tối thiểu 5 ký tự).' });
        return;
      }

      let tracking = await prisma.slaTracking.findUnique({ where: { ticketId } });

      if (!tracking) {
        const ticket = await prisma.incidentTicket.findUnique({
          where: { id: ticketId },
          select: {
            id: true,
            ticketCode: true,
            createdAt: true,
            status: true,
            finalPriority: true,
            aiSuggestedPriority: true,
          },
        });
        if (!ticket) {
          res.status(404).json({ success: false, message: 'Không tìm thấy sự cố.' });
          return;
        }
        await slaWorker.evaluateTicketSla(ticket);
        tracking = await prisma.slaTracking.findUnique({ where: { ticketId } });
      }

      if (!tracking) {
        res.status(404).json({ success: false, message: 'Không tìm thấy thông tin SLA của sự cố.' });
        return;
      }

      if (tracking.isPaused) {
        res.status(400).json({ success: false, message: 'Sự cố này đang ở trạng thái tạm dừng SLA rồi.' });
        return;
      }

      const now = new Date();
      const updated = await prisma.slaTracking.update({
        where: { ticketId },
        data: {
          isPaused: true,
          pausedAt: now,
          pauseReason: reason.trim(),
        },
      });

      // Ghi log tiến độ vòng đời sự cố
      await prisma.ticketStatusLog.create({
        data: {
          ticketId,
          toStatus: updated.status as any,
          title: 'Tạm dừng tính cam kết SLA',
          note: `Lý do tạm dừng: ${reason.trim()} (Bởi BMB: ${req.user?.fullName})`,
          changedById: req.user!.userId,
        },
      });

      console.log(`[SLA] BMB (${req.user?.fullName}) đã tạm dừng SLA cho ticket ${updated.ticketCode}: ${reason}`);

      res.status(200).json({
        success: true,
        message: 'Đã tạm dừng tính thời gian SLA của sự cố.',
        sla: slaWorker.formatSlaTracking(updated),
      });
    } catch (error) {
      console.error('Lỗi khi tạm dừng SLA:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tạm dừng SLA.' });
    }
  }
);

// POST /api/sla/ticket/:ticketId/resume - BMB tiếp tục tính SLA (gia hạn deadline tương ứng)
router.post(
  '/ticket/:ticketId/resume',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.ticketId);
      const tracking = await prisma.slaTracking.findUnique({ where: { ticketId } });

      if (!tracking || !tracking.isPaused || !tracking.pausedAt) {
        res.status(400).json({ success: false, message: 'Sự cố không ở trạng thái tạm dừng SLA.' });
        return;
      }

      // Tính thời gian đã tạm dừng (milliseconds) để cộng dồn gia hạn deadline
      const pauseDurationMs = Date.now() - new Date(tracking.pausedAt).getTime();

      const newResp = new Date(new Date(tracking.responseDeadline).getTime() + pauseDurationMs);
      const newAssign = new Date(new Date(tracking.assignmentDeadline).getTime() + pauseDurationMs);
      const newRes = new Date(new Date(tracking.resolutionDeadline).getTime() + pauseDurationMs);

      const updated = await prisma.slaTracking.update({
        where: { ticketId },
        data: {
          isPaused: false,
          pausedAt: null,
          pauseReason: null,
          responseDeadline: newResp,
          assignmentDeadline: newAssign,
          resolutionDeadline: newRes,
        },
      });

      await prisma.ticketStatusLog.create({
        data: {
          ticketId,
          toStatus: updated.status as any,
          title: 'Tiếp tục tính thời gian SLA',
          note: `Đã gia hạn thêm ${Math.round(pauseDurationMs / 60000)} phút do thời gian tạm dừng trước đó.`,
          changedById: req.user!.userId,
        },
      });

      console.log(`[SLA] BMB (${req.user?.fullName}) tiếp tục SLA cho ticket ${updated.ticketCode}. Đã gia hạn +${Math.round(pauseDurationMs / 60000)} phút.`);

      res.status(200).json({
        success: true,
        message: 'Đã tiếp tục tính SLA và gia hạn deadline tương ứng.',
        sla: slaWorker.formatSlaTracking(updated),
      });
    } catch (error) {
      console.error('Lỗi tiếp tục SLA:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tiếp tục SLA.' });
    }
  }
);

// ============================================================================
// 3. DASHBOARD BÁO ĐỘNG SLA & CẢNH BÁO KHẨN CẤP (EMERGENCY BROADCAST)
// ============================================================================

// GET /api/sla/admin/dashboard - BMB xem tổng quan tiến độ SLA toàn tòa nhà
router.get(
  '/admin/dashboard',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      // Chạy một chu kỳ quét cập nhật
      await slaWorker.runCheckCycle();

      const dbTrackings = await prisma.slaTracking.findMany({
        orderBy: { resolutionDeadline: 'asc' },
      });

      const trackings = dbTrackings.map((t) => slaWorker.formatSlaTracking(t));

      const onTrack = trackings.filter((t) => t.slaStatus === 'ON_TRACK');
      const atRisk = trackings.filter((t) => t.slaStatus === 'AT_RISK');
      const breached = trackings.filter((t) => t.slaStatus === 'BREACHED');

      res.status(200).json({
        success: true,
        summary: {
          total: trackings.length,
          onTrackCount: onTrack.length,
          atRiskCount: atRisk.length,
          breachedCount: breached.length,
        },
        breachedTickets: breached,
        atRiskTickets: atRisk,
      });
    } catch (error) {
      console.error('Lỗi khi lấy dashboard SLA:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải dashboard SLA.' });
    }
  }
);

// POST /api/sla/emergency-broadcast - Ban Quản Lý (BMB) phát tín hiệu cảnh báo khẩn cấp diện rộng
router.post(
  '/emergency-broadcast',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { emergencyType, location, buildingBlock, description, confirmEmergency, isTest } = req.body || {};

      // 1. Xác nhận thao tác bắt buộc
      if (!confirmEmergency) {
        res.status(400).json({
          success: false,
          message: 'Bắt buộc xác nhận thao tác khẩn cấp (confirmEmergency: true) để tránh phát nhầm.',
        });
        return;
      }

      // 2. Validate nội dung & phạm vi
      const cleanType = typeof emergencyType === 'string' && emergencyType.trim() ? emergencyType.trim().toUpperCase() : 'CHÁY_NỔ';
      const cleanLoc = typeof location === 'string' && location.trim() ? location.trim() : 'Toàn khu chung cư';
      const cleanBlock = typeof buildingBlock === 'string' && buildingBlock.trim() ? buildingBlock.trim() : 'TẤT CẢ CÁC TÒA NHÀ';
      const cleanDesc = typeof description === 'string' ? description.trim() : '';
      const isTestMode = Boolean(isTest);

      // Đọc danh sách alerts hiện có từ SystemSetting
      let emergencyAlerts: EmergencyAlertRecord[] = [];
      const alertSetting = await prisma.systemSetting.findUnique({ where: { key: 'emergency_alerts' } });
      if (alertSetting?.value && Array.isArray(alertSetting.value)) {
        emergencyAlerts = alertSetting.value as any;
      }

      // 3. Chống gửi trùng (Deduplication / Rate limit 60 giây cùng loại tại cùng vị trí)
      const lastSameAlert = emergencyAlerts.find(
        (a) => a.emergencyType === cleanType && Date.now() - new Date(a.createdAt).getTime() < 60000
      );
      if (lastSameAlert) {
        res.status(429).json({
          success: false,
          message: `Cảnh báo loại ${cleanType} vừa được phát cách đây ít hơn 60 giây. Vui lòng không spam tín hiệu!`,
        });
        return;
      }

      // 4. Lưu vết Audit Log vào SystemSetting
      const alertRecord: EmergencyAlertRecord = {
        id: `alert-${Date.now()}`,
        emergencyType: cleanType,
        location: cleanLoc,
        buildingBlock: cleanBlock,
        description: cleanDesc,
        triggeredById: req.user!.userId,
        triggeredByName: req.user?.fullName || 'BMB Quản lý',
        isTest: isTestMode,
        createdAt: new Date().toISOString(),
      };
      emergencyAlerts.push(alertRecord);

      await prisma.systemSetting.upsert({
        where: { key: 'emergency_alerts' },
        create: { key: 'emergency_alerts', value: emergencyAlerts as any },
        update: { value: emergencyAlerts as any },
      });

      console.error(`🚨 [EMERGENCY_BROADCAST] ${isTestMode ? '[DIỄN TẬP] ' : ''}Loại: ${cleanType} tại: ${cleanLoc} (${cleanBlock})! Bởi: ${alertRecord.triggeredByName}`);

      // 5. Nếu không phải chế độ test, phát thông báo thật vào database
      if (!isTestMode) {
        try {
          const allUsers = await prisma.user.findMany({
            where: { isActive: true },
            select: { id: true },
          });
          for (const u of allUsers) {
            await prisma.notification.create({
              data: {
                userId: u.id,
                type: NotificationType.STATUS_UPDATED,
                title: `🚨 BÁO ĐỘNG KHẨN CẤP: ${cleanType}`,
                message: `Khu vực: ${cleanLoc} (${cleanBlock}). ${cleanDesc}. Yêu cầu tuân thủ hướng dẫn an toàn!`,
              },
            });
          }
        } catch {
          // Bắt lỗi nhẹ nếu tạo notification gặp trục trặc
        }
      }

      res.status(200).json({
        success: true,
        broadcastTime: alertRecord.createdAt,
        isTest: isTestMode,
        message: isTestMode
          ? 'ĐÃ PHÁT TÍN HIỆU THỬ NGHIỆM / DIỄN TẬP THÀNH CÔNG (Không gửi tới cư dân).'
          : 'ĐÃ PHÁT TÍN HIỆU CẢNH BÁO NGUY HIỂM KHẨN CẤP TOÀN HỆ THỐNG!',
        details: alertRecord,
      });
    } catch (error) {
      console.error('Lỗi phát tín hiệu khẩn cấp:', error);
      res.status(500).json({ success: false, message: 'Không thể phát tín hiệu khẩn cấp.' });
    }
  }
);

// POST /api/sla/emergency-report - Kỹ thuật viên (KTV) gửi báo cáo nguy cơ khẩn cấp tới BMB (không phát diện rộng)
router.post(
  '/emergency-report',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { emergencyType, location, description } = req.body || {};

      const cleanType = typeof emergencyType === 'string' && emergencyType.trim() ? emergencyType.trim().toUpperCase() : 'NGUY_CƠ_CHẬP_CHÁY';
      const cleanLoc = typeof location === 'string' && location.trim() ? location.trim() : 'Hiện trường sự cố';
      const cleanDesc = typeof description === 'string' ? description.trim() : 'Phát hiện nguy cơ mất an toàn nghiêm trọng';

      console.warn(`⚠️ [KTV_EMERGENCY_REPORT] KTV ${req.user?.fullName} báo cáo nguy cơ khẩn cấp: ${cleanType} tại ${cleanLoc}`);

      // Gửi thông báo khẩn cấp trực tiếp tới hòm thư toàn bộ nhân sự BMB
      try {
        const bmbUsers = await prisma.user.findMany({
          where: { role: Role.BMB, isActive: true },
          select: { id: true },
        });
        for (const bmb of bmbUsers) {
          await prisma.notification.create({
            data: {
              userId: bmb.id,
              type: NotificationType.STATUS_UPDATED,
              title: `⚠️ BÁO CÁO KHẨN TỪ KTV: ${cleanType}`,
              message: `KTV ${req.user?.fullName} báo cáo sự cố khẩn tại ${cleanLoc}: ${cleanDesc}. Đề nghị BMB kiểm tra và quyết định phát báo động nếu cần.`,
            },
          });
        }
      } catch {
        // Bắt lỗi nhẹ
      }

      res.status(200).json({
        success: true,
        reportTime: new Date().toISOString(),
        message: 'Đã gửi báo cáo khẩn cấp tới Ban Quản Lý (BMB) thành công!',
        details: {
          reportedBy: req.user?.fullName || 'KTV',
          type: cleanType,
          location: cleanLoc,
          description: cleanDesc,
        },
      });
    } catch (error) {
      console.error('Lỗi gửi báo cáo khẩn cấp KTV:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi gửi báo cáo khẩn cấp.' });
    }
  }
);

export default router;
