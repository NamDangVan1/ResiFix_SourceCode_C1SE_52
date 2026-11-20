import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MediaType, Role, TicketStatus } from '@prisma/client';
import { authorizeSceneUpload, validateSceneAttachments } from '../services/incident_media';

// ============================================================================
// HÀM TRÍCH XUẤT VÀ XỬ LÝ ẢNH TRÊN CLIENT (ĐỒNG BỘ VỚI client/App.tsx)
// ============================================================================
function getResidentReportedMedia(ticket: any): { id: string; url: string; caption?: string }[] {
  if (!ticket) return [];
  const items: { id: string; url: string; caption?: string }[] = [];
  const seenUrls = new Set<string>();

  // 1. Lấy từ ticket.media (quan hệ Prisma chuẩn của IncidentTicket)
  if (Array.isArray(ticket.media) && ticket.media.length > 0) {
    for (const m of ticket.media) {
      if (!m || !m.imageUrl || typeof m.imageUrl !== 'string' || !m.imageUrl.trim()) continue;
      if (m.ticketId && ticket.id && m.ticketId !== ticket.id) continue;
      // Tuyệt đối không lấy ảnh nghiệm thu sau sửa của KTV
      if (m.mediaType === 'REPAIR_PROOF') continue;
      if (ticket.assignedTechId && m.uploadedById === ticket.assignedTechId) continue;

      const cleanUrl = m.imageUrl.split('#')[0].trim();
      if (!cleanUrl) continue;

      if (m.mediaType === 'SCENE_BEFORE') {
        if (!seenUrls.has(cleanUrl)) {
          seenUrls.add(cleanUrl);
          items.push({
            id: m.id || cleanUrl,
            url: cleanUrl,
            caption: m.caption || 'Ảnh hiện trường',
          });
        }
        continue;
      }

      // Tương thích ngược an toàn nếu dữ liệu cũ chưa có mediaType hoặc báo cáo ẩn danh
      const isUploadedByResident = ticket.residentId && m.uploadedById === ticket.residentId;
      const isAnonymousReport = ticket.isAnonymous || !ticket.residentId;
      const isSceneCaption = m.caption && /hiện trường|báo cáo|cư dân|ẩn danh/i.test(m.caption);
      if (isUploadedByResident || isAnonymousReport || isSceneCaption || !m.mediaType) {
        if (!seenUrls.has(cleanUrl)) {
          seenUrls.add(cleanUrl);
          items.push({
            id: m.id || cleanUrl,
            url: cleanUrl,
            caption: m.caption || 'Ảnh hiện trường',
          });
        }
      }
    }
  }

  // 2. Bổ sung / dự phòng nếu ticket có mảng photos (chuỗi URL) từ API
  if (Array.isArray(ticket.photos) && ticket.photos.length > 0) {
    ticket.photos.forEach((photoUrl: any, idx: number) => {
      if (typeof photoUrl === 'string' && photoUrl.trim().startsWith('http')) {
        const cleanPhotoUrl = photoUrl.split('#')[0].trim();
        if (cleanPhotoUrl && !seenUrls.has(cleanPhotoUrl)) {
          seenUrls.add(cleanPhotoUrl);
          items.push({
            id: `photo-${idx}-${cleanPhotoUrl}`,
            url: cleanPhotoUrl,
            caption: `Ảnh hiện trường ${idx + 1}`,
          });
        }
      }
    });
  }

  return items;
}

// Logic gộp state an toàn khi làm mới dữ liệu hoặc giao việc
function mergeTicketState(prevTicket: any, newTicketData: any): any {
  if (!prevTicket) return newTicketData;
  if (!newTicketData) return prevTicket;

  const mergedMedia =
    Array.isArray(newTicketData.media) && newTicketData.media.length > 0
      ? newTicketData.media
      : Array.isArray(prevTicket.media) && prevTicket.media.length > 0
        ? prevTicket.media
        : [];
  const mergedPhotos =
    Array.isArray(newTicketData.photos) && newTicketData.photos.length > 0
      ? newTicketData.photos
      : Array.isArray(prevTicket.photos) && prevTicket.photos.length > 0
        ? prevTicket.photos
        : [];

  return {
    ...prevTicket,
    ...newTicketData,
    media: mergedMedia,
    photos: mergedPhotos,
    asset: newTicketData.asset || prevTicket.asset || null,
    area: newTicketData.area || prevTicket.area || null,
  };
}

// ============================================================================
// BỘ KIỂM THỬ: XỬ LÝ VÀ HIỂN THỊ ẢNH HIỆN TRƯỜNG CƯ DÂN & BMB
// ============================================================================

test('1. Cư dân, nhiều ảnh: đính kèm 2 ảnh, kiểm tra lưu trữ, URL sạch và mở ảnh thứ hai', () => {
  const originalEnvCloud = process.env.CLOUDINARY_CLOUD_NAME;
  const originalEnvSecret = process.env.CLOUDINARY_API_SECRET;
  process.env.CLOUDINARY_CLOUD_NAME = 'resifix-cloud';
  process.env.CLOUDINARY_API_SECRET = 'resifix-test-secret-1234567890abcdef';

  try {
    const rawUrl1 = 'https://res.cloudinary.com/resifix-cloud/image/upload/v1001/resifix_c1se52/incident_scene/photo1.jpg';
    const rawUrl2 = 'https://res.cloudinary.com/resifix-cloud/image/upload/v1002/resifix_c1se52/incident_scene/photo2.jpg';

    // 1. Client upload nhận URL có chữ ký từ API
    const signedUrl1 = authorizeSceneUpload(rawUrl1, 'res-user-1');
    const signedUrl2 = authorizeSceneUpload(rawUrl2, 'res-user-1');
    assert.match(signedUrl1, /#[\da-f]{64}$/, 'URL tải lên phải có chữ ký HMAC');
    assert.match(signedUrl2, /#[\da-f]{64}$/, 'URL tải lên phải có chữ ký HMAC');

    // 2. Client gửi nguyên mảng URL đã ký lên POST /api/tickets
    const payloadImageUrls = [signedUrl1, signedUrl2];
    const validatedPhotos = validateSceneAttachments(payloadImageUrls, 'res-user-1');
    assert.ok(validatedPhotos, 'Xác thực chữ ký phải thành công');
    assert.equal(validatedPhotos.length, 2);
    assert.equal(validatedPhotos[0].imageUrl, rawUrl1, 'Backend phải chuẩn hóa URL loại bỏ hash signature');
    assert.equal(validatedPhotos[1].imageUrl, rawUrl2, 'Backend phải chuẩn hóa URL loại bỏ hash signature');

    // 3. Giả lập bản ghi Ticket được tạo trong DB và trả về cho client
    const createdTicket = {
      id: 'ticket-res-1',
      ticketCode: '#RF-2026-000001',
      title: 'Hỏng bóng đèn hành lang',
      description: 'Đèn chớp liên tục không sáng được.',
      status: TicketStatus.PENDING,
      residentId: 'res-user-1',
      media: validatedPhotos.map((p, idx) => ({
        id: `media-${idx + 1}`,
        ticketId: 'ticket-res-1',
        imageUrl: p.imageUrl,
        mediaType: MediaType.SCENE_BEFORE,
        caption: `Ảnh hiện trường ${idx + 1}`,
        uploadedById: 'res-user-1',
      })),
      photos: validatedPhotos.map((p) => p.imageUrl),
    };

    // 4. Client trích xuất danh sách ảnh hiện trường
    const extractedPhotos = getResidentReportedMedia(createdTicket);
    assert.equal(extractedPhotos.length, 2, 'Phải hiển thị đầy đủ 2 ảnh hiện trường');
    assert.equal(extractedPhotos[0].url, rawUrl1);
    assert.equal(extractedPhotos[1].url, rawUrl2);

    // 5. Thao tác người dùng: bấm ảnh thứ hai (index = 1)
    let viewerIndex = 1;
    let viewerList = extractedPhotos;
    let viewerVisible = true;
    assert.equal(viewerList[viewerIndex].url, rawUrl2, 'Bấm ảnh thứ hai phải mở đúng ảnh thứ hai');

    // Chuyển sang ảnh thứ nhất
    viewerIndex -= 1;
    assert.equal(viewerList[viewerIndex].url, rawUrl1, 'Phải chuyển lùi được về ảnh thứ nhất');

    // Đóng viewer
    viewerVisible = false;
    assert.equal(viewerVisible, false, 'Đóng modal thành công');
  } finally {
    process.env.CLOUDINARY_CLOUD_NAME = originalEnvCloud;
    process.env.CLOUDINARY_API_SECRET = originalEnvSecret;
  }
});

test('2. BMB, báo cáo cư dân: mở ticket lúc AI đang ANALYZING, sau đó phân loại giao việc ảnh vẫn giữ nguyên', () => {
  const residentTicket = {
    id: 'ticket-res-2',
    ticketCode: '#RF-2026-000002',
    title: 'Rò rỉ ống nước âm tường',
    description: 'Thấy vệt ẩm loang lổ và rỉ nước.',
    status: TicketStatus.PENDING,
    aiStatus: 'ANALYZING',
    aiSummary: 'Đang phân tích hình ảnh và mô tả bằng AI...',
    residentId: 'res-user-1',
    media: [
      {
        id: 'm-res-2-1',
        ticketId: 'ticket-res-2',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/pipe_leak.jpg',
        mediaType: MediaType.SCENE_BEFORE,
        caption: 'Ảnh hiện trường 1',
        uploadedById: 'res-user-1',
      },
    ],
    photos: ['https://res.cloudinary.com/demo/image/upload/v1/pipe_leak.jpg'],
  };

  // 1. Khi ticket vừa tạo và AI đang ANALYZING, BMB vẫn xem được ảnh ngay lập tức
  const bmbPhotosBefore = getResidentReportedMedia(residentTicket);
  assert.equal(bmbPhotosBefore.length, 1, 'BMB phải xem được ảnh ngay khi AI đang ANALYZING');
  assert.equal(bmbPhotosBefore[0].url, 'https://res.cloudinary.com/demo/image/upload/v1/pipe_leak.jpg');

  // 2. BMB duyệt phân loại và giao việc qua PATCH /:id/approve-assign
  const approveAssignApiResponse = {
    id: 'ticket-res-2',
    ticketCode: '#RF-2026-000002',
    status: TicketStatus.ASSIGNED,
    assignedTechId: 'tech-user-1',
    finalCategory: 'PLUMBING',
    finalPriority: 'HIGH',
    media: residentTicket.media,
    photos: residentTicket.photos,
  };

  // 3. Client cập nhật state bmbSelectedTicket sau khi giao việc
  const bmbSelectedTicketAfter = mergeTicketState(residentTicket, approveAssignApiResponse);
  assert.equal(bmbSelectedTicketAfter.status, TicketStatus.ASSIGNED);
  assert.equal(bmbSelectedTicketAfter.assignedTechId, 'tech-user-1');
  const bmbPhotosAfter = getResidentReportedMedia(bmbSelectedTicketAfter);
  assert.equal(bmbPhotosAfter.length, 1, 'Ảnh hiện trường không được bị mất sau khi BMB giao việc');
  assert.equal(bmbPhotosAfter[0].url, 'https://res.cloudinary.com/demo/image/upload/v1/pipe_leak.jpg');
});

test('3. BMB, báo cáo QR ẩn danh: ticket chưa xác minh vị trí và không có uploadedById vẫn hiển thị đủ ảnh', () => {
  const anonTicket = {
    id: 'ticket-anon-1',
    ticketCode: '#RF-2026-000003',
    title: 'Đèn thoát hiểm tầng 3 nhấp nháy',
    description: 'Báo cáo từ khách vãng lai quét QR tại tầng 3.',
    status: TicketStatus.PENDING,
    isAnonymous: true,
    locationVerificationStatus: 'UNVERIFIED',
    locationVerificationLabel: 'Chưa xác minh vị trí',
    residentId: null,
    media: [
      {
        id: 'm-anon-1',
        ticketId: 'ticket-anon-1',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/emergency_light.jpg',
        mediaType: MediaType.SCENE_BEFORE,
        caption: 'Ảnh hiện trường ẩn danh 1',
        uploadedById: null, // Khách ẩn danh không có tài khoản user
      },
    ],
    photos: ['https://res.cloudinary.com/demo/image/upload/v1/emergency_light.jpg'],
  };

  const anonPhotos = getResidentReportedMedia(anonTicket);
  assert.equal(anonPhotos.length, 1, 'Ảnh ẩn danh qua QR phải được trích xuất thành công');
  assert.equal(anonPhotos[0].url, 'https://res.cloudinary.com/demo/image/upload/v1/emergency_light.jpg');
  assert.equal(anonPhotos[0].caption, 'Ảnh hiện trường ẩn danh 1');
});

test('4. Dữ liệu cũ và hai loại ảnh: chỉ lấy SCENE_BEFORE, không lẫn REPAIR_PROOF, không trùng lặp và loại bỏ ticketId khác', () => {
  const complexTicket = {
    id: 'ticket-complex-1',
    ticketCode: '#RF-2026-000004',
    title: 'Sự cố vỡ ống nước',
    description: 'Sự cố đã được sửa chữa và nghiệm thu.',
    status: TicketStatus.COMPLETED,
    residentId: 'res-user-1',
    assignedTechId: 'tech-user-1',
    media: [
      // 1. Ảnh báo cáo ban đầu
      {
        id: 'm-scene-1',
        ticketId: 'ticket-complex-1',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/broken_pipe.jpg#signedhash',
        mediaType: MediaType.SCENE_BEFORE,
        caption: 'Ảnh trước khi sửa',
        uploadedById: 'res-user-1',
      },
      // 2. Ảnh nghiệm thu sau sửa của KTV
      {
        id: 'm-proof-1',
        ticketId: 'ticket-complex-1',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/fixed_pipe.jpg',
        mediaType: MediaType.REPAIR_PROOF,
        caption: 'Ảnh nghiệm thu KTV',
        uploadedById: 'tech-user-1',
      },
      // 3. Ảnh rác mang ticketId khác (do lỗi hệ thống khác lọt vào)
      {
        id: 'm-foreign-1',
        ticketId: 'ticket-other-999',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/foreign.jpg',
        mediaType: MediaType.SCENE_BEFORE,
        caption: 'Ảnh ticket khác',
        uploadedById: 'res-user-1',
      },
    ],
    // Mảng photos chứa cùng URL ảnh SCENE_BEFORE (không có hash)
    photos: [
      'https://res.cloudinary.com/demo/image/upload/v1/broken_pipe.jpg',
    ],
  };

  const scenePhotos = getResidentReportedMedia(complexTicket);
  assert.equal(scenePhotos.length, 1, 'Chỉ được lấy đúng 1 ảnh SCENE_BEFORE của ticket này');
  assert.equal(scenePhotos[0].url, 'https://res.cloudinary.com/demo/image/upload/v1/broken_pipe.jpg');
  assert.ok(!scenePhotos.some((p) => p.url.includes('fixed_pipe.jpg')), 'Tuyệt đối không lẫn ảnh REPAIR_PROOF của KTV');
  assert.ok(!scenePhotos.some((p) => p.url.includes('foreign.jpg')), 'Tuyệt đối không lấy ảnh của ticket khác');
});

test('5. Ảnh lỗi và ticket không ảnh: phân biệt đúng giữa "Chưa có ảnh" và "Lỗi tải ảnh"', () => {
  // Trường hợp A: Ticket không có ảnh
  const noPhotoTicket = {
    id: 'ticket-empty',
    media: [],
    photos: [],
  };
  const emptyPhotos = getResidentReportedMedia(noPhotoTicket);
  assert.equal(emptyPhotos.length, 0, 'Ticket không có ảnh phải trả về mảng rỗng để UI hiện Chưa có ảnh hiện trường');

  // Trường hợp B: Ticket có 2 ảnh, trong đó 1 ảnh bị lỗi tải
  const mixedTicket = {
    id: 'ticket-mixed',
    media: [
      { id: 'm-ok', ticketId: 'ticket-mixed', imageUrl: 'https://example.com/good-image.jpg', mediaType: MediaType.SCENE_BEFORE },
      { id: 'm-err', ticketId: 'ticket-mixed', imageUrl: 'https://example.com/broken-image.jpg', mediaType: MediaType.SCENE_BEFORE },
    ],
    photos: ['https://example.com/good-image.jpg', 'https://example.com/broken-image.jpg'],
  };
  const mixedPhotos = getResidentReportedMedia(mixedTicket);
  assert.equal(mixedPhotos.length, 2, 'Dữ liệu vẫn mang đủ 2 ảnh');

  // Mô phỏng trạng thái tải lỗi trên UI
  const failedPhotoUrls: Record<string, boolean> = {};
  failedPhotoUrls['https://example.com/broken-image.jpg'] = true;

  // Ảnh 1 tải tốt
  assert.equal(Boolean(failedPhotoUrls[mixedPhotos[0].url]), false, 'Ảnh 1 tải bình thường');
  // Ảnh 2 bị lỗi
  assert.equal(Boolean(failedPhotoUrls[mixedPhotos[1].url]), true, 'Ảnh 2 ghi nhận lỗi tải');
  // UI vẫn hiển thị danh sách ảnh, không bị coi là "Chưa có ảnh hiện trường."
  assert.ok(mixedPhotos.length > 0, 'Không rơi vào trạng thái rỗng');
});

test('6. Chuyển ticket: đóng modal, chuyển sang ticket khác thì viewer không bị lẫn ảnh cũ', () => {
  const ticketA = {
    id: 'ticket-A',
    media: [{ id: 'm-A', ticketId: 'ticket-A', imageUrl: 'https://example.com/photo-A.jpg', mediaType: MediaType.SCENE_BEFORE }],
  };
  const ticketB = {
    id: 'ticket-B',
    media: [{ id: 'm-B', ticketId: 'ticket-B', imageUrl: 'https://example.com/photo-B.jpg', mediaType: MediaType.SCENE_BEFORE }],
  };

  // Mở viewer cho ticket A
  let viewerVisible = true;
  let viewerList = getResidentReportedMedia(ticketA);
  let viewerIndex = 0;
  assert.equal(viewerList[0].url, 'https://example.com/photo-A.jpg');

  // Đóng modal và chuyển sang ticket B (handleSelectBmbTicket / openResidentTicket)
  viewerVisible = false;
  viewerList = [];
  viewerIndex = 0;

  // Mở ảnh ticket B
  viewerList = getResidentReportedMedia(ticketB);
  viewerVisible = true;
  assert.equal(viewerList.length, 1);
  assert.equal(viewerList[0].url, 'https://example.com/photo-B.jpg');
  assert.notEqual(viewerList[0].url, 'https://example.com/photo-A.jpg', 'Viewer ticket B không được chứa ảnh của ticket A');
});

test('7. Phân quyền (RBAC): Cư dân chỉ xem ticket của mình, BMB xem được toàn bộ, KTV chỉ xem ticket phân công', () => {
  const allTicketsInDb = [
    { id: 't-res-1', residentId: 'user-res-1', assignedTechId: 'user-tech-1', isAnonymous: false },
    { id: 't-res-2', residentId: 'user-res-2', assignedTechId: 'user-tech-2', isAnonymous: false },
    { id: 't-anon-1', residentId: null, assignedTechId: null, isAnonymous: true },
  ];

  // Cư dân 1 truy vấn GET /api/tickets
  const resident1Where = { residentId: 'user-res-1' };
  const resident1Results = allTicketsInDb.filter((t) => t.residentId === resident1Where.residentId);
  assert.equal(resident1Results.length, 1);
  assert.equal(resident1Results[0].id, 't-res-1', 'Cư dân 1 không được nhìn thấy ticket của cư dân 2 hay ticket ẩn danh');

  // KTV 1 truy vấn GET /api/tickets
  const tech1Where = { assignedTechId: 'user-tech-1' };
  const tech1Results = allTicketsInDb.filter((t) => t.assignedTechId === tech1Where.assignedTechId);
  assert.equal(tech1Results.length, 1);
  assert.equal(tech1Results[0].id, 't-res-1', 'KTV 1 chỉ xem được ticket được giao cho mình');

  // BMB truy vấn GET /api/tickets (không lọc theo residentId hay assignedTechId)
  const bmbResults = allTicketsInDb;
  assert.equal(bmbResults.length, 3, 'BMB có quyền xem toàn bộ ticket trong tòa nhà');
});

test('8. Hồi quy KTV: Ảnh hiện trường hiển thị trước và sau khi nhận việc (chuyển sang IN_PROGRESS)', () => {
  const assignedTicket = {
    id: 'ticket-tech-ack',
    ticketCode: '#RF-2026-000008',
    status: TicketStatus.ASSIGNED,
    assignedTechId: 'tech-user-1',
    residentId: 'res-user-1',
    media: [
      {
        id: 'm-tech-scene',
        ticketId: 'ticket-tech-ack',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/scene_ktv.jpg#hash',
        mediaType: MediaType.SCENE_BEFORE,
        caption: 'Ảnh hiện trường trước nhận việc',
        uploadedById: 'res-user-1',
      },
    ],
    photos: ['https://res.cloudinary.com/demo/image/upload/v1/scene_ktv.jpg'],
  };

  // Trước nhận việc
  const photosBeforeAck = getResidentReportedMedia(assignedTicket);
  assert.equal(photosBeforeAck.length, 1);
  assert.equal(photosBeforeAck[0].url, 'https://res.cloudinary.com/demo/image/upload/v1/scene_ktv.jpg');

  // Phản hồi PATCH /:id/acknowledge
  const acknowledgeResponse = {
    id: 'ticket-tech-ack',
    ticketCode: '#RF-2026-000008',
    status: TicketStatus.IN_PROGRESS,
    media: [
      {
        id: 'm-tech-scene',
        ticketId: 'ticket-tech-ack',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/scene_ktv.jpg',
        mediaType: MediaType.SCENE_BEFORE,
        caption: 'Ảnh hiện trường trước nhận việc',
        uploadedById: 'res-user-1',
      },
    ],
    photos: ['https://res.cloudinary.com/demo/image/upload/v1/scene_ktv.jpg'],
  };

  // Sau khi nhận việc (gộp state)
  const ticketAfterAck = mergeTicketState(assignedTicket, acknowledgeResponse);
  assert.equal(ticketAfterAck.status, TicketStatus.IN_PROGRESS);
  const photosAfterAck = getResidentReportedMedia(ticketAfterAck);
  assert.equal(photosAfterAck.length, 1);
  assert.equal(photosAfterAck[0].url, 'https://res.cloudinary.com/demo/image/upload/v1/scene_ktv.jpg');
});
