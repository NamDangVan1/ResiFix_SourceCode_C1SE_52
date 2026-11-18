-- ============================================================================
-- Migration chuẩn bị cho: Căn hộ, Lịch sử cư trú, Chấm công & Tính lương KTV
-- BẢN MIGRATION CHUẨN BỊ (PENDING REVIEW) - CHƯA CHẠY TRÊN DATABASE NEON
-- TUÂN THỦ: BẢO VỆ LỊCH SỬ (KHÔNG DÙNG CASCADE XÓA LỊCH SỬ), TIỀN VND DÙNG BIGINT,
-- SỐ GIỜ LÀM CHÍNH XÁC (MINUTES + NUMERIC), CHỐNG CHỒNG PHIÊN CHẤM CÔNG.
-- ============================================================================

-- 1. Bảng Thông tin Cấu hình & Liên hệ khẩn cấp
CREATE TABLE IF NOT EXISTS "SystemSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL UNIQUE,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng Căn hộ Tòa nhà
CREATE TABLE IF NOT EXISTS "Apartment" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "apartmentCode" TEXT NOT NULL UNIQUE,
    "buildingBlock" TEXT NOT NULL,
    "floorNumber" INTEGER NOT NULL,
    "roomQrCode" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'OCCUPIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bổ sung liên kết Căn hộ vào Báo cáo sự cố (IncidentTicket)
-- Cho phép NULL để tương thích 100% với các ticket cũ đã tồn tại
ALTER TABLE "IncidentTicket" ADD COLUMN IF NOT EXISTS "apartmentId" TEXT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ticket_apartment') THEN
        ALTER TABLE "IncidentTicket" ADD CONSTRAINT "fk_ticket_apartment" 
        FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- 4. Bảng Lịch sử Cư trú của Cư dân (BẢO TOÀN LỊCH SỬ - KHÔNG DÙNG CASCADE)
CREATE TABLE IF NOT EXISTS "ResidencyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_residency_user" FOREIGN KEY ("residentId") REFERENCES "User"("id") ON DELETE SET NULL,
    CONSTRAINT "fk_residency_apartment" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE RESTRICT
);

-- 5. Bảng Nhật ký Chấm công Kỹ thuật viên (Hỗ trợ nhiều ca/ngày & chống chồng phiên)
CREATE TABLE IF NOT EXISTS "AttendanceLog" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "technicianId" TEXT NOT NULL,
    "technicianName" TEXT NOT NULL,
    "date" TEXT NOT NULL, -- Định dạng YYYY-MM-DD
    "sessionIndex" INTEGER NOT NULL DEFAULT 1,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3),
    "workMinutes" INTEGER, -- Lưu chính xác số phút để tránh lỗi làm tròn số thực
    "workHours" NUMERIC(5, 2), -- Số giờ hiển thị
    "shiftScheduled" TEXT,
    "anomalyNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_attendance_tech" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT,
    CONSTRAINT "uq_attendance_tech_date_session" UNIQUE ("technicianId", "date", "sessionIndex")
);

-- 6. Bảng Yêu cầu Tăng ca (Overtime - Chống gian lận và trùng khung giờ thực tế)
CREATE TABLE IF NOT EXISTS "OvertimeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "technicianId" TEXT NOT NULL,
    "technicianName" TEXT NOT NULL,
    "ticketId" TEXT,
    "ticketCode" TEXT,
    "date" TEXT NOT NULL, -- Định dạng YYYY-MM-DD
    "fromTime" TEXT NOT NULL, -- HH:mm
    "toTime" TEXT NOT NULL, -- HH:mm
    "durationMinutes" INTEGER NOT NULL,
    "requestedHours" NUMERIC(4, 2) NOT NULL,
    "approvedHours" NUMERIC(4, 2),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_ot_tech" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE RESTRICT,
    CONSTRAINT "fk_ot_ticket" FOREIGN KEY ("ticketId") REFERENCES "IncidentTicket"("id") ON DELETE SET NULL,
    CONSTRAINT "fk_ot_reviewer" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL
);

-- 7. Bảng Khóa Bảng lương Hàng tháng (Tiền lương dùng BIGINT để tránh sai số thập phân)
CREATE TABLE IF NOT EXISTS "MonthlyPayrollLock" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "month" TEXT NOT NULL UNIQUE, -- YYYY-MM
    "totalPayout" BIGINT NOT NULL, -- Tổng tiền chi trả (VND) chính xác tuyệt đối
    "lockedById" TEXT,
    "lockedByName" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditNote" TEXT,
    CONSTRAINT "fk_payroll_lock_user" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL
);

-- ============================================================================
-- CÁC BẢNG CHO 3 MODULE MỚI: ĐỔI CA/XIN NGHỈ, CHI PHÍ VẬT TƯ & THEO DÕI SLA
-- ============================================================================

-- 8. Bảng Yêu cầu Đổi ca & Xin nghỉ phép Kỹ thuật viên
CREATE TABLE IF NOT EXISTS "ShiftScheduleRequest" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL, -- LEAVE, SHIFT_SWAP
    "techId" TEXT NOT NULL,
    "techName" TEXT NOT NULL,
    "date" TEXT NOT NULL, -- YYYY-MM-DD
    "endDate" TEXT,
    "leaveType" TEXT, -- ANNUAL, SICK, UNPAID
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
    CONSTRAINT "fk_sched_tech" FOREIGN KEY ("techId") REFERENCES "User"("id") ON DELETE RESTRICT,
    CONSTRAINT "fk_sched_target_tech" FOREIGN KEY ("targetTechId") REFERENCES "User"("id") ON DELETE SET NULL,
    CONSTRAINT "fk_sched_reviewer" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL
);

-- 9. Bảng Hồ sơ Chi phí sửa chữa gắn với sự cố (VND dùng BIGINT)
CREATE TABLE IF NOT EXISTS "RepairMaterialCost" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "ticketId" TEXT NOT NULL UNIQUE,
    "ticketCode" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "proposedByName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, PENDING, APPROVED, REJECTED
    "otherCost" BIGINT NOT NULL DEFAULT 0,
    "totalCost" BIGINT NOT NULL,
    "receiptProofUrl" TEXT,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_cost_ticket" FOREIGN KEY ("ticketId") REFERENCES "IncidentTicket"("id") ON DELETE RESTRICT,
    CONSTRAINT "fk_cost_proposer" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT,
    CONSTRAINT "fk_cost_reviewer" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL
);

-- 10. Bảng Chi tiết Danh mục vật tư
CREATE TABLE IF NOT EXISTS "MaterialItem" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "costId" TEXT NOT NULL,
    "materialCode" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "totalPrice" BIGINT NOT NULL,
    "notes" TEXT,
    CONSTRAINT "fk_item_cost" FOREIGN KEY ("costId") REFERENCES "RepairMaterialCost"("id") ON DELETE CASCADE
);

-- 11. Bảng Theo dõi Tiến độ Cam kết Dịch vụ (SLA) & Leo thang sự cố
CREATE TABLE IF NOT EXISTS "SlaTracking" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "ticketId" TEXT NOT NULL UNIQUE,
    "ticketCode" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseDeadline" TIMESTAMP(3) NOT NULL,
    "assignmentDeadline" TIMESTAMP(3) NOT NULL,
    "resolutionDeadline" TIMESTAMP(3) NOT NULL,
    "slaStatus" TEXT NOT NULL DEFAULT 'ON_TRACK', -- ON_TRACK, AT_RISK, BREACHED
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pauseReason" TEXT,
    "pausedAt" TIMESTAMP(3),
    "escalationTier" INTEGER NOT NULL DEFAULT 0,
    "lastAlertSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fk_sla_ticket" FOREIGN KEY ("ticketId") REFERENCES "IncidentTicket"("id") ON DELETE RESTRICT
);

-- 12. Tạo chỉ mục tối ưu truy vấn
CREATE INDEX IF NOT EXISTS "idx_apartment_block_floor" ON "Apartment"("buildingBlock", "floorNumber");
CREATE INDEX IF NOT EXISTS "idx_residency_apartment" ON "ResidencyRecord"("apartmentId");
CREATE INDEX IF NOT EXISTS "idx_residency_resident" ON "ResidencyRecord"("residentId");
CREATE INDEX IF NOT EXISTS "idx_attendance_tech_date" ON "AttendanceLog"("technicianId", "date");
CREATE INDEX IF NOT EXISTS "idx_ot_tech_date" ON "OvertimeRequest"("technicianId", "date");
CREATE INDEX IF NOT EXISTS "idx_ticket_apartment" ON "IncidentTicket"("apartmentId");
CREATE INDEX IF NOT EXISTS "idx_sched_tech_date" ON "ShiftScheduleRequest"("techId", "date");
CREATE INDEX IF NOT EXISTS "idx_material_cost" ON "MaterialItem"("costId");
CREATE INDEX IF NOT EXISTS "idx_sla_status_tier" ON "SlaTracking"("slaStatus", "escalationTier");

-- ============================================================================
-- PHƯƠNG ÁN ROLLBACK (NẾU CẦN HỦY BỎ):
-- DROP TABLE IF EXISTS "SlaTracking";
-- DROP TABLE IF EXISTS "MaterialItem";
-- DROP TABLE IF EXISTS "RepairMaterialCost";
-- DROP TABLE IF EXISTS "ShiftScheduleRequest";
-- ALTER TABLE "IncidentTicket" DROP CONSTRAINT IF EXISTS "fk_ticket_apartment";
-- ALTER TABLE "IncidentTicket" DROP COLUMN IF EXISTS "apartmentId";
-- DROP TABLE IF EXISTS "MonthlyPayrollLock";
-- DROP TABLE IF EXISTS "OvertimeRequest";
-- DROP TABLE IF EXISTS "AttendanceLog";
-- DROP TABLE IF EXISTS "ResidencyRecord";
-- DROP TABLE IF EXISTS "Apartment";
-- DROP TABLE IF EXISTS "SystemSetting";
-- ============================================================================
