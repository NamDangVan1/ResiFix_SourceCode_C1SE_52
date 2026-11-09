import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { prisma } from '../db';

// Mở rộng kiểu Request của Express để gắn thông tin User sau khi giải mã JWT
export interface AuthRequest extends Request {
  user?: {
    userId: string;
    phone: string;
    role: Role;
    fullName: string;
  };
}

// 1. Middleware xác thực JWT Token (Đáp ứng US-03, US-46, NFR02)
export const authenticateJWT = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Từ chối truy cập: Không tìm thấy mã xác thực (JWT Token). Vui lòng đăng nhập!',
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(503).json({ success: false, message: 'Dịch vụ xác thực chưa được cấu hình.' });
    return;
  }

  let decoded: jwt.JwtPayload;
  try {
    const payload = jwt.verify(token, secret);
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof payload.userId !== 'string' ||
      !Object.values(Role).includes(payload.role as Role)
    ) {
      res.status(401).json({
        success: false,
        message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại!',
      });
      return;
    }
    decoded = payload;
  } catch {
    res.status(401).json({
      success: false,
      message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại!',
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId as string },
      select: { id: true, phone: true, role: true, fullName: true, isActive: true },
    });
    if (!user || !user.isActive || (user as any).isActivated === false || user.role !== decoded.role) {
      res.status(401).json({ success: false, message: 'Tài khoản chưa được kích hoạt hoặc không còn hoạt động. Vui lòng đăng nhập lại!' });
      return;
    }

    if (decoded.tokenVersion !== undefined) {
      try {
        const userExtra = await prisma.user.findUnique({
          where: { id: decoded.userId as string },
          select: { id: true, tokenVersion: true } as any,
        });
        if (
          userExtra &&
          (userExtra as any).tokenVersion !== undefined &&
          decoded.tokenVersion !== (userExtra as any).tokenVersion
        ) {
          res.status(401).json({
            success: false,
            message: 'Phiên đăng nhập đã hết hạn do mật khẩu đã được thay đổi. Vui lòng đăng nhập lại!',
          });
          return;
        }
      } catch {
        // Bỏ qua nếu cột tokenVersion chưa tồn tại trên database
      }
    }

    req.user = {
      userId: user.id,
      phone: user.phone,
      role: user.role,
      fullName: user.fullName,
    };
    next();
  } catch {
    res.status(503).json({ success: false, message: 'Không thể xác minh phiên đăng nhập lúc này.' });
  }
};

// 2. Middleware Phân quyền theo Vai trò - RBAC (Đáp ứng FR01, US-04)
export const authorizeRoles = (...allowedRoles: Role[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Chưa xác thực người dùng!' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: `Quyền truy cập bị từ chối: Chức năng này chỉ dành cho vai trò [${allowedRoles.join(', ')}]. Vai trò hiện tại của bạn là [${req.user.role}].`,
      });
      return;
    }

    next();
  };
};
