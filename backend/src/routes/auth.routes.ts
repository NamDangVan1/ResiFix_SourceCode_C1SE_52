import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PrismaClient, Role } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

// ============================================================================
// 1. POST /api/auth/login - Đăng nhập hệ thống (FR01, US-01, US-03, US-45)
// Hỗ trợ đăng nhập bằng Số điện thoại (Mobile Cư dân/KTV) hoặc Email (Web BMB)
// ============================================================================
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { identifier, phone, password, fcmToken } = req.body;
    const loginInput = (identifier || phone || '').trim();

    // Kiểm tra đầu vào (US-44: Input Validation)
    if (!loginInput || !password) {
      res.status(400).json({
        success: false,
        message: 'Vui lòng nhập đầy đủ Số điện thoại (hoặc Email) và Mật khẩu!',
      });
      return;
    }

    // Tìm tài khoản theo Số điện thoại hoặc Email
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: loginInput },
          { email: loginInput.toLowerCase() },
        ],
      },
    });

    if (!user || !user.isActive) {
      res.status(401).json({
        success: false,
        message: 'Số điện thoại hoặc mật khẩu không chính xác, hoặc tài khoản đã bị khóa!',
      });
      return;
    }

    // So sánh mật khẩu mã hóa Bcrypt (NFR02, US-45)
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: 'Số điện thoại hoặc mật khẩu không chính xác!',
      });
      return;
    }

    // Nếu thiết bị Android gửi kèm fcmToken thì cập nhật luôn để nhận Push Notification (FR08, US-35)
    if (fcmToken) {
      await prisma.user.update({
        where: { id: user.id },
        data: { fcmToken },
      });
    }

    // Tạo JWT Token (US-03)
    const secret = process.env.JWT_SECRET || 'ResiFix_C1SE52_SuperSecretKey_2026';
    const token = jwt.sign(
      {
        userId: user.id,
        phone: user.phone,
        role: user.role,
        fullName: user.fullName,
      },
      secret,
      { expiresIn: '7d' }
    );

    // Ẩn passwordHash trước khi trả về Client (US-05 Acceptance Criteria)
    const { passwordHash, ...safeUserData } = user;

    res.status(200).json({
      success: true,
      message: `Đăng nhập thành công! Chào mừng ${user.fullName} (${user.role})`,
      token,
      user: safeUserData, // Client sẽ đọc user.role để tự mở giao diện Resident / Technician / BMB
    });
  } catch (error) {
    console.error('Lỗi đăng nhập:', error);
    res.status(500).json({
      success: false,
      message: 'Đã xảy ra lỗi hệ thống khi đăng nhập.',
    });
  }
});

// ============================================================================
// 2. GET /api/auth/me - Xem thông tin Hồ sơ cá nhân (US-05: View Profile)
// ============================================================================
router.get('/me', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.userId },
      select: {
        id: true,
        phone: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        apartmentCode: true,
        buildingBlock: true,
        floorNumber: true,
        specialty: true,
        specialtyLabel: true,
        shiftName: true,
        isOnDuty: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'Không tìm thấy thông tin người dùng!' });
      return;
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi khi tải hồ sơ cá nhân', error });
  }
});

// ============================================================================
// 3. POST /api/auth/logout - Đăng xuất & xóa FCM Token (US-02: Log out)
// ============================================================================
router.post('/logout', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Xóa fcmToken để thiết bị không còn nhận thông báo đẩy sau khi đăng xuất
    await prisma.user.update({
      where: { id: req.user?.userId },
      data: { fcmToken: null },
    });

    res.status(200).json({
      success: true,
      message: 'Đăng xuất tài khoản thành công! Phiên làm việc đã đóng.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi khi đăng xuất', error });
  }
});

// ============================================================================
// 4. PATCH /api/auth/on-duty - Kỹ thuật viên bật/tắt trạng thái Ca trực (FR06, Task 2.3.2.4)
// Chỉ cho phép vai trò TECHNICIAN hoặc BMB gọi API này (Demo RBAC US-04)
// ============================================================================
router.patch(
  '/on-duty',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN, Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { isOnDuty } = req.body;

      const updatedTech = await prisma.user.update({
        where: { id: req.user?.userId },
        data: { isOnDuty: Boolean(isOnDuty) },
        select: {
          id: true,
          fullName: true,
          specialtyLabel: true,
          shiftName: true,
          isOnDuty: true,
        },
      });

      res.status(200).json({
        success: true,
        message: `Đã cập nhật trạng thái ca trực: ${updatedTech.isOnDuty ? '🟢 Đang trong ca trực (On-duty)' : '⚪ Ngoài ca trực (Off-duty)'}`,
        technician: updatedTech,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi khi cập nhật trạng thái ca trực', error });
    }
  }
);

export default router;