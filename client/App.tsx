import React, { useState } from 'react';
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
  StatusBar,
  Alert,
} from 'react-native';
import QrScannerModal from './QrScannerModal';
import * as ImagePicker from 'expo-image-picker';

// ============================================================================
// CẤU HÌNH ĐỊA CHỈ BACKEND CHUẨN CHO CẢ WEB & ĐIỆN THOẠI
// ============================================================================
const COMPUTER_LAN_IP = '192.168.1.24'; // IP Wi-Fi máy tính của bạn

const getApiBaseUrl = () => {
  if (Platform.OS === 'web') {
    // Trên trình duyệt máy tính: Luôn gọi thẳng vào cổng 5000 nội bộ của máy tính
    return 'http://localhost:5000/api';
  }
  return 'https://fast-games-eat.loca.lt/api';
};

const API_BASE_URL = getApiBaseUrl();

const CATEGORY_VN: Record<string, string> = {
  PLUMBING: 'Hệ thống Điện - Nước',
  ELECTRICAL: 'Điện & Chiếu sáng',
  ELEVATOR: 'Thang máy & Cơ khí',
  HVAC: 'Điều hòa & Thông gió',
  ACCESS_SECURITY: 'Điện tử & An ninh',
  OTHER: 'Hạng mục khác',
};

const CATEGORY_SHORT_VN: Record<string, string> = {
  PLUMBING: 'Điện - Nước',
  ELECTRICAL: 'Hệ thống Điện',
  ELEVATOR: 'Thang máy',
  HVAC: 'Điều hòa',
  ACCESS_SECURITY: 'Điện tử & An ninh',
  OTHER: 'Khác',
};

const PRIORITY_VN: Record<string, string> = {
  HIGH: '🔥 Cao - Khẩn cấp',
  MEDIUM: '⚡ Trung bình',
  LOW: '🟢 Thấp',
};

const CATEGORIES_LIST = ['PLUMBING', 'ELECTRICAL', 'ELEVATOR', 'HVAC', 'ACCESS_SECURITY', 'OTHER'];
const PRIORITIES_LIST = ['HIGH', 'MEDIUM', 'LOW'];


// ============================================================================
// RESIFIX FIGMA DESIGN SYSTEM -- Android + React Native Web, không thêm thư viện
// Các biểu tượng được vẽ bằng View/Text thay vì emoji có màu khác nhau trên máy.
// ============================================================================
const UI = {
  primary: '#2563EB',
  primaryLight: '#EFF6FF',
  aiPurple: '#7C3AED',
  background: '#F8FAFC',
  text: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  success: '#10B981',
} as const;

// Đặt true khi nhóm cần nút demo đăng nhập nhanh, false để màn hình đúng Figma.
const SHOW_DEMO_SHORTCUTS = false;

function ResiFixLogoMark({ size = 68 }: { size?: number }) {
  const stroke = Math.max(1.25, size * 0.033);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.2,
        backgroundColor: UI.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: size * 0.45,
          height: size * 0.58,
          borderWidth: stroke,
          borderColor: '#FFFFFF',
          borderRadius: size * 0.04,
          justifyContent: 'space-around',
          padding: size * 0.065,
          marginRight: size * 0.08,
        }}
      >
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ width: size * 0.055, height: size * 0.055, backgroundColor: '#FFFFFF', borderRadius: 1 }} />
            <View style={{ width: size * 0.055, height: size * 0.055, backgroundColor: '#FFFFFF', borderRadius: 1 }} />
          </View>
        ))}
      </View>
      <View
        style={{
          position: 'absolute',
          right: size * 0.20,
          bottom: size * 0.18,
          width: size * 0.09,
          height: size * 0.34,
          borderWidth: stroke,
          borderColor: '#FFFFFF',
          borderRadius: size * 0.04,
          transform: [{ rotate: '35deg' }],
          backgroundColor: UI.primary,
        }}
      />
    </View>
  );
}

type ResiFixLineIcon = 'home' | 'history' | 'profile' | 'bell';
function OutlineIcon({
  name,
  size = 22,
  active = false,
  color,
}: {
  name: ResiFixLineIcon;
  size?: number;
  active?: boolean;
  color?: string;
}) {
  const c = color || (active ? UI.primary : UI.muted);
  const line = Math.max(1.7, size * 0.085);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {name === 'home' && (
        <>
          <View style={{
            position: 'absolute', width: size * 0.52, height: size * 0.51,
            bottom: size * 0.12, borderColor: c, borderWidth: line,
            borderTopWidth: 0, borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
          }} />
          <View style={{
            position: 'absolute', width: size * 0.51, height: size * 0.51,
            left: size * 0.245, top: size * 0.17, transform: [{ rotate: '45deg' }],
            borderColor: c, borderTopWidth: line, borderLeftWidth: line, borderTopLeftRadius: 2,
          }} />
          <View style={{
            position: 'absolute', bottom: size * 0.12, width: size * 0.17,
            height: size * 0.29, borderWidth: line * 0.85, borderBottomWidth: 0, borderColor: c,
          }} />
        </>
      )}
      {name === 'history' && (
        <>
          <View style={{ width: size * 0.73, height: size * 0.73, borderRadius: size, borderWidth: line, borderColor: c }} />
          <View style={{ position: 'absolute', left: size * 0.48, top: size * 0.27, width: line, height: size * 0.27, backgroundColor: c, borderRadius: 2 }} />
          <View style={{ position: 'absolute', left: size * 0.48, top: size * 0.51, width: size * 0.21, height: line, backgroundColor: c, borderRadius: 2 }} />
        </>
      )}
      {name === 'profile' && (
        <>
          <View style={{ position: 'absolute', top: size * 0.09, width: size * 0.37, height: size * 0.37, borderRadius: size, borderWidth: line, borderColor: c }} />
          <View style={{ position: 'absolute', bottom: size * 0.09, width: size * 0.74, height: size * 0.35, borderTopLeftRadius: size, borderTopRightRadius: size, borderWidth: line, borderBottomWidth: 0, borderColor: c }} />
        </>
      )}
      {name === 'bell' && (
        <>
          <View style={{ position: 'absolute', top: size * 0.15, width: size * 0.60, height: size * 0.59, borderTopLeftRadius: size, borderTopRightRadius: size, borderBottomLeftRadius: size * 0.08, borderBottomRightRadius: size * 0.08, borderWidth: line, borderColor: c }} />
          <View style={{ position: 'absolute', bottom: size * 0.16, width: size * 0.81, height: line, borderRadius: line, backgroundColor: c }} />
          <View style={{ position: 'absolute', bottom: size * 0.045, width: size * 0.16, height: size * 0.10, borderBottomLeftRadius: size, borderBottomRightRadius: size, backgroundColor: c }} />
        </>
      )}
    </View>
  );
}

export default function App() {
  // 1. State Xác thực & Chuyển đổi giao diện Login Web / Mobile (FR01)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [loginMode, setLoginMode] = useState<'BMB_WEB' | 'MOBILE'>(
    Platform.OS === 'web' ? 'BMB_WEB' : 'MOBILE'
  );
  const [phoneInput, setPhoneInput] = useState(
    Platform.OS === 'web' ? 'myhanh.bmb@resifix.vn' : '0905123456'
  );
  const [passwordInput, setPasswordInput] = useState('123456');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // 2. Điều hướng màn hình theo từng vai trò (Chuẩn 15 màn hình Figma)
  const [resScreen, setResScreen] = useState<
    'HOME' | 'CREATE_REPORT' | 'TICKET_DETAIL' | 'NOTI_PROFILE' | 'HISTORY'
  >('HOME');
  const [techScreen, setTechScreen] = useState<
    'HOME' | 'TASK_DETAIL' | 'NOTI_PROFILE' | 'HISTORY'
  >('HOME');
  const [bmbNavTab, setBmbNavTab] = useState<'TICKETS' | 'TECHNICIANS' | 'NOTIFICATIONS'>('TICKETS');

  // 3. State Dữ liệu thực từ Backend PostgreSQL
  const [tickets, setTickets] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [technicians, setTechnicians] = useState<any[]>([]);

  // 4. Bộ lọc trên các màn hình
  const [homeFilter, setHomeFilter] = useState<'ALL' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>('ALL');
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'CLOSED' | 'M10' | 'M09'>('ALL');
  const [techHomeFilter, setTechHomeFilter] = useState<'ALL' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED'>('ALL');
  const [techHistoryFilter, setTechHistoryFilter] = useState<'ALL' | 'CLOSED' | 'COMPLETED'>('ALL');
  const [bmbTicketFilter, setBmbTicketFilter] = useState<
    'ALL' | 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED'
  >('ALL');
  const [bmbNotiFilter, setBmbNotiFilter] = useState<'ALL' | 'UNREAD' | 'URGENT' | 'TECH'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // 5. State Màn hình 02 Cư dân: Tạo báo cáo sự cố 3 bước
  const [scannedAsset, setScannedAsset] = useState<{
    qrCode: string;
    assetName: string;
    locationLabel: string;
  } | null>({
    qrCode: 'AC-B02',
    assetName: 'Máy lạnh sảnh B',
    locationLabel: 'Tầng 1 - Tòa S1',
  });
  const [reportPhotos, setReportPhotos] = useState<Array<{ label: string; url: string }>>([
    {
      label: 'Máy lạnh sảnh B',
      url: 'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?auto=format&fit=crop&w=600&q=80',
    },
    {
      label: 'Nước chảy xuống sàn',
      url: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=600&q=80',
    },
  ]);
  const [reportDesc, setReportDesc] = useState(
    'Máy lạnh ở sảnh B tầng 1 bị chảy nước nhiều xuống sàn gây trơn trượt, có tiếng kêu to.'
  );
  const [isVoiceUsed, setIsVoiceUsed] = useState(false);

  // 6. State Chi tiết Sự cố (Cư dân & Kỹ thuật viên)
  const [activeTicket, setActiveTicket] = useState<any | null>(null);
  const [ratingStars, setRatingStars] = useState<number>(5);
  const [ratingComment, setRatingComment] = useState<string>('');
  const [techProofPhotos, setTechProofPhotos] = useState<string[]>([
    'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80',
  ]);
  const [techRepairNote, setTechRepairNote] = useState<string>(
    'Đã thay mới đoạn ống dẫn nước dưới bồn rửa và kiểm tra không còn rò rỉ.'
  );

  // 7. State BMB Web Dashboard (Màn hình 01, 02, 03 BMB)
  const [bmbSelectedTicket, setBmbSelectedTicket] = useState<any | null>(null);
  const [bmbCategory, setBmbCategory] = useState<string>('PLUMBING');
  const [bmbPriority, setBmbPriority] = useState<string>('HIGH');
  const [bmbTechId, setBmbTechId] = useState<string>('');
  const [bmbNote, setBmbNote] = useState<string>('');
  const [bmbAssignTargetTech, setBmbAssignTargetTech] = useState<any | null>(null);
  const [bmbViewingWorkloadTech, setBmbViewingWorkloadTech] = useState<any | null>(null);
  const [bmbRadioTicketId, setBmbRadioTicketId] = useState<string>('');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  // ============================================================================
  // HÀM GỌI API BACKEND
  // ============================================================================
  const handleLogin = async (overrideId?: string, overridePass?: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          identifier: (overrideId ?? phoneInput).trim(),
          password: (overridePass ?? passwordInput).trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.message || 'Sai thông tin đăng nhập!');
        return;
      }
      setToken(data.token);
      setUser(data.user);
      setResScreen('HOME');
      setTechScreen('HOME');
      setBmbNavTab('TICKETS');
      fetchAllData(data.token, data.user);
    } catch {
      showToast(`Không kết nối được Backend (${API_BASE_URL}). Hãy đảm bảo cổng 5000 đang chạy!`);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllData = async (currentToken = token, currentUser = user) => {
    if (!currentToken || !currentUser) return;
    try {
      const headers = { Authorization: `Bearer ${currentToken}` };
      const [tRes, nRes] = await Promise.all([
        fetch(`${API_BASE_URL}/tickets`, { headers }),
        fetch(`${API_BASE_URL}/notifications`, { headers }),
      ]);
      const tData = await tRes.json();
      const nData = await nRes.json();

      if (tData.success) {
        const list = tData.tickets || [];
        setTickets(list);
        if (activeTicket) {
          const updated = list.find((item: any) => item.id === activeTicket.id);
          if (updated) setActiveTicket(updated);
        }
        if (currentUser.role === 'BMB' && list.length > 0) {
          const currentSel = bmbSelectedTicket
            ? list.find((x: any) => x.id === bmbSelectedTicket.id) || list[0]
            : list[0];
          handleSelectBmbTicket(currentSel);
          const firstPending = list.find((x: any) => x.status === 'PENDING') || list[0];
          if (firstPending) setBmbRadioTicketId(firstPending.id);
        }
      }
      if (nData.success) {
        setNotifications(nData.notifications || []);
        setUnreadCount(nData.unreadCount || 0);
      }
      if (currentUser.role === 'BMB') {
        const techRes = await fetch(`${API_BASE_URL}/tickets/technicians/on-duty`, { headers });
        const techData = await techRes.json();
        if (techData.success) {
          const techList = techData.technicians || [];
          setTechnicians(techList);
          const firstDuty = techList.find((t: any) => t.isOnDuty) || techList[0];
          if (firstDuty) {
            setBmbTechId(firstDuty.id);
            setBmbAssignTargetTech(firstDuty);
            setBmbViewingWorkloadTech(techList[1] || firstDuty);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectBmbTicket = (t: any) => {
    setBmbSelectedTicket(t);
    setBmbCategory(t.finalCategory || t.aiSuggestedCategory || 'PLUMBING');
    setBmbPriority(t.finalPriority || t.aiSuggestedPriority || 'HIGH');
    setBmbNote(t.bmbAdminNote || '');
    if (t.assignedTechId) setBmbTechId(t.assignedTechId);
  };

  // Quét QR tự động điền thiết bị (Màn hình 02 Cư dân)
  const [qrModalVisible, setQrModalVisible] = useState(false);

  // Bộ dữ liệu thiết bị QR chuẩn của tòa nhà ResiFix (FR05, US-09)
  const RESIFIX_ASSET_CATALOG: Record<
    string,
    { qrCode: string; assetName: string; locationLabel: string }
  > = {
    'AC-B02': {
      qrCode: 'AC-B02',
      assetName: 'Máy lạnh sảnh B',
      locationLabel: 'Tầng 1 - Tòa S1',
    },
    'WP-1204': {
      qrCode: 'WP-1204',
      assetName: 'Đường ống nước bồn rửa',
      locationLabel: 'Căn hộ A-1204 - Tòa S1',
    },
    'HL-B12': {
      qrCode: 'HL-B12',
      assetName: 'Đèn hành lang khu B',
      locationLabel: 'Hành lang Tầng 12 - Tòa S1',
    },
    'ELV-02': {
      qrCode: 'ELV-02',
      assetName: 'Thang máy khách số 02',
      locationLabel: 'Sảnh Tầng 1 - Tòa S1',
    },
    'PK-B1-02': {
      qrCode: 'PK-B1-02',
      assetName: 'Đầu đọc thẻ từ hầm xe B1',
      locationLabel: 'Hầm gửi xe B1 - Tòa S1',
    },
  };

  // Hàm xử lý khi Camera quét được mã QR thiết bị (FR05, US-09)
  const handleQrCodeDetected = async (rawCode: string) => {
    const cleanCode = rawCode.trim().toUpperCase();
    try {
      setLoading(true);
      const res = await fetch(
        `${API_BASE_URL}/tickets/assets/qr/${encodeURIComponent(cleanCode)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'bypass-tunnel-reminder': 'true',
          },
        }
      );

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.asset) {
          setScannedAsset({
            qrCode: data.asset.qrCode,
            assetName: data.asset.assetName,
            locationLabel: data.asset.locationLabel,
          });
          showToast(`✅ Đã nhận diện từ mã QR: ${data.asset.assetName}`);
          return;
        }
      }

      // Nếu Backend chưa seed kịp hoặc đang đứt mạng, tra cứu ngay trong Catalog chuẩn:
      if (RESIFIX_ASSET_CATALOG[cleanCode]) {
        const fallbackAsset = RESIFIX_ASSET_CATALOG[cleanCode];
        setScannedAsset(fallbackAsset);
        showToast(`✅ Đã nhận diện từ mã QR: ${fallbackAsset.assetName}`);
      } else {
        showToast(`⚠️ Mã QR "${cleanCode}" không tồn tại trong danh mục thiết bị tòa nhà!`);
      }
    } catch {
      // Nếu lỗi mạng khi gọi API, vẫn tự động điền nếu mã QR hợp lệ
      if (RESIFIX_ASSET_CATALOG[cleanCode]) {
        const fallbackAsset = RESIFIX_ASSET_CATALOG[cleanCode];
        setScannedAsset(fallbackAsset);
        showToast(`✅ Đã nhận diện từ mã QR: ${fallbackAsset.assetName}`);
      } else {
        showToast(`❌ Không thể tra cứu mã "${cleanCode}". Kiểm tra lại kết nối Backend!`);
      }
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // CHỤP ẢNH CAMERA THẬT / CHỌN TỪ THƯ VIỆN & UPLOAD LÊN CLOUDINARY (US-08, US-33, US-43)
  // ============================================================================
  const uploadAssetToCloudinary = async (
    asset: ImagePicker.ImagePickerAsset,
    folderName: 'incident_scene' | 'repair_proof'
  ): Promise<string> => {
    if (!asset.base64) return asset.uri;
    try {
      const mimeType = asset.mimeType || 'image/jpeg';
      const base64DataUri = `data:${mimeType};base64,${asset.base64}`;

      const res = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          imageBase64: base64DataUri,
          folder: folderName,
        }),
      });

      const rawText = await res.text();
      const data = rawText ? JSON.parse(rawText) : null;
      if (res.ok && data?.success && data?.imageUrl) {
        return data.imageUrl;
      }
    } catch {
      // Nếu mất mạng tạm thời, dùng URI ảnh trên máy để hiển thị ngay
    }
    return asset.uri;
  };

  const launchCameraFlow = async (
    folderName: 'incident_scene' | 'repair_proof',
    onSuccessUrl: (url: string) => void
  ) => {
    const camPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (!camPerm.granted) {
      showToast('⚠️ Vui lòng cấp quyền Camera để chụp ảnh hiện trường!');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6, // Tối ưu dung lượng ảnh theo Risk R4
      base64: true,
    });
    if (!result.canceled && result.assets?.[0]) {
      setLoading(true);
      showToast('☁️ Đang tải ảnh lên Cloudinary...');
      const finalUrl = await uploadAssetToCloudinary(result.assets[0], folderName);
      setLoading(false);
      onSuccessUrl(finalUrl);
    }
  };

  const launchLibraryFlow = async (
    folderName: 'incident_scene' | 'repair_proof',
    onSuccessUrl: (url: string) => void
  ) => {
    const libPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!libPerm.granted) {
      showToast('⚠️ Vui lòng cấp quyền Thư viện ảnh để chọn ảnh!');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets?.[0]) {
      setLoading(true);
      showToast('☁️ Đang tải ảnh lên Cloudinary...');
      const finalUrl = await uploadAssetToCloudinary(result.assets[0], folderName);
      setLoading(false);
      onSuccessUrl(finalUrl);
    }
  };

  const handlePickOrCapturePhoto = (
    folderName: 'incident_scene' | 'repair_proof',
    onSuccessUrl: (url: string) => void
  ) => {
    // Trên trình duyệt Web: Mở thẳng hộp thoại chọn file ảnh từ máy tính
    if (Platform.OS === 'web') {
      launchLibraryFlow(folderName, onSuccessUrl);
      return;
    }

    // Trên Điện thoại Android: Hiển thị bảng chọn Chụp ảnh mới hoặc Chọn từ Thư viện
    Alert.alert(
      'Đính kèm hình ảnh',
      'Bạn muốn chụp ảnh trực tiếp bằng Camera hay chọn ảnh có sẵn từ Thư viện?',
      [
        {
          text: '📷 Chụp ảnh mới (Camera)',
          onPress: () => launchCameraFlow(folderName, onSuccessUrl),
        },
        {
          text: '🖼️ Chọn từ Thư viện ảnh',
          onPress: () => launchLibraryFlow(folderName, onSuccessUrl),
        },
        { text: 'Hủy', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  // Cư dân gửi báo cáo sự cố (Màn hình 02 - US-11, US-14, US-44)
  const handleSubmitReport = async () => {
    if (reportDesc.trim().length < 10) {
      showToast('Mô tả sự cố cần tối thiểu 10 ký tự!');
      return;
    }
    try {
      setLoading(true);
      const locationStr = scannedAsset
        ? `${scannedAsset.locationLabel} • Thiết bị: ${scannedAsset.qrCode}`
        : `Căn hộ ${user?.apartmentCode || 'A-1204'} • Tòa S1`;

      const res = await fetch(`${API_BASE_URL}/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          title: scannedAsset ? `Sự cố ${scannedAsset.assetName}` : undefined,
          description: reportDesc.trim(),
          locationNote: locationStr,
          qrCode: scannedAsset?.qrCode,
          isVoiceInput: isVoiceUsed,
          imageUrls: reportPhotos.map((p) => p.url),
        }),
      });

      // Đọc dưới dạng text trước để tránh lỗi "JSON Parse error: Unexpected end of input"
      const rawText = await res.text();
      let data: any = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }

      if (res.ok && data?.success) {
        showToast(`🎉 Đã gửi ${data.ticket.ticketCode} thành công!`);
        await fetchAllData();
        setResScreen('HOME');
      } else {
        showToast(
          data?.message ||
          `Lỗi máy chủ (${res.status}). Hãy kiểm tra cửa sổ Terminal của Backend!`
        );
      }
    } catch (err: any) {
      showToast('Không kết nối được Backend khi gửi báo cáo. Vui lòng thử lại!');
    } finally {
      setLoading(false);
    }
  };
  // Cư dân xác nhận Đã giải quyết & Đánh giá sao (Màn hình 03)
  const handleConfirmResolved = async (ticketToClose: any) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketToClose.id}/close`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ratingStars,
          ratingComment:
            ratingComment.trim() || 'Kỹ thuật viên xử lý rất nhanh và sạch sẽ!',
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Đã đóng sự cố ${ticketToClose.ticketCode} (${ratingStars} sao)!`);
        await fetchAllData();
        setResScreen('HOME');
      }
    } finally {
      setLoading(false);
    }
  };

  // Kỹ thuật viên bật/tắt Ca trực On-duty
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
        showToast(data.message);
      }
    } catch {
      showToast('Không thể đổi trạng thái ca trực');
    }
  };

  // Kỹ thuật viên bấm "Nhận việc ngay"
  const handleTechAcknowledge = async (ticketObj: any) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketObj.id}/acknowledge`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        showToast(`🛠️ Đã nhận việc ${ticketObj.ticketCode}!`);
        await fetchAllData();
        setActiveTicket(data.ticket || { ...ticketObj, status: 'IN_PROGRESS' });
        setTechScreen('TASK_DETAIL');
      }
    } finally {
      setLoading(false);
    }
  };

  // Kỹ thuật viên bấm "Hoàn thành & Gửi ảnh nghiệm thu"
  const handleTechCompleteSubmit = async (ticketObj: any) => {
    try {
      setLoading(true);
      if (ticketObj.status === 'ASSIGNED') {
        await fetch(`${API_BASE_URL}/tickets/${ticketObj.id}/acknowledge`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      const uploadRes = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          imageBase64:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          folder: 'repair_proof',
        }),
      });
      const uploadData = await uploadRes.json();
      const finalProofUrls = uploadData.imageUrl
        ? [uploadData.imageUrl, ...techProofPhotos.slice(1)]
        : techProofPhotos;

      const res = await fetch(`${API_BASE_URL}/tickets/${ticketObj.id}/complete`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          proofImageUrls: finalProofUrls,
          techRepairNote:
            techRepairNote.trim() ||
            'Đã thay mới đoạn ống dẫn nước dưới bồn rửa và kiểm tra không còn rò rỉ.',
          isQrVerifiedByTech: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`📸 Đã hoàn thành & gửi ảnh nghiệm thu ${ticketObj.ticketCode}!`);
        await fetchAllData();
        setTechScreen('HOME');
      }
    } finally {
      setLoading(false);
    }
  };

  // BMB duyệt gợi ý AI & Phân công Kỹ thuật viên (Màn hình 01 & 02 BMB)
  const handleBmbDispatch = async (customTicketId?: string, customTechId?: string) => {
    const targetTicketId = customTicketId || bmbSelectedTicket?.id;
    const targetTechId = customTechId || bmbTechId;
    if (!targetTicketId || !targetTechId) {
      showToast('Vui lòng chọn sự cố và Kỹ thuật viên đang trực!');
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tickets/${targetTicketId}/approve-assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          finalCategory: bmbCategory,
          finalPriority: bmbPriority,
          assignedTechId: targetTechId,
          bmbAdminNote: bmbNote || 'Kiểm tra kỹ và chụp ảnh nghiệm thu.',
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Đã duyệt & giao việc thành công! Đã gửi thông báo đẩy FCM.`);
        setBmbSelectedTicket(data.ticket);
        await fetchAllData();
      } else {
        showToast(data.message || 'Lỗi khi giao việc');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    await fetch(`${API_BASE_URL}/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    await fetchAllData();
    showToast('✓ Đã đánh dấu tất cả thông báo là đã đọc!');
  };

  // ============================================================================
  // MÀN HÌNH 00: ĐĂNG NHẬP HỆ THỐNG (TỰ ĐỘNG HIỂN THỊ BMB SPLIT-CARD HOẶC MOBILE LOGIN)
  // ============================================================================
  if (!token || !user) {
    // A. Giao diện Đăng nhập Ban Quản Lý BMB Web (Split-Card 2 cột chuẩn Figma 00 BMB)
    if (loginMode === 'BMB_WEB') {
      return (
        <SafeAreaView style={styles.bmbLoginOuterBg}>
          <View style={styles.bmbLoginSplitCard}>
            {/* Cột trái màu xanh dương đậm */}
            <View style={styles.bmbLoginLeftBlue}>
              <View style={styles.rowCenter}>
                <View style={{ marginRight: 9 }}><ResiFixLogoMark size={27} /></View>
                <Text style={styles.bmbLoginBrandText}>ResiFix BMB</Text>
              </View>
              <Text style={styles.bmbLoginHeroTitle}>
                Hệ thống Quản lý & Điều phối Sự cố Tòa nhà Thông minh
              </Text>
            </View>

            {/* Cột phải màu trắng */}
            <View style={styles.bmbLoginRightWhite}>
              <Text style={styles.bmbLoginFormHeading}>Đăng nhập</Text>

              {toastMsg && (
                <View style={[styles.toastBanner, { marginHorizontal: 0, marginBottom: 12 }]}>
                  <Text style={styles.toastText}>{toastMsg}</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>Email hoặc Số điện thoại công vụ *</Text>
              <TextInput
                style={styles.bmbWebInput}
                value={phoneInput}
                onChangeText={setPhoneInput}
                placeholder="myhanh.bmb@resifix.vn"
                placeholderTextColor="#94A3B8"
              />

              <Text style={styles.fieldLabel}>Mật khẩu *</Text>
              <TextInput
                style={styles.bmbWebInput}
                value={passwordInput}
                onChangeText={setPasswordInput}
                secureTextEntry
                placeholder="••••••••••"
                placeholderTextColor="#94A3B8"
              />

              <TouchableOpacity
                style={[styles.checkboxRow, { marginTop: 14, marginBottom: 22 }]}
                onPress={() => setRememberMe(!rememberMe)}
              >
                <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                  {rememberMe && <Text style={styles.checkMark}>✓</Text>}
                </View>
                <Text style={styles.rememberText}>Duy trì đăng nhập trên trình duyệt này</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.bmbWebLoginBtn}
                onPress={() => handleLogin()}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.bmbWebLoginBtnText}>Đăng nhập Hệ thống BMB</Text>
                )}
              </TouchableOpacity>

              {/* Thanh chuyển nhanh sang giao diện Mobile App để tiện Demo trên cùng 1 máy */}
              {SHOW_DEMO_SHORTCUTS && <View style={[styles.demoSwitchRow, { marginTop: 22 }]}>
                <TouchableOpacity
                  style={styles.demoChip}
                  onPress={() => {
                    setLoginMode('MOBILE');
                    setPhoneInput('0905123456');
                  }}
                >
                  <Text style={styles.demoChipText}>📱 Xem màn hình Login Mobile (Cư dân/KTV)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.demoChip}
                  onPress={() => {
                    setPhoneInput('myhanh.bmb@resifix.vn');
                    handleLogin('myhanh.bmb@resifix.vn', '123456');
                  }}
                >
                  <Text style={styles.demoChipText}>⚡ Vào nhanh BMB Dashboard</Text>
                </TouchableOpacity>
              </View>}
            </View>
          </View>
        </SafeAreaView>
      );
    }

    // B. Giao diện Đăng nhập Mobile App (Cư dân & Kỹ thuật viên chuẩn Figma 00 Mobile)
    return (
      <SafeAreaView style={styles.screenBg}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
        <ScrollView contentContainerStyle={styles.loginScroll}>
          <View style={styles.mobileFrame}>
            <View style={styles.brandCenter}>
              <ResiFixLogoMark size={68} />
              <Text style={styles.brandTitle}>ResiFix</Text>
              <Text style={styles.brandSub}>
                Hệ thống Quản lý & Khắc phục Sự cố Tòa nhà
              </Text>
              <View style={styles.geminiBadgePill}>
                <Text style={styles.geminiBadgeText}>✨ Tích hợp Trợ lý Gemini AI</Text>
              </View>
            </View>

            {toastMsg && (
              <View style={styles.toastBanner}>
                <Text style={styles.toastText}>{toastMsg}</Text>
              </View>
            )}

            <View style={styles.loginCard}>
              <Text style={styles.loginCardTitle}>Đăng nhập tài khoản</Text>
              <Text style={styles.loginCardSub}>
                Sử dụng số điện thoại đã đăng ký với Ban quản lý tòa nhà
              </Text>

              <Text style={styles.fieldLabel}>Số điện thoại *</Text>
              <View style={styles.inputWrapper}>
                <Text style={styles.inputPrefixIcon}>📞</Text>
                <TextInput
                  style={styles.textInputField}
                  value={phoneInput}
                  onChangeText={setPhoneInput}
                  placeholder="0905 xxx xxx"
                  placeholderTextColor="#94A3B8"
                />
              </View>

              <Text style={styles.fieldLabel}>Mật khẩu *</Text>
              <View style={styles.inputWrapper}>
                <Text style={styles.inputPrefixIcon}>🔒</Text>
                <TextInput
                  style={styles.textInputField}
                  value={passwordInput}
                  onChangeText={setPasswordInput}
                  secureTextEntry={!showPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#94A3B8"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.rememberRow}>
                <TouchableOpacity
                  style={styles.checkboxRow}
                  onPress={() => setRememberMe(!rememberMe)}
                >
                  <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                    {rememberMe && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                  <Text style={styles.rememberText}>Ghi nhớ đăng nhập</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    showToast('Vui lòng liên hệ Ban quản lý Tòa S1 để cấp lại mật khẩu!')
                  }
                >
                  <Text style={styles.forgotText}>Quên mật khẩu?</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.loginSubmitBtn}
                onPress={() => handleLogin()}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.loginSubmitText}>Đăng nhập</Text>
                )}
              </TouchableOpacity>
            </View>

            {SHOW_DEMO_SHORTCUTS && <View style={styles.demoSwitchRow}>
              <TouchableOpacity
                style={styles.demoChip}
                onPress={() => {
                  setPhoneInput('0905123456');
                  handleLogin('0905123456', '123456');
                }}
              >
                <Text style={styles.demoChipText}>🏠 Cư dân A-1204</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.demoChip}
                onPress={() => {
                  setPhoneInput('0356166863');
                  handleLogin('0356166863', '123456');
                }}
              >
                <Text style={styles.demoChipText}>👷 KTV Nam</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.demoChip}
                onPress={() => {
                  setLoginMode('BMB_WEB');
                  setPhoneInput('myhanh.bmb@resifix.vn');
                }}
              >
                <Text style={styles.demoChipText}>💻 BMB Login</Text>
              </TouchableOpacity>
            </View>}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // PHÂN HỆ 1: CƯ DÂN (RESIDENT) — BÁM BỐ CỤC 6 MÀN HÌNH FIGMA CƯ DÂN
  // ============================================================================
  if (user.role === 'RESIDENT') {
    const pendingCount = tickets.filter((t) => t.status === 'PENDING').length;
    const inProgressCount = tickets.filter(
      (t) => t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS'
    ).length;
    const completedCount = tickets.filter((t) => t.status === 'COMPLETED').length;
    const closedTickets = tickets.filter((t) => t.status === 'CLOSED');

    const filteredHomeTickets = tickets.filter((t) => {
      if (homeFilter === 'PENDING') return t.status === 'PENDING';
      if (homeFilter === 'IN_PROGRESS')
        return t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS';
      if (homeFilter === 'COMPLETED') return t.status === 'COMPLETED';
      return true;
    });

    const filteredHistoryTickets = tickets.filter((t) => {
      const matchSearch =
        !searchQuery.trim() ||
        t.ticketCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.title?.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchSearch) return false;
      if (historyFilter === 'CLOSED') return t.status === 'CLOSED';
      return true;
    });

    return (
      <SafeAreaView style={styles.screenBg}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
        <View style={styles.mobileShell}>
          {toastMsg && (
            <View style={styles.toastBanner}>
              <Text style={styles.toastText}>{toastMsg}</Text>
            </View>
          )}

          {resScreen === 'HOME' && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={{ paddingBottom: 28 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.resHomeHeader}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.aptSmallLabel}>Thông tin căn hộ</Text>
                  <Text style={styles.aptBigTitle}>
                    Căn hộ {user.apartmentCode || 'A-1204'} • {user.buildingBlock || 'Tòa S1'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.bellCircleBtn}
                  onPress={() => setResScreen('NOTI_PROFILE')}
                >
                  <OutlineIcon name="bell" size={21} color="#0F172A" />
                  {unreadCount > 0 && <View style={styles.bellRedDot} />}
                </TouchableOpacity>
              </View>

              <View style={styles.ctaHeroCard}>
                <View style={styles.ctaTitleRow}>
                  <Text style={styles.qrFrameIcon}>⛶</Text>
                  <Text style={styles.ctaHeroTitle}>Phát hiện sự cố tòa nhà?</Text>
                </View>
                <Text style={styles.ctaHeroDesc}>
                  Quét mã QR thiết bị, chụp ảnh hoặc đọc bằng giọng nói. Trợ lý AI sẽ tự động
                  phân loại giúp bạn!
                </Text>
                <TouchableOpacity
                  style={styles.ctaPrimaryBtn}
                  onPress={() => setResScreen('CREATE_REPORT')}
                >
                  <Text style={styles.ctaPrimaryBtnText}>📷 + Báo cáo sự cố ngay</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitleText}>Sự cố của tôi</Text>
                <TouchableOpacity onPress={() => setResScreen('HISTORY')}>
                  <Text style={styles.seeHistoryLink}>Xem lịch sử &gt;</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.pillsScroll}
              >
                <TouchableOpacity
                  style={[styles.filterPill, homeFilter === 'ALL' && styles.filterPillActive]}
                  onPress={() => setHomeFilter('ALL')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      homeFilter === 'ALL' && styles.filterPillTextActive,
                    ]}
                  >
                    Tất cả ({tickets.length})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    homeFilter === 'PENDING' && styles.filterPillActive,
                  ]}
                  onPress={() => setHomeFilter('PENDING')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      homeFilter === 'PENDING' && styles.filterPillTextActive,
                    ]}
                  >
                    Chờ duyệt ({pendingCount})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    homeFilter === 'IN_PROGRESS' && styles.filterPillActive,
                  ]}
                  onPress={() => setHomeFilter('IN_PROGRESS')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      homeFilter === 'IN_PROGRESS' && styles.filterPillTextActive,
                    ]}
                  >
                    Đang sửa ({inProgressCount})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    homeFilter === 'COMPLETED' && styles.filterPillActive,
                  ]}
                  onPress={() => setHomeFilter('COMPLETED')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      homeFilter === 'COMPLETED' && styles.filterPillTextActive,
                    ]}
                  >
                    Hoàn thành ({completedCount})
                  </Text>
                </TouchableOpacity>
              </ScrollView>

              {filteredHomeTickets.map((t) => {
                const isCompleted = t.status === 'COMPLETED';
                const isPending = t.status === 'PENDING';
                const isClosed = t.status === 'CLOSED';
                return (
                  <TouchableOpacity
                    key={t.id}
                    activeOpacity={0.9}
                    style={[
                      styles.resTicketCard,
                      isCompleted && styles.resTicketCardCompleted,
                    ]}
                    onPress={() => {
                      setActiveTicket(t);
                      setResScreen('TICKET_DETAIL');
                    }}
                  >
                    <View style={styles.cardTopRow}>
                      <Text style={styles.cardCodeText}>{t.ticketCode}</Text>
                      <View
                        style={[
                          styles.statusPill,
                          isCompleted
                            ? { backgroundColor: '#D1FAE5' }
                            : isPending
                              ? { backgroundColor: '#FEF3C7' }
                              : isClosed
                                ? { backgroundColor: '#F1F5F9' }
                                : { backgroundColor: '#E0E7FF' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusPillText,
                            isCompleted
                              ? { color: '#059669' }
                              : isPending
                                ? { color: '#D97706' }
                                : isClosed
                                  ? { color: '#64748B' }
                                  : { color: '#4F46E5' },
                          ]}
                        >
                          {isCompleted
                            ? 'Hoàn thành'
                            : isPending
                              ? 'Chờ duyệt'
                              : isClosed
                                ? 'Đã đóng'
                                : 'Đang xử lý'}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.cardMainTitle}>{t.title}</Text>
                    <Text style={styles.cardLocationText}>📍 {t.locationNote}</Text>

                    {isCompleted ? (
                      <View style={styles.completedActionBar}>
                        <Text style={styles.completedActionLabel}>
                          📸 KTV đã gửi ảnh nghiệm thu
                        </Text>
                        <TouchableOpacity
                          style={styles.resolvedGreenBtn}
                          onPress={() => {
                            setActiveTicket(t);
                            setResScreen('TICKET_DETAIL');
                          }}
                        >
                          <Text style={styles.resolvedGreenBtnText}>Đã giải quyết</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.cardFooterGrayBar}>
                        <Text style={styles.cardFooterGrayText}>
                          🛠️ KTV: {t.assignedTech?.fullName || 'Đặng Văn Nam'} • ⏱️ 15 phút trước
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {resScreen === 'CREATE_REPORT' && (
            <View style={{ flex: 1 }}>
              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={{ paddingBottom: 28 }}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.subScreenHeader}>
                  <TouchableOpacity onPress={() => setResScreen('HOME')}>
                    <Text style={styles.backArrowText}>←</Text>
                  </TouchableOpacity>
                  <Text style={styles.subScreenTitle}>Tạo báo cáo sự cố</Text>
                </View>

                <Text style={styles.stepTitle}>1. Vị trí & Thiết bị gặp sự cố *</Text>
                <TouchableOpacity
                  style={styles.qrDashedBtn}
                  onPress={() => setQrModalVisible(true)}
                >
                  <Text style={styles.qrDashedBtnText}>
                    📷 Quét mã QR thiết bị để tự động điền
                  </Text>
                </TouchableOpacity>

                <QrScannerModal
                  visible={qrModalVisible}
                  onClose={() => setQrModalVisible(false)}
                  onScannedCode={handleQrCodeDetected}
                />

                {scannedAsset && (
                  <View style={styles.qrRecognizedBox}>
                    <Text style={styles.qrRecognizedTitle}>
                      ✅ Đã nhận diện từ mã QR: {scannedAsset.assetName}
                    </Text>
                    <Text style={styles.qrRecognizedSub}>
                      Mã thiết bị: {scannedAsset.qrCode} • Vị trí: {scannedAsset.locationLabel}
                    </Text>
                  </View>
                )}

                <Text style={styles.stepTitle}>2. Hình ảnh hiện trường (Tối đa 3 ảnh)</Text>
                <View style={styles.photoGridRow}>
                  {reportPhotos.map((item, idx) => (
                    <View key={idx} style={styles.photoSlotCard}>
                      <TouchableOpacity
                        style={styles.removePhotoCircle}
                        onPress={() =>
                          setReportPhotos(reportPhotos.filter((_, i) => i !== idx))
                        }
                      >
                        <Text style={styles.removePhotoX}>✕</Text>
                      </TouchableOpacity>
                      <Image source={{ uri: item.url }} style={styles.slotPreviewImg} />
                      <Text style={styles.photoSlotCaption} numberOfLines={2}>
                        {item.label}
                      </Text>
                    </View>
                  ))}

                  {reportPhotos.length < 3 && (
                    <TouchableOpacity
                      style={styles.addPhotoDashedSlot}
                      onPress={() =>
                        handlePickOrCapturePhoto('incident_scene', (uploadedUrl) => {
                          setReportPhotos((prev) => [
                            ...prev,
                            {
                              label: scannedAsset
                                ? `${scannedAsset.assetName} (${prev.length + 1})`
                                : `Ảnh hiện trường ${prev.length + 1}`,
                              url: uploadedUrl,
                            },
                          ]);
                          showToast('📸 Đã đính kèm ảnh hiện trường thành công!');
                        })
                      }
                    >
                      <Text style={styles.addPhotoPlus}>＋</Text>
                      <Text style={styles.addPhotoLabel}>
                        + Thêm ảnh ({reportPhotos.length}/3)
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={styles.stepTitle}>3. Mô tả sự cố *</Text>
                <View style={styles.descBoxContainer}>
                  <TextInput
                    style={styles.descTextArea}
                    multiline
                    value={reportDesc}
                    onChangeText={setReportDesc}
                    placeholder="Nhập mô tả sự cố bằng tiếng Việt..."
                  />
                  <View style={styles.descBottomBar}>
                    <Text
                      style={[
                        styles.charCountText,
                        reportDesc.trim().length < 10 && { color: '#DC2626' },
                      ]}
                    >
                      {reportDesc.length} ký tự (Đạt chuẩn tối thiểu 10 ký tự)
                    </Text>
                    <TouchableOpacity
                      style={styles.voicePillBtn}
                      onPress={() => {
                        setIsVoiceUsed(true);
                        setReportDesc(
                          'Máy lạnh ở sảnh B tầng 1 bị chảy nước nhiều xuống sàn gây trơn trượt, có tiếng kêu to.'
                        );
                        showToast('🎤 Đã nhận diện giọng nói tiếng Việt!');
                      }}
                    >
                      <Text style={styles.voicePillText}>🎤 Nhấn để nói</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.geminiInfoBox}>
                  <Text style={styles.geminiInfoText}>
                    ✨ Bạn không cần chọn danh mục. Gemini AI sẽ tự động phân loại & đánh giá
                    độ khẩn cấp giúp Ban quản lý!
                  </Text>
                </View>
              </ScrollView>

              <View style={styles.stickyBottomBar}>
                <TouchableOpacity
                  style={styles.loginSubmitBtn}
                  onPress={handleSubmitReport}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.loginSubmitText}>Gửi báo cáo sự cố</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {resScreen === 'TICKET_DETAIL' && activeTicket && (
            <View style={{ flex: 1 }}>
              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={{ paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.subScreenHeaderBetween}>
                  <View style={styles.rowCenterFlex}>
                    <TouchableOpacity onPress={() => setResScreen('HOME')}>
                      <Text style={styles.backArrowText}>←</Text>
                    </TouchableOpacity>
                    <Text style={styles.subScreenTitle} numberOfLines={1}>
                      Chi tiết {activeTicket.ticketCode}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: '#D1FAE5' }]}>
                    <Text style={[styles.statusPillText, { color: '#059669' }]}>
                      {activeTicket.status === 'COMPLETED'
                        ? 'Hoàn thành'
                        : activeTicket.status === 'CLOSED'
                          ? 'Đã đóng'
                          : 'Đang xử lý'}
                    </Text>
                  </View>
                </View>

                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>Tiến độ xử lý sự cố</Text>
                  <View style={styles.timelineRow}>
                    <View style={[styles.timelineDot, { backgroundColor: '#16A34A' }]} />
                    <Text style={[styles.timelineText, { color: '#15803D', fontWeight: '700' }]}>
                      10:30 - Hoàn thành sửa chữa (KTV{' '}
                      {activeTicket.assignedTech?.fullName || 'Đặng Văn Nam'} đã gửi ảnh)
                    </Text>
                  </View>
                  <View style={styles.timelineLine} />
                  <View style={styles.timelineRow}>
                    <View style={[styles.timelineDot, { backgroundColor: '#2563EB' }]} />
                    <Text style={styles.timelineText}>
                      09:45 - Đang xử lý (KTV đã nhận việc)
                    </Text>
                  </View>
                  <View style={styles.timelineLine} />
                  <View style={styles.timelineRow}>
                    <View style={[styles.timelineDot, { backgroundColor: '#2563EB' }]} />
                    <Text style={styles.timelineText}>
                      09:32 - Đã phân công (BMB đã duyệt gợi ý AI)
                    </Text>
                  </View>
                  <View style={styles.timelineLine} />
                  <View style={styles.timelineRow}>
                    <View style={[styles.timelineDot, { backgroundColor: '#CBD5E1' }]} />
                    <Text style={styles.timelineText}>
                      09:30 - Đã tiếp nhận (Chờ duyệt - AI gợi ý:{' '}
                      {CATEGORY_SHORT_VN[activeTicket.aiSuggestedCategory] || 'Điện - Nước'})
                    </Text>
                  </View>
                </View>

                <View style={styles.proofGreenBorderCard}>
                  <Text style={styles.cardBlockTitle}>
                    📸 Bằng chứng khắc phục từ Kỹ thuật viên
                  </Text>
                  <View style={styles.proofCompareRow}>
                    <View style={styles.proofHalfCol}>
                      <View style={styles.proofBoxBefore}>
                        <Text style={{ fontSize: 26 }}>🖼️</Text>
                        <Text style={styles.proofPlaceholderText}>Đường ống rò rỉ</Text>
                      </View>
                      <Text style={styles.proofLabelBefore}>Ảnh trước khi sửa</Text>
                    </View>
                    <View style={styles.proofHalfCol}>
                      <View style={styles.proofBoxAfter}>
                        <View style={styles.greenCheckCircle}>
                          <Text style={{ color: '#059669', fontWeight: '800', fontSize: 18 }}>
                            ✓
                          </Text>
                        </View>
                        <Text style={styles.proofAfterSmallText}>Đường ống đã thay mới</Text>
                      </View>
                      <Text style={styles.proofLabelAfter}>✅ Ảnh sau khi sửa</Text>
                    </View>
                  </View>
                  <View style={styles.techNoteGrayBox}>
                    <Text style={styles.techNoteGrayText}>
                      Ghi chú KTV:{' '}
                      {activeTicket.techRepairNote ||
                        'Đã thay mới đoạn ống dẫn nước dưới bồn rửa và kiểm tra không còn rò rỉ.'}
                    </Text>
                  </View>
                </View>

                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>
                    Đánh giá chất lượng xử lý (Tùy chọn)
                  </Text>
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <TouchableOpacity key={star} onPress={() => setRatingStars(star)}>
                        <Text style={styles.starIcon}>
                          {star <= ratingStars ? '⭐' : '☆'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    style={styles.ratingInputBox}
                    placeholder="Nhập nhận xét của bạn về kỹ thuật viên..."
                    placeholderTextColor="#94A3B8"
                    value={ratingComment}
                    onChangeText={setRatingComment}
                  />
                </View>
              </ScrollView>

              {activeTicket.status !== 'CLOSED' && (
                <View style={styles.stickyBottomBar}>
                  <TouchableOpacity
                    style={styles.confirmCloseGreenBtn}
                    onPress={() => handleConfirmResolved(activeTicket)}
                    disabled={loading}
                  >
                    <Text style={styles.confirmCloseGreenText}>
                      ✅ Xác nhận Đã giải quyết (Đóng sự cố)
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {resScreen === 'NOTI_PROFILE' && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={{ paddingBottom: 28 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.subScreenHeader}>
                <TouchableOpacity onPress={() => setResScreen('HOME')}>
                  <Text style={styles.backArrowText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.subScreenTitle}>Thông báo & Hồ sơ</Text>
              </View>

              <View style={styles.whiteSectionCard}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.sectionTitleText}>Thông báo</Text>
                  <View style={styles.unreadPillBadge}>
                    <Text style={styles.unreadPillText}>{unreadCount} chưa đọc</Text>
                  </View>
                </View>
                {(notifications.length > 0
                  ? notifications.slice(0, 4)
                  : [
                    {
                      id: '1',
                      title:
                        '🛠️ Sự cố #RF-2026-014 đã hoàn thành. Vui lòng kiểm tra ảnh và xác nhận nghiệm thu!',
                      time: '5 phút trước',
                    },
                    {
                      id: '2',
                      title:
                        '👷 BMB đã phân công KTV Đặng Văn Nam xử lý sự cố #RF-2026-019.',
                      time: '15 phút trước',
                    },
                  ]
                ).map((n: any, idx: number) => (
                  <View key={n.id || idx} style={styles.notiBlueItem}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.notiItemTitle}>{n.title || n.message}</Text>
                      <Text style={styles.notiItemTime}>{n.time || '5 phút trước'}</Text>
                    </View>
                    <View style={styles.blueUnreadDot} />
                  </View>
                ))}
              </View>

              <View style={styles.whiteSectionCard}>
                <Text style={styles.cardBlockTitle}>Hồ sơ cư dân</Text>
                <View style={styles.profileAvatarWrapper}>
                  <View style={styles.profileAvatarCircle}>
                    <Text style={{ fontSize: 32, color: '#2563EB' }}>👤</Text>
                  </View>
                  <Text style={styles.profileNameText}>{user.fullName}</Text>
                </View>
                <View style={styles.profileInfoRow}>
                  <View style={styles.profileInfoIconBox}>
                    <Text style={{ fontSize: 16 }}>🏢</Text>
                  </View>
                  <Text style={styles.profileInfoValue}>
                    {user.apartmentCode || 'A-1204'} • {user.buildingBlock || 'Tòa S1'}
                  </Text>
                </View>
                <View style={styles.profileInfoRow}>
                  <View style={styles.profileInfoIconBox}>
                    <Text style={{ fontSize: 16 }}>📞</Text>
                  </View>
                  <Text style={styles.profileInfoValue}>{user.phone}</Text>
                </View>
                <TouchableOpacity
                  style={styles.logoutRedOutlineBtn}
                  onPress={() => {
                    setToken(null);
                    setUser(null);
                  }}
                >
                  <Text style={styles.logoutRedOutlineText}>↪ Đăng xuất tài khoản</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}

          {resScreen === 'HISTORY' && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={{ paddingBottom: 28 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.subScreenHeaderBetween}>
                <View style={styles.rowCenterFlex}>
                  <TouchableOpacity onPress={() => setResScreen('HOME')}>
                    <Text style={styles.backArrowText}>←</Text>
                  </TouchableOpacity>
                  <Text style={styles.subScreenTitle}>Lịch sử sự cố</Text>
                </View>
                <View style={styles.totalCountBadge}>
                  <Text style={styles.totalCountText}>Tổng: {tickets.length} sự cố</Text>
                </View>
              </View>

              <View style={styles.searchBarBox}>
                <Text style={{ marginRight: 8, color: '#64748B' }}>🔍</Text>
                <TextInput
                  style={styles.searchBarInput}
                  placeholder="Tìm mã Ticket (#RF-...) hoặc tên sự cố..."
                  placeholderTextColor="#94A3B8"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.pillsScroll}
              >
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    historyFilter === 'ALL' && styles.filterPillActive,
                  ]}
                  onPress={() => setHistoryFilter('ALL')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      historyFilter === 'ALL' && styles.filterPillTextActive,
                    ]}
                  >
                    Tất cả ({tickets.length})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    historyFilter === 'CLOSED' && styles.filterPillActive,
                  ]}
                  onPress={() => setHistoryFilter('CLOSED')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      historyFilter === 'CLOSED' && styles.filterPillTextActive,
                    ]}
                  >
                    Đã đóng ({closedTickets.length})
                  </Text>
                </TouchableOpacity>
              </ScrollView>

              {filteredHistoryTickets.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.resTicketCard}
                  onPress={() => {
                    setActiveTicket(t);
                    setResScreen('TICKET_DETAIL');
                  }}
                >
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardCodeText}>{t.ticketCode}</Text>
                    <View style={[styles.statusPill, { backgroundColor: '#F1F5F9' }]}>
                      <Text style={[styles.statusPillText, { color: '#64748B' }]}>
                        {t.status === 'CLOSED' ? 'Đã đóng' : t.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.cardMainTitle}>{t.title}</Text>
                  <Text style={styles.cardLocationText}>
                    📍 {t.locationNote} • Danh mục:{' '}
                    {CATEGORY_SHORT_VN[t.finalCategory || t.aiSuggestedCategory] || 'Điện - Nước'}
                  </Text>
                  <View style={styles.historyFooterBar}>
                    <View>
                      <Text style={styles.historyClosedDate}>✅ Đã đóng: 28/10/2026</Text>
                      <Text style={styles.historyTechName}>
                        (KTV: {t.assignedTech?.fullName || 'Đặng Văn Nam'})
                      </Text>
                    </View>
                    <View style={styles.rowCenter}>
                      <Text style={{ fontSize: 13 }}>⭐⭐⭐⭐⭐</Text>
                      <Text style={styles.historyRatingNum}>
                        {' '}
                        {(t.ratingStars || 5).toFixed(1)}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {(resScreen === 'HOME' ||
            resScreen === 'HISTORY' ||
            resScreen === 'NOTI_PROFILE') && (
              <View style={styles.figmaBottomNav}>
                <TouchableOpacity
                  style={styles.figmaNavTab}
                  onPress={() => setResScreen('HOME')}
                >
                  <OutlineIcon name="home" size={21} active={resScreen === 'HOME'} />
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      resScreen === 'HOME' && styles.figmaNavLabelActive,
                    ]}
                  >
                    Trang chủ
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.figmaNavTab}
                  onPress={() => setResScreen('HISTORY')}
                >
                  <OutlineIcon name="history" size={21} active={resScreen === 'HISTORY'} />
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      resScreen === 'HISTORY' && styles.figmaNavLabelActive,
                    ]}
                  >
                    Lịch sử
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.figmaNavTab}
                  onPress={() => setResScreen('NOTI_PROFILE')}
                >
                  <OutlineIcon name="profile" size={21} active={resScreen === 'NOTI_PROFILE'} />
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      resScreen === 'NOTI_PROFILE' && styles.figmaNavLabelActive,
                    ]}
                  >
                    Cá nhân
                  </Text>
                </TouchableOpacity>
              </View>
            )}
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // PHÂN HỆ 2: KỸ THUẬT VIÊN (TECHNICIAN) — BÁM BỐ CỤC 5 MÀN HÌNH FIGMA KTV
  // ============================================================================
  if (user.role === 'TECHNICIAN') {
    const assignedCount = tickets.filter((t) => t.status === 'ASSIGNED').length;
    const inProgressCount = tickets.filter((t) => t.status === 'IN_PROGRESS').length;
    const completedCount = tickets.filter(
      (t) => t.status === 'COMPLETED' || t.status === 'CLOSED'
    ).length;
    const closedCount = tickets.filter((t) => t.status === 'CLOSED').length;
    const waitingResidentCount = tickets.filter((t) => t.status === 'COMPLETED').length;

    const filteredTechHome = tickets.filter((t) => {
      if (techHomeFilter === 'ASSIGNED') return t.status === 'ASSIGNED';
      if (techHomeFilter === 'IN_PROGRESS') return t.status === 'IN_PROGRESS';
      if (techHomeFilter === 'COMPLETED')
        return t.status === 'COMPLETED' || t.status === 'CLOSED';
      return true;
    });

    const filteredTechHistory = tickets.filter((t) => {
      const matchQ =
        !searchQuery.trim() ||
        t.ticketCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.locationNote?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.title?.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchQ) return false;
      if (techHistoryFilter === 'CLOSED') return t.status === 'CLOSED';
      if (techHistoryFilter === 'COMPLETED') return t.status === 'COMPLETED';
      return true;
    });

    return (
      <SafeAreaView style={styles.screenBg}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
        <View style={styles.mobileShell}>
          {toastMsg && (
            <View style={styles.toastBanner}>
              <Text style={styles.toastText}>{toastMsg}</Text>
            </View>
          )}

          {techScreen === 'HOME' && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={{ paddingBottom: 28 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.resHomeHeader}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.aptSmallLabel}>
                    {user.specialtyLabel || 'Kỹ thuật viên Điện - Nước'}
                  </Text>
                  <Text style={styles.aptBigTitle}>
                    {user.fullName} • Ca trực Sáng
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.bellCircleBtn}
                  onPress={() => setTechScreen('NOTI_PROFILE')}
                >
                  <OutlineIcon name="bell" size={21} color="#0F172A" />
                  <View style={styles.bellRedDot} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.techDutyCard}
                onPress={handleToggleOnDuty}
              >
                <Text style={styles.techDutyTitle}>
                  Trạng thái làm việc: {user.isOnDuty !== false ? '🟢' : '⚪'}{' '}
                  {user.isOnDuty !== false
                    ? 'Đang trong ca trực (On-duty)'
                    : 'Ngoài ca trực (Off-duty)'}
                </Text>
                <Text style={styles.techDutySub}>
                  Hôm nay bạn có {assignedCount + inProgressCount} sự cố cần xử lý và{' '}
                  {completedCount} sự cố đã hoàn thành.
                </Text>
              </TouchableOpacity>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitleText}>Công việc được giao</Text>
                <TouchableOpacity onPress={() => setTechScreen('HISTORY')}>
                  <Text style={styles.seeHistoryLink}>Xem lịch sử &gt;</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.pillsScroll}
              >
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    techHomeFilter === 'ALL' && styles.filterPillActive,
                  ]}
                  onPress={() => setTechHomeFilter('ALL')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      techHomeFilter === 'ALL' && styles.filterPillTextActive,
                    ]}
                  >
                    Tất cả ({tickets.length})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    techHomeFilter === 'ASSIGNED' && styles.filterPillActive,
                  ]}
                  onPress={() => setTechHomeFilter('ASSIGNED')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      techHomeFilter === 'ASSIGNED' && styles.filterPillTextActive,
                    ]}
                  >
                    Chờ xử lý ({assignedCount})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    techHomeFilter === 'IN_PROGRESS' && styles.filterPillActive,
                  ]}
                  onPress={() => setTechHomeFilter('IN_PROGRESS')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      techHomeFilter === 'IN_PROGRESS' && styles.filterPillTextActive,
                    ]}
                  >
                    Đang sửa ({inProgressCount})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    techHomeFilter === 'COMPLETED' && styles.filterPillActive,
                  ]}
                  onPress={() => setTechHomeFilter('COMPLETED')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      techHomeFilter === 'COMPLETED' && styles.filterPillTextActive,
                    ]}
                  >
                    Hoàn thành ({completedCount})
                  </Text>
                </TouchableOpacity>
              </ScrollView>

              {filteredTechHome.map((t) => {
                const isAssigned = t.status === 'ASSIGNED';
                const isInProgress = t.status === 'IN_PROGRESS';
                const prio = t.finalPriority || t.aiSuggestedPriority || 'HIGH';
                return (
                  <TouchableOpacity
                    key={t.id}
                    activeOpacity={0.9}
                    style={[
                      styles.resTicketCard,
                      isAssigned && { borderColor: '#3B82F6', borderWidth: 1.5 },
                      isInProgress && { borderColor: '#818CF8', borderWidth: 1.5 },
                    ]}
                    onPress={() => {
                      setActiveTicket(t);
                      setTechRepairNote(
                        t.techRepairNote ||
                        'Đã thay mới đoạn ống dẫn nước dưới bồn rửa và kiểm tra không còn rò rỉ.'
                      );
                      setTechScreen('TASK_DETAIL');
                    }}
                  >
                    <View style={styles.cardTopRow}>
                      <Text style={styles.cardCodeText}>{t.ticketCode}</Text>
                      <View
                        style={[
                          styles.statusPill,
                          isAssigned
                            ? { backgroundColor: '#DBEAFE' }
                            : isInProgress
                              ? { backgroundColor: '#E0E7FF' }
                              : { backgroundColor: '#D1FAE5' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusPillText,
                            isAssigned
                              ? { color: '#2563EB' }
                              : isInProgress
                                ? { color: '#4F46E5' }
                                : { color: '#059669' },
                          ]}
                        >
                          {isAssigned
                            ? 'Đã phân công'
                            : isInProgress
                              ? 'Đang xử lý'
                              : 'Hoàn thành'}
                        </Text>
                      </View>
                    </View>

                    {prio === 'HIGH' && (
                      <Text style={styles.urgentRedText}>
                        🔥 Ưu tiên: Cao (Khẩn cấp)
                      </Text>
                    )}

                    <Text style={styles.cardMainTitle}>{t.title}</Text>
                    <Text style={styles.cardLocationText}>📍 {t.locationNote}</Text>

                    {isAssigned ? (
                      <View style={styles.techAssignActionBar}>
                        <TouchableOpacity
                          style={styles.acceptJobBlueBtn}
                          onPress={() => handleTechAcknowledge(t)}
                        >
                          <Text style={styles.acceptJobBlueBtnText}>Nhận việc ngay</Text>
                        </TouchableOpacity>
                        <Text style={styles.assignedTimeMeta}>
                          Giao bởi BMB • 5 phút trước
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.techInProgressBar}>
                        <Text style={styles.techInProgressText}>
                          🛠️ Kỹ thuật viên: {user.fullName} • ⏱️ 15 phút trước
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {techScreen === 'TASK_DETAIL' && activeTicket && (
            <View style={{ flex: 1 }}>
              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={{ paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.subScreenHeader}>
                  <TouchableOpacity onPress={() => setTechScreen('HOME')}>
                    <Text style={styles.backArrowText}>←</Text>
                  </TouchableOpacity>
                  <Text style={styles.subScreenTitle} numberOfLines={1}>
                    Chi tiết sự cố {activeTicket.ticketCode}
                  </Text>
                </View>

                <View style={styles.techDetailTopCard}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardCodeText}>{activeTicket.ticketCode}</Text>
                    <View style={[styles.statusPill, { backgroundColor: '#E0E7FF' }]}>
                      <Text style={[styles.statusPillText, { color: '#4F46E5' }]}>
                        {activeTicket.status === 'IN_PROGRESS'
                          ? 'Đang xử lý'
                          : activeTicket.status === 'ASSIGNED'
                            ? 'Đã phân công'
                            : 'Hoàn thành'}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.cardMainTitle, { marginBottom: 0 }]}>
                    {activeTicket.title}
                  </Text>
                </View>

                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>Thông tin kỹ thuật</Text>
                  <Text style={styles.techInfoLine}>
                    📍 Vị trí: {activeTicket.locationNote || 'Căn hộ A-1204 (Tòa S1 - Tầng 12)'}
                  </Text>
                  <Text style={styles.techInfoLine}>
                    🔧 Mã thiết bị (QR):{' '}
                    {activeTicket.asset?.qrCode || 'WP-1204 - Đường ống bồn rửa'}
                  </Text>
                  <Text style={[styles.techInfoLine, { marginBottom: 0 }]}>
                    ⚠️ Độ ưu tiên (BMB duyệt): Cao • Danh mục:{' '}
                    {CATEGORY_SHORT_VN[
                      activeTicket.finalCategory || activeTicket.aiSuggestedCategory
                    ] || 'Điện - Nước'}
                  </Text>
                </View>

                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>Mô tả của cư dân</Text>
                  <Text style={styles.residentDescGray}>
                    {activeTicket.description}
                  </Text>
                  <View style={styles.photoGridRow}>
                    {[0, 1, 2].map((idx) => {
                      const mediaItem = activeTicket.media?.[idx];
                      return (
                        <View key={idx} style={styles.residentGrayThumb}>
                          {mediaItem?.imageUrl ? (
                            <Image
                              source={{ uri: mediaItem.imageUrl }}
                              style={{ width: '100%', height: '100%', borderRadius: 10 }}
                            />
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.proofGreenBorderCard}>
                  <Text style={styles.cardBlockTitle}>
                    📸 Ảnh nghiệm thu sau khi sửa (Bắt buộc ít nhất 1 ảnh) *
                  </Text>
                  <View style={styles.proofCompareRow}>
                    <View style={styles.techCapturedBox}>
                      {techProofPhotos[0] ? (
                        <Image
                          source={{ uri: techProofPhotos[0] }}
                          style={{ width: '100%', height: '100%', borderRadius: 10 }}
                        />
                      ) : null}
                    </View>
                    <TouchableOpacity
                      style={styles.techAddPhotoDashedBox}
                      onPress={() =>
                        handlePickOrCapturePhoto('repair_proof', (uploadedUrl) => {
                          setTechProofPhotos((prev) => [uploadedUrl, ...prev]);
                          showToast('📸 Đã tải lên ảnh nghiệm thu sau sửa chữa!');
                        })
                      }
                    >
                      <Text style={styles.techPlusIcon}>＋</Text>
                      <Text style={styles.techAddPhotoBlueText}>
                        + Chụp ảnh hoàn thành ({techProofPhotos.length})
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>Ghi chú kết quả xử lý</Text>
                  <TextInput
                    style={styles.ratingInputBox}
                    multiline
                    value={techRepairNote}
                    onChangeText={setTechRepairNote}
                    placeholder="Đã thay mới đoạn ống dẫn nước dưới bồn rửa và kiểm tra không còn rò rỉ."
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              </ScrollView>

              {activeTicket.status !== 'COMPLETED' && activeTicket.status !== 'CLOSED' && (
                <View style={styles.stickyBottomBar}>
                  <TouchableOpacity
                    style={styles.confirmCloseGreenBtn}
                    onPress={() => handleTechCompleteSubmit(activeTicket)}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={styles.confirmCloseGreenText}>
                        Hoàn thành & Gửi ảnh nghiệm thu
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {techScreen === 'NOTI_PROFILE' && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={{ paddingBottom: 28 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.subScreenHeader}>
                <TouchableOpacity onPress={() => setTechScreen('HOME')}>
                  <Text style={styles.backArrowText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.subScreenTitle}>Thông báo & Hồ sơ KTV</Text>
              </View>

              <View style={styles.whiteSectionCard}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.sectionTitleText}>Thông báo công việc mới</Text>
                  <View style={styles.unreadPillBadge}>
                    <Text style={styles.unreadPillText}>{unreadCount} chưa đọc</Text>
                  </View>
                </View>

                <View style={styles.techNotiUrgentBox}>
                  <Text style={styles.techNotiUrgentTag}>
                    🔥 MỚI PHÂN CÔNG • 5 phút trước
                  </Text>
                  <Text style={styles.techNotiBodyText}>
                    Ban quản lý (Mỹ Hạnh) vừa giao cho bạn sự cố khẩn cấp #RF-2026-014: Rò
                    rỉ đường ống nước bồn rửa tại Căn hộ A-1204.
                  </Text>
                </View>

                <View style={styles.techNotiAcceptedBox}>
                  <Text style={styles.techNotiAcceptedTag}>
                    ✅ CƯ DÂN ĐÃ NGHIỆM THU • 1 giờ trước
                  </Text>
                  <Text style={styles.techNotiBodyText}>
                    Cư dân Căn hộ B-0802 đã xác nhận giải quyết và đánh giá 5 sao cho sự cố
                    #RF-2026-008.
                  </Text>
                </View>
              </View>

              <View style={styles.whiteSectionCard}>
                <Text style={styles.cardBlockTitle}>Hồ sơ Kỹ thuật viên</Text>
                <View style={styles.techProfileHeaderRow}>
                  <View style={styles.techAvatarCircle}>
                    <Text style={{ fontSize: 26, color: '#2563EB' }}>👷</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.profileNameText}>{user.fullName}</Text>
                    <View style={styles.specialtyPill}>
                      <Text style={styles.specialtyPillText}>
                        Chuyên môn: Điện - Nước (Plumbing)
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.techDivider} />

                <Text style={styles.techProfileLine}>
                  📞 Số điện thoại: {user.phone || '0356 166 863'}
                </Text>
                <Text style={styles.techProfileLine}>
                  🕒 Ca trực hiện tại: Ca Sáng (07:00 - 15:00) • 🟢 On-duty
                </Text>
                <Text style={styles.techProfileLine}>
                  📊 Hiệu suất tháng 10: Đã hoàn thành 24 sự cố (Đánh giá TB: 4.9 ⭐)
                </Text>

                <TouchableOpacity
                  style={styles.logoutRedOutlineBtn}
                  onPress={() => {
                    setToken(null);
                    setUser(null);
                  }}
                >
                  <Text style={styles.logoutRedOutlineText}>Đăng xuất tài khoản</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}

          {techScreen === 'HISTORY' && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={{ paddingBottom: 28 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.aptBigTitle, { marginTop: 4 }]}>
                Lịch sử công việc đã hoàn thành
              </Text>
              <View
                style={[styles.unreadPillBadge, { alignSelf: 'flex-start', marginVertical: 10 }]}
              >
                <Text style={styles.unreadPillText}>
                  Tháng 10: {tickets.length || 24} việc
                </Text>
              </View>

              <View style={styles.searchBarBox}>
                <Text style={{ marginRight: 8, color: '#64748B' }}>🔍</Text>
                <TextInput
                  style={styles.searchBarInput}
                  placeholder="Tìm mã Ticket (#RF-...) hoặc mã thiết bị (WP-...)..."
                  placeholderTextColor="#94A3B8"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              <View style={styles.chipWrapRow}>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    techHistoryFilter === 'ALL' && styles.filterPillActive,
                    { marginBottom: 8 },
                  ]}
                  onPress={() => setTechHistoryFilter('ALL')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      techHistoryFilter === 'ALL' && styles.filterPillTextActive,
                    ]}
                  >
                    Tất cả ({tickets.length})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    techHistoryFilter === 'CLOSED' && styles.filterPillActive,
                    { marginBottom: 8 },
                  ]}
                  onPress={() => setTechHistoryFilter('CLOSED')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      techHistoryFilter === 'CLOSED' && styles.filterPillTextActive,
                    ]}
                  >
                    Đã đóng ({closedCount})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    techHistoryFilter === 'COMPLETED' && styles.filterPillActive,
                    { marginBottom: 8 },
                  ]}
                  onPress={() => setTechHistoryFilter('COMPLETED')}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      techHistoryFilter === 'COMPLETED' && styles.filterPillTextActive,
                    ]}
                  >
                    Chờ cư dân nghiệm thu ({waitingResidentCount})
                  </Text>
                </TouchableOpacity>
              </View>

              {filteredTechHistory.map((t) => {
                const isWaitingAccept = t.status === 'COMPLETED';
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={styles.resTicketCard}
                    onPress={() => {
                      setActiveTicket(t);
                      setTechScreen('TASK_DETAIL');
                    }}
                  >
                    <View style={styles.cardTopRow}>
                      <Text style={styles.cardCodeText}>{t.ticketCode}</Text>
                      {!isWaitingAccept && (
                        <View style={[styles.statusPill, { backgroundColor: '#E2E8F0' }]}>
                          <Text style={[styles.statusPillText, { color: '#475569' }]}>
                            Đã đóng
                          </Text>
                        </View>
                      )}
                    </View>

                    {isWaitingAccept && (
                      <View style={styles.waitingResidentBanner}>
                        <Text style={styles.waitingResidentBannerText}>
                          Hoàn thành (Chờ cư dân xác nhận)
                        </Text>
                      </View>
                    )}

                    <Text style={styles.cardMainTitle}>{t.title}</Text>
                    <Text style={styles.cardLocationText}>📍 {t.locationNote}</Text>

                    {isWaitingAccept ? (
                      <View style={styles.sentPhotoBlueBar}>
                        <Text style={styles.sentPhotoBlueText}>
                          📸 Đã gửi 2 ảnh nghiệm thu lúc 08:40 hôm nay
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.closedResidentGreenBar}>
                        <Text style={styles.closedResidentGreenText}>
                          ✅ Cư dân đã xác nhận giải quyết • Đánh giá: ⭐⭐⭐⭐⭐ (
                          {(t.ratingStars || 5).toFixed(1)})
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {(techScreen === 'HOME' ||
            techScreen === 'HISTORY' ||
            techScreen === 'NOTI_PROFILE') && (
              <View style={styles.figmaBottomNav}>
                <TouchableOpacity
                  style={styles.figmaNavTab}
                  onPress={() => setTechScreen('HOME')}
                >
                  <OutlineIcon name="home" size={21} active={techScreen === 'HOME'} />
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      techScreen === 'HOME' && styles.figmaNavLabelActive,
                    ]}
                  >
                    Trang chủ
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.figmaNavTab}
                  onPress={() => setTechScreen('HISTORY')}
                >
                  <OutlineIcon name="history" size={21} active={techScreen === 'HISTORY'} />
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      techScreen === 'HISTORY' && styles.figmaNavLabelActive,
                    ]}
                  >
                    Lịch sử
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.figmaNavTab}
                  onPress={() => setTechScreen('NOTI_PROFILE')}
                >
                  <OutlineIcon name="profile" size={21} active={techScreen === 'NOTI_PROFILE'} />
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      techScreen === 'NOTI_PROFILE' && styles.figmaNavLabelActive,
                    ]}
                  >
                    Hồ sơ
                  </Text>
                </TouchableOpacity>
              </View>
            )}
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // PHÂN HỆ 3: BAN QUẢN LÝ TÒA NHÀ (BMB WEB APPLICATION) — BÁM BỐ CỤC 4 MÀN HÌNH FIGMA BMB
  // ============================================================================
  const bmbPendingCount = tickets.filter((t) => t.status === 'PENDING').length;
  const bmbAssignedCount = tickets.filter((t) => t.status === 'ASSIGNED').length;
  const bmbInProgressCount = tickets.filter((t) => t.status === 'IN_PROGRESS').length;
  const bmbCompletedCount = tickets.filter((t) => t.status === 'COMPLETED').length;
  const bmbClosedCount = tickets.filter((t) => t.status === 'CLOSED').length;

  const filteredBmbTickets = tickets.filter((t) => {
    const matchSearch =
      !searchQuery.trim() ||
      t.ticketCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.locationNote?.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchSearch) return false;
    if (bmbTicketFilter !== 'ALL') return t.status === bmbTicketFilter;
    return true;
  });

  const pendingTicketsForRadio = tickets.filter((t) => t.status === 'PENDING');

  return (
    <SafeAreaView style={styles.bmbWebRoot}>
      <View style={styles.bmbDesktopLayout}>
        {/* ==================================================================== */}
        {/* CỘT 1: SIDEBAR TRÁI CỐ ĐỊNH CHUẨN FIGMA BMB 01, 02, 03               */}
        {/* ==================================================================== */}
        <View style={styles.bmbSidebar}>
          <View>
            <View style={styles.bmbSidebarBrandRow}>
              <View style={{ marginRight: 9 }}><ResiFixLogoMark size={26} /></View>
              <Text style={styles.bmbSidebarLogoText}>ResiFix BMB</Text>
            </View>
            <Text style={styles.bmbSidebarSubText}>Hệ thống Quản lý Tòa nhà</Text>

            <Text style={styles.bmbWorkspaceHeading}>KHÔNG GIAN QUẢN LÝ</Text>

            <TouchableOpacity
              style={[
                styles.bmbMenuBtn,
                bmbNavTab === 'TICKETS' && styles.bmbMenuBtnActive,
              ]}
              onPress={() => setBmbNavTab('TICKETS')}
            >
              <Text
                style={[
                  styles.bmbMenuBtnText,
                  bmbNavTab === 'TICKETS' && styles.bmbMenuBtnTextActive,
                ]}
              >
                📋 Quản lý sự cố (Tickets)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.bmbMenuBtn,
                bmbNavTab === 'TECHNICIANS' && styles.bmbMenuBtnActive,
              ]}
              onPress={() => setBmbNavTab('TECHNICIANS')}
            >
              <Text
                style={[
                  styles.bmbMenuBtnText,
                  bmbNavTab === 'TECHNICIANS' && styles.bmbMenuBtnTextActive,
                ]}
              >
                👷 Kỹ thuật viên ca trực
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.bmbMenuBtn,
                bmbNavTab === 'NOTIFICATIONS' && styles.bmbMenuBtnActive,
              ]}
              onPress={() => setBmbNavTab('NOTIFICATIONS')}
            >
              <Text
                style={[
                  styles.bmbMenuBtnText,
                  bmbNavTab === 'NOTIFICATIONS' && styles.bmbMenuBtnTextActive,
                ]}
              >
                🔔 Thông báo hệ thống
              </Text>
              <View style={styles.bmbSidebarNewRedTag}>
                <Text style={styles.bmbSidebarNewRedText}>
                  {String(unreadCount).padStart(2, '0')} mới
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Footer Sidebar: Tòa nhà đang quản lý + BMB: Cầm Dương Mỹ Hạnh + Đăng xuất */}
          <View>
            <View style={styles.bmbBuildingStatusBox}>
              <Text style={styles.bmbBuildingSmallLabel}>TÒA NHÀ ĐANG QUẢN LÝ</Text>
              <Text style={styles.bmbBuildingName}>ResiFix Residence</Text>
              <Text style={styles.bmbBuildingOnline}>• Hệ thống đang hoạt động</Text>
            </View>

            <View style={styles.bmbAdminFooter}>
              <Text style={styles.bmbAdminNameText}>
                👤 BMB: {user.fullName || 'Cầm Dương Mỹ Hạnh'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setToken(null);
                  setUser(null);
                }}
              >
                <Text style={styles.bmbSidebarLogoutText}>↪ Đăng xuất</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ==================================================================== */}
        {/* MÀN HÌNH 01 BMB: QUẢN LÝ SỰ CỐ (DANH SÁCH GIỮA + CHI TIẾT AI PHẢI)   */}
        {/* ==================================================================== */}
        {bmbNavTab === 'TICKETS' && (
          <View style={styles.bmbContentTwoCols}>
            {/* CỘT GIỮA: DANH SÁCH SỰ CỐ TÒA NHÀ */}
            <ScrollView
              style={styles.bmbCenterColumn}
              showsVerticalScrollIndicator={false}
            >
              {toastMsg && (
                <View style={[styles.toastBanner, { marginHorizontal: 0 }]}>
                  <Text style={styles.toastText}>{toastMsg}</Text>
                </View>
              )}

              <View style={styles.cardTopRow}>
                <View>
                  <Text style={styles.bmbPageTitle}>Danh sách Sự cố Tòa nhà</Text>
                  <Text style={styles.bmbPageSubtitle}>
                    Theo dõi, phê duyệt và điều phối xử lý sự cố
                  </Text>
                </View>
                <Text style={styles.bmbDateLabel}>{new Date().toLocaleDateString('vi-VN')}</Text>
              </View>

              {/* 4 Thẻ KPI lớn chuẩn Figma 01 BMB */}
              <View style={styles.bmbKpiRow}>
                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>Chờ duyệt AI</Text>
                  <View style={styles.cardTopRow}>
                    <Text style={[styles.bmbKpiNumber, { color: '#EA580C' }]}>
                      {String(bmbPendingCount).padStart(2, '0')}
                    </Text>
                    <Text style={{ color: '#EA580C', fontSize: 16 }}>●</Text>
                  </View>
                </View>

                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>Đã phân công</Text>
                  <View style={styles.cardTopRow}>
                    <Text style={[styles.bmbKpiNumber, { color: '#2563EB' }]}>
                      {String(bmbAssignedCount).padStart(2, '0')}
                    </Text>
                    <Text style={{ color: '#2563EB', fontSize: 16 }}>●</Text>
                  </View>
                </View>

                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>Đang xử lý</Text>
                  <View style={styles.cardTopRow}>
                    <Text style={[styles.bmbKpiNumber, { color: '#4F46E5' }]}>
                      {String(bmbInProgressCount).padStart(2, '0')}
                    </Text>
                    <Text style={{ color: '#4F46E5', fontSize: 16 }}>●</Text>
                  </View>
                </View>

                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>Hoàn thành/Đóng</Text>
                  <View style={styles.cardTopRow}>
                    <Text style={[styles.bmbKpiNumber, { color: '#16A34A' }]}>
                      {bmbCompletedCount + bmbClosedCount}
                    </Text>
                    <Text style={{ color: '#16A34A', fontSize: 16 }}>●</Text>
                  </View>
                </View>
              </View>

              {/* Thanh tìm kiếm */}
              <View style={styles.searchBarBox}>
                <Text style={{ marginRight: 8, color: '#64748B' }}>🔍</Text>
                <TextInput
                  style={styles.searchBarInput}
                  placeholder="Tìm mã sự cố, căn hộ hoặc thiết bị..."
                  placeholderTextColor="#94A3B8"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              {/* Hàng 6 viên thuốc lọc trạng thái chuẩn Figma 01 BMB */}
              <View style={styles.chipWrapRow}>
                {[
                  { key: 'ALL', label: `Tất cả (${tickets.length})`, dot: '' },
                  {
                    key: 'PENDING',
                    label: `Chờ duyệt AI (0${bmbPendingCount})`,
                    dot: '🟠 ',
                  },
                  {
                    key: 'ASSIGNED',
                    label: `Đã phân công (0${bmbAssignedCount})`,
                    dot: '🔵 ',
                  },
                  {
                    key: 'IN_PROGRESS',
                    label: `Đang xử lý (0${bmbInProgressCount})`,
                    dot: '🟣 ',
                  },
                  {
                    key: 'COMPLETED',
                    label: `Hoàn thành (0${bmbCompletedCount})`,
                    dot: '🟢 ',
                  },
                  { key: 'CLOSED', label: `Đã đóng (${bmbClosedCount})`, dot: '⚫ ' },
                ].map((tab: any) => (
                  <TouchableOpacity
                    key={tab.key}
                    style={[
                      styles.bmbFilterChip,
                      bmbTicketFilter === tab.key && styles.bmbFilterChipActive,
                    ]}
                    onPress={() => setBmbTicketFilter(tab.key)}
                  >
                    <Text
                      style={[
                        styles.bmbFilterChipText,
                        bmbTicketFilter === tab.key && styles.bmbFilterChipTextActive,
                      ]}
                    >
                      {tab.dot}
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={[styles.cardTopRow, { marginVertical: 8 }]}>
                <Text style={{ fontWeight: '800', color: '#0F172A', fontSize: 13.5 }}>
                  Tất cả sự cố ({filteredBmbTickets.length})
                </Text>
                <Text style={{ color: '#64748B', fontSize: 12.5 }}>Mới nhất trước ↓</Text>
              </View>

              {/* Danh sách Thẻ Sự cố */}
              {filteredBmbTickets.map((t, index) => {
                const isSelected = bmbSelectedTicket?.id === t.id;
                const isPending = t.status === 'PENDING';
                const isAssigned = t.status === 'ASSIGNED';
                const isHigh =
                  (t.finalPriority || t.aiSuggestedPriority) === 'HIGH';
                const isFallbackWarning =
                  t.isAiFallbackManual || t.ticketCode === '#RF-2026-013' || index === 1;

                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[
                      styles.resTicketCard,
                      isSelected && { borderColor: '#2563EB', borderWidth: 2 },
                    ]}
                    onPress={() => handleSelectBmbTicket(t)}
                  >
                    <View style={styles.cardTopRow}>
                      <View style={styles.rowCenter}>
                        <Text
                          style={[
                            styles.cardCodeText,
                            isSelected && { color: '#2563EB', fontWeight: '800' },
                          ]}
                        >
                          {t.ticketCode}
                        </Text>
                        {isHigh && (
                          <Text style={styles.bmbUrgentInlineDot}> ● Khẩn cấp</Text>
                        )}
                      </View>
                      <View
                        style={[
                          styles.statusPill,
                          isPending
                            ? { backgroundColor: '#FEF3C7' }
                            : isAssigned
                              ? { backgroundColor: '#DBEAFE' }
                              : { backgroundColor: '#E0E7FF' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusPillText,
                            isPending
                              ? { color: '#D97706' }
                              : isAssigned
                                ? { color: '#2563EB' }
                                : { color: '#4F46E5' },
                          ]}
                        >
                          {isPending
                            ? 'Chờ duyệt'
                            : isAssigned
                              ? 'Đã phân công'
                              : t.status === 'IN_PROGRESS'
                                ? 'Đang xử lý'
                                : 'Đã đóng'}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.cardMainTitle}>{t.title}</Text>
                    <Text style={styles.cardLocationText}>📍 {t.locationNote}</Text>

                    <View style={[styles.cardTopRow, { marginTop: 10, marginBottom: 0 }]}>
                      {isFallbackWarning && isPending ? (
                        <View style={styles.bmbAiTimeoutTag}>
                          <Text style={styles.bmbAiTimeoutText}>
                            ⚠️ AI quá thời gian chờ - Vui lòng phân loại thủ công (US-19)
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.bmbAiPurpleMiniTag}>
                          <Text style={styles.bmbAiPurpleMiniText}>
                            ✨ Gemini gợi ý:{' '}
                            {CATEGORY_SHORT_VN[
                              t.finalCategory || t.aiSuggestedCategory
                            ] || 'Điện - Nước'}
                          </Text>
                        </View>
                      )}
                      <Text style={{ fontSize: 11.5, color: '#64748B' }}>
                        08:42 • Hôm nay
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* Thanh phân trang dưới đáy chuẩn Figma 01 BMB */}
              <View style={[styles.cardTopRow, { marginTop: 8, paddingBottom: 24 }]}>
                <Text style={{ fontSize: 12, color: '#64748B' }}>
                  Hiển thị {filteredBmbTickets.length} trong tổng số {tickets.length} sự cố
                </Text>
                <View style={styles.rowCenter}>
                  <View style={styles.pageNumActive}>
                    <Text style={{ color: '#2563EB', fontWeight: '800', fontSize: 12 }}>
                      1
                    </Text>
                  </View>
                  <Text style={styles.pageNumInactive}>2</Text>
                  <Text style={styles.pageNumInactive}>3</Text>
                  <Text style={styles.pageNumInactive}>&gt;</Text>
                </View>
              </View>
            </ScrollView>

            {/* CỘT PHẢI: CHI TIẾT SỰ CỐ & TRỢ LÝ QUYẾT ĐỊNH GEMINI FLASH AI */}
            <ScrollView
              style={styles.bmbRightInspector}
              showsVerticalScrollIndicator={false}
            >
              {bmbSelectedTicket && (
                <View>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.bmbInspectorTitle}>
                      Chi tiết sự cố {bmbSelectedTicket.ticketCode}
                    </Text>
                    <Text style={{ fontSize: 16, color: '#64748B' }}>✕</Text>
                  </View>

                  <View style={[styles.cardTopRow, { marginBottom: 14 }]}>
                    <View style={[styles.statusPill, { backgroundColor: '#FEF3C7' }]}>
                      <Text style={[styles.statusPillText, { color: '#D97706' }]}>
                        {bmbSelectedTicket.status === 'PENDING'
                          ? 'Chờ duyệt'
                          : bmbSelectedTicket.status}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 12, color: '#64748B' }}>
                      Tiếp nhận lúc 08:42 hôm nay
                    </Text>
                  </View>

                  <Text style={styles.bmbSmallSectionHead}>
                    THÔNG TIN CƯ DÂN PHẢN ÁNH
                  </Text>
                  <View style={[styles.cardTopRow, { marginTop: 6 }]}>
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#0F172A', flex: 1 }}>
                      📍 {bmbSelectedTicket.locationNote}
                    </Text>
                    <View style={styles.qrVerifiedPill}>
                      <Text style={styles.qrVerifiedPillText}>📷 Đã xác thực qua QR</Text>
                    </View>
                  </View>

                  <Text style={styles.bmbInspectorDesc}>
                    {bmbSelectedTicket.description}
                  </Text>

                  <View style={[styles.rowCenter, { marginVertical: 10 }]}>
                    <View style={styles.bmbAttachmentThumb}>
                      <Text style={{ fontSize: 18 }}>🖼️</Text>
                    </View>
                    <View style={styles.bmbAttachmentThumb}>
                      <Text style={{ fontSize: 18 }}>🖼️</Text>
                    </View>
                    <Text style={{ fontSize: 12, color: '#64748B', marginLeft: 6 }}>
                      2 ảnh đính kèm
                    </Text>
                  </View>

                  {/* HỘP VIỀN TÍM: PHÂN TÍCH & GỢI Ý TỪ GEMINI FLASH AI (TRỢ LÝ QUYẾT ĐỊNH) */}
                  <View style={styles.bmbGeminiPurpleCard}>
                    <View style={styles.cardTopRow}>
                      <Text style={styles.bmbGeminiCardTitle}>
                        ✨ Phân tích & Gợi ý từ Gemini Flash{'\n'}AI (Trợ lý quyết định)
                      </Text>
                      <View style={styles.bmbLatencyGreenPill}>
                        <Text style={styles.bmbLatencyGreenText}>
                          ⚡ 1.2s • JSON Hợp lệ
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.bmbAiSummaryBullet}>
                      • Tóm tắt AI: {bmbSelectedTicket.aiSummary || bmbSelectedTicket.title}
                    </Text>

                    <Text style={styles.fieldLabel}>Danh mục sự cố</Text>
                    <TouchableOpacity
                      style={styles.bmbDropdownBox}
                      onPress={() => {
                        const nextIdx =
                          (CATEGORIES_LIST.indexOf(bmbCategory) + 1) %
                          CATEGORIES_LIST.length;
                        setBmbCategory(CATEGORIES_LIST[nextIdx]);
                      }}
                    >
                      <Text style={styles.bmbDropdownValue}>
                        🔧 {CATEGORY_VN[bmbCategory] || 'Hệ thống Điện - Nước'}
                      </Text>
                      <Text style={{ color: '#64748B' }}>⌄</Text>
                    </TouchableOpacity>

                    <Text style={styles.fieldLabel}>Mức độ ưu tiên</Text>
                    <TouchableOpacity
                      style={[
                        styles.bmbDropdownBox,
                        bmbPriority === 'HIGH' && {
                          borderColor: '#EF4444',
                          backgroundColor: '#FEF2F2',
                        },
                      ]}
                      onPress={() => {
                        const nextIdx =
                          (PRIORITIES_LIST.indexOf(bmbPriority) + 1) %
                          PRIORITIES_LIST.length;
                        setBmbPriority(PRIORITIES_LIST[nextIdx]);
                      }}
                    >
                      <Text
                        style={[
                          styles.bmbDropdownValue,
                          bmbPriority === 'HIGH' && { color: '#DC2626', fontWeight: '800' },
                        ]}
                      >
                        {PRIORITY_VN[bmbPriority]}
                      </Text>
                      <Text style={{ color: '#DC2626' }}>⌄</Text>
                    </TouchableOpacity>

                    <Text style={styles.bmbRiskR1Hint}>
                      💡 BMB có toàn quyền giữ nguyên hoặc chỉnh sửa gợi ý của AI trước khi
                      duyệt (Risk R1).
                    </Text>
                  </View>

                  {/* Phân công Kỹ thuật viên đang trực */}
                  <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                    👷 Phân công Kỹ thuật viên đang trực
                  </Text>
                  <TouchableOpacity
                    style={styles.bmbDropdownBox}
                    onPress={() => {
                      if (technicians.length > 0) {
                        const idx = technicians.findIndex((x) => x.id === bmbTechId);
                        const nextTech = technicians[(idx + 1) % technicians.length];
                        if (nextTech) setBmbTechId(nextTech.id);
                      }
                    }}
                  >
                    <Text style={styles.bmbDropdownValue}>
                      🟢{' '}
                      {technicians.find((x) => x.id === bmbTechId)?.fullName ||
                        'Đặng Văn Nam'}{' '}
                      (Ca sáng - Đang xử lý: 1)
                    </Text>
                    <Text style={{ color: '#64748B' }}>⌄</Text>
                  </TouchableOpacity>
                  <Text style={{ fontSize: 11.5, color: '#64748B', marginTop: 6 }}>
                    Ca trực 07:00–15:00 • Chuyên môn Điện - Nước
                  </Text>

                  <View style={styles.techDivider} />
                  <Text style={{ fontSize: 11.5, color: '#64748B', marginBottom: 10 }}>
                    Bạn có thể điều chỉnh gợi ý AI trước khi giao việc.
                  </Text>

                  <TouchableOpacity
                    style={styles.bmbWebLoginBtn}
                    onPress={() => handleBmbDispatch()}
                    disabled={loading}
                  >
                    <Text style={styles.bmbWebLoginBtnText}>
                      ✅ Xác nhận Phân loại & Giao việc ngay
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        )}

        {/* ==================================================================== */}
        {/* MÀN HÌNH 02 BMB: KỸ THUẬT VIÊN CA TRỰC & WORKLOAD (FIGMA 02 BMB)     */}
        {/* ==================================================================== */}
        {bmbNavTab === 'TECHNICIANS' && (
          <View style={styles.bmbContentTwoCols}>
            {/* CỘT GIỮA: DANH SÁCH KỸ THUẬT VIÊN & TẢI CÔNG VIỆC */}
            <ScrollView
              style={styles.bmbCenterColumn}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.bmbPageTitle}>
                Danh sách Kỹ thuật viên & Tải công việc (Workload)
              </Text>
              <Text style={styles.bmbPageSubtitle}>
                Chọn KTV để giao việc mới hoặc kiểm tra tiến độ các việc đang xử lý (FR06)
              </Text>

              <View style={[styles.chipWrapRow, { marginTop: 12 }]}>
                <View style={styles.bmbStatPill}>
                  <Text style={styles.bmbStatPillText}>🟢 Đang trực: 04 KTV</Text>
                </View>
                <View style={styles.bmbStatPill}>
                  <Text style={styles.bmbStatPillText}>🛠️ Đang xử lý: 05 việc</Text>
                </View>
                <View style={styles.bmbStatPill}>
                  <Text style={styles.bmbStatPillText}>✅ Sẵn sàng: 03 KTV</Text>
                </View>
              </View>

              {(technicians.length > 0
                ? technicians
                : [
                  {
                    id: 'tech-1',
                    fullName: 'Đặng Văn Nam',
                    phone: '0356 166 863',
                    specialtyLabel: 'Điện - Nước (Plumbing)',
                    isOnDuty: true,
                    workloadCount: 1,
                  },
                  {
                    id: 'tech-2',
                    fullName: 'Đặng Thanh Nguyên',
                    phone: '0943 792 466',
                    specialtyLabel: 'Thang máy & Cơ khí',
                    isOnDuty: true,
                    workloadCount: 3,
                  },
                  {
                    id: 'tech-3',
                    fullName: 'Đặng Văn Tùng',
                    phone: '0969 595 478',
                    specialtyLabel: 'Điện & Chiếu sáng',
                    isOnDuty: true,
                    workloadCount: 0,
                  },
                  {
                    id: 'tech-4',
                    fullName: 'Đặng Thanh Quyết',
                    phone: '0913 402 803',
                    specialtyLabel: 'An ninh & Thẻ từ',
                    isOnDuty: false,
                    workloadCount: 0,
                  },
                ]
              ).map((tech: any, idx: number) => {
                const activeJobsCount =
                  tech.assignedTickets?.length ??
                  (idx === 0 ? 1 : idx === 1 ? 3 : 0);
                const isHighLoad = activeJobsCount >= 3;
                const isAssignSelected = bmbAssignTargetTech?.id === tech.id;
                const isViewingSelected = bmbViewingWorkloadTech?.id === tech.id;
                const initials = tech.fullName
                  .split(' ')
                  .slice(-2)
                  .map((w: string) => w[0])
                  .join('');

                return (
                  <View
                    key={tech.id}
                    style={[
                      styles.resTicketCard,
                      isAssignSelected && { borderColor: '#2563EB', borderWidth: 2 },
                      isViewingSelected &&
                      !isAssignSelected && { borderColor: '#4F46E5', borderWidth: 2 },
                      !tech.isOnDuty && { backgroundColor: '#F8FAFC', opacity: 0.75 },
                    ]}
                  >
                    <View style={styles.rowCenter}>
                      <View style={styles.bmbTechInitialsCircle}>
                        <Text style={styles.bmbTechInitialsText}>{initials}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardMainTitle}>
                          {tech.fullName} ({tech.phone})
                        </Text>
                        <View
                          style={[
                            styles.statusPill,
                            {
                              alignSelf: 'flex-start',
                              backgroundColor: tech.isOnDuty ? '#DCFCE7' : '#E2E8F0',
                            },
                          ]}
                        >
                          <Text
                            style={{
                              fontSize: 11.5,
                              fontWeight: '700',
                              color: tech.isOnDuty ? '#15803D' : '#64748B',
                            }}
                          >
                            {tech.isOnDuty
                              ? '🟢 Đang trực (Ca Sáng)'
                              : '⚪ Ngoài ca trực (Ca Chiều)'}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {tech.isOnDuty && (
                      <>
                        <Text style={[styles.cardLocationText, { marginTop: 10 }]}>
                          🔧 Chuyên môn: {tech.specialtyLabel}
                        </Text>
                        <Text
                          style={{
                            fontSize: 12.5,
                            fontWeight: '700',
                            color: isHighLoad ? '#D97706' : '#059669',
                            marginTop: 6,
                          }}
                        >
                          {activeJobsCount === 0
                            ? '0/4 việc (Đang rảnh)'
                            : isHighLoad
                              ? `Đang xử lý: ${activeJobsCount}/4 việc (Tải cao - Màu cam #F59E0B)`
                              : `Đang xử lý: ${activeJobsCount}/4 việc (Tải thấp)`}
                        </Text>

                        {/* Thanh Progress Bar tải công việc */}
                        <View style={styles.workloadTrack}>
                          <View
                            style={[
                              styles.workloadFill,
                              {
                                width: `${(activeJobsCount / 4) * 100}%`,
                                backgroundColor: isHighLoad ? '#F59E0B' : '#10B981',
                              },
                            ]}
                          />
                        </View>

                        <View style={[styles.rowBetween, { marginTop: 12, gap: 10 }]}>
                          <TouchableOpacity
                            style={[
                              styles.bmbWorkloadBtn,
                              isAssignSelected && styles.bmbWorkloadBtnBlueActive,
                            ]}
                            onPress={() => {
                              setBmbAssignTargetTech(tech);
                              setBmbTechId(tech.id);
                            }}
                          >
                            <Text
                              style={[
                                styles.bmbWorkloadBtnText,
                                isAssignSelected && { color: '#FFFFFF' },
                              ]}
                            >
                              {isAssignSelected
                                ? '[+ Giao việc mới đang chọn]'
                                : '[+ Giao việc mới]'}
                            </Text>
                          </TouchableOpacity>

                          {activeJobsCount > 0 && (
                            <TouchableOpacity
                              style={[
                                styles.bmbWorkloadBtn,
                                isViewingSelected && styles.bmbWorkloadBtnIndigoActive,
                              ]}
                              onPress={() => setBmbViewingWorkloadTech(tech)}
                            >
                              <Text
                                style={[
                                  styles.bmbWorkloadBtnText,
                                  isViewingSelected && { color: '#FFFFFF' },
                                ]}
                              >
                                {isViewingSelected
                                  ? `[👁️ Đang xem ${activeJobsCount} việc đang làm →]`
                                  : `[Xem ${activeJobsCount} việc đang làm]`}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            {/* CỘT PHẢI: 2 KHỐI XẾP DỌC (GIAO VIỆC MỚI + VIỆC ĐANG LÀM CỦA KTV) */}
            <ScrollView
              style={styles.bmbRightInspector}
              showsVerticalScrollIndicator={false}
            >
              {/* Khối trên: Giao việc mới cho KTV */}
              <View style={styles.bmbBlueOutlinePanel}>
                <Text style={styles.bmbPanelBlueTitle}>
                  ＋ Giao việc mới cho KTV:{' '}
                  {bmbAssignTargetTech?.fullName || 'Đặng Văn Nam'}
                </Text>
                <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
                  Chuyên môn:{' '}
                  {bmbAssignTargetTech?.specialtyLabel || 'Điện - Nước'} • Đang trực Ca
                  Sáng
                </Text>

                <Text style={styles.fieldLabel}>
                  Chọn sự cố đang chờ phân công (Phù hợp chuyên môn):
                </Text>

                {(pendingTicketsForRadio.length > 0
                  ? pendingTicketsForRadio.slice(0, 2)
                  : tickets.slice(0, 2)
                ).map((pt) => {
                  const isRadioChecked = bmbRadioTicketId === pt.id;
                  return (
                    <TouchableOpacity
                      key={pt.id}
                      style={[
                        styles.bmbRadioTicketBox,
                        isRadioChecked && styles.bmbRadioTicketBoxSelected,
                      ]}
                      onPress={() => setBmbRadioTicketId(pt.id)}
                    >
                      <View style={styles.rowCenter}>
                        <Text style={{ fontSize: 14, color: '#2563EB', marginRight: 6 }}>
                          {isRadioChecked ? '🔘' : '⚪'}
                        </Text>
                        <Text style={{ fontWeight: '800', color: '#2563EB', fontSize: 13 }}>
                          {pt.ticketCode}
                        </Text>
                        <View style={styles.bmbMiniOrangeBadge}>
                          <Text style={styles.bmbMiniOrangeText}>🔥 Ưu tiên: Cao</Text>
                        </View>
                        <View style={styles.bmbMiniPurpleBadge}>
                          <Text style={styles.bmbMiniPurpleText}>
                            ✨ AI: {CATEGORY_SHORT_VN[pt.aiSuggestedCategory] || 'Điện - Nước'}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 12.5, color: '#0F172A', marginTop: 6 }}>
                        {pt.title} ({pt.locationNote})
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                <Text style={styles.fieldLabel}>Ghi chú điều phối cho KTV (Tùy chọn):</Text>
                <TextInput
                  style={styles.bmbWebInput}
                  value={bmbNote}
                  onChangeText={setBmbNote}
                  placeholder="Mang theo ống nối chữ T..."
                  placeholderTextColor="#94A3B8"
                />

                <TouchableOpacity
                  style={[styles.bmbWebLoginBtn, { marginTop: 14 }]}
                  onPress={() =>
                    handleBmbDispatch(
                      bmbRadioTicketId || tickets[0]?.id,
                      bmbAssignTargetTech?.id || bmbTechId
                    )
                  }
                >
                  <Text style={styles.bmbWebLoginBtnText}>
                    ✅ Xác nhận Giao việc & Gửi thông báo FCM
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Khối dưới: Việc đang làm của KTV */}
              <View style={[styles.bmbBlueOutlinePanel, { borderColor: '#6366F1', marginTop: 14 }]}>
                <Text style={[styles.bmbPanelBlueTitle, { color: '#4338CA' }]}>
                  👁️ Việc đang làm của KTV:{' '}
                  {bmbViewingWorkloadTech?.fullName || 'Đặng Thanh Nguyên'} (03 việc)
                </Text>

                <View style={styles.bmbActiveJobItem}>
                  <Text style={{ fontWeight: '800', fontSize: 13, color: '#0F172A' }}>
                    #RF-2026-012 • Thang máy B2 phát tiếng động khi đóng cửa
                  </Text>
                  <Text style={{ fontSize: 12, color: '#4F46E5', marginTop: 4 }}>
                    🟣 Đang xử lý (In Progress - Nhận việc 20 phút trước) • 📍 Sảnh B Tầng 1
                    (QR: EL-B02)
                  </Text>
                </View>

                <View style={styles.bmbActiveJobItem}>
                  <Text style={{ fontWeight: '800', fontSize: 13, color: '#0F172A' }}>
                    #RF-2026-010 • Cửa thoát hiểm cầu thang bộ tầng 5 bị kẹt bản lề
                  </Text>
                  <Text style={{ fontSize: 12, color: '#4F46E5', marginTop: 4 }}>
                    🟣 Đang xử lý (In Progress - Nhận việc 45 phút trước) • 📍 Tầng 5 Tòa S1
                  </Text>
                </View>

                <View
                  style={[
                    styles.bmbActiveJobItem,
                    { backgroundColor: '#ECFDF5', borderColor: '#34D399', borderWidth: 1 },
                  ]}
                >
                  <Text style={{ fontWeight: '800', fontSize: 13, color: '#0F172A' }}>
                    #RF-2026-009 • Thay tay nắm cửa sảnh chính
                  </Text>
                  <Text style={{ fontSize: 12, color: '#059669', marginTop: 4 }}>
                    🟢 Hoàn thành (Đã tải 2 ảnh nghiệm thu - Đang chờ cư dân xác nhận đóng)
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>
        )}

        {/* ==================================================================== */}
        {/* MÀN HÌNH 03 BMB: TRUNG TÂM THÔNG BÁO & CLOUD STATUS (FIGMA 03 BMB)   */}
        {/* ==================================================================== */}
        {bmbNavTab === 'NOTIFICATIONS' && (
          <View style={styles.bmbContentTwoCols}>
            {/* CỘT GIỮA: TRUNG TÂM THÔNG BÁO & NHẬT KÝ HỆ THỐNG */}
            <ScrollView
              style={styles.bmbCenterColumn}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.cardTopRow}>
                <View>
                  <Text style={styles.bmbPageTitle}>
                    Trung tâm Thông báo & Nhật ký Hệ thống
                  </Text>
                  <Text style={styles.bmbPageSubtitle}>
                    Cập nhật thời gian thực qua Firebase FCM & Gemini AI (FR08, US-36)
                  </Text>
                </View>
                <TouchableOpacity onPress={handleMarkAllNotificationsRead}>
                  <Text style={{ color: '#2563EB', fontWeight: '700', fontSize: 13 }}>
                    ✓ Đánh dấu tất cả đã đọc
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.chipWrapRow, { marginTop: 12 }]}>
                {[
                  { key: 'ALL', label: 'Tất cả (15)' },
                  { key: 'UNREAD', label: '🔴 Chưa đọc (04)' },
                  { key: 'URGENT', label: '🟣 Sự cố khẩn cấp & AI (05)' },
                  { key: 'TECH', label: '🟢 Cập nhật từ KTV (06)' },
                ].map((tab: any) => (
                  <TouchableOpacity
                    key={tab.key}
                    style={[
                      styles.bmbFilterChip,
                      bmbNotiFilter === tab.key && styles.bmbFilterChipActive,
                    ]}
                    onPress={() => setBmbNotiFilter(tab.key)}
                  >
                    <Text
                      style={[
                        styles.bmbFilterChipText,
                        bmbNotiFilter === tab.key && styles.bmbFilterChipTextActive,
                      ]}
                    >
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Thẻ 1: Sự cố mới khẩn cấp */}
              <View style={styles.bmbAlertRedCard}>
                <View style={styles.cardTopRow}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#DC2626' }}>
                    🔥 SỰ CỐ MỚI KHẨN CẤP • Vừa xong
                  </Text>
                  <View style={styles.blueUnreadDot} />
                </View>
                <Text style={styles.cardMainTitle}>
                  Cư dân Căn hộ A-1204 vừa gửi báo cáo sự cố #RF-2026-014 (Kèm 2 ảnh & giọng
                  nói)
                </Text>
                <View style={styles.bmbAiPurpleMiniTag}>
                  <Text style={styles.bmbAiPurpleMiniText}>
                    ✨ Gemini Flash AI đã phân tích (1.2s): Gợi ý danh mục [Điện - Nước] • Mức
                    độ ưu tiên [Cao - Khẩn cấp]
                  </Text>
                </View>
                <TouchableOpacity
                  style={{ alignSelf: 'flex-end', marginTop: 8 }}
                  onPress={() => setBmbNavTab('TICKETS')}
                >
                  <Text style={{ color: '#2563EB', fontWeight: '800', fontSize: 13 }}>
                    Duyệt & Giao việc ngay →
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Thẻ 2: Cảnh báo trợ lý AI (US-19) */}
              <View style={styles.bmbAlertOrangeCard}>
                <View style={styles.cardTopRow}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#D97706' }}>
                    ⚠️ CẢNH BÁO TRỢ LÝ AI (US-19) • 5 phút trước
                  </Text>
                  <View style={styles.blueUnreadDot} />
                </View>
                <Text style={styles.cardMainTitle}>
                  Sự cố #RF-2026-013 (Đèn hành lang tầng 8) vượt thời gian chờ phản hồi từ
                  Gemini API (&gt;4s)
                </Text>
                <Text style={styles.cardLocationText}>
                  Hệ thống đã tự động chuyển sang chế độ Phân loại thủ công (Manual Review) để
                  không làm gián đoạn luồng xử lý.
                </Text>
                <TouchableOpacity
                  style={styles.bmbManualReviewOutlineBtn}
                  onPress={() => setBmbNavTab('TICKETS')}
                >
                  <Text style={{ color: '#2563EB', fontWeight: '700', fontSize: 12.5 }}>
                    Phân loại thủ công →
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Thẻ 3: KTV đã gửi ảnh nghiệm thu */}
              <View style={styles.resTicketCard}>
                <View style={styles.cardTopRow}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#059669' }}>
                    📸 KTV ĐÃ GỬI ẢNH NGHIỆM THU • 12 phút trước
                  </Text>
                  <View style={styles.blueUnreadDot} />
                </View>
                <Text style={styles.cardMainTitle}>
                  KTV Đặng Văn Nam đã hoàn thành sửa chữa sự cố #RF-2026-012 và tải lên 2 ảnh
                  nghiệm thu (Đã xác thực QR tại chỗ)
                </Text>
                <Text style={styles.cardLocationText}>
                  Hệ thống đã gửi thông báo đẩy (FCM) nhắc cư dân xác nhận Đã giải quyết
                  (FR08, FR09).
                </Text>
              </View>

              {/* Thẻ 4: KTV đã nhận việc */}
              <View style={styles.resTicketCard}>
                <Text
                  style={{ fontSize: 12, fontWeight: '800', color: '#2563EB', marginBottom: 4 }}
                >
                  🛠️ KTV ĐÃ NHẬN VIỆC • 25 phút trước
                </Text>
                <Text style={styles.cardMainTitle}>
                  KTV Đặng Thanh Nguyên đã xác nhận nhận việc #RF-2026-011 (Chuyển trạng thái:
                  Assigned → In Progress).
                </Text>
              </View>

              {/* Thẻ 5: Đã đóng sự cố */}
              <View style={styles.resTicketCard}>
                <Text
                  style={{ fontSize: 12, fontWeight: '800', color: '#475569', marginBottom: 4 }}
                >
                  ✅ ĐÃ ĐÓNG SỰ CỐ • 1 giờ trước
                </Text>
                <Text style={styles.cardMainTitle}>
                  Cư dân Căn hộ B-0802 đã nghiệm thu ảnh và đóng sự cố #RF-2026-008 (Đánh giá
                  chất lượng: ⭐⭐⭐⭐⭐ 5.0).
                </Text>
              </View>
            </ScrollView>

            {/* CỘT PHẢI: TRẠNG THÁI DỊCH VỤ ĐÁM MÂY (CLOUD STATUS - FIGMA 03 BMB) */}
            <ScrollView
              style={styles.bmbRightInspector}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.bmbInspectorTitle}>
                Trạng thái Dịch vụ Đám mây (Cloud Status)
              </Text>

              <View style={[styles.qrRecognizedBox, { marginTop: 12 }]}>
                <Text style={styles.qrRecognizedTitle}>
                  🤖 Google Gemini Flash API: Hoạt động tốt • Độ trễ TB: 1.4s (&lt;4s NFR01)
                </Text>
              </View>

              <View style={styles.qrRecognizedBox}>
                <Text style={styles.qrRecognizedTitle}>
                  🔔 Firebase Cloud Messaging (FCM): Kênh ưu tiên cao (High-Priority) đang bật
                  (99.8% gửi thành công)
                </Text>
              </View>

              <View style={styles.bmbCloudStorageBox}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E293B' }}>
                  ☁️ Cloudinary Media Storage: Đã dùng 1.2 GB / 25 GB Free Tier (Tối ưu ảnh tự
                  động)
                </Text>
                <View style={[styles.workloadTrack, { marginTop: 8 }]}>
                  <View
                    style={[
                      styles.workloadFill,
                      { width: '12%', backgroundColor: '#2563EB' },
                    ]}
                  />
                </View>
              </View>

              <View style={styles.techDivider} />
              <Text style={styles.cardBlockTitle}>Tóm tắt vận hành ca sáng</Text>
              <Text style={styles.techInfoLine}>
                • Tổng thông báo phát sinh hôm nay: <Text style={{ fontWeight: '800' }}>42 lượt</Text>
              </Text>
              <Text style={styles.techInfoLine}>
                • Thời gian phản hồi điều phối TB của BMB:{' '}
                <Text style={{ fontWeight: '800' }}>3.5 phút</Text>
              </Text>
            </ScrollView>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ============================================================================
// STYLESHEET ĐỒNG BỘ CHO 15 MÀN HÌNH FIGMA (MOBILE + BMB WEB)
// ============================================================================
const styles = StyleSheet.create({
  screenBg: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 10 : 0,
  },
  loginScroll: { flexGrow: 1, justifyContent: 'flex-start', alignItems: 'center', paddingHorizontal: 16, paddingTop: 40, paddingBottom: 24 },
  mobileFrame: { width: '100%', maxWidth: 412 },
  mobileShell: {
    flex: 1,
    width: '100%',
    maxWidth: 412,
    alignSelf: 'center',
    backgroundColor: '#F8FAFC',
  },
  scrollArea: { flex: 1, paddingHorizontal: 17, paddingTop: 9 },

  // Màn hình 00 BMB Web Login (Split-Card 2 cột chuẩn Figma)
  bmbLoginOuterBg: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  bmbLoginSplitCard: {
    width: '100%',
    maxWidth: 880,
    minHeight: 460,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  bmbLoginLeftBlue: {
    flex: 1,
    backgroundColor: '#2563EB',
    padding: 36,
    justifyContent: 'flex-start',
  },
  bmbLoginBrandText: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  bmbLoginHeroTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 28,
    lineHeight: 32,
  },
  bmbLoginRightWhite: {
    flex: 1.15,
    backgroundColor: '#FFFFFF',
    padding: 40,
    justifyContent: 'center',
  },
  bmbLoginFormHeading: { fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  bmbWebInput: {
    height: 46,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  bmbWebLoginBtn: {
    backgroundColor: '#2563EB',
    height: 46,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bmbWebLoginBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  // BMB Desktop 3-Column Layout (Màn hình 01, 02, 03 BMB)
  bmbWebRoot: { flex: 1, backgroundColor: '#F8FAFC' },
  bmbDesktopLayout: {
    flex: 1,
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
  },
  bmbSidebar: {
    width: Platform.OS === 'web' ? 235 : '100%',
    backgroundColor: '#FFFFFF',
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    padding: 18,
    justifyContent: 'space-between',
  },
  bmbSidebarBrandRow: { flexDirection: 'row', alignItems: 'center' },
  bmbSidebarLogoText: { fontSize: 20, fontWeight: '800', color: '#2563EB' },
  bmbSidebarSubText: { fontSize: 12, color: '#64748B', marginTop: 2, marginBottom: 22 },
  bmbWorkspaceHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94A3B8',
    marginBottom: 10,
    letterSpacing: 0.4,
  },
  bmbMenuBtn: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
  },
  bmbMenuBtnActive: { backgroundColor: '#EFF6FF' },
  bmbMenuBtnText: { fontSize: 13.5, fontWeight: '600', color: '#475569' },
  bmbMenuBtnTextActive: { color: '#2563EB', fontWeight: '800' },
  bmbSidebarNewRedTag: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
    marginLeft: 20,
  },
  bmbSidebarNewRedText: { fontSize: 11, fontWeight: '700', color: '#DC2626' },
  bmbBuildingStatusBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  bmbBuildingSmallLabel: { fontSize: 10, fontWeight: '700', color: '#94A3B8' },
  bmbBuildingName: { fontSize: 13.5, fontWeight: '800', color: '#0F172A', marginTop: 2 },
  bmbBuildingOnline: { fontSize: 11.5, color: '#10B981', marginTop: 4, fontWeight: '600' },
  bmbAdminFooter: { borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 12 },
  bmbAdminNameText: { fontSize: 12.5, fontWeight: '700', color: '#0F172A', marginBottom: 8 },
  bmbSidebarLogoutText: { fontSize: 13, fontWeight: '700', color: '#DC2626' },

  bmbContentTwoCols: {
    flex: 1,
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    padding: 20,
    gap: 18,
  },
  bmbCenterColumn: { flex: 1.35 },
  bmbRightInspector: {
    flex: 0.95,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  bmbPageTitle: { fontSize: 22, fontWeight: '800', color: '#0F172A' },
  bmbPageSubtitle: { fontSize: 13, color: '#64748B', marginTop: 2 },
  bmbDateLabel: { fontSize: 12.5, color: '#64748B' },
  bmbKpiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 14,
    gap: 10,
  },
  bmbKpiCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  bmbKpiLabel: { fontSize: 12, color: '#64748B', marginBottom: 6 },
  bmbKpiNumber: { fontSize: 26, fontWeight: '800' },
  bmbFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 6,
    marginBottom: 6,
  },
  bmbFilterChipActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  bmbFilterChipText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  bmbFilterChipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  bmbUrgentInlineDot: { fontSize: 12, fontWeight: '700', color: '#DC2626' },
  bmbAiPurpleMiniTag: {
    backgroundColor: '#FAF5FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  bmbAiPurpleMiniText: { fontSize: 11.5, fontWeight: '700', color: '#7E22CE' },
  bmbAiTimeoutTag: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  bmbAiTimeoutText: { fontSize: 11.5, fontWeight: '700', color: '#B45309' },
  pageNumActive: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#DBEAFE',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  pageNumInactive: { fontSize: 12, color: '#64748B', marginHorizontal: 6 },
  bmbInspectorTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  bmbSmallSectionHead: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.3,
  },
  qrVerifiedPill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  qrVerifiedPillText: { fontSize: 11, fontWeight: '700', color: '#2563EB' },
  bmbInspectorDesc: { fontSize: 13.5, color: '#0F172A', marginTop: 8, lineHeight: 19 },
  bmbAttachmentThumb: {
    width: 64,
    height: 54,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  bmbGeminiPurpleCard: {
    backgroundColor: '#FAF5FF',
    borderWidth: 1.5,
    borderColor: '#A855F7',
    borderRadius: 14,
    padding: 14,
    marginTop: 6,
  },
  bmbGeminiCardTitle: { fontSize: 13, fontWeight: '800', color: '#7E22CE', flex: 1 },
  bmbLatencyGreenPill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  bmbLatencyGreenText: { fontSize: 11, fontWeight: '700', color: '#15803D' },
  bmbAiSummaryBullet: {
    fontSize: 12.5,
    color: '#0F172A',
    marginTop: 6,
    marginBottom: 4,
  },
  bmbDropdownBox: {
    height: 42,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bmbDropdownValue: { fontSize: 13, fontWeight: '600', color: '#0F172A' },
  bmbRiskR1Hint: { fontSize: 11.5, color: '#64748B', marginTop: 10, lineHeight: 16 },

  // Màn hình 02 BMB: Workload Kỹ thuật viên
  bmbStatPill: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    marginRight: 8,
    marginBottom: 8,
  },
  bmbStatPillText: { fontSize: 12.5, fontWeight: '700', color: '#0F172A' },
  bmbTechInitialsCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  bmbTechInitialsText: { fontSize: 14, fontWeight: '800', color: '#2563EB' },
  workloadTrack: {
    height: 7,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    marginTop: 6,
    overflow: 'hidden',
  },
  workloadFill: { height: '100%', borderRadius: 4 },
  bmbWorkloadBtn: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bmbWorkloadBtnBlueActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  bmbWorkloadBtnIndigoActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  bmbWorkloadBtnText: { fontSize: 12, fontWeight: '700', color: '#2563EB' },
  bmbBlueOutlinePanel: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#3B82F6',
    borderRadius: 14,
    padding: 14,
  },
  bmbPanelBlueTitle: { fontSize: 15, fontWeight: '800', color: '#2563EB', marginBottom: 4 },
  bmbRadioTicketBox: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  bmbRadioTicketBoxSelected: { backgroundColor: '#EFF6FF', borderColor: '#3B82F6' },
  bmbMiniOrangeBadge: {
    backgroundColor: '#FFEDD5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  bmbMiniOrangeText: { fontSize: 10.5, fontWeight: '700', color: '#C2410C' },
  bmbMiniPurpleBadge: {
    backgroundColor: '#FAF5FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  bmbMiniPurpleText: { fontSize: 10.5, fontWeight: '700', color: '#7E22CE' },
  bmbActiveJobItem: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },

  // Màn hình 03 BMB: Thông báo hệ thống & Cloud Status
  bmbAlertRedCard: {
    backgroundColor: '#EFF6FF',
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  bmbAlertOrangeCard: {
    backgroundColor: '#FFFBEB',
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  bmbManualReviewOutlineBtn: {
    alignSelf: 'flex-end',
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  bmbCloudStorageBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },

  // Styles dùng chung cho Mobile (Cư dân & Kỹ thuật viên)
  brandCenter: { alignItems: 'center', marginBottom: 20, gap: 0 },
  appIconBox: {
    width: 68,
    height: 68,
    borderRadius: 18,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  appIconSymbol: { fontSize: 30, color: '#FFFFFF' },
  brandTitle: { fontSize: 30, fontWeight: '800', color: '#2563EB', marginTop: 9 },
  brandSub: { fontSize: 13.5, color: '#64748B', marginTop: 4, textAlign: 'center' },
  geminiBadgePill: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#A855F7',
    backgroundColor: '#FAF5FF',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  geminiBadgeText: { fontSize: 12, fontWeight: '700', color: '#7E22CE' },
  loginCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  loginCardTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  loginCardSub: { fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: 14, lineHeight: 18 },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', color: '#1E293B', marginTop: 10, marginBottom: 6 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  inputPrefixIcon: { fontSize: 16, marginRight: 8, color: '#64748B' },
  textInputField: { flex: 1, fontSize: 15, color: '#0F172A' },
  eyeIcon: { fontSize: 16, paddingLeft: 8 },
  rememberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 18,
  },
  checkboxRow: { flexDirection: 'row', alignItems: 'center' },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  checkMark: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  rememberText: { fontSize: 13, color: '#475569' },
  forgotText: { fontSize: 13, fontWeight: '700', color: '#2563EB' },
  loginSubmitBtn: {
    backgroundColor: '#2563EB',
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginSubmitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  demoSwitchRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, gap: 6 },
  demoChip: {
    flex: 1,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  demoChipText: { fontSize: 11, fontWeight: '700', color: '#2563EB', textAlign: 'center' },
  resHomeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  aptSmallLabel: { fontSize: 13, color: '#64748B' },
  aptBigTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A', marginTop: 2 },
  bellCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  bellRedDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  ctaHeroCard: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#3B82F6',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  ctaTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  qrFrameIcon: { fontSize: 20, color: '#2563EB', marginRight: 8, fontWeight: '800' },
  ctaHeroTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  ctaHeroDesc: { fontSize: 13, color: '#475569', lineHeight: 19, marginBottom: 14 },
  ctaPrimaryBtn: {
    backgroundColor: '#2563EB',
    height: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaPrimaryBtnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitleText: { fontSize: 17.5, fontWeight: '800', color: '#0F172A' },
  seeHistoryLink: { fontSize: 13.5, fontWeight: '700', color: '#2563EB' },
  pillsScroll: { marginBottom: 14, flexGrow: 0 },
  chipWrapRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  filterPill: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
  },
  filterPillActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  filterPillText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  filterPillTextActive: { color: '#FFFFFF', fontWeight: '700' },
  resTicketCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  resTicketCardCompleted: { borderColor: '#22C55E', borderWidth: 1.5 },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardCodeText: { fontSize: 13.5, fontWeight: '700', color: '#64748B' },
  statusPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16 },
  statusPillText: { fontSize: 11.5, fontWeight: '700' },
  cardMainTitle: { fontSize: 15.5, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  cardLocationText: { fontSize: 12.5, color: '#64748B' },
  completedActionBar: {
    marginTop: 12,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  completedActionLabel: { fontSize: 13, fontWeight: '700', color: '#059669' },
  resolvedGreenBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  resolvedGreenBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  cardFooterGrayBar: {
    marginTop: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
  },
  cardFooterGrayText: { fontSize: 12.5, color: '#64748B' },
  techDutyCard: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
  },
  techDutyTitle: { fontSize: 15.5, fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  techDutySub: { fontSize: 13, color: '#475569', lineHeight: 19 },
  urgentRedText: { fontSize: 12.5, fontWeight: '800', color: '#DC2626', marginBottom: 4 },
  techAssignActionBar: {
    marginTop: 12,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  acceptJobBlueBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
  },
  acceptJobBlueBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  assignedTimeMeta: { fontSize: 12, fontWeight: '600', color: '#2563EB' },
  techInProgressBar: {
    marginTop: 12,
    backgroundColor: '#EEF2FF',
    borderRadius: 10,
    padding: 10,
  },
  techInProgressText: { fontSize: 12.5, fontWeight: '600', color: '#4F46E5' },
  techDetailTopCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#34D399',
  },
  techInfoLine: { fontSize: 13, color: '#1E293B', marginBottom: 8, lineHeight: 19 },
  residentDescGray: { fontSize: 13.5, color: '#475569', marginBottom: 12, lineHeight: 19 },
  residentGrayThumb: {
    width: '31%',
    height: 78,
    backgroundColor: '#CBD5E1',
    borderRadius: 10,
  },
  techCapturedBox: {
    width: '48%',
    height: 92,
    backgroundColor: '#CBD5E1',
    borderRadius: 12,
  },
  techAddPhotoDashedBox: {
    width: '48%',
    height: 92,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#93C5FD',
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8,
  },
  techPlusIcon: { fontSize: 22, color: '#2563EB', marginBottom: 4 },
  techAddPhotoBlueText: { fontSize: 12, fontWeight: '700', color: '#2563EB', textAlign: 'center' },
  techNotiUrgentBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  techNotiUrgentTag: { fontSize: 12, fontWeight: '800', color: '#DC2626', marginBottom: 4 },
  techNotiAcceptedBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  techNotiAcceptedTag: { fontSize: 12, fontWeight: '800', color: '#059669', marginBottom: 4 },
  techNotiBodyText: { fontSize: 13, color: '#0F172A', lineHeight: 19 },
  techProfileHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  techAvatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  specialtyPill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  specialtyPillText: { fontSize: 12, fontWeight: '700', color: '#2563EB' },
  techDivider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 12 },
  techProfileLine: { fontSize: 13.5, color: '#0F172A', marginBottom: 8, lineHeight: 20 },
  waitingResidentBanner: {
    backgroundColor: '#CCFBF1',
    borderRadius: 10,
    paddingVertical: 7,
    alignItems: 'center',
    marginBottom: 8,
  },
  waitingResidentBannerText: { fontSize: 12.5, fontWeight: '700', color: '#047857' },
  sentPhotoBlueBar: {
    marginTop: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 10,
  },
  sentPhotoBlueText: { fontSize: 12.5, fontWeight: '600', color: '#2563EB' },
  closedResidentGreenBar: {
    marginTop: 10,
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    padding: 10,
  },
  closedResidentGreenText: { fontSize: 12.5, fontWeight: '700', color: '#047857' },
  subScreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  subScreenHeaderBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 14,
    gap: 8,
  },
  rowCenterFlex: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 },
  backArrowText: { fontSize: 22, fontWeight: '700', color: '#0F172A', marginRight: 10 },
  subScreenTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A', flexShrink: 1 },
  stepTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginTop: 8, marginBottom: 10 },
  qrDashedBtn: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#60A5FA',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  qrDashedBtnText: { color: '#2563EB', fontSize: 14, fontWeight: '700' },
  qrRecognizedBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#34D399',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  qrRecognizedTitle: { fontSize: 13, fontWeight: '700', color: '#047857', lineHeight: 18 },
  qrRecognizedSub: { fontSize: 12, color: '#64748B', marginTop: 4 },
  photoGridRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  photoSlotCard: {
    width: '31%',
    height: 112,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePhotoCircle: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removePhotoX: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  slotPreviewImg: { width: 52, height: 52, borderRadius: 8, marginBottom: 6 },
  photoSlotCaption: { fontSize: 11, color: '#64748B', textAlign: 'center' },
  addPhotoDashedSlot: {
    width: '31%',
    height: 112,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  addPhotoPlus: { fontSize: 24, color: '#64748B', marginBottom: 4 },
  addPhotoLabel: { fontSize: 11, color: '#64748B', textAlign: 'center' },
  descBoxContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 12,
    marginBottom: 14,
  },
  descTextArea: { minHeight: 74, fontSize: 14.5, color: '#0F172A', textAlignVertical: 'top' },
  descBottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  charCountText: { fontSize: 12, fontWeight: '600', color: '#059669' },
  voicePillBtn: {
    backgroundColor: '#FAF5FF',
    borderWidth: 1,
    borderColor: '#E9D5FF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
  },
  voicePillText: { color: '#7E22CE', fontSize: 12.5, fontWeight: '700' },
  geminiInfoBox: { backgroundColor: '#FAF5FF', borderRadius: 12, padding: 12, marginBottom: 20 },
  geminiInfoText: { color: '#7E22CE', fontSize: 12.5, lineHeight: 18 },
  stickyBottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  whiteSectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardBlockTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginBottom: 10 },
  timelineRow: { flexDirection: 'row', alignItems: 'center' },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginRight: 10 },
  timelineText: { fontSize: 13, color: '#475569', flex: 1 },
  timelineLine: {
    width: 2,
    height: 16,
    backgroundColor: '#CBD5E1',
    marginLeft: 5,
    marginVertical: 2,
  },
  proofGreenBorderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#22C55E',
  },
  proofCompareRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  proofHalfCol: { width: '48%' },
  proofBoxBefore: {
    height: 92,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  proofPlaceholderText: { fontSize: 11.5, color: '#64748B', marginTop: 4 },
  proofBoxAfter: {
    height: 92,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#6EE7B7',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  greenCheckCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  proofAfterSmallText: { fontSize: 11.5, color: '#059669', marginTop: 4, fontWeight: '600' },
  proofLabelBefore: { fontSize: 12.5, fontWeight: '700', color: '#0F172A' },
  proofLabelAfter: { fontSize: 12.5, fontWeight: '700', color: '#059669' },
  techNoteGrayBox: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12 },
  techNoteGrayText: { fontSize: 13, color: '#475569', lineHeight: 18 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginBottom: 14 },
  starIcon: { fontSize: 28, color: '#F59E0B' },
  ratingInputBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    padding: 12,
    minHeight: 60,
    fontSize: 13.5,
    color: '#0F172A',
    textAlignVertical: 'top',
  },
  confirmCloseGreenBtn: {
    backgroundColor: '#059669',
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmCloseGreenText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  unreadPillBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  unreadPillText: { fontSize: 12, fontWeight: '700', color: '#2563EB' },
  notiBlueItem: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  notiItemTitle: { fontSize: 13.5, fontWeight: '700', color: '#0F172A', lineHeight: 19 },
  notiItemTime: { fontSize: 12, color: '#64748B', marginTop: 6 },
  blueUnreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#2563EB',
    marginTop: 4,
  },
  profileAvatarWrapper: { alignItems: 'center', marginVertical: 10 },
  profileAvatarCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#EFF6FF',
    borderWidth: 2,
    borderColor: '#DBEAFE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  profileNameText: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  profileInfoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  profileInfoIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  profileInfoValue: { fontSize: 14.5, fontWeight: '700', color: '#0F172A' },
  logoutRedOutlineBtn: {
    marginTop: 16,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutRedOutlineText: { color: '#DC2626', fontSize: 14, fontWeight: '700' },
  totalCountBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  totalCountText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  searchBarBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 12,
  },
  searchBarInput: { flex: 1, fontSize: 13.5, color: '#0F172A' },
  historyFooterBar: {
    marginTop: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyClosedDate: { fontSize: 12.5, fontWeight: '600', color: '#475569' },
  historyTechName: { fontSize: 12, color: '#64748B', marginTop: 2 },
  historyRatingNum: { fontSize: 13.5, fontWeight: '800', color: '#0F172A' },
  figmaBottomNav: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 13 : 14,
    minHeight: 65,
  },
  figmaNavTab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  figmaNavLabel: { fontSize: 11.5, color: '#64748B', marginTop: 5, fontWeight: '600' },
  figmaNavLabelActive: { color: '#2563EB', fontWeight: '800' },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  toastBanner: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  toastText: { color: '#2563EB', fontWeight: '700', fontSize: 13, textAlign: 'center' },
});