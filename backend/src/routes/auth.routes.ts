import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../db';
import { createAndSaveOtp, verifyOtpCode, OtpServiceError } from '../services/otp.service';
import { safeSendOtpEmail } from '../services/mail.service';

const router = Router();

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length <= 2 ? name[0] + '***' : name[0] + '***' + name.slice(-1);
  return `${maskedName}@${domain}`;
}

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

async function findUserForAuth(where: any) {
  try {
    const user = await prisma.user.findFirst({
      where,
      select: {
        ...SAFE_USER_SELECT,
        isActivated: true,
        tokenVersion: true,
        mustChangePassword: true,
      },
    });
    return user;
  } catch (err: any) {
    const fallbackUser = await prisma.user.findFirst({
      where,
      select: SAFE_USER_SELECT,
    });
    if (!fallbackUser) return null;
    return {
      ...fallbackUser,
      isActivated: true,
      tokenVersion: 0,
      mustChangePassword: false,
    };
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
        { email: { equals: loginInput.toLowerCase(), mode: 'insensitive' } },
      ],
    });

    if (!user) {
      res.status(401).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'Email/SĐT hoặc mật khẩu không chính xác',
      });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({
        success: false,
        code: 'ACCOUNT_DISABLED',
        message: 'Tài khoản đã bị khóa. Vui lòng liên hệ BMB',
      });
      return;
    }

    // So sánh mật khẩu mã hóa Bcrypt
    const isTempUnactivated = user.passwordHash.startsWith('!UNACTIVATED_');
    const isPasswordValid = isTempUnactivated ? true : await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Email/SĐT hoặc mật khẩu không chính xác',
      });
      return;
    }

    // Kiểm tra tài khoản chưa kích hoạt (Áp dụng cho Cư dân, Kỹ thuật viên, BMB)
    const isUnactivated = (user as any).isActivated === false || isTempUnactivated;
    if (isUnactivated) {
      let emailSent = false;
      if (user.email) {
        try {
          const { otp } = await createAndSaveOtp(user.email, 'ACCOUNT_ACTIVATION', 5);
          const mailResult = await safeSendOtpEmail(user.email, otp, 'ACCOUNT_ACTIVATION', user.role);
          emailSent = mailResult.success;
        } catch (otpErr: any) {
          if (otpErr?.code === 'OTP_COOLDOWN_ACTIVE') {
            emailSent = true;
          }
        }
      }

      res.status(403).json({
        success: false,
        isPendingActivation: true,
        code: 'ACCOUNT_NOT_ACTIVATED',
        role: user.role,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        emailSent,
        user: {
          id: user.id,
          role: user.role,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
        },
        message: 'Tài khoản chưa kích hoạt. Vui lòng xác thực OTP',
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

    const mustChangePassword = Boolean((user as any).mustChangePassword);

    const token = jwt.sign(
      {
        userId: user.id,
        phone: user.phone,
        role: user.role,
        fullName: user.fullName,
        tokenVersion: (user as any).tokenVersion ?? 0,
        mustChangePassword,
      },
      secret,
      { expiresIn: '7d' }
    );

    // Ẩn passwordHash trước khi trả về Client (US-05 Acceptance Criteria)
    const { passwordHash, ...safeUserData } = user;

    res.status(200).json({
      success: true,
      message: mustChangePassword
        ? 'Đăng nhập thành công! Vui lòng đổi mật khẩu mới ở lần đăng nhập đầu tiên để bảo vệ tài khoản.'
        : `Đăng nhập thành công! Chào mừng ${user.fullName} (${user.role})`,
      token,
      mustChangePassword,
      user: {
        ...safeUserData,
        mustChangePassword,
      }, // Client sẽ đọc user.role để tự mở giao diện Resident / Technician / BMB
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
// 1b. POST /api/auth/change-password-first-login - Đổi mật khẩu lần đầu (bắt buộc)
// ============================================================================
router.post('/change-password-first-login', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const cleanCur = typeof currentPassword === 'string' ? currentPassword : '';
    const cleanNew = typeof newPassword === 'string' ? newPassword : '';

    if (!cleanCur || !cleanNew) {
      res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp mật khẩu hiện tại và mật khẩu mới.',
      });
      return;
    }

    if (cleanNew.length < 6 || cleanNew.length > 128) {
      res.status(400).json({
        success: false,
        message: 'Mật khẩu mới phải có độ dài từ 6 đến 128 ký tự để đảm bảo an toàn.',
      });
      return;
    }

    if (cleanCur === cleanNew) {
      res.status(400).json({
        success: false,
        message: 'Mật khẩu mới không được trùng với mật khẩu tạm thời hiện tại.',
      });
      return;
    }

    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Phiên làm việc không hợp lệ.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: SAFE_USER_SELECT,
    });

    if (!user || !user.isActive) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản người dùng hoặc tài khoản đã bị khóa.' });
      return;
    }

    const isMatch = await bcrypt.compare(cleanCur, user.passwordHash);
    if (!isMatch) {
      res.status(400).json({
        success: false,
        message: 'Mật khẩu hiện tại không chính xác. Vui lòng kiểm tra lại.',
      });
      return;
    }

    const newHash = await bcrypt.hash(cleanNew, 10);

    let updatedUser: any;
    try {
      updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: newHash,
          mustChangePassword: false,
          tokenVersion: { increment: 1 },
        } as any,
        select: SAFE_USER_SELECT,
      });
    } catch {
      updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: newHash,
        },
        select: SAFE_USER_SELECT,
      });
    }



    const secret = process.env.JWT_SECRET!;
    const newToken = jwt.sign(
      {
        userId: user.id,
        phone: user.phone,
        role: user.role,
        fullName: user.fullName,
        tokenVersion: ((req.user as any)?.tokenVersion ?? 0) + 1,
        mustChangePassword: false,
      },
      secret,
      { expiresIn: '7d' }
    );

    const { passwordHash, ...safeUserData } = updatedUser;

    res.status(200).json({
      success: true,
      message: 'Đổi mật khẩu thành công! Tài khoản của bạn đã được cập nhật an toàn.',
      token: newToken,
      mustChangePassword: false,
      user: {
        ...safeUserData,
        mustChangePassword: false,
      },
    });
  } catch (error) {
    console.error('Lỗi khi đổi mật khẩu lần đầu:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi đổi mật khẩu lần đầu.' });
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
// 5. POST /api/auth/otp/request-activation - Yêu cầu gửi lại OTP kích hoạt tài khoản cư dân / KTV
// ============================================================================
router.post('/otp/request-activation', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phone, identifier } = req.body || {};
    const rawInput = typeof identifier === 'string' ? identifier : typeof email === 'string' ? email : typeof phone === 'string' ? phone : '';
    const cleanInput = rawInput.trim();

    if (!cleanInput) {
      res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp địa chỉ email hoặc số điện thoại để nhận mã OTP kích hoạt.',
      });
      return;
    }

    const user = await findUserForAuth({
      OR: [
        { phone: cleanInput },
        { email: { equals: cleanInput.toLowerCase(), mode: 'insensitive' } },
        ...(email && typeof email === 'string' ? [{ email: { equals: email.trim().toLowerCase(), mode: 'insensitive' } }] : []),
        ...(phone && typeof phone === 'string' ? [{ phone: phone.trim() }] : []),
      ],
    });

    if (!user || (user.role !== Role.RESIDENT && user.role !== Role.TECHNICIAN && user.role !== Role.BMB)) {
      res.status(404).json({
        success: false,
        code: 'ACCOUNT_NOT_FOUND',
        message: cleanInput.includes('@')
          ? 'Không tìm thấy tài khoản với email này'
          : 'Không tìm thấy tài khoản tương ứng',
      });
      return;
    }

    if (!user.email) {
      res.status(400).json({
        success: false,
        code: 'EMAIL_MISSING',
        message: 'Email không khớp với tài khoản đã đăng ký',
      });
      return;
    }

    const isUnactivated = (user as any).isActivated === false || user.passwordHash.startsWith('!UNACTIVATED_');
    if (!isUnactivated) {
      res.status(400).json({
        success: false,
        message: 'Tài khoản này đã được kích hoạt từ trước. Vui lòng đăng nhập hoặc sử dụng Quên mật khẩu.',
      });
      return;
    }

    const { otp } = await createAndSaveOtp(user.email, 'ACCOUNT_ACTIVATION', 5);
    const mailResult = await safeSendOtpEmail(user.email, otp, 'ACCOUNT_ACTIVATION', user.role);

    if (!mailResult.success) {
      console.error('[OTP_ACTIVATION_MAIL_ERROR]', mailResult.error || 'Failed to send OTP email');
      res.status(502).json({
        success: false,
        emailSent: false,
        message: 'Không thể gửi mã OTP. Vui lòng thử lại',
      });
      return;
    }

    res.status(200).json({
      success: true,
      emailSent: true,
      message: 'Mã OTP mới đã được gửi đến email của bạn',
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      user: {
        id: user.id,
        role: user.role,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (error: any) {
    if (error instanceof OtpServiceError) {
      if (error.code === 'OTP_COOLDOWN_ACTIVE') {
        res.status(429).json({
          success: false,
          code: 'OTP_COOLDOWN_ACTIVE',
          message: 'Vui lòng đợi trước khi gửi lại mã OTP',
        });
        return;
      }
      res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
      return;
    }
    console.error('Lỗi khi yêu cầu gửi OTP kích hoạt:', error);
    res.status(500).json({ success: false, message: 'Không thể gửi mã OTP. Vui lòng thử lại' });
  }
});

// ============================================================================
// 6. POST /api/auth/otp/activate-account - Kích hoạt tài khoản và thiết lập mật khẩu cư dân / KTV
// ============================================================================
router.post('/otp/activate-account', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanOtp = typeof otp === 'string' ? otp.trim() : '';

    if (!cleanEmail || !cleanOtp || typeof newPassword !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ email, mã OTP và mật khẩu mới.',
      });
      return;
    }

    if (typeof confirmPassword === 'string' && newPassword !== confirmPassword) {
      res.status(400).json({
        success: false,
        code: 'CONFIRM_PASSWORD_MISMATCH',
        message: 'Mật khẩu xác nhận không trùng khớp',
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        code: 'PASSWORD_TOO_SHORT',
        message: 'Mật khẩu phải có ít nhất 6 ký tự',
      });
      return;
    }

    if (newPassword.length > 128) {
      res.status(400).json({
        success: false,
        code: 'PASSWORD_TOO_LONG',
        message: 'Mật khẩu không được vượt quá 128 ký tự',
      });
      return;
    }

    const user = await findUserForAuth({ email: { equals: cleanEmail, mode: 'insensitive' } });

    if (!user) {
      res.status(404).json({
        success: false,
        code: 'EMAIL_MISMATCH',
        message: 'Email không khớp với tài khoản đã đăng ký',
      });
      return;
    }

    // Xác minh mã OTP (kiểm tra hạn 5 phút, giới hạn 5 lần sai, đánh dấu đã dùng)
    await verifyOtpCode(cleanEmail, cleanOtp, 'ACCOUNT_ACTIVATION');

    // Hash mật khẩu mới bằng Bcrypt
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Cập nhật trạng thái tài khoản: đã kích hoạt, mustChangePassword = false, tăng tokenVersion
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          isActivated: true,
          mustChangePassword: false,
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
      role: user.role,
      fullName: user.fullName,
      user: {
        id: user.id,
        role: user.role,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
      },
      message: 'Kích hoạt tài khoản thành công',
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
// Hỗ trợ nhập Email hoặc Số điện thoại của tài khoản
// ============================================================================
router.post('/otp/request-reset', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phone, identifier } = req.body || {};
    const rawInput = typeof identifier === 'string' ? identifier : typeof email === 'string' ? email : typeof phone === 'string' ? phone : '';
    const cleanInput = rawInput.trim();

    if (!cleanInput) {
      res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp số điện thoại hoặc email đã đăng ký.',
      });
      return;
    }

    // Thông điệp bảo mật chung chống rò rỉ danh sách tài khoản (Email Enumeration Mitigation)
    const genericSuccessMessage = 'Nếu thông tin hợp lệ và tồn tại trên hệ thống ResiFix, mã OTP đặt lại mật khẩu đã được gửi tới email đăng ký của bạn.';

    const user = await findUserForAuth({
      OR: [
        { phone: cleanInput },
        { email: cleanInput.toLowerCase() },
      ],
    });

    let maskedEmail: string | undefined;

    if (user && user.isActive && user.email) {
      // Quên mật khẩu chỉ dùng cho tài khoản đã kích hoạt (isActivated === true)
      const isUnactivated = (user as any).isActivated === false || user.passwordHash.startsWith('!UNACTIVATED_');
      if (isUnactivated) {
        res.status(400).json({
          success: false,
          code: 'ACCOUNT_NOT_ACTIVATED',
          message: 'Tài khoản chưa được kích hoạt. Vui lòng kích hoạt tài khoản bằng mã OTP gửi về email thay vì đặt lại mật khẩu.',
        });
        return;
      }

      try {
        const { otp } = await createAndSaveOtp(user.email, 'PASSWORD_RESET', 5);
        await safeSendOtpEmail(user.email, otp, 'PASSWORD_RESET');
        maskedEmail = maskEmail(user.email);
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
      maskedEmail,
    });
  } catch (error: any) {
    console.error('Lỗi khi yêu cầu đặt lại mật khẩu:', error);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống khi xử lý yêu cầu đặt lại mật khẩu.' });
  }
});

// ============================================================================
// 8. POST /api/auth/otp/reset-password - Xác minh OTP và cập nhật mật khẩu mới
// Hỗ trợ xác minh qua Email hoặc Số điện thoại
// ============================================================================
router.post('/otp/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, phone, identifier, otp, newPassword } = req.body || {};
    const rawInput = typeof identifier === 'string' ? identifier : typeof email === 'string' ? email : typeof phone === 'string' ? phone : '';
    const cleanInput = rawInput.trim();
    const cleanOtp = typeof otp === 'string' ? otp.trim() : '';

    if (!cleanInput || !cleanOtp || typeof newPassword !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ email (hoặc số điện thoại), mã OTP và mật khẩu mới.',
      });
      return;
    }

    if (newPassword.length < 6 || newPassword.length > 128) {
      res.status(400).json({
        success: false,
        message: 'Mật khẩu mới phải có độ dài từ 6 đến 128 ký tự để đảm bảo an toàn.',
      });
      return;
    }

    const user = await findUserForAuth({
      OR: [
        { phone: cleanInput },
        { email: cleanInput.toLowerCase() },
      ],
    });

    if (!user || !user.isActive || !user.email) {
      res.status(400).json({
        success: false,
        message: 'Yêu cầu đặt lại mật khẩu không hợp lệ hoặc tài khoản đã bị khóa.',
      });
      return;
    }

    // Xác minh mã OTP gắn với email của người dùng (chỉ dùng được một lần)
    await verifyOtpCode(user.email, cleanOtp, 'PASSWORD_RESET');

    // Hash mật khẩu mới bằng Bcrypt
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Cập nhật mật khẩu, xóa cờ mustChangePassword và tăng tokenVersion để vô hiệu các phiên cũ
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          tokenVersion: { increment: 1 },
        } as any,
        select: { id: true },
      });
    } catch {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
        select: { id: true },
      });
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
