import 'dotenv/config';
import { PrismaClient, Role, IncidentCategory, PriorityLevel, TicketStatus, MediaType } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Đang nạp dữ liệu mẫu ResiFix khớp với thiết kế Figma...');

  const defaultPassword = await bcrypt.hash('123456', 10);

  // 1. Tạo tài khoản Ban Quản Lý (BMB - Cầm Dương Mỹ Hạnh)
  const bmbAdmin = await prisma.user.upsert({
    where: { phone: '0582302454' },
    update: {},
    create: {
      phone: '0582302454',
      email: 'myhanh.bmb@resifix.vn',
      passwordHash: defaultPassword,
      fullName: 'Cầm Dương Mỹ Hạnh',
      role: Role.BMB,
    },
  });

  // 2. Tạo tài khoản Kỹ thuật viên (Đặng Thành Quyết)
  const techQuyet = await prisma.user.upsert({
    where: { phone: '0913402803' },
    update: {},
    create: {
      phone: '0913402803',
      email: 'thanhquyet100105@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Đặng Thành Quyết',
      role: Role.TECHNICIAN,
      specialty: IncidentCategory.PLUMBING,
      specialtyLabel: 'Kỹ thuật viên Điện - Nước',
      shiftName: 'Ca trực Sáng (07:00 - 15:00)',
      isOnDuty: true,
    },
  });

  // 3. Tạo tài khoản Cư dân chính thức (Cristiano Ronaldo - Căn hộ G103)
  const resident = await prisma.user.upsert({
    where: { phone: '0913400800' },
    update: {},
    create: {
      phone: '0913400800',
      email: 'dtq12305@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Cristiano Ronaldo',
      role: Role.RESIDENT,
      apartmentCode: 'G103',
      buildingBlock: 'Tòa G',
      floorNumber: 1,
    },
  });

  // 4. Tạo Khu vực gắn mã QR (WP-1204 & AC-B02)
  const pipeArea = await prisma.buildingArea.upsert({
    where: { qrCode: 'WP-1204' },
    update: {},
    create: {
      qrCode: 'WP-1204',
      areaName: 'Căn hộ A-1204',
      category: IncidentCategory.PLUMBING,
      locationLabel: 'Căn hộ A-1204 • Tòa S1',
      buildingBlock: 'Tòa S1',
      floor: 'Tầng 12',
    },
  });

  // 5. Tạo Sự cố #RF-2026-014 giống hệt trên Figma
  await prisma.incidentTicket.upsert({
    where: { ticketCode: '#RF-2026-014' },
    update: {},
    create: {
      ticketCode: '#RF-2026-014',
      title: 'Rò rỉ đường ống nước bồn rửa',
      description: 'Ống nước dưới bồn rửa bị nứt, nước chảy tràn ra sàn nhiều.',
      isVoiceInput: true,
      locationNote: 'Căn hộ A-1204 • Khu vực: WP-1204',
      areaId: pipeArea.id,
      isQrScannedByRes: true,
      aiSummary: 'Vỡ đường ống cấp nước bồn rửa tại căn hộ A-1204, nguy cơ ngập sàn.',
      aiSuggestedCategory: IncidentCategory.PLUMBING,
      aiSuggestedPriority: PriorityLevel.HIGH,
      aiLatencyMs: 1200,
      finalCategory: IncidentCategory.PLUMBING,
      finalPriority: PriorityLevel.HIGH,
      bmbApprovedById: bmbAdmin.id,
      assignedTechId: techQuyet.id,
      status: TicketStatus.COMPLETED,
      techRepairNote: 'Đã thay mới đoạn ống dẫn nước dưới bồn rửa và kiểm tra không còn rò rỉ.',
      residentId: resident.id,
      statusLogs: {
        create: [
          { toStatus: TicketStatus.PENDING, title: 'Đã tiếp nhận (Pending)', note: 'Gemini AI tự động phân loại: Điện - Nước', changedById: resident.id },
          { fromStatus: TicketStatus.PENDING, toStatus: TicketStatus.ASSIGNED, title: 'Đã phân công (Assigned)', note: 'BMB đã duyệt gợi ý AI & giao việc', changedById: bmbAdmin.id },
          { fromStatus: TicketStatus.ASSIGNED, toStatus: TicketStatus.IN_PROGRESS, title: 'Đang xử lý (In Progress)', note: 'KTV đã xác nhận và bắt đầu sửa', changedById: techQuyet.id },
          { fromStatus: TicketStatus.IN_PROGRESS, toStatus: TicketStatus.COMPLETED, title: 'Hoàn thành sửa chữa', note: 'KTV Đặng Thành Quyết đã gửi ảnh nghiệm thu', changedById: techQuyet.id },
        ],
      },
    },
  });

  console.log('✅ Đã nạp xong dữ liệu mẫu ResiFix thành công!');
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
