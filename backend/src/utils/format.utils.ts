/**
 * Ẩn một phần địa chỉ email để bảo mật thông tin người dùng (VD: a***b@gmail.com)
 */
export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length <= 2 ? name[0] + '***' : name[0] + '***' + name.slice(-1);
  return `${maskedName}@${domain}`;
}

/**
 * Chuẩn hóa chuỗi số điện thoại
 */
export function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, '');
}

