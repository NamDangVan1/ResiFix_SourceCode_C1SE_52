import { IncidentCategory, PriorityLevel, Role, TicketStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { calculateDistanceMeters, resiFixStore } from '../data/resifix_store';

// ============================================================================
// HẰNG SỐ CẤU HÌNH GỢI Ý KỸ THUẬT VIÊN
// ============================================================================
export const TECHNICIAN_LOCATION_MAX_AGE_MS = 60 * 60 * 1000; // 60 phút (3,600,000 ms)
export const MAX_TECHNICIAN_SUGGESTIONS = 3;

export class RouteError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'RouteError';
  }
}

export const TECHNICIAN_SPECIALTY_LABELS: Record<IncidentCategory, string> = {
  [IncidentCategory.PLUMBING]: 'Điện - Nước',
  [IncidentCategory.ELECTRICAL]: 'Điện & Chiếu sáng',
  [IncidentCategory.ELEVATOR]: 'Thang máy & Cơ khí',
  [IncidentCategory.HVAC]: 'Điều hòa & Thông gió',
  [IncidentCategory.ACCESS_SECURITY]: 'Điện tử & An ninh',
  [IncidentCategory.OTHER]: 'Khác',
};

export const isIncidentCategory = (value: unknown): value is IncidentCategory =>
  typeof value === 'string' && Object.values(IncidentCategory).includes(value as IncidentCategory);

export const isPriorityLevel = (value: unknown): value is PriorityLevel =>
  typeof value === 'string' && Object.values(PriorityLevel).includes(value as PriorityLevel);

/**
 * Kiểm tra xem thời điểm đối soát có nằm trong khung giờ ca trực hay không (Asia/Ho_Chi_Minh).
 * Cho phép truyền refDate để kiểm thử giả lập thời gian.
 */
export const isCurrentlyInShift = (shiftName?: string | null, refDate: Date = new Date()): boolean => {
  if (!shiftName) return false;
  const match = shiftName.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  if (!match) return false;

  const startHour = parseInt(match[1], 10);
  const startMin = parseInt(match[2], 10);
  const endHour = parseInt(match[3], 10);
  const endMin = parseInt(match[4], 10);

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  const vnTimeStr = refDate.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const [currH, currM] = vnTimeStr.split(':').map(Number);
  const currentMinutes = currH * 60 + currM;

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
  if (startMinutes > endMinutes) {
    // Ca trực đêm qua ngày (ví dụ 22:00 - 06:00)
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
  return false;
};

export async function isTechOnApprovedLeaveDb(techId: string, date: string): Promise<boolean> {
  try {
    const leave = await prisma.shiftScheduleRequest.findFirst({
      where: {
        techId,
        type: 'LEAVE',
        status: 'APPROVED',
        date: { lte: date },
        OR: [{ endDate: null, date }, { endDate: { gte: date } }],
      },
      select: { id: true },
    });
    return Boolean(leave);
  } catch {
    return false;
  }
}

// ============================================================================
// DTO & INTERFACES
// ============================================================================
export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface SuggestedTechnicianDto {
  id: string;
  fullName: string;
  specialty: IncidentCategory;
  specialtyLabel: string;
  shiftName: string | null;
  isOnDuty: boolean;
  activeTicketsCount: number;
  hasFreshLocation: boolean;
  estimatedDistanceMeters: number | null;
  reason: string;
}

export interface SuggestionResult {
  success: boolean;
  category: IncidentCategory | null;
  suggestedTechnicians: SuggestedTechnicianDto[];
  message?: string;
}

export interface CandidateTechnician {
  id: string;
  fullName: string;
  specialty: IncidentCategory | null;
  specialtyLabel?: string | null;
  shiftName?: string | null;
  isOnDuty: boolean;
  isActive: boolean;
  activeTicketsCount: number;
}

// ============================================================================
// REGISTRY TỌA ĐỘ VỊ TRÍ (IN-MEMORY & PERSISTENT FALLBACK)
// ============================================================================
const technicianLocationRegistry = new Map<
  string,
  { latitude: number; longitude: number; recordedAt: Date }
>();
const areaCoordinatesRegistry = new Map<string, GeoCoordinates>();
const ticketCoordinatesRegistry = new Map<string, GeoCoordinates>();

export const DEFAULT_AREA_COORDINATES: Record<string, GeoCoordinates> = {
  'AREA-SANH-T1': { latitude: 16.0492916, longitude: 108.1600966 },
  'AC-B02': { latitude: 16.0492916, longitude: 108.1600966 },
  'ELV-02': { latitude: 16.04935, longitude: 108.16015 },
  'HL-B12': { latitude: 16.0494, longitude: 108.1602 },
  'AREA-HL-B': { latitude: 16.0494, longitude: 108.1602 },
  'PK-B1-02': { latitude: 16.04915, longitude: 108.15995 },
  'AREA-HAM-B1': { latitude: 16.04915, longitude: 108.15995 },
  'WP-1204': { latitude: 16.0493, longitude: 108.1601 },
  'AREA-CH-A1204': { latitude: 16.0493, longitude: 108.1601 },
};

// Khởi tạo tọa độ khu vực mặc định
for (const [code, coords] of Object.entries(DEFAULT_AREA_COORDINATES)) {
  areaCoordinatesRegistry.set(code, coords);
}

export function recordTechnicianLocation(
  techId: string,
  coords: GeoCoordinates,
  recordedAt: Date = new Date()
): void {
  technicianLocationRegistry.set(techId, {
    latitude: coords.latitude,
    longitude: coords.longitude,
    recordedAt,
  });
}

export function clearTechnicianLocations(): void {
  technicianLocationRegistry.clear();
}

export function recordAreaCoordinates(qrCode: string, coords: GeoCoordinates | null): void {
  const clean = qrCode.trim().toUpperCase();
  if (coords) {
    areaCoordinatesRegistry.set(clean, coords);
  } else {
    areaCoordinatesRegistry.delete(clean);
  }
}

export function clearAreaCoordinates(): void {
  areaCoordinatesRegistry.clear();
}

export function resetDefaultAreaCoordinates(): void {
  areaCoordinatesRegistry.clear();
  for (const [code, coords] of Object.entries(DEFAULT_AREA_COORDINATES)) {
    areaCoordinatesRegistry.set(code, coords);
  }
}

export function recordTicketCoordinates(ticketId: string, coords: GeoCoordinates): void {
  ticketCoordinatesRegistry.set(ticketId, coords);
}

export function clearTicketCoordinates(): void {
  ticketCoordinatesRegistry.clear();
}

/**
 * Định dạng khoảng cách ước tính thân thiện với người dùng (ví dụ "khoảng 120 m" hoặc "khoảng 1.2 km")
 */
export function formatEstimatedDistance(distanceMeters: number): string {
  const rounded = Math.round(distanceMeters);
  if (rounded < 1000) {
    return `khoảng ${rounded} m`;
  }
  return `khoảng ${(rounded / 1000).toFixed(1)} km`;
}

/**
 * Lấy vị trí hợp lệ gần nhất của kỹ thuật viên từ registry hoặc attendanceLog check-in
 */
export function getTechnicianLatestLocation(
  techId: string,
  now: Date = new Date()
): { latitude: number; longitude: number; recordedAt: Date } | null {
  const recorded = technicianLocationRegistry.get(techId);
  if (recorded) return recorded;

  try {
    const store = resiFixStore?.get();
    const storeLogs = store?.attendanceLogs || [];
    const active = storeLogs.find(
      (a) => a.techId === techId && !a.checkOut && a.checkInGps
    );
    if (
      active &&
      active.checkInGps &&
      typeof active.checkInGps.latitude === 'number' &&
      typeof active.checkInGps.longitude === 'number' &&
      !isNaN(active.checkInGps.latitude) &&
      !isNaN(active.checkInGps.longitude)
    ) {
      return {
        latitude: active.checkInGps.latitude,
        longitude: active.checkInGps.longitude,
        recordedAt: new Date(active.checkIn || now),
      };
    }
  } catch {
    // Dự phòng khi không có store
  }

  return null;
}

/**
 * Lấy tọa độ nơi xảy ra sự cố (từ ticket verified GPS hoặc khu vực QR)
 */
export function getIncidentCoordinates(ticket: {
  id: string;
  areaId?: string | null;
  area?: { qrCode?: string | null } | null;
}): GeoCoordinates | null {
  const ticketCoords = ticketCoordinatesRegistry.get(ticket.id);
  if (ticketCoords) return ticketCoords;

  if (ticket.area?.qrCode) {
    const cleanQr = ticket.area.qrCode.trim().toUpperCase();
    const areaCoords = areaCoordinatesRegistry.get(cleanQr);
    if (areaCoords) return areaCoords;
  }

  return null;
}

/**
 * Kiểm tra điều kiện làm việc của kỹ thuật viên
 */
export function evaluateTechnicianEligibility(
  tech: {
    id: string;
    isActive: boolean;
    isOnDuty: boolean;
    shiftName?: string | null;
  },
  todayLogs: Array<{ technicianId: string; checkOut?: Date | string | null }>,
  approvedLeaveTechIds: Set<string>,
  refDate: Date = new Date()
): boolean {
  if (!tech.isActive) return false;
  if (!tech.isOnDuty) return false;
  if (!isCurrentlyInShift(tech.shiftName, refDate)) return false;
  if (approvedLeaveTechIds.has(tech.id)) return false;

  const techLogs = todayLogs.filter((a) => a.technicianId === tech.id);
  const activeAttendance = techLogs.find((a) => !a.checkOut);
  if (!activeAttendance) return false;

  return true;
}

/**
 * Lọc và xếp hạng danh sách KTV đủ chuyên môn theo khoảng cách và khối lượng công việc
 */
export function rankEligibleTechnicians(
  eligibleCandidates: CandidateTechnician[],
  category: IncidentCategory,
  incidentCoords: GeoCoordinates | null,
  now: Date = new Date()
): SuggestedTechnicianDto[] {
  const specialtyLabel = TECHNICIAN_SPECIALTY_LABELS[category] || 'Khác';

  const evaluated = eligibleCandidates.map((tech) => {
    const techLoc = getTechnicianLatestLocation(tech.id, now);
    let hasFreshLocation = false;
    let estimatedDistanceMeters: number | null = null;
    let reason = '';

    if (techLoc) {
      const ageMs = now.getTime() - techLoc.recordedAt.getTime();
      // Vị trí hợp lệ: trong ngưỡng độ mới và không bị lệch thời gian tương lai quá mức
      if (ageMs >= 0 && ageMs <= TECHNICIAN_LOCATION_MAX_AGE_MS) {
        if (incidentCoords) {
          const dist = Math.round(
            calculateDistanceMeters(
              incidentCoords.latitude,
              incidentCoords.longitude,
              techLoc.latitude,
              techLoc.longitude
            )
          );
          hasFreshLocation = true;
          estimatedDistanceMeters = dist;
          reason = `Chuyên môn ${tech.specialtyLabel || specialtyLabel} · cách khu vực sự cố ${formatEstimatedDistance(dist)}`;
        }
      }
    }

    if (!hasFreshLocation) {
      reason = `Chuyên môn ${tech.specialtyLabel || specialtyLabel} · Chưa có vị trí cập nhật`;
    }

    return {
      id: tech.id,
      fullName: tech.fullName,
      specialty: category,
      specialtyLabel: tech.specialtyLabel || specialtyLabel,
      shiftName: tech.shiftName || null,
      isOnDuty: tech.isOnDuty,
      activeTicketsCount: tech.activeTicketsCount,
      hasFreshLocation,
      estimatedDistanceMeters,
      reason,
    };
  });

  // Quy tắc xếp hạng:
  // 1. KTV có vị trí mới và gần hơn đứng trước
  // 2. KTV không có vị trí mới xếp sau, được xếp theo số công việc đang xử lý (ít việc hơn đứng trước)
  // 3. Tiêu chí phụ khi hòa: số công việc đang xử lý, rồi theo tên bảng chữ cái
  evaluated.sort((a, b) => {
    if (a.hasFreshLocation && b.hasFreshLocation) {
      if (a.estimatedDistanceMeters !== b.estimatedDistanceMeters) {
        return (a.estimatedDistanceMeters ?? 0) - (b.estimatedDistanceMeters ?? 0);
      }
    } else if (a.hasFreshLocation && !b.hasFreshLocation) {
      return -1;
    } else if (!a.hasFreshLocation && b.hasFreshLocation) {
      return 1;
    }

    if (a.activeTicketsCount !== b.activeTicketsCount) {
      return a.activeTicketsCount - b.activeTicketsCount;
    }

    return a.fullName.localeCompare(b.fullName, 'vi');
  });

  return evaluated.slice(0, MAX_TECHNICIAN_SUGGESTIONS);
}

/**
 * Service chính: Lấy danh sách KTV gợi ý cho một phiếu sự cố
 */
export async function suggestTechniciansForTicket(
  ticketId: string,
  categoryOverride?: IncidentCategory | null,
  refDate: Date = new Date(),
  db: any = prisma
): Promise<SuggestionResult> {
  const ticket = await db.incidentTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      ticketCode: true,
      finalCategory: true,
      aiSuggestedCategory: true,
      locationVerificationStatus: true,
      areaId: true,
      area: {
        select: {
          id: true,
          qrCode: true,
          areaName: true,
          locationLabel: true,
        },
      },
    },
  });

  if (!ticket) {
    throw new RouteError(404, 'Không tìm thấy phiếu sự cố!');
  }

  // 1. Xác định danh mục áp dụng: BMB chọn > finalCategory > aiSuggestedCategory
  let effectiveCategory: IncidentCategory | null = null;
  if (categoryOverride && isIncidentCategory(categoryOverride)) {
    effectiveCategory = categoryOverride;
  } else if (ticket.finalCategory && isIncidentCategory(ticket.finalCategory)) {
    effectiveCategory = ticket.finalCategory;
  } else if (ticket.aiSuggestedCategory && isIncidentCategory(ticket.aiSuggestedCategory)) {
    effectiveCategory = ticket.aiSuggestedCategory;
  }

  if (!effectiveCategory) {
    return {
      success: true,
      category: null,
      suggestedTechnicians: [],
      message: 'Chọn danh mục để xem gợi ý kỹ thuật viên',
    };
  }

  // 2. Lấy danh sách kỹ thuật viên đang hoạt động có chuyên môn phù hợp
  const technicians = await db.user.findMany({
    where: {
      role: Role.TECHNICIAN,
      isActive: true,
      specialty: effectiveCategory,
    },
    select: {
      id: true,
      fullName: true,
      specialty: true,
      specialtyLabel: true,
      shiftName: true,
      isOnDuty: true,
      isActive: true,
      assignedTickets: {
        where: { status: { in: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS] } },
        select: { id: true },
      },
    },
  });

  if (technicians.length === 0) {
    return {
      success: true,
      category: effectiveCategory,
      suggestedTechnicians: [],
      message: 'Không có kỹ thuật viên phù hợp với chuyên môn này đang trong ca trực.',
    };
  }

  // 3. Kiểm tra điều kiện nghiệp vụ: ca trực, chấm công, nghỉ phép
  const todayVn = refDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const [todayLogs, approvedLeaves] = await Promise.all([
    db.attendanceLog.findMany({ where: { date: todayVn } }),
    db.shiftScheduleRequest.findMany({
      where: {
        type: 'LEAVE',
        status: 'APPROVED',
        date: { lte: todayVn },
        OR: [{ endDate: null, date: todayVn }, { endDate: { gte: todayVn } }],
      },
      select: { techId: true },
    }),
  ]);
  const approvedLeaveTechIds = new Set<string>(approvedLeaves.map((l: any) => String(l.techId)));

  const eligibleCandidates: CandidateTechnician[] = (technicians as any[])
    .filter((tech: any) =>
      evaluateTechnicianEligibility(
        {
          id: tech.id,
          isActive: tech.isActive,
          isOnDuty: tech.isOnDuty,
          shiftName: tech.shiftName,
        },
        todayLogs,
        approvedLeaveTechIds,
        refDate
      )
    )
    .map((tech: any) => ({
      id: tech.id,
      fullName: tech.fullName,
      specialty: tech.specialty,
      specialtyLabel: tech.specialtyLabel,
      shiftName: tech.shiftName,
      isOnDuty: tech.isOnDuty,
      isActive: tech.isActive,
      activeTicketsCount: Array.isArray(tech.assignedTickets) ? tech.assignedTickets.length : 0,
    }));

  if (eligibleCandidates.length === 0) {
    return {
      success: true,
      category: effectiveCategory,
      suggestedTechnicians: [],
      message: 'Không có kỹ thuật viên phù hợp với chuyên môn này đang trong ca trực.',
    };
  }

  // 4. Lấy tọa độ sự cố
  const incidentCoords = getIncidentCoordinates(ticket);

  // 5. Xếp hạng và trả tối đa 3 gợi ý
  const suggestedTechnicians = rankEligibleTechnicians(
    eligibleCandidates,
    effectiveCategory,
    incidentCoords,
    refDate
  );

  return {
    success: true,
    category: effectiveCategory,
    suggestedTechnicians,
  };
}
