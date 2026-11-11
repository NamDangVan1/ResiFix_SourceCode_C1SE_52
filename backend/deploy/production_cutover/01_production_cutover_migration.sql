-- ============================================================================
-- RESIFIX PRODUCTION CUTOVER MIGRATION SCRIPT
-- Mục tiêu: Đồng bộ hóa toàn bộ 11 bảng còn thiếu và 4 cột mới lên Neon PRODUCTION
-- Nguyên tắc: 
--   1. AN TOÀN TUYỆT ĐỐI - KHÔNG DROP BẢNG, KHÔNG XÓA DỮ LIỆU CŨ.
--   2. BẢO VỆ 4 USER, 16 TICKET, 35 MEDIA, 71 STATUS LOG, 548 NOTI, 5 AREA.
--   3. TOÀN BỘ LỆNH ĐỀU CÓ 'IF NOT EXISTS' - CHẠY NHIỀU LẦN AN TOÀN (IDEMPOTENT).
--   4. TƯƠNG THÍCH 100% VỚI PRISMA 5.22.0 VÀ POSTGRESQL 18+.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PHẦN 1: BỔ SUNG CỘT CHO CÁC BẢNG HIỆN HỮU (USER & INCIDENTTICKET)
-- ============================================================================

-- 1.1 Bảng User: Bổ sung 3 cột (Đặt DEFAULT true cho isActivated để không khóa tài khoản cũ)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActivated" BOOLEAN NOT NULL DEFAULT true;
-- Sau khi gán true cho 4 tài khoản cũ hiện có, chuyển DEFAULT về false để tuân thủ schema.prisma cho tài khoản tạo mới
ALTER TABLE "User" ALTER COLUMN "isActivated" SET DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Chỉ mục tối ưu cho User
CREATE INDEX IF NOT EXISTS "User_role_isOnDuty_idx" ON "User"("role", "isOnDuty");
CREATE INDEX IF NOT EXISTS "User_apartmentCode_idx" ON "User"("apartmentCode");

-- 1.2 Bảng IncidentTicket: Bổ sung cột apartmentId (nullable để không ảnh hưởng 16 ticket cũ)
ALTER TABLE "IncidentTicket" ADD COLUMN IF NOT EXISTS "apartmentId" TEXT;

-- ============================================================================
-- PHẦN 2: TẠO 11 BẢNG MỚI THEO SCHEMA.PRISMA
-- ============================================================================

-- 2.1 Bảng SystemSetting (Lưu cấu hình hệ thống, liên hệ khẩn cấp, tọa độ Duy Tân)
CREATE TABLE IF NOT EXISTS "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SystemSetting_key_key" ON "SystemSetting"("key");

-- 2.2 Bảng Apartment (Danh mục căn hộ tòa nhà)
CREATE TABLE IF NOT EXISTS "Apartment" (
    "id" TEXT NOT NULL,
    "apartmentCode" TEXT NOT NULL,
    "buildingBlock" TEXT NOT NULL,
    "floorNumber" INTEGER NOT NULL,
    "roomQrCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OCCUPIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Apartment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Apartment_apartmentCode_key" ON "Apartment"("apartmentCode");
CREATE UNIQUE INDEX IF NOT EXISTS "Apartment_roomQrCode_key" ON "Apartment"("roomQrCode");
CREATE INDEX IF NOT EXISTS "Apartment_buildingBlock_floorNumber_idx" ON "Apartment"("buildingBlock", "floorNumber");

-- 2.3 Bảng ResidencyRecord (Lịch sử cư trú của Cư dân - Bảo toàn dữ liệu, không cascade)
CREATE TABLE IF NOT EXISTS "ResidencyRecord" (
    "id" TEXT NOT NULL,
    "residentId" TEXT,
    "residentName" TEXT NOT NULL,
    "residentPhone" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "apartmentCode" TEXT NOT NULL,
    "buildingBlock" TEXT NOT NULL,
    "floorNumber" INTEGER NOT NULL,
    "moveInDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moveOutDate" TIMESTAMP(3),
    "isRepresentative" BOOLEAN NOT NULL DEFAULT false,
    "residencyRole" TEXT NOT NULL DEFAULT 'TENANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResidencyRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ResidencyRecord_apartmentId_idx" ON "ResidencyRecord"("apartmentId");
CREATE INDEX IF NOT EXISTS "ResidencyRecord_residentId_idx" ON "ResidencyRecord"("residentId");

-- 2.4 Bảng AttendanceLog (Nhật ký chấm công Kỹ thuật viên)
CREATE TABLE IF NOT EXISTS "AttendanceLog" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "technicianName" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sessionIndex" INTEGER NOT NULL DEFAULT 1,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3),
    "workMinutes" INTEGER,
    "workHours" DECIMAL(5,2),
    "shiftScheduled" TEXT,
    "anomalyNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AttendanceLog_technicianId_date_idx" ON "AttendanceLog"("technicianId", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceLog_technicianId_date_sessionIndex_key" ON "AttendanceLog"("technicianId", "date", "sessionIndex");

-- 2.5 Bảng OvertimeRequest (Đăng ký tăng ca KTV & BMB xét duyệt)
CREATE TABLE IF NOT EXISTS "OvertimeRequest" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "technicianName" TEXT NOT NULL,
    "ticketId" TEXT,
    "ticketCode" TEXT,
    "date" TEXT NOT NULL,
    "fromTime" TEXT NOT NULL,
    "toTime" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "requestedHours" DECIMAL(4,2) NOT NULL,
    "approvedHours" DECIMAL(4,2),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OvertimeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OvertimeRequest_technicianId_date_idx" ON "OvertimeRequest"("technicianId", "date");

-- 2.6 Bảng MonthlyPayrollLock (Khóa bảng lương hàng tháng)
CREATE TABLE IF NOT EXISTS "MonthlyPayrollLock" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "totalPayout" BIGINT NOT NULL,
    "lockedById" TEXT,
    "lockedByName" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditNote" TEXT,

    CONSTRAINT "MonthlyPayrollLock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyPayrollLock_month_key" ON "MonthlyPayrollLock"("month");

-- 2.7 Bảng ShiftScheduleRequest (Đổi ca / Xin nghỉ ca của KTV)
CREATE TABLE IF NOT EXISTS "ShiftScheduleRequest" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "techId" TEXT NOT NULL,
    "techName" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "endDate" TEXT,
    "leaveType" TEXT,
    "shiftName" TEXT,
    "targetTechId" TEXT,
    "targetTechName" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftScheduleRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ShiftScheduleRequest_techId_date_idx" ON "ShiftScheduleRequest"("techId", "date");

-- 2.8 Bảng RepairMaterialCost (Dự toán & Hồ sơ chi phí sửa chữa)
CREATE TABLE IF NOT EXISTS "RepairMaterialCost" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketCode" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "proposedByName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "otherCost" BIGINT NOT NULL DEFAULT 0,
    "totalCost" BIGINT NOT NULL,
    "receiptProofUrl" TEXT,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairMaterialCost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RepairMaterialCost_ticketId_key" ON "RepairMaterialCost"("ticketId");

-- 2.9 Bảng MaterialItem (Chi tiết từng hạng mục vật tư)
CREATE TABLE IF NOT EXISTS "MaterialItem" (
    "id" TEXT NOT NULL,
    "costId" TEXT NOT NULL,
    "materialCode" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "totalPrice" BIGINT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "MaterialItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MaterialItem_costId_idx" ON "MaterialItem"("costId");

-- 2.10 Bảng SlaTracking (Tiến độ cam kết dịch vụ & leo thang sự cố)
CREATE TABLE IF NOT EXISTS "SlaTracking" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ticketCode" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseDeadline" TIMESTAMP(3) NOT NULL,
    "assignmentDeadline" TIMESTAMP(3) NOT NULL,
    "resolutionDeadline" TIMESTAMP(3) NOT NULL,
    "slaStatus" TEXT NOT NULL DEFAULT 'ON_TRACK',
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pauseReason" TEXT,
    "pausedAt" TIMESTAMP(3),
    "escalationTier" INTEGER NOT NULL DEFAULT 0,
    "lastAlertSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaTracking_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SlaTracking_ticketId_key" ON "SlaTracking"("ticketId");
CREATE INDEX IF NOT EXISTS "SlaTracking_slaStatus_escalationTier_idx" ON "SlaTracking"("slaStatus", "escalationTier");

-- 2.11 Bảng OtpVerification (Lưu trữ và xác thực mã OTP bảo mật)
CREATE TABLE IF NOT EXISTS "OtpVerification" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpVerification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OtpVerification_email_purpose_idx" ON "OtpVerification"("email", "purpose");
CREATE INDEX IF NOT EXISTS "OtpVerification_expiresAt_idx" ON "OtpVerification"("expiresAt");

-- ============================================================================
-- PHẦN 3: BỔ SUNG CÁC RÀNG BUỘC KHÓA NGOẠI (FOREIGN KEYS)
-- ============================================================================

-- IncidentTicket -> Apartment
ALTER TABLE "IncidentTicket" DROP CONSTRAINT IF EXISTS "IncidentTicket_apartmentId_fkey";
ALTER TABLE "IncidentTicket" ADD CONSTRAINT "IncidentTicket_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ResidencyRecord -> User & Apartment
ALTER TABLE "ResidencyRecord" DROP CONSTRAINT IF EXISTS "ResidencyRecord_residentId_fkey";
ALTER TABLE "ResidencyRecord" ADD CONSTRAINT "ResidencyRecord_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ResidencyRecord" DROP CONSTRAINT IF EXISTS "ResidencyRecord_apartmentId_fkey";
ALTER TABLE "ResidencyRecord" ADD CONSTRAINT "ResidencyRecord_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AttendanceLog -> User
ALTER TABLE "AttendanceLog" DROP CONSTRAINT IF EXISTS "AttendanceLog_technicianId_fkey";
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- OvertimeRequest -> User & IncidentTicket
ALTER TABLE "OvertimeRequest" DROP CONSTRAINT IF EXISTS "OvertimeRequest_technicianId_fkey";
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OvertimeRequest" DROP CONSTRAINT IF EXISTS "OvertimeRequest_ticketId_fkey";
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "IncidentTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OvertimeRequest" DROP CONSTRAINT IF EXISTS "OvertimeRequest_reviewedById_fkey";
ALTER TABLE "OvertimeRequest" ADD CONSTRAINT "OvertimeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- MonthlyPayrollLock -> User
ALTER TABLE "MonthlyPayrollLock" DROP CONSTRAINT IF EXISTS "MonthlyPayrollLock_lockedById_fkey";
ALTER TABLE "MonthlyPayrollLock" ADD CONSTRAINT "MonthlyPayrollLock_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ShiftScheduleRequest -> User
ALTER TABLE "ShiftScheduleRequest" DROP CONSTRAINT IF EXISTS "ShiftScheduleRequest_techId_fkey";
ALTER TABLE "ShiftScheduleRequest" ADD CONSTRAINT "ShiftScheduleRequest_techId_fkey" FOREIGN KEY ("techId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShiftScheduleRequest" DROP CONSTRAINT IF EXISTS "ShiftScheduleRequest_targetTechId_fkey";
ALTER TABLE "ShiftScheduleRequest" ADD CONSTRAINT "ShiftScheduleRequest_targetTechId_fkey" FOREIGN KEY ("targetTechId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShiftScheduleRequest" DROP CONSTRAINT IF EXISTS "ShiftScheduleRequest_reviewedById_fkey";
ALTER TABLE "ShiftScheduleRequest" ADD CONSTRAINT "ShiftScheduleRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RepairMaterialCost -> IncidentTicket & User
ALTER TABLE "RepairMaterialCost" DROP CONSTRAINT IF EXISTS "RepairMaterialCost_ticketId_fkey";
ALTER TABLE "RepairMaterialCost" ADD CONSTRAINT "RepairMaterialCost_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "IncidentTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RepairMaterialCost" DROP CONSTRAINT IF EXISTS "RepairMaterialCost_proposedById_fkey";
ALTER TABLE "RepairMaterialCost" ADD CONSTRAINT "RepairMaterialCost_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RepairMaterialCost" DROP CONSTRAINT IF EXISTS "RepairMaterialCost_reviewedById_fkey";
ALTER TABLE "RepairMaterialCost" ADD CONSTRAINT "RepairMaterialCost_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- MaterialItem -> RepairMaterialCost
ALTER TABLE "MaterialItem" DROP CONSTRAINT IF EXISTS "MaterialItem_costId_fkey";
ALTER TABLE "MaterialItem" ADD CONSTRAINT "MaterialItem_costId_fkey" FOREIGN KEY ("costId") REFERENCES "RepairMaterialCost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SlaTracking -> IncidentTicket
ALTER TABLE "SlaTracking" DROP CONSTRAINT IF EXISTS "SlaTracking_ticketId_fkey";
ALTER TABLE "SlaTracking" ADD CONSTRAINT "SlaTracking_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "IncidentTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

