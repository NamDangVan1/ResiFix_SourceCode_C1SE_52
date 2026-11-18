import './env';
import { PrismaClient } from '@prisma/client';

/**
 * CẤU HÌNH KẾT NỐI DATABASE PRISMA CLIENT
 * Đảm bảo chỉ khởi tạo một instance duy nhất (Singleton pattern) dùng chung cho toàn bộ API routes,
 * middleware và services.
 */
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

export default prisma;

