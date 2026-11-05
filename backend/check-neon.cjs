const path = require("node:path");
const crypto = require("node:crypto");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  try {
    const [result] = await prisma.$queryRaw`
      SELECT
        current_database() AS "databaseName",
        current_schema() AS "schemaName",
        (
          SELECT COUNT(*)::integer
          FROM information_schema.tables
          WHERE table_schema = current_schema()
          AND table_type = 'BASE TABLE'
        ) AS "tableCount"
    `;

    const url = new URL(process.env.DATABASE_URL);
    const host = url.hostname.replace(/-pooler(?=\.)/, "");

    const fingerprint = crypto
      .createHash("sha256")
      .update(
        `${host}/${result.databaseName}/${result.schemaName}`
      )
      .digest("hex")
      .slice(0, 12);

    console.log("✅ KẾT NỐI PRISMA THÀNH CÔNG");
    console.log("Database:", result.databaseName);
    console.log("Schema:", result.schemaName);
    console.log("Số bảng:", result.tableCount);
    console.log("Mã đối chiếu:", fingerprint);
    console.log("Không hiển thị DATABASE_URL");
  } catch (error) {
    console.error("❌ KẾT NỐI THẤT BẠI");
    console.error("Mã lỗi:", error.code || "UNKNOWN");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();