import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// 1. API Kiểm tra kết nối Server & Neon PostgreSQL Database (Health Check)
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const userCount = await prisma.user.count();
    const ticketCount = await prisma.incidentTicket.count();
    res.status(200).json({
      status: 'OK',
      project: 'ResiFix API Gateway - C1SE.52',
      database: 'Connected to Neon PostgreSQL successfully!',
      stats: { totalUsers: userCount, totalTickets: ticketCount },
    });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: 'Database connection failed', error });
  }
});

// 2. API Lấy danh sách Sự cố (Phục vụ Trang chủ Cư dân, KTV & BMB Web - US-13, US-21, US-29)
app.get('/api/tickets', async (req: Request, res: Response) => {
  try {
    const tickets = await prisma.incidentTicket.findMany({
      include: {
        resident: { select: { fullName: true, apartmentCode: true, phone: true } },
        assignedTech: { select: { fullName: true, specialtyLabel: true, phone: true } },
        asset: true,
        media: true,
        statusLogs: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ message: 'Lỗi khi tải danh sách sự cố', error });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 ResiFix Backend Server đang chạy tại: http://localhost:${PORT}/api/health`);
});