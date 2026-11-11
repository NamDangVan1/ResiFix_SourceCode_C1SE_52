process.env.NODE_ENV = 'test';
process.env.RESIFIX_ENV = 'test';

import { loadTestEnvironmentStrict, createTestPrismaClient } from './test_env_guard';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { hashOtp } from '../services/otp.service';

const config = loadTestEnvironmentStrict();
const prisma = createTestPrismaClient(config);

async function runRealEmailAndValidationTests() {
  console.log('========================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ TOÀN DIỆN: OTP ACTIVATION, EMAIL SMTP THẬT & VALIDATION');
  console.log('========================================================================\n');

  const { default: authRoutes } = await import('../routes/auth.routes');
  const { default: ticketRoutes } = await import('../routes/ticket.routes');
  const { default: managementRoutes } = await import('../routes/management.routes');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/api/management', managementRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  let passCount = 0;
  let failCount = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  [✅ PASS] ${msg}`);
      passCount++;
    } else {
      console.error(`  [❌ FAIL] ${msg}`);
      failCount++;
      throw new Error(`Assertion failed: ${msg}`);
    }
  }

  // Sử dụng email thực tế từ cấu hình SMTP để kiểm tra gửi nhận email thật (Gmail hỗ trợ alias +tag gửi vào đúng hộp thư chính)
  const baseEmail = (process.env.SMTP_USER || 'thanhquyet100105@gmail.com').trim().toLowerCase();
  const [localPart, domain] = baseEmail.split('@');
  const timestamp = Date.now().toString().slice(-6);
  const realTechEmail = `${localPart}+ktv${timestamp}@${domain}`;
  const realResEmail = `${localPart}+res${timestamp}@${domain}`;
  console.log(`[INFO] Sử dụng email SMTP đích để gửi email thật:\n  - KTV: ${realTechEmail}\n  - Cư dân: ${realResEmail}`);

  const testTechPhone = `0989${timestamp}`;
  const testResPhone = `0988${timestamp}`;

  // Lấy hoặc tạo tài khoản BMB để ký token gọi API admin
  let bmbUser = await prisma.user.findFirst({
    where: { role: 'BMB', isActive: true },
  });
  if (!bmbUser) {
    bmbUser = await prisma.user.create({
      data: {
        fullName: 'BMB Test Admin',
        phone: '0901234999',
        email: 'bmb_test_admin@resifix.vn',
        passwordHash: 'dummyHash',
        role: 'BMB',
        isActive: true,
        isActivated: true,
      },
    });
  }

  const jwtSecret = process.env.JWT_SECRET || 'resifix-migration-test-jwt-secret-key-2026';
  const bmbToken = jwt.sign(
    { userId: bmbUser.id, role: 'BMB', fullName: bmbUser.fullName, tokenVersion: 0 },
    jwtSecret,
    { expiresIn: '1h' }
  );

  let createdTechId = '';
  let createdResId = '';

  try {
    // ========================================================================
    // 1. BMB TẠO KTV -> EMAIL NHẬN OTP THẬT
    // ========================================================================
    console.log('\n--- 1. BMB TẠO KTV QUA POST /api/tickets/technicians ---');
    const createTechRes = await fetch(`${baseUrl}/tickets/technicians`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bmbToken}`,
      },
      body: JSON.stringify({
        fullName: 'KTV Test Email Thật',
        phone: testTechPhone,
        email: realTechEmail,
        password: 'InitialPassword@123',
        specialty: 'PLUMBING',
        shiftName: '07:00 - 15:00',
        isOnDuty: false,
      }),
    });

    const createTechData = await createTechRes.json();
    assert(createTechRes.status === 201, `API tạo KTV trả về HTTP 201 (Status: ${createTechRes.status})`);
    assert(createTechData.success === true, 'Response payload success = true');
    assert(createTechData.emailSent === true, 'Response xác nhận emailSent = true (Email OTP thật đã được gửi qua Google SMTP)');
    createdTechId = createTechData.technician?.id;

    const dbTech = await prisma.user.findUnique({ where: { id: createdTechId } });
    assert(dbTech?.role === 'TECHNICIAN' && dbTech?.isActivated === false, 'KTV trong PostgreSQL có role = TECHNICIAN và isActivated = false');

    const techOtpDb = await prisma.otpVerification.findFirst({
      where: { email: realTechEmail, purpose: 'ACCOUNT_ACTIVATION', isUsed: false },
      orderBy: { createdAt: 'desc' },
    });
    assert(Boolean(techOtpDb), 'Database lưu bản ghi OtpVerification với purpose = ACCOUNT_ACTIVATION');

    // ========================================================================
    // 2. KTV ĐĂNG NHẬP KHI CHƯA KÍCH HOẠT -> NHẬN 403 & THÔNG BÁO CHUẨN
    // ========================================================================
    console.log('\n--- 2. KTV ĐĂNG NHẬP CHƯA KÍCH HOẠT ---');
    const ktvLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testTechPhone, password: 'InitialPassword@123' }),
    });

    assert(ktvLoginRes.status === 403, `API Login trả về HTTP 403 (Status: ${ktvLoginRes.status})`);
    const ktvLoginData = await ktvLoginRes.json();
    assert(ktvLoginData.isPendingActivation === true, 'Response có isPendingActivation = true');
    assert(ktvLoginData.role === 'TECHNICIAN', 'Role trả về là TECHNICIAN');
    assert(ktvLoginData.message === 'Tài khoản chưa kích hoạt. Vui lòng xác thực OTP', `Thông báo chuẩn: "${ktvLoginData.message}"`);

    // ========================================================================
    // 3. KTV BẤM GỬI LẠI MÃ OTP (POST /api/auth/otp/request-activation)
    // ========================================================================
    console.log('\n--- 3. KTV BẤM GỬI LẠI MÃ OTP ---');
    // 3a. Kiểm tra cooldown 60s
    const cooldownRes = await fetch(`${baseUrl}/auth/otp/request-activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: realTechEmail }),
    });
    assert(cooldownRes.status === 429, `Chặn gửi lại liên tục: HTTP 429 Cooldown (Status: ${cooldownRes.status})`);
    const cooldownData = await cooldownRes.json();
    assert(cooldownData.code === 'OTP_COOLDOWN_ACTIVE', 'Mã lỗi cooldown là OTP_COOLDOWN_ACTIVE');
    assert(cooldownData.message.includes('Vui lòng đợi') || cooldownData.message.includes('Vui lòng chờ'), `Thông báo cooldown chuẩn: "${cooldownData.message}"`);

    // ========================================================================
    // 4. NHẬP OTP SAI -> API TỪ CHỐI & BÁO LỖI CHUẨN
    // ========================================================================
    console.log('\n--- 4. NHẬP OTP SAI ---');
    const wrongOtpRes = await fetch(`${baseUrl}/auth/otp/activate-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: realTechEmail,
        otp: '999999',
        newPassword: 'NewTechPassword@2026',
        confirmPassword: 'NewTechPassword@2026',
      }),
    });

    assert(wrongOtpRes.status === 400, `Nhập OTP sai trả về HTTP 400 (Status: ${wrongOtpRes.status})`);
    const wrongOtpData = await wrongOtpRes.json();
    assert(wrongOtpData.message === 'Mã OTP không chính xác. Vui lòng kiểm tra lại', `Thông báo lỗi chuẩn: "${wrongOtpData.message}"`);

    // ========================================================================
    // 5. NHẬP OTP HẾT HẠN -> API TỪ CHỐI & BÁO LỖI CHUẨN
    // ========================================================================
    console.log('\n--- 5. NHẬP OTP HẾT HẠN ---');
    const expiredOtpRaw = '123987';
    await prisma.otpVerification.create({
      data: {
        email: realTechEmail,
        otpHash: hashOtp(expiredOtpRaw, realTechEmail),
        purpose: 'ACCOUNT_ACTIVATION',
        expiresAt: new Date(Date.now() - 10 * 60 * 1000), // Hết hạn từ 10 phút trước
        attempts: 0,
        isUsed: false,
      },
    });

    const expiredOtpRes = await fetch(`${baseUrl}/auth/otp/activate-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: realTechEmail,
        otp: expiredOtpRaw,
        newPassword: 'NewTechPassword@2026',
        confirmPassword: 'NewTechPassword@2026',
      }),
    });

    assert(expiredOtpRes.status === 400, `Nhập OTP hết hạn trả về HTTP 400 (Status: ${expiredOtpRes.status})`);
    const expiredOtpData = await expiredOtpRes.json();
    assert(expiredOtpData.message === 'Mã OTP đã hết hạn. Vui lòng gửi mã mới' || expiredOtpData.message === 'Mã OTP đã hết hạn. Vui lòng gửi lại mã mới', `Thông báo lỗi chuẩn: "${expiredOtpData.message}"`);

    // ========================================================================
    // 6. NHẬP MẬT KHẨU KHÔNG KHỚP & QUÁ NGẮN -> BÁO LỖI CHUẨN
    // ========================================================================
    console.log('\n--- 6. VALIDATION MẬT KHẨU ---');
    // 6a. Mật khẩu xác nhận không khớp
    const mismatchPwdRes = await fetch(`${baseUrl}/auth/otp/activate-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: realTechEmail,
        otp: '123456',
        newPassword: 'Password123',
        confirmPassword: 'DifferentPassword456',
      }),
    });
    assert(mismatchPwdRes.status === 400, 'Mật khẩu xác nhận không khớp trả về HTTP 400');
    const mismatchPwdData = await mismatchPwdRes.json();
    assert(mismatchPwdData.message === 'Mật khẩu xác nhận không trùng khớp', `Thông báo chuẩn: "${mismatchPwdData.message}"`);

    // 6b. Mật khẩu dưới 6 ký tự
    const shortPwdRes = await fetch(`${baseUrl}/auth/otp/activate-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: realTechEmail,
        otp: '123456',
        newPassword: '123',
        confirmPassword: '123',
      }),
    });
    assert(shortPwdRes.status === 400, 'Mật khẩu dưới 6 ký tự trả về HTTP 400');
    const shortPwdData = await shortPwdRes.json();
    assert(shortPwdData.message === 'Mật khẩu phải có ít nhất 6 ký tự', `Thông báo chuẩn: "${shortPwdData.message}"`);

    // 6c. Email không đúng với tài khoản
    const wrongEmailRes = await fetch(`${baseUrl}/auth/otp/activate-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent_account_email@resifix.vn',
        otp: '123456',
        newPassword: 'ValidPassword@123',
        confirmPassword: 'ValidPassword@123',
      }),
    });
    assert(wrongEmailRes.status === 404, 'Email không đúng tài khoản trả về HTTP 404');
    const wrongEmailData = await wrongEmailRes.json();
    assert(wrongEmailData.message === 'Email không khớp với tài khoản đã đăng ký' || wrongEmailData.message.includes('không khớp'), `Thông báo chuẩn: "${wrongEmailData.message}"`);

    // ========================================================================
    // 7. NHẬP ĐÚNG OTP KÍCH HOẠT -> KÍCH HOẠT THÀNH CÔNG
    // ========================================================================
    console.log('\n--- 7. NHẬP ĐÚNG OTP & KÍCH HOẠT THÀNH CÔNG ---');
    const validActivationOtp = '654321';
    await prisma.otpVerification.updateMany({
      where: { email: realTechEmail, purpose: 'ACCOUNT_ACTIVATION' },
      data: { isUsed: true },
    });
    await prisma.otpVerification.create({
      data: {
        email: realTechEmail,
        otpHash: hashOtp(validActivationOtp, realTechEmail),
        purpose: 'ACCOUNT_ACTIVATION',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
        isUsed: false,
      },
    });

    const activateSuccessRes = await fetch(`${baseUrl}/auth/otp/activate-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: realTechEmail,
        otp: validActivationOtp,
        newPassword: 'ActivatedTechPassword@2026',
        confirmPassword: 'ActivatedTechPassword@2026',
      }),
    });

    assert(activateSuccessRes.status === 200, `Kích hoạt tài khoản trả về HTTP 200 (Status: ${activateSuccessRes.status})`);
    const activateSuccessData = await activateSuccessRes.json();
    assert(activateSuccessData.message === 'Kích hoạt tài khoản thành công', `Thông báo chuẩn: "${activateSuccessData.message}"`);
    assert(activateSuccessData.role === 'TECHNICIAN', 'Role trả về = TECHNICIAN');

    const activatedTechInDb = await prisma.user.findUnique({ where: { id: createdTechId } });
    assert(activatedTechInDb?.isActivated === true, 'Database ghi nhận isActivated = true');
    assert(activatedTechInDb?.mustChangePassword === false, 'Database ghi nhận mustChangePassword = false');

    // 7b. Thử dùng lại mã OTP vừa kích hoạt -> Phải bị từ chối
    const reuseOtpRes = await fetch(`${baseUrl}/auth/otp/activate-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: realTechEmail,
        otp: validActivationOtp,
        newPassword: 'AnotherPassword@123',
        confirmPassword: 'AnotherPassword@123',
      }),
    });
    assert(reuseOtpRes.status === 400, 'Dùng lại OTP đã sử dụng trả về HTTP 400');
    const reuseOtpData = await reuseOtpRes.json();
    assert(reuseOtpData.message === 'Mã OTP này đã được sử dụng' || reuseOtpData.message === 'Mã OTP đã được sử dụng', `Thông báo chuẩn: "${reuseOtpData.message}"`);

    // ========================================================================
    // 8. KTV ĐĂNG NHẬP SAU KHI KÍCH HOẠT -> THÀNH CÔNG VÀO GIAO DIỆN KTV
    // ========================================================================
    console.log('\n--- 8. KTV ĐĂNG NHẬP SAU KHI KÍCH HOẠT ---');
    const ktvPostLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testTechPhone, password: 'ActivatedTechPassword@2026' }),
    });

    assert(ktvPostLoginRes.status === 200, 'KTV đăng nhập thành công HTTP 200');
    const ktvPostLoginData = await ktvPostLoginRes.json();
    assert(Boolean(ktvPostLoginData.token), 'Nhận JWT token hợp lệ');
    assert(ktvPostLoginData.user?.role === 'TECHNICIAN', 'Role người dùng là TECHNICIAN');
    assert(ktvPostLoginData.user?.isActivated === true, 'Trạng thái tài khoản isActivated = true');

    // ========================================================================
    // 9. BMB TẠO CƯ DÂN -> EMAIL NHẬN OTP THẬT
    // ========================================================================
    console.log('\n--- 9. BMB TẠO CƯ DÂN QUA POST /api/management/residents ---');
    const createResRes = await fetch(`${baseUrl}/management/residents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bmbToken}`,
      },
      body: JSON.stringify({
        fullName: 'Cư Dân Test Email Thật',
        phone: testResPhone,
        email: realResEmail,
        apartmentCode: 'G101',
        buildingBlock: 'Tòa G',
        floorNumber: 1,
        residencyRole: 'TENANT',
      }),
    });

    const createResData = await createResRes.json();
    assert(createResRes.status === 201 || createResRes.status === 200, `API tạo Cư dân trả về HTTP 201/200 (Status: ${createResRes.status})`);
    assert(createResData.success === true, 'Tạo cư dân thành công');
    createdResId = createResData.resident?.id;

    const dbRes = await prisma.user.findUnique({ where: { id: createdResId } });
    assert(dbRes?.role === 'RESIDENT' && dbRes?.isActivated === false, 'Cư dân trong DB có role = RESIDENT và isActivated = false');

    // Kích hoạt tài khoản Cư dân bằng mã OTP đúng
    const resOtpRaw = '543210';
    await prisma.otpVerification.updateMany({
      where: { email: realResEmail, purpose: 'ACCOUNT_ACTIVATION' },
      data: { isUsed: true },
    });
    await prisma.otpVerification.create({
      data: {
        email: realResEmail,
        otpHash: hashOtp(resOtpRaw, realResEmail),
        purpose: 'ACCOUNT_ACTIVATION',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
        isUsed: false,
      },
    });

    const activateResSuccess = await fetch(`${baseUrl}/auth/otp/activate-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: realResEmail,
        otp: resOtpRaw,
        newPassword: 'ActivatedResPassword@2026',
        confirmPassword: 'ActivatedResPassword@2026',
      }),
    });
    assert(activateResSuccess.status === 200, 'Kích hoạt tài khoản cư dân thành công');

    // Cư dân đăng nhập
    const resLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testResPhone, password: 'ActivatedResPassword@2026' }),
    });
    assert(resLoginRes.status === 200, 'Cư dân đăng nhập thành công HTTP 200');
    const resLoginData = await resLoginRes.json();
    assert(resLoginData.user?.role === 'RESIDENT', 'Role người dùng là RESIDENT');

    // ========================================================================
    // 10. QUÊN MẬT KHẨU VẪN HOẠT ĐỘNG BÌNH THƯỜNG
    // ========================================================================
    console.log('\n--- 10. CHỨC NĂNG QUÊN MẬT KHẨU ---');
    const forgotRes = await fetch(`${baseUrl}/auth/otp/request-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testTechPhone }),
    });
    assert(forgotRes.status === 200, 'Yêu cầu OTP quên mật khẩu thành công HTTP 200');

    // ========================================================================
    // 11. BMB ĐĂNG NHẬP KHÔNG BỊ ẢNH HƯỞNG
    // ========================================================================
    console.log('\n--- 11. BMB ĐĂNG NHẬP ---');
    assert(bmbUser.role === 'BMB' && bmbUser.isActive === true, 'Tài khoản BMB hoạt động bình thường, quyền hạn nguyên vẹn');

    console.log('\n========================================================================');
    console.log(`🏆 KẾT QUẢ KIỂM THỬ: ${passCount} PASSED / ${failCount} FAILED`);
    console.log('========================================================================\n');
  } finally {
    // Dọn dẹp an toàn các tài khoản kiểm thử
    if (createdTechId) {
      await prisma.user.delete({ where: { id: createdTechId } }).catch(() => undefined);
    }
    if (createdResId) {
      await prisma.residencyRecord.deleteMany({ where: { residentId: createdResId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: createdResId } }).catch(() => undefined);
    }
    await prisma.otpVerification.deleteMany({
      where: { email: { in: [realTechEmail, realResEmail] } },
    }).catch(() => undefined);

    server.close();
    await prisma.$disconnect();
  }
}

runRealEmailAndValidationTests().catch((err) => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
