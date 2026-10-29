import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  SafeAreaView,
  Image,
} from 'react-native';

// ⚠️ LƯU Ý: Khi chạy trên Web dùng localhost:5000.
// Khi quét QR bằng điện thoại Android thật (Expo Go), hãy đổi localhost thành IP WiFi máy tính của bạn (VD: http://192.168.1.x:5000/api)
const API_BASE_URL = 'http://localhost:5000/api';

const CATEGORIES = ['PLUMBING', 'ELECTRICAL', 'ELEVATOR', 'HVAC', 'ACCESS_SECURITY', 'OTHER'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

const CATEGORY_LABELS: Record<string, string> = {
  PLUMBING: '💧 Cấp thoát nước (Plumbing)',
  ELECTRICAL: '⚡ Hệ thống Điện (Electrical)',
  ELEVATOR: '🛗 Thang máy (Elevator)',
  HVAC: '❄️ Điều hòa & Thông gió (HVAC)',
  ACCESS_SECURITY: '🔐 An ninh & Thẻ từ (Security)',
  OTHER: '🔧 Hạng mục khác (Other)',
};

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  PENDING: { label: '⏳ Chờ BMB duyệt (Pending)', bg: '#FEF3C7', color: '#D97706' },
  ASSIGNED: { label: '👷 Đã phân công (Assigned)', bg: '#DBEAFE', color: '#2563EB' },
  IN_PROGRESS: { label: '🛠️ Đang xử lý (In Progress)', bg: '#E0E7FF', color: '#4F46E5' },
  COMPLETED: { label: '📸 Chờ nghiệm thu (Completed)', bg: '#D1FAE5', color: '#059669' },
  CLOSED: { label: '✅ Đã đóng (Closed)', bg: '#F1F5F9', color: '#475569' },
};

export default function App() {
  // State Xác thực & Phân quyền RBAC (FR01)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [identifier, setIdentifier] = useState('0905123456');
  const [password, setPassword] = useState('123456');
  const [loading, setLoading] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  // State Dữ liệu Sự cố, Thông báo & Kỹ thuật viên ca trực
  const [tickets, setTickets] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'HOME' | 'REPORT' | 'NOTIFICATIONS'>('HOME');

  // State Form Báo cáo sự cố của Cư dân (FR03, FR05)
  const [descInput, setDescInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [isVoice, setIsVoice] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([
    'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?auto=format&fit=crop&w=600&q=80',
  ]);

  // State Duyệt & Phân công của BMB (FR06)
  const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
  const [editCategory, setEditCategory] = useState<string>('PLUMBING');
  const [editPriority, setEditPriority] = useState<string>('HIGH');
  const [selectedTechId, setSelectedTechId] = useState<string>('');
  const [bmbNote, setBmbNote] = useState<string>('');

  const showMessage = (msg: string) => {
    setBannerMsg(msg);
    setTimeout(() => setBannerMsg(null), 5000);
  };

  // ============================================================================
  // 1. HÀM ĐĂNG NHẬP & TẢI DỮ LIỆU THEO VAI TRÒ (RBAC)
  // ============================================================================
  const handleLogin = async (quickId?: string, quickPass?: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: quickId ?? identifier,
          password: quickPass ?? password,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showMessage(`❌ ${data.message || 'Đăng nhập thất bại'}`);
        return;
      }
      setToken(data.token);
      setUser(data.user);
      setActiveTab('HOME');
      showMessage(`✅ ${data.message}`);
    } catch (error) {
      showMessage('❌ Không kết nối được Backend! Hãy đảm bảo cổng 5000 đang chạy.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAllData = async (currentToken = token, currentUser = user) => {
    if (!currentToken || !currentUser) return;
    try {
      const headers = { Authorization: `Bearer ${currentToken}` };

      // Tải danh sách sự cố
      const ticketRes = await fetch(`${API_BASE_URL}/tickets`, { headers });
      const ticketData = await ticketRes.json();
      if (ticketData.success) {
        setTickets(ticketData.tickets || []);
        if (currentUser.role === 'BMB' && ticketData.tickets?.length > 0 && !selectedTicket) {
          selectTicketForBmb(ticketData.tickets[0]);
        }
      }

      // Tải hộp thư thông báo (US-36)
      const notiRes = await fetch(`${API_BASE_URL}/notifications`, { headers });
      const notiData = await notiRes.json();
      if (notiData.success) {
        setNotifications(notiData.notifications || []);
        setUnreadCount(notiData.unreadCount || 0);
      }

      // Nếu là BMB thì tải thêm danh sách KTV ca trực (US-27)
      if (currentUser.role === 'BMB') {
        const techRes = await fetch(`${API_BASE_URL}/tickets/technicians/on-duty`, { headers });
        const techData = await techRes.json();
        if (techData.success) {
          setTechnicians(techData.technicians || []);
          const firstOnDuty = techData.technicians?.find((t: any) => t.isOnDuty);
          if (firstOnDuty) setSelectedTechId(firstOnDuty.id);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (token && user) {
      fetchAllData(token, user);
    }
  }, [token, user]);

  const selectTicketForBmb = (t: any) => {
    setSelectedTicket(t);
    setEditCategory(t.finalCategory || t.aiSuggestedCategory || 'PLUMBING');
    setEditPriority(t.finalPriority || t.aiSuggestedPriority || 'HIGH');
    setBmbNote(t.bmbAdminNote || '');
  };

  // ============================================================================
  // 2. CÁC HÀM NGHIỆP VỤ CỦA CƯ DÂN (QUÉT QR, GIỌNG NÓI, TẠO BÁO CÁO, ĐÓNG TICKET)
  // ============================================================================
  const handleScanQrCode = async (code: string) => {
    if (!token) return;
    try {
      setQrInput(code);
      const res = await fetch(`${API_BASE_URL}/tickets/assets/qr/${code}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success && data.asset) {
        setLocationInput(`${data.asset.locationLabel} • Thiết bị: ${data.asset.qrCode}`);
        showMessage(`📷 Đã quét mã QR [${code}]: Tự động điền "${data.asset.assetName}"`);
      } else {
        showMessage(`⚠️ ${data.message}`);
      }
    } catch {
      showMessage('❌ Lỗi khi tra cứu mã QR');
    }
  };

  const handleVoiceSimulate = () => {
    setIsVoice(true);
    setDescInput('Đường ống nước dưới bồn rửa bát căn hộ A-1204 bị rò rỉ nước chảy tràn ra sàn bếp, cần khóa van gấp.');
    showMessage('🎙️ Speech-to-Text: Đã chuyển giọng nói tiếng Việt thành văn bản!');
  };

  const handleCreateTicket = async () => {
    if (descInput.trim().length < 10) {
      showMessage('⚠️ Mô tả sự cố phải có tối thiểu 10 ký tự (Risk R2 / US-07)!');
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          description: descInput,
          locationNote: locationInput || `Căn hộ ${user.apartmentCode || 'A-1204'}`,
          qrCode: qrInput || undefined,
          isVoiceInput: isVoice,
          imageUrls: photoUrls,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage(`🎉 ${data.message}`);
        setDescInput('');
        setQrInput('');
        setActiveTab('HOME');
        fetchAllData();
      } else {
        showMessage(`❌ ${data.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResidentCloseTicket = async (ticketId: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketId}/close`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ratingStars: 5,
          ratingComment: 'Kỹ thuật viên xử lý rất nhanh và sạch sẽ, cảm ơn BMB!',
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage(`⭐ ${data.message}`);
        fetchAllData();
      }
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // 3. CÁC HÀM NGHIỆP VỤ CỦA BMB (DUYỆT AI & GIAO VIỆC KTV CA TRỰC)
  // ============================================================================
  const handleBmbApproveAndAssign = async () => {
    if (!selectedTicket || !selectedTechId) {
      showMessage('⚠️ Vui lòng chọn Kỹ thuật viên đang trong ca trực!');
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tickets/${selectedTicket.id}/approve-assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          finalCategory: editCategory,
          finalPriority: editPriority,
          assignedTechId: selectedTechId,
          bmbAdminNote: bmbNote || 'Ưu tiên kiểm tra và chụp ảnh nghiệm thu rõ nét.',
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage(`✅ ${data.message}`);
        setSelectedTicket(data.ticket);
        fetchAllData();
      } else {
        showMessage(`❌ ${data.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // 4. CÁC HÀM NGHIỆP VỤ CỦA KỸ THUẬT VIÊN (CA TRỰC, NHẬN VIỆC, HOÀN THÀNH)
  // ============================================================================
  const handleToggleOnDuty = async () => {
    try {
      const nextDuty = !user.isOnDuty;
      const res = await fetch(`${API_BASE_URL}/auth/on-duty`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isOnDuty: nextDuty }),
      });
      const data = await res.json();
      if (data.success) {
        setUser({ ...user, isOnDuty: nextDuty });
        showMessage(data.message);
      }
    } catch {
      showMessage('❌ Lỗi đổi trạng thái ca trực');
    }
  };

  const handleTechAcknowledge = async (ticketId: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketId}/acknowledge`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        showMessage(`🛠️ ${data.message}`);
        fetchAllData();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTechComplete = async (ticketId: string) => {
    try {
      setLoading(true);
      // Bước 1: Gọi API Upload ảnh nghiệm thu lên Cloudinary (US-33, US-43)
      const uploadRes = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          folder: 'repair_proof',
        }),
      });
      const uploadData = await uploadRes.json();
      const proofUrl = uploadData.imageUrl || 'https://res.cloudinary.com/demo/image/upload/sample.jpg';

      // Bước 2: Cập nhật trạng thái COMPLETED kèm ảnh nghiệm thu (US-34)
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketId}/complete`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          proofImageUrls: [proofUrl],
          techRepairNote: 'Đã thay thế linh kiện hỏng, vệ sinh khu vực và kiểm tra vận hành ổn định 100%.',
          isQrVerifiedByTech: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage(`📸 ${data.message}`);
        fetchAllData();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAllRead = async () => {
    await fetch(`${API_BASE_URL}/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchAllData();
    showMessage('✅ Đã đánh dấu đọc toàn bộ thông báo!');
  };

  // ============================================================================
  // GIAO DIỆN 1: MÀN HÌNH ĐĂNG NHẬP HỢP NHẤT (SINGLE CODEBASE - FR01)
  // ============================================================================
  if (!token || !user) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <View style={styles.authCard}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoText}>🏢 RESIFIX • C1SE.52</Text>
          </View>
          <Text style={styles.authTitle}>Hệ Thống Quản Lý & Khắc Phục Sự Cố Tòa Nhà</Text>
          <Text style={styles.authSubtitle}>
            Single Codebase (React Native Expo) • Tích hợp Trợ lý Gemini Flash AI
          </Text>

          {bannerMsg && (
            <View style={styles.bannerBox}>
              <Text style={styles.bannerText}>{bannerMsg}</Text>
            </View>
          )}

          <Text style={styles.inputLabel}>Số điện thoại hoặc Email công vụ</Text>
          <TextInput
            style={styles.input}
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="Nhập SĐT hoặc Email..."
          />

          <Text style={styles.inputLabel}>Mật khẩu</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Nhập mật khẩu..."
          />

          <TouchableOpacity style={styles.primaryBtn} onPress={() => handleLogin()} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.primaryBtnText}>ĐĂNG NHẬP HỆ THỐNG</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider} />
          <Text style={styles.quickTitle}>⚡ ĐĂNG NHẬP NHANH ĐỂ DEMO 3 VAI TRÒ (RBAC):</Text>

          <TouchableOpacity
            style={[styles.quickRoleBtn, { borderColor: '#2563EB', backgroundColor: '#EFF6FF' }]}
            onPress={() => {
              setIdentifier('0905123456');
              handleLogin('0905123456', '123456');
            }}
          >
            <Text style={[styles.quickRoleTitle, { color: '#1D4ED8' }]}>
              🏠 Vai trò 1: Cư dân Căn hộ A-1204 (Mobile App)
            </Text>
            <Text style={styles.quickRoleSub}>SĐT: 0905123456 • Báo cáo sự cố, Quét QR, Giọng nói, Nghiệm thu</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickRoleBtn, { borderColor: '#7C3AED', backgroundColor: '#F5F3FF' }]}
            onPress={() => {
              setIdentifier('myhanh.bmb@resifix.vn');
              handleLogin('myhanh.bmb@resifix.vn', '123456');
            }}
          >
            <Text style={[styles.quickRoleTitle, { color: '#6D28D9' }]}>
              💻 Vai trò 2: Ban Quản Lý - Cầm Dương Mỹ Hạnh (BMB Web App)
            </Text>
            <Text style={styles.quickRoleSub}>Email: myhanh.bmb@resifix.vn • Duyệt gợi ý Gemini AI & Điều phối KTV</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickRoleBtn, { borderColor: '#059669', backgroundColor: '#ECFDF5' }]}
            onPress={() => {
              setIdentifier('0356166863');
              handleLogin('0356166863', '123456');
            }}
          >
            <Text style={[styles.quickRoleTitle, { color: '#047857' }]}>
              👷 Vai trò 3: Kỹ thuật viên - Đặng Văn Nam (Mobile App)
            </Text>
            <Text style={styles.quickRoleSub}>SĐT: 0356166863 • Nhận việc, Cập nhật tiến độ, Chụp ảnh nghiệm thu</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // GIAO DIỆN 2: PHÂN HỆ BAN QUẢN LÝ TOÀ NHÀ - BMB WEB DASHBOARD (US-20 -> US-28)
  // ============================================================================
  if (user.role === 'BMB') {
    return (
      <SafeAreaView style={styles.bmbContainer}>
        {/* Top Header BMB */}
        <View style={styles.bmbHeader}>
          <View>
            <Text style={styles.bmbLogo}>🏢 RESIFIX BMB PORTAL • TRUNG TÂM ĐIỀU PHỐI SỰ CỐ AI</Text>
            <Text style={styles.bmbSubHeader}>
              Quản trị viên: {user.fullName} ({user.email}) • Tổng số phiếu: {tickets.length}
            </Text>
          </View>
          <View style={styles.rowCenter}>
            <TouchableOpacity style={styles.refreshBtn} onPress={() => fetchAllData()}>
              <Text style={styles.refreshBtnText}>🔄 Làm mới dữ liệu</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={() => {
                setToken(null);
                setUser(null);
              }}
            >
              <Text style={styles.logoutBtnText}>Đăng xuất</Text>
            </TouchableOpacity>
          </View>
        </View>

        {bannerMsg && (
          <View style={styles.bannerBox}>
            <Text style={styles.bannerText}>{bannerMsg}</Text>
          </View>
        )}

        <View style={styles.bmbBody}>
          {/* Cột Trái: Danh sách Sự cố toàn tòa nhà (US-21) */}
          <ScrollView style={styles.bmbLeftList}>
            <Text style={styles.sectionHeader}>📋 DANH SÁCH SỰ CỐ TOÀN TÒA NHÀ ({tickets.length})</Text>
            {tickets.map((t) => {
              const badge = STATUS_BADGE[t.status] || STATUS_BADGE.PENDING;
              const isSelected = selectedTicket?.id === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.ticketCard, isSelected && styles.ticketCardSelected]}
                  onPress={() => selectTicketForBmb(t)}
                >
                  <View style={styles.rowBetween}>
                    <Text style={styles.ticketCode}>{t.ticketCode}</Text>
                    <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.ticketTitle}>{t.title}</Text>
                  <Text style={styles.ticketMeta}>
                    📍 {t.locationNote} • 🏠 {t.resident?.fullName} ({t.resident?.apartmentCode})
                  </Text>
                  <View style={styles.aiMiniTag}>
                    <Text style={styles.aiMiniText}>
                      ✨ Gemini AI gợi ý: {t.aiSuggestedCategory} • Ưu tiên: {t.aiSuggestedPriority} ({t.aiLatencyMs}ms)
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Cột Phải: Chi tiết Sự cố + Duyệt AI + Phân công KTV Ca trực (US-22 -> US-27) */}
          <ScrollView style={styles.bmbRightDetail}>
            {selectedTicket ? (
              <View>
                <Text style={styles.sectionHeader}>
                  🔍 CHI TIẾT & ĐIỀU PHỐI PHIẾU: {selectedTicket.ticketCode}
                </Text>
                <Text style={styles.detailTitle}>{selectedTicket.title}</Text>
                <Text style={styles.detailDesc}>📝 Mô tả cư dân: "{selectedTicket.description}"</Text>
                <Text style={styles.detailMeta}>📍 Vị trí: {selectedTicket.locationNote}</Text>

                {/* Khối Gợi ý từ Trợ lý Gemini AI (FR04, FR06, Risk R1) */}
                <View style={styles.aiAssistantBox}>
                  <Text style={styles.aiBoxHeader}>
                    ✨ TRỢ LÝ GEMINI FLASH AI PHÂN TÍCH TỰ ĐỘNG ({selectedTicket.aiLatencyMs}ms)
                  </Text>
                  <Text style={styles.aiSummaryText}>{selectedTicket.aiSummary}</Text>

                  <Text style={styles.inputLabel}>
                    1. Duyệt hoặc Chỉnh sửa Danh mục Sự cố (US-24 - AI gợi ý: {selectedTicket.aiSuggestedCategory}):
                  </Text>
                  <View style={styles.chipRow}>
                    {CATEGORIES.map((cat) => (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.chip, editCategory === cat && styles.chipActive]}
                        onPress={() => setEditCategory(cat)}
                      >
                        <Text style={[styles.chipText, editCategory === cat && styles.chipTextActive]}>
                          {CATEGORY_LABELS[cat]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.inputLabel}>
                    2. Duyệt hoặc Chỉnh sửa Mức độ Ưu tiên (US-25 - AI gợi ý: {selectedTicket.aiSuggestedPriority}):
                  </Text>
                  <View style={styles.chipRow}>
                    {PRIORITIES.map((prio) => (
                      <TouchableOpacity
                        key={prio}
                        style={[styles.chip, editPriority === prio && styles.chipActive]}
                        onPress={() => setEditPriority(prio)}
                      >
                        <Text style={[styles.chipText, editPriority === prio && styles.chipTextActive]}>
                          {prio === 'HIGH' ? '🔴 KHẨN CẤP (HIGH)' : prio === 'MEDIUM' ? '🟡 TRUNG BÌNH (MEDIUM)' : '🟢 THẤP (LOW)'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.inputLabel}>3. Chọn Kỹ thuật viên đang trong ca trực (On-Duty - US-27):</Text>
                  {technicians.map((tech) => (
                    <TouchableOpacity
                      key={tech.id}
                      style={[
                        styles.techItem,
                        selectedTechId === tech.id && styles.techItemSelected,
                      ]}
                      onPress={() => setSelectedTechId(tech.id)}
                    >
                      <Text style={styles.techName}>
                        {tech.isOnDuty ? '🟢' : '⚪'} {tech.fullName} — {tech.specialtyLabel}
                      </Text>
                      <Text style={styles.techSub}>
                        {tech.shiftName} • Đang xử lý: {tech.assignedTickets?.length || 0} việc
                      </Text>
                    </TouchableOpacity>
                  ))}

                  <Text style={styles.inputLabel}>4. Ghi chú chỉ đạo của Ban Quản Lý:</Text>
                  <TextInput
                    style={styles.input}
                    value={bmbNote}
                    onChangeText={setBmbNote}
                    placeholder="Nhập ghi chú giao việc cho Kỹ thuật viên..."
                  />

                  {selectedTicket.status === 'PENDING' ? (
                    <TouchableOpacity
                      style={styles.primaryBtn}
                      onPress={handleBmbApproveAndAssign}
                      disabled={loading}
                    >
                      <Text style={styles.primaryBtnText}>
                        ✅ XÁC NHẬN PHÂN LOẠI & GIAO VIỆC CHO KỸ THUẬT VIÊN
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.approvedBanner}>
                      <Text style={styles.approvedBannerText}>
                        ✔ Phiếu này đã được điều phối cho KTV: {selectedTicket.assignedTech?.fullName || 'Đặng Văn Nam'} (Trạng thái: {selectedTicket.status})
                      </Text>
                    </View>
                  )}
                </View>

                {/* Nhật ký Trạng thái (Status Logs - US-28) */}
                <Text style={[styles.sectionHeader, { marginTop: 18 }]}>🕒 NHẬT KÝ VÒNG ĐỜI SỰ CỐ (STATUS LOGS)</Text>
                {selectedTicket.statusLogs?.map((log: any) => (
                  <View key={log.id} style={styles.logItem}>
                    <Text style={styles.logTitle}>• {log.title}</Text>
                    <Text style={styles.logNote}>{log.note}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text>Hãy chọn 1 sự cố bên trái để xem chi tiết.</Text>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // GIAO DIỆN 3: MOBILE APP CHO CƯ DÂN & KỸ THUẬT VIÊN (RESIDENT & TECHNICIAN)
  // ============================================================================
  return (
    <SafeAreaView style={styles.mobileContainer}>
      {/* Header Mobile */}
      <View style={styles.mobileHeader}>
        <View>
          <Text style={styles.mobileRoleTag}>
            {user.role === 'RESIDENT'
              ? `🏠 CƯ DÂN • CĂN HỘ ${user.apartmentCode} (${user.buildingBlock})`
              : `👷 KỸ THUẬT VIÊN • ${user.specialtyLabel}`}
          </Text>
          <Text style={styles.mobileWelcome}>Xin chào, {user.fullName}</Text>
        </View>
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => {
            setToken(null);
            setUser(null);
          }}
        >
          <Text style={styles.logoutBtnText}>Thoát</Text>
        </TouchableOpacity>
      </View>

      {/* Thanh trạng thái Ca trực dành riêng cho Kỹ thuật viên (FR06) */}
      {user.role === 'TECHNICIAN' && (
        <View style={styles.dutyBar}>
          <Text style={styles.dutyText}>
            Ca trực: {user.isOnDuty ? '🟢 Đang trong ca trực (On-duty)' : '⚪ Ngoài ca trực'}
          </Text>
          <TouchableOpacity style={styles.dutyToggleBtn} onPress={handleToggleOnDuty}>
            <Text style={styles.dutyToggleText}>Đổi trạng thái</Text>
          </TouchableOpacity>
        </View>
      )}

      {bannerMsg && (
        <View style={styles.bannerBox}>
          <Text style={styles.bannerText}>{bannerMsg}</Text>
        </View>
      )}

      {/* Nội dung chính của Mobile App */}
      <ScrollView style={styles.mobileBody}>
        {/* TAB 1: DANH SÁCH SỰ CỐ / CÔNG VIỆC */}
        {activeTab === 'HOME' && (
          <View>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionHeader}>
                {user.role === 'RESIDENT' ? '📋 LỊCH SỬ BÁO CÁO SỰ CỐ CỦA TÔI' : '🛠️ CÔNG VIỆC ĐƯỢC PHÂN CÔNG'}
              </Text>
              <TouchableOpacity onPress={() => fetchAllData()}>
                <Text style={{ color: '#2563EB', fontWeight: '700' }}>🔄 Làm mới</Text>
              </TouchableOpacity>
            </View>

            {tickets.map((t) => {
              const badge = STATUS_BADGE[t.status] || STATUS_BADGE.PENDING;
              return (
                <View key={t.id} style={styles.ticketCard}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.ticketCode}>{t.ticketCode}</Text>
                    <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                    </View>
                  </View>

                  <Text style={styles.ticketTitle}>{t.title}</Text>
                  <Text style={styles.ticketDescText}>{t.description}</Text>
                  <Text style={styles.ticketMeta}>📍 Vị trí: {t.locationNote}</Text>

                  <View style={styles.aiMiniTag}>
                    <Text style={styles.aiMiniText}>
                      ✨ AI Phân loại: {t.finalCategory || t.aiSuggestedCategory} • Ưu tiên:{' '}
                      {t.finalPriority || t.aiSuggestedPriority}
                    </Text>
                  </View>

                  {t.assignedTech && (
                    <Text style={styles.techAssignedInfo}>
                      👷 KTV phụ trách: {t.assignedTech.fullName} ({t.assignedTech.phone})
                    </Text>
                  )}

                  {/* Nút hành động cho Kỹ thuật viên (FR07: US-31 -> US-34) */}
                  {user.role === 'TECHNICIAN' && t.status === 'ASSIGNED' && (
                    <TouchableOpacity
                      style={[styles.primaryBtn, { backgroundColor: '#2563EB', marginTop: 10 }]}
                      onPress={() => handleTechAcknowledge(t.id)}
                    >
                      <Text style={styles.primaryBtnText}>🛠️ XÁC NHẬN NHẬN VIỆC NGAY (IN PROGRESS)</Text>
                    </TouchableOpacity>
                  )}

                  {user.role === 'TECHNICIAN' && t.status === 'IN_PROGRESS' && (
                    <TouchableOpacity
                      style={[styles.primaryBtn, { backgroundColor: '#059669', marginTop: 10 }]}
                      onPress={() => handleTechComplete(t.id)}
                    >
                      <Text style={styles.primaryBtnText}>
                        📸 TẢI ẢNH NGHIỆM THU & HOÀN THÀNH SỬA CHỮA
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Nút nghiệm thu & Đánh giá 5 sao cho Cư dân (FR09: US-38, US-40) */}
                  {user.role === 'RESIDENT' && t.status === 'COMPLETED' && (
                    <View style={styles.acceptBox}>
                      <Text style={styles.acceptTitle}>
                        📸 Kỹ thuật viên đã gửi ảnh nghiệm thu: "{t.techRepairNote}"
                      </Text>
                      <TouchableOpacity
                        style={[styles.primaryBtn, { backgroundColor: '#059669', marginTop: 8 }]}
                        onPress={() => handleResidentCloseTicket(t.id)}
                      >
                        <Text style={styles.primaryBtnText}>
                          ✅ XÁC NHẬN "ĐÃ GIẢI QUYẾT" & ĐÁNH GIÁ 5 SAO ⭐
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {t.status === 'CLOSED' && t.ratingStars && (
                    <Text style={styles.closedRatingText}>
                      ⭐ Đã nghiệm thu & đóng phiếu: {t.ratingStars}/5 sao — "{t.ratingComment}"
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* TAB 2: FORM BÁO CÁO SỰ CỐ 1 CHẠM CỦA CƯ DÂN (FR03, FR05, US-06 -> US-11) */}
        {activeTab === 'REPORT' && user.role === 'RESIDENT' && (
          <View style={styles.formCard}>
            <Text style={styles.sectionHeader}>➕ TẠO BÁO CÁO SỰ CỐ MỚI (3 BƯỚC)</Text>

            <Text style={styles.inputLabel}>Bước 1: Quét mã QR Thiết bị để tự động điền vị trí (FR05, US-09)</Text>
            <View style={styles.rowBetween}>
              <TouchableOpacity style={styles.qrQuickBtn} onPress={() => handleScanQrCode('WP-1204')}>
                <Text style={styles.qrQuickText}>📷 Quét QR: WP-1204 (Ống nước A-1204)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.qrQuickBtn} onPress={() => handleScanQrCode('AC-B02')}>
                <Text style={styles.qrQuickText}>📷 Quét QR: AC-B02 (Máy lạnh Sảnh B)</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Vị trí sự cố (Tự động điền từ QR hoặc nhập tay):</Text>
            <TextInput
              style={styles.input}
              value={locationInput}
              onChangeText={setLocationInput}
              placeholder="VD: Căn hộ A-1204 hoặc Hành lang tầng 12..."
            />

            <View style={styles.rowBetween}>
              <Text style={styles.inputLabel}>Bước 2: Mô tả sự cố tiếng Việt (Tối thiểu 10 ký tự - US-07)</Text>
              <TouchableOpacity style={styles.voiceBtn} onPress={handleVoiceSimulate}>
                <Text style={styles.voiceBtnText}>🎙️ Nhập bằng giọng nói (US-10)</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
              multiline
              value={descInput}
              onChangeText={setDescInput}
              placeholder="Hãy mô tả tự nhiên bằng tiếng Việt, Gemini AI sẽ tự động phân loại danh mục & mức độ khẩn cấp..."
            />

            <Text style={styles.inputLabel}>Bước 3: Đính kèm tối đa 3 ảnh hiện trường (FR03, US-08):</Text>
            <View style={styles.photoPreviewRow}>
              {photoUrls.map((url, idx) => (
                <Image key={idx} source={{ uri: url }} style={styles.thumbImg} />
              ))}
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleCreateTicket} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryBtnText}>🚀 GỬI BÁO CÁO & PHÂN TÍCH BẰNG GEMINI AI</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* TAB 3: HỘP THƯ THÔNG BÁO (FR08, Risk R3, US-36, US-37) */}
        {activeTab === 'NOTIFICATIONS' && (
          <View>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionHeader}>🔔 HỘP THƯ THÔNG BÁO ({unreadCount} chưa đọc)</Text>
              <TouchableOpacity onPress={handleMarkAllRead}>
                <Text style={{ color: '#2563EB', fontWeight: '700' }}>✔ Đánh dấu đã đọc hết</Text>
              </TouchableOpacity>
            </View>
            {notifications.map((n) => (
              <View key={n.id} style={[styles.notiCard, !n.isRead && styles.notiUnread]}>
                <Text style={styles.notiTitle}>{n.title}</Text>
                <Text style={styles.notiMessage}>{n.message}</Text>
                <Text style={styles.notiTime}>Mã phiếu: {n.ticket?.ticketCode} • {n.ticket?.locationNote}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Thanh Điều Hướng Đáy (Bottom Navigation Bar cho Mobile) */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('HOME')}>
          <Text style={[styles.navText, activeTab === 'HOME' && styles.navTextActive]}>
            🏠 {user.role === 'RESIDENT' ? 'Sự cố của tôi' : 'Việc được giao'}
          </Text>
        </TouchableOpacity>

        {user.role === 'RESIDENT' && (
          <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('REPORT')}>
            <Text style={[styles.navText, activeTab === 'REPORT' && styles.navTextActive]}>
              ➕ Báo cáo sự cố
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('NOTIFICATIONS')}>
          <Text style={[styles.navText, activeTab === 'NOTIFICATIONS' && styles.navTextActive]}>
            🔔 Thông báo {unreadCount > 0 ? `(${unreadCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  authContainer: { flex: 1, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', padding: 16 },
  authCard: { width: '100%', maxWidth: 520, backgroundColor: '#FFF', borderRadius: 16, padding: 24, elevation: 4 },
  logoBadge: { alignSelf: 'flex-start', backgroundColor: '#DBEAFE', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginBottom: 10 },
  logoText: { color: '#1E40AF', fontWeight: '800', fontSize: 13 },
  authTitle: { fontSize: 22, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  authSubtitle: { fontSize: 13, color: '#64748B', marginBottom: 16 },
  inputLabel: { fontSize: 13, fontWeight: '700', color: '#334155', marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#F8FAFC' },
  primaryBtn: { backgroundColor: '#1D4ED8', borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  divider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 18 },
  quickTitle: { fontSize: 12, fontWeight: '800', color: '#475569', marginBottom: 8 },
  quickRoleBtn: { borderWidth: 1.5, borderRadius: 10, padding: 12, marginBottom: 10 },
  quickRoleTitle: { fontWeight: '800', fontSize: 14 },
  quickRoleSub: { fontSize: 12, color: '#475569', marginTop: 2 },
  bannerBox: { backgroundColor: '#FEF3C7', borderColor: '#F59E0B', borderWidth: 1, padding: 10, borderRadius: 8, margin: 10 },
  bannerText: { color: '#B45309', fontWeight: '700', fontSize: 13 },
  bmbContainer: { flex: 1, backgroundColor: '#F8FAFC' },
  bmbHeader: { backgroundColor: '#1E293B', paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bmbLogo: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  bmbSubHeader: { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  bmbBody: { flex: 1, flexDirection: Platform.OS === 'web' ? 'row' : 'column', padding: 16 },
  bmbLeftList: { flex: 1, marginRight: Platform.OS === 'web' ? 16 : 0 },
  bmbRightDetail: { flex: 1.2, backgroundColor: '#FFF', borderRadius: 12, padding: 18, borderWidth: 1, borderColor: '#E2E8F0' },
  sectionHeader: { fontSize: 14, fontWeight: '800', color: '#0F172A', marginBottom: 12 },
  ticketCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  ticketCardSelected: { borderColor: '#2563EB', borderWidth: 2, backgroundColor: '#F8FAFC' },
  ticketCode: { fontWeight: '800', fontSize: 14, color: '#1E40AF' },
  ticketTitle: { fontWeight: '700', fontSize: 15, color: '#0F172A', marginTop: 6 },
  ticketDescText: { fontSize: 13, color: '#334155', marginTop: 4 },
  ticketMeta: { fontSize: 12, color: '#64748B', marginTop: 6 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  aiMiniTag: { backgroundColor: '#F3E8FF', padding: 8, borderRadius: 8, marginTop: 8 },
  aiMiniText: { color: '#6B21A8', fontSize: 12, fontWeight: '700' },
  detailTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  detailDesc: { fontSize: 14, color: '#334155', marginBottom: 6 },
  detailMeta: { fontSize: 13, color: '#64748B', marginBottom: 12 },
  aiAssistantBox: { backgroundColor: '#FAF5FF', borderColor: '#D8B4FE', borderWidth: 1, borderRadius: 12, padding: 14 },
  aiBoxHeader: { color: '#6B21A8', fontWeight: '800', fontSize: 14, marginBottom: 4 },
  aiSummaryText: { color: '#4C1D95', fontSize: 13, fontStyle: 'italic', marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#FFF', marginRight: 6, marginBottom: 6 },
  chipActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  chipText: { fontSize: 12, color: '#334155', fontWeight: '600' },
  chipTextActive: { color: '#FFF', fontWeight: '800' },
  techItem: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 10, marginBottom: 6 },
  techItemSelected: { borderColor: '#059669', borderWidth: 2, backgroundColor: '#ECFDF5' },
  techName: { fontWeight: '700', fontSize: 13, color: '#0F172A' },
  techSub: { fontSize: 12, color: '#64748B', marginTop: 2 },
  approvedBanner: { backgroundColor: '#DCFCE7', padding: 12, borderRadius: 8, marginTop: 12 },
  approvedBannerText: { color: '#166534', fontWeight: '700', fontSize: 13 },
  logItem: { borderLeftWidth: 3, borderLeftColor: '#2563EB', paddingLeft: 10, marginBottom: 8 },
  logTitle: { fontWeight: '700', fontSize: 13, color: '#1E293B' },
  logNote: { fontSize: 12, color: '#64748B' },
  mobileContainer: { flex: 1, backgroundColor: '#F1F5F9' },
  mobileHeader: { backgroundColor: '#1D4ED8', padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mobileRoleTag: { color: '#BFDBFE', fontSize: 11, fontWeight: '800' },
  mobileWelcome: { color: '#FFF', fontSize: 17, fontWeight: '800', marginTop: 2 },
  dutyBar: { backgroundColor: '#0F172A', paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dutyText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  dutyToggleBtn: { backgroundColor: '#3B82F6', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  dutyToggleText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  mobileBody: { flex: 1, padding: 14 },
  formCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  qrQuickBtn: { flex: 1, backgroundColor: '#EFF6FF', borderColor: '#93C5FD', borderWidth: 1, padding: 10, borderRadius: 8, marginRight: 6 },
  qrQuickText: { color: '#1D4ED8', fontSize: 12, fontWeight: '700' },
  voiceBtn: { backgroundColor: '#FEE2E2', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  voiceBtnText: { color: '#DC2626', fontSize: 12, fontWeight: '700' },
  photoPreviewRow: { flexDirection: 'row', marginTop: 6 },
  thumbImg: { width: 80, height: 80, borderRadius: 8, marginRight: 8 },
  techAssignedInfo: { fontSize: 12, color: '#047857', fontWeight: '700', marginTop: 6 },
  acceptBox: { backgroundColor: '#ECFDF5', padding: 10, borderRadius: 8, marginTop: 10, borderWidth: 1, borderColor: '#6EE7B7' },
  acceptTitle: { color: '#065F46', fontSize: 12, fontWeight: '700' },
  closedRatingText: { color: '#D97706', fontWeight: '700', fontSize: 12, marginTop: 8 },
  notiCard: { backgroundColor: '#FFF', padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  notiUnread: { borderLeftWidth: 4, borderLeftColor: '#2563EB', backgroundColor: '#EFF6FF' },
  notiTitle: { fontWeight: '800', fontSize: 14, color: '#0F172A' },
  notiMessage: { fontSize: 13, color: '#334155', marginTop: 4 },
  notiTime: { fontSize: 11, color: '#64748B', marginTop: 6 },
  bottomNav: { flexDirection: 'row', backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingVertical: 12 },
  navItem: { flex: 1, alignItems: 'center' },
  navText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  navTextActive: { color: '#1D4ED8', fontWeight: '800' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  refreshBtn: { backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, marginRight: 8 },
  refreshBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  logoutBtn: { backgroundColor: '#EF4444', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  logoutBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
});