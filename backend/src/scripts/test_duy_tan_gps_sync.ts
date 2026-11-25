import assert from 'assert';
import { DEFAULT_BUILDING_LOCATION as BACKEND_GPS } from '../config/building.config';
import { calculateDistanceMeters, resiFixStore } from '../data/resifix_store';
import { evaluateAnonymousLocation } from '../routes/ticket.routes';

console.log('================================================================');
console.log('🧪 TEST SUITE: ĐỒNG BỘ ĐIỂM CHUẨN GPS ĐẠI HỌC DUY TÂN (RESIFIX)');
console.log('================================================================\n');

// TEST 1: Kiểm tra tính chuẩn xác của cấu hình GPS Đại học Duy Tân
console.log('--- 1. Kiểm tra cấu hình điểm chuẩn GPS Đại học Duy Tân ---');
assert.strictEqual(BACKEND_GPS.buildingName, 'Đại học Duy Tân', 'Tên tòa nhà phải là Đại học Duy Tân');
assert.strictEqual(BACKEND_GPS.campusName, 'Hòa Khánh Nam', 'Cơ sở phải là Hòa Khánh Nam');
assert.strictEqual(BACKEND_GPS.buildingAddress, '120 Hoàng Minh Thảo, Hòa Khánh Nam, Đà Nẵng, Việt Nam');
assert.strictEqual(BACKEND_GPS.latitude, 16.0492916, 'Vĩ độ phải là 16.0492916');
assert.strictEqual(BACKEND_GPS.longitude, 108.1600966, 'Kinh độ phải là 108.1600966');
assert.strictEqual(BACKEND_GPS.allowedRadiusMeters, 300, 'Bán kính hợp lệ phải là 300 mét');
console.log('  => TEST 1 ĐẠT ✅: Cấu hình chuẩn xác 100%');

// TEST 2: Đối chiếu với resifix_store và resifix_data.json
console.log('\n--- 2. Kiểm tra nạp dữ liệu từ Store & JSON ---');
const store = resiFixStore.get();
const storeLoc = store.payrollConfig.buildingLocation;
assert.strictEqual(storeLoc.buildingName, 'Đại học Duy Tân');
assert.strictEqual(storeLoc.buildingAddress, '120 Hoàng Minh Thảo, Hòa Khánh Nam, Đà Nẵng, Việt Nam');
assert.strictEqual(storeLoc.latitude, 16.0492916);
assert.strictEqual(storeLoc.longitude, 108.1600966);
assert.strictEqual(storeLoc.allowedRadiusMeters, 300);
console.log('  => TEST 2 ĐẠT ✅: Store và JSON đã đồng bộ với điểm chuẩn GPS mới');

// TEST 3: Kiểm tra công thức Haversine tại tọa độ Đại học Duy Tân
console.log('\n--- 3. Kiểm tra tính toán khoảng cách thực tế quanh Đại học Duy Tân ---');
const centerLat = BACKEND_GPS.latitude;
const centerLng = BACKEND_GPS.longitude;

// A: Cùng tọa độ -> 0m
const distSelf = calculateDistanceMeters(centerLat, centerLng, centerLat, centerLng);
assert.strictEqual(distSelf, 0, 'Khoảng cách tại tâm trường phải bằng 0m');

// B: Tọa độ trong sân trường Duy Tân (~45m)
const campusNearLat = 16.04960;
const campusNearLng = 108.16035;
const distNear = calculateDistanceMeters(centerLat, centerLng, campusNearLat, campusNearLng);
assert(distNear > 20 && distNear < 100, `Khoảng cách gần trong sân trường (${distNear}m)`);
assert(distNear <= BACKEND_GPS.allowedRadiusMeters, 'Nằm trong bán kính 300m');

// C: Tọa độ ngoài cổng trường, cách ~450m
const outsideLat = 16.05300;
const outsideLng = 108.16200;
const distOutside = calculateDistanceMeters(centerLat, centerLng, outsideLat, outsideLng);
assert(distOutside > 350, `Khoảng cách ngoài cổng trường (${distOutside}m)`);
assert(distOutside > BACKEND_GPS.allowedRadiusMeters, 'Vượt quá bán kính 300m');
console.log(`  => TEST 3 ĐẠT ✅: Khoảng cách tính toán chuẩn xác (Tại tâm: ${distSelf}m, Trong trường: ${distNear}m, Ngoài trường: ${distOutside}m)`);

// TEST 4: Xác thực GPS Báo cáo Sự cố Ẩn danh (Guest QR Report)
console.log('\n--- 4. Kiểm tra xác minh vị trí báo cáo của khách vãng lai ---');
const buildingConfig = {
  buildingName: BACKEND_GPS.buildingName,
  latitude: BACKEND_GPS.latitude,
  longitude: BACKEND_GPS.longitude,
  allowedRadiusMeters: BACKEND_GPS.allowedRadiusMeters,
  hasBoundaryConfig: true,
};

// Ca 4.1: Khách đang đứng trong khuôn viên trường Duy Tân (sai số 15m)
const resInCampus = evaluateAnonymousLocation(
  { latitude: campusNearLat, longitude: campusNearLng, accuracy: 15 },
  buildingConfig
);
assert.strictEqual(resInCampus.status, 'VERIFIED');
assert.strictEqual(resInCampus.label, 'Đã xác minh vị trí');
assert(resInCampus.reason.includes('Đại học Duy Tân'), 'Lý do phải nhắc đến Đại học Duy Tân');

// Ca 4.2: Khách ở xa ngoài trường (cách 450m)
const resOutside = evaluateAnonymousLocation(
  { latitude: outsideLat, longitude: outsideLng, accuracy: 20 },
  buildingConfig
);
assert.strictEqual(resOutside.status, 'UNVERIFIED');
assert.strictEqual(resOutside.label, 'Chưa xác minh vị trí');
assert(resOutside.reason.includes('ngoài phạm vi ranh giới của Đại học Duy Tân'));

// Ca 4.3: Sai số GPS quá lớn (> 150m)
const resLowAccuracy = evaluateAnonymousLocation(
  { latitude: campusNearLat, longitude: campusNearLng, accuracy: 200 },
  buildingConfig
);
assert.strictEqual(resLowAccuracy.status, 'UNVERIFIED');
assert(resLowAccuracy.reason.includes('vượt ngưỡng 150m'));

// Ca 4.4: Khách từ chối cấp quyền vị trí (null coords)
const resNoGps = evaluateAnonymousLocation(null, buildingConfig);
assert.strictEqual(resNoGps.status, 'UNVERIFIED');
assert(resNoGps.reason.includes('từ chối quyền vị trí'));
console.log('  => TEST 4 ĐẠT ✅: Kiểm tra ranh giới địa lý khách vãng lai hoạt động hoàn hảo');

console.log('\n================================================================');
console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ ĐỒNG BỘ GPS ĐẠI HỌC DUY TÂN ĐỀU ĐẠT 100%!');
console.log('================================================================\n');
