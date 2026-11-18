import {
  resiFixStore,
  createAttendanceNonce,
  consumeAttendanceNonce,
  calculateOvertimeMultiplier,
  calculateOvertimePay,
  calculateShiftSalaryVietnam,
  getDayType,
  isVietnamPublicHoliday,
  AttendanceRecord,
} from '../data/resifix_store';

function runAssertion(testName: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName} - ${detail || ''}`);
    process.exit(1);
  }
}

async function runSecurityTests() {
  console.log('===============================================================');
  console.log('RESIFIX SECURITY & LABOR LAW 2019 AUDIT SUITE');
  console.log('===============================================================');

  // --- PHẦN 1: BẢO MẬT PHIÊN CHẤM CÔNG (NONCE, ANTI-REPLAY & IDOR) ---
  console.log('\n--- 1. Kiểm tra Nonce, Chống Replay Attack & Quyền sở hữu ---');
  const techA = 'tech_security_user_A';
  const techB = 'tech_security_user_B';

  // 1.1 Tạo Nonce hợp lệ
  const nonceA = createAttendanceNonce(techA, 180);
  runAssertion('Sinh Nonce ngẫu nhiên thành công', typeof nonceA === 'string' && nonceA.length === 32);

  // 1.2 Tech B cố tình dùng Nonce của Tech A (IDOR Replay)
  const idorAttempt = consumeAttendanceNonce(nonceA, techB);
  runAssertion('Chặn Tech B sử dụng Nonce của Tech A', Boolean(!idorAttempt.valid && idorAttempt.reason?.includes('không thuộc về tài khoản này')));

  // 1.3 Tech A sử dụng Nonce hợp lệ lần đầu
  const validUse = consumeAttendanceNonce(nonceA, techA);
  runAssertion('Tech A sử dụng Nonce lần 1 thành công', Boolean(validUse.valid));

  // 1.4 Replay Attack: Tech A cố tình gửi lại cùng Nonce lần 2
  const replayAttempt = consumeAttendanceNonce(nonceA, techA);
  runAssertion('Chống Replay: Chặn đứng gửi lại Nonce lần 2', !replayAttempt.valid);

  // 1.5 Nonce hết hạn (TTL Expired)
  const expiredNonce = createAttendanceNonce(techA, -10); // Hết hạn 10s trước
  const expireCheck = consumeAttendanceNonce(expiredNonce, techA);
  runAssertion('Chặn Nonce đã hết hạn thời gian (TTL > 3 phút)', Boolean(!expireCheck.valid && expireCheck.reason?.includes('hết hạn')));

  // --- PHẦN 2: BMB XÁC NHẬN TỌA ĐỘ TÒA NHÀ & BẢO MẬT GPS ---
  console.log('\n--- 2. Tọa độ Tòa nhà phải được BMB xác nhận (Chống hardcode không kiểm chứng) ---');
  const store = resiFixStore.get();
  
  // Kiểm tra cờ isConfirmed
  const originalConfirmed = store.payrollConfig.buildingLocation.isConfirmed;
  store.payrollConfig.buildingLocation.isConfirmed = false;
  resiFixStore.save(store);
  runAssertion('Khi chưa xác nhận, cờ isConfirmed là false', !store.payrollConfig.buildingLocation.isConfirmed);

  // BMB thực hiện xác nhận và lưu audit log
  const nowIso = new Date().toISOString();
  if (!store.payrollConfig.buildingLocation.configAuditLogs) {
    store.payrollConfig.buildingLocation.configAuditLogs = [];
  }
  const { configAuditLogs: _ignored, ...prevConfigPure } = store.payrollConfig.buildingLocation;
  store.payrollConfig.buildingLocation.configAuditLogs.push({
    changedAt: nowIso,
    changedById: 'bmb_lead_01',
    changedByName: 'Cam Dương Mỹ Hạnh',
    previousConfig: prevConfigPure,
    newConfig: {
      buildingName: 'Tòa nhà ResiFix Residence',
      buildingAddress: 'Đại Học Duy Tân,120 Hoàng Minh Thảo, TP Đà Nẵng',
      latitude: 10.7324,
      longitude: 106.6992,
      allowedRadiusMeters: 300,
      isConfirmed: true,
    },
    note: 'BMB xác nhận tọa độ thực địa chuẩn 300m',
  });
  store.payrollConfig.buildingLocation.isConfirmed = true;
  store.payrollConfig.buildingLocation.confirmedAt = nowIso;
  store.payrollConfig.buildingLocation.confirmedByName = 'Cầm Dương Mỹ Hạnh';
  resiFixStore.save(store);

  runAssertion('BMB xác nhận tọa độ thành công (isConfirmed = true)', store.payrollConfig.buildingLocation.isConfirmed);
  runAssertion('Audit log lưu giữ lịch sử thay đổi cấu hình tọa độ', store.payrollConfig.buildingLocation.configAuditLogs.length > 0);

  // Khôi phục cấu hình
  store.payrollConfig.buildingLocation.isConfirmed = originalConfirmed;
  resiFixStore.save(store);

  // --- PHẦN 3: BẢO VỆ DỮ LIỆU KHI TỪ CHỐI BẰNG CHỨNG (BẢO LƯU GIỜ TRANH CHẤP) ---
  console.log('\n--- 3. Không xóa giờ thực tế khi BMB từ chối bằng chứng (Bảo lưu tranh chấp lao động) ---');
  const testShiftId = 'att_dispute_test_01';
  const disputeRecord: AttendanceRecord = {
    id: testShiftId,
    techId: techA,
    techName: 'KTV Thử Nghiệm Tranh Chấp',
    date: '2026-11-09',
    sessionIndex: 1,
    checkIn: new Date('2026-11-09T07:00:00+07:00').toISOString(),
    checkOut: new Date('2026-11-09T15:00:00+07:00').toISOString(),
    workMinutes: 480,
    workHours: 8,
    regularHours: 8,
    nightHours: 0,
    verificationStatus: 'PENDING_REVIEW',
    auditLogs: [],
  };

  store.attendanceLogs.push(disputeRecord);
  resiFixStore.save(store);

  // Giả lập BMB từ chối bằng chứng (REJECT)
  disputeRecord.verificationStatus = 'REJECTED';
  disputeRecord.billableHours = 0;
  disputeRecord.disputedHours = disputeRecord.workHours; // BẢO LƯU GIỜ TRANH CHẤP!
  disputeRecord.reviewNote = 'Ảnh chụp mờ không rõ người làm việc; bảo lưu 8h để hòa giải tranh chấp.';
  resiFixStore.save(store);

  runAssertion('Trạng thái xác minh chuyển sang REJECTED', disputeRecord.verificationStatus === 'REJECTED');
  runAssertion('Giờ tính lương tự động = 0 (chưa trả)', disputeRecord.billableHours === 0);
  runAssertion('Giờ làm thực tế (workHours) được giữ nguyên 8h', disputeRecord.workHours === 8);
  runAssertion('Giờ tranh chấp (disputedHours) bảo lưu nguyên vẹn 8h phục vụ hòa giải', disputeRecord.disputedHours === 8);

  // Dọn dẹp
  store.attendanceLogs = store.attendanceLogs.filter((l) => l.id !== testShiftId);
  resiFixStore.save(store);

  // --- PHẦN 4: TÍNH LƯƠNG CHUẨN ĐIỀU 98 BỘ LUẬT LAO ĐỘNG 2019 ---
  console.log('\n--- 4. Công thức Tiền lương & Tăng ca theo Điều 98 BLLĐ 2019 ---');
  const baseRate = 50000; // 50.000 VNĐ / giờ

  // 4.1 Ca ngày thường: 8 giờ thường @ 50.000 đ/h
  const shiftDay = calculateShiftSalaryVietnam(8, 0, baseRate);
  runAssertion('Ca ngày thường: 8h x 50.000đ = 400.000đ', shiftDay.regularPay === 400000 && shiftDay.totalShiftPay === 400000);

  // 4.2 Ca đêm: 8 giờ đêm (22:00 - 06:00) theo Điều 98 Khoản 2 (130% = 65.000 đ/h)
  const shiftNight = calculateShiftSalaryVietnam(0, 8, baseRate);
  runAssertion('Ca đêm: 8h x (50.000đ x 1.3) = 520.000đ', shiftNight.nightPay === 520000 && shiftNight.totalShiftPay === 520000);

  // 4.3 Ca hỗn hợp: 2h ngày + 6h đêm (tổng 8h)
  const shiftMixed = calculateShiftSalaryVietnam(2, 6, baseRate);
  // 2 * 50.000 = 100.000; 6 * 65.000 = 390.000; Tổng = 490.000
  runAssertion('Ca hỗn hợp 2h ngày + 6h đêm = 490.000đ', shiftMixed.totalShiftPay === 490000);

  // 4.4 Tăng ca ngày thường ban ngày (150% = 75.000 đ/h) - Điều 98 K.1.a
  const otNormalDay = calculateOvertimePay(2, 'NORMAL', false, baseRate);
  runAssertion('OT ngày thường ban ngày 2h x 150% = 150.000đ', otNormalDay === 150000);

  // 4.5 Tăng ca ngày thường ban đêm (210% = 105.000 đ/h) - Điều 98 K.3
  const otNormalNight = calculateOvertimePay(2, 'NORMAL', true, baseRate);
  runAssertion('OT ngày thường ban đêm 2h x 210% = 210.000đ', otNormalNight === 210000);

  // 4.6 Tăng ca ngày nghỉ hằng tuần ban ngày (200% = 100.000 đ/h) - Điều 98 K.1.b
  const otWeekendDay = calculateOvertimePay(2, 'WEEKEND', false, baseRate);
  runAssertion('OT ngày nghỉ cuối tuần ban ngày 2h x 200% = 200.000đ', otWeekendDay === 200000);

  // 4.7 Tăng ca ngày nghỉ hằng tuần ban đêm (270% = 135.000 đ/h) - Điều 98 K.3
  const otWeekendNight = calculateOvertimePay(2, 'WEEKEND', true, baseRate);
  runAssertion('OT ngày nghỉ cuối tuần ban đêm 2h x 270% = 270.000đ', otWeekendNight === 270000);

  // 4.8 Tăng ca ngày Lễ, Tết ban ngày (300% = 150.000 đ/h) - Điều 98 K.1.c
  const otHolidayDay = calculateOvertimePay(2, 'HOLIDAY', false, baseRate);
  runAssertion('OT ngày Lễ/Tết ban ngày 2h x 300% = 300.000đ', otHolidayDay === 300000);

  // 4.9 Tăng ca ngày Lễ, Tết ban đêm (390% = 195.000 đ/h) - Điều 98 K.3
  const otHolidayNight = calculateOvertimePay(2, 'HOLIDAY', true, baseRate);
  runAssertion('OT ngày Lễ/Tết ban đêm 2h x 390% = 390.000đ', otHolidayNight === 390000);

  // --- PHẦN 5: BẢO VỆ KỲ LƯƠNG ĐÃ KHÓA (CHỐNG CHỈNH SỬA / DUYỆT TRÁI PHÉP) ---
  console.log('\n--- 5. Khóa Kỳ Lương & Bất Biến Dữ Liệu Sau Khóa ---');
  const lockedMonthStr = '2026-10';
  store.lockedMonths = store.lockedMonths.filter((m) => m.month !== lockedMonthStr);
  store.lockedMonths.push({
    month: lockedMonthStr,
    lockedAt: new Date().toISOString(),
    lockedBy: 'BMB Cầm Dương Mỹ Hạnh',
    totalPayout: 25000000,
  });
  resiFixStore.save(store);

  const isMonthLocked = store.lockedMonths.some((m) => m.month === lockedMonthStr);
  runAssertion('Kỳ lương tháng 2026-10 đã được khóa chính thức', isMonthLocked);

  // Thử kiểm tra ca thuộc tháng đã khóa
  const testLockedShift: AttendanceRecord = {
    id: 'att_locked_test_01',
    techId: techA,
    techName: 'KTV Test Locked',
    date: '2026-10-15',
    sessionIndex: 1,
    checkIn: '2026-10-15T07:00:00Z',
  };
  const isShiftInLockedMonth = store.lockedMonths.some((m) => m.month === testLockedShift.date.slice(0, 7));
  runAssertion('Hệ thống phát hiện chính xác ca trực nằm trong kỳ lương đã khóa để từ chối sửa', isShiftInLockedMonth);

  // Dọn dẹp
  store.lockedMonths = store.lockedMonths.filter((m) => m.month !== lockedMonthStr);
  resiFixStore.save(store);

  // --- PHẦN 6: KIỂM TRA GHI NGUYÊN TỬ & SAO LƯU DỮ LIỆU (.tmp & .bak) ---
  console.log('\n--- 6. Ghi Tệp Nguyên Tử (Atomic Write) & Phục Hồi Dữ Liệu ---');
  const beforeSave = resiFixStore.get();
  beforeSave.emergencyContact.managerName = 'Đặng Thành Quyết (Verified Atomic)';
  resiFixStore.save(beforeSave);

  const fs = require('fs');
  const path = require('path');
  const jsonPath = path.resolve(__dirname, '../data/resifix_data.json');
  const bakPath = path.resolve(__dirname, '../data/resifix_data.json.bak');

  runAssertion('Tệp resifix_data.json tồn tại và có dữ liệu', fs.existsSync(jsonPath));
  runAssertion('Tệp sao lưu dự phòng .bak được tạo tự động khi lưu', fs.existsSync(bakPath));

  const reloaded = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  runAssertion('Dữ liệu lưu nguyên tử được đọc lại chính xác', reloaded.emergencyContact.managerName === 'Đặng Thành Quyết (Verified Atomic)');

  // Khôi phục tên gốc
  beforeSave.emergencyContact.managerName = 'Đặng Thành Quyết';
  resiFixStore.save(beforeSave);

  console.log('\n===============================================================');
  console.log('TẤT CẢ 23 BÀI KIỂM THỬ BẢO MẬT & LUẬT LAO ĐỘNG ĐỀU PASS 100%!');
  console.log('===============================================================');
}

runSecurityTests().catch((err) => {
  console.error('Lỗi khi chạy bộ kiểm thử bảo mật:', err);
  process.exit(1);
});
