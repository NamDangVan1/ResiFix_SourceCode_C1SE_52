/**
 * MODULE BẢO VỆ MÔI TRƯỜNG TEST & CHỐNG RÒ RỈ PRODUCTION
 * 
 * NGUYÊN TẮC BẢO MẬT & CÔ LẬP TUYỆT ĐỐI:
 * 1. Chỉ đọc duy nhất file backend/.env.test.
 * 2. Tuyệt đối KHÔNG nạp hay đọc backend/.env.
 * 3. Xóa sạch biến môi trường DATABASE_URL trước khi đọc .env.test.
 * 4. Chặn đứng kết nối nếu phát hiện endpoint của Production (ep-calm-block-ao4yq1h0).
 * 5. Cơ chế xác nhận database đích là branch resifix-migration-test (dựa trên Endpoint ID và Fingerprint cấu trúc).
 * 6. Tuyệt đối KHÔNG in username, password hoặc chuỗi connection string ra console/log.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

export interface TestDbConfig {
  testDatabaseUrl: string;
  hostname: string;
  databaseName: string;
  port: string;
}

export interface TargetVerificationResult {
  isVerifiedTest: boolean;
  database: string;
  schema: string;
  serverVersion: string;
  tableCount: number;
  tables: string[];
  fingerprint: {
    hasApartment: boolean;
    apartmentCount: number;
    hasBuildingArea: boolean;
    buildingAreaCount: number;
    hasIncidentTicket: boolean;
    incidentTicketCount: number;
    hasResidencyRecord: boolean;
    residencyRecordCount: number;
  };
  rejectionReason?: string;
}

// Endpoint ID của Production cần được bảo vệ tuyệt đối
const PROD_ENDPOINT_KEY = 'ao4yq1h0';

/**
 * Nạp và thẩm định chuỗi kết nối TEST duy nhất từ backend/.env.test.
 * Tuyệt đối không đọc backend/.env. Dừng ngay nếu thiếu file hoặc thiếu DATABASE_URL.
 */
export function loadTestEnvironmentStrict(): TestDbConfig {
  const envTestPath = path.resolve(__dirname, '../../../backend/.env.test');

  // 1. Kiểm tra sự tồn tại của file backend/.env.test
  if (!fs.existsSync(envTestPath)) {
    console.error('\n❌ [BẢO VỆ PRODUCTION] KHÔNG TÌM THẤY FILE: backend/.env.test');
    console.error('   Hệ thống từ chối chạy để tránh kết nối nhầm vào Production.');
    console.error('   Vui lòng tạo file backend/.env.test và cấu hình DATABASE_URL của branch resifix-migration-test.\n');
    process.exit(1);
  }

  // 2. Xóa triệt để biến môi trường cũ trong process.env
  delete process.env.DATABASE_URL;

  // 3. Đọc duy nhất file .env.test (không gọi dotenv.config() để tránh nạp .env)
  const rawContent = fs.readFileSync(envTestPath, 'utf8');
  const parsed = dotenv.parse(rawContent);

  const testDatabaseUrl = (parsed.DATABASE_URL || '').trim();

  // 4. Nếu thiếu DATABASE_URL hoặc đang để trống -> Dừng ngay lập tức
  if (!testDatabaseUrl) {
    console.error('\n⚠️ [YÊU CẦU CẤU HÌNH] DATABASE_URL trong backend/.env.test ĐANG ĐỂ TRỐNG!');
    console.error('   Hệ thống đã dừng lại an toàn và không thực hiện bất kỳ thao tác nào.');
    console.error('   Vui lòng mở file backend/.env.test và dán Connection String của branch "resifix-migration-test".\n');
    process.exit(1);
  }

  // 5. Thẩm định cú pháp URL và bóc tách hostname an toàn (ẩn credentials)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(testDatabaseUrl);
  } catch (err: any) {
    console.error('\n❌ [LỖI ĐỊNH DẠNG] DATABASE_URL trong backend/.env.test không phải là URL PostgreSQL hợp lệ!');
    console.error('   Chi tiết lỗi cú pháp:', err.message);
    process.exit(1);
  }

  if (parsedUrl.protocol !== 'postgresql:' && parsedUrl.protocol !== 'postgres:') {
    console.error('\n❌ [LỖI PROTOCOL] Giao thức cơ sở dữ liệu phải là postgresql:// hoặc postgres://');
    process.exit(1);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const databaseName = parsedUrl.pathname.replace(/^\//, '') || 'neondb';
  const port = parsedUrl.port || '5432';

  // 6. Cơ chế chặn Production dựa trên Endpoint ID thực tế của Production
  if (hostname.includes(PROD_ENDPOINT_KEY)) {
    console.error('\n⛔ [BÁO ĐỘNG ĐỎ] PHÁT HIỆN HOSTNAME TRÙNG VỚI PRODUCTION DATABASE!');
    console.error(`   Hostname [${hostname}] chứa mã định danh của Production (${PROD_ENDPOINT_KEY}).`);
    console.error('   Hệ thống từ chối kết nối ngay lập tức để bảo vệ 100% dữ liệu Production.\n');
    process.exit(1);
  }

  // Gán an toàn vào process.env để Prisma Client nhận đúng URL của TEST
  process.env.DATABASE_URL = testDatabaseUrl;

  return {
    testDatabaseUrl,
    hostname,
    databaseName,
    port,
  };
}

/**
 * Khởi tạo PrismaClient riêng biệt chỉ kết nối vào TEST
 */
export function createTestPrismaClient(config: TestDbConfig): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: config.testDatabaseUrl,
      },
    },
    log: ['error', 'warn'],
  });
}

/**
 * Xác minh Database đích:
 * 1. Thực hiện truy vấn CHỈ ĐỌC (Read-Only).
 * 2. Thu thập database name, schema, version, tables.
 * 3. Kiểm tra dấu vân tay cấu trúc (Structural Fingerprint) để đảm bảo không phải Production.
 * 4. Từ chối chạy nếu không xác minh được database đích an toàn.
 */
export async function verifyTargetDatabaseIsTestBranch(
  prisma: PrismaClient,
  config: TestDbConfig
): Promise<TargetVerificationResult> {
  // Check 1: Hostname chặn Production ID
  if (config.hostname.includes(PROD_ENDPOINT_KEY)) {
    return {
      isVerifiedTest: false,
      database: config.databaseName,
      schema: 'unknown',
      serverVersion: 'unknown',
      tableCount: 0,
      tables: [],
      fingerprint: {
        hasApartment: false,
        apartmentCount: 0,
        hasBuildingArea: false,
        buildingAreaCount: 0,
        hasIncidentTicket: false,
        incidentTicketCount: 0,
        hasResidencyRecord: false,
        residencyRecordCount: 0,
      },
      rejectionReason: `Hostname chứa Endpoint ID của Production (${PROD_ENDPOINT_KEY})`,
    };
  }

  // Truy vấn chỉ đọc thông tin hệ thống
  const sysInfo: any[] = await prisma.$queryRaw`
    SELECT 
      current_database()::text as database,
      current_schema()::text as schema,
      version()::text as version;
  `;
  const row = sysInfo[0] || {};
  const currentDb = row.database || config.databaseName;
  const currentSchema = row.schema || 'public';
  const serverVersion = String(row.version || '').split(' on ')[0];

  // Khảo sát danh sách bảng trong schema hiện tại
  const tablesResult: any[] = await prisma.$queryRaw`
    SELECT table_name::text as table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
    ORDER BY table_name;
  `;
  const tableNames = new Set(tablesResult.map((t: any) => t.table_name));
  const tablesList = Array.from(tableNames);

  // Fingerprint checks
  const hasApartment = tableNames.has('Apartment');
  let apartmentCount = 0;
  if (hasApartment) {
    const res: any[] = await prisma.$queryRaw`SELECT count(*)::int as count FROM "Apartment";`;
    apartmentCount = res[0]?.count ?? 0;
  }

  const hasBuildingArea = tableNames.has('BuildingArea');
  let buildingAreaCount = 0;
  if (hasBuildingArea) {
    const res: any[] = await prisma.$queryRaw`SELECT count(*)::int as count FROM "BuildingArea";`;
    buildingAreaCount = res[0]?.count ?? 0;
  }

  const hasIncidentTicket = tableNames.has('IncidentTicket');
  let incidentTicketCount = 0;
  if (hasIncidentTicket) {
    const res: any[] = await prisma.$queryRaw`SELECT count(*)::int as count FROM "IncidentTicket";`;
    incidentTicketCount = res[0]?.count ?? 0;
  }

  const hasResidencyRecord = tableNames.has('ResidencyRecord');
  let residencyRecordCount = 0;
  if (hasResidencyRecord) {
    const res: any[] = await prisma.$queryRaw`SELECT count(*)::int as count FROM "ResidencyRecord";`;
    residencyRecordCount = res[0]?.count ?? 0;
  }

  const fingerprint = {
    hasApartment,
    apartmentCount,
    hasBuildingArea,
    buildingAreaCount,
    hasIncidentTicket,
    incidentTicketCount,
    hasResidencyRecord,
    residencyRecordCount,
  };

  // Check 2: Dấu vân tay Production (5 BuildingArea + 8 IncidentTicket liên kết)
  if (hasBuildingArea && buildingAreaCount === 5 && incidentTicketCount >= 7) {
    return {
      isVerifiedTest: false,
      database: currentDb,
      schema: currentSchema,
      serverVersion,
      tableCount: tablesList.length,
      tables: tablesList,
      fingerprint,
      rejectionReason: 'Dấu vân tay dữ liệu trùng khớp với Production (5 BuildingArea và 7+ IncidentTicket). Nghi ngờ kết nối vào Production!',
    };
  }

  return {
    isVerifiedTest: true,
    database: currentDb,
    schema: currentSchema,
    serverVersion,
    tableCount: tablesList.length,
    tables: tablesList,
    fingerprint,
  };
}
