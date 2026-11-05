import { Router, Response } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { Role } from '@prisma/client';
import { authenticateJWT, AuthRequest } from '../middlewares/auth.middleware';

const router = Router();

const IMAGE_DATA_URI = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

router.post('/', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const imageBase64 = body.imageBase64;
  const folder = body.folder;

  if (typeof imageBase64 !== 'string' || !IMAGE_DATA_URI.test(imageBase64)) {
    res.status(400).json({ success: false, message: 'Ảnh phải là dữ liệu JPEG, PNG hoặc WebP hợp lệ.' });
    return;
  }
  if (imageBase64.length > 9_500_000) {
    res.status(413).json({ success: false, message: 'Ảnh vượt quá dung lượng cho phép.' });
    return;
  }
  if (folder !== 'incident_scene' && folder !== 'repair_proof') {
    res.status(400).json({ success: false, message: 'Loại ảnh tải lên không hợp lệ.' });
    return;
  }
  if (
    (folder === 'incident_scene' && req.user?.role !== Role.RESIDENT) ||
    (folder === 'repair_proof' && req.user?.role !== Role.TECHNICIAN)
  ) {
    res.status(403).json({ success: false, message: 'Vai trò hiện tại không được tải loại ảnh này.' });
    return;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    res.status(503).json({ success: false, message: 'Dịch vụ lưu ảnh chưa được cấu hình.' });
    return;
  }

  try {
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    const uploadResult = await cloudinary.uploader.upload(imageBase64, {
      folder: `resifix_c1se52/${folder}`,
      transformation: [{ width: 1080, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }],
      resource_type: 'image',
    });

    res.status(201).json({
      success: true,
      mode: 'CLOUDINARY_CLOUD',
      message: 'Đã tải ảnh lên Cloudinary thành công.',
      imageUrl: uploadResult.secure_url,
      publicId: uploadResult.public_id,
    });
  } catch (error) {
    console.error('Lỗi upload Cloudinary:', error);
    res.status(502).json({ success: false, message: 'Không thể tải ảnh lên Cloudinary. Vui lòng thử lại.' });
  }
});

export default router;
