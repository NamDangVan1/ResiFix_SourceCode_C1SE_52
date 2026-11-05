import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Platform,
  Image,
  StatusBar,
  Alert,
  Modal,
} from 'react-native';
import {
  UiActivityIndicator as ActivityIndicator,
  UiSafeAreaView as SafeAreaView,
  UiScrollView as ScrollView,
  UiStatusBar as ThemedStatusBar,
  UiText as Text,
  UiTextInput as TextInput,
  UiTouchableOpacity as TouchableOpacity,
  UiView as View,
  PreferenceControls,
  UiPreferencesProvider,
  useUiPreferences,
} from './UiPreferences';
import QrScannerModal from './QrScannerModal';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================================
// CẤU HÌNH ĐỊA CHỈ BACKEND CHUẨN CHO CẢ WEB & ĐIỆN THOẠI
// ============================================================================
const getApiBaseUrl = () => {
  if (Platform.OS === 'web') {
    // Trên trình duyệt máy tính: Luôn gọi thẳng vào cổng 5000 nội bộ của máy tính
    return 'http://localhost:5000/api';
  }
  return `https://itchy-jars-vanish.loca.lt/api`;
};

const API_BASE_URL = getApiBaseUrl();
const AUTH_SESSION_STORAGE_KEY = 'resifix.auth.session';

export default function App() {
  return (
    <UiPreferencesProvider>
      <AppContent />
    </UiPreferencesProvider>
  );
}

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

const formatDateTime = (value?: string | Date | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

type TechnicianForm = {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  specialty: string;
  shiftName: string;
  isOnDuty: boolean;
};

const EMPTY_TECHNICIAN_FORM: TechnicianForm = {
  fullName: '',
  phone: '',
  email: '',
  password: '',
  specialty: 'PLUMBING',
  shiftName: '',
  isOnDuty: false,
};

function AppContent() {
  const { t: translate } = useUiPreferences();
  // 1. State Xác thực & Chuyển đổi giao diện Login Web / Mobile (FR01)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [loginMode, setLoginMode] = useState<'BMB_WEB' | 'MOBILE'>(
    Platform.OS === 'web' ? 'BMB_WEB' : 'MOBILE'
  );
  const [phoneInput, setPhoneInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const [dutyUpdating, setDutyUpdating] = useState(false);
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
  const [technicianDialogMode, setTechnicianDialogMode] = useState<'create' | 'edit' | 'delete' | null>(null);
  const [selectedTechnician, setSelectedTechnician] = useState<any | null>(null);
  const [technicianForm, setTechnicianForm] = useState<TechnicianForm>(EMPTY_TECHNICIAN_FORM);
  const [technicianFormBusy, setTechnicianFormBusy] = useState(false);
  const [technicianFormError, setTechnicianFormError] = useState<string | null>(null);

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
  } | null>(null);
  const [manualLocation, setManualLocation] = useState('');
  const [reportPhotos, setReportPhotos] = useState<{ label: string; url: string }[]>([]);
  const [reportDesc, setReportDesc] = useState('');

  // 6. State Chi tiết Sự cố (Cư dân & Kỹ thuật viên)
  const [activeTicket, setActiveTicket] = useState<any | null>(null);
  const [ratingStars, setRatingStars] = useState<number>(5);
  const [ratingComment, setRatingComment] = useState<string>('');
  const [techProofPhotos, setTechProofPhotos] = useState<string[]>([]);
  const [techRepairNote, setTechRepairNote] = useState<string>('');

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
          password: overridePass ?? passwordInput,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.message || translate('Sai thông tin đăng nhập!'));
        return;
      }
      setToken(data.token);
      setUser(data.user);
      setResScreen('HOME');
      setTechScreen('HOME');
      setBmbNavTab('TICKETS');
      if (rememberMe) {
        void AsyncStorage.setItem(
          AUTH_SESSION_STORAGE_KEY,
          JSON.stringify({ token: data.token, user: data.user })
        ).catch(() => showToast(translate('Không thể lưu phiên đăng nhập trên thiết bị này.')));
      } else {
        void AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY).catch(() => undefined);
      }
      await fetchAllData(data.token, data.user);
    } catch {
      showToast(translate(`Không kết nối được Backend (${API_BASE_URL}). Hãy đảm bảo cổng 5000 đang chạy!`));
    } finally {
      setLoading(false);
    }
  };

  const fetchAllData = async (currentToken = token, currentUser = user): Promise<boolean> => {
    if (!currentToken || !currentUser) return false;
    try {
      const headers = {
        Authorization: `Bearer ${currentToken}`,
        'bypass-tunnel-reminder': 'true',
      };
      const [tRes, nRes] = await Promise.all([
        fetch(`${API_BASE_URL}/tickets`, { headers }),
        fetch(`${API_BASE_URL}/notifications`, { headers }),
      ]);
      if (tRes.status === 401 || nRes.status === 401) {
        void AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY).catch(() => undefined);
        setToken(null);
        setUser(null);
        setDataLoadError(null);
        setToastMsg(translate('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'));
        return false;
      }
      const [tData, nData] = await Promise.all([
        tRes.json().catch(() => ({})),
        nRes.json().catch(() => ({})),
      ]);
      if (!tRes.ok || !tData?.success || !Array.isArray(tData.tickets)) {
        throw new Error(tData?.message || 'Không thể tải danh sách sự cố.');
      }
      if (!nRes.ok || !nData?.success || !Array.isArray(nData.notifications)) {
        throw new Error(nData?.message || 'Không thể tải danh sách thông báo.');
      }

      const list = tData.tickets;
      setTickets(list);
      if (activeTicket) {
        const updated = list.find((item: any) => item.id === activeTicket.id);
        if (updated) setActiveTicket(updated);
      }
      if (currentUser.role === 'BMB') {
        if (list.length > 0) {
          const currentSel = bmbSelectedTicket
            ? list.find((x: any) => x.id === bmbSelectedTicket.id) || list[0]
            : list[0];
          handleSelectBmbTicket(currentSel);
          const firstPending = list.find((x: any) => x.status === 'PENDING') || list[0];
          setBmbRadioTicketId(firstPending.id);
        } else {
          setBmbSelectedTicket(null);
          setBmbRadioTicketId('');
        }
      }
      setNotifications(nData.notifications);
      setUnreadCount(Number.isInteger(nData.unreadCount) ? nData.unreadCount : 0);

      if (currentUser.role === 'BMB') {
        const techRes = await fetch(`${API_BASE_URL}/tickets/technicians/on-duty`, { headers });
        const techData = await techRes.json().catch(() => ({}));
        if (!techRes.ok || !techData?.success || !Array.isArray(techData.technicians)) {
          throw new Error(techData?.message || 'Không thể tải danh sách kỹ thuật viên.');
        }
        const techList = techData.technicians;
        setTechnicians(techList);
        const firstDuty = techList.find((t: any) => t.isOnDuty) || techList[0];
        if (firstDuty) {
          setBmbTechId((current) => techList.some((item: any) => item.id === current) ? current : firstDuty.id);
          setBmbAssignTargetTech((current: any) => techList.find((item: any) => item.id === current?.id) || firstDuty);
          setBmbViewingWorkloadTech((current: any) => techList.find((item: any) => item.id === current?.id) || firstDuty);
        }
      } else {
        setTechnicians([]);
      }
      setDataLoadError(null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể tải dữ liệu. Vui lòng thử lại.';
      console.error('Lỗi khi tải dữ liệu ứng dụng:', error);
      setDataLoadError(message);
      return false;
    }
  };

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(AUTH_SESSION_STORAGE_KEY)
      .then(async (savedSession) => {
        if (!savedSession) return;
        let session: any;
        try {
          session = JSON.parse(savedSession);
        } catch {
          await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
          return;
        }
        if (!session?.token || !session?.user) {
          await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
          return;
        }
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: {
            Authorization: `Bearer ${session.token}`,
            'bypass-tunnel-reminder': 'true',
          },
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403) {
          await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
          if (mounted) showToast(translate('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'));
          return;
        }
        if (!response.ok || !data?.success || !data?.user) {
          throw new Error(data?.message || 'Không thể xác minh phiên đăng nhập.');
        }
        if (!mounted) return;
        setToken(session.token);
        setUser(data.user);
        setRememberMe(true);
        await fetchAllData(session.token, data.user);
      })
      .catch((error) => {
        if (mounted) showToast(error instanceof Error ? error.message : translate('Không thể khôi phục phiên đăng nhập.'));
      });

    return () => {
      mounted = false;
    };
    // Restore the saved session once on launch and revalidate it with the API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = () => {
    const currentToken = token;
    if (currentToken) {
      void fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentToken}`, 'bypass-tunnel-reminder': 'true' },
      }).catch(() => undefined);
    }
    void AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY).catch(() => undefined);
    setToken(null);
    setUser(null);
    setTickets([]);
    setNotifications([]);
    setUnreadCount(0);
    setTechnicians([]);
    setActiveTicket(null);
    setTechnicianDialogMode(null);
    setDataLoadError(null);
    setToastMsg(null);
  };

  const openCreateTechnician = () => {
    setSelectedTechnician(null);
    setTechnicianForm(EMPTY_TECHNICIAN_FORM);
    setTechnicianFormError(null);
    setTechnicianDialogMode('create');
  };

  const openEditTechnician = (technician: any) => {
    setSelectedTechnician(technician);
    setTechnicianForm({
      fullName: technician.fullName || '',
      phone: technician.phone || '',
      email: technician.email || '',
      password: '',
      specialty: technician.specialty || 'OTHER',
      shiftName: technician.shiftName || '',
      isOnDuty: Boolean(technician.isOnDuty),
    });
    setTechnicianFormError(null);
    setTechnicianDialogMode('edit');
  };

  const closeTechnicianDialog = () => {
    if (technicianFormBusy) return;
    setTechnicianDialogMode(null);
    setTechnicianFormError(null);
  };

  const saveTechnician = async () => {
    if (!technicianForm.fullName.trim() || !technicianForm.phone.trim()) {
      setTechnicianFormError(translate('Vui lòng nhập họ tên và số điện thoại hợp lệ.'));
      return;
    }
    if (technicianDialogMode === 'create' && technicianForm.password.length < 6) {
      setTechnicianFormError(translate('Mật khẩu ban đầu phải có ít nhất 6 ký tự.'));
      return;
    }

    const payload: Record<string, unknown> = {
      fullName: technicianForm.fullName.trim(),
      phone: technicianForm.phone.trim(),
      email: technicianForm.email.trim() || null,
      specialty: technicianForm.specialty,
      shiftName: technicianForm.shiftName.trim() || null,
      isOnDuty: technicianForm.isOnDuty,
    };
    if (technicianForm.password) payload.password = technicianForm.password;

    try {
      setTechnicianFormError(null);
      setTechnicianFormBusy(true);
      const isEditing = technicianDialogMode === 'edit';
      const endpoint = isEditing
        ? `${API_BASE_URL}/tickets/technicians/${selectedTechnician.id}`
        : `${API_BASE_URL}/tickets/technicians`;
      const response = await fetch(endpoint, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        setTechnicianFormError(result.message || translate('Không thể lưu thông tin kỹ thuật viên.'));
        return;
      }

      await fetchAllData();
      setTechnicianDialogMode(null);
      showToast(translate(isEditing ? 'Đã cập nhật kỹ thuật viên.' : 'Đã thêm kỹ thuật viên.'));
    } catch {
      setTechnicianFormError(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setTechnicianFormBusy(false);
    }
  };

  const deleteTechnician = async () => {
    if (!selectedTechnician) return;
    try {
      setTechnicianFormError(null);
      setTechnicianFormBusy(true);
      const response = await fetch(
        `${API_BASE_URL}/tickets/technicians/${selectedTechnician.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' } }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        setTechnicianFormError(result.message || translate('Không thể xóa kỹ thuật viên.'));
        return;
      }

      await fetchAllData();
      setTechnicianDialogMode(null);
      setSelectedTechnician(null);
      showToast(translate('Đã vô hiệu hóa kỹ thuật viên.'));
    } catch {
      setTechnicianFormError(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setTechnicianFormBusy(false);
    }
  };

  const handleSelectBmbTicket = (t: any) => {
    setBmbSelectedTicket(t);
    setBmbCategory(t.finalCategory || t.aiSuggestedCategory || 'OTHER');
    setBmbPriority(t.finalPriority || t.aiSuggestedPriority || 'MEDIUM');
    setBmbNote(t.bmbAdminNote || '');
    if (t.assignedTechId) setBmbTechId(t.assignedTechId);
  };

  const openTechnicianTask = (ticket: any) => {
    setActiveTicket(ticket);
    setTechRepairNote(ticket.techRepairNote || '');
    setTechProofPhotos([]);
    setTechScreen('TASK_DETAIL');
  };

  // Quét QR tự động điền thiết bị (Màn hình 02 Cư dân)
  const [qrModalVisible, setQrModalVisible] = useState(false);

  // Hàm xử lý khi Camera quét được mã QR thiết bị (FR05, US-09)
  const handleQrCodeDetected = async (rawCode: string) => {
    const cleanCode = rawCode.trim().toUpperCase();
    try {
      setScannedAsset(null);
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

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || !data?.asset) {
        showToast(data?.message || translate('Không tìm thấy thiết bị trong danh mục đang hoạt động.'));
        return;
      }
      setScannedAsset({
        qrCode: data.asset.qrCode,
        assetName: data.asset.assetName,
        locationLabel: data.asset.locationLabel,
      });
      showToast(translate(`Đã nhận diện từ mã QR: ${data.asset.assetName}`));
    } catch {
      showToast(translate(`Không thể tra cứu mã "${cleanCode}". Hãy kiểm tra kết nối Backend rồi thử lại.`));
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
    if (!asset.base64) throw new Error(translate('Không đọc được dữ liệu ảnh đã chọn.'));
    const mimeType = asset.mimeType || 'image/jpeg';
    const base64DataUri = `data:${mimeType};base64,${asset.base64}`;
    const res = await fetch(`${API_BASE_URL}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'bypass-tunnel-reminder': 'true',
      },
      body: JSON.stringify({ imageBase64: base64DataUri, folder: folderName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success || typeof data?.imageUrl !== 'string') {
      throw new Error(data?.message || translate('Không thể tải ảnh lên máy chủ. Vui lòng thử lại.'));
    }
    return data.imageUrl;
  };

  const launchCameraFlow = async (
    folderName: 'incident_scene' | 'repair_proof',
    onSuccessUrl: (url: string) => void
  ) => {
    try {
      const camPerm = await ImagePicker.requestCameraPermissionsAsync();
      if (!camPerm.granted) {
        showToast(translate('⚠️ Vui lòng cấp quyền Camera để chụp ảnh hiện trường!'));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.6,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      setLoading(true);
      showToast(translate('☁️ Đang tải ảnh lên Cloudinary...'));
      const finalUrl = await uploadAssetToCloudinary(result.assets[0], folderName);
      onSuccessUrl(finalUrl);
    } catch (error) {
      showToast(error instanceof Error ? error.message : translate('Không thể chụp hoặc tải ảnh lên.'));
    } finally {
      setLoading(false);
    }
  };

  const launchLibraryFlow = async (
    folderName: 'incident_scene' | 'repair_proof',
    onSuccessUrl: (url: string) => void
  ) => {
    try {
      if (Platform.OS !== 'web') {
        const libPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!libPerm.granted) {
          showToast(translate('⚠️ Vui lòng cấp quyền Thư viện ảnh để chọn ảnh!'));
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.6,
        base64: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      setLoading(true);
      showToast(translate('☁️ Đang tải ảnh lên Cloudinary...'));
      const finalUrl = await uploadAssetToCloudinary(result.assets[0], folderName);
      onSuccessUrl(finalUrl);
    } catch (error) {
      showToast(error instanceof Error ? error.message : translate('Không thể chọn hoặc tải ảnh lên.'));
    } finally {
      setLoading(false);
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
      translate('Đính kèm hình ảnh'),
      translate('Bạn muốn chụp ảnh trực tiếp bằng Camera hay chọn ảnh có sẵn từ Thư viện?'),
      [
        {
          text: translate('📷 Chụp ảnh mới (Camera)'),
          onPress: () => launchCameraFlow(folderName, onSuccessUrl),
        },
        {
          text: translate('🖼️ Chọn từ Thư viện ảnh'),
          onPress: () => launchLibraryFlow(folderName, onSuccessUrl),
        },
        { text: translate('Hủy'), style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  // Cư dân gửi báo cáo sự cố (Màn hình 02 - US-11, US-14, US-44)
  const handleSubmitReport = async () => {
    if (reportDesc.trim().length < 10) {
      showToast(translate('Mô tả sự cố cần tối thiểu 10 ký tự!'));
      return;
    }
    const profileLocation = [
      user?.apartmentCode ? `Căn hộ ${user.apartmentCode}` : '',
      user?.buildingBlock || '',
      user?.floorNumber ? `Tầng ${user.floorNumber}` : '',
    ].filter(Boolean).join(' • ');
    const locationStr = scannedAsset
      ? `${scannedAsset.locationLabel} • Thiết bị: ${scannedAsset.qrCode}`
      : manualLocation.trim() || profileLocation;
    if (!locationStr) {
      showToast(translate('Vui lòng nhập vị trí sự cố hoặc quét mã thiết bị.'));
      return;
    }
    try {
      setLoading(true);
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
          isVoiceInput: false,
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
        setTickets((current) => [data.ticket, ...current.filter((ticket) => ticket.id !== data.ticket.id)]);
        setReportDesc('');
        setManualLocation('');
        setReportPhotos([]);
        setScannedAsset(null);
        setResScreen('HOME');
        showToast(translate(data.message || `Đã gửi ${data.ticket.ticketCode} thành công.`));
        await fetchAllData();
      } else {
        showToast(
          data?.message ||
          translate(`Lỗi máy chủ (${res.status}). Hãy kiểm tra cửa sổ Terminal của Backend!`)
        );
      }
    } catch {
      showToast(translate('Không kết nối được Backend khi gửi báo cáo. Vui lòng thử lại!'));
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
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          ratingStars,
          ratingComment: ratingComment.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast(data.message || translate('Không thể xác nhận đã giải quyết. Vui lòng thử lại.'));
        return;
      }
      setTickets((current) => current.map((ticket) => ticket.id === data.ticket.id ? data.ticket : ticket));
      setActiveTicket(data.ticket);
      showToast(translate(`✅ Đã đóng sự cố ${ticketToClose.ticketCode} (${ratingStars} sao)!`));
      await fetchAllData();
      setResScreen('HOME');
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };

  // Kỹ thuật viên bật/tắt Ca trực On-duty
  const handleToggleOnDuty = async () => {
    try {
      setDutyUpdating(true);
      const nextDuty = !user.isOnDuty;
      const res = await fetch(`${API_BASE_URL}/auth/on-duty`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({ isOnDuty: nextDuty }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast(data.message || translate('Không thể đổi trạng thái ca trực'));
        return;
      }
      setUser({ ...user, isOnDuty: data.technician?.isOnDuty ?? nextDuty });
      showToast(data.message || translate('Đã cập nhật trạng thái ca trực.'));
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setDutyUpdating(false);
    }
  };

  // Kỹ thuật viên bấm "Nhận việc ngay"
  const handleTechAcknowledge = async (ticketObj: any) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketObj.id}/acknowledge`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast(data.message || translate('Không thể nhận việc. Vui lòng thử lại.'));
        return;
      }
      showToast(translate(`🛠️ Đã nhận việc ${ticketObj.ticketCode}!`));
      setTickets((current) => current.map((ticket) => ticket.id === data.ticket.id ? data.ticket : ticket));
      await fetchAllData();
      openTechnicianTask(data.ticket || { ...ticketObj, status: 'IN_PROGRESS' });
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };

  // Kỹ thuật viên bấm "Hoàn thành & Gửi ảnh nghiệm thu"
  const handleTechCompleteSubmit = async (ticketObj: any) => {
    if (techProofPhotos.length === 0) {
      showToast(translate('Vui lòng chọn ít nhất một ảnh nghiệm thu trước khi hoàn tất.'));
      return;
    }

    try {
      setLoading(true);
      let currentTicket = ticketObj;
      if (ticketObj.status === 'ASSIGNED') {
        const acknowledgeRes = await fetch(`${API_BASE_URL}/tickets/${ticketObj.id}/acknowledge`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' },
        });
        const acknowledgeData = await acknowledgeRes.json().catch(() => ({}));
        if (!acknowledgeRes.ok || !acknowledgeData.success) {
          showToast(acknowledgeData.message || translate('Không thể nhận việc. Vui lòng tải lại danh sách.'));
          return;
        }
        currentTicket = acknowledgeData.ticket || { ...ticketObj, status: 'IN_PROGRESS' };
        setActiveTicket(currentTicket);
      }

      const res = await fetch(`${API_BASE_URL}/tickets/${currentTicket.id}/complete`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          proofImageUrls: techProofPhotos,
          techRepairNote: techRepairNote.trim(),
          isQrVerifiedByTech: Boolean(currentTicket.isQrVerifiedByTech),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast(data.message || translate('Không thể hoàn tất công việc. Vui lòng thử lại.'));
        return;
      }
      showToast(translate(`📸 Đã hoàn thành & gửi ảnh nghiệm thu ${ticketObj.ticketCode}!`));
      setTickets((current) => current.map((ticket) => ticket.id === data.ticket.id ? data.ticket : ticket));
      setActiveTicket(data.ticket);
      setTechProofPhotos([]);
      await fetchAllData();
      setTechScreen('HOME');
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };

  // BMB duyệt gợi ý AI & Phân công Kỹ thuật viên (Màn hình 01 & 02 BMB)
  const handleBmbDispatch = async (customTicketId?: string, customTechId?: string) => {
    const targetTicketId = customTicketId || bmbSelectedTicket?.id;
    const targetTechId = customTechId || bmbTechId;
    if (!targetTicketId || !targetTechId) {
      showToast(translate('Vui lòng chọn sự cố và Kỹ thuật viên đang trực!'));
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tickets/${targetTicketId}/approve-assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          finalCategory: bmbCategory,
          finalPriority: bmbPriority,
          assignedTechId: targetTechId,
          bmbAdminNote: bmbNote,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast(data.message || translate('Lỗi khi giao việc'));
        return;
      }
      showToast(translate(`Đã duyệt và phân công kỹ thuật viên thành công.`));
      setBmbSelectedTicket(data.ticket);
      await fetchAllData();
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/notifications/read-all`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast(data.message || translate('Không thể cập nhật thông báo. Vui lòng thử lại.'));
        return;
      }
      setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
      setUnreadCount(0);
      showToast(translate('✓ Đã đánh dấu tất cả thông báo là đã đọc!'));
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    }
  };

  const handleOpenNotification = async (notification: any) => {
    if (!notification.isRead) {
      try {
        const res = await fetch(`${API_BASE_URL}/notifications/${notification.id}/read`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'bypass-tunnel-reminder': 'true',
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          showToast(data.message || translate('Không thể cập nhật thông báo. Vui lòng thử lại.'));
        } else {
          setNotifications((current) =>
            current.map((item) => item.id === notification.id ? { ...item, isRead: true } : item)
          );
          setUnreadCount((count) => Math.max(0, count - 1));
        }
      } catch {
        showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
      }
    }

    if (notification.ticketId) {
      const relatedTicket = tickets.find((ticket) => ticket.id === notification.ticketId);
      if (relatedTicket) {
        if (user?.role === 'BMB') {
          handleSelectBmbTicket(relatedTicket);
          setBmbNavTab('TICKETS');
        } else if (user?.role === 'TECHNICIAN') {
          openTechnicianTask(relatedTicket);
        } else {
          setActiveTicket(relatedTicket);
          setResScreen('TICKET_DETAIL');
        }
      }
    }
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
                <Text style={{ fontSize: 24, marginRight: 8 }}>🏢</Text>
                <Text style={styles.bmbLoginBrandText}>ResiFix BMB</Text>
              </View>
              <Text style={styles.bmbLoginHeroTitle}>
                {translate("Hệ thống Quản lý & Điều phối Sự cố Tòa nhà Thông minh")}</Text>
            </View>

            {/* Cột phải màu trắng */}
            <View style={styles.bmbLoginRightWhite}>
              <Text style={styles.bmbLoginFormHeading}>{translate("Đăng nhập")}</Text>

              {toastMsg && (
                <View style={[styles.toastBanner, { marginHorizontal: 0, marginBottom: 12 }]}>
                  <Text style={styles.toastText}>{toastMsg}</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>{translate("Email hoặc Số điện thoại công vụ *")}</Text>
              <TextInput
                style={styles.bmbWebInput}
                value={phoneInput}
                onChangeText={setPhoneInput}
                placeholder="myhanh.bmb@resifix.vn"
                placeholderTextColor="#94A3B8"
              />

              <Text style={styles.fieldLabel}>{translate("Mật khẩu *")}</Text>
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
                <Text style={styles.rememberText}>{translate("Duy trì đăng nhập trên trình duyệt này")}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.bmbWebLoginBtn}
                onPress={() => handleLogin()}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.bmbWebLoginBtnText}>{translate("Đăng nhập Hệ thống BMB")}</Text>
                )}
              </TouchableOpacity>

              {/* Switch login presentation only; authentication still uses the API. */}
              <View style={[styles.demoSwitchRow, { marginTop: 22 }]}>
                <TouchableOpacity
                  style={styles.demoChip}
                  onPress={() => {
                    setLoginMode('MOBILE');
                  }}
                >
                  <Text style={styles.demoChipText}>{translate("📱 Xem màn hình Login Mobile (Cư dân/KTV)")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </SafeAreaView>
      );
    }

    // B. Giao diện Đăng nhập Mobile App (Cư dân & Kỹ thuật viên chuẩn Figma 00 Mobile)
    return (
      <SafeAreaView style={styles.screenBg}>
        <ThemedStatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={styles.loginScroll}>
          <View style={styles.mobileFrame}>
            <View style={styles.brandCenter}>
              <View style={styles.appIconBox}>
                <Text style={styles.appIconSymbol}>🏢🔧</Text>
              </View>
              <Text style={styles.brandTitle}>ResiFix</Text>
              <Text style={styles.brandSub}>
                {translate("Hệ thống Quản lý & Khắc phục Sự cố Tòa nhà")}</Text>
              <View style={styles.geminiBadgePill}>
                <Text style={styles.geminiBadgeText}>{translate("✨ Tích hợp Trợ lý Gemini AI")}</Text>
              </View>
            </View>

            {toastMsg && (
              <View style={styles.toastBanner}>
                <Text style={styles.toastText}>{toastMsg}</Text>
              </View>
            )}

            <View style={styles.loginCard}>
              <Text style={styles.loginCardTitle}>{translate("Đăng nhập tài khoản")}</Text>
              <Text style={styles.loginCardSub}>
                {translate("Sử dụng số điện thoại đã đăng ký với Ban quản lý tòa nhà")}</Text>

              <Text style={styles.fieldLabel}>{translate("Số điện thoại *")}</Text>
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

              <Text style={styles.fieldLabel}>{translate("Mật khẩu *")}</Text>
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
                  <Text style={styles.rememberText}>{translate("Ghi nhớ đăng nhập")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    showToast(translate('Tính năng quên mật khẩu chưa được hỗ trợ. Vui lòng liên hệ Ban quản lý.'))
                  }
                >
                  <Text style={styles.forgotText}>{translate("Quên mật khẩu?")}</Text>
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
                  <Text style={styles.loginSubmitText}>{translate("Đăng nhập")}</Text>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.demoSwitchRow}>
              <TouchableOpacity
                style={styles.demoChip}
                onPress={() => {
                  setLoginMode('BMB_WEB');
                }}
              >
                <Text style={styles.demoChipText}>{translate("💻 BMB Login")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // PHÂN HỆ 1: CƯ DÂN (RESIDENT) — KHỚP 100% 6 MÀN HÌNH FIGMA CƯ DÂN
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
        <ThemedStatusBar barStyle="dark-content" />
        <View style={styles.mobileShell}>
          {toastMsg && (
            <View style={styles.toastBanner}>
              <Text style={styles.toastText}>{toastMsg}</Text>
            </View>
          )}
          {dataLoadError && (
            <TouchableOpacity style={styles.toastBanner} onPress={() => void fetchAllData()}>
              <Text style={styles.toastText}>{translate('Tải dữ liệu thất bại. Nhấn để thử lại: ')}{dataLoadError}</Text>
            </TouchableOpacity>
          )}

          {resScreen === 'HOME' && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={{ paddingBottom: 28 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.resHomeHeader}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.aptSmallLabel}>{translate("Thông tin căn hộ")}</Text>
                  <Text style={styles.aptBigTitle}>
                  {translate('Căn hộ ')}{user.apartmentCode || translate('Chưa cập nhật')} • {user.buildingBlock || translate('Chưa cập nhật')}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.bellCircleBtn}
                  onPress={() => setResScreen('NOTI_PROFILE')}
                >
                  <Text style={{ fontSize: 20 }}>🔔</Text>
                  {unreadCount > 0 && <View style={styles.bellRedDot} />}
                </TouchableOpacity>
              </View>

              <View style={styles.ctaHeroCard}>
                <View style={styles.ctaTitleRow}>
                  <Text style={styles.qrFrameIcon}>⛶</Text>
                  <Text style={styles.ctaHeroTitle}>{translate("Phát hiện sự cố tòa nhà?")}</Text>
                </View>
                <Text style={styles.ctaHeroDesc}>
                  {translate("Quét mã QR thiết bị, chụp ảnh hoặc đọc bằng giọng nói. Trợ lý AI sẽ tự động phân loại giúp bạn!")}</Text>
                <TouchableOpacity
                  style={styles.ctaPrimaryBtn}
                  onPress={() => setResScreen('CREATE_REPORT')}
                >
                  <Text style={styles.ctaPrimaryBtnText}>{translate("📷 + Báo cáo sự cố ngay")}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitleText}>{translate("Sự cố của tôi")}</Text>
                <TouchableOpacity onPress={() => setResScreen('HISTORY')}>
                  <Text style={styles.seeHistoryLink}>{translate("Xem lịch sử >")}</Text>
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
                    {translate("Tất cả (")}{tickets.length})
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
                    {translate("Chờ duyệt (")}{pendingCount})
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
                    {translate("Đang sửa (")}{inProgressCount})
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
                    {translate("Hoàn thành (")}{completedCount})
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
                            ? translate('Hoàn thành')
                            : isPending
                              ? translate('Chờ duyệt')
                              : isClosed
                                ? translate('Đã đóng')
                                : translate('Đang xử lý')}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.cardMainTitle}>{t.title}</Text>
                    <Text style={styles.cardLocationText}>📍 {t.locationNote}</Text>

                    {isCompleted ? (
                      <View style={styles.completedActionBar}>
                        <Text style={styles.completedActionLabel}>
                          {translate("📸 KTV đã gửi ảnh nghiệm thu")}</Text>
                        <TouchableOpacity
                          style={styles.resolvedGreenBtn}
                          onPress={() => {
                            setActiveTicket(t);
                            setResScreen('TICKET_DETAIL');
                          }}
                        >
                          <Text style={styles.resolvedGreenBtnText}>{translate("Đã giải quyết")}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.cardFooterGrayBar}>
                        <Text style={styles.cardFooterGrayText}>
                          {translate('KTV: ')}{t.assignedTech?.fullName || translate('Chưa phân công')} • {formatDateTime(t.assignedAt || t.updatedAt || t.createdAt)}</Text>
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
                  <Text style={styles.subScreenTitle}>{translate("Tạo báo cáo sự cố")}</Text>
                </View>

                <Text style={styles.stepTitle}>{translate("1. Vị trí & Thiết bị gặp sự cố *")}</Text>
                <TouchableOpacity
                  style={styles.qrDashedBtn}
                  onPress={() => setQrModalVisible(true)}
                >
                  <Text style={styles.qrDashedBtnText}>
                    {translate("📷 Quét mã QR thiết bị để tự động điền")}</Text>
                </TouchableOpacity>

                {qrModalVisible && (
                  <QrScannerModal
                    visible
                    onClose={() => setQrModalVisible(false)}
                    onScannedCode={handleQrCodeDetected}
                  />
                )}

                {scannedAsset && (
                  <View style={styles.qrRecognizedBox}>
                    <Text style={styles.qrRecognizedTitle}>
                      {translate("✅ Đã nhận diện từ mã QR: ")}{scannedAsset.assetName}
                    </Text>
                    <Text style={styles.qrRecognizedSub}>
                      {translate("Mã thiết bị: ")}{scannedAsset.qrCode} {translate("• Vị trí: ")}{scannedAsset.locationLabel}
                    </Text>
                    <TouchableOpacity onPress={() => setScannedAsset(null)}>
                      <Text style={styles.seeHistoryLink}>{translate('Bỏ thiết bị đã chọn')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {!scannedAsset && (
                  <>
                    <Text style={styles.fieldLabel}>{translate('Vị trí thủ công (nếu hồ sơ chưa có vị trí)')}</Text>
                    <TextInput
                      style={styles.bmbWebInput}
                      value={manualLocation}
                      onChangeText={setManualLocation}
                      placeholder={translate('Nhập tòa nhà, tầng hoặc khu vực')}
                      placeholderTextColor="#94A3B8"
                    />
                  </>
                )}

                <Text style={styles.stepTitle}>{translate("2. Hình ảnh hiện trường (Tối đa 3 ảnh)")}</Text>
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
                          showToast(translate('📸 Đã đính kèm ảnh hiện trường thành công!'));
                        })
                      }
                    >
                      <Text style={styles.addPhotoPlus}>＋</Text>
                      <Text style={styles.addPhotoLabel}>
                        {translate("+ Thêm ảnh (")}{reportPhotos.length}/3)
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={styles.stepTitle}>{translate("3. Mô tả sự cố *")}</Text>
                <View style={styles.descBoxContainer}>
                  <TextInput
                    style={styles.descTextArea}
                    multiline
                    value={reportDesc}
                    onChangeText={setReportDesc}
                    placeholder={translate("Nhập mô tả sự cố bằng tiếng Việt...")}
                  />
                  <View style={styles.descBottomBar}>
                    <Text
                      style={[
                        styles.charCountText,
                        reportDesc.trim().length < 10 && { color: '#DC2626' },
                      ]}
                    >
                      {reportDesc.length} {translate("ký tự (Đạt chuẩn tối thiểu 10 ký tự)")}</Text>
                    <TouchableOpacity
                      style={styles.voicePillBtn}
                      onPress={() => {
                        showToast(translate('Nhận dạng giọng nói chưa được hỗ trợ. Vui lòng nhập mô tả bằng bàn phím.'));
                      }}
                    >
                      <Text style={styles.voicePillText}>{translate("🎤 Nhận dạng giọng nói chưa hỗ trợ")}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.geminiInfoBox}>
                  <Text style={styles.geminiInfoText}>
                    {translate("✨ Bạn không cần chọn danh mục. Gemini AI sẽ tự động phân loại & đánh giá độ khẩn cấp giúp Ban quản lý!")}</Text>
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
                    <Text style={styles.loginSubmitText}>{translate("Gửi báo cáo sự cố")}</Text>
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
                      {translate("Chi tiết ")}{activeTicket.ticketCode}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: '#D1FAE5' }]}>
                    <Text style={[styles.statusPillText, { color: '#059669' }]}>
                      {activeTicket.status === 'COMPLETED'
                        ? translate('Hoàn thành')
                        : activeTicket.status === 'CLOSED'
                          ? translate('Đã đóng')
                          : translate('Đang xử lý')}
                    </Text>
                  </View>
                </View>

                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>{translate("Tiến độ xử lý sự cố")}</Text>
                  {activeTicket.statusLogs?.length ? activeTicket.statusLogs.map((log: any) => (
                    <View key={log.id} style={styles.timelineRow}>
                      <View style={[styles.timelineDot, { backgroundColor: '#2563EB' }]} />
                      <Text style={styles.timelineText}>
                        {formatDateTime(log.createdAt)} • {log.title}
                        {log.changedBy?.fullName ? ` — ${log.changedBy.fullName}` : ''}
                        {log.note ? ` — ${log.note}` : ''}
                      </Text>
                    </View>
                  )) : (
                    <Text style={styles.timelineText}>{translate('Chưa có lịch sử cập nhật.')}</Text>
                  )}
                </View>

                <View style={styles.proofGreenBorderCard}>
                  <Text style={styles.cardBlockTitle}>
                    {translate("📸 Bằng chứng khắc phục từ Kỹ thuật viên")}</Text>
                  <View style={styles.proofCompareRow}>
                    <View style={styles.proofHalfCol}>
                      <View style={styles.proofBoxBefore}>
                        {activeTicket.media?.find((media: any) => media.mediaType === 'SCENE_BEFORE')?.imageUrl ? (
                          <Image
                            source={{ uri: activeTicket.media.find((media: any) => media.mediaType === 'SCENE_BEFORE').imageUrl }}
                            style={{ width: '100%', height: '100%', borderRadius: 10 }}
                          />
                        ) : <Text style={styles.proofPlaceholderText}>{translate('Chưa có ảnh hiện trường.')}</Text>}
                      </View>
                      <Text style={styles.proofLabelBefore}>{translate("Ảnh trước khi sửa")}</Text>
                    </View>
                    <View style={styles.proofHalfCol}>
                      <View style={styles.proofBoxAfter}>
                        {activeTicket.media?.find((media: any) => media.mediaType === 'REPAIR_PROOF')?.imageUrl ? (
                          <Image
                            source={{ uri: activeTicket.media.find((media: any) => media.mediaType === 'REPAIR_PROOF').imageUrl }}
                            style={{ width: '100%', height: '100%', borderRadius: 10 }}
                          />
                        ) : <Text style={styles.proofAfterSmallText}>{translate('Chưa có ảnh nghiệm thu.')}</Text>}
                      </View>
                      <Text style={styles.proofLabelAfter}>{translate("✅ Ảnh sau khi sửa")}</Text>
                    </View>
                  </View>
                  {activeTicket.techRepairNote ? (
                    <View style={styles.techNoteGrayBox}>
                      <Text style={styles.techNoteGrayText}>{translate('Ghi chú KTV:')} {activeTicket.techRepairNote}</Text>
                    </View>
                  ) : null}
                </View>

                {activeTicket.status === 'COMPLETED' && (
                  <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>
                    {translate("Đánh giá chất lượng xử lý (Tùy chọn)")}</Text>
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
                    placeholder={translate("Nhập nhận xét của bạn về kỹ thuật viên...")}
                    placeholderTextColor="#94A3B8"
                    value={ratingComment}
                    onChangeText={setRatingComment}
                  />
                  </View>
                )}
              </ScrollView>

              {activeTicket.status === 'COMPLETED' && (
                <View style={styles.stickyBottomBar}>
                  <TouchableOpacity
                    style={styles.confirmCloseGreenBtn}
                    onPress={() => handleConfirmResolved(activeTicket)}
                    disabled={loading}
                  >
                    <Text style={styles.confirmCloseGreenText}>
                      {translate("✅ Xác nhận Đã giải quyết (Đóng sự cố)")}</Text>
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
                <Text style={styles.subScreenTitle}>{translate("Thông báo & Hồ sơ")}</Text>
              </View>

              <View style={styles.whiteSectionCard}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.sectionTitleText}>{translate("Thông báo")}</Text>
                  <View style={styles.unreadPillBadge}>
                    <Text style={styles.unreadPillText}>{unreadCount} {translate("chưa đọc")}</Text>
                  </View>
                  {unreadCount > 0 && (
                    <TouchableOpacity onPress={handleMarkAllNotificationsRead}>
                      <Text style={styles.seeHistoryLink}>{translate('Đánh dấu đã đọc')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {notifications.length > 0 ? notifications.slice(0, 4).map((n: any) => (
                  <TouchableOpacity key={n.id} style={styles.notiBlueItem} onPress={() => handleOpenNotification(n)}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.notiItemTitle}>{n.title}</Text>
                      <Text style={styles.notiItemTime}>{formatDateTime(n.createdAt)}</Text>
                    </View>
                    {!n.isRead && <View style={styles.blueUnreadDot} />}
                  </TouchableOpacity>
                )) : (
                  <Text style={styles.techInfoLine}>{translate('Chưa có thông báo.')}</Text>
                )}
              </View>

              <View style={styles.whiteSectionCard}>
                <Text style={styles.cardBlockTitle}>{translate("Hồ sơ cư dân")}</Text>
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
                    {user.apartmentCode || translate('Chưa cập nhật')} • {user.buildingBlock || translate('Chưa cập nhật')}
                  </Text>
                </View>
                <View style={styles.profileInfoRow}>
                  <View style={styles.profileInfoIconBox}>
                    <Text style={{ fontSize: 16 }}>📞</Text>
                  </View>
                  <Text style={styles.profileInfoValue}>{user.phone}</Text>
                </View>
                <PreferenceControls />
                <TouchableOpacity
                  style={styles.logoutRedOutlineBtn}
                  onPress={handleLogout}
                >
                  <Text style={styles.logoutRedOutlineText}>{translate("↪ Đăng xuất tài khoản")}</Text>
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
                  <Text style={styles.subScreenTitle}>{translate("Lịch sử sự cố")}</Text>
                </View>
                <View style={styles.totalCountBadge}>
                  <Text style={styles.totalCountText}>{translate("Tổng: ")}{tickets.length} {translate("sự cố")}</Text>
                </View>
              </View>

              <View style={styles.searchBarBox}>
                <Text style={{ marginRight: 8, color: '#64748B' }}>🔍</Text>
                <TextInput
                  style={styles.searchBarInput}
                  placeholder={translate("Tìm mã Ticket (#RF-...) hoặc tên sự cố...")}
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
                    {translate("Tất cả (")}{tickets.length})
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
                    {translate("Đã đóng (")}{closedTickets.length})
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
                        {t.status === 'CLOSED' ? translate('Đã đóng') : translate(t.status)}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.cardMainTitle}>{t.title}</Text>
                  <Text style={styles.cardLocationText}>
                    📍 {t.locationNote} {translate("• Danh mục:")}{' '}
                    {translate(CATEGORY_SHORT_VN[t.finalCategory || t.aiSuggestedCategory] || 'Điện - Nước')}
                  </Text>
                  <View style={styles.historyFooterBar}>
                    <View>
                      <Text style={styles.historyClosedDate}>✅ Đã đóng: 28/10/2026</Text>
                      <Text style={styles.historyTechName}>
                        (KTV: {t.assignedTech?.fullName || translate('Chưa phân công')})
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
                  <Text style={{ fontSize: 18 }}>🏠</Text>
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      resScreen === 'HOME' && styles.figmaNavLabelActive,
                    ]}
                  >
                    {translate("Trang chủ")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.figmaNavTab}
                  onPress={() => setResScreen('HISTORY')}
                >
                  <Text style={{ fontSize: 18 }}>🕒</Text>
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      resScreen === 'HISTORY' && styles.figmaNavLabelActive,
                    ]}
                  >
                    {translate("Lịch sử")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.figmaNavTab}
                  onPress={() => setResScreen('NOTI_PROFILE')}
                >
                  <Text style={{ fontSize: 18 }}>👤</Text>
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      resScreen === 'NOTI_PROFILE' && styles.figmaNavLabelActive,
                    ]}
                  >
                    {translate("Cá nhân")}</Text>
                </TouchableOpacity>
              </View>
            )}
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // PHÂN HỆ 2: KỸ THUẬT VIÊN (TECHNICIAN) — KHỚP 100% 5 MÀN HÌNH FIGMA KTV
  // ============================================================================
  if (user.role === 'TECHNICIAN') {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const assignedCount = tickets.filter((t) => t.status === 'ASSIGNED').length;
    const inProgressCount = tickets.filter((t) => t.status === 'IN_PROGRESS').length;
    const completedCount = tickets.filter(
      (t) => t.status === 'COMPLETED' || t.status === 'CLOSED'
    ).length;
    const closedCount = tickets.filter((t) => t.status === 'CLOSED').length;
    const waitingResidentCount = tickets.filter((t) => t.status === 'COMPLETED').length;
    const completedThisMonth = tickets.filter((t) => {
      const completedAt = t.completedAt ? new Date(t.completedAt) : null;
      return completedAt && completedAt >= monthStart;
    });
    const ratedTickets = tickets.filter((t) => Number.isInteger(t.ratingStars) && t.ratingStars >= 1 && t.ratingStars <= 5);
    const averageRating = ratedTickets.length
      ? (ratedTickets.reduce((total, ticket) => total + ticket.ratingStars, 0) / ratedTickets.length).toFixed(1)
      : '—';
    const completedHistory = tickets.filter((t) => t.status === 'COMPLETED' || t.status === 'CLOSED');

    const filteredTechHome = tickets.filter((t) => {
      if (techHomeFilter === 'ASSIGNED') return t.status === 'ASSIGNED';
      if (techHomeFilter === 'IN_PROGRESS') return t.status === 'IN_PROGRESS';
      if (techHomeFilter === 'COMPLETED')
        return t.status === 'COMPLETED' || t.status === 'CLOSED';
      return true;
    });

    const filteredTechHistory = tickets.filter((t) => {
      if (t.status !== 'COMPLETED' && t.status !== 'CLOSED') return false;
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
        <ThemedStatusBar barStyle="dark-content" />
        <View style={styles.mobileShell}>
          {toastMsg && (
            <View style={styles.toastBanner}>
              <Text style={styles.toastText}>{toastMsg}</Text>
            </View>
          )}
          {dataLoadError && (
            <TouchableOpacity style={styles.toastBanner} onPress={() => void fetchAllData()}>
              <Text style={styles.toastText}>{translate('Tải dữ liệu thất bại. Nhấn để thử lại: ')}{dataLoadError}</Text>
            </TouchableOpacity>
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
                    {user.specialtyLabel || translate('Chưa cập nhật chuyên môn')}
                  </Text>
                  <Text style={styles.aptBigTitle}>
                    {user.fullName} • {user.shiftName || translate('Ca trực chưa cập nhật')}</Text>
                </View>
                <TouchableOpacity
                  style={styles.bellCircleBtn}
                  onPress={() => setTechScreen('NOTI_PROFILE')}
                >
                  <Text style={{ fontSize: 20 }}>🔔</Text>
                  {unreadCount > 0 && <View style={styles.bellRedDot} />}
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.techDutyCard}
                onPress={handleToggleOnDuty}
                disabled={dutyUpdating}
              >
                <Text style={styles.techDutyTitle}>
                  {dutyUpdating ? translate('Đang cập nhật trạng thái...') : translate("Trạng thái làm việc: ")}{!dutyUpdating && (user.isOnDuty !== false ? '🟢' : '⚪')}{' '}
                  {!dutyUpdating && (user.isOnDuty !== false
                    ? translate('Đang trong ca trực (On-duty)')
                    : translate('Ngoài ca trực (Off-duty)'))}
                </Text>
                <Text style={styles.techDutySub}>
                  {translate('Công việc đang mở: ')}{assignedCount + inProgressCount} • {translate('Đã hoàn thành: ')}{completedCount}</Text>
              </TouchableOpacity>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitleText}>{translate("Công việc được giao")}</Text>
                <TouchableOpacity onPress={() => setTechScreen('HISTORY')}>
                  <Text style={styles.seeHistoryLink}>{translate("Xem lịch sử >")}</Text>
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
                    {translate("Tất cả (")}{tickets.length})
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
                    {translate("Chờ xử lý (")}{assignedCount})
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
                    {translate("Đang sửa (")}{inProgressCount})
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
                    {translate("Hoàn thành (")}{completedCount})
                  </Text>
                </TouchableOpacity>
              </ScrollView>

              {filteredTechHome.map((t) => {
                const isAssigned = t.status === 'ASSIGNED';
                const isInProgress = t.status === 'IN_PROGRESS';
                const prio = t.finalPriority || t.aiSuggestedPriority;
                return (
                  <TouchableOpacity
                    key={t.id}
                    activeOpacity={0.9}
                    style={[
                      styles.resTicketCard,
                      isAssigned && { borderColor: '#3B82F6', borderWidth: 1.5 },
                      isInProgress && { borderColor: '#818CF8', borderWidth: 1.5 },
                    ]}
                    onPress={() => openTechnicianTask(t)}
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
                              ? { color: '#1D61E7' }
                              : isInProgress
                                ? { color: '#4F46E5' }
                                : { color: '#059669' },
                          ]}
                        >
                          {isAssigned
                            ? translate('Đã phân công')
                            : isInProgress
                              ? translate('Đang xử lý')
                              : t.status === 'CLOSED' ? translate('Đã đóng') : translate('Hoàn thành')}
                        </Text>
                      </View>
                    </View>

                    {prio === 'HIGH' && (
                      <Text style={styles.urgentRedText}>
                        {translate("🔥 Ưu tiên: Cao (Khẩn cấp)")}</Text>
                    )}

                    <Text style={styles.cardMainTitle}>{t.title}</Text>
                    <Text style={styles.cardLocationText}>📍 {t.locationNote}</Text>

                    {isAssigned ? (
                      <View style={styles.techAssignActionBar}>
                        <TouchableOpacity
                          style={styles.acceptJobBlueBtn}
                          onPress={() => handleTechAcknowledge(t)}
                          disabled={loading}
                        >
                          {loading ? (
                            <ActivityIndicator color="#FFFFFF" />
                          ) : (
                            <Text style={styles.acceptJobBlueBtnText}>{translate("Nhận việc ngay")}</Text>
                          )}
                        </TouchableOpacity>
                        <Text style={styles.assignedTimeMeta}>
                          {translate('Giao bởi BMB • ')}{formatDateTime(t.assignedAt || t.createdAt)}</Text>
                      </View>
                    ) : (
                      <View style={styles.techInProgressBar}>
                        <Text style={styles.techInProgressText}>
                          {translate('Cập nhật: ')}{formatDateTime(t.updatedAt || t.createdAt)}</Text>
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
                    {translate("Chi tiết sự cố ")}{activeTicket.ticketCode}
                  </Text>
                </View>

                <View style={styles.techDetailTopCard}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardCodeText}>{activeTicket.ticketCode}</Text>
                    <View style={[styles.statusPill, { backgroundColor: '#E0E7FF' }]}>
                      <Text style={[styles.statusPillText, { color: '#4F46E5' }]}>
                        {activeTicket.status === 'IN_PROGRESS'
                          ? translate('Đang xử lý')
                          : activeTicket.status === 'ASSIGNED'
                            ? translate('Đã phân công')
                            : translate('Hoàn thành')}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.cardMainTitle, { marginBottom: 0 }]}>
                    {activeTicket.title}
                  </Text>
                </View>

                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>{translate("Thông tin kỹ thuật")}</Text>
                  <Text style={styles.techInfoLine}>
                    {translate('📍 Vị trí: ')}{activeTicket.locationNote || translate('Chưa cập nhật')}
                  </Text>
                  <Text style={styles.techInfoLine}>
                    {translate("🔧 Mã thiết bị (QR):")}{' '}
                    {activeTicket.asset?.qrCode || translate('Không gắn mã thiết bị')}
                  </Text>
                  <Text style={[styles.techInfoLine, { marginBottom: 0 }]}>
                    {translate("⚠️ Độ ưu tiên (BMB duyệt): Cao • Danh mục:")}{' '}
                    {translate(CATEGORY_SHORT_VN[
                      activeTicket.finalCategory || activeTicket.aiSuggestedCategory
                    ] || 'Điện - Nước')}
                  </Text>
                </View>

                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>{translate("Mô tả của cư dân")}</Text>
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
                    {translate("📸 Ảnh nghiệm thu sau khi sửa (Bắt buộc ít nhất 1 ảnh) *")}</Text>
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
                          showToast(translate('📸 Đã tải lên ảnh nghiệm thu sau sửa chữa!'));
                        })
                      }
                    >
                      <Text style={styles.techPlusIcon}>＋</Text>
                      <Text style={styles.techAddPhotoBlueText}>
                        {translate("+ Chụp ảnh hoàn thành (")}{techProofPhotos.length})
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>{translate("Ghi chú kết quả xử lý")}</Text>
                  <TextInput
                    style={styles.ratingInputBox}
                    multiline
                    value={techRepairNote}
                    onChangeText={setTechRepairNote}
                    placeholder={translate("Đã thay mới đoạn ống dẫn nước dưới bồn rửa và kiểm tra không còn rò rỉ.")}
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
                        {translate("Hoàn thành & Gửi ảnh nghiệm thu")}</Text>
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
                <Text style={styles.subScreenTitle}>{translate("Thông báo & Hồ sơ KTV")}</Text>
              </View>

              <View style={styles.whiteSectionCard}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.sectionTitleText}>{translate("Thông báo công việc mới")}</Text>
                  <View style={styles.unreadPillBadge}>
                    <Text style={styles.unreadPillText}>{unreadCount} {translate('chưa đọc')}</Text>
                  </View>
                </View>

                {notifications.length > 0 ? notifications.map((notification: any) => (
                  <TouchableOpacity
                    key={notification.id}
                    style={[styles.notiBlueItem, !notification.isRead && { borderColor: '#60A5FA', borderWidth: 1.5 }]}
                    onPress={() => handleOpenNotification(notification)}
                  >
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.notiItemTitle}>{notification.title}</Text>
                      <Text style={styles.techNotiBodyText}>{notification.message}</Text>
                      <Text style={styles.notiItemTime}>{formatDateTime(notification.createdAt)}</Text>
                    </View>
                    {!notification.isRead && <View style={styles.blueUnreadDot} />}
                  </TouchableOpacity>
                )) : (
                  <Text style={styles.techInfoLine}>{translate('Chưa có thông báo công việc.')}</Text>
                )}
              </View>

              <View style={styles.whiteSectionCard}>
                <Text style={styles.cardBlockTitle}>{translate("Hồ sơ Kỹ thuật viên")}</Text>
                <View style={styles.techProfileHeaderRow}>
                  <View style={styles.techAvatarCircle}>
                    <Text style={{ fontSize: 26, color: '#1D61E7' }}>👷</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.profileNameText}>{user.fullName}</Text>
                    <View style={styles.specialtyPill}>
                      <Text style={styles.specialtyPillText}>
                        {translate('Chuyên môn: ')}{user.specialtyLabel || translate('Chưa cập nhật')}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.techDivider} />

                <Text style={styles.techProfileLine}>
                  {translate('📞 Số điện thoại: ')}{user.phone || translate('Chưa cập nhật')}
                </Text>
                <Text style={styles.techProfileLine}>
                  {translate('🕒 Ca trực: ')}{user.shiftName || translate('Chưa cập nhật')} • {user.isOnDuty ? translate('Đang trực') : translate('Ngoài ca trực')}</Text>
                <Text style={styles.techProfileLine}>
                  {translate('📊 Hoàn thành trong tháng này: ')}{completedThisMonth.length} • {translate('Đánh giá trung bình: ')}{averageRating}</Text>

                <PreferenceControls />
                <TouchableOpacity
                  style={styles.logoutRedOutlineBtn}
                onPress={handleLogout}
                >
                  <Text style={styles.logoutRedOutlineText}>{translate("Đăng xuất tài khoản")}</Text>
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
                {translate("Lịch sử công việc đã hoàn thành")}</Text>
              <View
                style={[styles.unreadPillBadge, { alignSelf: 'flex-start', marginVertical: 10 }]}
              >
                <Text style={styles.unreadPillText}>
                  {translate('Hoàn thành trong tháng này: ')}{completedThisMonth.length} {translate('việc')}</Text>
              </View>

              <View style={styles.searchBarBox}>
                <Text style={{ marginRight: 8, color: '#64748B' }}>🔍</Text>
                <TextInput
                  style={styles.searchBarInput}
                  placeholder={translate("Tìm mã Ticket (#RF-...) hoặc mã thiết bị (WP-...)...")}
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
                    {translate("Tất cả (")}{tickets.length})
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
                    {translate("Đã đóng (")}{closedCount})
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
                    {translate("Chờ cư dân nghiệm thu (")}{waitingResidentCount})
                  </Text>
                </TouchableOpacity>
              </View>

              {filteredTechHistory.map((t) => {
                const isWaitingAccept = t.status === 'COMPLETED';
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={styles.resTicketCard}
                    onPress={() => openTechnicianTask(t)}
                  >
                    <View style={styles.cardTopRow}>
                      <Text style={styles.cardCodeText}>{t.ticketCode}</Text>
                      {!isWaitingAccept && (
                        <View style={[styles.statusPill, { backgroundColor: '#E2E8F0' }]}>
                          <Text style={[styles.statusPillText, { color: '#475569' }]}>
                            {translate("Đã đóng")}</Text>
                        </View>
                      )}
                    </View>

                    {isWaitingAccept && (
                      <View style={styles.waitingResidentBanner}>
                        <Text style={styles.waitingResidentBannerText}>
                          {translate("Hoàn thành (Chờ cư dân xác nhận)")}</Text>
                      </View>
                    )}

                    <Text style={styles.cardMainTitle}>{t.title}</Text>
                    <Text style={styles.cardLocationText}>📍 {t.locationNote}</Text>

                    {isWaitingAccept ? (
                      <View style={styles.sentPhotoBlueBar}>
                        <Text style={styles.sentPhotoBlueText}>
                          {translate("📸 Đã gửi 2 ảnh nghiệm thu lúc 08:40 hôm nay")}</Text>
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
                  <Text style={{ fontSize: 18 }}>🏠</Text>
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      techScreen === 'HOME' && styles.figmaNavLabelActive,
                    ]}
                  >
                    {translate("Trang chủ")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.figmaNavTab}
                  onPress={() => setTechScreen('HISTORY')}
                >
                  <Text style={{ fontSize: 18 }}>🕒</Text>
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      techScreen === 'HISTORY' && styles.figmaNavLabelActive,
                    ]}
                  >
                    {translate("Lịch sử")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.figmaNavTab}
                  onPress={() => setTechScreen('NOTI_PROFILE')}
                >
                  <Text style={{ fontSize: 18 }}>👤</Text>
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      techScreen === 'NOTI_PROFILE' && styles.figmaNavLabelActive,
                    ]}
                  >
                    {translate("Hồ sơ")}</Text>
                </TouchableOpacity>
              </View>
            )}
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // PHÂN HỆ 3: BAN QUẢN LÝ TÒA NHÀ (BMB WEB APPLICATION) — KHỚP 100% 4 MÀN HÌNH FIGMA BMB
  // ============================================================================
  const bmbPendingCount = tickets.filter((t) => t.status === 'PENDING').length;
  const bmbAssignedCount = tickets.filter((t) => t.status === 'ASSIGNED').length;
  const bmbInProgressCount = tickets.filter((t) => t.status === 'IN_PROGRESS').length;
  const bmbCompletedCount = tickets.filter((t) => t.status === 'COMPLETED').length;
  const bmbClosedCount = tickets.filter((t) => t.status === 'CLOSED').length;
  const onDutyTechnicianCount = technicians.filter((tech) => tech.isOnDuty).length;
  const openTechnicianWorkCount = technicians.reduce(
    (total, tech) => total + (Array.isArray(tech.assignedTickets) ? tech.assignedTickets.length : 0),
    0
  );
  const availableTechnicianCount = technicians.filter(
    (tech) => tech.isOnDuty && (tech.assignedTickets?.length ?? 0) === 0
  ).length;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const ticketsCreatedToday = tickets.filter((ticket) => ticket.createdAt && new Date(ticket.createdAt) >= startOfToday).length;
  const notificationsCreatedToday = notifications.filter((notification) => notification.createdAt && new Date(notification.createdAt) >= startOfToday).length;

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
  const viewingTechTickets = tickets.filter(
    (ticket) => ticket.assignedTechId === bmbViewingWorkloadTech?.id &&
      (ticket.status === 'ASSIGNED' || ticket.status === 'IN_PROGRESS')
  );
  const isUrgentNotification = (notification: any) =>
    notification.type === 'NEW_INCIDENT_AI' ||
    notification.type === 'AI_TIMEOUT_ALERT' ||
    notification.ticket?.finalPriority === 'HIGH';
  const isTechnicianNotification = (notification: any) =>
    notification.type === 'TASK_ASSIGNED' || notification.type === 'STATUS_UPDATED';
  const filteredBmbNotifications = notifications.filter((notification) => {
    if (bmbNotiFilter === 'UNREAD') return !notification.isRead;
    if (bmbNotiFilter === 'URGENT') return isUrgentNotification(notification);
    if (bmbNotiFilter === 'TECH') return isTechnicianNotification(notification);
    return true;
  });
  const urgentNotificationCount = notifications.filter(isUrgentNotification).length;
  const technicianNotificationCount = notifications.filter(isTechnicianNotification).length;

  return (
    <SafeAreaView style={styles.bmbWebRoot}>
      <View style={styles.bmbDesktopLayout}>
        {dataLoadError && (
          <TouchableOpacity
            style={[styles.toastBanner, { position: 'absolute', zIndex: 100, top: 8, right: 8 }]}
            onPress={() => void fetchAllData()}
          >
            <Text style={styles.toastText}>{translate('Tải dữ liệu thất bại. Nhấn để thử lại: ')}{dataLoadError}</Text>
          </TouchableOpacity>
        )}
        {/* ==================================================================== */}
        {/* CỘT 1: SIDEBAR TRÁI CỐ ĐỊNH CHUẨN FIGMA BMB 01, 02, 03               */}
        {/* ==================================================================== */}
        <View style={styles.bmbSidebar}>
          <ScrollView
            style={styles.bmbSidebarNavigation}
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.bmbSidebarBrandRow}>
              <Text style={{ fontSize: 22, marginRight: 8 }}>🏢</Text>
              <Text style={styles.bmbSidebarLogoText}>ResiFix BMB</Text>
            </View>
            <Text style={styles.bmbSidebarSubText}>{translate("Hệ thống Quản lý Tòa nhà")}</Text>

            <Text style={styles.bmbWorkspaceHeading}>{translate("KHÔNG GIAN QUẢN LÝ")}</Text>

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
                {translate("📋 Quản lý sự cố (Tickets)")}</Text>
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
                {translate("👷 Kỹ thuật viên ca trực")}</Text>
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
                {translate("🔔 Thông báo hệ thống")}</Text>
              <View style={styles.bmbSidebarNewRedTag}>
                <Text style={styles.bmbSidebarNewRedText}>
                  {String(unreadCount).padStart(2, '0')} {translate("mới")}</Text>
              </View>
            </TouchableOpacity>
          </ScrollView>

          {/* Footer sidebar */}
          <View style={styles.bmbSidebarFooter}>
            <PreferenceControls compact />
            <View style={styles.bmbBuildingStatusBox}>
              <Text style={styles.bmbBuildingSmallLabel}>{translate("TÒA NHÀ ĐANG QUẢN LÝ")}</Text>
              <Text style={styles.bmbBuildingName}>ResiFix Residence</Text>
              <Text style={styles.bmbBuildingOnline}>{translate("• Hệ thống đang hoạt động")}</Text>
            </View>

            <View style={styles.bmbAdminFooter}>
              <Text style={styles.bmbAdminNameText}>
                👤 BMB: {user.fullName || translate('Chưa cập nhật hồ sơ')}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  handleLogout();
                }}
              >
                <Text style={styles.bmbSidebarLogoutText}>{translate("↪ Đăng xuất")}</Text>
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
                  <Text style={styles.bmbPageTitle}>{translate("Danh sách Sự cố Tòa nhà")}</Text>
                  <Text style={styles.bmbPageSubtitle}>
                    {translate("Theo dõi, phê duyệt và điều phối xử lý sự cố")}</Text>
                </View>
                  <Text style={styles.bmbDateLabel}>{new Date().toLocaleDateString()}</Text>
              </View>

              {/* 4 Thẻ KPI lớn chuẩn Figma 01 BMB */}
              <View style={styles.bmbKpiRow}>
                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate('Chờ duyệt')}</Text>
                  <View style={styles.cardTopRow}>
                    <Text style={[styles.bmbKpiNumber, { color: '#EA580C' }]}>
                      {String(bmbPendingCount).padStart(2, '0')}
                    </Text>
                    <Text style={{ color: '#EA580C', fontSize: 16 }}>●</Text>
                  </View>
                </View>

                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Đã phân công")}</Text>
                  <View style={styles.cardTopRow}>
                    <Text style={[styles.bmbKpiNumber, { color: '#2563EB' }]}>
                      {String(bmbAssignedCount).padStart(2, '0')}
                    </Text>
                    <Text style={{ color: '#2563EB', fontSize: 16 }}>●</Text>
                  </View>
                </View>

                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Đang xử lý")}</Text>
                  <View style={styles.cardTopRow}>
                    <Text style={[styles.bmbKpiNumber, { color: '#4F46E5' }]}>
                      {String(bmbInProgressCount).padStart(2, '0')}
                    </Text>
                    <Text style={{ color: '#4F46E5', fontSize: 16 }}>●</Text>
                  </View>
                </View>

                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Hoàn thành/Đóng")}</Text>
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
                  placeholder={translate("Tìm mã sự cố, căn hộ hoặc thiết bị...")}
                  placeholderTextColor="#94A3B8"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              {/* Hàng 6 viên thuốc lọc trạng thái chuẩn Figma 01 BMB */}
              <View style={styles.chipWrapRow}>
                {[
                    { key: 'ALL', label: `${translate('Tất cả')} (${tickets.length})`, dot: '' },
                  {
                    key: 'PENDING',
                    label: `${translate('Chờ duyệt (')}${bmbPendingCount})`,
                    dot: '🟠 ',
                  },
                  {
                    key: 'ASSIGNED',
                    label: `${translate('Đã phân công')} (${bmbAssignedCount})`,
                    dot: '🔵 ',
                  },
                  {
                    key: 'IN_PROGRESS',
                    label: `${translate('Đang xử lý')} (${bmbInProgressCount})`,
                    dot: '🟣 ',
                  },
                  {
                    key: 'COMPLETED',
                    label: `${translate('Hoàn thành')} (${bmbCompletedCount})`,
                    dot: '🟢 ',
                  },
                  { key: 'CLOSED', label: `${translate('Đã đóng (')}${bmbClosedCount})`, dot: '⚫ ' },
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
                  {translate("Tất cả sự cố (")}{filteredBmbTickets.length})
                </Text>
                <Text style={{ color: '#64748B', fontSize: 12.5 }}>{translate("Mới nhất trước ↓")}</Text>
              </View>

              {/* Danh sách Thẻ Sự cố */}
              {filteredBmbTickets.map((t) => {
                const isSelected = bmbSelectedTicket?.id === t.id;
                const isPending = t.status === 'PENDING';
                const isAssigned = t.status === 'ASSIGNED';
                const isHigh =
                  (t.finalPriority || t.aiSuggestedPriority) === 'HIGH';
                const isFallbackWarning = t.isAiFallbackManual;

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
                            isSelected && { color: '#1D61E7', fontWeight: '800' },
                          ]}
                        >
                          {t.ticketCode}
                        </Text>
                        {isHigh && (
                          <Text style={styles.bmbUrgentInlineDot}> {translate("● Khẩn cấp")}</Text>
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
                                ? { color: '#1D61E7' }
                                : { color: '#4F46E5' },
                          ]}
                        >
                          {isPending
                            ? translate('Chờ duyệt')
                            : isAssigned
                              ? translate('Đã phân công')
                              : t.status === 'IN_PROGRESS'
                                ? translate('Đang xử lý')
                                : translate('Đã đóng')}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.cardMainTitle}>{t.title}</Text>
                    <Text style={styles.cardLocationText}>📍 {t.locationNote}</Text>

                    <View style={[styles.cardTopRow, { marginTop: 10, marginBottom: 0 }]}>
                      {isFallbackWarning && isPending ? (
                        <View style={styles.bmbAiTimeoutTag}>
                          <Text style={styles.bmbAiTimeoutText}>
                            {translate("⚠️ AI quá thời gian chờ - Vui lòng phân loại thủ công (US-19)")}</Text>
                        </View>
                      ) : (
                        <View style={styles.bmbAiPurpleMiniTag}>
                          <Text style={styles.bmbAiPurpleMiniText}>
                            {translate("✨ Gemini gợi ý:")}{' '}
                            {translate(CATEGORY_SHORT_VN[
                              t.finalCategory || t.aiSuggestedCategory
                            ] || 'Điện - Nước')}
                          </Text>
                        </View>
                      )}
                      <Text style={{ fontSize: 11.5, color: '#64748B' }}>
                        {translate("08:42 • Hôm nay")}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* Thanh phân trang dưới đáy chuẩn Figma 01 BMB */}
              <View style={[styles.cardTopRow, { marginTop: 8, paddingBottom: 24 }]}>
                <Text style={{ fontSize: 12, color: '#64748B' }}>
                  {translate("Hiển thị ")}{filteredBmbTickets.length} {translate("trong tổng số ")}{tickets.length} {translate("sự cố")}</Text>
                <View style={styles.rowCenter}>
                  <View style={styles.pageNumActive}>
                    <Text style={{ color: '#1D61E7', fontWeight: '800', fontSize: 12 }}>
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
                      {translate("Chi tiết sự cố ")}{bmbSelectedTicket.ticketCode}
                    </Text>
                    <Text style={{ fontSize: 16, color: '#64748B' }}>✕</Text>
                  </View>

                  <View style={[styles.cardTopRow, { marginBottom: 14 }]}>
                    <View style={[styles.statusPill, { backgroundColor: '#FEF3C7' }]}>
                      <Text style={[styles.statusPillText, { color: '#D97706' }]}>
                        {bmbSelectedTicket.status === 'PENDING'
                          ? translate('Chờ duyệt')
                          : translate(bmbSelectedTicket.status)}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 12, color: '#64748B' }}>
                      {translate("Tiếp nhận lúc 08:42 hôm nay")}</Text>
                  </View>

                  <Text style={styles.bmbSmallSectionHead}>
                    {translate("THÔNG TIN CƯ DÂN PHẢN ÁNH")}</Text>
                  <View style={[styles.cardTopRow, { marginTop: 6 }]}>
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#0F172A', flex: 1 }}>
                      📍 {bmbSelectedTicket.locationNote}
                    </Text>
                    <View style={styles.qrVerifiedPill}>
                      <Text style={styles.qrVerifiedPillText}>{translate("📷 Đã xác thực qua QR")}</Text>
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
                      {translate("2 ảnh đính kèm")}</Text>
                  </View>

                  {/* HỘP VIỀN TÍM: PHÂN TÍCH & GỢI Ý TỪ GEMINI FLASH AI (TRỢ LÝ QUYẾT ĐỊNH) */}
                  <View style={styles.bmbGeminiPurpleCard}>
                    <View style={styles.cardTopRow}>
                      <Text style={styles.bmbGeminiCardTitle}>
                        {translate("✨ Phân tích & Gợi ý từ Gemini Flash")}{'\n'}{translate("AI (Trợ lý quyết định)")}</Text>
                      <View style={styles.bmbLatencyGreenPill}>
                        <Text style={styles.bmbLatencyGreenText}>
                          {translate("⚡ 1.2s • JSON Hợp lệ")}</Text>
                      </View>
                    </View>

                    <Text style={styles.bmbAiSummaryBullet}>
                      {translate("• Tóm tắt AI: ")}{bmbSelectedTicket.aiSummary || bmbSelectedTicket.title}
                    </Text>

                    <Text style={styles.fieldLabel}>{translate("Danh mục sự cố")}</Text>
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
                        🔧 {translate(CATEGORY_VN[bmbCategory] || 'Hệ thống Điện - Nước')}
                      </Text>
                      <Text style={{ color: '#64748B' }}>⌄</Text>
                    </TouchableOpacity>

                    <Text style={styles.fieldLabel}>{translate("Mức độ ưu tiên")}</Text>
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
                        {translate(PRIORITY_VN[bmbPriority])}
                      </Text>
                      <Text style={{ color: '#DC2626' }}>⌄</Text>
                    </TouchableOpacity>

                    <Text style={styles.bmbRiskR1Hint}>
                      {translate("💡 BMB có toàn quyền giữ nguyên hoặc chỉnh sửa gợi ý của AI trước khi duyệt (Risk R1).")}</Text>
                  </View>

                  {/* Phân công Kỹ thuật viên đang trực */}
                  <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                    {translate("👷 Phân công Kỹ thuật viên đang trực")}</Text>
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
                      {technicians.find((x) => x.id === bmbTechId)?.fullName || translate('Chưa chọn kỹ thuật viên')}{' '}
                      ({technicians.find((x) => x.id === bmbTechId)?.assignedTickets?.length ?? 0} {translate('việc đang mở')})</Text>
                    <Text style={{ color: '#64748B' }}>⌄</Text>
                  </TouchableOpacity>
                  <Text style={{ fontSize: 11.5, color: '#64748B', marginTop: 6 }}>
                    {technicians.find((x) => x.id === bmbTechId)?.shiftName || translate('Ca trực chưa cập nhật')} • {technicians.find((x) => x.id === bmbTechId)?.specialtyLabel || translate('Chuyên môn chưa cập nhật')}</Text>

                  <View style={styles.techDivider} />
                  <Text style={{ fontSize: 11.5, color: '#64748B', marginBottom: 10 }}>
                    {translate("Bạn có thể điều chỉnh gợi ý AI trước khi giao việc.")}</Text>

                  <TouchableOpacity
                    style={styles.bmbWebLoginBtn}
                    onPress={() => handleBmbDispatch()}
                    disabled={loading}
                  >
                    <Text style={styles.bmbWebLoginBtnText}>
                      {translate("✅ Xác nhận Phân loại & Giao việc ngay")}</Text>
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
              {toastMsg && (
                <View style={[styles.toastBanner, { marginHorizontal: 0 }]}>
                  <Text style={styles.toastText}>{toastMsg}</Text>
                </View>
              )}
              <Text style={styles.bmbPageTitle}>
                {translate("Danh sách Kỹ thuật viên & Tải công việc (Workload)")}</Text>
              <Text style={styles.bmbPageSubtitle}>
                {translate("Chọn KTV để giao việc mới hoặc kiểm tra tiến độ các việc đang xử lý (FR06)")}</Text>

              <TouchableOpacity style={styles.technicianAddButton} onPress={openCreateTechnician}>
                <Text style={styles.technicianAddButtonText}>＋ {translate('Thêm kỹ thuật viên')}</Text>
              </TouchableOpacity>

              <View style={[styles.chipWrapRow, { marginTop: 12 }]}>
                <View style={styles.bmbStatPill}>
                  <Text style={styles.bmbStatPillText}>{translate('🟢 Đang trực: ')}{onDutyTechnicianCount} {translate('KTV')}</Text>
                </View>
                <View style={styles.bmbStatPill}>
                  <Text style={styles.bmbStatPillText}>{translate('🛠️ Việc đang mở: ')}{openTechnicianWorkCount}</Text>
                </View>
                <View style={styles.bmbStatPill}>
                  <Text style={styles.bmbStatPillText}>{translate('✅ Rảnh: ')}{availableTechnicianCount} {translate('KTV')}</Text>
                </View>
              </View>

              {technicians.length === 0 ? (
                <View style={styles.technicianEmptyState}>
                  <Text style={styles.technicianEmptyText}>
                    {translate('Chưa có kỹ thuật viên đang hoạt động.')}
                  </Text>
                </View>
              ) : technicians.map((tech: any) => {
                const activeJobsCount = tech.assignedTickets?.length ?? 0;
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
                              ? `${translate('🟢 Đang trực')} • ${tech.shiftName || translate('Ca chưa cập nhật')}`
                              : `${translate('⚪ Ngoài ca trực')} • ${tech.shiftName || translate('Ca chưa cập nhật')}`}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {tech.isOnDuty && (
                      <>
                        <Text style={[styles.cardLocationText, { marginTop: 10 }]}>
                          {translate('🔧 Chuyên môn: ')}{tech.specialtyLabel || translate('Chưa cập nhật')}
                        </Text>
                        <Text
                          style={{
                            fontSize: 12.5,
                            fontWeight: '700',
                            color: '#059669',
                            marginTop: 6,
                          }}
                        >
                          {activeJobsCount === 0
                            ? translate('Không có việc đang mở.')
                            : `${translate('Đang mở: ')}${activeJobsCount} ${translate('việc')}`}
                        </Text>

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
                                ? translate('[+ Giao việc mới đang chọn]')
                                : translate('[+ Giao việc mới]')}
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
                                  ? translate(`[👁️ Đang xem ${activeJobsCount} việc đang làm →]`)
                                  : translate(`[Xem ${activeJobsCount} việc đang làm]`)}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </>
                    )}

                    <View style={styles.technicianActions}>
                      <TouchableOpacity
                        style={styles.technicianEditButton}
                        onPress={() => openEditTechnician(tech)}
                      >
                        <Text style={styles.technicianEditButtonText}>{translate('Sửa')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.technicianDeleteButton}
                        onPress={() => {
                          setSelectedTechnician(tech);
                          setTechnicianFormError(null);
                          setTechnicianDialogMode('delete');
                        }}
                      >
                        <Text style={styles.technicianDeleteButtonText}>{translate('Xóa')}</Text>
                      </TouchableOpacity>
                    </View>
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
                  {translate("＋ Giao việc mới cho KTV:")}{' '}
                  {bmbAssignTargetTech?.fullName || translate('Chưa chọn kỹ thuật viên')}
                </Text>
                <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
                  {translate("Chuyên môn:")}{' '}
                  {bmbAssignTargetTech?.specialtyLabel || translate('Chưa cập nhật')} • {bmbAssignTargetTech?.shiftName || translate('Ca trực chưa cập nhật')}</Text>

                <Text style={styles.fieldLabel}>
                  {translate("Chọn sự cố đang chờ phân công (Phù hợp chuyên môn):")}</Text>

                {pendingTicketsForRadio.map((pt) => {
                  const isRadioChecked = bmbRadioTicketId === pt.id;
                  const priority = pt.finalPriority || pt.aiSuggestedPriority;
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
                        <Text style={{ fontSize: 14, color: '#1D61E7', marginRight: 6 }}>
                          {isRadioChecked ? '🔘' : '⚪'}
                        </Text>
                        <Text style={{ fontWeight: '800', color: '#1D61E7', fontSize: 13 }}>
                          {pt.ticketCode}
                        </Text>
                        {priority && <View style={styles.bmbMiniOrangeBadge}>
                          <Text style={styles.bmbMiniOrangeText}>{translate('Ưu tiên: ')}{translate(PRIORITY_VN[priority] || priority)}</Text>
                        </View>}
                        <View style={styles.bmbMiniPurpleBadge}>
                          <Text style={styles.bmbMiniPurpleText}>
                            ✨ {translate('AI: ')}{translate(CATEGORY_SHORT_VN[pt.aiSuggestedCategory] || 'Chưa phân loại')}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 12.5, color: '#0F172A', marginTop: 6 }}>
                        {pt.title} ({pt.locationNote})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {pendingTicketsForRadio.length === 0 && (
                  <Text style={styles.techInfoLine}>{translate('Hiện không có sự cố đang chờ phân công.')}</Text>
                )}

                <Text style={styles.fieldLabel}>{translate("Ghi chú điều phối cho KTV (Tùy chọn):")}</Text>
                <TextInput
                  style={styles.bmbWebInput}
                  value={bmbNote}
                  onChangeText={setBmbNote}
                  placeholder={translate("Mang theo ống nối chữ T...")}
                  placeholderTextColor="#94A3B8"
                />

                <TouchableOpacity
                  style={[styles.bmbWebLoginBtn, { marginTop: 14 }]}
                  onPress={() =>
                    handleBmbDispatch(
                      bmbRadioTicketId,
                      bmbAssignTargetTech?.id || bmbTechId
                    )
                  }
                  disabled={loading || pendingTicketsForRadio.length === 0 || !bmbAssignTargetTech?.id}
                >
                  <Text style={styles.bmbWebLoginBtnText}>
                    {loading ? translate('Đang xử lý...') : translate('Xác nhận giao việc')}</Text>
                </TouchableOpacity>
              </View>

              {/* Khối dưới: Việc đang làm của KTV */}
              <View style={[styles.bmbBlueOutlinePanel, { borderColor: '#6366F1', marginTop: 14 }]}>
                <Text style={[styles.bmbPanelBlueTitle, { color: '#4338CA' }]}>
                  {translate("👁️ Việc đang làm của KTV:")}{' '}
                  {bmbViewingWorkloadTech?.fullName || translate('Chưa chọn kỹ thuật viên')} ({viewingTechTickets.length} {translate('việc đang mở')})</Text>
                {viewingTechTickets.length > 0 ? viewingTechTickets.map((ticket) => (
                  <View key={ticket.id} style={styles.bmbActiveJobItem}>
                    <Text style={{ fontWeight: '800', fontSize: 13, color: '#0F172A' }}>
                      {ticket.ticketCode} • {ticket.title}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#4F46E5', marginTop: 4 }}>
                      {translate(ticket.status === 'ASSIGNED' ? 'Đã phân công' : 'Đang xử lý')} • {ticket.locationNote} • {formatDateTime(ticket.updatedAt || ticket.assignedAt)}
                    </Text>
                  </View>
                )) : (
                  <Text style={styles.techInfoLine}>{translate('Kỹ thuật viên này chưa có việc đang mở.')}</Text>
                )}
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
                    {translate("Trung tâm Thông báo & Nhật ký Hệ thống")}</Text>
                  <Text style={styles.bmbPageSubtitle}>
                    {translate("Cập nhật thời gian thực qua Firebase FCM & Gemini AI (FR08, US-36)")}</Text>
                </View>
                <TouchableOpacity
                  onPress={handleMarkAllNotificationsRead}
                  disabled={unreadCount === 0}
                  style={{ opacity: unreadCount === 0 ? 0.5 : 1 }}
                >
                  <Text style={{ color: '#1D61E7', fontWeight: '700', fontSize: 13 }}>
                    {translate("✓ Đánh dấu tất cả đã đọc")}</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.chipWrapRow, { marginTop: 12 }]}>
                {[
                  { key: 'ALL', label: `${translate('Tất cả')} (${notifications.length})` },
                  { key: 'UNREAD', label: `${translate('🔴 Chưa đọc')} (${unreadCount})` },
                  { key: 'URGENT', label: `${translate('🟣 Sự cố khẩn cấp & AI')} (${urgentNotificationCount})` },
                  { key: 'TECH', label: `${translate('🟢 Cập nhật từ KTV')} (${technicianNotificationCount})` },
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

              {filteredBmbNotifications.length === 0 ? (
                <View style={styles.technicianEmptyState}>
                  <Text style={styles.technicianEmptyText}>
                    {translate('Không có thông báo phù hợp.')}
                  </Text>
                </View>
              ) : filteredBmbNotifications.map((notification) => (
                <TouchableOpacity
                  key={notification.id}
                  style={[
                    styles.resTicketCard,
                    !notification.isRead && { borderColor: '#60A5FA', borderWidth: 1.5 },
                  ]}
                  onPress={() => handleOpenNotification(notification)}
                >
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardMainTitle}>{notification.title}</Text>
                    {!notification.isRead && <View style={styles.blueUnreadDot} />}
                  </View>
                  <Text style={styles.cardLocationText}>{notification.message}</Text>
                  {notification.ticket?.ticketCode && (
                    <Text style={styles.cardLocationText}>
                      {translate('Sự cố liên quan:')} {notification.ticket.ticketCode}
                    </Text>
                  )}
                  <Text style={styles.techInfoLine}>
                    {formatDateTime(notification.createdAt)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* CỘT PHẢI: TRẠNG THÁI DỊCH VỤ ĐÁM MÂY (CLOUD STATUS - FIGMA 03 BMB) */}
            <ScrollView
              style={styles.bmbRightInspector}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.bmbInspectorTitle}>{translate('Thông tin vận hành')}</Text>
              <View style={[styles.qrRecognizedBox, { marginTop: 12 }]}>
                <Text style={styles.qrRecognizedTitle}>{translate('Gemini: kết quả gợi ý hoặc yêu cầu phân loại thủ công được lưu trên từng sự cố.')}</Text>
              </View>
              <View style={styles.qrRecognizedBox}>
                <Text style={styles.qrRecognizedTitle}>{translate('Thông báo đẩy FCM chưa được gửi; ứng dụng đang lưu thông báo trong hộp thư.')}</Text>
              </View>
              <View style={styles.bmbCloudStorageBox}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E293B' }}>
                  {translate('Số liệu dung lượng Cloudinary hiện chưa được cung cấp.')}
                </Text>
              </View>
              <View style={styles.techDivider} />
              <Text style={styles.cardBlockTitle}>{translate('Hoạt động hôm nay')}</Text>
              <Text style={styles.techInfoLine}>{translate('Sự cố tạo hôm nay: ')}<Text style={{ fontWeight: '800' }}>{ticketsCreatedToday}</Text></Text>
              <Text style={styles.techInfoLine}>{translate('Thông báo tạo hôm nay: ')}<Text style={{ fontWeight: '800' }}>{notificationsCreatedToday}</Text></Text>
            </ScrollView>
          </View>
        )}
      </View>
      <Modal
        visible={technicianDialogMode !== null}
        transparent
        animationType="fade"
        onRequestClose={closeTechnicianDialog}
      >
        <View style={styles.technicianModalOverlay}>
          <View style={styles.technicianModalCard}>
            {technicianDialogMode === 'delete' ? (
              <>
                <Text style={styles.technicianModalTitle}>{translate('Xóa kỹ thuật viên')}</Text>
                <Text style={styles.technicianModalDescription}>
                  {translate('Bạn có chắc muốn vô hiệu hóa')} {selectedTechnician?.fullName}?
                </Text>
                <Text style={styles.technicianModalHint}>
                  {translate('Tài khoản sẽ bị vô hiệu hóa; lịch sử công việc vẫn được giữ lại.')}
                </Text>
                {technicianFormError && (
                  <Text style={styles.technicianFormError}>{technicianFormError}</Text>
                )}
                <View style={styles.technicianModalActions}>
                  <TouchableOpacity
                    style={styles.technicianCancelButton}
                    onPress={closeTechnicianDialog}
                    disabled={technicianFormBusy}
                  >
                    <Text style={styles.technicianCancelButtonText}>{translate('Hủy')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.technicianConfirmDeleteButton, technicianFormBusy && styles.technicianDisabledButton]}
                    onPress={deleteTechnician}
                    disabled={technicianFormBusy}
                  >
                    <Text style={styles.technicianConfirmDeleteText}>
                      {technicianFormBusy ? translate('Đang xử lý...') : translate('Vô hiệu hóa')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.technicianModalTitle}>
                  {translate(technicianDialogMode === 'edit' ? 'Sửa kỹ thuật viên' : 'Thêm kỹ thuật viên')}
                </Text>
                <ScrollView
                  style={styles.technicianFormScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.technicianFieldLabel}>{translate('Họ và tên')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={technicianForm.fullName}
                    onChangeText={(fullName) => setTechnicianForm((current) => ({ ...current, fullName }))}
                    placeholder={translate('Nhập họ và tên')}
                    placeholderTextColor="#94A3B8"
                    autoCapitalize="words"
                  />

                  <Text style={styles.technicianFieldLabel}>{translate('Số điện thoại')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={technicianForm.phone}
                    onChangeText={(phone) => setTechnicianForm((current) => ({ ...current, phone }))}
                    placeholder={translate('Nhập số điện thoại')}
                    placeholderTextColor="#94A3B8"
                    keyboardType="phone-pad"
                  />

                  <Text style={styles.technicianFieldLabel}>{translate('Email (tùy chọn)')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={technicianForm.email}
                    onChangeText={(email) => setTechnicianForm((current) => ({ ...current, email }))}
                    placeholder="email@example.com"
                    placeholderTextColor="#94A3B8"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />

                  <Text style={styles.technicianFieldLabel}>
                    {translate(technicianDialogMode === 'edit' ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu ban đầu')}
                  </Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={technicianForm.password}
                    onChangeText={(password) => setTechnicianForm((current) => ({ ...current, password }))}
                    placeholder={translate(technicianDialogMode === 'edit' ? 'Để trống nếu giữ nguyên mật khẩu' : 'Ít nhất 6 ký tự')}
                    placeholderTextColor="#94A3B8"
                    secureTextEntry
                    autoCapitalize="none"
                  />

                  <Text style={styles.technicianFieldLabel}>{translate('Chuyên môn')}</Text>
                  <View style={styles.technicianSpecialtyChoices}>
                    {CATEGORIES_LIST.map((specialty) => (
                      <TouchableOpacity
                        key={specialty}
                        style={[
                          styles.technicianSpecialtyChoice,
                          technicianForm.specialty === specialty && styles.technicianSpecialtyChoiceActive,
                        ]}
                        onPress={() => setTechnicianForm((current) => ({ ...current, specialty }))}
                      >
                        <Text
                          style={[
                            styles.technicianSpecialtyChoiceText,
                            technicianForm.specialty === specialty && styles.technicianSpecialtyChoiceTextActive,
                          ]}
                        >
                          {translate(CATEGORY_VN[specialty] || 'Hạng mục khác')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.technicianFieldLabel}>{translate('Ca trực')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={technicianForm.shiftName}
                    onChangeText={(shiftName) => setTechnicianForm((current) => ({ ...current, shiftName }))}
                    placeholder={translate('Ví dụ: Ca sáng 07:00 - 15:00')}
                    placeholderTextColor="#94A3B8"
                  />

                  <TouchableOpacity
                    style={styles.technicianDutyToggle}
                    onPress={() => setTechnicianForm((current) => ({ ...current, isOnDuty: !current.isOnDuty }))}
                  >
                    <View style={[
                      styles.technicianDutyIndicator,
                      technicianForm.isOnDuty && styles.technicianDutyIndicatorActive,
                    ]} />
                    <Text style={styles.technicianDutyText}>
                      {translate(technicianForm.isOnDuty ? 'Đang trực' : 'Ngoài ca trực')}
                    </Text>
                  </TouchableOpacity>
                </ScrollView>

                {technicianFormError && (
                  <Text style={styles.technicianFormError}>{technicianFormError}</Text>
                )}
                <View style={styles.technicianModalActions}>
                  <TouchableOpacity
                    style={styles.technicianCancelButton}
                    onPress={closeTechnicianDialog}
                    disabled={technicianFormBusy}
                  >
                    <Text style={styles.technicianCancelButtonText}>{translate('Hủy')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.technicianSaveButton, technicianFormBusy && styles.technicianDisabledButton]}
                    onPress={saveTechnician}
                    disabled={technicianFormBusy}
                  >
                    <Text style={styles.technicianSaveButtonText}>
                      {technicianFormBusy
                        ? translate('Đang xử lý...')
                        : translate(technicianDialogMode === 'edit' ? 'Cập nhật' : 'Tạo tài khoản')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ============================================================================
// STYLESHEET HOÀN CHỈNH CHO CẢ 15 MÀN HÌNH FIGMA (MOBILE + BMB WEB)
// ============================================================================
const styles = StyleSheet.create({
  screenBg: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 10 : 0,
  },
  loginScroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  mobileFrame: { width: '100%', maxWidth: 420 },
  mobileShell: {
    flex: 1,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    backgroundColor: '#F8FAFC',
  },
  scrollArea: { flex: 1, paddingHorizontal: 16, paddingTop: 6 },

  // Màn hình 00 BMB Web Login (Split-Card 2 cột chuẩn Figma)
  bmbLoginOuterBg: {
    flex: 1,
    backgroundColor: '#F1F5F9',
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
    backgroundColor: '#1D61E7',
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
    backgroundColor: '#1D61E7',
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
    minHeight: 0,
    backgroundColor: '#FFFFFF',
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    padding: 18,
    justifyContent: 'space-between',
  },
  bmbSidebarNavigation: { flex: 1, minHeight: 0 },
  bmbSidebarFooter: { flexShrink: 0 },
  bmbSidebarBrandRow: { flexDirection: 'row', alignItems: 'center' },
  bmbSidebarLogoText: { fontSize: 20, fontWeight: '800', color: '#1D61E7' },
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
  bmbMenuBtnTextActive: { color: '#1D61E7', fontWeight: '800' },
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

  technicianAddButton: {
    alignSelf: 'flex-end',
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: '#1D61E7',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  technicianAddButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  technicianActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  technicianEditButton: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
  },
  technicianEditButtonText: { color: '#1D61E7', fontSize: 12, fontWeight: '700' },
  technicianDeleteButton: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
  },
  technicianDeleteButtonText: { color: '#DC2626', fontSize: 12, fontWeight: '700' },
  technicianEmptyState: {
    marginTop: 18,
    padding: 22,
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  technicianEmptyText: { color: '#64748B', fontSize: 14 },
  technicianModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  technicianModalCard: {
    width: 520,
    maxWidth: '100%',
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  technicianModalTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  technicianModalDescription: { color: '#334155', fontSize: 14, lineHeight: 21, marginTop: 8 },
  technicianModalHint: { color: '#64748B', fontSize: 13, lineHeight: 19, marginTop: 8 },
  technicianFormScroll: { flexShrink: 1, minHeight: 0, maxHeight: 520, marginTop: 4 },
  technicianFieldLabel: { color: '#334155', fontSize: 12.5, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  technicianFormInput: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
    fontSize: 14,
  },
  technicianSpecialtyChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  technicianSpecialtyChoice: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  technicianSpecialtyChoiceActive: { backgroundColor: '#EFF6FF', borderColor: '#2563EB' },
  technicianSpecialtyChoiceText: { color: '#475569', fontSize: 11.5, fontWeight: '600' },
  technicianSpecialtyChoiceTextActive: { color: '#1D61E7', fontWeight: '800' },
  technicianDutyToggle: { flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 8 },
  technicianDutyIndicator: { width: 12, height: 12, borderRadius: 6, marginRight: 8, backgroundColor: '#94A3B8' },
  technicianDutyIndicatorActive: { backgroundColor: '#16A34A' },
  technicianDutyText: { color: '#334155', fontSize: 13, fontWeight: '700' },
  technicianFormError: { color: '#B91C1C', fontSize: 12.5, lineHeight: 18, marginTop: 12 },
  technicianModalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 16 },
  technicianCancelButton: {
    minWidth: 90,
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 9,
    backgroundColor: '#F1F5F9',
  },
  technicianCancelButtonText: { color: '#334155', fontSize: 13, fontWeight: '700' },
  technicianSaveButton: {
    minWidth: 112,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 9,
    backgroundColor: '#1D61E7',
  },
  technicianSaveButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  technicianConfirmDeleteButton: {
    minWidth: 112,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 9,
    backgroundColor: '#DC2626',
  },
  technicianConfirmDeleteText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  technicianDisabledButton: { opacity: 0.55 },

  bmbContentTwoCols: {
    flex: 1,
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    padding: 20,
    gap: 20,
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
  bmbFilterChipActive: { backgroundColor: '#1D61E7', borderColor: '#1D61E7' },
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
  qrVerifiedPillText: { fontSize: 11, fontWeight: '700', color: '#1D61E7' },
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
  bmbTechInitialsText: { fontSize: 14, fontWeight: '800', color: '#1D61E7' },
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
  bmbWorkloadBtnBlueActive: { backgroundColor: '#1D61E7', borderColor: '#1D61E7' },
  bmbWorkloadBtnIndigoActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  bmbWorkloadBtnText: { fontSize: 12, fontWeight: '700', color: '#1D61E7' },
  bmbBlueOutlinePanel: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#3B82F6',
    borderRadius: 14,
    padding: 14,
  },
  bmbPanelBlueTitle: { fontSize: 15, fontWeight: '800', color: '#1D4ED8', marginBottom: 4 },
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
  brandCenter: { alignItems: 'center', marginBottom: 20 },
  appIconBox: {
    width: 68,
    height: 68,
    borderRadius: 18,
    backgroundColor: '#1D61E7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  appIconSymbol: { fontSize: 30, color: '#FFFFFF' },
  brandTitle: { fontSize: 30, fontWeight: '800', color: '#1D61E7' },
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
  checkboxChecked: { backgroundColor: '#1D61E7', borderColor: '#1D61E7' },
  checkMark: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  rememberText: { fontSize: 13, color: '#475569' },
  forgotText: { fontSize: 13, fontWeight: '700', color: '#1D61E7' },
  loginSubmitBtn: {
    backgroundColor: '#1D61E7',
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
  demoChipText: { fontSize: 11, fontWeight: '700', color: '#1D4ED8', textAlign: 'center' },
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
  qrFrameIcon: { fontSize: 20, color: '#1D61E7', marginRight: 8, fontWeight: '800' },
  ctaHeroTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  ctaHeroDesc: { fontSize: 13, color: '#475569', lineHeight: 19, marginBottom: 14 },
  ctaPrimaryBtn: {
    backgroundColor: '#1D61E7',
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
  seeHistoryLink: { fontSize: 13.5, fontWeight: '700', color: '#1D61E7' },
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
  filterPillActive: { backgroundColor: '#1D61E7', borderColor: '#1D61E7' },
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
  techPlusIcon: { fontSize: 22, color: '#1D61E7', marginBottom: 4 },
  techAddPhotoBlueText: { fontSize: 12, fontWeight: '700', color: '#1D61E7', textAlign: 'center' },
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
  specialtyPillText: { fontSize: 12, fontWeight: '700', color: '#1D61E7' },
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
  sentPhotoBlueText: { fontSize: 12.5, fontWeight: '600', color: '#1D61E7' },
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
  qrDashedBtnText: { color: '#1D61E7', fontSize: 14, fontWeight: '700' },
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
  unreadPillText: { fontSize: 12, fontWeight: '700', color: '#1D61E7' },
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
    backgroundColor: '#1D61E7',
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
    paddingVertical: 10,
  },
  figmaNavTab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  figmaNavLabel: { fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: '600' },
  figmaNavLabelActive: { color: '#1D61E7', fontWeight: '800' },
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
  toastText: { color: '#1D4ED8', fontWeight: '700', fontSize: 13, textAlign: 'center' },
});
