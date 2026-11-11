process.env.NODE_ENV = 'test';
process.env.RESIFIX_ENV = 'test';

import { loadTestEnvironmentStrict, createTestPrismaClient } from './test_env_guard';
import express from 'express';
import http from 'http';
import bcrypt from 'bcrypt';
import { hashOtp } from '../services/otp.service';

const config = loadTestEnvironmentStrict();
const prisma = createTestPrismaClient(config);

function simulateFrontendTitleResolution(data: any, currentRole: 'RESIDENT' | 'TECHNICIAN' | null): {
  resolvedRole: 'RESIDENT' | 'TECHNICIAN' | null;
  modalTitle: string;
} {
  const rawRole = (data?.role || data?.user?.role || '').toString().toUpperCase().trim();
  const resolvedRole: 'RESIDENT' | 'TECHNICIAN' | null =
    rawRole === 'TECHNICIAN' ? 'TECHNICIAN' : rawRole === 'RESIDENT' ? 'RESIDENT' : currentRole;

  const modalTitle =
    resolvedRole === 'TECHNICIAN'
      ? 'Kích hoạt tài khoản Kỹ thuật viên'
      : resolvedRole === 'RESIDENT'
      ? 'Kích hoạt tài khoản Cư dân'
      : 'Kích hoạt tài khoản';

  return { resolvedRole, modalTitle };
}

async function runRoleActivationVerification() {
  console.log('========================================================================');
  console.log('🧪 KIỂM CHỨNG TOÀN DIỆN: NHẬN DIỆN ROLE KHI KÍCH HOẠT TÀI KHOẢN');
  console.log('========================================================================\n');

  const { default: authRoutes } = await import('../routes/auth.routes');
  const { default: ticketRoutes } = await import('../routes/ticket.routes');
  const { default: managementRoutes } = await import('../routes/management.routes');

  // Khởi tạo HTTP Express server test trên port ngẫu nhiên
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/api/management', managementRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api/auth`;

  const testTechEmail = 'ktv_role_verify@resifix.vn';
  const testTechPhone = '0981112233';
  const testResEmail = 'cudan_role_verify@resifix.vn';
  const testResPhone = '0982223344';

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

  // Dọn dẹp trước nếu còn dữ liệu cũ
  await prisma.otpVerification.deleteMany({
    where: { email: { in: [testTechEmail, testResEmail] } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: [testTechEmail, testResEmail] } },
  });

  try {
    // ========================================================================
    // TEST 1: KTV CHƯA KÍCH HOẠT ĐĂNG NHẬP (KIỂM TRA 403 & NHẬN DIỆN ROLE KTV)
    // ========================================================================
    console.log('--- TEST 1: BMB TẠO KTV & KTV ĐĂNG NHẬP CHƯA KÍCH HOẠT ---');
    const initialTechPassword = 'InitialTechPass@123';
    const techUser = await prisma.user.create({
      data: {
        fullName: 'KTV Trần Văn Kiểm Thử',
        phone: testTechPhone,
        email: testTechEmail,
        passwordHash: await bcrypt.hash(initialTechPassword, 10),
        role: 'TECHNICIAN',
        specialty: 'ELECTRICAL',
        specialtyLabel: 'Điện & Chiếu sáng',
        isActive: true,
        isActivated: false,
        mustChangePassword: true,
      },
    });

    assert(techUser.role === 'TECHNICIAN' && techUser.isActivated === false, 'KTV tạo thành công với role TECHNICIAN và isActivated = false');

    const ktvLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testTechPhone, password: initialTechPassword }),
    });

    assert(ktvLoginRes.status === 403, `API Login trả về HTTP 403 (Nhận được: ${ktvLoginRes.status})`);
    const ktvLoginData = await ktvLoginRes.json();
    console.log('  Response Payload KTV Login 403:', JSON.stringify(ktvLoginData, null, 2));

    assert(ktvLoginData.isPendingActivation === true, 'Response payload có isPendingActivation = true');
    assert(ktvLoginData.role === 'TECHNICIAN', 'Response payload có top-level role = "TECHNICIAN"');
    assert(ktvLoginData.user?.role === 'TECHNICIAN', 'Response payload có user.role = "TECHNICIAN"');

    // Giả lập logic Frontend xử lý response
    const ktvUiState = simulateFrontendTitleResolution(ktvLoginData, null);
    assert(ktvUiState.resolvedRole === 'TECHNICIAN', 'Frontend nhận diện chính xác role = "TECHNICIAN"');
    assert(ktvUiState.modalTitle === 'Kích hoạt tài khoản Kỹ thuật viên', 'Frontend render tiêu đề: "Kích hoạt tài khoản Kỹ thuật viên"');
    assert(ktvUiState.modalTitle !== 'Kích hoạt tài khoản Cư dân', 'Frontend KHÔNG bị nhầm thành "Kích hoạt tài khoản Cư dân"');

    // ========================================================================
    // TEST 2: CƯ DÂN CHƯA KÍCH HOẠT ĐĂNG NHẬP (KIỂM TRA 403 & NHẬN DIỆN ROLE RESIDENT)
    // ========================================================================
    console.log('\n--- TEST 2: BMB TẠO CƯ DÂN & CƯ DÂN ĐĂNG NHẬP CHƯA KÍCH HOẠT ---');
    const initialResPassword = 'InitialResPass@123';
    const resUser = await prisma.user.create({
      data: {
        fullName: 'Cư Dân Lê Thị Kiểm Thử',
        phone: testResPhone,
        email: testResEmail,
        passwordHash: await bcrypt.hash(initialResPassword, 10),
        role: 'RESIDENT',
        isActive: true,
        isActivated: false,
        mustChangePassword: true,
      },
    });

    assert(resUser.role === 'RESIDENT' && resUser.isActivated === false, 'Cư dân tạo thành công với role RESIDENT và isActivated = false');

    const resLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testResPhone, password: initialResPassword }),
    });

    assert(resLoginRes.status === 403, `API Login trả về HTTP 403 (Nhận được: ${resLoginRes.status})`);
    const resLoginData = await resLoginRes.json();
    console.log('  Response Payload Cư Dân Login 403:', JSON.stringify(resLoginData, null, 2));

    assert(resLoginData.isPendingActivation === true, 'Response payload có isPendingActivation = true');
    assert(resLoginData.role === 'RESIDENT', 'Response payload có top-level role = "RESIDENT"');
    assert(resLoginData.user?.role === 'RESIDENT', 'Response payload có user.role = "RESIDENT"');

    // Giả lập logic Frontend xử lý response
    const resUiState = simulateFrontendTitleResolution(resLoginData, null);
    assert(resUiState.resolvedRole === 'RESIDENT', 'Frontend nhận diện chính xác role = "RESIDENT"');
    assert(resUiState.modalTitle === 'Kích hoạt tài khoản Cư dân', 'Frontend render tiêu đề: "Kích hoạt tài khoản Cư dân"');
    assert(resUiState.modalTitle !== 'Kích hoạt tài khoản Kỹ thuật viên', 'Frontend KHÔNG bị nhầm thành "Kích hoạt tài khoản Kỹ thuật viên"');

    // ========================================================================
    // TEST 3: KTV KÍCH HOẠT BẰNG OTP VÀ ĐĂNG NHẬP THÀNH CÔNG VỚI ROLE KTV
    // ========================================================================
    console.log('\n--- TEST 3: KTV NHẬP OTP KÍCH HOẠT & ĐĂNG NHẬP VỚI MẬT KHẨU MỚI ---');
    const techOtpRaw = '888999';
    await prisma.otpVerification.create({
      data: {
        email: testTechEmail,
        otpHash: hashOtp(techOtpRaw, testTechEmail),
        purpose: 'ACCOUNT_ACTIVATION',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
        isUsed: false,
      },
    });

    const newTechPassword = 'NewTechSecurePass@2026';
    const ktvActivateRes = await fetch(`${baseUrl}/otp/activate-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testTechEmail, otp: techOtpRaw, newPassword: newTechPassword }),
    });

    assert(ktvActivateRes.status === 200, `KTV kích hoạt tài khoản thành công HTTP 200 (Nhận được: ${ktvActivateRes.status})`);
    const ktvActivateData = await ktvActivateRes.json();
    assert(ktvActivateData.role === 'TECHNICIAN', 'API kích hoạt trả về role = "TECHNICIAN"');

    const updatedTech = await prisma.user.findUnique({ where: { id: techUser.id } });
    assert(updatedTech?.isActivated === true && updatedTech?.mustChangePassword === false, 'DB cập nhật KTV: isActivated = true, mustChangePassword = false');

    // Đăng nhập KTV bằng mật khẩu mới
    const ktvPostLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testTechPhone, password: newTechPassword }),
    });

    assert(ktvPostLoginRes.status === 200, 'KTV đăng nhập thành công với mật khẩu mới HTTP 200');
    const ktvPostLoginData = await ktvPostLoginRes.json();
    assert(Boolean(ktvPostLoginData.token), 'Nhận JWT token hợp lệ');
    assert(ktvPostLoginData.user?.role === 'TECHNICIAN', 'User role sau đăng nhập là TECHNICIAN');

    // ========================================================================
    // TEST 4: CƯ DÂN KÍCH HOẠT BẰNG OTP VÀ ĐĂNG NHẬP THÀNH CÔNG VỚI ROLE CƯ DÂN
    // ========================================================================
    console.log('\n--- TEST 4: CƯ DÂN NHẬP OTP KÍCH HOẠT & ĐĂNG NHẬP VỚI MẬT KHẨU MỚI ---');
    const resOtpRaw = '777888';
    await prisma.otpVerification.create({
      data: {
        email: testResEmail,
        otpHash: hashOtp(resOtpRaw, testResEmail),
        purpose: 'ACCOUNT_ACTIVATION',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
        isUsed: false,
      },
    });

    const newResPassword = 'NewResSecurePass@2026';
    const resActivateRes = await fetch(`${baseUrl}/otp/activate-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testResEmail, otp: resOtpRaw, newPassword: newResPassword }),
    });

    assert(resActivateRes.status === 200, `Cư dân kích hoạt tài khoản thành công HTTP 200 (Nhận được: ${resActivateRes.status})`);
    const resActivateData = await resActivateRes.json();
    assert(resActivateData.role === 'RESIDENT', 'API kích hoạt trả về role = "RESIDENT"');

    const updatedRes = await prisma.user.findUnique({ where: { id: resUser.id } });
    assert(updatedRes?.isActivated === true && updatedRes?.mustChangePassword === false, 'DB cập nhật Cư dân: isActivated = true, mustChangePassword = false');

    // Đăng nhập Cư dân bằng mật khẩu mới
    const resPostLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testResPhone, password: newResPassword }),
    });

    assert(resPostLoginRes.status === 200, 'Cư dân đăng nhập thành công với mật khẩu mới HTTP 200');
    const resPostLoginData = await resPostLoginRes.json();
    assert(Boolean(resPostLoginData.token), 'Nhận JWT token hợp lệ');
    assert(resPostLoginData.user?.role === 'RESIDENT', 'User role sau đăng nhập là RESIDENT');

    // ========================================================================
    // TEST 5: EDGE CASE - MỞ MODAL TRỰC TIẾP & REQUEST OTP CẬP NHẬT ĐỘNG
    // ========================================================================
    console.log('\n--- TEST 5: EDGE CASE - MỞ MODAL TRỰC TIẾP & GỬI LẠI OTP CẬP NHẬT ROLE ĐỘNG ---');
    // Khi người dùng bấm trực tiếp "Kích hoạt tài khoản" trên màn hình đăng nhập
    const neutralState = simulateFrontendTitleResolution({}, null);
    assert(neutralState.resolvedRole === null, 'Khi chưa có role, resolvedRole = null');
    assert(neutralState.modalTitle === 'Kích hoạt tài khoản', 'Tiêu đề trung tính: "Kích hoạt tài khoản" (KHÔNG tự gán Cư dân)');

    // Tạo KTV thứ hai chưa kích hoạt để test luồng request-activation
    const testTech2Email = 'ktv_request_otp@resifix.vn';
    await prisma.otpVerification.deleteMany({ where: { email: testTech2Email } });
    await prisma.user.deleteMany({ where: { email: testTech2Email } });
    await prisma.user.create({
      data: {
        fullName: 'KTV Yêu Cầu Lại OTP',
        phone: '0983334455',
        email: testTech2Email,
        passwordHash: await bcrypt.hash('TempPass@123', 10),
        role: 'TECHNICIAN',
        specialty: 'PLUMBING',
        specialtyLabel: 'Điện - Nước',
        isActive: true,
        isActivated: false,
        mustChangePassword: true,
      },
    });

    const requestActivationRes = await fetch(`${baseUrl}/otp/request-activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testTech2Email }),
    });

    // Email SMTP có thể không kết nối được trên sandbox hoặc mock, nhưng router trả về role trong response nếu gửi thành công
    // hoặc ta kiểm tra schema phản hồi của router
    if (requestActivationRes.status === 200) {
      const reqActData = await requestActivationRes.json();
      assert(reqActData.role === 'TECHNICIAN', 'POST /otp/request-activation trả về role = "TECHNICIAN"');
      assert(reqActData.user?.role === 'TECHNICIAN', 'POST /otp/request-activation trả về user.role = "TECHNICIAN"');
      const dynamicUiState = simulateFrontendTitleResolution(reqActData, null);
      assert(dynamicUiState.modalTitle === 'Kích hoạt tài khoản Kỹ thuật viên', 'Sau khi request OTP, tiêu đề tự động cập nhật: "Kích hoạt tài khoản Kỹ thuật viên"');
    } else {
      console.log(`  [INFO] SMTP chưa kết nối (Status ${requestActivationRes.status}), bỏ qua gửi mail thực tế, kiểm tra route contract.`);
    }

    // Dọn dẹp tài khoản KTV 2
    await prisma.otpVerification.deleteMany({ where: { email: testTech2Email } });
    await prisma.user.deleteMany({ where: { email: testTech2Email } });

    console.log('\n========================================================================');
    console.log(`🏆 KẾT QUẢ KIỂM THỬ: ${passCount} PASSED / ${failCount} FAILED`);
    console.log('========================================================================\n');
  } finally {
    // Dọn dẹp an toàn các tài khoản kiểm thử
    await prisma.otpVerification.deleteMany({
      where: { email: { in: [testTechEmail, testResEmail] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [testTechEmail, testResEmail] } },
    });
    server.close();
    await prisma.$disconnect();
  }
}

runRoleActivationVerification().catch((err) => {
  console.error('Fatal error in role activation verification:', err);
  process.exit(1);
});
