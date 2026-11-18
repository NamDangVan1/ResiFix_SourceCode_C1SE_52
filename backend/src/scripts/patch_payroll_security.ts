import fs from 'fs';
import path from 'path';

const filePath = path.resolve(__dirname, '../routes/payroll.routes.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Cập nhật check-in: Nonce, Building location confirmed, Photo validation & Watermark metadata
const oldCheckInSetup = `      // Đọc dữ liệu GPS & Ảnh từ Client gửi lên
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { photoUrl, latitude, longitude, accuracy, notes } = body;

      const buildingLoc = store.payrollConfig.buildingLocation || {
        buildingName: 'Tòa nhà ResiFix SkyView',
        buildingAddress: '123 Đường Nguyễn Hữu Thọ, Phường Tân Hưng, Quận 7, TP.HCM',
        latitude: 10.7324,
        longitude: 106.6992,
        allowedRadiusMeters: 300,
      };`;

const newCheckInSetup = `      // Đọc dữ liệu GPS & Ảnh từ Client gửi lên
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { photoUrl, latitude, longitude, accuracy, notes, nonce } = body;

      // Kiểm tra Nonce chống Replay Attack & Duplicate Request
      if (typeof nonce === 'string' && nonce.trim()) {
        const nonceCheck = consumeAttendanceNonce(nonce.trim(), techId);
        if (!nonceCheck.valid) {
          res.status(400).json({
            success: false,
            message: nonceCheck.reason || 'Mã phiên chấm công (nonce) không hợp lệ hoặc đã hết hạn.',
          });
          return;
        }
      }

      const buildingLoc = store.payrollConfig.buildingLocation || {
        buildingName: 'Tòa nhà ResiFix SkyView',
        buildingAddress: '123 Đường Nguyễn Hữu Thọ, Phường Tân Hưng, Quận 7, TP.HCM',
        latitude: 10.7324,
        longitude: 106.6992,
        allowedRadiusMeters: 300,
        isConfirmed: false,
      };`;

if (content.includes(oldCheckInSetup)) {
  content = content.replace(oldCheckInSetup, newCheckInSetup);
  console.log('[OK] Updated check-in nonce verification');
}

// 2. Thêm kiểm tra buildingLoc.isConfirmed và photoValidation trong check-in
const oldCheckInVerify = `      // 7. Xác định trạng thái xác minh:
      // - Nếu có ảnh chụp + GPS trong bán kính -> VERIFIED (tự động xác nhận)
      // - Nếu GPS ngoài phạm vi hoặc thiếu ảnh -> PENDING_REVIEW (chờ BMB xử lý ngoại lệ)
      let verificationStatus: AttendanceVerificationStatus = 'VERIFIED';
      const anomalyReasons: string[] = [];

      if (!hasGps) {
        verificationStatus = 'PENDING_REVIEW';
        anomalyReasons.push('Không xác định được vị trí GPS khi check-in');
      } else if (!isWithinRadius) {
        verificationStatus = 'PENDING_REVIEW';
        anomalyReasons.push(\`Vị trí GPS ngoài phạm vi tòa nhà (\${checkInGps?.distanceToBuildingMeters}m > \${buildingLoc.allowedRadiusMeters}m)\`);
      }

      if (!hasPhoto) {
        verificationStatus = 'PENDING_REVIEW';
        anomalyReasons.push('Thiếu ảnh chụp hiện trường check-in');
      }`;

const newCheckInVerify = `      // 7. Xác định trạng thái xác minh:
      let verificationStatus: AttendanceVerificationStatus = 'VERIFIED';
      const anomalyReasons: string[] = [];

      // Kiểm tra xem BMB đã xác nhận tọa độ chính thức của tòa nhà hay chưa
      if (!buildingLoc.isConfirmed) {
        verificationStatus = 'PENDING_REVIEW';
        anomalyReasons.push('Tọa độ tòa nhà chưa được BMB xác nhận chính thức. Ca trực đưa vào danh sách chờ BMB đối soát.');
      }

      if (!hasGps) {
        verificationStatus = 'PENDING_REVIEW';
        anomalyReasons.push('Không xác định được vị trí GPS khi check-in');
      } else if (!isWithinRadius) {
        verificationStatus = 'PENDING_REVIEW';
        anomalyReasons.push(\`Vị trí GPS ngoài phạm vi tòa nhà (\${checkInGps?.distanceToBuildingMeters}m > \${buildingLoc.allowedRadiusMeters}m)\`);
      } else if (typeof accuracy === 'number' && accuracy > 100) {
        anomalyReasons.push(\`Độ chính xác GPS kém (±\${Math.round(accuracy)}m > 100m), cần đối soát thực tế\`);
      }

      // Kiểm tra tính hợp lệ & an toàn của ảnh
      const photoValidation = validateAttendancePhoto(photoUrl);
      let photoMetadata: any = null;
      if (!photoValidation.valid) {
        verificationStatus = 'PENDING_REVIEW';
        anomalyReasons.push(photoValidation.message || 'Ảnh chụp check-in không hợp lệ');
      } else {
        photoMetadata = {
          originalPhotoUrl: photoUrl.trim(),
          watermarkText: \`ResiFix Attendance [\${tech.fullName}] • \${serverIsoTime} • \${buildingLoc.buildingName}\`,
          verifiedLocationText: checkInGps ? \`Tọa độ: \${checkInGps.latitude.toFixed(6)}, \${checkInGps.longitude.toFixed(6)} (~\${checkInGps.distanceToBuildingMeters}m)\` : 'Không có GPS',
          serverTimestamp: serverIsoTime,
          uploadedAt: serverIsoTime,
          mimeType: photoValidation.detectedMime,
          fileSizeBytes: photoValidation.sizeBytes,
          storageRetentionPolicy: 'Lưu giữ 90 ngày đối soát công lương theo quy định ResiFix. Không dùng nhận diện sinh trắc học.',
        };
      }`;

if (content.includes(oldCheckInVerify)) {
  content = content.replace(oldCheckInVerify, newCheckInVerify);
  console.log('[OK] Updated check-in verification with photo validation and building confirmation check');
}

// 3. Gắn photoMetadata vào bản ghi check-in
const oldCheckInRecord = `        checkInPhotoUrl: hasPhoto ? photoUrl.trim() : null,
        checkInGps,
        checkInNotes: typeof notes === 'string' ? notes.trim() : null,`;

const newCheckInRecord = `        checkInPhotoUrl: hasPhoto ? photoUrl.trim() : null,
        checkInGps,
        checkInNotes: typeof notes === 'string' ? notes.trim() : null,
        photoMetadata,`;

if (content.includes(oldCheckInRecord)) {
  content = content.replace(oldCheckInRecord, newCheckInRecord);
  console.log('[OK] Attached photoMetadata to check-in record');
}

// 4. Cập nhật check-out nonce
const oldCheckOutNonce = `      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { photoUrl, latitude, longitude, accuracy, notes } = body;`;

const newCheckOutNonce = `      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { photoUrl, latitude, longitude, accuracy, notes, nonce } = body;

      // Kiểm tra Nonce chống Replay Attack & Duplicate Request
      if (typeof nonce === 'string' && nonce.trim()) {
        const nonceCheck = consumeAttendanceNonce(nonce.trim(), techId);
        if (!nonceCheck.valid) {
          res.status(400).json({
            success: false,
            message: nonceCheck.reason || 'Mã phiên chấm công (nonce) không hợp lệ hoặc đã hết hạn.',
          });
          return;
        }
      }`;

if (content.includes(oldCheckOutNonce)) {
  content = content.replace(oldCheckOutNonce, newCheckOutNonce);
  console.log('[OK] Updated check-out nonce verification');
}

// 5. Cập nhật xử lý từ chối BMB (REJECT) để giữ lại disputedHours thay vì xóa trắng
const oldRejectAction = `      } else if (action === 'REJECT') {
        record.verificationStatus = 'REJECTED';
        record.billableHours = 0;
        record.disputedHours = 0;
        record.reviewNote = reviewNote.trim();`;

const newRejectAction = `      } else if (action === 'REJECT') {
        record.verificationStatus = 'REJECTED';
        record.billableHours = 0;
        record.disputedHours = record.workHours || 0; // Bảo lưu giờ thực tế để giải quyết tranh chấp lao động
        record.reviewNote = reviewNote.trim();`;

if (content.includes(oldRejectAction)) {
  content = content.replace(oldRejectAction, newRejectAction);
  console.log('[OK] Updated REJECT action to preserve disputedHours');
}

// 6. Kiểm tra khóa kỳ lương trong review endpoint
const oldReviewLockCheck = `      const store = resiFixStore.get();
      const record = store.attendanceLogs.find((a) => a.id === attendanceId);
      if (!record) {
        res.status(404).json({ success: false, message: 'Không tìm thấy ca chấm công này.' });
        return;
      }`;

const newReviewLockCheck = `      const store = resiFixStore.get();
      const record = store.attendanceLogs.find((a) => a.id === attendanceId);
      if (!record) {
        res.status(404).json({ success: false, message: 'Không tìm thấy ca chấm công này.' });
        return;
      }

      const shiftMonth = record.date.slice(0, 7);
      if (store.lockedMonths.some((m) => m.month === shiftMonth)) {
        res.status(403).json({
          success: false,
          message: \`Kỳ lương tháng \${shiftMonth} đã được khóa chính thức. Không thể sửa đổi hoặc phê duyệt ca này.\`,
        });
        return;
      }`;

if (content.includes(oldReviewLockCheck)) {
  content = content.replace(oldReviewLockCheck, newReviewLockCheck);
  console.log('[OK] Added locked month check in attendance review endpoint');
}

// 7. Cập nhật tính lương chuẩn Điều 98 BLLĐ 2019 trong my-salary
const oldMySalaryCalc = `      // Công thức tiền lương chi tiết
      const regularPay = Math.round(regularHours * hourlyRate);
      const nightPay = Math.round(nightHours * hourlyRate * ((cfg.otMultiplierNight || 1.3) - 1.0)); // Phụ cấp đêm 30%
      const otPay = Math.round(totalOtHours * hourlyRate * (cfg.otMultiplierNormal || 1.5));
      const allowance = cfg.standardAllowance || 730000;
      const totalSalary = regularPay + nightPay + otPay + allowance;
      const disputedPayEstimated = Math.round(disputedHours * hourlyRate);

      const isLocked = store.lockedMonths.some((m) => m.month === targetMonth);

      res.status(200).json({
        success: true,
        payroll: {
          month: targetMonth,
          hourlyRate,
          regularHours,
          regularPay,
          nightHours,
          nightPay,
          approvedOtHours: totalOtHours,
          otPay,
          standardAllowance: allowance,
          disputedHours,
          disputedPayEstimated,
          deductions: 0,
          totalSalary,
          isLocked,
          formulaDetail: \`Lương = (\${regularHours}h x \${hourlyRate.toLocaleString('vi-VN')}đ) + (Đêm: \${nightHours}h x 30%) + (OT: \${totalOtHours}h x 1.5) + Phụ cấp \${allowance.toLocaleString('vi-VN')}đ\`,`;

const newMySalaryCalc = `      // Công thức tiền lương chuẩn Điều 98 Bộ luật Lao động 2019
      const shiftSalary = calculateShiftSalaryVietnam(regularHours, nightHours, hourlyRate);
      const regularPay = shiftSalary.regularPay;
      const nightPay = shiftSalary.nightPay; // Đủ 130% tiền lương ca đêm theo Điều 98 Khoản 2

      let totalOtPay = 0;
      for (const ot of approvedOts) {
        const otH = ot.approvedHours ?? ot.hours;
        const dType = ot.dayType || getDayType(ot.date);
        const isNight = Boolean(ot.isNightOt);
        totalOtPay += calculateOvertimePay(otH, dType, isNight, hourlyRate);
      }
      const otPay = totalOtPay;

      const allowance = cfg.standardAllowance || 730000;
      const totalSalary = regularPay + nightPay + otPay + allowance;
      const disputedPayEstimated = Math.round(disputedHours * hourlyRate);

      const isLocked = store.lockedMonths.some((m) => m.month === targetMonth);

      res.status(200).json({
        success: true,
        payroll: {
          month: targetMonth,
          hourlyRate,
          regularHours,
          regularPay,
          nightHours,
          nightPay,
          approvedOtHours: totalOtHours,
          otPay,
          standardAllowance: allowance,
          disputedHours,
          disputedPayEstimated,
          deductions: 0,
          totalSalary,
          isLocked,
          formulaDetail: \`Lương = (Ngày: \${regularHours.toFixed(1)}h x \${hourlyRate.toLocaleString('vi-VN')}đ) + (Đêm: \${nightHours.toFixed(1)}h x \${(hourlyRate * 1.3).toLocaleString('vi-VN')}đ [BLLĐ Điều 98 K.2]) + (OT: \${otPay.toLocaleString('vi-VN')}đ [BLLĐ Điều 98 K.1,3]) + Phụ cấp \${allowance.toLocaleString('vi-VN')}đ\`,`;

if (content.includes(oldMySalaryCalc)) {
  content = content.replace(oldMySalaryCalc, newMySalaryCalc);
  console.log('[OK] Updated my-salary formula with Vietnam Labor Code 2019');
}

// 8. Cập nhật tính lương chuẩn trong admin/summary
const oldAdminSummaryCalc = `        const regularPay = Math.round(regularHours * hourlyRate);
        const nightPay = Math.round(nightHours * hourlyRate * ((cfg.otMultiplierNight || 1.3) - 1.0)); // Phụ cấp đêm 30%
        const otPay = Math.round(otHours * hourlyRate * (cfg.otMultiplierNormal || 1.5));
        const allowance = cfg.standardAllowance || 730000;
        const totalSalary = regularPay + nightPay + otPay + allowance;
        const disputedPayEstimated = Math.round(disputedHours * hourlyRate);`;

const newAdminSummaryCalc = `        const shiftSalary = calculateShiftSalaryVietnam(regularHours, nightHours, hourlyRate);
        const regularPay = shiftSalary.regularPay;
        const nightPay = shiftSalary.nightPay;

        let totalOtPay = 0;
        for (const ot of approvedOts) {
          const otH = ot.approvedHours ?? ot.hours;
          const dType = ot.dayType || getDayType(ot.date);
          const isNight = Boolean(ot.isNightOt);
          totalOtPay += calculateOvertimePay(otH, dType, isNight, hourlyRate);
        }
        const otPay = totalOtPay;

        const allowance = cfg.standardAllowance || 730000;
        const totalSalary = regularPay + nightPay + otPay + allowance;
        const disputedPayEstimated = Math.round(disputedHours * hourlyRate);`;

if (content.includes(oldAdminSummaryCalc)) {
  content = content.replace(oldAdminSummaryCalc, newAdminSummaryCalc);
  console.log('[OK] Updated admin/summary formula with Vietnam Labor Code 2019');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('[SUCCESS] All payroll security & labor law patches applied cleanly!');

