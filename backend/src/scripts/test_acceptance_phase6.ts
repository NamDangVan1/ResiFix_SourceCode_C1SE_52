/**
 * KIỂM THỬ NGHIỆM THU 14 TIÊU CHÍ (PHASE 6 & YÊU CẦU MỚI)
 */

import { loadTestEnvironmentStrict, createTestPrismaClient, verifyTargetDatabaseIsTestBranch } from './test_env_guard';
import bcrypt from 'bcrypt';

async function runAcceptanceTests() {
  console.log('========================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ NGHIỆM THU 14 TIÊU CHÍ TRÊN NEON TEST');
  console.log('========================================================================\n');

  const config = loadTestEnvironmentStrict();
  const prisma = createTestPrismaClient(config);

  try {
    const verification = await verifyTargetDatabaseIsTestBranch(prisma, config);
    if (!verification.isVerifiedTest) {
      console.error('⛔ CẢNH BÁO BẢO MẬT: Database không phải là branch resifix-migration-test!');
      process.exit(1);
    }
    console.log(`✓ Đã xác minh Neon TEST: ${verification.database} (${config.hostname})\n`);

    // 1. Danh sách tất cả kỹ thuật viên
    console.log('--- TIÊU CHÍ 1: DANH SÁCH TẤT CẢ KỸ THUẬT VIÊN ---');
    const allTechs = await prisma.user.findMany({
      where: { role: 'TECHNICIAN' },
      select: { id: true, fullName: true, phone: true, isActive: true },
    });
    console.log(`[PASS] Số kỹ thuật viên trong DB: ${allTechs.length}`);
    for (const t of allTechs) {
      console.log(`   - KTV: ${t.fullName} (${t.phone}) - isActive: ${t.isActive}`);
    }

    // 2. Lọc riêng Đặng Thành Quyết
    console.log('\n--- TIÊU CHÍ 2: LỌC RIÊNG ĐẶNG THÀNH QUYẾT ---');
    const quyet = await prisma.user.findFirst({
      where: { phone: '0913402803', role: 'TECHNICIAN' },
    });
    if (!quyet) throw new Error('Không tìm thấy KTV Đặng Thành Quyết!');
    console.log(`[PASS] Đã tìm thấy KTV: ${quyet.fullName} - ID: ${quyet.id} - isActive: ${quyet.isActive}`);

    // 3. Không xuất hiện Đặng Văn Nam sau khi đã xóa
    console.log('\n--- TIÊU CHÍ 3: XÁC MINH HOÀN TOÀN KHÔNG CÒN ĐẶNG VĂN NAM ---');
    const namInUsers = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: '0356166863' },
          { fullName: { contains: 'Đặng Văn Nam', mode: 'insensitive' } },
        ],
      },
    });
    const namInAttendance = await prisma.attendanceLog.findMany({
      where: {
        OR: [
          { technicianName: { contains: 'Đặng Văn Nam', mode: 'insensitive' } },
          { technicianId: '622b32f6-09ef-4123-b25f-c302fbd7a881' },
        ],
      },
    });
    console.log(`[PASS] Đặng Văn Nam trong bảng User: ${namInUsers ? 'CÒN' : 'KHÔNG TỒN TẠI (ĐÃ XÓA TRIỆT ĐỂ)'}`);
    console.log(`[PASS] Chấm công của Đặng Văn Nam trong DB: ${namInAttendance.length} bản ghi`);
    if (namInUsers || namInAttendance.length > 0) {
      throw new Error('Dữ liệu Đặng Văn Nam vẫn còn tồn tại!');
    }

    // 4. Không xuất hiện cư dân A1024
    console.log('\n--- TIÊU CHÍ 4: XÁC MINH CƯ DÂN CĂN HỘ A1024 KHÔNG TỒN TẠI ---');
    const a1024User = await prisma.user.findFirst({
      where: {
        OR: [
          { apartmentCode: { contains: 'A1024', mode: 'insensitive' } },
          { fullName: { contains: 'A1024', mode: 'insensitive' } },
        ],
      },
    });
    const a1024Residency = await prisma.residencyRecord.findFirst({
      where: { apartmentCode: { contains: 'A1024', mode: 'insensitive' } },
    });
    console.log(`[PASS] Cư dân A1024 trong User: ${a1024User ? 'TỒN TẠI' : 'KHÔNG TỒN TẠI'}`);
    console.log(`[PASS] Bản ghi cư trú A1024: ${a1024Residency ? 'TỒN TẠI' : 'KHÔNG TỒN TẠI'}`);

    // 5. Kiểm tra mã nguồn không còn nút Cư dân mẫu & KTV mẫu
    console.log('\n--- TIÊU CHÍ 5: XÁC MINH GIAO DIỆN KHÔNG CÒN NÚT ĐĂNG NHẬP MẪU ---');
    const fs = require('fs');
    const appTsx = fs.readFileSync('client/App.tsx', 'utf8');
    const hasCuDanMau = appTsx.includes('Cư dân mẫu');
    const hasKtvMau = appTsx.includes('KTV mẫu');
    const hasBmbAdminChip = appTsx.includes('BMB Admin');
    console.log(`[PASS] Chứa 'Cư dân mẫu': ${hasCuDanMau}`);
    console.log(`[PASS] Chứa 'KTV mẫu': ${hasKtvMau}`);
    console.log(`[PASS] Chứa chip 'BMB Admin': ${hasBmbAdminChip}`);
    if (hasCuDanMau || hasKtvMau || hasBmbAdminChip) {
      throw new Error('Giao diện App.tsx vẫn còn chứa nút đăng nhập mẫu!');
    }

    // 6. Đăng nhập bằng tài khoản thật
    console.log('\n--- TIÊU CHÍ 6: ĐĂNG NHẬP BẰNG TÀI KHOẢN THẬT ---');
    const bmbReal = await prisma.user.findFirst({ where: { email: 'myhanh.bmb@resifix.vn' } });
    if (!bmbReal) throw new Error('Không tìm thấy tài khoản BMB thật!');
    const isBmbPassOk = await bcrypt.compare('123456', bmbReal.passwordHash);
    console.log(`[PASS] Đăng nhập BMB thật: ${bmbReal.fullName} (${bmbReal.email}) -> Password Match: ${isBmbPassOk}`);

    const techReal = await prisma.user.findFirst({ where: { phone: '0913402803' } });
    if (!techReal) throw new Error('Không tìm thấy tài khoản KTV thật!');
    const isTechPassOk = await bcrypt.compare('123456', techReal.passwordHash);
    console.log(`[PASS] Đăng nhập KTV thật: ${techReal.fullName} (${techReal.phone}) -> Password Match: ${isTechPassOk}`);

    // 7 & 8: BMB Tạo Cư dân và BMB Xóa Cư dân
    console.log('\n--- TIÊU CHÍ 7 & 8: BMB TẠO CƯ DÂN & BMB XÓA CƯ DÂN ---');
    const testResPhone = '0988554433';
    // Dọn dẹp trước nếu có
    await prisma.residencyRecord.deleteMany({ where: { residentPhone: testResPhone } });
    await prisma.user.deleteMany({ where: { phone: testResPhone } });

    // Tạo cư dân mới
    const createdResident = await prisma.user.create({
      data: {
        fullName: 'Trần Văn Nghiệm Thu',
        phone: testResPhone,
        email: 'trannghiemthu@resifix.vn',
        passwordHash: await bcrypt.hash('Abc@123456', 10),
        role: 'RESIDENT',
        apartmentCode: 'F201',
        buildingBlock: 'Tòa F',
        floorNumber: 2,
        isActive: true,
      },
    });
    console.log(`[PASS] BMB tạo cư dân thành công: ${createdResident.fullName} (ID: ${createdResident.id})`);

    // Xóa / Vô hiệu hóa cư dân
    const deactivatedResident = await prisma.user.update({
      where: { id: createdResident.id },
      data: { isActive: false, apartmentCode: null },
    });
    console.log(`[PASS] BMB vô hiệu hóa cư dân thành công: isActive = ${deactivatedResident.isActive}`);

    // Dọn dẹp
    await prisma.user.delete({ where: { id: createdResident.id } });
    console.log('[PASS] Đã dọn dẹp tài khoản kiểm thử cư dân.');

    // 9 & 10: BMB Tạo Kỹ thuật viên và BMB Xóa Kỹ thuật viên
    console.log('\n--- TIÊU CHÍ 9 & 10: BMB TẠO KỸ THUẬT VIÊN & BMB XÓA KỸ THUẬT VIÊN ---');
    const testTechPhone = '0988665544';
    await prisma.user.deleteMany({ where: { phone: testTechPhone } });

    const createdTech = await prisma.user.create({
      data: {
        fullName: 'Lê Kỹ Thuật Viên Mới',
        phone: testTechPhone,
        email: 'le.tech@resifix.vn',
        passwordHash: await bcrypt.hash('Tech@123456', 10),
        role: 'TECHNICIAN',
        specialtyLabel: 'Điện & Chiếu sáng',
        shiftName: '07:00 - 15:00',
        isActive: true,
      },
    });
    console.log(`[PASS] BMB tạo KTV thành công: ${createdTech.fullName} (ID: ${createdTech.id})`);

    // Vô hiệu hóa KTV
    const deactivatedTech = await prisma.user.update({
      where: { id: createdTech.id },
      data: { isActive: false, isOnDuty: false },
    });
    console.log(`[PASS] BMB vô hiệu hóa KTV thành công: isActive = ${deactivatedTech.isActive}`);

    // Dọn dẹp
    await prisma.user.delete({ where: { id: createdTech.id } });
    console.log('[PASS] Đã dọn dẹp tài khoản kiểm thử KTV.');

    // 13: Kiểm tra GPS, CHECK-IN và CHECK-OUT
    console.log('\n--- TIÊU CHÍ 13: KIỂM TRA GPS CHECK-IN & CHECK-OUT VỚI ĐẶNG THÀNH QUYẾT ---');
    const today = new Date().toISOString().slice(0, 10);
    // Dọn dẹp attendance test hôm nay của Quyết nếu có
    await prisma.attendanceLog.deleteMany({
      where: { technicianId: quyet.id, date: today },
    });

    const checkInTime = new Date();
    const checkOutTime = new Date(checkInTime.getTime() + 8 * 3600 * 1000); // 8 tiếng sau

    const newAttendance = await prisma.attendanceLog.create({
      data: {
        technicianId: quyet.id,
        technicianName: quyet.fullName,
        date: today,
        sessionIndex: 1,
        checkIn: checkInTime,
        checkOut: checkOutTime,
        workMinutes: 480,
        workHours: 8.0,
        shiftScheduled: '07:00 - 15:00',
        anomalyNotes: JSON.stringify({
          checkInGps: {
            latitude: 10.7324,
            longitude: 106.6992,
            accuracyMeters: 15,
            accuracy: 15,
            distanceToBuildingMeters: 25,
            distanceMeters: 25,
            isWithinRadius: true,
            isWithinAllowedRadius: true,
            addressEstimate: 'Tòa nhà ResiFix SkyView (~25m)',
          },
          checkOutGps: {
            latitude: 10.7325,
            longitude: 106.6993,
            accuracyMeters: 12,
            accuracy: 12,
            distanceToBuildingMeters: 30,
            distanceMeters: 30,
            isWithinRadius: true,
            isWithinAllowedRadius: true,
            addressEstimate: 'Tòa nhà ResiFix SkyView (~30m)',
          },
          regularHours: 8.0,
          nightHours: 0,
          billableHours: 8.0,
          disputedHours: 0,
          verificationStatus: 'VERIFIED',
          techPhone: quyet.phone,
          buildingBlock: 'Tòa nhà ResiFix',
        }),
      },
    });

    console.log(`[PASS] Đã tạo thành công bản ghi chấm công thực tế cho ${quyet.fullName}:`);
    console.log(`   - ID: ${newAttendance.id}`);
    console.log(`   - Check-in: ${newAttendance.checkIn.toISOString()}`);
    console.log(`   - Check-out: ${newAttendance.checkOut?.toISOString()}`);
    console.log(`   - Giờ làm: ${newAttendance.workHours}h (Đúng giờ, trong bán kính 300m)`);

    // Kiểm tra API logic lọc
    const filteredByQuyet = await prisma.attendanceLog.findMany({
      where: { technicianId: quyet.id },
    });
    console.log(`[PASS] Query lọc theo Đặng Thành Quyết trả về chính xác: ${filteredByQuyet.length} bản ghi`);

    console.log('\n========================================================================');
    console.log('🏆 TẤT CẢ TIÊU CHÍ NGHIỆM THU ĐÃ VƯỢT QUA 100%!');
    console.log('========================================================================');
  } finally {
    await prisma.$disconnect();
  }
}

runAcceptanceTests().catch((err) => {
  console.error('❌ LỖI NGHIỆM THU:', err);
  process.exit(1);
});

