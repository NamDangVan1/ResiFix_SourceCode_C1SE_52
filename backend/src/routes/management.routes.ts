import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { Prisma, Role, TicketStatus } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../db';
import { ResidencyRecord } from '../data/resifix_store';
import { createAndSaveOtp } from '../services/otp.service';
import { safeSendOtpEmail } from '../services/mail.service';

const router = Router();

function generateSecureTemporaryPassword(length = 10): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;

  let pwd = '';
  pwd += upper[crypto.randomInt(0, upper.length)];
  pwd += lower[crypto.randomInt(0, lower.length)];
  pwd += digits[crypto.randomInt(0, digits.length)];

  for (let i = 3; i < length; i++) {
    pwd += all[crypto.randomInt(0, all.length)];
  }

  // Fisher-Yates shuffle
  const arr = pwd.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

const getParamAsString = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || '';
  return String(param || '');
};

// ============================================================================
// 1. LIÊN HỆ QUẢN LÝ KHẨN CẤP
// ============================================================================
// GET /api/management/emergency-contact (Cư dân & BMB đều xem được)
router.get('/emergency-contact', authenticateJWT, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    let contact = {
      managerName: 'Ban Quản Lý ResiFix',
      managerPhone: '0901234567',
    };
    try {
      const setting = await prisma.systemSetting.findUnique({ where: { key: 'emergency_contact' } });
      if (setting && setting.value) {
        contact = setting.value as any;
      }
    } catch (dbErr) {
      console.warn('Lỗi đọc emergency_contact từ DB:', dbErr);
    }
    res.status(200).json({
      success: true,
      emergencyContact: contact,
    });
  } catch (error) {
    console.error('Lỗi khi lấy thông tin liên hệ khẩn cấp:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi lấy thông tin liên hệ khẩn cấp.' });
  }
});

// PATCH /api/management/emergency-contact (Chỉ BMB có quyền chỉnh sửa)
router.patch(
  '/emergency-contact',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { managerName, managerPhone } = req.body || {};
      const cleanName = typeof managerName === 'string' ? managerName.trim() : '';
      const cleanPhone = typeof managerPhone === 'string' ? managerPhone.replace(/[^\d]/g, '').slice(0, 10) : '';

      if (cleanName.length < 2 || cleanName.length > 100) {
        res.status(400).json({ success: false, message: 'Họ tên người phụ trách phải từ 2 đến 100 ký tự.' });
        return;
      }
      if (!/^0\d{9}$/.test(cleanPhone)) {
        res.status(400).json({ success: false, message: 'Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0.' });
        return;
      }

      const contactData = { managerName: cleanName, managerPhone: cleanPhone };

      // Lưu vào PostgreSQL Neon qua Prisma
      await prisma.systemSetting.upsert({
        where: { key: 'emergency_contact' },
        create: { key: 'emergency_contact', value: contactData },
        update: { value: contactData },
      });

      console.log(`[AUDIT] BMB (${req.user?.fullName}) đã cập nhật liên hệ khẩn cấp: ${cleanName} - ${cleanPhone}`);

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật liên hệ quản lý khẩn cấp.',
        emergencyContact: contactData,
      });
    } catch (error) {
      console.error('Lỗi khi cập nhật liên hệ khẩn cấp:', error);
      res.status(500).json({ success: false, message: 'Không thể cập nhật liên hệ khẩn cấp.' });
    }
  }
);

// ============================================================================
// 2. QUẢN LÝ CƯ DÂN & TÀI KHOẢN (BMB ONLY)
// ============================================================================
// GET /api/management/residents - Danh sách cư dân (tìm kiếm, lọc)
router.get(
  '/residents',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const reqId = crypto.randomBytes(4).toString('hex');
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const block = typeof req.query.block === 'string' ? req.query.block.trim() : '';
      console.log(`[MANAGEMENT_AUDIT][${reqId}][${new Date().toISOString()}] GET /api/management/residents - query: block="${block}", searchApplied=${Boolean(search)}`);

      const includeInactive = req.query.includeInactive === 'true';
      const activeCondition = includeInactive ? {} : { isActive: true };

      // Cư dân bao gồm user có role RESIDENT HOẶC bất kỳ user nào được gán mã căn hộ (apartmentCode != null)
      const roleOrAptCondition = {
        AND: [
          activeCondition,
          {
            OR: [
              { role: Role.RESIDENT },
              { apartmentCode: { not: null } },
            ],
          },
        ],
      };

      const where: any = block
        ? { AND: [roleOrAptCondition, { buildingBlock: block }] }
        : { ...roleOrAptCondition };

      if (search) {
        const searchCondition = {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { apartmentCode: { contains: search, mode: 'insensitive' } },
          ],
        };
        where.AND = where.AND ? [...where.AND, searchCondition] : [roleOrAptCondition, searchCondition];
      }

      const residents = await prisma.user.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          role: true,
          apartmentCode: true,
          buildingBlock: true,
          floorNumber: true,
          isActive: true,
          isActivated: true,
          createdAt: true,
        },
        orderBy: [{ apartmentCode: 'asc' }, { fullName: 'asc' }],
      });

      console.log(`[MANAGEMENT_AUDIT][${reqId}][${new Date().toISOString()}] GET /api/management/residents - returned ${residents.length} records`);

      const allHistories = await prisma.residencyRecord.findMany({
        orderBy: { createdAt: 'desc' },
      });

      // Ghép thông tin người đại diện và ngày vào từ lịch sử cư trú mới nhất
      const enhancedResidents = residents.map((r) => {
        const matchingHistory = allHistories.filter((h: any) => {
          const idMatch = h.residentId && h.residentId === r.id;
          const phoneMatch = (h.phone && h.phone === r.phone) || (h.residentPhone && h.residentPhone === r.phone);
          const aptMatch = !r.apartmentCode || h.apartmentCode === r.apartmentCode;
          return (idMatch || phoneMatch) && aptMatch;
        });

        const history = matchingHistory.length > 0
          ? matchingHistory[0]
          : allHistories.find((h: any) => {
              const idMatch = h.residentId && h.residentId === r.id;
              const phoneMatch = (h.phone && h.phone === r.phone) || (h.residentPhone && h.residentPhone === r.phone);
              return idMatch || phoneMatch;
            });

        const role = history?.residencyRole || (history?.isRepresentative ? 'OWNER' : 'TENANT');
        const moveInStr = history?.moveInDate instanceof Date
          ? history.moveInDate.toISOString().slice(0, 10)
          : history?.moveInDate ?? r.createdAt.toISOString().slice(0, 10);
        const moveOutStr = history?.moveOutDate instanceof Date
          ? history.moveOutDate.toISOString().slice(0, 10)
          : history?.moveOutDate ?? null;

        return {
          ...r,
          isActivated: r.isActivated ?? true,
          residencyRole: role,
          isRepresentative: history?.isRepresentative ?? (role === 'OWNER'),
          moveInDate: moveInStr,
          moveOutDate: moveOutStr,
        };
      });

      res.status(200).json({ success: true, residents: enhancedResidents });
    } catch (error) {
      console.error('Lỗi khi lấy danh sách cư dân:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách cư dân.' });
    }
  }
);

// POST /api/management/residents - Thêm mới cư dân & gán phòng
router.post(
  '/residents',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const postReqId = crypto.randomBytes(4).toString('hex');
    try {
      const {
        fullName,
        phone,
        email,
        apartmentCode,
        buildingBlock,
        floorNumber,
        residencyRole,
        moveInDate,
        moveOutDate,
      } = req.body || {};

      const cleanName = typeof fullName === 'string' ? fullName.trim() : '';
      const digitsOnly = typeof phone === 'string' ? phone.replace(/[^\d]/g, '') : '';
      const rawEmail = typeof email === 'string' ? email.trim() : '';
      const cleanEmail = rawEmail ? rawEmail.toLowerCase() : null;

      // 1. Kiểm tra họ tên và số điện thoại
      if (cleanName.length < 2 || !/^0\d{9}$/.test(digitsOnly)) {
        res.status(400).json({
          success: false,
          message: 'Họ tên cư dân tối thiểu 2 ký tự và số điện thoại phải gồm đúng 10 chữ số (bắt đầu bằng số 0).',
        });
        return;
      }
      const cleanPhone = digitsOnly;

      // 2. Kiểm tra định dạng email (nếu có cung cấp)
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        res.status(400).json({
          success: false,
          message: 'Vui lòng nhập địa chỉ email hợp lệ.',
        });
        return;
      }

      const cleanApt = typeof apartmentCode === 'string' && apartmentCode.trim() ? apartmentCode.trim().toUpperCase() : 'G101';
      let cleanBlock = typeof buildingBlock === 'string' && buildingBlock.trim() ? buildingBlock.trim() : '';
      let cleanFloor = Number.isInteger(Number(floorNumber)) ? Number(floorNumber) : 0;

      // Tự động nhận diện Tòa và Tầng từ mã căn hộ 75 phòng (G101..G505, F101..F505, E101..E505)
      const aptMatch = cleanApt.match(/^([GFE])([1-5])(\d{2})$/);
      if (aptMatch) {
        if (!cleanBlock || cleanBlock === 'Tòa S1') cleanBlock = `Tòa ${aptMatch[1]}`;
        if (!cleanFloor) cleanFloor = parseInt(aptMatch[2], 10);
      }
      if (!cleanBlock) cleanBlock = 'Tòa G';
      if (!cleanFloor) cleanFloor = 1;
      const validRoles = ['OWNER', 'TENANT', 'MEMBER'];
      const rawRole = typeof residencyRole === 'string' ? residencyRole.toUpperCase() : 'TENANT';
      const cleanResidencyRole = validRoles.includes(rawRole) ? (rawRole as 'OWNER' | 'TENANT' | 'MEMBER') : 'TENANT';
      const isRepresentative = cleanResidencyRole === 'OWNER';
      const cleanMoveIn = typeof moveInDate === 'string' && moveInDate ? moveInDate : new Date().toISOString().slice(0, 10);
      const cleanMoveOut = typeof moveOutDate === 'string' && moveOutDate ? moveOutDate : null;

      // 3. Kiểm tra xem người dùng đã tồn tại trong hệ thống chưa (theo SĐT hoặc Email)
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { phone: cleanPhone },
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
          ],
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          role: true,
          apartmentCode: true,
          buildingBlock: true,
          floorNumber: true,
          isActive: true,
          isActivated: true,
          createdAt: true,
        },
      });

      // TRƯỜNG HỢP 1: CƯ DÂN ĐÃ CÓ TÀI KHOẢN TRONG HỆ THỐNG
      // -> Liên kết vào căn hộ mới hoặc kích hoạt lại tài khoản mà không tạo tài khoản User trùng lặp
      if (existingUser) {
        if (existingUser.apartmentCode === cleanApt && existingUser.isActive) {
          res.status(409).json({
            success: false,
            message: `Người dùng ${existingUser.fullName} (${existingUser.phone}) hiện đã được liên kết với căn hộ ${cleanApt} và đang hoạt động.`,
          });
          return;
        }

        const updatedUser = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            fullName: cleanName || existingUser.fullName,
            ...(cleanEmail && !existingUser.email ? { email: cleanEmail } : {}),
            role: existingUser.role === Role.BMB ? Role.BMB : Role.RESIDENT,
            apartmentCode: cleanApt,
            buildingBlock: cleanBlock,
            floorNumber: cleanFloor,
            isActive: true, // Kích hoạt trạng thái hoạt động để hiển thị ngay trong danh sách cư dân & căn hộ
            ...((!existingUser.isActivated && !(cleanEmail || existingUser.email)) ? { isActivated: true } : {}),
          },
          select: {
            id: true,
            fullName: true,
            phone: true,
            email: true,
            role: true,
            apartmentCode: true,
            buildingBlock: true,
            floorNumber: true,
            isActive: true,
            isActivated: true,
            createdAt: true,
          },
        });

        // Đảm bảo Apartment tồn tại trong PostgreSQL
        let apt = await prisma.apartment.findFirst({ where: { apartmentCode: cleanApt } });
        if (!apt) {
          apt = await prisma.apartment.create({
            data: {
              apartmentCode: cleanApt,
              buildingBlock: cleanBlock,
              floorNumber: cleanFloor,
              roomQrCode: `ROOM:${cleanApt}`,
              status: 'OCCUPIED',
            },
          });
        }

        if (isRepresentative) {
          await prisma.residencyRecord.updateMany({
            where: { apartmentCode: cleanApt, moveOutDate: null },
            data: { isRepresentative: false },
          });
        }

        // Ghi nhận lịch sử cư trú vào PostgreSQL qua Prisma
        await prisma.residencyRecord.create({
          data: {
            id: `res-rec-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
            residentId: updatedUser.id,
            residentName: updatedUser.fullName,
            residentPhone: updatedUser.phone,
            apartmentId: apt.id,
            apartmentCode: cleanApt,
            buildingBlock: cleanBlock,
            floorNumber: cleanFloor,
            residencyRole: cleanResidencyRole,
            moveInDate: cleanMoveIn ? new Date(cleanMoveIn) : new Date(),
            moveOutDate: cleanMoveOut ? new Date(cleanMoveOut) : null,
            isRepresentative,
          },
        });

        console.log(`[MANAGEMENT_AUDIT][${postReqId}][${new Date().toISOString()}] POST /api/management/residents - LINK_EXISTING residentId: ${existingUser.id}, apartment: ${cleanApt}, phoneSuffix: ***${cleanPhone.slice(-4)}`);

        res.status(200).json({
          success: true,
          isExistingUser: true,
          temporaryPassword: null,
          message: `Cư dân ${existingUser.fullName} đã có tài khoản trên hệ thống. Đã liên kết thành công vào căn hộ ${cleanApt} mà không tạo tài khoản trùng lặp.`,
          resident: {
            ...updatedUser,
            residencyRole: cleanResidencyRole,
            isRepresentative,
            moveInDate: cleanMoveIn,
            moveOutDate: cleanMoveOut,
          },
        });
        return;
      }

      // TRƯỜNG HỢP 2: CƯ DÂN MỚI CHƯA CÓ TÀI KHOẢN
      // -> Tạo tài khoản RESIDENT, sinh mật khẩu tạm thời ngẫu nhiên và yêu cầu đổi mật khẩu ở lần đầu
      const temporaryPassword = generateSecureTemporaryPassword(10);
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);

      const baseUserData: any = {
        fullName: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        passwordHash,
        role: Role.RESIDENT,
        apartmentCode: cleanApt,
        buildingBlock: cleanBlock,
        floorNumber: cleanFloor,
        isActive: true,
      };

      const shouldRequireActivation = Boolean(cleanEmail);

      const newResident = await prisma.user.create({
        data: {
          ...baseUserData,
          isActivated: !shouldRequireActivation, // Nếu có email thì bắt buộc kích hoạt qua OTP
          mustChangePassword: true, // Bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          role: true,
          apartmentCode: true,
          buildingBlock: true,
          floorNumber: true,
          isActive: true,
          isActivated: true,
          createdAt: true,
        },
      });

      // Sinh mã OTP kích hoạt 6 chữ số (hiệu lực 5 phút) và gửi email nếu có email
      let emailSent = false;
      let emailMessage = '';
      if (cleanEmail) {
        try {
          const { otp } = await createAndSaveOtp(cleanEmail, 'ACCOUNT_ACTIVATION', 5);
          const mailResult = await safeSendOtpEmail(cleanEmail, otp, 'ACCOUNT_ACTIVATION', Role.RESIDENT);
          emailSent = mailResult.success;
          if (!mailResult.success) {
            console.error('[RESIDENT_CREATE_OTP_MAIL_ERROR]', mailResult.error || 'Failed to send activation email');
            emailMessage = 'Tài khoản đã tạo nhưng chưa thể gửi email OTP (lỗi kết nối SMTP). Cư dân có thể bấm "Gửi lại mã OTP" trên màn hình kích hoạt.';
          }
        } catch (otpErr: any) {
          console.warn('[RESIDENT_CREATE_OTP_WARN]', otpErr?.message);
          emailMessage = 'Tài khoản đã tạo nhưng gửi OTP thất bại. Cư dân có thể bấm "Gửi lại mã OTP" khi đăng nhập.';
        }
      }

      // Đảm bảo Apartment tồn tại trong PostgreSQL
      let apt = await prisma.apartment.findFirst({ where: { apartmentCode: cleanApt } });
      if (!apt) {
        apt = await prisma.apartment.create({
          data: {
            apartmentCode: cleanApt,
            buildingBlock: cleanBlock,
            floorNumber: cleanFloor,
            roomQrCode: `ROOM:${cleanApt}`,
            status: 'OCCUPIED',
          },
        });
      }

      if (isRepresentative) {
        await prisma.residencyRecord.updateMany({
          where: { apartmentCode: cleanApt, moveOutDate: null },
          data: { isRepresentative: false },
        });
      }

      // Ghi nhận lịch sử cư trú vào PostgreSQL qua Prisma
      await prisma.residencyRecord.create({
        data: {
          id: `res-rec-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          residentId: newResident.id,
          residentName: newResident.fullName,
          residentPhone: newResident.phone,
          apartmentId: apt.id,
          apartmentCode: cleanApt,
          buildingBlock: cleanBlock,
          floorNumber: cleanFloor,
          residencyRole: cleanResidencyRole,
          moveInDate: cleanMoveIn ? new Date(cleanMoveIn) : new Date(),
          moveOutDate: cleanMoveOut ? new Date(cleanMoveOut) : null,
          isRepresentative,
        },
      });

      // Ghi audit log an toàn (TUYỆT ĐỐI KHÔNG GHI MẬT KHẨU TẠM HOẶC SĐT ĐẦY ĐỦ VÀO LOG)
      console.log(`[MANAGEMENT_AUDIT][${postReqId}][${new Date().toISOString()}] POST /api/management/residents - CREATE_NEW residentId: ${newResident.id}, apartment: ${cleanApt}, phoneSuffix: ***${cleanPhone.slice(-4)}`);

      res.status(201).json({
        success: true,
        isExistingUser: false,
        emailSent,
        temporaryPassword, // Trả về cho BMB để bàn giao nếu cư dân không dùng email
        message: cleanEmail
          ? (emailSent
              ? `Đã tạo tài khoản cư dân ${cleanName} và gửi mã OTP kích hoạt đến email ${cleanEmail}.`
              : emailMessage)
          : 'Đã tạo tài khoản cư dân thành công! Vui lòng lưu lại mật khẩu tạm thời để bàn giao cho cư dân.',
        resident: {
          ...newResident,
          residencyRole: cleanResidencyRole,
          isRepresentative,
          moveInDate: cleanMoveIn,
          moveOutDate: cleanMoveOut,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target)
          ? (error.meta.target as string[]).join(', ')
          : String(error.meta?.target || '');
        if (target.includes('phone')) {
          res.status(409).json({ success: false, message: 'Số điện thoại này đã được đăng ký tài khoản trong hệ thống.' });
          return;
        }
        if (target.includes('email')) {
          res.status(409).json({ success: false, message: 'Địa chỉ email này đã được sử dụng cho một tài khoản khác.' });
          return;
        }
        res.status(409).json({ success: false, message: 'Thông tin cư dân bị trùng lặp với dữ liệu đã có trong hệ thống.' });
        return;
      }
      console.error('Lỗi khi thêm cư dân:', error);
      res.status(500).json({ success: false, message: 'Không thể tạo tài khoản cư dân lúc này.' });
    }
  }
);

// PATCH /api/management/residents/:id - Cập nhật thông tin cư dân
router.patch(
  '/residents/:id',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const residentId = getParamAsString(req.params.id);
      const { fullName, phone, email, apartmentCode, buildingBlock, floorNumber, isActive, isRepresentative } = req.body || {};

      const existingResident = await prisma.user.findFirst({
        where: {
          id: residentId,
          OR: [{ role: Role.RESIDENT }, { apartmentCode: { not: null } }],
        },
        select: { id: true },
      });
      if (!existingResident) {
        res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản cư dân.' });
        return;
      }

      const data: any = {};
      if (fullName !== undefined) {
        const cleanName = String(fullName).trim();
        if (cleanName.length < 2) {
          res.status(400).json({ success: false, message: 'Họ tên cư dân tối thiểu 2 ký tự.' });
          return;
        }
        data.fullName = cleanName;
      }

      if (phone !== undefined) {
        const digitsOnly = String(phone).replace(/[^\d]/g, '');
        if (!/^0\d{9}$/.test(digitsOnly)) {
          res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ (phải gồm đúng 10 chữ số, bắt đầu bằng 0).' });
          return;
        }
        const cleanPhone = digitsOnly;
        // Kiểm tra trùng SĐT với user khác
        const dupPhone = await prisma.user.findFirst({
          where: { phone: cleanPhone, NOT: { id: residentId } },
          select: { id: true },
        });
        if (dupPhone) {
          res.status(409).json({ success: false, message: 'Số điện thoại này đã được sử dụng bởi người dùng khác.' });
          return;
        }
        data.phone = cleanPhone;
      }

      if (email !== undefined) {
        const cleanEmail = email ? String(email).trim().toLowerCase() : null;
        if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          res.status(400).json({ success: false, message: 'Địa chỉ email không đúng định dạng.' });
          return;
        }
        if (cleanEmail) {
          const dupEmail = await prisma.user.findFirst({
            where: { email: cleanEmail, NOT: { id: residentId } },
            select: { id: true },
          });
          if (dupEmail) {
            res.status(409).json({ success: false, message: 'Địa chỉ email này đã được sử dụng bởi người dùng khác.' });
            return;
          }
        }
        data.email = cleanEmail;
      }

      if (apartmentCode !== undefined) data.apartmentCode = String(apartmentCode).trim().toUpperCase();
      if (buildingBlock !== undefined) data.buildingBlock = String(buildingBlock).trim();
      if (floorNumber !== undefined) data.floorNumber = Number(floorNumber) || 1;
      if (typeof isActive === 'boolean') data.isActive = isActive;

      const updated = await prisma.user.update({
        where: { id: residentId },
        data,
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          role: true,
          apartmentCode: true,
          buildingBlock: true,
          floorNumber: true,
          isActive: true,
          isActivated: true,
        },
      });

      // Cập nhật người đại diện và thông tin cư dân trong ResidencyRecord trên PostgreSQL
      const updateData: any = {};
      if (typeof isRepresentative === 'boolean') updateData.isRepresentative = isRepresentative;
      if (data.apartmentCode) updateData.apartmentCode = data.apartmentCode;
      if (data.fullName) updateData.residentName = data.fullName;
      if (data.phone) updateData.residentPhone = data.phone;

      if (Object.keys(updateData).length > 0) {
        await prisma.residencyRecord.updateMany({
          where: { residentId },
          data: updateData,
        });
      }

      res.status(200).json({ success: true, message: 'Đã cập nhật thông tin cư dân thành công.', resident: updated });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ success: false, message: 'Số điện thoại hoặc email đã tồn tại trong hệ thống.' });
        return;
      }
      console.error('Lỗi khi cập nhật cư dân:', error);
      res.status(500).json({ success: false, message: 'Không thể cập nhật thông tin cư dân.' });
    }
  }
);

// POST /api/management/residents/:id/reset-password - BMB đặt lại mật khẩu tạm thời cho cư dân (hoặc cư dân mất email)
router.post(
  '/residents/:id/reset-password',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const residentId = getParamAsString(req.params.id);
      const { newPassword } = req.body || {};
      const cleanPass = typeof newPassword === 'string' && newPassword.trim()
        ? newPassword.trim()
        : generateSecureTemporaryPassword(10);

      if (cleanPass.length < 6 || cleanPass.length > 128) {
        res.status(400).json({ success: false, message: 'Mật khẩu phải từ 6 đến 128 ký tự để đảm bảo an toàn.' });
        return;
      }

      const target = await prisma.user.findFirst({
        where: {
          id: residentId,
          OR: [{ role: Role.RESIDENT }, { apartmentCode: { not: null } }],
        },
        select: { id: true, fullName: true, phone: true },
      });

      if (!target) {
        res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản cư dân.' });
        return;
      }

      const hash = await bcrypt.hash(cleanPass, 10);
      try {
        await prisma.user.update({
          where: { id: residentId },
          data: {
            passwordHash: hash,
            mustChangePassword: true,
            tokenVersion: { increment: 1 },
          } as any,
          select: { id: true },
        });
      } catch {
        await prisma.user.update({
          where: { id: residentId },
          data: { passwordHash: hash },
          select: { id: true },
        });
      }

      console.log(`[AUDIT_LOG] BMB (${req.user?.fullName} - ID: ${req.user?.userId}) đã đặt lại mật khẩu tạm thời cho cư dân: ${target.fullName} (${target.phone}) lúc ${new Date().toISOString()}`);

      res.status(200).json({
        success: true,
        temporaryPassword: cleanPass,
        message: `Đã đặt lại mật khẩu tạm thời cho cư dân ${target.fullName} thành công! Hãy bàn giao mật khẩu này cho cư dân đổi mật khẩu ở lần đăng nhập tới.`,
      });
    } catch (error) {
      console.error('Lỗi khi đặt lại mật khẩu:', error);
      res.status(500).json({ success: false, message: 'Không thể đặt lại mật khẩu.' });
    }
  }
);

// Helper xử lý chuyển đi / kết thúc cư trú
const handleResidentDepartureLogic = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const residentId = getParamAsString(req.params.id);
    const { moveOutDate } = req.body || {};

    const resident = await prisma.user.findFirst({
      where: {
        id: residentId,
        OR: [{ role: Role.RESIDENT }, { apartmentCode: { not: null } }],
      },
      select: { id: true, fullName: true, phone: true, apartmentCode: true },
    });
    if (!resident) {
      res.status(404).json({ success: false, message: 'Không tìm thấy cư dân.' });
      return;
    }

    const outDate = typeof moveOutDate === 'string' && moveOutDate ? moveOutDate : new Date().toISOString().slice(0, 10);
    const outDateObj = moveOutDate ? new Date(moveOutDate) : new Date();

    // Cập nhật ngày chuyển đi trong PostgreSQL ResidencyRecord
    await prisma.residencyRecord.updateMany({
      where: { residentId, moveOutDate: null },
      data: {
        moveOutDate: outDateObj,
        isRepresentative: false,
      },
    });

    // Gỡ căn hộ trên tài khoản cư dân (thu hồi quyền tạo ticket/truy cập căn hộ cũ)
    // Toàn bộ ticket và QR phòng vẫn giữ nguyên an toàn!
    await prisma.user.update({
      where: { id: residentId },
      data: {
        apartmentCode: null,
        buildingBlock: null,
        floorNumber: null,
      },
      select: { id: true },
    });

    console.log(`[AUDIT] Cư dân ${resident.fullName} (${resident.phone}) đã rời căn hộ ${resident.apartmentCode || ''} vào ngày ${outDate}`);

    res.status(200).json({
      success: true,
      message: `Đã hoàn tất thủ tục bàn giao / chuyển đi cho cư dân ${resident.fullName}. Quyền truy cập căn hộ đã được thu hồi; toàn bộ lịch sử sửa chữa và mã QR căn hộ được bảo lưu an toàn.`,
    });
  } catch (error) {
    console.error('Lỗi khi ghi nhận rời phòng:', error);
    res.status(500).json({ success: false, message: 'Không thể cập nhật trạng thái rời phòng.' });
  }
};

// POST /api/management/residents/:id/move-out & /departure - Ghi nhận cư dân rời phòng (bảo lưu toàn bộ ticket và QR)
router.post('/residents/:id/move-out', authenticateJWT, authorizeRoles(Role.BMB), handleResidentDepartureLogic);
router.post('/residents/:id/departure', authenticateJWT, authorizeRoles(Role.BMB), handleResidentDepartureLogic);

// DELETE /api/management/residents/:id - Vô hiệu hóa / Xóa tài khoản Cư dân (BMB only)
// Tuân thủ nguyên tắc: Không xóa tài khoản BMB cuối cùng, vô hiệu hóa tài khoản bảo toàn lịch sử ticket & giải phóng căn hộ
router.delete(
  '/residents/:id',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const residentId = getParamAsString(req.params.id);
      const user = await prisma.user.findUnique({
        where: { id: residentId },
        select: { id: true, fullName: true, phone: true, role: true, isActive: true, apartmentCode: true },
      });

      if (!user) {
        res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản người dùng.' });
        return;
      }

      // Chống xóa tài khoản BMB cuối cùng
      if (user.role === Role.BMB) {
        const activeBmbCount = await prisma.user.count({
          where: { role: Role.BMB, isActive: true },
        });
        if (activeBmbCount <= 1) {
          res.status(400).json({
            success: false,
            message: 'Không thể xóa hoặc vô hiệu hóa tài khoản Ban Quản Lý (BMB) cuối cùng đang hoạt động của hệ thống!',
          });
          return;
        }
      }

      const isPurge = req.query.purge === 'true' || (req.body && req.body.purge === true);

      if (isPurge) {
        const bmbAdmin = await prisma.user.findFirst({
          where: { role: Role.BMB, isActive: true },
        });
        const fallbackId = bmbAdmin ? bmbAdmin.id : req.user!.userId;

        await prisma.$transaction(async (tx) => {
          await tx.incidentTicket.updateMany({
            where: { residentId: user.id },
            data: { residentId: fallbackId },
          });
          await tx.ticketStatusLog.updateMany({
            where: { changedById: user.id },
            data: { changedById: fallbackId },
          });
          await tx.ticketMedia.updateMany({
            where: { uploadedById: user.id },
            data: { uploadedById: fallbackId },
          });
          await tx.notification.deleteMany({
            where: { userId: user.id },
          });
          await tx.residencyRecord.deleteMany({
            where: { residentId: user.id },
          });
          await tx.user.delete({
            where: { id: user.id },
          });
        });

        res.status(200).json({
          success: true,
          message: `Đã xóa vĩnh viễn tài khoản cư dân ${user.fullName} (${user.phone}). Lịch sử sự cố được bảo lưu an toàn.`,
        });
        return;
      }

      const now = new Date();

      // Cập nhật ngày chuyển đi trong ResidencyRecord nếu có
      await prisma.residencyRecord.updateMany({
        where: { residentId: user.id, moveOutDate: null },
        data: {
          moveOutDate: now,
          isRepresentative: false,
        },
      });

      // Vô hiệu hóa tài khoản, gỡ căn hộ và tăng tokenVersion để thu hồi phiên đăng nhập
      await prisma.user.update({
        where: { id: user.id },
        data: {
          isActive: false,
          apartmentCode: null,
          buildingBlock: null,
          floorNumber: null,
          tokenVersion: { increment: 1 },
        },
      });

      res.status(200).json({
        success: true,
        message: `Đã vô hiệu hóa tài khoản ${user.fullName} (${user.phone}) thành công. Lịch sử sự cố và dữ liệu liên quan được bảo lưu toàn vẹn.`,
      });
    } catch (error) {
      console.error('Lỗi khi vô hiệu hóa tài khoản cư dân:', error);
      res.status(500).json({ success: false, message: 'Lỗi server khi vô hiệu hóa tài khoản.' });
    }
  }
);

// ============================================================================
// 3. QUẢN LÝ CĂN HỘ & LỊCH SỬ SỬA CHỮA (BMB & RESIDENT)
// ============================================================================
// GET /api/management/apartments - BMB xem danh sách căn hộ theo khối/tầng/phòng
router.get(
  '/apartments',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const residents = await prisma.user.findMany({
        where: {
          isActive: true,
          OR: [
            { role: Role.RESIDENT },
            { apartmentCode: { not: null } },
          ],
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          apartmentCode: true,
          buildingBlock: true,
          floorNumber: true,
        },
      });

      // 1. Tải cấu hình tòa nhà từ SystemSetting trên DB (với fallback sang store)
      let buildingAddress = 'Đại học Duy Tân, Hòa Khánh Nam, Đà Nẵng';
      let buildingName = 'Khu Tòa Nhà ResiFix - Đại học Duy Tân';
      try {
        const payrollSetting = await prisma.systemSetting.findUnique({ where: { key: 'payroll_config' } });
        const val = payrollSetting?.value as any;
        if (val?.buildingLocation) {
          buildingAddress = val.buildingLocation.buildingAddress || buildingAddress;
          buildingName = val.buildingLocation.buildingName || buildingName;
        }
      } catch (e) {
        // Ignored
      }

      // 2. Tải danh sách căn hộ từ PostgreSQL Neon (Apartment table)
      const rawApartments = await prisma.apartment.findMany({
        orderBy: [{ buildingBlock: 'asc' }, { floorNumber: 'asc' }, { apartmentCode: 'asc' }],
      });

      // Gom nhóm căn hộ theo apartmentCode (75 phòng G101..G505, F101..F505, E101..E505)
      const aptMap = new Map<string, any>();

      // Nạp tất cả căn hộ từ DB
      for (const a of rawApartments) {
        const code = a.apartmentCode.toUpperCase();
        aptMap.set(code, {
          id: a.id,
          apartmentCode: code,
          buildingBlock: a.buildingBlock,
          floorNumber: a.floorNumber,
          roomQrCode: a.roomQrCode || `ROOM:${code}`,
          status: 'VACANT',
          buildingAddress,
          buildingName,
          residents: [],
          representative: null,
        });
      }

      const activeResidencies = await prisma.residencyRecord.findMany({
        where: { moveOutDate: null },
      });

      // 2. Nạp cư dân thực tế vào các căn hộ
      for (const r of residents) {
        if (!r.apartmentCode) continue;
        const code = r.apartmentCode.toUpperCase();
        if (!aptMap.has(code)) {
          aptMap.set(code, {
            id: `apt-${code.toLowerCase()}`,
            apartmentCode: code,
            buildingBlock: r.buildingBlock || 'Tòa G',
            floorNumber: r.floorNumber || 1,
            roomQrCode: `ROOM:${code}`,
            status: 'OCCUPIED',
            buildingAddress,
            buildingName,
            residents: [],
            representative: null,
          });
        }
        const apt = aptMap.get(code);
        apt.status = 'OCCUPIED';
        const history = activeResidencies.find((h) => h.residentId === r.id);
        const isRep = history?.isRepresentative ?? (apt.residents.length === 0);
        const rObj = {
          id: r.id,
          fullName: r.fullName,
          phone: r.phone,
          isRepresentative: isRep,
          residencyRole: history?.residencyRole || (isRep ? 'OWNER' : 'TENANT'),
          moveInDate: history?.moveInDate ? history.moveInDate.toISOString().slice(0, 10) : '2025-01-01',
        };
        apt.residents.push(rObj);
        if (isRep || !apt.representative) {
          apt.representative = rObj;
        }
      }

      const apartments = Array.from(aptMap.values()).sort((a, b) => a.apartmentCode.localeCompare(b.apartmentCode));
      const occupiedCount = apartments.filter((a) => a.residents.length > 0).length;

      res.status(200).json({
        success: true,
        buildingName,
        buildingAddress,
        totalRooms: apartments.length,
        occupiedRooms: occupiedCount,
        vacantRooms: apartments.length - occupiedCount,
        apartments,
      });
    } catch (error) {
      console.error('Lỗi khi lấy danh sách căn hộ:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải danh sách căn hộ.' });
    }
  }
);

// GET /api/management/apartments/:apartmentCode/repairs - Lịch sử sửa chữa của căn hộ
// BẢO MẬT & PHÂN QUYỀN RBAC: BMB toàn quyền; Cư dân chỉ xem phòng của mình; KTV chỉ xem phòng có nhiệm vụ được giao
router.get(
  '/apartments/:apartmentCode/repairs',
  authenticateJWT,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const apartmentCode = getParamAsString(req.params.apartmentCode).toUpperCase();
      const isFullHistory = req.query.all === 'true';
      const userRole = req.user?.role;
      const userId = req.user?.userId;

      // 1. KIỂM TRA PHÂN QUYỀN RBAC PHÍA BACKEND
      if (userRole === Role.RESIDENT) {
        // Cư dân: Kiểm tra xem user có quan hệ cư trú hợp lệ với apartmentCode không
        const me = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, apartmentCode: true },
        });
        const hasCurrentApt = me?.apartmentCode && me.apartmentCode.toUpperCase() === apartmentCode;
        const activeResidency = await prisma.residencyRecord.findFirst({
          where: { residentId: userId, apartmentCode, moveOutDate: null },
        });

        if (!hasCurrentApt && !activeResidency) {
          res.status(403).json({
            success: false,
            message: 'Bạn không có quyền truy cập lịch sử sửa chữa của căn hộ này.',
          });
          return;
        }
      } else if (userRole === Role.TECHNICIAN) {
        // Kỹ thuật viên: Chỉ truy cập nếu có ticket trong căn hộ được phân công cho KTV này
        const hasAssignedTicket = await prisma.incidentTicket.findFirst({
          where: {
            assignedTechId: userId,
            OR: [
              { locationNote: { contains: apartmentCode } },
              { resident: { apartmentCode } },
            ],
          },
          select: { id: true },
        });

        if (!hasAssignedTicket) {
          res.status(403).json({
            success: false,
            message: 'Kỹ thuật viên chỉ có quyền truy cập khi có nhiệm vụ liên quan đến căn hộ này.',
          });
          return;
        }
      } else if (userRole !== Role.BMB) {
        res.status(403).json({ success: false, message: 'Quyền truy cập bị từ chối.' });
        return;
      }

      // 2. TRUY VẤN LỊCH SỬ SỬA CHỮA (BẢO TOÀN LỊCH SỬ KHI CƯ DÂN CHUYỂN PHÒNG)
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      // Thu thập ID của các cư dân từng sống tại căn hộ này từ lịch sử cư trú PostgreSQL
      const pastResidencies = await prisma.residencyRecord.findMany({
        where: { apartmentCode },
        select: { residentId: true },
      });
      const pastResidentIds = pastResidencies.map((h) => h.residentId).filter(Boolean) as string[];

      const where: any = {
        OR: [
          { locationNote: { contains: apartmentCode } },
          { residentId: { in: pastResidentIds } },
          { resident: { apartmentCode } },
        ],
      };

      if (!isFullHistory) {
        where.createdAt = { gte: threeMonthsAgo };
      }

      const rawTickets = await prisma.incidentTicket.findMany({
        where,
        select: {
          id: true,
          ticketCode: true,
          title: true,
          description: true,
          status: true,
          finalCategory: true,
          finalPriority: true,
          locationNote: true,
          createdAt: true,
          completedAt: true,
          assignedTech: {
            select: { fullName: true, phone: true },
          },
          resident: {
            select: { id: true, fullName: true, phone: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // 3. BẢO VỆ DỮ LIỆU CÁ NHÂN (DATA PRIVACY SANITIZATION)
      // Nếu là RESIDENT hoặc TECHNICIAN xem: KHÔNG trả số điện thoại của cư dân khác
      const sanitizedTickets = rawTickets.map((t) => {
        const isBmb = userRole === Role.BMB;
        const isSelf = t.resident?.id === userId;
        return {
          id: t.id,
          ticketCode: t.ticketCode,
          title: t.title,
          description: t.description,
          status: t.status,
          finalCategory: t.finalCategory,
          finalPriority: t.finalPriority,
          locationNote: t.locationNote,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
          assignedTech: t.assignedTech,
          resident: {
            fullName: t.resident?.fullName || 'Cư dân',
            // Chỉ BMB hoặc chính chủ cư dân mới xem được SĐT người báo cáo
            phone: isBmb || isSelf ? t.resident?.phone : undefined,
          },
        };
      });

      res.status(200).json({
        success: true,
        apartmentCode,
        isFullHistory,
        period: isFullHistory ? 'Toàn bộ thời gian' : '3 tháng gần nhất',
        totalTickets: sanitizedTickets.length,
        repairs: sanitizedTickets,
      });
    } catch (error) {
      console.error('Lỗi khi lấy lịch sử sửa chữa căn hộ:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải lịch sử sửa chữa.' });
    }
  }
);

// GET /api/management/my-apartment - Cư dân xem thông tin căn hộ của mình
router.get(
  '/my-apartment',
  authenticateJWT,
  authorizeRoles(Role.RESIDENT),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const me = await prisma.user.findUnique({
        where: { id: req.user?.userId },
        select: { id: true, fullName: true, apartmentCode: true, buildingBlock: true, floorNumber: true },
      });

      if (!me || !me.apartmentCode) {
        res.status(200).json({ success: true, apartment: null });
        return;
      }

      const coResidents = await prisma.user.findMany({
        where: { apartmentCode: me.apartmentCode, isActive: true },
        select: { id: true, fullName: true, phone: true },
      });

      const repRecord = await prisma.residencyRecord.findFirst({
        where: { apartmentCode: me.apartmentCode, isRepresentative: true, moveOutDate: null },
      });

      res.status(200).json({
        success: true,
        apartment: {
          apartmentCode: me.apartmentCode,
          buildingBlock: me.buildingBlock,
          floorNumber: me.floorNumber,
          qrCode: `ROOM:${me.apartmentCode}`,
          representative: repRecord ? { fullName: repRecord.residentName, phone: repRecord.residentPhone } : coResidents[0],
          residents: coResidents,
        },
      });
    } catch (error) {
      console.error('Lỗi khi tải thông tin căn hộ cá nhân:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi tải thông tin căn hộ.' });
    }
  }
);

export default router;

