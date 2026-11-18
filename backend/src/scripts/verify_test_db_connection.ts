/**
 * SCRIPT KIỂM TRA KẾT NỐI CHỈ ĐỌC (READ-ONLY) VÀO NEON TEST DATABASE
 * 
 * MỤC TIÊU:
 * 1. Đọc duy nhất backend/.env.test. Tuyệt đối không đọc backend/.env.
 * 2. Hiển thị database, schema, hostname (KHÔNG in username, password hoặc connection string).
 * 3. Đối chiếu Fingerprint cấu trúc thực tế của TEST:
 *    - Bảng Apartment: kiểm tra số lượng (dự kiến 0).
 *    - Bảng BuildingArea: kiểm tra sự hiện diện.
 *    - Bảng IncidentTicket & ResidencyRecord: kiểm tra sự hiện diện.
 * 4. Xác nhận an toàn: Tuyệt đối từ chối nếu phát hiện bất kỳ dấu hiệu nào của Production.
 * 5. 100% READ-ONLY, hoàn toàn không ghi hay chỉnh sửa database.
 */

import { loadTestEnvironmentStrict, createTestPrismaClient, verifyTargetDatabaseIsTestBranch } from './test_env_guard';

async function main() {
  console.log('===============================================================');
  console.log('🔍 KIỂM TRA KẾT NỐI CHỈ ĐỌC VÀO NEON TEST DATABASE');
  console.log('===============================================================\n');

  // 1. Nạp và kiểm tra nghiêm ngặt .env.test
  const config = loadTestEnvironmentStrict();

  console.log('Thông tin kết nối (Đã lọc bỏ thông tin bảo mật):');
  console.log(`- Database Name : ${config.databaseName}`);
  console.log(`- Hostname      : ${config.hostname}`);
  console.log(`- Port          : ${config.port}`);
  console.log(`- Nguồn cấu hình: backend/.env.test (Độc lập 100% với .env Production)\n`);

  const prisma = createTestPrismaClient(config);

  try {
    console.log('Đang thực hiện truy vấn kiểm tra kết nối chỉ đọc...');
    const verification = await verifyTargetDatabaseIsTestBranch(prisma, config);

    console.log('✓ Kết nối thành công đến PostgreSQL server!');
    console.log(`  - Database thực tế : ${verification.database}`);
    console.log(`  - Schema thực tế   : ${verification.schema}`);
    console.log(`  - Phiên bản Server : ${verification.serverVersion}\n`);

    console.log('--- KHẢO SÁT DANH SÁCH BẢNG HIỆN CÓ TRÊN TEST ---');
    console.log(`Tổng số bảng phát hiện: ${verification.tableCount}`);
    console.log(`Danh sách: ${verification.tables.join(', ') || '(Chưa có bảng nào)'}\n`);

    console.log('--- ĐỐI CHIẾU DẤU VẾT HỆ THỐNG (BRANCH FINGERPRINT) ---');
    const { fingerprint } = verification;
    console.log(`- Bảng BuildingArea   : ${fingerprint.hasBuildingArea ? `ĐÃ TỒN TẠI (${fingerprint.buildingAreaCount} bản ghi)` : 'CHƯA TỒN TẠI (Khớp hiện trạng branch TEST)'}`);
    console.log(`- Bảng Apartment      : ${fingerprint.hasApartment ? `ĐÃ TỒN TẠI (${fingerprint.apartmentCount} bản ghi)` : 'CHƯA TỒN TẠI'}`);
    console.log(`- Bảng IncidentTicket : ${fingerprint.hasIncidentTicket ? `ĐÃ TỒN TẠI (${fingerprint.incidentTicketCount} bản ghi)` : 'CHƯA TỒN TẠI'}`);
    console.log(`- Bảng ResidencyRecord: ${fingerprint.hasResidencyRecord ? `ĐÃ TỒN TẠI (${fingerprint.residencyRecordCount} bản ghi)` : 'CHƯA TỒN TẠI'}`);

    // Khảo sát SystemSetting
    const hasSysSetting = verification.tables.includes('SystemSetting');
    if (hasSysSetting) {
      const settings: any[] = await prisma.$queryRaw`SELECT "key", "updatedAt" FROM "SystemSetting";`;
      console.log(`- Bảng SystemSetting   : ĐÃ TỒN TẠI (${settings.length} bản ghi: ${settings.map(s => s.key).join(', ') || 'Rỗng'})`);
    } else {
      console.log(`- Bảng SystemSetting   : CHƯA TỒN TẠI`);
    }

    console.log('\n--- KẾT QUẢ XÁC MINH AN TOÀN ---');
    if (!verification.isVerifiedTest) {
      console.error(`⛔ CẢNH BÁO BẢO MẬT: ${verification.rejectionReason}`);
      console.error('   Hệ thống từ chối xác nhận môi trường TEST!');
      process.exit(1);
    }

    console.log('✅ XÁC NHẬN: Database đích được xác minh là TEST an toàn.');
    console.log('✅ Hoàn toàn độc lập với Production.');
    console.log('✅ Kết nối hoạt động ở chế độ CHỈ ĐỌC (không có bất kỳ thay đổi nào vào DB).\n');
  } catch (dbErr: any) {
    console.error('\n❌ LỖI KẾT NỐI DATABASE TEST:', dbErr.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Lỗi thực thi:', err);
  process.exit(1);
});
