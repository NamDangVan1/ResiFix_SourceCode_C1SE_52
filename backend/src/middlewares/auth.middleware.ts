import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

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
export const authenticateJWT = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Từ chối truy cập: Không tìm thấy mã xác thực (JWT Token). Vui lòng đăng nhập!',
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET || 'ResiFix_C1SE52_SuperSecretKey_2026';

  try {
    const decoded = jwt.verify(token, secret) as AuthRequest['user'];
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({
      success: false,
      message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại!',
    });
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