import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_SCENE_PHOTOS = 3;
export const MAX_SCENE_PHOTO_BYTES = 5 * 1024 * 1024;

function sceneAsset(value: unknown, residentId: string | null) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName || !/^[\w-]+$/.test(cloudName)) return null;
  const origin = `https://res.cloudinary.com/${cloudName}/image/upload/`;
  if (!value.startsWith(origin)) return null;

  const folder = residentId ? 'incident_scene' : 'incident_scene_anonymous';
  const path = value.slice(origin.length).split('#', 1)[0];
  const match = /^v(\d+)\/(resifix_c1se52\/(incident_scene(?:_anonymous)?)\/[\w-]+)\.(?:jpe?g|png|webp)$/i.exec(path);
  if (!match || match[3] !== folder) return null;
  return {
    imageUrl: origin + path,
    publicId: match[2],
    // Cloudinary strips GPS and other embedded private metadata from this derived image.
    analysisUrl: `${origin}c_limit,w_1080,q_auto/v${match[1]}/${match[2]}.jpg`,
  };
}

function sceneSignature(imageUrl: string, residentId: string | null): Buffer {
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!secret) throw new Error('Dịch vụ lưu ảnh chưa được cấu hình.');
  return createHmac('sha256', secret)
    .update(JSON.stringify(['resifix-scene-upload', imageUrl, residentId]))
    .digest();
}

export function authorizeSceneUpload(imageUrl: string, residentId: string | null): string {
  const asset = sceneAsset(imageUrl, residentId);
  if (!asset) throw new Error('Kho ảnh trả về đường dẫn ảnh hiện trường không hợp lệ.');
  // Keep the existing imageUrl contract. Clients can display it and pass it back unchanged.
  return `${asset.imageUrl}#${sceneSignature(asset.imageUrl, residentId).toString('hex')}`;
}

export function validateSceneAttachments(values: unknown, residentId: string | null) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > MAX_SCENE_PHOTOS) return null;

  const photos: { imageUrl: string; publicId: string }[] = [];
  for (const value of values) {
    const asset = sceneAsset(value, residentId);
    if (!asset || !process.env.CLOUDINARY_API_SECRET) return null;
    const signature = value.slice(asset.imageUrl.length);
    if (!/^#[0-9a-f]{64}$/.test(signature)) return null;
    if (!timingSafeEqual(Buffer.from(signature.slice(1), 'hex'), sceneSignature(asset.imageUrl, residentId))) return null;
    if (photos.some((photo) => photo.publicId === asset.publicId)) return null;
    photos.push({ imageUrl: asset.imageUrl, publicId: asset.publicId });
  }
  return photos;
}

export function sceneAnalysisUrl(
  media: { imageUrl: string; publicId: string | null },
  residentId: string | null
): string | null {
  const asset = sceneAsset(media.imageUrl, residentId);
  return asset && asset.publicId === media.publicId ? asset.analysisUrl : null;
}
