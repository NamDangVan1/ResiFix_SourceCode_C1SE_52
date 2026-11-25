import React, { useState } from 'react';
import { Image } from 'react-native';
import {
  UiActivityIndicator as ActivityIndicator,
  UiScrollView as ScrollView,
  UiText as Text,
  UiTextInput as TextInput,
  UiTouchableOpacity as TouchableOpacity,
  UiView as View,
} from './UiPreferences';
import {
  ScreenTransition,
  CollapsibleDrawer,
  AnimatedBadgeEntrance,
  MOTION_TIMINGS,
} from './Transitions';

export function hasTechArrivedOnSite(ticket: any): boolean {
  if (!ticket) return false;
  if (ticket.status === 'COMPLETED' || ticket.status === 'CLOSED') return true;
  if (ticket.hasArrivedOnSite === true) return true;
  if (
    Array.isArray(ticket.statusLogs) &&
    ticket.statusLogs.some(
      (l: any) =>
        String(l?.title || '').includes('đến hiện trường') ||
        String(l?.note || '').includes('[ĐẾN HIỆN TRƯỜNG]')
    )
  ) {
    return true;
  }
  if (
    Array.isArray(ticket.media) &&
    ticket.media.some((m: any) => String(m?.caption || '').includes('[ARRIVAL_PROOF]'))
  ) {
    return true;
  }
  return false;
}

export function getTechIncidentStep(ticket: any): 1 | 2 | 3 | 4 {
  if (!ticket) return 1;
  if (ticket.status === 'COMPLETED' || ticket.status === 'CLOSED') return 4;
  if (ticket.status === 'ASSIGNED' || ticket.status === 'PENDING') return 1;
  if (ticket.status === 'IN_PROGRESS') {
    return hasTechArrivedOnSite(ticket) ? 3 : 2;
  }
  return 1;
}

interface TechnicianStepFlowProps {
  activeTicket: any;
  loading: boolean;
  styles: any;
  translate: (text: string) => string;
  formatDateTime: (iso?: string | null) => string;
  PRIORITY_VN: Record<string, string>;
  CATEGORY_SHORT_VN: Record<string, string>;
  getResidentReportedMedia: (ticket: any) => Array<{ id: string; url: string; caption?: string }>;
  openReportedPhoto: (photos: Array<{ id: string; url: string; caption?: string }>, index: number) => void;
  failedPhotoUrls: Record<string, boolean>;
  setFailedPhotoUrls: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  renderIncidentProgressTimeline: (ticket: any, role: 'RESIDENT' | 'TECHNICIAN' | 'BMB') => React.ReactNode;
  // Step 1: Nhận việc
  onAcceptJob: (ticket: any) => Promise<void>;
  // Step 2: Đến hiện trường
  techArrivalPhotoUrl: string | null;
  techArrivalGps: { latitude: number; longitude: number; accuracy: number } | null;
  onCaptureArrivalPhoto: () => Promise<void>;
  onConfirmArrival: (ticket: any) => Promise<void>;
  // Step 3: Xử lý sự cố (AI, Checklist, Chi phí, Nghiệm thu)
  technicianGuidance: any;
  technicianGuidanceLoading: boolean;
  checkedChecklistItems: Record<string, boolean>;
  setCheckedChecklistItems: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  ticketCosts: Record<string, any>;
  matNameInput: string;
  setMatNameInput: (val: string) => void;
  matQtyInput: string;
  setMatQtyInput: (val: string) => void;
  matUnitInput: string;
  setMatUnitInput: (val: string) => void;
  matPriceInput: string;
  setMatPriceInput: (val: string) => void;
  handleTechSubmitCost: (ticketId: string) => Promise<void>;
  techProofPhotos: string[];
  setTechProofPhotos: React.Dispatch<React.SetStateAction<string[]>>;
  techRepairNote: string;
  setTechRepairNote: (val: string) => void;
  handlePickOrCapturePhoto: (folder: 'incident_scene' | 'repair_proof', onSuccess: (url: string) => void) => void;
  onCompleteRepair: (ticket: any) => Promise<void>;
  // Navigation
  onBackHome: () => void;
  showToast: (msg: string) => void;
}

export function TechnicianStepFlow({
  activeTicket,
  loading,
  styles,
  translate,
  formatDateTime,
  PRIORITY_VN,
  CATEGORY_SHORT_VN,
  getResidentReportedMedia,
  openReportedPhoto,
  failedPhotoUrls,
  setFailedPhotoUrls,
  renderIncidentProgressTimeline,
  onAcceptJob,
  techArrivalPhotoUrl,
  techArrivalGps,
  onCaptureArrivalPhoto,
  onConfirmArrival,
  technicianGuidance,
  technicianGuidanceLoading,
  checkedChecklistItems,
  setCheckedChecklistItems,
  ticketCosts,
  matNameInput,
  setMatNameInput,
  matQtyInput,
  setMatQtyInput,
  matUnitInput,
  setMatUnitInput,
  matPriceInput,
  setMatPriceInput,
  handleTechSubmitCost,
  techProofPhotos,
  setTechProofPhotos,
  techRepairNote,
  setTechRepairNote,
  handlePickOrCapturePhoto,
  onCompleteRepair,
  onBackHome,
  showToast,
}: TechnicianStepFlowProps) {
  const currentStep = getTechIncidentStep(activeTicket);

  // Các mục phụ thu gọn mặc định để giao diện gọn gàng, chỉ tập trung 1 hành động chính mỗi bước
  const [expandSceneDetails, setExpandSceneDetails] = useState(false);
  const [expandAiSection, setExpandAiSection] = useState(false);
  const [expandChecklistSection, setExpandChecklistSection] = useState(false);
  const [expandCostSection, setExpandCostSection] = useState(false);
  const [expandTimelineSection, setExpandTimelineSection] = useState(false);

  const prioKey = activeTicket.finalPriority || activeTicket.aiSuggestedPriority || 'MEDIUM';
  const catKey = activeTicket.finalCategory || activeTicket.aiSuggestedCategory || 'PLUMBING';
  const scenePhotos = getResidentReportedMedia(activeTicket);

  const checklistList: string[] = Array.isArray(technicianGuidance?.inspectionChecklist)
    ? technicianGuidance.inspectionChecklist
    : [];
  const checkedCount = checklistList.filter((_, idx) => Boolean(checkedChecklistItems[`${activeTicket.id}_${idx}`])).length;

  const proofMediaFromTicket = Array.isArray(activeTicket.media)
    ? activeTicket.media
        .filter((m: any) => m?.mediaType === 'REPAIR_PROOF' && typeof m?.imageUrl === 'string')
        .map((m: any) => m.imageUrl.split('#')[0])
    : [];
  const allProofPhotos = techProofPhotos.length > 0 ? techProofPhotos : proofMediaFromTicket;

  const stepsMeta = [
    { step: 1, label: 'Nhận việc' },
    { step: 2, label: 'Đến nơi' },
    { step: 3, label: 'Xử lý' },
    { step: 4, label: 'Hoàn thành' },
  ];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header quay lại */}
        <View style={styles.subScreenHeader}>
          <TouchableOpacity onPress={onBackHome}>
            <Text style={styles.backArrowText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.subScreenTitle} numberOfLines={1}>
            {translate('Xử lý sự cố')} {activeTicket.ticketCode}
          </Text>
        </View>

        {/* Thanh tiến trình 4 bước trực quan */}
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 12,
            paddingVertical: 12,
            paddingHorizontal: 10,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: '#E2E8F0',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {stepsMeta.map((item, idx) => {
            const isDone = currentStep > item.step || (currentStep === 4 && item.step === 4);
            const isCurrent = currentStep === item.step;
            const circleBg = isDone ? '#16A34A' : isCurrent ? '#2563EB' : '#F1F5F9';
            const circleText = isDone || isCurrent ? '#FFFFFF' : '#64748B';
            const labelColor = isCurrent ? '#1D4ED8' : isDone ? '#15803D' : '#64748B';

            return (
              <React.Fragment key={item.step}>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      backgroundColor: circleBg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '800', color: circleText }}>
                      {isDone ? '✓' : item.step}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: isCurrent ? '800' : '600',
                      color: labelColor,
                      marginTop: 4,
                    }}
                    numberOfLines={1}
                  >
                    {translate(item.label)}
                  </Text>
                </View>
                {idx < stepsMeta.length - 1 && (
                  <View
                    style={{
                      height: 2,
                      flex: 0.45,
                      backgroundColor: currentStep > item.step ? '#86EFAC' : '#E2E8F0',
                      marginBottom: 14,
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </View>

        {/* Thẻ Tóm tắt Sự cố (Luôn hiển thị gọn ở đầu màn hình) */}
        <View style={[styles.whiteSectionCard, { marginBottom: 12 }]}>
          <View style={[styles.cardTopRow, { marginBottom: 6 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={styles.cardCodeText}>{activeTicket.ticketCode}</Text>
              <View
                style={{
                  backgroundColor: prioKey === 'HIGH' ? '#FEE2E2' : '#EFF6FF',
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 6,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '700',
                    color: prioKey === 'HIGH' ? '#DC2626' : '#1D4ED8',
                  }}
                >
                  {translate(PRIORITY_VN[prioKey] || 'Trung bình')} • {translate(CATEGORY_SHORT_VN[catKey] || 'Điện - Nước')}
                </Text>
              </View>
            </View>
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor:
                    currentStep === 4 ? '#DCFCE7' : currentStep === 1 ? '#DBEAFE' : '#E0E7FF',
                },
              ]}
            >
              <Text
                style={[
                  styles.statusPillText,
                  {
                    color:
                      currentStep === 4 ? '#15803D' : currentStep === 1 ? '#1D4ED8' : '#4338CA',
                  },
                ]}
              >
                {currentStep === 1
                  ? translate('Bước 1: Chờ nhận việc')
                  : currentStep === 2
                  ? translate('Bước 2: Đến hiện trường')
                  : currentStep === 3
                  ? translate('Bước 3: Đang xử lý')
                  : translate('Bước 4: Đã hoàn thành')}
              </Text>
            </View>
          </View>

          <Text style={[styles.cardMainTitle, { fontSize: 16, marginBottom: 4 }]}>
            {activeTicket.title}
          </Text>
          <Text style={[styles.techInfoLine, { marginBottom: 2, fontWeight: '600', color: '#0F172A' }]}>
            📍 {activeTicket.locationNote || translate('Vị trí sự cố')}
          </Text>
          {activeTicket.asset?.qrCode && (
            <Text style={[styles.techInfoLine, { fontSize: 12, color: '#64748B', marginBottom: 0 }]}>
              🏷️ Mã QR khu vực/thiết bị: {activeTicket.asset.qrCode}
            </Text>
          )}
        </View>

        {/* VÙNG NỘI DUNG THEO TỪNG BƯỚC (Hiệu ứng chuyển bước mượt 320ms Fade + Slide ngang tự nhiên) */}
        <ScreenTransition
          transitionKey={`tech-step-${activeTicket.id}-${currentStep}`}
          duration={MOTION_TIMINGS.TECH_STEP_MS}
          type="fade-slide"
          direction="right"
        >
          {/* ============================================================== */}
          {/* BƯỚC 1: NHẬN VIỆC                                              */}
          {/* ============================================================== */}
          {currentStep === 1 && (
            <View>
              <View style={styles.whiteSectionCard}>
                <Text style={styles.cardBlockTitle}>1️⃣ {translate('Thông tin cần kiểm tra & Nhận việc')}</Text>
                <Text style={[styles.residentDescGray, { marginTop: 4 }]}>
                  {activeTicket.description}
                </Text>

                {scenePhotos.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#334155', marginBottom: 8 }}>
                      📷 {translate('Ảnh hiện trường ban đầu')} ({scenePhotos.length})
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      {scenePhotos.map((photo, index) => (
                        <TouchableOpacity
                          key={photo.id || index}
                          onPress={() => openReportedPhoto(scenePhotos, index)}
                        >
                          {failedPhotoUrls[photo.url] ? (
                            <View style={{ width: 76, height: 76, borderRadius: 8, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ fontSize: 14 }}>⚠️</Text>
                            </View>
                          ) : (
                            <Image
                              source={{ uri: photo.url }}
                              style={{ width: 76, height: 76, borderRadius: 8, backgroundColor: '#F1F5F9' }}
                              resizeMode="cover"
                              onError={() => setFailedPhotoUrls((prev) => ({ ...prev, [photo.url]: true }))}
                            />
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                <View
                  style={{
                    backgroundColor: '#EFF6FF',
                    borderRadius: 8,
                    padding: 10,
                    marginTop: 12,
                    borderWidth: 1,
                    borderColor: '#BFDBFE',
                  }}
                >
                  <Text style={{ fontSize: 12, color: '#1E40AF', lineHeight: 18 }}>
                    💡 {translate('Bấm "Nhận việc" bên dưới để xác nhận tiếp nhận nhiệm vụ và chuyển sang bước di chuyển đến hiện trường.')}
                  </Text>
                </View>
              </View>

              {/* Mục phụ thu gọn: Hành trình xử lý */}
              <View style={styles.whiteSectionCard}>
                <TouchableOpacity
                  style={styles.cardTopRow}
                  onPress={() => setExpandTimelineSection((prev) => !prev)}
                >
                  <Text style={[styles.cardBlockTitle, { marginBottom: 0 }]}>
                    🕒 {translate('Hành trình sự cố')}
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>
                    {expandTimelineSection ? translate('Thu gọn ▲') : translate('Xem chi tiết ▼')}
                  </Text>
                </TouchableOpacity>
                <CollapsibleDrawer expanded={expandTimelineSection}>
                  <View style={{ marginTop: 10 }}>
                    {renderIncidentProgressTimeline(activeTicket, 'TECHNICIAN')}
                  </View>
                </CollapsibleDrawer>
              </View>
            </View>
          )}

          {/* ============================================================== */}
          {/* BƯỚC 2: ĐẾN HIỆN TRƯỜNG                                        */}
          {/* ============================================================== */}
          {currentStep === 2 && (
            <View>
              <View style={[styles.whiteSectionCard, { borderColor: '#93C5FD', borderWidth: 1.5 }]}>
                <Text style={styles.cardBlockTitle}>2️⃣ {translate('Di chuyển & Xác nhận đến hiện trường')}</Text>
                <Text style={{ fontSize: 12.5, color: '#475569', lineHeight: 18, marginBottom: 10 }}>
                  {translate('Bạn đã nhận việc. Khi có mặt tại vị trí sự cố, vui lòng chụp 1 ảnh hiện trường bằng Camera và bấm "Tôi đã đến" để hệ thống ghi nhận thời gian phản hồi (chuẩn ≤ 15 phút).')}
                </Text>

                {/* Vị trí cần đến */}
                <View style={{ backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12 }}>
                  <Text style={{ fontSize: 12, color: '#64748B', fontWeight: '600' }}>
                    {translate('VỊ TRÍ CẦN ĐẾN')}
                  </Text>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#0F172A', marginTop: 2 }}>
                    📍 {activeTicket.locationNote || translate('Khu vực sự cố')}
                  </Text>
                  {techArrivalGps && (
                    <Text style={{ fontSize: 11.5, color: '#059669', marginTop: 4, fontWeight: '600' }}>
                      ✓ GPS hiện tại: ({techArrivalGps.latitude.toFixed(5)}, {techArrivalGps.longitude.toFixed(5)}) • ±{techArrivalGps.accuracy}m
                    </Text>
                  )}
                </View>

                {/* Chụp ảnh xác nhận có mặt tại hiện trường */}
                <Text style={styles.fieldLabel}>
                  {translate('Ảnh chụp Camera xác nhận tại hiện trường *')}
                </Text>
                {techArrivalPhotoUrl ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
                    <Image
                      source={{ uri: techArrivalPhotoUrl }}
                      style={{ width: 88, height: 88, borderRadius: 10, borderWidth: 1.5, borderColor: '#16A34A' }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#15803D' }}>
                        ✓ {translate('Đã có ảnh chụp tại hiện trường')}
                      </Text>
                      <TouchableOpacity
                        style={{
                          marginTop: 6,
                          alignSelf: 'flex-start',
                          backgroundColor: '#EFF6FF',
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: '#BFDBFE',
                        }}
                        onPress={() => void onCaptureArrivalPhoto()}
                        disabled={loading}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#1D4ED8' }}>
                          🔄 {translate('Chụp lại ảnh')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={{
                      marginTop: 6,
                      backgroundColor: '#EFF6FF',
                      borderWidth: 1.5,
                      borderColor: '#3B82F6',
                      borderStyle: 'dashed',
                      borderRadius: 10,
                      paddingVertical: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onPress={() => void onCaptureArrivalPhoto()}
                    disabled={loading}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#1D4ED8' }}>
                      📷 {translate('Mở Camera chụp ảnh tại hiện trường')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Mục phụ thu gọn: Xem mô tả & ảnh báo cáo ban đầu */}
              <View style={styles.whiteSectionCard}>
                <TouchableOpacity
                  style={styles.cardTopRow}
                  onPress={() => setExpandSceneDetails((prev) => !prev)}
                >
                  <Text style={[styles.cardBlockTitle, { marginBottom: 0 }]}>
                    📄 {translate('Mô tả sự cố & Ảnh báo cáo ban đầu')}
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>
                    {expandSceneDetails ? translate('Thu gọn ▲') : translate('Xem chi tiết ▼')}
                  </Text>
                </TouchableOpacity>

                <CollapsibleDrawer expanded={expandSceneDetails}>
                  <View style={{ marginTop: 10 }}>
                    <Text style={styles.residentDescGray}>{activeTicket.description}</Text>
                    {scenePhotos.length > 0 && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                        {scenePhotos.map((photo, index) => (
                          <TouchableOpacity
                            key={photo.id || index}
                            onPress={() => openReportedPhoto(scenePhotos, index)}
                          >
                            <Image
                              source={{ uri: photo.url }}
                              style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#F1F5F9' }}
                            />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                </CollapsibleDrawer>
              </View>
            </View>
          )}

          {/* ============================================================== */}
          {/* BƯỚC 3: ĐANG XỬ LÝ SỰ CỐ                                       */}
          {/* ============================================================== */}
          {currentStep === 3 && (
            <View>
              {/* Khu vực chính của Bước 3: Bằng chứng nghiệm thu & Ghi chú kết quả */}
              <View style={styles.proofGreenBorderCard}>
                <Text style={styles.cardBlockTitle}>
                  3️⃣ {translate('Cập nhật kết quả & Ảnh nghiệm thu sau sửa chữa *')}
                </Text>
                <Text style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
                  {translate('Chụp ít nhất 1 ảnh nghiệm thu sau khi khắc phục xong sự cố để chuyển sang bước Hoàn thành.')}
                </Text>

                <View style={styles.proofCompareRow}>
                  <View style={styles.techCapturedBox}>
                    {techProofPhotos[0] ? (
                      <Image
                        source={{ uri: techProofPhotos[0] }}
                        style={{ width: '100%', height: '100%', borderRadius: 10 }}
                      />
                    ) : (
                      <Text style={{ fontSize: 11.5, color: '#64748B', textAlign: 'center', paddingHorizontal: 6 }}>
                        {translate('Chưa có ảnh nghiệm thu')}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.techAddPhotoDashedBox}
                    onPress={() =>
                      handlePickOrCapturePhoto('repair_proof', (uploadedUrl) => {
                        setTechProofPhotos((prev) => [uploadedUrl, ...prev]);
                        showToast(translate('Đã tải lên ảnh nghiệm thu sau sửa chữa!'));
                      })
                    }
                  >
                    <Text style={styles.techPlusIcon}>＋</Text>
                    <Text style={styles.techAddPhotoBlueText}>
                      {translate('+ Chụp ảnh nghiệm thu (')}{techProofPhotos.length})
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.fieldLabel, { marginTop: 10 }]}>
                  {translate('Ghi chú kết quả xử lý')}
                </Text>
                <TextInput
                  style={[styles.ratingInputBox, { marginTop: 4 }]}
                  multiline
                  value={techRepairNote}
                  onChangeText={setTechRepairNote}
                  placeholder={translate('Mô tả ngắn gọn công việc đã thực hiện...')}
                  placeholderTextColor="#94A3B8"
                  maxLength={500}
                />
              </View>

              {/* MỤC PHỤ THU GỌN 1: Trợ lý AI kỹ thuật */}
              <View style={styles.whiteSectionCard}>
                <TouchableOpacity
                  style={styles.cardTopRow}
                  onPress={() => setExpandAiSection((prev) => !prev)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <Text style={{ fontSize: 15 }}>🤖</Text>
                    <Text style={[styles.cardBlockTitle, { marginBottom: 0 }]}>
                      {translate('Trợ lý AI kỹ thuật')}
                    </Text>
                    {technicianGuidance?.isSafetyHazard && (
                      <View style={{ backgroundColor: '#FEE2E2', paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 4 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#DC2626' }}>
                          🚨 {translate('Lưu ý an toàn')}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {technicianGuidanceLoading && <ActivityIndicator size="small" color="#2563EB" />}
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>
                      {expandAiSection ? translate('Thu gọn ▲') : translate('Xem chi tiết ▼')}
                    </Text>
                  </View>
                </TouchableOpacity>

                <CollapsibleDrawer expanded={expandAiSection}>
                  <View style={{ marginTop: 10, gap: 10 }}>
                    {!technicianGuidance || technicianGuidance.status === 'GENERATING' ? (
                      <Text style={{ fontSize: 12.5, color: '#0284C7' }}>
                        ⏳ {translate('AI đang chuẩn bị gợi ý nguyên nhân và các bước xử lý an toàn...')}
                      </Text>
                    ) : technicianGuidance.status === 'UNAVAILABLE' ? (
                      <Text style={styles.techInfoLine}>
                        ℹ️ {translate('Chưa có gợi ý AI cho sự cố này.')}
                      </Text>
                    ) : (
                      <>
                        {(technicianGuidance.isSafetyHazard ||
                          (Array.isArray(technicianGuidance.stopAndEscalateWhen) &&
                            technicianGuidance.stopAndEscalateWhen.length > 0)) && (
                          <View
                            style={{
                              backgroundColor: technicianGuidance.isSafetyHazard ? '#FEF2F2' : '#FFFBEB',
                              borderColor: technicianGuidance.isSafetyHazard ? '#F87171' : '#FCD34D',
                              borderWidth: 1,
                              borderRadius: 8,
                              padding: 10,
                            }}
                          >
                            <Text
                              style={{
                                color: technicianGuidance.isSafetyHazard ? '#DC2626' : '#B45309',
                                fontWeight: '700',
                                fontSize: 12.5,
                                marginBottom: 4,
                              }}
                            >
                              {technicianGuidance.isSafetyHazard
                                ? `🚨 ${translate('CẢNH BÁO NGUY HIỂM TẠI HIỆN TRƯỜNG')}`
                                : `⚠️ ${translate('Điều kiện dừng hoặc báo BMB')}`}
                            </Text>
                            {technicianGuidance.hazardWarning ? (
                              <Text style={{ color: '#991B1B', fontSize: 11.5, marginBottom: 4 }}>
                                {technicianGuidance.hazardWarning}
                              </Text>
                            ) : null}
                            {Array.isArray(technicianGuidance.stopAndEscalateWhen) &&
                              technicianGuidance.stopAndEscalateWhen.map((cond: string, idx: number) => (
                                <Text key={idx} style={{ color: '#92400E', fontSize: 11.5 }}>
                                  • {cond}
                                </Text>
                              ))}
                          </View>
                        )}

                        {Array.isArray(technicianGuidance.possibleCauses) &&
                          technicianGuidance.possibleCauses.length > 0 && (
                            <View style={{ gap: 4 }}>
                              <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#1E293B' }}>
                                🔍 {translate('Nguyên nhân có thể xảy ra')}
                              </Text>
                              {technicianGuidance.possibleCauses.map((c: any, idx: number) => (
                                <Text key={idx} style={{ fontSize: 12, color: '#334155' }}>
                                  {idx + 1}. {c.cause} {c.signsToVerify ? `(${c.signsToVerify})` : ''}
                                </Text>
                              ))}
                            </View>
                          )}

                        {Array.isArray(technicianGuidance.safeHandlingSteps) &&
                          technicianGuidance.safeHandlingSteps.length > 0 && (
                            <View style={{ gap: 4 }}>
                              <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#1E293B' }}>
                                🛡️ {translate('Các bước xử lý an toàn')}
                              </Text>
                              {technicianGuidance.safeHandlingSteps.map((step: string, idx: number) => (
                                <Text key={idx} style={{ fontSize: 12, color: '#334155' }}>
                                  {step.startsWith(String(idx + 1)) ? step : `${idx + 1}. ${step}`}
                                </Text>
                              ))}
                            </View>
                          )}
                      </>
                    )}
                  </View>
                </CollapsibleDrawer>
              </View>

              {/* MỤC PHỤ THU GỌN 2: Checklist kiểm tra & Vật tư dự kiến */}
              <View style={styles.whiteSectionCard}>
                <TouchableOpacity
                  style={styles.cardTopRow}
                  onPress={() => setExpandChecklistSection((prev) => !prev)}
                >
                  <Text style={[styles.cardBlockTitle, { marginBottom: 0 }]}>
                    📋 {translate('Checklist kiểm tra')} ({checkedCount}/{checklistList.length})
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>
                    {expandChecklistSection ? translate('Thu gọn ▲') : translate('Xem chi tiết ▼')}
                  </Text>
                </TouchableOpacity>

                <CollapsibleDrawer expanded={expandChecklistSection}>
                  <View style={{ marginTop: 10, gap: 6 }}>
                    {checklistList.length === 0 ? (
                      <Text style={styles.techInfoLine}>
                        {translate('Đang tải hoặc chưa có mục checklist cho sự cố này.')}
                      </Text>
                    ) : (
                      checklistList.map((item: string, idx: number) => {
                        const isChecked = !!checkedChecklistItems[`${activeTicket.id}_${idx}`];
                        return (
                          <TouchableOpacity
                            key={idx}
                            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 }}
                            onPress={() =>
                              setCheckedChecklistItems((prev) => ({
                                ...prev,
                                [`${activeTicket.id}_${idx}`]: !isChecked,
                              }))
                            }
                          >
                            <View
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: 4,
                                borderWidth: 1.5,
                                borderColor: isChecked ? '#059669' : '#94A3B8',
                                backgroundColor: isChecked ? '#059669' : '#FFFFFF',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginTop: 1,
                              }}
                            >
                              {isChecked && <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>✓</Text>}
                            </View>
                            <Text
                              style={{
                                fontSize: 12,
                                color: isChecked ? '#64748B' : '#334155',
                                textDecorationLine: isChecked ? 'line-through' : 'none',
                                flex: 1,
                              }}
                            >
                              {item}
                            </Text>
                          </TouchableOpacity>
                        );
                      })
                    )}

                    {Array.isArray(technicianGuidance?.estimatedMaterials) &&
                      technicianGuidance.estimatedMaterials.length > 0 && (
                        <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#F1F5F9' }}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#1E293B', marginBottom: 4 }}>
                            🧰 {translate('Vật tư & Dụng cụ dự kiến:')}
                          </Text>
                          {technicianGuidance.estimatedMaterials.map((m: any, idx: number) => (
                            <Text key={idx} style={{ fontSize: 12, color: '#334155' }}>
                              • {m.name} {m.conditionToVerify ? `(${m.conditionToVerify})` : ''}
                            </Text>
                          ))}
                        </View>
                      )}
                  </View>
                </CollapsibleDrawer>
              </View>

              {/* MỤC PHỤ THU GỌN 3: Đề xuất vật tư & Chi phí sửa chữa */}
              <View style={styles.whiteSectionCard}>
                <TouchableOpacity
                  style={styles.cardTopRow}
                  onPress={() => setExpandCostSection((prev) => !prev)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.cardBlockTitle, { marginBottom: 0 }]}>
                      💰 {translate('Đề xuất vật tư & Chi phí')}
                    </Text>
                    {ticketCosts[activeTicket.id] && (
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor:
                              ticketCosts[activeTicket.id].status === 'APPROVED'
                                ? '#DCFCE7'
                                : ticketCosts[activeTicket.id].status === 'REJECTED'
                                ? '#FEE2E2'
                                : '#FEF3C7',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusPillText,
                            {
                              color:
                                ticketCosts[activeTicket.id].status === 'APPROVED'
                                  ? '#15803D'
                                  : ticketCosts[activeTicket.id].status === 'REJECTED'
                                  ? '#B91C1C'
                                  : '#B45309',
                            },
                          ]}
                        >
                          {ticketCosts[activeTicket.id].status === 'APPROVED'
                            ? translate('Đã duyệt')
                            : ticketCosts[activeTicket.id].status === 'REJECTED'
                            ? translate('Từ chối')
                            : translate('Chờ duyệt')}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>
                    {expandCostSection ? translate('Thu gọn ▲') : translate('Xem chi tiết ▼')}
                  </Text>
                </TouchableOpacity>

                <CollapsibleDrawer expanded={expandCostSection}>
                  <View style={{ marginTop: 10 }}>
                    {ticketCosts[activeTicket.id] ? (
                      <View>
                        {(ticketCosts[activeTicket.id].items || []).map((it: any, idx: number) => (
                          <View key={idx} style={styles.bmbStatRow}>
                            <Text style={styles.bmbStatLabel}>
                              • {it.materialName} ({it.quantity} {it.unit})
                            </Text>
                            <Text style={styles.bmbStatValue}>
                              {Number(it.totalPrice || 0).toLocaleString('vi-VN')} đ
                            </Text>
                          </View>
                        ))}
                        <View style={styles.bmbStatRow}>
                          <Text style={[styles.bmbStatLabel, { fontWeight: '700', color: '#0F172A' }]}>
                            {translate('Tổng dự toán:')}
                          </Text>
                          <Text style={[styles.bmbStatValue, { fontWeight: '800', color: '#2563EB' }]}>
                            {Number(ticketCosts[activeTicket.id].totalCost || 0).toLocaleString('vi-VN')} đ
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <View>
                        <Text style={styles.fieldLabel}>{translate('Tên vật tư thay thế *')}</Text>
                        <TextInput
                          style={styles.textInputField}
                          value={matNameInput}
                          onChangeText={setMatNameInput}
                          placeholder={translate('Ví dụ: Ống nhựa PVC D21, Van khóa...')}
                          placeholderTextColor="#94A3B8"
                        />
                        <View style={{ flexDirection: 'row', gap: 8, marginVertical: 6 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.fieldLabel}>{translate('Số lượng')}</Text>
                            <TextInput
                              style={styles.textInputField}
                              value={matQtyInput}
                              onChangeText={setMatQtyInput}
                              keyboardType="numeric"
                              placeholder="1"
                              placeholderTextColor="#94A3B8"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.fieldLabel}>{translate('Đơn vị')}</Text>
                            <TextInput
                              style={styles.textInputField}
                              value={matUnitInput}
                              onChangeText={setMatUnitInput}
                              placeholder="Cái"
                              placeholderTextColor="#94A3B8"
                            />
                          </View>
                          <View style={{ flex: 1.5 }}>
                            <Text style={styles.fieldLabel}>{translate('Đơn giá (VND)')}</Text>
                            <TextInput
                              style={styles.textInputField}
                              value={matPriceInput}
                              onChangeText={setMatPriceInput}
                              keyboardType="numeric"
                              placeholder="50000"
                              placeholderTextColor="#94A3B8"
                            />
                          </View>
                        </View>
                        <TouchableOpacity
                          style={[styles.primaryActionBtn, { marginTop: 6, backgroundColor: '#0284C7' }]}
                          onPress={() => void handleTechSubmitCost(activeTicket.id)}
                          disabled={loading}
                        >
                          <Text style={styles.primaryActionBtnText}>{translate('Gửi đề xuất chi phí')}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </CollapsibleDrawer>
              </View>

              {/* MỤC PHỤ THU GỌN 4: Lịch sử & Mô tả ban đầu */}
              <View style={styles.whiteSectionCard}>
                <TouchableOpacity
                  style={styles.cardTopRow}
                  onPress={() => setExpandTimelineSection((prev) => !prev)}
                >
                  <Text style={[styles.cardBlockTitle, { marginBottom: 0 }]}>
                    🕒 {translate('Hành trình & Mô tả sự cố')}
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>
                    {expandTimelineSection ? translate('Thu gọn ▲') : translate('Xem chi tiết ▼')}
                  </Text>
                </TouchableOpacity>
                <CollapsibleDrawer expanded={expandTimelineSection}>
                  <View style={{ marginTop: 10 }}>
                    <Text style={[styles.residentDescGray, { marginBottom: 10 }]}>
                      {activeTicket.description}
                    </Text>
                    {renderIncidentProgressTimeline(activeTicket, 'TECHNICIAN')}
                  </View>
                </CollapsibleDrawer>
              </View>
            </View>
          )}

          {/* ============================================================== */}
          {/* BƯỚC 4: HOÀN THÀNH VÀ NGHIỆM THU                               */}
          {/* ============================================================== */}
          {currentStep === 4 && (
            <AnimatedBadgeEntrance delay={60}>
              <View
                style={[
                  styles.whiteSectionCard,
                  { borderColor: '#86EFAC', borderWidth: 1.5, backgroundColor: '#F0FDF4' },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: '#16A34A',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>✓</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#166534' }}>
                      {translate('Đã hoàn thành sửa chữa')}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#15803D', marginTop: 2 }}>
                      {activeTicket.status === 'CLOSED'
                        ? translate('Cư dân đã xác nhận nghiệm thu & đóng sự cố.')
                        : translate('Đang chờ Cư dân / Ban Quản lý xác nhận nghiệm thu.')}
                    </Text>
                  </View>
                </View>

                <Text style={{ fontSize: 12.5, color: '#334155', marginTop: 4 }}>
                  🕒 <Text style={{ fontWeight: '700' }}>{translate('Thời gian hoàn thành:')}</Text>{' '}
                  {formatDateTime(activeTicket.completedAt || activeTicket.updatedAt || new Date().toISOString())}
                </Text>
                {activeTicket.techRepairNote ? (
                  <Text style={{ fontSize: 12.5, color: '#334155', marginTop: 4 }}>
                    📝 <Text style={{ fontWeight: '700' }}>{translate('Ghi chú xử lý:')}</Text> {activeTicket.techRepairNote}
                  </Text>
                ) : null}

                {allProofPhotos.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#166534', marginBottom: 6 }}>
                      📷 {translate('Ảnh nghiệm thu đã gửi')} ({allProofPhotos.length})
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      {allProofPhotos.map((url: string, idx: number) => (
                        <Image
                          key={idx}
                          source={{ uri: url }}
                          style={{
                            width: 84,
                            height: 84,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: '#86EFAC',
                          }}
                        />
                      ))}
                    </View>
                  </View>
                )}
              </View>

              {/* Mục thu gọn: Xem lại hành trình xử lý */}
              <View style={styles.whiteSectionCard}>
                <TouchableOpacity
                  style={styles.cardTopRow}
                  onPress={() => setExpandTimelineSection((prev) => !prev)}
                >
                  <Text style={[styles.cardBlockTitle, { marginBottom: 0 }]}>
                    🕒 {translate('Xem hành trình xử lý đầy đủ')}
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>
                    {expandTimelineSection ? translate('Thu gọn ▲') : translate('Xem chi tiết ▼')}
                  </Text>
                </TouchableOpacity>
                <CollapsibleDrawer expanded={expandTimelineSection}>
                  <View style={{ marginTop: 10 }}>
                    {renderIncidentProgressTimeline(activeTicket, 'TECHNICIAN')}
                  </View>
                </CollapsibleDrawer>
              </View>
            </AnimatedBadgeEntrance>
          )}
        </ScreenTransition>
      </ScrollView>

      {/* THANH NÚT HÀNH ĐỘNG CHÍNH DUY NHẤT Ở MỖI BƯỚC */}
      <View style={styles.stickyBottomBar}>
        {currentStep === 1 && (
          <TouchableOpacity
            style={[styles.primaryActionBtn, { backgroundColor: '#2563EB', paddingVertical: 14 }]}
            onPress={() => void onAcceptJob(activeTicket)}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={[styles.primaryActionBtnText, { fontSize: 14.5 }]}>
                🛠️ {translate('Nhận việc')}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {currentStep === 2 && (
          <TouchableOpacity
            style={[
              styles.primaryActionBtn,
              { backgroundColor: '#0284C7', paddingVertical: 14 },
              loading && { opacity: 0.6 },
            ]}
            onPress={() => void onConfirmArrival(activeTicket)}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={[styles.primaryActionBtnText, { fontSize: 14.5 }]}>
                📍 {translate('Tôi đã đến')}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {currentStep === 3 && (
          <TouchableOpacity
            style={[
              styles.confirmCloseGreenBtn,
              (loading || techProofPhotos.length === 0) && { opacity: 0.6 },
            ]}
            onPress={() => void onCompleteRepair(activeTicket)}
            disabled={loading || techProofPhotos.length === 0}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.confirmCloseGreenText}>
                ✓ {translate('Hoàn thành sửa chữa')}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {currentStep === 4 && (
          <TouchableOpacity
            style={[styles.primaryActionBtn, { backgroundColor: '#334155', paddingVertical: 14 }]}
            onPress={onBackHome}
          >
            <Text style={[styles.primaryActionBtnText, { fontSize: 14 }]}>
              ← {translate('Quay về danh sách công việc')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
