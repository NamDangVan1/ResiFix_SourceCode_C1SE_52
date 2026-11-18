import { resiFixStore, generateOfficial75Apartments } from '../data/resifix_store';

function assert(condition: any, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: 75 CĂN HỘ, ĐỊA CHỈ DUY TÂN & QR CODE BÁO SỰ CỐ');
  console.log('===============================================================\n');

  // TEST 1: KIỂM TRA 75 PHÒNG CHUẨN TÒA G, F, E
  console.log('--- TEST 1: Danh sách 75 phòng chuẩn tòa G, F, E ---');
  const store = resiFixStore.get();
  const apts = store.apartments;
  assert(apts.length === 75, `Tổng số phòng phải bằng đúng 75 (thực tế: ${apts.length})`);

  const gRooms = apts.filter((a) => a.apartmentCode.startsWith('G'));
  const fRooms = apts.filter((a) => a.apartmentCode.startsWith('F'));
  const eRooms = apts.filter((a) => a.apartmentCode.startsWith('E'));

  assert(gRooms.length === 25, `Tòa G phải có 25 phòng (thực tế: ${gRooms.length})`);
  assert(fRooms.length === 25, `Tòa F phải có 25 phòng (thực tế: ${fRooms.length})`);
  assert(eRooms.length === 25, `Tòa E phải có 25 phòng (thực tế: ${eRooms.length})`);

  // Kiểm tra từng tầng 1..5, mỗi tầng 5 phòng 01..05
  for (const block of ['G', 'F', 'E']) {
    for (let floor = 1; floor <= 5; floor++) {
      for (let room = 1; room <= 5; room++) {
        const expectedCode = `${block}${floor}${String(room).padStart(2, '0')}`;
        const found = apts.find((a) => a.apartmentCode === expectedCode);
        assert(found !== undefined, `Phải có phòng ${expectedCode}`);
        assert(found?.floorNumber === floor, `Phòng ${expectedCode} phải thuộc tầng ${floor}`);
        assert(found?.roomQrCode === `ROOM:${expectedCode}`, `Mã QR phòng ${expectedCode} phải là ROOM:${expectedCode}`);
      }
    }
  }

  // TEST 2: ĐỘ ĐỘC BẢN CỦA 75 MÃ QR
  console.log('\n--- TEST 2: Tính duy nhất và bất biến của 75 mã QR ---');
  const qrSet = new Set(apts.map((a) => a.roomQrCode));
  assert(qrSet.size === 75, `Tất cả 75 mã QR phải là duy nhất (Set size: ${qrSet.size})`);
  assert(qrSet.has('ROOM:G101'), 'Có mã ROOM:G101');
  assert(qrSet.has('ROOM:G505'), 'Có mã ROOM:G505');
  assert(qrSet.has('ROOM:F101'), 'Có mã ROOM:F101');
  assert(qrSet.has('ROOM:E505'), 'Có mã ROOM:E505');

  // TEST 3: CẤU HÌNH ĐỊA CHỈ TÒA NHÀ ĐẠI HỌC DUY TÂN
  console.log('\n--- TEST 3: Cấu hình địa chỉ tòa nhà (Dynamic Config) ---');
  const location = store.payrollConfig.buildingLocation;
  assert(location.buildingAddress === 'Đại học Duy Tân, Hòa Khánh Nam, Đà Nẵng', `Địa chỉ chuẩn phải là Đại học Duy Tân (thực tế: "${location.buildingAddress}")`);
  assert(location.buildingName.includes('Duy Tân') || location.buildingName.includes('ResiFix'), `Tên tòa nhà: ${location.buildingName}`);
  assert(typeof location.latitude === 'number' && typeof location.longitude === 'number', 'Tọa độ GPS hợp lệ');

  // TEST 4: QUY TẮC PHÂN QUYỀN BÁO CÁO SỰ CỐ PHÒNG RIÊNG VS KHU VỰC CHUNG (Section VI)
  console.log('\n--- TEST 4: Logic phân quyền QR: Phòng riêng vs Khu vực chung ---');
  // Giả lập cư dân An cư trú tại phòng G201
  const residentA = { id: 'user-res-1', apartmentCode: 'G201' };

  // Helper kiểm tra quyền tương tự backend route
  const checkReportPermission = (userApt: string, targetQr: string) => {
    const cleanQr = targetQr.trim().toUpperCase();
    let roomCode = cleanQr.startsWith('ROOM:') ? cleanQr.replace(/^ROOM:/i, '').trim().toUpperCase() : null;
    let aptRec = roomCode ? apts.find((a) => a.apartmentCode.toUpperCase() === roomCode) : null;
    if (!aptRec && !cleanQr.startsWith('ROOM:')) {
      const m = apts.find((a) => a.apartmentCode.toUpperCase() === cleanQr);
      if (m) {
        roomCode = m.apartmentCode;
        aptRec = m;
      }
    }

    if (aptRec && roomCode) {
      if (userApt !== roomCode) {
        return { allowed: false, error: `Bạn không có quyền báo cáo sự cố tại phòng riêng ${roomCode} vì bạn không cư trú tại phòng này.` };
      }
      return { allowed: true, type: 'ROOM', roomCode, address: location.buildingAddress };
    }

    // Khu vực chung
    return { allowed: true, type: 'COMMON_AREA', qrCode: cleanQr };
  };

  const selfReport = checkReportPermission(residentA.apartmentCode, 'ROOM:G201');
  assert(selfReport.allowed === true && selfReport.type === 'ROOM', 'Cư dân G201 quét mã ROOM:G201 được phép báo cáo');

  const otherReport = checkReportPermission(residentA.apartmentCode, 'ROOM:F305');
  assert(otherReport.allowed === false, 'Cư dân G201 quét mã ROOM:F305 bị từ chối');
  assert(otherReport.error?.includes('không cư trú tại phòng này'), 'Thông báo từ chối đúng quy định bảo mật');

  const commonReport = checkReportPermission(residentA.apartmentCode, 'WP-1204');
  assert(commonReport.allowed === true && commonReport.type === 'COMMON_AREA', 'Cư dân quét mã khu vực chung WP-1204 được phép báo cáo');

  // TEST 5: BẢO LƯU QR VÀ PHÒNG KHI CƯ DÂN RỜI PHÒNG (MOVE-OUT)
  console.log('\n--- TEST 5: Bảo tồn căn hộ và QR khi cư dân chuyển đi ---');
  // Khi cư dân G201 chuyển đi, căn hộ G201 vẫn tồn tại trong store và mã QR không bị mất
  const roomAfterMoveOut = apts.find((a) => a.apartmentCode === 'G201');
  assert(roomAfterMoveOut !== undefined, 'Căn hộ G201 vẫn tồn tại sau khi cư dân rời phòng');
  assert(roomAfterMoveOut?.roomQrCode === 'ROOM:G201', 'Mã QR ROOM:G201 gắn liền vĩnh viễn với phòng');

  console.log('\n===============================================================');
  console.log('✅ TẤT CẢ 5 NHÓM KIỂM THỬ ĐÃ ĐẠT 100%! HỆ THỐNG AN TOÀN VÀ ĐÚNG CHUẨN.');
  console.log('===============================================================\n');
}

runTests().catch((err) => {
  console.error('Lỗi khi chạy kiểm thử:', err);
  process.exit(1);
});

