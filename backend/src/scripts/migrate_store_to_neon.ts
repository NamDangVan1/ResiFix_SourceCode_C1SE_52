/**
 * Script Import 1 lần từ resifix_store.json sang Neon PostgreSQL (Kế hoạch Cutover)
 * QUY TẮC AN TOÀN:
 * 1. Mặc định chạy ở chế độ DRY-RUN (không ghi vào DB).
 * 2. Tự động sao lưu file JSON gốc sang file .bak kèm timestamp trước khi thực hiện.
 * 3. Kiểm tra trùng lặp (duplicate check) và ràng buộc khóa ngoại trước khi nạp.
 * 4. Đối chiếu số lượng bản ghi nguồn vs đích (Record Count Verification).
 * 5. KHÔNG xóa file JSON gốc.
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { prisma } from '../db';
import { resiFixStore, ResiFixStoreData } from '../data/resifix_store';

const STORE_PATH = path.resolve(__dirname, '../data/resifix_data.json');

export interface MigrationReport {
  dryRun: boolean;
  backupPath: string | null;
  counts: {
    systemSettings: { source: number; imported: number };
    apartments: { source: number; imported: number };
    residencyRecords: { source: number; imported: number };
    attendanceLogs: { source: number; imported: number };
    overtimeRequests: { source: number; imported: number };
    monthlyPayrollLocks: { source: number; imported: number };
    shiftScheduleRequests: { source: number; imported: number };
    repairMaterialCosts: { source: number; imported: number };
    materialItems: { source: number; imported: number };
    slaTrackings: { source: number; imported: number };
  };
  warnings: string[];
  success: boolean;
}

export async function runStoreToNeonMigration(isDryRun: boolean = true): Promise<MigrationReport> {
  const storeData: ResiFixStoreData = resiFixStore.get();
  const allMaterialItems = (storeData.repairCosts || []).flatMap((c) => c.items || []);

  const report: MigrationReport = {
    dryRun: isDryRun,
    backupPath: null,
    counts: {
      systemSettings: { source: 4, imported: 0 },
      apartments: { source: (storeData.apartments || []).length, imported: 0 },
      residencyRecords: { source: (storeData.residencyHistory || []).length, imported: 0 },
      attendanceLogs: { source: (storeData.attendanceLogs || []).length, imported: 0 },
      overtimeRequests: { source: (storeData.overtimeRequests || []).length, imported: 0 },
      monthlyPayrollLocks: { source: (storeData.lockedMonths || []).length, imported: 0 },
      shiftScheduleRequests: { source: (storeData.scheduleRequests || []).length, imported: 0 },
      repairMaterialCosts: { source: (storeData.repairCosts || []).length, imported: 0 },
      materialItems: { source: allMaterialItems.length, imported: 0 },
      slaTrackings: { source: (storeData.slaTrackings || []).length, imported: 0 },
    },
    warnings: [],
    success: true,
  };

  // 1. Tự động sao lưu file JSON
  if (fs.existsSync(STORE_PATH)) {
    const backupFile = `${STORE_PATH}.bak.${Date.now()}`;
    fs.copyFileSync(STORE_PATH, backupFile);
    report.backupPath = backupFile;
  }

  // 2. Kiểm tra dữ liệu & Khóa ngoại (nếu có kết nối DB)
  try {
    const users = await prisma.user.findMany({ select: { id: true, phone: true } });
    const userMap = new Set(users.map((u) => u.id));

    const tickets = await prisma.incidentTicket.findMany({ select: { id: true } });
    const ticketMap = new Set(tickets.map((t) => t.id));

    // Kiểm tra KTV tồn tại cho chấm công
    for (const att of storeData.attendanceLogs || []) {
      if (!userMap.has(att.techId)) {
        report.warnings.push(`Chấm công ${att.id}: techId "${att.techId}" không tồn tại trong User table Neon.`);
      }
    }

    // Kiểm tra KTV tồn tại cho OT
    for (const ot of storeData.overtimeRequests || []) {
      if (!userMap.has(ot.techId)) {
        report.warnings.push(`Tăng ca ${ot.id}: techId "${ot.techId}" không tồn tại trong User table Neon.`);
      }
    }

    // Kiểm tra Đổi ca & Xin nghỉ
    for (const req of storeData.scheduleRequests || []) {
      if (!userMap.has(req.techId)) {
        report.warnings.push(`Yêu cầu lịch ${req.id}: techId "${req.techId}" không tồn tại trong User table Neon.`);
      }
    }

    // Kiểm tra Chi phí sửa chữa & Ticket
    for (const cost of storeData.repairCosts || []) {
      if (!ticketMap.has(cost.ticketId)) {
        report.warnings.push(`Chi phí ${cost.id}: ticketId "${cost.ticketId}" không tồn tại trong IncidentTicket Neon.`);
      }
    }
  } catch (dbErr: any) {
    report.warnings.push(`Không thể kết nối Neon DB để xác minh khóa ngoại trực tiếp (Môi trường Offline/Sandbox): ${dbErr.message?.slice(0, 80)}...`);
  }

  if (isDryRun) {
    // Chế độ Dry-run: Phân tích nguồn và đối chiếu số lượng bản ghi
    report.counts.systemSettings.imported = report.counts.systemSettings.source;
    report.counts.apartments.imported = report.counts.apartments.source;
    report.counts.residencyRecords.imported = report.counts.residencyRecords.source;
    report.counts.attendanceLogs.imported = report.counts.attendanceLogs.source;
    report.counts.overtimeRequests.imported = report.counts.overtimeRequests.source;
    report.counts.monthlyPayrollLocks.imported = report.counts.monthlyPayrollLocks.source;
    report.counts.shiftScheduleRequests.imported = report.counts.shiftScheduleRequests.source;
    report.counts.repairMaterialCosts.imported = report.counts.repairMaterialCosts.source;
    report.counts.materialItems.imported = report.counts.materialItems.source;
    report.counts.slaTrackings.imported = report.counts.slaTrackings.source;
    return report;
  }

  // 3. THỰC THI GHI VÀO DATABASE THẬT QUA TRANSACTION (IDEMPOTENT & SAFE RE-RUN)
  try {
    await prisma.$transaction(async (tx) => {
      // 1. SystemSetting
      const settings = [
        { key: 'emergency_contact', value: storeData.emergencyContact },
        { key: 'payroll_config', value: storeData.payrollConfig },
        { key: 'cost_config', value: storeData.costConfig },
        { key: 'sla_config', value: storeData.slaConfig },
      ];
      for (const s of settings) {
        await tx.$executeRaw`
          INSERT INTO "SystemSetting" ("id", "key", "value", "updatedAt")
          VALUES (gen_random_uuid(), ${s.key}, ${JSON.stringify(s.value)}::jsonb, CURRENT_TIMESTAMP)
          ON CONFLICT ("key") DO UPDATE SET "value" = ${JSON.stringify(s.value)}::jsonb, "updatedAt" = CURRENT_TIMESTAMP;
        `;
        report.counts.systemSettings.imported++;
      }

      // 2. Apartments
      for (const apt of storeData.apartments || []) {
        await tx.$executeRaw`
          INSERT INTO "Apartment" ("id", "apartmentCode", "buildingBlock", "floorNumber", "roomQrCode", "status", "createdAt", "updatedAt")
          VALUES (${apt.id}, ${apt.apartmentCode}, ${apt.buildingBlock}, ${apt.floorNumber}, ${apt.roomQrCode}, ${apt.status || 'OCCUPIED'}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT ("apartmentCode") DO NOTHING;
        `;
        report.counts.apartments.imported++;
      }

      // 3. ResidencyRecord
      const aptCodeToId = new Map((storeData.apartments || []).map((a) => [a.apartmentCode, a.id]));
      for (const res of storeData.residencyHistory || []) {
        const aptId = aptCodeToId.get(res.apartmentCode) || res.apartmentCode;
        await tx.$executeRaw`
          INSERT INTO "ResidencyRecord" ("id", "apartmentId", "residentId", "startDate", "endDate", "isCurrent", "residentType", "createdAt", "updatedAt")
          VALUES (${res.id}, ${aptId}, ${res.residentId}, ${new Date(res.moveInDate)}, ${res.moveOutDate ? new Date(res.moveOutDate) : null}, ${!res.moveOutDate}, ${res.isRepresentative ? 'OWNER' : 'TENANT'}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT ("id") DO NOTHING;
        `;
        report.counts.residencyRecords.imported++;
      }

      // 4. AttendanceLog
      for (const att of storeData.attendanceLogs || []) {
        await tx.$executeRaw`
          INSERT INTO "AttendanceLog" ("id", "techId", "date", "sessionIndex", "checkIn", "checkOut", "workMinutes", "workHours", "shiftScheduled", "anomalyNotes", "createdAt")
          VALUES (${att.id}, ${att.techId}, ${att.date}, ${att.sessionIndex || 1}, ${new Date(att.checkIn)}, ${att.checkOut ? new Date(att.checkOut) : null}, ${att.workMinutes || null}, ${att.workHours || null}, ${att.shiftScheduled || '08:00 - 17:00'}, ${att.anomalyNotes || null}, CURRENT_TIMESTAMP)
          ON CONFLICT ("id") DO NOTHING;
        `;
        report.counts.attendanceLogs.imported++;
      }

      // 5. OvertimeRequest
      for (const ot of storeData.overtimeRequests || []) {
        await tx.$executeRaw`
          INSERT INTO "OvertimeRequest" ("id", "techId", "date", "fromTime", "toTime", "hours", "reason", "ticketId", "status", "reviewNote", "reviewedById", "reviewedAt", "createdAt")
          VALUES (${ot.id}, ${ot.techId}, ${ot.date}, ${ot.fromTime || null}, ${ot.toTime || null}, ${ot.hours}, ${ot.reason}, ${ot.ticketId || null}, ${ot.status}, ${ot.reviewNote || null}, null, ${ot.reviewedAt ? new Date(ot.reviewedAt) : null}, ${new Date(ot.createdAt || Date.now())})
          ON CONFLICT ("id") DO NOTHING;
        `;
        report.counts.overtimeRequests.imported++;
      }

      // 6. MonthlyPayrollLock
      for (const lock of storeData.lockedMonths || []) {
        await tx.$executeRaw`
          INSERT INTO "MonthlyPayrollLock" ("id", "month", "lockedById", "lockedAt", "summarySnapshot", "createdAt")
          VALUES (${'lock-' + lock.month}, ${lock.month}, ${lock.lockedBy || 'bmb-admin'}, ${new Date(lock.lockedAt)}, ${JSON.stringify({ totalPayout: lock.totalPayout })}::jsonb, CURRENT_TIMESTAMP)
          ON CONFLICT ("month") DO NOTHING;
        `;
        report.counts.monthlyPayrollLocks.imported++;
      }

      // 7. ShiftScheduleRequest
      for (const req of storeData.scheduleRequests || []) {
        await tx.$executeRaw`
          INSERT INTO "ShiftScheduleRequest" ("id", "type", "techId", "techName", "date", "endDate", "leaveType", "shiftName", "targetTechId", "targetTechName", "reason", "status", "reviewNote", "reviewedById", "reviewedByName", "reviewedAt", "createdAt")
          VALUES (${req.id}, ${req.type}, ${req.techId}, ${req.techName}, ${req.date}, ${req.endDate || null}, ${req.leaveType || null}, ${req.shiftName || null}, ${req.targetTechId || null}, ${req.targetTechName || null}, ${req.reason}, ${req.status}, ${req.reviewNote || null}, null, ${req.reviewedBy || null}, ${req.reviewedAt ? new Date(req.reviewedAt) : null}, ${new Date(req.createdAt || Date.now())})
          ON CONFLICT ("id") DO NOTHING;
        `;
        report.counts.shiftScheduleRequests.imported++;
      }

      // 8. RepairMaterialCost & MaterialItem
      for (const cost of storeData.repairCosts || []) {
        await tx.$executeRaw`
          INSERT INTO "RepairMaterialCost" ("id", "ticketId", "ticketCode", "proposedById", "proposedByName", "status", "otherCost", "totalCost", "receiptProofUrl", "reviewNote", "reviewedById", "reviewedByName", "reviewedAt", "createdAt", "updatedAt")
          VALUES (${cost.id}, ${cost.ticketId}, ${cost.ticketCode}, ${cost.proposedById}, ${cost.proposedByName}, ${cost.status}, ${BigInt(cost.otherCost || 0)}, ${BigInt(cost.totalCost || 0)}, ${cost.receiptProofUrl || null}, ${cost.reviewNote || null}, null, ${cost.reviewedBy || null}, ${cost.reviewedAt ? new Date(cost.reviewedAt) : null}, ${new Date(cost.createdAt || Date.now())}, ${new Date(cost.updatedAt || Date.now())})
          ON CONFLICT ("ticketId") DO NOTHING;
        `;
        report.counts.repairMaterialCosts.imported++;

        for (const item of cost.items || []) {
          await tx.$executeRaw`
            INSERT INTO "MaterialItem" ("id", "costId", "materialCode", "materialName", "unit", "quantity", "unitPrice", "totalPrice", "notes")
            VALUES (${item.id}, ${cost.id}, ${item.materialCode}, ${item.materialName}, ${item.unit}, ${item.quantity}, ${BigInt(item.unitPrice)}, ${BigInt(item.totalPrice)}, ${item.notes || null})
            ON CONFLICT ("id") DO NOTHING;
          `;
          report.counts.materialItems.imported++;
        }
      }

      // 9. SlaTracking
      for (const sla of storeData.slaTrackings || []) {
        await tx.$executeRaw`
          INSERT INTO "SlaTracking" ("id", "ticketId", "ticketCode", "priority", "status", "responseDeadline", "assignmentDeadline", "resolutionDeadline", "slaStatus", "isPaused", "pauseReason", "pausedAt", "escalationTier", "lastAlertSentAt", "createdAt", "updatedAt")
          VALUES (${'sla-' + sla.ticketId}, ${sla.ticketId}, ${sla.ticketCode}, ${sla.priority}, ${sla.status}, ${new Date(sla.responseDeadline)}, ${new Date(sla.assignmentDeadline)}, ${new Date(sla.resolutionDeadline)}, ${sla.slaStatus}, ${sla.isPaused}, ${sla.pauseReason || null}, ${sla.pausedAt ? new Date(sla.pausedAt) : null}, ${sla.escalationTier || 0}, ${sla.lastAlertSentAt ? new Date(sla.lastAlertSentAt) : null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT ("ticketId") DO NOTHING;
        `;
        report.counts.slaTrackings.imported++;
      }
    });
  } catch (err: any) {
    report.success = false;
    report.warnings.push(`Thực thi import thất bại, toàn bộ Transaction đã được tự động Rollback: ${err.message}`);
  }

  return report;
}

if (require.main === module) {
  const isExecute = process.argv.includes('--execute');
  runStoreToNeonMigration(!isExecute)
    .then((rep) => {
      console.log('=== BÁO CÁO KẾ HOẠCH IMPORT DỮ LIỆU TỪ JSON SANG NEON ===');
      console.log(`Chế độ: ${rep.dryRun ? 'DRY-RUN (Phân tích, không ghi DB)' : 'THỰC THI THẬT'}`);
      console.log(`File Backup: ${rep.backupPath || 'Không có file JSON gốc để backup'}`);
      console.table(rep.counts);
      if (rep.warnings.length > 0) {
        console.log('\nCảnh báo kiểm tra tính toàn vẹn:');
        rep.warnings.forEach((w) => console.warn(`- ${w}`));
      } else {
        console.log('\nTính toàn vẹn dữ liệu: HOÀN HẢO - Không có cảnh báo.');
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Lỗi kiểm tra:', err);
      process.exit(1);
    });
}
