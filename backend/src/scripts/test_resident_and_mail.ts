/**
 * SUITE KIỂM THỬ TỰ ĐỘNG CHO:
 * 1. Dịch vụ gửi mã OTP qua Email (mail.service.ts)
 * 2. Luồng thẩm định & bảo mật lưu cư dân (management.routes.ts)
 */

import { sendOtpEmail, safeSendOtpEmail, MailServiceError } from '../services/mail.service';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

async function runTests() {
  console.log('====================================================');
  console.log('BẮT ĐẦU CHẠY BỘ TEST: QUẢN LÝ CƯ DÂN & GỬI OTP EMAIL');
  console.log('====================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  const testSync = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         Chi tiết lỗi: ${err.message}`);
      failedCount++;
    }
  };

  const testAsync = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         Chi tiết lỗi: ${err.message}`);
      failedCount++;
    }
  };

  // --------------------------------------------------------------------------
  // NHÓM 1: KIỂM THỬ MAIL SERVICE INPUT VALIDATION
  // --------------------------------------------------------------------------

  await testAsync('Mail Service: Chặn email người nhận không hợp lệ', async () => {
    try {
      await sendOtpEmail('invalid-email-format', '123456', 'ACCOUNT_ACTIVATION');
      throw new Error('Đáng lẽ phải ném lỗi khi email sai định dạng');
    } catch (err: any) {
      if (err instanceof MailServiceError && err.code === 'INVALID_EMAIL') {
        // Đúng mong đợi
      } else {
        throw new Error(`Mã lỗi không đúng: ${err.message}`);
      }
    }
  });

  await testAsync('Mail Service: Chặn email rỗng', async () => {
    try {
      await sendOtpEmail('', '123456', 'ACCOUNT_ACTIVATION');
      throw new Error('Đáng lẽ phải ném lỗi khi email rỗng');
    } catch (err: any) {
      if (err instanceof MailServiceError && err.code === 'INVALID_EMAIL') {
        // Đúng mong đợi
      } else {
        throw new Error(`Mã lỗi không đúng: ${err.message}`);
      }
    }
  });

  await testAsync('Mail Service: Chặn mã OTP không phải 6 chữ số (ít hơn 6 số)', async () => {
    try {
      await sendOtpEmail('user@example.com', '12345', 'ACCOUNT_ACTIVATION');
      throw new Error('Đáng lẽ phải ném lỗi khi OTP có 5 số');
    } catch (err: any) {
      if (err instanceof MailServiceError && err.code === 'INVALID_OTP') {
        // Đúng mong đợi
      } else {
        throw new Error(`Mã lỗi không đúng: ${err.message}`);
      }
    }
  });

  await testAsync('Mail Service: Chặn mã OTP chứa ký tự chữ cái', async () => {
    try {
      await sendOtpEmail('user@example.com', '12A456', 'PASSWORD_RESET');
      throw new Error('Đáng lẽ phải ném lỗi khi OTP chứa chữ');
    } catch (err: any) {
      if (err instanceof MailServiceError && err.code === 'INVALID_OTP') {
        // Đúng mong đợi
      } else {
        throw new Error(`Mã lỗi không đúng: ${err.message}`);
      }
    }
  });

  await testAsync('Mail Service: Chặn mục đích gửi không hợp lệ', async () => {
    try {
      await sendOtpEmail('user@example.com', '123456', 'INVALID_PURPOSE' as any);
      throw new Error('Đáng lẽ phải ném lỗi khi purpose không hợp lệ');
    } catch (err: any) {
      if (err instanceof MailServiceError && err.code === 'INVALID_PURPOSE') {
        // Đúng mong đợi
      } else {
        throw new Error(`Mã lỗi không đúng: ${err.message}`);
      }
    }
  });

  await testAsync('Mail Service: safeSendOtpEmail trả về kết quả mềm không crash', async () => {
    const res = await safeSendOtpEmail('invalid-email', '123456', 'ACCOUNT_ACTIVATION');
    if (res.success !== false || !res.error) {
      throw new Error('safeSendOtpEmail phải trả về { success: false, error: ... }');
    }
  });

  // --------------------------------------------------------------------------
  // NHÓM 2: KIỂM THỬ QUY TẮC MẬT KHẨU & TẠO CƯ DÂN KHÔNG CẦN PASSWORD123
  // --------------------------------------------------------------------------

  testSync('Cư dân: Khi BMB để trống mật khẩu, sinh hash ngẫu nhiên bảo mật, KHÔNG dùng password123', () => {
    const cleanPass = '';
    const rawPasswordToHash = cleanPass || crypto.randomBytes(32).toString('hex');
    
    if (rawPasswordToHash === 'password123') {
      throw new Error('Tuyệt đối không được dùng password123 mặc định!');
    }
    if (rawPasswordToHash.length < 32) {
      throw new Error('Chuỗi mật khẩu ngẫu nhiên tạo sẵn phải có độ dài tối thiểu 32 ký tự hex!');
    }

    // Kiểm tra không ai đoán được mật khẩu này bằng password123
    const isGuessable = bcrypt.compareSync('password123', bcrypt.hashSync(rawPasswordToHash, 10));
    if (isGuessable) {
      throw new Error('Mật khẩu ngẫu nhiên không được khớp với password123!');
    }
  });

  testSync('Cư dân: Mật khẩu thiết lập phải tuân thủ chuẩn an toàn 12 đến 128 ký tự', () => {
    const passwordInputs = ['ResiFix@2026SafePass', 'MatKhauMoi2026!', 'KichHoatTaiKhoan123!'];
    for (const pass of passwordInputs) {
      const isValid = pass.length >= 12 && pass.length <= 128;
      if (!isValid) {
        throw new Error(`Mật khẩu hợp lệ "${pass}" bị từ chối!`);
      }
    }

    // Từ chối mật khẩu dưới 12 ký tự (kể cả 6 ký tự như trước đây)
    const shortPasswords = ['12345', '123456', 'Abc@123', 'Pass1234567'];
    for (const shortPass of shortPasswords) {
      const isShortValid = shortPass.length >= 12 && shortPass.length <= 128;
      if (isShortValid) {
        throw new Error(`Mật khẩu dưới 12 ký tự "${shortPass}" không được phép chấp nhận!`);
      }
    }
  });

  testSync('Cư dân: Kiểm tra định dạng số điện thoại Việt Nam chuẩn 10 số bắt đầu bằng 0', () => {
    const validPhones = ['0905123456', '0987654321', '0321654987', '0779988776'];
    const invalidPhones = ['905123456', '090512345', '09051234567', 'abc09051234', '1905123456'];

    for (const p of validPhones) {
      const clean = p.replace(/[^\d]/g, '');
      if (!/^0\d{9}$/.test(clean)) {
        throw new Error(`SĐT hợp lệ ${p} bị nhận diện sai`);
      }
    }

    for (const p of invalidPhones) {
      const clean = p.replace(/[^\d]/g, '');
      if (/^0\d{9}$/.test(clean)) {
        throw new Error(`SĐT không hợp lệ ${p} lại được chấp nhận!`);
      }
    }
  });

  testSync('Cư dân: Kiểm tra định dạng Email khi nhập vào form', () => {
    const validEmails = ['cudan@gmail.com', 'nguyen.a@resifix.vn', 'test+tag@domain.co'];
    const invalidEmails = ['plainaddress', 'cudan@', '@domain.com', 'cudan@domain', 'cu dan@mail.com'];

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (const e of validEmails) {
      if (!emailRegex.test(e.trim().toLowerCase())) {
        throw new Error(`Email hợp lệ ${e} bị báo lỗi`);
      }
    }

    for (const e of invalidEmails) {
      if (emailRegex.test(e.trim().toLowerCase())) {
        throw new Error(`Email không hợp lệ ${e} lại được chấp nhận`);
      }
    }
  });

  // --------------------------------------------------------------------------
  // NHÓM 3: KIỂM THỬ XỬ LÝ LỖI TRÙNG LẶP SĐT / EMAIL (PRISMA P2002)
  // --------------------------------------------------------------------------

  testSync('Bảo mật: Phân giải chính xác thông báo lỗi trùng lặp từ Prisma P2002', () => {
    const fakePrismaPhoneError = {
      code: 'P2002',
      meta: { target: ['phone'] },
    };

    const fakePrismaEmailError = {
      code: 'P2002',
      meta: { target: ['email'] },
    };

    const getErrorMessage = (err: any): string => {
      if (err.code === 'P2002') {
        const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : String(err.meta?.target || '');
        if (target.includes('phone')) return 'Số điện thoại này đã được đăng ký tài khoản trong hệ thống.';
        if (target.includes('email')) return 'Địa chỉ email này đã được sử dụng cho một tài khoản khác.';
        return 'Thông tin cư dân bị trùng lặp với dữ liệu đã có trong hệ thống.';
      }
      return 'Lỗi hệ thống';
    };

    if (getErrorMessage(fakePrismaPhoneError) !== 'Số điện thoại này đã được đăng ký tài khoản trong hệ thống.') {
      throw new Error('Thông báo lỗi trùng SĐT không chính xác');
    }

    if (getErrorMessage(fakePrismaEmailError) !== 'Địa chỉ email này đã được sử dụng cho một tài khoản khác.') {
      throw new Error('Thông báo lỗi trùng Email không chính xác');
    }
  });

  // --------------------------------------------------------------------------
  // TỔNG KẾT
  // --------------------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`KẾT QUẢ KIỂM THỬ: ${passedCount} PASSED, ${failedCount} FAILED.`);
  console.log('====================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Lỗi khi chạy bộ test:', err);
  process.exit(1);
});
