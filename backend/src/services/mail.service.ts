import nodemailer, { Transporter } from 'nodemailer';

export type OtpPurpose = 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET';

export class MailServiceError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'MailServiceError';
  }
}

export interface SendOtpEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * Đọc cấu hình SMTP an toàn từ process.env.
 * Tuyệt đối không log mật khẩu hoặc bí mật ra console.
 */
function getSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_APP_PASSWORD?.trim();
  const from = process.env.MAIL_FROM?.trim() || (user ? `"ResiFix - Ban Quản Lý" <${user}>` : '"ResiFix" <no-reply@resifix.vn>');

  if (!user || !pass) {
    throw new MailServiceError(
      'Dịch vụ gửi email chưa được cấu hình hoàn chỉnh (thiếu SMTP_USER hoặc SMTP_APP_PASSWORD trong .env).',
      'SMTP_CONFIG_MISSING'
    );
  }

  return { host, port, user, pass, from };
}

/**
 * Tạo transporter Nodemailer dựa trên cấu hình SMTP
 */
function createMailTransporter(config: SmtpConfig): Transporter {
  const isSecure = config.port === 465;

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: isSecure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

/**
 * Ẩn email người nhận khi ghi nhật ký để bảo vệ quyền riêng tư
 */
export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length <= 2 ? name[0] + '***' : name[0] + '***' + name[name.length - 1];
  return `${maskedName}@${domain}`;
}

/**
 * Xây dựng nội dung email xác thực OTP bằng tiếng Việt
 */
function buildOtpContent(otp: string, purpose: OtpPurpose, role?: 'RESIDENT' | 'TECHNICIAN' | string): { subject: string; text: string; html: string } {
  const isActivation = purpose === 'ACCOUNT_ACTIVATION';
  const isTechnician = role === 'TECHNICIAN';

  const roleName = isTechnician ? 'Kỹ thuật viên' : 'Cư dân';
  const greeting = isTechnician ? 'Quý Kỹ thuật viên' : 'Quý Cư dân';

  const title = isActivation
    ? `Xác thực kích hoạt tài khoản ${roleName}`
    : `Xác thực đặt lại mật khẩu ${roleName}`;

  const introText = isActivation
    ? (isTechnician
        ? 'Ban Quản lý tòa nhà ResiFix đã tạo tài khoản Kỹ thuật viên cho bạn trên hệ thống. Dưới đây là mã xác thực OTP dùng để kích hoạt tài khoản và thiết lập mật khẩu cá nhân của bạn:'
        : 'Ban Quản lý tòa nhà ResiFix đã đăng ký thông tin cư dân cho bạn trên hệ thống. Dưới đây là mã xác thực OTP dùng để kích hoạt tài khoản và thiết lập mật khẩu cá nhân của bạn:')
    : `Hệ thống ResiFix nhận được yêu cầu đặt lại mật khẩu cho tài khoản ${roleName.toLowerCase()} của bạn. Dưới đây là mã xác thực OTP để tiến hành đổi mật khẩu mới:`;

  const subject = `[ResiFix] ${title} - Mã OTP: ${otp.slice(0, 3)}***`;

  const text = `
==================================================
RESIFIX - HỆ THỐNG QUẢN LÝ TÒA NHÀ THÔNG MINH
==================================================

Xin chào ${greeting},

${introText}

MÃ XÁC THỰC OTP CỦA BẠN: [ ${otp} ]

Thời hạn hiệu lực: 5 PHÚT kể từ thời điểm thư này được gửi đi.

LƯU Ý QUAN TRỌNG:
- Mã OTP chỉ sử dụng một lần và có hiệu lực tối đa trong vòng 5 phút.
- Tuyệt đối không cung cấp hoặc chia sẻ mã OTP này cho bất kỳ ai (kể cả nhân viên ban quản lý tòa nhà) để đảm bảo an toàn cho tài khoản của bạn.
- Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email hoặc liên hệ ngay với Ban Quản lý ResiFix để được hỗ trợ.

Trân trọng,
Ban Quản trị & Kỹ thuật Tòa nhà ResiFix
Email hỗ trợ tự động - Vui lòng không trả lời thư này.
==================================================
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; margin: 0; padding: 24px; color: #0F172A; }
    .container { max-width: 560px; margin: 0 auto; background: #FFFFFF; border-radius: 14px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: #1D61E7; padding: 24px 28px; text-align: left; }
    .logo-text { font-size: 22px; font-weight: 800; color: #FFFFFF; letter-spacing: 0.5px; margin: 0; }
    .sub-brand { font-size: 12px; color: #DBEAFE; margin-top: 4px; }
    .content { padding: 32px 28px; }
    .title { font-size: 19px; font-weight: 700; color: #0F172A; margin: 0 0 14px 0; }
    .desc { font-size: 14.5px; line-height: 22px; color: #334155; margin-bottom: 24px; }
    .otp-box { background: #EFF6FF; border: 1.5px dashed #2563EB; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .otp-label { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #1D4ED8; font-weight: 700; margin-bottom: 8px; }
    .otp-code { font-size: 34px; font-weight: 800; color: #1D4ED8; letter-spacing: 8px; font-family: monospace; }
    .expiry-note { display: inline-block; background: #FEF3C7; color: #92400E; font-size: 12.5px; font-weight: 600; padding: 6px 14px; border-radius: 20px; margin-top: 10px; }
    .security-notice { background: #F8FAFC; border-left: 4px solid #CBD5E1; padding: 12px 16px; border-radius: 0 8px 8px 0; font-size: 13px; color: #64748B; line-height: 20px; margin-top: 20px; }
    .footer { background: #F1F5F9; padding: 20px 28px; font-size: 12px; color: #64748B; line-height: 18px; border-top: 1px solid #E2E8F0; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-text">ResiFix</div>
      <div class="sub-brand">Hệ thống Quản lý &amp; Khắc phục Sự cố Tòa nhà thông minh</div>
    </div>
    <div class="content">
      <h2 class="title">${title}</h2>
      <p class="desc">Xin chào ${greeting},<br/><br/>${introText}</p>
      
      <div class="otp-box">
        <div class="otp-label">MÃ XÁC THỰC OTP</div>
        <div class="otp-code">${otp}</div>
        <div class="expiry-note">&#x23F1; Có hiệu lực trong vòng 5 phút</div>
      </div>

      <div class="security-notice">
        <strong>Lưu ý an toàn:</strong> Tuyệt đối không chia sẻ mã này cho bất kỳ ai. Ban quản lý và kỹ thuật viên ResiFix không bao giờ yêu cầu bạn cung cấp mã OTP này qua điện thoại hoặc tin nhắn.
      </div>
    </div>
    <div class="footer">
      Thư điện tử tự động từ ResiFix &bull; Không trả lời thư này.<br/>
      &copy; ${new Date().getFullYear()} ResiFix Building Management. Bảo lưu mọi quyền.
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, text, html };
}

/**
 * Gửi email chứa mã OTP đến địa chỉ email người nhận.
 * 
 * @param recipientEmail Địa chỉ email người nhận (Cư dân / Kỹ thuật viên)
 * @param otp Mã xác thực 6 chữ số
 * @param purpose Mục đích gửi: 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET'
 * @param role Vai trò người nhận: 'RESIDENT' | 'TECHNICIAN'
 * @returns Promise<SendOtpEmailResult> Kết quả gửi email (kèm messageId hoặc ném lỗi an toàn)
 */
export async function sendOtpEmail(
  recipientEmail: string,
  otp: string,
  purpose: OtpPurpose,
  role?: 'RESIDENT' | 'TECHNICIAN' | string
): Promise<SendOtpEmailResult> {
  // 1. Kiểm tra đầu vào người nhận
  if (!recipientEmail || typeof recipientEmail !== 'string') {
    throw new MailServiceError('Địa chỉ email người nhận không được để trống.', 'INVALID_EMAIL');
  }

  const cleanEmail = recipientEmail.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    throw new MailServiceError('Địa chỉ email người nhận không đúng định dạng.', 'INVALID_EMAIL');
  }

  // 2. Kiểm tra định dạng OTP 6 chữ số
  if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
    throw new MailServiceError('Mã OTP phải gồm chính xác 6 chữ số.', 'INVALID_OTP');
  }
  const cleanOtp = otp.trim();

  // 3. Kiểm tra mục đích
  if (purpose !== 'ACCOUNT_ACTIVATION' && purpose !== 'PASSWORD_RESET') {
    throw new MailServiceError(
      'Mục đích gửi OTP không hợp lệ (hỗ trợ ACCOUNT_ACTIVATION hoặc PASSWORD_RESET).',
      'INVALID_PURPOSE'
    );
  }

  // 4. Lấy cấu hình SMTP an toàn
  const config = getSmtpConfig();
  const transporter = createMailTransporter(config);
  const { subject, text, html } = buildOtpContent(cleanOtp, purpose, role);

  try {
    const info = await transporter.sendMail({
      from: config.from,
      to: cleanEmail,
      subject,
      text,
      html,
    });

    console.log(`[MailService] Đã gửi thành công email OTP tới [${maskEmail(cleanEmail)}] (ID: ${info.messageId})`);

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error: any) {
    // Tuyệt đối không log thông tin bí mật hoặc OTP
    console.error(`[MailService] Lỗi khi gửi email đến [${maskEmail(cleanEmail)}]:`, error?.code || error?.message || 'Unknown error');

    if (error?.code === 'EAUTH') {
      throw new MailServiceError(
        'Xác thực máy chủ gửi email thất bại. Vui lòng kiểm tra lại cấu hình SMTP.',
        'SMTP_AUTH_FAILED'
      );
    }

    if (error?.code === 'ESOCKET' || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNREFUSED') {
      throw new MailServiceError(
        'Không thể kết nối đến máy chủ gửi email. Vui lòng kiểm tra kết nối mạng.',
        'SMTP_CONNECTION_FAILED'
      );
    }

    throw new MailServiceError(
      'Không thể gửi email xác thực lúc này. Vui lòng thử lại sau.',
      'SEND_EMAIL_FAILED'
    );
  }
}

/**
 * Phiên bản an toàn không ném exception của sendOtpEmail, tiện cho các luồng xử lý cần bắt mã lỗi mềm
 */
export async function safeSendOtpEmail(
  recipientEmail: string,
  otp: string,
  purpose: OtpPurpose,
  role?: 'RESIDENT' | 'TECHNICIAN' | string
): Promise<SendOtpEmailResult> {
  try {
    return await sendOtpEmail(recipientEmail, otp, purpose, role);
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Lỗi gửi email xác thực.',
    };
  }
}
