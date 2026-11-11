import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { generateOfficial75Apartments } from '../../src/data/resifix_store';

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log('========================================================================');
  console.log(`📦 RESIFIX PRODUCTION - IMPORT DỮ LIỆU NỀN TẢNG [${isExecute ? 'THỰC THI (EXECUTE)' : 'CHẾ ĐỘ THỬ NGHIỆM (DRY-RUN)'}]`);
  console.log('========================================================================\n');

  if (!isExecute) {
    console.log('⚠️ ĐANG CHẠY Ở CHẾ ĐỘ DRY-RUN: Chỉ kiểm tra và hiển thị dữ liệu.');
    console.log('   Để thực thi ghi dữ liệu lên Production, cần truyền thêm tham số --execute.\n');
  }

  // 1. Đọc backend/.env (Production)
  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ Không tìm thấy file backend/.env!');
    process.exit(1);
  }

  const rawEnv = fs.readFileSync(envPath, 'utf8');
  const parsed = dotenv.parse(rawEnv);
  const prodDatabaseUrl = (parsed.DATABASE_URL || '').trim();

  if (!prodDatabaseUrl) {
    console.error('❌ Thiếu DATABASE_URL trong backend/.env!');
    process.exit(1);
  }

  const parsedUrl = new URL(prodDatabaseUrl);
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname.includes('ao4iuzkq') || hostname.includes('old-sound')) {
    console.error('❌ DATABASE_URL trong backend/.env đang trỏ vào TEST! Hủy bỏ.');
    process.exit(1);
  }

  console.log(`✓ Database Target (Production): ${hostname}`);
  console.log(`✓ Database Name: ${parsedUrl.pathname.replace(/^\//, '') || 'resifix_db'}\n`);

  // 2. Đọc backend/.env.test (TEST)
  const testEnvPath = path.resolve(__dirname, '../../.env.test');
  let testPrisma: PrismaClient | null = null;
  if (fs.existsSync(testEnvPath)) {
    const rawTestEnv = fs.readFileSync(testEnvPath, 'utf8');
    const testParsed = dotenv.parse(rawTestEnv);
    if (testParsed.DATABASE_URL) {
      testPrisma = new PrismaClient({ datasources: { db: { url: testParsed.DATABASE_URL.trim() } } });
      console.log('✓ Đã kết nối đọc dữ liệu nghiệp vụ hợp lệ từ Neon TEST (Read-Only).');
    }
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: prodDatabaseUrl } },
  });

  try {
    // 3. Chuẩn bị 75 căn hộ chuẩn + căn hộ E3204
    const official75Apartments = generateOfficial75Apartments();
    const allApartments = [
      ...official75Apartments,
      {
        id: 'apt-e3204',
        apartmentCode: 'E3204',
        buildingBlock: 'Tòa E',
        floorNumber: 3,
        roomQrCode: 'ROOM:E3204',
        status: 'OCCUPIED',
        createdAt: '2026-11-10T10:30:06.789Z',
      },
    ];
    console.log(`✓ Đã nạp danh mục 76 căn hộ (75 căn chuẩn VACANT tòa G, F, E + 1 căn OCCUPIED E3204).`);

    // 4. Chuẩn bị 4 SystemSetting
    const officialSystemSettings = [
      {
        key: 'emergency_contact',
        value: {
          managerName: 'Đặng Thành Quyết',
          managerPhone: '0913402803',
          fireHotline: '114',
          policeHotline: '113',
          ambulanceHotline: '115',
          buildingSecurityPhone: '02363827111',
        },
      },
      {
        key: 'payroll_config',
        value: {
          hourlyRateDefault: 50000,
          baseSalaryDefault: 10400000,
          standardMonthlyHours: 208,
          otMultiplierNormal: 1.5,
          otMultiplierNight: 1.3,
          otMultiplierWeekend: 2.0,
          standardAllowance: 730000,
          holidays: ['2026-01-01', '2026-04-30', '2026-05-01', '2026-09-02', '2026-09-03'],
          buildingLocation: {
            buildingName: 'Khu Tòa Nhà ResiFix - Đại học Duy Tân',
            buildingAddress: 'Đại học Duy Tân, Hòa Khánh Nam, Đà Nẵng',
            latitude: 16.0592,
            longitude: 108.1472,
            allowedRadiusMeters: 300,
            isConfirmed: true,
            configAuditLogs: [],
          },
        },
      },
      {
        key: 'cost_config',
        value: {
          anomalyThresholdVnd: 5000000,
          requireReceiptThresholdVnd: 500000,
        },
      },
      {
        key: 'sla_config',
        value: {
          highPriority: { responseMinutes: 15, assignmentMinutes: 30, resolutionHours: 4 },
          mediumPriority: { responseMinutes: 30, assignmentMinutes: 120, resolutionHours: 24 },
          lowPriority: { responseMinutes: 60, assignmentMinutes: 240, resolutionHours: 48 },
          warningThresholdPercent: 80,
          autoEscalationHours: 2,
          alertDebounceMinutes: 15,
        },
      },
    ];
    console.log(`✓ Đã nạp 4 cấu hình hệ thống: emergency_contact, payroll_config, cost_config, sla_config`);

    // 5. Đọc & đối chiếu dữ liệu nghiệp vụ hợp lệ từ TEST
    let residenciesToImport: any[] = [];
    let attendancesToImport: any[] = [];
    let repairCostsToImport: any[] = [];
    let materialItemsToImport: any[] = [];
    let slaToImport: any[] = [];

    if (testPrisma) {
      // Lấy danh sách ID user và ticket hiện có trên Production để bảo đảm toàn vẹn khóa ngoại
      const prodUsers = await prisma.$queryRawUnsafe<any[]>('SELECT id FROM "User";');
      const prodUserIds = new Set(prodUsers.map((u) => u.id));

      const prodTickets = await prisma.$queryRawUnsafe<any[]>('SELECT id FROM "IncidentTicket";');
      const prodTicketIds = new Set(prodTickets.map((t) => t.ticketId || t.id));

      // 5.1 ResidencyRecord
      const testResidencies = await testPrisma.$queryRawUnsafe<any[]>('SELECT * FROM "ResidencyRecord";');
      residenciesToImport = testResidencies.map((r) => ({
        ...r,
        // Nếu residentId không tồn tại trên Production (ví dụ Cristiano Ronaldo test user), set null để bảo đảm FK
        residentId: r.residentId && prodUserIds.has(r.residentId) ? r.residentId : null,
      }));
      console.log(`✓ Đã đối chiếu ${residenciesToImport.length} bản ghi ResidencyRecord từ TEST.`);

      // 5.2 AttendanceLog
      const testAttendances = await testPrisma.$queryRawUnsafe<any[]>('SELECT * FROM "AttendanceLog";');
      attendancesToImport = testAttendances.filter((a) => prodUserIds.has(a.technicianId));
      console.log(`✓ Đã đối chiếu ${attendancesToImport.length} bản ghi AttendanceLog hợp lệ từ TEST.`);

      // 5.3 RepairMaterialCost & MaterialItem
      const testCosts = await testPrisma.$queryRawUnsafe<any[]>('SELECT * FROM "RepairMaterialCost";');
      repairCostsToImport = testCosts.filter((c) => prodTicketIds.has(c.ticketId) && prodUserIds.has(c.proposedById));
      console.log(`✓ Đã đối chiếu ${repairCostsToImport.length} bản ghi RepairMaterialCost hợp lệ từ TEST.`);

      const validCostIds = new Set(repairCostsToImport.map((c) => c.id));
      const testItems = await testPrisma.$queryRawUnsafe<any[]>('SELECT * FROM "MaterialItem";');
      materialItemsToImport = testItems.filter((i) => validCostIds.has(i.costId));
      console.log(`✓ Đã đối chiếu ${materialItemsToImport.length} bản ghi MaterialItem hợp lệ từ TEST.`);

      // 5.4 SlaTracking
      const testSla = await testPrisma.$queryRawUnsafe<any[]>('SELECT * FROM "SlaTracking";');
      slaToImport = testSla.filter((s) => prodTicketIds.has(s.ticketId));
      console.log(`✓ Đã đối chiếu ${slaToImport.length} bản ghi SlaTracking hợp lệ từ TEST.`);
    }

    if (!isExecute) {
      console.log('\n------------------------------------------------------------------------');
      console.log('DRY-RUN THÀNH CÔNG: Dữ liệu đã sẵn sàng để nạp.');
      console.log('Chưa có bất kỳ thay đổi nào được ghi vào cơ sở dữ liệu Production.');
      console.log('------------------------------------------------------------------------\n');
      return;
    }

    // THỰC THI THẬT KHI CÓ CỜ --execute
    console.log('\n--- ĐANG THỰC HIỆN IMPORT DỮ LIỆU LÊN PRODUCTION ---');
    await prisma.$transaction(async (tx) => {
      // 1. Import Apartments
      let aptCount = 0;
      for (const apt of allApartments) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "Apartment" ("id", "apartmentCode", "buildingBlock", "floorNumber", "roomQrCode", "status", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT ("apartmentCode") DO NOTHING;`,
          apt.id,
          apt.apartmentCode,
          apt.buildingBlock,
          apt.floorNumber,
          apt.roomQrCode,
          apt.status || 'VACANT'
        );
        aptCount++;
      }
      console.log(`✓ Đã đồng bộ ${aptCount} căn hộ vào bảng Apartment (ON CONFLICT DO NOTHING).`);

      // 2. Import SystemSettings
      let settingCount = 0;
      for (const s of officialSystemSettings) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "SystemSetting" ("id", "key", "value", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2::jsonb, CURRENT_TIMESTAMP)
           ON CONFLICT ("key") DO UPDATE SET "value" = $2::jsonb, "updatedAt" = CURRENT_TIMESTAMP;`,
          s.key,
          JSON.stringify(s.value)
        );
        settingCount++;
      }
      console.log(`✓ Đã đồng bộ ${settingCount} cấu hình vào bảng SystemSetting (ON CONFLICT DO UPDATE).`);

      // 3. Import ResidencyRecord
      let resCount = 0;
      for (const r of residenciesToImport) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "ResidencyRecord" ("id", "residentId", "residentName", "residentPhone", "apartmentId", "apartmentCode", "buildingBlock", "floorNumber", "moveInDate", "moveOutDate", "isRepresentative", "residencyRole", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT ("id") DO NOTHING;`,
          r.id,
          r.residentId,
          r.residentName,
          r.residentPhone,
          r.apartmentId,
          r.apartmentCode,
          r.buildingBlock,
          r.floorNumber,
          r.moveInDate || new Date(),
          r.moveOutDate,
          r.isRepresentative ?? false,
          r.residencyRole || 'TENANT',
          r.createdAt || new Date()
        );
        resCount++;
      }
      console.log(`✓ Đã chuyển ${resCount} bản ghi lịch sử cư trú vào ResidencyRecord.`);

      // 4. Import AttendanceLog
      let attCount = 0;
      for (const a of attendancesToImport) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "AttendanceLog" ("id", "technicianId", "technicianName", "date", "sessionIndex", "checkIn", "checkOut", "workMinutes", "workHours", "shiftScheduled", "anomalyNotes", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT ("technicianId", "date", "sessionIndex") DO NOTHING;`,
          a.id,
          a.technicianId,
          a.technicianName,
          a.date,
          a.sessionIndex,
          a.checkIn,
          a.checkOut,
          a.workMinutes,
          a.workHours,
          a.shiftScheduled,
          a.anomalyNotes,
          a.createdAt || new Date()
        );
        attCount++;
      }
      console.log(`✓ Đã chuyển ${attCount} bản ghi nhật ký chấm công vào AttendanceLog.`);

      // 5. Import RepairMaterialCost & MaterialItem
      let costCount = 0;
      for (const c of repairCostsToImport) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "RepairMaterialCost" ("id", "ticketId", "ticketCode", "proposedById", "proposedByName", "status", "otherCost", "totalCost", "receiptProofUrl", "reviewNote", "reviewedById", "reviewedByName", "reviewedAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7::bigint, $8::bigint, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT ("ticketId") DO NOTHING;`,
          c.id,
          c.ticketId,
          c.ticketCode,
          c.proposedById,
          c.proposedByName,
          c.status,
          c.otherCost ? c.otherCost.toString() : '0',
          c.totalCost ? c.totalCost.toString() : '0',
          c.receiptProofUrl,
          c.reviewNote,
          c.reviewedById,
          c.reviewedByName,
          c.reviewedAt,
          c.createdAt || new Date(),
          c.updatedAt || new Date()
        );
        costCount++;
      }
      console.log(`✓ Đã chuyển ${costCount} hồ sơ chi phí vào RepairMaterialCost.`);

      let itemCount = 0;
      for (const i of materialItemsToImport) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "MaterialItem" ("id", "costId", "materialCode", "materialName", "unit", "quantity", "unitPrice", "totalPrice", "notes")
           VALUES ($1, $2, $3, $4, $5, $6, $7::bigint, $8::bigint, $9)
           ON CONFLICT ("id") DO NOTHING;`,
          i.id,
          i.costId,
          i.materialCode,
          i.materialName,
          i.unit,
          i.quantity,
          i.unitPrice ? i.unitPrice.toString() : '0',
          i.totalPrice ? i.totalPrice.toString() : '0',
          i.notes
        );
        itemCount++;
      }
      console.log(`✓ Đã chuyển ${itemCount} chi tiết vật tư vào MaterialItem.`);

      // 6. Import SlaTracking
      let slaCount = 0;
      for (const s of slaToImport) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "SlaTracking" ("id", "ticketId", "ticketCode", "priority", "status", "responseDeadline", "assignmentDeadline", "resolutionDeadline", "slaStatus", "isPaused", "pauseReason", "pausedAt", "escalationTier", "lastAlertSentAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           ON CONFLICT ("ticketId") DO NOTHING;`,
          s.id,
          s.ticketId,
          s.ticketCode,
          s.priority,
          s.status,
          s.responseDeadline,
          s.assignmentDeadline,
          s.resolutionDeadline,
          s.slaStatus,
          s.isPaused ?? false,
          s.pauseReason,
          s.pausedAt,
          s.escalationTier ?? 0,
          s.lastAlertSentAt,
          s.createdAt || new Date(),
          s.updatedAt || new Date()
        );
        slaCount++;
      }
      console.log(`✓ Đã chuyển ${slaCount} bản ghi theo dõi SLA vào SlaTracking.`);
    });

    console.log('\n========================================================================');
    console.log('🎉 TOÀN BỘ DỮ LIỆU CHÍNH THỨC & NGHIỆP VỤ HỢP LỆ ĐÃ ĐƯỢC CHUYỂN THÀNH CÔNG!');
    console.log('========================================================================\n');
  } finally {
    if (testPrisma) await testPrisma.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error during baseline data import:', err);
  process.exit(1);
});
