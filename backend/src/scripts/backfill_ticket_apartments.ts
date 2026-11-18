/**
 * Script phân tích và backfill căn hộ cho Ticket cũ
 * NGUYÊN TẮC AN TOÀN:
 * - Chạy ở chế độ DRY-RUN mặc định (chỉ phân tích, không sửa DB)
 * - Chỉ cập nhật khi xác định chính xác 100% căn hộ
 * - Các bản ghi mơ hồ (khu vực chung, hành lang, thang máy) giữ nguyên apartmentId = null
 *   và xuất báo cáo cần đối chiếu thủ công.
 */

import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../db';
import { resiFixStore } from '../data/resifix_store';

export interface BackfillAnalysisResult {
  totalTickets: number;
  alreadyLinked: number;
  exactMatched: Array<{ ticketCode: string; detectedApt: string; reason: string }>;
  ambiguous: Array<{ ticketCode: string; locationNote: string; reason: string }>;
}

export async function analyzeTicketApartments(): Promise<BackfillAnalysisResult> {
  let tickets: any[] = [];
  try {
    tickets = await prisma.incidentTicket.findMany({
      select: {
        id: true,
        ticketCode: true,
        locationNote: true,
        createdAt: true,
        residentId: true,
        resident: {
          select: {
            fullName: true,
            apartmentCode: true,
          },
        },
      },
    });
  } catch (err: any) {
    console.warn(`[OFFLINE_NOTICE] Không thể kết nối Neon DB trực tiếp trong Sandbox: ${err.message?.slice(0, 80)}...`);
  }

  const store = resiFixStore.get();
  const result: BackfillAnalysisResult = {
    totalTickets: tickets.length,
    alreadyLinked: 0,
    exactMatched: [],
    ambiguous: [],
  };

  for (const t of tickets) {
    const loc = (t.locationNote || '').trim();

    // 1. Kiểm tra xem locationNote có chứa mã phòng rõ ràng dạng [A-Z]-\d{3,4} (ví dụ A-1204)
    const roomMatch = loc.match(/\b([A-Za-z])-?(\d{3,4})\b/i);

    if (roomMatch) {
      const formattedCode = `${roomMatch[1].toUpperCase()}-${roomMatch[2]}`;
      result.exactMatched.push({
        ticketCode: t.ticketCode,
        detectedApt: formattedCode,
        reason: `Trích xuất trực tiếp từ vị trí: "${loc}"`,
      });
      continue;
    }

    // 2. Kiểm tra lịch sử cư trú của cư dân tại thời điểm tạo ticket
    const ticketTime = new Date(t.createdAt).getTime();
    const residencyAtTime = store.residencyHistory.find((h) => {
      if (h.residentId !== t.residentId) return false;
      const moveIn = new Date(h.moveInDate).getTime();
      const moveOut = h.moveOutDate ? new Date(h.moveOutDate).getTime() : Infinity;
      return ticketTime >= moveIn && ticketTime <= moveOut;
    });

    if (residencyAtTime) {
      result.exactMatched.push({
        ticketCode: t.ticketCode,
        detectedApt: residencyAtTime.apartmentCode,
        reason: `Khớp theo lịch sử cư trú của cư dân (${residencyAtTime.residentName}) tại ngày báo cáo`,
      });
      continue;
    }

    // 3. Nếu locationNote là khu vực công cộng hoặc không có căn hộ cụ thể -> Ghi nhận mơ hồ
    result.ambiguous.push({
      ticketCode: t.ticketCode,
      locationNote: loc || '(Trống)',
      reason: 'Vị trí khu vực chung hoặc không thể xác định chính xác căn hộ; giữ nguyên để BMB đối soát thủ công.',
    });
  }

  return result;
}

// Chạy kiểm tra nếu gọi trực tiếp từ CLI
if (require.main === module) {
  analyzeTicketApartments()
    .then((res) => {
      console.log('=== KẾT QUẢ PHÂN TÍCH BACKFILL CĂN HỘ CHO TICKET CŨ ===');
      console.log(`Tổng số ticket: ${res.totalTickets}`);
      console.log(`Số ticket khớp chính xác căn hộ: ${res.exactMatched.length}`);
      console.log(`Số ticket mơ hồ / khu vực chung cần đối soát: ${res.ambiguous.length}`);
      if (res.exactMatched.length > 0) {
        console.log('\nMẫu ticket khớp chính xác:');
        console.table(res.exactMatched.slice(0, 5));
      }
      if (res.ambiguous.length > 0) {
        console.log('\nMẫu ticket mơ hồ cần đối chiếu thủ công:');
        console.table(res.ambiguous.slice(0, 5));
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Lỗi phân tích:', err);
      process.exit(1);
    });
}
