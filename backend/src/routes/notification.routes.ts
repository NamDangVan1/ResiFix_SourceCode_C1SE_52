import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateJWT, AuthRequest } from '../middlewares/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

const getParamAsString = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || '';
  return String(param || '');
};

// ============================================================================
// 1. GET /api/notifications - Lấy danh sách thông báo & số lượng chưa đọc (FR08, Risk R3, US-36, US-37)
// Phục vụ màn hình "04. Hộp thư Thông báo" trên Mobile và "03. Thông báo hệ thống" trên BMB Web
// ============================================================================
router.get('/', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const unreadOnly = req.query.unreadOnly === 'true';

    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      include: {
        ticket: {
          select: {
            id: true,
            ticketCode: true,
            title: true,
            status: true,
            locationNote: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    res.status(200).json({
      success: true,
      unreadCount, // Dùng để hiển thị chấm đỏ trên biểu tượng Chuông 🔔 ở Trang chủ
      total: notifications.length,
      notifications,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi khi tải hộp thư thông báo', error });
  }
});

// ============================================================================
// 2. PATCH /api/notifications/read-all - Đánh dấu tất cả là Đã đọc (US-36)
// ============================================================================
router.patch('/read-all', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.userId, isRead: false },
      data: { isRead: true },
    });

    res.status(200).json({
      success: true,
      message: `Đã đánh dấu đọc toàn bộ ${result.count} thông báo!`,
      updatedCount: result.count,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi khi cập nhật trạng thái thông báo', error });
  }
});

// ============================================================================
// 3. PATCH /api/notifications/:id/read - Đánh dấu 1 thông báo là Đã đọc khi người dùng bấm vào (US-36)
// ============================================================================
router.patch('/:id/read', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const notificationId = getParamAsString(req.params.id);

    const existing = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!existing || existing.userId !== req.user!.userId) {
      res.status(404).json({ success: false, message: 'Không tìm thấy thông báo!' });
      return;
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    res.status(200).json({
      success: true,
      message: 'Đã đánh dấu thông báo là đã đọc.',
      notification: updated,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi khi đánh dấu đã đọc', error });
  }
});

export default router;