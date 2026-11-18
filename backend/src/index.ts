import './config/env';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { prisma } from './config/database';
import apiRouter from './routes';
import { slaWorker } from './services/sla_worker';

const app = express();
const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required to start the ResiFix API.');
}

app.use(cors());
// Tăng giới hạn payload lên 10MB để hỗ trợ upload ảnh chụp từ Camera (US-08, US-33, US-43)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Gắn kết toàn bộ 9 phân hệ API chính thức qua Router Aggregator
app.use('/api', apiRouter);

// 10. API Kiểm tra kết nối Server & Neon PostgreSQL Database (Health Check)
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'OK',
      project: 'ResiFix API Gateway - C1SE.52',
      database: 'Connected to Neon PostgreSQL successfully!',
    });
  } catch (error: any) {
    console.error('Health check database check failed:', error?.message || error);
    res.status(503).json({
      status: 'UNAVAILABLE',
      message: 'Cơ sở dữ liệu đang kết nối hoặc tạm thời chưa sẵn sàng. Vui lòng thử lại sau giây lát.',
    });
  }
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`✅ Đã nạp DATABASE_URL: ${process.env.DATABASE_URL ? 'THÀNH CÔNG' : 'THẤT BẠI (Kiểm tra lại tên file .env)'}`);
  console.log(`🚀 ResiFix Backend Server đang chạy tại: http://localhost:${PORT}/api/health`);
  slaWorker.start();

  // Kiểm tra kết nối cơ sở dữ liệu khi khởi động
  prisma.$queryRaw`SELECT 1`
    .then(() => console.log('✅ Kết nối Neon PostgreSQL: SẴN SÀNG!'))
    .catch((err: any) => console.warn('⚠️ Neon PostgreSQL đang khởi động hoặc chưa sẵn sàng:', err?.message || err));
});
