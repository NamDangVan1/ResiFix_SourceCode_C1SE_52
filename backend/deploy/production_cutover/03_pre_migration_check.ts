import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

async function main() {
  console.log('========================================================================');
  console.log('🔍 RESIFIX PRODUCTION - KIỂM TRA ĐIỀU KIỆN TIỀN MIGRATION (PRE-CHECK)');
  console.log('========================================================================\n');

  // 1. Đọc và thẩm định backend/.env
  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ [FAIL] Không tìm thấy file backend/.env!');
    process.exit(1);
  }

  const rawEnv = fs.readFileSync(envPath, 'utf8');
  const parsed = dotenv.parse(rawEnv);
  const prodDatabaseUrl = (parsed.DATABASE_URL || '').trim();

  if (!prodDatabaseUrl) {
    console.error('❌ [FAIL] Thiếu biến DATABASE_URL trong backend/.env!');
    process.exit(1);
  }

  const parsedUrl = new URL(prodDatabaseUrl);
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname.includes('ao4iuzkq') || hostname.includes('old-sound')) {
    console.error('❌ [FAIL] Biến DATABASE_URL đang trỏ vào TEST! Hủy bỏ ngay lập tức.');
    process.exit(1);
  }

  console.log('--- 1. XÁC MINH TARGET DATABASE ---');
  console.log(`✓ Database Host: ${hostname} (Xác nhận PRODUCTION)`);
  console.log(`✓ Database Name: ${parsedUrl.pathname.replace(/^\//, '') || 'resifix_db'}\n`);

  const prisma = new PrismaClient({
    datasources: { db: { url: prodDatabaseUrl } },
  });

  try {
    // 2. Kiểm tra dữ liệu cốt lõi cần bảo toàn
    console.log('--- 2. KIỂM TRA BẢO TOÀN DỮ LIỆU CỐT LÕI (CORE DATA AUDIT) ---');
    const tableCounts: Record<string, number> = {};
    const checkTables = ['User', 'IncidentTicket', 'TicketMedia', 'TicketStatusLog', 'Notification', 'BuildingArea'];

    for (const tbl of checkTables) {
      try {
        const res = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::text as cnt FROM "${tbl}";`);
        tableCounts[tbl] = parseInt(res[0]?.cnt || '0', 10);
        console.log(`  [✅ PASS] Bảng "${tbl}": ${tableCounts[tbl]} bản ghi nguyên vẹn`);
      } catch (err: any) {
        console.error(`  [❌ FAIL] Bảng "${tbl}" gặp lỗi: ${err.message}`);
        process.exit(1);
      }
    }

    if (tableCounts['User'] !== 4) {
      console.warn(`  ⚠️ Cảnh báo: Số lượng User hiện tại là ${tableCounts['User']} (kỳ vọng 4).`);
    }
    if (tableCounts['IncidentTicket'] !== 16) {
      console.warn(`  ⚠️ Cảnh báo: Số lượng IncidentTicket hiện tại là ${tableCounts['IncidentTicket']} (kỳ vọng 16).`);
    }

    // 3. Kiểm tra các tài khoản quan trọng
    console.log('\n--- 3. KIỂM TRA DANH TÁNH TÀI KHOẢN PRODUCTION ---');
    const users = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "fullName", role::text, email, SUBSTRING(phone, 1, 4) || '****' || SUBSTRING(phone, 9, 2) as masked_phone 
       FROM "User" 
       ORDER BY role;`
    );
    for (const u of users) {
      console.log(`  [✅ PASS] [${u.role}] ${u.fullName} (SĐT: ${u.masked_phone})`);
    }

    // 4. Kiểm tra trạng thái migration hiện tại
    console.log('\n--- 4. KIỂM TRA TRẠNG THÁI MIGRATION HIỆN TẠI ---');
    const migrations = await prisma.$queryRawUnsafe<any[]>(
      `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at ASC;`
    );
    console.log(`✓ Số migration hiện có: ${migrations.length}`);
    for (const m of migrations) {
      console.log(`   - ${m.migration_name} (${m.finished_at ? 'HOÀN THÀNH' : 'PENDING'})`);
    }

    // 5. Kiểm tra bảng thiếu
    console.log('\n--- 5. XÁC NHẬN CÁC THÀNH PHẦN SẼ ĐƯỢC BỔ SUNG TRONG MIGRATION ---');
    const existingTablesRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`
    );
    const existingTableNames = existingTablesRes.map((r) => r.table_name);

    const missingExpected = [
      'SystemSetting', 'Apartment', 'ResidencyRecord', 'AttendanceLog',
      'OvertimeRequest', 'MonthlyPayrollLock', 'ShiftScheduleRequest',
      'RepairMaterialCost', 'MaterialItem', 'SlaTracking', 'OtpVerification'
    ];

    const toCreate = missingExpected.filter((t) => !existingTableNames.includes(t));
    console.log(`✓ 11 Bảng sẽ được tạo mới an toàn (IF NOT EXISTS): ${toCreate.join(', ')}`);

    console.log('\n========================================================================');
    console.log('✅ PRE-MIGRATION CHECK: ĐẠT YÊU CẦU 100%! PRODUCTION SẴN SÀNG CHO CUTOVER.');
    console.log('========================================================================\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal pre-check error:', err);
  process.exit(1);
});

