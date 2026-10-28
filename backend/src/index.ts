import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth.routes';
import ticketRoutes from './routes/ticket.routes';
import notificationRoutes from './routes/notification.routes';
import uploadRoutes from './routes/upload.routes';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;

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
    const userCount = await prisma.user.count();
    const ticketCount = await prisma.incidentTicket.count();
    const notificationCount = await prisma.notification.count();
    res.status(200).json({
      status: 'OK',
      project: 'ResiFix API Gateway - C1SE.52',
      database: 'Connected to Neon PostgreSQL successfully!',
      stats: {
        totalUsers: userCount,
        totalTickets: ticketCount,
        totalNotifications: notificationCount,
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Database connection failed', error });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 ResiFix Backend Server đang chạy tại: http://localhost:${PORT}/api/health`);
});