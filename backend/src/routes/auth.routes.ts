import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../db';

const router = Router();

// ============================================================================
// 1. POST /api/auth/login - Đăng nhập hệ thống (FR01, US-01, US-03, US-45)
// Hỗ trợ đăng nhập bằng Số điện thoại (Mobile Cư dân/KTV) hoặc Email (Web BMB)
// ============================================================================
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { identifier, phone, password, fcmToken } = body;
    const rawIdentifier = typeof identifier === 'string' ? identifier : typeof phone === 'string' ? phone : '';
    const loginInput = rawIdentifier.trim();

    // Kiểm tra đầu vào (US-44: Input Validation)
    if (!loginInput || typeof password !== 'string' || password.length === 0 || password.length > 128) {
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
    if (fcmToken !== undefined) {
      if (typeof fcmToken !== 'string' || fcmToken.length > 4096) {
        res.status(400).json({ success: false, message: 'Mã thiết bị nhận thông báo không hợp lệ.' });
        return;
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { fcmToken },
      });
    }

    // Tạo JWT Token (US-03)
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(503).json({ success: false, message: 'Dịch vụ xác thực chưa được cấu hình.' });
      return;
    }
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
    console.error('Lỗi khi tải hồ sơ cá nhân:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi tải hồ sơ cá nhân.' });
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
    console.error('Lỗi khi đăng xuất:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi đăng xuất.' });
  }
});

// ============================================================================
// 4. PATCH /api/auth/on-duty - Kỹ thuật viên bật/tắt trạng thái Ca trực (FR06, Task 2.3.2.4)
// Only technicians may change their own duty status.
// ============================================================================
router.patch(
  '/on-duty',
  authenticateJWT,
  authorizeRoles(Role.TECHNICIAN),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { isOnDuty } = req.body;
      if (typeof isOnDuty !== 'boolean') {
        res.status(400).json({ success: false, message: 'Trạng thái ca trực không hợp lệ.' });
        return;
      }

      const updatedTech = await prisma.user.update({
        where: { id: req.user?.userId },
        data: { isOnDuty },
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
      console.error('Lỗi khi cập nhật trạng thái ca trực:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi cập nhật trạng thái ca trực.' });
    }
  }
);

export default router;
