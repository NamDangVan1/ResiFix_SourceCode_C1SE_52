import crypto from 'crypto';
import { prisma } from '../db';

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
 * Hỗ trợ phân biệt theo purpose (ACCOUNT_ACTIVATION hoặc PASSWORD_RESET).
 */
export function checkResendCooldown(
  email: string,
  purpose?: string | number,
  cooldownSeconds: number = 60
): { canResend: boolean; remainingSeconds: number } {
  const actualCooldown = typeof purpose === 'number' ? purpose : cooldownSeconds;
  const purposeTag = typeof purpose === 'string' ? `:${purpose}` : '';
  const key = `${email.trim().toLowerCase()}${purposeTag}`;
  const lastTime = lastOtpRequestTime.get(key);
  if (!lastTime) return { canResend: true, remainingSeconds: 0 };

  const elapsedSeconds = Math.floor((Date.now() - lastTime) / 1000);
  if (elapsedSeconds < actualCooldown) {
    return { canResend: false, remainingSeconds: actualCooldown - elapsedSeconds };
  }
  return { canResend: true, remainingSeconds: 0 };
}

/**
 * Đánh dấu thời điểm vừa gửi OTP.
 */
export function recordOtpRequestTimestamp(email: string, purpose?: string): void {
  const purposeTag = purpose ? `:${purpose}` : '';
  const key = `${email.trim().toLowerCase()}${purposeTag}`;
  lastOtpRequestTime.set(key, Date.now());
}

/**
 * Xóa cooldown của email (hữu ích cho unit test / reset nhanh).
 */
export function clearOtpCooldown(email?: string): void {
  if (!email) {
    lastOtpRequestTime.clear();
    return;
  }
  const clean = email.trim().toLowerCase();
  for (const k of lastOtpRequestTime.keys()) {
    if (k === clean || k.startsWith(`${clean}:`)) {
      lastOtpRequestTime.delete(k);
    }
  }
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
  const cooldown = checkResendCooldown(cleanEmail, purpose, 60);
  if (!cooldown.canResend) {
    throw new OtpServiceError(
      'Vui lòng đợi trước khi gửi lại mã OTP',
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
  recordOtpRequestTimestamp(cleanEmail, purpose);

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
    throw new OtpServiceError('Vui lòng nhập đủ 6 chữ số OTP', 'INVALID_OTP_FORMAT', 400);
  }

  const now = new Date();
  const candidateHash = hashOtp(cleanOtp, cleanEmail);

  // 1. Kiểm tra xem mã OTP này đã từng được sử dụng trước đó hay chưa (Chống Replay Attack)
  let isAlreadyUsed = false;
  try {
    if ((prisma as any).otpVerification) {
      const usedDb = await (prisma as any).otpVerification.findFirst({
        where: { email: cleanEmail, purpose, otpHash: candidateHash, isUsed: true },
      });
      if (usedDb) isAlreadyUsed = true;
    }
  } catch {
    // ignore
  }

  if (!isAlreadyUsed) {
    const usedMem = Array.from(inMemoryOtpStore.values()).find(
      (r) => r.email === cleanEmail && r.purpose === purpose && r.otpHash === candidateHash && r.isUsed
    );
    if (usedMem) isAlreadyUsed = true;
  }

  if (isAlreadyUsed) {
    throw new OtpServiceError('Mã OTP này đã được sử dụng', 'OTP_ALREADY_USED', 400);
  }

  // 2. Tìm bản ghi OTP cho candidateHash còn chưa dùng, HOẶC bản ghi OTP chưa dùng mới nhất của email
  let matchingRecord: OtpRecord | null = null;
  let latestActiveRecord: OtpRecord | null = null;

  try {
    if ((prisma as any).otpVerification) {
      // Tìm bản ghi khớp chính xác candidateHash trước
      const dbMatch = await (prisma as any).otpVerification.findFirst({
        where: { email: cleanEmail, purpose, otpHash: candidateHash, isUsed: false },
        orderBy: { createdAt: 'desc' },
      });
      if (dbMatch) {
        matchingRecord = {
          id: dbMatch.id,
          email: dbMatch.email,
          otpHash: dbMatch.otpHash,
          purpose: dbMatch.purpose as OtpPurpose,
          expiresAt: dbMatch.expiresAt.toISOString(),
          attempts: dbMatch.attempts,
          isUsed: dbMatch.isUsed,
          createdAt: dbMatch.createdAt.toISOString(),
        };
      }

      // Tìm bản ghi active mới nhất
      const dbLatest = await (prisma as any).otpVerification.findFirst({
        where: { email: cleanEmail, purpose, isUsed: false },
        orderBy: { createdAt: 'desc' },
      });
      if (dbLatest) {
        latestActiveRecord = {
          id: dbLatest.id,
          email: dbLatest.email,
          otpHash: dbLatest.otpHash,
          purpose: dbLatest.purpose as OtpPurpose,
          expiresAt: dbLatest.expiresAt.toISOString(),
          attempts: dbLatest.attempts,
          isUsed: dbLatest.isUsed,
          createdAt: dbLatest.createdAt.toISOString(),
        };
      }
    }
  } catch {
    // fallback
  }

  // Fallback inMemoryOtpStore
  if (!matchingRecord) {
    const matchMem = Array.from(inMemoryOtpStore.values())
      .filter((r) => r.email === cleanEmail && r.purpose === purpose && r.otpHash === candidateHash && !r.isUsed)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (matchMem) matchingRecord = matchMem;
  }
  if (!latestActiveRecord) {
    const latestMem = Array.from(inMemoryOtpStore.values())
      .filter((r) => r.email === cleanEmail && r.purpose === purpose && !r.isUsed)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (latestMem) latestActiveRecord = latestMem;
  }

  // 3. Nếu tìm thấy bản ghi khớp hash candidate
  if (matchingRecord) {
    // Kiểm tra số lần thử sai trước đó
    if (matchingRecord.attempts >= 5) {
      matchingRecord.isUsed = true;
      try {
        if ((prisma as any).otpVerification) {
          await (prisma as any).otpVerification.update({
            where: { id: matchingRecord.id },
            data: { isUsed: true },
          });
        }
      } catch {}
      throw new OtpServiceError(
        'Mã OTP đã hết hạn. Vui lòng gửi mã mới',
        'OTP_MAX_ATTEMPTS_EXCEEDED',
        400
      );
    }

    // Kiểm tra hết hạn (quá 5 phút)
    if (now > new Date(matchingRecord.expiresAt)) {
      matchingRecord.isUsed = true;
      try {
        if ((prisma as any).otpVerification) {
          await (prisma as any).otpVerification.update({
            where: { id: matchingRecord.id },
            data: { isUsed: true },
          });
        }
      } catch {}
      throw new OtpServiceError(
        'Mã OTP đã hết hạn. Vui lòng gửi mã mới',
        'OTP_EXPIRED',
        400
      );
    }

    // Hợp lệ -> Đánh dấu đã sử dụng (Single-Use)
    matchingRecord.isUsed = true;
    try {
      if ((prisma as any).otpVerification) {
        await (prisma as any).otpVerification.update({
          where: { id: matchingRecord.id },
          data: { isUsed: true },
        });
      }
    } catch {}

    return { success: true, message: 'Xác thực mã OTP thành công.' };
  }

  // 4. Nếu không khớp hash candidate nhưng có một OTP active đang chờ người dùng nhập
  if (latestActiveRecord) {
    // Kiểm tra xem bản ghi active này bản thân nó có bị hết hạn chưa
    if (now > new Date(latestActiveRecord.expiresAt)) {
      latestActiveRecord.isUsed = true;
      try {
        if ((prisma as any).otpVerification) {
          await (prisma as any).otpVerification.update({
            where: { id: latestActiveRecord.id },
            data: { isUsed: true },
          });
        }
      } catch {}
      throw new OtpServiceError(
        'Mã OTP đã hết hạn. Vui lòng gửi mã mới',
        'OTP_EXPIRED',
        400
      );
    }

    latestActiveRecord.attempts += 1;
    try {
      if ((prisma as any).otpVerification) {
        await (prisma as any).otpVerification.update({
          where: { id: latestActiveRecord.id },
          data: { attempts: latestActiveRecord.attempts },
        });
      }
    } catch {}

    if (latestActiveRecord.attempts >= 5) {
      latestActiveRecord.isUsed = true;
      try {
        if ((prisma as any).otpVerification) {
          await (prisma as any).otpVerification.update({
            where: { id: latestActiveRecord.id },
            data: { isUsed: true },
          });
        }
      } catch {}
      throw new OtpServiceError(
        'Mã OTP đã hết hạn. Vui lòng gửi mã mới',
        'OTP_MAX_ATTEMPTS_EXCEEDED',
        400
      );
    }

    throw new OtpServiceError(
      'Mã OTP không chính xác. Vui lòng kiểm tra lại',
      'OTP_MISMATCH',
      400
    );
  }

  // 5. Không có bản ghi active nào và cũng không khớp
  throw new OtpServiceError(
    'Mã OTP không chính xác. Vui lòng kiểm tra lại',
    'OTP_NOT_FOUND',
    400
  );
}

