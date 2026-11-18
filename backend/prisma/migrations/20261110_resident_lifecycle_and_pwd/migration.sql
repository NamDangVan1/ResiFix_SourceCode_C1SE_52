-- Migration: 20261110_resident_lifecycle_and_pwd
-- Mô tả: Bổ sung cờ mustChangePassword trên bảng User và vai trò cư trú residencyRole trên bảng ResidencyRecord
-- An toàn: Dùng cú pháp IF NOT EXISTS, không khóa bảng, không mất dữ liệu cũ

-- 1. Bổ sung cờ bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên cho người dùng
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- 2. Bổ sung vai trò cư trú (OWNER, TENANT, MEMBER) trên bảng lịch sử cư trú
ALTER TABLE "ResidencyRecord" ADD COLUMN IF NOT EXISTS "residencyRole" TEXT NOT NULL DEFAULT 'TENANT';

