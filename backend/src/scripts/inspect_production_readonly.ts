import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

async function main() {
  console.log('========================================================================');
  console.log('🔍 BẮT ĐẦU KIỂM TRA ĐỐI CHIẾU NEON PRODUCTION (READ-ONLY)');
  console.log('========================================================================\n');

  // 1. Đọc tường minh file backend/.env (TUYỆT ĐỐI KHÔNG ĐỌC .env.test)
  const envProdPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envProdPath)) {
    console.error('❌ Không tìm thấy file backend/.env!');
    process.exit(1);
  }

  const rawEnv = fs.readFileSync(envProdPath, 'utf8');
  const parsed = dotenv.parse(rawEnv);
  const prodDatabaseUrl = (parsed.DATABASE_URL || '').trim();

  if (!prodDatabaseUrl) {
    console.error('❌ Thiếu DATABASE_URL trong backend/.env!');
    process.exit(1);
  }

  // 2. Thẩm định URL an toàn, tuyệt đối không in secret/password
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(prodDatabaseUrl);
  } catch (err: any) {
    console.error('❌ Cú pháp DATABASE_URL không hợp lệ:', err.message);
    process.exit(1);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const databaseName = parsedUrl.pathname.replace(/^\//, '') || 'neondb';
  const port = parsedUrl.port || '5432';

  // Xác minh đây KHÔNG phải là TEST database
  if (hostname.includes('ao4iuzkq') || hostname.includes('old-sound')) {
    console.error('❌ DATABASE_URL trong backend/.env đang trỏ vào TEST! Hủy bỏ.');
    process.exit(1);
  }

  console.log('--- 1. THÔNG TIN KẾT NỐI PRODUCTION ---');
  console.log(`✓ Môi trường   : PRODUCTION`);
  console.log(`✓ Cấu hình nạp : backend/.env (Chính thức)`);
  console.log(`✓ Database Host: ${hostname}`);
  console.log(`✓ Database Name: ${databaseName}`);
  console.log(`✓ Database Port: ${port}`);
  console.log(`✓ Chế độ        : READ-ONLY (Chỉ đọc, nghiêm cấm mọi thao tác ghi/xóa)\n`);

  // 3. Khởi tạo PrismaClient kết nối tới Production
  const prisma = new PrismaClient({
    datasources: {
      db: { url: prodDatabaseUrl },
    },
  });

  try {
    // 4. Kiểm tra phiên bản DB và thông tin phiên làm việc
    console.log('--- 2. THÔNG TIN DATABASE & PHIÊN LÀM VIỆC ---');
    const versionResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT current_database() as db, current_schema() as schema, current_user as usr, version() as ver;`
    );
    console.log(`✓ Database hiện tại : ${versionResult[0]?.db}`);
    console.log(`✓ Schema hiện tại   : ${versionResult[0]?.schema}`);
    console.log(`✓ User kết nối      : ${versionResult[0]?.usr}`);
    console.log(`✓ PostgreSQL Version: ${versionResult[0]?.ver?.split(' on ')[0]}\n`);

    // 5. Kiểm tra bảng _prisma_migrations trên Production
    console.log('--- 3. LỊCH SỬ MIGRATION TRÊN PRODUCTION (_prisma_migrations) ---');
    let appliedMigrations: any[] = [];
    try {
      appliedMigrations = await prisma.$queryRawUnsafe<any[]>(
        `SELECT migration_name, checksum, finished_at, applied_steps_count, rolled_back_at 
         FROM _prisma_migrations 
         ORDER BY started_at ASC;`
      );
      console.log(`✓ Tổng số migration đã áp dụng trên Production: ${appliedMigrations.length}`);
      for (const m of appliedMigrations) {
        console.log(`   - [${m.finished_at ? 'HOÀN THÀNH' : 'CHƯA XONG'}] ${m.migration_name} (checksum: ${m.checksum}, steps: ${m.applied_steps_count})`);
      }
    } catch (e: any) {
      console.log(`⚠️ Bảng _prisma_migrations chưa tồn tại hoặc lỗi truy vấn: ${e.message}`);
    }
    console.log('');

    // 6. Kiểm tra toàn bộ bảng hiện có trong public schema
    console.log('--- 4. TẤT CẢ CÁC BẢNG HIỆN CÓ TRÊN PRODUCTION ---');
    const tables = await prisma.$queryRawUnsafe<any[]>(
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name;`
    );
    const existingTableNames = tables.map((t) => t.table_name);
    console.log(`✓ Tổng số bảng hiện có: ${existingTableNames.length}`);
    console.log(`   Danh sách bảng: ${existingTableNames.join(', ')}\n`);

    // 7. Thống kê số lượng bản ghi (Row Count) trên từng bảng
    console.log('--- 5. DỮ LIỆU HIỆN CÓ TRÊN CÁC BẢNG (ROW COUNTS) ---');
    for (const tName of existingTableNames) {
      if (tName === '_prisma_migrations') continue;
      try {
        const countRes = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::text as cnt FROM "${tName}";`);
        console.log(`   - Bảng "${tName}": ${countRes[0]?.cnt} bản ghi`);
      } catch (e: any) {
        console.log(`   - Bảng "${tName}": lỗi đếm (${e.message})`);
      }
    }
    console.log('');

    // 8. Đối chiếu 17 Model trong schema.prisma với Production
    console.log('--- 6. ĐỐI CHIẾU 17 PRISMA MODELS VỚI DATABASE PRODUCTION ---');
    const expectedModels = [
      'User',
      'BuildingArea',
      'IncidentTicket',
      'TicketMedia',
      'TicketStatusLog',
      'Notification',
      'SystemSetting',
      'Apartment',
      'ResidencyRecord',
      'AttendanceLog',
      'OvertimeRequest',
      'MonthlyPayrollLock',
      'ShiftScheduleRequest',
      'RepairMaterialCost',
      'MaterialItem',
      'SlaTracking',
      'OtpVerification',
    ];

    const missingTables: string[] = [];
    const existingModels: string[] = [];

    for (const m of expectedModels) {
      if (existingTableNames.includes(m)) {
        existingModels.push(m);
      } else {
        missingTables.push(m);
      }
    }

    console.log(`✓ Bảng đã có sẵn (${existingModels.length}/${expectedModels.length}): ${existingModels.join(', ')}`);
    if (missingTables.length > 0) {
      console.log(`❌ BẢNG CÒN THIẾU (${missingTables.length}/${expectedModels.length}): ${missingTables.join(', ')}`);
    } else {
      console.log(`✓ Tất cả 17 bảng trong schema.prisma đều đã có mặt trên Production!`);
    }
    console.log('');

    // 9. Kiểm tra chi tiết cấu trúc cột của bảng User
    console.log('--- 7. CẤU TRÚC CỘT BẢNG User TRÊN PRODUCTION ---');
    const userColumns = await prisma.$queryRawUnsafe<any[]>(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'User'
       ORDER BY ordinal_position;`
    );
    const userColNames = userColumns.map((c) => c.column_name);
    console.log(`✓ Các cột hiện có trong bảng User (${userColNames.length}): ${userColNames.join(', ')}`);

    const expectedUserCols = [
      'id', 'phone', 'email', 'passwordHash', 'fullName', 'avatarUrl', 'role',
      'isActive', 'isActivated', 'mustChangePassword', 'tokenVersion',
      'apartmentCode', 'buildingBlock', 'floorNumber',
      'specialty', 'specialtyLabel', 'shiftName', 'isOnDuty', 'fcmToken',
      'createdAt', 'updatedAt'
    ];

    const missingUserCols = expectedUserCols.filter((c) => !userColNames.includes(c));
    if (missingUserCols.length > 0) {
      console.log(`❌ Bảng User ĐANG THIẾU CỘT: ${missingUserCols.join(', ')}`);
    } else {
      console.log(`✓ Bảng User đã có đầy đủ 100% cột cần thiết (bao gồm isActivated, mustChangePassword, tokenVersion)!`);
    }
    console.log('');

    // 10. Kiểm tra chi tiết các bảng quan trọng khác
    console.log('--- 8. KIỂM TRA CỘT TRÊN CÁC BẢNG QUAN TRỌNG KHÁC ---');
    
    // 10a. IncidentTicket
    if (existingTableNames.includes('IncidentTicket')) {
      const ticketCols = await prisma.$queryRawUnsafe<any[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'IncidentTicket';`
      );
      const ticketColNames = ticketCols.map((c) => c.column_name);
      console.log(`- IncidentTicket: apartmentId có sẵn: ${ticketColNames.includes('apartmentId')}, areaId có sẵn: ${ticketColNames.includes('areaId')}`);
    }

    // 10b. ResidencyRecord
    if (existingTableNames.includes('ResidencyRecord')) {
      const resCols = await prisma.$queryRawUnsafe<any[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ResidencyRecord';`
      );
      const resColNames = resCols.map((c) => c.column_name);
      console.log(`- ResidencyRecord: residencyRole có sẵn: ${resColNames.includes('residencyRole')}, isRepresentative có sẵn: ${resColNames.includes('isRepresentative')}`);
    } else {
      console.log(`- ResidencyRecord: CHƯA TỒN TẠI TRÊN PRODUCTION`);
    }

    // 10c. OtpVerification
    if (existingTableNames.includes('OtpVerification')) {
      const otpCols = await prisma.$queryRawUnsafe<any[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'OtpVerification';`
      );
      const otpColNames = otpCols.map((c) => c.column_name);
      console.log(`- OtpVerification: Các cột: ${otpColNames.join(', ')}`);
    } else {
      console.log(`- OtpVerification: CHƯA TỒN TẠI TRÊN PRODUCTION`);
    }

    // 10d. Apartment
    if (existingTableNames.includes('Apartment')) {
      const aptCols = await prisma.$queryRawUnsafe<any[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Apartment';`
      );
      const aptColNames = aptCols.map((c) => c.column_name);
      console.log(`- Apartment: Các cột: ${aptColNames.join(', ')}`);
    } else {
      console.log(`- Apartment: CHƯA TỒN TẠI TRÊN PRODUCTION`);
    }
    console.log('');

    // 11. Kiểm tra Enums trên Production
    console.log('--- 9. ENUMS TRÊN POSTGRESQL PRODUCTION ---');
    const enums = await prisma.$queryRawUnsafe<any[]>(
      `SELECT t.typname, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) as values
       FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public'
       GROUP BY t.typname
       ORDER BY t.typname;`
    );
    for (const en of enums) {
      console.log(`   - Enum "${en.typname}": [${en.values}]`);
    }
    console.log('');

    // 12. Kiểm tra dữ liệu người dùng thực tế trên Production
    console.log('--- 10. THỐNG KÊ NGƯỜI DÙNG & TÀI KHOẢN TRÊN PRODUCTION ---');
    if (existingTableNames.includes('User')) {
      const usersByRole = await prisma.$queryRawUnsafe<any[]>(
        `SELECT role::text, COUNT(*)::text as cnt FROM "User" GROUP BY role;`
      );
      console.log('✓ Phân bổ tài khoản theo vai trò:');
      for (const r of usersByRole) {
        console.log(`   - Vai trò ${r.role}: ${r.cnt} tài khoản`);
      }

      // Liệt kê an toàn thông tin tài khoản (ẩn hash và số điện thoại nhạy cảm)
      const userList = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, "fullName", role::text, email, "isActive", 
                SUBSTRING(phone, 1, 4) || '****' || SUBSTRING(phone, 9, 2) as masked_phone
         FROM "User"
         ORDER BY role, "createdAt" ASC;`
      );
      console.log(`\n✓ Danh sách tài khoản hiện hữu trên Production (${userList.length}):`);
      for (const u of userList) {
        console.log(`   - [${u.role}] ${u.fullName} | Email: ${u.email || '(trống)'} | SĐT: ${u.masked_phone} | isActive: ${u.isActive}`);
      }
    }
    console.log('');

    // 13. Kiểm tra khóa ngoại hiện có
    console.log('--- 11. KHÓA NGOẠI (FOREIGN KEYS) TRÊN PRODUCTION ---');
    const foreignKeys = await prisma.$queryRawUnsafe<any[]>(
      `SELECT tc.table_name, tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.key_column_usage AS kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
       ORDER BY tc.table_name, tc.constraint_name;`
    );
    console.log(`✓ Tổng số khóa ngoại hiện có: ${foreignKeys.length}`);
    for (const fk of foreignKeys) {
      console.log(`   - ${fk.table_name}.${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name} (${fk.constraint_name})`);
    }
    console.log('');

    // 13b. Kiểm tra BuildingArea & IncidentTicket trên Production
    console.log('--- 11b. DỮ LIỆU KHU VỰC VÀ SỰ CỐ TRÊN PRODUCTION ---');
    const areas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "qrCode", "areaName", category::text, "locationLabel" FROM "BuildingArea";`
    );
    console.log(`✓ Danh mục BuildingArea (${areas.length}):`);
    for (const a of areas) {
      console.log(`   - [${a.category}] ${a.areaName} (QR: ${a.qrCode}) - ${a.locationLabel}`);
    }

    const ticketsSample = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "ticketCode", title, status::text, "createdAt" 
       FROM "IncidentTicket" 
       ORDER BY "createdAt" DESC 
       LIMIT 5;`
    );
    console.log(`\n✓ Top 5 IncidentTicket mới nhất trên Production:`);
    for (const tk of ticketsSample) {
      console.log(`   - [${tk.status}] ${tk.ticketCode}: ${tk.title} (${tk.createdAt})`);
    }
    console.log('');

    // 14. Đối chiếu các file migration trong mã nguồn với DB Production
    console.log('--- 12. ĐỐI CHIẾU MIGRATIONS TRONG REPO VỚI PRODUCTION ---');
    const repoMigrations = [
      '0_baseline',
      '20261105_apartments_and_payroll',
      '20261106_otp_and_activation',
      '20261110_resident_lifecycle_and_pwd',
    ];

    const appliedNames = appliedMigrations.map((m) => m.migration_name);
    for (const rm of repoMigrations) {
      const isApplied = appliedNames.some((an) => an.includes(rm) || an.endsWith(rm));
      console.log(`   - Migration "${rm}": ${isApplied ? '✅ ĐÃ ÁP DỤNG' : '⚠️ CHƯA ÁP DỤNG TRÊN PRODUCTION'}`);
    }
    console.log('');

  } finally {
    await prisma.$disconnect();
    console.log('✓ Đã ngắt kết nối an toàn với Production.');
  }
}

main().catch((err) => {
  console.error('Fatal error during production inspection:', err);
  process.exit(1);
});
