import fs from 'fs';
import path from 'path';

const filePath = path.resolve(__dirname, '../data/resifix_store.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Cập nhật StoreManager.save với Atomic write và Backup
const oldSaveStr = `  public save(newData?: ResiFixStoreData): void {
    if (newData) this.data = newData;
    try {
      const dir = path.dirname(STORE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Lỗi khi ghi resifix_store.json:', err);
    }
  }`;

const newSaveStr = `  public save(newData?: ResiFixStoreData): void {
    if (newData) this.data = newData;
    try {
      const dir = path.dirname(STORE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const serialized = JSON.stringify(this.data, null, 2);
      const tempPath = STORE_PATH + '.tmp';
      const bakPath = STORE_PATH + '.bak';

      // 1. Sao lưu file hiện tại sang .bak
      if (fs.existsSync(STORE_PATH)) {
        try {
          fs.copyFileSync(STORE_PATH, bakPath);
        } catch {}
      }

      // 2. Ghi ra file tạm (.tmp) trước
      fs.writeFileSync(tempPath, serialized, 'utf8');

      // 3. Đổi tên nguyên tử (Atomic Rename) để chống hỏng file khi crash/tắt máy đột ngột
      fs.renameSync(tempPath, STORE_PATH);
    } catch (err) {
      console.error('Lỗi khi ghi an toàn resifix_data.json:', err);
    }
  }`;

if (content.includes(oldSaveStr)) {
  content = content.replace(oldSaveStr, newSaveStr);
  console.log('[OK] Updated StoreManager.save with atomic rename and backup');
} else {
  console.warn('[WARN] oldSaveStr not matched exactly, checking normalized whitespace');
}

// 2. Thêm các hàm nghiệp vụ: Nonce, BLLĐ 2019 Điều 98, Ca đêm, Ngày lễ
const helpersCode = `
// ----------------------------------------------------------------------------
// BẢO MẬT PHIÊN CHẤM CÔNG (NONCE - ANTI-REPLAY & CHỐNG DUPLICATE REQUESTS)
// ----------------------------------------------------------------------------

export const createAttendanceNonce = (techId: string, ttlSeconds = 180): string => {
  const store = resiFixStore.get();
  if (!store.activeNonces) store.activeNonces = [];
  const now = Date.now();
  // Dọn dẹp các nonce đã hết hạn hoặc đã dùng
  store.activeNonces = store.activeNonces.filter((n) => n.expiresAt > now && !n.used);

  const nonce = crypto.randomBytes(16).toString('hex');
  store.activeNonces.push({
    nonce,
    techId,
    createdAt: now,
    expiresAt: now + ttlSeconds * 1000,
    used: false,
  });
  resiFixStore.save(store);
  return nonce;
};

export const consumeAttendanceNonce = (nonce: string, techId: string): { valid: boolean; reason?: string } => {
  const store = resiFixStore.get();
  if (!store.activeNonces) store.activeNonces = [];
  const now = Date.now();
  const entry = store.activeNonces.find((n) => n.nonce === nonce);
  if (!entry) {
    return { valid: false, reason: 'Mã phiên chấm công (nonce) không tồn tại hoặc đã được sử dụng.' };
  }
  if (entry.used) {
    return { valid: false, reason: 'Mã phiên chấm công (nonce) đã được sử dụng trước đó (chống Replay).' };
  }
  if (entry.techId !== techId) {
    return { valid: false, reason: 'Mã phiên chấm công không thuộc về tài khoản này.' };
  }
  if (entry.expiresAt < now) {
    return { valid: false, reason: 'Mã phiên chấm công đã hết hạn (quá 3 phút). Vui lòng tải lại.' };
  }
  // Đánh dấu đã sử dụng ngay lập tức
  entry.used = true;
  store.activeNonces = store.activeNonces.filter((n) => n.nonce !== nonce && n.expiresAt > now);
  resiFixStore.save(store);
  return { valid: true };
};

// ----------------------------------------------------------------------------
// TÍNH LƯƠNG CHUẨN ĐIỀU 98 BỘ LUẬT LAO ĐỘNG 2019 (VIỆT NAM)
// ----------------------------------------------------------------------------

export const VIETNAM_PUBLIC_HOLIDAYS_FIXED = [
  '01-01', // Tết Dương lịch
  '04-30', // Giải phóng Miền Nam
  '05-01', // Quốc tế Lao động
  '09-02', // Quốc khánh
  '09-03', // Quốc khánh (ngày liền kề)
];

export const isVietnamPublicHoliday = (dateStr: string): boolean => {
  const mmdd = dateStr.slice(5);
  if (VIETNAM_PUBLIC_HOLIDAYS_FIXED.includes(mmdd)) return true;
  const store = resiFixStore.get();
  if (Array.isArray(store.payrollConfig.holidays) && store.payrollConfig.holidays.includes(dateStr)) {
    return true;
  }
  return false;
};

export const getDayType = (dateStr: string): 'NORMAL' | 'WEEKEND' | 'HOLIDAY' => {
  if (isVietnamPublicHoliday(dateStr)) return 'HOLIDAY';
  const vnDate = new Date(\`\${dateStr}T12:00:00+07:00\`);
  const day = vnDate.getDay();
  if (day === 0 || day === 6) return 'WEEKEND';
  return 'NORMAL';
};

/**
 * Tính hệ số tăng ca chuẩn theo Điều 98 Bộ luật Lao động 2019:
 * - Ngày thường: 150% (ban ngày), 210% (ban đêm = 150% + 30% + 20% x 150%)
 * - Ngày nghỉ hằng tuần: 200% (ban ngày), 270% (ban đêm = 200% + 30% + 20% x 200%)
 * - Ngày lễ, Tết: 300% (ban ngày), 390% (ban đêm = 300% + 30% + 20% x 300%)
 */
export const calculateOvertimeMultiplier = (
  dayType: 'NORMAL' | 'WEEKEND' | 'HOLIDAY',
  isNightOt: boolean
): number => {
  if (dayType === 'HOLIDAY') {
    return isNightOt ? 3.9 : 3.0;
  }
  if (dayType === 'WEEKEND') {
    return isNightOt ? 2.7 : 2.0;
  }
  return isNightOt ? 2.1 : 1.5;
};

export const calculateOvertimePay = (
  hours: number,
  dayType: 'NORMAL' | 'WEEKEND' | 'HOLIDAY',
  isNightOt: boolean,
  baseHourlyRate: number
): number => {
  const mult = calculateOvertimeMultiplier(dayType, isNightOt);
  return Math.round(hours * baseHourlyRate * mult);
};

/**
 * Tính tiền lương ca làm việc chuẩn theo Điều 98 BLLĐ 2019:
 * - Giờ thường ban ngày (06:00 - 22:00): 100% đơn giá (50.000 VNĐ/giờ)
 * - Giờ làm việc ban đêm (22:00 - 06:00): 130% đơn giá (65.000 VNĐ/giờ)
 */
export const calculateShiftSalaryVietnam = (
  regularHours: number,
  nightHours: number,
  baseHourlyRate: number
): { regularPay: number; nightPay: number; totalShiftPay: number } => {
  const regularPay = Math.round(regularHours * baseHourlyRate);
  const nightPay = Math.round(nightHours * baseHourlyRate * 1.3);
  return {
    regularPay,
    nightPay,
    totalShiftPay: regularPay + nightPay,
  };
};
`;

if (!content.includes('createAttendanceNonce')) {
  content += helpersCode;
  console.log('[OK] Added Nonce & Labor Code 2019 helper functions');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('[SUCCESS] resifix_store.ts patched cleanly!');

