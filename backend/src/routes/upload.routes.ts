import { Router, Response } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { authenticateJWT, AuthRequest } from '../middlewares/auth.middleware';

const router = Router();

// Cấu hình Cloudinary từ biến môi trường .env (Task 2.2.2.2, US-43)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ============================================================================
// POST /api/upload - Tải ảnh hiện trường (Cư dân) hoặc ảnh nghiệm thu (KTV) lên Cloudinary (US-08, US-33, US-43)
// Nhận vào: { imageBase64: "data:image/jpeg;base64,...", folder: "scene_before" | "repair_proof" }
// ============================================================================
router.post('/', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { imageBase64, folder } = req.body;

    if (!imageBase64) {
      res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp dữ liệu hình ảnh (imageBase64 hoặc URL)!',
      });
      return;
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';

    // Cơ chế Fallback thông minh: Nếu chưa cấu hình Cloudinary thật trong .env thì trả về ảnh Demo chất lượng cao
    if (!cloudName || cloudName === 'your_cloud_name') {
      const isRepairProof = folder === 'repair_proof';
      const demoUrl = isRepairProof
        ? 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg'
        : 'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?auto=format&fit=crop&w=800&q=80';

      res.status(200).json({
        success: true,
        mode: 'CLOUDINARY_DEMO_FALLBACK',
        message: 'Tải ảnh thành công (Chế độ Demo khi chưa điền CLOUDINARY_CLOUD_NAME trong .env)!',
        imageUrl: demoUrl,
        publicId: `resifix_demo_${Date.now()}`,
      });
      return;
    }

    // Nếu đã có tài khoản Cloudinary thật: Tải lên và tự động nén ảnh (Risk R4: Optimize storage payload)
    const uploadResult = await cloudinary.uploader.upload(String(imageBase64), {
      folder: `resifix_c1se52/${folder || 'incidents'}`,
      transformation: [{ width: 1080, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }],
    });

    res.status(200).json({
      success: true,
      mode: 'CLOUDINARY_CLOUD',
      message: 'Đã tải ảnh lên Cloudinary thành công!',
      imageUrl: uploadResult.secure_url,
      publicId: uploadResult.public_id,
    });
  } catch (error) {
    console.error('Lỗi upload Cloudinary:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi tải ảnh lên đám mây Cloudinary.',
      error,
    });
  }
});

export default router;