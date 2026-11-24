/**
 * AUTOMATED TEST SUITE: INCIDENT TIMELINE & SLA CALCULATION
 * 
 * Kiểm thử toàn diện dòng thời gian xử lý sự cố & đối chiếu SLA:
 * 1. Ticket vừa tiếp nhận (PENDING) khi AI đang chạy: hiển thị "Chờ duyệt", thời gian đã chờ.
 * 2. Luồng đầy đủ (PENDING -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> CLOSED): đúng thứ tự, thời lượng từng giai đoạn, tổng thời gian.
 * 3. SLA: ON_TRACK, AT_RISK, BREACHED, PAUSED, Chưa có thời hạn quy định.
 * 4. Mốc chờ nghiệm thu: xuất hiện khi có quy trình sửa chữa; không tạo mốc giả khi bị hủy/từ chối từ đầu.
 * 5. Các trường hợp ngoài luồng: Chuyển KTV / thu hồi phân công, yêu cầu làm lại, từ chối/hủy sự cố.
 * 6. Ticket cũ thiếu nhật ký (legacy) và lọc log trùng / log AI.
 * 7. Kiểm tra định dạng ngày giờ qua nửa đêm (midnight boundary).
 * 8. Phân quyền hiển thị theo vai trò (Cư dân vs BMB vs KTV).
 */

import {
  buildIncidentTimeline,
  formatIncidentDateTime,
  formatDuration,
} from '../services/incident_timeline.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION_FAILED] ${message}`);
  }
}

async function runTimelineTests() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU CHẠY KIỂM THỬ: DÒNG THỜI GIAN TIẾN ĐỘ & SLA (RESIFIX)');
  console.log('================================================================\n');

  // Mốc thời gian giả lập cố định
  const T0 = new Date('2026-11-24T10:00:00.000Z'); // Tạo ticket: 10:00
  const T1 = new Date('2026-11-24T10:18:00.000Z'); // Phân công: 10:18 (18 phút)
  const T2 = new Date('2026-11-24T10:30:00.000Z'); // KTV nhận việc: 10:30 (12 phút)
  const T3 = new Date('2026-11-24T12:05:00.000Z'); // KTV sửa xong: 12:05 (1 giờ 35 phút)
  const T4 = new Date('2026-11-24T12:30:00.000Z'); // Cư dân nghiệm thu: 12:30 (25 phút)

  // --------------------------------------------------------------------------
  // TEST 1: Ticket vừa tiếp nhận (PENDING) khi AI đang phân tích
  // --------------------------------------------------------------------------
  console.log('TEST 1: Ticket vừa tiếp nhận (PENDING) khi AI đang phân tích...');
  {
    const ticketPending = {
      id: 'ticket-1',
      ticketCode: 'SC-20261124-001',
      status: 'PENDING',
      createdAt: T0.toISOString(),
      aiStatus: 'ANALYZING',
      statusLogs: [
        {
          toStatus: 'PENDING',
          title: 'Đã tiếp nhận (Chờ duyệt)',
          createdAt: T0.toISOString(),
        },
      ],
    };

    const summary = buildIncidentTimeline(ticketPending, {
      now: T1.getTime(), // 18 phút sau khi tạo
      role: 'RESIDENT',
    });

    assert(summary.currentStatus === 'PENDING', 'Trạng thái hiện tại phải là PENDING');
    assert(summary.currentStatusLabel === 'Chờ duyệt', 'Nhãn trạng thái phải là "Chờ duyệt"');
    assert(summary.totalDurationLabel === 'Tổng thời gian thực tế: 18 phút', 'Tổng thời gian phải là 18 phút');

    const intakeMilestone = summary.milestones.find((m) => m.key === 'INTAKE');
    assert(intakeMilestone !== undefined, 'Phải có mốc INTAKE');
    assert(intakeMilestone?.status === 'ACTIVE', 'Mốc INTAKE phải ở trạng thái ACTIVE');
    assert(intakeMilestone?.durationLabel === 'Đang chờ duyệt · 18 phút', `Label phải là "Đang chờ duyệt · 18 phút", nhận được: ${intakeMilestone?.durationLabel}`);
    assert(intakeMilestone?.note?.includes('AI đang phân tích') === true, 'Ghi chú phải nêu rõ AI đang phân tích trong nền');

    const assignedMilestone = summary.milestones.find((m) => m.key === 'ASSIGNED');
    assert(assignedMilestone?.status === 'PENDING', 'Mốc phân công phải là PENDING');
    assert(assignedMilestone?.formattedTime === 'Chờ phân công', 'Thời gian phân công phải ghi "Chờ phân công"');

    console.log('  => TEST 1 ĐẠT ✅');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Toàn bộ vòng đời chuẩn (PENDING -> ASSIGNED -> IN_PROGRESS -> COMPLETED -> CLOSED)
  // --------------------------------------------------------------------------
  console.log('\nTEST 2: Toàn bộ vòng đời chuẩn với thời lượng từng giai đoạn và tổng thời gian...');
  {
    const fullTicket = {
      id: 'ticket-2',
      ticketCode: 'SC-20261124-002',
      status: 'CLOSED',
      createdAt: T0.toISOString(),
      assignedAt: T1.toISOString(),
      acknowledgedAt: T2.toISOString(),
      completedAt: T3.toISOString(),
      resolvedConfirmedAt: T4.toISOString(),
      ratingStars: 5,
      ratingComment: 'Kỹ thuật viên xử lý rất nhanh và sạch sẽ!',
      assignedTech: { fullName: 'Nguyễn Văn An', specialtyLabel: 'Điện - Nước' },
      statusLogs: [
        { toStatus: 'PENDING', title: 'Đã tiếp nhận', createdAt: T0.toISOString() },
        { toStatus: 'ASSIGNED', title: 'Đã phân công', createdAt: T1.toISOString() },
        { toStatus: 'IN_PROGRESS', title: 'Đang xử lý', createdAt: T2.toISOString() },
        { toStatus: 'COMPLETED', title: 'Hoàn thành sửa chữa', createdAt: T3.toISOString() },
        { toStatus: 'CLOSED', title: 'Đã đóng sự cố', createdAt: T4.toISOString() },
      ],
    };

    const summary = buildIncidentTimeline(fullTicket, { now: T4.getTime(), role: 'RESIDENT' });

    assert(summary.currentStatus === 'CLOSED', 'Trạng thái là CLOSED');
    assert(summary.milestones.length === 5, `Phải có đúng 5 mốc, nhận được: ${summary.milestones.length}`);

    // Mốc 1: Chờ duyệt 18 phút
    const m1 = summary.milestones[0];
    assert(m1.key === 'INTAKE' && m1.status === 'COMPLETED', 'Mốc 1 INTAKE COMPLETED');
    assert(m1.durationLabel === 'Chờ duyệt 18 phút', `Mốc 1 durationLabel: ${m1.durationLabel}`);

    // Mốc 2: Chờ KTV nhận việc 12 phút (10:18 đến 10:30)
    const m2 = summary.milestones[1];
    assert(m2.key === 'ASSIGNED' && m2.status === 'COMPLETED', 'Mốc 2 ASSIGNED COMPLETED');
    assert(m2.durationLabel === 'Chờ KTV nhận việc 12 phút', `Mốc 2 durationLabel: ${m2.durationLabel}`);

    // Mốc 3: Xử lý 1 giờ 35 phút (10:30 đến 12:05)
    const m3 = summary.milestones[2];
    assert(m3.key === 'IN_PROGRESS' && m3.status === 'COMPLETED', 'Mốc 3 IN_PROGRESS COMPLETED');
    assert(m3.durationLabel === 'Xử lý 1 giờ 35 phút', `Mốc 3 durationLabel: ${m3.durationLabel}`);

    // Mốc 4: Chờ nghiệm thu 25 phút (12:05 đến 12:30)
    const m4 = summary.milestones[3];
    assert(m4.key === 'COMPLETED' && m4.status === 'COMPLETED', 'Mốc 4 COMPLETED');
    assert(m4.durationLabel === 'Chờ nghiệm thu 25 phút', `Mốc 4 durationLabel: ${m4.durationLabel}`);

    // Mốc 5: Hoàn thành (12:30)
    const m5 = summary.milestones[4];
    assert(m5.key === 'CLOSED' && m5.status === 'COMPLETED', 'Mốc 5 CLOSED COMPLETED');
    assert(m5.note?.includes('5⭐') === true, 'Mốc 5 phải có đánh giá sao');

    // Tổng thời gian: 10:00 đến 12:30 = 2 giờ 30 phút
    assert(
      summary.totalDurationLabel === 'Tổng thời gian thực tế: 2 giờ 30 phút',
      `Tổng thời gian phải là "Tổng thời gian thực tế: 2 giờ 30 phút", nhận được: ${summary.totalDurationLabel}`
    );

    console.log('  => TEST 2 ĐẠT ✅');
  }

  // --------------------------------------------------------------------------
  // TEST 3: Đối chiếu chính sách SLA (ON_TRACK, AT_RISK, BREACHED, PAUSED, Chưa có quy định)
  // --------------------------------------------------------------------------
  console.log('\nTEST 3: Đối chiếu chính sách SLA và thời hạn...');
  {
    const resolutionDeadline = new Date('2026-11-24T14:00:00.000Z'); // Hạn 14:00 (4 giờ từ 10:00)

    // 3A: Chưa có SLA
    const ticketNoSla = {
      id: 't-no-sla',
      status: 'PENDING',
      createdAt: T0.toISOString(),
      slaTracking: null,
    };
    const sNoSla = buildIncidentTimeline(ticketNoSla, { now: T1.getTime() });
    assert(sNoSla.slaInfo.hasSla === false, 'Phải ghi nhận không có SLA');
    assert(sNoSla.slaInfo.formattedDeadline === 'Chưa có thời hạn quy định', 'Hạn phải ghi Chưa có thời hạn quy định');
    assert(sNoSla.slaInfo.slaRemainingText === 'Chưa có thời hạn quy định', 'Trạng thái còn lại Chưa có thời hạn quy định');

    // 3B: Đang chạy SLA ON_TRACK: Hiện tại 11:45, hạn 14:00 -> Còn 2 giờ 15 phút
    const nowOnTrack = new Date('2026-11-24T11:45:00.000Z');
    const ticketOnTrack = {
      id: 't-on-track',
      status: 'IN_PROGRESS',
      createdAt: T0.toISOString(),
      acknowledgedAt: T2.toISOString(),
      slaTracking: {
        resolutionDeadline: resolutionDeadline.toISOString(),
        slaStatus: 'ON_TRACK',
        isPaused: false,
      },
    };
    const sOnTrack = buildIncidentTimeline(ticketOnTrack, { now: nowOnTrack.getTime() });
    assert(sOnTrack.slaInfo.slaStatus === 'ON_TRACK', 'SLA phải là ON_TRACK');
    assert(sOnTrack.slaInfo.slaRemainingText === 'Còn 2 giờ 15 phút', `Còn 2 giờ 15 phút, nhận được: ${sOnTrack.slaInfo.slaRemainingText}`);

    // 3C: Quá hạn SLA (BREACHED): Hiện tại 14:25, hạn 14:00 -> Trễ 25 phút
    const nowBreached = new Date('2026-11-24T14:25:00.000Z');
    const ticketBreached = {
      ...ticketOnTrack,
      slaTracking: {
        resolutionDeadline: resolutionDeadline.toISOString(),
        slaStatus: 'BREACHED',
        isPaused: false,
      },
    };
    const sBreached = buildIncidentTimeline(ticketBreached, { now: nowBreached.getTime() });
    assert(sBreached.slaInfo.slaStatus === 'BREACHED', 'SLA phải là BREACHED');
    assert(sBreached.slaInfo.slaRemainingText === 'Trễ 25 phút', `Trễ 25 phút, nhận được: ${sBreached.slaInfo.slaRemainingText}`);

    // 3D: Hoàn thành đúng hạn: Hoàn tất lúc 12:30 <= 14:00
    const ticketClosedOnTime = {
      id: 't-closed-ontime',
      status: 'CLOSED',
      createdAt: T0.toISOString(),
      resolvedConfirmedAt: T4.toISOString(), // 12:30
      slaTracking: {
        resolutionDeadline: resolutionDeadline.toISOString(),
        slaStatus: 'ON_TRACK',
      },
    };
    const sClosedOnTime = buildIncidentTimeline(ticketClosedOnTime, { now: T4.getTime() });
    assert(sClosedOnTime.slaInfo.slaStatusLabel === 'Hoàn thành đúng hạn', 'Hoàn thành đúng hạn');
    assert(sClosedOnTime.slaInfo.slaRemainingText === 'Hoàn thành đúng hạn', 'slaRemainingText Hoàn thành đúng hạn');

    // 3E: Hoàn thành trễ hạn: Hoàn tất lúc 14:25 > 14:00 (trễ 25 phút)
    const ticketClosedLate = {
      id: 't-closed-late',
      status: 'CLOSED',
      createdAt: T0.toISOString(),
      resolvedConfirmedAt: nowBreached.toISOString(), // 14:25
      slaTracking: {
        resolutionDeadline: resolutionDeadline.toISOString(),
        slaStatus: 'BREACHED',
      },
    };
    const sClosedLate = buildIncidentTimeline(ticketClosedLate, { now: nowBreached.getTime() });
    assert(sClosedLate.slaInfo.slaRemainingText === 'Hoàn thành trễ 25 phút', `Hoàn thành trễ 25 phút, nhận được: ${sClosedLate.slaInfo.slaRemainingText}`);

    // 3F: Tạm dừng SLA (PAUSED)
    const ticketPaused = {
      id: 't-paused',
      status: 'IN_PROGRESS',
      createdAt: T0.toISOString(),
      slaTracking: {
        resolutionDeadline: resolutionDeadline.toISOString(),
        isPaused: true,
        pauseReason: 'Chờ vật tư thay thế van nước',
        escalationTier: 1,
      },
    };
    const sPaused = buildIncidentTimeline(ticketPaused, { now: nowOnTrack.getTime(), role: 'BMB' });
    assert(sPaused.slaInfo.slaStatus === 'PAUSED', 'SLA phải là PAUSED');
    assert(sPaused.slaInfo.slaRemainingText.includes('Chờ vật tư thay thế van nước'), 'Phải nêu lý do tạm dừng');
    assert(sPaused.slaInfo.escalationTier === 1, 'Cấp độ leo thang 1');

    console.log('  => TEST 3 ĐẠT ✅');
  }

  // --------------------------------------------------------------------------
  // TEST 4: Mốc Chờ nghiệm thu xuất hiện đúng ngữ cảnh, không tạo mốc giả khi bị hủy
  // --------------------------------------------------------------------------
  console.log('\nTEST 4: Mốc Chờ nghiệm thu xuất hiện đúng ngữ cảnh...');
  {
    // Ticket bị Hủy/Từ chối từ đầu
    const ticketCancelled = {
      id: 't-cancelled',
      status: 'CANCELLED',
      createdAt: T0.toISOString(),
      statusLogs: [
        { toStatus: 'PENDING', title: 'Đã tiếp nhận', createdAt: T0.toISOString() },
        { toStatus: 'CANCELLED', title: 'Từ chối sự cố', note: 'Khu vực không thuộc phạm vi bảo trì tòa nhà', createdAt: T1.toISOString() },
      ],
    };

    const sCancelled = buildIncidentTimeline(ticketCancelled, { now: T1.getTime() });
    const hasCompletedMilestone = sCancelled.milestones.some((m) => m.key === 'COMPLETED');
    assert(!hasCompletedMilestone, 'Ticket bị hủy không được hiển thị mốc giả "Chờ nghiệm thu"');

    const cancelMilestone = sCancelled.milestones.find((m) => m.key === 'SPECIAL' && m.status === 'CANCELLED');
    assert(cancelMilestone !== undefined, 'Phải có mốc Đã từ chối / Hủy sự cố');
    assert(cancelMilestone?.note?.includes('không thuộc phạm vi') === true, 'Phải hiển thị lý do từ chối');

    console.log('  => TEST 4 ĐẠT ✅');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Xử lý Chuyển KTV / Thu hồi phân công & Yêu cầu làm lại
  // --------------------------------------------------------------------------
  console.log('\nTEST 5: Xử lý Chuyển KTV, làm lại và duy trì tổng thời gian...');
  {
    const T1_revoke = new Date('2026-11-24T10:25:00.000Z');
    const T1_reassign = new Date('2026-11-24T10:35:00.000Z');

    const ticketReassigned = {
      id: 't-reassign',
      status: 'ASSIGNED',
      createdAt: T0.toISOString(),
      assignedAt: T1_reassign.toISOString(),
      assignedTech: { fullName: 'Trần Văn Bình', specialtyLabel: 'Điện & Chiếu sáng' },
      statusLogs: [
        { toStatus: 'PENDING', title: 'Đã tiếp nhận', createdAt: T0.toISOString() },
        { toStatus: 'ASSIGNED', title: 'Đã phân công KTV A', createdAt: T1.toISOString() },
        {
          fromStatus: 'ASSIGNED',
          toStatus: 'PENDING',
          title: 'Thu hồi phân công sự cố',
          note: 'KTV A bận việc đột xuất ngoài ca',
          createdAt: T1_revoke.toISOString(),
        },
        { toStatus: 'ASSIGNED', title: 'Đã phân công KTV B', createdAt: T1_reassign.toISOString() },
      ],
    };

    const sReassign = buildIncidentTimeline(ticketReassigned, { now: new Date('2026-11-24T10:45:00.000Z').getTime() });
    const hasRevokeMilestone = sReassign.milestones.some((m) => m.title.includes('Thu hồi phân công sự cố'));
    assert(hasRevokeMilestone, 'Phải có mốc Thu hồi phân công');
    assert(sReassign.totalDurationLabel === 'Tổng thời gian thực tế: 45 phút', `Tổng thời gian vẫn tính từ lúc tạo: ${sReassign.totalDurationLabel}`);

    // Yêu cầu làm lại (Rework)
    const ticketRework = {
      id: 't-rework',
      status: 'IN_PROGRESS',
      createdAt: T0.toISOString(),
      statusLogs: [
        { toStatus: 'PENDING', title: 'Đã tiếp nhận', createdAt: T0.toISOString() },
        { toStatus: 'ASSIGNED', title: 'Đã phân công', createdAt: T1.toISOString() },
        { toStatus: 'IN_PROGRESS', title: 'Đang xử lý', createdAt: T2.toISOString() },
        { toStatus: 'COMPLETED', title: 'Hoàn thành sửa chữa lần 1', createdAt: T3.toISOString() },
        {
          fromStatus: 'COMPLETED',
          toStatus: 'IN_PROGRESS',
          title: 'Yêu cầu làm lại sự cố',
          note: 'Ống nước vẫn rỉ giọt sau khi thay gioăng',
          createdAt: new Date('2026-11-24T12:15:00.000Z').toISOString(),
        },
      ],
    };

    const sRework = buildIncidentTimeline(ticketRework, { now: new Date('2026-11-24T12:25:00.000Z').getTime() });
    const hasReworkMilestone = sRework.milestones.some((m) => m.title.includes('Yêu cầu làm lại sự cố'));
    assert(hasReworkMilestone, 'Phải có mốc Yêu cầu làm lại sự cố');
    assert(sRework.currentStatus === 'IN_PROGRESS', 'Trạng thái hiện hành phải là IN_PROGRESS');

    console.log('  => TEST 5 ĐẠT ✅');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Ticket cũ thiếu nhật ký & Lọc log trùng / log AI
  // --------------------------------------------------------------------------
  console.log('\nTEST 6: Ticket cũ thiếu nhật ký và lọc log trùng lặp...');
  {
    // Legacy ticket: statusLogs rỗng hoàn toàn, chỉ có các trường timestamp
    const legacyTicket = {
      id: 't-legacy',
      status: 'COMPLETED',
      createdAt: T0.toISOString(),
      assignedAt: T1.toISOString(),
      acknowledgedAt: T2.toISOString(),
      completedAt: T3.toISOString(),
      statusLogs: [], // không có log
    };

    const sLegacy = buildIncidentTimeline(legacyTicket, { now: T3.getTime() });
    assert(sLegacy.milestones.length >= 4, 'Ticket legacy vẫn dựng được các mốc từ trường timestamp');
    assert(sLegacy.totalDurationLabel === 'Tổng thời gian thực tế: 2 giờ 5 phút', `Tổng thời gian legacy: ${sLegacy.totalDurationLabel}`);

    // Ticket có log trùng lặp & log AI
    const noisyTicket = {
      id: 't-noisy',
      status: 'PENDING',
      createdAt: T0.toISOString(),
      statusLogs: [
        { toStatus: 'PENDING', title: 'Đã tiếp nhận', createdAt: T0.toISOString() },
        { fromStatus: 'PENDING', toStatus: 'PENDING', title: '[AI] Đang phân tích ảnh', createdAt: T0.toISOString() },
        { fromStatus: 'PENDING', toStatus: 'PENDING', title: 'Cập nhật ghi chú không đổi trạng thái', createdAt: T0.toISOString() },
      ],
    };

    const sNoisy = buildIncidentTimeline(noisyTicket, { now: T1.getTime() });
    assert(sNoisy.milestones.length === 5, `Số mốc không bị nhân bản bởi log trùng/AI, nhận được: ${sNoisy.milestones.length}`);

    console.log('  => TEST 6 ĐẠT ✅');
  }

  // --------------------------------------------------------------------------
  // TEST 7: Định dạng ngày giờ qua nửa đêm (Midnight Boundary)
  // --------------------------------------------------------------------------
  console.log('\nTEST 7: Kiểm tra định dạng ngày giờ qua nửa đêm (Midnight boundary)...');
  {
    const midnightBefore = new Date('2026-11-24T23:55:00.000+07:00');
    const midnightAfter = new Date('2026-11-25T00:20:00.000+07:00');

    const strBefore = formatIncidentDateTime(midnightBefore);
    const strAfter = formatIncidentDateTime(midnightAfter);

    assert(strBefore.includes('23:55') && strBefore.includes('24/11/2026'), `Trước nửa đêm: ${strBefore}`);
    assert(strAfter.includes('00:20') && strAfter.includes('25/11/2026'), `Sau nửa đêm: ${strAfter}`);

    const durationAcrossMidnight = formatDuration(midnightAfter.getTime() - midnightBefore.getTime());
    assert(durationAcrossMidnight === '25 phút', `Thời lượng qua nửa đêm phải là 25 phút, nhận được: ${durationAcrossMidnight}`);

    // Bảo vệ không hiển thị thời lượng âm nếu timestamp bị ngược
    const negativeDuration = formatDuration(midnightBefore.getTime() - midnightAfter.getTime());
    assert(negativeDuration === null, 'Thời lượng âm phải trả về null');

    console.log('  => TEST 7 ĐẠT ✅');
  }

  // --------------------------------------------------------------------------
  // TEST 8: Phân quyền hiển thị theo vai trò (Role-based visibility)
  // --------------------------------------------------------------------------
  console.log('\nTEST 8: Phân quyền hiển thị theo vai trò...');
  {
    const sensitiveTicket = {
      id: 't-sensitive',
      status: 'ASSIGNED',
      createdAt: T0.toISOString(),
      assignedAt: T1.toISOString(),
      bmbAdminNote: 'Cần kiểm tra kỹ hợp đồng bảo hành thiết bị trước khi thanh toán',
      assignedTech: { fullName: 'Lê Hoàng Nam', specialtyLabel: 'Thang máy' },
      statusLogs: [
        { toStatus: 'PENDING', title: 'Đã tiếp nhận', createdAt: T0.toISOString() },
        {
          toStatus: 'ASSIGNED',
          title: 'Đã phân công',
          note: 'BMB điều động nhân sự gấp',
          changedBy: { fullName: 'Quản lý Trần Hùng', role: 'BMB' },
          createdAt: T1.toISOString(),
        },
      ],
      slaTracking: {
        resolutionDeadline: new Date('2026-11-24T14:00:00.000Z').toISOString(),
        escalationTier: 2,
        isPaused: false,
      },
    };

    // Cư dân xem: Không thấy ghi chú nội bộ BMB, không thấy cảnh báo leo thang nội bộ
    const sResident = buildIncidentTimeline(sensitiveTicket, { now: T2.getTime(), role: 'RESIDENT' });
    const assignedMilestoneRes = sResident.milestones.find((m) => m.key === 'ASSIGNED');
    assert(assignedMilestoneRes?.note?.includes('hợp đồng bảo hành') === false, 'Cư dân không được thấy ghi chú nội bộ BMB');
    assert(assignedMilestoneRes?.note?.includes('Lê Hoàng Nam') === true, 'Cư dân thấy tên KTV tiếp nhận');

    // BMB xem: Thấy ghi chú nội bộ, người thực hiện, cấp độ leo thang
    const sBmb = buildIncidentTimeline(sensitiveTicket, { now: T2.getTime(), role: 'BMB' });
    const assignedMilestoneBmb = sBmb.milestones.find((m) => m.key === 'ASSIGNED');
    assert(assignedMilestoneBmb?.note?.includes('hợp đồng bảo hành') === true, 'BMB phải thấy ghi chú nội bộ');
    assert(assignedMilestoneBmb?.actorName === 'Quản lý Trần Hùng', 'BMB thấy người phân công');
    assert(sBmb.slaInfo.escalationTier === 2, 'BMB thấy cấp độ leo thang 2');

    console.log('  => TEST 8 ĐẠT ✅');
  }

  console.log('\n================================================================');
  console.log('🎉 TẤT CẢ 8 CA KIỂM THỬ DÒNG THỜI GIAN & SLA ĐÃ HOÀN TOÀN ĐẠT!');
  console.log('================================================================');
}

runTimelineTests().catch((err) => {
  console.error('\n❌ KIỂM THỬ THẤT BẠI:', err);
  process.exit(1);
});
