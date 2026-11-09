import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface EmergencyContact {
  managerName: string;
  managerPhone: string;
}

export interface ApartmentRecord {
  id: string;
  apartmentCode: string;
  buildingBlock: string;
  floorNumber: number;
  roomQrCode: string;
  status: 'OCCUPIED' | 'VACANT' | 'MAINTENANCE';
  createdAt: string;
}

export interface ResidencyRecord {
  id: string;
  residentId: string;
  residentName: string;
  phone: string;
  apartmentCode: string;
  buildingBlock: string;
  floorNumber: number;
  moveInDate: string;
  moveOutDate?: string | null;
  isRepresentative: boolean;
}

export interface BuildingLocationConfigAudit {
  changedAt: string;
  changedById: string;
  changedByName: string;
  previousConfig: Partial<Omit<BuildingLocationConfig, 'configAuditLogs'>>;
  newConfig: Partial<Omit<BuildingLocationConfig, 'configAuditLogs'>>;
  note?: string | null;
}

export interface BuildingLocationConfig {
  buildingName: string; // Tên tòa nhà
  buildingAddress: string; // Địa chỉ tòa nhà
  latitude: number; // Vĩ độ GPS chuẩn
  longitude: number; // Kinh độ GPS chuẩn
  allowedRadiusMeters: number; // Bán kính cho phép chấm công hợp lệ (mặc định 300m)
  isConfirmed: boolean; // BMB đã kiểm tra và xác nhận tọa độ chính thức
  confirmedAt?: string | null;
  confirmedById?: string | null;
  confirmedByName?: string | null;
  configAuditLogs?: BuildingLocationConfigAudit[];
}

export interface PayrollConfig {
  hourlyRateDefault: number; // 50,000 VND / giờ theo quy định ResiFix
  baseSalaryDefault: number; // VND / tháng (ví dụ: 10,400,000 cho 208 giờ)
  standardMonthlyHours: number; // ví dụ: 208 giờ
  otMultiplierNormal: number; // 1.5x ngày thường
  otMultiplierNight: number; // 1.3x làm đêm (sau 22:00)
  otMultiplierWeekend: number; // 2.0x cuối tuần / ngày lễ
  standardAllowance: number; // 730,000 VND phụ cấp ăn trưa
  holidays?: string[]; // Danh sách ngày lễ đặc biệt (YYYY-MM-DD)
  buildingLocation: BuildingLocationConfig; // Cấu hình vị trí GPS tòa nhà
}

export interface AttendanceNonce {
  nonce: string;
  techId: string;
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms (mặc định 3 phút)
  used: boolean;
}

export type AttendanceVerificationStatus =
  | 'VERIFIED'        // Đầy đủ, trong phạm vi, tự động xác nhận
  | 'PENDING_REVIEW'  // Cần BMB xem xét (GPS ngoài phạm vi, thiếu ảnh, hoặc quên check-out)
  | 'APPROVED'        // BMB đã duyệt chấp thuận ngoại lệ
  | 'REJECTED'        // BMB từ chối (gian lận hoặc không hợp lệ)
  | 'NEEDS_EXPLANATION'; // BMB yêu cầu KTV giải trình bổ sung

export type AttendancePunctualityStatus =
  | 'ON_TIME'         // Đúng giờ
  | 'LATE'            // Đi muộn (vào sau giờ bắt đầu ca)
  | 'EARLY_LEAVE'     // Về sớm (ra trước giờ kết thúc ca)
  | 'LATE_AND_EARLY'  // Cả đi muộn và về sớm
  | 'ON_TRACK';       // Ca đang mở, chưa đến giờ kết thúc

export interface AttendanceGpsSnapshot {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  distanceToBuildingMeters: number;
  isWithinRadius: boolean;
  addressEstimate?: string | null; // Địa chỉ ước tính từ GPS
}

export interface AttendanceAuditLog {
  action: 'AUTO_VERIFY' | 'SYSTEM_FLAG' | 'BMB_APPROVE' | 'BMB_REJECT' | 'REQUEST_EXPLANATION' | 'TECH_EXPLAIN';
  performedById: string;
  performedByName: string;
  performedAt: string; // ISO string
  note?: string | null;
  adjustedHours?: number | null;
}

export interface AttendanceRecord {
  id: string;
  techId: string;
  techName: string;
  techPhone?: string | null;
  buildingBlock?: string | null;
  date: string; // YYYY-MM-DD
  sessionIndex: number; // 1, 2, 3... hỗ trợ nhiều ca/ngày

  // Lịch làm việc được giao
  shiftScheduled?: string | null; // Ví dụ: "07:00 - 15:00"
  shiftStartTime?: string; // "07:00"
  shiftEndTime?: string; // "15:00"

  // Check-in
  checkIn: string; // ISO do SERVER ghi nhận
  checkInPhotoUrl?: string | null; // Ảnh selfie có watermark
  checkInGps?: AttendanceGpsSnapshot | null;
  checkInNotes?: string | null;

  // Check-out
  checkOut?: string | null; // ISO do SERVER ghi nhận
  checkOutPhotoUrl?: string | null;
  checkOutGps?: AttendanceGpsSnapshot | null;
  checkOutNotes?: string | null;

  // Thời gian & Giờ làm tính lương
  workMinutes?: number | null; // Số phút thực tế (checkOut - checkIn)
  workHours?: number | null; // Số giờ hiển thị
  billableHours?: number | null; // Số giờ được tính lương (sau khi BMB duyệt/xác nhận)
  regularHours?: number | null; // Giờ công thường (50.000 VNĐ/giờ)
  nightHours?: number | null; // Giờ công ca đêm (22:00 - 06:00)
  disputedHours?: number | null; // Giờ đang tranh chấp / chờ duyệt

  // Trạng thái độc lập:
  punctualityStatus?: AttendancePunctualityStatus; // ON_TIME, LATE, EARLY_LEAVE, ON_TRACK
  lateMinutes?: number; // Số phút đi muộn
  earlyMinutes?: number; // Số phút về sớm
  verificationStatus?: AttendanceVerificationStatus; // VERIFIED, PENDING_REVIEW, APPROVED, REJECTED, NEEDS_EXPLANATION

  anomalyNotes?: string | null; // Ghi chú bất thường tự động
  explanationText?: string | null; // Giải trình từ KTV nếu có ngoại lệ

  // Metadata ảnh watermark thực sự phía Backend
  photoMetadata?: {
    originalPhotoUrl?: string | null;
    watermarkText: string;
    verifiedLocationText: string;
    serverTimestamp: string;
    uploadedAt: string;
    mimeType?: string;
    fileSizeBytes?: number;
    storageRetentionPolicy?: string;
  } | null;

  // Lịch sử duyệt của BMB (bảo toàn bằng chứng gốc)
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  auditLogs?: AttendanceAuditLog[];
}

export interface OvertimeRequest {
  id: string;
  techId: string;
  techName: string;
  date: string; // YYYY-MM-DD
  fromTime: string; // HH:mm
  toTime: string; // HH:mm
  durationMinutes: number; // Số phút chính xác
  hours: number;
  reason: string;
  ticketId?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedHours?: number;
  dayType?: 'NORMAL' | 'WEEKEND' | 'HOLIDAY'; // Ngày thường, ngày nghỉ tuần, ngày lễ
  isNightOt?: boolean; // Tăng ca ban đêm (22:00 - 06:00)
  multiplierApplied?: number; // Hệ số Điều 98 BLLĐ 2019
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

export interface ReconcileRequest {
  id: string;
  techId: string;
  techName: string;
  month: string; // YYYY-MM
  note: string;
  status: 'PENDING' | 'RESOLVED';
  responseNote?: string | null;
  createdAt: string;
}

export interface LockedMonth {
  month: string; // YYYY-MM
  lockedAt: string;
  lockedBy: string;
  totalPayout: number;
}

// ----------------------------------------------------------------------------
// 1. MODULE ĐỔI CA & XIN NGHỈ (LEAVE & SHIFT SWAP)
// ----------------------------------------------------------------------------
export interface ScheduleRequest {
  id: string;
  type: 'LEAVE' | 'SHIFT_SWAP';
  techId: string;
  techName: string;
  specialty?: string | null;
  date: string; // YYYY-MM-DD
  endDate?: string | null; // Dùng khi xin nghỉ nhiều ngày
  leaveType?: 'ANNUAL' | 'SICK' | 'UNPAID';
  shiftName?: string; // Ca trực muốn đổi
  targetTechId?: string | null; // KTV được đề nghị đổi ca
  targetTechName?: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

// ----------------------------------------------------------------------------
// 2. MODULE CHI PHÍ SỬA CHỮA (REPAIR MATERIAL & OPERATIONAL COSTS)
// ----------------------------------------------------------------------------
export interface MaterialItem {
  id: string;
  materialCode: string; // Ví dụ: VT-ONGNUOC-01
  materialName: string;
  unit: string; // Cái, Mét, Bộ, Cuộn...
  quantity: number;
  unitPrice: number; // VND số nguyên chính xác
  totalPrice: number; // quantity * unitPrice
  notes?: string | null;
}

export interface TicketRepairCost {
  id: string;
  ticketId: string;
  ticketCode: string;
  proposedById: string;
  proposedByName: string;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  items: MaterialItem[];
  otherCost: number; // Chi phí phát sinh (vận chuyển, dụng cụ phụ...)
  totalCost: number; // Tổng chi phí (VND)
  receiptProofUrl?: string | null; // Link ảnh hóa đơn/chứng từ nghiệm thu
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CostConfig {
  anomalyThresholdVnd: number; // Ngưỡng cảnh báo chi phí bất thường (VND)
  requireReceiptThresholdVnd: number; // Mức chi phí bắt buộc đính kèm hóa đơn
}

// ----------------------------------------------------------------------------
// 3. MODULE SLA & ESCALATION (QUY ĐỊNH THỜI GIAN & LEO THANG SỰ CỐ)
// ----------------------------------------------------------------------------
export interface SlaTierConfig {
  responseMinutes: number; // Thời hạn Tiếp nhận (phút)
  assignmentMinutes: number; // Thời hạn Phân công (phút)
  resolutionHours: number; // Thời hạn Nghiệm thu hoàn tất (giờ)
}

export interface SlaConfig {
  highPriority: SlaTierConfig;
  mediumPriority: SlaTierConfig;
  lowPriority: SlaTierConfig;
  warningThresholdPercent: number; // Ngưỡng cảnh báo sắp hạn (mặc định 80%)
  autoEscalationHours: number; // Sau số giờ quá hạn sẽ leo thang lên Quản lý trưởng
  alertDebounceMinutes: number; // Khử rung chuông báo động (mặc định 15 phút)
}

export interface SlaTicketStatus {
  ticketId: string;
  ticketCode: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: string; // PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, CLOSED
  responseDeadline: string; // ISO
  assignmentDeadline: string; // ISO
  resolutionDeadline: string; // ISO
  slaStatus: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
  isResponseBreached: boolean;
  isAssignmentBreached: boolean;
  isResolutionBreached: boolean;
  isPaused: boolean;
  pauseReason?: string | null;
  pausedAt?: string | null;
  escalationTier: number; // 0: Bình thường, 1: Nhắc nhở KTV, 2: Báo động BMB Điều phối, 3: Leo thang Ban Giám Đốc
  lastAlertSentAt?: string | null;
}

export interface EmergencyAlertRecord {
  id: string;
  emergencyType: string;
  location: string;
  buildingBlock?: string | null;
  description: string;
  triggeredById: string;
  triggeredByName: string;
  isTest: boolean;
  createdAt: string;
}

export interface ResiFixStoreData {
  emergencyContact: EmergencyContact;
  apartments: ApartmentRecord[];
  residencyHistory: ResidencyRecord[];
  payrollConfig: PayrollConfig;
  attendanceLogs: AttendanceRecord[];
  overtimeRequests: OvertimeRequest[];
  reconcileRequests: ReconcileRequest[];
  lockedMonths: LockedMonth[];
  activeNonces?: AttendanceNonce[];
  // 3 Module mới:
  scheduleRequests: ScheduleRequest[];
  repairCosts: TicketRepairCost[];
  costConfig: CostConfig;
  slaConfig: SlaConfig;
  slaTrackings: SlaTicketStatus[];
  emergencyAlerts: EmergencyAlertRecord[];
}

const STORE_PATH = path.resolve(__dirname, 'resifix_data.json');

const DEFAULT_STORE: ResiFixStoreData = {
  emergencyContact: {
    managerName: 'Đặng Thành Quyết',
    managerPhone: '0913402803',
  },
  apartments: [],
  residencyHistory: [],
  payrollConfig: {
    hourlyRateDefault: 50000,
    baseSalaryDefault: 10400000, // 208 giờ * 50.000 VNĐ
    standardMonthlyHours: 208,
    otMultiplierNormal: 1.5,
    otMultiplierNight: 1.3,
    otMultiplierWeekend: 2.0,
    standardAllowance: 730000,
    holidays: ['2026-01-01', '2026-04-30', '2026-05-01', '2026-09-02', '2026-09-03'],
    buildingLocation: {
      buildingName: 'Tòa nhà ResiFix SkyView',
      buildingAddress: '123 Đường Nguyễn Hữu Thọ, Phường Tân Hưng, Quận 7, TP.HCM',
      latitude: 10.7324,
      longitude: 106.6992,
      allowedRadiusMeters: 300,
      isConfirmed: false, // Bắt buộc BMB xác nhận chính thức
      configAuditLogs: [],
    },
  },
  attendanceLogs: [],
  overtimeRequests: [],
  reconcileRequests: [],
  lockedMonths: [],
  activeNonces: [],
  scheduleRequests: [],
  repairCosts: [],
  costConfig: {
    anomalyThresholdVnd: 5000000,
    requireReceiptThresholdVnd: 500000,
  },
  slaConfig: {
    highPriority: { responseMinutes: 15, assignmentMinutes: 30, resolutionHours: 4 },
    mediumPriority: { responseMinutes: 30, assignmentMinutes: 120, resolutionHours: 24 },
    lowPriority: { responseMinutes: 60, assignmentMinutes: 240, resolutionHours: 48 },
    warningThresholdPercent: 80,
    autoEscalationHours: 2,
    alertDebounceMinutes: 15,
  },
  slaTrackings: [],
  emergencyAlerts: [],
};

class StoreManager {
  private data: ResiFixStoreData;

  constructor() {
    this.data = this.load();
  }

  private load(): ResiFixStoreData {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_STORE,
          ...parsed,
          payrollConfig: {
            ...DEFAULT_STORE.payrollConfig,
            ...(parsed.payrollConfig || {}),
            buildingLocation: {
              ...DEFAULT_STORE.payrollConfig.buildingLocation,
              ...(parsed.payrollConfig?.buildingLocation || {}),
            },
          },
          costConfig: {
            ...DEFAULT_STORE.costConfig,
            ...(parsed.costConfig || {}),
          },
          slaConfig: {
            ...DEFAULT_STORE.slaConfig,
            ...(parsed.slaConfig || {}),
          },
        };
      }
    } catch (err) {
      console.warn('Không thể đọc file resifix_store.json, khởi tạo dữ liệu mặc định:', err);
    }
    this.save(DEFAULT_STORE);
    return DEFAULT_STORE;
  }

  public save(newData?: ResiFixStoreData): void {
    if (newData) this.data = newData;
    try {
      const dir = path.dirname(STORE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const serialized = JSON.stringify(this.data, null, 2);
      const tempPath = STORE_PATH + '.tmp';
      const bakPath = STORE_PATH + '.bak';

      // 1. Sao lưu file hiện tại sang .bak
      if (fs.existsSync(STORE_PATH)) {
        try {
          fs.copyFileSync(STORE_PATH, bakPath);
        } catch {}
      }

      // 2. Ghi ra file tạm (.tmp) trước
      fs.writeFileSync(tempPath, serialized, 'utf8');

      // 3. Đổi tên nguyên tử (Atomic Rename) để chống hỏng file khi crash/tắt máy đột ngột
      fs.renameSync(tempPath, STORE_PATH);
    } catch (err) {
      console.error('Lỗi khi ghi an toàn resifix_data.json:', err);
    }
  }

  public get(): ResiFixStoreData {
    return this.data;
  }
}

export const resiFixStore = new StoreManager();

export const isTechOnApprovedLeave = (techId: string, dateStr: string): boolean => {
  const store = resiFixStore.get();
  return store.scheduleRequests.some(
    (r) =>
      r.techId === techId &&
      r.type === 'LEAVE' &&
      r.status === 'APPROVED' &&
      r.date <= dateStr &&
      (r.endDate || r.date) >= dateStr
  );
};

// ----------------------------------------------------------------------------
// CÁC HÀM TIỆN ÍCH TÍNH TOÁN GPS, CA TRỰC, ĐI MUỘN VÀ PHÂN BỔ GIỜ CÔNG
// ----------------------------------------------------------------------------

/**
 * Tính khoảng cách giữa 2 tọa độ GPS theo công thức Haversine (đơn vị: mét)
 */
export const calculateDistanceMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371e3; // Bán kính trái đất (mét)
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
};

/**
 * Trích xuất giờ bắt đầu và kết thúc từ chuỗi ca trực (ví dụ "07:00 - 15:00")
 */
export const parseShiftBounds = (shiftName?: string | null): { startH: number; startM: number; endH: number; endM: number } | null => {
  if (!shiftName) return null;
  const match = shiftName.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return {
    startH: parseInt(match[1], 10),
    startM: parseInt(match[2], 10),
    endH: parseInt(match[3], 10),
    endM: parseInt(match[4], 10),
  };
};

/**
 * Đánh giá tính đúng giờ khi Check-in so với lịch làm việc (Asia/Ho_Chi_Minh)
 * Cho phép grace period 15 phút không tính đi muộn
 */
export const evaluateCheckInPunctuality = (
  checkInDate: Date,
  shiftName?: string | null
): { punctualityStatus: AttendancePunctualityStatus; lateMinutes: number } => {
  const bounds = parseShiftBounds(shiftName);
  if (!bounds) {
    return { punctualityStatus: 'ON_TIME', lateMinutes: 0 };
  }

  const vnTimeStr = checkInDate.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const [currH, currM] = vnTimeStr.split(':').map(Number);
  const checkInMinutes = currH * 60 + currM;
  const shiftStartMinutes = bounds.startH * 60 + bounds.startM;

  const diff = checkInMinutes - shiftStartMinutes;
  // Đi muộn nếu vào sau giờ bắt đầu ca > 15 phút (grace period)
  if (diff > 15) {
    return { punctualityStatus: 'LATE', lateMinutes: diff };
  }
  return { punctualityStatus: 'ON_TIME', lateMinutes: 0 };
};

/**
 * Phân bổ số giờ làm việc: giờ thường (50k/h) và giờ đêm (sau 22:00 đến 06:00)
 */
export const calculateWorkHoursBreakdown = (
  checkInDate: Date,
  checkOutDate: Date
): { totalMinutes: number; totalHours: number; regularHours: number; nightHours: number } => {
  const diffMs = Math.max(0, checkOutDate.getTime() - checkInDate.getTime());
  const totalMinutes = Math.round(diffMs / 60000);
  const totalHours = Math.round((totalMinutes / 60) * 100) / 100;

  // Tính số phút rơi vào khung giờ đêm 22:00 - 06:00 theo Asia/Ho_Chi_Minh
  let nightMinutes = 0;
  const stepMs = 60000 * 5; // Bước nhảy 5 phút
  for (let t = checkInDate.getTime(); t < checkOutDate.getTime(); t += stepMs) {
    const cur = new Date(t);
    const vnTimeStr = cur.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
      hour: '2-digit',
    });
    const h = parseInt(vnTimeStr, 10);
    if (h >= 22 || h < 6) {
      nightMinutes += 5;
    }
  }

  const clampedNightMinutes = Math.min(nightMinutes, totalMinutes);
  const nightHours = Math.round((clampedNightMinutes / 60) * 100) / 100;
  const regularHours = Math.max(0, Math.round((totalHours - nightHours) * 100) / 100);

  return {
    totalMinutes,
    totalHours,
    regularHours,
    nightHours,
  };
};


// ----------------------------------------------------------------------------
// BẢO MẬT PHIÊN CHẤM CÔNG (NONCE - ANTI-REPLAY & CHỐNG DUPLICATE REQUESTS)
// ----------------------------------------------------------------------------

export const createAttendanceNonce = (techId: string, ttlSeconds = 180): string => {
  const store = resiFixStore.get();
  if (!store.activeNonces) store.activeNonces = [];
  const now = Date.now();
  // Dọn dẹp các nonce đã hết hạn hoặc đã dùng
  store.activeNonces = store.activeNonces.filter((n) => n.expiresAt > now && !n.used);

  const nonce = crypto.randomBytes(16).toString('hex');
  store.activeNonces.push({
    nonce,
    techId,
    createdAt: now,
    expiresAt: now + ttlSeconds * 1000,
    used: false,
  });
  resiFixStore.save(store);
  return nonce;
};

export const consumeAttendanceNonce = (nonce: string, techId: string): { valid: boolean; reason?: string } => {
  const store = resiFixStore.get();
  if (!store.activeNonces) store.activeNonces = [];
  const now = Date.now();
  const entry = store.activeNonces.find((n) => n.nonce === nonce);
  if (!entry) {
    return { valid: false, reason: 'Mã phiên chấm công (nonce) không tồn tại hoặc đã được sử dụng.' };
  }
  if (entry.used) {
    return { valid: false, reason: 'Mã phiên chấm công (nonce) đã được sử dụng trước đó (chống Replay).' };
  }
  if (entry.techId !== techId) {
    return { valid: false, reason: 'Mã phiên chấm công không thuộc về tài khoản này.' };
  }
  if (entry.expiresAt < now) {
    return { valid: false, reason: 'Mã phiên chấm công đã hết hạn (quá 3 phút). Vui lòng tải lại.' };
  }
  // Đánh dấu đã sử dụng ngay lập tức
  entry.used = true;
  store.activeNonces = store.activeNonces.filter((n) => n.nonce !== nonce && n.expiresAt > now);
  resiFixStore.save(store);
  return { valid: true };
};

// ----------------------------------------------------------------------------
// TÍNH LƯƠNG CHUẨN ĐIỀU 98 BỘ LUẬT LAO ĐỘNG 2019 (VIỆT NAM)
// ----------------------------------------------------------------------------

export const VIETNAM_PUBLIC_HOLIDAYS_FIXED = [
  '01-01', // Tết Dương lịch
  '04-30', // Giải phóng Miền Nam
  '05-01', // Quốc tế Lao động
  '09-02', // Quốc khánh
  '09-03', // Quốc khánh (ngày liền kề)
];

export const isVietnamPublicHoliday = (dateStr: string): boolean => {
  const mmdd = dateStr.slice(5);
  if (VIETNAM_PUBLIC_HOLIDAYS_FIXED.includes(mmdd)) return true;
  const store = resiFixStore.get();
  if (Array.isArray(store.payrollConfig.holidays) && store.payrollConfig.holidays.includes(dateStr)) {
    return true;
  }
  return false;
};

export const getDayType = (dateStr: string): 'NORMAL' | 'WEEKEND' | 'HOLIDAY' => {
  if (isVietnamPublicHoliday(dateStr)) return 'HOLIDAY';
  const vnDate = new Date(`${dateStr}T12:00:00+07:00`);
  const day = vnDate.getDay();
  if (day === 0 || day === 6) return 'WEEKEND';
  return 'NORMAL';
};

/**
 * Tính hệ số tăng ca chuẩn theo Điều 98 Bộ luật Lao động 2019:
 * - Ngày thường: 150% (ban ngày), 210% (ban đêm = 150% + 30% + 20% x 150%)
 * - Ngày nghỉ hằng tuần: 200% (ban ngày), 270% (ban đêm = 200% + 30% + 20% x 200%)
 * - Ngày lễ, Tết: 300% (ban ngày), 390% (ban đêm = 300% + 30% + 20% x 300%)
 */
export const calculateOvertimeMultiplier = (
  dayType: 'NORMAL' | 'WEEKEND' | 'HOLIDAY',
  isNightOt: boolean
): number => {
  if (dayType === 'HOLIDAY') {
    return isNightOt ? 3.9 : 3.0;
  }
  if (dayType === 'WEEKEND') {
    return isNightOt ? 2.7 : 2.0;
  }
  return isNightOt ? 2.1 : 1.5;
};

export const calculateOvertimePay = (
  hours: number,
  dayType: 'NORMAL' | 'WEEKEND' | 'HOLIDAY',
  isNightOt: boolean,
  baseHourlyRate: number
): number => {
  const mult = calculateOvertimeMultiplier(dayType, isNightOt);
  return Math.round(hours * baseHourlyRate * mult);
};

/**
 * Tính tiền lương ca làm việc chuẩn theo Điều 98 BLLĐ 2019:
 * - Giờ thường ban ngày (06:00 - 22:00): 100% đơn giá (50.000 VNĐ/giờ)
 * - Giờ làm việc ban đêm (22:00 - 06:00): 130% đơn giá (65.000 VNĐ/giờ)
 */
export const calculateShiftSalaryVietnam = (
  regularHours: number,
  nightHours: number,
  baseHourlyRate: number
): { regularPay: number; nightPay: number; totalShiftPay: number } => {
  const regularPay = Math.round(regularHours * baseHourlyRate);
  const nightPay = Math.round(nightHours * baseHourlyRate * 1.3);
  return {
    regularPay,
    nightPay,
    totalShiftPay: regularPay + nightPay,
  };
};
