/**
 * SCRIPT ĐỐI CHIẾU & ĐỒNG BỘ SCHEMA TRÊN NEON TEST
 * 
 * MỤC TIÊU:
 * 1. Tạo bảng BuildingArea theo đúng Prisma schema.
 * 2. Bảo toàn 2 khu vực hiện có từ EquipmentAsset sang BuildingArea (giữ nguyên ID).
 * 3. Bổ sung cột IncidentTicket.areaId và liên kết 7 ticket hiện có (khớp với assetId).
 * 4. Bổ sung các cột an toàn cho User: isActivated, mustChangePassword, tokenVersion.
 * 5. Bổ sung bảng OtpVerification và cột residencyRole cho ResidencyRecord.
 * 6. TUYỆT ĐỐI KHÔNG DROP, KHÔNG DELETE, KHÔNG TRUNCATE bất kỳ dữ liệu nào.
 */

import { loadTestEnvironmentStrict, createTestPrismaClient, verifyTargetDatabaseIsTestBranch } from './test_env_guard';

export async function reconcileTestSchema(isExecute: boolean = false) {
  console.log('===============================================================');
  console.log('🛠️ ĐỐI CHIẾU & ĐỒNG BỘ SCHEMA CHO NEON TEST (BUILDINGAREA & USERS)');
  console.log('===============================================================\n');

  const config = loadTestEnvironmentStrict();
  const prisma = createTestPrismaClient(config);

  try {
    const verification = await verifyTargetDatabaseIsTestBranch(prisma, config);
    if (!verification.isVerifiedTest) {
      console.error(`⛔ [TỪ CHỐI THỰC THI] ${verification.rejectionReason}`);
      process.exit(1);
    }

    console.log(`✓ Database đích TEST đã xác minh: ${verification.database} (${config.hostname})\n`);

    console.log(`Chế độ: ${isExecute ? '⚡ THỰC THI THẬT TRÊN TEST' : '🔍 PHÂN TÍCH DRY-RUN (Không thay đổi DB)'}\n`);

    // 1. Phân tích trạng thái hiện tại
    const tables: any[] = await prisma.$queryRaw`
      SELECT table_name::text as table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema();
    `;
    const tableSet = new Set(tables.map((t: any) => t.table_name));

    const hasBuildingArea = tableSet.has('BuildingArea');
    const hasEquipmentAsset = tableSet.has('EquipmentAsset');
    const hasOtpVerification = tableSet.has('OtpVerification');

    console.log('Hiện trạng các bảng liên quan:');
    console.log(`- BuildingArea     : ${hasBuildingArea ? 'ĐÃ CÓ' : 'CHƯA CÓ (Cần tạo mới)'}`);
    console.log(`- EquipmentAsset   : ${hasEquipmentAsset ? 'ĐÃ CÓ (Cần sao chép sang BuildingArea)' : 'CHƯA CÓ'}`);
    console.log(`- OtpVerification  : ${hasOtpVerification ? 'ĐÃ CÓ' : 'CHƯA CÓ (Cần tạo mới)'}`);

    // Phân tích cột trong IncidentTicket
    const ticketCols: any[] = await prisma.$queryRaw`
      SELECT column_name::text as col
      FROM information_schema.columns
      WHERE table_name = 'IncidentTicket' AND table_schema = current_schema();
    `;
    const ticketColSet = new Set(ticketCols.map((c: any) => c.col));
    const hasAreaId = ticketColSet.has('areaId');
    console.log(`- IncidentTicket.areaId : ${hasAreaId ? 'ĐÃ CÓ' : 'CHƯA CÓ (Cần bổ sung và liên kết 7 ticket)'}`);

    // Phân tích cột trong User
    const userCols: any[] = await prisma.$queryRaw`
      SELECT column_name::text as col
      FROM information_schema.columns
      WHERE table_name = 'User' AND table_schema = current_schema();
    `;
    const userColSet = new Set(userCols.map((c: any) => c.col));
    console.log(`- User.isActivated      : ${userColSet.has('isActivated') ? 'ĐÃ CÓ' : 'CHƯA CÓ (Cần bổ sung)'}`);
    console.log(`- User.mustChangePassword: ${userColSet.has('mustChangePassword') ? 'ĐÃ CÓ' : 'CHƯA CÓ (Cần bổ sung)'}`);
    console.log(`- User.tokenVersion     : ${userColSet.has('tokenVersion') ? 'ĐÃ CÓ' : 'CHƯA CÓ (Cần bổ sung)'}\n`);

    if (!isExecute) {
      console.log('KẾ HOẠCH DDL AN TOÀN SẼ THỰC HIỆN KHI CÓ LỆNH THỰC THI:');
      console.log('1. CREATE TABLE "BuildingArea" (khớp 100% Prisma schema).');
      console.log('2. INSERT INTO "BuildingArea" SELECT FROM "EquipmentAsset" (bảo toàn 2 khu vực WP-1204, AC-B02).');
      console.log('3. ALTER TABLE "IncidentTicket" ADD COLUMN "areaId" & UPDATE "areaId" = "assetId" (bảo toàn 7 ticket liên kết).');
      console.log('4. ALTER TABLE "User" ADD COLUMN "isActivated", "mustChangePassword", "tokenVersion".');
      console.log('5. UPDATE "User" SET "isActivated" = true cho các tài khoản hiện có.');
      console.log('6. CREATE TABLE "OtpVerification" & ALTER TABLE "ResidencyRecord" ADD COLUMN "residencyRole".');
      console.log('\nĐể áp dụng DDL này lên TEST, chạy lệnh: npm --prefix backend run test:reconcile-schema -- --execute');
      return;
    }

    // THỰC THI DDL TRÊN TEST TRONG TRANSACTION (TỰ ĐỘNG ROLLBACK NẾU LỖI)
    console.log('Đang thực thi đồng bộ DDL an toàn trên TEST (trong Transaction)...');

    await prisma.$transaction(async (tx) => {
      // 1. Tạo bảng BuildingArea
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "BuildingArea" (
          "id" TEXT NOT NULL,
          "qrCode" TEXT NOT NULL,
          "areaName" TEXT NOT NULL,
          "category" "IncidentCategory" NOT NULL,
          "locationLabel" TEXT NOT NULL,
          "buildingBlock" TEXT NOT NULL,
          "floor" TEXT NOT NULL,
          "isActive" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "BuildingArea_pkey" PRIMARY KEY ("id")
        );
      `);
      await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "BuildingArea_qrCode_key" ON "BuildingArea"("qrCode");`);
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BuildingArea_qrCode_idx" ON "BuildingArea"("qrCode");`);

      // 2. Chuyển dữ liệu từ EquipmentAsset sang BuildingArea nếu có
      if (hasEquipmentAsset) {
        await tx.$executeRawUnsafe(`
          INSERT INTO "BuildingArea" ("id", "qrCode", "areaName", "category", "locationLabel", "buildingBlock", "floor", "isActive", "createdAt")
          SELECT "id", "qrCode", "assetName", "category", "locationLabel", "buildingBlock", "floor", "isActive", "createdAt"
          FROM "EquipmentAsset"
          ON CONFLICT ("id") DO NOTHING;
        `);
      }

      // 3. Bổ sung areaId cho IncidentTicket và liên kết 7 ticket
      await tx.$executeRawUnsafe(`ALTER TABLE "IncidentTicket" ADD COLUMN IF NOT EXISTS "areaId" TEXT;`);
      await tx.$executeRawUnsafe(`
        UPDATE "IncidentTicket" 
        SET "areaId" = "assetId" 
        WHERE "areaId" IS NULL AND "assetId" IS NOT NULL;
      `);

      // Khóa ngoại areaId
      await tx.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'IncidentTicket_areaId_fkey' AND table_name = 'IncidentTicket'
          ) THEN
            ALTER TABLE "IncidentTicket"
            ADD CONSTRAINT "IncidentTicket_areaId_fkey"
            FOREIGN KEY ("areaId") REFERENCES "BuildingArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
          END IF;
        END $$;
      `);
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "IncidentTicket_areaId_idx" ON "IncidentTicket"("areaId");`);

      // 4. Bổ sung các cột cho User
      await tx.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActivated" BOOLEAN NOT NULL DEFAULT false;`);
      await tx.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;`);
      await tx.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;`);
      await tx.$executeRawUnsafe(`UPDATE "User" SET "isActivated" = true WHERE "isActive" = true AND "isActivated" = false;`);

      // 5. Bổ sung bảng OtpVerification
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "OtpVerification" (
          "id" TEXT NOT NULL,
          "email" TEXT NOT NULL,
          "otpHash" TEXT NOT NULL,
          "purpose" TEXT NOT NULL,
          "expiresAt" TIMESTAMP(3) NOT NULL,
          "attempts" INTEGER NOT NULL DEFAULT 0,
          "isUsed" BOOLEAN NOT NULL DEFAULT false,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "OtpVerification_pkey" PRIMARY KEY ("id")
        );
      `);
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OtpVerification_email_purpose_idx" ON "OtpVerification"("email", "purpose");`);
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OtpVerification_expiresAt_idx" ON "OtpVerification"("expiresAt");`);

      // 6. Bổ sung residencyRole cho ResidencyRecord
      await tx.$executeRawUnsafe(`ALTER TABLE "ResidencyRecord" ADD COLUMN IF NOT EXISTS "residencyRole" TEXT NOT NULL DEFAULT 'TENANT';`);
    });

    console.log('✓ Đã tạo/kiểm tra bảng BuildingArea.');
    if (hasEquipmentAsset) {
      console.log('✓ Đã sao chép khu vực từ EquipmentAsset sang BuildingArea.');
    }
    console.log('✓ Đã liên kết areaId từ assetId cho IncidentTicket.');
    console.log('✓ Đã tạo khóa ngoại IncidentTicket(areaId) -> BuildingArea(id).');
    console.log('✓ Đã cập nhật các trường User (isActivated, mustChangePassword, tokenVersion) và kích hoạt tài khoản hiện có.');
    console.log('✓ Đã tạo/kiểm tra bảng OtpVerification.');
    console.log('✓ Đã bổ sung trường residencyRole cho ResidencyRecord.');

    console.log('\n🎉 HOÀN TẤT ĐỒNG BỘ SCHEMA TRÊN NEON TEST MỘT CÁCH AN TOÀN!');
  } catch (err: any) {
    console.error('\n❌ LỖI ĐỒNG BỘ SCHEMA:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const isExecute = process.argv.includes('--execute');
  reconcileTestSchema(isExecute);
}

