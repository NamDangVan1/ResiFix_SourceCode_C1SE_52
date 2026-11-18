import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

interface DbInfo {
  name: string;
  envFile: string;
  hostname: string;
  endpointId: string;
  databaseName: string;
  port: string;
  client: PrismaClient;
}

function parseDbEnv(filePath: string, label: string): { url: string; hostname: string; endpointId: string; databaseName: string; port: string } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File ${filePath} không tồn tại!`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = dotenv.parse(raw);
  const url = (parsed.DATABASE_URL || '').trim();
  if (!url) {
    throw new Error(`Không tìm thấy DATABASE_URL trong ${filePath}!`);
  }
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.toLowerCase();
  const endpointId = hostname.split('.')[0] || '';
  const databaseName = parsedUrl.pathname.replace(/^\//, '') || 'neondb';
  const port = parsedUrl.port || '5432';

  return { url, hostname, endpointId, databaseName, port };
}

async function inspectDatabase(db: DbInfo) {
  console.log(`\n========================================================================`);
  console.log(`🔎 [${db.name}] KIỂM TRA: ${db.hostname} (${db.databaseName})`);
  console.log(`========================================================================`);

  const p = db.client;

  // 1. Version & Current info
  const ver = await p.$queryRawUnsafe<any[]>(
    `SELECT current_database() as db, current_schema() as schema, current_user as usr, version() as ver;`
  );
  console.log(`✓ Database: ${ver[0]?.db} | Schema: ${ver[0]?.schema} | User: ${ver[0]?.usr}`);
  console.log(`✓ Engine: ${ver[0]?.ver?.split(' on ')[0]}`);

  // 2. _prisma_migrations
  let migrations: any[] = [];
  try {
    migrations = await p.$queryRawUnsafe<any[]>(
      `SELECT migration_name, checksum, finished_at, applied_steps_count, rolled_back_at, started_at
       FROM _prisma_migrations 
       ORDER BY started_at ASC;`
    );
    console.log(`✓ Bảng _prisma_migrations (${migrations.length} bản ghi):`);
    for (const m of migrations) {
      console.log(`   - [${m.finished_at ? 'HOÀN THÀNH' : 'PENDING'}] ${m.migration_name} (checksum: ${m.checksum?.substring(0, 16)}..., steps: ${m.applied_steps_count})`);
    }
  } catch (e: any) {
    console.log(`⚠️ Không thể đọc _prisma_migrations: ${e.message}`);
  }

  // 3. Tables
  const tables = await p.$queryRawUnsafe<any[]>(
    `SELECT table_name 
     FROM information_schema.tables 
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name;`
  );
  const tableNames = tables.map((t) => t.table_name);
  console.log(`✓ Tổng số bảng (${tableNames.length}): ${tableNames.join(', ')}`);

  // 4. Row counts
  console.log(`✓ Thống kê số lượng bản ghi từng bảng:`);
  const counts: Record<string, number> = {};
  for (const t of tableNames) {
    try {
      const cRes = await p.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::text as cnt FROM "${t}";`);
      counts[t] = parseInt(cRes[0]?.cnt || '0', 10);
      console.log(`   - ${t}: ${counts[t]}`);
    } catch (e: any) {
      console.log(`   - ${t}: Lỗi đếm (${e.message})`);
    }
  }

  // 5. Enums
  const enums = await p.$queryRawUnsafe<any[]>(
    `SELECT t.typname, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) as values
     FROM pg_type t
     JOIN pg_enum e ON t.oid = e.enumtypid
     JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
     GROUP BY t.typname
     ORDER BY t.typname;`
  );
  console.log(`✓ Enums (${enums.length}):`);
  for (const en of enums) {
    console.log(`   - ${en.typname}: [${en.values}]`);
  }

  // 6. Users detail
  let users: any[] = [];
  if (tableNames.includes('User')) {
    const userCols = await p.$queryRawUnsafe<any[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'User';`
    );
    const colSet = new Set(userCols.map((c) => c.column_name));
    const selectCols = [
      'id', 'role::text as role', '"fullName"', 'email',
      `SUBSTRING(phone, 1, 4) || '****' || SUBSTRING(phone, 9, 2) as masked_phone`,
      'phone',
      '"isActive"',
      colSet.has('isActivated') ? '"isActivated"' : 'NULL as "isActivated"',
      colSet.has('mustChangePassword') ? '"mustChangePassword"' : 'NULL as "mustChangePassword"',
      colSet.has('tokenVersion') ? '"tokenVersion"' : 'NULL as "tokenVersion"',
      '"apartmentCode"', '"buildingBlock"', '"floorNumber"',
      '"createdAt"'
    ].join(', ');

    users = await p.$queryRawUnsafe<any[]>(`SELECT ${selectCols} FROM "User" ORDER BY role, "createdAt" ASC;`);
    console.log(`✓ Chi tiết Users (${users.length}):`);
    for (const u of users) {
      console.log(`   - ID: ${u.id} | [${u.role}] ${u.fullName} | Email: ${u.email || '(none)'} | SĐT: ${u.masked_phone} | isActivated: ${u.isActivated} | mustChangePwd: ${u.mustChangePassword}`);
    }
  }

  // 7. BuildingAreas detail
  let areas: any[] = [];
  if (tableNames.includes('BuildingArea')) {
    areas = await p.$queryRawUnsafe<any[]>(
      `SELECT id, "qrCode", "areaName", category::text, "locationLabel" FROM "BuildingArea" ORDER BY "qrCode";`
    );
    console.log(`✓ Chi tiết BuildingArea (${areas.length}):`);
    for (const a of areas) {
      console.log(`   - [${a.category}] ${a.areaName} (QR: ${a.qrCode}) ID: ${a.id}`);
    }
  }

  // 8. Tickets sample / summary
  let tickets: any[] = [];
  if (tableNames.includes('IncidentTicket')) {
    const statusCounts = await p.$queryRawUnsafe<any[]>(
      `SELECT status::text, COUNT(*)::text as cnt FROM "IncidentTicket" GROUP BY status;`
    );
    console.log(`✓ Phân bổ IncidentTicket theo trạng thái:`);
    for (const s of statusCounts) {
      console.log(`   - ${s.status}: ${s.cnt}`);
    }
    const ticketCols = await p.$queryRawUnsafe<any[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='IncidentTicket';`
    );
    const tColSet = new Set(ticketCols.map((c: any) => c.column_name));
    const aptColExpr = tColSet.has('apartmentId') ? '"apartmentId"' : 'NULL as "apartmentId"';

    tickets = await p.$queryRawUnsafe<any[]>(
      `SELECT id, "ticketCode", title, status::text, "residentId", "assignedTechId", ${aptColExpr}, "areaId", "createdAt" 
       FROM "IncidentTicket" 
       ORDER BY "createdAt" DESC;`
    );
  }

  // 9. Foreign Keys
  const fks = await p.$queryRawUnsafe<any[]>(
    `SELECT tc.table_name, tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
     FROM information_schema.table_constraints AS tc
     JOIN information_schema.key_column_usage AS kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage AS ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
     ORDER BY tc.table_name, tc.constraint_name;`
  );

  return {
    name: db.name,
    hostname: db.hostname,
    endpointId: db.endpointId,
    databaseName: db.databaseName,
    port: db.port,
    tableNames,
    counts,
    migrations,
    enums,
    users,
    areas,
    tickets,
    fks,
  };
}

async function main() {
  console.log('========================================================================');
  console.log('🛡️  RESIFIX FULL DATABASE DUAL-AUDIT (READ-ONLY)');
  console.log('========================================================================');

  const prodEnvPath = path.resolve(__dirname, '../../.env');
  const testEnvPath = path.resolve(__dirname, '../../.env.test');

  const prodParsed = parseDbEnv(prodEnvPath, 'PRODUCTION');
  const testParsed = parseDbEnv(testEnvPath, 'TEST');

  console.log('\n--- XÁC MINH CẤU HÌNH KẾT NỐI HAI MÔI TRƯỜNG ---');
  console.log(`[PRODUCTION] File: backend/.env`);
  console.log(`  - Hostname   : ${prodParsed.hostname}`);
  console.log(`  - Endpoint ID: ${prodParsed.endpointId}`);
  console.log(`  - Database   : ${prodParsed.databaseName}`);
  console.log(`  - Port       : ${prodParsed.port}`);

  console.log(`\n[TEST] File: backend/.env.test`);
  console.log(`  - Hostname   : ${testParsed.hostname}`);
  console.log(`  - Endpoint ID: ${testParsed.endpointId}`);
  console.log(`  - Database   : ${testParsed.databaseName}`);
  console.log(`  - Port       : ${testParsed.port}`);

  // Chống nhầm lẫn: Kiểm tra xem Production và TEST có trỏ nhầm vào nhau không
  if (prodParsed.hostname === testParsed.hostname) {
    console.error('\n❌ [BLOCKER CỰC KỲ NGUY HIỂM] Hostname của backend/.env và backend/.env.test TRÙNG NHAU!');
    process.exit(1);
  }

  if (prodParsed.hostname.includes('ao4iuzkq') || prodParsed.hostname.includes('old-sound')) {
    console.error('\n❌ [BLOCKER] backend/.env đang trỏ vào TEST endpoint!');
    process.exit(1);
  }

  if (!testParsed.hostname.includes('ao4iuzkq') && !testParsed.hostname.includes('old-sound')) {
    console.error('\n❌ [BLOCKER] backend/.env.test không trỏ vào đúng TEST endpoint!');
    process.exit(1);
  }

  console.log('\n✅ XÁC NHẬN: Hai database hoàn toàn độc lập, tách biệt 100%!');

  const prodClient = new PrismaClient({ datasources: { db: { url: prodParsed.url } } });
  const testClient = new PrismaClient({ datasources: { db: { url: testParsed.url } } });

  try {
    const prodData = await inspectDatabase({
      name: 'PRODUCTION',
      envFile: 'backend/.env',
      hostname: prodParsed.hostname,
      endpointId: prodParsed.endpointId,
      databaseName: prodParsed.databaseName,
      port: prodParsed.port,
      client: prodClient,
    });

    const testData = await inspectDatabase({
      name: 'TEST',
      envFile: 'backend/.env.test',
      hostname: testParsed.hostname,
      endpointId: testParsed.endpointId,
      databaseName: testParsed.databaseName,
      port: testParsed.port,
      client: testClient,
    });

    // ========================================================================
    // ĐỐI CHIẾU DỮ LIỆU CHÉO (CROSS-DATABASE AUDIT)
    // ========================================================================
    console.log(`\n========================================================================`);
    console.log(`⚖️  ĐỐI CHIẾU CHÉO GIỮA TEST VÀ PRODUCTION (CROSS-COMPARISON)`);
    console.log(`========================================================================`);

    // 1. So sánh bảng
    console.log('\n--- 1. SO SÁNH BẢNG (TABLES) ---');
    const allExpectedTables = [
      'User', 'BuildingArea', 'IncidentTicket', 'TicketMedia', 'TicketStatusLog', 'Notification',
      'SystemSetting', 'Apartment', 'ResidencyRecord', 'AttendanceLog', 'OvertimeRequest',
      'MonthlyPayrollLock', 'ShiftScheduleRequest', 'RepairMaterialCost', 'MaterialItem',
      'SlaTracking', 'OtpVerification'
    ];

    console.log(`| Bảng | TEST (${testData.tableNames.length}) | PRODUCTION (${prodData.tableNames.length}) | Trạng thái |`);
    console.log(`| :--- | :---: | :---: | :--- |`);
    for (const t of allExpectedTables) {
      const inTest = testData.tableNames.includes(t);
      const inProd = prodData.tableNames.includes(t);
      const status = inTest && inProd ? 'Cả hai đều có' : inTest && !inProd ? 'Chỉ có trên TEST' : !inTest && inProd ? 'Chỉ có trên PROD' : 'Chưa có ở đâu';
      const testCnt = inTest ? testData.counts[t] : '-';
      const prodCnt = inProd ? prodData.counts[t] : '-';
      console.log(`| ${t} | ${testCnt} | ${prodCnt} | ${status} |`);
    }

    // 2. So sánh Users
    console.log('\n--- 2. SO SÁNH USERS VÀ TRÙNG LẶP ID / PHONE / EMAIL ---');
    const prodUserMapById = new Map(prodData.users.map((u: any) => [u.id, u]));
    const prodUserMapByPhone = new Map(prodData.users.map((u: any) => [u.phone, u]));
    const prodUserMapByEmail = new Map(prodData.users.filter((u: any) => u.email).map((u: any) => [u.email.toLowerCase(), u]));

    console.log(`Tổng User trên Production: ${prodData.users.length}`);
    console.log(`Tổng User trên TEST      : ${testData.users.length}`);

    console.log('\nKiểm tra từng User trên TEST xem có trùng lặp với Production không:');
    for (const tu of testData.users) {
      const matchId = prodUserMapById.get(tu.id);
      const matchPhone = prodUserMapByPhone.get(tu.phone);
      const matchEmail = tu.email ? prodUserMapByEmail.get(tu.email.toLowerCase()) : null;

      const overlapTypes: string[] = [];
      if (matchId) overlapTypes.push(`TRÙNG ID (${tu.id})`);
      if (matchPhone) overlapTypes.push(`TRÙNG SĐT (${tu.phone} - ${matchPhone.fullName})`);
      if (matchEmail) overlapTypes.push(`TRÙNG EMAIL (${tu.email} - ${matchEmail.fullName})`);

      if (overlapTypes.length > 0) {
        console.log(`  ⚠️ [TRÙNG LẶP] TEST User: [${tu.role}] ${tu.fullName} -> ${overlapTypes.join(' & ')}`);
      } else {
        console.log(`  + [DUY NHẤT TRÊN TEST] [${tu.role}] ${tu.fullName} (SĐT: ${tu.phone}, Email: ${tu.email || 'none'})`);
      }
    }

    // 3. So sánh BuildingAreas
    console.log('\n--- 3. SO SÁNH BUILDING AREA (KHU VỰC QUÉT QR) ---');
    const prodAreaCodes = new Set(prodData.areas.map((a: any) => a.qrCode));
    const testAreaCodes = new Set(testData.areas.map((a: any) => a.qrCode));

    console.log(`BuildingArea trên Production: ${prodData.areas.length}`);
    console.log(`BuildingArea trên TEST      : ${testData.areas.length}`);

    for (const ta of testData.areas) {
      if (prodAreaCodes.has(ta.qrCode)) {
        console.log(`  ✓ QR [${ta.qrCode}] ${ta.areaName} có trên cả TEST và Production`);
      } else {
        console.log(`  + QR [${ta.qrCode}] ${ta.areaName} CHỈ CÓ TRÊN TEST`);
      }
    }

    // 4. So sánh Tickets
    console.log('\n--- 4. SO SÁNH INCIDENT TICKETS (PHIẾU SỰ CỐ) ---');
    console.log(`Production Tickets: ${prodData.tickets.length}`);
    console.log(`TEST Tickets      : ${testData.tickets.length}`);

    const prodTicketCodes = new Set(prodData.tickets.map((t: any) => t.ticketCode));
    const testTicketCodes = new Set(testData.tickets.map((t: any) => t.ticketCode));

    const duplicateTicketCodes = [...testTicketCodes].filter((code) => prodTicketCodes.has(code));
    console.log(`Số Ticket trùng ticketCode giữa TEST và PROD: ${duplicateTicketCodes.length}`);
    if (duplicateTicketCodes.length > 0) {
      console.log(`  Danh sách trùng mã ticketCode: ${duplicateTicketCodes.join(', ')}`);
    }

    // 5. Kiểm tra dữ liệu mồ côi (Orphaned records) trên Production
    console.log('\n--- 5. KIỂM TRA DỮ LIỆU MỒ CÔI (ORPHAN AUDIT) TRÊN PRODUCTION ---');
    const prodUserIds = new Set(prodData.users.map((u: any) => u.id));
    const prodAreaIds = new Set(prodData.areas.map((a: any) => a.id));

    let orphanTicketResident = 0;
    let orphanTicketTech = 0;
    let orphanTicketArea = 0;

    for (const tk of prodData.tickets) {
      if (tk.residentId && !prodUserIds.has(tk.residentId)) {
        orphanTicketResident++;
        console.log(`  ⚠️ Ticket ${tk.ticketCode} có residentId không tồn tại trong User: ${tk.residentId}`);
      }
      if (tk.assignedTechId && !prodUserIds.has(tk.assignedTechId)) {
        orphanTicketTech++;
        console.log(`  ⚠️ Ticket ${tk.ticketCode} có assignedTechId không tồn tại trong User: ${tk.assignedTechId}`);
      }
      if (tk.areaId && !prodAreaIds.has(tk.areaId)) {
        orphanTicketArea++;
        console.log(`  ⚠️ Ticket ${tk.ticketCode} có areaId không tồn tại trong BuildingArea: ${tk.areaId}`);
      }
    }
    console.log(`✓ Mồ côi Resident: ${orphanTicketResident} | Mồ côi KTV: ${orphanTicketTech} | Mồ côi Area: ${orphanTicketArea}`);

    // Output JSON report file for detailed inspection
    const auditSummary = {
      timestamp: new Date().toISOString(),
      production: {
        hostname: prodData.hostname,
        endpointId: prodData.endpointId,
        database: prodData.databaseName,
        tableCount: prodData.tableNames.length,
        tables: prodData.counts,
        usersCount: prodData.users.length,
        ticketsCount: prodData.tickets.length,
        migrations: prodData.migrations.map((m: any) => m.migration_name),
      },
      test: {
        hostname: testData.hostname,
        endpointId: testData.endpointId,
        database: testData.databaseName,
        tableCount: testData.tableNames.length,
        tables: testData.counts,
        usersCount: testData.users.length,
        ticketsCount: testData.tickets.length,
        migrations: testData.migrations.map((m: any) => m.migration_name),
      },
    };

    fs.writeFileSync(
      path.resolve(__dirname, 'audit_summary_dump.json'),
      JSON.stringify(auditSummary, null, 2),
      'utf8'
    );
    console.log('\n✓ Đã ghi bản tóm tắt dữ liệu kiểm toán vào: backend/src/scripts/audit_summary_dump.json');

  } finally {
    await prodClient.$disconnect();
    await testClient.$disconnect();
    console.log('✓ Đã ngắt kết nối an toàn cả hai database.');
  }
}

main().catch((err) => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
