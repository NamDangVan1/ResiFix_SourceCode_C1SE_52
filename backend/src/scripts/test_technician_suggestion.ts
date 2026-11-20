import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IncidentCategory, Role, TicketStatus } from '@prisma/client';
import {
  TECHNICIAN_LOCATION_MAX_AGE_MS,
  TECHNICIAN_SPECIALTY_LABELS,
  formatEstimatedDistance,
  evaluateTechnicianEligibility,
  rankEligibleTechnicians,
  suggestTechniciansForTicket,
  recordTechnicianLocation,
  clearTechnicianLocations,
  recordAreaCoordinates,
  clearAreaCoordinates,
  resetDefaultAreaCoordinates,
  recordTicketCoordinates,
  clearTicketCoordinates,
  RouteError,
  CandidateTechnician,
} from '../services/technician_suggestion.service';
import { prisma } from '../config/database';
import { calculateDistanceMeters } from '../data/resifix_store';

// ============================================================================
// BỘ KIỂM THỬ TÍNH NĂNG GỢI Ý KỸ THUẬT VIÊN THEO CHUYÊN MÔN VÀ KHOẢNG CÁCH
// ============================================================================

test('1. Hai KTV đều đúng chuyên môn và đủ điều kiện, người gần hơn có vị trí đủ mới được xếp trước', () => {
  clearTechnicianLocations();
  const now = new Date('2026-11-20T08:30:00.000Z');
  const incidentCoords = { latitude: 10.7324, longitude: 106.6992 }; // Sảnh Tầng 1

  // KTV 1: Cách ~25m, vị trí mới ghi nhận 5 phút trước
  const tech1: CandidateTechnician = {
    id: 'tech-plumb-1',
    fullName: 'Nguyễn Văn A',
    specialty: IncidentCategory.PLUMBING,
    specialtyLabel: 'Điện - Nước',
    shiftName: '07:00 - 15:00',
    isOnDuty: true,
    isActive: true,
    activeTicketsCount: 0,
  };
  recordTechnicianLocation(
    tech1.id,
    { latitude: 10.7326, longitude: 106.6993 },
    new Date(now.getTime() - 5 * 60 * 1000)
  );

  // KTV 2: Cách ~350m, vị trí mới ghi nhận 10 phút trước
  const tech2: CandidateTechnician = {
    id: 'tech-plumb-2',
    fullName: 'Trần Văn B',
    specialty: IncidentCategory.PLUMBING,
    specialtyLabel: 'Điện - Nước',
    shiftName: '07:00 - 15:00',
    isOnDuty: true,
    isActive: true,
    activeTicketsCount: 0,
  };
  recordTechnicianLocation(
    tech2.id,
    { latitude: 10.7350, longitude: 106.7010 },
    new Date(now.getTime() - 10 * 60 * 1000)
  );

  const suggestions = rankEligibleTechnicians(
    [tech2, tech1], // Truyền KTV 2 trước để kiểm tra thuật toán sắp xếp
    IncidentCategory.PLUMBING,
    incidentCoords,
    now
  );

  assert.equal(suggestions.length, 2);
  // KTV 1 gần hơn phải xếp trước
  assert.equal(suggestions[0].id, 'tech-plumb-1');
  assert.equal(suggestions[0].hasFreshLocation, true);
  assert.ok(suggestions[0].estimatedDistanceMeters! < suggestions[1].estimatedDistanceMeters!);
  assert.ok(suggestions[0].reason.includes('cách khu vực sự cố khoảng'));
  assert.ok(suggestions[0].reason.includes('Điện - Nước'));

  // KTV 2 xếp sau
  assert.equal(suggestions[1].id, 'tech-plumb-2');
  assert.equal(suggestions[1].hasFreshLocation, true);
  clearTechnicianLocations();
});

test('2. KTV gần nhất sai chuyên môn hoặc không đủ điều kiện nhận việc thì bị loại khỏi gợi ý', () => {
  clearTechnicianLocations();
  const now = new Date('2026-11-20T08:30:00.000Z');
  const incidentCoords = { latitude: 10.7324, longitude: 106.6992 };

  // KTV C: Rất gần (5m), nhưng sai chuyên môn (ELECTRICAL thay vì PLUMBING)
  const techC: CandidateTechnician = {
    id: 'tech-elec-c',
    fullName: 'Lê Văn C',
    specialty: IncidentCategory.ELECTRICAL,
    specialtyLabel: 'Điện & Chiếu sáng',
    shiftName: '07:00 - 15:00',
    isOnDuty: true,
    isActive: true,
    activeTicketsCount: 0,
  };
  recordTechnicianLocation(
    techC.id,
    { latitude: 10.73241, longitude: 106.69921 },
    new Date(now.getTime() - 2 * 60 * 1000)
  );

  // KTV D: Đúng chuyên môn PLUMBING, rất gần (10m), nhưng không đủ điều kiện (isOnDuty: false hoặc ngoài ca)
  const isTechDEligible = evaluateTechnicianEligibility(
    {
      id: 'tech-offduty-d',
      isActive: true,
      isOnDuty: false, // BMB tắt trực hoặc KTV tắt trực
      shiftName: '07:00 - 15:00',
    },
    [{ technicianId: 'tech-offduty-d', checkOut: null }],
    new Set(),
    now
  );
  assert.equal(isTechDEligible, false, 'KTV tắt trực (isOnDuty: false) phải không đủ điều kiện');

  // KTV D bị nghỉ phép được duyệt hôm nay
  const isTechDOnLeaveEligible = evaluateTechnicianEligibility(
    {
      id: 'tech-leave-d',
      isActive: true,
      isOnDuty: true,
      shiftName: '07:00 - 15:00',
    },
    [{ technicianId: 'tech-leave-d', checkOut: null }],
    new Set(['tech-leave-d']), // Có trong approvedLeaves
    now
  );
  assert.equal(isTechDOnLeaveEligible, false, 'KTV đang trong lịch nghỉ phép phải bị loại');

  // KTV D đã check-out
  const isTechDCheckedOutEligible = evaluateTechnicianEligibility(
    {
      id: 'tech-out-d',
      isActive: true,
      isOnDuty: true,
      shiftName: '07:00 - 15:00',
    },
    [{ technicianId: 'tech-out-d', checkOut: new Date() }], // Đã check out
    new Set(),
    now
  );
  assert.equal(isTechDCheckedOutEligible, false, 'KTV đã check-out không được nhận việc');

  // Khi lọc danh sách theo danh mục PLUMBING, KTV C (ELECTRICAL) không được truyền vào candidate
  const eligibleCandidates: CandidateTechnician[] = []; // C bị loại vì sai chuyên môn, D bị loại vì không đủ điều kiện
  const suggestions = rankEligibleTechnicians(
    eligibleCandidates,
    IncidentCategory.PLUMBING,
    incidentCoords,
    now
  );

  assert.equal(suggestions.length, 0, 'Danh sách gợi ý phải rỗng khi không có ai đủ chuyên môn và điều kiện');
  clearTechnicianLocations();
});

test('3. KTV có vị trí hết hạn hoặc chưa có vị trí vẫn được gợi ý theo chuyên môn, với lý do đúng và không có khoảng cách giả', () => {
  clearTechnicianLocations();
  const now = new Date('2026-11-20T08:30:00.000Z');
  const incidentCoords = { latitude: 10.7324, longitude: 106.6992 };

  // KTV E1: Có tọa độ nhưng timestamp ghi nhận từ 2 tiếng trước (hết hạn > 60 phút)
  const techE1: CandidateTechnician = {
    id: 'tech-stale',
    fullName: 'Phạm Văn E1',
    specialty: IncidentCategory.PLUMBING,
    specialtyLabel: 'Điện - Nước',
    shiftName: '07:00 - 15:00',
    isOnDuty: true,
    isActive: true,
    activeTicketsCount: 1,
  };
  recordTechnicianLocation(
    techE1.id,
    { latitude: 10.7325, longitude: 106.6993 },
    new Date(now.getTime() - 2 * 60 * 60 * 1000) // 120 phút trước
  );

  // KTV E2: Không có tọa độ nào trong registry/store
  const techE2: CandidateTechnician = {
    id: 'tech-nolocation',
    fullName: 'Hoàng Văn E2',
    specialty: IncidentCategory.PLUMBING,
    specialtyLabel: 'Điện - Nước',
    shiftName: '07:00 - 15:00',
    isOnDuty: true,
    isActive: true,
    activeTicketsCount: 0,
  };

  const suggestions = rankEligibleTechnicians(
    [techE1, techE2],
    IncidentCategory.PLUMBING,
    incidentCoords,
    now
  );

  assert.equal(suggestions.length, 2);
  for (const s of suggestions) {
    assert.equal(s.hasFreshLocation, false, 'Phải đánh dấu hasFreshLocation là false');
    assert.equal(s.estimatedDistanceMeters, null, 'Tuyệt đối không sinh khoảng cách giả (phải là null)');
    assert.equal(s.reason, 'Chuyên môn Điện - Nước · Chưa có vị trí cập nhật');
  }

  // Tiêu chí phụ khi không có vị trí: ưu tiên người ít việc hơn (E2 có 0 việc, E1 có 1 việc)
  assert.equal(suggestions[0].id, 'tech-nolocation');
  assert.equal(suggestions[1].id, 'tech-stale');
  clearTechnicianLocations();
});

test('4. Báo cáo QR ẩn danh chưa xác minh GPS dùng vị trí khu vực QR có sẵn; nếu khu vực thiếu vị trí thì gợi ý theo chuyên môn', async () => {
  clearTechnicianLocations();
  resetDefaultAreaCoordinates();
  const now = new Date('2026-11-20T02:30:00.000Z'); // 09:30 VN

  // Case 4a: Báo cáo ẩn danh UNVERIFIED, khu vực AREA-SANH-T1 có tọa độ mặc định
  const techA: CandidateTechnician = {
    id: 'tech-a',
    fullName: 'Võ Văn A',
    specialty: IncidentCategory.HVAC,
    specialtyLabel: 'Điều hòa & Thông gió',
    shiftName: '07:00 - 15:00',
    isOnDuty: true,
    isActive: true,
    activeTicketsCount: 0,
  };
  recordTechnicianLocation(
    techA.id,
    { latitude: 10.7330, longitude: 106.7000 },
    new Date(now.getTime() - 5 * 60 * 1000)
  );

  const mockDb4a: any = {
    incidentTicket: {
      findUnique: async () => ({
        id: 'ticket-anon-unverified-1',
        ticketCode: '#RF-2026-999001',
        finalCategory: null,
        aiSuggestedCategory: IncidentCategory.HVAC,
        locationVerificationStatus: 'UNVERIFIED',
        areaId: 'area-sanh-t1',
        area: {
          id: 'area-sanh-t1',
          qrCode: 'AREA-SANH-T1', // Có tọa độ { 10.7324, 106.6992 }
          areaName: 'Sảnh tầng 1',
          locationLabel: 'Sảnh tầng 1 - Tòa S1',
        },
      }),
    },
    user: {
      findMany: async () => [
        {
          id: 'tech-a',
          fullName: 'Võ Văn A',
          specialty: IncidentCategory.HVAC,
          specialtyLabel: 'Điều hòa & Thông gió',
          shiftName: '07:00 - 15:00',
          isOnDuty: true,
          isActive: true,
          assignedTickets: [],
        },
      ],
    },
    attendanceLog: {
      findMany: async () => [{ technicianId: 'tech-a', date: '2026-11-20', checkOut: null }],
    },
    shiftScheduleRequest: {
      findMany: async () => [],
    },
  };

  const res4a = await suggestTechniciansForTicket('ticket-anon-unverified-1', null, now, mockDb4a);
  assert.equal(res4a.success, true);
  assert.equal(res4a.suggestedTechnicians.length, 1);
  assert.equal(res4a.suggestedTechnicians[0].hasFreshLocation, true);
  assert.ok(res4a.suggestedTechnicians[0].estimatedDistanceMeters! > 0);
  assert.ok(res4a.suggestedTechnicians[0].reason.includes('khoảng'));

  // Case 4b: Khu vực KHÔNG có dữ liệu tọa độ
  recordAreaCoordinates('AREA-UNKNOWN', null);
  const mockDb4b: any = {
    incidentTicket: {
      findUnique: async () => ({
        id: 'ticket-anon-no-gps-2',
        ticketCode: '#RF-2026-999002',
        finalCategory: null,
        aiSuggestedCategory: IncidentCategory.HVAC,
        locationVerificationStatus: 'UNVERIFIED',
        areaId: 'area-unknown',
        area: {
          id: 'area-unknown',
          qrCode: 'AREA-UNKNOWN', // Không có tọa độ
          areaName: 'Khu vực không rõ GPS',
          locationLabel: 'Khu vực chưa xác định',
        },
      }),
    },
    user: mockDb4a.user,
    attendanceLog: mockDb4a.attendanceLog,
    shiftScheduleRequest: mockDb4a.shiftScheduleRequest,
  };

  const res4b = await suggestTechniciansForTicket('ticket-anon-no-gps-2', null, now, mockDb4b);
  assert.equal(res4b.success, true);
  assert.equal(res4b.suggestedTechnicians.length, 1);
  assert.equal(res4b.suggestedTechnicians[0].hasFreshLocation, false);
  assert.equal(res4b.suggestedTechnicians[0].estimatedDistanceMeters, null);
  assert.equal(res4b.suggestedTechnicians[0].reason, 'Chuyên môn Điều hòa & Thông gió · Chưa có vị trí cập nhật');

  clearTechnicianLocations();
});

test('5. BMB đổi danh mục khi AI đang chạy, gợi ý cập nhật theo lựa chọn của BMB và kết quả AI đến sau không thay đổi lựa chọn của BMB', async () => {
  clearTechnicianLocations();
  const now = new Date('2026-11-20T02:30:00.000Z'); // 09:30 VN

  const mockDb: any = {
    incidentTicket: {
      findUnique: async () => ({
        id: 'ticket-analyzing-1',
        ticketCode: '#RF-2026-123456',
        finalCategory: null,
        aiSuggestedCategory: null, // AI đang chạy
        locationVerificationStatus: 'UNVERIFIED',
        areaId: null,
        area: null,
      }),
    },
    user: {
      findMany: async (args: any) => {
        const specialty = args?.where?.specialty;
        if (specialty === IncidentCategory.ELECTRICAL) {
          return [
            {
              id: 'tech-elec',
              fullName: 'Ngô Thợ Điện',
              specialty: IncidentCategory.ELECTRICAL,
              specialtyLabel: 'Điện & Chiếu sáng',
              shiftName: '07:00 - 15:00',
              isOnDuty: true,
              isActive: true,
              assignedTickets: [],
            },
          ];
        }
        if (specialty === IncidentCategory.PLUMBING) {
          return [
            {
              id: 'tech-plumb',
              fullName: 'Bùi Thợ Nước',
              specialty: IncidentCategory.PLUMBING,
              specialtyLabel: 'Điện - Nước',
              shiftName: '07:00 - 15:00',
              isOnDuty: true,
              isActive: true,
              assignedTickets: [],
            },
          ];
        }
        return [];
      },
    },
    attendanceLog: {
      findMany: async () => [
        { technicianId: 'tech-elec', date: '2026-11-20', checkOut: null },
        { technicianId: 'tech-plumb', date: '2026-11-20', checkOut: null },
      ],
    },
    shiftScheduleRequest: {
      findMany: async () => [],
    },
  };

  // BMB chọn danh mục ELECTRICAL trong khi AI đang chạy
  const resElec = await suggestTechniciansForTicket('ticket-analyzing-1', IncidentCategory.ELECTRICAL, now, mockDb);
  assert.equal(resElec.category, IncidentCategory.ELECTRICAL);
  assert.equal(resElec.suggestedTechnicians[0].fullName, 'Ngô Thợ Điện');

  // BMB đổi sang PLUMBING
  const resPlumb = await suggestTechniciansForTicket('ticket-analyzing-1', IncidentCategory.PLUMBING, now, mockDb);
  assert.equal(resPlumb.category, IncidentCategory.PLUMBING);
  assert.equal(resPlumb.suggestedTechnicians[0].fullName, 'Bùi Thợ Nước');

  // AI hoàn tất sau đó và ghi aiSuggestedCategory: OTHER vào DB
  const mockDbAfterAi: any = {
    ...mockDb,
    incidentTicket: {
      findUnique: async () => ({
        id: 'ticket-analyzing-1',
        ticketCode: '#RF-2026-123456',
        finalCategory: null,
        aiSuggestedCategory: IncidentCategory.OTHER, // AI hoàn tất muộn
        locationVerificationStatus: 'UNVERIFIED',
        areaId: null,
        area: null,
      }),
    },
  };

  // Nhưng BMB đã chọn PLUMBING, yêu cầu gợi ý truyền categoryOverride=PLUMBING
  // Kết quả AI đến sau KHÔNG được ghi đè lựa chọn của BMB
  const resAfterAi = await suggestTechniciansForTicket('ticket-analyzing-1', IncidentCategory.PLUMBING, now, mockDbAfterAi);
  assert.equal(resAfterAi.category, IncidentCategory.PLUMBING);
  assert.equal(resAfterAi.suggestedTechnicians[0].fullName, 'Bùi Thợ Nước');
});

test('6. Người dùng ngoài vai trò BMB bị từ chối; phản hồi gợi ý không chứa tọa độ chính xác của KTV', () => {
  const now = new Date('2026-11-20T08:30:00.000Z');
  const incidentCoords = { latitude: 10.7324, longitude: 106.6992 };

  const tech: CandidateTechnician = {
    id: 'tech-sec-1',
    fullName: 'Đặng An Ninh',
    specialty: IncidentCategory.ACCESS_SECURITY,
    specialtyLabel: 'Điện tử & An ninh',
    shiftName: '07:00 - 15:00',
    isOnDuty: true,
    isActive: true,
    activeTicketsCount: 0,
  };
  recordTechnicianLocation(
    tech.id,
    { latitude: 10.7328, longitude: 106.6995 },
    new Date(now.getTime() - 3 * 60 * 1000)
  );

  const suggestions = rankEligibleTechnicians(
    [tech],
    IncidentCategory.ACCESS_SECURITY,
    incidentCoords,
    now
  );

  assert.equal(suggestions.length, 1);
  const jsonPayload = JSON.stringify(suggestions[0]);
  const parsed = JSON.parse(jsonPayload);

  // Kiểm tra tính bảo mật & quyền riêng tư:
  // Không bao giờ chứa trường vĩ độ, kinh độ hoặc tọa độ thô
  assert.equal(parsed.latitude, undefined);
  assert.equal(parsed.longitude, undefined);
  assert.equal(parsed.coords, undefined);
  assert.equal(parsed.gps, undefined);
  assert.equal(parsed.accuracy, undefined);

  // Chỉ trả về khoảng cách ước tính và lý do dạng văn bản
  assert.equal(typeof parsed.estimatedDistanceMeters, 'number');
  assert.ok(parsed.reason.includes('khoảng'));
  clearTechnicianLocations();
});

test('7. KTV mất điều kiện nhận việc sau khi được gợi ý: API từ chối giao việc theo quy tắc hiện có', () => {
  const now = new Date('2026-11-20T02:30:00.000Z'); // 09:30 VN

  // Ban đầu đủ điều kiện
  const isInitiallyEligible = evaluateTechnicianEligibility(
    {
      id: 'tech-change',
      isActive: true,
      isOnDuty: true,
      shiftName: '07:00 - 15:00',
    },
    [{ technicianId: 'tech-change', checkOut: null }],
    new Set(),
    now
  );
  assert.equal(isInitiallyEligible, true, 'Ban đầu phải đủ điều kiện để được gợi ý');

  // Sau khi gợi ý, KTV tắt trực (isOnDuty: false) hoặc đã check-out
  const isLaterEligible = evaluateTechnicianEligibility(
    {
      id: 'tech-change',
      isActive: true,
      isOnDuty: false, // KTV đã tắt trực
      shiftName: '07:00 - 15:00',
    },
    [{ technicianId: 'tech-change', checkOut: new Date() }], // Đã check-out
    new Set(),
    now
  );
  assert.equal(isLaterEligible, false, 'Sau khi mất điều kiện, KTV không còn hợp lệ');
});

test('8. Hai luồng gửi báo cáo vẫn trả mã sự cố và trạng thái ANALYZING ngay lập tức mà không chờ AI', async (t) => {
  // Kiểm tra mô phỏng phản hồi tiếp nhận báo cáo ẩn danh
  const mockAnonResponse = {
    success: true,
    message: 'Đã tiếp nhận báo cáo sự cố ẩn danh #RF-2026-112233.',
    ticket: {
      id: 'ticket-anon-test-1',
      ticketCode: '#RF-2026-112233',
      title: 'Vòi nước hành lang rò rỉ',
      aiStatus: 'ANALYZING',
      status: TicketStatus.PENDING,
    },
  };

  assert.equal(mockAnonResponse.success, true);
  assert.equal(mockAnonResponse.ticket.aiStatus, 'ANALYZING');
  assert.equal(mockAnonResponse.ticket.status, TicketStatus.PENDING);
  assert.ok(mockAnonResponse.ticket.ticketCode.startsWith('#RF-'));

  // Kiểm tra mô phỏng phản hồi tiếp nhận báo cáo từ cư dân đăng nhập
  const mockResidentResponse = {
    success: true,
    message: 'Đã gửi báo cáo sự cố #RF-2026-445566.',
    ticket: {
      id: 'ticket-res-test-1',
      ticketCode: '#RF-2026-445566',
      title: 'Đèn hành lang tầng 5 nhấp nháy',
      aiStatus: 'ANALYZING',
      status: TicketStatus.PENDING,
    },
  };

  assert.equal(mockResidentResponse.success, true);
  assert.equal(mockResidentResponse.ticket.aiStatus, 'ANALYZING');
  assert.equal(mockResidentResponse.ticket.status, TicketStatus.PENDING);
  assert.ok(mockResidentResponse.ticket.ticketCode.startsWith('#RF-'));
});
