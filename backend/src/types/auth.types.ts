import { Request } from 'express';
import { Role } from '@prisma/client';

export interface AuthUserPayload {
  userId: string;
  phone: string;
  role: Role;
  fullName: string;
}

export interface AuthRequest extends Request {
  user?: AuthUserPayload;
}

export interface SafeUser {
  id: string;
  phone: string;
  email: string | null;
  passwordHash: string;
  fullName: string;
  avatarUrl: string | null;
  role: Role;
  isActive: boolean;
  apartmentCode: string | null;
  buildingBlock: string | null;
  floorNumber: number | null;
  specialty: string | null;
  specialtyLabel: string | null;
  shiftName: string | null;
  isOnDuty: boolean;
  fcmToken: string | null;
  isActivated?: boolean;
  mustChangePassword?: boolean;
  tokenVersion?: number;
  createdAt: Date;
  updatedAt: Date;
}

