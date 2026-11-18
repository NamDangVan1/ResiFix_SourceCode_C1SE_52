import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

async function main() {
  const isConfirmed = process.argv.includes('--confirm-cutover-production');

  console.log('========================================================================');
  console.log('🚀 RESIFIX PRODUCTION CUTOVER EXECUTION RUNNER');
  console.log('========================================================================\n');

  if (!isConfirmed) {
    console.error('⛔ [AN TOÀN BẢO VỆ PRODUCTION]: Lệnh thực thi chưa có cờ xác nhận!');
    console.error('   Để thực thi chính thức, bạn PHẢI truyền đúng tham số:');
    console.error('   --confirm-cutover-production\n');
    console.error('   Lệnh bị hủy bỏ ngay lập tức để bảo vệ an toàn cho Production.\n');
    process.exit(1);
  }

  // 1. Đọc backend/.env
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

  console.log('--- 1. XÁC NHẬN MÔI TRƯỜNG MỤC TIÊU ---');
  console.log(`✓ Database Target: ${hostname} (PRODUCTION)`);
  console.log(`✓ Database Name  : ${parsedUrl.pathname.replace(/^\//, '') || 'resifix_db'}\n`);

  const prisma = new PrismaClient({
    datasources: { db: { url: prodDatabaseUrl } },
  });

  const sqlPath = path.resolve(__dirname, '01_production_cutover_migration.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error('❌ Không tìm thấy file 01_production_cutover_migration.sql!');
    process.exit(1);
  }
  const rawSql = fs.readFileSync(sqlPath, 'utf8');

  // Phân tách thành từng câu lệnh đơn lẻ để tương thích với PostgreSQL Prepared Statements
  const statements = rawSql
    .split(/;\s*[\r\n]+/)
    .map((s) => s.replace(/--.*$/gm, '').trim())
    .filter((s) => s.length > 0 && s !== 'BEGIN' && s !== 'COMMIT');

  console.log(`✓ Đã nạp và phân tích ${statements.length} câu lệnh DDL an toàn từ 01_production_cutover_migration.sql.`);

  try {
    console.log('\n--- 2. ĐANG THỰC THI TOÀN BỘ DDL MIGRATION TRONG TRANSACTION ---');

    await prisma.$transaction(
      async (tx) => {
        let stmtIdx = 0;
        for (const stmt of statements) {
          stmtIdx++;
          await tx.$executeRawUnsafe(stmt);
        }
        console.log(`  [✅ DDL EXECUTED] Đã thực thi thành công toàn bộ ${stmtIdx} câu lệnh DDL trên Production!`);

        // Ghi nhận chính xác 3 migration delta vào _prisma_migrations
        console.log('\n--- 3. ĐỒNG BỘ LỊCH SỬ MIGRATION (_prisma_migrations) ---');
        const migrationsToRecord = [
          '20261105_apartments_and_payroll',
          '20261106_otp_and_activation',
          '20261110_resident_lifecycle_and_pwd',
        ];

        for (const mName of migrationsToRecord) {
          const migFile = path.resolve(__dirname, '../../prisma/migrations', mName, 'migration.sql');
          if (!fs.existsSync(migFile)) {
            throw new Error(`Không tìm thấy file migration vật lý: ${migFile}`);
          }
          const migSql = fs.readFileSync(migFile, 'utf8');
          const checksum = crypto.createHash('sha256').update(migSql).digest('hex');

          const existing = await tx.$queryRawUnsafe<any[]>(
            `SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1;`,
            mName
          );
          if (existing.length === 0) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
               VALUES (gen_random_uuid(), $1, CURRENT_TIMESTAMP, $2, null, null, CURRENT_TIMESTAMP, 1);`,
              checksum,
              mName
            );
            console.log(`  [✅ RECORDED] ${mName} (${checksum.substring(0, 16)}...)`);
          } else {
            console.log(`  [ℹ️ ALREADY RECORDED] ${mName}`);
          }
        }
      },
      {
        timeout: 60000, // 60s timeout cho migration
      }
    );

    console.log('\n========================================================================');
    console.log('🎉 BƯỚC 1 CỦA CUTOVER HOÀN THÀNH: SCHEMA PRODUCTION ĐÃ ĐỒNG BỘ 100%!');
    console.log('   Bước tiếp theo: Chạy script 02_import_production_baseline_data.ts --execute');
    console.log('========================================================================\n');
  } catch (err: any) {
    console.error('❌ LỖI TRONG QUÁ TRÌNH CUTOVER:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal cutover runner error:', err);
  process.exit(1);
});
