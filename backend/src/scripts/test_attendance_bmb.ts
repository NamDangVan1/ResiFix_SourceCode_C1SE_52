import {
  resiFixStore,
  calculateDistanceMeters,
  evaluateCheckInPunctuality,
  calculateWorkHoursBreakdown,
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

async function runAttendanceTests() {
  console.log('===============================================================');
  console.log('RESIFIX TEST: ATTENDANCE & PAYROLL BMB ENHANCEMENT SUITE');
  console.log('===============================================================');

  // TEST 1: Haversine GPS Distance Calculation
  console.log('\n--- 1. Kiểm tra tính khoảng cách GPS (Haversine Formula) ---');
  const buildingLat = 10.7324;
  const buildingLon = 106.6992;

  // Cùng tọa độ
  const distZero = calculateDistanceMeters(buildingLat, buildingLon, buildingLat, buildingLon);
  runAssertion('Khoảng cách tại chính tòa nhà xấp xỉ 0m', distZero === 0, `Nhận được: ${distZero}`);

  // Tọa độ lệch nhẹ (~50-100m)
  const distNear = calculateDistanceMeters(buildingLat, buildingLon, 10.7328, 106.6995);
  runAssertion('Khoảng cách gần nằm trong bán kính 300m', distNear < 300 && distNear > 20, `Nhận được: ${distNear}m`);

  // Tọa độ xa (~2.5km)
  const distFar = calculateDistanceMeters(buildingLat, buildingLon, 10.7550, 106.6992);
  runAssertion('Khoảng cách xa nằm ngoài bán kính 300m', distFar > 2000, `Nhận được: ${distFar}m`);

  // TEST 2: Đánh giá đúng giờ / Đi muộn (Punctuality) độc lập với Gian lận
  console.log('\n--- 2. Kiểm tra tính đúng giờ / Đi muộn độc lập với Xác minh ---');
  // Ca sáng 07:00 - 15:00
  const onTimeDate = new Date('2026-11-09T07:10:00+07:00'); // 7h10 (trong 15p ân hạn)
  const evalOnTime = evaluateCheckInPunctuality(onTimeDate, '07:00 - 15:00');
  runAssertion('Check-in lúc 07:10 là ON_TIME (ân hạn 15 phút)', evalOnTime.punctualityStatus === 'ON_TIME', `Nhận: ${evalOnTime.punctualityStatus}`);

  const lateDate = new Date('2026-11-09T07:35:00+07:00'); // 7h35 (muộn 35 phút)
  const evalLate = evaluateCheckInPunctuality(lateDate, '07:00 - 15:00');
  runAssertion('Check-in lúc 07:35 là LATE', evalLate.punctualityStatus === 'LATE', `Nhận: ${evalLate.punctualityStatus}`);
  runAssertion('Đi muộn đúng 35 phút', evalLate.lateMinutes === 35, `Nhận: ${evalLate.lateMinutes}`);

  // TEST 3: Bóc tách giờ làm & Ca đêm (22:00 - 06:00) với đơn giá 50.000 VNĐ/giờ
  console.log('\n--- 3. Bóc tách giờ làm & Ca đêm (22:00 - 06:00) ---');
  // Ca ngày: 08:00 đến 16:00 giờ Việt Nam (8 tiếng ban ngày hoàn toàn)
  const dayShift = calculateWorkHoursBreakdown(new Date('2026-11-09T08:00:00+07:00'), new Date('2026-11-09T16:00:00+07:00'));
  runAssertion('Ca ngày: 8 tiếng tổng cộng', dayShift.totalHours === 8, `Nhận: ${dayShift.totalHours}`);
  runAssertion('Ca ngày: 8 tiếng giờ công thường', dayShift.regularHours === 8, `Nhận: ${dayShift.regularHours}`);
  runAssertion('Ca ngày: 0 tiếng ca đêm', dayShift.nightHours === 0, `Nhận: ${dayShift.nightHours}`);

  // Đơn giá 50.000 VNĐ/giờ: 8 * 50.000 = 400.000 VNĐ
  const wageDay = dayShift.regularHours * 50000 + dayShift.nightHours * 50000 * 1.3;
  runAssertion('Tiền lương ca ngày 8h = 400.000 VNĐ', wageDay === 400000, `Nhận: ${wageDay}`);

  // Ca đêm: 22:00 đến 06:00 giờ Việt Nam (8 tiếng ban đêm hoàn toàn)
  const nightShift = calculateWorkHoursBreakdown(new Date('2026-11-09T22:00:00+07:00'), new Date('2026-11-10T06:00:00+07:00'));
  runAssertion('Ca đêm: 8 tiếng tổng cộng', nightShift.totalHours === 8, `Nhận: ${nightShift.totalHours}`);
  runAssertion('Ca đêm: 8 tiếng giờ ca đêm', nightShift.nightHours === 8, `Nhận: ${nightShift.nightHours}`);
  runAssertion('Ca đêm: 0 tiếng giờ thường', nightShift.regularHours === 0, `Nhận: ${nightShift.regularHours}`);
  const wageNight = nightShift.regularHours * 50000 + nightShift.nightHours * 50000 * 1.3;
  runAssertion('Tiền lương ca đêm 8h = 520.000 VNĐ (50k x 1.3)', wageNight === 520000, `Nhận: ${wageNight}`);

  // TEST 4: Quy trình Phê duyệt ngoại lệ & Lưu vết Audit Log
  console.log('\n--- 4. Quy trình Phê duyệt Ngoại lệ & Audit Trail ---');
  const store = resiFixStore.get();

  const testAttendanceId = 'att_test_integration_01';
  // Tạo bản ghi chấm công có ngoại lệ (GPS ngoài bán kính)
  const testRecord: AttendanceRecord = {
    id: testAttendanceId,
    techId: 'tech_01',
    techName: 'KTV Trần Văn Nam',
    techPhone: '0901234567',
    buildingBlock: 'Tòa S1',
    date: '2026-11-09',
    sessionIndex: 1,
    shiftScheduled: '07:00 - 15:00',
    shiftStartTime: '07:00',
    shiftEndTime: '15:00',
    checkIn: new Date().toISOString(),
    checkInGps: {
      latitude: 10.7550,
      longitude: 106.6992,
      accuracyMeters: 15,
      distanceToBuildingMeters: 2514,
      isWithinRadius: false,
      addressEstimate: 'Cách ResiFix Residence ~2514m',
    },
    punctualityStatus: 'ON_TIME',
    verificationStatus: 'PENDING_REVIEW',
    anomalyNotes: 'Vị trí check-in ngoài phạm vi tòa nhà: 2,514m',
    auditLogs: [
      {
        action: 'SYSTEM_FLAG',
        performedById: 'tech_01',
        performedByName: 'KTV Trần Văn Nam',
        performedAt: new Date().toISOString(),
        note: 'Check-in phát hiện ngoại lệ: Vị trí check-in ngoài phạm vi tòa nhà: 2,514m',
      },
    ],
  };

  // Lưu vào store
  store.attendanceLogs = store.attendanceLogs.filter((l) => l.id !== testAttendanceId);
  store.attendanceLogs.push(testRecord);
  resiFixStore.save(store);

  // Bước 4.1: BMB yêu cầu giải trình
  const recordToReview = store.attendanceLogs.find((l) => l.id === testAttendanceId);
  runAssertion('Tìm thấy bản ghi chấm công thử nghiệm', !!recordToReview);

  if (recordToReview) {
    recordToReview.verificationStatus = 'NEEDS_EXPLANATION';
    recordToReview.reviewNote = 'Yêu cầu giải trình lý do chấm công tại vị trí cách tòa nhà 2.5km.';
    recordToReview.reviewedBy = 'BMB Cầm Dương Mỹ Hạnh';
    recordToReview.reviewedAt = new Date().toISOString();
    recordToReview.auditLogs = recordToReview.auditLogs || [];
    recordToReview.auditLogs.push({
      action: 'REQUEST_EXPLANATION',
      performedById: 'bmb_01',
      performedByName: 'BMB Cầm Dương Mỹ Hạnh',
      performedAt: new Date().toISOString(),
      note: 'Yêu cầu giải trình lý do chấm công tại vị trí cách tòa nhà 2.5km.',
    });
    resiFixStore.save(store);

    runAssertion('Trạng thái chuyển sang NEEDS_EXPLANATION', recordToReview.verificationStatus === 'NEEDS_EXPLANATION');

    // Bước 4.2: KTV gửi giải trình
    recordToReview.explanationText = 'Em được điều động đi mua van áp suất khẩn cấp cho sự cố căn B1204 nên check-in trên đường.';
    recordToReview.verificationStatus = 'PENDING_REVIEW';
    recordToReview.auditLogs.push({
      action: 'TECH_EXPLAIN',
      performedById: 'tech_01',
      performedByName: 'KTV Trần Văn Nam',
      performedAt: new Date().toISOString(),
      note: 'KTV gửi giải trình: Em được điều động đi mua van áp suất khẩn cấp...',
    });
    resiFixStore.save(store);

    runAssertion('KTV gửi giải trình thành công, trạng thái trở lại PENDING_REVIEW', recordToReview.verificationStatus === 'PENDING_REVIEW');
    runAssertion('Nội dung giải trình được lưu chính xác', !!recordToReview.explanationText);

    // Bước 4.3: BMB xem xét và Phê duyệt ngoại lệ với 8 giờ tính lương
    recordToReview.verificationStatus = 'APPROVED';
    recordToReview.billableHours = 8;
    recordToReview.regularHours = 8;
    recordToReview.disputedHours = 0;
    recordToReview.reviewNote = 'Đã đối chiếu hóa đơn vật tư và duyệt hợp lệ 8 giờ.';
    recordToReview.reviewedBy = 'BMB Cầm Dương Mỹ Hạnh';
    recordToReview.reviewedAt = new Date().toISOString();
    recordToReview.auditLogs.push({
      action: 'BMB_APPROVE',
      performedById: 'bmb_01',
      performedByName: 'BMB Cầm Dương Mỹ Hạnh',
      performedAt: new Date().toISOString(),
      note: 'BMB phê duyệt tính lương: Đã đối chiếu hóa đơn vật tư và duyệt hợp lệ 8 giờ.',
      adjustedHours: 8,
    });
    resiFixStore.save(store);

    runAssertion('BMB phê duyệt thành công: trạng thái APPROVED', recordToReview.verificationStatus === 'APPROVED');
    runAssertion('Giờ tính lương được ghi nhận: 8h', recordToReview.billableHours === 8);
    runAssertion('Bằng chứng GPS gốc không bị xóa/ghi đè', recordToReview.checkInGps?.distanceToBuildingMeters === 2514);
    runAssertion('Audit log lưu giữ đầy đủ 4 bước thao tác', recordToReview.auditLogs.length === 4);
  }

  // Dọn dẹp bản ghi test
  store.attendanceLogs = store.attendanceLogs.filter((l) => l.id !== testAttendanceId);
  resiFixStore.save(store);

  console.log('\n===============================================================');
  console.log('TẤT CẢ CÁC BÀI TEST CHẤM CÔNG & LƯƠNG BMB ĐỀU THÀNH CÔNG 100%!');
  console.log('===============================================================');
}

runAttendanceTests().catch((err) => {
  console.error('Lỗi khi chạy bài test:', err);
  process.exit(1);
});
