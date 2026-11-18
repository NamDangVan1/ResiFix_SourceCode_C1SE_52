import fs from 'fs';
import path from 'path';

const filePath = path.resolve(__dirname, '../routes/payroll.routes.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Cập nhật imports từ resifix_store
const oldImports = `import {
  resiFixStore,
  AttendanceRecord,
  OvertimeRequest,
  ReconcileRequest,
  isTechOnApprovedLeave,
  calculateDistanceMeters,
  evaluateCheckInPunctuality,
  calculateWorkHoursBreakdown,
  parseShiftBounds,
  AttendanceGpsSnapshot,
  AttendanceAuditLog,
  AttendanceVerificationStatus,
} from '../data/resifix_store';`;

const newImports = `import {
  resiFixStore,
  AttendanceRecord,
  OvertimeRequest,
  ReconcileRequest,
  isTechOnApprovedLeave,
  calculateDistanceMeters,
  evaluateCheckInPunctuality,
  calculateWorkHoursBreakdown,
  parseShiftBounds,
  AttendanceGpsSnapshot,
  AttendanceAuditLog,
  AttendanceVerificationStatus,
  createAttendanceNonce,
  consumeAttendanceNonce,
  calculateOvertimeMultiplier,
  calculateOvertimePay,
  calculateShiftSalaryVietnam,
  getDayType,
} from '../data/resifix_store';

const IMAGE_DATA_URI = /^data:image\\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;
const SAFE_URL = /^https:\\/\\/[^\\s$.?#].[^\\s]*$/i;

const validateAttendancePhoto = (photoUrl?: string | null): { valid: boolean; message?: string; detectedMime?: string; sizeBytes?: number } => {
  if (!photoUrl || typeof photoUrl !== 'string' || !photoUrl.trim()) {
    return { valid: false, message: 'Thiếu dữ liệu ảnh chụp hiện trường.' };
  }
  const clean = photoUrl.trim();
  if (clean.startsWith('data:image/')) {
    if (!IMAGE_DATA_URI.test(clean)) {
      return { valid: false, message: 'Định dạng ảnh không hợp lệ. Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.' };
    }
    if (clean.length > 7_000_000) {
      return { valid: false, message: 'Dung lượng ảnh vượt quá giới hạn tối đa cho phép (5MB).' };
    }
    const match = clean.match(/^data:(image\\/(?:jpeg|png|webp));base64,/i);
    const mime = match ? match[1] : 'image/jpeg';
    const estimatedBytes = Math.round((clean.length - (clean.indexOf(',') + 1)) * 3 / 4);
    return { valid: true, detectedMime: mime, sizeBytes: estimatedBytes };
  }
  if (SAFE_URL.test(clean)) {
    return { valid: true, detectedMime: 'image/jpeg', sizeBytes: 0 };
  }
  return { valid: false, message: 'Đường dẫn ảnh không an toàn. Yêu cầu giao thức HTTPS hoặc data URI hợp lệ.' };
};`;

if (content.includes(oldImports)) {
  content = content.replace(oldImports, newImports);
  console.log('[OK] Updated imports in payroll.routes.ts');
}

// 2. Thêm endpoint /attendance-nonce và /attendance/:id/photo
const nonceAndPhotoRoutes = `
// ============================================================================
// 0. BẢO MẬT: NONCE PHIÊN CHẤM CÔNG & TRUY CẬP ẢNH AN TOÀN (CHỐNG REPLAY & IDOR)
// ============================================================================

// GET /api/payroll/attendance-nonce - Khởi tạo phiên chấm công có nonce ngắn hạn (3 phút), chống replay attack
router.get(
  '/attendance-nonce',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;
      const nonce = createAttendanceNonce(techId, 180);
      res.status(200).json({
        success: true,
        nonce,
        expiresInSeconds: 180,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Lỗi khi tạo nonce chấm công:', error);
      res.status(500).json({ success: false, message: 'Không thể tạo phiên chấm công.' });
    }
  }
);

// GET /api/payroll/attendance/:id/photo - Truy cập ảnh chấm công có kiểm tra quyền sở hữu (chống IDOR)
router.get(
  '/attendance/:id/photo',
  authenticateJWT,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const attendanceId = getParamAsString(req.params.id);
      const store = resiFixStore.get();
      const record = store.attendanceLogs.find((a) => a.id === attendanceId);

      if (!record) {
        res.status(404).json({ success: false, message: 'Không tìm thấy ca chấm công này.' });
        return;
      }

      // Quyền truy cập: BMB hoặc chính KTV sở hữu bản ghi
      const isOwner = req.user?.role === Role.TECHNICIAN && record.techId === req.user?.userId;
      const isBmb = req.user?.role === Role.BMB;

      if (!isBmb && !isOwner) {
        res.status(403).json({
          success: false,
          message: 'Bạn không có quyền truy cập dữ liệu ảnh chấm công này.',
        });
        return;
      }

      res.status(200).json({
        success: true,
        attendanceId: record.id,
        techName: record.techName,
        date: record.date,
        checkInPhotoUrl: record.checkInPhotoUrl,
        checkOutPhotoUrl: record.checkOutPhotoUrl,
        photoMetadata: record.photoMetadata,
      });
    } catch (error) {
      console.error('Lỗi khi truy cập ảnh chấm công:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ.' });
    }
  }
);

// GET /api/payroll/admin/building-location - BMB xem cấu hình tọa độ tòa nhà
router.get(
  '/admin/building-location',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const store = resiFixStore.get();
      res.status(200).json({
        success: true,
        buildingLocation: store.payrollConfig.buildingLocation,
      });
    } catch (error) {
      console.error('Lỗi khi tải cấu hình vị trí tòa nhà:', error);
      res.status(500).json({ success: false, message: 'Không thể tải cấu hình vị trí.' });
    }
  }
);

// PUT /api/payroll/admin/building-location - BMB cấu hình & xác nhận tọa độ chuẩn tòa nhà
router.put(
  '/admin/building-location',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { buildingName, buildingAddress, latitude, longitude, allowedRadiusMeters, note } = req.body || {};

      if (typeof buildingName !== 'string' || buildingName.trim().length < 3) {
        res.status(400).json({ success: false, message: 'Tên tòa nhà phải từ 3 ký tự trở lên.' });
        return;
      }
      if (typeof buildingAddress !== 'string' || buildingAddress.trim().length < 5) {
        res.status(400).json({ success: false, message: 'Địa chỉ tòa nhà phải từ 5 ký tự trở lên.' });
        return;
      }
      if (typeof latitude !== 'number' || isNaN(latitude) || latitude < -90 || latitude > 90) {
        res.status(400).json({ success: false, message: 'Vĩ độ GPS (latitude) không hợp lệ (-90 đến 90).' });
        return;
      }
      if (typeof longitude !== 'number' || isNaN(longitude) || longitude < -180 || longitude > 180) {
        res.status(400).json({ success: false, message: 'Kinh độ GPS (longitude) không hợp lệ (-180 đến 180).' });
        return;
      }
      if (typeof allowedRadiusMeters !== 'number' || isNaN(allowedRadiusMeters) || allowedRadiusMeters < 50 || allowedRadiusMeters > 5000) {
        res.status(400).json({ success: false, message: 'Bán kính chấm công hợp lệ phải từ 50m đến 5000m.' });
        return;
      }

      const store = resiFixStore.get();
      const prevConfig = { ...store.payrollConfig.buildingLocation };

      const bmbId = req.user!.userId;
      const bmbName = req.user!.fullName || 'BMB Admin';
      const nowIso = new Date().toISOString();

      if (!store.payrollConfig.buildingLocation.configAuditLogs) {
        store.payrollConfig.buildingLocation.configAuditLogs = [];
      }

      store.payrollConfig.buildingLocation.configAuditLogs.push({
        changedAt: nowIso,
        changedById: bmbId,
        changedByName: bmbName,
        previousConfig: prevConfig,
        newConfig: {
          buildingName: buildingName.trim(),
          buildingAddress: buildingAddress.trim(),
          latitude,
          longitude,
          allowedRadiusMeters,
          isConfirmed: true,
        },
        note: typeof note === 'string' ? note.trim() : 'BMB xác nhận cấu hình tọa độ tòa nhà',
      });

      store.payrollConfig.buildingLocation.buildingName = buildingName.trim();
      store.payrollConfig.buildingLocation.buildingAddress = buildingAddress.trim();
      store.payrollConfig.buildingLocation.latitude = latitude;
      store.payrollConfig.buildingLocation.longitude = longitude;
      store.payrollConfig.buildingLocation.allowedRadiusMeters = allowedRadiusMeters;
      store.payrollConfig.buildingLocation.isConfirmed = true;
      store.payrollConfig.buildingLocation.confirmedAt = nowIso;
      store.payrollConfig.buildingLocation.confirmedById = bmbId;
      store.payrollConfig.buildingLocation.confirmedByName = bmbName;

      resiFixStore.save(store);

      console.log(\`[AUDIT] BMB (\${bmbName}) đã xác nhận cấu hình vị trí tòa nhà:\`, store.payrollConfig.buildingLocation);

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật và xác nhận tọa độ chính thức của tòa nhà thành công.',
        buildingLocation: store.payrollConfig.buildingLocation,
      });
    } catch (error) {
      console.error('Lỗi khi cấu hình vị trí tòa nhà:', error);
      res.status(500).json({ success: false, message: 'Không thể lưu cấu hình vị trí tòa nhà.' });
    }
  }
);
`;

const routerMarker = 'const router = Router();';
if (content.includes(routerMarker) && !content.includes('/attendance-nonce')) {
  content = content.replace(routerMarker, routerMarker + '\n' + nonceAndPhotoRoutes);
  console.log('[OK] Added /attendance-nonce, /attendance/:id/photo, and /admin/building-location routes');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('[SUCCESS] payroll.routes.ts updated successfully with security endpoints');

