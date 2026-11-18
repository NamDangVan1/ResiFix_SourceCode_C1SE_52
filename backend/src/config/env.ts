import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/**
 * MODULE KHỞI TẠO MÔI TRƯỜNG & GUARD BẢO VỆ DATABASE
 * Đảm bảo nạp cấu hình trước khi PrismaClient hoặc Express Routes được import.
 */

const isTestMode =
  process.argv.includes('--test-env') ||
  process.argv.includes('--test') ||
  process.env.NODE_ENV === 'test' ||
  process.env.RESIFIX_ENV === 'test';

const PROD_ENDPOINT_KEY = 'ao4yq1h0';
const TEST_ENDPOINT_KEY = 'ao4iuzkq';

// Tìm thư mục gốc backend (chứa package.json, .env, .env.test)
const backendRoot = path.resolve(__dirname, '../../');

if (isTestMode) {
  const envTestPath = path.resolve(backendRoot, '.env.test');

  // 1. Kiểm tra tồn tại file backend/.env.test
  if (!fs.existsSync(envTestPath)) {
    console.error('\n❌ [FATAL_ENV_GUARD] KHÔNG TÌM THẤY FILE: backend/.env.test');
    console.error('   Chế độ dev:test yêu cầu file backend/.env.test nhưng không tìm thấy.');
    console.error('   Khởi động bị HỦY BỎ ngay lập tức để bảo vệ hệ thống.\n');
    process.exit(1);
  }

  // 2. Xóa sạch DATABASE_URL cũ trong process.env để tránh rò rỉ
  delete process.env.DATABASE_URL;

  // 3. Đọc tường minh DUY NHẤT file .env.test (TUYỆT ĐỐI KHÔNG FALLBACK SANG .env)
  const rawContent = fs.readFileSync(envTestPath, 'utf8');
  const parsed = dotenv.parse(rawContent);

  const testDatabaseUrl = (parsed.DATABASE_URL || '').trim();
  if (!testDatabaseUrl) {
    console.error('\n❌ [FATAL_ENV_GUARD] THIẾU DATABASE_URL TRONG backend/.env.test');
    console.error('   Khởi động bị HỦY BỎ ngay lập tức.\n');
    process.exit(1);
  }

  // 4. Thẩm định URL và Hostname (không in credentials hay connection string)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(testDatabaseUrl);
  } catch (err: any) {
    console.error('\n❌ [FATAL_ENV_GUARD] DATABASE_URL trong backend/.env.test không hợp lệ!');
    console.error('   Lỗi cú pháp:', err.message);
    process.exit(1);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const databaseName = parsedUrl.pathname.replace(/^\//, '') || 'neondb';
  const port = parsedUrl.port || '5432';

  // 5. CHẶN NGUY HIỂM: Nếu Hostname chứa mã Production
  if (hostname.includes(PROD_ENDPOINT_KEY) || hostname.includes('calm-block')) {
    console.error('\n⛔ [FATAL_ENV_GUARD - BÁO ĐỘNG ĐỎ] PHÁT HIỆN HOSTNAME TRÙNG PRODUCTION!');
    console.error(`   Hostname: [${hostname}] thuộc cơ sở dữ liệu PRODUCTION.`);
    console.error('   Hệ thống TỪ CHỐI KHỞI ĐỘNG để bảo vệ 100% dữ liệu thật của Production.\n');
    process.exit(1);
  }

  // 6. XÁC MINH TEST: Hostname phải khớp nhánh Neon TEST an toàn
  if (!hostname.includes(TEST_ENDPOINT_KEY) && !hostname.includes('old-sound')) {
    console.error('\n❌ [FATAL_ENV_GUARD] KHÔNG XÁC MINH ĐƯỢC DATABASE TEST!');
    console.error(`   Hostname: [${hostname}] không khớp với nhánh Neon TEST được phê duyệt (${TEST_ENDPOINT_KEY}).`);
    console.error('   Hệ thống TỪ CHỐI KHỞI ĐỘNG.\n');
    process.exit(1);
  }

  // 7. Gán toàn bộ biến từ .env.test vào process.env
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.NODE_ENV = 'test';

  // 8. In thông báo an toàn xác nhận chế độ TEST
  console.log('===============================================================');
  console.log('🛡️  RESIFIX BACKEND - CHẾ ĐỘ TEST AN TOÀN (TEST-ONLY MODE)');
  console.log('===============================================================');
  console.log(`✓ Môi trường    : NEON TEST (Nhánh resifix-migration-test)`);
  console.log(`✓ Cấu hình nạp : backend/.env.test (Độc lập 100% với .env)`);
  console.log(`✓ Database Host : ${hostname}`);
  console.log(`✓ Database Name : ${databaseName}`);
  console.log(`✓ Database Port : ${port}`);
  console.log(`✓ API Port      : ${process.env.PORT || 5000}`);
  console.log('✓ Khóa bảo vệ   : ĐÃ BẬT - Tự động chặn mọi kết nối đến Production');
  console.log('===============================================================\n');
} else {
  // Chế độ DEV thông thường: Nạp backend/.env như mặc định
  const envPath = path.resolve(backendRoot, '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

export { isTestMode, PROD_ENDPOINT_KEY, TEST_ENDPOINT_KEY };

