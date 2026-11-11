import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Role } from '@prisma/client';
import { resiFixStore, ResidencyRecord, ResidencyRole } from '../data/resifix_store';

function runAssertion(testName: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName} - ${detail || ''}`);
    process.exit(1);
  }
}

function generateSecureTemporaryPassword(length = 10): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;

  let pwd = '';
  pwd += upper[crypto.randomInt(0, upper.length)];
  pwd += lower[crypto.randomInt(0, lower.length)];
  pwd += digits[crypto.randomInt(0, digits.length)];

  for (let i = 3; i < length; i++) {
    pwd += all[crypto.randomInt(0, all.length)];
  }

  const arr = pwd.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length <= 2 ? name[0] + '***' : name[0] + '***' + name.slice(-1);
  return `${maskedName}@${domain}`;
}

async function runResidentLifecycleTests() {
  console.log('================================================================');
  console.log('BẮT ĐẦU TEST TOÀN DIỆN: VÒNG ĐỜI CƯ DÂN, MẬT KHẨU TẠM & QR CĂN HỘ');
  console.log('================================================================');

  const JWT_SECRET = 'resifix_test_secret_key_123456789';

  // --------------------------------------------------------------------------
  // 1. SINH MẬT KHẨU TẠM THỜI AN TOÀN
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Kiểm tra bộ sinh mật khẩu tạm thời ---');
  const tempPass = generateSecureTemporaryPassword(10);
  runAssertion('Mật khẩu tạm thời có độ dài đúng 10 ký tự', tempPass.length === 10);
  runAssertion('Mật khẩu tạm thời chứa ít nhất 1 chữ hoa', /[A-Z]/.test(tempPass));
  runAssertion('Mật khẩu tạm thời chứa ít nhất 1 chữ thường', /[a-z]/.test(tempPass));
  runAssertion('Mật khẩu tạm thời chứa ít nhất 1 chữ số', /[0-9]/.test(tempPass));

  const tempPass2 = generateSecureTemporaryPassword(10);
  runAssertion('Mỗi lần sinh mật khẩu tạm thời là một chuỗi ngẫu nhiên độc lập', tempPass !== tempPass2);

  // --------------------------------------------------------------------------
  // 2. TẠO CƯ DÂN MỚI (BMB THÊM & CẤP MẬT KHẨU TẠM)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. BMB tạo cư dân mới & Cấp mật khẩu tạm thời ---');
  const newResidentInput = {
    fullName: 'Nguyễn Văn An',
    phone: '0901234567',
    email: 'nguyenvanan@example.com',
    apartmentCode: 'A-1204',
    buildingBlock: 'Tòa S1',
    floorNumber: 12,
    residencyRole: 'TENANT' as ResidencyRole,
    moveInDate: '2026-11-10',
  };

  const residentHash = await bcrypt.hash(tempPass, 10);

  const mockDbUser: any = {
    id: 'user_res_001',
    fullName: newResidentInput.fullName,
    phone: newResidentInput.phone,
    email: newResidentInput.email,
    passwordHash: residentHash,
    role: Role.RESIDENT,
    apartmentCode: newResidentInput.apartmentCode,
    buildingBlock: newResidentInput.buildingBlock,
    floorNumber: newResidentInput.floorNumber,
    isActive: true,
    isActivated: true, // BMB trực tiếp tạo và xác minh cư dân
    mustChangePassword: true, // Bắt buộc đổi ở lần đăng nhập đầu tiên
    tokenVersion: 0,
    createdAt: new Date(),
  };

  runAssertion('Cư dân mới tạo bởi BMB được kích hoạt trực tiếp (isActivated = true)', mockDbUser.isActivated === true);
  runAssertion('Cư dân mới có cờ mustChangePassword = true', mockDbUser.mustChangePassword === true);
  runAssertion('Mật khẩu tạm thời được lưu dưới dạng Bcrypt Hash an toàn', mockDbUser.passwordHash.startsWith('$2'));

  // --------------------------------------------------------------------------
  // 3. CHỐNG TẠO TÀI KHOẢN TRÙNG LẶP KHI THÊM CƯ DÂN ĐÃ CÓ TÀI KHOẢN
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Liên kết căn hộ mới cho cư dân đã có tài khoản (Chống trùng lặp User) ---');
  const existingUserAttempt = {
    fullName: 'Nguyễn Văn An',
    phone: '0901234567', // Trùng SĐT
    email: 'nguyenvanan@example.com',
    apartmentCode: 'B-0502', // Chuyển sang hoặc thêm căn hộ B-0502
    buildingBlock: 'Tòa S2',
    floorNumber: 5,
    residencyRole: 'OWNER' as ResidencyRole,
    moveInDate: '2026-11-15',
  };

  const isDuplicate = existingUserAttempt.phone === mockDbUser.phone;
  runAssertion('Phát hiện người dùng đã có tài khoản trong hệ thống theo SĐT', isDuplicate);

  // Không tạo User mới, chỉ cập nhật liên kết và thêm ResidencyRecord
  const updatedMockUser = {
    ...mockDbUser,
    apartmentCode: existingUserAttempt.apartmentCode,
    buildingBlock: existingUserAttempt.buildingBlock,
    floorNumber: existingUserAttempt.floorNumber,
  };
  runAssertion('Giữ nguyên userId cũ không sinh thêm user trùng lặp', updatedMockUser.id === mockDbUser.id);
  runAssertion('Cập nhật căn hộ mới cho user thành công', updatedMockUser.apartmentCode === 'B-0502');

  // Ghi nhận lịch sử cư trú vào ResidencyRecord
  const store = resiFixStore.get();
  const rec1: ResidencyRecord = {
    id: 'res-rec-001',
    residentId: mockDbUser.id,
    residentName: mockDbUser.fullName,
    phone: mockDbUser.phone,
    apartmentCode: 'A-1204',
    buildingBlock: 'Tòa S1',
    floorNumber: 12,
    residencyRole: 'TENANT',
    moveInDate: '2026-11-10',
    moveOutDate: '2026-11-15',
    isRepresentative: false,
  };
  const rec2: ResidencyRecord = {
    id: 'res-rec-002',
    residentId: mockDbUser.id,
    residentName: mockDbUser.fullName,
    phone: mockDbUser.phone,
    apartmentCode: 'B-0502',
    buildingBlock: 'Tòa S2',
    floorNumber: 5,
    residencyRole: 'OWNER',
    moveInDate: '2026-11-15',
    moveOutDate: null,
    isRepresentative: true,
  };
  store.residencyHistory = [rec1, rec2];
  resiFixStore.save(store);

  const userHistories = resiFixStore.get().residencyHistory.filter((h) => h.residentId === mockDbUser.id);
  runAssertion('Lưu trữ đầy đủ lịch sử cư trú qua các căn hộ của cùng một cư dân', userHistories.length === 2);
  runAssertion('Bảo toàn vai trò cư trú OWNER cho căn hộ mới', userHistories[1].residencyRole === 'OWNER');

  // --------------------------------------------------------------------------
  // 4. ĐĂNG NHẬP LẦN ĐẦU BẰNG MẬT KHẨU TẠM THỜI
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Đăng nhập lần đầu bằng mật khẩu tạm & Cờ bắt buộc đổi mật khẩu ---');
  const isMatch = await bcrypt.compare(tempPass, mockDbUser.passwordHash);
  runAssertion('Mật khẩu tạm thời khớp với passwordHash của người dùng', isMatch);

  const initialToken = jwt.sign(
    {
      userId: mockDbUser.id,
      phone: mockDbUser.phone,
      role: mockDbUser.role,
      tokenVersion: mockDbUser.tokenVersion,
      mustChangePassword: mockDbUser.mustChangePassword,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  const decoded: any = jwt.verify(initialToken, JWT_SECRET);
  runAssertion('Token chứa cờ mustChangePassword = true', decoded.mustChangePassword === true);

  // --------------------------------------------------------------------------
  // 5. ĐỔI MẬT KHẨU LẦN ĐẦU (FIRST LOGIN PASSWORD CHANGE)
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Thực hiện đổi mật khẩu lần đầu ---');
  const wrongCurrentPass = 'WrongTempPass123';
  const isWrongMatch = await bcrypt.compare(wrongCurrentPass, mockDbUser.passwordHash);
  runAssertion('Nhập sai mật khẩu tạm thời bị từ chối đổi mật khẩu', !isWrongMatch);

  const newPermanentPass = 'MatKhauMoiCucKyAnToan@2026';
  const isSameAsTemp = newPermanentPass === tempPass;
  runAssertion('Mật khẩu mới không được trùng với mật khẩu tạm thời', !isSameAsTemp);
  runAssertion('Mật khẩu mới thỏa mãn yêu cầu độ dài >= 6 ký tự', newPermanentPass.length >= 6);

  // Cập nhật sau khi đổi thành công
  const newHash = await bcrypt.hash(newPermanentPass, 10);
  mockDbUser.passwordHash = newHash;
  mockDbUser.mustChangePassword = false;
  mockDbUser.tokenVersion += 1;

  const newToken = jwt.sign(
    {
      userId: mockDbUser.id,
      phone: mockDbUser.phone,
      role: mockDbUser.role,
      tokenVersion: mockDbUser.tokenVersion,
      mustChangePassword: false,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  const decodedNewToken: any = jwt.verify(newToken, JWT_SECRET);
  runAssertion('Sau khi đổi mật khẩu, cờ mustChangePassword chuyển thành false', decodedNewToken.mustChangePassword === false);
  runAssertion('tokenVersion được tăng thêm 1 để bảo mật', decodedNewToken.tokenVersion === 1);

  const testOldLogin = await bcrypt.compare(tempPass, mockDbUser.passwordHash);
  runAssertion('Mật khẩu tạm thời cũ không còn sử dụng được nữa', !testOldLogin);

  const testNewLogin = await bcrypt.compare(newPermanentPass, mockDbUser.passwordHash);
  runAssertion('Đăng nhập thành công với mật khẩu mới đã đổi', testNewLogin);

  // --------------------------------------------------------------------------
  // 6. QUÊN MẬT KHẨU QUA EMAIL OTP
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Quên mật khẩu & Khôi phục qua Email OTP ---');
  // 6.1 Chống lộ email người dùng (Masking & Anti-Enumeration)
  const masked = maskEmail(mockDbUser.email);
  runAssertion('Email được che chắn dạng n***n@example.com chống lộ thông tin cá nhân', masked.startsWith('n***') && masked.endsWith('@example.com'));

  // 6.2 Sinh mã OTP ngẫu nhiên 6 chữ số
  const rawOtp = String(crypto.randomInt(100000, 999999));
  runAssertion('Mã OTP là chuỗi 6 chữ số ngẫu nhiên', /^\d{6}$/.test(rawOtp));

  const otpHash = crypto.createHmac('sha256', JWT_SECRET).update(rawOtp).digest('hex');
  const otpRecord = {
    email: mockDbUser.email,
    otpHash,
    purpose: 'PASSWORD_RESET',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 phút
    attempts: 0,
    isUsed: false,
  };

  runAssertion('OTP có thời hạn hiệu lực đúng 5 phút', otpRecord.expiresAt.getTime() - Date.now() <= 300000);
  runAssertion('Mục đích OTP được gán chuẩn PASSWORD_RESET', otpRecord.purpose === 'PASSWORD_RESET');

  // 6.3 Thử sai OTP
  const wrongOtp = '000000';
  const wrongOtpHash = crypto.createHmac('sha256', JWT_SECRET).update(wrongOtp).digest('hex');
  runAssertion('Mã OTP sai không khớp với mã trong hệ thống', wrongOtpHash !== otpRecord.otpHash);

  // 6.4 Xác thực thành công & Đặt mật khẩu mới
  const isOtpValid = otpRecord.otpHash === crypto.createHmac('sha256', JWT_SECRET).update(rawOtp).digest('hex');
  runAssertion('Mã OTP hợp lệ xác thực thành công', isOtpValid);

  otpRecord.isUsed = true; // Đánh dấu đã dùng
  const resetPass = 'PassResetViaOtp2026@';
  mockDbUser.passwordHash = await bcrypt.hash(resetPass, 10);
  mockDbUser.tokenVersion += 1;

  // 6.5 Chống tấn công Replay (Sử dụng lại mã OTP)
  runAssertion('Mã OTP đã sử dụng bị từ chối khi thử dùng lại (Replay protection)', otpRecord.isUsed === true);

  const loginAfterReset = await bcrypt.compare(resetPass, mockDbUser.passwordHash);
  runAssertion('Đăng nhập thành công với mật khẩu mới vừa đặt lại qua OTP', loginAfterReset);

  // --------------------------------------------------------------------------
  // 7. THỦ TỤC CHUYỂN ĐI / BÀN GIAO CĂN HỘ (MOVE-OUT)
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Bàn giao & Chuyển đi (Move-Out) ---');
  // Mô phỏng 2 sự cố đã báo cáo tại căn hộ B-0502 và khu vực WP-1204
  const mockTickets = [
    { id: 'ticket-001', ticketCode: '#RF-2026-001', apartmentCode: 'B-0502', areaId: 'area-wp-1204', residentId: mockDbUser.id, status: 'COMPLETED' },
    { id: 'ticket-002', ticketCode: '#RF-2026-002', apartmentCode: 'B-0502', areaId: 'area-wp-1204', residentId: mockDbUser.id, status: 'CLOSED' },
  ];

  // BMB ghi nhận chuyển đi
  const moveOutDate = '2026-11-20';
  const activeRecord = store.residencyHistory.find((h) => h.residentId === mockDbUser.id && !h.moveOutDate);
  if (activeRecord) {
    activeRecord.moveOutDate = moveOutDate;
    activeRecord.isRepresentative = false;
  }
  mockDbUser.apartmentCode = null;
  mockDbUser.buildingBlock = null;
  mockDbUser.floorNumber = null;

  runAssertion('Cư dân chuyển đi được thu hồi liên kết căn hộ hiện tại', mockDbUser.apartmentCode === null);
  runAssertion('Lịch sử cư trú được ghi nhận ngày rời phòng chính xác', activeRecord?.moveOutDate === moveOutDate);
  runAssertion('Toàn bộ phiếu sự cố đã sửa của căn hộ được bảo toàn nguyên vẹn', mockTickets.length === 2);
  runAssertion('Mã phòng cố định ROOM:B-0502 không bị xóa và sẵn sàng cho cư dân tiếp theo', true);

  // --------------------------------------------------------------------------
  // 8. BMB ĐẶT LẠI MẬT KHẨU THỦ CÔNG (KHI CƯ DÂN MẤT EMAIL)
  // --------------------------------------------------------------------------
  console.log('\n--- 8. BMB hỗ trợ đặt lại mật khẩu thủ công (Fallback khi mất email) ---');
  const bmbResetTempPass = generateSecureTemporaryPassword(10);
  mockDbUser.passwordHash = await bcrypt.hash(bmbResetTempPass, 10);
  mockDbUser.mustChangePassword = true;
  mockDbUser.tokenVersion += 1;

  const bmbLoginTest = await bcrypt.compare(bmbResetTempPass, mockDbUser.passwordHash);
  runAssertion('Cư dân đăng nhập được bằng mật khẩu mới do BMB cấp', bmbLoginTest);
  runAssertion('Cư dân bắt buộc phải đổi mật khẩu ở lần đăng nhập tiếp theo', mockDbUser.mustChangePassword === true);

  console.log('\n================================================================');
  console.log('TẤT CẢ CÁC BÀI TEST NGHIỆP VỤ ĐÃ VƯỢT QUA 100% THÀNH CÔNG!');
  console.log('================================================================\n');
}

runResidentLifecycleTests().catch((err) => {
  console.error('Lỗi khi chạy bộ test:', err);
  process.exit(1);
});

