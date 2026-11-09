import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { Prisma, Role, TicketStatus } from '@prisma/client';
import { authenticateJWT, authorizeRoles, AuthRequest } from '../middlewares/auth.middleware';
import { prisma } from '../db';
import { resiFixStore, ResidencyRecord } from '../data/resifix_store';
import { createAndSaveOtp } from '../services/otp.service';
import { safeSendOtpEmail } from '../services/mail.service';

const router = Router();

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
    const store = resiFixStore.get();
    res.status(200).json({
      success: true,
      emergencyContact: store.emergencyContact,
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

      const store = resiFixStore.get();
      store.emergencyContact = { managerName: cleanName, managerPhone: cleanPhone };
      resiFixStore.save(store);

      console.log(`[AUDIT] BMB (${req.user?.fullName}) đã cập nhật liên hệ khẩn cấp: ${cleanName} - ${cleanPhone}`);

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật liên hệ quản lý khẩn cấp.',
        emergencyContact: store.emergencyContact,
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
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const block = typeof req.query.block === 'string' ? req.query.block.trim() : '';

      const where: any = { role: Role.RESIDENT };
      if (block) {
        where.buildingBlock = block;
      }
      if (search) {
        where.OR = [
          { fullName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { apartmentCode: { contains: search, mode: 'insensitive' } },
        ];
      }

      const residents = await prisma.user.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          apartmentCode: true,
          buildingBlock: true,
          floorNumber: true,
          isActive: true,
          createdAt: true,
        },
        orderBy: [{ apartmentCode: 'asc' }, { fullName: 'asc' }],
      });

      const store = resiFixStore.get();

      // Ghép thông tin người đại diện và ngày vào từ lịch sử cư trú
      const enhancedResidents = residents.map((r) => {
        const history = store.residencyHistory.find((h) => h.residentId === r.id || h.phone === r.phone);
        return {
          ...r,
          isRepresentative: history?.isRepresentative ?? true,
          moveInDate: history?.moveInDate ?? r.createdAt.toISOString().slice(0, 10),
          moveOutDate: history?.moveOutDate ?? null,
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
    try {
      const { fullName, phone, email, apartmentCode, buildingBlock, floorNumber, password, isRepresentative, moveInDate } = req.body || {};
      const cleanName = typeof fullName === 'string' ? fullName.trim() : '';
      const digitsOnly = typeof phone === 'string' ? phone.replace(/[^\d]/g, '') : '';
      const rawEmail = typeof email === 'string' ? email.trim() : '';
      const cleanEmail = rawEmail ? rawEmail.toLowerCase() : null;
      const cleanPass = typeof password === 'string' ? password.trim() : '';

      // 1. Kiểm tra họ tên và số điện thoại
      if (cleanName.length < 2 || !/^0\d{9}$/.test(digitsOnly)) {
        res.status(400).json({
          success: false,
          message: 'Họ tên cư dân tối thiểu 2 ký tự và số điện thoại phải gồm đúng 10 chữ số (bắt đầu bằng số 0).',
        });
        return;
      }
      const cleanPhone = digitsOnly;

      // 2. Bắt buộc nhập email hợp lệ để gửi mã OTP kích hoạt tài khoản
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        res.status(400).json({
          success: false,
          message: 'Vui lòng nhập địa chỉ email hợp lệ để hệ thống gửi mã xác thực kích hoạt tài khoản OTP cho cư dân.',
        });
        return;
      }

      // 3. Mật khẩu không bắt buộc khi BMB tạo tài khoản (cư dân sẽ tự thiết lập qua OTP)
      if (cleanPass && (cleanPass.length < 12 || cleanPass.length > 128)) {
        res.status(400).json({
          success: false,
          message: 'Mật khẩu ban đầu phải từ 12 đến 128 ký tự để đảm bảo an toàn (hoặc để trống để cư dân tự tạo mật khẩu qua OTP).',
        });
        return;
      }

      // 4. Kiểm tra trùng số điện thoại
      const existingPhone = await prisma.user.findFirst({ where: { phone: cleanPhone }, select: { id: true } });
      if (existingPhone) {
        res.status(409).json({
          success: false,
          message: 'Số điện thoại này đã được đăng ký cho một tài khoản khác trong hệ thống.',
        });
        return;
      }

      // 5. Kiểm tra trùng email
      const existingEmail = await prisma.user.findFirst({ where: { email: cleanEmail }, select: { id: true } });
      if (existingEmail) {
        res.status(409).json({
          success: false,
          message: 'Địa chỉ email này đã được sử dụng cho một tài khoản khác trong hệ thống.',
        });
        return;
      }

      const cleanApt = typeof apartmentCode === 'string' && apartmentCode.trim() ? apartmentCode.trim().toUpperCase() : 'A-1204';
      const cleanBlock = typeof buildingBlock === 'string' && buildingBlock.trim() ? buildingBlock.trim() : 'Tòa S1';
      const cleanFloor = Number.isInteger(Number(floorNumber)) ? Number(floorNumber) : 1;

      // Tài khoản tạo bởi BMB không có mật khẩu sẽ ở trạng thái chờ kích hoạt (không thể đăng nhập cho tới khi xác thực OTP)
      const isActivationPending = !cleanPass;
      const initialPasswordHash = isActivationPending
        ? `!UNACTIVATED_${crypto.randomBytes(16).toString('hex')}`
        : await bcrypt.hash(cleanPass, 10);

      const baseUserData: any = {
        fullName: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        passwordHash: initialPasswordHash,
        role: Role.RESIDENT,
        apartmentCode: cleanApt,
        buildingBlock: cleanBlock,
        floorNumber: cleanFloor,
        isActive: true,
      };

      let newResident: any;
      try {
        newResident = await prisma.user.create({
          data: {
            ...baseUserData,
            isActivated: !isActivationPending,
          },
          select: {
            id: true,
            fullName: true,
            phone: true,
            email: true,
            apartmentCode: true,
            buildingBlock: true,
            floorNumber: true,
            isActive: true,
            createdAt: true,
          },
        });
      } catch (createErr: any) {
        // Tương thích ngược: Nếu PostgreSQL chưa được áp dụng migration cột isActivated (lỗi undefined_column / 42703 / P2021)
        if (
          createErr?.code === 'P2021' ||
          createErr?.code === 'P2022' ||
          String(createErr?.message || '').includes('isActivated') ||
          String(createErr?.meta?.column || '').includes('isActivated')
        ) {
          console.warn('[MANAGEMENT] Cột isActivated chưa có trên DB. Tự động lưu tài khoản an toàn qua passwordHash (!UNACTIVATED_).');
          newResident = await prisma.user.create({
            data: baseUserData,
            select: {
              id: true,
              fullName: true,
              phone: true,
              email: true,
              apartmentCode: true,
              buildingBlock: true,
              floorNumber: true,
              isActive: true,
              createdAt: true,
            },
          });
        } else {
          throw createErr;
        }
      }

      // Lưu vào lịch sử cư trú và cập nhật store (được bọc an toàn để không làm hỏng phản hồi của cư dân đã lưu DB thành công)
      try {
        const store = resiFixStore.get();
        const newRec: ResidencyRecord = {
          id: `res-rec-${Date.now()}`,
          residentId: newResident.id,
          residentName: newResident.fullName,
          phone: newResident.phone,
          apartmentCode: cleanApt,
          buildingBlock: cleanBlock,
          floorNumber: cleanFloor,
          moveInDate: typeof moveInDate === 'string' && moveInDate ? moveInDate : new Date().toISOString().slice(0, 10),
          moveOutDate: null,
          isRepresentative: Boolean(isRepresentative),
        };

        if (isRepresentative) {
          store.residencyHistory.forEach((h) => {
            if (h.apartmentCode === cleanApt && !h.moveOutDate) {
              h.isRepresentative = false;
            }
          });
        }
        store.residencyHistory.push(newRec);

        // Đảm bảo căn hộ có trong store.apartments
        if (!store.apartments.some((a) => a.apartmentCode.toUpperCase() === cleanApt)) {
          store.apartments.push({
            id: `apt-${cleanApt.toLowerCase()}`,
            apartmentCode: cleanApt,
            buildingBlock: cleanBlock,
            floorNumber: cleanFloor,
            roomQrCode: `ROOM:${cleanApt}`,
            status: 'OCCUPIED',
            createdAt: new Date().toISOString(),
          });
        }
        resiFixStore.save(store);
      } catch (storeError) {
        console.warn('Cảnh báo: Không thể đồng bộ lịch sử cư trú vào JSON store:', storeError);
      }

      // Tự động phát mã OTP kích hoạt qua Email
      let emailOtpSent = false;
      if (isActivationPending && cleanEmail) {
        try {
          const { otp } = await createAndSaveOtp(cleanEmail, 'ACCOUNT_ACTIVATION', 5);
          const mailRes = await safeSendOtpEmail(cleanEmail, otp, 'ACCOUNT_ACTIVATION');
          emailOtpSent = Boolean(mailRes.success);
        } catch (otpError) {
          console.warn('[MANAGEMENT] Không thể gửi mã OTP kích hoạt tài khoản:', otpError);
        }
      }

      res.status(201).json({
        success: true,
        message: emailOtpSent
          ? 'Đã thêm cư dân thành công! Mã OTP kích hoạt tài khoản đã được gửi đến email của cư dân.'
          : isActivationPending
            ? 'Đã thêm cư dân thành công vào hệ thống. Email gửi mã kích hoạt tạm thời chưa thể kết nối; cư dân có thể chọn "Gửi lại OTP" trên ứng dụng để nhận mã.'
            : 'Đã thêm cư dân thành công.',
        isEmailSent: emailOtpSent,
        isActivationPending,
        resident: {
          ...newResident,
          isRepresentative: Boolean(isRepresentative),
          moveInDate: typeof moveInDate === 'string' && moveInDate ? moveInDate : newResident.createdAt.toISOString().slice(0, 10),
          moveOutDate: null,
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
        where: { id: residentId, role: Role.RESIDENT },
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
          apartmentCode: true,
          buildingBlock: true,
          floorNumber: true,
          isActive: true,
        },
      });

      // Cập nhật người đại diện nếu có
      try {
        const store = resiFixStore.get();
        const rec = store.residencyHistory.find((h) => h.residentId === residentId);
        if (rec) {
          if (typeof isRepresentative === 'boolean') {
            rec.isRepresentative = isRepresentative;
          }
          if (data.apartmentCode) rec.apartmentCode = data.apartmentCode;
          if (data.fullName) rec.residentName = data.fullName;
          if (data.phone) rec.phone = data.phone;
          resiFixStore.save(store);
        }
      } catch (storeError) {
        console.warn('Cảnh báo: Không thể cập nhật residencyRecord trong JSON store:', storeError);
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

// POST /api/management/residents/:id/reset-password - BMB đặt lại mật khẩu cư dân
router.post(
  '/residents/:id/reset-password',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const residentId = getParamAsString(req.params.id);
      const { newPassword } = req.body || {};
      const cleanPass = typeof newPassword === 'string' ? newPassword.trim() : '';

      if (cleanPass.length < 12 || cleanPass.length > 128) {
        res.status(400).json({ success: false, message: 'Mật khẩu mới phải từ 12 đến 128 ký tự để đảm bảo an toàn.' });
        return;
      }

      const target = await prisma.user.findFirst({
        where: { id: residentId, role: Role.RESIDENT },
        select: { id: true, fullName: true, phone: true },
      });

      if (!target) {
        res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản cư dân.' });
        return;
      }

      const hash = await bcrypt.hash(cleanPass, 10);
      await prisma.user.update({
        where: { id: residentId },
        data: { passwordHash: hash },
        select: { id: true },
      });

      // Audit log: KHÔNG ghi plain text password vào log!
      console.log(`[AUDIT_LOG] BMB (${req.user?.fullName} - ID: ${req.user?.userId}) đã đặt lại mật khẩu cho cư dân: ${target.fullName} (${target.phone}) lúc ${new Date().toISOString()}`);

      res.status(200).json({
        success: true,
        message: `Đã đặt lại mật khẩu cho cư dân ${target.fullName} thành công!`,
      });
    } catch (error) {
      console.error('Lỗi khi đặt lại mật khẩu:', error);
      res.status(500).json({ success: false, message: 'Không thể đặt lại mật khẩu.' });
    }
  }
);

// POST /api/management/residents/:id/departure - Ghi nhận cư dân rời phòng (không xóa tài khoản/ticket)
router.post(
  '/residents/:id/departure',
  authenticateJWT,
  authorizeRoles(Role.BMB),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const residentId = getParamAsString(req.params.id);
      const { moveOutDate } = req.body || {};

      const resident = await prisma.user.findFirst({
        where: { id: residentId, role: Role.RESIDENT },
        select: { id: true, fullName: true, phone: true, apartmentCode: true },
      });
      if (!resident) {
        res.status(404).json({ success: false, message: 'Không tìm thấy cư dân.' });
        return;
      }

      const outDate = typeof moveOutDate === 'string' && moveOutDate ? moveOutDate : new Date().toISOString().slice(0, 10);

      const store = resiFixStore.get();
      const rec = store.residencyHistory.find((h) => h.residentId === residentId && !h.moveOutDate);
      if (rec) {
        rec.moveOutDate = outDate;
        rec.isRepresentative = false;
        resiFixStore.save(store);
      }

      // Vẫn giữ tài khoản và toàn bộ ticket, chỉ cập nhật trạng thái cư trú
      await prisma.user.update({
        where: { id: residentId },
        data: { apartmentCode: null },
        select: { id: true },
      });

      console.log(`[AUDIT] Cư dân ${resident.fullName} (${resident.phone}) đã rời căn hộ ${resident.apartmentCode || ''} vào ngày ${outDate}`);

      res.status(200).json({
        success: true,
        message: `Đã cập nhật ngày rời phòng cho cư dân ${resident.fullName}. Lịch sử và tài khoản được bảo lưu an toàn.`,
      });
    } catch (error) {
      console.error('Lỗi khi ghi nhận rời phòng:', error);
      res.status(500).json({ success: false, message: 'Không thể cập nhật trạng thái rời phòng.' });
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
        where: { role: Role.RESIDENT, isActive: true },
        select: {
          id: true,
          fullName: true,
          phone: true,
          apartmentCode: true,
          buildingBlock: true,
          floorNumber: true,
        },
      });

      const store = resiFixStore.get();

      // Gom nhóm căn hộ theo apartmentCode (KHÔNG dùng căn hộ mẫu hardcode)
      const aptMap = new Map<string, any>();

      // 1. Nạp các căn hộ đã đăng ký trong store (nếu có)
      for (const a of store.apartments || []) {
        const code = a.apartmentCode.toUpperCase();
        aptMap.set(code, {
          apartmentCode: code,
          buildingBlock: a.buildingBlock,
          floorNumber: a.floorNumber,
          qrCode: a.roomQrCode || `ROOM:${code}`,
          status: a.status || 'OCCUPIED',
          residents: [],
          representative: null,
        });
      }

      // 2. Nạp thêm các căn hộ từ danh sách cư dân thực tế
      for (const r of residents) {
        if (!r.apartmentCode) continue;
        const code = r.apartmentCode.toUpperCase();
        if (!aptMap.has(code)) {
          aptMap.set(code, {
            apartmentCode: code,
            buildingBlock: r.buildingBlock || 'Tòa S1',
            floorNumber: r.floorNumber || 1,
            qrCode: `ROOM:${code}`,
            status: 'OCCUPIED',
            residents: [],
            representative: null,
          });
        }
        const apt = aptMap.get(code);
        const history = store.residencyHistory.find((h) => h.residentId === r.id);
        const isRep = history?.isRepresentative ?? (apt.residents.length === 0);
        const rObj = {
          id: r.id,
          fullName: r.fullName,
          phone: r.phone,
          isRepresentative: isRep,
          moveInDate: history?.moveInDate ?? '2025-01-01',
        };
        apt.residents.push(rObj);
        if (isRep || !apt.representative) {
          apt.representative = rObj;
        }
      }

      const apartments = Array.from(aptMap.values()).sort((a, b) => a.apartmentCode.localeCompare(b.apartmentCode));

      res.status(200).json({ success: true, apartments });
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

      const store = resiFixStore.get();

      // 1. KIỂM TRA PHÂN QUYỀN RBAC PHÍA BACKEND
      if (userRole === Role.RESIDENT) {
        // Cư dân: Kiểm tra xem user có quan hệ cư trú hợp lệ với apartmentCode không
        const me = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, apartmentCode: true },
        });
        const hasCurrentApt = me?.apartmentCode && me.apartmentCode.toUpperCase() === apartmentCode;
        const hasResidencyHistory = store.residencyHistory.some(
          (h) => h.residentId === userId && h.apartmentCode.toUpperCase() === apartmentCode && !h.moveOutDate
        );

        if (!hasCurrentApt && !hasResidencyHistory) {
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

      // Thu thập ID của các cư dân từng sống tại căn hộ này từ lịch sử cư trú
      const pastResidentIds = store.residencyHistory
        .filter((h) => h.apartmentCode.toUpperCase() === apartmentCode)
        .map((h) => h.residentId);

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
        where: { apartmentCode: me.apartmentCode, role: Role.RESIDENT, isActive: true },
        select: { id: true, fullName: true, phone: true },
      });

      const store = resiFixStore.get();
      const repRecord = store.residencyHistory.find((h) => h.apartmentCode === me.apartmentCode && h.isRepresentative && !h.moveOutDate);

      res.status(200).json({
        success: true,
        apartment: {
          apartmentCode: me.apartmentCode,
          buildingBlock: me.buildingBlock,
          floorNumber: me.floorNumber,
          qrCode: `ROOM:${me.apartmentCode}`,
          representative: repRecord ? { fullName: repRecord.residentName, phone: repRecord.phone } : coResidents[0],
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

