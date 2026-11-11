import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

async function main() {
  console.log('========================================================================');
  console.log('🔎 RESIFIX PRODUCTION - KIỂM TRA HẬU MIGRATION (POST-CHECK)');
  console.log('========================================================================\n');

  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ Không tìm thấy file backend/.env!');
    process.exit(1);
  }

  const rawEnv = fs.readFileSync(envPath, 'utf8');
  const parsed = dotenv.parse(rawEnv);
  const prodDatabaseUrl = (parsed.DATABASE_URL || '').trim();

  const parsedUrl = new URL(prodDatabaseUrl);
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname.includes('ao4iuzkq') || hostname.includes('old-sound')) {
    console.error('❌ DATABASE_URL trong backend/.env đang trỏ vào TEST! Hủy bỏ.');
    process.exit(1);
  }

  console.log(`✓ Database Target: ${hostname} (PRODUCTION)`);
  console.log(`✓ Database Name  : ${parsedUrl.pathname.replace(/^\//, '') || 'resifix_db'}\n`);

  const prisma = new PrismaClient({
    datasources: { db: { url: prodDatabaseUrl } },
  });

  let passCount = 0;
  let failCount = 0;

  function runAssert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  [✅ PASS] ${desc}`);
      passCount++;
    } else {
      console.error(`  [❌ FAIL] ${desc}`);
      failCount++;
    }
  }

  try {
    // 1. Kiểm tra sự tồn tại của đầy đủ 17 bảng
    console.log('--- 1. KIỂM TRA ĐẦY ĐỦ 17 BẢNG TRONG SCHEMA.PRISMA ---');
    const expectedTables = [
      'User', 'BuildingArea', 'IncidentTicket', 'TicketMedia', 'TicketStatusLog', 'Notification',
      'SystemSetting', 'Apartment', 'ResidencyRecord', 'AttendanceLog', 'OvertimeRequest',
      'MonthlyPayrollLock', 'ShiftScheduleRequest', 'RepairMaterialCost', 'MaterialItem',
      'SlaTracking', 'OtpVerification'
    ];

    const tablesRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`
    );
    const existingTableNames = tablesRes.map((r) => r.table_name);

    for (const t of expectedTables) {
      runAssert(existingTableNames.includes(t), `Bảng "${t}" tồn tại trong database`);
    }

    // 2. Kiểm tra cột mới trên bảng User
    console.log('\n--- 2. KIỂM TRA CỘT MỚI TRÊN BẢNG User ---');
    const userCols = await prisma.$queryRawUnsafe<any[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'User';`
    );
    const userColNames = userCols.map((c) => c.column_name);
    runAssert(userColNames.includes('isActivated'), 'Cột "isActivated" tồn tại trên User');
    runAssert(userColNames.includes('mustChangePassword'), 'Cột "mustChangePassword" tồn tại trên User');
    runAssert(userColNames.includes('tokenVersion'), 'Cột "tokenVersion" tồn tại trên User');

    // 3. Kiểm tra cột mới trên IncidentTicket
    console.log('\n--- 3. KIỂM TRA CỘT MỚI TRÊN IncidentTicket ---');
    const ticketCols = await prisma.$queryRawUnsafe<any[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'IncidentTicket';`
    );
    const ticketColNames = ticketCols.map((c) => c.column_name);
    runAssert(ticketColNames.includes('apartmentId'), 'Cột "apartmentId" tồn tại trên IncidentTicket');

    // 4. Kiểm tra bảo toàn dữ liệu cũ
    console.log('\n--- 4. KIỂM TRA BẢO TOÀN DỮ LIỆU CŨ ---');
    const userCnt = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::text as cnt FROM "User";`);
    runAssert(parseInt(userCnt[0]?.cnt, 10) >= 4, `Số lượng User được bảo toàn (>= 4, thực tế: ${userCnt[0]?.cnt})`);

    const ticketCnt = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::text as cnt FROM "IncidentTicket";`);
    runAssert(parseInt(ticketCnt[0]?.cnt, 10) >= 16, `Số lượng IncidentTicket được bảo toàn (>= 16, thực tế: ${ticketCnt[0]?.cnt})`);

    const mediaCnt = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::text as cnt FROM "TicketMedia";`);
    runAssert(parseInt(mediaCnt[0]?.cnt, 10) >= 35, `Số lượng TicketMedia được bảo toàn (>= 35, thực tế: ${mediaCnt[0]?.cnt})`);

    const notiCnt = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::text as cnt FROM "Notification";`);
    runAssert(parseInt(notiCnt[0]?.cnt, 10) >= 548, `Số lượng Notification được bảo toàn (>= 548, thực tế: ${notiCnt[0]?.cnt})`);

    const areaCnt = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::text as cnt FROM "BuildingArea";`);
    runAssert(parseInt(areaCnt[0]?.cnt, 10) >= 5, `Số lượng BuildingArea được bảo toàn (>= 5, thực tế: ${areaCnt[0]?.cnt})`);

    // 5. Kiểm tra trạng thái isActivated của 4 User cũ
    console.log('\n--- 5. KIỂM TRA TRẠNG THÁI TÀI KHOẢN CŨ (KHÔNG BỊ KHÓA OTP) ---');
    if (userColNames.includes('isActivated')) {
      const unactivatedOldUsers = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::text as cnt FROM "User" WHERE "isActivated" = false;`
      );
      runAssert(
        parseInt(unactivatedOldUsers[0]?.cnt, 10) === 0,
        `Tất cả tài khoản cũ đều có isActivated = true (không bị chặn đăng nhập đột ngột)`
      );
    }

    // 6. Kiểm tra dữ liệu nền tảng đã nạp
    console.log('\n--- 6. KIỂM TRA DỮ LIỆU NỀN TẢNG (APARTMENTS & SETTINGS) ---');
    if (existingTableNames.includes('Apartment')) {
      const aptCount = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::text as cnt FROM "Apartment";`);
      runAssert(parseInt(aptCount[0]?.cnt, 10) >= 75, `Bảng Apartment có đủ 75 căn hộ chuẩn (thực tế: ${aptCount[0]?.cnt})`);
    }

    if (existingTableNames.includes('SystemSetting')) {
      const settingCount = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::text as cnt FROM "SystemSetting";`);
      runAssert(parseInt(settingCount[0]?.cnt, 10) >= 4, `Bảng SystemSetting có đủ 4 cấu hình cốt lõi (thực tế: ${settingCount[0]?.cnt})`);
    }

    // 7. Kiểm tra lịch sử migration trong _prisma_migrations
    console.log('\n--- 7. KIỂM TRA LỊCH SỬ MIGRATION (_prisma_migrations) ---');
    const migs = await prisma.$queryRawUnsafe<any[]>(
      `SELECT migration_name FROM "_prisma_migrations" ORDER BY started_at ASC;`
    );
    const migNames = migs.map((m) => m.migration_name);
    runAssert(migNames.includes('0_init'), 'Bản ghi lịch sử ban đầu "0_init" được bảo tồn');
    runAssert(migNames.includes('20261105_apartments_and_payroll'), 'Migration "20261105_apartments_and_payroll" đã ghi nhận');
    runAssert(migNames.includes('20261106_otp_and_activation'), 'Migration "20261106_otp_and_activation" đã ghi nhận');
    runAssert(migNames.includes('20261110_resident_lifecycle_and_pwd'), 'Migration "20261110_resident_lifecycle_and_pwd" đã ghi nhận');

    console.log('\n========================================================================');
    console.log(`KẾT QUẢ POST-CHECK: ${passCount} PASSED / ${failCount} FAILED`);
    console.log('========================================================================\n');

    if (failCount > 0) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal post-check error:', err);
  process.exit(1);
});

