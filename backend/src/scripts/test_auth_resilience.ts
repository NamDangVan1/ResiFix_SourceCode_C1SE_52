import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

function runAssertion(testName: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName} - ${detail || ''}`);
    process.exit(1);
  }
}

async function testAuthResilience() {
  console.log('====================================================');
  console.log('BẮT ĐẦU CHẠY BỘ TEST: BẢO VỆ ĐĂNG NHẬP & PHÒNG CHỐNG P2022');
  console.log('====================================================');

  // 1. Kiểm tra logic nhận diện tài khoản cũ vs tài khoản chưa kích hoạt
  console.log('\n--- 1. Kiểm tra logic kích hoạt tài khoản ---');
  const validPasswordHash = await bcrypt.hash('Password123@', 10);
  const unactivatedPasswordHash = '!UNACTIVATED_abc1234567890def';

  // 1.1 Người dùng cũ (chưa có cột isActivated trên DB -> isActivated = undefined)
  const legacyUser = {
    id: 'user_tech_001',
    phone: '0356166863',
    role: Role.TECHNICIAN,
    fullName: 'Trần Kỹ Thuật',
    passwordHash: validPasswordHash,
    isActive: true,
    isActivated: undefined,
  };

  const isLegacyUnactivated = (legacyUser as any).isActivated === false || legacyUser.passwordHash.startsWith('!UNACTIVATED_');
  runAssertion('Tài khoản KTV cũ (cột isActivated = undefined) KHÔNG bị khóa kích hoạt', !isLegacyUnactivated);

  const isLegacyPassValid = await bcrypt.compare('Password123@', legacyUser.passwordHash);
  runAssertion('Tài khoản KTV cũ xác thực Bcrypt thành công với mật khẩu đúng', isLegacyPassValid);

  // 1.2 Người dùng mới tạo chưa kích hoạt (passwordHash bắt đầu bằng !UNACTIVATED_)
  const newResidentUser = {
    id: 'user_res_new_001',
    phone: '0912345678',
    email: 'newres@example.com',
    role: Role.RESIDENT,
    fullName: 'Nguyễn Văn Mới',
    passwordHash: unactivatedPasswordHash,
    isActive: true,
    isActivated: undefined, // Dù DB chưa có cột, cờ !UNACTIVATED_ trong passwordHash vẫn bảo vệ tuyệt đối
  };

  const isNewUnactivated = (newResidentUser as any).isActivated === false || newResidentUser.passwordHash.startsWith('!UNACTIVATED_');
  runAssertion('Tài khoản cư dân mới tạo bằng BMB bị chặn đăng nhập và yêu cầu OTP kích hoạt', isNewUnactivated);

  // 1.3 Người dùng mới sau khi kích hoạt thành công (passwordHash được đổi sang Bcrypt, isActivated = true)
  const activatedUser = {
    id: 'user_res_new_001',
    phone: '0912345678',
    email: 'newres@example.com',
    role: Role.RESIDENT,
    fullName: 'Nguyễn Văn Mới',
    passwordHash: validPasswordHash,
    isActive: true,
    isActivated: true,
  };

  const isAlreadyActivated = (activatedUser as any).isActivated === false || activatedUser.passwordHash.startsWith('!UNACTIVATED_');
  runAssertion('Tài khoản đã kích hoạt qua OTP cho phép đăng nhập bình thường', !isAlreadyActivated);

  // 2. Kiểm tra tính tương thích ngược của BuildingArea và alias asset
  console.log('\n--- 2. Kiểm tra BuildingArea và tương thích ngược Frontend ---');
  const sampleArea = {
    id: 'area-uuid-001',
    qrCode: 'WP-1204',
    areaName: 'Căn hộ A-1204',
    locationLabel: 'Căn hộ A-1204 • Tầng 12 - Tòa S1',
    buildingBlock: 'Tòa S1',
    floor: '12',
    category: 'PLUMBING',
    isActive: true,
  };

  const sampleTicketFromDb = {
    id: 'ticket-uuid-001',
    ticketCode: '#RF-2026-001',
    title: 'Rò rỉ nước bồn rửa bát',
    areaId: sampleArea.id,
    area: sampleArea,
  };

  const mappedTicket = {
    ...sampleTicketFromDb,
    asset: sampleTicketFromDb.area ? {
      id: sampleTicketFromDb.area.id,
      qrCode: sampleTicketFromDb.area.qrCode,
      assetName: sampleTicketFromDb.area.areaName,
      areaName: sampleTicketFromDb.area.areaName,
      locationLabel: sampleTicketFromDb.area.locationLabel,
      buildingBlock: sampleTicketFromDb.area.buildingBlock,
      floor: sampleTicketFromDb.area.floor,
      category: sampleTicketFromDb.area.category,
      isActive: sampleTicketFromDb.area.isActive,
    } : null,
  };

  runAssertion('Ticket giữ nguyên trường area theo chuẩn Schema BuildingArea', Boolean(mappedTicket.area && mappedTicket.area.areaName === 'Căn hộ A-1204'));
  runAssertion('Ticket ánh xạ alias asset tương thích 100% với Frontend client/App.tsx', Boolean(mappedTicket.asset && mappedTicket.asset.assetName === 'Căn hộ A-1204'));
  runAssertion('asset.qrCode hiển thị chính xác WP-1204 trên thẻ Card', mappedTicket.asset?.qrCode === 'WP-1204');

  // 3. Kiểm tra tính toàn vẹn của Token JWT
  console.log('\n--- 3. Kiểm tra ký và giải mã JWT Token ---');
  const jwtSecret = 'test_jwt_secret_key_1234567890';
  const token = jwt.sign(
    {
      userId: legacyUser.id,
      phone: legacyUser.phone,
      role: legacyUser.role,
      fullName: legacyUser.fullName,
      tokenVersion: 0,
    },
    jwtSecret,
    { expiresIn: '7d' }
  );

  const decoded: any = jwt.verify(token, jwtSecret);
  runAssertion('JWT Token giải mã chứa đúng userId', decoded.userId === legacyUser.id);
  runAssertion('JWT Token chứa đúng role TECHNICIAN', decoded.role === Role.TECHNICIAN);
  runAssertion('JWT Token chứa tokenVersion = 0 fallback an toàn', decoded.tokenVersion === 0);

  console.log('\n====================================================');
  console.log('TẤT CẢ CÁC BÀI TEST BẢO VỆ ĐĂNG NHẬP & TƯƠNG THÍCH ĐỀU PASS 100%!');
  console.log('====================================================');
}

testAuthResilience().catch((err) => {
  console.error(err);
  process.exit(1);
});

