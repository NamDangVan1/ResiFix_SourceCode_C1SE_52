# HƯỚNG DẪN SAO LƯU (BACKUP) VÀ PHỤC HỒI (ROLLBACK) NEON PRODUCTION

Tài liệu này cung cấp quy trình kỹ thuật tiêu chuẩn để sao lưu dự phòng và phục hồi an toàn tuyệt đối cơ sở dữ liệu Neon PostgreSQL Production trước, trong và sau cutover.

---

## I. QUY TRÌNH SAO LƯU DỰ PHÒNG (BACKUP)

Trước khi thực thi bất kỳ thao tác migration hoặc nạp dữ liệu nào trên Production, hãy thực hiện một trong hai phương án sao lưu dưới đây:

### Phương án 1: Sao lưu tức thời trên Neon Console (Khuyến nghị - Nhanh nhất)
1. Đăng nhập vào [Neon Console](https://console.neon.tech).
2. Chọn Project: `resifix`.
3. Vào tab **Branches** $\rightarrow$ Chọn branch chính: `main` (Production).
4. Nhấn **Create Branch** hoặc **Create Snapshot**:
   - Tên branch sao lưu: `backup-pre-cutover-20261111`
   - Gốc (Parent branch): `main`
5. *Ưu điểm*: Tạo bản sao lưu toàn vẹn (Copy-on-write snapshot) trong vòng 2 giây, không tốn thêm dung lượng lưu trữ, cho phép khôi phục tức thì tại đúng thời điểm (Point-in-Time Restore).

### Phương án 2: Xuất file dump qua công cụ `pg_dump`
Nếu bạn có cài đặt `pg_dump` trên máy hoặc server:
```bash
pg_dump "<DATABASE_URL_PRODUCTION>" \
  --format=custom \
  --file="resifix_production_backup_20261111.dump" \
  --verbose
```
*Lưu ý*: Bảo mật file `.dump` và không đẩy lên Git public repository.

---

## II. QUY TRÌNH PHỤC HỒI (ROLLBACK)

Trong trường hợp cutover gặp sự cố không mong muốn hoặc cần quay lại trạng thái ban đầu:

### Phương án 1: Rollback tức thì qua Neon Branch (Khuyến nghị)
1. Trên Neon Console $\rightarrow$ Project `resifix`.
2. Tạo branch mới từ `backup-pre-cutover-20261111` hoặc khôi phục `main` về thời điểm trước cutover qua tính năng **Time Travel / Point-in-Time Restore**.
3. Cập nhật lại connection string trong `backend/.env` nếu có thay đổi endpoint.

### Phương án 2: Rollback bằng SQL Script (Xóa các thành phần mới, giữ nguyên 100% dữ liệu cũ)
Nếu migration đã chạy nhưng cần gỡ bỏ các bảng và cột mới mà **không làm mất 4 User, 16 IncidentTicket, 35 TicketMedia, 71 StatusLog, 548 Notification và 5 BuildingArea**, thực thi đoạn SQL sau:

```sql
BEGIN;

-- 1. Gỡ khóa ngoại liên kết với bảng mới trên IncidentTicket
ALTER TABLE "IncidentTicket" DROP CONSTRAINT IF EXISTS "IncidentTicket_apartmentId_fkey";
ALTER TABLE "IncidentTicket" DROP COLUMN IF EXISTS "apartmentId";

-- 2. Gỡ 3 cột mới trên bảng User
ALTER TABLE "User" DROP COLUMN IF EXISTS "isActivated";
ALTER TABLE "User" DROP COLUMN IF EXISTS "mustChangePassword";
ALTER TABLE "User" DROP COLUMN IF EXISTS "tokenVersion";

-- 3. Xóa các chỉ mục mới
DROP INDEX IF EXISTS "User_role_isOnDuty_idx";
DROP INDEX IF EXISTS "User_apartmentCode_idx";

-- 4. Xóa 11 bảng mới theo thứ tự khóa ngoại phụ thuộc (Không chạm vào 6 bảng gốc)
DROP TABLE IF EXISTS "MaterialItem" CASCADE;
DROP TABLE IF EXISTS "RepairMaterialCost" CASCADE;
DROP TABLE IF EXISTS "SlaTracking" CASCADE;
DROP TABLE IF EXISTS "ShiftScheduleRequest" CASCADE;
DROP TABLE IF EXISTS "MonthlyPayrollLock" CASCADE;
DROP TABLE IF EXISTS "OvertimeRequest" CASCADE;
DROP TABLE IF EXISTS "AttendanceLog" CASCADE;
DROP TABLE IF EXISTS "ResidencyRecord" CASCADE;
DROP TABLE IF EXISTS "Apartment" CASCADE;
DROP TABLE IF EXISTS "SystemSetting" CASCADE;
DROP TABLE IF EXISTS "OtpVerification" CASCADE;

-- 5. Xóa các bản ghi migration mới trong _prisma_migrations (giữ nguyên 0_init)
DELETE FROM "_prisma_migrations" 
WHERE migration_name IN (
    '0_baseline',
    '20261105_apartments_and_payroll',
    '20261106_otp_and_activation',
    '20261110_resident_lifecycle_and_pwd'
);

COMMIT;
```

---

## III. NGUYÊN TẮC AN TOÀN TUYỆT ĐỐI
- Tuyệt đối không xóa 6 bảng cốt lõi: `User`, `BuildingArea`, `IncidentTicket`, `TicketMedia`, `TicketStatusLog`, `Notification`.
- Mọi thao tác đều thực hiện trong khối giao dịch `BEGIN; ... COMMIT;`.

