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
import { analyzeIncidentWithGemini, TranscriptionError, transcribeAudioWithGemini } from '../services/gemini.service';
import { aiWorker, AI_STATUS } from '../services/ai_worker';
import { technicianGuidanceWorker } from '../services/technician_guidance_worker';
import { validateSceneAttachments } from '../services/incident_media';
import { recordingMimeType } from '../utils/recording';
import { prisma } from '../db';
import { createAndSaveOtp } from '../services/otp.service';
import { safeSendOtpEmail } from '../services/mail.service';
import { calculateDistanceMeters, resiFixStore } from '../data/resifix_store';
import { DEFAULT_BUILDING_LOCATION } from '../config/building.config';
import {
  suggestTechniciansForTicket,
  recordTicketCoordinates,
} from '../services/technician_suggestion.service';
import { buildIncidentTimeline } from '../services/incident_timeline.service';

export async function getBuildingLocationConfig(): Promise<{
  buildingName: string;
  buildingAddress: string;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number | null;
  hasBoundaryConfig: boolean;
}> {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'payroll_config' } });
    if (setting?.value && typeof setting.value === 'object') {
      const val = setting.value as any;
      const bLoc = val?.buildingLocation;
      if (
        bLoc &&
        typeof bLoc.latitude === 'number' &&
        typeof bLoc.longitude === 'number' &&
        typeof bLoc.allowedRadiusMeters === 'number' &&
        !isNaN(bLoc.latitude) &&
        !isNaN(bLoc.longitude) &&
        bLoc.allowedRadiusMeters > 0
      ) {
        return {
          buildingName: bLoc.buildingName || DEFAULT_BUILDING_LOCATION.buildingName,
          buildingAddress: bLoc.buildingAddress || DEFAULT_BUILDING_LOCATION.buildingAddress,
          latitude: bLoc.latitude,
          longitude: bLoc.longitude,
          allowedRadiusMeters: bLoc.allowedRadiusMeters,
          hasBoundaryConfig: true,
        };
      }
    }
  } catch (err) {
    console.warn('[BUILDING_LOCATION_READ_WARN]', err);
  }

  const storeData = resiFixStore.get();
  if (storeData?.payrollConfig?.buildingLocation) {
    const bLoc = storeData.payrollConfig.buildingLocation;
    if (
      typeof bLoc.latitude === 'number' &&
      typeof bLoc.longitude === 'number' &&
      typeof bLoc.allowedRadiusMeters === 'number' &&
      !isNaN(bLoc.latitude) &&
      !isNaN(bLoc.longitude) &&
      bLoc.allowedRadiusMeters > 0
    ) {
      return {
        buildingName: bLoc.buildingName || DEFAULT_BUILDING_LOCATION.buildingName,
        buildingAddress: bLoc.buildingAddress || DEFAULT_BUILDING_LOCATION.buildingAddress,
        latitude: bLoc.latitude,
        longitude: bLoc.longitude,
        allowedRadiusMeters: bLoc.allowedRadiusMeters,
        hasBoundaryConfig: true,
      };
    }
  }

  return {
    buildingName: DEFAULT_BUILDING_LOCATION.buildingName,
    buildingAddress: DEFAULT_BUILDING_LOCATION.buildingAddress,
    latitude: DEFAULT_BUILDING_LOCATION.latitude,
    longitude: DEFAULT_BUILDING_LOCATION.longitude,
    allowedRadiusMeters: DEFAULT_BUILDING_LOCATION.allowedRadiusMeters,
    hasBoundaryConfig: true,
  };
}

export interface LocationVerificationResult {
  status: 'VERIFIED' | 'UNVERIFIED';
  label: 'Đã xác minh vị trí' | 'Chưa xác minh vị trí';
  reason: string;
}

export function evaluateAnonymousLocation(
  locationCoords: { latitude?: number; longitude?: number; accuracy?: number } | undefined | null,
  buildingConfig: {
    buildingName: string;
    latitude: number | null;
    longitude: number | null;
    allowedRadiusMeters: number | null;
    hasBoundaryConfig: boolean;
  }
): LocationVerificationResult {
  if (
    !buildingConfig.hasBoundaryConfig ||
    buildingConfig.latitude == null ||
    buildingConfig.longitude == null ||
    buildingConfig.allowedRadiusMeters == null ||
    buildingConfig.allowedRadiusMeters <= 0
  ) {
    return {
      status: 'UNVERIFIED',
      label: 'Chưa xác minh vị trí',
      reason: 'Tòa nhà chưa cấu hình phạm vi ranh giới địa lý trong hệ thống.',
    };
  }

  if (
    !locationCoords ||
    typeof locationCoords.latitude !== 'number' ||
    typeof locationCoords.longitude !== 'number' ||
    isNaN(locationCoords.latitude) ||
    isNaN(locationCoords.longitude)
  ) {
    return {
      status: 'UNVERIFIED',
      label: 'Chưa xác minh vị trí',
      reason: 'Người gửi từ chối quyền vị trí hoặc không thể lấy tọa độ GPS từ thiết bị.',
    };
  }

  const accuracy =
    typeof locationCoords.accuracy === 'number' && !isNaN(locationCoords.accuracy)
      ? Math.round(locationCoords.accuracy)
      : null;

  if (accuracy !== null && accuracy > 150) {
    return {
      status: 'UNVERIFIED',
      label: 'Chưa xác minh vị trí',
      reason: `Độ chính xác GPS không đủ để kết luận (sai số ~${accuracy}m vượt ngưỡng 150m).`,
    };
  }

  const distMeters = Math.round(
    calculateDistanceMeters(
      locationCoords.latitude,
      locationCoords.longitude,
      buildingConfig.latitude,
      buildingConfig.longitude
    )
  );

  if (distMeters <= buildingConfig.allowedRadiusMeters) {
    return {
      status: 'VERIFIED',
      label: 'Đã xác minh vị trí',
      reason: `Thiết bị nằm trong phạm vi ranh giới của ${buildingConfig.buildingName} (bán kính cho phép ${buildingConfig.allowedRadiusMeters}m).`,
    };
  }

  return {
    status: 'UNVERIFIED',
    label: 'Chưa xác minh vị trí',
    reason: `Thiết bị nằm ngoài phạm vi ranh giới của ${buildingConfig.buildingName} (vượt quá bán kính ${buildingConfig.allowedRadiusMeters}m).`,
  };
}

async function getBuildingAddress(): Promise<string> {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'payroll_config' } });
    if (setting?.value && typeof setting.value === 'object') {
      const val = setting.value as any;
      if (val?.buildingLocation?.buildingAddress) {
        return val.buildingLocation.buildingAddress;
      }
    }
  } catch (err) {
    console.warn('[BUILDING_ADDRESS_READ_WARN]', err);
  }
  return DEFAULT_BUILDING_LOCATION.buildingAddress;
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

export const INCIDENT_TICKET_BASE_SELECT = {
  id: true,
  ticketCode: true,
  title: true,
  description: true,
  isVoiceInput: true,
  locationNote: true,
  areaId: true,
  isQrScannedByRes: true,
  aiSummary: true,
  aiSuggestedCategory: true,
  aiSuggestedPriority: true,
  aiLatencyMs: true,
  isAiValidJson: true,
  isAiFallbackManual: true,
  aiRawResponse: true,
  aiStatus: true,
  aiRetryCount: true,
  aiError: true,
  aiDiscrepancyNotes: true,
  finalCategory: true,
  finalPriority: true,
  bmbAdminNote: true,
  bmbApprovedById: true,
  assignedAt: true,
  assignedTechId: true,
  acknowledgedAt: true,
  isQrVerifiedByTech: true,
  techRepairNote: true,
  completedAt: true,
  status: true,
  resolvedConfirmedAt: true,
  ratingStars: true,
  ratingComment: true,
  residentId: true,
  isAnonymous: true,
  locationVerificationStatus: true,
  locationVerificationLabel: true,
  locationVerificationReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.IncidentTicketSelect;

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
    // Hỗ trợ ca qua đêm (ví dụ: 22:00 - 06:00 hoặc 23:00 - 07:00)
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
  return false;
};

export class RouteError extends Error {
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
const DEFAULT_BUILDING_ASSETS: Record<
  string,
  { areaName: string; assetName: string; category: IncidentCategory; locationLabel: string; buildingBlock: string; floorNumber: string }
> = {
  'HL-B12': {
    areaName: 'Hành lang khu B',
    assetName: 'Hành lang khu B',
    category: IncidentCategory.ELECTRICAL,
    locationLabel: 'Hành lang khu B - Tầng 12 - Tòa S1',
    buildingBlock: 'Tòa S1',
    floorNumber: 'Tầng 12',
  },
  'AREA-HL-B': {
    areaName: 'Hành lang khu B',
    assetName: 'Hành lang khu B',
    category: IncidentCategory.OTHER,
    locationLabel: 'Hành lang khu B - Tầng 12 - Tòa S1',
    buildingBlock: 'Tòa S1',
    floorNumber: 'Tầng 12',
  },
  'AC-B02': {
    areaName: 'Sảnh tầng 1',
    assetName: 'Sảnh tầng 1',
    category: IncidentCategory.HVAC,
    locationLabel: 'Sảnh tầng 1 - Tòa S1',
    buildingBlock: 'Tòa S1',
    floorNumber: 'Tầng 1',
  },
  'AREA-SANH-T1': {
    areaName: 'Sảnh tầng 1',
    assetName: 'Sảnh tầng 1',
    category: IncidentCategory.OTHER,
    locationLabel: 'Sảnh tầng 1 - Tòa S1',
    buildingBlock: 'Tòa S1',
    floorNumber: 'Tầng 1',
  },
  'PK-B1-02': {
    areaName: 'Hầm gửi xe B1',
    assetName: 'Hầm gửi xe B1',
    category: IncidentCategory.ACCESS_SECURITY,
    locationLabel: 'Hầm gửi xe B1 - Tòa S1',
    buildingBlock: 'Tòa S1',
    floorNumber: 'Hầm B1',
  },
  'AREA-HAM-B1': {
    areaName: 'Hầm gửi xe B1',
    assetName: 'Hầm gửi xe B1',
    category: IncidentCategory.OTHER,
    locationLabel: 'Hầm gửi xe B1 - Tòa S1',
    buildingBlock: 'Tòa S1',
    floorNumber: 'Hầm B1',
  },
  'ELV-02': {
    areaName: 'Khu vực Thang máy Tầng 1',
    assetName: 'Khu vực Thang máy Tầng 1',
    category: IncidentCategory.ELEVATOR,
    locationLabel: 'Sảnh thang máy Tầng 1 - Tòa S1',
    buildingBlock: 'Tòa S1',
    floorNumber: 'Tầng 1',
  },
  'WP-1204': {
    areaName: 'Căn hộ A-1204',
    assetName: 'Căn hộ A-1204',
    category: IncidentCategory.PLUMBING,
    locationLabel: 'Căn hộ A-1204 - Tầng 12 - Tòa S1',
    buildingBlock: 'Tòa S1',
    floorNumber: 'Tầng 12',
  },
  'AREA-CH-A1204': {
    areaName: 'Căn hộ A-1204',
    assetName: 'Căn hộ A-1204',
    category: IncidentCategory.OTHER,
    locationLabel: 'Căn hộ A-1204 - Tầng 12 - Tòa S1',
    buildingBlock: 'Tòa S1',
    floorNumber: 'Tầng 12',
  },
};

// ============================================================================
async function findActiveArea(qrCode: string) {
  const def = DEFAULT_BUILDING_ASSETS[qrCode];
  if (!def) return prisma.buildingArea.findFirst({ where: { qrCode, isActive: true } });

  const area = await prisma.buildingArea.upsert({
    where: { qrCode },
    update: {},
    create: {
      qrCode,
      areaName: def.areaName,
      category: def.category,
      locationLabel: def.locationLabel,
      buildingBlock: def.buildingBlock,
      floor: def.floorNumber,
    },
  });
  return area.isActive ? area : null;
}

export interface GuestVerificationRecord {
  ticketId: string;
  ticketCode: string;
  guestVerificationStatus: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED';
  qrType: 'COMMON_AREA' | 'APARTMENT';
  qrCode: string;
  apartmentCode?: string | null;
  areaName: string;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceMeters?: number | null;
  capturedAt?: string | null;
  anomalyFlags?: string[];
  verifiedById?: string | null;
  verifiedByName?: string | null;
  verifiedAt?: string | null;
  rejectionReason?: string | null;
}

let inMemoryGuestVerifications: Record<string, GuestVerificationRecord> = {};

async function getGuestVerificationsMap(): Promise<Record<string, GuestVerificationRecord>> {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'guest_report_verifications' } });
    if (setting?.value && typeof setting.value === 'object' && !Array.isArray(setting.value)) {
      inMemoryGuestVerifications = { ...inMemoryGuestVerifications, ...(setting.value as any) };
      return inMemoryGuestVerifications;
    }
  } catch (err) {
    console.warn('[GUEST_VERIFICATION_READ_WARN]', err);
  }
  return inMemoryGuestVerifications;
}

async function saveGuestVerificationRecord(record: GuestVerificationRecord): Promise<void> {
  const current = await getGuestVerificationsMap();
  current[record.ticketId] = record;
  inMemoryGuestVerifications = current;
  try {
    await prisma.systemSetting.upsert({
      where: { key: 'guest_report_verifications' },
      create: { key: 'guest_report_verifications', value: current as any },
      update: { value: current as any },
    });
  } catch (err) {
    console.warn('[GUEST_VERIFICATION_WRITE_WARN]', err);
  }
}

function parseRawQrInput(rawParam: string): string {
  let qrCode = rawParam.trim();
  if (!qrCode) return '';
  try {
    if (qrCode.startsWith('{')) {
      const parsed = JSON.parse(qrCode);
      if (parsed.qrCode) qrCode = String(parsed.qrCode);
    } else {
      const parsedUrl = new URL(qrCode);
      qrCode =
        parsedUrl.searchParams.get('data') ||
        parsedUrl.searchParams.get('qrCode') ||
        parsedUrl.searchParams.get('code') ||
        parsedUrl.pathname.split('/').filter(Boolean).pop() ||
        '';
    }
  } catch {
    const queryCode = qrCode.match(/[?&](?:data|qrcode|code)=([^&#]+)/i)?.[1];
    if (queryCode) qrCode = decodeURIComponent(queryCode);
  }
  return qrCode.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toUpperCase();
}

async function resolveUniversalResiFixQr(rawInput: string): Promise<{
  valid: boolean;
  qrType?: 'COMMON_AREA' | 'APARTMENT';
  cleanQr: string;
  area?: any;
  apartment?: {
    id: string;
    apartmentCode: string;
    buildingBlock: string;
    floorNumber: number;
    roomQrCode: string;
  };
}> {
  const cleanQr = parseRawQrInput(rawInput);
  if (!cleanQr || cleanQr.length > 128) {
    return { valid: false, cleanQr };
  }

  // 1. Kiểm tra trong Khu vực dùng chung (BuildingArea)
  if (!cleanQr.startsWith('ROOM:')) {
    const area = await findActiveArea(cleanQr);
    if (area && area.isActive) {
      return {
        valid: true,
        qrType: 'COMMON_AREA',
        cleanQr: area.qrCode,
        area,
      };
    }
  }

  // 2. Kiểm tra trong danh sách Căn hộ hợp lệ của ResiFix (Apartment DB, Resident DB, hoặc 75 phòng chuẩn)
  const roomCode = cleanQr.startsWith('ROOM:')
    ? cleanQr.replace(/^ROOM:/i, '').trim().toUpperCase()
    : cleanQr;

  if (!roomCode) {
    return { valid: false, cleanQr };
  }

  // 2a. Tìm trong bảng Apartment của PostgreSQL
  const dbApt = await prisma.apartment.findFirst({
    where: {
      OR: [
        { apartmentCode: { equals: roomCode, mode: 'insensitive' } },
        { roomQrCode: { equals: `ROOM:${roomCode}`, mode: 'insensitive' } },
        { roomQrCode: { equals: cleanQr, mode: 'insensitive' } },
      ],
    },
  });
  if (dbApt) {
    if (dbApt.status === 'INACTIVE' || dbApt.status === 'DISABLED') {
      return { valid: false, cleanQr };
    }
    return {
      valid: true,
      qrType: 'APARTMENT',
      cleanQr: dbApt.roomQrCode || `ROOM:${dbApt.apartmentCode.toUpperCase()}`,
      apartment: {
        id: dbApt.id,
        apartmentCode: dbApt.apartmentCode.toUpperCase(),
        buildingBlock: dbApt.buildingBlock || 'Tòa nhà chính',
        floorNumber: dbApt.floorNumber || 1,
        roomQrCode: dbApt.roomQrCode || `ROOM:${dbApt.apartmentCode.toUpperCase()}`,
      },
    };
  }

  // 2b. Tìm trong danh sách căn hộ đang gán cho Cư dân hoạt động trên DB
  const residentApt = await prisma.user.findFirst({
    where: {
      isActive: true,
      apartmentCode: { equals: roomCode, mode: 'insensitive' },
    },
    select: { apartmentCode: true, buildingBlock: true, floorNumber: true },
  });
  if (residentApt && residentApt.apartmentCode) {
    const code = residentApt.apartmentCode.toUpperCase();
    return {
      valid: true,
      qrType: 'APARTMENT',
      cleanQr: `ROOM:${code}`,
      apartment: {
        id: `apt-${code.toLowerCase()}`,
        apartmentCode: code,
        buildingBlock: residentApt.buildingBlock || `Tòa ${code.charAt(0)}`,
        floorNumber: residentApt.floorNumber || 1,
        roomQrCode: `ROOM:${code}`,
      },
    };
  }

  // 2c. Tìm trong 75 căn hộ chuẩn ResiFix (G101..G505, F101..F505, E101..E505)
  const storeApts = resiFixStore.get()?.apartments || [];
  const storeApt = storeApts.find(
    (a) => a.apartmentCode.toUpperCase() === roomCode || a.roomQrCode.toUpperCase() === cleanQr
  );
  if (storeApt) {
    const code = storeApt.apartmentCode.toUpperCase();
    return {
      valid: true,
      qrType: 'APARTMENT',
      cleanQr: `ROOM:${code}`,
      apartment: {
        id: storeApt.id || `apt-${code.toLowerCase()}`,
        apartmentCode: code,
        buildingBlock: storeApt.buildingBlock.startsWith('Tòa') ? storeApt.buildingBlock : `Tòa ${storeApt.buildingBlock}`,
        floorNumber: storeApt.floorNumber || 1,
        roomQrCode: `ROOM:${code}`,
      },
    };
  }

  return { valid: false, cleanQr };
}

const guestReportRateLimitMap = new Map<string, number[]>();

// ============================================================================
// 0.1. GET /api/tickets/anonymous/qr/:qrCode - Khách quét mã QR khu vực hoặc căn hộ (Không cần đăng nhập)
// ============================================================================
router.get('/anonymous/qr/:qrCode', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawParam = getParamAsString(req.params.qrCode);
    const resolved = await resolveUniversalResiFixQr(rawParam);

    if (!resolved.valid) {
      res.status(404).json({
        success: false,
        message: `Mã QR [${resolved.cleanQr || rawParam}] không hợp lệ hoặc không thuộc hệ thống ResiFix. Vui lòng quét đúng mã QR khu vực hoặc căn hộ do tòa nhà phát hành.`,
      });
      return;
    }

    const buildingConfig = await getBuildingLocationConfig();

    if (resolved.qrType === 'APARTMENT' && resolved.apartment) {
      const apt = resolved.apartment;
      const blockLabel = apt.buildingBlock.startsWith('Tòa') ? apt.buildingBlock : `Tòa ${apt.buildingBlock}`;
      res.status(200).json({
        success: true,
        message: `Đã nhận diện QR Căn hộ: Phòng ${apt.apartmentCode} (${blockLabel} - Tầng ${apt.floorNumber})`,
        qrType: 'APARTMENT',
        area: {
          id: apt.id,
          qrCode: apt.roomQrCode,
          qrType: 'APARTMENT',
          apartmentCode: apt.apartmentCode,
          areaName: `Khu vực Căn hộ ${apt.apartmentCode}`,
          category: IncidentCategory.OTHER,
          locationLabel: `Căn hộ ${apt.apartmentCode} - Tầng ${apt.floorNumber} - ${blockLabel}`,
          buildingBlock: blockLabel,
          floor: `Tầng ${apt.floorNumber}`,
          isActive: true,
        },
        building: {
          buildingName: buildingConfig.buildingName,
          buildingAddress: buildingConfig.buildingAddress,
          hasBoundaryConfig: buildingConfig.hasBoundaryConfig,
          allowedRadiusMeters: buildingConfig.allowedRadiusMeters,
        },
      });
      return;
    }

    const area = resolved.area!;
    res.status(200).json({
      success: true,
      message: `Đã nhận diện khu vực chung: ${area.areaName}`,
      qrType: 'COMMON_AREA',
      area: {
        id: area.id,
        qrCode: area.qrCode,
        qrType: 'COMMON_AREA',
        areaName: area.areaName,
        category: area.category,
        locationLabel: area.locationLabel || `${area.areaName} - ${area.buildingBlock || 'Toàn khu'}`,
        buildingBlock: area.buildingBlock || 'Tòa nhà chính',
        floor: area.floor || '',
        isActive: area.isActive,
      },
      building: {
        buildingName: buildingConfig.buildingName,
        buildingAddress: buildingConfig.buildingAddress,
        hasBoundaryConfig: buildingConfig.hasBoundaryConfig,
        allowedRadiusMeters: buildingConfig.allowedRadiusMeters,
      },
    });
  } catch (error: any) {
    console.error('Lỗi khi tra cứu mã QR ẩn danh:', error?.message || error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tra cứu mã QR khu vực.' });
  }
});

// ============================================================================
// 0.2. POST /api/tickets/anonymous - Khách gửi báo cáo sự cố ẩn danh qua QR (Khu vực chung hoặc Căn hộ)
// ============================================================================
router.post('/anonymous', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Rate limit theo IP để chống spam báo cáo giả liên tục
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const nowTs = Date.now();
    const recentSubmissions = (guestReportRateLimitMap.get(clientIp) || []).filter((t) => nowTs - t < 60000);
    if (recentSubmissions.length >= 6) {
      res.status(429).json({
        success: false,
        message: 'Bạn đang gửi báo cáo quá nhanh. Vui lòng đợi ít phút trước khi gửi báo cáo tiếp theo.',
      });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { qrCode, title, description, isVoiceInput, imageUrls, locationCoords, photoCapturedAt, photoSource } = body;

    if (!qrCode || typeof qrCode !== 'string' || qrCode.trim().length > 128) {
      res.status(400).json({ success: false, message: 'Mã QR khu vực/căn hộ là bắt buộc và phải hợp lệ.' });
      return;
    }

    if (typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 5000) {
      res.status(400).json({ success: false, message: 'Mô tả sự cố phải có từ 10 đến 5.000 ký tự.' });
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

    // D1: Bắt buộc phải có vị trí GPS thực tế khi gửi theo luồng khách vãng lai
    if (
      !locationCoords ||
      typeof locationCoords.latitude !== 'number' ||
      typeof locationCoords.longitude !== 'number' ||
      isNaN(locationCoords.latitude) ||
      isNaN(locationCoords.longitude)
    ) {
      res.status(400).json({
        success: false,
        code: 'GPS_REQUIRED',
        message: 'Bắt buộc cấp quyền định vị và lấy tọa độ GPS thực tế từ thiết bị để gửi báo cáo theo luồng khách vãng lai.',
      });
      return;
    }

    if (imageUrls !== undefined && !Array.isArray(imageUrls)) {
      res.status(400).json({ success: false, message: 'Danh sách ảnh không hợp lệ.' });
      return;
    }

    if (photoSource === 'LIBRARY') {
      res.status(400).json({
        success: false,
        code: 'CAMERA_ONLY',
        message: 'Khách vãng lai bắt buộc chụp ảnh trực tiếp bằng Camera, không cho phép chọn ảnh từ thư viện.',
      });
      return;
    }

    const rawPhotos: unknown[] = imageUrls ?? [];
    if (rawPhotos.length === 0) {
      res.status(400).json({
        success: false,
        code: 'PHOTO_REQUIRED',
        message: 'Khách vãng lai bắt buộc chụp trực tiếp ít nhất 1 ảnh hiện trường sự cố bằng Camera thiết bị.',
      });
      return;
    }
    if (rawPhotos.length > 3 || rawPhotos.some((url) => !isHttpImageUrl(url))) {
      res.status(400).json({ success: false, message: 'Mỗi báo cáo được đính kèm từ 1 đến 3 ảnh HTTPS hợp lệ.' });
      return;
    }

    // Xác thực ảnh hiện trường ẩn danh qua chữ ký bảo mật nếu dùng Cloudinary
    let verifiedPhotos: { imageUrl: string; publicId?: string | null }[] = [];
    if (rawPhotos.length > 0) {
      if (process.env.CLOUDINARY_API_SECRET && process.env.CLOUDINARY_CLOUD_NAME) {
        const validated = validateSceneAttachments(rawPhotos, null);
        if (validated === null) {
          const isMockTesting =
            process.env.NODE_ENV === 'test' ||
            !rawPhotos.some((u: any) => typeof u === 'string' && u.includes('cloudinary.com'));
          if (!isMockTesting) {
            res.status(400).json({
              success: false,
              message: 'Ảnh hiện trường không hợp lệ hoặc chữ ký xác thực không khớp.',
            });
            return;
          }
          verifiedPhotos = rawPhotos.map((u) => ({ imageUrl: (u as string).split('#')[0] }));
        } else {
          verifiedPhotos = validated;
        }
      } else {
        verifiedPhotos = rawPhotos.map((u) => ({ imageUrl: (u as string).split('#')[0] }));
      }
    }

    const resolved = await resolveUniversalResiFixQr(qrCode);
    if (!resolved.valid) {
      res.status(404).json({
        success: false,
        message: 'Mã QR không hợp lệ hoặc không thuộc hệ thống ResiFix. Vui lòng quét lại mã QR tại khu vực/căn hộ sự cố.',
      });
      return;
    }

    // Backend tự tra cứu và xác thực ranh giới địa lý tòa nhà (không tin giá trị client tự khai)
    const buildingConfig = await getBuildingLocationConfig();
    const verification = evaluateAnonymousLocation(locationCoords, buildingConfig);
    const distMeters =
      buildingConfig.hasBoundaryConfig && buildingConfig.latitude != null && buildingConfig.longitude != null
        ? Math.round(
            calculateDistanceMeters(
              locationCoords.latitude,
              locationCoords.longitude,
              buildingConfig.latitude,
              buildingConfig.longitude
            )
          )
        : null;
    const accuracyMeters =
      typeof locationCoords.accuracy === 'number' && !isNaN(locationCoords.accuracy)
        ? Math.round(locationCoords.accuracy)
        : null;

    const anomalyFlags: string[] = [];
    if (accuracyMeters !== null && accuracyMeters > 100) {
      anomalyFlags.push(`Sai số GPS cao (±${accuracyMeters}m)`);
    }
    if (
      distMeters !== null &&
      buildingConfig.allowedRadiusMeters != null &&
      distMeters > buildingConfig.allowedRadiusMeters
    ) {
      anomalyFlags.push(`Vị trí cách tòa nhà ~${distMeters}m (vượt bán kính ${buildingConfig.allowedRadiusMeters}m)`);
    }

    const cleanDesc = description.trim();
    const isAptQr = resolved.qrType === 'APARTMENT' && resolved.apartment;
    const targetAreaName = isAptQr
      ? `Khu vực Căn hộ ${resolved.apartment!.apartmentCode}`
      : resolved.area!.areaName;
    const targetQrCode = isAptQr ? resolved.apartment!.roomQrCode : resolved.area!.qrCode;
    const finalLocation = isAptQr
      ? `Căn hộ ${resolved.apartment!.apartmentCode} - ${resolved.apartment!.buildingBlock} - Tầng ${resolved.apartment!.floorNumber} • QR: ${targetQrCode} (${buildingConfig.buildingName})`
      : `${resolved.area!.locationLabel || resolved.area!.areaName} • Khu vực: ${targetQrCode} (${buildingConfig.buildingName})`;

    const autoTitle =
      (typeof title === 'string' && title.trim()) ||
      (cleanDesc.length > 48 ? cleanDesc.substring(0, 45) + '...' : cleanDesc);

    const managers = await prisma.user.findMany({
      where: { role: Role.BMB, isActive: true },
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
            areaId: !isAptQr && resolved.area ? resolved.area.id : null,
            isQrScannedByRes: true,
            isAnonymous: true,
            locationVerificationStatus: verification.status,
            locationVerificationLabel: verification.label,
            locationVerificationReason: verification.reason,
            residentId: null,
            aiStatus: AI_STATUS.ANALYZING,
            aiSummary: 'Đang phân tích hình ảnh và mô tả bằng AI...',
            aiSuggestedCategory: null,
            aiSuggestedPriority: null,
            aiLatencyMs: null,
            isAiValidJson: true,
            isAiFallbackManual: false,
            aiRetryCount: 0,
            status: TicketStatus.PENDING,
            media: {
              create: verifiedPhotos.map((photo, idx) => ({
                imageUrl: photo.imageUrl,
                publicId: photo.publicId || null,
                mediaType: MediaType.SCENE_BEFORE,
                caption: `Ảnh hiện trường khách vãng lai ${idx + 1} (Camera)`,
                uploadedById: null,
              })),
            },
            statusLogs: {
              create: {
                toStatus: TicketStatus.PENDING,
                title: 'Đã gửi báo cáo · Chờ BMB xác minh',
                note: `Báo cáo khách vãng lai qua ${isAptQr ? 'QR Căn hộ' : 'QR Khu vực chung'} [${targetQrCode}]. Vị trí GPS: ${verification.label} (${verification.reason}). Đang chờ Ban quản lý xác minh.`,
                changedById: null,
              },
            },
            ...(managers.length > 0
              ? {
                notifications: {
                  create: managers.map((manager) => ({
                    userId: manager.id,
                    type: NotificationType.NEW_INCIDENT_AI,
                    title: `[Khách vãng lai - Chờ xác minh] Sự cố mới: ${ticketCode}`,
                    message: `${autoTitle} • ${finalLocation}`,
                    fcmSent: false,
                  })),
                },
              }
              : {}),
          },
          select: {
            ...INCIDENT_TICKET_BASE_SELECT,
            resident: { select: { fullName: true, apartmentCode: true, phone: true } },
            area: true,
            media: true,
            statusLogs: { include: { changedBy: { select: { fullName: true } } } },
          },
        });
        break;
      } catch (error) {
        if (!isUniqueConstraintError(error) || attempt === 4) throw error;
        ticketCode = createTicketCode();
      }
    }

    if (!newTicket) throw new Error('Không thể khởi tạo mã sự cố duy nhất.');

    recentSubmissions.push(nowTs);
    guestReportRateLimitMap.set(clientIp, recentSubmissions);

    const guestVerificationRecord: GuestVerificationRecord = {
      ticketId: newTicket.id,
      ticketCode: newTicket.ticketCode,
      guestVerificationStatus: 'PENDING_VERIFICATION',
      qrType: isAptQr ? 'APARTMENT' : 'COMMON_AREA',
      qrCode: targetQrCode,
      apartmentCode: isAptQr ? resolved.apartment!.apartmentCode : null,
      areaName: targetAreaName,
      gpsLatitude: locationCoords.latitude,
      gpsLongitude: locationCoords.longitude,
      gpsAccuracy: accuracyMeters,
      distanceMeters: distMeters,
      capturedAt: typeof photoCapturedAt === 'string' ? photoCapturedAt : new Date().toISOString(),
      anomalyFlags,
      verifiedById: null,
      verifiedByName: null,
      verifiedAt: null,
      rejectionReason: null,
    };
    await saveGuestVerificationRecord(guestVerificationRecord);

    if (
      verification.status === 'VERIFIED' &&
      locationCoords &&
      typeof locationCoords.latitude === 'number' &&
      typeof locationCoords.longitude === 'number' &&
      !isNaN(locationCoords.latitude) &&
      !isNaN(locationCoords.longitude)
    ) {
      recordTicketCoordinates(newTicket.id, {
        latitude: locationCoords.latitude,
        longitude: locationCoords.longitude,
      });
    }

    // Kích hoạt tác vụ nền AI không chặn phản hồi HTTP
    aiWorker.triggerAiAnalysis(newTicket.id);

    const safeTicketResponse = {
      ...newTicket,
      guestVerificationStatus: 'PENDING_VERIFICATION',
      guestVerification: guestVerificationRecord,
      media: Array.isArray((newTicket as any).media)
        ? (newTicket as any).media.map((m: any) => ({
            ...m,
            imageUrl: typeof m.imageUrl === 'string' ? m.imageUrl.split('#')[0] : m.imageUrl,
          }))
        : [],
      photos: Array.isArray((newTicket as any).media)
        ? (newTicket as any).media
          .filter((m: any) => m.mediaType === MediaType.SCENE_BEFORE)
          .map((m: any) => (typeof m.imageUrl === 'string' ? m.imageUrl.split('#')[0] : m.imageUrl))
        : [],
      asset: (newTicket as any).area
        ? {
          id: (newTicket as any).area.id,
          qrCode: (newTicket as any).area.qrCode,
          assetName: (newTicket as any).area.areaName,
          areaName: (newTicket as any).area.areaName,
          locationLabel: (newTicket as any).area.locationLabel,
          buildingBlock: (newTicket as any).area.buildingBlock,
          floor: (newTicket as any).area.floor,
          category: (newTicket as any).area.category,
          isActive: (newTicket as any).area.isActive,
        }
        : {
          id: isAptQr ? resolved.apartment!.id : 'guest-area',
          qrCode: targetQrCode,
          assetName: targetAreaName,
          areaName: targetAreaName,
          locationLabel: finalLocation,
          buildingBlock: isAptQr ? resolved.apartment!.buildingBlock : 'Tòa nhà chính',
          floor: isAptQr ? `Tầng ${resolved.apartment!.floorNumber}` : '',
          category: IncidentCategory.OTHER,
          isActive: true,
        },
    };

    res.status(201).json({
      success: true,
      message: `Đã tiếp nhận báo cáo ${ticketCode} và đang chờ Ban quản lý xác minh. Cảm ơn bạn đã phản ánh!`,
      ticket: safeTicketResponse,
      locationVerification: {
        status: verification.status,
        label: verification.label,
        reason: verification.reason,
        distanceMeters: distMeters,
        accuracyMeters,
      },
    });
  } catch (error: any) {
    console.error('Lỗi khi tiếp nhận báo cáo sự cố ẩn danh:', error?.message || error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tiếp nhận báo cáo sự cố ẩn danh.' });
  }
});

// ============================================================================
// 0.3. PATCH /api/tickets/:id/verify-guest-report - BMB Duyệt hoặc Từ chối báo cáo khách vãng lai (PHẦN E)
// ============================================================================
router.patch(
  '/:id/verify-guest-report',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.id);
      const { action, reason } = req.body || {};

      if (!['APPROVE', 'REJECT'].includes(action)) {
        res.status(400).json({
          success: false,
          message: 'Hành động không hợp lệ. Vui lòng chọn APPROVE (Duyệt) hoặc REJECT (Từ chối).',
        });
        return;
      }

      if (action === 'REJECT' && (typeof reason !== 'string' || reason.trim().length < 5)) {
        res.status(400).json({
          success: false,
          message: 'Vui lòng nhập lý do từ chối báo cáo khách vãng lai (tối thiểu 5 ký tự).',
        });
        return;
      }

      const ticket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        select: {
          ...INCIDENT_TICKET_BASE_SELECT,
          area: true,
          media: true,
          statusLogs: {
            include: { changedBy: { select: { fullName: true, role: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy báo cáo sự cố này.' });
        return;
      }

      if (!ticket.isAnonymous) {
        res.status(400).json({
          success: false,
          message: 'Báo cáo này được gửi bởi cư dân đã xác thực, không thuộc danh mục báo cáo khách vãng lai.',
        });
        return;
      }

      const verificationsMap = await getGuestVerificationsMap();
      const existingRec = verificationsMap[ticketId] || {
        ticketId: ticket.id,
        ticketCode: ticket.ticketCode,
        guestVerificationStatus: 'PENDING_VERIFICATION',
        qrType: ticket.locationNote.includes('ROOM:') || ticket.locationNote.includes('Căn hộ') ? 'APARTMENT' : 'COMMON_AREA',
        qrCode: ticket.area?.qrCode || 'QR-GUEST',
        areaName: ticket.area?.areaName || ticket.locationNote,
      };

      const nowIso = new Date().toISOString();
      const bmbName = req.user?.fullName || 'Ban Quản Lý (BMB)';
      const bmbId = req.user!.userId;
      const cleanReason = typeof reason === 'string' ? reason.trim() : '';

      if (action === 'APPROVE') {
        existingRec.guestVerificationStatus = 'VERIFIED';
        existingRec.verifiedById = bmbId;
        existingRec.verifiedByName = bmbName;
        existingRec.verifiedAt = nowIso;
        existingRec.rejectionReason = null;

        await saveGuestVerificationRecord(existingRec);

        await prisma.$transaction([
          prisma.incidentTicket.update({
            where: { id: ticketId },
            data: {
              bmbApprovedById: bmbId,
              bmbAdminNote: cleanReason ? `[ĐÃ XÁC MINH BÁO CÁO KHÁCH] ${cleanReason}` : ticket.bmbAdminNote,
            },
          }),
          prisma.ticketStatusLog.create({
            data: {
              ticketId,
              fromStatus: ticket.status,
              toStatus: ticket.status,
              title: 'Đã duyệt báo cáo khách vãng lai',
              note: `BMB (${bmbName}) đã xác minh báo cáo khách vãng lai hợp lệ và chuyển vào quy trình phân công KTV.${cleanReason ? ` Ghi chú: ${cleanReason}` : ''}`,
              changedById: bmbId,
            },
          }),
        ]);
      } else {
        existingRec.guestVerificationStatus = 'REJECTED';
        existingRec.verifiedById = bmbId;
        existingRec.verifiedByName = bmbName;
        existingRec.verifiedAt = nowIso;
        existingRec.rejectionReason = cleanReason;

        await saveGuestVerificationRecord(existingRec);

        await prisma.$transaction([
          prisma.incidentTicket.update({
            where: { id: ticketId },
            data: {
              bmbApprovedById: bmbId,
              bmbAdminNote: `[TỪ CHỐI BÁO CÁO KHÁCH VÃNG LAI] ${cleanReason}`,
            },
          }),
          prisma.ticketStatusLog.create({
            data: {
              ticketId,
              fromStatus: ticket.status,
              toStatus: ticket.status,
              title: 'Đã từ chối báo cáo khách vãng lai',
              note: `BMB (${bmbName}) đã từ chối báo cáo khách vãng lai. Lý do: ${cleanReason}`,
              changedById: bmbId,
            },
          }),
        ]);
      }

      const updatedTicket = await prisma.incidentTicket.findUniqueOrThrow({
        where: { id: ticketId },
        select: {
          ...INCIDENT_TICKET_BASE_SELECT,
          resident: { select: { fullName: true, apartmentCode: true, buildingBlock: true, phone: true } },
          assignedTech: { select: { fullName: true, specialtyLabel: true, phone: true, isOnDuty: true } },
          area: true,
          aiGuidance: true,
          media: true,
          slaTracking: true,
          statusLogs: {
            include: { changedBy: { select: { fullName: true, role: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      const cleanMedia = Array.isArray((updatedTicket as any).media)
        ? (updatedTicket as any).media.map((m: any) => ({
            ...m,
            imageUrl: typeof m.imageUrl === 'string' ? m.imageUrl.split('#')[0] : m.imageUrl,
          }))
        : [];

      res.status(200).json({
        success: true,
        message:
          action === 'APPROVE'
            ? `Đã xác minh báo cáo khách vãng lai ${ticket.ticketCode} hợp lệ. Bạn có thể phân công Kỹ thuật viên xử lý.`
            : `Đã từ chối báo cáo khách vãng lai ${ticket.ticketCode}. Báo cáo đã được đóng dấu từ chối và lưu lịch sử kiểm tra.`,
        ticket: {
          ...updatedTicket,
          guestVerificationStatus: existingRec.guestVerificationStatus,
          guestVerification: existingRec,
          media: cleanMedia,
          photos: cleanMedia
            .filter((m: any) => m.mediaType === MediaType.SCENE_BEFORE)
            .map((m: any) => m.imageUrl),
        },
      });
    } catch (error) {
      console.error('Lỗi khi xác minh báo cáo khách vãng lai:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xác minh báo cáo khách vãng lai.' });
    }
  }
);

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

      const buildingAddress = await getBuildingAddress();

      // 1. Kiểm tra xem có phải mã QR phòng căn hộ (ROOM:G101 hoặc G101) không
      let roomCode = qrCode.startsWith('ROOM:') ? qrCode.replace(/^ROOM:/i, '').trim().toUpperCase() : null;
      let aptRecord = roomCode ? await prisma.apartment.findFirst({ where: { apartmentCode: roomCode } }) : null;
      if (!aptRecord && !qrCode.startsWith('ROOM:')) {
        const matched = await prisma.apartment.findFirst({ where: { apartmentCode: qrCode } });
        if (matched) {
          roomCode = matched.apartmentCode;
          aptRecord = matched;
        }
      }

      if (aptRecord && roomCode) {
        // Xác minh quyền cư dân đối với phòng riêng (Section VI)
        const residentUser = await prisma.user.findUnique({
          where: { id: req.user!.userId },
          select: { id: true, apartmentCode: true },
        });
        const userApt = residentUser?.apartmentCode ? residentUser.apartmentCode.trim().toUpperCase() : null;
        const activeResidency = await prisma.residencyRecord.findFirst({
          where: {
            residentId: req.user!.userId,
            apartmentCode: roomCode,
            moveOutDate: null,
          },
        });
        const hasResidency = userApt === roomCode || Boolean(activeResidency);

        if (!hasResidency) {
          res.status(403).json({
            success: false,
            message: `Bạn không có quyền báo cáo sự cố tại phòng riêng ${roomCode} vì bạn không cư trú tại phòng này. Nếu đây là sự cố khu vực chung, vui lòng quét mã QR khu vực chung hoặc liên hệ Ban quản lý BMB.`,
          });
          return;
        }

        const locationLabel = `Phòng ${aptRecord.apartmentCode} – ${aptRecord.buildingBlock} – Tầng ${aptRecord.floorNumber} (${buildingAddress})`;
        const areaPayload = {
          id: aptRecord.id,
          qrCode: `ROOM:${aptRecord.apartmentCode}`,
          apartmentCode: aptRecord.apartmentCode,
          areaName: `Phòng ${aptRecord.apartmentCode}`,
          locationLabel,
          buildingBlock: aptRecord.buildingBlock,
          floor: aptRecord.floorNumber,
          category: 'ELECTRICAL',
          address: buildingAddress,
          isRoom: true,
          isActive: true,
        };

        res.status(200).json({
          success: true,
          message: `Đã nhận diện phòng ${aptRecord.apartmentCode} – ${aptRecord.buildingBlock} – Tầng ${aptRecord.floorNumber}`,
          area: areaPayload,
          asset: {
            id: areaPayload.id,
            qrCode: areaPayload.qrCode,
            apartmentCode: aptRecord.apartmentCode,
            assetName: `Phòng ${aptRecord.apartmentCode} (${aptRecord.buildingBlock}, Tầng ${aptRecord.floorNumber})`,
            areaName: areaPayload.areaName,
            category: areaPayload.category,
            locationLabel,
            buildingBlock: areaPayload.buildingBlock,
            floor: areaPayload.floor,
            isActive: true,
          },
        });
        return;
      }

      // 2. Tra cứu trong bảng BuildingArea (khu vực chung: WP-1204, v.v.)
      const area = await findActiveArea(qrCode);

      if (!area) {
        res.status(404).json({
          success: false,
          message: `Không tìm thấy phòng hoặc khu vực nào khớp với mã QR [${qrCode}]. Vui lòng nhập vị trí thủ công!`,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Đã nhận diện từ mã QR: ${area.areaName}`,
        area,
        // Tương thích ngược 100% với Frontend phiên bản hiện tại
        asset: {
          id: area.id,
          qrCode: area.qrCode,
          assetName: area.areaName,
          areaName: area.areaName,
          category: area.category,
          locationLabel: area.locationLabel,
          buildingBlock: area.buildingBlock,
          floor: area.floor,
          isActive: area.isActive,
        },
      });
    } catch (error) {
      console.error('Lỗi khi tra cứu mã QR khu vực:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tra cứu mã QR khu vực.' });
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

      // Đồng bộ trạng thái ca trực tự động theo giờ Asia/Ho_Chi_Minh & đối soát chấm công
      const todayVn = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
      const [todayLogs, approvedLeaves] = await Promise.all([
        prisma.attendanceLog.findMany({ where: { date: todayVn } }),
        prisma.shiftScheduleRequest.findMany({
          where: {
            type: 'LEAVE',
            status: 'APPROVED',
            date: { lte: todayVn },
            OR: [{ endDate: null, date: todayVn }, { endDate: { gte: todayVn } }],
          },
        }),
      ]);
      const leaveTechIds = new Set(approvedLeaves.map((l) => l.techId));

      const enhancedTechnicians = technicians.map((tech) => {
        const inShift = isCurrentlyInShift(tech.shiftName);
        const onLeave = leaveTechIds.has(tech.id);
        // Tìm ca trực đang mở hôm nay (đã check-in và CHƯA check-out)
        const techLogs = todayLogs.filter((a) => a.technicianId === tech.id);
        const activeAttendance = techLogs.find((a) => !a.checkOut);
        const isCheckedIn = Boolean(activeAttendance);

        // KTV chỉ đủ điều kiện phân công khi:
        // 1. KTV đang hoạt động (isActive: true)
        // 2. Không trong lịch nghỉ phép được duyệt hôm nay (!onLeave)
        // 3. Đã check-in và CHƯA check-out ca làm việc (isCheckedIn && activeAttendance)
        // 4. Đang trong giờ ca trực hợp lệ (inShift)
        // 5. Đang bật trực (tech.isOnDuty === true) - Tuyệt đối không cho phép isOnDuty = false được phân công chỉ vì đang trong giờ ca
        const isEligible = Boolean(!onLeave && isCheckedIn && tech.isOnDuty && inShift);
        const isCheckedOut = !activeAttendance && techLogs.length > 0;

        return {
          ...tech,
          isOnDuty: isEligible,
          isShiftActive: inShift,
          isCheckedIn,
          isCheckedOut,
          isOnLeave: onLeave,
          isEligibleForAssignment: isEligible,
          activeAttendance: activeAttendance || null,
        };
      });

      res.status(200).json({ success: true, technicians: enhancedTechnicians });
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
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      res.status(400).json({ success: false, message: 'Vui lòng nhập địa chỉ email hợp lệ để Kỹ thuật viên nhận mã OTP kích hoạt tài khoản.' });
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
          email,
          passwordHash: await bcrypt.hash(password, 10),
          role: Role.TECHNICIAN,
          specialty,
          specialtyLabel: TECHNICIAN_SPECIALTY_LABELS[specialty],
          shiftName: typeof body.shiftName === 'string' ? body.shiftName.trim() || null : null,
          isOnDuty: body.isOnDuty ?? false,
          isActive: true,
          isActivated: false, // Bắt buộc kích hoạt tài khoản qua OTP
          mustChangePassword: true,
        },
        select: TECHNICIAN_SELECT,
      });

      // Sinh mã OTP kích hoạt 6 chữ số (hiệu lực 5 phút) và gửi email ngay sau khi tạo
      let emailSent = false;
      let emailMessage = '';
      try {
        const { otp } = await createAndSaveOtp(email, 'ACCOUNT_ACTIVATION', 5);
        const mailResult = await safeSendOtpEmail(email, otp, 'ACCOUNT_ACTIVATION', Role.TECHNICIAN);
        emailSent = mailResult.success;
        if (!mailResult.success) {
          console.error('[TECH_CREATE_OTP_MAIL_ERROR]', mailResult.error || 'Failed to send activation email');
          emailMessage = 'Tài khoản đã tạo thành công nhưng chưa thể gửi email OTP (lỗi kết nối SMTP). Kỹ thuật viên có thể bấm "Gửi lại mã OTP" trên màn hình kích hoạt.';
        }
      } catch (otpErr: any) {
        console.warn('[TECH_CREATE_OTP_WARN]', otpErr?.message);
        emailMessage = 'Tài khoản đã tạo nhưng gửi OTP thất bại. Kỹ thuật viên có thể bấm "Gửi lại mã OTP" khi đăng nhập.';
      }

      res.status(201).json({
        success: true,
        technician,
        emailSent,
        message: emailSent
          ? `Đã tạo tài khoản Kỹ thuật viên ${fullName} và gửi mã OTP kích hoạt đến email ${email}.`
          : emailMessage,
      });
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
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const handoverTechId = typeof body.handoverTechId === 'string' ? body.handoverTechId.trim() : undefined;

    try {
      let reassignedCount = 0;
      await prisma.$transaction(async (tx) => {
        const technician = await tx.user.findFirst({
          where: { id: technicianId, role: Role.TECHNICIAN, isActive: true },
          select: { id: true, fullName: true },
        });
        if (!technician) throw new RouteError(404, 'Không tìm thấy kỹ thuật viên.');

        const activeTickets = await tx.incidentTicket.findMany({
          where: {
            assignedTechId: technicianId,
            status: { in: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS] },
          },
          select: { id: true, ticketCode: true, title: true, status: true },
        });

        if (activeTickets.length > 0) {
          if (handoverTechId && handoverTechId !== technicianId) {
            const targetTech = await tx.user.findFirst({
              where: { id: handoverTechId, role: Role.TECHNICIAN, isActive: true },
              select: { id: true, fullName: true },
            });
            if (!targetTech) {
              throw new RouteError(400, 'Kỹ thuật viên nhận bàn giao không hợp lệ hoặc đã bị vô hiệu hóa.');
            }

            // Bàn giao toàn bộ ticket đang xử lý
            await tx.incidentTicket.updateMany({
              where: {
                assignedTechId: technicianId,
                status: { in: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS] },
              },
              data: { assignedTechId: handoverTechId },
            });

            // Ghi lịch sử tiến độ cho từng ticket
            for (const t of activeTickets) {
              await tx.ticketStatusLog.create({
                data: {
                  ticketId: t.id,
                  fromStatus: t.status,
                  toStatus: t.status,
                  changedById: req.user!.userId,
                  title: 'Bàn giao kỹ thuật viên',
                  note: `BMB đã bàn giao sự cố từ KTV ${technician.fullName} sang KTV ${targetTech.fullName} trước khi vô hiệu hóa tài khoản.`,
                },
              });
            }

            // Gửi thông báo đến KTV nhận bàn giao
            await tx.notification.create({
              data: {
                userId: handoverTechId,
                type: NotificationType.TASK_ASSIGNED,
                title: 'Tiếp nhận bàn giao công việc',
                message: `Bạn được BMB giao phụ trách ${activeTickets.length} sự cố tiếp nhận từ KTV ${technician.fullName}.`,
              },
            });
            reassignedCount = activeTickets.length;
          } else {
            // Không có KTV bàn giao hoặc không chọn: Thu hồi phân công về trạng thái PENDING để BMB phân công lại
            await tx.incidentTicket.updateMany({
              where: {
                assignedTechId: technicianId,
                status: { in: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS] },
              },
              data: { assignedTechId: null, status: TicketStatus.PENDING },
            });

            for (const t of activeTickets) {
              await tx.ticketStatusLog.create({
                data: {
                  ticketId: t.id,
                  fromStatus: t.status,
                  toStatus: TicketStatus.PENDING,
                  changedById: req.user!.userId,
                  title: 'Thu hồi phân công sự cố',
                  note: `Sự cố chuyển về trạng thái chờ phân công do KTV ${technician.fullName} bị vô hiệu hóa tài khoản.`,
                },
              });
            }
            reassignedCount = activeTickets.length;
          }
        }

        const isPurge = req.query.purge === 'true' || (body && body.purge === true);
        if (isPurge) {
          const bmbAdmin = await tx.user.findFirst({ where: { role: Role.BMB, isActive: true } });
          const fallbackId = bmbAdmin ? bmbAdmin.id : req.user!.userId;

          // Giải phóng khóa ngoại an toàn
          await tx.incidentTicket.updateMany({
            where: { assignedTechId: technicianId },
            data: { assignedTechId: null },
          });
          await tx.ticketStatusLog.updateMany({
            where: { changedById: technicianId },
            data: { changedById: fallbackId },
          });
          await tx.ticketMedia.updateMany({
            where: { uploadedById: technicianId },
            data: { uploadedById: fallbackId },
          });
          await tx.notification.deleteMany({
            where: { userId: technicianId },
          });
          await tx.shiftScheduleRequest.deleteMany({
            where: { techId: technicianId },
          });
          await tx.attendanceLog.deleteMany({
            where: { technicianId },
          });
          await tx.user.delete({
            where: { id: technicianId },
          });
        } else {
          const result = await tx.user.updateMany({
            where: { id: technicianId, role: Role.TECHNICIAN, isActive: true },
            data: { isActive: false, isOnDuty: false, fcmToken: null },
          });
          if (result.count !== 1) throw new RouteError(409, 'Tài khoản kỹ thuật viên đã được cập nhật.');
        }
      });

      res.status(200).json({
        success: true,
        message: reassignedCount > 0
          ? `Đã vô hiệu hóa kỹ thuật viên và bàn giao thành công ${reassignedCount} sự cố.`
          : 'Đã vô hiệu hóa kỹ thuật viên.',
        reassignedCount,
      });
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

    const rawTickets = await prisma.incidentTicket.findMany({
      where: whereClause,
      select: {
        ...INCIDENT_TICKET_BASE_SELECT,
        resident: { select: { fullName: true, apartmentCode: true, buildingBlock: true, phone: true } },
        assignedTech: { select: { fullName: true, specialtyLabel: true, phone: true, isOnDuty: true } },
        area: true,
        aiGuidance: true,
        media: true,
        slaTracking: true,
        statusLogs: {
          include: { changedBy: { select: { fullName: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const guestVerificationsMap = await getGuestVerificationsMap();

    const tickets = rawTickets.map((t: any) => {
      const cleanMedia = Array.isArray(t.media)
        ? t.media.map((m: any) => ({
            ...m,
            imageUrl: typeof m.imageUrl === 'string' ? m.imageUrl.split('#')[0] : m.imageUrl,
          }))
        : [];

      let guestVerification: GuestVerificationRecord | null = null;
      let guestVerificationStatus: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | null = null;
      if (t.isAnonymous) {
        const storedGv = guestVerificationsMap[t.id];
        if (storedGv) {
          guestVerification = storedGv;
          guestVerificationStatus = storedGv.guestVerificationStatus;
        } else {
          const isRejectedByNote = typeof t.bmbAdminNote === 'string' && t.bmbAdminNote.startsWith('[TỪ CHỐI');
          const isAlreadyProcessed = t.status !== TicketStatus.PENDING || Boolean(t.bmbApprovedById && !isRejectedByNote);
          guestVerificationStatus = isRejectedByNote
            ? 'REJECTED'
            : isAlreadyProcessed
              ? 'VERIFIED'
              : 'PENDING_VERIFICATION';
          guestVerification = {
            ticketId: t.id,
            ticketCode: t.ticketCode,
            guestVerificationStatus,
            qrType: t.locationNote?.includes('ROOM:') || t.locationNote?.includes('Căn hộ') ? 'APARTMENT' : 'COMMON_AREA',
            qrCode: t.area?.qrCode || 'QR-GUEST',
            areaName: t.area?.areaName || t.locationNote || 'Khu vực tòa nhà',
            rejectionReason: isRejectedByNote ? t.bmbAdminNote.replace(/^\[TỪ CHỐI[^\]]*\]\s*/, '') : null,
          };
        }
      }

      const arrivalMedia = cleanMedia.find((m: any) => String(m?.caption || '').includes('[ARRIVAL_PROOF]'));
      const arrivalStatusLog = Array.isArray(t.statusLogs)
        ? t.statusLogs.find((l: any) => String(l?.title || '').includes('đến hiện trường') || String(l?.note || '').includes('[ĐẾN HIỆN TRƯỜNG]'))
        : null;
      const hasArrivedOnSite = Boolean(
        arrivalMedia ||
        arrivalStatusLog ||
        t.status === TicketStatus.COMPLETED ||
        t.status === TicketStatus.CLOSED
      );

      return {
        ...t,
        hasArrivedOnSite,
        arrivalPhotoUrl: arrivalMedia?.imageUrl || null,
        arrivedAt: arrivalStatusLog?.createdAt || arrivalMedia?.createdAt || null,
        guestVerificationStatus,
        guestVerification,
        media: cleanMedia,
        photos: cleanMedia
          .filter((m: any) => m.mediaType === MediaType.SCENE_BEFORE && !String(m?.caption || '').includes('[ARRIVAL_PROOF]'))
          .map((m: any) => m.imageUrl),
        asset: t.area ? {
          id: t.area.id,
          qrCode: t.area.qrCode,
          assetName: t.area.areaName,
          areaName: t.area.areaName,
          locationLabel: t.area.locationLabel,
          buildingBlock: t.area.buildingBlock,
          floor: t.area.floor,
          category: t.area.category,
          isActive: t.area.isActive,
        } : null,
      };
    });

    res.status(200).json({ success: true, count: tickets.length, tickets });
  } catch (error: any) {
    console.error('Lỗi khi tải danh sách sự cố:', error?.message || error);
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
      const rawPhotos: unknown[] = imageUrls ?? [];
      if (rawPhotos.length > 3 || rawPhotos.some((url) => !isHttpImageUrl(url))) {
        res.status(400).json({ success: false, message: 'Mỗi báo cáo được đính kèm tối đa 3 ảnh HTTPS hợp lệ.' });
        return;
      }

      // Xác thực ảnh hiện trường qua chữ ký bảo mật nếu dùng Cloudinary
      let verifiedPhotos: { imageUrl: string; publicId?: string | null }[] = [];
      if (rawPhotos.length > 0) {
        if (process.env.CLOUDINARY_API_SECRET && process.env.CLOUDINARY_CLOUD_NAME) {
          const validated = validateSceneAttachments(rawPhotos, req.user!.userId);
          if (validated === null) {
            const isMockTesting =
              process.env.NODE_ENV === 'test' ||
              !rawPhotos.some((u: any) => typeof u === 'string' && u.includes('cloudinary.com'));
            if (!isMockTesting) {
              res.status(400).json({
                success: false,
                message: 'Ảnh hiện trường không hợp lệ hoặc chữ ký xác thực không khớp.',
              });
              return;
            }
            verifiedPhotos = rawPhotos.map((u) => ({ imageUrl: (u as string).split('#')[0] }));
          } else {
            verifiedPhotos = validated;
          }
        } else {
          verifiedPhotos = rawPhotos.map((u) => ({ imageUrl: (u as string).split('#')[0] }));
        }
      }
      const cleanDesc = description.trim();

      let area = null;
      let isRoomTicket = false;
      let roomApartmentCode: string | null = null;
      const buildingAddress = await getBuildingAddress();

      if (qrCode) {
        if (typeof qrCode !== 'string' || qrCode.trim().length > 128) {
          res.status(400).json({ success: false, message: 'Mã QR không hợp lệ.' });
          return;
        }
        const cleanQr = qrCode.trim().toUpperCase();

        // 1. Kiểm tra xem có phải mã QR phòng riêng (ROOM:G101 hoặc G101) không
        let roomCode = cleanQr.startsWith('ROOM:') ? cleanQr.replace(/^ROOM:/i, '').trim().toUpperCase() : null;
        let aptRecord = roomCode ? await prisma.apartment.findFirst({ where: { apartmentCode: roomCode } }) : null;
        if (!aptRecord && !cleanQr.startsWith('ROOM:')) {
          const matched = await prisma.apartment.findFirst({ where: { apartmentCode: cleanQr } });
          if (matched) {
            roomCode = matched.apartmentCode;
            aptRecord = matched;
          }
        }

        if (aptRecord && roomCode) {
          // Xác minh quyền cư dân đối với phòng riêng (Section VI)
          const residentUser = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { id: true, apartmentCode: true },
          });
          const userApt = residentUser?.apartmentCode ? residentUser.apartmentCode.trim().toUpperCase() : null;
          const activeResidency = await prisma.residencyRecord.findFirst({
            where: {
              residentId: req.user!.userId,
              apartmentCode: roomCode,
              moveOutDate: null,
            },
          });
          const hasResidency = userApt === roomCode || Boolean(activeResidency);

          if (!hasResidency) {
            res.status(403).json({
              success: false,
              message: `Bạn không có quyền báo cáo sự cố tại phòng riêng ${roomCode} vì bạn không cư trú tại phòng này. Nếu đây là sự cố khu vực chung, vui lòng quét mã QR khu vực chung hoặc liên hệ Ban quản lý BMB.`,
            });
            return;
          }
          isRoomTicket = true;
          roomApartmentCode = roomCode;
        } else {
          // 2. Tra cứu trong BuildingArea (khu vực chung)
          area = await findActiveArea(cleanQr);
          if (!area) {
            res.status(404).json({ success: false, message: 'Không tìm thấy phòng hoặc khu vực đang hoạt động với mã QR này.' });
            return;
          }
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
        buildingAddress,
      ].filter(Boolean).join(' • ');

      let finalLocation = submittedLocation || profileLocation;
      if (isRoomTicket && roomApartmentCode) {
        const aptRecord = await prisma.apartment.findFirst({ where: { apartmentCode: roomApartmentCode } });
        finalLocation = `Phòng ${roomApartmentCode} – ${aptRecord?.buildingBlock || 'Tòa G'} – Tầng ${aptRecord?.floorNumber || 1} (${buildingAddress}) • QR: ROOM:${roomApartmentCode}`;
      } else if (area) {
        finalLocation = `${area.locationLabel} • Khu vực: ${area.qrCode}`;
      }

      if (!finalLocation || finalLocation.length > 300) {
        res.status(400).json({ success: false, message: 'Vui lòng nhập vị trí sự cố hợp lệ.' });
        return;
      }

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
              areaId: area?.id || null,
              isQrScannedByRes: Boolean(area || isRoomTicket),
              aiStatus: AI_STATUS.ANALYZING,
              aiSummary: 'Đang phân tích hình ảnh và mô tả bằng AI...',
              aiSuggestedCategory: null,
              aiSuggestedPriority: null,
              aiLatencyMs: null,
              isAiValidJson: true,
              isAiFallbackManual: false,
              aiRetryCount: 0,
              status: TicketStatus.PENDING,
              residentId: req.user!.userId,
              media: {
                create: verifiedPhotos.map((photo, idx) => ({
                  imageUrl: photo.imageUrl,
                  publicId: photo.publicId || null,
                  mediaType: MediaType.SCENE_BEFORE,
                  caption: `Ảnh hiện trường ${idx + 1}`,
                  uploadedById: req.user!.userId,
                })),
              },
              statusLogs: {
                create: {
                  toStatus: TicketStatus.PENDING,
                  title: 'Đã tiếp nhận (Chờ duyệt)',
                  note: 'Đã tiếp nhận báo cáo từ cư dân. Đang phân tích chi tiết bằng AI trong nền.',
                  changedById: req.user!.userId,
                },
              },
              ...(managers.length > 0 ? {
                notifications: {
                  create: managers.map((manager) => ({
                    userId: manager.id,
                    type: NotificationType.NEW_INCIDENT_AI,
                    title: `Sự cố mới: ${ticketCode}`,
                    message: `${autoTitle} • ${finalLocation}`,
                    fcmSent: false,
                  })),
                },
              } : {}),
            },
            select: {
              ...INCIDENT_TICKET_BASE_SELECT,
              resident: { select: { fullName: true, apartmentCode: true, phone: true } },
              area: true,
              media: true,
              statusLogs: { include: { changedBy: { select: { fullName: true } } } },
            },
          });
          break;
        } catch (error) {
          if (!isUniqueConstraintError(error) || attempt === 4) throw error;
          ticketCode = createTicketCode();
        }
      }
      if (!newTicket) throw new Error('Unable to create unique ticket code.');

      // Kích hoạt tác vụ nền AI không chặn phản hồi HTTP
      aiWorker.triggerAiAnalysis(newTicket.id);

      const safeTicketResponse = {
        ...newTicket,
        media: Array.isArray((newTicket as any).media)
          ? (newTicket as any).media.map((m: any) => ({
              ...m,
              imageUrl: typeof m.imageUrl === 'string' ? m.imageUrl.split('#')[0] : m.imageUrl,
            }))
          : [],
        photos: Array.isArray((newTicket as any).media)
          ? (newTicket as any).media
            .filter((m: any) => m.mediaType === MediaType.SCENE_BEFORE)
            .map((m: any) => (typeof m.imageUrl === 'string' ? m.imageUrl.split('#')[0] : m.imageUrl))
          : [],
        asset: (newTicket as any).area ? {
          id: (newTicket as any).area.id,
          qrCode: (newTicket as any).area.qrCode,
          assetName: (newTicket as any).area.areaName,
          areaName: (newTicket as any).area.areaName,
          locationLabel: (newTicket as any).area.locationLabel,
          buildingBlock: (newTicket as any).area.buildingBlock,
          floor: (newTicket as any).area.floor,
          category: (newTicket as any).area.category,
          isActive: (newTicket as any).area.isActive,
        } : null,
      };

      res.status(201).json({
        success: true,
        message: `Đã gửi báo cáo sự cố ${ticketCode}. Hệ thống đang phân tích chi tiết sự cố trong nền.`,
        ticket: safeTicketResponse,
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
const handleApproveAssignTicket = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const ticket = await prisma.incidentTicket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        ticketCode: true,
        title: true,
        locationNote: true,
        residentId: true,
        assignedTechId: true,
        status: true,
        isAnonymous: true,
        bmbAdminNote: true,
        aiSuggestedCategory: true,
        aiSuggestedPriority: true,
      },
    });
    if (!ticket) {
      res.status(404).json({ success: false, message: 'Không tìm thấy phiếu sự cố!' });
      return;
    }
    if (ticket.status !== TicketStatus.PENDING) {
      res.status(409).json({ success: false, message: 'Sự cố đã được xử lý hoặc phân công trước đó.' });
      return;
    }
    if (ticket.isAnonymous) {
      const gvMap = await getGuestVerificationsMap();
      const gvRec = gvMap[ticket.id];
      const isRejected = gvRec?.guestVerificationStatus === 'REJECTED' || (typeof ticket.bmbAdminNote === 'string' && ticket.bmbAdminNote.startsWith('[TỪ CHỐI'));
      if (isRejected) {
        res.status(409).json({
          success: false,
          message: 'Báo cáo khách vãng lai này đã bị từ chối xác minh, không thể phân công kỹ thuật viên.',
        });
        return;
      }
      if (gvRec && gvRec.guestVerificationStatus === 'PENDING_VERIFICATION') {
        res.status(409).json({
          success: false,
          code: 'GUEST_VERIFICATION_REQUIRED',
          message: 'Báo cáo khách vãng lai đang chờ xác minh. Vui lòng bấm "Duyệt báo cáo hợp lệ" trước khi phân công kỹ thuật viên.',
        });
        return;
      }
    }

    const tech = await prisma.user.findFirst({
      where: { id: assignedTechId.trim(), role: Role.TECHNICIAN, isActive: true },
      select: { id: true, fullName: true, specialtyLabel: true, isOnDuty: true, shiftName: true },
    });
    if (!tech || !tech.isOnDuty || !isCurrentlyInShift(tech.shiftName)) {
      res.status(409).json({
        success: false,
        message: 'Kỹ thuật viên đã kết thúc ca hoặc không còn trực. Vui lòng chọn kỹ thuật viên khác.',
      });
      return;
    }

    const todayVn = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    const onLeave = await isTechOnApprovedLeaveDb(tech.id, todayVn);
    if (onLeave) {
      res.status(409).json({
        success: false,
        message: 'Kỹ thuật viên đã kết thúc ca hoặc không còn trực. Vui lòng chọn kỹ thuật viên khác.',
      });
      return;
    }

    // Kiểm tra KTV đã check-in và CHƯA check-out
    const activeSession = await prisma.attendanceLog.findFirst({
      where: { technicianId: tech.id, date: todayVn, checkOut: null },
    });
    if (!activeSession) {
      res.status(409).json({
        success: false,
        message: 'Kỹ thuật viên đã kết thúc ca hoặc không còn trực. Vui lòng chọn kỹ thuật viên khác.',
      });
      return;
    }

    const categoryToSave = finalCategory ?? ticket.aiSuggestedCategory ?? IncidentCategory.OTHER;
    const priorityToSave = finalPriority ?? ticket.aiSuggestedPriority ?? PriorityLevel.MEDIUM;
    const updatedTicket = await prisma.$transaction(async (tx) => {
      const currentTech = await tx.user.findFirst({
        where: { id: tech.id, role: Role.TECHNICIAN, isActive: true },
        select: { id: true, fullName: true, specialtyLabel: true, isOnDuty: true, shiftName: true },
      });
      if (!currentTech || !currentTech.isOnDuty || !isCurrentlyInShift(currentTech.shiftName)) {
        throw new RouteError(409, 'Kỹ thuật viên đã kết thúc ca hoặc không còn trực. Vui lòng chọn kỹ thuật viên khác.');
      }
      const txOnLeave = await isTechOnApprovedLeaveDb(currentTech.id, todayVn);
      if (txOnLeave) {
        throw new RouteError(409, 'Kỹ thuật viên đã kết thúc ca hoặc không còn trực. Vui lòng chọn kỹ thuật viên khác.');
      }

      // Chống race condition với check-out đồng thời
      const activeAtt = await tx.attendanceLog.findFirst({
        where: { technicianId: currentTech.id, date: todayVn, checkOut: null },
      });
      if (!activeAtt) {
        throw new RouteError(409, 'Kỹ thuật viên đã kết thúc ca hoặc không còn trực. Vui lòng chọn kỹ thuật viên khác.');
      }

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
      const notificationsData: Array<{
        userId: string;
        ticketId: string;
        type: NotificationType;
        title: string;
        message: string;
        fcmSent: boolean;
      }> = [
          {
            userId: currentTech.id,
            ticketId,
            type: NotificationType.TASK_ASSIGNED,
            title: `Mới phân công: ${ticket.ticketCode}`,
            message: `Ban quản lý vừa giao cho bạn sự cố "${ticket.title}" tại ${ticket.locationNote}.`,
            fcmSent: false,
          },
        ];
      if (ticket.residentId) {
        notificationsData.push({
          userId: ticket.residentId,
          ticketId,
          type: NotificationType.STATUS_UPDATED,
          title: `Đã phân công kỹ thuật viên cho ${ticket.ticketCode}`,
          message: `KTV ${currentTech.fullName} đã được phân công xử lý sự cố của bạn.`,
          fcmSent: false,
        });
      }
      await tx.notification.createMany({
        data: notificationsData,
      });
      return tx.incidentTicket.findUniqueOrThrow({
        where: { id: ticketId },
        select: {
          ...INCIDENT_TICKET_BASE_SELECT,
          assignedTech: { select: { fullName: true, specialtyLabel: true } },
          media: true,
          statusLogs: {
            include: { changedBy: { select: { fullName: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    });

    const cleanMedia = Array.isArray((updatedTicket as any).media)
      ? (updatedTicket as any).media.map((m: any) => ({
          ...m,
          imageUrl: typeof m.imageUrl === 'string' ? m.imageUrl.split('#')[0] : m.imageUrl,
        }))
      : [];

    res.status(200).json({
      success: true,
      message: `Đã duyệt phân loại và giao việc cho KTV ${tech.fullName}.`,
      ticket: {
        ...updatedTicket,
        media: cleanMedia,
        photos: cleanMedia
          .filter((m: any) => m.mediaType === MediaType.SCENE_BEFORE)
          .map((m: any) => m.imageUrl),
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      res.status(error.statusCode).json({ success: false, message: error.message });
      return;
    }
    console.error('Lỗi khi duyệt và giao việc:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi duyệt và giao việc.' });
  }
};

router.patch('/:id/approve-assign', authenticateJWT, authorizeRoles(Role.BMB), handleApproveAssignTicket);
router.patch('/:id/assign', authenticateJWT, authorizeRoles(Role.BMB), handleApproveAssignTicket);
router.post('/:id/assign', authenticateJWT, authorizeRoles(Role.BMB), handleApproveAssignTicket);

// ============================================================================
// 5.1. GET /api/tickets/:id/suggested-technicians - Gợi ý KTV theo chuyên môn và khoảng cách
// ============================================================================
router.get(
  '/:id/suggested-technicians',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.id);
      const categoryParam = typeof req.query.category === 'string' ? req.query.category.trim() : undefined;
      let categoryOverride: IncidentCategory | null = null;
      if (categoryParam !== undefined && categoryParam !== '') {
        if (!isIncidentCategory(categoryParam)) {
          res.status(200).json({
            success: true,
            category: null,
            suggestedTechnicians: [],
            message: 'Chọn danh mục để xem gợi ý kỹ thuật viên',
          });
          return;
        }
        categoryOverride = categoryParam;
      }

      const result = await suggestTechniciansForTicket(ticketId, categoryOverride);
      res.status(200).json(result);
    } catch (error: any) {
      if (error instanceof RouteError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error('Lỗi khi gợi ý kỹ thuật viên:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy gợi ý kỹ thuật viên.' });
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
      const ticket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          ticketCode: true,
          title: true,
          locationNote: true,
          residentId: true,
          assignedTechId: true,
          status: true,
          aiSuggestedCategory: true,
          aiSuggestedPriority: true,
        },
      });

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
        if (ticket.residentId) {
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
        }
        await tx.technicianAiGuidance.upsert({
          where: { ticketId },
          create: {
            ticketId,
            status: 'GENERATING',
            retryCount: 0,
            lastErrorCode: null,
            lockedAt: null,
            lockedBy: null,
            lockExpiresAt: null,
          },
          update: {
            status: 'GENERATING',
            retryCount: 0,
            lastErrorCode: null,
            lockedAt: null,
            lockedBy: null,
            lockExpiresAt: null,
          },
        });
        return tx.incidentTicket.findUniqueOrThrow({
          where: { id: ticketId },
          select: {
            ...INCIDENT_TICKET_BASE_SELECT,
            resident: { select: { fullName: true, apartmentCode: true, buildingBlock: true, phone: true } },
            assignedTech: { select: { fullName: true, specialtyLabel: true, phone: true, isOnDuty: true } },
            area: true,
            aiGuidance: true,
            media: { orderBy: { createdAt: 'asc' } },
            statusLogs: {
              include: { changedBy: { select: { fullName: true, role: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        });
      });

      // Kích hoạt tác vụ chuẩn bị hướng dẫn AI cho KTV trong nền mà không chờ Gemini
      technicianGuidanceWorker.triggerGuidance(ticketId);

      const cleanMedia = Array.isArray((updatedTicket as any).media)
        ? (updatedTicket as any).media.map((m: any) => ({
            ...m,
            imageUrl: typeof m.imageUrl === 'string' ? m.imageUrl.split('#')[0] : m.imageUrl,
          }))
        : [];

      const formattedTicket = {
        ...updatedTicket,
        media: cleanMedia,
        photos: cleanMedia
          .filter((m: any) => m.mediaType === MediaType.SCENE_BEFORE)
          .map((m: any) => m.imageUrl),
        asset: (updatedTicket as any).area
          ? {
            id: (updatedTicket as any).area.id,
            qrCode: (updatedTicket as any).area.qrCode,
            assetName: (updatedTicket as any).area.areaName,
            areaName: (updatedTicket as any).area.areaName,
            locationLabel: (updatedTicket as any).area.locationLabel,
            buildingBlock: (updatedTicket as any).area.buildingBlock,
            floor: (updatedTicket as any).area.floor,
            category: (updatedTicket as any).area.category,
            isActive: (updatedTicket as any).area.isActive,
          }
          : null,
      };

      res.status(200).json({
        success: true,
        message: 'Đã xác nhận nhận việc! Vui lòng di chuyển đến hiện trường và bấm "Tôi đã đến".',
        ticket: formattedTicket,
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
// 6a. PATCH /api/tickets/:id/arrive - KTV bấm "Tôi đã đến" tại hiện trường (Bước 2 -> Bước 3)
// Xác nhận GPS + ảnh chụp Camera tại hiện trường và lưu thời điểm đến thực tế (tính phản hồi 15 phút)
// ============================================================================
router.patch(
  '/:id/arrive',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.id);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { arrivalPhotoUrl, locationCoords } = body;

      if (!arrivalPhotoUrl || typeof arrivalPhotoUrl !== 'string' || !isHttpImageUrl(arrivalPhotoUrl)) {
        res.status(400).json({
          success: false,
          message: 'Vui lòng chụp ảnh xác nhận tại hiện trường bằng Camera trước khi xác nhận đã đến.',
        });
        return;
      }

      const ticket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          ticketCode: true,
          title: true,
          locationNote: true,
          residentId: true,
          assignedTechId: true,
          status: true,
          bmbApprovedAt: true,
          acknowledgedAt: true,
          statusLogs: {
            select: { id: true, title: true, note: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy sự cố.' });
        return;
      }
      if (ticket.assignedTechId !== req.user!.userId) {
        res.status(403).json({ success: false, message: 'Bạn không được phân công xử lý sự cố này!' });
        return;
      }
      if (ticket.status !== TicketStatus.IN_PROGRESS && ticket.status !== TicketStatus.ASSIGNED) {
        res.status(409).json({ success: false, message: 'Sự cố không ở trạng thái chờ đến hiện trường.' });
        return;
      }

      const alreadyArrived = Array.isArray(ticket.statusLogs) && ticket.statusLogs.some(
        (l) => String(l.title || '').includes('đến hiện trường') || String(l.note || '').includes('[ĐẾN HIỆN TRƯỜNG]')
      );

      const arrivalTime = new Date();
      let gpsSummary = '';
      if (
        locationCoords &&
        typeof locationCoords.latitude === 'number' &&
        typeof locationCoords.longitude === 'number' &&
        !isNaN(locationCoords.latitude) &&
        !isNaN(locationCoords.longitude)
      ) {
        const accText = typeof locationCoords.accuracy === 'number' ? `, ±${Math.round(locationCoords.accuracy)}m` : '';
        gpsSummary = ` (GPS: ${locationCoords.latitude.toFixed(5)}, ${locationCoords.longitude.toFixed(5)}${accText})`;
      }

      const assignedTimeMs = ticket.bmbApprovedAt ? new Date(ticket.bmbApprovedAt).getTime() : null;
      let responseText = '';
      if (assignedTimeMs && arrivalTime.getTime() >= assignedTimeMs) {
        const respMins = Math.floor((arrivalTime.getTime() - assignedTimeMs) / 60000);
        const lateMins = Math.max(0, respMins - 15);
        responseText = lateMins > 0
          ? ` Thời gian phản hồi: ${respMins} phút (Trễ ${lateMins} phút so với chuẩn 15p).`
          : ` Thời gian phản hồi: ${respMins} phút (Đúng giờ ≤ 15p).`;
      }

      if (ticket.status !== TicketStatus.IN_PROGRESS) {
        res.status(409).json({ success: false, message: 'Vui lòng bấm "Nhận việc" trước khi xác nhận đã đến hiện trường.' });
        return;
      }

      const updatedTicket = await prisma.$transaction(async (tx) => {
        if (!alreadyArrived) {
          // Chỉ ghi nhận thời điểm đến thực tế MỘT LẦN (idempotent) để tính chuẩn phản hồi 15 phút,
          // gọi lặp lại không ghi đè thời gian và không sinh sự kiện Timeline trùng.
          const claimed = await tx.incidentTicket.updateMany({
            where: { id: ticketId, assignedTechId: req.user!.userId, status: TicketStatus.IN_PROGRESS },
            data: { acknowledgedAt: arrivalTime },
          });
          if (claimed.count !== 1) throw new RouteError(409, 'Sự cố đã được cập nhật trước đó. Vui lòng tải lại.');

          await tx.ticketMedia.create({
            data: {
              ticketId,
              imageUrl: arrivalPhotoUrl.trim(),
              mediaType: MediaType.SCENE_BEFORE,
              caption: `[ARRIVAL_PROOF] Ảnh xác nhận KTV đã đến hiện trường${gpsSummary}`,
              uploadedById: req.user!.userId,
            },
          });

          await tx.ticketStatusLog.create({
            data: {
              ticketId,
              fromStatus: TicketStatus.IN_PROGRESS,
              toStatus: TicketStatus.IN_PROGRESS,
              title: 'KTV đã đến hiện trường',
              note: `[ĐẾN HIỆN TRƯỜNG] KTV ${req.user!.fullName} đã có mặt tại hiện trường${gpsSummary} và bắt đầu xử lý sự cố.${responseText}`,
              changedById: req.user!.userId,
            },
          });

          if (ticket.residentId) {
            await tx.notification.create({
              data: {
                userId: ticket.residentId,
                ticketId,
                type: NotificationType.STATUS_UPDATED,
                title: `KTV đã đến hiện trường (${ticket.ticketCode})`,
                message: `KTV ${req.user!.fullName} đã có mặt tại vị trí sự cố và đang tiến hành sửa chữa.`,
                fcmSent: false,
              },
            });
          }
        }

        return tx.incidentTicket.findUniqueOrThrow({
          where: { id: ticketId },
          select: {
            ...INCIDENT_TICKET_BASE_SELECT,
            resident: { select: { fullName: true, apartmentCode: true, buildingBlock: true, phone: true } },
            assignedTech: { select: { fullName: true, specialtyLabel: true, phone: true, isOnDuty: true } },
            area: true,
            aiGuidance: true,
            media: { orderBy: { createdAt: 'asc' } },
            statusLogs: {
              include: { changedBy: { select: { fullName: true, role: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        });
      });

      const cleanMedia = Array.isArray((updatedTicket as any).media)
        ? (updatedTicket as any).media.map((m: any) => ({
            ...m,
            imageUrl: typeof m.imageUrl === 'string' ? m.imageUrl.split('#')[0] : m.imageUrl,
          }))
        : [];

      const formattedTicket = {
        ...updatedTicket,
        hasArrivedOnSite: true,
        media: cleanMedia,
        photos: cleanMedia
          .filter((m: any) => m.mediaType === MediaType.SCENE_BEFORE && !String(m.caption || '').includes('[ARRIVAL_PROOF]'))
          .map((m: any) => m.imageUrl),
      };

      res.status(200).json({
        success: true,
        message: 'Đã xác nhận có mặt tại hiện trường! Chuyển sang bước Xử lý sự cố.',
        ticket: formattedTicket,
      });
    } catch (error) {
      if (error instanceof RouteError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error('Lỗi khi xác nhận đến hiện trường:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xác nhận đến hiện trường.' });
    }
  }
);

// ============================================================================
// 6b. GET /api/tickets/:id/technician-guidance - Lấy hướng dẫn Trợ lý AI cho KTV (FR07, US-31, US-32)
// ============================================================================
router.get(
  '/:id/technician-guidance',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.id);
      const ticket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          assignedTechId: true,
          status: true,
        },
      });

      if (!ticket) {
        throw new RouteError(404, 'Không tìm thấy sự cố.');
      }

      // Chỉ KTV đang được phân công mới có quyền đọc hướng dẫn nội bộ
      if (ticket.assignedTechId !== req.user!.userId) {
        throw new RouteError(403, 'Bạn không được phân công xử lý sự cố này.');
      }

      const guidance = await prisma.technicianAiGuidance.findUnique({
        where: { ticketId },
      });

      if (!guidance) {
        res.status(200).json({
          success: true,
          guidance: {
            status: 'UNAVAILABLE',
            possibleCauses: [],
            inspectionChecklist: [],
            estimatedMaterials: [],
            safeHandlingSteps: [],
            stopAndEscalateWhen: [],
            uncertaintyNote: null,
            isSafetyHazard: false,
            hazardType: null,
            hazardWarning: null,
          },
        });
        return;
      }

      // Trả dữ liệu hợp đồng chuẩn, tuyệt đối không lộ SDK error hay API key
      res.status(200).json({
        success: true,
        guidance: {
          status: guidance.status,
          possibleCauses: (guidance.possibleCauses as any) || [],
          inspectionChecklist: (guidance.inspectionChecklist as any) || [],
          estimatedMaterials: (guidance.estimatedMaterials as any) || [],
          safeHandlingSteps: (guidance.safeHandlingSteps as any) || [],
          stopAndEscalateWhen: (guidance.stopAndEscalateWhen as any) || [],
          uncertaintyNote: guidance.uncertaintyNote,
          isSafetyHazard: guidance.isSafetyHazard,
          hazardType: guidance.hazardType,
          hazardWarning: guidance.hazardWarning,
          updatedAt: guidance.updatedAt,
        },
      });
    } catch (error) {
      if (error instanceof RouteError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }
      console.error('Lỗi khi lấy hướng dẫn AI cho KTV:', error);
      res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy hướng dẫn AI.' });
    }
  }
);

// GET /api/tickets/:id/timeline - Lấy tiến độ thời gian thực & SLA chi tiết của sự cố
router.get(
  '/:id/timeline',
  authenticateJWT,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ticketId = getParamAsString(req.params.id);
      const ticket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        include: {
          resident: { select: { fullName: true, apartmentCode: true, phone: true } },
          assignedTech: { select: { fullName: true, specialtyLabel: true, phone: true } },
          statusLogs: {
            include: { changedBy: { select: { fullName: true, role: true } } },
            orderBy: { createdAt: 'asc' },
          },
          slaTracking: true,
          area: true,
        },
      });

      if (!ticket) {
        res.status(404).json({ success: false, message: 'Không tìm thấy sự cố.' });
        return;
      }

      // Kiểm tra quyền truy cập theo vai trò
      if (req.user?.role === Role.RESIDENT && ticket.residentId && ticket.residentId !== req.user.userId) {
        res.status(403).json({ success: false, message: 'Bạn không có quyền xem tiến độ sự cố này.' });
        return;
      }

      const timeline = buildIncidentTimeline(ticket, { role: req.user?.role as any });
      res.status(200).json({ success: true, timeline });
    } catch (error) {
      console.error('Lỗi khi lấy timeline sự cố:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải dòng thời gian sự cố.' });
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

      const ticket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          ticketCode: true,
          title: true,
          locationNote: true,
          residentId: true,
          assignedTechId: true,
          status: true,
          aiSuggestedCategory: true,
          aiSuggestedPriority: true,
        },
      });
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

      // Không cho bỏ qua bước bắt buộc: KTV phải xác nhận "Tôi đã đến" (GPS + ảnh Camera) trước khi hoàn thành
      const arrivalProof = await prisma.ticketStatusLog.findFirst({
        where: {
          ticketId,
          OR: [{ title: { contains: 'đến hiện trường' } }, { note: { contains: '[ĐẾN HIỆN TRƯỜNG]' } }],
        },
        select: { id: true },
      });
      if (!arrivalProof) {
        res.status(409).json({
          success: false,
          message: 'Bạn cần xác nhận "Tôi đã đến" tại hiện trường (kèm ảnh Camera) trước khi hoàn thành sửa chữa.',
        });
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
        if (ticket.residentId) {
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
        }
        return tx.incidentTicket.findUniqueOrThrow({
          where: { id: ticketId },
          select: {
            ...INCIDENT_TICKET_BASE_SELECT,
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

      const ticket = await prisma.incidentTicket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          ticketCode: true,
          title: true,
          locationNote: true,
          residentId: true,
          assignedTechId: true,
          status: true,
          aiSuggestedCategory: true,
          aiSuggestedPriority: true,
        },
      });
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
          select: {
            ...INCIDENT_TICKET_BASE_SELECT,
            statusLogs: { orderBy: { createdAt: 'asc' } },
          },
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

// 12. POST /api/tickets/transcribe-voice - Chuyển đổi giọng nói tiếng Việt thành văn bản
// Hỗ trợ cả Cư dân đã đăng nhập và Khách vãng lai báo cáo sự cố qua QR
// ============================================================================
router.post('/transcribe-voice', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { audioBase64, mimeType } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({ success: false, message: 'Thiếu dữ liệu âm thanh ghi âm (audioBase64)!' });
      return;
    }

    const cleanBase64 = audioBase64.replace(/^data:audio\/[^,]+;base64,/i, '').trim();
    if (!cleanBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64) || cleanBase64.length % 4 === 1) {
      res.status(400).json({ success: false, message: 'Dữ liệu ghi âm trống hoặc không hợp lệ. Vui lòng ghi lại.' });
      return;
    }
    const declared = typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : '';
    const format = recordingMimeType(Buffer.from(cleanBase64, 'base64'), declared);
    if (!format) {
      res.status(422).json({ success: false, code: 'INVALID_RECORDING', message: 'File ghi âm chưa hoàn chỉnh hoặc sai định dạng. Hãy ghi lại và bấm dừng sau khi nói xong.' });
      return;
    }
    const result = await transcribeAudioWithGemini(cleanBase64, format);

    res.status(200).json({
      success: true,
      text: result.text,
      latencyMs: result.latencyMs,
      mode: result.mode,
    });
  } catch (error) {
    if (error instanceof TranscriptionError) {
      res.status(error.status).json({ success: false, code: error.code, message: error.message });
      return;
    }
    res.status(500).json({ success: false, message: 'Lỗi server khi chuyển đổi giọng nói.' });
  }
});

export default router;
