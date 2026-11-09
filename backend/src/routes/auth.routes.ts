import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../db';
import { createAndSaveOtp, verifyOtpCode, OtpServiceError } from '../services/otp.service';
import { safeSendOtpEmail } from '../services/mail.service';

const router = Router();

// Whitelist các trường 100% có sẵn trên bảng User (tương thích ngược hoàn hảo với DB gốc trước và sau migration)
const SAFE_USER_SELECT = {
  id: true,
  phone: true,
  email: true,
  passwordHash: true,
  fullName: true,
  avatarUrl: true,
  role: true,
  isActive: true,
  apartmentCode: true,
  buildingBlock: true,
  floorNumber: true,
  specialty: true,
  specialtyLabel: true,
  shiftName: true,
  isOnDuty: true,
  fcmToken: true,
  createdAt: true,
  updatedAt: true,
} as const;

let dbSupportsNewUserColumns: boolean | null = null;

async function findUserForAuth(where: any) {
  if (dbSupportsNewUserColumns === false) {
    const user = await prisma.user.findFirst({
      where,
      select: SAFE_USER_SELECT,
    });
    if (!user) return null;
    return {
      ...user,
      isActivated: undefined,
      tokenVersion: 0,
    };
  }

  try {
    const user = await prisma.user.findFirst({
      where,
      select: {
        ...SAFE_USER_SELECT,
        isActivated: true,
        tokenVersion: true,
      },
    });
    dbSupportsNewUserColumns = true;
    return user;
  } catch (err: any) {
    if (
      err?.code === 'P2022' ||
      err?.code === 'P2021' ||
      String(err?.message || '').includes('isActivated') ||
      String(err?.message || '').includes('tokenVersion')
    ) {
      dbSupportsNewUserColumns = false;
      const user = await prisma.user.findFirst({
        where,
        select: SAFE_USER_SELECT,
      });
      if (!user) return null;
      return {
        ...user,
        isActivated: undefined,
        tokenVersion: 0,
      };
    }
    throw err;
  }
}

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

    // Tìm tài khoản an toàn chống lỗi Prisma P2022 thiếu cột
    const user = await findUserForAuth({
      OR: [
        { phone: loginInput },
        { email: loginInput.toLowerCase() },
      ],
    });

    if (!user || !user.isActive) {
      res.status(401).json({
        success: false,
        message: 'Số điện thoại hoặc mật khẩu không chính xác, hoặc tài khoản đã bị khóa!',
      });
      return;
    }

    // Kiểm tra tài khoản chưa kích hoạt (Chỉ áp dụng cho tài khoản cư dân mới tạo chưa kích hoạt qua OTP)
    const isUnactivated = (user as any).isActivated === false || user.passwordHash.startsWith('!UNACTIVATED_');
    if (isUnactivated) {
      res.status(403).json({
        success: false,
        isPendingActivation: true,
        email: user.email,
        phone: user.phone,
        message: 'Tài khoản chưa được kích hoạt. Vui lòng nhập mã OTP đã nhận qua email để thiết lập mật khẩu.',
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
        select: { id: true },
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
        tokenVersion: (user as any).tokenVersion ?? 0,
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
      select: { id: true },
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

// ============================================================================
// 5. POST /api/auth/otp/request-activation - Yêu cầu gửi lại OTP kích hoạt tài khoản cư dân
// ============================================================================
router.post('/otp/request-activation', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phone } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

    if (!cleanEmail && !cleanPhone) {
      res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp địa chỉ email hoặc số điện thoại để nhận mã OTP kích hoạt.',
      });
      return;
    }

    const user = await findUserForAuth(cleanEmail ? { email: cleanEmail } : { phone: cleanPhone });

    if (!user || user.role !== Role.RESIDENT) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài khoản cư dân với thông tin đã cung cấp.',
      });
      return;
    }

    if (!user.email) {
      res.status(400).json({
        success: false,
        message: 'Tài khoản chưa được thiết lập địa chỉ email. Vui lòng liên hệ Ban Quản lý BMB.',
      });
      return;
    }

    const isUnactivated = (user as any).isActivated === false || user.passwordHash.startsWith('!UNACTIVATED_');
    if (!isUnactivated) {
      res.status(400).json({
        success: false,
        message: 'Tài khoản này đã được kích hoạt từ trước. Quý cư dân vui lòng đăng nhập hoặc sử dụng Quên mật khẩu.',
      });
      return;
    }

    const { otp } = await createAndSaveOtp(user.email, 'ACCOUNT_ACTIVATION', 5);
    const mailResult = await safeSendOtpEmail(user.email, otp, 'ACCOUNT_ACTIVATION');

    if (!mailResult.success) {
      res.status(502).json({
        success: false,
        message: 'Dịch vụ gửi email hiện không khả dụng. Vui lòng thử lại sau giây lát hoặc liên hệ Ban Quản lý.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Mã xác thực OTP đã được gửi đến email của bạn. Mã có hiệu lực trong 5 phút.',
      email: user.email,
    });
  } catch (error: any) {
    if (error instanceof OtpServiceError) {
      res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
      return;
    }
    console.error('Lỗi khi yêu cầu gửi OTP kích hoạt:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi gửi mã OTP kích hoạt.' });
  }
});

// ============================================================================
// 6. POST /api/auth/otp/activate-account - Kích hoạt tài khoản và thiết lập mật khẩu cư dân
// ============================================================================
router.post('/otp/activate-account', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp, newPassword } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanOtp = typeof otp === 'string' ? otp.trim() : '';

    if (!cleanEmail || !cleanOtp || typeof newPassword !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ email, mã OTP và mật khẩu mới.',
      });
      return;
    }

    if (newPassword.length < 12 || newPassword.length > 128) {
      res.status(400).json({
        success: false,
        message: 'Mật khẩu mới phải có độ dài từ 12 đến 128 ký tự để đảm bảo an toàn.',
      });
      return;
    }

    const user = await findUserForAuth({ email: cleanEmail });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'Không tìm thấy tài khoản tương ứng với email này.',
      });
      return;
    }

    // Xác minh mã OTP (kiểm tra hạn 5 phút, giới hạn 5 lần sai, đánh dấu đã dùng)
    await verifyOtpCode(cleanEmail, cleanOtp, 'ACCOUNT_ACTIVATION');

    // Hash mật khẩu mới bằng Bcrypt
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Cập nhật trạng thái tài khoản: đã kích hoạt, tăng tokenVersion nếu có cột
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          isActivated: true,
          tokenVersion: { increment: 1 },
        } as any,
        select: { id: true },
      });
    } catch (updateErr: any) {
      if (
        updateErr?.code === 'P2021' ||
        updateErr?.code === 'P2022' ||
        String(updateErr?.message || '').includes('isActivated') ||
        String(updateErr?.message || '').includes('tokenVersion')
      ) {
        // Fallback: cập nhật passwordHash nếu cột chưa có
        await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash },
          select: { id: true },
        });
      } else {
        throw updateErr;
      }
    }

    res.status(200).json({
      success: true,
      message: 'Kích hoạt tài khoản thành công! Bạn có thể sử dụng mật khẩu mới để đăng nhập ngay bây giờ.',
    });
  } catch (error: any) {
    if (error instanceof OtpServiceError) {
      res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
      return;
    }
    console.error('Lỗi khi kích hoạt tài khoản:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi kích hoạt tài khoản.' });
  }
});

// ============================================================================
// 7. POST /api/auth/otp/request-reset - Yêu cầu OTP đặt lại mật khẩu (Anti-Enumeration)
// ============================================================================
router.post('/otp/request-reset', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp địa chỉ email hợp lệ.',
      });
      return;
    }

    // Thông điệp bảo mật chung chống rò rỉ danh sách tài khoản (Email Enumeration Mitigation)
    const genericSuccessMessage = 'Nếu địa chỉ email tồn tại trên hệ thống ResiFix, mã OTP đặt lại mật khẩu đã được gửi tới hòm thư của bạn.';

    const user = await findUserForAuth({ email: cleanEmail });

    if (user && user.isActive) {
      try {
        const { otp } = await createAndSaveOtp(cleanEmail, 'PASSWORD_RESET', 5);
        await safeSendOtpEmail(cleanEmail, otp, 'PASSWORD_RESET');
      } catch (err: any) {
        if (err instanceof OtpServiceError && err.code === 'OTP_COOLDOWN_ACTIVE') {
          res.status(429).json({ success: false, message: err.message, code: err.code });
          return;
        }
        console.warn('[AUTH] Không thể gửi OTP reset mật khẩu:', err);
      }
    }

    res.status(200).json({
      success: true,
      message: genericSuccessMessage,
    });
  } catch (error: any) {
    console.error('Lỗi khi yêu cầu đặt lại mật khẩu:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi xử lý yêu cầu đặt lại mật khẩu.' });
  }
});

// ============================================================================
// 8. POST /api/auth/otp/reset-password - Xác minh OTP và cập nhật mật khẩu mới
// ============================================================================
router.post('/otp/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp, newPassword } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanOtp = typeof otp === 'string' ? otp.trim() : '';

    if (!cleanEmail || !cleanOtp || typeof newPassword !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ email, mã OTP và mật khẩu mới.',
      });
      return;
    }

    if (newPassword.length < 12 || newPassword.length > 128) {
      res.status(400).json({
        success: false,
        message: 'Mật khẩu mới phải có độ dài từ 12 đến 128 ký tự để đảm bảo an toàn.',
      });
      return;
    }

    const user = await findUserForAuth({ email: cleanEmail });

    if (!user || !user.isActive) {
      res.status(400).json({
        success: false,
        message: 'Yêu cầu đặt lại mật khẩu không hợp lệ hoặc tài khoản đã bị khóa.',
      });
      return;
    }

    // Xác minh mã OTP
    await verifyOtpCode(cleanEmail, cleanOtp, 'PASSWORD_RESET');

    // Hash mật khẩu mới bằng Bcrypt
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Cập nhật mật khẩu và tăng tokenVersion nếu có
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
        } as any,
        select: { id: true },
      });
    } catch (updateErr: any) {
      if (
        updateErr?.code === 'P2021' ||
        updateErr?.code === 'P2022' ||
        String(updateErr?.message || '').includes('tokenVersion')
      ) {
        await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash },
          select: { id: true },
        });
      } else {
        throw updateErr;
      }
    }

    res.status(200).json({
      success: true,
      message: 'Đặt lại mật khẩu thành công! Tất cả các phiên làm việc trước đã được đăng xuất an toàn. Vui lòng đăng nhập lại.',
    });
  } catch (error: any) {
    if (error instanceof OtpServiceError) {
      res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
      return;
    }
    console.error('Lỗi khi đặt lại mật khẩu:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi đặt lại mật khẩu.' });
  }
});

export default router;
