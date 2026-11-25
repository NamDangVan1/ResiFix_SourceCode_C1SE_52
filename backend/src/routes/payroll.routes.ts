import { Router, Response } from 'express';
import { Role } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../db';
import { DEFAULT_BUILDING_LOCATION } from '../config/building.config';
import {
  AttendanceRecord,
  OvertimeRequest,
  ReconcileRequest,
  calculateDistanceMeters,
  evaluateCheckInPunctuality,
  calculateWorkHoursBreakdown,
  AttendanceGpsSnapshot,
  AttendanceAuditLog,
  AttendanceVerificationStatus,
  createAttendanceNonce,
  consumeAttendanceNonce,
  calculateOvertimePay,
  calculateShiftSalaryVietnam,
  getDayType,
} from '../data/resifix_store';

const IMAGE_DATA_URI = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;
const SAFE_URL = /^https:\/\/[^\s$.?#].[^\s]*$/i;

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
    const match = clean.match(/^data:(image\/(?:jpeg|png|webp));base64,/i);
    const mime = match ? match[1] : 'image/jpeg';
    const estimatedBytes = Math.round((clean.length - (clean.indexOf(',') + 1)) * 3 / 4);
    return { valid: true, detectedMime: mime, sizeBytes: estimatedBytes };
  }
  if (SAFE_URL.test(clean)) {
    return { valid: true, detectedMime: 'image/jpeg', sizeBytes: 0 };
  }
  return { valid: false, message: 'Đường dẫn ảnh không an toàn. Yêu cầu giao thức HTTPS hoặc data URI hợp lệ.' };
};

const getParamAsString = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || '';
  return String(param || '');
};

const timeToMinutes = (t: string): number => {
  if (!t || typeof t !== 'string') return -1;
  const parts = t.trim().split(':').map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return -1;
  const [h, m] = parts;
  if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
};

// ============================================================================
// CÁC HÀM TIỆN ÍCH LƯU TRỮ VÀ GIẢI MÃ DỮ LIỆU ATTENDANCE VÀ OVERTIME QUA PRISMA
// ============================================================================

function unpackAttendanceLog(log: any): AttendanceRecord {
  let meta: any = {};
  if (log.anomalyNotes && typeof log.anomalyNotes === 'string') {
    const trimmed = log.anomalyNotes.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        meta = JSON.parse(trimmed);
      } catch {
        meta = { rawAnomaly: log.anomalyNotes };
      }
    } else {
      meta = { rawAnomaly: log.anomalyNotes };
    }
  }

  const workH = log.workHours !== null && log.workHours !== undefined ? Number(log.workHours) : null;
  const regularH = meta.regularHours !== undefined ? meta.regularHours : workH;
  const nightH = meta.nightHours !== undefined ? meta.nightHours : 0;
  const billableH = meta.billableHours !== undefined ? meta.billableHours : workH;
  const disputedH = meta.disputedHours !== undefined ? meta.disputedHours : (meta.verificationStatus === 'REJECTED' ? (workH || 0) : 0);

  return {
    id: log.id,
    techId: log.technicianId,
    techName: log.technicianName,
    techPhone: meta.techPhone || null,
    buildingBlock: meta.buildingBlock || 'Tòa S1',
    date: log.date,
    sessionIndex: log.sessionIndex,
    shiftScheduled: log.shiftScheduled,
    shiftStartTime: meta.shiftStartTime || (log.shiftScheduled ? log.shiftScheduled.split('-')[0]?.trim() : '07:00'),
    shiftEndTime: meta.shiftEndTime || (log.shiftScheduled ? log.shiftScheduled.split('-')[1]?.trim() : '15:00'),
    checkIn: log.checkIn instanceof Date ? log.checkIn.toISOString() : String(log.checkIn),
    checkInPhotoUrl: meta.checkInPhotoUrl || null,
    checkInGps: meta.checkInGps || null,
    checkInNotes: meta.checkInNotes || null,
    checkOut: log.checkOut ? (log.checkOut instanceof Date ? log.checkOut.toISOString() : String(log.checkOut)) : null,
    checkOutPhotoUrl: meta.checkOutPhotoUrl || null,
    checkOutGps: meta.checkOutGps || null,
    checkOutNotes: meta.checkOutNotes || null,
    workMinutes: log.workMinutes,
    workHours: workH,
    billableHours: billableH,
    regularHours: regularH,
    nightHours: nightH,
    disputedHours: disputedH,
    punctualityStatus: meta.punctualityStatus || 'ON_TIME',
    lateMinutes: meta.lateMinutes || 0,
    earlyMinutes: meta.earlyMinutes || 0,
    verificationStatus: meta.verificationStatus || 'VERIFIED',
    anomalyNotes: meta.rawAnomaly || meta.anomalyText || (typeof meta.anomalyNotes === 'string' ? meta.anomalyNotes : null),
    explanationText: meta.explanationText || null,
    photoMetadata: meta.photoMetadata || null,
    reviewNote: meta.reviewNote || null,
    reviewedBy: meta.reviewedBy || null,
    reviewedAt: meta.reviewedAt || null,
    auditLogs: meta.auditLogs || [],
  };
}

function packAttendanceMetadata(record: any, baseAnomalyText?: string | null): string {
  const payload = {
    techPhone: record.techPhone || null,
    buildingBlock: record.buildingBlock || 'Tòa S1',
    shiftStartTime: record.shiftStartTime,
    shiftEndTime: record.shiftEndTime,
    checkInPhotoUrl: record.checkInPhotoUrl || null,
    checkInGps: record.checkInGps || null,
    checkInNotes: record.checkInNotes || null,
    checkOutPhotoUrl: record.checkOutPhotoUrl || null,
    checkOutGps: record.checkOutGps || null,
    checkOutNotes: record.checkOutNotes || null,
    photoMetadata: record.photoMetadata || null,
    regularHours: record.regularHours,
    nightHours: record.nightHours,
    billableHours: record.billableHours,
    disputedHours: record.disputedHours,
    punctualityStatus: record.punctualityStatus,
    lateMinutes: record.lateMinutes,
    earlyMinutes: record.earlyMinutes,
    verificationStatus: record.verificationStatus,
    rawAnomaly: baseAnomalyText || record.anomalyNotes || null,
    explanationText: record.explanationText || null,
    reviewNote: record.reviewNote || null,
    reviewedBy: record.reviewedBy || null,
    reviewedAt: record.reviewedAt || null,
    auditLogs: record.auditLogs || [],
  };
  return JSON.stringify(payload);
}

function formatOvertime(o: any): OvertimeRequest {
  const reqH = o.requestedHours !== undefined && o.requestedHours !== null
    ? Number(o.requestedHours)
    : (o.hours !== undefined ? Number(o.hours) : 0);
  const appH = o.approvedHours !== undefined && o.approvedHours !== null ? Number(o.approvedHours) : reqH;

  return {
    id: o.id,
    techId: o.technicianId || o.techId,
    techName: o.technicianName || o.techName,
    date: o.date,
    fromTime: o.fromTime,
    toTime: o.toTime,
    durationMinutes: o.durationMinutes,
    hours: reqH,
    reason: o.reason,
    ticketId: o.ticketId || null,
    status: o.status,
    approvedHours: appH,
    reviewNote: o.reviewNote || null,
    reviewedBy: o.reviewedByName || (o.reviewedBy ? o.reviewedBy.fullName : null),
    reviewedAt: o.reviewedAt ? new Date(o.reviewedAt).toISOString() : null,
    createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : new Date().toISOString(),
  };
}

async function getPayrollConfig() {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'payroll_config' } });
    if (setting?.value && typeof setting.value === 'object') {
      return setting.value as any;
    }
  } catch (err) {
    console.warn('[PAYROLL_CONFIG_READ_WARN]', err);
  }
  return {
    baseSalaryDefault: 8000000,
    hourlyRateDefault: 50000,
    standardMonthlyHours: 160,
    otMultiplierNormal: 1.5,
    otMultiplierWeekend: 2.0,
    otMultiplierHoliday: 3.0,
    standardAllowance: 730000,
    buildingLocation: {
      buildingName: DEFAULT_BUILDING_LOCATION.buildingName,
      buildingAddress: DEFAULT_BUILDING_LOCATION.buildingAddress,
      latitude: DEFAULT_BUILDING_LOCATION.latitude,
      longitude: DEFAULT_BUILDING_LOCATION.longitude,
      allowedRadiusMeters: DEFAULT_BUILDING_LOCATION.allowedRadiusMeters,
      isConfirmed: true,
    },
  };
}

async function isTechOnApprovedLeaveDb(techId: string, date: string): Promise<boolean> {
  try {
    const leave = await prisma.shiftScheduleRequest.findFirst({
      where: {
        techId,
        type: 'LEAVE',
        status: 'APPROVED',
        date: { lte: date },
        OR: [
          { endDate: null, date },
          { endDate: { gte: date } },
        ],
      },
    });
    return Boolean(leave);
  } catch {
    return false;
  }
}

async function getReconcileRequests(): Promise<ReconcileRequest[]> {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'payroll_reconcile_requests' } });
    if (setting?.value && Array.isArray(setting.value)) {
      return setting.value as any;
    }
  } catch {}
  return [];
}

async function saveReconcileRequests(reqs: ReconcileRequest[]): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: 'payroll_reconcile_requests' },
    create: { key: 'payroll_reconcile_requests', value: reqs as any },
    update: { value: reqs as any },
  });
}

export interface PayrollBonusHistoryItem {
  bonusAmount: number;
  note: string;
  updatedById: string;
  updatedByName: string;
  updatedAt: string;
}

export interface PayrollBonusRecord {
  techId: string;
  month: string;
  bonusAmount: number;
  note: string;
  updatedById: string;
  updatedByName: string;
  updatedAt: string;
  history: PayrollBonusHistoryItem[];
}

const PAYROLL_BONUSES_SETTING_KEY = 'payroll_bonuses';
const FIXED_MONTHLY_BASE_SALARY = 5000000; // 5.000.000 VNĐ / tháng
const FIXED_STANDARD_MONTHLY_HOURS = 180; // 180 giờ / tháng
const FIXED_HOURLY_RATE = FIXED_MONTHLY_BASE_SALARY / FIXED_STANDARD_MONTHLY_HOURS; // ~27.777,78 VNĐ/giờ
const ON_SITE_RESPONSE_THRESHOLD_MINUTES = 15; // Ngưỡng đến hiện trường 15 phút

async function getPayrollBonusesMap(): Promise<Record<string, PayrollBonusRecord>> {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: PAYROLL_BONUSES_SETTING_KEY } });
    if (setting?.value && typeof setting.value === 'object' && !Array.isArray(setting.value)) {
      return setting.value as unknown as Record<string, PayrollBonusRecord>;
    }
  } catch (err) {
    console.warn('[PAYROLL_BONUSES_READ_WARN]', err);
  }
  return {};
}

async function savePayrollBonusRecord(record: PayrollBonusRecord): Promise<void> {
  const map = await getPayrollBonusesMap();
  const key = `${record.month}__${record.techId}`;
  map[key] = record;
  await prisma.systemSetting.upsert({
    where: { key: PAYROLL_BONUSES_SETTING_KEY },
    create: { key: PAYROLL_BONUSES_SETTING_KEY, value: map as any },
    update: { value: map as any },
  });
}

function getVietnamMinutesOfDay(isoOrDate: string | Date): number {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (isNaN(d.getTime())) return -1;
  const timeStr = d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  return timeToMinutes(timeStr);
}

function enrichAttendanceShiftTiming(log: AttendanceRecord) {
  const shiftStartStr = log.shiftStartTime || (log.shiftScheduled ? log.shiftScheduled.split('-')[0]?.trim() : '07:00') || '07:00';
  const shiftEndStr = log.shiftEndTime || (log.shiftScheduled ? log.shiftScheduled.split('-')[1]?.trim() : '15:00') || '15:00';
  const startMin = timeToMinutes(shiftStartStr);
  const endMin = timeToMinutes(shiftEndStr);
  const checkInMin = log.checkIn ? getVietnamMinutesOfDay(log.checkIn) : -1;
  const checkOutMin = log.checkOut ? getVietnamMinutesOfDay(log.checkOut) : -1;

  let earlyArrivalMinutes = 0;
  let lateArrivalMinutes = log.lateMinutes || 0;
  if (startMin >= 0 && checkInMin >= 0) {
    const diffIn = checkInMin - startMin;
    if (diffIn < 0) {
      earlyArrivalMinutes = Math.abs(diffIn);
    } else if (diffIn > 15 && lateArrivalMinutes === 0) {
      lateArrivalMinutes = diffIn;
    }
  }

  let earlyLeaveMinutes = log.earlyMinutes || 0;
  let lateCheckoutMinutes = 0;
  if (endMin >= 0 && checkOutMin >= 0) {
    const diffOut = checkOutMin - endMin;
    if (diffOut < -15 && earlyLeaveMinutes === 0) {
      earlyLeaveMinutes = Math.abs(diffOut);
    } else if (diffOut > 0) {
      lateCheckoutMinutes = diffOut;
    }
  }

  const arrivalLabel =
    lateArrivalMinutes > 0
      ? `Đi trễ ${lateArrivalMinutes} phút`
      : earlyArrivalMinutes > 0
      ? `Đi sớm ${earlyArrivalMinutes} phút`
      : 'Đúng giờ';

  const departureLabel = !log.checkOut
    ? 'Đang trong ca'
    : earlyLeaveMinutes > 0
    ? `Về sớm ${earlyLeaveMinutes} phút`
    : lateCheckoutMinutes > 0
    ? `Về muộn ${lateCheckoutMinutes} phút`
    : 'Đúng giờ';

  const gpsWithin = log.checkInGps ? (log.checkInGps.isWithinAllowedRadius ?? (log.checkInGps as any).isWithinRadius) !== false : false;
  const gpsAcc = log.checkInGps ? Number(log.checkInGps.accuracy ?? (log.checkInGps as any).accuracyMeters ?? 10) : 999;
  const gpsValid = Boolean(log.checkInGps && gpsWithin && gpsAcc <= 100);
  const gpsStatusLabel = !log.checkInGps
    ? 'Thiếu dữ liệu GPS'
    : !gpsWithin
    ? `Ngoài bán kính (~${log.checkInGps.distanceMeters ?? 0}m)`
    : gpsAcc > 100
    ? `GPS sai số cao (±${gpsAcc}m)`
    : 'GPS hợp lệ';

  const shiftStatus = !log.checkOut ? 'ON_DUTY' : 'COMPLETED';
  const validWorkHours =
    log.verificationStatus === 'REJECTED'
      ? 0
      : Math.round(Number(log.billableHours ?? log.workHours ?? 0) * 100) / 100;

  return {
    earlyArrivalMinutes,
    lateArrivalMinutes,
    earlyLeaveMinutes,
    lateCheckoutMinutes,
    arrivalLabel,
    departureLabel,
    gpsValid,
    gpsStatusLabel,
    shiftStatus,
    validWorkHours,
  };
}

async function computeTechnicianMonthlyPerformance(
  techId: string,
  targetMonth: string,
  monthLogs: AttendanceRecord[],
  bonusRecord?: PayrollBonusRecord | null
) {
  const verifiedLogs = monthLogs.filter(
    (a) => a.verificationStatus === 'VERIFIED' || a.verificationStatus === 'APPROVED'
  );
  const disputedLogs = monthLogs.filter(
    (a) => a.verificationStatus === 'PENDING_REVIEW' || a.verificationStatus === 'NEEDS_EXPLANATION'
  );
  const unclosedLogs = monthLogs.filter((a) => !a.checkOut);

  // Nhóm 1: Giờ công (chỉ tính từ chấm công ca làm hợp lệ, không cộng trùng thời gian sự cố)
  const validWorkHours = Math.round(
    verifiedLogs.reduce((sum, a) => sum + Number(a.billableHours ?? a.workHours ?? 0), 0) * 100
  ) / 100;
  const workDaysCount = new Set(verifiedLogs.map((a) => a.date)).size;
  const lateCheckInCount = monthLogs.filter(
    (a) => a.punctualityStatus === 'LATE' || a.punctualityStatus === 'LATE_AND_EARLY' || (a.lateMinutes || 0) > 0
  ).length;
  const earlyLeaveCount = monthLogs.filter(
    (a) => a.punctualityStatus === 'EARLY_LEAVE' || a.punctualityStatus === 'LATE_AND_EARLY' || (a.earlyMinutes || 0) > 0
  ).length;

  // Ngày nghỉ theo lịch được duyệt trong tháng
  let scheduledLeaveDaysCount = 0;
  try {
    const approvedLeaves = await prisma.shiftScheduleRequest.findMany({
      where: {
        techId,
        type: 'LEAVE',
        status: 'APPROVED',
        date: { startsWith: targetMonth },
      },
    });
    scheduledLeaveDaysCount = approvedLeaves.length;
  } catch {}

  // Nhóm 2, 3, 4: Sự cố, Thời gian phản hồi hiện trường & Đánh giá cư dân trong tháng
  const monthStart = new Date(`${targetMonth}-01T00:00:00.000+07:00`);
  const [yearNum, monthNum] = targetMonth.split('-').map(Number);
  const nextMonthStart =
    !isNaN(yearNum) && !isNaN(monthNum)
      ? new Date(yearNum, monthNum, 1, 0, 0, 0)
      : new Date(Date.now() + 30 * 86400000);

  let techTickets: any[] = [];
  try {
    techTickets = await prisma.incidentTicket.findMany({
      where: {
        assignedTechId: techId,
        OR: [
          { assignedAt: { gte: monthStart, lt: nextMonthStart } },
          { assignedAt: null, createdAt: { gte: monthStart, lt: nextMonthStart } },
        ],
      },
      select: {
        id: true,
        ticketCode: true,
        title: true,
        status: true,
        finalPriority: true,
        aiSuggestedPriority: true,
        assignedAt: true,
        acknowledgedAt: true,
        startedAt: true,
        resolvedAt: true,
        closedAt: true,
        ratingStars: true,
        ratingComment: true,
        ratedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch (err) {
    console.warn('[TECH_MONTHLY_TICKETS_WARN]', err);
  }

  const totalAssignedTickets = techTickets.length;
  let highPriorityCount = 0;
  let mediumPriorityCount = 0;
  let lowPriorityCount = 0;
  let completedTicketsCount = 0;

  let onTimeArrivalCount = 0;
  let lateArrivalCount = 0;
  let totalLateArrivalMinutes = 0;
  let pendingArrivalCount = 0;

  const lateTicketsDetail: Array<{
    ticketId: string;
    ticketCode: string;
    title: string;
    priority: string;
    assignedAt: string;
    acknowledgedAt: string;
    responseMinutes: number;
    lateMinutes: number;
  }> = [];

  const monthTicketsDetail: Array<{
    ticketId: string;
    ticketCode: string;
    title: string;
    status: string;
    priority: string;
    assignedAt: string | null;
    acknowledgedAt: string | null;
    responseMinutes: number | null;
    lateMinutes: number | null;
    arrivalStatus: 'ON_TIME' | 'LATE' | 'MISSING_DATA';
    ratingStars: number | null;
  }> = [];

  const ratingsList: Array<{
    ticketCode: string;
    title: string;
    ratingStars: number;
    ratingComment: string | null;
    ratedAt: string | null;
  }> = [];

  for (const t of techTickets) {
    const prio = String(t.finalPriority || t.aiSuggestedPriority || 'MEDIUM').toUpperCase();
    if (prio === 'HIGH') highPriorityCount += 1;
    else if (prio === 'LOW') lowPriorityCount += 1;
    else mediumPriorityCount += 1;

    if (t.status === 'COMPLETED' || t.status === 'CLOSED') {
      completedTicketsCount += 1;
    }

    // Thời gian phản hồi = Thời gian check-in hiện trường (acknowledgedAt || startedAt) - Thời gian được phân công (assignedAt)
    const assignedDate = t.assignedAt ? new Date(t.assignedAt) : null;
    const arrivedDate = t.acknowledgedAt
      ? new Date(t.acknowledgedAt)
      : t.startedAt
      ? new Date(t.startedAt)
      : null;

    let responseMinutes: number | null = null;
    let lateMinutes: number | null = null;
    let arrivalStatus: 'ON_TIME' | 'LATE' | 'MISSING_DATA' = 'MISSING_DATA';

    if (
      assignedDate &&
      arrivedDate &&
      !isNaN(assignedDate.getTime()) &&
      !isNaN(arrivedDate.getTime()) &&
      arrivedDate.getTime() >= assignedDate.getTime()
    ) {
      responseMinutes = Math.floor((arrivedDate.getTime() - assignedDate.getTime()) / 60000);
      if (responseMinutes <= ON_SITE_RESPONSE_THRESHOLD_MINUTES) {
        arrivalStatus = 'ON_TIME';
        lateMinutes = 0;
        onTimeArrivalCount += 1;
      } else {
        arrivalStatus = 'LATE';
        lateMinutes = Math.max(0, responseMinutes - ON_SITE_RESPONSE_THRESHOLD_MINUTES);
        lateArrivalCount += 1;
        totalLateArrivalMinutes += lateMinutes;
        lateTicketsDetail.push({
          ticketId: t.id,
          ticketCode: t.ticketCode,
          title: t.title,
          priority: prio,
          assignedAt: assignedDate.toISOString(),
          acknowledgedAt: arrivedDate.toISOString(),
          responseMinutes,
          lateMinutes,
        });
      }
    } else {
      pendingArrivalCount += 1;
    }

    monthTicketsDetail.push({
      ticketId: t.id,
      ticketCode: t.ticketCode,
      title: t.title,
      status: t.status,
      priority: prio,
      assignedAt: assignedDate ? assignedDate.toISOString() : null,
      acknowledgedAt: arrivedDate ? arrivedDate.toISOString() : null,
      responseMinutes,
      lateMinutes,
      arrivalStatus,
      ratingStars: t.ratingStars ?? null,
    });

    if (typeof t.ratingStars === 'number' && t.ratingStars > 0) {
      ratingsList.push({
        ticketCode: t.ticketCode,
        title: t.title,
        ratingStars: t.ratingStars,
        ratingComment: t.ratingComment || null,
        ratedAt: t.ratedAt ? new Date(t.ratedAt).toISOString() : null,
      });
    }
  }

  const totalRatingsCount = ratingsList.length;
  const averageRating =
    totalRatingsCount > 0
      ? Math.round((ratingsList.reduce((sum, r) => sum + r.ratingStars, 0) / totalRatingsCount) * 10) / 10
      : null;

  // Công thức tính lương cố định (Phần G1):
  // Lương cơ bản = 5.000.000 VNĐ / 180 giờ
  // Lương theo giờ = (5.000.000 / 180) * Số giờ công hợp lệ
  // Tổng lương = Lương theo giờ + Tiền thưởng BMB
  const hourlySalary = Math.round(FIXED_HOURLY_RATE * validWorkHours);
  const bmbBonus = bonusRecord && typeof bonusRecord.bonusAmount === 'number' ? Math.max(0, Math.round(bonusRecord.bonusAmount)) : 0;
  const totalSalary = hourlySalary + bmbBonus;
  const disputedHours = Math.round(
    disputedLogs.reduce((sum, a) => sum + Number(a.disputedHours || a.workHours || 0), 0) * 100
  ) / 100;

  return {
    baseSalaryFixed: FIXED_MONTHLY_BASE_SALARY,
    standardMonthlyHoursFixed: FIXED_STANDARD_MONTHLY_HOURS,
    hourlyRateFixed: Math.round(FIXED_HOURLY_RATE * 100) / 100,
    validWorkHours,
    hourlySalary,
    bmbBonus,
    bmbBonusNote: bonusRecord?.note || '',
    bmbBonusUpdatedBy: bonusRecord?.updatedByName || null,
    bmbBonusUpdatedAt: bonusRecord?.updatedAt || null,
    bmbBonusHistory: bonusRecord?.history || [],
    totalSalary,
    disputedHours,
    unclosedShiftsCount: unclosedLogs.length,
    performance: {
      workHoursGroup: {
        validWorkHours,
        workDaysCount,
        scheduledLeaveDaysCount,
        lateCheckInCount,
        earlyLeaveCount,
        unclosedShiftsCount: unclosedLogs.length,
        totalLogsCount: monthLogs.length,
        verifiedShiftsCount: verifiedLogs.length,
        disputedShiftsCount: disputedLogs.length,
      },
      incidentsGroup: {
        totalAssignedTickets,
        highPriorityCount,
        mediumPriorityCount,
        lowPriorityCount,
        completedTicketsCount,
      },
      responseTimeGroup: {
        thresholdMinutes: ON_SITE_RESPONSE_THRESHOLD_MINUTES,
        onTimeArrivalCount,
        lateArrivalCount,
        totalLateArrivalMinutes,
        pendingArrivalCount,
        lateTicketsDetail,
      },
      ratingsGroup: {
        totalRatingsCount,
        averageRating,
        ratingsList,
      },
      monthTicketsDetail,
    },
  };
}

const router = Router();

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
      const dbRecord = await prisma.attendanceLog.findUnique({
        where: { id: attendanceId },
      });

      if (!dbRecord) {
        res.status(404).json({ success: false, message: 'Không tìm thấy ca chấm công này.' });
        return;
      }

      const record = unpackAttendanceLog(dbRecord);

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
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const cfg = await getPayrollConfig();
      res.status(200).json({
        success: true,
        buildingLocation: cfg.buildingLocation,
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

      const cfg = await getPayrollConfig();
      const prevLocation = cfg.buildingLocation || {};
      const { configAuditLogs: _ignored, ...prevConfigPure } = prevLocation;

      const bmbId = req.user!.userId;
      const bmbName = req.user!.fullName || 'BMB Admin';
      const nowIso = new Date().toISOString();

      if (!prevLocation.configAuditLogs) {
        prevLocation.configAuditLogs = [];
      }

      prevLocation.configAuditLogs.push({
        changedAt: nowIso,
        changedById: bmbId,
        changedByName: bmbName,
        previousConfig: prevConfigPure,
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

      prevLocation.buildingName = buildingName.trim();
      prevLocation.buildingAddress = buildingAddress.trim();
      prevLocation.latitude = latitude;
      prevLocation.longitude = longitude;
      prevLocation.allowedRadiusMeters = allowedRadiusMeters;
      prevLocation.isConfirmed = true;
      prevLocation.confirmedAt = nowIso;
      prevLocation.confirmedById = bmbId;
      prevLocation.confirmedByName = bmbName;

      cfg.buildingLocation = prevLocation;

      await prisma.systemSetting.upsert({
        where: { key: 'payroll_config' },
        create: { key: 'payroll_config', value: cfg as any },
        update: { value: cfg as any },
      });

      console.log(`[AUDIT] BMB (${bmbName}) đã xác nhận cấu hình vị trí tòa nhà:`, cfg.buildingLocation);

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật và xác nhận tọa độ chính thức của tòa nhà thành công.',
        buildingLocation: cfg.buildingLocation,
      });
    } catch (error) {
      console.error('Lỗi khi cấu hình vị trí tòa nhà:', error);
      res.status(500).json({ success: false, message: 'Không thể lưu cấu hình vị trí tòa nhà.' });
    }
  }
);

// ============================================================================
// 1. KỸ THUẬT VIÊN: CHECK-IN / CHECK-OUT (GIỜ CHUẨN SERVER + GPS + ẢNH WATERMARK)
// ============================================================================

// POST /api/payroll/check-in
router.post(
  '/check-in',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;
      const tech = await prisma.user.findUnique({
        where: { id: techId },
        select: { id: true, fullName: true, shiftName: true, buildingBlock: true },
      });

      if (!tech) {
        res.status(404).json({ success: false, message: 'Không tìm thấy kỹ thuật viên.' });
        return;
      }

      // 1. LẤY THỜI GIAN CHÍNH THỨC TỪ SERVER (Asia/Ho_Chi_Minh)
      const now = new Date();
      const serverIsoTime = now.toISOString();
      const todayDate = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

      // 2. Kiểm tra lịch nghỉ phép đã được phê duyệt hôm nay
      const onLeave = await isTechOnApprovedLeaveDb(techId, todayDate);
      if (onLeave) {
        res.status(400).json({
          success: false,
          message: `Hôm nay (${todayDate}) bạn đang có lịch nghỉ phép đã được phê duyệt. Không thể thực hiện check-in!`,
        });
        return;
      }

      // 3. Chống Check-in trùng (ca làm việc đang mở chưa check-out)
      const activeSession = await prisma.attendanceLog.findFirst({
        where: { technicianId: techId, checkOut: null },
      });
      if (activeSession) {
        const unpackedActive = unpackAttendanceLog(activeSession);
        res.status(400).json({
          success: false,
          message: `Bạn đang có ca làm việc chưa hoàn tất check-out (bắt đầu lúc ${new Date(activeSession.checkIn).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} ngày ${activeSession.date}). Vui lòng check-out trước khi bắt đầu ca mới!`,
          attendance: unpackedActive,
        });
        return;
      }

      // Đọc dữ liệu GPS & Ảnh từ Client gửi lên
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { photoUrl, latitude, longitude, accuracy, notes, nonce } = body;

      // Kiểm tra Nonce chống Replay Attack & Duplicate Request
      if (typeof nonce === 'string' && nonce.trim()) {
        const nonceCheck = consumeAttendanceNonce(nonce.trim(), techId);
        if (!nonceCheck.valid) {
          res.status(400).json({
            success: false,
            message: nonceCheck.reason || 'Mã phiên chấm công (nonce) không hợp lệ hoặc đã hết hạn.',
          });
          return;
        }
      }

      const cfg = await getPayrollConfig();
      const buildingLoc = cfg.buildingLocation || {
        buildingName: DEFAULT_BUILDING_LOCATION.buildingName,
        buildingAddress: DEFAULT_BUILDING_LOCATION.buildingAddress,
        latitude: DEFAULT_BUILDING_LOCATION.latitude,
        longitude: DEFAULT_BUILDING_LOCATION.longitude,
        allowedRadiusMeters: DEFAULT_BUILDING_LOCATION.allowedRadiusMeters,
        isConfirmed: true,
      };

      // 4. Kiểm tra vị trí GPS so với tọa độ tòa nhà
      let checkInGps: AttendanceGpsSnapshot | null = null;
      let isWithinRadius = false;
      const hasGps = typeof latitude === 'number' && typeof longitude === 'number' && !isNaN(latitude) && !isNaN(longitude);

      if (hasGps) {
        const distMeters = calculateDistanceMeters(latitude, longitude, buildingLoc.latitude, buildingLoc.longitude);
        isWithinRadius = distMeters <= buildingLoc.allowedRadiusMeters;
        checkInGps = {
          latitude,
          longitude,
          accuracyMeters: typeof accuracy === 'number' ? Math.round(accuracy) : null,
          accuracy: typeof accuracy === 'number' ? Math.round(accuracy) : null,
          distanceToBuildingMeters: distMeters,
          distanceMeters: distMeters,
          isWithinRadius,
          isWithinAllowedRadius: isWithinRadius,
          addressEstimate: isWithinRadius
            ? `${buildingLoc.buildingName} (Ước tính cách ~${distMeters}m)`
            : `Tọa độ ngoài phạm vi (Cách ${buildingLoc.buildingName} ~${distMeters}m)`,
        };
      }

      // 5. Kiểm tra tính đúng giờ so với ca trực được giao
      const punctuality = evaluateCheckInPunctuality(now, tech.shiftName);

      // 6. Kiểm tra ảnh chụp trực tiếp
      const hasPhoto = typeof photoUrl === 'string' && photoUrl.trim().length > 0;

      // 7. Xác định trạng thái xác minh:
      let verificationStatus: AttendanceVerificationStatus = 'VERIFIED';
      const anomalyReasons: string[] = [];

      if (!buildingLoc.isConfirmed) {
        verificationStatus = 'PENDING_REVIEW';
        anomalyReasons.push('Tọa độ tòa nhà chưa được BMB xác nhận chính thức. Ca trực đưa vào danh sách chờ BMB đối soát.');
      }

      if (!hasGps) {
        verificationStatus = 'PENDING_REVIEW';
        anomalyReasons.push('Không xác định được vị trí GPS khi check-in');
      } else if (!isWithinRadius) {
        verificationStatus = 'PENDING_REVIEW';
        anomalyReasons.push(`Vị trí GPS ngoài phạm vi tòa nhà (${checkInGps?.distanceToBuildingMeters}m > ${buildingLoc.allowedRadiusMeters}m)`);
      } else if (typeof accuracy === 'number' && accuracy > 100) {
        anomalyReasons.push(`Độ chính xác GPS kém (±${Math.round(accuracy)}m > 100m), cần đối soát thực tế`);
      }

      const photoValidation = validateAttendancePhoto(photoUrl);
      let photoMetadata: any = null;
      if (!photoValidation.valid) {
        verificationStatus = 'PENDING_REVIEW';
        anomalyReasons.push(photoValidation.message || 'Ảnh chụp check-in không hợp lệ');
      } else {
        photoMetadata = {
          originalPhotoUrl: photoUrl.trim(),
          watermarkText: `ResiFix Attendance [${tech.fullName}] • ${serverIsoTime} • ${buildingLoc.buildingName}`,
          verifiedLocationText: checkInGps ? `Tọa độ: ${checkInGps.latitude.toFixed(6)}, ${checkInGps.longitude.toFixed(6)} (~${checkInGps.distanceToBuildingMeters}m)` : 'Không có GPS',
          serverTimestamp: serverIsoTime,
          uploadedAt: serverIsoTime,
          mimeType: photoValidation.detectedMime,
          fileSizeBytes: photoValidation.sizeBytes,
          storageRetentionPolicy: 'Lưu giữ 90 ngày đối soát công lương theo quy định ResiFix. Không dùng nhận diện sinh trắc học.',
        };
      }

      if (punctuality.punctualityStatus === 'LATE') {
        anomalyReasons.push(`Vào ca muộn ${punctuality.lateMinutes} phút so với ca ${tech.shiftName || 'tiêu chuẩn'}`);
      }

      const initialAuditLog: AttendanceAuditLog = {
        action: verificationStatus === 'VERIFIED' ? 'AUTO_VERIFY' : 'SYSTEM_FLAG',
        performedById: techId,
        performedByName: tech.fullName,
        performedAt: serverIsoTime,
        note: verificationStatus === 'VERIFIED'
          ? 'Hệ thống tự động xác nhận: Vị trí trong phạm vi tòa nhà & có ảnh check-in hợp lệ.'
          : `Gắn cờ ngoại lệ: ${anomalyReasons.join('; ')}`,
      };

      const daySessionsCount = await prisma.attendanceLog.count({
        where: { technicianId: techId, date: todayDate },
      });
      const sessionIndex = daySessionsCount + 1;

      const recordData: any = {
        id: `att-${Date.now()}-${sessionIndex}`,
        techId,
        techName: tech.fullName,
        techPhone: req.user!.phone,
        buildingBlock: tech.buildingBlock || 'Tòa S1',
        date: todayDate,
        sessionIndex,
        shiftScheduled: tech.shiftName || '07:00 - 15:00',
        checkIn: serverIsoTime,
        checkInPhotoUrl: hasPhoto ? photoUrl.trim() : null,
        checkInGps,
        checkInNotes: typeof notes === 'string' ? notes.trim() : null,
        photoMetadata,
        checkOut: null,
        workMinutes: null,
        workHours: null,
        billableHours: null,
        regularHours: null,
        nightHours: null,
        disputedHours: null,
        punctualityStatus: punctuality.punctualityStatus,
        lateMinutes: punctuality.lateMinutes,
        verificationStatus,
        anomalyNotes: anomalyReasons.length > 0 ? anomalyReasons.join('; ') : null,
        auditLogs: [initialAuditLog],
      };

      const serializedMetadata = packAttendanceMetadata(recordData, recordData.anomalyNotes);

      const created = await prisma.attendanceLog.create({
        data: {
          id: recordData.id,
          technicianId: techId,
          technicianName: tech.fullName,
          date: todayDate,
          sessionIndex,
          shiftScheduled: recordData.shiftScheduled,
          checkIn: now,
          anomalyNotes: serializedMetadata,
        },
      });

      // Cập nhật trạng thái sẵn sàng trực isOnDuty = true trên User
      await prisma.user.update({
        where: { id: techId },
        data: { isOnDuty: true },
        select: { id: true },
      });

      console.log(`[ATTENDANCE] KTV ${tech.fullName} đã check-in ca ${sessionIndex} lúc ${serverIsoTime} [${verificationStatus} - ${punctuality.punctualityStatus}]`);

      res.status(200).json({
        success: true,
        message: `Check-in ca ${sessionIndex} thành công! (${punctuality.punctualityStatus === 'LATE' ? `Ghi nhận vào muộn ${punctuality.lateMinutes} phút` : 'Đúng giờ'})`,
        attendance: unpackAttendanceLog(created),
      });
    } catch (error) {
      console.error('Lỗi khi check-in:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi check-in.' });
    }
  }
);

// POST /api/payroll/check-out
router.post(
  '/check-out',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;
      const now = new Date();
      const serverIsoTime = now.toISOString();

      // Tìm ca trực đang mở gần nhất chưa check-out của KTV
      const dbActive = await prisma.attendanceLog.findFirst({
        where: { technicianId: techId, checkOut: null },
        orderBy: { checkIn: 'desc' },
      });

      if (!dbActive) {
        res.status(400).json({
          success: false,
          message: 'Không tìm thấy ca làm việc nào đang mở cần check-out.',
        });
        return;
      }

      const activeRecord = unpackAttendanceLog(dbActive);

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { photoUrl, latitude, longitude, accuracy, notes, nonce } = body;

      // Kiểm tra Nonce chống Replay Attack & Duplicate Request
      if (typeof nonce === 'string' && nonce.trim()) {
        const nonceCheck = consumeAttendanceNonce(nonce.trim(), techId);
        if (!nonceCheck.valid) {
          res.status(400).json({
            success: false,
            message: nonceCheck.reason || 'Mã phiên chấm công (nonce) không hợp lệ hoặc đã hết hạn.',
          });
          return;
        }
      }

      const cfg = await getPayrollConfig();
      const buildingLoc = cfg.buildingLocation || {
        buildingName: DEFAULT_BUILDING_LOCATION.buildingName,
        buildingAddress: DEFAULT_BUILDING_LOCATION.buildingAddress,
        latitude: DEFAULT_BUILDING_LOCATION.latitude,
        longitude: DEFAULT_BUILDING_LOCATION.longitude,
        allowedRadiusMeters: DEFAULT_BUILDING_LOCATION.allowedRadiusMeters,
        isConfirmed: true,
      };

      let checkOutGps: AttendanceGpsSnapshot | null = null;
      let isWithinRadius = false;
      const hasGps = typeof latitude === 'number' && typeof longitude === 'number' && !isNaN(latitude) && !isNaN(longitude);

      if (hasGps) {
        const distMeters = calculateDistanceMeters(latitude, longitude, buildingLoc.latitude, buildingLoc.longitude);
        isWithinRadius = distMeters <= buildingLoc.allowedRadiusMeters;
        checkOutGps = {
          latitude,
          longitude,
          accuracyMeters: typeof accuracy === 'number' ? Math.round(accuracy) : null,
          accuracy: typeof accuracy === 'number' ? Math.round(accuracy) : null,
          distanceToBuildingMeters: distMeters,
          distanceMeters: distMeters,
          isWithinRadius,
          isWithinAllowedRadius: isWithinRadius,
          addressEstimate: isWithinRadius
            ? `${buildingLoc.buildingName} (Ước tính cách ~${distMeters}m)`
            : `Tọa độ ngoài phạm vi (Cách ${buildingLoc.buildingName} ~${distMeters}m)`,
        };
      }

      const hasPhoto = typeof photoUrl === 'string' && photoUrl.trim().length > 0;
      activeRecord.checkOut = serverIsoTime;
      activeRecord.checkOutPhotoUrl = hasPhoto ? photoUrl.trim() : null;
      activeRecord.checkOutGps = checkOutGps;
      activeRecord.checkOutNotes = typeof notes === 'string' ? notes.trim() : null;

      // Phân bổ thời gian thực tế chính xác
      const breakdown = calculateWorkHoursBreakdown(new Date(activeRecord.checkIn), now);
      activeRecord.workMinutes = breakdown.totalMinutes;
      activeRecord.workHours = breakdown.totalHours;
      activeRecord.regularHours = breakdown.regularHours;
      activeRecord.nightHours = breakdown.nightHours;

      const checkoutAnomalies: string[] = [];
      if (!hasGps) {
        checkoutAnomalies.push('Không có GPS khi check-out');
      } else if (!isWithinRadius) {
        checkoutAnomalies.push(`GPS check-out ngoài phạm vi (${checkOutGps?.distanceToBuildingMeters}m)`);
      }

      if (!hasPhoto) {
        checkoutAnomalies.push('Thiếu ảnh chụp hiện trường check-out');
      }

      if (checkoutAnomalies.length > 0) {
        activeRecord.verificationStatus = 'PENDING_REVIEW';
        const existingNotes = activeRecord.anomalyNotes ? `${activeRecord.anomalyNotes}; ` : '';
        activeRecord.anomalyNotes = `${existingNotes}${checkoutAnomalies.join('; ')}`;
        activeRecord.billableHours = activeRecord.workHours;
        activeRecord.disputedHours = activeRecord.workHours;
      } else {
        if (activeRecord.verificationStatus !== 'PENDING_REVIEW') {
          activeRecord.verificationStatus = 'VERIFIED';
          activeRecord.billableHours = activeRecord.workHours;
          activeRecord.disputedHours = 0;
        } else {
          activeRecord.billableHours = activeRecord.workHours;
          activeRecord.disputedHours = activeRecord.workHours;
        }
      }

      if (!activeRecord.auditLogs) activeRecord.auditLogs = [];
      activeRecord.auditLogs.push({
        action: checkoutAnomalies.length > 0 ? 'SYSTEM_FLAG' : 'AUTO_VERIFY',
        performedById: techId,
        performedByName: activeRecord.techName,
        performedAt: serverIsoTime,
        note: `Check-out thành công. Tổng giờ: ${breakdown.totalHours}h (${breakdown.regularHours}h thường, ${breakdown.nightHours}h đêm).${checkoutAnomalies.length > 0 ? ` Ngoại lệ: ${checkoutAnomalies.join('; ')}` : ''}`,
      });

      const updatedSerializedMetadata = packAttendanceMetadata(activeRecord, activeRecord.anomalyNotes);

      const updated = await prisma.attendanceLog.update({
        where: { id: dbActive.id },
        data: {
          checkOut: now,
          workMinutes: breakdown.totalMinutes,
          workHours: breakdown.totalHours,
          anomalyNotes: updatedSerializedMetadata,
        },
      });

      console.log(`[ATTENDANCE] KTV ${activeRecord.techName} đã check-out lúc ${serverIsoTime}. Tổng thời gian: ${breakdown.totalHours}h (${activeRecord.verificationStatus})`);

      res.status(200).json({
        success: true,
        message: `Check-out thành công! Tổng thời gian làm việc: ${breakdown.totalHours} giờ (${breakdown.regularHours}h ngày, ${breakdown.nightHours}h đêm).`,
        attendance: unpackAttendanceLog(updated),
      });
    } catch (error) {
      console.error('Lỗi khi check-out:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi check-out.' });
    }
  }
);

// GET /api/payroll/my-attendance - KTV xem lịch sử chấm công của bản thân
router.get(
  '/my-attendance',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;
      const logs = await prisma.attendanceLog.findMany({
        where: { technicianId: techId },
        orderBy: { checkIn: 'desc' },
      });

      res.status(200).json({ success: true, logs: logs.map(unpackAttendanceLog) });
    } catch (error) {
      console.error('Lỗi khi tải lịch sử chấm công:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải lịch sử chấm công.' });
    }
  }
);

// ============================================================================
// 2. YÊU CẦU TĂNG CA (OVERTIME) - CHỐNG GIAN LẬN & CHỒNG LẤN KHUNG GIỜ
// ============================================================================

// POST /api/payroll/overtime - KTV gửi yêu cầu tăng ca
router.post(
  '/overtime',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;
      const { fromTime, toTime, hours, reason, ticketId, date } = req.body || {};

      let validFrom = typeof fromTime === 'string' ? fromTime.trim() : '';
      let validTo = typeof toTime === 'string' ? toTime.trim() : '';
      let durationMinutes = 0;
      let finalHours = 0;

      if (validFrom && validTo) {
        const startM = timeToMinutes(validFrom);
        const endM = timeToMinutes(validTo);
        if (startM < 0 || endM < 0) {
          res.status(400).json({ success: false, message: 'Định dạng khung giờ không hợp lệ (HH:mm).' });
          return;
        }
        let diff = endM - startM;
        if (diff <= 0) diff += 24 * 60;
        durationMinutes = diff;
        finalHours = Math.round((diff / 60) * 100) / 100;
      } else {
        const numHours = Number(hours);
        if (isNaN(numHours) || numHours < 0.5 || numHours > 8) {
          res.status(400).json({ success: false, message: 'Số giờ tăng ca phải từ 0.5 đến 8 giờ theo quy định.' });
          return;
        }
        finalHours = numHours;
        durationMinutes = Math.round(numHours * 60);
        validFrom = '17:30';
        const endM = 17 * 60 + 30 + durationMinutes;
        validTo = `${String(Math.floor((endM / 60) % 24)).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;
      }

      if (finalHours < 0.5 || finalHours > 8) {
        res.status(400).json({ success: false, message: 'Mỗi phiên tăng ca phải từ 0.5 đến 8 giờ.' });
        return;
      }

      if (typeof reason !== 'string' || reason.trim().length < 5) {
        res.status(400).json({ success: false, message: 'Vui lòng nêu rõ lý do tăng ca (tối thiểu 5 ký tự).' });
        return;
      }

      const tech = await prisma.user.findUnique({
        where: { id: techId },
        select: { fullName: true },
      });

      const todayDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

      // Lấy danh sách OT trong ngày từ PostgreSQL
      const existingOts = await prisma.overtimeRequest.findMany({
        where: { technicianId: techId, date: todayDate, status: { not: 'REJECTED' } },
      });

      const startA = timeToMinutes(validFrom);
      let endA = timeToMinutes(validTo);
      if (endA <= startA) endA += 24 * 60;

      for (const existing of existingOts) {
        const startB = timeToMinutes(existing.fromTime || '17:30');
        let endB = timeToMinutes(existing.toTime || '19:30');
        if (endB <= startB) endB += 24 * 60;

        if (startA < endB && endA > startB) {
          res.status(409).json({
            success: false,
            message: `Khung giờ tăng ca (${validFrom} - ${validTo}) bị trùng hoặc chồng lấn với yêu cầu tăng ca khác (${existing.fromTime || '17:30'} - ${existing.toTime || '19:30'}) của bạn trong ngày ${todayDate}!`,
          });
          return;
        }
      }

      const dayExistingHours = existingOts.reduce((sum, o) => sum + Number(o.requestedHours), 0);
      if (dayExistingHours + finalHours > 8) {
        res.status(400).json({
          success: false,
          message: `Tổng số giờ tăng ca trong ngày (${dayExistingHours + finalHours}h) vượt quá định mức tối đa cho phép (8h/ngày).`,
        });
        return;
      }

      const created = await prisma.overtimeRequest.create({
        data: {
          id: `ot-${Date.now()}`,
          technicianId: techId,
          technicianName: tech?.fullName || 'Kỹ thuật viên',
          date: todayDate,
          fromTime: validFrom,
          toTime: validTo,
          durationMinutes,
          requestedHours: finalHours,
          approvedHours: finalHours,
          reason: reason.trim(),
          ticketId: ticketId ? String(ticketId).trim() : null,
          status: 'PENDING',
        },
      });

      console.log(`[OVERTIME] KTV ${created.technicianName} gửi yêu cầu OT: ${validFrom}-${validTo} (${finalHours}h) - Lý do: ${reason}`);

      res.status(201).json({
        success: true,
        message: 'Yêu cầu tăng ca đã được gửi tới Ban Quản Lý (BMB) để phê duyệt.',
        overtime: formatOvertime(created),
      });
    } catch (error) {
      console.error('Lỗi khi gửi yêu cầu tăng ca:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi gửi yêu cầu tăng ca.' });
    }
  }
);

// GET /api/payroll/my-overtime - KTV xem danh sách yêu cầu tăng ca của mình
router.get(
  '/my-overtime',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;
      const ots = await prisma.overtimeRequest.findMany({
        where: { technicianId: techId },
        orderBy: { createdAt: 'desc' },
      });

      res.status(200).json({ success: true, overtimes: ots.map(formatOvertime) });
    } catch (error) {
      console.error('Lỗi khi tải danh sách tăng ca:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách tăng ca.' });
    }
  }
);

// ============================================================================
// 3. TÍNH LƯƠNG & PHIẾU LƯƠNG CỦA KỸ THUẬT VIÊN (LƯƠNG CƠ BẢN 5.000.000 VNĐ / 180 GIỜ + THƯỞNG BMB)
// ============================================================================

// GET /api/payroll/my-salary - KTV xem phiếu lương & thống kê hiệu suất cá nhân minh bạch
router.get(
  '/my-salary',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;
      const targetMonth = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
        ? req.query.month
        : new Date().toISOString().slice(0, 7);

      // Các ca chấm công trong tháng từ PostgreSQL
      const dbLogs = await prisma.attendanceLog.findMany({
        where: { technicianId: techId, date: { startsWith: targetMonth } },
        orderBy: { checkIn: 'desc' },
      });
      const monthLogs = dbLogs.map(unpackAttendanceLog);

      // Tăng ca đã phê duyệt (giữ để hiển thị lịch sử tham khảo; chưa cộng vào công thức lương hiện tại)
      const dbOts = await prisma.overtimeRequest.findMany({
        where: { technicianId: techId, status: 'APPROVED', date: { startsWith: targetMonth } },
      });
      const approvedOts = dbOts.map(formatOvertime);
      const totalOtHours = approvedOts.reduce((sum, o) => sum + (o.approvedHours ?? o.hours), 0);

      const bonusesMap = await getPayrollBonusesMap();
      const bonusRecord = bonusesMap[`${targetMonth}__${techId}`] || null;

      const perfAndPay = await computeTechnicianMonthlyPerformance(
        techId,
        targetMonth,
        monthLogs,
        bonusRecord
      );

      const lock = await prisma.monthlyPayrollLock.findUnique({ where: { month: targetMonth } });
      const isLocked = Boolean(lock);

      res.status(200).json({
        success: true,
        payroll: {
          month: targetMonth,
          baseSalary: perfAndPay.baseSalaryFixed,
          standardMonthlyHours: perfAndPay.standardMonthlyHoursFixed,
          hourlyRate: perfAndPay.hourlyRateFixed,
          validWorkHours: perfAndPay.validWorkHours,
          regularHours: perfAndPay.validWorkHours,
          hourlySalary: perfAndPay.hourlySalary,
          regularPay: perfAndPay.hourlySalary,
          bmbBonus: perfAndPay.bmbBonus,
          bmbBonusNote: perfAndPay.bmbBonusNote,
          bmbBonusUpdatedBy: perfAndPay.bmbBonusUpdatedBy,
          bmbBonusUpdatedAt: perfAndPay.bmbBonusUpdatedAt,
          bmbBonusHistory: perfAndPay.bmbBonusHistory,
          nightHours: 0,
          nightPay: 0,
          approvedOtHours: totalOtHours,
          otPay: 0,
          standardAllowance: 0,
          disputedHours: perfAndPay.disputedHours,
          disputedPayEstimated: Math.round(perfAndPay.disputedHours * FIXED_HOURLY_RATE),
          deductions: 0,
          totalSalary: perfAndPay.totalSalary,
          isLocked,
          formulaDetail: `Lương theo giờ = (5.000.000 / 180) × ${perfAndPay.validWorkHours}h = ${perfAndPay.hourlySalary.toLocaleString('vi-VN')}đ | Thưởng BMB: +${perfAndPay.bmbBonus.toLocaleString('vi-VN')}đ | Tổng lương = ${perfAndPay.totalSalary.toLocaleString('vi-VN')}đ`,
          overtimeDetails: approvedOts,
          attendanceLogsCount: monthLogs.length,
          verifiedShiftsCount: perfAndPay.performance.workHoursGroup.verifiedShiftsCount,
          disputedShiftsCount: perfAndPay.performance.workHoursGroup.disputedShiftsCount,
          performance: perfAndPay.performance,
        },
      });
    } catch (error) {
      console.error('Lỗi khi tải phiếu lương:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải phiếu lương.' });
    }
  }
);

// POST /api/payroll/my-attendance/:id/explain - KTV gửi giải trình cho ca ngoại lệ
router.post(
  '/my-attendance/:id/explain',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const attendanceId = getParamAsString(req.params.id);
      const { explanationText } = req.body || {};

      if (typeof explanationText !== 'string' || !explanationText.trim()) {
        res.status(400).json({ success: false, message: 'Vui lòng nhập nội dung giải trình.' });
        return;
      }

      const dbLog = await prisma.attendanceLog.findFirst({
        where: { id: attendanceId, technicianId: req.user!.userId },
      });

      if (!dbLog) {
        res.status(404).json({ success: false, message: 'Không tìm thấy ca chấm công của bạn.' });
        return;
      }

      const record = unpackAttendanceLog(dbLog);
      const nowIso = new Date().toISOString();
      record.explanationText = explanationText.trim();
      record.verificationStatus = 'PENDING_REVIEW';

      if (!record.auditLogs) record.auditLogs = [];
      record.auditLogs.push({
        action: 'TECH_EXPLAIN',
        performedById: req.user!.userId,
        performedByName: req.user!.fullName,
        performedAt: nowIso,
        note: `KTV giải trình: ${explanationText.trim()}`,
      });

      const updatedSerialized = packAttendanceMetadata(record, record.anomalyNotes);

      const updated = await prisma.attendanceLog.update({
        where: { id: dbLog.id },
        data: { anomalyNotes: updatedSerialized },
      });

      console.log(`[ATTENDANCE_EXPLAIN] KTV ${req.user!.fullName} đã gửi giải trình cho ca ${record.id}`);

      res.status(200).json({
        success: true,
        message: 'Đã gửi giải trình thành công. Vui lòng chờ Ban quản lý xét duyệt!',
        attendance: unpackAttendanceLog(updated),
      });
    } catch (error) {
      console.error('Lỗi gửi giải trình chấm công:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi gửi giải trình.' });
    }
  }
);

// POST /api/payroll/my-reconcile - KTV gửi yêu cầu đối soát / khiếu nại lương
router.post(
  '/my-reconcile',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const techId = req.user!.userId;
      const { month, note } = req.body || {};
      if (typeof note !== 'string' || note.trim().length < 5) {
        res.status(400).json({ success: false, message: 'Vui lòng nhập nội dung đối soát (tối thiểu 5 ký tự).' });
        return;
      }

      const tech = await prisma.user.findUnique({ where: { id: techId }, select: { fullName: true } });
      const recs = await getReconcileRequests();

      const rec: ReconcileRequest = {
        id: `rec-${Date.now()}`,
        techId,
        techName: tech?.fullName || 'KTV',
        month: month || new Date().toISOString().slice(0, 7),
        note: note.trim(),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };

      recs.push(rec);
      await saveReconcileRequests(recs);

      console.log(`[AUDIT] KTV ${rec.techName} gửi yêu cầu đối soát lương tháng ${rec.month}: ${rec.note}`);

      res.status(201).json({
        success: true,
        message: 'Đã gửi yêu cầu đối soát tới Ban Quản Lý (BMB).',
        reconcile: rec,
      });
    } catch (error) {
      console.error('Lỗi khi gửi đối soát:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi gửi đối soát.' });
    }
  }
);

// ============================================================================
// 4. BMB ADMIN: QUẢN LÝ CHẤM CÔNG, DUYỆT NGOẠI LỆ, BẢNG LƯƠNG & KHÓA SỔ
// ============================================================================

// GET /api/payroll/admin/attendance - BMB quản lý toàn bộ chấm công, lọc linh hoạt, GPS + Ảnh
router.get(
  '/admin/attendance',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { date, month, techId, buildingBlock, status } = req.query as Record<string, string>;

      const where: any = {
        technician: { isActive: true },
      };
      if (date && typeof date === 'string' && date.trim()) {
        where.date = date.trim();
      } else if (month && typeof month === 'string' && month.trim()) {
        where.date = { startsWith: month.trim() };
      }
      if (techId && typeof techId === 'string' && techId !== 'ALL') {
        where.technicianId = techId.trim();
      }

      const [dbLogs, activeTechnicians] = await Promise.all([
        prisma.attendanceLog.findMany({
          where,
          orderBy: { checkIn: 'desc' },
        }),
        prisma.user.findMany({
          where: { role: Role.TECHNICIAN, isActive: true },
          select: { id: true, fullName: true, phone: true, shiftName: true, buildingBlock: true, isOnDuty: true },
        }),
      ]);

      let logs = dbLogs.map(unpackAttendanceLog);

      if (buildingBlock && typeof buildingBlock === 'string' && buildingBlock !== 'ALL') {
        logs = logs.filter((l) => (l.buildingBlock || 'Tòa S1').toUpperCase() === buildingBlock.trim().toUpperCase());
      }

      // Làm giàu thông tin đi sớm/trễ, về sớm/muộn, trạng thái GPS và giờ công hợp lệ
      let enrichedLogs = logs.map((log) => {
        const timing = enrichAttendanceShiftTiming(log);
        return {
          ...log,
          ...timing,
          checkInMapUrl: log.checkInGps
            ? `https://www.google.com/maps?q=${log.checkInGps.latitude},${log.checkInGps.longitude}`
            : null,
          checkOutMapUrl: log.checkOutGps
            ? `https://www.google.com/maps?q=${log.checkOutGps.latitude},${log.checkOutGps.longitude}`
            : null,
        };
      });

      // Tính toán 6 chỉ số KPI tổng quan phía trên (trước khi lọc status để tổng quan rõ ràng, hoặc trên tập dữ liệu hiện tại)
      const currentlyOnDutyCount = enrichedLogs.filter((l) => !l.checkOut).length;
      const completedShiftCount = enrichedLogs.filter((l) => Boolean(l.checkOut)).length;
      const lateCount = enrichedLogs.filter(
        (l) => l.punctualityStatus === 'LATE' || l.punctualityStatus === 'LATE_AND_EARLY' || (l.lateArrivalMinutes || 0) > 0
      ).length;
      const earlyLeaveCount = enrichedLogs.filter(
        (l) => l.punctualityStatus === 'EARLY_LEAVE' || l.punctualityStatus === 'LATE_AND_EARLY' || (l.earlyLeaveMinutes || 0) > 0
      ).length;
      const pendingReviewCount = enrichedLogs.filter(
        (l) => l.verificationStatus === 'PENDING_REVIEW' || l.verificationStatus === 'NEEDS_EXPLANATION'
      ).length;
      const verifiedCount = enrichedLogs.filter(
        (l) => l.verificationStatus === 'VERIFIED' || l.verificationStatus === 'APPROVED'
      ).length;

      // Xác định KTV chưa check-in hoặc nghỉ theo lịch trong ngày đang chọn (hoặc hôm nay)
      const targetDayForRoster =
        date && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
          ? date.trim()
          : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

      const checkedInTechIdsOnTargetDay = new Set(
        enrichedLogs.filter((l) => l.date === targetDayForRoster).map((l) => l.techId)
      );

      let notCheckedInCount = 0;
      const technicianRosterStatus: Array<{
        techId: string;
        techName: string;
        techPhone: string | null;
        buildingBlock: string;
        date: string;
        shiftScheduled: string;
        rosterStatus: 'ON_DUTY' | 'COMPLETED' | 'NOT_STARTED' | 'ABSENT' | 'ON_LEAVE';
        rosterStatusLabel: string;
      }> = [];

      const nowVnMinutes = getVietnamMinutesOfDay(new Date());

      for (const tech of activeTechnicians) {
        if (techId && techId !== 'ALL' && tech.id !== techId.trim()) continue;
        if (
          buildingBlock &&
          buildingBlock !== 'ALL' &&
          (tech.buildingBlock || 'Tòa S1').toUpperCase() !== buildingBlock.trim().toUpperCase()
        ) {
          continue;
        }

        const techDayLog = enrichedLogs.find((l) => l.techId === tech.id && l.date === targetDayForRoster);
        const shiftStr = tech.shiftName || '07:00 - 15:00';
        if (techDayLog) {
          const rStatus = techDayLog.checkOut ? 'COMPLETED' : 'ON_DUTY';
          technicianRosterStatus.push({
            techId: tech.id,
            techName: tech.fullName,
            techPhone: tech.phone,
            buildingBlock: tech.buildingBlock || 'Tòa S1',
            date: targetDayForRoster,
            shiftScheduled: techDayLog.shiftScheduled || shiftStr,
            rosterStatus: rStatus,
            rosterStatusLabel: rStatus === 'ON_DUTY' ? 'Đang trực' : 'Đã kết thúc',
          });
        } else {
          const onLeave = await isTechOnApprovedLeaveDb(tech.id, targetDayForRoster);
          if (onLeave) {
            technicianRosterStatus.push({
              techId: tech.id,
              techName: tech.fullName,
              techPhone: tech.phone,
              buildingBlock: tech.buildingBlock || 'Tòa S1',
              date: targetDayForRoster,
              shiftScheduled: shiftStr,
              rosterStatus: 'ON_LEAVE',
              rosterStatusLabel: 'Nghỉ theo lịch',
            });
          } else {
            notCheckedInCount += 1;
            const shiftEndMin = timeToMinutes(shiftStr.split('-')[1]?.trim() || '15:00');
            const isPastShift = shiftEndMin > 0 && nowVnMinutes > shiftEndMin;
            technicianRosterStatus.push({
              techId: tech.id,
              techName: tech.fullName,
              techPhone: tech.phone,
              buildingBlock: tech.buildingBlock || 'Tòa S1',
              date: targetDayForRoster,
              shiftScheduled: shiftStr,
              rosterStatus: isPastShift ? 'ABSENT' : 'NOT_STARTED',
              rosterStatusLabel: isPastShift ? 'Vắng mặt theo lịch' : 'Chưa bắt đầu',
            });
          }
        }
      }

      // Áp dụng bộ lọc trạng thái cho danh sách hiển thị
      if (status && typeof status === 'string' && status !== 'ALL') {
        const s = status.trim().toUpperCase();
        if (s === 'VERIFIED') {
          enrichedLogs = enrichedLogs.filter((l) => l.verificationStatus === 'VERIFIED' || l.verificationStatus === 'APPROVED');
        } else if (s === 'PENDING_REVIEW') {
          enrichedLogs = enrichedLogs.filter((l) => l.verificationStatus === 'PENDING_REVIEW' || l.verificationStatus === 'NEEDS_EXPLANATION');
        } else if (s === 'ON_DUTY') {
          enrichedLogs = enrichedLogs.filter((l) => !l.checkOut);
        } else if (s === 'COMPLETED') {
          enrichedLogs = enrichedLogs.filter((l) => Boolean(l.checkOut));
        } else if (s === 'LATE') {
          enrichedLogs = enrichedLogs.filter(
            (l) => l.punctualityStatus === 'LATE' || l.punctualityStatus === 'LATE_AND_EARLY' || (l.lateArrivalMinutes || 0) > 0
          );
        } else if (s === 'EARLY_LEAVE') {
          enrichedLogs = enrichedLogs.filter(
            (l) => l.punctualityStatus === 'EARLY_LEAVE' || l.punctualityStatus === 'LATE_AND_EARLY' || (l.earlyLeaveMinutes || 0) > 0
          );
        } else if (s === 'REJECTED') {
          enrichedLogs = enrichedLogs.filter((l) => l.verificationStatus === 'REJECTED');
        } else if (s === 'EXCEPTION') {
          enrichedLogs = enrichedLogs.filter((l) => Boolean(l.anomalyNotes) || !l.gpsValid);
        }
      }

      const anomalies: string[] = [];
      if (currentlyOnDutyCount > 0) {
        anomalies.push(`Có ${currentlyOnDutyCount} kỹ thuật viên đang trực (chưa check-out).`);
      }
      if (pendingReviewCount > 0) {
        anomalies.push(`Có ${pendingReviewCount} ca chấm công có ngoại lệ đang chờ BMB xem xét.`);
      }

      const totalBillableHours = Math.round(enrichedLogs.reduce((sum, l) => sum + (l.validWorkHours || 0), 0) * 100) / 100;
      const totalDisputedHours = Math.round(enrichedLogs.reduce((sum, l) => sum + (l.disputedHours || 0), 0) * 100) / 100;

      const cfg = await getPayrollConfig();

      res.status(200).json({
        success: true,
        totalLogs: enrichedLogs.length,
        currentlyOnDutyCount,
        completedShiftCount,
        verifiedCount,
        pendingReviewCount,
        lateCount,
        earlyLeaveCount,
        notCheckedInCount,
        totalBillableHours,
        totalDisputedHours,
        anomalies,
        buildingLocation: cfg.buildingLocation,
        attendanceLogs: enrichedLogs,
        technicianRosterStatus,
      });
    } catch (error) {
      console.error('Lỗi khi lấy dữ liệu chấm công BMB:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi lấy dữ liệu chấm công.' });
    }
  }
);

// PATCH /api/payroll/admin/attendance/:id/review - BMB duyệt ngoại lệ / điều chỉnh chấm công KTV
router.patch(
  '/admin/attendance/:id/review',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const attendanceId = getParamAsString(req.params.id);
      const { action, reviewNote, adjustedHours } = req.body || {};

      if (!['APPROVE', 'REJECT', 'REQUEST_EXPLANATION'].includes(action)) {
        res.status(400).json({
          success: false,
          message: 'Hành động duyệt không hợp lệ. Vui lòng chọn: APPROVE, REJECT, hoặc REQUEST_EXPLANATION.',
        });
        return;
      }

      if (typeof reviewNote !== 'string' || !reviewNote.trim()) {
        res.status(400).json({
          success: false,
          message: 'Bắt buộc nhập lý do hoặc phản hồi của BMB để lưu vết audit log.',
        });
        return;
      }

      const dbRecord = await prisma.attendanceLog.findUnique({
        where: { id: attendanceId },
      });
      if (!dbRecord) {
        res.status(404).json({ success: false, message: 'Không tìm thấy ca chấm công này.' });
        return;
      }

      const record = unpackAttendanceLog(dbRecord);
      const shiftMonth = record.date.slice(0, 7);
      const isLocked = Boolean(await prisma.monthlyPayrollLock.findUnique({ where: { month: shiftMonth } }));

      if (isLocked) {
        res.status(403).json({
          success: false,
          message: `Kỳ lương tháng ${shiftMonth} đã được khóa chính thức. Không thể sửa đổi hoặc phê duyệt ca này.`,
        });
        return;
      }

      const nowIso = new Date().toISOString();
      const bmbName = req.user?.fullName || 'BMB Admin';
      const bmbId = req.user?.userId || 'bmb-id';

      if (!record.auditLogs) record.auditLogs = [];

      let finalBillable = record.workHours || 0;
      if (action === 'APPROVE') {
        record.verificationStatus = 'APPROVED';
        finalBillable =
          typeof adjustedHours === 'number' && adjustedHours >= 0
            ? Math.round(adjustedHours * 100) / 100
            : record.workHours || 0;
        record.billableHours = finalBillable;
        record.disputedHours = 0;
        record.reviewNote = reviewNote.trim();
        record.reviewedBy = bmbName;
        record.reviewedAt = nowIso;
        record.auditLogs.push({
          action: 'BMB_APPROVE',
          performedById: bmbId,
          performedByName: bmbName,
          performedAt: nowIso,
          note: reviewNote.trim(),
          adjustedHours: finalBillable,
        });
      } else if (action === 'REJECT') {
        record.verificationStatus = 'REJECTED';
        record.billableHours = 0;
        record.disputedHours = record.workHours || 0;
        record.reviewNote = reviewNote.trim();
        record.reviewedBy = bmbName;
        record.reviewedAt = nowIso;
        record.auditLogs.push({
          action: 'BMB_REJECT',
          performedById: bmbId,
          performedByName: bmbName,
          performedAt: nowIso,
          note: reviewNote.trim(),
          adjustedHours: 0,
        });
      } else if (action === 'REQUEST_EXPLANATION') {
        record.verificationStatus = 'NEEDS_EXPLANATION';
        record.reviewNote = reviewNote.trim();
        record.reviewedBy = bmbName;
        record.reviewedAt = nowIso;
        record.auditLogs.push({
          action: 'REQUEST_EXPLANATION',
          performedById: bmbId,
          performedByName: bmbName,
          performedAt: nowIso,
          note: reviewNote.trim(),
        });
      }

      const updatedSerialized = packAttendanceMetadata(record, record.anomalyNotes);

      const updated = await prisma.attendanceLog.update({
        where: { id: dbRecord.id },
        data: {
          workHours: action === 'APPROVE' ? finalBillable : dbRecord.workHours,
          anomalyNotes: updatedSerialized,
        },
      });

      console.log(`[AUDIT_LOG] BMB (${bmbName}) đã ${action} ca chấm công ${record.id} của KTV ${record.techName}. Ghi chú: ${reviewNote.trim()}`);

      res.status(200).json({
        success: true,
        message:
          action === 'APPROVE'
            ? `Đã phê duyệt chấp thuận ca chấm công (${record.billableHours}h được tính lương).`
            : action === 'REJECT'
            ? 'Đã từ chối ca chấm công này.'
            : 'Đã gửi yêu cầu giải trình đến Kỹ thuật viên.',
        attendance: unpackAttendanceLog(updated),
      });
    } catch (error) {
      console.error('Lỗi khi BMB duyệt chấm công:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi duyệt chấm công.' });
    }
  }
);

// GET /api/payroll/admin/overtime - BMB xem danh sách tăng ca
router.get(
  '/admin/overtime',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ots = await prisma.overtimeRequest.findMany({
        where: { technician: { isActive: true } },
        orderBy: { createdAt: 'desc' },
      });
      res.status(200).json({
        success: true,
        overtimeRequests: ots.map(formatOvertime),
      });
    } catch (error) {
      console.error('Lỗi khi lấy danh sách tăng ca:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi lấy danh sách tăng ca.' });
    }
  }
);

// PATCH /api/payroll/admin/overtime/:id - BMB duyệt / từ chối / điều chỉnh tăng ca
router.patch(
  '/admin/overtime/:id',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const otId = getParamAsString(req.params.id);
      const { status, approvedHours, reviewNote } = req.body || {};

      if (!['APPROVED', 'REJECTED'].includes(status)) {
        res.status(400).json({ success: false, message: 'Trạng thái duyệt phải là APPROVED hoặc REJECTED.' });
        return;
      }

      const target = await prisma.overtimeRequest.findUnique({
        where: { id: otId },
      });
      if (!target) {
        res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu tăng ca.' });
        return;
      }

      const reqH = Number(target.requestedHours);
      let appH = reqH;

      if (status === 'APPROVED') {
        if (approvedHours !== undefined) {
          const numApp = Number(approvedHours);
          if (isNaN(numApp) || numApp <= 0 || numApp > reqH) {
            res.status(400).json({
              success: false,
              message: `Số giờ duyệt (${approvedHours}h) không hợp lệ! Phải > 0 và không được vượt quá số giờ KTV đã đăng ký (${reqH}h).`,
            });
            return;
          }
          appH = Math.round(numApp * 100) / 100;
        }
      } else if (status === 'REJECTED') {
        if (!reviewNote || typeof reviewNote !== 'string' || reviewNote.trim().length < 5) {
          res.status(400).json({
            success: false,
            message: 'Bắt buộc nhập lý do từ chối yêu cầu tăng ca (tối thiểu 5 ký tự) để phục vụ kiểm toán và đối soát.',
          });
          return;
        }
        appH = 0;
      }

      const reviewerName = req.user?.fullName || 'BMB Admin';

      const updated = await prisma.overtimeRequest.update({
        where: { id: otId },
        data: {
          status,
          approvedHours: appH,
          reviewNote: typeof reviewNote === 'string' ? reviewNote.trim() : null,
          reviewedById: req.user!.userId,
          reviewedByName: reviewerName,
          reviewedAt: new Date(),
        },
      });

      console.log(`[AUDIT_LOG] BMB (${reviewerName} - ID: ${req.user?.userId}) đã ${status} yêu cầu tăng ca ${updated.id} của KTV ${updated.technicianName}. Giờ duyệt: ${appH}h.`);

      res.status(200).json({
        success: true,
        message: status === 'APPROVED'
          ? `Đã phê duyệt yêu cầu tăng ca (${appH} giờ).`
          : 'Đã từ chối yêu cầu tăng ca.',
        overtime: formatOvertime(updated),
      });
    } catch (error) {
      console.error('Lỗi khi duyệt tăng ca:', error);
      res.status(500).json({ success: false, message: 'Không thể duyệt tăng ca.' });
    }
  }
);

// GET /api/payroll/admin/summary - BMB xem bảng lương tổng hợp & thống kê hiệu suất 4 nhóm theo tháng
router.get(
  '/admin/summary',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const targetMonth = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
        ? req.query.month
        : new Date().toISOString().slice(0, 7);

      const technicians = await prisma.user.findMany({
        where: { role: Role.TECHNICIAN, isActive: true },
        select: { id: true, fullName: true, phone: true, specialtyLabel: true, shiftName: true, buildingBlock: true },
      });

      const cfg = await getPayrollConfig();
      const lock = await prisma.monthlyPayrollLock.findUnique({ where: { month: targetMonth } });
      const isLocked = Boolean(lock);

      const dbAllMonthLogs = await prisma.attendanceLog.findMany({
        where: { date: { startsWith: targetMonth } },
        orderBy: { checkIn: 'desc' },
      });
      const allMonthLogs = dbAllMonthLogs.map(unpackAttendanceLog);

      const dbAllMonthOts = await prisma.overtimeRequest.findMany({
        where: { status: 'APPROVED', date: { startsWith: targetMonth } },
      });
      const allMonthOts = dbAllMonthOts.map(formatOvertime);

      const bonusesMap = await getPayrollBonusesMap();

      const payrollList = await Promise.all(
        technicians.map(async (tech) => {
          const monthLogs = allMonthLogs.filter((a) => a.techId === tech.id);
          const approvedOts = allMonthOts.filter((o) => o.techId === tech.id);
          const otHours = approvedOts.reduce((sum, o) => sum + (o.approvedHours ?? o.hours), 0);

          const bonusRecord = bonusesMap[`${targetMonth}__${tech.id}`] || null;
          const perfAndPay = await computeTechnicianMonthlyPerformance(
            tech.id,
            targetMonth,
            monthLogs,
            bonusRecord
          );

          return {
            techId: tech.id,
            fullName: tech.fullName,
            phone: tech.phone,
            specialtyLabel: tech.specialtyLabel || 'Đa năng',
            shiftName: tech.shiftName || '07:00 - 15:00',
            buildingBlock: tech.buildingBlock || 'Tòa S1',
            baseSalary: perfAndPay.baseSalaryFixed,
            standardMonthlyHours: perfAndPay.standardMonthlyHoursFixed,
            hourlyRate: perfAndPay.hourlyRateFixed,
            validWorkHours: perfAndPay.validWorkHours,
            regularHours: perfAndPay.validWorkHours,
            hourlySalary: perfAndPay.hourlySalary,
            regularPay: perfAndPay.hourlySalary,
            bmbBonus: perfAndPay.bmbBonus,
            bmbBonusNote: perfAndPay.bmbBonusNote,
            bmbBonusUpdatedBy: perfAndPay.bmbBonusUpdatedBy,
            bmbBonusUpdatedAt: perfAndPay.bmbBonusUpdatedAt,
            bmbBonusHistory: perfAndPay.bmbBonusHistory,
            nightHours: 0,
            nightPay: 0,
            otHours: Math.round(otHours * 100) / 100,
            otPay: 0,
            allowance: 0,
            disputedHours: perfAndPay.disputedHours,
            disputedPayEstimated: Math.round(perfAndPay.disputedHours * FIXED_HOURLY_RATE),
            deductions: 0,
            totalSalary: perfAndPay.totalSalary,
            totalShiftsCount: monthLogs.length,
            verifiedShiftsCount: perfAndPay.performance.workHoursGroup.verifiedShiftsCount,
            disputedShiftsCount: perfAndPay.performance.workHoursGroup.disputedShiftsCount,
            unclosedShiftsCount: perfAndPay.unclosedShiftsCount,
            performance: perfAndPay.performance,
            attendanceLogs: monthLogs.map((l) => ({
              id: l.id,
              date: l.date,
              shiftScheduled: l.shiftScheduled,
              checkIn: l.checkIn,
              checkOut: l.checkOut,
              workHours: l.workHours,
              billableHours: l.billableHours,
              punctualityStatus: l.punctualityStatus,
              lateMinutes: l.lateMinutes,
              earlyMinutes: l.earlyMinutes,
              verificationStatus: l.verificationStatus,
            })),
            formulaDetail: `Lương theo giờ = (5.000.000 / 180) × ${perfAndPay.validWorkHours}h = ${perfAndPay.hourlySalary.toLocaleString('vi-VN')}đ | Thưởng BMB: +${perfAndPay.bmbBonus.toLocaleString('vi-VN')}đ | Tổng lương = ${perfAndPay.totalSalary.toLocaleString('vi-VN')}đ`,
          };
        })
      );

      const totalPayout = payrollList.reduce((sum, p) => sum + p.totalSalary, 0);
      const allReconciles = await getReconcileRequests();
      const monthReconciles = allReconciles.filter((r) => r.month === targetMonth);

      res.status(200).json({
        success: true,
        month: targetMonth,
        isLocked,
        baseSalaryFixed: FIXED_MONTHLY_BASE_SALARY,
        standardMonthlyHoursFixed: FIXED_STANDARD_MONTHLY_HOURS,
        hourlyRateFixed: Math.round(FIXED_HOURLY_RATE * 100) / 100,
        config: {
          ...cfg,
          baseSalaryDefault: FIXED_MONTHLY_BASE_SALARY,
          standardMonthlyHours: FIXED_STANDARD_MONTHLY_HOURS,
          hourlyRateDefault: Math.round(FIXED_HOURLY_RATE),
        },
        totalPayout,
        payrolls: payrollList,
        reconcileRequests: monthReconciles,
      });
    } catch (error) {
      console.error('Lỗi khi tính bảng lương BMB:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tính bảng lương.' });
    }
  }
);

// PATCH /api/payroll/admin/bonus - BMB nhập và lưu tiền thưởng thủ công cho từng KTV theo tháng
router.patch(
  '/admin/bonus',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { techId, month, bonusAmount, note } = req.body || {};

      if (!techId || typeof techId !== 'string' || !techId.trim()) {
        res.status(400).json({ success: false, message: 'Thiếu mã kỹ thuật viên (techId).' });
        return;
      }

      const targetMonth =
        typeof month === 'string' && /^\d{4}-\d{2}$/.test(month.trim())
          ? month.trim()
          : new Date().toISOString().slice(0, 7);

      const parsedBonus = Number(bonusAmount);
      if (bonusAmount === undefined || bonusAmount === null || bonusAmount === '' || isNaN(parsedBonus) || !isFinite(parsedBonus)) {
        res.status(400).json({
          success: false,
          message: 'Tiền thưởng không hợp lệ. Vui lòng nhập số tiền hợp lệ (>= 0 VNĐ).',
        });
        return;
      }
      if (parsedBonus < 0) {
        res.status(400).json({
          success: false,
          message: 'Tiền thưởng không được là số âm.',
        });
        return;
      }
      if (parsedBonus > 100_000_000) {
        res.status(400).json({
          success: false,
          message: 'Tiền thưởng vượt quá hạn mức cho phép trong tháng (tối đa 100.000.000 VNĐ).',
        });
        return;
      }

      const lock = await prisma.monthlyPayrollLock.findUnique({ where: { month: targetMonth } });
      if (lock) {
        res.status(403).json({
          success: false,
          message: `Bảng lương tháng ${targetMonth} đã được khóa sổ. Không thể chỉnh sửa tiền thưởng.`,
        });
        return;
      }

      const tech = await prisma.user.findFirst({
        where: { id: techId.trim(), role: Role.TECHNICIAN },
        select: { id: true, fullName: true },
      });
      if (!tech) {
        res.status(404).json({ success: false, message: 'Không tìm thấy kỹ thuật viên.' });
        return;
      }

      const cleanBonus = Math.round(parsedBonus);
      const cleanNote = typeof note === 'string' && note.trim()
        ? note.trim()
        : cleanBonus > 0
        ? 'Thưởng hiệu suất làm việc trong tháng do BMB xét duyệt'
        : 'Đặt lại mức thưởng 0 VNĐ';

      const nowIso = new Date().toISOString();
      const bmbId = req.user?.userId || 'bmb-admin';
      const bmbName = req.user?.fullName || 'Ban Quản Lý (BMB)';

      const bonusesMap = await getPayrollBonusesMap();
      const existing = bonusesMap[`${targetMonth}__${tech.id}`];
      const history: PayrollBonusHistoryItem[] = Array.isArray(existing?.history) ? [...existing.history] : [];
      history.unshift({
        bonusAmount: cleanBonus,
        note: cleanNote,
        updatedById: bmbId,
        updatedByName: bmbName,
        updatedAt: nowIso,
      });

      const updatedRecord: PayrollBonusRecord = {
        techId: tech.id,
        month: targetMonth,
        bonusAmount: cleanBonus,
        note: cleanNote,
        updatedById: bmbId,
        updatedByName: bmbName,
        updatedAt: nowIso,
        history: history.slice(0, 25),
      };

      await savePayrollBonusRecord(updatedRecord);

      console.log(
        `[AUDIT_BONUS] BMB (${bmbName}) đã cập nhật tiền thưởng tháng ${targetMonth} cho KTV ${tech.fullName}: ${cleanBonus.toLocaleString('vi-VN')} VNĐ. Ghi chú: ${cleanNote}`
      );

      res.status(200).json({
        success: true,
        message: `Đã lưu tiền thưởng ${cleanBonus.toLocaleString('vi-VN')} VNĐ cho KTV ${tech.fullName} (Tháng ${targetMonth}).`,
        bonusRecord: updatedRecord,
      });
    } catch (error) {
      console.error('Lỗi khi lưu tiền thưởng KTV:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lưu tiền thưởng.' });
    }
  }
);

// POST /api/payroll/admin/lock-month - BMB khóa bảng lương tháng (Audit log)
router.post(
  '/admin/lock-month',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { month } = req.body || {};
      const targetMonth = typeof month === 'string' && month ? month : new Date().toISOString().slice(0, 7);

      const existing = await prisma.monthlyPayrollLock.findUnique({
        where: { month: targetMonth },
      });
      if (existing) {
        res.status(409).json({ success: false, message: `Bảng lương tháng ${targetMonth} đã được khóa trước đó!` });
        return;
      }

      await prisma.monthlyPayrollLock.create({
        data: {
          month: targetMonth,
          totalPayout: BigInt(0),
          lockedById: req.user!.userId,
          lockedByName: req.user?.fullName || 'BMB Admin',
          auditNote: `BMB (${req.user?.fullName}) đã KHÓA BẢNG LƯƠNG tháng ${targetMonth}`,
        },
      });

      console.log(`[AUDIT_LOG] BMB (${req.user?.fullName}) đã KHÓA BẢNG LƯƠNG tháng ${targetMonth} lúc ${new Date().toISOString()}`);

      res.status(200).json({
        success: true,
        message: `Đã khóa bảng lương tháng ${targetMonth} thành công. Mọi điều chỉnh từ nay được ghi nhận vào kỳ kế tiếp.`,
      });
    } catch (error) {
      console.error('Lỗi khi khóa bảng lương:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi khóa bảng lương.' });
    }
  }
);

// PATCH /api/payroll/admin/config - BMB cấu hình mức lương & hệ số tăng ca
router.patch(
  '/admin/config',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { baseSalaryDefault, standardMonthlyHours, otMultiplierNormal, otMultiplierWeekend, standardAllowance } = req.body || {};
      const cfg = await getPayrollConfig();

      if (typeof baseSalaryDefault === 'number' && baseSalaryDefault > 0) {
        cfg.baseSalaryDefault = baseSalaryDefault;
      }
      if (typeof standardMonthlyHours === 'number' && standardMonthlyHours > 0) {
        cfg.standardMonthlyHours = standardMonthlyHours;
      }
      if (typeof otMultiplierNormal === 'number' && otMultiplierNormal > 0) {
        cfg.otMultiplierNormal = otMultiplierNormal;
      }
      if (typeof otMultiplierWeekend === 'number' && otMultiplierWeekend > 0) {
        cfg.otMultiplierWeekend = otMultiplierWeekend;
      }
      if (typeof standardAllowance === 'number' && standardAllowance >= 0) {
        cfg.standardAllowance = standardAllowance;
      }

      await prisma.systemSetting.upsert({
        where: { key: 'payroll_config' },
        create: { key: 'payroll_config', value: cfg as any },
        update: { value: cfg as any },
      });

      console.log(`[AUDIT] BMB (${req.user?.fullName}) đã cập nhật cấu hình lương:`, cfg);

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật cấu hình lương và quy tắc tăng ca thành công.',
        config: cfg,
      });
    } catch (error) {
      console.error('Lỗi cập nhật cấu hình lương:', error);
      res.status(500).json({ success: false, message: 'Không thể cập nhật cấu hình lương.' });
    }
  }
);

export default router;
