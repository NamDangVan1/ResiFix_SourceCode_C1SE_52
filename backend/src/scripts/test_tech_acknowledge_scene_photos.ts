import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MediaType, Role, TicketStatus } from '@prisma/client';

// ============================================================================
// LOGIC TRÍCH XUẤT ẢNH HIỆN TRƯỜNG TƯƠNG ĐƯƠNG TRÊN CLIENT
// ============================================================================
function getResidentReportedMedia(ticket: any): { id: string; url: string; caption?: string }[] {
  if (!ticket) return [];
  const items: { id: string; url: string; caption?: string }[] = [];
  const seenUrls = new Set<string>();

  // 1. Lấy từ ticket.media
  if (Array.isArray(ticket.media) && ticket.media.length > 0) {
    for (const m of ticket.media) {
      if (!m || !m.imageUrl || typeof m.imageUrl !== 'string' || !m.imageUrl.trim()) continue;
      if (m.ticketId && ticket.id && m.ticketId !== ticket.id) continue;
      if (m.mediaType === 'REPAIR_PROOF') continue;
      if (ticket.assignedTechId && m.uploadedById === ticket.assignedTechId) continue;

      if (m.mediaType === 'SCENE_BEFORE') {
        if (!seenUrls.has(m.imageUrl)) {
          seenUrls.add(m.imageUrl);
          items.push({
            id: m.id || m.imageUrl,
            url: m.imageUrl,
            caption: m.caption || 'Ảnh hiện trường',
          });
        }
        continue;
      }

      const isUploadedByResident = ticket.residentId && m.uploadedById === ticket.residentId;
      const isAnonymousReport = ticket.isAnonymous || !ticket.residentId;
      const isSceneCaption = m.caption && /hiện trường|báo cáo|cư dân|ẩn danh/i.test(m.caption);
      if (isUploadedByResident || isAnonymousReport || isSceneCaption || !m.mediaType) {
        if (!seenUrls.has(m.imageUrl)) {
          seenUrls.add(m.imageUrl);
          items.push({
            id: m.id || m.imageUrl,
            url: m.imageUrl,
            caption: m.caption || 'Ảnh hiện trường',
          });
        }
      }
    }
  }

  // 2. Bổ sung / dự phòng nếu ticket có mảng photos (chuỗi URL) từ API
  if (Array.isArray(ticket.photos) && ticket.photos.length > 0) {
    ticket.photos.forEach((photoUrl: any, idx: number) => {
      if (typeof photoUrl === 'string' && photoUrl.startsWith('http') && !seenUrls.has(photoUrl)) {
        seenUrls.add(photoUrl);
        items.push({
          id: `photo-${idx}-${photoUrl}`,
          url: photoUrl,
          caption: `Ảnh hiện trường ${idx + 1}`,
        });
      }
    });
  }

  return items;
}

// Logic gộp state activeTicket khi nhận việc hoặc fetch lại dữ liệu
function mergeActiveTicket(prevTicket: any, newTicketData: any): any {
  const mergedMedia =
    Array.isArray(newTicketData?.media) && newTicketData.media.length > 0
      ? newTicketData.media
      : Array.isArray(prevTicket?.media) && prevTicket.media.length > 0
        ? prevTicket.media
        : [];
  const mergedPhotos =
    Array.isArray(newTicketData?.photos) && newTicketData.photos.length > 0
      ? newTicketData.photos
      : Array.isArray(prevTicket?.photos) && prevTicket.photos.length > 0
        ? prevTicket.photos
        : [];
  const mergedAsset = newTicketData?.asset || prevTicket?.asset || null;
  const mergedArea = newTicketData?.area || prevTicket?.area || null;

  return {
    ...prevTicket,
    ...newTicketData,
    media: mergedMedia,
    photos: mergedPhotos,
    asset: mergedAsset,
    area: mergedArea,
    status: newTicketData?.status ?? prevTicket?.status ?? 'IN_PROGRESS',
  };
}

// ============================================================================
// BỘ KIỂM THỬ: HIỂN THỊ ẢNH HIỆN TRƯỜNG CHO KTV KHI NHẬN VIỆC
// ============================================================================

test('1. Ticket cư dân có nhiều ảnh: ảnh có trước khi nhận việc, giữ nguyên sau khi nhận việc và khi đóng mở lại', () => {
  const residentTicket = {
    id: 'ticket-res-1',
    ticketCode: '#RF-2026-100001',
    title: 'Rò rỉ ống nước bồn rửa bát',
    description: 'Nước rỉ tràn ra sàn bếp từ tối qua.',
    isAnonymous: false,
    residentId: 'res-user-1',
    assignedTechId: 'tech-user-1',
    status: TicketStatus.ASSIGNED,
    media: [
      {
        id: 'media-1',
        ticketId: 'ticket-res-1',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/scene1.jpg',
        mediaType: MediaType.SCENE_BEFORE,
        caption: 'Ảnh hiện trường 1',
        uploadedById: 'res-user-1',
      },
      {
        id: 'media-2',
        ticketId: 'ticket-res-1',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/scene2.jpg',
        mediaType: MediaType.SCENE_BEFORE,
        caption: 'Ảnh hiện trường 2',
        uploadedById: 'res-user-1',
      },
    ],
    photos: [
      'https://res.cloudinary.com/demo/image/upload/v1/scene1.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1/scene2.jpg',
    ],
  };

  // Trước khi nhận việc (status: ASSIGNED)
  const photosBefore = getResidentReportedMedia(residentTicket);
  assert.equal(photosBefore.length, 2, 'Trước khi nhận việc phải có đủ 2 ảnh');
  assert.equal(photosBefore[0].url, 'https://res.cloudinary.com/demo/image/upload/v1/scene1.jpg');
  assert.equal(photosBefore[1].url, 'https://res.cloudinary.com/demo/image/upload/v1/scene2.jpg');

  // Mô phỏng phản hồi từ API PATCH /:id/acknowledge
  const acknowledgeApiResponse = {
    id: 'ticket-res-1',
    ticketCode: '#RF-2026-100001',
    status: TicketStatus.IN_PROGRESS,
    acknowledgedAt: new Date().toISOString(),
    media: residentTicket.media,
    photos: residentTicket.photos,
  };

  // Ngay sau khi bấm "Nhận việc ngay" (gộp state)
  const activeTicketAfterAck = mergeActiveTicket(residentTicket, acknowledgeApiResponse);
  assert.equal(activeTicketAfterAck.status, TicketStatus.IN_PROGRESS);
  const photosAfterAck = getResidentReportedMedia(activeTicketAfterAck);
  assert.equal(photosAfterAck.length, 2, 'Ngay sau khi nhận việc phải còn nguyên 2 ảnh');
  assert.equal(photosAfterAck[0].url, 'https://res.cloudinary.com/demo/image/upload/v1/scene1.jpg');

  // Đóng rồi mở lại chi tiết sự cố (mô phỏng fetch lại từ server hoặc chọn lại ticket)
  const reopenedTicket = mergeActiveTicket(activeTicketAfterAck, acknowledgeApiResponse);
  const photosReopened = getResidentReportedMedia(reopenedTicket);
  assert.equal(photosReopened.length, 2, 'Sau khi đóng rồi mở lại chi tiết vẫn phải đủ 2 ảnh');
});

test('2. Ticket ẩn danh qua QR có ảnh: ảnh có trước khi nhận việc, giữ nguyên sau khi nhận việc và khi đóng mở lại', () => {
  const anonTicket = {
    id: 'ticket-anon-1',
    ticketCode: '#RF-2026-200002',
    title: 'Đèn hành lang chập cháy',
    description: 'Bóng đèn nhấp nháy phát ra tia lửa.',
    isAnonymous: true,
    residentId: null,
    assignedTechId: 'tech-user-1',
    status: TicketStatus.ASSIGNED,
    locationVerificationStatus: 'UNVERIFIED',
    media: [
      {
        id: 'media-anon-1',
        ticketId: 'ticket-anon-1',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/anon-scene.jpg',
        mediaType: MediaType.SCENE_BEFORE,
        caption: 'Ảnh hiện trường 1 (Ẩn danh)',
        uploadedById: null,
      },
    ],
    photos: ['https://res.cloudinary.com/demo/image/upload/v1/anon-scene.jpg'],
    area: {
      qrCode: 'AREA-HL-B',
      areaName: 'Hành lang khu B',
    },
  };

  // Trước khi nhận việc
  const photosBefore = getResidentReportedMedia(anonTicket);
  assert.equal(photosBefore.length, 1, 'Ticket ẩn danh phải hiển thị 1 ảnh trước khi nhận việc');
  assert.equal(photosBefore[0].url, 'https://res.cloudinary.com/demo/image/upload/v1/anon-scene.jpg');

  // Sau khi nhận việc
  const acknowledgeApiResponse = {
    id: 'ticket-anon-1',
    status: TicketStatus.IN_PROGRESS,
    acknowledgedAt: new Date().toISOString(),
    media: anonTicket.media,
    photos: anonTicket.photos,
    area: anonTicket.area,
  };
  const activeTicketAfter = mergeActiveTicket(anonTicket, acknowledgeApiResponse);
  assert.equal(activeTicketAfter.status, TicketStatus.IN_PROGRESS);
  assert.equal(getResidentReportedMedia(activeTicketAfter).length, 1, 'Ảnh ẩn danh vẫn hiển thị sau khi nhận việc');
  assert.equal(activeTicketAfter.area?.qrCode, 'AREA-HL-B', 'Thông tin khu vực QR không bị mất');
});

test('3. Ticket không có ảnh: hiển thị danh sách rỗng để UI hiển thị "Chưa có ảnh hiện trường."', () => {
  const emptyTicket = {
    id: 'ticket-no-photo',
    ticketCode: '#RF-2026-300003',
    title: 'Mùi lạ ở sảnh',
    description: 'Có mùi khét nhẹ ở góc sảnh tầng 1.',
    isAnonymous: false,
    residentId: 'res-user-2',
    assignedTechId: 'tech-user-1',
    status: TicketStatus.ASSIGNED,
    media: [],
    photos: [],
  };

  const photos = getResidentReportedMedia(emptyTicket);
  assert.equal(photos.length, 0, 'Ticket không có ảnh phải trả về mảng rỗng');
});

test('4. Ticket chỉ có ảnh nghiệm thu của KTV (REPAIR_PROOF): không bị nhầm lẫn thành ảnh hiện trường', () => {
  const proofOnlyTicket = {
    id: 'ticket-proof-only',
    ticketCode: '#RF-2026-400004',
    title: 'Sửa vòi nước',
    description: 'Đã hoàn tất sửa chữa.',
    isAnonymous: false,
    residentId: 'res-user-1',
    assignedTechId: 'tech-user-1',
    status: TicketStatus.COMPLETED,
    media: [
      {
        id: 'proof-1',
        ticketId: 'ticket-proof-only',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/tech-proof.jpg',
        mediaType: MediaType.REPAIR_PROOF,
        caption: 'Ảnh nghiệm thu sau sửa',
        uploadedById: 'tech-user-1',
      },
    ],
    photos: [], // API đã lọc SCENE_BEFORE nên photos rỗng
  };

  const photos = getResidentReportedMedia(proofOnlyTicket);
  assert.equal(photos.length, 0, 'Ảnh REPAIR_PROOF của KTV tuyệt đối không được hiển thị ở mục ảnh hiện trường');
});

test('5. Ticket trả ảnh qua ticket.photos (dữ liệu cũ hoặc API không trả media): trích xuất thành công', () => {
  const legacyTicket = {
    id: 'ticket-legacy',
    ticketCode: '#RF-2026-500005',
    title: 'Ổ cắm điện lỏng',
    description: 'Cần siết lại vít ổ cắm.',
    isAnonymous: false,
    residentId: 'res-user-3',
    assignedTechId: 'tech-user-1',
    status: TicketStatus.IN_PROGRESS,
    media: [], // Không có media object
    photos: [
      'https://res.cloudinary.com/demo/image/upload/v1/legacy1.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1/legacy2.jpg',
    ],
  };

  const photos = getResidentReportedMedia(legacyTicket);
  assert.equal(photos.length, 2, 'Phải trích xuất được 2 ảnh từ mảng photos dự phòng');
  assert.equal(photos[0].url, 'https://res.cloudinary.com/demo/image/upload/v1/legacy1.jpg');
  assert.equal(photos[1].url, 'https://res.cloudinary.com/demo/image/upload/v1/legacy2.jpg');
});

test('6. Chuyển giữa hai ticket: trình xem ảnh mở đúng ảnh của từng ticket, không bị lẫn ảnh cũ', () => {
  const ticketA = {
    id: 'ticket-a',
    media: [
      { id: 'm-a', ticketId: 'ticket-a', imageUrl: 'https://example.com/photo-a.jpg', mediaType: MediaType.SCENE_BEFORE },
    ],
  };
  const ticketB = {
    id: 'ticket-b',
    media: [
      { id: 'm-b', ticketId: 'ticket-b', imageUrl: 'https://example.com/photo-b.jpg', mediaType: MediaType.SCENE_BEFORE },
    ],
  };

  const photosA = getResidentReportedMedia(ticketA);
  const photosB = getResidentReportedMedia(ticketB);

  assert.equal(photosA.length, 1);
  assert.equal(photosA[0].url, 'https://example.com/photo-a.jpg');

  assert.equal(photosB.length, 1);
  assert.equal(photosB[0].url, 'https://example.com/photo-b.jpg');
  assert.notEqual(photosA[0].url, photosB[0].url, 'Hai ticket phải có URL ảnh độc lập');

  // Kiểm tra điều kiện bảo vệ cross-ticket: media có ticketId khác ticket.id phải bị loại bỏ
  const pollutedTicket = {
    id: 'ticket-x',
    media: [
      { id: 'm-x', ticketId: 'ticket-x', imageUrl: 'https://example.com/x.jpg', mediaType: MediaType.SCENE_BEFORE },
      { id: 'm-leak', ticketId: 'ticket-OTHER', imageUrl: 'https://example.com/leak.jpg', mediaType: MediaType.SCENE_BEFORE },
    ],
  };
  const photosClean = getResidentReportedMedia(pollutedTicket);
  assert.equal(photosClean.length, 1);
  assert.equal(photosClean[0].url, 'https://example.com/x.jpg');
});

test('7. API nhận việc: thành công chuyển IN_PROGRESS, trả đủ media và photos; từ chối KTV không được phân công', async () => {
  // Mô phỏng logic route PATCH /:id/acknowledge
  const mockDb: { tickets: any[] } = {
    tickets: [
      {
        id: 't-assigned-1',
        ticketCode: '#RF-2026-700007',
        assignedTechId: 'tech-assigned-id',
        status: TicketStatus.ASSIGNED,
        residentId: 'res-id',
        area: { id: 'area-1', qrCode: 'AREA-1', areaName: 'Khu A' },
        media: [
          {
            id: 'm-1',
            imageUrl: 'https://example.com/scene.jpg',
            mediaType: MediaType.SCENE_BEFORE,
            caption: 'Ảnh hiện trường',
          },
        ],
      },
    ],
  };

  const handleAcknowledge = async (ticketId: string, userId: string, role: Role) => {
    if (role !== Role.TECHNICIAN) {
      return { status: 403, error: 'Chỉ KTV mới có quyền nhận việc' };
    }
    const ticket = mockDb.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      return { status: 404, error: 'Không tìm thấy sự cố.' };
    }
    if (ticket.assignedTechId !== userId) {
      return { status: 403, error: 'Bạn không được phân công xử lý sự cố này!' };
    }
    if (ticket.status !== TicketStatus.ASSIGNED) {
      return { status: 409, error: 'Sự cố không còn ở trạng thái chờ nhận việc.' };
    }

    // Cập nhật trạng thái
    ticket.status = TicketStatus.IN_PROGRESS;
    const formatted = {
      ...ticket,
      photos: (ticket.media as any[])
        .filter((m: any) => m.mediaType === MediaType.SCENE_BEFORE)
        .map((m: any) => m.imageUrl),
    };
    return { status: 200, success: true, ticket: formatted };
  };

  // Ca 1: KTV được phân công nhận việc hợp lệ
  const resSuccess = await handleAcknowledge('t-assigned-1', 'tech-assigned-id', Role.TECHNICIAN);
  assert.equal(resSuccess.status, 200);
  assert.equal(resSuccess.success, true);
  assert.equal(resSuccess.ticket?.status, TicketStatus.IN_PROGRESS);
  assert.equal(resSuccess.ticket?.media?.length, 1);
  assert.equal(resSuccess.ticket?.photos?.length, 1);

  // Ca 2: KTV KHÁC cố nhận việc
  const resForbidden = await handleAcknowledge('t-assigned-1', 'tech-OTHER-id', Role.TECHNICIAN);
  assert.equal(resForbidden.status, 403);
  assert.equal(resForbidden.error, 'Bạn không được phân công xử lý sự cố này!');

  // Ca 3: Cố nhận việc lại khi ticket đã IN_PROGRESS
  const resConflict = await handleAcknowledge('t-assigned-1', 'tech-assigned-id', Role.TECHNICIAN);
  assert.equal(resConflict.status, 409);
  assert.equal(resConflict.error, 'Sự cố không còn ở trạng thái chờ nhận việc.');

  // Ca 4: Ticket không tồn tại
  const resNotFound = await handleAcknowledge('non-existent-id', 'tech-assigned-id', Role.TECHNICIAN);
  assert.equal(resNotFound.status, 404);
});
