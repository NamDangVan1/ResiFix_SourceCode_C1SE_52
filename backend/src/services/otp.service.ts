import crypto from 'crypto';
import { prisma } from '../db';
import { resiFixStore } from '../data/resifix_store';

export type OtpPurpose = 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET';

export interface OtpRecord {
  id: string;
  email: string;
  otpHash: string;
  purpose: OtpPurpose;
  expiresAt: string; // ISO String
  attempts: number;
  isUsed: boolean;
  createdAt: string; // ISO String
}

export class OtpServiceError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode: number = 400) {
    super(message);
    this.name = 'OtpServiceError';
  }
}

// Bộ nhớ đệm fallback lưu OTP (trong trường hợp bảng OtpVerification chưa được migrate vào Neon DB)
const inMemoryOtpStore = new Map<string, OtpRecord>();

// Lưu mốc thời gian gửi gần nhất để giới hạn cooldown 60s
const lastOtpRequestTime = new Map<string, number>();

/**
 * Băm mã OTP bằng HMAC-SHA256 với secret của server.
 * Tuyệt đối không lưu mã OTP dạng văn bản thuần (plaintext) trong database hoặc RAM.
 */
export function hashOtp(otp: string, email: string): string {
  const secret = process.env.JWT_SECRET || 'resifix-otp-salt-secret-key-2026';
  return crypto
    .createHmac('sha256', secret)
    .update(`${email.trim().toLowerCase()}:${otp.trim()}`)
    .digest('hex');
}

/**
 * Sinh mã OTP ngẫu nhiên 6 chữ số bằng crypto.randomInt (chuẩn mã hóa mật mã học an toàn).
 */
export function generateRandom6DigitOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Kiểm tra giới hạn tần suất gửi lại OTP (tối thiểu 60 giây).
 */
export function checkResendCooldown(email: string, cooldownSeconds: number = 60): { canResend: boolean; remainingSeconds: number } {
  const key = email.trim().toLowerCase();
  const lastTime = lastOtpRequestTime.get(key);
  if (!lastTime) return { canResend: true, remainingSeconds: 0 };

  const elapsedSeconds = Math.floor((Date.now() - lastTime) / 1000);
  if (elapsedSeconds < cooldownSeconds) {
    return { canResend: false, remainingSeconds: cooldownSeconds - elapsedSeconds };
  }
  return { canResend: true, remainingSeconds: 0 };
}

/**
 * Đánh dấu thời điểm vừa gửi OTP.
 */
export function recordOtpRequestTimestamp(email: string): void {
  lastOtpRequestTime.set(email.trim().toLowerCase(), Date.now());
}

/**
 * Tạo và lưu trữ mã OTP mới cho email người nhận.
 * Mã mới sẽ tự động vô hiệu hóa tất cả các mã cũ của cùng email và cùng purpose.
 */
export async function createAndSaveOtp(
  email: string,
  purpose: OtpPurpose,
  ttlMinutes: number = 5
): Promise<{ otp: string; recordId: string; expiresAt: Date }> {
  const cleanEmail = email.trim().toLowerCase();

  // 1. Kiểm tra cooldown 60s
  const cooldown = checkResendCooldown(cleanEmail, 60);
  if (!cooldown.canResend) {
    throw new OtpServiceError(
      `Vui lòng đợi ${cooldown.remainingSeconds} giây trước khi yêu cầu gửi lại mã OTP mới.`,
      'OTP_COOLDOWN_ACTIVE',
      429
    );
  }

  // 2. Sinh mã OTP 6 số
  const rawOtp = generateRandom6DigitOtp();
  const otpHash = hashOtp(rawOtp, cleanEmail);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  const recordId = `otp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  // 3. Vô hiệu hóa các mã cũ trước đó
  for (const [key, rec] of inMemoryOtpStore.entries()) {
    if (rec.email === cleanEmail && rec.purpose === purpose && !rec.isUsed) {
      rec.isUsed = true;
    }
  }

  // 4. Lưu vào inMemoryStore
  const newRecord: OtpRecord = {
    id: recordId,
    email: cleanEmail,
    otpHash,
    purpose,
    expiresAt: expiresAt.toISOString(),
    attempts: 0,
    isUsed: false,
    createdAt: now.toISOString(),
  };
  inMemoryOtpStore.set(recordId, newRecord);

  // 5. Thử lưu vào PostgreSQL nếu bảng OtpVerification đã tồn tại
  try {
    if ((prisma as any).otpVerification) {
      // Vô hiệu hóa các OTP cũ cùng email và purpose trong DB
      await (prisma as any).otpVerification.updateMany({
        where: { email: cleanEmail, purpose, isUsed: false },
        data: { isUsed: true },
      });

      await (prisma as any).otpVerification.create({
        data: {
          id: recordId,
          email: cleanEmail,
          otpHash,
          purpose,
          expiresAt,
          attempts: 0,
          isUsed: false,
        },
      });
    }
  } catch (dbErr) {
    // Nếu bảng chưa được migrate trên DB, inMemoryStore đảm bảo hoạt động an toàn và liền mạch
    console.warn('[OtpService] Lưu OTP vào DB bỏ qua, sử dụng in-memory persistence an toàn.');
  }

  // 6. Ghi nhận mốc thời gian vừa gửi
  recordOtpRequestTimestamp(cleanEmail);

  return { otp: rawOtp, recordId, expiresAt };
}

/**
 * Xác minh mã OTP do người dùng nhập.
 * - Kiểm tra hạn 5 phút
 * - Giới hạn tối đa 5 lần nhập sai
 * - Vô hiệu hóa mã sau khi xác minh thành công (Single Use)
 */
export async function verifyOtpCode(
  email: string,
  inputOtp: string,
  purpose: OtpPurpose
): Promise<{ success: boolean; message: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanOtp = inputOtp.trim();

  if (!/^\d{6}$/.test(cleanOtp)) {
    throw new OtpServiceError('Mã OTP phải gồm chính xác 6 chữ số.', 'INVALID_OTP_FORMAT', 400);
  }

  const now = new Date();

  // 1. Tìm bản ghi OTP gần nhất còn hiệu lực
  let activeRecord: OtpRecord | null = null;

  // Thử tìm trong DB trước nếu có
  try {
    if ((prisma as any).otpVerification) {
      const dbRec = await (prisma as any).otpVerification.findFirst({
        where: { email: cleanEmail, purpose, isUsed: false },
        orderBy: { createdAt: 'desc' },
      });
      if (dbRec) {
        activeRecord = {
          id: dbRec.id,
          email: dbRec.email,
          otpHash: dbRec.otpHash,
          purpose: dbRec.purpose as OtpPurpose,
          expiresAt: dbRec.expiresAt.toISOString(),
          attempts: dbRec.attempts,
          isUsed: dbRec.isUsed,
          createdAt: dbRec.createdAt.toISOString(),
        };
      }
    }
  } catch {
    // fallback
  }

  // Nếu không thấy trong DB, tìm trong inMemoryOtpStore
  if (!activeRecord) {
    const list = Array.from(inMemoryOtpStore.values())
      .filter((r) => r.email === cleanEmail && r.purpose === purpose && !r.isUsed)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (list.length > 0) {
      activeRecord = list[0];
    }
  }

  if (!activeRecord) {
    throw new OtpServiceError(
      'Không tìm thấy mã OTP hợp lệ hoặc mã đã được sử dụng. Vui lòng yêu cầu mã mới.',
      'OTP_NOT_FOUND',
      400
    );
  }

  // 2. Kiểm tra số lần thử sai (tối đa 5 lần)
  if (activeRecord.attempts >= 5) {
    // Đánh dấu mã đã bị khóa
    activeRecord.isUsed = true;
    try {
      if ((prisma as any).otpVerification) {
        await (prisma as any).otpVerification.update({
          where: { id: activeRecord.id },
          data: { isUsed: true },
        });
      }
    } catch {
      // ignore
    }
    throw new OtpServiceError(
      'Mã OTP đã bị khóa do bạn đã nhập sai quá 5 lần. Vui lòng yêu cầu gửi lại mã mới.',
      'OTP_MAX_ATTEMPTS_EXCEEDED',
      400
    );
  }

  // 3. Kiểm tra hạn sử dụng (5 phút)
  if (now > new Date(activeRecord.expiresAt)) {
    activeRecord.isUsed = true;
    try {
      if ((prisma as any).otpVerification) {
        await (prisma as any).otpVerification.update({
          where: { id: activeRecord.id },
          data: { isUsed: true },
        });
      }
    } catch {
      // ignore
    }
    throw new OtpServiceError(
      'Mã OTP đã hết thời hạn hiệu lực (5 phút). Vui lòng yêu cầu mã mới.',
      'OTP_EXPIRED',
      400
    );
  }

  // 4. So khớp Hash
  const candidateHash = hashOtp(cleanOtp, cleanEmail);
  if (candidateHash !== activeRecord.otpHash) {
    activeRecord.attempts += 1;
    const remaining = 5 - activeRecord.attempts;

    try {
      if ((prisma as any).otpVerification) {
        await (prisma as any).otpVerification.update({
          where: { id: activeRecord.id },
          data: { attempts: activeRecord.attempts },
        });
      }
    } catch {
      // ignore
    }

    if (remaining <= 0) {
      activeRecord.isUsed = true;
      throw new OtpServiceError(
        'Mã OTP không chính xác. Bạn đã hết số lần thử, mã OTP này đã bị hủy.',
        'OTP_MAX_ATTEMPTS_EXCEEDED',
        400
      );
    }

    throw new OtpServiceError(
      `Mã OTP không chính xác. Bạn còn ${remaining} lần thử lại.`,
      'OTP_MISMATCH',
      400
    );
  }

  // 5. Xác thực thành công: Đánh dấu đã dùng một lần duy nhất
  activeRecord.isUsed = true;
  try {
    if ((prisma as any).otpVerification) {
      await (prisma as any).otpVerification.update({
        where: { id: activeRecord.id },
        data: { isUsed: true },
      });
    }
  } catch {
    // ignore
  }

  return { success: true, message: 'Xác thực mã OTP thành công.' };
}

