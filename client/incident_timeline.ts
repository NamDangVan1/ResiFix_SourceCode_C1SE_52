/**
 * INCIDENT TIMELINE & SLA CALCULATION MODULE (CLIENT)
 * - Tính toán dòng thời gian xử lý sự cố từ lúc tiếp nhận đến khi hoàn thành
 * - Tính thời lượng thực tế của từng giai đoạn và tổng thời gian từ lúc tạo
 * - Đối chiếu thời hạn cam kết SLA (Đúng hạn, Sắp quá hạn, Quá hạn, Tạm dừng)
 * - Xử lý chuyển KTV, làm lại, hủy/từ chối, lọc log AI/trùng lặp, bảo vệ lỗi timestamp
 * - Áp dụng phân quyền hiển thị theo vai trò (Cư dân, BMB, KTV, Khách QR)
 */

export type TimelineRole = 'RESIDENT' | 'BMB' | 'TECHNICIAN' | 'GUEST';

export type MilestoneKey = 'INTAKE' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED' | 'SPECIAL';

export type MilestoneStatus = 'COMPLETED' | 'ACTIVE' | 'PENDING' | 'CANCELLED';

export type SlaStatusType = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'PAUSED' | 'NONE';

export interface TimelineMilestone {
  key: MilestoneKey;
  title: string;
  status: MilestoneStatus;
  timestamp: string | null;
  formattedTime: string;
  durationLabel: string | null;
  note: string | null;
  actorName: string | null;
  isSpecialEvent?: boolean;
}

export interface SlaSummaryInfo {
  hasSla: boolean;
  slaStatus: SlaStatusType;
  slaStatusLabel: string;
  resolutionDeadline: string | null;
  formattedDeadline: string;
  slaRemainingText: string;
  isPaused: boolean;
  pauseReason?: string | null;
  escalationTier: number;
}

export interface IncidentTimelineSummary {
  currentStatus: string;
  currentStatusLabel: string;
  totalDurationMs: number | null;
  totalDurationLabel: string;
  slaInfo: SlaSummaryInfo;
  milestones: TimelineMilestone[];
}

/**
 * Định dạng ngày giờ chuẩn: "14:35 · 24/11/2026"
 * Xử lý an toàn khi ngày giờ không hợp lệ hoặc thiếu dữ liệu.
 */
export const formatIncidentDateTime = (value?: string | Date | number | null): string => {
  if (!value) return 'Chưa ghi nhận thời điểm';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa ghi nhận thời điểm';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${hours}:${minutes} · ${day}/${month}/${year}`;
};

/**
 * Định dạng khoảng thời gian bằng tiếng Việt:
 * - Dưới 1 phút: "< 1 phút"
 * - Phút: "18 phút"
 * - Giờ và phút: "1 giờ 35 phút"
 * - Ngày và giờ: "2 ngày 4 giờ"
 * Ẩn và trả về null nếu số âm hoặc không hợp lệ.
 */
export const formatDuration = (ms: number | null | undefined): string | null => {
  if (ms === null || ms === undefined || Number.isNaN(ms) || ms < 0) return null;
  if (ms < 60 * 1000) return '< 1 phút';

  const totalMinutes = Math.floor(ms / (60 * 1000));
  if (totalMinutes < 60) return `${totalMinutes} phút`;

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remainingMinutes > 0 ? `${totalHours} giờ ${remainingMinutes} phút` : `${totalHours} giờ`;
  }

  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return remainingHours > 0 ? `${totalDays} ngày ${remainingHours} giờ` : `${totalDays} ngày`;
};

/**
 * Lấy nhãn tiếng Việt của trạng thái sự cố
 */
export const getStatusLabel = (status?: string | null): string => {
  switch (status) {
    case 'PENDING':
      return 'Chờ duyệt';
    case 'ASSIGNED':
      return 'Đã phân công';
    case 'IN_PROGRESS':
      return 'Đang xử lý';
    case 'COMPLETED':
      return 'Đã sửa xong · Chờ nghiệm thu';
    case 'CLOSED':
      return 'Hoàn thành';
    case 'CANCELLED':
    case 'REJECTED':
      return 'Đã hủy / Từ chối';
    default:
      return status || 'Đang xử lý';
  }
};

/**
 * Lọc các log hợp lệ, loại bỏ log trùng lặp và log AI không làm đổi tiến độ nghiệp vụ
 */
export const sanitizeStatusLogs = (rawLogs?: any[]): any[] => {
  if (!Array.isArray(rawLogs) || rawLogs.length === 0) return [];

  const cleanLogs: any[] = [];
  for (const log of rawLogs) {
    if (!log) continue;
    const title = String(log.title || '');
    const note = String(log.note || '');

    // Bỏ qua log trùng lặp hoàn toàn fromStatus === toStatus nếu không có ý nghĩa chuyển giao/làm lại
    const isReassignment = title.includes('Thu hồi') || title.includes('Chuyển') || note.includes('Thu hồi') || note.includes('Chuyển');
    const isRework = title.includes('làm lại') || note.includes('làm lại') || title.includes('mở lại');
    const isCancellation = title.includes('Hủy') || title.includes('Từ chối') || note.includes('Hủy') || note.includes('Từ chối');

    if (log.fromStatus && log.toStatus && log.fromStatus === log.toStatus && !isReassignment && !isRework && !isCancellation) {
      continue;
    }

    // Bỏ qua log AI tự động ghi nhận phân tích mà không thay đổi trạng thái
    if (title.startsWith('[AI]') || title.includes('AI đang phân tích')) {
      continue;
    }

    cleanLogs.push(log);
  }

  return cleanLogs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
};

/**
 * Xây dựng dòng thời gian và tính toán SLA chi tiết
 */
export const buildIncidentTimeline = (
  ticket: any,
  options?: {
    now?: Date | number | string;
    role?: TimelineRole;
  }
): IncidentTimelineSummary => {
  const role = options?.role || 'RESIDENT';
  const nowMs = options?.now ? new Date(options.now).getTime() : Date.now();

  const ticketStatus = String(ticket?.status || 'PENDING');
  const createdAtMs = ticket?.createdAt ? new Date(ticket.createdAt).getTime() : null;

  // Lấy các log đã chuẩn hóa
  const statusLogs = sanitizeStatusLogs(ticket?.statusLogs);

  // Tìm các mốc thời gian từ statusLogs hoặc ticket properties
  const intakeLog = statusLogs.find((l) => l.toStatus === 'PENDING' && !l.title?.includes('Thu hồi'));
  const assignLog = statusLogs.find((l) => l.toStatus === 'ASSIGNED');
  const inProgressLog = statusLogs.find((l) => l.toStatus === 'IN_PROGRESS');
  const completedLog = statusLogs.find((l) => l.toStatus === 'COMPLETED');
  const closedLog = statusLogs.find((l) => l.toStatus === 'CLOSED');

  // Tìm các sự kiện đặc biệt (Thu hồi phân công, chuyển KTV, làm lại, hủy/từ chối)
  const reassignmentLog = statusLogs.find(
    (l) => (l.title?.includes('Thu hồi') || l.note?.includes('Thu hồi') || (l.fromStatus === 'ASSIGNED' && l.toStatus === 'PENDING'))
  );
  const reworkLog = statusLogs.find((l) => l.title?.includes('làm lại') || l.note?.includes('làm lại'));
  const cancelLog = statusLogs.find((l) => l.toStatus === 'CANCELLED' || l.title?.includes('Hủy') || l.title?.includes('Từ chối'));

  // Timestamps
  const intakeMs = createdAtMs || (intakeLog?.createdAt ? new Date(intakeLog.createdAt).getTime() : null);
  const assignedMs = ticket?.assignedAt
    ? new Date(ticket.assignedAt).getTime()
    : assignLog?.createdAt
      ? new Date(assignLog.createdAt).getTime()
      : null;
  const acknowledgedMs = ticket?.acknowledgedAt
    ? new Date(ticket.acknowledgedAt).getTime()
    : inProgressLog?.createdAt
      ? new Date(inProgressLog.createdAt).getTime()
      : null;
  const completedMs = ticket?.completedAt
    ? new Date(ticket.completedAt).getTime()
    : completedLog?.createdAt
      ? new Date(completedLog.createdAt).getTime()
      : null;
  const closedMs = ticket?.resolvedConfirmedAt
    ? new Date(ticket.resolvedConfirmedAt).getTime()
    : closedLog?.createdAt
      ? new Date(closedLog.createdAt).getTime()
      : null;

  // 1. MỐC 1: Đã tiếp nhận · Chờ duyệt
  const isIntakeActive = ticketStatus === 'PENDING';
  let intakeDurationLabel: string | null = null;
  if (intakeMs !== null) {
    if (isIntakeActive) {
      const elapsed = nowMs - intakeMs;
      if (elapsed >= 0) intakeDurationLabel = `Đang chờ duyệt · ${formatDuration(elapsed)}`;
    } else {
      const nextMs = assignedMs || acknowledgedMs || completedMs || closedMs;
      if (nextMs !== null && nextMs >= intakeMs) {
        intakeDurationLabel = `Chờ duyệt ${formatDuration(nextMs - intakeMs)}`;
      }
    }
  }

  let intakeNote: string | null = null;
  if (ticket.isAnonymous) {
    intakeNote = ticket.locationVerificationLabel
      ? `Báo cáo ẩn danh qua QR khu vực. Vị trí: ${ticket.locationVerificationLabel}`
      : 'Báo cáo ẩn danh qua mã QR khu vực';
  } else if (ticket.aiStatus === 'ANALYZING') {
    intakeNote = 'AI đang phân tích mô tả và ảnh hiện trường trong nền.';
  } else if (ticket.aiStatus === 'MANUAL_REVIEW' || ticket.isAiFallbackManual) {
    intakeNote = 'Chờ Ban quản lý đánh giá và phân loại thủ công.';
  } else {
    intakeNote = 'Hệ thống đã tiếp nhận báo cáo sự cố thành công.';
  }

  const milestones: TimelineMilestone[] = [
    {
      key: 'INTAKE',
      title: 'Đã tiếp nhận · Chờ duyệt',
      status: isIntakeActive ? 'ACTIVE' : 'COMPLETED',
      timestamp: intakeMs ? new Date(intakeMs).toISOString() : null,
      formattedTime: formatIncidentDateTime(intakeMs),
      durationLabel: intakeDurationLabel,
      note: intakeNote,
      actorName: intakeLog?.changedBy?.fullName || (ticket.isAnonymous ? 'Khách vãng lai' : ticket.resident?.fullName || null),
    },
  ];

  // Nếu có sự kiện Thu hồi phân công / Chuyển KTV
  if (reassignmentLog) {
    const rMs = new Date(reassignmentLog.createdAt).getTime();
    milestones.push({
      key: 'SPECIAL',
      title: reassignmentLog.title || 'Thu hồi phân công sự cố',
      status: 'COMPLETED',
      timestamp: new Date(rMs).toISOString(),
      formattedTime: formatIncidentDateTime(rMs),
      durationLabel: null,
      note: (role === 'BMB' || role === 'TECHNICIAN') ? (reassignmentLog.note || 'Điều chỉnh kỹ thuật viên tiếp nhận') : 'Hệ thống điều phối lại kỹ thuật viên',
      actorName: reassignmentLog.changedBy?.fullName || null,
      isSpecialEvent: true,
    });
  }

  // 2. MỐC 2: Đã phân công
  const hasAssigned = Boolean(assignedMs || assignLog || ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'].includes(ticketStatus));
  const isAssignedActive = ticketStatus === 'ASSIGNED';
  let assignedDurationLabel: string | null = null;
  if (assignedMs !== null) {
    if (isAssignedActive) {
      const elapsed = nowMs - assignedMs;
      if (elapsed >= 0) assignedDurationLabel = `Đang chờ KTV nhận việc · ${formatDuration(elapsed)}`;
    } else {
      const nextMs = acknowledgedMs || completedMs || closedMs;
      if (nextMs !== null && nextMs >= assignedMs) {
        assignedDurationLabel = `Chờ KTV nhận việc ${formatDuration(nextMs - assignedMs)}`;
      }
    }
  }

  let assignedNote: string | null = null;
  const techName = ticket.assignedTech?.fullName || null;
  if (techName) {
    assignedNote = `Kỹ thuật viên: ${techName}${ticket.assignedTech?.specialtyLabel ? ` (${ticket.assignedTech.specialtyLabel})` : ''}`;
  }
  if ((role === 'BMB' || role === 'TECHNICIAN') && ticket.bmbAdminNote) {
    assignedNote = assignedNote ? `${assignedNote}\nGhi chú BMB: ${ticket.bmbAdminNote}` : `Ghi chú BMB: ${ticket.bmbAdminNote}`;
  }

  milestones.push({
    key: 'ASSIGNED',
    title: 'Đã phân công',
    status: isAssignedActive ? 'ACTIVE' : hasAssigned && assignedMs ? 'COMPLETED' : 'PENDING',
    timestamp: assignedMs ? new Date(assignedMs).toISOString() : null,
    formattedTime: hasAssigned ? formatIncidentDateTime(assignedMs) : 'Chờ phân công',
    durationLabel: assignedDurationLabel,
    note: hasAssigned ? assignedNote : 'Chờ Ban quản lý chỉ định kỹ thuật viên phù hợp',
    actorName: assignLog?.changedBy?.fullName || (ticket.bmbApprovedById ? 'Ban Quản Lý' : null),
  });

  // 3. MỐC 3: KTV đã nhận việc · Đang xử lý
  const hasAcknowledged = Boolean(acknowledgedMs || inProgressLog || ['IN_PROGRESS', 'COMPLETED', 'CLOSED'].includes(ticketStatus));
  const isInProgressActive = ticketStatus === 'IN_PROGRESS';
  let inProgressDurationLabel: string | null = null;
  if (acknowledgedMs !== null) {
    if (isInProgressActive) {
      const elapsed = nowMs - acknowledgedMs;
      if (elapsed >= 0) inProgressDurationLabel = `Đang xử lý · ${formatDuration(elapsed)}`;
    } else {
      const nextMs = completedMs || closedMs;
      if (nextMs !== null && nextMs >= acknowledgedMs) {
        inProgressDurationLabel = `Xử lý ${formatDuration(nextMs - acknowledgedMs)}`;
      }
    }
  }

  milestones.push({
    key: 'IN_PROGRESS',
    title: 'KTV đã nhận việc · Đang xử lý',
    status: isInProgressActive ? 'ACTIVE' : hasAcknowledged && acknowledgedMs ? 'COMPLETED' : 'PENDING',
    timestamp: acknowledgedMs ? new Date(acknowledgedMs).toISOString() : null,
    formattedTime: hasAcknowledged ? formatIncidentDateTime(acknowledgedMs) : 'Chờ KTV nhận việc',
    durationLabel: inProgressDurationLabel,
    note: hasAcknowledged
      ? 'Kỹ thuật viên đã tiếp nhận tại hiện trường và tiến hành kiểm tra, sửa chữa.'
      : 'Kỹ thuật viên sẽ kiểm tra hiện trường sau khi nhận việc',
    actorName: inProgressLog?.changedBy?.fullName || techName,
  });

  // Nếu có sự kiện yêu cầu làm lại
  if (reworkLog) {
    const rwMs = new Date(reworkLog.createdAt).getTime();
    milestones.push({
      key: 'SPECIAL',
      title: reworkLog.title || 'Yêu cầu làm lại sự cố',
      status: 'COMPLETED',
      timestamp: new Date(rwMs).toISOString(),
      formattedTime: formatIncidentDateTime(rwMs),
      durationLabel: null,
      note: reworkLog.note || 'Cần kiểm tra hoặc xử lý lại theo yêu cầu nghiệm thu',
      actorName: reworkLog.changedBy?.fullName || null,
      isSpecialEvent: true,
    });
  }

  // 4. MỐC 4: Đã sửa xong · Chờ nghiệm thu
  // Chỉ hiển thị mốc này nếu ticket đi theo luồng chuẩn kỹ thuật viên (hoặc có completedMs)
  // Nếu ticket bị từ chối / hủy thẳng từ PENDING/ASSIGNED, bỏ qua mốc này.
  const hasCompletedStep = Boolean(completedMs || completedLog || ticketStatus === 'COMPLETED' || ticketStatus === 'CLOSED' || ['PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(ticketStatus));

  if (hasCompletedStep && !cancelLog) {
    const isCompletedActive = ticketStatus === 'COMPLETED';
    let completedDurationLabel: string | null = null;
    if (completedMs !== null) {
      if (isCompletedActive) {
        const elapsed = nowMs - completedMs;
        if (elapsed >= 0) completedDurationLabel = `Đang chờ nghiệm thu · ${formatDuration(elapsed)}`;
      } else if (closedMs !== null && closedMs >= completedMs) {
        completedDurationLabel = `Chờ nghiệm thu ${formatDuration(closedMs - completedMs)}`;
      }
    }

    let completedNote = 'Kỹ thuật viên đã gửi ảnh nghiệm thu và hoàn thành công tác sửa chữa.';
    if ((role === 'BMB' || role === 'TECHNICIAN') && ticket.techRepairNote) {
      completedNote = `Ghi chú KTV: ${ticket.techRepairNote}`;
    }

    milestones.push({
      key: 'COMPLETED',
      title: 'Đã sửa xong · Chờ nghiệm thu',
      status: isCompletedActive ? 'ACTIVE' : (ticketStatus === 'CLOSED' && completedMs) ? 'COMPLETED' : 'PENDING',
      timestamp: completedMs ? new Date(completedMs).toISOString() : null,
      formattedTime: completedMs ? formatIncidentDateTime(completedMs) : 'Chờ hoàn thành sửa chữa',
      durationLabel: completedDurationLabel,
      note: (completedMs || isCompletedActive) ? completedNote : 'Chờ kỹ thuật viên khắc phục và gửi ảnh nghiệm thu',
      actorName: completedLog?.changedBy?.fullName || techName,
    });
  }

  // 5. MỐC 5: Hoàn thành / Đóng sự cố (hoặc Từ chối / Hủy)
  if (cancelLog || ticketStatus === 'CANCELLED' || ticketStatus === 'REJECTED') {
    const cMs = cancelLog?.createdAt ? new Date(cancelLog.createdAt).getTime() : nowMs;
    milestones.push({
      key: 'SPECIAL',
      title: 'Đã từ chối / Hủy sự cố',
      status: 'CANCELLED',
      timestamp: new Date(cMs).toISOString(),
      formattedTime: formatIncidentDateTime(cMs),
      durationLabel: null,
      note: cancelLog?.note || 'Sự cố đã được hủy hoặc từ chối xử lý.',
      actorName: cancelLog?.changedBy?.fullName || null,
      isSpecialEvent: true,
    });
  } else {
    const isClosed = ticketStatus === 'CLOSED';
    let closedNote = 'Chờ cư dân hoặc Ban quản lý kiểm tra và xác nhận đóng sự cố.';
    if (isClosed) {
      if (ticket.ratingStars) {
        closedNote = `Đã nghiệm thu và đánh giá ${ticket.ratingStars}⭐${ticket.ratingComment ? `: "${ticket.ratingComment}"` : ''}`;
      } else {
        closedNote = 'Đã nghiệm thu và hoàn tất quy trình xử lý sự cố.';
      }
    }

    milestones.push({
      key: 'CLOSED',
      title: 'Hoàn thành',
      status: isClosed ? 'COMPLETED' : 'PENDING',
      timestamp: closedMs ? new Date(closedMs).toISOString() : null,
      formattedTime: isClosed ? formatIncidentDateTime(closedMs) : 'Chờ nghiệm thu hoàn tất',
      durationLabel: null,
      note: closedNote,
      actorName: closedLog?.changedBy?.fullName || (isClosed ? (ticket.resident?.fullName || 'Cư dân') : null),
    });
  }

  // TÍNH TỔNG THỜI GIAN THỰC TẾ
  let totalDurationMs: number | null = null;
  if (intakeMs !== null) {
    if (ticketStatus === 'CLOSED') {
      const endMs = closedMs || completedMs || nowMs;
      if (endMs >= intakeMs) totalDurationMs = endMs - intakeMs;
    } else if (ticketStatus === 'CANCELLED' || ticketStatus === 'REJECTED') {
      const cancelMs = cancelLog?.createdAt ? new Date(cancelLog.createdAt).getTime() : nowMs;
      if (cancelMs >= intakeMs) totalDurationMs = cancelMs - intakeMs;
    } else {
      const elapsed = nowMs - intakeMs;
      if (elapsed >= 0) totalDurationMs = elapsed;
    }
  }

  const totalDurationFormatted = formatDuration(totalDurationMs);
  const totalDurationLabel = totalDurationFormatted
    ? `Tổng thời gian thực tế: ${totalDurationFormatted}`
    : 'Tổng thời gian thực tế: Chưa xác định';

  // TÍNH TOÁN VÀ ĐỐI CHIẾU SLA
  const slaTracking = ticket?.slaTracking || null;
  let slaInfo: SlaSummaryInfo;

  if (!slaTracking || (!slaTracking.resolutionDeadline && !slaTracking.responseDeadline)) {
    slaInfo = {
      hasSla: false,
      slaStatus: 'NONE',
      slaStatusLabel: 'Chưa có thời hạn quy định',
      resolutionDeadline: null,
      formattedDeadline: 'Chưa có thời hạn quy định',
      slaRemainingText: 'Chưa có thời hạn quy định',
      isPaused: false,
      escalationTier: 0,
    };
  } else {
    const isPaused = Boolean(slaTracking.isPaused);
    const pauseReason = slaTracking.pauseReason || null;
    const escalationTier = Number(slaTracking.escalationTier || 0);

    const resDeadlineMs = slaTracking.resolutionDeadline
      ? new Date(slaTracking.resolutionDeadline).getTime()
      : null;
    const formattedDeadline = resDeadlineMs
      ? formatIncidentDateTime(resDeadlineMs)
      : 'Chưa có thời hạn quy định';

    if (isPaused) {
      slaInfo = {
        hasSla: true,
        slaStatus: 'PAUSED',
        slaStatusLabel: 'Tạm dừng SLA',
        resolutionDeadline: slaTracking.resolutionDeadline ? new Date(slaTracking.resolutionDeadline).toISOString() : null,
        formattedDeadline,
        slaRemainingText: pauseReason ? `Tạm dừng SLA (${pauseReason})` : 'Tạm dừng SLA',
        isPaused: true,
        pauseReason,
        escalationTier,
      };
    } else if (ticketStatus === 'CLOSED') {
      const finishMs = closedMs || completedMs || nowMs;
      if (resDeadlineMs && finishMs > resDeadlineMs) {
        const overdueMs = finishMs - resDeadlineMs;
        slaInfo = {
          hasSla: true,
          slaStatus: 'BREACHED',
          slaStatusLabel: 'Quá hạn SLA',
          resolutionDeadline: new Date(resDeadlineMs).toISOString(),
          formattedDeadline,
          slaRemainingText: `Hoàn thành trễ ${formatDuration(overdueMs)}`,
          isPaused: false,
          escalationTier,
        };
      } else {
        slaInfo = {
          hasSla: true,
          slaStatus: 'ON_TRACK',
          slaStatusLabel: 'Hoàn thành đúng hạn',
          resolutionDeadline: resDeadlineMs ? new Date(resDeadlineMs).toISOString() : null,
          formattedDeadline,
          slaRemainingText: 'Hoàn thành đúng hạn',
          isPaused: false,
          escalationTier,
        };
      }
    } else {
      // Ticket đang mở
      if (resDeadlineMs) {
        if (nowMs <= resDeadlineMs) {
          const remainingMs = resDeadlineMs - nowMs;
          const isAtRisk = slaTracking.slaStatus === 'AT_RISK';
          slaInfo = {
            hasSla: true,
            slaStatus: isAtRisk ? 'AT_RISK' : 'ON_TRACK',
            slaStatusLabel: isAtRisk ? 'Sắp quá hạn' : 'Đúng hạn',
            resolutionDeadline: new Date(resDeadlineMs).toISOString(),
            formattedDeadline,
            slaRemainingText: `Còn ${formatDuration(remainingMs)}`,
            isPaused: false,
            escalationTier,
          };
        } else {
          const overdueMs = nowMs - resDeadlineMs;
          slaInfo = {
            hasSla: true,
            slaStatus: 'BREACHED',
            slaStatusLabel: 'Quá hạn SLA',
            resolutionDeadline: new Date(resDeadlineMs).toISOString(),
            formattedDeadline,
            slaRemainingText: `Trễ ${formatDuration(overdueMs)}`,
            isPaused: false,
            escalationTier,
          };
        }
      } else {
        slaInfo = {
          hasSla: true,
          slaStatus: 'ON_TRACK',
          slaStatusLabel: 'Đang theo dõi',
          resolutionDeadline: null,
          formattedDeadline: 'Chưa có thời hạn quy định',
          slaRemainingText: 'Chưa có thời hạn quy định',
          isPaused: false,
          escalationTier,
        };
      }
    }
  }

  return {
    currentStatus: ticketStatus,
    currentStatusLabel: getStatusLabel(ticketStatus),
    totalDurationMs,
    totalDurationLabel,
    slaInfo,
    milestones,
  };
};
