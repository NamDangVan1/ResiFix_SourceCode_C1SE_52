-- Migration: 20261106_otp_and_activation
-- Mục tiêu: Bổ sung cờ kích hoạt tài khoản isActivated và bảng lưu trữ OTP bảo mật OtpVerification

-- 1. Bổ sung trường isActivated và tokenVersion cho bảng User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActivated" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- 2. Tạo bảng lưu trữ mã OTP xác thực
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

-- 3. Tạo các chỉ mục tối ưu truy vấn theo email, purpose và thời gian hết hạn
CREATE INDEX IF NOT EXISTS "OtpVerification_email_purpose_idx" ON "OtpVerification"("email", "purpose");
CREATE INDEX IF NOT EXISTS "OtpVerification_expiresAt_idx" ON "OtpVerification"("expiresAt");

