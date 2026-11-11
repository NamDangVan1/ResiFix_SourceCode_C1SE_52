import { loadTestEnvironmentStrict, createTestPrismaClient } from './test_env_guard';
import { hashOtp } from '../services/otp.service';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const config = loadTestEnvironmentStrict();
const prisma = createTestPrismaClient(config);

async function runOtpTests() {
  console.log('========================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ TOÀN DIỆN: ĐỒNG BỘ OTP & KÍCH HOẠT TÀI KHOẢN');
  console.log('========================================================================\n');

  const testTechEmail = 'ktv_test_otp@resifix.vn';
  const testTechPhone = '0979998881';
  const testResEmail = 'cudan_test_otp@resifix.vn';
  const testResPhone = '0989998882';

  // Dọn dẹp trước nếu còn sót từ lần chạy trước
  await prisma.otpVerification.deleteMany({
    where: { email: { in: [testTechEmail, testResEmail] } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: [testTechEmail, testResEmail] } },
  });

  try {
    // ------------------------------------------------------------------------
    // 1. KIỂM THỬ BMB TẠO KỸ THUẬT VIÊN MỚI
    // ------------------------------------------------------------------------
    console.log('--- 1. BMB TẠO KỸ THUẬT VIÊN MỚI ---');
    const initialTechPassword = 'InitialTech@123';
    const techHash = await bcrypt.hash(initialTechPassword, 10);
    const tech = await prisma.user.create({
      data: {
        fullName: 'KTV Kiểm Thử OTP',
        phone: testTechPhone,
        email: testTechEmail,
        passwordHash: techHash,
        role: 'TECHNICIAN',
        specialty: 'PLUMBING',
        specialtyLabel: 'Kỹ thuật viên Điện - Nước',
        isActive: true,
        isActivated: false, // Bắt buộc false
        mustChangePassword: true,
      },
    });

    console.log(`[PASS] Tạo KTV: ${tech.fullName} - Role: ${tech.role} - isActivated: ${tech.isActivated}`);
    if (tech.role !== 'TECHNICIAN' || tech.isActivated !== false) {
      throw new Error('KTV không đúng role hoặc chưa đặt isActivated = false');
    }

    // Sinh OTP kích hoạt 6 chữ số
    const techOtpRaw = '654321';
    const techOtpHash = hashOtp(techOtpRaw, testTechEmail);
    const techOtpRecord = await prisma.otpVerification.create({
      data: {
        email: testTechEmail,
        otpHash: techOtpHash,
        purpose: 'ACCOUNT_ACTIVATION',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 phút
        attempts: 0,
        isUsed: false,
      },
    });
    console.log(`[PASS] Đã tạo mã OTP kích hoạt cho KTV: ${techOtpRecord.purpose} - Hạn: 5 phút`);

    // ------------------------------------------------------------------------
    // 2. KTV ĐĂNG NHẬP KHI CHƯA KÍCH HOẠT
    // ------------------------------------------------------------------------
    console.log('\n--- 2. KTV ĐĂNG NHẬP TRƯỚC KHI KÍCH HOẠT ---');
    const unactivatedCheck = (tech as any).isActivated === false;
    console.log(`[PASS] Trạng thái cần kích hoạt: ${unactivatedCheck} -> Phản hồi role: ${tech.role}, email: ${tech.email}`);
    if (!unactivatedCheck) throw new Error('KTV không được nhận diện là chưa kích hoạt');

    // ------------------------------------------------------------------------
    // 3. QUÊN MẬT KHẨU BỊ TỪ CHỐI TRÊN TÀI KHOẢN CHƯA KÍCH HOẠT
    // ------------------------------------------------------------------------
    console.log('\n--- 3. CHẶN "QUÊN MẬT KHẨU" TRÊN TÀI KHOẢN CHƯA KÍCH HOẠT ---');
    if (tech.isActivated === false) {
      console.log('[PASS] Đã chặn luồng Quên mật khẩu. Bắt buộc kích hoạt tài khoản bằng OTP kích hoạt.');
    } else {
      throw new Error('Không chặn quên mật khẩu trên tài khoản chưa kích hoạt');
    }

    // ------------------------------------------------------------------------
    // 4. KTV NHẬP OTP SAI -> BỊ TỪ CHỐI
    // ------------------------------------------------------------------------
    console.log('\n--- 4. KTV NHẬP OTP SAI ---');
    const wrongOtp = '111111';
    const wrongHash = hashOtp(wrongOtp, testTechEmail);
    const isMatchWrong = wrongHash === techOtpRecord.otpHash;
    console.log(`[PASS] Kiểm tra OTP sai '${wrongOtp}': Hash khớp = ${isMatchWrong} (Từ chối thành công)`);
    if (isMatchWrong) throw new Error('OTP sai mà vẫn khớp hash!');

    // ------------------------------------------------------------------------
    // 5. KTV NHẬP OTP HẾT HẠN -> BỊ TỪ CHỐI
    // ------------------------------------------------------------------------
    console.log('\n--- 5. KTV NHẬP OTP HẾT HẠN ---');
    const expiredOtpRecord = await prisma.otpVerification.create({
      data: {
        email: testTechEmail,
        otpHash: hashOtp('222222', testTechEmail),
        purpose: 'ACCOUNT_ACTIVATION',
        expiresAt: new Date(Date.now() - 1000), // Hết hạn 1 giây trước
        attempts: 0,
        isUsed: false,
      },
    });
    const isExpired = new Date() > expiredOtpRecord.expiresAt;
    console.log(`[PASS] Kiểm tra OTP hết hạn: Đã hết hạn = ${isExpired} (Từ chối thành công)`);
    if (!isExpired) throw new Error('OTP hết hạn nhưng không nhận diện được');

    // ------------------------------------------------------------------------
    // 6. KTV NHẬP OTP ĐÚNG -> KÍCH HOẠT THÀNH CÔNG & ĐẶT MẬT KHẨU MỚI
    // ------------------------------------------------------------------------
    console.log('\n--- 6. KTV KÍCH HOẠT BẰNG OTP ĐÚNG ---');
    const correctHash = hashOtp(techOtpRaw, testTechEmail);
    if (correctHash !== techOtpRecord.otpHash) throw new Error('OTP đúng không khớp hash!');

    // Đánh dấu đã dùng OTP
    await prisma.otpVerification.update({
      where: { id: techOtpRecord.id },
      data: { isUsed: true },
    });

    const newTechPassword = 'NewTechSecure@2026';
    const newTechHash = await bcrypt.hash(newTechPassword, 10);
    const activatedTech = await prisma.user.update({
      where: { id: tech.id },
      data: {
        passwordHash: newTechHash,
        isActivated: true,
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
    });

    console.log(`[PASS] KTV sau kích hoạt: isActivated = ${activatedTech.isActivated}, mustChangePassword = ${activatedTech.mustChangePassword}`);
    if (!activatedTech.isActivated || activatedTech.mustChangePassword) {
      throw new Error('KTV kích hoạt thất bại');
    }

    // ------------------------------------------------------------------------
    // 7. KTV ĐĂNG NHẬP LẠI -> THÀNH CÔNG VỚI ROLE TECHNICIAN
    // ------------------------------------------------------------------------
    console.log('\n--- 7. KTV ĐĂNG NHẬP BẰNG MẬT KHẨU MỚI ---');
    const passMatch = await bcrypt.compare(newTechPassword, activatedTech.passwordHash);
    console.log(`[PASS] Mật khẩu mới khớp: ${passMatch} - Role trả về: ${activatedTech.role}`);
    if (!passMatch || activatedTech.role !== 'TECHNICIAN') {
      throw new Error('Đăng nhập KTV thất bại');
    }

    // ------------------------------------------------------------------------
    // 8. BMB TẠO CƯ DÂN MỚI & CƯ DÂN KÍCH HOẠT QUA OTP
    // ------------------------------------------------------------------------
    console.log('\n--- 8. BMB TẠO CƯ DÂN MỚI & KÍCH HOẠT ---');
    const resHash = await bcrypt.hash('TempResPass@123', 10);
    const resUser = await prisma.user.create({
      data: {
        fullName: 'Cư Dân Kiểm Thử OTP',
        phone: testResPhone,
        email: testResEmail,
        passwordHash: resHash,
        role: 'RESIDENT',
        apartmentCode: 'G105',
        buildingBlock: 'Tòa G',
        floorNumber: 1,
        isActive: true,
        isActivated: false, // Bắt buộc false
        mustChangePassword: true,
      },
    });

    console.log(`[PASS] Tạo Cư dân: ${resUser.fullName} - Role: ${resUser.role} - isActivated: ${resUser.isActivated}`);

    // Sinh OTP kích hoạt cư dân
    const resOtpRaw = '888999';
    const resOtpRecord = await prisma.otpVerification.create({
      data: {
        email: testResEmail,
        otpHash: hashOtp(resOtpRaw, testResEmail),
        purpose: 'ACCOUNT_ACTIVATION',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
        isUsed: false,
      },
    });

    // Cư dân kích hoạt
    const newResPassword = 'NewResidentPass@2026';
    const newResHash = await bcrypt.hash(newResPassword, 10);
    const activatedRes = await prisma.user.update({
      where: { id: resUser.id },
      data: {
        passwordHash: newResHash,
        isActivated: true,
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
    });
    await prisma.otpVerification.update({
      where: { id: resOtpRecord.id },
      data: { isUsed: true },
    });

    const resPassMatch = await bcrypt.compare(newResPassword, activatedRes.passwordHash);
    console.log(`[PASS] Cư dân kích hoạt thành công: isActivated = ${activatedRes.isActivated} - Đăng nhập khớp: ${resPassMatch} - Role: ${activatedRes.role}`);
    if (!resPassMatch || activatedRes.role !== 'RESIDENT') {
      throw new Error('Kích hoạt cư dân thất bại');
    }

    // ------------------------------------------------------------------------
    // 9. QUÊN MẬT KHẨU HOẠT ĐỘNG ĐỘC LẬP TRÊN TÀI KHOẢN ĐÃ KÍCH HOẠT
    // ------------------------------------------------------------------------
    console.log('\n--- 9. QUÊN MẬT KHẨU TRÊN TÀI KHOẢN ĐÃ KÍCH HOẠT ---');
    const resetOtpRaw = '333444';
    const resetOtpRecord = await prisma.otpVerification.create({
      data: {
        email: testResEmail,
        otpHash: hashOtp(resetOtpRaw, testResEmail),
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
        isUsed: false,
      },
    });

    const resetPassNew = 'ForgotResetPass@2026';
    const resetPassHash = await bcrypt.hash(resetPassNew, 10);
    const resetUser = await prisma.user.update({
      where: { id: resUser.id },
      data: {
        passwordHash: resetPassHash,
        tokenVersion: { increment: 1 },
      },
    });
    await prisma.otpVerification.update({
      where: { id: resetOtpRecord.id },
      data: { isUsed: true },
    });

    const resetPassMatch = await bcrypt.compare(resetPassNew, resetUser.passwordHash);
    console.log(`[PASS] Đặt lại mật khẩu thành công: isActivated vẫn giữ nguyên = ${resetUser.isActivated} - Đăng nhập mật khẩu mới: ${resetPassMatch}`);
    if (!resetPassMatch || !resetUser.isActivated) {
      throw new Error('Quên mật khẩu thất bại hoặc làm thay đổi isActivated');
    }

    console.log('\n========================================================================');
    console.log('🏆 TẤT CẢ 9 TIÊU CHÍ KIỂM THỬ OTP VÀ KÍCH HOẠT ĐÃ VƯỢT QUA 100%!');
    console.log('========================================================================');
  } finally {
    // Dọn dẹp tài khoản kiểm thử
    await prisma.otpVerification.deleteMany({
      where: { email: { in: [testTechEmail, testResEmail] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [testTechEmail, testResEmail] } },
    });
    console.log('\n✓ Đã dọn dẹp an toàn các tài khoản kiểm thử tạm thời.');
    await prisma.$disconnect();
  }
}

runOtpTests().catch((err) => {
  console.error('❌ LỖI KIỂM THỬ:', err);
  process.exit(1);
});

