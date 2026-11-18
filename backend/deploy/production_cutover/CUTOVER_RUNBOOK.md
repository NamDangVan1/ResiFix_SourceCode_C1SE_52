# SỔ TAY HƯỚNG DẪN TRIỂN KHAI CUTOVER NEON PRODUCTION (CUTOVER RUNBOOK)

---

## I. TỔNG QUAN BỘ CÔNG CỤ CUTOVER

Tất cả các tài nguyên phục vụ triển khai chính thức đã được kiểm thử, đóng gói độc lập trong thư mục:
`backend/deploy/production_cutover/`

| STT | File / Script | Vai trò & Mục đích | Trạng thái |
| :---: | :--- | :--- | :---: |
| 1 | [`01_production_cutover_migration.sql`](file:///d:/Capstone/ResiFix_SourceCode_C1SE_52/backend/deploy/production_cutover/01_production_cutover_migration.sql) | Script SQL đồng bộ 11 bảng, 4 cột, index & khóa ngoại | Sẵn sàng |
| 2 | [`02_import_production_baseline_data.ts`](file:///d:/Capstone/ResiFix_SourceCode_C1SE_52/backend/deploy/production_cutover/02_import_production_baseline_data.ts) | Nạp 75 Căn hộ chuẩn và 4 Cấu hình SystemSetting | Đã test Dry-run |
| 3 | [`03_pre_migration_check.ts`](file:///d:/Capstone/ResiFix_SourceCode_C1SE_52/backend/deploy/production_cutover/03_pre_migration_check.ts) | Kiểm tra điều kiện tiên quyết trước migration | Đã chạy PASS 100% |
| 4 | [`04_post_migration_check.ts`](file:///d:/Capstone/ResiFix_SourceCode_C1SE_52/backend/deploy/production_cutover/04_post_migration_check.ts) | Thẩm định 17 bảng và tính toàn vẹn dữ liệu sau migration | Sẵn sàng |
| 5 | [`05_execute_production_cutover.ts`](file:///d:/Capstone/ResiFix_SourceCode_C1SE_52/backend/deploy/production_cutover/05_execute_production_cutover.ts) | Runner thực thi chính thức (Yêu cầu cờ xác nhận an toàn) | Sẵn sàng |
| 6 | [`ROLLBACK_AND_BACKUP_GUIDE.md`](file:///d:/Capstone/ResiFix_SourceCode_C1SE_52/backend/deploy/production_cutover/ROLLBACK_AND_BACKUP_GUIDE.md) | Tài liệu hướng dẫn sao lưu snapshot & khôi phục rollback | Sẵn sàng |

---

## II. QUY TRÌNH THỰC HIỆN CUTOVER (6 BƯỚC CHUẨN)

### BƯỚC 1: SAO LƯU NEON PRODUCTION (BẮT BUỘC)
Tạo branch snapshot trên [Neon Console](https://console.neon.tech) từ branch `main`:
- Tên snapshot: `backup-pre-cutover-20261111`
- Mục đích: Đảm bảo khả năng Time Travel khôi phục tức thời nếu xảy ra sự cố mạng.

---

### BƯỚC 2: CHẠY KIỂM TRA ĐIỀU KIỆN TIỀN MIGRATION (PRE-CHECK)
Chạy script kiểm tra ở chế độ Read-only:
```bash
npx --prefix backend ts-node backend/deploy/production_cutover/03_pre_migration_check.ts
```
*Kết quả kỳ vọng*:
- Xác nhận Target: `ep-calm-block-ao4yq1h0-pooler...`
- 4 User, 16 Ticket, 35 Media, 71 Log, 548 Notification, 5 Area nguyên vẹn.
- In thông báo: `✅ PRE-MIGRATION CHECK: ĐẠT YÊU CẦU 100%!`.

---

### BƯỚC 3: THỰC THI SQL MIGRATION TRÊN PRODUCTION
Chạy script thực thi migration an toàn kèm cờ xác nhận:
```bash
npx --prefix backend ts-node backend/deploy/production_cutover/05_execute_production_cutover.ts --confirm-cutover-production
```
*Các tác vụ tự động thực hiện*:
1. Thực thi `01_production_cutover_migration.sql` trong 1 Transaction.
2. Thêm 3 cột trên bảng `User`: `isActivated` (DEFAULT true), `mustChangePassword`, `tokenVersion`.
3. Thêm cột `apartmentId` trên bảng `IncidentTicket`.
4. Tạo 11 bảng: `SystemSetting`, `Apartment`, `ResidencyRecord`, `AttendanceLog`, `OvertimeRequest`, `MonthlyPayrollLock`, `ShiftScheduleRequest`, `RepairMaterialCost`, `MaterialItem`, `SlaTracking`, `OtpVerification`.
5. Tạo toàn bộ Index & Khóa ngoại tham chiếu an toàn.
6. Ghi nhận lịch sử migration vào `_prisma_migrations`.

---

### BƯỚC 4: NẠP DỮ LIỆU NỀN TẢNG (75 CĂN HỘ & 4 CẤU HÌNH)
Nạp dữ liệu chuẩn với cơ chế chống trùng lặp:
```bash
npx --prefix backend ts-node backend/deploy/production_cutover/02_import_production_baseline_data.ts --execute
```
*Các tác vụ tự động thực hiện*:
1. Nạp danh mục 75 căn hộ chuẩn tòa G, F, E (`ON CONFLICT ("apartmentCode") DO NOTHING`).
2. Nạp 4 bản ghi cấu hình `SystemSetting` (`emergency_contact`, `payroll_config`, `cost_config`, `sla_config`).

---

### BƯỚC 5: KIỂM TRA TOÀN DIỆN HẬU MIGRATION (POST-CHECK)
Chạy script thẩm định sau triển khai:
```bash
npx --prefix backend ts-node backend/deploy/production_cutover/04_post_migration_check.ts
```
*Kết quả kỳ vọng*:
- Đầy đủ 17 bảng trong schema.
- Toàn bộ 4 tài khoản cũ có `isActivated = true` (không bị gián đoạn đăng nhập).
- 75 căn hộ và 4 cấu hình đã nạp thành công.
- 0 lỗi phát sinh.

---

### BƯỚC 6: KHỞI ĐỘNG CHÍNH THỨC HỆ THỐNG VẬN HÀNH (GO-LIVE)
Khởi động Backend chính thức bằng cấu hình `backend/.env` (Production):
```bash
npm --prefix backend run dev
# Hoặc chế độ Production Server:
# npm --prefix backend run build && npm --prefix backend start
```
Thực hiện Smoke Test trên Frontend:
1. Đăng nhập Ban Quản Lý: `myhanh.bmb@resifix.vn` $\rightarrow$ Kiểm tra danh sách Căn hộ & Quản lý Sự cố.
2. Đăng nhập Kỹ thuật viên: `0913402803` $\rightarrow$ Kiểm tra Chấm công & Nhận việc.
3. Thử nghiệm Báo cáo sự cố quét mã QR và tạo yêu cầu.

