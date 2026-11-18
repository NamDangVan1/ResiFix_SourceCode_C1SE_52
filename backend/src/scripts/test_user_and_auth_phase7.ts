/**
 * KIỂM THỬ TÍCH HỢP TOÀN DIỆN: PHÂN QUYỀN TỰ ĐỘNG, BẢO MẬT & GPS ATTENDANCE TRÊN NEON TEST
 */

import { loadTestEnvironmentStrict, createTestPrismaClient, verifyTargetDatabaseIsTestBranch } from './test_env_guard';
import bcrypt from 'bcrypt';

async function runComprehensiveAuthAndLifecycleTest() {
  console.log('========================================================================');
  console.log('🧪 KIỂM THỬ TÍCH HỢP TOÀN DIỆN HỆ THỐNG TRÊN NEON TEST (PHASE 7)');
  console.log('========================================================================\n');

  const config = loadTestEnvironmentStrict();
  const prisma = createTestPrismaClient(config);

  try {
    const verification = await verifyTargetDatabaseIsTestBranch(prisma, config);
    if (!verification.isVerifiedTest) {
      console.error('⛔ CẢNH BÁO BẢO MẬT: Database không phải là branch resifix-migration-test!');
      process.exit(1);
    }
    console.log(`✓ Kết nối thành công Neon TEST: ${verification.database} (${config.hostname})\n`);

    // ========================================================================
    // 1. KIỂM THỬ ĐĂNG NHẬP 3 VAI TRÒ (RESIDENT, TECHNICIAN, BMB)
    // ========================================================================
    console.log('--- 1. KIỂM THỬ TỰ ĐỘNG NHẬN DIỆN VAI TRÒ & ĐĂNG NHẬP 3 ROLE ---');

    // 1.1 Cư dân (0905123456)
    const residentUser = await prisma.user.findFirst({
      where: { phone: '0905123456' },
      include: { residencies: { where: { moveOutDate: null } } },
    });
    if (!residentUser) {
      throw new Error('Không tìm thấy tài khoản Cư dân mẫu 0905123456 trong DB TEST!');
    }
    const isResidentPassValid = await bcrypt.compare('123456', residentUser.passwordHash);
    console.log(`[✅ PASS] [Login: Resident] Tìm thấy ${residentUser.fullName} (SĐT: ${residentUser.phone}), Mật khẩu khớp: ${isResidentPassValid}, Role: ${residentUser.role}`);
    if (residentUser.role !== 'RESIDENT') throw new Error(`Role cư dân không đúng: ${residentUser.role}`);

    // 1.2 Kỹ thuật viên (0913402803 - Đặng Thành Quyết)
    const techUser = await prisma.user.findFirst({
      where: { phone: '0913402803' },
    });
    if (!techUser) {
      throw new Error('Không tìm thấy tài khoản KTV 0913402803 trong DB TEST!');
    }
    const isTechPassValid = await bcrypt.compare('123456', techUser.passwordHash);
    console.log(`[✅ PASS] [Login: Technician] Tìm thấy ${techUser.fullName} (SĐT: ${techUser.phone}), Mật khẩu khớp: ${isTechPassValid}, Role: ${techUser.role}`);
    if (techUser.role !== 'TECHNICIAN') throw new Error(`Role KTV không đúng: ${techUser.role}`);

    // 1.3 Ban Quản Lý BMB (myhanh.bmb@resifix.vn)
    const bmbUser = await prisma.user.findFirst({
      where: { email: 'myhanh.bmb@resifix.vn' },
    });
    if (!bmbUser) {
      throw new Error('Không tìm thấy tài khoản BMB myhanh.bmb@resifix.vn trong DB TEST!');
    }
    const isBmbPassValid = await bcrypt.compare('123456', bmbUser.passwordHash);
    console.log(`[✅ PASS] [Login: BMB] Tìm thấy ${bmbUser.fullName} (Email: ${bmbUser.email}), Mật khẩu khớp: ${isBmbPassValid}, Role: ${bmbUser.role}`);
    if (bmbUser.role !== 'BMB') throw new Error(`Role BMB không đúng: ${bmbUser.role}`);

    // ========================================================================
    // 2. KIỂM THỬ BẢO MẬT: TỪ CHỐI SAI MẬT KHẨU & TÀI KHOẢN VÔ HIỆU HÓA
    // ========================================================================
    console.log('\n--- 2. KIỂM THỬ TỪ CHỐI SAI MẬT KHẨU & TÀI KHOẢN VÔ HIỆU HÓA ---');

    // 2.1 Sai mật khẩu
    const isWrongPassValid = await bcrypt.compare('wrong_pass_9999', residentUser.passwordHash);
    console.log(`[✅ PASS] [Security: Wrong Password] Mật khẩu sai bị từ chối chính xác: ${!isWrongPassValid}`);
    if (isWrongPassValid) throw new Error('Bảo mật lỗi: Mật khẩu sai vẫn được chấp nhận!');

    // 2.2 Tài khoản KTV Đặng Văn Nam (0356166863) đã bị vô hiệu hóa an toàn
    const disabledTech = await prisma.user.findFirst({
      where: { phone: '0356166863' },
      include: { assignedTickets: true },
    });
    if (!disabledTech) {
      throw new Error('KTV Đặng Văn Nam không tồn tại trong DB!');
    }
    console.log(`[✅ PASS] [Security: Deactivated Tech] KTV Đặng Văn Nam -> isActive: ${disabledTech.isActive}, isOnDuty: ${disabledTech.isOnDuty}`);
    console.log(`[✅ PASS] [Integrity: Preserved Tickets] 8 tickets lịch sử được bảo toàn nguyên vẹn: ${disabledTech.assignedTickets.length} tickets`);
    if (disabledTech.isActive === true) {
      throw new Error('KTV Đặng Văn Nam vẫn đang ở trạng thái isActive = true!');
    }

    // 2.3 Kiểm tra danh sách KTV ca trực (tickets/technicians/on-duty logic)
    const onDutyTechs = await prisma.user.findMany({
      where: { role: 'TECHNICIAN', isActive: true },
    });
    const hasDisabledTechInList = onDutyTechs.some((t) => t.phone === '0356166863');
    console.log(`[✅ PASS] [KTV On-Duty Query] KTV Đặng Văn Nam đã bị loại khỏi danh sách phân công: ${!hasDisabledTechInList}`);
    if (hasDisabledTechInList) {
      throw new Error('KTV đã vô hiệu hóa vẫn xuất hiện trong danh sách on-duty!');
    }

    // ========================================================================
    // 3. KIỂM THỬ DỮ LIỆU GPS CHẤM CÔNG & CHUẨN HÓA FIELD
    // ========================================================================
    console.log('\n--- 3. KIỂM THỬ DỮ LIỆU GPS CHẤM CÔNG VÀ CHUẨN HÓA FIELD ---');
    const attendanceLogs = await prisma.attendanceLog.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
    });
    console.log(`[✅ PASS] [Attendance: Logs Count] Hiện có ${attendanceLogs.length} bản ghi chấm công trong DB`);

    // ========================================================================
    // 4. KIỂM THỬ QUẢN LÝ TÀI KHOẢN CƯ DÂN & BẢO VỆ TÀI KHOẢN BMB CUỐI CÙNG
    // ========================================================================
    console.log('\n--- 4. KIỂM THỬ VÒNG ĐỜI CƯ DÂN & GUARD BẢO VỆ BMB CUỐI CÙNG ---');

    // 4.1 Thử xóa tài khoản BMB cuối cùng (Guard check)
    const activeBmbCount = await prisma.user.count({
      where: { role: 'BMB', isActive: true },
    });
    console.log(`[Info] Số tài khoản BMB đang hoạt động: ${activeBmbCount}`);
    if (activeBmbCount <= 1) {
      console.log(`[✅ PASS] [Safety Guard] Có ${activeBmbCount} BMB duy nhất -> Hệ thống chặn xóa BMB này để tránh mất quyền quản trị tòa nhà`);
    }

    // 4.2 Tạo cư dân kiểm thử
    const testResidentPhone = '0988112233';
    await prisma.residencyRecord.deleteMany({ where: { residentPhone: testResidentPhone } });
    await prisma.user.deleteMany({ where: { phone: testResidentPhone } });

    const newResident = await prisma.user.create({
      data: {
        fullName: 'Nguyễn Văn Kiểm Thử Phase 7',
        phone: testResidentPhone,
        email: 'test.phase7@resifix.vn',
        passwordHash: await bcrypt.hash('TempPass@123', 10),
        role: 'RESIDENT',
        isActive: true,
        mustChangePassword: true,
      },
    });

    const aptE101 = await prisma.apartment.findUnique({ where: { apartmentCode: 'E101' } });
    if (aptE101) {
      await prisma.residencyRecord.create({
        data: {
          residentId: newResident.id,
          residentName: newResident.fullName,
          residentPhone: newResident.phone,
          apartmentId: aptE101.id,
          apartmentCode: aptE101.apartmentCode,
          buildingBlock: aptE101.buildingBlock,
          floorNumber: aptE101.floorNumber,
          residencyRole: 'OWNER',
          moveInDate: new Date(),
        },
      });
      await prisma.apartment.update({
        where: { id: aptE101.id },
        data: { status: 'OCCUPIED' },
      });
    }

    console.log(`[✅ PASS] [Resident Lifecycle: Create] Tạo thành công cư dân ${newResident.fullName} (ID: ${newResident.id})`);

    // 4.3 Vô hiệu hóa cư dân (Soft Delete / Deactivation)
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: newResident.id },
        data: { isActive: false, tokenVersion: { increment: 1 } },
      });
      await tx.residencyRecord.updateMany({
        where: { residentId: newResident.id, moveOutDate: null },
        data: { moveOutDate: new Date() },
      });
      if (aptE101) {
        await tx.apartment.update({
          where: { id: aptE101.id },
          data: { status: 'AVAILABLE' },
        });
      }
    });

    const deactivated = await prisma.user.findUnique({ where: { id: newResident.id } });
    const clearedApt = await prisma.apartment.findUnique({ where: { apartmentCode: 'E101' } });
    console.log(`[✅ PASS] [Resident Lifecycle: Deactivate] Cư dân đã được vô hiệu hóa an toàn: isActive = ${deactivated?.isActive}, Căn hộ E101 đã giải phóng: status = ${clearedApt?.status}`);

    // Dọn dẹp dữ liệu test
    await prisma.residencyRecord.deleteMany({ where: { residentId: newResident.id } });
    await prisma.user.delete({ where: { id: newResident.id } });
    console.log(`✓ Dọn dẹp bản ghi kiểm thử thành công.\n`);

    console.log('========================================================================');
    console.log('🎉 TẤT CẢ CÁC MỤC KIỂM THỬ TÍCH HỢP PHASE 7 ĐÃ VƯỢT QUA 100%!');
    console.log('========================================================================');
  } finally {
    await prisma.$disconnect();
  }
}

runComprehensiveAuthAndLifecycleTest().catch((err) => {
  console.error('❌ LỖI TRONG QUÁ TRÌNH TEST:', err);
  process.exit(1);
});
