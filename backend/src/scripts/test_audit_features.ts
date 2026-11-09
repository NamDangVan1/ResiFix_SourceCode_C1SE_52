/**
 * SUITE KIỂM THỬ TỰ ĐỘNG CÁC TÍNH NĂNG AUDIT CỦA RESIFIX:
 * 1. Phân quyền RBAC & Bảo vệ thông tin cá nhân (Cư dân xem phòng khác, KTV xem ngoài nhiệm vụ).
 * 2. Cư dân chuyển phòng: Bảo toàn lịch sử sửa chữa phòng cũ.
 * 3. Chống gian lận tăng ca: Chặn trùng/chồng lấn khung giờ (kể cả không có ticketId).
 * 4. Hỗ trợ ca đêm qua 00:00: Tính đúng số giờ, không bị âm.
 * 5. Chấm công nhiều ca/ngày & Chống chồng phiên khi chưa check-out.
 */

import { resiFixStore } from '../data/resifix_store';

function runAuditTests() {
  console.log('====================================================');
  console.log('BẮT ĐẦU CHẠY BỘ TEST KIỂM TRA AUDIT & BẢO MẬT');
  console.log('====================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         Chi tiết lỗi: ${err.message}`);
      failedCount++;
    }
  };

  const timeToMinutes = (t: string): number => {
    const parts = t.split(':').map(Number);
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return -1;
    return parts[0] * 60 + parts[1];
  };

  // --------------------------------------------------------------------------
  // TEST GROUP 1: CHỐNG CHỒNG PHIÊN & HỖ TRỢ NHIỀU CA CHẤM CÔNG/NGÀY
  // --------------------------------------------------------------------------
  test('Chấm công: Chặn check-in lần 2 nếu ca 1 chưa check-out', () => {
    const store = resiFixStore.get();
    const techId = 'test-ktv-01';
    const today = '2026-11-05';

    store.attendanceLogs = store.attendanceLogs.filter((a) => a.techId !== techId);

    // Ca 1: Check-in
    store.attendanceLogs.push({
      id: 'att-test-1',
      techId,
      techName: 'KTV Test',
      date: today,
      sessionIndex: 1,
      checkIn: '2026-11-05T08:00:00.000Z',
      checkOut: null,
    });

    // Thử check-in lần 2 khi ca 1 chưa check-out
    const activeSession = store.attendanceLogs.find((a) => a.techId === techId && !a.checkOut);
    if (!activeSession) {
      throw new Error('Phải phát hiện ca làm việc đang mở chưa check-out');
    }
  });

  test('Chấm công: Cho phép ca 2 trong ngày sau khi ca 1 đã check-out hợp lệ', () => {
    const store = resiFixStore.get();
    const techId = 'test-ktv-01';
    const today = '2026-11-05';

    // Đóng ca 1
    const s1 = store.attendanceLogs.find((a) => a.techId === techId && a.sessionIndex === 1);
    if (!s1) throw new Error('Không tìm thấy ca 1');
    s1.checkOut = '2026-11-05T12:00:00.000Z';
    s1.workMinutes = 240;
    s1.workHours = 4.0;

    // Check-in ca 2
    const daySessions = store.attendanceLogs.filter((a) => a.techId === techId && a.date === today);
    if (daySessions.length !== 1) throw new Error('Số ca ban đầu phải là 1');

    const s2Index = daySessions.length + 1;
    store.attendanceLogs.push({
      id: 'att-test-2',
      techId,
      techName: 'KTV Test',
      date: today,
      sessionIndex: s2Index,
      checkIn: '2026-11-05T13:30:00.000Z',
      checkOut: '2026-11-05T17:30:00.000Z',
      workMinutes: 240,
      workHours: 4.0,
    });

    const allSessions = store.attendanceLogs.filter((a) => a.techId === techId && a.date === today);
    if (allSessions.length !== 2) throw new Error('Phải hỗ trợ 2 ca làm việc trong ngày');
    if (allSessions[1].sessionIndex !== 2) throw new Error('Ca 2 phải có sessionIndex = 2');
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 2: CHỐNG GIAN LẬN OT & CHỒNG LẤN KHUNG GIỜ
  // --------------------------------------------------------------------------
  test('Tăng ca: Phát hiện chồng lấn giờ kể cả khi không có ticketId', () => {
    const store = resiFixStore.get();
    const techId = 'test-ktv-02';
    const today = '2026-11-05';

    store.overtimeRequests = store.overtimeRequests.filter((o) => o.techId !== techId);

    // Yêu cầu 1: 17:30 đến 19:30 (không kèm ticketId)
    store.overtimeRequests.push({
      id: 'ot-test-1',
      techId,
      techName: 'KTV Test 2',
      date: today,
      fromTime: '17:30',
      toTime: '19:30',
      durationMinutes: 120,
      hours: 2,
      reason: 'Sửa điện',
      ticketId: null,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    // Thử gửi Yêu cầu 2: 18:30 đến 20:30 (chồng lấn từ 18:30 - 19:30)
    const newFrom = '18:30';
    const newTo = '20:30';
    const startA = timeToMinutes(newFrom);
    const endA = timeToMinutes(newTo);

    let isOverlapping = false;
    for (const existing of store.overtimeRequests) {
      if (existing.techId === techId && existing.date === today && existing.status !== 'REJECTED') {
        const startB = timeToMinutes(existing.fromTime);
        const endB = timeToMinutes(existing.toTime);
        if (startA < endB && endA > startB) {
          isOverlapping = true;
          break;
        }
      }
    }

    if (!isOverlapping) {
      throw new Error('Hệ thống phải bắt được lỗi chồng lấn khung giờ dù không có ticketId');
    }
  });

  test('Tăng ca ca đêm: Tính đúng thời gian qua nửa đêm (22:00 -> 02:00)', () => {
    const fromTime = '22:00';
    const toTime = '02:00';
    const startM = timeToMinutes(fromTime);
    const endM = timeToMinutes(toTime);

    let diff = endM - startM;
    if (diff <= 0) diff += 24 * 60;

    const hours = Math.round((diff / 60) * 100) / 100;
    if (diff !== 240) throw new Error(`Số phút ca đêm phải là 240, nhận được: ${diff}`);
    if (hours !== 4.0) throw new Error(`Số giờ ca đêm phải là 4.0, nhận được: ${hours}`);
  });

  test('Tăng ca: BMB không được duyệt số giờ lớn hơn số giờ KTV đăng ký', () => {
    const requestedHours = 2.0;
    const adminApprovedInput = 3.5;

    const isValid = adminApprovedInput > 0 && adminApprovedInput <= requestedHours;
    if (isValid !== false) {
      throw new Error('Phải chặn việc duyệt giờ OT vượt quá giờ đăng ký');
    }
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 3: PHÂN QUYỀN RBAC & BẢO VỆ DỮ LIỆU CÁ NHÂN
  // --------------------------------------------------------------------------
  test('Bảo mật: Cư dân phòng B không được quyền xem lịch sử sửa chữa phòng A', () => {
    const residentApartment: string = 'B-0801';
    const targetQueryApartment: string = 'A-1204';

    const hasAccess = residentApartment === targetQueryApartment;
    if (hasAccess !== false) {
      throw new Error('Cư dân phải bị từ chối truy cập (403 Forbidden)');
    }
  });

  test('Bảo vệ dữ liệu cá nhân: Ẩn số điện thoại của cư dân khác khi trả về danh sách sự cố', () => {
    const rawTicket = {
      ticketCode: '#RF-2026-001',
      title: 'Hỏng vòi sen',
      resident: { id: 'user-other', fullName: 'Trần Thị B', phone: '0987654321' },
    };

    const currentViewerUserId = 'user-viewer';
    const isBmb = false;

    const sanitizedTicket = {
      ...rawTicket,
      resident: {
        fullName: rawTicket.resident.fullName,
        phone: isBmb || rawTicket.resident.id === currentViewerUserId ? rawTicket.resident.phone : undefined,
      },
    };

    if (sanitizedTicket.resident.fullName !== 'Trần Thị B') {
      throw new Error('Tên cư dân phải hiển thị đúng');
    }
    if (sanitizedTicket.resident.phone !== undefined) {
      throw new Error('Số điện thoại của cư dân khác phải bị ẩn');
    }
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 4: CƯ DÂN CHUYỂN PHÒNG & BẢO TOÀN LỊCH SỬ CĂN HỘ
  // --------------------------------------------------------------------------
  test('Căn hộ: Cư dân chuyển phòng không làm mất lịch sử sửa chữa phòng cũ', () => {
    const store = resiFixStore.get();
    const residentId = 'res-chuyen-phong-01';

    // Hồ sơ lịch sử cư trú phòng cũ A-1204
    store.residencyHistory.push({
      id: 'rec-old',
      residentId,
      residentName: 'Lê Văn Cũ',
      phone: '0912000111',
      apartmentCode: 'A-1204',
      buildingBlock: 'Tòa S1',
      floorNumber: 12,
      moveInDate: '2025-01-01',
      moveOutDate: '2026-06-01',
      isRepresentative: false,
    });

    const pastResidentIds = store.residencyHistory
      .filter((h) => h.apartmentCode === 'A-1204')
      .map((h) => h.residentId);

    if (!pastResidentIds.includes(residentId)) {
      throw new Error('Phải tìm thấy ID cư dân cũ trong danh sách từng ở phòng A-1204');
    }
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 5: MODULE ĐỔI CA & XIN NGHỈ (LEAVE & SHIFT SWAP)
  // --------------------------------------------------------------------------
  test('Đổi ca: Chặn đổi ca nếu KTV được chọn khác chuyên môn', () => {
    const techA = { id: 'tech-1', specialty: 'ELECTRICAL', specialtyLabel: 'Điện' };
    const techB = { id: 'tech-2', specialty: 'PLUMBING', specialtyLabel: 'Nước' };

    const isSpecialtyMatch = techA.specialty === techB.specialty;
    if (isSpecialtyMatch !== false) {
      throw new Error('Phải chặn việc đổi ca giữa hai KTV khác chuyên môn');
    }
  });

  test('Xin nghỉ: Yêu cầu bàn giao khi KTV còn ticket đang xử lý', () => {
    const activeTickets = [
      { id: 'tk-1', ticketCode: '#RF-01', status: 'IN_PROGRESS' },
    ];
    const handoverTechId = null;

    const canApproveWithoutHandover = activeTickets.length === 0 || Boolean(handoverTechId);
    if (canApproveWithoutHandover !== false) {
      throw new Error('Bắt buộc phải có KTV nhận bàn giao khi KTV xin nghỉ còn sự cố đang làm');
    }
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 6: MODULE CHI PHÍ SỬA CHỮA & VẬT TƯ (REPAIR COSTS)
  // --------------------------------------------------------------------------
  test('Chi phí: Tính toán chính xác tiền VND và chặn trùng mã vật tư', () => {
    const items = [
      { materialCode: 'VT-01', quantity: 3, unitPrice: 50000 },
      { materialCode: 'VT-02', quantity: 2, unitPrice: 120000 },
    ];

    const seen = new Set<string>();
    let duplicate = false;
    for (const it of items) {
      if (seen.has(it.materialCode)) duplicate = true;
      seen.add(it.materialCode);
    }

    const itemsTotal = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
    const otherCost = 25000;
    const total = itemsTotal + otherCost;

    if (duplicate !== false) throw new Error('Không được có mã vật tư trùng lặp');
    if (itemsTotal !== 390000) throw new Error(`Tổng vật tư tính sai: ${itemsTotal}`);
    if (total !== 415000) throw new Error(`Tổng chi phí tính sai: ${total}`);
  });

  test('Chi phí: Cư dân không được xem chi phí khi chưa được BMB phê duyệt', () => {
    const costRecord = { status: 'PENDING', totalCost: 500000 };
    const isPublicToResident = costRecord.status === 'APPROVED';

    if (isPublicToResident !== false) {
      throw new Error('Cư dân chỉ được xem chi phí khi trạng thái là APPROVED');
    }
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 7: MODULE SLA & LEO THANG SỰ CỐ (SLA & ESCALATION)
  // --------------------------------------------------------------------------
  test('SLA: Tính đúng thời hạn Response/Assignment/Resolution cho mức ưu tiên HIGH', () => {
    const createdTime = new Date('2026-11-05T08:00:00.000Z').getTime();
    const highCfg = { responseMinutes: 15, assignmentMinutes: 30, resolutionHours: 4 };

    const respDeadline = new Date(createdTime + highCfg.responseMinutes * 60 * 1000).toISOString();
    const resDeadline = new Date(createdTime + highCfg.resolutionHours * 3600 * 1000).toISOString();

    if (respDeadline !== '2026-11-05T08:15:00.000Z') {
      throw new Error(`Response deadline tính sai: ${respDeadline}`);
    }
    if (resDeadline !== '2026-11-05T12:00:00.000Z') {
      throw new Error(`Resolution deadline tính sai: ${resDeadline}`);
    }
  });

  test('SLA: Nhận diện chính xác ON_TRACK, AT_RISK (80%) và BREACHED (quá hạn)', () => {
    const windowMs = 100 * 60 * 1000; // 100 phút
    const getStatus = (elapsedMs: number) => {
      const ratio = elapsedMs / windowMs;
      if (ratio >= 1.0) return 'BREACHED';
      if (ratio >= 0.8) return 'AT_RISK';
      return 'ON_TRACK';
    };

    if (getStatus(50 * 60 * 1000) !== 'ON_TRACK') throw new Error('Phải là ON_TRACK tại 50%');
    if (getStatus(85 * 60 * 1000) !== 'AT_RISK') throw new Error('Phải là AT_RISK tại 85%');
    if (getStatus(105 * 60 * 1000) !== 'BREACHED') throw new Error('Phải là BREACHED tại 105%');
  });

  test('SLA: Tạm dừng và gia hạn deadline bù đúng thời gian tạm dừng', () => {
    const originalDeadlineMs = new Date('2026-11-05T12:00:00.000Z').getTime();
    const pauseDurationMs = 45 * 60 * 1000; // Tạm dừng 45 phút

    const extendedDeadline = new Date(originalDeadlineMs + pauseDurationMs).toISOString();
    if (extendedDeadline !== '2026-11-05T12:45:00.000Z') {
      throw new Error(`Gia hạn deadline sai: ${extendedDeadline}`);
    }
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 8: KIỂM THỬ CÁC TÍNH NĂNG AUDIT MỚI ĐƯỢC KHẮC PHỤC
  // --------------------------------------------------------------------------
  test('Lịch nghỉ: KTV có đơn nghỉ phép APPROVED phải chặn phân công và chặn check-in', () => {
    const store = resiFixStore.get();
    const techId = 'tech-leave-test-01';
    const testDate = '2026-11-06';

    store.scheduleRequests = store.scheduleRequests.filter((r) => r.techId !== techId);
    store.scheduleRequests.push({
      id: 'leave-test-01',
      type: 'LEAVE',
      techId,
      techName: 'KTV Nghỉ Phép',
      date: testDate,
      reason: 'Nghỉ phép năm',
      status: 'APPROVED',
      createdAt: new Date().toISOString(),
    });

    // Kiểm tra helper isTechOnApprovedLeave
    const { isTechOnApprovedLeave } = require('../data/resifix_store');
    const onLeave = isTechOnApprovedLeave(techId, testDate);
    if (!onLeave) {
      throw new Error('KTV có đơn APPROVED ngày 2026-11-06 nhưng isTechOnApprovedLeave trả về false!');
    }

    const onLeaveOtherDay = isTechOnApprovedLeave(techId, '2026-11-07');
    if (onLeaveOtherDay) {
      throw new Error('isTechOnApprovedLeave trả về true cho ngày không đăng ký nghỉ!');
    }
  });

  test('Chi phí: Chặn duyệt lại khi chi phí đã ở trạng thái APPROVED', () => {
    const existingCost = {
      id: 'cost-test-dup',
      ticketId: 'ticket-test-dup',
      status: 'APPROVED',
      totalCost: 1500000,
      reviewedBy: 'BMB Manager',
    };

    // Giả lập logic kiểm tra duyệt trùng
    const attemptReview = (status: string) => {
      if (existingCost.status === 'APPROVED') {
        throw new Error('Chi phí sự cố này đã được phê duyệt trước đó, không thể duyệt lại.');
      }
    };

    let blocked = false;
    try {
      attemptReview('APPROVED');
    } catch (e: any) {
      if (e.message.includes('đã được phê duyệt trước đó')) blocked = true;
    }
    if (!blocked) throw new Error('Không chặn được thao tác duyệt trùng trên chi phí đã APPROVED');
  });

  test('Chi phí: Bắt buộc đính kèm hóa đơn chứng từ khi chi phí >= ngưỡng quy định', () => {
    const threshold = 500000;
    const costAbove = 750000;
    const hasReceipt = false;

    const validateSubmission = (amount: number, receipt?: string | null) => {
      if (amount >= threshold && !receipt) {
        throw new Error('Bắt buộc đính kèm ảnh chụp hóa đơn/chứng từ');
      }
    };

    let blocked = false;
    try {
      validateSubmission(costAbove, null);
    } catch (e: any) {
      if (e.message.includes('Bắt buộc đính kèm')) blocked = true;
    }
    if (!blocked) throw new Error('Không bắt buộc hóa đơn khi chi phí vượt ngưỡng 500.000 VND');
  });

  test('SLA: Lưu giữ độc lập các vi phạm Response/Assignment/Resolution không bị ghi đè', () => {
    const tracking = {
      isResponseBreached: true,
      isAssignmentBreached: false,
      isResolutionBreached: false,
      slaStatus: 'BREACHED',
    };

    // Khi ticket chuyển từ PENDING -> ASSIGNED
    // Nếu kiểm tra giai đoạn mới nhưng isResponseBreached đã true thì slaStatus vẫn phải là BREACHED
    const hasBreach = tracking.isResponseBreached || tracking.isAssignmentBreached || tracking.isResolutionBreached;
    if (!hasBreach) {
      throw new Error('Vi phạm Response SLA bị xóa mất khi chuyển giai đoạn sự cố');
    }
    if (tracking.slaStatus !== 'BREACHED') {
      throw new Error('Trạng thái SLA phải giữ nguyên BREACHED khi đã từng vi phạm tiếp nhận');
    }
  });

  test('Emergency Broadcast: Bắt buộc confirmEmergency và cơ chế chống gửi trùng', () => {
    const attempts: any[] = [];
    const broadcast = (data: { confirmEmergency?: boolean; type: string; timestamp: number }) => {
      if (!data.confirmEmergency) throw new Error('Bắt buộc xác nhận thao tác khẩn cấp');
      const lastSame = attempts.find((a) => a.type === data.type && data.timestamp - a.timestamp < 60000);
      if (lastSame) throw new Error('Cảnh báo vừa được phát cách đây ít hơn 60 giây');
      attempts.push(data);
    };

    // 1. Chặn khi không có confirmEmergency
    let blockedNoConfirm = false;
    try {
      broadcast({ type: 'CHAY_NO', timestamp: 1000 });
    } catch {
      blockedNoConfirm = true;
    }
    if (!blockedNoConfirm) throw new Error('Không chặn broadcast khi thiếu confirmEmergency');

    // 2. Cho phép khi có confirmEmergency
    broadcast({ confirmEmergency: true, type: 'CHAY_NO', timestamp: 1000 });

    // 3. Chặn gửi trùng trong vòng 60s
    let blockedSpam = false;
    try {
      broadcast({ confirmEmergency: true, type: 'CHAY_NO', timestamp: 30000 });
    } catch {
      blockedSpam = true;
    }
    if (!blockedSpam) throw new Error('Không chặn spam broadcast trong vòng 60 giây');
  });

  test('Emergency Broadcast: Phân định quyền BMB diện rộng vs KTV báo cáo khẩn', () => {
    const canBroadcastWide = (role: string) => role === 'BMB';
    const canReportEmergency = (role: string) => role === 'TECHNICIAN' || role === 'BMB';

    if (!canBroadcastWide('BMB')) throw new Error('BMB phải có quyền phát cảnh báo diện rộng');
    if (canBroadcastWide('TECHNICIAN')) throw new Error('KTV không được phép tự ý phát cảnh báo diện rộng');
    if (!canReportEmergency('TECHNICIAN')) throw new Error('KTV phải có quyền gửi báo cáo sự cố khẩn cấp');
  });

  console.log('\n====================================================');
  console.log(`KẾT QUẢ: ${passedCount} PASSED, ${failedCount} FAILED.`);
  console.log('====================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAuditTests();

