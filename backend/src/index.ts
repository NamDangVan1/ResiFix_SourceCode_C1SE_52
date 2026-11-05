import path from 'path';
import dotenv from 'dotenv';

// BẮT BUỘC NẠP FILE .ENV NGAY DÒNG ĐẦU TIÊN TRƯỚC KHI IMPORT CÁC ROUTES & PRISMA
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express, { Request, Response } from 'express';
import cors from 'cors';
import { prisma } from './db';
import authRoutes from './routes/auth.routes';
import ticketRoutes from './routes/ticket.routes';
import notificationRoutes from './routes/notification.routes';
import uploadRoutes from './routes/upload.routes';

const app = express();
const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required to start the ResiFix API.');
}

app.use(cors());
// Tăng giới hạn payload lên 10MB để hỗ trợ upload ảnh chụp từ Camera (US-08, US-33, US-43)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 1. Module Xác thực & Phân quyền RBAC (EP01: US-01 -> US-05)
app.use('/api/auth', authRoutes);

// 2. Module Quản lý Sự cố, Quét QR & Trợ lý Gemini AI (EP02 -> EP07: US-06 -> US-40)
app.use('/api/tickets', ticketRoutes);

// 3. Module Hộp thư Thông báo & Lịch sử FCM (EP06: US-35 -> US-37, Risk R3)
app.use('/api/notifications', notificationRoutes);

// 4. Module Tải ảnh đám mây Cloudinary (EP08: US-43, Risk R4)
app.use('/api/upload', uploadRoutes);

// 5. API Kiểm tra kết nối Server & Neon PostgreSQL Database (Health Check)
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'OK',
      project: 'ResiFix API Gateway - C1SE.52',
      database: 'Connected to Neon PostgreSQL successfully!',
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'ERROR', message: 'Database connection failed' });
  }
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`✅ Đã nạp DATABASE_URL: ${process.env.DATABASE_URL ? 'THÀNH CÔNG' : 'THẤT BẠI (Kiểm tra lại tên file .env)'}`);
  console.log(`🚀 ResiFix Backend Server đang chạy tại: http://localhost:${PORT}/api/health`);
});
