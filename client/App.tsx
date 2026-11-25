import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Platform,
  Image,
  StatusBar,
  Alert,
  Modal,
  Linking,
  AppState,
  useWindowDimensions,
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
import VoiceRecorderButton from './VoiceRecorderButton';
import { QrCodeView, printQrCode, downloadQrSvg } from './QrCodeView';
import {
  ScreenTransition,
  AnimatedModalContent,
  TimelineNodeEntrance,
  ActiveMilestonePulse,
  StaggeredCardEntrance,
  AnimatedBadgeEntrance,
  CollapsibleDrawer,
} from './Transitions';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildIncidentTimeline } from './incident_timeline';
import { TechnicianStepFlow, hasTechArrivedOnSite } from './TechnicianStepFlow';
import { DEFAULT_BUILDING_LOCATION } from './src/config/building.config';

// ============================================================================
// CẤU HÌNH ĐỊA CHỈ BACKEND CHUẨN CHO CẢ WEB & ĐIỆN THOẠI
// ============================================================================

const DEV_LAN_IP = '192.168.1.233'; // IPv4 máy tính Windows chạy Backend (port 5000)

const getApiBaseUrl = () => {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      return `http://${window.location.hostname}:5000/api`;
    }
    return 'http://localhost:5000/api';
  }

  // Trên thiết bị di động (Expo Go iOS / Android) trong môi trường phát triển cục bộ
  if (__DEV__) {
    return `http://${DEV_LAN_IP}:5000/api`;
  }

  // Môi trường Production release (không dùng IP LAN)
  return 'https://api.resifix.vn/api';
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
  shiftStartTime: string;
  shiftEndTime: string;
  isOnDuty: boolean;
};

const EMPTY_TECHNICIAN_FORM: TechnicianForm = {
  fullName: '',
  phone: '',
  email: '',
  password: '',
  specialty: 'PLUMBING',
  shiftStartTime: '07:00',
  shiftEndTime: '15:00',
  isOnDuty: false,
};

const SHIFT_PRESETS = [
  { label: 'Ca sáng', start: '07:00', end: '15:00' },
  { label: 'Hành chính', start: '08:00', end: '17:00' },
  { label: 'Ca chiều', start: '15:00', end: '23:00' },
  { label: 'Ca đêm', start: '23:00', end: '07:00' },
];

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES_STEPS = ['00', '15', '30', '45'];

const isCurrentlyInShift = (shiftName?: string | null): boolean => {
  if (!shiftName) return false;
  const match = shiftName.match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  if (!match) return false;

  const startHour = parseInt(match[1], 10);
  const startMin = parseInt(match[2], 10);
  const endHour = parseInt(match[3], 10);
  const endMin = parseInt(match[4], 10);

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  const now = new Date();
  const vnTimeStr = now.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const [currH, currM] = vnTimeStr.split(':').map(Number);
  const currentMinutes = currH * 60 + currM;

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
  return false;
};

function RealTimeClock({ style }: { style?: any }) {
  const [timeStr, setTimeStr] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  useEffect(() => {
    const update = () => {
      const d = new Date();
      setTimeStr(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    };
    update();
    const interval = setInterval(update, 1000 * 30);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={[styles.realTimeClockBadge, style]}>
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: '#10B981',
          marginRight: 6,
        }}
      />
      <Text style={styles.realTimeClockText}>{timeStr}</Text>
    </View>
  );
}

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


function ResiFixLogoMark({ size = 68 }: { size?: number }) {
  const stroke = Math.max(1.25, size * 0.033);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        backgroundColor: UI.primary,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#1E40AF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
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

const calculateDistanceMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

function AppContent() {
  const { width: windowWidth } = useWindowDimensions();
  const isMobileLayout = windowWidth < 900;
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

  // State GPS Live & Quản trị tài khoản BMB thống nhất
  const [techLiveLocation, setTechLiveLocation] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [techLocationError, setTechLocationError] = useState<string | null>(null);
  const [techGpsRefreshing, setTechGpsRefreshing] = useState(false);

  // 2. Điều hướng màn hình theo từng vai trò (Chuẩn 15 màn hình Figma)
  const [resScreen, setResScreen] = useState<
    'HOME' | 'CREATE_REPORT' | 'TICKET_DETAIL' | 'NOTI_PROFILE' | 'HISTORY'
  >('HOME');
  const [techScreen, setTechScreen] = useState<
    'HOME' | 'TASK_DETAIL' | 'NOTI_PROFILE' | 'HISTORY' | 'PAYROLL'
  >('HOME');
  const [bmbNavTab, setBmbNavTab] = useState<'TICKETS' | 'TECHNICIANS' | 'NOTIFICATIONS' | 'APARTMENTS' | 'ATTENDANCE' | 'PAYROLL'>('TICKETS');

  // Thông báo mở rộng / thu gọn
  const [showAllNotifications, setShowAllNotifications] = useState(false);
  const [showAllBmbNotifications, setShowAllBmbNotifications] = useState(false);

  // Kỹ thuật viên bàn giao khi xóa
  const [handoverTechId, setHandoverTechId] = useState<string>('');
  const [technicianActiveTicketsCount, setTechnicianActiveTicketsCount] = useState<number>(0);

  // Liên hệ khẩn cấp
  const [emergencyContact, setEmergencyContact] = useState<{ managerName: string; managerPhone: string }>({
    managerName: 'Đặng Thành Quyết',
    managerPhone: '0913402803',
  });
  const [editingEmergencyContact, setEditingEmergencyContact] = useState(false);
  const [emergencyNameInput, setEmergencyNameInput] = useState('Đặng Thành Quyết');
  const [emergencyPhoneInput, setEmergencyPhoneInput] = useState('0913402803');

  // Căn hộ & Cư dân (BMB)
  const [apartments, setApartments] = useState<any[]>([]);
  const [selectedApartment, setSelectedApartment] = useState<any | null>(null);
  const [apartmentRepairs, setApartmentRepairs] = useState<any[]>([]);
  const [apartmentRepairsFullHistory, setApartmentRepairsFullHistory] = useState(false);
  const [residentsList, setResidentsList] = useState<any[]>([]);
  const [residentSearchQuery, setResidentSearchQuery] = useState('');
  const [residentModalMode, setResidentModalMode] = useState<'create' | 'edit' | 'reset_password' | null>(null);
  const [residentModalError, setResidentModalError] = useState<string | null>(null);
  const [residentModalBusy, setResidentModalBusy] = useState(false);
  const [apartmentFilterBlock, setApartmentFilterBlock] = useState<'ALL' | 'G' | 'F' | 'E'>('ALL');
  const [apartmentFilterFloor, setApartmentFilterFloor] = useState<number | 'ALL'>('ALL');
  const [apartmentFilterStatus, setApartmentFilterStatus] = useState<'ALL' | 'OCCUPIED' | 'VACANT'>('ALL');
  const [zoomQrApartment, setZoomQrApartment] = useState<any | null>(null);
  const [selectedResident, setSelectedResident] = useState<any | null>(null);
  const [residentForm, setResidentForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    apartmentCode: 'G101',
    buildingBlock: 'Tòa G',
    floorNumber: 1,
    residencyRole: 'TENANT' as 'OWNER' | 'TENANT' | 'MEMBER',
    moveInDate: new Date().toISOString().slice(0, 10),
    moveOutDate: '',
    isRepresentative: false,
  });
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [createdTempPasswordData, setCreatedTempPasswordData] = useState<{
    temporaryPassword: string;
    residentName: string;
    apartmentCode: string;
    phone: string;
    isExistingUser?: boolean;
  } | null>(null);

  // Modal đổi mật khẩu lần đầu bắt buộc cho cư dân (đăng nhập bằng mật khẩu tạm)
  const [showFirstLoginPasswordModal, setShowFirstLoginPasswordModal] = useState(false);
  const [firstLoginCurrentPassword, setFirstLoginCurrentPassword] = useState('');
  const [firstLoginNewPassword, setFirstLoginNewPassword] = useState('');
  const [firstLoginConfirmPassword, setFirstLoginConfirmPassword] = useState('');
  const [firstLoginBusy, setFirstLoginBusy] = useState(false);

  // Chấm công & Lương KTV
  const [myAttendanceLogs, setMyAttendanceLogs] = useState<any[]>([]);
  const [myOvertimeRequests, setMyOvertimeRequests] = useState<any[]>([]);
  const [myPayrollData, setMyPayrollData] = useState<any | null>(null);
  const [techPayrollSubTab, setTechPayrollSubTab] = useState<'ATTENDANCE' | 'OVERTIME' | 'SALARY' | 'SCHEDULE'>('ATTENDANCE');
  const [otFromTimeInput, setOtFromTimeInput] = useState('17:30');
  const [otToTimeInput, setOtToTimeInput] = useState('19:30');
  const [otHoursInput, setOtHoursInput] = useState('2');
  const [otReasonInput, setOtReasonInput] = useState('');
  const [otTicketIdInput, setOtTicketIdInput] = useState('');
  const [reconcileNoteInput, setReconcileNoteInput] = useState('');

  // 3 Module mới: Đổi ca/Xin nghỉ, Chi phí, SLA
  const [scheduleRequests, setScheduleRequests] = useState<any[]>([]);
  const [myScheduleData, setMyScheduleData] = useState<any | null>(null);
  const [myScheduleRequests, setMyScheduleRequests] = useState<any[]>([]);
  const [leaveDateInput, setLeaveDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [leaveTypeInput, setLeaveTypeInput] = useState<'ANNUAL' | 'SICK' | 'UNPAID'>('ANNUAL');
  const [leaveReasonInput, setLeaveReasonInput] = useState('');
  const [swapDateInput, setSwapDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [swapShiftInput, setSwapShiftInput] = useState('08:00 - 17:00');
  const [swapTargetTechId, setSwapTargetTechId] = useState('');
  const [swapReasonInput, setSwapReasonInput] = useState('');
  const [scheduleHandoverTechId, setScheduleHandoverTechId] = useState<Record<string, string>>({});

  // Chi phí sửa chữa
  const [ticketCosts, setTicketCosts] = useState<Record<string, any>>({});
  const [costReport, setCostReport] = useState<any | null>(null);
  const [matNameInput, setMatNameInput] = useState('');
  const [matQtyInput, setMatQtyInput] = useState('1');
  const [matPriceInput, setMatPriceInput] = useState('50000');
  const [matUnitInput, setMatUnitInput] = useState('Cái');

  // SLA & Escalation
  const [ticketSlas, setTicketSlas] = useState<Record<string, any>>({});
  const [slaDashboard, setSlaDashboard] = useState<any | null>(null);
  const [liveClockTime, setLiveClockTime] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveClockTime(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Chấm công & Lương BMB
  const [bmbPayrollSummary, setBmbPayrollSummary] = useState<any | null>(null);
  const [bmbAttendanceLogs, setBmbAttendanceLogs] = useState<any[]>([]);
  const [bmbAnomalies, setBmbAnomalies] = useState<string[]>([]);
  const [bmbOvertimeRequests, setBmbOvertimeRequests] = useState<any[]>([]);
  const [bmbPayrollTab, setBmbPayrollTab] = useState<'SUMMARY' | 'ATTENDANCE' | 'OVERTIME' | 'SCHEDULE' | 'COSTS' | 'SLA' | 'CONFIG'>('SUMMARY');
  const [payrollConfig, setPayrollConfig] = useState({
    baseSalaryDefault: 10000000,
    standardMonthlyHours: 208,
    otMultiplierNormal: 1.5,
    otMultiplierWeekend: 2.0,
    standardAllowance: 730000,
  });

  // Quản lý Chấm công BMB chuyên sâu (GPS, Camera & Phê duyệt ngoại lệ)
  const [bmbAttendanceFilterDate, setBmbAttendanceFilterDate] = useState('');
  const [bmbAttendanceFilterMonth, setBmbAttendanceFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [bmbAttendanceFilterTech, setBmbAttendanceFilterTech] = useState('ALL');
  const [bmbAttendanceFilterBuilding, setBmbAttendanceFilterBuilding] = useState('ALL');
  const [bmbAttendanceFilterStatus, setBmbAttendanceFilterStatus] = useState('ALL');
  const [showAdvancedAttendanceFilters, setShowAdvancedAttendanceFilters] = useState(false);
  const [bmbAttendanceStats, setBmbAttendanceStats] = useState({
    totalLogs: 0,
    currentlyOnDutyCount: 0,
    completedShiftCount: 0,
    verifiedCount: 0,
    pendingReviewCount: 0,
    lateCount: 0,
    earlyLeaveCount: 0,
    notCheckedInCount: 0,
    totalBillableHours: 0,
    totalDisputedHours: 0,
  });
  const [bmbTechnicianRosterStatus, setBmbTechnicianRosterStatus] = useState<any[]>([]);
  const [selectedAttendanceDetailModal, setSelectedAttendanceDetailModal] = useState<any | null>(null);
  const [selectedAttendanceForReview, setSelectedAttendanceForReview] = useState<any | null>(null);
  const [bmbReviewAction, setBmbReviewAction] = useState<'APPROVE' | 'REJECT' | 'REQUEST_EXPLANATION'>('APPROVE');
  const [bmbReviewNote, setBmbReviewNote] = useState('');
  const [bmbAdjustedHours, setBmbAdjustedHours] = useState('');
  const [showAttendanceReviewModal, setShowAttendanceReviewModal] = useState(false);
  const [viewingPhotoModal, setViewingPhotoModal] = useState<{ url: string; title: string; meta?: any } | null>(null);

  // State Tính lương cố định 5.000.000/180h & Nhập thưởng BMB thủ công
  const [bmbPayrollMonth, setBmbPayrollMonth] = useState(new Date().toISOString().slice(0, 7));
  const [bmbBonusInputs, setBmbBonusInputs] = useState<Record<string, string>>({});
  const [bmbBonusNotes, setBmbBonusNotes] = useState<Record<string, string>>({});
  const [bmbSavingBonusTechId, setBmbSavingBonusTechId] = useState<string | null>(null);
  const [expandedPayrollTechId, setExpandedPayrollTechId] = useState<string | null>(null);

  // Cấu hình tọa độ tòa nhà BMB (Bảo mật GPS & Xác thực chấm công)
  const [bmbBuildingLocation, setBmbBuildingLocation] = useState<any | null>(null);
  const [bmbBuildingModalVisible, setBmbBuildingModalVisible] = useState(false);
  const [bmbBuildingForm, setBmbBuildingForm] = useState<{
    buildingName: string;
    buildingAddress: string;
    latitude: string;
    longitude: string;
    allowedRadiusMeters: string;
    note: string;
  }>({
    buildingName: DEFAULT_BUILDING_LOCATION.buildingName,
    buildingAddress: DEFAULT_BUILDING_LOCATION.buildingAddress,
    latitude: String(DEFAULT_BUILDING_LOCATION.latitude),
    longitude: String(DEFAULT_BUILDING_LOCATION.longitude),
    allowedRadiusMeters: String(DEFAULT_BUILDING_LOCATION.allowedRadiusMeters),
    note: '',
  });

  // KTV Check-in/out Camera, GPS & Giải trình
  const [techCheckInModal, setTechCheckInModal] = useState<{ visible: boolean; mode: 'CHECK_IN' | 'CHECK_OUT' }>({ visible: false, mode: 'CHECK_IN' });
  const [techPhotoUri, setTechPhotoUri] = useState<string | null>(null);
  const [techCheckInNotes, setTechCheckInNotes] = useState('');
  const [techExplanationModal, setTechExplanationModal] = useState<{ visible: boolean; log: any | null }>({ visible: false, log: null });
  const [techExplanationInput, setTechExplanationInput] = useState('');

  // 3. State Dữ liệu thực từ Backend PostgreSQL
  const [tickets, setTickets] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [technicianDialogMode, setTechnicianDialogMode] = useState<'create' | 'edit' | 'delete' | null>(null);
  const [selectedTechnician, setSelectedTechnician] = useState<any | null>(null);
  const [technicianForm, setTechnicianForm] = useState<TechnicianForm>(EMPTY_TECHNICIAN_FORM);
  const [technicianFieldErrors, setTechnicianFieldErrors] = useState<{
    fullName?: string;
    phone?: string;
    email?: string;
    password?: string;
    shift?: string;
    specialty?: string;
  }>({});
  const [timePickerTarget, setTimePickerTarget] = useState<'start' | 'end' | null>(null);
  const [technicianFormBusy, setTechnicianFormBusy] = useState(false);
  const [technicianFormError, setTechnicianFormError] = useState<string | null>(null);

  // State Quên mật khẩu & Kích hoạt tài khoản bằng OTP
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMaskedEmail, setForgotMaskedEmail] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotCooldown, setForgotCooldown] = useState(0);
  const [forgotBusy, setForgotBusy] = useState(false);

  const [showActivationModal, setShowActivationModal] = useState(false);
  const [activationRole, setActivationRole] = useState<'RESIDENT' | 'TECHNICIAN' | 'BMB' | null>(null);
  const [activationFullName, setActivationFullName] = useState('');
  const [activationEmail, setActivationEmail] = useState('');
  const [activationOtp, setActivationOtp] = useState('');
  const [activationNewPassword, setActivationNewPassword] = useState('');
  const [activationConfirmPassword, setActivationConfirmPassword] = useState('');
  const [showActivationNewPass, setShowActivationNewPass] = useState(false);
  const [showActivationConfirmPass, setShowActivationConfirmPass] = useState(false);
  const [showBmbWebPassword, setShowBmbWebPassword] = useState(false);
  const [activationCooldown, setActivationCooldown] = useState(0);
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activationOtpStatus, setActivationOtpStatus] = useState<'IDLE' | 'SENDING' | 'SENT' | 'FAILED' | 'EXPIRED' | 'SUCCESS'>('IDLE');
  const [activationFieldErrors, setActivationFieldErrors] = useState<{
    email?: string;
    otp?: string;
    password?: string;
    confirmPassword?: string;
  }>({});
  const [loginFieldErrors, setLoginFieldErrors] = useState<{
    identifier?: string;
    password?: string;
  }>({});

  const maskEmailString = (email: string) => {
    if (!email || !email.includes('@')) return email;
    const [local, domain] = email.split('@');
    if (local.length <= 2) return `${local[0]}***@${domain}`;
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
  };

  useEffect(() => {
    if (forgotCooldown <= 0 && activationCooldown <= 0) return;
    const timer = setInterval(() => {
      setForgotCooldown((prev) => (prev > 0 ? prev - 1 : 0));
      setActivationCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [forgotCooldown, activationCooldown]);

  // 4. Bộ lọc trên các màn hình
  const [homeFilter, setHomeFilter] = useState<'ALL' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>('ALL');
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'CLOSED' | 'M10' | 'M09'>('ALL');
  const [techHomeFilter, setTechHomeFilter] = useState<'ALL' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED'>('ALL');
  const [techHistoryFilter, setTechHistoryFilter] = useState<'ALL' | 'CLOSED' | 'COMPLETED'>('ALL');
  const [bmbTicketFilter, setBmbTicketFilter] = useState<
    'ALL' | 'PENDING' | 'GUEST_REVIEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED'
  >('ALL');
  const [bmbNotiFilter, setBmbNotiFilter] = useState<'ALL' | 'UNREAD' | 'URGENT' | 'TECH'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // 5. State Màn hình 02 Cư dân: Tạo báo cáo sự cố 3 bước (Quét mã QR Khu vực)
  const [scannedAsset, setScannedAsset] = useState<{
    qrCode: string;
    assetName: string;
    locationLabel: string;
    areaName?: string;
  } | null>(null);
  const [manualLocation, setManualLocation] = useState('');
  const [reportPhotos, setReportPhotos] = useState<{ label: string; url: string }[]>([]);
  const [reportDesc, setReportDesc] = useState('');
  const [isVoiceUsed, setIsVoiceUsed] = useState(false);
  const [reportVoiceBusy, setReportVoiceBusy] = useState(false);

  // 5.1. State Báo cáo sự cố ẩn danh qua QR (Khách vãng lai chưa đăng nhập)
  const [guestQrModalVisible, setGuestQrModalVisible] = useState<boolean>(false);
  const [isAnonymousReporting, setIsAnonymousReporting] = useState<boolean>(false);
  const [anonymousArea, setAnonymousArea] = useState<{
    id: string;
    qrCode: string;
    qrType?: 'COMMON_AREA' | 'APARTMENT';
    apartmentCode?: string;
    areaName: string;
    category?: string;
    locationLabel: string;
    buildingBlock: string;
    floor?: string;
    buildingName: string;
    buildingAddress: string;
    hasBoundaryConfig: boolean;
  } | null>(null);
  const [anonymousTitle, setAnonymousTitle] = useState<string>('');
  const [anonymousDesc, setAnonymousDesc] = useState<string>('');
  const [anonymousPhotos, setAnonymousPhotos] = useState<string[]>([]);
  const [anonymousPhotoCapturedAt, setAnonymousPhotoCapturedAt] = useState<string | null>(null);
  const [anonymousUploading, setAnonymousUploading] = useState<boolean>(false);
  const [anonymousVoiceBusy, setAnonymousVoiceBusy] = useState<boolean>(false);
  const [anonymousIsVoiceUsed, setAnonymousIsVoiceUsed] = useState<boolean>(false);
  const [bmbGuestRejectReason, setBmbGuestRejectReason] = useState<string>('');
  const [bmbGuestVerifyBusy, setBmbGuestVerifyBusy] = useState<boolean>(false);
  const [showBmbGuestRejectInput, setShowBmbGuestRejectInput] = useState<boolean>(false);
  const [anonymousLocationCoords, setAnonymousLocationCoords] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
  } | null>(null);
  const [anonymousGpsStatus, setAnonymousGpsStatus] = useState<
    'IDLE' | 'FETCHING' | 'ACQUIRED' | 'DENIED' | 'BLOCKED' | 'SERVICE_DISABLED' | 'FAILED' | 'SKIPPED'
  >('IDLE');
  const [anonymousCanAskAgain, setAnonymousCanAskAgain] = useState<boolean>(true);
  const [anonymousLocationError, setAnonymousLocationError] = useState<string | null>(null);
  const [anonymousReceipt, setAnonymousReceipt] = useState<{
    ticketCode: string;
    status: string;
    verificationStatus: string;
    verificationLabel: string;
    verificationReason: string;
    areaName: string;
    buildingName: string;
  } | null>(null);

  // 6. State Chi tiết Sự cố (Cư dân & Kỹ thuật viên)
  const [activeTicket, setActiveTicket] = useState<any | null>(null);
  const [ratingStars, setRatingStars] = useState<number>(5);
  const [ratingComment, setRatingComment] = useState<string>('');
  const [techProofPhotos, setTechProofPhotos] = useState<string[]>([]);
  const [techRepairNote, setTechRepairNote] = useState<string>('');
  const [techArrivalPhotoUrl, setTechArrivalPhotoUrl] = useState<string | null>(null);
  const [techArrivalGps, setTechArrivalGps] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);

  // 7. State BMB Web Dashboard (Màn hình 01, 02, 03 BMB)
  const [bmbSelectedTicket, setBmbSelectedTicket] = useState<any | null>(null);
  const [bmbCategory, setBmbCategory] = useState<string>('PLUMBING');
  const [bmbPriority, setBmbPriority] = useState<string>('HIGH');
  const [bmbTechId, setBmbTechId] = useState<string>('');
  const [bmbNote, setBmbNote] = useState<string>('');
  const [bmbAssignTargetTech, setBmbAssignTargetTech] = useState<any | null>(null);
  const [bmbViewingWorkloadTech, setBmbViewingWorkloadTech] = useState<any | null>(null);
  const [bmbRadioTicketId, setBmbRadioTicketId] = useState<string>('');

  // Gợi ý kỹ thuật viên theo chuyên môn và khoảng cách cho BMB
  const [suggestedTechnicians, setSuggestedTechnicians] = useState<any[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState<boolean>(false);
  const [suggestionsMessage, setSuggestionsMessage] = useState<string>('');
  const suggestionRequestIdRef = useRef<number>(0);

  // Trợ lý AI kỹ thuật viên cho KTV
  const [technicianGuidance, setTechnicianGuidance] = useState<any | null>(null);
  const [technicianGuidanceLoading, setTechnicianGuidanceLoading] = useState<boolean>(false);
  const [checkedChecklistItems, setCheckedChecklistItems] = useState<Record<string, boolean>>({});

  const fetchTechnicianGuidance = useCallback(async (ticketId: string) => {
    if (!token || !ticketId) return null;
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketId}/technician-guidance`, {
        headers: { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' },
      });
      const data = await res.json();
      if (data.success && data.guidance) {
        setTechnicianGuidance(data.guidance);
        return data.guidance;
      }
    } catch (err) {
      console.warn('[Fetch Guidance Error]', err);
    }
    return null;
  }, [token]);

  // State xem ảnh phóng to của cư dân cho BMB
  const [bmbPhotoViewerVisible, setBmbPhotoViewerVisible] = useState<boolean>(false);
  const [bmbPhotoViewerIndex, setBmbPhotoViewerIndex] = useState<number>(0);
  const [bmbPhotoViewerList, setBmbPhotoViewerList] = useState<{ id: string; url: string; caption?: string }[]>([]);
  const [bmbPhotoModalLoading, setBmbPhotoModalLoading] = useState<boolean>(false);
  const [bmbPhotoModalError, setBmbPhotoModalError] = useState<boolean>(false);
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<Record<string, boolean>>({});

  const openReportedPhoto = (photos: typeof bmbPhotoViewerList, index: number) => {
    setBmbPhotoViewerList(photos);
    setBmbPhotoViewerIndex(index);
    setBmbPhotoModalLoading(true);
    setBmbPhotoModalError(false);
    setBmbPhotoViewerVisible(true);
  };

  // Trích xuất danh sách ảnh ban đầu do Cư dân hoặc Khách ẩn danh báo cáo (chỉ lấy SCENE_BEFORE, tuyệt đối loại trừ REPAIR_PROOF của KTV)
  const getResidentReportedMedia = (ticket: any): { id: string; url: string; caption?: string }[] => {
    if (!ticket) return [];
    const items: { id: string; url: string; caption?: string }[] = [];
    const seenUrls = new Set<string>();

    // 1. Lấy từ ticket.media (quan hệ Prisma chuẩn của IncidentTicket)
    if (Array.isArray(ticket.media) && ticket.media.length > 0) {
      for (const m of ticket.media) {
        if (!m || !m.imageUrl || typeof m.imageUrl !== 'string' || !m.imageUrl.trim()) continue;
        if (m.ticketId && ticket.id && m.ticketId !== ticket.id) continue;
        // Tuyệt đối không lấy ảnh nghiệm thu sau sửa của KTV
        if (m.mediaType === 'REPAIR_PROOF') continue;
        if (ticket.assignedTechId && m.uploadedById === ticket.assignedTechId) continue;

        const cleanUrl = m.imageUrl.split('#')[0].trim();
        if (!cleanUrl) continue;

        if (m.mediaType === 'SCENE_BEFORE') {
          if (!seenUrls.has(cleanUrl)) {
            seenUrls.add(cleanUrl);
            items.push({
              id: m.id || cleanUrl,
              url: cleanUrl,
              caption: m.caption || translate('Ảnh hiện trường'),
            });
          }
          continue;
        }

        // Tương thích ngược an toàn nếu dữ liệu cũ chưa có mediaType hoặc báo cáo ẩn danh
        const isUploadedByResident = ticket.residentId && m.uploadedById === ticket.residentId;
        const isAnonymousReport = ticket.isAnonymous || !ticket.residentId;
        const isSceneCaption = m.caption && /hiện trường|báo cáo|cư dân|ẩn danh/i.test(m.caption);
        if (isUploadedByResident || isAnonymousReport || isSceneCaption || !m.mediaType) {
          if (!seenUrls.has(cleanUrl)) {
            seenUrls.add(cleanUrl);
            items.push({
              id: m.id || cleanUrl,
              url: cleanUrl,
              caption: m.caption || translate('Ảnh hiện trường'),
            });
          }
        }
      }
    }

    // 2. Bổ sung / dự phòng nếu ticket có mảng photos (chuỗi URL) từ API
    if (Array.isArray(ticket.photos) && ticket.photos.length > 0) {
      ticket.photos.forEach((photoUrl: any, idx: number) => {
        if (typeof photoUrl === 'string' && photoUrl.trim().startsWith('http')) {
          const cleanPhotoUrl = photoUrl.split('#')[0].trim();
          if (cleanPhotoUrl && !seenUrls.has(cleanPhotoUrl)) {
            seenUrls.add(cleanPhotoUrl);
            items.push({
              id: `photo-${idx}-${cleanPhotoUrl}`,
              url: cleanPhotoUrl,
              caption: `${translate('Ảnh hiện trường')} ${idx + 1}`,
            });
          }
        }
      });
    }

    return items;
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  // ============================================================================
  // HÀM GỌI API BACKEND
  // ============================================================================
  const handleLogin = async (overrideId?: string, overridePass?: string) => {
    if (loading) return; // Chống gọi API đăng nhập nhiều lần khi nhấn liên tục

    const id = (overrideId ?? phoneInput).trim();
    const pass = overridePass ?? passwordInput;
    const errors: { identifier?: string; password?: string } = {};

    if (!id) {
      errors.identifier = translate('Vui lòng nhập Số điện thoại hoặc Email');
    }
    if (!pass) {
      errors.password = translate('Vui lòng nhập mật khẩu');
    }

    if (Object.keys(errors).length > 0) {
      setLoginFieldErrors(errors);
      showToast(translate('Vui lòng nhập đầy đủ thông tin đăng nhập.'));
      return;
    }
    setLoginFieldErrors({});

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 15000); // 15s timeout chống treo vô hạn

    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          identifier: id,
          password: pass,
        }),
        signal: abortController.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        if (data?.isPendingActivation) {
          const rawRole = (data.role || data.user?.role || '').toString().toUpperCase().trim();
          const resolvedRole: 'RESIDENT' | 'TECHNICIAN' | 'BMB' | null =
            rawRole === 'TECHNICIAN' ? 'TECHNICIAN' : rawRole === 'RESIDENT' ? 'RESIDENT' : rawRole === 'BMB' ? 'BMB' : null;

          if (!resolvedRole) {
            showToast(data.message || translate('Không thể xác định vai trò của tài khoản để kích hoạt. Vui lòng liên hệ Ban Quản lý.'));
            return;
          }

          setActivationRole(resolvedRole);
          setActivationFullName(data.fullName || data.user?.fullName || '');
          const targetEmail = data.email || data.user?.email || (id.includes('@') ? id : '');
          setActivationEmail(targetEmail);
          setActivationOtp('');
          setActivationNewPassword('');
          setActivationConfirmPassword('');
          setActivationError(null);
          setActivationFieldErrors({});
          setActivationBusy(false);
          if (data.emailSent) {
            setActivationOtpStatus('SENT');
            setActivationCooldown(60);
          } else {
            setActivationOtpStatus('IDLE');
            setActivationCooldown(0);
          }
          setShowActivationModal(true);
          showToast(data.message || translate('Tài khoản chưa kích hoạt. Vui lòng xác thực OTP'));
          return;
        }
        let errMsg = data?.message;
        if (!errMsg) {
          if (res.status === 401) {
            errMsg = translate('Email/SĐT hoặc mật khẩu không chính xác');
          } else if (res.status === 403) {
            errMsg = translate('Tài khoản bị khóa hoặc từ chối truy cập.');
          } else if (res.status === 404) {
            errMsg = translate('Không tìm thấy cổng dịch vụ xác thực (404). Vui lòng kiểm tra API Backend.');
          } else if (res.status >= 500) {
            errMsg = translate('Máy chủ Backend đang gặp sự cố (500). Vui lòng thử lại sau.');
          } else {
            errMsg = translate('Đăng nhập không thành công. Vui lòng thử lại.');
          }
        }
        showToast(errMsg);
        return;
      }
      const userRole = data.user?.role;
      setToken(data.token);
      setUser(data.user);
      if (userRole === 'BMB') {
        setLoginMode('BMB_WEB');
      } else {
        setLoginMode('MOBILE');
      }
      setResScreen('HOME');
      setTechScreen('HOME');
      setBmbNavTab('TICKETS');

      // Nếu tài khoản có cờ đổi mật khẩu lần đầu (cư dân đăng nhập bằng mật khẩu tạm thời)
      if (data.mustChangePassword === true || data.user?.mustChangePassword === true) {
        setFirstLoginCurrentPassword(pass);
        setFirstLoginNewPassword('');
        setFirstLoginConfirmPassword('');
        setShowFirstLoginPasswordModal(true);
        showToast(translate('Vui lòng đổi mật khẩu mới ở lần đăng nhập đầu tiên để bảo vệ tài khoản.'));
        return;
      }

      if (rememberMe) {
        void AsyncStorage.setItem(
          AUTH_SESSION_STORAGE_KEY,
          JSON.stringify({ token: data.token, user: data.user })
        ).catch(() => showToast(translate('Không thể lưu phiên đăng nhập trên thiết bị này.')));
      } else {
        void AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY).catch(() => undefined);
      }
      try {
        await fetchAllData(data.token, data.user);
      } catch (dataErr) {
        console.error('Lỗi tải dữ liệu sau đăng nhập:', dataErr);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        showToast(translate('Quá thời gian kết nối máy chủ (Timeout 15s). Vui lòng kiểm tra Wi-Fi và Backend.'));
      } else {
        showToast(translate('Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và đảm bảo Backend đang chạy.'));
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const handleChangePasswordFirstLogin = async () => {
    const cur = firstLoginCurrentPassword.trim();
    const newPwd = firstLoginNewPassword.trim();
    const confirmPwd = firstLoginConfirmPassword.trim();

    if (!cur) {
      showToast(translate('Vui lòng nhập mật khẩu tạm thời hiện tại.'));
      return;
    }
    if (newPwd.length < 6) {
      showToast(translate('Mật khẩu mới tối thiểu 6 ký tự.'));
      return;
    }
    if (newPwd !== confirmPwd) {
      showToast(translate('Xác nhận mật khẩu mới không khớp.'));
      return;
    }
    if (cur === newPwd) {
      showToast(translate('Mật khẩu mới không được trùng với mật khẩu tạm thời.'));
      return;
    }

    try {
      setFirstLoginBusy(true);
      const res = await fetch(`${API_BASE_URL}/auth/change-password-first-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          currentPassword: cur,
          newPassword: newPwd,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.message || translate('Đổi mật khẩu thất bại.'));
        return;
      }
      setToken(data.token);
      setUser(data.user);
      setShowFirstLoginPasswordModal(false);
      setFirstLoginCurrentPassword('');
      setFirstLoginNewPassword('');
      setFirstLoginConfirmPassword('');
      showToast(translate('✓ Đổi mật khẩu thành công! Chào mừng bạn đến với ResiFix.'));
      if (rememberMe) {
        void AsyncStorage.setItem(
          AUTH_SESSION_STORAGE_KEY,
          JSON.stringify({ token: data.token, user: data.user })
        ).catch(() => undefined);
      }
      await fetchAllData(data.token, data.user);
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setFirstLoginBusy(false);
    }
  };

  const handleRequestForgotOtp = async () => {
    const cleanInput = forgotEmail.trim();
    if (!cleanInput) {
      showToast(translate('Vui lòng nhập Email hoặc Số điện thoại đã đăng ký.'));
      return;
    }
    try {
      setForgotBusy(true);
      const res = await fetch(`${API_BASE_URL}/auth/otp/request-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({ identifier: cleanInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.message || translate('Không thể yêu cầu mã OTP lúc này.'));
        return;
      }
      setForgotStep(2);
      setForgotCooldown(60);
      if (data.maskedEmail) {
        setForgotMaskedEmail(data.maskedEmail);
      }
      showToast(data.message || translate('Mã OTP đã được gửi đến email đăng ký của bạn.'));
    } catch {
      showToast(translate('Không thể kết nối đến máy chủ.'));
    } finally {
      setForgotBusy(false);
    }
  };

  const handleResetPassword = async () => {
    const cleanInput = forgotEmail.trim();
    const cleanOtp = forgotOtp.trim();
    if (!cleanInput) {
      showToast(translate('Vui lòng nhập Email hoặc Số điện thoại.'));
      return;
    }
    if (cleanOtp.length !== 6) {
      showToast(translate('Mã OTP phải gồm chính xác 6 chữ số.'));
      return;
    }
    if (forgotNewPassword.length < 6 || forgotNewPassword.length > 128) {
      showToast(translate('Mật khẩu mới phải có độ dài từ 6 đến 128 ký tự.'));
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      showToast(translate('Mật khẩu xác nhận không khớp.'));
      return;
    }
    try {
      setForgotBusy(true);
      const res = await fetch(`${API_BASE_URL}/auth/otp/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({
          identifier: cleanInput,
          otp: cleanOtp,
          newPassword: forgotNewPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.message || translate('Đặt lại mật khẩu thất bại.'));
        return;
      }
      showToast(translate('✓ Đặt lại mật khẩu thành công! Tất cả các phiên cũ đã đăng xuất. Vui lòng đăng nhập lại.'));
      setShowForgotModal(false);
      setForgotStep(1);
      setForgotOtp('');
      setForgotNewPassword('');
      setForgotConfirmPassword('');
      setForgotMaskedEmail('');
      setPasswordInput('');
    } catch {
      showToast(translate('Không thể kết nối đến máy chủ.'));
    } finally {
      setForgotBusy(false);
    }
  };

  const handleRequestActivationOtp = async () => {
    const cleanEmail = activationEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      const errMsg = translate('Email không khớp với tài khoản đã đăng ký');
      setActivationFieldErrors((prev) => ({ ...prev, email: errMsg }));
      setActivationError(errMsg);
      showToast(errMsg);
      return;
    }
    try {
      setActivationBusy(true);
      setActivationError(null);
      setActivationOtpStatus('SENDING');
      const res = await fetch(`${API_BASE_URL}/auth/otp/request-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setActivationOtpStatus('FAILED');
        setActivationCooldown(0);
        const errMsg = data.message || translate('Không thể gửi mã OTP. Vui lòng thử lại');
        if (data.code === 'OTP_COOLDOWN_ACTIVE') {
          setActivationError(errMsg);
        } else if (data.code === 'ACCOUNT_NOT_FOUND' || data.code === 'EMAIL_MISSING') {
          setActivationFieldErrors((prev) => ({ ...prev, email: errMsg }));
        } else {
          setActivationError(errMsg);
        }
        showToast(errMsg);
        return;
      }
      const rawRole = (data.role || data.user?.role || '').toString().toUpperCase().trim();
      if (rawRole === 'TECHNICIAN' || rawRole === 'RESIDENT' || rawRole === 'BMB') {
        setActivationRole(rawRole as 'RESIDENT' | 'TECHNICIAN' | 'BMB');
      }
      if (data.fullName || data.user?.fullName) {
        setActivationFullName(data.fullName || data.user?.fullName);
      }
      setActivationCooldown(60);
      setActivationOtpStatus('SENT');
      setActivationFieldErrors({});
      setActivationError(null);
      const successMsg = data.message || translate('Mã OTP mới đã được gửi đến email của bạn');
      showToast(successMsg);
    } catch {
      setActivationOtpStatus('FAILED');
      setActivationCooldown(0);
      const errMsg = translate('Không thể kết nối máy chủ. Vui lòng thử lại');
      setActivationError(errMsg);
      showToast(errMsg);
    } finally {
      setActivationBusy(false);
    }
  };

  const handleActivateAccount = async () => {
    const cleanEmail = activationEmail.trim().toLowerCase();
    const cleanOtp = activationOtp.trim();
    const fieldErrs: { email?: string; otp?: string; password?: string; confirmPassword?: string } = {};

    if (!cleanEmail || !cleanEmail.includes('@')) {
      fieldErrs.email = translate('Email không khớp với tài khoản đã đăng ký');
    }
    if (!cleanOtp) {
      fieldErrs.otp = translate('Vui lòng nhập đủ 6 chữ số OTP');
    } else if (cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
      fieldErrs.otp = translate('Vui lòng nhập đủ 6 chữ số OTP');
    }
    if (!activationNewPassword) {
      fieldErrs.password = translate('Mật khẩu phải có ít nhất 6 ký tự');
    } else if (activationNewPassword.length < 6) {
      fieldErrs.password = translate('Mật khẩu phải có ít nhất 6 ký tự');
    } else if (activationNewPassword.length > 128) {
      fieldErrs.password = translate('Mật khẩu không được vượt quá 128 ký tự');
    }
    if (!activationConfirmPassword) {
      fieldErrs.confirmPassword = translate('Mật khẩu xác nhận không trùng khớp');
    } else if (activationNewPassword !== activationConfirmPassword) {
      fieldErrs.confirmPassword = translate('Mật khẩu xác nhận không trùng khớp');
    }

    if (Object.keys(fieldErrs).length > 0) {
      setActivationFieldErrors(fieldErrs);
      const firstMsg = Object.values(fieldErrs)[0];
      setActivationError(firstMsg);
      showToast(firstMsg);
      return;
    }

    setActivationFieldErrors({});
    try {
      setActivationBusy(true);
      setActivationError(null);
      const res = await fetch(`${API_BASE_URL}/auth/otp/activate-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({
          email: cleanEmail,
          otp: cleanOtp,
          newPassword: activationNewPassword,
          confirmPassword: activationConfirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const errMsg = data.message || translate('Mã OTP không chính xác. Vui lòng kiểm tra lại');
        if (data.code === 'EMAIL_MISMATCH') {
          setActivationFieldErrors((prev) => ({ ...prev, email: errMsg }));
        } else if (
          data.code === 'OTP_MISMATCH' ||
          data.code === 'OTP_NOT_FOUND' ||
          errMsg.includes('không chính xác')
        ) {
          setActivationOtpStatus('FAILED');
          setActivationFieldErrors((prev) => ({ ...prev, otp: errMsg }));
        } else if (data.code === 'OTP_EXPIRED' || errMsg.includes('hết hạn')) {
          setActivationOtpStatus('EXPIRED');
          setActivationFieldErrors((prev) => ({ ...prev, otp: errMsg }));
        } else if (data.code === 'OTP_ALREADY_USED' || errMsg.includes('đã được sử dụng')) {
          setActivationFieldErrors((prev) => ({ ...prev, otp: errMsg }));
        } else if (data.code === 'CONFIRM_PASSWORD_MISMATCH') {
          setActivationFieldErrors((prev) => ({ ...prev, confirmPassword: errMsg }));
        } else if (data.code === 'PASSWORD_TOO_SHORT' || data.code === 'PASSWORD_TOO_LONG') {
          setActivationFieldErrors((prev) => ({ ...prev, password: errMsg }));
        } else {
          setActivationError(errMsg);
        }
        setActivationError(errMsg);
        showToast(errMsg);
        return;
      }
      setActivationOtpStatus('SUCCESS');
      showToast(translate('Kích hoạt tài khoản thành công'));
      setShowActivationModal(false);
      setPasswordInput(activationNewPassword);
      if (cleanEmail) {
        setPhoneInput(cleanEmail);
      }
      setActivationRole(null);
      setActivationFullName('');
      setActivationOtp('');
      setActivationNewPassword('');
      setActivationConfirmPassword('');
      setActivationError(null);
      setActivationFieldErrors({});
    } catch {
      setActivationOtpStatus('FAILED');
      setActivationCooldown(0);
      const errMsg = translate('Không thể kết nối máy chủ. Vui lòng thử lại');
      setActivationError(errMsg);
      showToast(errMsg);
    } finally {
      setActivationBusy(false);
    }
  };

  const isFetchingDataRef = useRef(false);

  // Helper fetch với cơ chế retry ngắn có giới hạn khi Backend đang khởi động hoặc Neon cold start
  const fetchWithRetry = async (url: string, options: RequestInit, retries = 2, delayMs = 1200): Promise<Response> => {
    let lastError: any = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await fetch(url, options);
        // Nếu trả về 503 (Database tạm thời khởi động), thử lại có giới hạn
        if (res.status === 503 && attempt < retries) {
          await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
        }
      }
    }
    throw lastError || new Error('Không thể kết nối đến máy chủ.');
  };

  const fetchAllData = async (currentToken = token, currentUser = user): Promise<boolean> => {
    if (!currentToken || !currentUser) return false;
    if (isFetchingDataRef.current) return false;
    isFetchingDataRef.current = true;

    try {
      const headers = {
        Authorization: `Bearer ${currentToken}`,
        'bypass-tunnel-reminder': 'true',
      };

      let tRes: Response;
      let nRes: Response;
      try {
        [tRes, nRes] = await Promise.all([
          fetchWithRetry(`${API_BASE_URL}/tickets`, { headers }),
          fetchWithRetry(`${API_BASE_URL}/notifications`, { headers }),
        ]);
      } catch (connErr) {
        console.error('Lỗi kết nối khi tải dữ liệu ban đầu:', connErr);
        setDataLoadError(translate('Không kết nối được Backend. Vui lòng đảm bảo Backend cổng 5000 đang chạy rồi nhấn để thử lại.'));
        return false;
      }

      // Xử lý khi phiên đăng nhập hết hạn hoặc bị từ chối
      if (tRes.status === 401 || tRes.status === 403 || nRes.status === 401 || nRes.status === 403) {
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

      // Kiểm tra danh sách sự cố
      if (!tRes.ok || !tData?.success || !Array.isArray(tData.tickets)) {
        setDataLoadError(tData?.message || translate('Lỗi khi tải danh sách sự cố. Nhấn để thử lại.'));
        return false;
      }

      const list = tData.tickets;
      setTickets(list);
      if (activeTicket) {
        const updated = list.find((item: any) => item.id === activeTicket.id);
        if (updated) {
          const mergedMedia =
            Array.isArray(updated.media) && updated.media.length > 0
              ? updated.media
              : Array.isArray(activeTicket.media) && activeTicket.media.length > 0
                ? activeTicket.media
                : [];
          const mergedPhotos =
            Array.isArray(updated.photos) && updated.photos.length > 0
              ? updated.photos
              : Array.isArray(activeTicket.photos) && activeTicket.photos.length > 0
                ? activeTicket.photos
                : [];
          setActiveTicket({
            ...activeTicket,
            ...updated,
            media: mergedMedia,
            photos: mergedPhotos,
            asset: updated.asset || activeTicket.asset || null,
            area: updated.area || activeTicket.area || null,
          });
        }
      }
      if (currentUser.role === 'BMB') {
        if (list.length > 0) {
          if (!bmbSelectedTicket) {
            handleSelectBmbTicket(list[0]);
          } else {
            const currentSel = list.find((x: any) => x.id === bmbSelectedTicket.id);
            if (currentSel) {
              const mergedMedia =
                Array.isArray(currentSel.media) && currentSel.media.length > 0
                  ? currentSel.media
                  : Array.isArray(bmbSelectedTicket.media) && bmbSelectedTicket.media.length > 0
                    ? bmbSelectedTicket.media
                    : [];
              const mergedPhotos =
                Array.isArray(currentSel.photos) && currentSel.photos.length > 0
                  ? currentSel.photos
                  : Array.isArray(bmbSelectedTicket.photos) && bmbSelectedTicket.photos.length > 0
                    ? bmbSelectedTicket.photos
                    : [];
              setBmbSelectedTicket({
                ...bmbSelectedTicket,
                ...currentSel,
                media: mergedMedia,
                photos: mergedPhotos,
                asset: currentSel.asset || bmbSelectedTicket.asset || null,
                area: currentSel.area || bmbSelectedTicket.area || null,
              });
            } else {
              handleSelectBmbTicket(list[0]);
            }
          }
          const firstPending = list.find((x: any) => x.status === 'PENDING') || list[0];
          setBmbRadioTicketId(firstPending.id);
        } else {
          setBmbSelectedTicket(null);
          setBmbRadioTicketId('');
        }
      }

      // Kiểm tra danh sách thông báo (không làm hỏng danh sách sự cố đã tải thành công)
      if (nRes.ok && nData?.success && Array.isArray(nData.notifications)) {
        setNotifications(nData.notifications);
        setUnreadCount(Number.isInteger(nData.unreadCount) ? nData.unreadCount : 0);
      }

      // Tải thông tin liên hệ khẩn cấp
      void fetch(`${API_BASE_URL}/management/emergency-contact`, { headers })
        .then((r) => r.json())
        .then((d) => {
          if (d?.emergencyContact) {
            setEmergencyContact(d.emergencyContact);
            setEmergencyNameInput(d.emergencyContact.managerName);
            setEmergencyPhoneInput(d.emergencyContact.managerPhone);
          }
        })
        .catch(() => undefined);

      if (currentUser.role === 'BMB') {
        // Tải danh sách kỹ thuật viên
        try {
          const techRes = await fetchWithRetry(`${API_BASE_URL}/tickets/technicians/on-duty`, { headers });
          if (techRes.status === 401 || techRes.status === 403) {
            void AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY).catch(() => undefined);
            setToken(null);
            setUser(null);
            setToastMsg(translate('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'));
            return false;
          }
          const techData = await techRes.json().catch(() => ({}));
          if (techRes.ok && techData?.success && Array.isArray(techData.technicians)) {
            const techList = techData.technicians;
            setTechnicians(techList);
            const firstDuty = techList.find((t: any) => t.isOnDuty) || techList[0];
            if (firstDuty) {
              setBmbTechId((current) => techList.some((item: any) => item.id === current) ? current : firstDuty.id);
              setBmbAssignTargetTech((current: any) => techList.find((item: any) => item.id === current?.id) || firstDuty);
              setBmbViewingWorkloadTech((current: any) => techList.find((item: any) => item.id === current?.id) || firstDuty);
            }
          }
        } catch (techErr) {
          console.warn('Lỗi khi tải danh sách kỹ thuật viên:', techErr);
        }

        // Tải danh sách căn hộ & cư dân cho BMB
        try {
          const [aptRes, resRes] = await Promise.all([
            fetch(`${API_BASE_URL}/management/apartments`, { headers }),
            fetch(`${API_BASE_URL}/management/residents`, { headers }),
          ]);
          const aptData = await aptRes.json().catch(() => null);
          const resData = await resRes.json().catch(() => null);

          if (aptData?.apartments) {
            setApartments(aptData.apartments);
            setSelectedApartment((current: any) => {
              if (!current) return aptData.apartments[0] || null;
              return aptData.apartments.find((a: any) => a.apartmentCode === current.apartmentCode) || aptData.apartments[0] || null;
            });
          }
          console.log(`[CLIENT_RESIDENT_LOG][${new Date().toISOString()}] GET /management/residents completed. Received: ${resData?.residents?.length ?? 0} records (source: fetchAllData)`);
          if (resData?.residents) {
            setResidentsList(resData.residents);
          }
        } catch {
          // Bỏ qua lỗi nền khi tải căn hộ/cư dân
        }

        // Tải bảng lương và chấm công BMB (độc lập)
        void fetch(`${API_BASE_URL}/payroll/admin/summary?month=${encodeURIComponent(bmbPayrollMonth)}`, { headers })
        void fetch(`${API_BASE_URL}/payroll/admin/summary`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.success) {
              setBmbPayrollSummary(d);
              if (Array.isArray(d.payrolls)) {
                const initBonuses: Record<string, string> = {};
                const initNotes: Record<string, string> = {};
                for (const p of d.payrolls) {
                  initBonuses[p.techId] = String(p.bmbBonus ?? 0);
                  initNotes[p.techId] = p.bmbBonusNote || '';
                }
                setBmbBonusInputs(initBonuses);
                setBmbBonusNotes(initNotes);
              }
            }
            if (d?.success) setBmbPayrollSummary(d);
          })
          .catch(() => undefined);

        void fetch(`${API_BASE_URL}/payroll/admin/attendance`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.attendanceLogs) setBmbAttendanceLogs(d.attendanceLogs);
            if (d?.anomalies) setBmbAnomalies(d.anomalies);
            if (Array.isArray(d?.technicianRosterStatus)) {
              setBmbTechnicianRosterStatus(d.technicianRosterStatus);
            }
            if (d?.success) {
              setBmbAttendanceStats({
                totalLogs: d.totalLogs || (d.attendanceLogs ? d.attendanceLogs.length : 0),
                currentlyOnDutyCount: d.currentlyOnDutyCount || 0,
                completedShiftCount: d.completedShiftCount || 0,
                verifiedCount: d.verifiedCount || 0,
                pendingReviewCount: d.pendingReviewCount || 0,
                lateCount: d.lateCount || 0,
                earlyLeaveCount: d.earlyLeaveCount || 0,
                notCheckedInCount: d.notCheckedInCount || 0,
                totalBillableHours: d.totalBillableHours || 0,
                totalDisputedHours: d.totalDisputedHours || 0,
              });
            }
          })
          .catch(() => undefined);

        void fetch(`${API_BASE_URL}/payroll/admin/overtime`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.overtimeRequests) setBmbOvertimeRequests(d.overtimeRequests);
          })
          .catch(() => undefined);

        void fetch(`${API_BASE_URL}/payroll/admin/building-location`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.success && d?.buildingLocation) {
              setBmbBuildingLocation(d.buildingLocation);
              setBmbBuildingForm({
                buildingName: d.buildingLocation.buildingName || '',
                buildingAddress: d.buildingLocation.buildingAddress || '',
                latitude: String(d.buildingLocation.latitude ?? DEFAULT_BUILDING_LOCATION.latitude),
                longitude: String(d.buildingLocation.longitude ?? DEFAULT_BUILDING_LOCATION.longitude),
                allowedRadiusMeters: String(d.buildingLocation.allowedRadiusMeters ?? DEFAULT_BUILDING_LOCATION.allowedRadiusMeters),
                note: '',
              });
            }
          })
          .catch(() => undefined);

        // 3 Module BMB: Lịch & Nghỉ phép, Chi phí, Dashboard SLA
        void fetch(`${API_BASE_URL}/schedule/admin/requests`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.requests) setScheduleRequests(d.requests);
          })
          .catch(() => undefined);

        void fetch(`${API_BASE_URL}/costs/admin/report`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.success) setCostReport(d);
          })
          .catch(() => undefined);

        void fetch(`${API_BASE_URL}/sla/admin/dashboard`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.success) setSlaDashboard(d);
          })
          .catch(() => undefined);
      } else if (currentUser.role === 'TECHNICIAN') {
        setTechnicians([]);
        // Tải chấm công & lương cá nhân của KTV
        void fetch(`${API_BASE_URL}/payroll/my-attendance`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.logs) setMyAttendanceLogs(d.logs);
          })
          .catch(() => undefined);

        void fetch(`${API_BASE_URL}/payroll/my-overtime`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.overtimes) setMyOvertimeRequests(d.overtimes);
          })
          .catch(() => undefined);

        void fetch(`${API_BASE_URL}/payroll/my-salary`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.payroll) setMyPayrollData(d.payroll);
          })
          .catch(() => undefined);

        // 3 Module mới KTV: Lịch trực & Đổi ca
        void fetch(`${API_BASE_URL}/schedule/my-schedule`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.success) setMyScheduleData(d);
          })
          .catch(() => undefined);

        void fetch(`${API_BASE_URL}/schedule/my-requests`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.requests) setMyScheduleRequests(d.requests);
          })
          .catch(() => undefined);
      } else {
        setTechnicians([]);
      }

      setDataLoadError(null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : translate('Không thể tải dữ liệu. Vui lòng thử lại.');
      console.error('Lỗi khi tải dữ liệu ứng dụng:', error);
      setDataLoadError(message);
      return false;
    } finally {
      isFetchingDataRef.current = false;
    }
  };

  useEffect(() => {
    let mounted = true;

    const restoreSession = async (retryCount = 0) => {
      try {
        const savedSession = await AsyncStorage.getItem(AUTH_SESSION_STORAGE_KEY);
        if (!savedSession || !mounted) return;

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

        let response: Response | null = null;
        try {
          response = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: {
              Authorization: `Bearer ${session.token}`,
              'bypass-tunnel-reminder': 'true',
            },
          });
        } catch {
          // Khi Backend chưa bật hoặc đang khởi động, thử lại tối đa 2 lần với backoff
          if (retryCount < 2) {
            await new Promise((r) => setTimeout(r, 1500 * (retryCount + 1)));
            if (mounted) void restoreSession(retryCount + 1);
            return;
          }
          // Sau 2 lần thử vẫn không kết nối được: giữ nguyên session trong AsyncStorage và báo rõ cho người dùng
          if (mounted) {
            setDataLoadError(translate('Không thể kết nối đến máy chủ Backend (Cổng 5000). Hãy đảm bảo Backend đang chạy rồi nhấn để thử lại.'));
          }
          return;
        }

        if (!response) return;

        // Phiên đăng nhập hết hạn hoặc bị từ chối trên server -> Xóa phiên và thông báo
        if (response.status === 401 || response.status === 403) {
          await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
          if (mounted) {
            setToken(null);
            setUser(null);
            showToast(translate('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'));
          }
          return;
        }

        // Nếu database đang kết nối (503), thử lại có giới hạn
        if (response.status === 503 && retryCount < 2) {
          await new Promise((r) => setTimeout(r, 1500 * (retryCount + 1)));
          if (mounted) void restoreSession(retryCount + 1);
          return;
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success || !data?.user) {
          if (mounted) {
            showToast(data?.message || translate('Không thể xác minh phiên đăng nhập.'));
          }
          return;
        }

        if (!mounted) return;
        setToken(session.token);
        setUser(data.user);
        setRememberMe(true);
        await fetchAllData(session.token, data.user);
      } catch (error) {
        if (mounted) {
          console.error('Lỗi khôi phục phiên đăng nhập:', error);
        }
      }
    };

    void restoreSession();

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

  const parseShiftTimes = (shiftName?: string | null) => {
    if (!shiftName) return { start: '07:00', end: '15:00' };
    const match = shiftName.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);
    if (match) {
      return {
        start: match[1].padStart(5, '0'),
        end: match[2].padStart(5, '0'),
      };
    }
    return { start: '07:00', end: '15:00' };
  };

  const openCreateTechnician = () => {
    setSelectedTechnician(null);
    setTechnicianForm(EMPTY_TECHNICIAN_FORM);
    setTechnicianFieldErrors({});
    setTechnicianFormError(null);
    setTimePickerTarget(null);
    setTechnicianDialogMode('create');
  };

  const openEditTechnician = (technician: any) => {
    setSelectedTechnician(technician);
    const { start, end } = parseShiftTimes(technician.shiftName);
    setTechnicianForm({
      fullName: technician.fullName || '',
      phone: (technician.phone || '').replace(/\D/g, '').slice(0, 10),
      email: technician.email || '',
      password: '',
      specialty: technician.specialty || 'PLUMBING',
      shiftStartTime: start,
      shiftEndTime: end,
      isOnDuty: Boolean(technician.isOnDuty),
    });
    setTechnicianFieldErrors({});
    setTechnicianFormError(null);
    setTimePickerTarget(null);
    setTechnicianDialogMode('edit');
  };

  const closeTechnicianDialog = () => {
    if (technicianFormBusy) return;
    setTechnicianDialogMode(null);
    setTechnicianFieldErrors({});
    setTechnicianFormError(null);
    setTimePickerTarget(null);
  };

  const saveTechnician = async () => {
    const errors: {
      fullName?: string;
      phone?: string;
      email?: string;
      password?: string;
      shift?: string;
      specialty?: string;
    } = {};

    const cleanName = technicianForm.fullName.trim();
    if (!cleanName) {
      errors.fullName = translate('Họ và tên không được để trống.');
    } else if (cleanName.length < 2) {
      errors.fullName = translate('Họ và tên tối thiểu 2 ký tự.');
    }

    const cleanPhone = technicianForm.phone.trim();
    if (!cleanPhone) {
      errors.phone = translate('Số điện thoại không được để trống.');
    } else if (!/^0\d{9}$/.test(cleanPhone)) {
      errors.phone = translate('Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.');
    }

    const cleanEmail = technicianForm.email.trim();
    if (!cleanEmail) {
      errors.email = translate('Email là bắt buộc để Kỹ thuật viên nhận mã OTP kích hoạt tài khoản.');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      errors.email = translate('Email không đúng định dạng (ví dụ: email@domain.com).');
    }

    if (technicianDialogMode === 'create') {
      if (!technicianForm.password) {
        errors.password = translate('Mật khẩu ban đầu không được để trống.');
      } else if (technicianForm.password.length < 6) {
        errors.password = translate('Mật khẩu ban đầu tối thiểu 6 ký tự.');
      }
    } else if (technicianForm.password && technicianForm.password.length < 6) {
      errors.password = translate('Mật khẩu mới tối thiểu 6 ký tự.');
    }

    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeRegex.test(technicianForm.shiftStartTime)) {
      errors.shift = translate('Giờ bắt đầu không hợp lệ (HH:mm, 24 giờ).');
    } else if (!timeRegex.test(technicianForm.shiftEndTime)) {
      errors.shift = translate('Giờ kết thúc không hợp lệ (HH:mm, 24 giờ).');
    } else if (technicianForm.shiftStartTime === technicianForm.shiftEndTime) {
      errors.shift = translate('Giờ bắt đầu và kết thúc không được trùng nhau.');
    }

    if (!technicianForm.specialty || !CATEGORIES_LIST.includes(technicianForm.specialty)) {
      errors.specialty = translate('Vui lòng chọn chuyên môn.');
    }

    if (Object.keys(errors).length > 0) {
      setTechnicianFieldErrors(errors);
      return;
    }

    const shiftFormatted = `${technicianForm.shiftStartTime} - ${technicianForm.shiftEndTime}`;
    const payload: Record<string, unknown> = {
      fullName: cleanName,
      phone: cleanPhone,
      email: cleanEmail || null,
      specialty: technicianForm.specialty,
      shiftName: shiftFormatted,
      isOnDuty: technicianForm.isOnDuty,
    };
    if (technicianForm.password) payload.password = technicianForm.password;

    try {
      setTechnicianFormError(null);
      setTechnicianFieldErrors({});
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
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'bypass-tunnel-reminder': 'true',
          },
          body: JSON.stringify({
            handoverTechId: handoverTechId || undefined,
          }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        if (result.requiresHandover || (result.message && result.message.includes('bàn giao'))) {
          setTechnicianActiveTicketsCount(result.activeCount || 1);
        }
        setTechnicianFormError(result.message || translate('Không thể xóa kỹ thuật viên.'));
        return;
      }

      await fetchAllData();
      setTechnicianDialogMode(null);
      setSelectedTechnician(null);
      setHandoverTechId('');
      setTechnicianActiveTicketsCount(0);
      showToast(result.message || translate('Đã vô hiệu hóa kỹ thuật viên.'));
    } catch {
      setTechnicianFormError(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setTechnicianFormBusy(false);
    }
  };

  // --------------------------------------------------------------------------
  // HÀM QUẢN LÝ LIÊN HỆ KHẨN CẤP
  // --------------------------------------------------------------------------
  const handleSaveEmergencyContact = async () => {
    const cleanPhone = emergencyPhoneInput.replace(/[^\d]/g, '').slice(0, 10);
    if (!/^0\d{9}$/.test(cleanPhone)) {
      showToast(translate('Số điện thoại phải gồm 10 chữ số và bắt đầu bằng số 0.'));
      return;
    }
    if (emergencyNameInput.trim().length < 2) {
      showToast(translate('Họ và tên người phụ trách tối thiểu 2 ký tự.'));
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/management/emergency-contact`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          managerName: emergencyNameInput.trim(),
          managerPhone: cleanPhone,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        setEmergencyContact(data.emergencyContact);
        setEditingEmergencyContact(false);
        showToast(translate('Đã cập nhật liên hệ khẩn cấp thành công.'));
      } else {
        showToast(data?.message || translate('Lỗi khi cập nhật liên hệ khẩn cấp.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  // --------------------------------------------------------------------------
  // HÀM QUẢN LÝ CĂN HỘ & CƯ DÂN
  // --------------------------------------------------------------------------
  const handleSelectApartment = async (apt: any) => {
    setSelectedApartment(apt);
    setApartmentRepairsFullHistory(false);
    try {
      const res = await fetch(`${API_BASE_URL}/management/apartments/${apt.apartmentCode}/repairs?all=false`, {
        headers: { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' },
      });
      const data = await res.json().catch(() => ({}));
      if (data?.repairs) setApartmentRepairs(data.repairs);
    } catch {
      // ignore
    }
  };

  const handleToggleApartmentRepairsHistory = async (isFull: boolean) => {
    if (!selectedApartment) return;
    setApartmentRepairsFullHistory(isFull);
    try {
      const res = await fetch(`${API_BASE_URL}/management/apartments/${selectedApartment.apartmentCode}/repairs?all=${isFull}`, {
        headers: { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' },
      });
      const data = await res.json().catch(() => ({}));
      if (data?.repairs) setApartmentRepairs(data.repairs);
    } catch {
      // ignore
    }
  };

  const handleSaveResident = async () => {
    setResidentModalError(null);
    const cleanName = residentForm.fullName.trim();
    const digitsOnly = residentForm.phone.replace(/[^\d]/g, '');
    const cleanEmail = residentForm.email.trim();

    if (cleanName.length < 2) {
      setResidentModalError(translate('Vui lòng nhập họ tên cư dân (tối thiểu 2 ký tự).'));
      return;
    }

    if (!/^0\d{9}$/.test(digitsOnly)) {
      setResidentModalError(translate('Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0 (ví dụ: 0905123456).'));
      return;
    }

    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setResidentModalError(translate('Vui lòng nhập địa chỉ email hợp lệ (ví dụ: resident@gmail.com).'));
      return;
    }

    const aptCode = residentForm.apartmentCode || 'G101';
    const bBlock = residentForm.buildingBlock || 'Tòa G';
    const fNum = residentForm.floorNumber || 1;

    try {
      setResidentModalBusy(true);
      const isEdit = residentModalMode === 'edit' && selectedResident;
      const url = isEdit ? `${API_BASE_URL}/management/residents/${selectedResident.id}` : `${API_BASE_URL}/management/residents`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          fullName: cleanName,
          phone: digitsOnly,
          email: cleanEmail || null,
          apartmentCode: aptCode,
          buildingBlock: bBlock,
          floorNumber: fNum,
          residencyRole: residentForm.residencyRole || 'TENANT',
          moveInDate: residentForm.moveInDate || new Date().toISOString().slice(0, 10),
          moveOutDate: residentForm.moveOutDate || null,
          isRepresentative: residentForm.residencyRole === 'OWNER',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setResidentModalMode(null);
        setResidentModalError(null);
        if (data.temporaryPassword) {
          setCreatedTempPasswordData({
            temporaryPassword: data.temporaryPassword,
            residentName: cleanName,
            apartmentCode: aptCode,
            phone: digitsOnly,
            isExistingUser: data.isExistingUser,
          });
        } else {
          showToast(translate(isEdit ? 'Đã cập nhật thông tin cư dân.' : (data.message || 'Đã liên kết cư dân thành công.')));
        }

        // Cập nhật ngay danh sách cư dân trên UI mà không cần chờ fetch nền
        if (data.resident) {
          const savedResident = data.resident;
          setResidentsList((prev) => {
            const idx = prev.findIndex((r) => r.id === savedResident.id || (r.phone && r.phone === savedResident.phone));
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], ...savedResident };
              return copy;
            }
            return [savedResident, ...prev];
          });
        }

        // Tải lại trực tiếp danh sách cư dân & căn hộ có độ ưu tiên cao
        try {
          const [rRes, aRes] = await Promise.all([
            fetch(`${API_BASE_URL}/management/residents`, {
              headers: { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' },
            }),
            fetch(`${API_BASE_URL}/management/apartments`, {
              headers: { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' },
            }),
          ]);
          const rJson = await rRes.json().catch(() => null);
          const aJson = await aRes.json().catch(() => null);
          if (rJson?.residents) {
            setResidentsList(rJson.residents);
          }
          if (aJson?.apartments) {
            setApartments(aJson.apartments);
            setSelectedApartment((current: any) => {
              if (!current) return aJson.apartments[0] || null;
              return aJson.apartments.find((a: any) => a.apartmentCode === current.apartmentCode) || aJson.apartments[0] || null;
            });
          }
        } catch (fetchErr) {
          console.warn('Lỗi khi tải lại dữ liệu cư dân/căn hộ sau khi lưu:', fetchErr);
        }

        console.log(`[CLIENT_RESIDENT_LOG][${new Date().toISOString()}] POST /management/residents success: residentId=${data.resident?.id}, apt=${data.resident?.apartmentCode}. Refreshing authoritative state via fetchAllData() (source: handleSaveResident)`);
        await fetchAllData();
      } else {
        const errMsg = data?.message || translate(`Lỗi máy chủ (${res.status}). Không thể lưu thông tin.`);
        setResidentModalError(errMsg);
        showToast(errMsg);
      }
    } catch {
      const connErr = translate('Không kết nối được Backend. Vui lòng kiểm tra lại kết nối mạng hoặc Terminal Backend.');
      setResidentModalError(connErr);
      showToast(connErr);
    } finally {
      setResidentModalBusy(false);
    }
  };

  const handleResetResidentPassword = async () => {
    if (!selectedResident) return;
    setResidentModalError(null);
    try {
      setResidentModalBusy(true);
      const res = await fetch(`${API_BASE_URL}/management/residents/${selectedResident.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({ newPassword: newPasswordInput.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setResidentModalMode(null);
        setResidentModalError(null);
        setNewPasswordInput('');
        if (data.temporaryPassword) {
          setCreatedTempPasswordData({
            temporaryPassword: data.temporaryPassword,
            residentName: selectedResident.fullName,
            apartmentCode: selectedResident.apartmentCode || '',
            phone: selectedResident.phone,
          });
        } else {
          showToast(translate(data.message || 'Đã đặt lại mật khẩu thành công!'));
        }
      } else {
        const errMsg = data?.message || translate('Lỗi khi đặt lại mật khẩu.');
        setResidentModalError(errMsg);
        showToast(errMsg);
      }
    } catch {
      const connErr = translate('Không kết nối được Backend. Vui lòng thử lại.');
      setResidentModalError(connErr);
      showToast(connErr);
    } finally {
      setResidentModalBusy(false);
    }
  };

  const handleResidentDeparture = async (resId: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/management/residents/${resId}/move-out`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({ moveOutDate: new Date().toISOString().slice(0, 10) }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(data.message || translate('Đã hoàn tất bàn giao / chuyển đi cho cư dân.'));
        setResidentsList((prev) => prev.filter((r) => r.id !== resId));
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi ghi nhận chuyển đi.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };

  const executeDeleteResident = async (resId: string, purge: boolean = true) => {
    try {
      setLoading(true);
      const url = `${API_BASE_URL}/management/residents/${resId}${purge ? '?purge=true' : ''}`;
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(data.message || translate('Đã xóa tài khoản cư dân thành công.'));
        setResidentsList((prev) => prev.filter((r) => r.id !== resId));
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi xóa tài khoản cư dân.'));
      }
    } catch {
      showToast(translate('Không kết nối được server.'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteResident = (resId: string, residentName: string) => {
    const confirmMessage = translate(`Bạn có chắc chắn muốn xóa tài khoản của cư dân ${residentName}? Toàn bộ lịch sử sự cố và dữ liệu liên quan sẽ được lưu vết an toàn trong database.`);
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm && window.confirm(confirmMessage)) {
        void executeDeleteResident(resId, true);
      }
      return;
    }

    Alert.alert(
      translate('Xóa tài khoản cư dân'),
      confirmMessage,
      [
        { text: translate('Hủy'), style: 'cancel' },
        {
          text: translate('Xóa'),
          style: 'destructive',
          onPress: () => {
            void executeDeleteResident(resId, true);
          },
        },
      ]
    );
  };





  // --------------------------------------------------------------------------
  // HÀM CHẤM CÔNG & LƯƠNG CHUYÊN SÂU (GPS, CAMERA & PHÊ DUYỆT BMB)
  // --------------------------------------------------------------------------
  const fetchBmbAttendance = async (overrideParams?: {
    date?: string;
    month?: string;
    techId?: string;
    buildingBlock?: string;
    status?: string;
  }) => {
    try {
      const qDate = overrideParams?.date !== undefined ? overrideParams.date : bmbAttendanceFilterDate;
      const qMonth = overrideParams?.month !== undefined ? overrideParams.month : bmbAttendanceFilterMonth;
      const qTech = overrideParams?.techId !== undefined ? overrideParams.techId : bmbAttendanceFilterTech;
      const qBuilding = overrideParams?.buildingBlock !== undefined ? overrideParams.buildingBlock : bmbAttendanceFilterBuilding;
      const qStatus = overrideParams?.status !== undefined ? overrideParams.status : bmbAttendanceFilterStatus;

      const params = new URLSearchParams();
      if (qDate) params.append('date', qDate);
      if (qMonth) params.append('month', qMonth);
      if (qTech && qTech !== 'ALL') params.append('techId', qTech);
      if (qBuilding && qBuilding !== 'ALL') params.append('buildingBlock', qBuilding);
      if (qStatus && qStatus !== 'ALL') params.append('status', qStatus);

      const res = await fetch(`${API_BASE_URL}/payroll/admin/attendance?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' },
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && Array.isArray(data.attendanceLogs)) {
        setBmbAttendanceLogs(data.attendanceLogs);
        if (data.anomalies) setBmbAnomalies(data.anomalies);
        if (Array.isArray(data.technicianRosterStatus)) {
          setBmbTechnicianRosterStatus(data.technicianRosterStatus);
        }
        setBmbAttendanceStats({
          totalLogs: data.totalLogs || data.attendanceLogs.length,
          currentlyOnDutyCount: data.currentlyOnDutyCount || 0,
          completedShiftCount: data.completedShiftCount || 0,
          verifiedCount: data.verifiedCount || 0,
          pendingReviewCount: data.pendingReviewCount || 0,
          lateCount: data.lateCount || 0,
          earlyLeaveCount: data.earlyLeaveCount || 0,
          notCheckedInCount: data.notCheckedInCount || 0,
          totalBillableHours: data.totalBillableHours || 0,
          totalDisputedHours: data.totalDisputedHours || 0,
        });
      }
    } catch (err) {
      console.warn('Lỗi khi tải danh sách chấm công BMB:', err);
    }
  };

  const fetchBmbPayrollSummary = async (overrideMonth?: string) => {
    try {
      const m = (overrideMonth ?? bmbPayrollMonth).trim() || new Date().toISOString().slice(0, 7);
      const res = await fetch(`${API_BASE_URL}/payroll/admin/summary?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' },
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        setBmbPayrollSummary(data);
        if (Array.isArray(data.payrolls)) {
          const initBonuses: Record<string, string> = {};
          const initNotes: Record<string, string> = {};
          for (const p of data.payrolls) {
            initBonuses[p.techId] = String(p.bmbBonus ?? 0);
            initNotes[p.techId] = p.bmbBonusNote || '';
          }
          setBmbBonusInputs(initBonuses);
          setBmbBonusNotes(initNotes);
        }
      }
    } catch (err) {
      console.warn('Lỗi khi tải bảng lương BMB:', err);
    }
  };

  const handleSaveBmbBonus = async (techId: string, techName: string) => {
    if (!token) return;
    const rawVal = (bmbBonusInputs[techId] ?? '0').replace(/[^\d-]/g, '').trim();
    const numBonus = Number(rawVal);
    if (rawVal === '' || isNaN(numBonus) || numBonus < 0) {
      showToast(translate('Tiền thưởng không hợp lệ. Vui lòng nhập số không âm (>= 0 VNĐ).'));
      return;
    }
    try {
      setBmbSavingBonusTechId(techId);
      const res = await fetch(`${API_BASE_URL}/payroll/admin/bonus`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          techId,
          month: bmbPayrollSummary?.month || bmbPayrollMonth,
          bonusAmount: numBonus,
          note: (bmbBonusNotes[techId] || '').trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showToast(data.message || `✓ Đã lưu tiền thưởng cho ${techName}`);
        await fetchBmbPayrollSummary(bmbPayrollSummary?.month || bmbPayrollMonth);
      } else {
        showToast(data?.message || translate('Không thể lưu tiền thưởng.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend khi lưu tiền thưởng.'));
    } finally {
      setBmbSavingBonusTechId(null);
    }
  };

  const handleBmbReviewAttendance = async () => {
    if (!selectedAttendanceForReview) return;
    if (!bmbReviewNote.trim()) {
      showToast(translate('Vui lòng nhập lý do / phản hồi của BMB để lưu vết audit log.'));
      return;
    }
    try {
      setLoading(true);
      const payload: any = {
        action: bmbReviewAction,
        reviewNote: bmbReviewNote.trim(),
      };
      if (bmbReviewAction === 'APPROVE' && bmbAdjustedHours.trim()) {
        payload.adjustedHours = Number(bmbAdjustedHours);
      }
      const res = await fetch(`${API_BASE_URL}/payroll/admin/attendance/${selectedAttendanceForReview.id}/review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(data.message || translate('Xử lý duyệt chấm công thành công.'));
        setShowAttendanceReviewModal(false);
        setSelectedAttendanceForReview(null);
        setBmbReviewNote('');
        setBmbAdjustedHours('');
        await fetchBmbAttendance();
      } else {
        showToast(data?.message || translate('Lỗi khi duyệt chấm công.'));
      }
    } catch {
      showToast(translate('Không kết nối được server.'));
    } finally {
      setLoading(false);
    }
  };

  const getDeviceLocation = async (): Promise<{ latitude: number; longitude: number; accuracy: number } | null> => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted) {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (loc?.coords) {
          return {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: Math.round(loc.coords.accuracy || 10),
          };
        }
      }
    } catch (err) {
      console.warn('Location.getCurrentPositionAsync fallback warning:', err);
    }

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: Math.round(pos.coords.accuracy || 10),
            });
          },
          (err) => {
            console.warn('Geolocation warning:', err.message);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
        );
      });
    }
    return null;
  };

  const handlePickCheckInPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          translate('Yêu cầu quyền Camera'),
          translate('ResiFix yêu cầu quyền mở Camera để chụp ảnh selfie/hiện trường trực tiếp tại điểm chấm công. Hệ thống không cho phép tải ảnh từ thư viện để đảm bảo tính khách quan và chống giả mạo.')
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.6,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.base64) {
          const mime = asset.mimeType || 'image/jpeg';
          setTechPhotoUri(`data:${mime};base64,${asset.base64}`);
        } else {
          setTechPhotoUri(asset.uri);
        }
      }
    } catch (err) {
      console.warn('ImagePicker error:', err);
      Alert.alert(translate('Lỗi chụp ảnh'), translate('Không thể mở Camera. Vui lòng kiểm tra quyền thiết bị.'));
    }
  };

  const executeTechAttendance = async (mode: 'CHECK_IN' | 'CHECK_OUT') => {
    try {
      setLoading(true);

      // 1. Lấy single-use attendance nonce từ server để chống replay attack
      let nonce: string | undefined;
      try {
        const nonceRes = await fetch(`${API_BASE_URL}/payroll/attendance-nonce`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'bypass-tunnel-reminder': 'true',
          },
        });
        const nonceData = await nonceRes.json().catch(() => ({}));
        if (nonceData?.success && nonceData?.nonce) {
          nonce = nonceData.nonce;
        }
      } catch (err) {
        console.warn('Không lấy được attendance nonce:', err);
      }

      const loc = await getDeviceLocation();
      const endpoint = mode === 'CHECK_IN' ? `${API_BASE_URL}/payroll/check-in` : `${API_BASE_URL}/payroll/check-out`;

      const payload: any = {
        photoUrl: techPhotoUri,
        notes: techCheckInNotes.trim() || undefined,
        nonce,
      };
      if (loc) {
        payload.latitude = loc.latitude;
        payload.longitude = loc.longitude;
        payload.accuracy = loc.accuracy;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(data.message || (mode === 'CHECK_IN' ? translate('Check-in thành công!') : translate('Check-out thành công!')));
        setTechCheckInModal({ visible: false, mode: 'CHECK_IN' });
        setTechPhotoUri(null);
        setTechCheckInNotes('');
        await fetchAllData();
      } else {
        showToast(data?.message || (mode === 'CHECK_IN' ? translate('Lỗi khi check-in.') : translate('Lỗi khi check-out.')));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveBuildingLocation = async () => {
    try {
      setLoading(true);
      const lat = parseFloat(bmbBuildingForm.latitude);
      const lon = parseFloat(bmbBuildingForm.longitude);
      const rad = parseInt(bmbBuildingForm.allowedRadiusMeters, 10);

      if (!bmbBuildingForm.buildingName.trim() || bmbBuildingForm.buildingName.trim().length < 3) {
        Alert.alert(translate('Lỗi nhập liệu'), translate('Tên tòa nhà phải từ 3 ký tự trở lên.'));
        return;
      }
      if (!bmbBuildingForm.buildingAddress.trim() || bmbBuildingForm.buildingAddress.trim().length < 5) {
        Alert.alert(translate('Lỗi nhập liệu'), translate('Địa chỉ tòa nhà phải từ 5 ký tự trở lên.'));
        return;
      }
      if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lon) || lon < -180 || lon > 180) {
        Alert.alert(translate('Lỗi nhập liệu'), translate('Tọa độ GPS không hợp lệ (-90 đến 90, -180 đến 180).'));
        return;
      }
      if (isNaN(rad) || rad < 50 || rad > 5000) {
        Alert.alert(translate('Lỗi nhập liệu'), translate('Bán kính cho phép phải từ 50m đến 5000m.'));
        return;
      }

      const res = await fetch(`${API_BASE_URL}/payroll/admin/building-location`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          buildingName: bmbBuildingForm.buildingName.trim(),
          buildingAddress: bmbBuildingForm.buildingAddress.trim(),
          latitude: lat,
          longitude: lon,
          allowedRadiusMeters: rad,
          note: bmbBuildingForm.note.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(data.message || translate('Đã lưu và xác nhận tọa độ tòa nhà thành công.'));
        setBmbBuildingLocation(data.buildingLocation);
        setBmbBuildingModalVisible(false);
        await fetchAllData();
      } else {
        Alert.alert(translate('Lỗi'), data?.message || translate('Không thể cập nhật tọa độ tòa nhà.'));
      }
    } catch {
      Alert.alert(translate('Lỗi kết nối'), translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };

  const handleTechCheckIn = async () => {
    setTechPhotoUri(null);
    setTechCheckInNotes('');
    setTechCheckInModal({ visible: true, mode: 'CHECK_IN' });
  };

  const handleTechCheckOut = async () => {
    setTechPhotoUri(null);
    setTechCheckInNotes('');
    setTechCheckInModal({ visible: true, mode: 'CHECK_OUT' });
  };

  const handleTechSubmitExplanation = async () => {
    if (!techExplanationModal.log) return;
    if (!techExplanationInput.trim()) {
      showToast(translate('Vui lòng nhập nội dung giải trình.'));
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/payroll/my-attendance/${techExplanationModal.log.id}/explain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({ explanationText: techExplanationInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(data.message || translate('Đã gửi giải trình thành công.'));
        setTechExplanationModal({ visible: false, log: null });
        setTechExplanationInput('');
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi gửi giải trình.'));
      }
    } catch {
      showToast(translate('Không kết nối được server.'));
    } finally {
      setLoading(false);
    }
  };





  const renderAttendanceReviewModal = () => (
    <Modal
      visible={showAttendanceReviewModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowAttendanceReviewModal(false)}
    >
      <View style={styles.technicianModalOverlay}>
        <AnimatedModalContent visible={showAttendanceReviewModal} style={[styles.technicianModalCard, { width: 560 }]}>
          <Text style={styles.technicianModalTitle}>
            {bmbReviewAction === 'APPROVE' ? translate('Phê duyệt Chấm công') :
              bmbReviewAction === 'REQUEST_EXPLANATION' ? translate('Yêu cầu KTV Giải trình') :
                translate('Từ chối tính công')}
          </Text>
          <Text style={styles.technicianModalDescription}>
            {translate('Kỹ thuật viên:')} <Text style={{ fontWeight: '700' }}>{selectedAttendanceForReview?.techName}</Text> • {translate('Ngày:')} {selectedAttendanceForReview?.date} • {translate('Ca:')} {selectedAttendanceForReview?.shiftScheduled || '07:00 - 15:00'}
          </Text>

          {/* Chọn hành động */}
          <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
            {[
              { key: 'APPROVE', label: '✓ Phê duyệt', color: '#16A34A' },
              { key: 'REQUEST_EXPLANATION', label: '💬 Yêu cầu giải trình', color: '#7E22CE' },
              { key: 'REJECT', label: '✕ Từ chối', color: '#DC2626' },
            ].map((act) => (
              <TouchableOpacity
                key={act.key}
                style={[
                  styles.bmbFilterChip,
                  bmbReviewAction === act.key && { backgroundColor: act.color, borderColor: act.color },
                  { flex: 1, alignItems: 'center', paddingVertical: 8, marginBottom: 0 }
                ]}
                onPress={() => {
                  setBmbReviewAction(act.key as any);
                  if (act.key === 'APPROVE' && !bmbAdjustedHours) {
                    setBmbAdjustedHours(String(selectedAttendanceForReview?.workHours || 8));
                  }
                }}
              >
                <Text style={[
                  styles.bmbFilterChipText,
                  bmbReviewAction === act.key ? { color: '#FFFFFF', fontWeight: '700' } : { color: '#334155' }
                ]}>
                  {translate(act.label)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Nếu Phê duyệt: cho phép điều chỉnh số giờ tính lương nếu muốn */}
          {bmbReviewAction === 'APPROVE' && (
            <View style={{ marginBottom: 10 }}>
              <Text style={styles.fieldLabel}>
                {translate('Số giờ được tính lương (chuẩn 50.000 VNĐ/giờ):')}
              </Text>
              <TextInput
                style={styles.technicianFormInput}
                value={bmbAdjustedHours}
                onChangeText={setBmbAdjustedHours}
                keyboardType="numeric"
                placeholder="VD: 8.0"
                placeholderTextColor="#94A3B8"
              />
              <Text style={[styles.cardLocationText, { fontSize: 11, marginTop: 2 }]}>
                * {translate('Số giờ thực tế ghi nhận:')} {selectedAttendanceForReview?.workHours || 0}h. BMB có thể điều chỉnh theo quyết định công tác.
              </Text>
            </View>
          )}

          {/* Nhập lý do bắt buộc để lưu audit log */}
          <View style={{ marginBottom: 12 }}>
            <Text style={styles.fieldLabel}>
              {translate('Lý do / Căn cứ phê duyệt của BMB (bắt buộc lưu vết Audit Log) *')}
            </Text>
            <TextInput
              style={[styles.technicianFormInput, { height: 80, textAlignVertical: 'top' }]}
              value={bmbReviewNote}
              onChangeText={setBmbReviewNote}
              multiline
              placeholder={
                bmbReviewAction === 'APPROVE' ? 'VD: Đã đối chiếu camera và xác nhận KTV có mặt làm việc.' :
                  bmbReviewAction === 'REQUEST_EXPLANATION' ? 'VD: Yêu cầu giải trình lý do GPS nằm ngoài khuôn viên tòa nhà.' :
                    'VD: Chấm công không hợp lệ, không liên lạc được với KTV.'
              }
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={styles.technicianModalActions}>
            <TouchableOpacity
              style={styles.technicianCancelButton}
              onPress={() => setShowAttendanceReviewModal(false)}
            >
              <Text style={styles.technicianCancelButtonText}>{translate('Hủy')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryActionBtn, { flex: 1, paddingVertical: 10, backgroundColor: bmbReviewAction === 'REJECT' ? '#DC2626' : '#2563EB' }]}
              onPress={handleBmbReviewAttendance}
              disabled={loading}
            >
              <Text style={styles.primaryActionBtnText}>
                {translate('Xác nhận & Lưu vết Audit')}
              </Text>
            </TouchableOpacity>
          </View>
        </AnimatedModalContent>
      </View></Modal>
  );

  const renderBuildingLocationModal = () => (
    <Modal
      visible={bmbBuildingModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setBmbBuildingModalVisible(false)}
    >
      <View style={styles.technicianModalOverlay}>
        <AnimatedModalContent visible={bmbBuildingModalVisible} style={[styles.technicianModalCard, { width: 520 }]}>
          <Text style={styles.technicianModalTitle}>🏢 {translate('Cấu hình & Xác nhận Tọa độ Tòa nhà')}</Text>
          <Text style={styles.technicianModalDescription}>
            {translate('Tọa độ GPS này là căn cứ duy nhất để máy chủ ResiFix tính khoảng cách khi KTV Check-in/Check-out. Bắt buộc BMB xác nhận để gỡ cờ tạm hoãn chấm công.')}
          </Text>

          <View style={{ marginVertical: 6 }}>
            <Text style={styles.fieldLabel}>{translate('Tên tòa nhà *')}</Text>
            <TextInput
              style={styles.technicianFormInput}
              value={bmbBuildingForm.buildingName}
              onChangeText={(val) => setBmbBuildingForm((f) => ({ ...f, buildingName: val }))}
              placeholder="VD: Đại học Duy Tân"
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={{ marginVertical: 6 }}>
            <Text style={styles.fieldLabel}>{translate('Địa chỉ tòa nhà *')}</Text>
            <TextInput
              style={styles.technicianFormInput}
              value={bmbBuildingForm.buildingAddress}
              onChangeText={(val) => setBmbBuildingForm((f) => ({ ...f, buildingAddress: val }))}
              placeholder="VD: 120 Hoàng Minh Thảo, Hòa Khánh Nam, Đà Nẵng"
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginVertical: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>{translate('Vĩ độ (Latitude) *')}</Text>
              <TextInput
                style={styles.technicianFormInput}
                value={bmbBuildingForm.latitude}
                onChangeText={(val) => setBmbBuildingForm((f) => ({ ...f, latitude: val }))}
                placeholder={String(DEFAULT_BUILDING_LOCATION.latitude)}
                keyboardType="numeric"
                placeholderTextColor="#94A3B8"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>{translate('Kinh độ (Longitude) *')}</Text>
              <TextInput
                style={styles.technicianFormInput}
                value={bmbBuildingForm.longitude}
                onChangeText={(val) => setBmbBuildingForm((f) => ({ ...f, longitude: val }))}
                placeholder={String(DEFAULT_BUILDING_LOCATION.longitude)}
                keyboardType="numeric"
                placeholderTextColor="#94A3B8"
              />
            </View>
          </View>

          <View style={{ marginVertical: 6 }}>
            <Text style={styles.fieldLabel}>{translate('Bán kính cho phép (mét, từ 50m - 5000m) *')}</Text>
            <TextInput
              style={styles.technicianFormInput}
              value={bmbBuildingForm.allowedRadiusMeters}
              onChangeText={(val) => setBmbBuildingForm((f) => ({ ...f, allowedRadiusMeters: val }))}
              placeholder="300"
              keyboardType="numeric"
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={{ marginVertical: 6 }}>
            <Text style={styles.fieldLabel}>{translate('Ghi chú xác nhận / Căn cứ thực địa (Audit Log)')}</Text>
            <TextInput
              style={styles.technicianFormInput}
              value={bmbBuildingForm.note}
              onChangeText={(val) => setBmbBuildingForm((f) => ({ ...f, note: val }))}
              placeholder="VD: Đã đo đạc GPS thực tế tại cổng chính sảnh cư dân..."
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={styles.technicianModalActions}>
            <TouchableOpacity
              style={styles.technicianCancelButton}
              onPress={() => setBmbBuildingModalVisible(false)}
            >
              <Text style={styles.technicianCancelButtonText}>{translate('Hủy')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryActionBtn, { flex: 1, paddingVertical: 10, backgroundColor: '#16A34A' }]}
              onPress={handleSaveBuildingLocation}
              disabled={loading}
            >
              <Text style={styles.primaryActionBtnText}>
                {loading ? translate('Đang lưu...') : translate('Xác nhận tọa độ chuẩn')}
              </Text>
            </TouchableOpacity>
          </View>
        </AnimatedModalContent>
      </View></Modal>
  );

  const renderPhotoViewerModal = () => (
    <Modal
      visible={viewingPhotoModal !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setViewingPhotoModal(null)}
    >
      <View style={styles.technicianModalOverlay}>
        <AnimatedModalContent visible={viewingPhotoModal !== null} style={[styles.technicianModalCard, { width: 500, alignItems: 'center' }]}>
          <Text style={styles.technicianModalTitle}>{viewingPhotoModal?.title || translate('Ảnh minh chứng chấm công')}</Text>
          {viewingPhotoModal?.url ? (
            <View style={{ width: '100%', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#CBD5E1', marginVertical: 10 }}>
              <Image
                source={{ uri: viewingPhotoModal.url }}
                style={{ width: '100%', height: 320, resizeMode: 'cover' }}
              />
              {/* Watermark overlay */}
              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(15, 23, 42, 0.75)', padding: 8 }}>
                <Text style={{ color: '#FFFFFF', fontSize: 11.5, fontWeight: '700' }}>
                  ResiFix Attendance • {viewingPhotoModal.meta?.techName || 'KTV'}
                </Text>
                <Text style={{ color: '#E2E8F0', fontSize: 10.5 }}>
                  ⏰ Thời gian Server: {formatDateTime(viewingPhotoModal.meta?.time)}
                </Text>
                {viewingPhotoModal.meta?.gps ? (
                  <Text style={{ color: '#E2E8F0', fontSize: 10.5 }}>
                    📍 GPS: {viewingPhotoModal.meta.gps.latitude.toFixed(6)}, {viewingPhotoModal.meta.gps.longitude.toFixed(6)} (~{viewingPhotoModal.meta.gps.distanceMeters}m đến tòa nhà)
                  </Text>
                ) : null}
              </View>
            </View>
          ) : (
            <Text style={{ marginVertical: 20, color: '#64748B' }}>{translate('Không tìm thấy hình ảnh.')}</Text>
          )}

          <TouchableOpacity
            style={[styles.primaryActionBtn, { width: '100%', paddingVertical: 10, marginTop: 4 }]}
            onPress={() => setViewingPhotoModal(null)}
          >
            <Text style={styles.primaryActionBtnText}>{translate('Đóng')}</Text>
          </TouchableOpacity>
        </AnimatedModalContent>
      </View></Modal>
  );

  const renderBmbIncidentPhotoModal = () => (
    <Modal
      visible={bmbPhotoViewerVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setBmbPhotoViewerVisible(false)}
    >
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
      }}>
        <View style={{
          width: '100%',
          maxWidth: 720,
          maxHeight: '92%',
          backgroundColor: '#0F172A',
          borderRadius: 14,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: '#334155',
          flexDirection: 'column',
        }}>
          {/* Header thanh điều khiển */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: '#1E293B',
            backgroundColor: '#0B1120',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: '#F8FAFC', fontWeight: '700', fontSize: 14 }}>
                📷 {translate("Ảnh hiện trường")}
              </Text>
              {bmbPhotoViewerList.length > 0 && (
                <View style={{
                  backgroundColor: '#1E293B',
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 6,
                }}>
                  <Text style={{ color: '#94A3B8', fontSize: 12, fontWeight: '600' }}>
                    {bmbPhotoViewerIndex + 1} / {bmbPhotoViewerList.length}
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: '#1E293B',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onPress={() => setBmbPhotoViewerVisible(false)}
            >
              <Text style={{ color: '#F8FAFC', fontSize: 16, fontWeight: '700', lineHeight: 18 }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Vùng hiển thị ảnh chính */}
          <View style={{
            minHeight: 320,
            maxHeight: 520,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#020617',
            position: 'relative',
            padding: 8,
          }}>
            {bmbPhotoModalLoading && (
              <View style={{
                position: 'absolute',
                zIndex: 2,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <ActivityIndicator size="large" color="#38BDF8" />
                <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 8 }}>
                  {translate("Đang tải hình ảnh...")}
                </Text>
              </View>
            )}

            {bmbPhotoModalError ? (
              <View style={{ alignItems: 'center', padding: 20 }}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>⚠️</Text>
                <Text style={{ color: '#F87171', fontWeight: '700', fontSize: 14, textAlign: 'center' }}>
                  {translate("Không thể tải hình ảnh từ Cloudinary.")}
                </Text>
                <Text style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
                  {translate("Vui lòng kiểm tra lại kết nối mạng hoặc thử lại sau.")}
                </Text>
              </View>
            ) : (
              bmbPhotoViewerList[bmbPhotoViewerIndex]?.url ? (
                <Image
                  source={{ uri: bmbPhotoViewerList[bmbPhotoViewerIndex].url }}
                  style={{
                    width: '100%',
                    height: 480,
                    maxHeight: '100%',
                  }}
                  resizeMode="contain"
                  onLoadStart={() => {
                    setBmbPhotoModalLoading(true);
                    setBmbPhotoModalError(false);
                  }}
                  onLoadEnd={() => setBmbPhotoModalLoading(false)}
                  onError={() => {
                    setBmbPhotoModalLoading(false);
                    setBmbPhotoModalError(true);
                  }}
                />
              ) : null
            )}

            {/* Nút lùi ảnh (Previous) */}
            {bmbPhotoViewerList.length > 1 && (
              <TouchableOpacity
                style={{
                  position: 'absolute',
                  left: 12,
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: bmbPhotoViewerIndex > 0 ? 'rgba(30, 41, 59, 0.85)' : 'rgba(30, 41, 59, 0.3)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 3,
                }}
                disabled={bmbPhotoViewerIndex <= 0}
                onPress={() => {
                  if (bmbPhotoViewerIndex > 0) {
                    setBmbPhotoViewerIndex((i) => i - 1);
                    setBmbPhotoModalLoading(true);
                    setBmbPhotoModalError(false);
                  }
                }}
              >
                <Text style={{
                  color: bmbPhotoViewerIndex > 0 ? '#FFFFFF' : '#475569',
                  fontSize: 22,
                  fontWeight: '700',
                  lineHeight: 24,
                }}>‹</Text>
              </TouchableOpacity>
            )}

            {/* Nút tiến ảnh (Next) */}
            {bmbPhotoViewerList.length > 1 && (
              <TouchableOpacity
                style={{
                  position: 'absolute',
                  right: 12,
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: bmbPhotoViewerIndex < bmbPhotoViewerList.length - 1 ? 'rgba(30, 41, 59, 0.85)' : 'rgba(30, 41, 59, 0.3)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 3,
                }}
                disabled={bmbPhotoViewerIndex >= bmbPhotoViewerList.length - 1}
                onPress={() => {
                  if (bmbPhotoViewerIndex < bmbPhotoViewerList.length - 1) {
                    setBmbPhotoViewerIndex((i) => i + 1);
                    setBmbPhotoModalLoading(true);
                    setBmbPhotoModalError(false);
                  }
                }}
              >
                <Text style={{
                  color: bmbPhotoViewerIndex < bmbPhotoViewerList.length - 1 ? '#FFFFFF' : '#475569',
                  fontSize: 22,
                  fontWeight: '700',
                  lineHeight: 24,
                }}>›</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Footer chú thích & chuyển ảnh */}
          <View style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: '#0B1120',
            borderTopWidth: 1,
            borderTopColor: '#1E293B',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}>
            <Text style={{ color: '#CBD5E1', fontSize: 13, flex: 1 }}>
              {bmbPhotoViewerList[bmbPhotoViewerIndex]?.caption || translate("Ảnh hiện trường")}
            </Text>

            {bmbPhotoViewerList.length > 1 && (
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                {bmbPhotoViewerList.map((_, dotIdx) => (
                  <TouchableOpacity
                    key={dotIdx}
                    style={{
                      width: dotIdx === bmbPhotoViewerIndex ? 18 : 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: dotIdx === bmbPhotoViewerIndex ? '#38BDF8' : '#334155',
                    }}
                    onPress={() => {
                      setBmbPhotoViewerIndex(dotIdx);
                      setBmbPhotoModalLoading(true);
                      setBmbPhotoModalError(false);
                    }}
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderTechCheckInModal = () => (
    <Modal
      visible={techCheckInModal.visible}
      transparent
      animationType="fade"
      onRequestClose={() => setTechCheckInModal((m) => ({ ...m, visible: false }))}
    >
      <View style={styles.technicianModalOverlay}>
        <AnimatedModalContent visible={techCheckInModal.visible} style={[styles.technicianModalCard, { width: 480 }]}>
          <Text style={styles.technicianModalTitle}>
            {techCheckInModal.mode === 'CHECK_IN' ? '🟢 ' + translate('Check-in (Vào ca trực)') : '🔴 ' + translate('Check-out (Tan ca)')}
          </Text>
          <Text style={styles.technicianModalDescription}>
            {translate('Hệ thống tự động ghi nhận thời gian chính xác từ Server và vị trí GPS thiết bị để đối soát minh bạch.')}
          </Text>

          {/* Live Server Time Clock */}
          <View style={{ backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, alignItems: 'center', marginVertical: 10, borderWidth: 1, borderColor: '#E2E8F0' }}>
            <Text style={{ fontSize: 11.5, color: '#64748B' }}>{translate('Thời gian máy chủ ghi nhận:')}</Text>
            <RealTimeClock style={{ fontSize: 24, fontWeight: '800', color: '#0F172A', marginTop: 2 }} />
            <Text style={{ fontSize: 11, color: '#059669', marginTop: 2 }}>✓ {translate('Bảo đảm tính chính xác & chống chỉnh sửa giờ máy client')}</Text>
          </View>

          {/* Chụp ảnh selfie / camera */}
          <View style={{ marginVertical: 8 }}>
            <Text style={styles.fieldLabel}>{translate('Ảnh chụp khuôn mặt / Hiện trường ca trực *')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
              <TouchableOpacity
                style={[styles.primaryActionBtn, { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#4F46E5' }]}
                onPress={handlePickCheckInPhoto}
              >
                <Text style={styles.primaryActionBtnText}>📷 {translate('Chụp ảnh selfie')}</Text>
              </TouchableOpacity>
              {techPhotoUri ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Image source={{ uri: techPhotoUri }} style={{ width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1' }} />
                  <Text style={{ fontSize: 11.5, color: '#16A34A', fontWeight: '700' }}>✓ Đã chọn ảnh</Text>
                </View>
              ) : (
                <Text style={{ fontSize: 11.5, color: '#94A3B8' }}>{translate('Chưa có ảnh (khuyến khích)')}</Text>
              )}
            </View>
          </View>

          {/* Ghi chú thêm nếu có */}
          <View style={{ marginVertical: 8 }}>
            <Text style={styles.fieldLabel}>{translate('Ghi chú ca trực (tùy chọn):')}</Text>
            <TextInput
              style={styles.technicianFormInput}
              value={techCheckInNotes}
              onChangeText={setTechCheckInNotes}
              placeholder="VD: Trực ca sáng tòa S1, hỗ trợ sự cố khẩn cấp..."
              placeholderTextColor="#94A3B8"
            />
          </View>

          {/* Thông tin an toàn & minh bạch */}
          <View style={{ backgroundColor: '#F1F5F9', borderRadius: 8, padding: 8, marginVertical: 6, borderWidth: 1, borderColor: '#E2E8F0' }}>
            <Text style={{ fontSize: 11, color: '#475569', lineHeight: 16 }}>
              🔒 <Text style={{ fontWeight: '700' }}>{translate('Bảo vệ tính khách quan:')}</Text> {translate('Yêu cầu chụp trực tiếp qua Camera (chống tải ảnh có sẵn), bảo vệ phiên bằng mã ngẫu nhiên Nonce một lần và xác thực bán kính GPS với tọa độ tòa nhà được BMB duyệt.')}
            </Text>
          </View>

          <View style={styles.technicianModalActions}>
            <TouchableOpacity
              style={styles.technicianCancelButton}
              onPress={() => setTechCheckInModal((m) => ({ ...m, visible: false }))}
            >
              <Text style={styles.technicianCancelButtonText}>{translate('Hủy')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.primaryActionBtn,
                { flex: 1, paddingVertical: 10, backgroundColor: techCheckInModal.mode === 'CHECK_IN' ? '#16A34A' : '#DC2626' }
              ]}
              onPress={() => executeTechAttendance(techCheckInModal.mode)}
              disabled={loading}
            >
              <Text style={styles.primaryActionBtnText}>
                {loading ? translate('Đang xử lý...') : techCheckInModal.mode === 'CHECK_IN' ? translate('Xác nhận Check-in') : translate('Xác nhận Check-out')}
              </Text>
            </TouchableOpacity>
          </View>
        </AnimatedModalContent>
      </View></Modal>
  );

  const renderTechExplanationModal = () => (
    <Modal
      visible={techExplanationModal.visible}
      transparent
      animationType="fade"
      onRequestClose={() => setTechExplanationModal({ visible: false, log: null })}
    >
      <View style={styles.technicianModalOverlay}>
        <AnimatedModalContent visible={techExplanationModal.visible} style={[styles.technicianModalCard, { width: 480 }]}>
          <Text style={styles.technicianModalTitle}>💬 {translate('Gửi giải trình Chấm công')}</Text>
          <Text style={styles.technicianModalDescription}>
            {translate('Ca trực:')} {techExplanationModal.log?.date} • {techExplanationModal.log?.shiftScheduled || '07:00 - 15:00'}
          </Text>

          {techExplanationModal.log?.anomalyNotes && (
            <View style={{ backgroundColor: '#FFFBEB', padding: 8, borderRadius: 8, marginVertical: 8, borderWidth: 1, borderColor: '#FDE68A' }}>
              <Text style={{ fontSize: 12, color: '#B45309', fontWeight: '700' }}>
                ⚠️ Lý do cần giải trình: {techExplanationModal.log.anomalyNotes}
              </Text>
            </View>
          )}

          <Text style={styles.fieldLabel}>{translate('Nội dung giải trình chi tiết *')}</Text>
          <TextInput
            style={[styles.technicianFormInput, { height: 90, textAlignVertical: 'top' }]}
            value={techExplanationInput}
            onChangeText={setTechExplanationInput}
            multiline
            placeholder="Nêu rõ lý do đi muộn, vị trí ngoài tòa nhà hoặc công tác đột xuất..."
            placeholderTextColor="#94A3B8"
          />

          <View style={styles.technicianModalActions}>
            <TouchableOpacity
              style={styles.technicianCancelButton}
              onPress={() => setTechExplanationModal({ visible: false, log: null })}
            >
              <Text style={styles.technicianCancelButtonText}>{translate('Hủy')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryActionBtn, { flex: 1, paddingVertical: 10, backgroundColor: '#6366F1' }]}
              onPress={handleTechSubmitExplanation}
              disabled={loading}
            >
              <Text style={styles.primaryActionBtnText}>{translate('Gửi giải trình cho BMB')}</Text>
            </TouchableOpacity>
          </View>
        </AnimatedModalContent>
      </View></Modal>
  );

  const refreshTechLocation = async (): Promise<{ latitude: number; longitude: number; accuracy: number } | null> => {
    setTechGpsRefreshing(true);
    try {
      const loc = await getDeviceLocation();
      if (loc) {
        setTechLiveLocation(loc);
        setTechLocationError(null);
      } else {
        setTechLocationError(translate('Chưa thể lấy vị trí GPS hoặc quyền định vị bị từ chối.'));
      }
      return loc;
    } catch (err: any) {
      setTechLocationError(err?.message || translate('Lỗi khi truy xuất GPS.'));
      return null;
    } finally {
      setTechGpsRefreshing(false);
    }
  };

  const renderTechGpsWidget = () => {
    const buildingLat = Number(bmbBuildingLocation?.latitude ?? DEFAULT_BUILDING_LOCATION.latitude);
    const buildingLng = Number(bmbBuildingLocation?.longitude ?? DEFAULT_BUILDING_LOCATION.longitude);
    const allowedRadius = Number(bmbBuildingLocation?.allowedRadiusMeters ?? DEFAULT_BUILDING_LOCATION.allowedRadiusMeters);

    const latestAtt = myAttendanceLogs && myAttendanceLogs.length > 0 ? myAttendanceLogs[0] : null;
    const latestGps = latestAtt?.checkInGps || null;

    if (techLiveLocation) {
      const dist = calculateDistanceMeters(
        techLiveLocation.latitude,
        techLiveLocation.longitude,
        buildingLat,
        buildingLng
      );
      const isWithin = dist <= allowedRadius;
      const accuracy = techLiveLocation.accuracy;

      return (
        <View style={{ backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, marginVertical: 8, borderWidth: 1, borderColor: '#E2E8F0' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#0F172A' }}>
                📍 {translate("Vị trí GPS của bạn:")}
              </Text>
              <View style={[
                styles.statusPill,
                isWithin ? { backgroundColor: '#DCFCE7' } : { backgroundColor: '#FEE2E2' }
              ]}>
                <Text style={[
                  styles.statusPillText,
                  isWithin ? { color: '#15803D' } : { color: '#B91C1C' }
                ]}>
                  {isWithin ? '✓ Trong bán kính 300m' : '⚠️ Ngoài bán kính (>300m)'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => void refreshTechLocation()}
              disabled={techGpsRefreshing}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Text style={{ fontSize: 11.5, color: '#2563EB', fontWeight: '600' }}>
                {techGpsRefreshing ? translate('Đang cập nhật...') : '🔄 ' + translate('Cập nhật GPS')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Tọa độ chi tiết Latitude & Longitude */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6, alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: '#334155' }}>
              <Text style={{ fontWeight: '600', color: '#64748B' }}>Lat:</Text> {techLiveLocation.latitude.toFixed(6)}
            </Text>
            <Text style={{ fontSize: 12, color: '#334155' }}>
              <Text style={{ fontWeight: '600', color: '#64748B' }}>Long:</Text> {techLiveLocation.longitude.toFixed(6)}
            </Text>
            <Text style={{ fontSize: 11.5, color: '#64748B' }}>
              (±{accuracy}m)
            </Text>
          </View>

          {/* Khoảng cách & Bán kính */}
          <View style={{ marginTop: 4, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 12, color: '#334155' }}>
              {translate("Khoảng cách đến tòa nhà:")} <Text style={{ fontWeight: '800', color: isWithin ? '#16A34A' : '#DC2626' }}>~{dist}m</Text> • {translate("Giới hạn cho phép:")} ≤ {allowedRadius}m
            </Text>
          </View>

          {/* Cảnh báo nếu độ chính xác kém */}
          {accuracy > 100 && (
            <View style={{ backgroundColor: '#FEF3C7', borderRadius: 6, padding: 6, marginTop: 6, borderWidth: 1, borderColor: '#FDE68A' }}>
              <Text style={{ fontSize: 11, color: '#B45309', fontWeight: '600' }}>
                ⚠️ {translate("Độ chính xác GPS thấp (±")}{accuracy}m {translate("> 100m). Vui lòng ra nơi thoáng đãng để định vị chuẩn xác hơn.")}
              </Text>
            </View>
          )}

          {latestGps && (
            <Text style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
              🕒 {translate("Check-in gần nhất:")} {latestGps.latitude?.toFixed(4)}, {latestGps.longitude?.toFixed(4)} (~{latestGps.distanceMeters ?? latestGps.distanceToBuildingMeters ?? 0}m)
            </Text>
          )}
        </View>
      );
    }

    return (
      <View style={{ backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12, marginVertical: 8, borderWidth: 1, borderColor: '#FDE68A' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <Text style={{ fontSize: 12, color: '#B45309', fontWeight: '600', flex: 1 }}>
            ⚠️ {techLocationError || translate('Chưa xác định tọa độ GPS hoặc chưa được cấp quyền vị trí.')}
          </Text>
          <TouchableOpacity
            onPress={() => void refreshTechLocation()}
            disabled={techGpsRefreshing}
            style={[styles.primaryActionBtn, { paddingVertical: 5, paddingHorizontal: 10, backgroundColor: '#EA580C' }]}
          >
            <Text style={[styles.primaryActionBtnText, { fontSize: 11.5 }]}>
              {techGpsRefreshing ? translate('Đang lấy...') : '📍 ' + translate('Lấy GPS')}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 11, color: '#78350F', marginTop: 4 }}>
          * {translate("Hệ thống yêu cầu vị trí GPS để đối soát bán kính điểm danh với tòa nhà (≤ 300m).")}
        </Text>
      </View>
    );
  };

  const handleTechSubmitOvertime = async () => {
    if (!otHoursInput || isNaN(Number(otHoursInput)) || Number(otHoursInput) <= 0) {
      showToast(translate('Số giờ tăng ca không hợp lệ.'));
      return;
    }
    if (otReasonInput.trim().length < 5) {
      showToast(translate('Vui lòng nêu rõ lý do tăng ca (tối thiểu 5 ký tự).'));
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/payroll/overtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          fromTime: otFromTimeInput.trim(),
          toTime: otToTimeInput.trim(),
          hours: Number(otHoursInput),
          reason: otReasonInput.trim(),
          ticketId: otTicketIdInput.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate('Đã gửi yêu cầu tăng ca tới BMB phê duyệt!'));
        setOtReasonInput('');
        setOtTicketIdInput('');
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi gửi yêu cầu tăng ca.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  const handleTechSubmitReconcile = async () => {
    if (reconcileNoteInput.trim().length < 5) {
      showToast(translate('Vui lòng nhập nội dung đối soát (tối thiểu 5 ký tự).'));
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/payroll/my-reconcile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          note: reconcileNoteInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate('Đã gửi yêu cầu đối soát thành công! BMB sẽ phản hồi sớm.'));
        setReconcileNoteInput('');
      } else {
        showToast(data?.message || translate('Lỗi khi gửi đối soát.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  const handleBmbReviewOvertime = async (otId: string, status: 'APPROVED' | 'REJECTED', approvedHours?: number) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/payroll/admin/overtime/${otId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          status,
          approvedHours,
          reviewNote: status === 'APPROVED' ? 'Đã duyệt tăng ca' : 'Từ chối tăng ca',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate(status === 'APPROVED' ? 'Đã duyệt yêu cầu tăng ca.' : 'Đã từ chối yêu cầu tăng ca.'));
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi duyệt tăng ca.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  const handleBmbLockMonth = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/payroll/admin/lock-month`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate('Đã khóa bảng lương tháng thành công!'));
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi khóa bảng lương.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  const handleSelectBmbTicket = (t: any) => {
    setBmbPhotoViewerVisible(false);
    setBmbPhotoViewerList([]);
    setBmbPhotoViewerIndex(0);
    setBmbSelectedTicket(t);
    setBmbCategory(t.finalCategory || t.aiSuggestedCategory || 'OTHER');
    setBmbPriority(t.finalPriority || t.aiSuggestedPriority || 'MEDIUM');
    setBmbNote(t.bmbAdminNote || '');
    if (t.assignedTechId) setBmbTechId(t.assignedTechId);
    if (token && t?.id) {
      const headers = { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' };
      void fetch(`${API_BASE_URL}/sla/status/${t.id}`, { headers })
        .then((r) => r.json())
        .then((d) => {
          if (d?.sla) setTicketSlas((prev) => ({ ...prev, [t.id]: d.sla }));
        })
        .catch(() => undefined);
    }
  };

  const loadSuggestedTechnicians = useCallback(
    async (ticketId?: string, category?: string) => {
      if (!ticketId) {
        setSuggestedTechnicians([]);
        setSuggestionsMessage('');
        return;
      }
      if (!category) {
        setSuggestedTechnicians([]);
        setSuggestionsMessage(translate('Chọn danh mục để xem gợi ý kỹ thuật viên'));
        return;
      }
      if (!token) return;

      const reqId = ++suggestionRequestIdRef.current;
      setLoadingSuggestions(true);
      try {
        const headers = {
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        };
        const res = await fetch(
          `${API_BASE_URL}/tickets/${ticketId}/suggested-technicians?category=${encodeURIComponent(category)}`,
          { headers }
        );
        const data = await res.json();
        if (reqId === suggestionRequestIdRef.current) {
          if (data.success && Array.isArray(data.suggestedTechnicians)) {
            setSuggestedTechnicians(data.suggestedTechnicians);
            setSuggestionsMessage(
              data.message ||
              (data.suggestedTechnicians.length === 0
                ? translate('Không có kỹ thuật viên phù hợp với chuyên môn này đang trong ca trực.')
                : '')
            );
          } else {
            setSuggestedTechnicians([]);
            setSuggestionsMessage(data.message || '');
          }
        }
      } catch (_err) {
        if (reqId === suggestionRequestIdRef.current) {
          setSuggestedTechnicians([]);
          setSuggestionsMessage('');
        }
      } finally {
        if (reqId === suggestionRequestIdRef.current) {
          setLoadingSuggestions(false);
        }
      }
    },
    [token]
  );

  useEffect(() => {
    if (user?.role === 'BMB' && bmbSelectedTicket?.id) {
      loadSuggestedTechnicians(bmbSelectedTicket.id, bmbCategory);
    } else {
      setSuggestedTechnicians([]);
      setSuggestionsMessage('');
    }
  }, [bmbSelectedTicket?.id, bmbCategory, loadSuggestedTechnicians, user?.role]);

  // Nạp hướng dẫn Trợ lý AI khi KTV mở chi tiết sự cố
  useEffect(() => {
    if (user?.role === 'TECHNICIAN' && techScreen === 'TASK_DETAIL' && activeTicket?.id) {
      setCheckedChecklistItems({});
      if (activeTicket.status === 'IN_PROGRESS' || activeTicket.status === 'COMPLETED' || activeTicket.status === 'CLOSED') {
        setTechnicianGuidanceLoading(true);
        void fetchTechnicianGuidance(activeTicket.id).finally(() => {
          setTechnicianGuidanceLoading(false);
        });
      } else {
        setTechnicianGuidance(null);
        setTechnicianGuidanceLoading(false);
      }
    } else {
      setTechnicianGuidance(null);
      setTechnicianGuidanceLoading(false);
    }
  }, [user?.role, techScreen, activeTicket?.id, activeTicket?.status, fetchTechnicianGuidance]);

  // Polling tự động làm mới khi guidance đang ở trạng thái GENERATING
  useEffect(() => {
    if (
      user?.role === 'TECHNICIAN' &&
      techScreen === 'TASK_DETAIL' &&
      activeTicket?.id &&
      technicianGuidance?.status === 'GENERATING'
    ) {
      const currentTicketId = activeTicket.id;
      const interval = setInterval(async () => {
        if (activeTicket?.id !== currentTicketId) {
          clearInterval(interval);
          return;
        }
        const res = await fetchTechnicianGuidance(currentTicketId);
        if (res && res.status !== 'GENERATING') {
          clearInterval(interval);
        }
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [user?.role, techScreen, activeTicket?.id, technicianGuidance?.status, fetchTechnicianGuidance]);

  const openResidentTicket = (ticket: any) => {
    setBmbPhotoViewerVisible(false);
    setBmbPhotoViewerList([]);
    setBmbPhotoViewerIndex(0);
    setActiveTicket(ticket);
    setResScreen('TICKET_DETAIL');
    if (token) {
      const headers = { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' };
      void fetch(`${API_BASE_URL}/costs/ticket/${ticket.id}`, { headers })
        .then((r) => r.json())
        .then((d) => {
          if (d?.cost) setTicketCosts((prev) => ({ ...prev, [ticket.id]: d.cost }));
        })
        .catch(() => undefined);
      void fetch(`${API_BASE_URL}/sla/status/${ticket.id}`, { headers })
        .then((r) => r.json())
        .then((d) => {
          if (d?.sla) setTicketSlas((prev) => ({ ...prev, [ticket.id]: d.sla }));
        })
        .catch(() => undefined);
    }
  };

  const openTechnicianTask = (ticket: any) => {
    setBmbPhotoViewerVisible(false);
    setBmbPhotoViewerList([]);
    setBmbPhotoViewerIndex(0);
    setActiveTicket(ticket);
    setTechRepairNote(ticket.techRepairNote || '');
    setTechProofPhotos([]);
    setTechScreen('TASK_DETAIL');

    if (token) {
      const headers = { Authorization: `Bearer ${token}`, 'bypass-tunnel-reminder': 'true' };
      void fetch(`${API_BASE_URL}/costs/ticket/${ticket.id}`, { headers })
        .then((r) => r.json())
        .then((d) => {
          if (d?.cost) setTicketCosts((prev) => ({ ...prev, [ticket.id]: d.cost }));
        })
        .catch(() => undefined);

      void fetch(`${API_BASE_URL}/sla/status/${ticket.id}`, { headers })
        .then((r) => r.json())
        .then((d) => {
          if (d?.sla) setTicketSlas((prev) => ({ ...prev, [ticket.id]: d.sla }));
        })
        .catch(() => undefined);
    }
  };

  // Dòng thời gian tiến độ xử lý sự cố & SLA
  const renderIncidentProgressTimeline = (
    ticket: any,
    role: 'RESIDENT' | 'BMB' | 'TECHNICIAN' | 'GUEST' = 'RESIDENT'
  ) => {
    if (!ticket) return null;

    const ticketWithSla = {
      ...ticket,
      slaTracking: ticket.slaTracking || ticketSlas[ticket.id] || null,
    };

    const summary = buildIncidentTimeline(ticketWithSla, {
      role,
      now: liveClockTime,
    });

    const sla = summary.slaInfo;

    // Màu sắc badge SLA
    let slaBg = '#F1F5F9';
    let slaFg = '#475569';
    if (sla.hasSla) {
      if (sla.slaStatus === 'PAUSED') {
        slaBg = '#F1F5F9';
        slaFg = '#64748B';
      } else if (sla.slaStatus === 'BREACHED') {
        slaBg = '#FEE2E2';
        slaFg = '#DC2626';
      } else if (sla.slaStatus === 'AT_RISK') {
        slaBg = '#FEF3C7';
        slaFg = '#D97706';
      } else if (sla.slaStatus === 'ON_TRACK') {
        slaBg = '#DCFCE7';
        slaFg = '#16A34A';
      }
    }

    return (
      <View style={styles.whiteSectionCard}>
        <View style={[styles.cardTopRow, { marginBottom: 10 }]}>
          <Text style={styles.cardBlockTitle}>{translate('Tiến độ xử lý sự cố')}</Text>
          <View style={[styles.statusPill, { backgroundColor: slaBg }]}>
            <Text style={[styles.statusPillText, { color: slaFg, fontWeight: '700' }]}>
              {translate(sla.slaStatusLabel)}
            </Text>
          </View>
        </View>

        {/* Khối tóm tắt tiến độ & SLA */}
        <View style={styles.timelineHeaderBox}>
          <Text style={styles.timelineMetaLine}>
            ⏱️ <Text style={{ fontWeight: '700' }}>{translate(summary.totalDurationLabel)}</Text>
          </Text>
          <Text style={styles.timelineMetaLine}>
            🎯 <Text style={{ fontWeight: '700' }}>{translate('Hạn hoàn thành:')}</Text>{' '}
            {sla.hasSla ? (
              <Text>
                {sla.formattedDeadline}{' '}
                <Text
                  style={{
                    color:
                      sla.slaStatus === 'BREACHED'
                        ? '#DC2626'
                        : sla.slaStatus === 'AT_RISK'
                          ? '#D97706'
                          : '#16A34A',
                    fontWeight: '700',
                  }}
                >
                  ({translate(sla.slaRemainingText)})
                </Text>
              </Text>
            ) : (
              <Text style={{ color: '#64748B', fontStyle: 'italic' }}>
                {translate('Chưa có thời hạn quy định')}
              </Text>
            )}
          </Text>
          {sla.isPaused && sla.pauseReason && (
            <Text style={[styles.timelineMetaLine, { color: '#64748B', fontStyle: 'italic' }]}>
              ⏸️ {translate('Lý do tạm dừng:')} {sla.pauseReason}
            </Text>
          )}
          {sla.escalationTier > 0 && role !== 'RESIDENT' && (
            <Text style={[styles.timelineMetaLine, { color: '#DC2626', fontWeight: '700' }]}>
              🚨 {translate('Cấp độ leo thang')} {sla.escalationTier}: {translate('Đã kích hoạt cảnh báo SLA')}
            </Text>
          )}
        </View>

        {/* Dòng thời gian dọc chi tiết - Chỉ hiển thị các sự kiện thực tế đã xảy ra */}
        <View style={styles.timelineContainer}>
          {(() => {
            const occurredMilestones = summary.milestones.filter((m) => m.status !== 'PENDING');
            const displayList = occurredMilestones.length > 0 ? occurredMilestones : summary.milestones.slice(0, 1);
            return displayList.map((milestone, idx) => {
              const isLast = idx === displayList.length - 1;
              const isCompleted = milestone.status === 'COMPLETED';
              const isActive = milestone.status === 'ACTIVE';
              const isCancelled = milestone.status === 'CANCELLED';

              const dotColor = isCancelled
                ? '#DC2626'
                : isCompleted
                  ? '#16A34A'
                  : isActive
                    ? '#2563EB'
                    : '#CBD5E1';

              return (
                <TimelineNodeEntrance key={`${milestone.key}-${idx}`} index={idx}>
                  <View style={[styles.timelineStepRow, { alignItems: 'stretch' }]}>
                    {/* Cột trái: Dot và đường nối dọc co giãn đúng theo nội dung thực tế */}
                    <View style={styles.timelineLeftCol}>
                      <ActiveMilestonePulse active={isActive}>
                        <View
                          style={{
                            backgroundColor: dotColor,
                            width: isActive ? 12 : 10,
                            height: isActive ? 12 : 10,
                            borderRadius: 6,
                            marginTop: 4,
                            borderWidth: isActive ? 2 : 0,
                            borderColor: '#BFDBFE',
                          }}
                        />
                      </ActiveMilestonePulse>
                    {!isLast && (
                      <View
                        style={{
                          width: 2,
                          flexGrow: 1,
                          backgroundColor: isCompleted ? '#86EFAC' : '#CBD5E1',
                          marginVertical: 4,
                        }}
                      />
                    )}
                  </View>

                  {/* Cột phải: Thông tin mốc */}
                  <View style={[styles.timelineRightCol, isLast && { paddingBottom: 2 }]}>
                    <View style={[styles.timelineStepTitleRow, { flexWrap: 'wrap' }]}>
                      <Text
                        style={[
                          styles.timelineStepTitle,
                          isActive && { color: '#2563EB', fontWeight: '800' },
                          isCancelled && { color: '#DC2626' },
                        ]}
                      >
                        {translate(milestone.title)}
                      </Text>
                      {isActive && (
                        <View style={{ backgroundColor: '#EFF6FF', paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 4 }}>
                          <Text style={{ fontSize: 10, color: '#2563EB', fontWeight: '800' }}>
                            {translate('Hiện tại')}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Thời điểm & Thời lượng */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
                      <Text style={styles.timelineStepMeta}>
                        {milestone.formattedTime}
                      </Text>
                      {milestone.durationLabel && (
                        <Text
                          style={[
                            styles.timelineStepDuration,
                            { color: isActive ? '#2563EB' : '#059669', marginLeft: 6 },
                          ]}
                        >
                          • {translate(milestone.durationLabel)}
                        </Text>
                      )}
                    </View>

                    {/* Ghi chú & Người thực hiện */}
                    {(milestone.note || milestone.actorName) && (
                      <View style={styles.timelineStepNoteBox}>
                        {milestone.note ? (
                          <Text style={styles.timelineStepNoteText}>
                            {translate(milestone.note)}
                          </Text>
                        ) : null}
                        {milestone.actorName && (
                          <Text style={{ fontSize: 11, color: '#475569', marginTop: milestone.note ? 3 : 0, fontWeight: '600' }}>
                            👤 {translate('Người thực hiện:')} {milestone.actorName}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              </TimelineNodeEntrance>
            );
            });
          })()}
        </View>
      </View>
    );
  };

  // Quét QR tự động điền thông tin khu vực (Màn hình 02 Cư dân)
  const [qrModalVisible, setQrModalVisible] = useState(false);

  // Bộ dữ liệu khu vực QR chuẩn của tòa nhà ResiFix (FR05, US-09)
  const RESIFIX_ASSET_CATALOG: Record<
    string,
    { qrCode: string; assetName: string; locationLabel: string; areaName?: string }
  > = {
    'HL-B12': {
      qrCode: 'HL-B12',
      assetName: 'Hành lang khu B',
      areaName: 'Hành lang khu B',
      locationLabel: 'Hành lang khu B - Tầng 12 - Tòa S1',
    },
    'AREA-HL-B': {
      qrCode: 'AREA-HL-B',
      assetName: 'Hành lang khu B',
      areaName: 'Hành lang khu B',
      locationLabel: 'Hành lang khu B - Tầng 12 - Tòa S1',
    },
    'AC-B02': {
      qrCode: 'AC-B02',
      assetName: 'Sảnh tầng 1',
      areaName: 'Sảnh tầng 1',
      locationLabel: 'Sảnh tầng 1 - Tòa S1',
    },
    'AREA-SANH-T1': {
      qrCode: 'AREA-SANH-T1',
      assetName: 'Sảnh tầng 1',
      areaName: 'Sảnh tầng 1',
      locationLabel: 'Sảnh tầng 1 - Tòa S1',
    },
    'PK-B1-02': {
      qrCode: 'PK-B1-02',
      assetName: 'Hầm gửi xe B1',
      areaName: 'Hầm gửi xe B1',
      locationLabel: 'Hầm gửi xe B1 - Tòa S1',
    },
    'AREA-HAM-B1': {
      qrCode: 'AREA-HAM-B1',
      assetName: 'Hầm gửi xe B1',
      areaName: 'Hầm gửi xe B1',
      locationLabel: 'Hầm gửi xe B1 - Tòa S1',
    },
    'ELV-02': {
      qrCode: 'ELV-02',
      assetName: 'Khu vực Thang máy Tầng 1',
      areaName: 'Khu vực Thang máy Tầng 1',
      locationLabel: 'Sảnh thang máy Tầng 1 - Tòa S1',
    },
    'WP-1204': {
      qrCode: 'WP-1204',
      assetName: 'Căn hộ A-1204',
      areaName: 'Căn hộ A-1204',
      locationLabel: 'Căn hộ A-1204 - Tầng 12 - Tòa S1',
    },
    'AREA-CH-A1204': {
      qrCode: 'AREA-CH-A1204',
      assetName: 'Căn hộ A-1204',
      areaName: 'Căn hộ A-1204',
      locationLabel: 'Căn hộ A-1204 - Tầng 12 - Tòa S1',
    },
  };

  // Hàm xử lý khi Camera quét được mã QR khu vực (FR05, US-09)
  // 1. KTV XIN NGHỈ PHÉP
  const handleTechSubmitLeave = async () => {
    if (leaveReasonInput.trim().length < 5) {
      showToast(translate('Vui lòng nêu rõ lý do xin nghỉ (tối thiểu 5 ký tự).'));
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/schedule/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          date: leaveDateInput,
          leaveType: leaveTypeInput,
          reason: leaveReasonInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate('Đã gửi đơn xin nghỉ phép tới BMB!'));
        setLeaveReasonInput('');
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi gửi đơn xin nghỉ.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  // 2. KTV ĐỀ NGHỊ ĐỔI CA
  const handleTechSubmitSwap = async () => {
    if (!swapTargetTechId) {
      showToast(translate('Vui lòng chọn KTV để đổi ca trực.'));
      return;
    }
    if (swapReasonInput.trim().length < 5) {
      showToast(translate('Vui lòng nêu rõ lý do đổi ca (tối thiểu 5 ký tự).'));
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/schedule/swap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          date: swapDateInput,
          shiftName: swapShiftInput,
          targetTechId: swapTargetTechId,
          reason: swapReasonInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate('Đã gửi yêu cầu đổi ca trực tới BMB!'));
        setSwapReasonInput('');
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi gửi yêu cầu đổi ca.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  // HỦY YÊU CẦU NGHỈ / ĐỔI CA (KTV)
  const handleTechCancelSchedule = async (reqId: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/schedule/requests/${reqId}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate('Đã hủy yêu cầu thành công.'));
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi hủy yêu cầu.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  // 3. BMB DUYỆT / TỪ CHỐI LỊCH & NGHỈ PHÉP
  const handleBmbReviewSchedule = async (reqId: string, status: 'APPROVED' | 'REJECTED', handoverId?: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/schedule/admin/requests/${reqId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          status,
          reviewNote: status === 'APPROVED' ? 'BMB đã phê duyệt' : 'BMB không đồng ý phê duyệt',
          handoverTechId: handoverId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate(status === 'APPROVED' ? 'Đã phê duyệt yêu cầu thành công!' : 'Đã từ chối yêu cầu.'));
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi xét duyệt yêu cầu.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  // 4. KTV ĐỀ XUẤT CHI PHÍ SỬA CHỮA CHO TICKET
  const handleTechSubmitCost = async (ticketId: string) => {
    if (!matNameInput.trim()) {
      showToast(translate('Vui lòng nhập tên vật tư.'));
      return;
    }
    const qty = Number(matQtyInput) || 1;
    const price = Number(matPriceInput) || 50000;
    const other = 0;

    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/costs/ticket/${ticketId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          items: [
            {
              materialCode: `VT-${Date.now().toString().slice(-4)}`,
              materialName: matNameInput.trim(),
              unit: matUnitInput.trim() || 'Cái',
              quantity: qty,
              unitPrice: price,
            },
          ],
          otherCost: other,
          submitForApproval: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate('Đã gửi đề xuất chi phí vật tư tới BMB!'));
        setMatNameInput('');
        if (data.cost) {
          setTicketCosts((prev) => ({ ...prev, [ticketId]: data.cost }));
        }
      } else {
        showToast(data?.message || translate('Lỗi khi đề xuất chi phí.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  // 5. BMB PHÊ DUYỆT / TỪ CHỐI CHI PHÍ
  const handleBmbReviewCost = async (ticketId: string, status: 'APPROVED' | 'REJECTED') => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/costs/admin/ticket/${ticketId}/review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          status,
          reviewNote: status === 'APPROVED' ? 'BMB đã thẩm định và duyệt chi phí' : 'Chi phí chưa hợp lý, đề nghị kiểm tra lại',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate(status === 'APPROVED' ? 'Đã duyệt chi phí sửa chữa!' : 'Đã từ chối chi phí.'));
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi duyệt chi phí.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  // 6. BMB TẠM DỪNG / TIẾP TỤC SLA
  const handleBmbTogglePauseSla = async (ticketId: string, isCurrentlyPaused: boolean) => {
    try {
      setLoading(true);
      const endpoint = isCurrentlyPaused ? 'resume' : 'pause';
      const res = await fetch(`${API_BASE_URL}/sla/ticket/${ticketId}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          reason: 'Chờ cư dân sắp xếp thời gian hoặc chờ vật tư chuyên dụng',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate(isCurrentlyPaused ? 'Đã tiếp tục tính SLA!' : 'Đã tạm dừng tính SLA.'));
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi thao tác SLA.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  // 7. BÁO ĐỘNG NGUY HIỂM KHẨN CẤP (EMERGENCY BROADCAST)
  const handleEmergencyBroadcast = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/sla/emergency-broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          emergencyType: 'CHÁY_CHẬP_ĐIỆN',
          location: 'Tòa nhà ResiFix',
          buildingBlock: 'TOÀN TÒA NHÀ',
          description: 'Cảnh báo khẩn cấp phát từ hệ thống quản trị BMB',
          confirmEmergency: true,
          isTest: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate('🚨 ĐÃ PHÁT TÍN HIỆU CẢNH BÁO NGUY HIỂM KHẨN CẤP TOÀN HỆ THỐNG!'));
      } else {
        showToast(translate('Không thể phát tín hiệu khẩn cấp.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend.'));
    } finally {
      setLoading(false);
    }
  };





  // ============================================================================
  // QUẢN LÝ BÁO CÁO SỰ CỐ ẨN DANH QUA QR (KHÁCH VÃNG LAI CHƯA ĐĂNG NHẬP)
  // ============================================================================
  const requestGuestLocation = async (userInitiated = false) => {
    setAnonymousGpsStatus('FETCHING');
    setAnonymousLocationError(null);

    try {
      // 1. Đọc trạng thái quyền vị trí foreground hiện tại bằng API expo-location
      let perm = await Location.getForegroundPermissionsAsync();

      // 2. Nếu chưa được cấp quyền
      if (!perm.granted) {
        if (perm.canAskAgain) {
          setAnonymousCanAskAgain(true);
          // Yêu cầu quyền nếu người dùng chủ động bấm hoặc hệ thống chưa hỏi lần nào (UNDETERMINED)
          if (userInitiated || perm.status === Location.PermissionStatus.UNDETERMINED) {
            perm = await Location.requestForegroundPermissionsAsync();
          } else {
            setAnonymousGpsStatus('DENIED');
            setAnonymousLocationCoords(null);
            return;
          }
        } else {
          // canAskAgain là false: Người dùng đã từ chối vĩnh viễn hoặc hệ thống chặn hỏi lại
          setAnonymousCanAskAgain(false);
          setAnonymousGpsStatus('BLOCKED');
          setAnonymousLocationCoords(null);
          if (userInitiated) {
            Alert.alert(
              translate('Quyền vị trí đã bị chặn'),
              translate(
                'Hệ điều hành đã chặn yêu cầu quyền vị trí. Vui lòng nhấn "Mở Cài đặt" để cho phép ResiFix truy cập vị trí.'
              ),
              [
                { text: translate('Hủy'), style: 'cancel' },
                { text: translate('Mở Cài đặt'), onPress: () => Linking.openSettings() },
              ]
            );
          }
          return;
        }
      }

      // 3. Kiểm tra kết quả sau khi xin quyền
      if (!perm.granted) {
        setAnonymousCanAskAgain(perm.canAskAgain);
        setAnonymousLocationCoords(null);
        if (!perm.canAskAgain) {
          setAnonymousGpsStatus('BLOCKED');
        } else {
          setAnonymousGpsStatus('DENIED');
        }
        return;
      }

      setAnonymousCanAskAgain(true);

      // 4. Kiểm tra dịch vụ định vị (GPS) trên thiết bị có đang bật không
      let servicesEnabled = true;
      try {
        servicesEnabled = await Location.hasServicesEnabledAsync();
      } catch (svcErr) {
        console.warn('Location.hasServicesEnabledAsync check warning:', svcErr);
      }

      if (!servicesEnabled) {
        setAnonymousGpsStatus('SERVICE_DISABLED');
        setAnonymousLocationCoords(null);
        setAnonymousLocationError(
          translate('Dịch vụ vị trí (GPS) trên thiết bị đang tắt. Vui lòng bật GPS để xác minh vị trí.')
        );
        if (userInitiated) {
          Alert.alert(
            translate('Dịch vụ vị trí đang tắt'),
            translate('Vui lòng bật định vị GPS trong cài đặt thiết bị để ResiFix có thể xác minh vị trí của bạn.')
          );
        }
        return;
      }

      // 5. Đã có quyền và GPS bật: Lấy tọa độ hiện tại của thiết bị
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      if (loc?.coords) {
        const coords = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: Math.round(loc.coords.accuracy || 10),
        };
        setAnonymousLocationCoords(coords);
        setAnonymousGpsStatus('ACQUIRED');
        setAnonymousLocationError(null);
        showToast(translate('📍 Đã ghi nhận vị trí thiết bị (Sẵn sàng đối chiếu phạm vi khi gửi)'));
      } else {
        throw new Error('Không thể lấy tọa độ từ thiết bị.');
      }
    } catch (err: any) {
      console.warn('Lỗi lấy vị trí khách vãng lai:', err?.message || err);
      setAnonymousLocationCoords(null);
      setAnonymousGpsStatus('FAILED');
      setAnonymousLocationError(
        translate('Không thể lấy tọa độ hiện tại. Vui lòng kiểm tra GPS và thử lại.')
      );
      if (userInitiated) {
        showToast(translate('⚠️ Không thể lấy tọa độ. Báo cáo vẫn được gửi bình thường.'));
      }
    }
  };

  // Tự động kiểm tra lại quyền vị trí khi người dùng quay lại app từ màn hình Cài đặt hệ thống
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'active') {
        if (isAnonymousReporting && anonymousArea && !anonymousLocationCoords) {
          try {
            const perm = await Location.getForegroundPermissionsAsync();
            if (perm.granted) {
              await requestGuestLocation(false);
            } else {
              setAnonymousCanAskAgain(perm.canAskAgain);
              if (!perm.canAskAgain) {
                setAnonymousGpsStatus('BLOCKED');
              }
            }
          } catch (err) {
            console.warn('AppState change permission check warning:', err);
          }
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isAnonymousReporting, anonymousArea, anonymousLocationCoords]);

  const handlePickAnonymousPhoto = async (fromCamera = true, replaceIndex?: number) => {
    try {
      // D2: Khách vãng lai bắt buộc chụp ảnh trực tiếp bằng Camera, không cho chọn từ Album
      if (!fromCamera) {
        Alert.alert(
          translate('Yêu cầu chụp trực tiếp'),
          translate('Để chống báo cáo giả, khách vãng lai bắt buộc chụp ảnh sự cố trực tiếp bằng Camera thiết bị.')
        );
        return;
      }
      if (replaceIndex === undefined && anonymousPhotos.length >= 3) {
        Alert.alert(translate('Thông báo'), translate('Bạn chỉ có thể đính kèm tối đa 3 ảnh hiện trường.'));
        return;
      }
      const { status } = await ImagePicker.requestCameraPermissionsAsync();

      if (status !== 'granted') {
        Alert.alert(
          translate('Cần quyền truy cập Camera'),
          translate('Vui lòng cấp quyền Camera để chụp ảnh trực tiếp tại hiện trường sự cố.'),
          [
            { text: translate('Đóng'), style: 'cancel' },
            { text: translate('Mở Cài đặt'), onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      });

      if (result.canceled || !result.assets || !result.assets[0]?.base64) return;

      setAnonymousUploading(true);
      const asset = result.assets[0];
      const mimeType = asset.mimeType || 'image/jpeg';
      const base64DataUri = `data:${mimeType};base64,${asset.base64}`;
      const capturedIso = new Date().toISOString();

      const res = await fetch(`${API_BASE_URL}/upload/anonymous`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          imageBase64: base64DataUri,
          folder: 'incident_scene',
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.imageUrl) {
        setAnonymousPhotoCapturedAt(capturedIso);
        if (typeof replaceIndex === 'number') {
          setAnonymousPhotos((prev) => prev.map((item, i) => (i === replaceIndex ? data.imageUrl : item)));
          showToast(translate('Đã chụp lại ảnh hiện trường thành công!'));
        } else {
          setAnonymousPhotos((prev) => [...prev, data.imageUrl]);
          showToast(translate('Đã chụp và tải ảnh hiện trường thành công!'));
        }
      } else {
        Alert.alert(translate('Lỗi tải ảnh'), translate(data.message || 'Không thể tải ảnh lên máy chủ.'));
      }
    } catch {
      Alert.alert(translate('Lỗi'), translate('Lỗi khi chụp/tải ảnh hiện trường. Vui lòng thử lại.'));
    } finally {
      setAnonymousUploading(false);
    }
  };

  const handleGuestSubmitReport = async () => {
    if (loading) return;
    if (!anonymousArea) {
      Alert.alert(translate('Thông báo'), translate('Vui lòng quét mã QR khu vực hoặc căn hộ sự cố.'));
      return;
    }
    if (anonymousGpsStatus !== 'ACQUIRED' || !anonymousLocationCoords) {
      Alert.alert(
        translate('Bắt buộc xác định vị trí GPS'),
        translate('Để chống báo cáo giả, khách vãng lai bắt buộc cấp quyền định vị và lấy tọa độ GPS thực tế trước khi gửi báo cáo.'),
        [
          { text: translate('Đóng'), style: 'cancel' },
          { text: translate('Lấy vị trí ngay'), onPress: () => requestGuestLocation(true) },
        ]
      );
      return;
    }
    if (anonymousPhotos.length === 0) {
      Alert.alert(
        translate('Bắt buộc chụp ảnh hiện trường'),
        translate('Khách vãng lai bắt buộc chụp trực tiếp ít nhất 1 ảnh sự cố bằng Camera thiết bị trước khi gửi báo cáo.')
      );
      return;
    }
    if (anonymousDesc.trim().length < 10) {
      Alert.alert(translate('Mô tả quá ngắn'), translate('Mô tả sự cố cần tối thiểu 10 ký tự để Ban quản lý và kỹ thuật viên nắm rõ.'));
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        qrCode: anonymousArea.qrCode,
        title: anonymousTitle.trim() || undefined,
        description: anonymousDesc.trim(),
        isVoiceInput: anonymousIsVoiceUsed,
        imageUrls: anonymousPhotos,
        photoSource: 'CAMERA',
        photoCapturedAt: anonymousPhotoCapturedAt || new Date().toISOString(),
        locationCoords: {
          latitude: anonymousLocationCoords.latitude,
          longitude: anonymousLocationCoords.longitude,
          accuracy: anonymousLocationCoords.accuracy,
        },
      };

      const res = await fetch(`${API_BASE_URL}/tickets/anonymous`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success && data.ticket) {
        setAnonymousReceipt({
          ticketCode: data.ticket.ticketCode,
          status: data.ticket.status,
          verificationStatus: data.locationVerification?.status || 'UNVERIFIED',
          verificationLabel: data.locationVerification?.label || 'Chờ BMB xác minh',
          verificationReason: data.locationVerification?.reason || '',
          areaName: anonymousArea.areaName,
          buildingName: anonymousArea.buildingName,
        });
        showToast(translate(data.message || 'Đã tiếp nhận báo cáo và đang chờ Ban quản lý xác minh!'));
      } else {
        Alert.alert(
          translate('Không thể gửi báo cáo'),
          translate(data.message || 'Đã có lỗi xảy ra. Vui lòng thử lại.')
        );
      }
    } catch {
      Alert.alert(
        translate('Lỗi kết nối'),
        translate('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleBmbVerifyGuestReport = async (ticketId: string, action: 'APPROVE' | 'REJECT') => {
    if (!token || bmbGuestVerifyBusy) return;
    if (action === 'REJECT' && bmbGuestRejectReason.trim().length < 5) {
      Alert.alert(
        translate('Thiếu lý do từ chối'),
        translate('Vui lòng nhập lý do từ chối báo cáo khách vãng lai (tối thiểu 5 ký tự).')
      );
      return;
    }

    setBmbGuestVerifyBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketId}/verify-guest-report`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          action,
          reason: action === 'REJECT' ? bmbGuestRejectReason.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data.ticket) {
        setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, ...data.ticket } : t)));
        if (bmbSelectedTicket?.id === ticketId) {
          setBmbSelectedTicket((prev: any) => (prev ? { ...prev, ...data.ticket } : data.ticket));
        }
        setShowBmbGuestRejectInput(false);
        setBmbGuestRejectReason('');
        showToast(translate(data.message || (action === 'APPROVE' ? 'Đã duyệt báo cáo khách vãng lai!' : 'Đã từ chối báo cáo khách vãng lai.')));
      } else {
        Alert.alert(translate('Thông báo'), translate(data?.message || 'Không thể cập nhật trạng thái xác minh báo cáo.'));
      }
    } catch {
      Alert.alert(translate('Lỗi kết nối'), translate('Không thể kết nối tới máy chủ để xác minh báo cáo.'));
    } finally {
      setBmbGuestVerifyBusy(false);
    }
  };

  // Quét QR tự động điền thiết bị (Màn hình 02 Cư dân) & Khách vãng lai báo sự cố qua QR
  const handleQrCodeDetected = async (rawCode: string) => {
    const cleanCode = rawCode.trim().toUpperCase();

    // 1. NẾU LÀ KHÁCH VÃNG LAI CHƯA ĐĂNG NHẬP
    if (!token) {
      try {
        setLoading(true);
        const response = await fetch(
          `${API_BASE_URL}/tickets/anonymous/qr/${encodeURIComponent(cleanCode)}`,
          {
            headers: {
              'bypass-tunnel-reminder': 'true',
            },
          }
        );

        const data = await response.json();
        if (response.ok && data.success && data.area) {
          setAnonymousArea({
            id: data.area.id,
            qrCode: data.area.qrCode,
            qrType: data.qrType || data.area.qrType || 'COMMON_AREA',
            apartmentCode: data.area.apartmentCode,
            areaName: data.area.areaName,
            category: data.area.category,
            locationLabel: data.area.locationLabel,
            buildingBlock: data.area.buildingBlock,
            floor: data.area.floor,
            buildingName: data.building?.buildingName || 'Tòa nhà ResiFix',
            buildingAddress: data.building?.buildingAddress || '',
            hasBoundaryConfig: Boolean(data.building?.hasBoundaryConfig),
          });
          setAnonymousTitle('');
          setAnonymousDesc('');
          setAnonymousPhotos([]);
          setAnonymousPhotoCapturedAt(null);
          setAnonymousReceipt(null);
          setAnonymousLocationCoords(null);
          setAnonymousGpsStatus('IDLE');
          setGuestQrModalVisible(false);
          setQrModalVisible(false);
          setIsAnonymousReporting(true);
          showToast(translate(data.message || `✅ Đã nhận diện: ${data.area.areaName}`));

          // Tự động yêu cầu quyền vị trí và giải thích mục đích đối chiếu phạm vi tòa nhà
          setTimeout(() => {
            requestGuestLocation();
          }, 400);
          return;
        }

        // Mã QR không hợp lệ hoặc khu vực không còn hoạt động: Thông báo và cho khách quét lại
        const isPrivateRoom = data.code === 'PRIVATE_APARTMENT_QR';
        Alert.alert(
          translate(isPrivateRoom ? 'Mã QR phòng riêng căn hộ' : 'Mã QR không hợp lệ'),
          translate(
            data.message ||
            'Mã QR không hợp lệ hoặc khu vực hiện không còn hoạt động. Vui lòng quét lại mã QR tại khu vực sự cố.'
          )
        );
      } catch {
        Alert.alert(
          translate('Lỗi kết nối máy chủ'),
          translate('Không thể kiểm tra mã QR khu vực. Vui lòng kiểm tra lại kết nối mạng và thử lại.')
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    // 2. NẾU LÀ CƯ DÂN ĐÃ ĐĂNG NHẬP (GIỮ NGUYÊN TOÀN VẸN 100%)
    try {
      setScannedAsset(null);
      setLoading(true);
      const response = await fetch(
        `${API_BASE_URL}/tickets/assets/qr/${encodeURIComponent(cleanCode)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'bypass-tunnel-reminder': 'true',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.success && (data.area || data.asset)) {
          const item = data.area || data.asset;
          const areaTitle = item.areaName || item.assetName;
          setScannedAsset({
            qrCode: item.qrCode,
            assetName: areaTitle,
            locationLabel: item.locationLabel,
            areaName: areaTitle,
          });
          showToast(translate(`✅ Đã xác định khu vực: ${areaTitle}`));
          return;
        }
      } else {
        const errData = await response.json().catch(() => null);
        if (errData?.message) {
          Alert.alert(translate('Thông báo quét mã QR'), translate(errData.message));
          return;
        }
      }

      showToast(translate("Mã QR không hợp lệ hoặc bạn chưa có quyền sử dụng."));
    } catch {
      // Nếu lỗi mạng khi gọi API, vẫn tự động điền nếu mã QR hợp lệ
      if (RESIFIX_ASSET_CATALOG[cleanCode]) {
        const fallbackAsset = RESIFIX_ASSET_CATALOG[cleanCode];
        setScannedAsset(fallbackAsset);
        showToast(translate(`✅ Đã xác định khu vực: ${fallbackAsset.areaName || fallbackAsset.assetName}`));
      } else {
        showToast(translate(`❌ Không thể tra cứu mã "${cleanCode}". Kiểm tra lại kết nối Backend!`));
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
    } catch {
      showToast(translate('⚠️ Lỗi khi tải ảnh lên! Vui lòng thử lại.'));
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
    } catch {
      showToast(translate('⚠️ Lỗi khi chọn ảnh từ thư viện! Vui lòng thử lại.'));
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
          title: scannedAsset ? `Sự cố tại ${scannedAsset.areaName || scannedAsset.assetName}` : undefined,
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
        setReportDesc('');
        setManualLocation('');
        setScannedAsset(null);
        setReportPhotos([]);
        setIsVoiceUsed(false);
        showToast(translate(data.message || `Đã gửi ${data.ticket?.ticketCode || 'sự cố'} thành công.`));
        if (data.ticket) {
          openResidentTicket(data.ticket);
        } else {
          setResScreen('HOME');
        }
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
      const data = await res.json();
      if (data.success) {
        showToast(`🛠️ Đã nhận việc ${ticketObj.ticketCode}!`);
        await fetchAllData();
        const prevTicket = activeTicket?.id === ticketObj.id ? activeTicket : ticketObj;
        const mergedMedia =
          Array.isArray(data.ticket?.media) && data.ticket.media.length > 0
            ? data.ticket.media
            : Array.isArray(prevTicket?.media) && prevTicket.media.length > 0
              ? prevTicket.media
              : [];
        const mergedPhotos =
          Array.isArray(data.ticket?.photos) && data.ticket.photos.length > 0
            ? data.ticket.photos
            : Array.isArray(prevTicket?.photos) && prevTicket.photos.length > 0
              ? prevTicket.photos
              : [];
        const mergedAsset = data.ticket?.asset || prevTicket?.asset || null;
        const mergedArea = data.ticket?.area || prevTicket?.area || null;

        setActiveTicket({
          ...prevTicket,
          ...data.ticket,
          media: mergedMedia,
          photos: mergedPhotos,
          asset: mergedAsset,
          area: mergedArea,
          status: data.ticket?.status ?? 'IN_PROGRESS',
        });
        setTechScreen('TASK_DETAIL');
        if (data.ticket?.id) {
          setTechnicianGuidance({ status: 'GENERATING' });
          void fetchTechnicianGuidance(data.ticket.id);
        }
      } else {
        showToast(data.message || translate('Lỗi khi nhận việc.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  // Bước 2: KTV chụp ảnh xác nhận có mặt tại hiện trường (Camera trực tiếp trên điện thoại)
  const handleTechCaptureArrivalPhoto = async () => {
    if (loading) return;
    const onUrl = (url: string) => {
      setTechArrivalPhotoUrl(url);
      showToast(translate('Đã chụp ảnh xác nhận tại hiện trường.'));
    };
    if (Platform.OS === 'web') {
      await launchLibraryFlow('incident_scene', onUrl);
    } else {
      await launchCameraFlow('incident_scene', onUrl);
    }
    void getDeviceLocation()
      .then((loc) => {
        if (loc) setTechArrivalGps(loc);
      })
      .catch(() => undefined);
  };

  // Bước 2 -> 3: KTV bấm "Tôi đã đến". Chỉ chuyển bước khi Backend lưu thành công.
  const handleTechConfirmArrival = async (ticketObj: any) => {
    if (loading) return;
    if (!techArrivalPhotoUrl) {
      showToast(translate('Vui lòng chụp ảnh xác nhận tại hiện trường trước khi bấm "Tôi đã đến".'));
      return;
    }
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 20000);
    try {
      setLoading(true);
      try {
        if (Platform.OS !== 'web') await Location.requestForegroundPermissionsAsync();
      } catch {
        // Quyền vị trí bị từ chối: tiếp tục không có GPS, Backend vẫn lưu ảnh và thời điểm đến
      }
      const loc = await getDeviceLocation();
      if (loc) setTechArrivalGps(loc);

      const res = await fetch(`${API_BASE_URL}/tickets/${ticketObj.id}/arrive`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          arrivalPhotoUrl: techArrivalPhotoUrl,
          locationCoords: loc || undefined,
        }),
        signal: abortController.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && data.ticket) {
        setActiveTicket((prev: any) => ({
          ...(prev && prev.id === ticketObj.id ? prev : ticketObj),
          ...data.ticket,
          hasArrivedOnSite: true,
        }));
        setTechArrivalPhotoUrl(null);
        showToast(translate(data.message || 'Đã xác nhận có mặt tại hiện trường!'));
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Không thể xác nhận đã đến hiện trường. Vui lòng thử lại.'));
      }
    } catch (err: any) {
      showToast(
        err?.name === 'AbortError'
          ? translate('Quá thời gian kết nối máy chủ. Vẫn ở bước hiện tại, vui lòng thử lại.')
          : translate('Không kết nối được Backend. Vẫn ở bước hiện tại, vui lòng thử lại.')
      );
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  // Bước 3 -> 4: KTV bấm "Hoàn thành sửa chữa" (kèm ảnh nghiệm thu). Chỉ chuyển bước khi API thành công.
  const handleTechCompleteSubmit = async (ticketObj: any) => {
    if (loading) return;
    if (ticketObj.status !== 'IN_PROGRESS') {
      showToast(translate('Vui lòng nhận việc và xác nhận đã đến hiện trường trước khi hoàn thành.'));
      return;
    }
    if (!hasTechArrivedOnSite(ticketObj)) {
      showToast(translate('Bạn cần bấm "Tôi đã đến" tại hiện trường trước khi hoàn thành sửa chữa.'));
      return;
    }
    if (techProofPhotos.length === 0) {
      showToast(translate('Vui lòng chọn ít nhất một ảnh nghiệm thu trước khi hoàn tất.'));
      return;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 20000);
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tickets/${ticketObj.id}/complete`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          proofImageUrls: techProofPhotos,
          techRepairNote: techRepairNote.trim() || undefined,
          isQrVerifiedByTech: true,
        }),
        signal: abortController.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && data.ticket) {
        setActiveTicket((prev: any) => ({
          ...(prev && prev.id === ticketObj.id ? prev : ticketObj),
          ...data.ticket,
          status: data.ticket.status ?? 'COMPLETED',
        }));
        showToast(`📸 Đã hoàn thành & gửi ảnh nghiệm thu ${ticketObj.ticketCode}!`);
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Không thể hoàn thành sửa chữa. Vẫn ở bước hiện tại, vui lòng thử lại.'));
      }
    } catch (err: any) {
      showToast(
        err?.name === 'AbortError'
          ? translate('Quá thời gian kết nối máy chủ. Vẫn ở bước hiện tại, vui lòng thử lại.')
          : translate('Không kết nối được Backend. Vẫn ở bước hiện tại, vui lòng thử lại.')
      );
    } finally {
      clearTimeout(timeoutId);
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

    const targetTech = technicians.find((t) => t.id === targetTechId);
    if (
      targetTech &&
      (targetTech.isEligibleForAssignment === false ||
        !targetTech.isOnDuty ||
        targetTech.isCheckedOut ||
        !targetTech.isCheckedIn ||
        targetTech.onLeave)
    ) {
      showToast('Kỹ thuật viên đã kết thúc ca hoặc không còn trực. Vui lòng chọn kỹ thuật viên khác.');
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
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Đã duyệt & giao việc thành công! Đã gửi thông báo đẩy FCM.`);
        const assignedTicket = data.ticket;
        setBmbSelectedTicket((prev: any) => {
          if (!prev || prev.id !== assignedTicket?.id) return assignedTicket;
          const mergedMedia =
            Array.isArray(assignedTicket?.media) && assignedTicket.media.length > 0
              ? assignedTicket.media
              : prev.media || [];
          const mergedPhotos =
            Array.isArray(assignedTicket?.photos) && assignedTicket.photos.length > 0
              ? assignedTicket.photos
              : prev.photos || [];
          return {
            ...prev,
            ...assignedTicket,
            media: mergedMedia,
            photos: mergedPhotos,
          };
        });
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
    const renderAuthModals = () => (
      <>
        {/* Modal Quên mật khẩu */}
        <Modal
          visible={showForgotModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowForgotModal(false)}
        >
          <View style={styles.technicianModalOverlay}>
            <AnimatedModalContent visible={showForgotModal} style={styles.technicianModalCard}>
              <Text style={styles.technicianModalTitle}>
                {forgotStep === 1 ? translate('Quên mật khẩu') : translate('Xác thực OTP & Đặt lại mật khẩu')}
              </Text>
              <Text style={styles.technicianModalDescription}>
                {forgotStep === 1
                  ? translate('Nhập địa chỉ email đã đăng ký để nhận mã OTP khôi phục mật khẩu.')
                  : `${translate('Nhập mã OTP 6 số đã gửi tới:')} ${forgotMaskedEmail || forgotEmail}`}
              </Text>

              {forgotStep === 1 ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.fieldLabel}>{translate('Địa chỉ Email *')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={forgotEmail}
                    onChangeText={setForgotEmail}
                    placeholder="ví dụ: cu_dan@resifix.vn"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                    <TouchableOpacity
                      style={[styles.technicianCancelButton, { flex: 1 }]}
                      onPress={() => setShowForgotModal(false)}
                      disabled={forgotBusy}
                    >
                      <Text style={styles.technicianCancelButtonText}>{translate('Hủy')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.bmbWebLoginBtn, { flex: 2 }, forgotBusy && { opacity: 0.6 }]}
                      onPress={handleRequestForgotOtp}
                      disabled={forgotBusy}
                    >
                      {forgotBusy ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.bmbWebLoginBtnText}>{translate('Gửi mã OTP')}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.fieldLabel}>{translate('Mã OTP 6 chữ số *')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={forgotOtp}
                    onChangeText={setForgotOtp}
                    placeholder=""
                    keyboardType="numeric"
                    maxLength={6}
                  />

                  <Text style={[styles.fieldLabel, { marginTop: 10 }]}>
                    {translate('Mật khẩu mới (12-128 ký tự) *')}
                  </Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={forgotNewPassword}
                    onChangeText={setForgotNewPassword}
                    secureTextEntry
                    placeholder="Nhập tối thiểu 12 ký tự"
                  />

                  <Text style={[styles.fieldLabel, { marginTop: 10 }]}>
                    {translate('Xác nhận mật khẩu mới *')}
                  </Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={forgotConfirmPassword}
                    onChangeText={setForgotConfirmPassword}
                    secureTextEntry
                    placeholder="Nhập lại mật khẩu mới"
                  />

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                    <TouchableOpacity
                      onPress={handleRequestForgotOtp}
                      disabled={forgotCooldown > 0 || forgotBusy}
                    >
                      <Text style={{ fontSize: 13, color: forgotCooldown > 0 ? '#94A3B8' : '#0284C7', fontWeight: '600' }}>
                        {forgotCooldown > 0
                          ? `${translate('Gửi lại sau')} (${forgotCooldown}s)`
                          : translate('Gửi lại mã OTP')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setForgotStep(1)}>
                      <Text style={{ fontSize: 13, color: '#64748B' }}>{translate('Đổi email khác')}</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                    <TouchableOpacity
                      style={[styles.technicianCancelButton, { flex: 1 }]}
                      onPress={() => setShowForgotModal(false)}
                      disabled={forgotBusy}
                    >
                      <Text style={styles.technicianCancelButtonText}>{translate('Đóng')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.bmbWebLoginBtn, { flex: 2 }, forgotBusy && { opacity: 0.6 }]}
                      onPress={handleResetPassword}
                      disabled={forgotBusy}
                    >
                      {forgotBusy ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.bmbWebLoginBtnText}>{translate('Đổi mật khẩu')}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </AnimatedModalContent>
          </View></Modal>

        {/* Modal Kích hoạt tài khoản Cư dân, Kỹ thuật viên & Ban Quản Lý */}
        <Modal
          visible={showActivationModal}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setActivationError(null);
            setActivationFieldErrors({});
            setShowActivationModal(false);
          }}
        >
          <View style={styles.technicianModalOverlay}>
            <AnimatedModalContent visible={showActivationModal} style={[styles.technicianModalCard, { maxHeight: '94%' }]}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 10 }}
              >
                <Text style={styles.technicianModalTitle}>
                  {activationRole === 'TECHNICIAN'
                    ? translate('Kích hoạt tài khoản Kỹ thuật viên')
                    : activationRole === 'RESIDENT'
                      ? translate('Kích hoạt tài khoản Cư dân')
                      : activationRole === 'BMB'
                        ? translate('Kích hoạt tài khoản Ban Quản Lý')
                        : translate('Kích hoạt tài khoản')}
                </Text>

                {activationFullName ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 4, flexWrap: 'wrap' }}>
                    <Text style={{ fontSize: 13, color: '#0F172A', fontWeight: '700' }}>
                      {translate('Tài khoản:')} {activationFullName}
                    </Text>
                    {activationRole ? (
                      <View style={[styles.statusPill, {
                        backgroundColor:
                          activationRole === 'TECHNICIAN' ? '#E0F2FE' :
                            activationRole === 'BMB' ? '#F3E8FF' : '#DCFCE7'
                      }]}>
                        <Text style={[styles.statusPillText, {
                          color:
                            activationRole === 'TECHNICIAN' ? '#0369A1' :
                              activationRole === 'BMB' ? '#7E22CE' : '#15803D',
                          fontWeight: '700'
                        }]}>
                          {activationRole === 'TECHNICIAN' ? translate('Kỹ thuật viên') :
                            activationRole === 'BMB' ? translate('Kích hoạt tài khoản Ban Quản Lý') : translate('Cư dân')}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {/* Email nhận mã OTP & Thời hạn */}
                {activationEmail ? (
                  <View style={{ backgroundColor: '#EFF6FF', borderRadius: 8, padding: 10, marginVertical: 6, borderWidth: 1, borderColor: '#BFDBFE' }}>
                    <Text style={{ fontSize: 12, color: '#1E40AF', fontWeight: '500' }}>
                      ✉️ {translate('Email nhận mã OTP:')} <Text style={{ fontWeight: '700' }}>{maskEmailString(activationEmail)}</Text>
                    </Text>
                    <Text style={{ fontSize: 11, color: '#3B82F6', marginTop: 2 }}>
                      ⏱️ {translate('Thời gian hiệu lực OTP: 5 phút')}
                    </Text>
                  </View>
                ) : null}

                {/* Badge trạng thái OTP */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 4 }}>
                  <View style={[styles.statusPill, {
                    backgroundColor:
                      activationOtpStatus === 'SENT' ? '#DCFCE7' :
                        activationOtpStatus === 'SENDING' ? '#E0F2FE' :
                          activationOtpStatus === 'FAILED' ? '#FEE2E2' :
                            activationOtpStatus === 'EXPIRED' ? '#FEF3C7' : '#F1F5F9'
                  }]}>
                    <Text style={[styles.statusPillText, {
                      color:
                        activationOtpStatus === 'SENT' ? '#15803D' :
                          activationOtpStatus === 'SENDING' ? '#0369A1' :
                            activationOtpStatus === 'FAILED' ? '#DC2626' :
                              activationOtpStatus === 'EXPIRED' ? '#B45309' : '#475569',
                      fontWeight: '700'
                    }]}>
                      {activationOtpStatus === 'SENT' ? ('🟢 ' + translate('Đã gửi OTP')) :
                        activationOtpStatus === 'SENDING' ? ('🔄 ' + translate('Đang gửi OTP')) :
                          activationOtpStatus === 'FAILED' ? ('🔴 ' + translate('Gửi OTP thất bại')) :
                            activationOtpStatus === 'EXPIRED' ? ('⚠️ ' + translate('OTP hết hạn')) :
                              ('⚪ ' + translate('Chưa gửi OTP'))}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.technicianModalDescription, { marginTop: 4 }]}>
                  {translate('Vui lòng nhập mã OTP đã nhận qua email và thiết lập mật khẩu bảo mật (từ 6 đến 128 ký tự).')}
                </Text>

                <View style={{ marginTop: 10 }}>
                  <Text style={styles.fieldLabel}>{translate('Địa chỉ Email *')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={activationEmail}
                    onChangeText={(val) => {
                      setActivationError(null);
                      setActivationFieldErrors((prev) => ({ ...prev, email: undefined }));
                      setActivationEmail(val);
                    }}
                    placeholder={activationRole === 'TECHNICIAN' ? 'ky_thuat_vien@resifix.vn' : activationRole === 'RESIDENT' ? 'cu_dan@resifix.vn' : 'email@resifix.vn'}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  {activationFieldErrors.email ? (
                    <Text style={[styles.technicianFormError, { marginTop: 4 }]}>{activationFieldErrors.email}</Text>
                  ) : null}

                  <Text style={[styles.fieldLabel, { marginTop: 10 }]}>{translate('Mã OTP 6 chữ số *')}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <TextInput
                      style={[styles.technicianFormInput, { flex: 1, letterSpacing: 2, fontWeight: '700' }]}
                      value={activationOtp}
                      onChangeText={(val) => {
                        setActivationError(null);
                        setActivationFieldErrors((prev) => ({ ...prev, otp: undefined }));
                        setActivationOtp(val);
                      }}
                      placeholder=""
                      keyboardType="numeric"
                      maxLength={6}
                    />
                    <TouchableOpacity
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: 8,
                        backgroundColor: activationCooldown > 0 || activationBusy ? '#F1F5F9' : '#E0F2FE',
                        borderWidth: 1,
                        borderColor: activationCooldown > 0 || activationBusy ? '#E2E8F0' : '#BAE6FD',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      onPress={handleRequestActivationOtp}
                      disabled={activationCooldown > 0 || activationBusy}
                    >
                      <Text style={{ fontSize: 12, color: activationCooldown > 0 ? '#94A3B8' : '#0369A1', fontWeight: '700' }}>
                        {activationCooldown > 0
                          ? `${translate('Gửi lại sau')} (${activationCooldown}s)`
                          : activationOtpStatus === 'SENT' ? translate('Gửi lại mã OTP') : translate('Gửi mã kích hoạt')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {activationFieldErrors.otp ? (
                    <Text style={[styles.technicianFormError, { marginTop: 4 }]}>{activationFieldErrors.otp}</Text>
                  ) : null}

                  <Text style={[styles.fieldLabel, { marginTop: 10 }]}>
                    {translate('Mật khẩu mới (từ 6-128 ký tự) *')}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', position: 'relative' }}>
                    <TextInput
                      style={[styles.technicianFormInput, { flex: 1, paddingRight: 48 }]}
                      value={activationNewPassword}
                      onChangeText={(val) => {
                        setActivationError(null);
                        setActivationFieldErrors((prev) => ({ ...prev, password: undefined }));
                        setActivationNewPassword(val);
                      }}
                      secureTextEntry={!showActivationNewPass}
                      placeholder="Nhập tối thiểu 6 ký tự"
                    />
                    <TouchableOpacity
                      onPress={() => setShowActivationNewPass(!showActivationNewPass)}
                      style={{ position: 'absolute', right: 10, padding: 6 }}
                    >
                      <Text style={{ fontSize: 12, color: '#64748B', fontWeight: '600' }}>
                        {showActivationNewPass ? translate('Ẩn') : translate('Hiện')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {activationFieldErrors.password ? (
                    <Text style={[styles.technicianFormError, { marginTop: 4 }]}>{activationFieldErrors.password}</Text>
                  ) : null}

                  <Text style={[styles.fieldLabel, { marginTop: 10 }]}>
                    {translate('Xác nhận mật khẩu mới *')}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', position: 'relative' }}>
                    <TextInput
                      style={[styles.technicianFormInput, { flex: 1, paddingRight: 48 }]}
                      value={activationConfirmPassword}
                      onChangeText={(val) => {
                        setActivationError(null);
                        setActivationFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                        setActivationConfirmPassword(val);
                      }}
                      secureTextEntry={!showActivationConfirmPass}
                      placeholder="Nhập lại mật khẩu mới"
                    />
                    <TouchableOpacity
                      onPress={() => setShowActivationConfirmPass(!showActivationConfirmPass)}
                      style={{ position: 'absolute', right: 10, padding: 6 }}
                    >
                      <Text style={{ fontSize: 12, color: '#64748B', fontWeight: '600' }}>
                        {showActivationConfirmPass ? translate('Ẩn') : translate('Hiện')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {activationFieldErrors.confirmPassword ? (
                    <Text style={[styles.technicianFormError, { marginTop: 4 }]}>{activationFieldErrors.confirmPassword}</Text>
                  ) : null}

                  {activationError && !Object.values(activationFieldErrors).some(Boolean) ? (
                    <View style={{ backgroundColor: '#FEE2E2', borderRadius: 8, padding: 10, marginTop: 12, borderWidth: 1, borderColor: '#FCA5A5' }}>
                      <Text style={[styles.technicianFormError, { color: '#B91C1C', marginTop: 0 }]}>{activationError}</Text>
                    </View>
                  ) : null}

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                    <TouchableOpacity
                      style={[styles.technicianCancelButton, { flex: 1 }]}
                      onPress={() => {
                        setActivationError(null);
                        setActivationFieldErrors({});
                        setShowActivationModal(false);
                      }}
                      disabled={activationBusy}
                    >
                      <Text style={styles.technicianCancelButtonText}>{translate('Quay lại đăng nhập')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.bmbWebLoginBtn, { flex: 2 }, activationBusy && { opacity: 0.6 }]}
                      onPress={handleActivateAccount}
                      disabled={activationBusy}
                    >
                      {activationBusy ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.bmbWebLoginBtnText}>{translate('Kích hoạt và tiếp tục')}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </ScrollView>
            </AnimatedModalContent>
          </View>
        </Modal>

        {/* Modal Quét QR dành cho Khách vãng lai báo cáo sự cố (Không cần đăng nhập) */}
        {guestQrModalVisible && (
          <QrScannerModal
            visible
            onClose={() => setGuestQrModalVisible(false)}
            onScannedCode={handleQrCodeDetected}
            roleTitle={translate("Quét mã QR Khu vực báo sự cố (Khách vãng lai)")}
          />
        )}
      </>
    );

    // ========================================================================
    // MÀN HÌNH BÁO CÁO SỰ CỐ ẨN DANH (KHÁCH QUÉT MÃ QR KHU VỰC)
    // ========================================================================
    if (isAnonymousReporting && anonymousArea) {
      if (anonymousReceipt) {
        return (
          <ScreenTransition transitionKey="GUEST_RECEIPT" style={{ flex: 1 }}>
            <SafeAreaView style={[styles.screenBg, { backgroundColor: '#F8FAFC' }]}>
              <ThemedStatusBar barStyle="dark-content" />
              <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center', justifyContent: 'center', minHeight: '100%' }}>
                <AnimatedBadgeEntrance delay={60}>
                  <View style={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: 16,
                    padding: 24,
                    width: '100%',
                    maxWidth: 480,
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: '#E2E8F0',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.08,
                    shadowRadius: 12,
                    elevation: 4,
                  }}>
                <View style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: '#ECFDF5',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                }}>
                  <Text style={{ fontSize: 36 }}>✅</Text>
                </View>

                <Text style={{ fontSize: 20, fontWeight: '800', color: '#0F172A', textAlign: 'center', marginBottom: 8 }}>
                  {translate('Tiếp nhận báo cáo thành công!')}
                </Text>

                <Text style={{ fontSize: 13.5, color: '#64748B', textAlign: 'center', lineHeight: 20, marginBottom: 20 }}>
                  {translate('Cảm ơn bạn đã hỗ trợ Ban quản lý phát hiện sự cố. Báo cáo của bạn đã được tiếp nhận và sẽ sớm được xử lý.')}
                </Text>

                <View style={{
                  width: '100%',
                  backgroundColor: '#F1F5F9',
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 20,
                  gap: 10,
                }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>{translate('Mã sự cố:')}</Text>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: '#2563EB' }}>{anonymousReceipt.ticketCode}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>{translate('Khu vực:')}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#0F172A', flex: 1, textAlign: 'right' }}>
                      {anonymousReceipt.areaName}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>{translate('Tòa nhà:')}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#334155' }}>
                      {anonymousReceipt.buildingName}
                    </Text>
                  </View>
                  <View style={{ borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 8, marginTop: 2 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>{translate('Trạng thái vị trí:')}</Text>
                      {anonymousReceipt.verificationStatus === 'VERIFIED' ? (
                        <View style={{ backgroundColor: '#ECFDF5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#A7F3D0' }}>
                          <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#059669' }}>📍 {translate('Đã xác minh vị trí')}</Text>
                        </View>
                      ) : (
                        <View style={{ backgroundColor: '#FFFBEB', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#FDE68A' }}>
                          <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#D97706' }}>⚠️ {translate('Chưa xác minh vị trí')}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontSize: 12, color: '#64748B', fontStyle: 'italic', lineHeight: 17 }}>
                      {anonymousReceipt.verificationReason}
                    </Text>
                  </View>
                  <View style={{ borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 8, marginTop: 2 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>{translate('Đánh giá AI:')}</Text>
                      <View style={{ backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#BFDBFE' }}>
                        <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#2563EB' }}>⏳ {translate('Đang phân tích')}</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 12, color: '#64748B', fontStyle: 'italic', lineHeight: 17 }}>
                      {translate('Hệ thống đang phân tích ảnh và mô tả sự cố trong nền.')}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={{
                    backgroundColor: '#2563EB',
                    width: '100%',
                    paddingVertical: 14,
                    borderRadius: 10,
                    alignItems: 'center',
                    marginBottom: 10,
                  }}
                  onPress={() => {
                    setIsAnonymousReporting(false);
                    setAnonymousArea(null);
                    setAnonymousReceipt(null);
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 15 }}>
                    {translate('Quay về trang đăng nhập')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1,
                    borderColor: '#CBD5E1',
                    width: '100%',
                    paddingVertical: 12,
                    borderRadius: 10,
                    alignItems: 'center',
                  }}
                  onPress={() => {
                    setAnonymousReceipt(null);
                    setGuestQrModalVisible(true);
                  }}
                >
                  <Text style={{ color: '#334155', fontWeight: '600', fontSize: 14 }}>
                    📷 {translate('Báo cáo sự cố khác (Quét QR)')}
                  </Text>
                </TouchableOpacity>
              </View>
            </AnimatedBadgeEntrance>
            </ScrollView>
            {renderAuthModals()}
          </SafeAreaView>
        </ScreenTransition>
      );
    }

    // Màn hình Form điền thông tin sự cố ẩn danh
    return (
      <ScreenTransition transitionKey="GUEST_FORM" style={{ flex: 1 }}>
        <SafeAreaView style={[styles.screenBg, { backgroundColor: '#F8FAFC' }]}>
          <ThemedStatusBar barStyle="dark-content" />
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 14,
            backgroundColor: '#FFFFFF',
            borderBottomWidth: 1,
            borderBottomColor: '#E2E8F0',
          }}>
            <TouchableOpacity
              onPress={() => {
                setIsAnonymousReporting(false);
                setAnonymousArea(null);
              }}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <Text style={{ fontSize: 18, color: '#2563EB', marginRight: 6 }}>←</Text>
              <Text style={{ fontSize: 14, color: '#2563EB', fontWeight: '600' }}>{translate('Đăng nhập')}</Text>
            </TouchableOpacity>

            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#0F172A' }}>
                {translate('Báo cáo sự cố ẩn danh')}
              </Text>
              <Text style={{ fontSize: 11, color: '#64748B' }}>
                {translate('Khách vãng lai (Không cần tài khoản)')}
              </Text>
            </View>

            <TouchableOpacity onPress={() => setGuestQrModalVisible(true)}>
              <Text style={{ fontSize: 13, color: '#059669', fontWeight: '700' }}>📷 {translate('Quét lại')}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
            {/* Card 1: Khu vực / Căn hộ đã quét mã QR */}
            <View style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 12,
              padding: 16,
              marginBottom: 14,
              borderWidth: 1,
              borderColor: '#E2E8F0',
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 16 }}>{anonymousArea.qrType === 'APARTMENT' ? '🏠' : '🏷️'}</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F172A' }}>
                    {translate(anonymousArea.qrType === 'APARTMENT' ? 'Khu vực Căn hộ (QR ResiFix)' : 'Khu vực chung (QR ResiFix)')}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ backgroundColor: anonymousArea.qrType === 'APARTMENT' ? '#EFF6FF' : '#F0FDF4', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: anonymousArea.qrType === 'APARTMENT' ? '#BFDBFE' : '#BBF7D0' }}>
                    <Text style={{ fontSize: 10.5, color: anonymousArea.qrType === 'APARTMENT' ? '#1D4ED8' : '#15803D', fontWeight: '700' }}>
                      {anonymousArea.qrType === 'APARTMENT' ? translate('QR Căn hộ') : translate('QR Khu vực chung')}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: '#ECFDF5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, color: '#059669', fontWeight: '700' }}>✓ {anonymousArea.qrCode}</Text>
                  </View>
                </View>
              </View>

              <Text style={{ fontSize: 16, fontWeight: '800', color: '#1E293B', marginBottom: 4 }}>
                {anonymousArea.areaName}
              </Text>
              <Text style={{ fontSize: 13, color: '#64748B', marginBottom: 6 }}>
                📍 {anonymousArea.locationLabel}
              </Text>
              <Text style={{ fontSize: 12, color: '#475569' }}>
                🏢 {translate('Tòa nhà:')} <Text style={{ fontWeight: '600' }}>{anonymousArea.buildingName}</Text>
                {anonymousArea.buildingBlock ? ` • ${anonymousArea.buildingBlock}` : ''}
                {anonymousArea.floor ? ` • ${String(anonymousArea.floor).startsWith('Tầng') ? anonymousArea.floor : `Tầng ${anonymousArea.floor}`}` : ''}
              </Text>
            </View>

            {/* Card 2: Bắt buộc xác định vị trí GPS (Chống báo cáo giả) */}
            <View
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 12,
                padding: 16,
                marginBottom: 14,
                borderWidth: 1.5,
                borderColor:
                  anonymousGpsStatus === 'ACQUIRED'
                    ? '#86EFAC'
                    : '#FCA5A5',
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 16 }}>📍</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F172A' }}>
                    {translate('Xác minh vị trí GPS thiết bị * (Bắt buộc)')}
                  </Text>
                </View>

                {anonymousGpsStatus === 'FETCHING' && (
                  <ActivityIndicator size="small" color="#2563EB" />
                )}
                {anonymousGpsStatus === 'ACQUIRED' && (
                  <View style={{ backgroundColor: '#ECFDF5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, color: '#059669', fontWeight: '700' }}>✓ {translate('Đã có tọa độ GPS')}</Text>
                  </View>
                )}
                {anonymousGpsStatus !== 'ACQUIRED' && anonymousGpsStatus !== 'FETCHING' && (
                  <View style={{ backgroundColor: '#FEF2F2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, color: '#DC2626', fontWeight: '700' }}>⚠️ {translate('Bắt buộc định vị')}</Text>
                  </View>
                )}
              </View>

              <Text style={{ fontSize: 12.5, color: '#475569', lineHeight: 18, marginBottom: 10 }}>
                {translate(
                  'Để chống báo cáo giả, khách vãng lai bắt buộc cấp quyền định vị GPS để hệ thống đối chiếu vị trí thực tế với tòa nhà.'
                )}
              </Text>

              {anonymousGpsStatus === 'FETCHING' && (
                <View style={{ backgroundColor: '#EFF6FF', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#BFDBFE', marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: '#1D4ED8' }}>
                    {translate('Đang lấy tọa độ GPS thực tế từ thiết bị...')}
                  </Text>
                </View>
              )}

              {anonymousGpsStatus === 'ACQUIRED' && anonymousLocationCoords && (
                <View style={{ backgroundColor: '#F0FDF4', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#BBF7D0', marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: '#166534', fontWeight: '700' }}>
                    ✓ {translate('Đã ghi nhận tọa độ:')} ({anonymousLocationCoords.latitude.toFixed(5)}, {anonymousLocationCoords.longitude.toFixed(5)})
                    {anonymousLocationCoords.accuracy ? ` • Sai số ±${anonymousLocationCoords.accuracy}m` : ''}
                  </Text>
                  {anonymousLocationCoords.accuracy > 100 && (
                    <Text style={{ fontSize: 11.5, color: '#B45309', marginTop: 4 }}>
                      ⚠️ {translate('Tín hiệu GPS trong nhà có sai số cao. Thông tin này sẽ được chuyển cho Ban quản lý xem xét khi xác minh.')}
                    </Text>
                  )}
                </View>
              )}

              {anonymousGpsStatus !== 'ACQUIRED' && anonymousGpsStatus !== 'FETCHING' && (
                <View style={{ backgroundColor: '#FEF2F2', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FECACA', marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: '#B91C1C', fontWeight: '600' }}>
                    {anonymousLocationError ||
                      translate('Chưa có tọa độ GPS thực tế. Bạn không thể hoàn tất gửi báo cáo nếu chưa bật định vị và cấp quyền vị trí.')}
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                {anonymousGpsStatus === 'BLOCKED' ? (
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      backgroundColor: '#FEF2F2',
                      paddingVertical: 10,
                      borderRadius: 8,
                      alignItems: 'center',
                      borderWidth: 1.5,
                      borderColor: '#F87171',
                    }}
                    onPress={() => Linking.openSettings()}
                  >
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#DC2626' }}>
                      ⚙️ {translate('Mở Cài đặt để bật Vị trí')}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      backgroundColor: anonymousGpsStatus === 'ACQUIRED' ? '#F0FDF4' : '#EFF6FF',
                      paddingVertical: 10,
                      borderRadius: 8,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: anonymousGpsStatus === 'ACQUIRED' ? '#BBF7D0' : '#BFDBFE',
                    }}
                    onPress={() => requestGuestLocation(true)}
                    disabled={anonymousGpsStatus === 'FETCHING'}
                  >
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: anonymousGpsStatus === 'ACQUIRED' ? '#15803D' : '#1D4ED8' }}>
                      {anonymousGpsStatus === 'ACQUIRED' ? `🔄 ${translate('Lấy lại vị trí GPS')}` : `📍 ${translate('Cấp quyền & Lấy vị trí GPS ngay')}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Card 3: Form nhập mô tả và chụp ảnh trực tiếp bằng Camera */}
            <View style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 12,
              padding: 16,
              marginBottom: 14,
              borderWidth: 1,
              borderColor: '#E2E8F0',
            }}>
              <Text style={styles.fieldLabel}>{translate('Tiêu đề sự cố (Tùy chọn)')}</Text>
              <TextInput
                style={[styles.technicianFormInput, { marginBottom: 14 }]}
                value={anonymousTitle}
                onChangeText={setAnonymousTitle}
                placeholder={translate('Ví dụ: Đèn hành lang bị chập, Rò rỉ nước...')}
                placeholderTextColor="#94A3B8"
              />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <Text style={styles.fieldLabel}>{translate('Mô tả chi tiết sự cố *')}</Text>
                <Text style={{ fontSize: 11, color: anonymousDesc.trim().length >= 10 ? '#059669' : '#DC2626' }}>
                  {anonymousDesc.trim().length}/10 {translate('ký tự tối thiểu')}
                </Text>
              </View>
              <Text style={{ fontSize: 11.5, color: '#64748B', marginBottom: 6, fontStyle: 'italic' }}>
                {translate('Gợi ý: Thiết bị nào gặp sự cố? Xảy ra khi nào? Ảnh hưởng ra sao?')}
              </Text>

              <TextInput
                style={[styles.descTextArea, { minHeight: 90 }]}
                value={anonymousDesc}
                onChangeText={setAnonymousDesc}
                placeholder={translate('Thiết bị nào gặp sự cố? Xảy ra khi nào? Ảnh hưởng ra sao? (Có thể bấm "Nhấn để nói" bên dưới...)')}
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={4}
              />

              <View style={{ marginTop: 10, marginBottom: 16 }}>
                <VoiceRecorderButton
                  apiBaseUrl={API_BASE_URL}
                  token={null}
                  disabled={loading}
                  onBusyChange={setAnonymousVoiceBusy}
                  onTranscribed={(text) => {
                    setAnonymousDesc((prev) => (prev.trimEnd() ? `${prev.trimEnd()} ${text}` : text));
                    setAnonymousIsVoiceUsed(true);
                  }}
                />
              </View>

              <View style={{ borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={styles.fieldLabel}>{translate('Ảnh chụp trực tiếp bằng Camera * (Bắt buộc 1-3 ảnh)')}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: anonymousPhotos.length > 0 ? '#059669' : '#DC2626' }}>
                    {anonymousPhotos.length}/3
                  </Text>
                </View>
                <Text style={{ fontSize: 11.5, color: '#64748B', marginBottom: 10 }}>
                  📷 {translate('Chỉ chấp nhận ảnh chụp trực tiếp từ Camera thiết bị tại hiện trường (không tải từ Album).')}
                </Text>

                {anonymousPhotos.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                    {anonymousPhotos.map((url, idx) => (
                      <View key={idx} style={{ width: 96, alignItems: 'center' }}>
                        <View style={{ position: 'relative', width: 96, height: 96, borderRadius: 10, overflow: 'hidden', borderWidth: 1.5, borderColor: '#86EFAC' }}>
                          <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} />
                          <TouchableOpacity
                            style={{
                              position: 'absolute',
                              top: 4,
                              right: 4,
                              backgroundColor: 'rgba(220,38,38,0.85)',
                              width: 22,
                              height: 22,
                              borderRadius: 11,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            onPress={() => setAnonymousPhotos((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity
                          style={{ marginTop: 4, backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#BFDBFE' }}
                          onPress={() => handlePickAnonymousPhoto(true, idx)}
                          disabled={anonymousUploading}
                        >
                          <Text style={{ fontSize: 10.5, fontWeight: '700', color: '#1D4ED8' }}>🔄 {translate('Chụp lại')}</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {anonymousPhotoCapturedAt && anonymousPhotos.length > 0 && (
                  <Text style={{ fontSize: 11, color: '#059669', marginBottom: 10, fontWeight: '600' }}>
                    🕒 {translate('Thời gian chụp:')} {formatDateTime(anonymousPhotoCapturedAt)}
                  </Text>
                )}

                {anonymousUploading && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <ActivityIndicator size="small" color="#2563EB" />
                    <Text style={{ fontSize: 12, color: '#2563EB' }}>{translate('Đang kiểm tra và tải ảnh chụp lên...')}</Text>
                  </View>
                )}

                {anonymousPhotos.length < 3 && (
                  <TouchableOpacity
                    style={{
                      backgroundColor: '#EFF6FF',
                      borderWidth: 1.5,
                      borderColor: '#3B82F6',
                      borderStyle: 'dashed',
                      paddingVertical: 12,
                      borderRadius: 10,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                    onPress={() => handlePickAnonymousPhoto(true)}
                    disabled={anonymousUploading}
                  >
                    <Text style={{ fontSize: 18 }}>📷</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#1D4ED8' }}>
                      {translate(anonymousPhotos.length === 0 ? 'Mở Camera chụp ảnh sự cố' : 'Chụp thêm ảnh hiện trường')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <View style={{
              backgroundColor: '#EFF6FF',
              borderRadius: 10,
              padding: 12,
              borderWidth: 1,
              borderColor: '#BFDBFE',
              marginBottom: 16,
            }}>
              <Text style={{ fontSize: 12, color: '#1E40AF', lineHeight: 18 }}>
                🛡️ {translate('Báo cáo khách vãng lai sau khi gửi sẽ ở trạng thái Chờ Ban quản lý (BMB) xác minh vị trí GPS và hình ảnh Camera trước khi phân công Kỹ thuật viên.')}
              </Text>
            </View>
          </ScrollView>

          {/* Sticky Bottom Bar */}
          <View style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: '#FFFFFF',
            borderTopWidth: 1,
            borderTopColor: '#E2E8F0',
            paddingHorizontal: 16,
            paddingVertical: 12,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.05,
            shadowRadius: 4,
            elevation: 4,
          }}>
            <TouchableOpacity
              style={[
                styles.loginSubmitBtn,
                (loading || anonymousVoiceBusy || anonymousUploading || anonymousDesc.trim().length < 10 || anonymousPhotos.length === 0 || anonymousGpsStatus !== 'ACQUIRED') && { opacity: 0.6 },
              ]}
              onPress={handleGuestSubmitReport}
              disabled={loading || anonymousVoiceBusy || anonymousUploading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.loginSubmitText}>
                  🚀 {translate('Gửi báo cáo sự cố (Ẩn danh)')}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {renderAuthModals()}
        </SafeAreaView>
      </ScreenTransition>
    );
  }

    // A. Giao diện Đăng nhập Ban Quản Lý BMB Web (Split-Card 2 cột chuẩn Figma 00 BMB)
    if (loginMode === 'BMB_WEB') {
      return (
        <ScreenTransition transitionKey="BMB_WEB" style={{ flex: 1 }}>
          <SafeAreaView style={styles.bmbLoginOuterBg}>
            <View style={styles.bmbLoginSplitCard}>
              {/* Cột trái màu xanh dương đậm */}
              <View style={styles.bmbLoginLeftBlue}>
                <View>
                  <View style={styles.rowCenter}>
                    <View style={{ marginRight: 10 }}><ResiFixLogoMark size={30} /></View>
                    <View>
                      <Text style={styles.bmbLoginBrandText}>ResiFix BMB</Text>
                      <Text style={{ fontSize: 11, color: '#93C5FD', fontWeight: '600', letterSpacing: 0.5 }}>ENTERPRISE CLOUD</Text>
                    </View>
                  </View>
                  <Text style={styles.bmbLoginHeroTitle}>
                    {translate("Hệ thống Quản lý & Điều phối Sự cố Tòa nhà Thông minh")}
                  </Text>
                  <Text style={{ fontSize: 13, color: '#BFDBFE', marginTop: 8, lineHeight: 20 }}>
                    {translate("Giải pháp tự động hóa vận hành, kiểm soát SLA và quản lý chi phí toàn diện.")}
                  </Text>

                  {/* 3 bullet feature badges */}
                  <View style={{ marginTop: 24, gap: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>✓</Text>
                      </View>
                      <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '500' }}>
                        {translate("Tối ưu phân công sự cố tự động bằng Gemini AI")}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>✓</Text>
                      </View>
                      <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '500' }}>
                        {translate("Giám sát chấm công GPS & ảnh chống gian lận")}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>✓</Text>
                      </View>
                      <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '500' }}>
                        {translate("Minh bạch bảng lương, tăng ca và chi phí vận hành")}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={{ marginTop: 32, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)', paddingTop: 14 }}>
                  <Text style={{ color: '#93C5FD', fontSize: 11 }}>
                    ResiFix Enterprise Platform • v2.4.0 • 2026
                  </Text>
                </View>
              </View>

              {/* Cột phải màu trắng */}
              <View style={styles.bmbLoginRightWhite}>
                <Text style={styles.bmbLoginFormHeading}>{translate("Đăng nhập")}</Text>
                <Text style={[styles.loginCardSub, { marginBottom: 16 }]}>
                  {translate("Hệ thống tự động nhận diện vai trò Ban Quản Lý (BMB), Kỹ thuật viên hoặc Cư dân.")}
                </Text>

                {toastMsg && (
                  <View style={[styles.toastBanner, { marginHorizontal: 0, marginBottom: 12 }]}>
                    <Text style={styles.toastText}>{toastMsg}</Text>
                  </View>
                )}

                <Text style={styles.fieldLabel}>{translate("Email hoặc Số điện thoại công vụ *")}</Text>
                <TextInput
                  style={styles.bmbWebInput}
                  value={phoneInput}
                  onChangeText={(val) => {
                    setLoginFieldErrors((prev) => ({ ...prev, identifier: undefined }));
                    setPhoneInput(val);
                  }}
                  placeholder="myhanh.bmb@resifix.vn"
                  placeholderTextColor="#94A3B8"
                />
                {loginFieldErrors.identifier ? (
                  <Text style={[styles.technicianFormError, { marginTop: 4, marginBottom: 8 }]}>
                    {loginFieldErrors.identifier}
                  </Text>
                ) : null}

                <Text style={styles.fieldLabel}>{translate("Mật khẩu *")}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', position: 'relative' }}>
                  <TextInput
                    style={[styles.bmbWebInput, { flex: 1, paddingRight: 48 }]}
                    value={passwordInput}
                    onChangeText={(val) => {
                      setLoginFieldErrors((prev) => ({ ...prev, password: undefined }));
                      setPasswordInput(val);
                    }}
                    secureTextEntry={!showBmbWebPassword}
                    placeholder="••••••••••"
                    placeholderTextColor="#94A3B8"
                  />
                  <TouchableOpacity
                    onPress={() => setShowBmbWebPassword(!showBmbWebPassword)}
                    style={{ position: 'absolute', right: 12, padding: 6 }}
                  >
                    <Text style={{ fontSize: 12, color: '#64748B', fontWeight: '600' }}>
                      {showBmbWebPassword ? translate('Ẩn') : translate('Hiện')}
                    </Text>
                  </TouchableOpacity>
                </View>
                {loginFieldErrors.password ? (
                  <Text style={[styles.technicianFormError, { marginTop: 4, marginBottom: 8 }]}>
                    {loginFieldErrors.password}
                  </Text>
                ) : null}

                <View style={[styles.rowBetween, { marginTop: 14, marginBottom: 16 }]}>
                  <TouchableOpacity
                    style={styles.checkboxRow}
                    onPress={() => setRememberMe(!rememberMe)}
                  >
                    <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                      {rememberMe && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                    <Text style={styles.rememberText}>{translate("Duy trì đăng nhập")}</Text>
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', gap: 14 }}>
                    <TouchableOpacity
                      onPress={() => {
                        setForgotStep(1);
                        setForgotEmail(phoneInput.includes('@') ? phoneInput : '');
                        setForgotOtp('');
                        setForgotNewPassword('');
                        setForgotConfirmPassword('');
                        setShowForgotModal(true);
                      }}
                    >
                      <Text style={styles.forgotText}>{translate("Quên mật khẩu?")}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        setActivationRole(null);
                        setActivationFullName('');
                        setActivationEmail(phoneInput.includes('@') ? phoneInput.trim().toLowerCase() : '');
                        setActivationOtp('');
                        setActivationNewPassword('');
                        setActivationConfirmPassword('');
                        setActivationError(null);
                        setActivationFieldErrors({});
                        setActivationCooldown(0);
                        setActivationBusy(false);
                        setActivationOtpStatus('IDLE');
                        setShowActivationModal(true);
                      }}
                    >
                      <Text style={[styles.forgotText, { color: '#0284C7' }]}>
                        {translate("Kích hoạt tài khoản")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

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

                {/* Lựa chọn Quét QR báo sự cố cho Khách vãng lai (Không cần tài khoản) */}
                <View style={{ marginTop: 14, alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 6, width: '100%' }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: '#E2E8F0' }} />
                    <Text style={{ marginHorizontal: 8, color: '#94A3B8', fontSize: 11, fontWeight: '600' }}>
                      {translate('HOẶC')}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: '#E2E8F0' }} />
                  </View>
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#ECFDF5',
                      borderWidth: 1.5,
                      borderColor: '#10B981',
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 10,
                      width: '100%',
                    }}
                    onPress={() => setGuestQrModalVisible(true)}
                  >
                    <Text style={{ fontSize: 16, marginRight: 6 }}>📷</Text>
                    <Text style={{ color: '#047857', fontWeight: '700', fontSize: 13.5 }}>
                      {translate('Quét mã QR khu vực báo sự cố (Khách vãng lai)')}
                    </Text>
                  </TouchableOpacity>
                  <Text style={{ fontSize: 11, color: '#64748B', marginTop: 4, textAlign: 'center' }}>
                    {translate('Không cần đăng nhập • Tự động nhận diện khu vực tòa nhà')}
                  </Text>
                </View>

                {/* Chuyển đổi linh hoạt giữa giao diện Web và Mobile khi thử nghiệm trên trình duyệt */}
                <View style={[styles.demoSwitchRow, { justifyContent: 'center', marginTop: 20 }]}>
                  <TouchableOpacity
                    style={[styles.demoChip, { paddingHorizontal: 16, paddingVertical: 8 }]}
                    onPress={() => {
                      setLoginMode('MOBILE');
                    }}
                  >
                    <Text style={styles.demoChipText}>📱 {translate("Chuyển sang giao diện Mobile App")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            {renderAuthModals()}
          </SafeAreaView>
        </ScreenTransition>
      );
    }

    // B. Giao diện Đăng nhập Mobile App (Cư dân & Kỹ thuật viên chuẩn Figma 00 Mobile)
    return (
      <ScreenTransition transitionKey="MOBILE" style={{ flex: 1 }}>
        <SafeAreaView style={styles.screenBg}>
          <ThemedStatusBar barStyle="dark-content" />
          <ScrollView contentContainerStyle={styles.loginScroll}>
            <View style={styles.mobileFrame}>
              <StaggeredCardEntrance index={0}>
                <View style={styles.brandCenter}>
                  <ResiFixLogoMark size={60} />
                  <Text style={styles.brandTitle}>ResiFix</Text>
                  <Text style={styles.brandSub}>
                    {translate("Hệ thống Quản lý & Khắc phục Sự cố Tòa nhà")}</Text>
                  <View style={styles.geminiBadgePill}>
                    <Text style={styles.geminiBadgeText}>{translate("Trợ lý Gemini AI hỗ trợ")}</Text>
                  </View>
                </View>
              </StaggeredCardEntrance>

              {toastMsg && (
                <View style={styles.toastBanner}>
                  <Text style={styles.toastText}>{toastMsg}</Text>
                </View>
              )}

              <StaggeredCardEntrance index={1}>
                <View style={styles.loginCard}>
                <Text style={styles.loginCardTitle}>{translate("Đăng nhập tài khoản")}</Text>

                <Text style={styles.loginCardSub}>
                  {translate("Nhập Số điện thoại hoặc Email. Hệ thống tự động nhận diện vai trò Cư dân, Kỹ thuật viên hoặc Ban Quản Lý.")}
                </Text>

                <Text style={styles.fieldLabel}>{translate("Số điện thoại hoặc Email *")}</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInputField}
                    value={phoneInput}
                    onChangeText={(val) => {
                      setLoginFieldErrors((prev) => ({ ...prev, identifier: undefined }));
                      setPhoneInput(val);
                    }}
                    placeholder="0905 xxx xxx hoặc email@domain.com"
                    placeholderTextColor="#94A3B8"
                    autoCapitalize="none"
                  />
                </View>
                {loginFieldErrors.identifier ? (
                  <Text style={[styles.technicianFormError, { marginTop: 4, marginBottom: 8 }]}>
                    {loginFieldErrors.identifier}
                  </Text>
                ) : null}

                <Text style={styles.fieldLabel}>{translate("Mật khẩu *")}</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInputField}
                    value={passwordInput}
                    onChangeText={(val) => {
                      setLoginFieldErrors((prev) => ({ ...prev, password: undefined }));
                      setPasswordInput(val);
                    }}
                    secureTextEntry={!showPassword}
                    placeholder="••••••••"
                    placeholderTextColor="#94A3B8"
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={{ paddingHorizontal: 6 }}>
                    <Text style={styles.eyeIconText}>{showPassword ? translate('Ẩn') : translate('Hiện')}</Text>
                  </TouchableOpacity>
                </View>
                {loginFieldErrors.password ? (
                  <Text style={[styles.technicianFormError, { marginTop: 4, marginBottom: 8 }]}>
                    {loginFieldErrors.password}
                  </Text>
                ) : null}

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
                    onPress={() => {
                      setForgotStep(1);
                      setForgotEmail(phoneInput.includes('@') ? phoneInput : '');
                      setForgotOtp('');
                      setForgotNewPassword('');
                      setForgotConfirmPassword('');
                      setShowForgotModal(true);
                    }}
                  >
                    <Text style={styles.forgotText}>{translate("Quên mật khẩu?")}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={() => {
                    setActivationRole(null);
                    setActivationFullName('');
                    setActivationEmail(phoneInput.includes('@') ? phoneInput.trim().toLowerCase() : '');
                    setActivationOtp('');
                    setActivationNewPassword('');
                    setActivationConfirmPassword('');
                    setActivationError(null);
                    setActivationFieldErrors({});
                    setActivationCooldown(0);
                    setActivationBusy(false);
                    setActivationOtpStatus('IDLE');
                    setShowActivationModal(true);
                  }}
                  style={{ marginTop: 2, marginBottom: 16, alignItems: 'center' }}
                >
                  <Text style={[styles.forgotText, { color: '#0284C7', fontWeight: '600' }]}>
                    {translate("Chưa kích hoạt tài khoản? Kích hoạt bằng mã OTP")}
                  </Text>
                </TouchableOpacity>

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

                {/* Lựa chọn Quét QR báo sự cố cho Khách vãng lai (Không cần tài khoản) */}
                <View style={{ marginTop: 16, alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8, width: '100%' }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: '#E2E8F0' }} />
                    <Text style={{ marginHorizontal: 10, color: '#94A3B8', fontSize: 12, fontWeight: '600' }}>
                      {translate('HOẶC')}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: '#E2E8F0' }} />
                  </View>
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#ECFDF5',
                      borderWidth: 1.5,
                      borderColor: '#10B981',
                      paddingVertical: 12,
                      paddingHorizontal: 16,
                      borderRadius: 10,
                      width: '100%',
                      shadowColor: '#10B981',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.1,
                      shadowRadius: 4,
                      elevation: 2,
                    }}
                    onPress={() => setGuestQrModalVisible(true)}
                  >
                    <Text style={{ fontSize: 18, marginRight: 8 }}>📷</Text>
                    <Text style={{ color: '#047857', fontWeight: '700', fontSize: 14 }}>
                      {translate('Quét mã QR khu vực báo sự cố (Khách vãng lai)')}
                    </Text>
                  </TouchableOpacity>
                  <Text style={{ fontSize: 11.5, color: '#64748B', marginTop: 6, textAlign: 'center' }}>
                    {translate('Không cần đăng nhập • Tự động nhận diện khu vực tòa nhà')}
                  </Text>
                </View>
              </View>
            </StaggeredCardEntrance>

              {Platform.OS === 'web' && (
                <View style={[styles.demoSwitchRow, { justifyContent: 'center', marginTop: 16 }]}>
                  <TouchableOpacity
                    style={[styles.demoChip, { paddingHorizontal: 16, paddingVertical: 8 }]}
                    onPress={() => setLoginMode('BMB_WEB')}
                  >
                    <Text style={styles.demoChipText}>🖥️ {translate("Chuyển sang giao diện BMB Web")}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>
          {renderAuthModals()}
        </SafeAreaView>
      </ScreenTransition>
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

          <ScreenTransition transitionKey={resScreen} style={{ flex: 1 }}>
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
                      Căn hộ {user.apartmentCode || '---'} • {user.buildingBlock || '---'}
                    </Text>
                  </View>
                  <View style={styles.rowCenter}>
                    <RealTimeClock style={{ marginRight: 8 }} />
                    <TouchableOpacity
                      style={styles.bellCircleBtn}
                      onPress={() => setResScreen('NOTI_PROFILE')}
                    >
                      <OutlineIcon name="bell" size={21} color="#0F172A" />
                      {unreadCount > 0 && <View style={styles.bellRedDot} />}
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Thẻ Liên hệ Quản lý Khẩn cấp */}
                <StaggeredCardEntrance index={0}>
                  <View style={styles.emergencyCard}>
                    <View style={styles.rowCenter}>
                      <View style={styles.emergencyIconCircle}>
                        <OutlineIcon name="bell" size={16} color="#DC2626" />
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.emergencyTitle}>{translate('Liên hệ quản lý khẩn cấp')}</Text>
                        <Text style={styles.emergencyContactName}>
                          {emergencyContact.managerName} – {emergencyContact.managerPhone}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.emergencyCallBtn}
                        onPress={() => Linking.openURL(`tel:${emergencyContact.managerPhone}`)}
                      >
                        <Text style={styles.emergencyCallBtnText}>{translate('Gọi ngay')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </StaggeredCardEntrance>

                <StaggeredCardEntrance index={1}>
                  <View style={styles.ctaHeroCard}>
                    <View style={styles.ctaTitleRow}>
                      <Text style={styles.ctaHeroTitle}>{translate("Cần sửa chữa thiết bị trong căn hộ?")}</Text>
                    </View>
                    <Text style={styles.ctaHeroDesc}>
                      {translate("Chụp ảnh hoặc quét mã QR để Ban Quản Lý tiếp nhận và cử thợ đến hỗ trợ nhanh chóng.")}
                    </Text>
                    <TouchableOpacity
                      style={styles.ctaPrimaryBtn}
                      onPress={() => setResScreen('CREATE_REPORT')}
                    >
                      <Text style={styles.ctaPrimaryBtnText}>📸 {translate("+ Gửi yêu cầu sửa chữa mới")}</Text>
                    </TouchableOpacity>

                    {/* Thanh tiến trình 4 bước đơn giản, thân thiện với người không biết IT */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(37, 99, 235, 0.15)' }}>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#2563EB' }}>1. {translate("Gửi ảnh")}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: '#93C5FD' }}>→</Text>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#2563EB' }}>2. {translate("Tiếp nhận")}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: '#93C5FD' }}>→</Text>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#2563EB' }}>3. {translate("Sửa chữa")}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: '#93C5FD' }}>→</Text>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#2563EB' }}>4. {translate("Nghiệm thu")}</Text>
                      </View>
                    </View>
                  </View>
                </StaggeredCardEntrance>

                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitleText}>{translate("Yêu cầu sửa chữa của tôi")}</Text>
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

                {filteredHomeTickets.map((t, idx) => {
                  const isCompleted = t.status === 'COMPLETED';
                  const isPending = t.status === 'PENDING';
                  const isClosed = t.status === 'CLOSED';
                  return (
                    <StaggeredCardEntrance key={t.id} index={idx}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        style={[
                          styles.resTicketCard,
                          isCompleted && styles.resTicketCardCompleted,
                        ]}
                        onPress={() => openResidentTicket(t)}
                      >
                      <View style={styles.cardTopRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                          <Text style={styles.cardCodeText}>{t.ticketCode}</Text>
                          {t.isAnonymous && (
                            <View style={{ backgroundColor: '#F1F5F9', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#CBD5E1' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#475569' }}>👤 {translate('Ẩn danh')}</Text>
                            </View>
                          )}
                          {t.locationVerificationStatus === 'VERIFIED' ? (
                            <View style={{ backgroundColor: '#ECFDF5', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#A7F3D0' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#059669' }}>📍 {translate('Đã xác minh vị trí')}</Text>
                            </View>
                          ) : t.locationVerificationStatus === 'UNVERIFIED' ? (
                            <View style={{ backgroundColor: '#FFFBEB', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#FDE68A' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#D97706' }}>⚠️ {translate('Chưa xác minh vị trí')}</Text>
                            </View>
                          ) : null}
                        </View>
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
                      <Text style={styles.cardLocationText}>{t.locationNote}</Text>

                      {isCompleted ? (
                        <View style={styles.completedActionBar}>
                          <Text style={styles.completedActionLabel}>
                            {translate("KTV đã gửi ảnh nghiệm thu")}</Text>
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
                            KTV: {t.assignedTech?.fullName || translate('Chưa phân công')} • {translate('15 phút trước')}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </StaggeredCardEntrance>
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
                    <Text style={styles.subScreenTitle}>{translate("Gửi yêu cầu sửa chữa")}</Text>
                  </View>

                  <Text style={styles.stepTitle}>{translate("1. Vị trí & Khu vực gặp sự cố *")}</Text>
                  <Text style={[styles.cardLocationText, { marginTop: -4, marginBottom: 8 }]}>
                    {translate("Quét mã QR dán tại thiết bị hoặc khu vực để xác nhận vị trí chính xác.")}
                  </Text>
                  <TouchableOpacity
                    style={styles.qrDashedBtn}
                    onPress={() => setQrModalVisible(true)}
                  >
                    <Text style={styles.qrDashedBtnText}>
                      {translate("📷 Quét mã QR khu vực để tự động điền vị trí")}</Text>
                  </TouchableOpacity>

                  {qrModalVisible && (
                    <QrScannerModal
                      visible
                      onClose={() => setQrModalVisible(false)}
                      onScannedCode={handleQrCodeDetected}
                    />
                  )}

                  {!scannedAsset && (
                    <TextInput style={styles.technicianFormInput} value={manualLocation} onChangeText={setManualLocation}
                      placeholder={translate("Nhập vị trí sự cố")} />
                  )}
                  {scannedAsset && (
                    <View style={styles.qrRecognizedBox}>
                      <Text style={styles.qrRecognizedTitle}>
                        {translate("✅ Đã xác định khu vực: ")}{scannedAsset.areaName || scannedAsset.assetName}
                      </Text>
                      <Text style={styles.qrRecognizedSub}>
                        {translate("📍 Vị trí: ")}{scannedAsset.locationLabel}
                      </Text>
                      <TouchableOpacity onPress={() => setScannedAsset(null)} style={{ marginTop: 4 }}>
                        <Text style={styles.seeHistoryLink}>{translate('Bỏ thiết bị đã chọn')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <Text style={styles.stepTitle}>{translate("2. Hình ảnh hiện trường (Tối đa 3 ảnh)")}</Text>
                  <Text style={[styles.cardLocationText, { marginTop: -4, marginBottom: 8 }]}>
                    {translate("Chụp rõ vị trí hư hỏng để kỹ thuật viên chuẩn bị sẵn linh kiện và đồ nghề.")}
                  </Text>
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
                                  ? `${scannedAsset.areaName || scannedAsset.assetName} (${prev.length + 1})`
                                  : `Ảnh hiện trường ${prev.length + 1}`,
                                url: uploadedUrl,
                              },
                            ]);
                            showToast(translate('Đã đính kèm ảnh hiện trường thành công!'));
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

                  <Text style={styles.stepTitle}>{translate("3. Mô tả chi tiết sự cố *")}</Text>
                  <Text style={[styles.cardLocationText, { marginTop: -4, marginBottom: 8 }]}>
                    {translate("Gợi ý: Thiết bị nào gặp sự cố? Xảy ra khi nào? Ảnh hưởng ra sao? (Ảnh và mô tả chi tiết là tùy chọn)")}
                  </Text>
                  <View style={styles.descBoxContainer}>
                    <TextInput
                      style={styles.descTextArea}
                      multiline
                      value={reportDesc}
                      onChangeText={setReportDesc}
                      placeholder={translate("Thiết bị nào gặp sự cố? Xảy ra khi nào? Ảnh hưởng ra sao?")}
                    />
                    <Text
                      style={[
                        styles.charCountText,
                        reportDesc.trim().length < 10 && { color: '#DC2626' },
                      ]}
                    >
                      {reportDesc.length} {translate("ký tự (Đạt chuẩn tối thiểu 10 ký tự)")}</Text>
                    <VoiceRecorderButton
                      apiBaseUrl={API_BASE_URL}
                      token={token}
                      disabled={loading}
                      onBusyChange={setReportVoiceBusy}
                      onTranscribed={(text) => {
                        setReportDesc(previous => previous.trimEnd() ? `${previous.trimEnd()} ${text}` : text);
                        setIsVoiceUsed(true);
                      }}
                    />
                  </View>
                  {reportDesc.length > 0 && reportDesc.trim().length < 10 && (
                    <Text style={[styles.inlineFieldError, { marginTop: -8, marginBottom: 12 }]}>
                      {translate('Mô tả sự cố cần tối thiểu 10 ký tự!')}
                    </Text>
                  )}

                  <View style={styles.geminiInfoBox}>
                    <Text style={styles.geminiInfoText}>
                      {translate("Trợ lý AI sẽ tự động phân loại danh mục & đánh giá độ khẩn cấp sự cố.")}</Text>
                  </View>
                </ScrollView>

                <View style={styles.stickyBottomBar}>
                  <TouchableOpacity
                    style={[styles.loginSubmitBtn, (loading || reportVoiceBusy || reportDesc.trim().length < 10) && { opacity: 0.6 }]}
                    onPress={handleSubmitReport}
                    disabled={loading || reportVoiceBusy || reportDesc.trim().length < 10}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={styles.loginSubmitText}>🚀 {translate("Gửi yêu cầu sửa chữa ngay")}</Text>
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
<View
                      style={[
                        styles.statusPill,
                        {
                          backgroundColor:
                            activeTicket.status === 'CLOSED'
                              ? '#E2E8F0'
                              : activeTicket.status === 'COMPLETED'
                                ? '#D1FAE5'
                                : activeTicket.status === 'PENDING'
                                  ? '#FEF3C7'
                                  : activeTicket.status === 'ASSIGNED'
                                    ? '#DBEAFE'
                                    : '#E0E7FF',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          {
                            color:
                              activeTicket.status === 'CLOSED'
                                ? '#475569'
                                : activeTicket.status === 'COMPLETED'
                                  ? '#059669'
                                  : activeTicket.status === 'PENDING'
                                    ? '#B45309'
                                    : activeTicket.status === 'ASSIGNED'
                                      ? '#1D4ED8'
                                      : '#4338CA',
                          },
                        ]}
                      >
                        {activeTicket.status === 'CLOSED'
                          ? translate('Đã đóng')
                          : activeTicket.status === 'COMPLETED'
                            ? translate('Chờ nghiệm thu')
                            : activeTicket.status === 'PENDING'
                              ? translate('Chờ duyệt')
                              : activeTicket.status === 'ASSIGNED'
                                ? translate('Đã phân công')
                                : translate('Đang xử lý')}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.whiteSectionCard}>
                    <Text style={[styles.cardMainTitle, { marginBottom: 4 }]}>{activeTicket.title}</Text>
                    {activeTicket.locationNote ? (
                      <Text style={styles.cardLocationText}>📍 {activeTicket.locationNote}</Text>
                    ) : null}
                    {emergencyContact?.managerPhone ? (
                      <TouchableOpacity
                        style={{
                          marginTop: 10,
                          alignSelf: 'flex-start',
                          backgroundColor: '#EFF6FF',
                          borderWidth: 1,
                          borderColor: '#BFDBFE',
                          borderRadius: 8,
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                        }}
                        onPress={() => void Linking.openURL(`tel:${emergencyContact.managerPhone}`)}
                      >
                        <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#1D4ED8' }}>
                          📞 {translate('Liên hệ BMB')}: {emergencyContact.managerName} • {emergencyContact.managerPhone}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  {renderIncidentProgressTimeline(activeTicket, 'RESIDENT')}

                  {/* Mục Ảnh hiện trường do Cư dân gửi */}
                  {(() => {
                    const reportedPhotos = getResidentReportedMedia(activeTicket);
                    return (
                      <View style={styles.whiteSectionCard}>
                        <View style={[styles.cardTopRow, { marginBottom: 8 }]}>
                          <Text style={styles.cardBlockTitle}>{translate("Ảnh hiện trường")}</Text>
                          {reportedPhotos.length > 0 && (
                            <View style={[styles.statusPill, { backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 2 }]}>
                              <Text style={[styles.statusPillText, { color: '#2563EB', fontWeight: '700', fontSize: 11.5 }]}>
                                {reportedPhotos.length} {translate("ảnh")}
                              </Text>
                            </View>
                          )}
                        </View>
                        {reportedPhotos.length === 0 ? (
                          <View style={{
                            backgroundColor: '#F8FAFC',
                            borderWidth: 1,
                            borderColor: '#E2E8F0',
                            borderRadius: 8,
                            paddingVertical: 12,
                            paddingHorizontal: 14,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                          }}>
                            <Text style={{ fontSize: 18 }}>📷</Text>
                            <Text style={{ fontSize: 13, color: '#64748B', fontStyle: 'italic' }}>
                              {translate("Chưa có ảnh hiện trường.")}
                            </Text>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                            {reportedPhotos.map((item, idx) => (
                              <TouchableOpacity
                                key={item.id || idx}
                                style={{
                                  width: 80,
                                  height: 80,
                                  borderRadius: 8,
                                  borderWidth: 1.5,
                                  borderColor: '#CBD5E1',
                                  overflow: 'hidden',
                                  backgroundColor: '#F1F5F9',
                                  position: 'relative',
                                }}
                                activeOpacity={0.8}
                                onPress={() => openReportedPhoto(reportedPhotos, idx)}
                              >
                                {failedPhotoUrls[item.url] ? (
                                  <View style={{ flex: 1, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', padding: 4 }}>
                                    <Text style={{ fontSize: 16 }}>⚠️</Text>
                                    <Text style={{ fontSize: 9, color: '#DC2626', textAlign: 'center', fontWeight: '600' }}>
                                      {translate("Lỗi tải ảnh")}
                                    </Text>
                                  </View>
                                ) : (
                                  <Image
                                    source={{ uri: item.url }}
                                    style={{ width: '100%', height: '100%' }}
                                    resizeMode="cover"
                                    onError={() => setFailedPhotoUrls((prev) => ({ ...prev, [item.url]: true }))}
                                  />
                                )}
                                <View style={{
                                  position: 'absolute',
                                  bottom: 3,
                                  right: 3,
                                  backgroundColor: 'rgba(15, 23, 42, 0.72)',
                                  borderRadius: 4,
                                  paddingHorizontal: 4,
                                  paddingVertical: 1,
                                }}>
                                  <Text style={{ color: '#FFFFFF', fontSize: 9.5, fontWeight: '700' }}>
                                    🔍 {idx + 1}
                                  </Text>
                                </View>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </View>
                    );
                  })()}

                  <View style={styles.proofGreenBorderCard}>
                    <Text style={styles.cardBlockTitle}>
                      {translate("Bằng chứng khắc phục từ Kỹ thuật viên")}</Text>
                    <View style={styles.proofCompareRow}>
                      <View style={styles.proofHalfCol}>
                        <View style={styles.proofBoxBefore}>
                          {(() => {
                            const scenePhotos = getResidentReportedMedia(activeTicket);
                            return scenePhotos[0]?.url ? (
                              <TouchableOpacity
                                style={{ width: '100%', height: '100%' }}
                                activeOpacity={0.8}
                                onPress={() => openReportedPhoto(scenePhotos, 0)}
                              >
                                <Image
                                  source={{ uri: scenePhotos[0].url }}
                                  style={{ width: '100%', height: '100%', borderRadius: 10 }}
                                  resizeMode="cover"
                                />
                              </TouchableOpacity>
                            ) : (
                              <Text style={styles.proofPlaceholderText}>{translate('Chưa có ảnh hiện trường.')}</Text>
                            );
                          })()}
                        </View>
                        <Text style={styles.proofLabelBefore}>{translate("Ảnh trước khi sửa")}</Text>
                      </View>
                      <View style={styles.proofHalfCol}>
                        <View style={styles.proofBoxAfter}>
                          {(() => {
                            const proofMedia = Array.isArray(activeTicket.media)
                              ? activeTicket.media.find((m: any) => m.mediaType === 'REPAIR_PROOF')
                              : null;
                            const proofUrl = proofMedia?.imageUrl
                              ? (typeof proofMedia.imageUrl === 'string' ? proofMedia.imageUrl.split('#')[0] : proofMedia.imageUrl)
                              : null;
                            return proofUrl ? (
                              <TouchableOpacity
                                style={{ width: '100%', height: '100%' }}
                                activeOpacity={0.8}
                                onPress={() => {
                                  setViewingPhotoModal({
                                    url: proofUrl,
                                    title: translate('Ảnh sau khi sửa (KTV)'),
                                    meta: {
                                      techName: activeTicket.assignedTech?.fullName || 'KTV',
                                      time: activeTicket.completedAt || proofMedia?.createdAt,
                                    },
                                  });
                                }}
                              >
                                <Image
                                  source={{ uri: proofUrl }}
                                  style={{ width: '100%', height: '100%', borderRadius: 10 }}
                                  resizeMode="cover"
                                />
                              </TouchableOpacity>
                            ) : (
                              <>
                                <View style={styles.greenCheckCircle}>
                                  <Text style={{ color: '#059669', fontWeight: '800', fontSize: 18 }}>
                                    ✓
                                  </Text>
                                </View>
                                <Text style={styles.proofAfterSmallText}>Đường ống đã thay mới</Text>
                              </>
                            );
                          })()}
                        </View>
                        <Text style={styles.proofLabelAfter}>{translate("Ảnh sau khi sửa")}</Text>
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

                  {/* Thẻ Chi phí sửa chữa công khai nếu BMB đã phê duyệt */}
                  {ticketCosts[activeTicket.id]?.status === 'APPROVED' && (
                    <View style={styles.whiteSectionCard}>
                      <View style={styles.cardTopRow}>
                        <Text style={styles.cardBlockTitle}>{translate("Chi phí sửa chữa")}</Text>
                        <View style={[styles.statusPill, { backgroundColor: '#DCFCE7' }]}>
                          <Text style={[styles.statusPillText, { color: '#15803D' }]}>{translate("Đã phê duyệt")}</Text>
                        </View>
                      </View>
                      {(ticketCosts[activeTicket.id].items || []).map((it: any, i: number) => (
                        <View key={i} style={styles.bmbStatRow}>
                          <Text style={styles.bmbStatLabel}>• {it.materialName} ({it.quantity} {it.unit})</Text>
                          <Text style={styles.bmbStatValue}>{Number(it.totalPrice || 0).toLocaleString('vi-VN')} đ</Text>
                        </View>
                      ))}
                      {Number(ticketCosts[activeTicket.id].otherCost || 0) > 0 && (
                        <View style={styles.bmbStatRow}>
                          <Text style={styles.bmbStatLabel}>{translate("Chi phí khác:")}</Text>
                          <Text style={styles.bmbStatValue}>{Number(ticketCosts[activeTicket.id].otherCost).toLocaleString('vi-VN')} đ</Text>
                        </View>
                      )}
                      <View style={styles.techDivider} />
                      <View style={styles.bmbStatRow}>
                        <Text style={[styles.bmbStatLabel, { fontWeight: '700', color: '#0F172A' }]}>{translate("Tổng chi phí:")}</Text>
                        <Text style={[styles.bmbStatValue, { fontWeight: '800', color: '#2563EB', fontSize: 15 }]}>
                          {Number(ticketCosts[activeTicket.id].totalCost || 0).toLocaleString('vi-VN')} đ
                        </Text>
                      </View>
                    </View>
                  )}

                  {activeTicket.status === 'COMPLETED' && (
                    <AnimatedBadgeEntrance delay={100}>
                      <View style={styles.whiteSectionCard}>
                        <Text style={styles.cardBlockTitle}>
                          {translate("Đánh giá chất lượng xử lý (Tùy chọn)")}</Text>
                        <View style={styles.starsRow}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <TouchableOpacity key={star} onPress={() => setRatingStars(star)}>
                              <Text style={styles.starIcon}>
                                {star <= ratingStars ? '★' : '☆'}
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
                    </AnimatedBadgeEntrance>
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
                        {translate("Xác nhận Đã giải quyết (Đóng sự cố)")}</Text>
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
                      <Text style={styles.unreadPillText}>{unreadCount} {translate('chưa đọc')}</Text>
                    </View>
                    {unreadCount > 0 && (
                      <TouchableOpacity onPress={handleMarkAllNotificationsRead}>
                        <Text style={styles.seeHistoryLink}>{translate('Đánh dấu đã đọc')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {(() => {
                    const sortedNotis = [...notifications].sort(
                      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    );
                    const displayed = showAllNotifications ? sortedNotis : sortedNotis.slice(0, 5);
                    if (sortedNotis.length === 0) {
                      return <Text style={styles.techInfoLine}>{translate('Chưa có thông báo.')}</Text>;
                    }
                    return (
                      <>
                        {displayed.map((n: any) => (
                          <TouchableOpacity key={n.id} style={styles.notiBlueItem} onPress={() => handleOpenNotification(n)}>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                              <Text style={styles.notiItemTitle}>{n.title}</Text>
                              <Text style={styles.notiItemTime}>{formatDateTime(n.createdAt)}</Text>
                            </View>
                            {!n.isRead && <View style={styles.blueUnreadDot} />}
                          </TouchableOpacity>
                        ))}
                        {sortedNotis.length > 5 && (
                          <TouchableOpacity
                            style={{ paddingVertical: 10, alignItems: 'center' }}
                            onPress={() => setShowAllNotifications(!showAllNotifications)}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '600', color: '#2563EB' }}>
                              {showAllNotifications
                                ? translate('Thu gọn')
                                : `${translate('Xem thêm')} (${sortedNotis.length - 5})`}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </>
                    );
                  })()}
                </View>

                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>{translate("Hồ sơ cư dân")}</Text>
                  <View style={styles.profileAvatarWrapper}>
                    <View style={styles.profileAvatarCircle}>
                      <Text style={{ fontSize: 24, fontWeight: '700', color: '#2563EB' }}>
                        {user.fullName ? user.fullName.charAt(0).toUpperCase() : 'U'}
                      </Text>
                    </View>
                    <Text style={styles.profileNameText}>{user.fullName}</Text>
                  </View>
                  <View style={styles.profileInfoRow}>
                    <View style={styles.profileInfoIconBox}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748B' }}>CH</Text>
                    </View>
                    <Text style={styles.profileInfoValue}>
                      {user.apartmentCode || translate('Chưa cập nhật')} • {user.buildingBlock || translate('Chưa cập nhật')}
                    </Text>
                  </View>
                  <View style={styles.profileInfoRow}>
                    <View style={styles.profileInfoIconBox}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748B' }}>SĐT</Text>
                    </View>
                    <Text style={styles.profileInfoValue}>{user.phone}</Text>
                  </View>
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

                {filteredHistoryTickets.map((t, idx) => (
                  <StaggeredCardEntrance key={t.id} index={idx}>
                    <TouchableOpacity
                      style={styles.resTicketCard}
                      onPress={() => openResidentTicket(t)}
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
                        {t.locationNote} {translate("• Danh mục:")}{' '}
                        {translate(CATEGORY_SHORT_VN[t.finalCategory || t.aiSuggestedCategory] || 'Điện - Nước')}
                      </Text>
                      <View style={styles.historyFooterBar}>
                        <View>
                          <Text style={styles.historyClosedDate}>Đã đóng: 28/10/2026</Text>
                          <Text style={styles.historyTechName}>
                            (KTV: {t.assignedTech?.fullName || translate('Chưa phân công')})
                          </Text>
                        </View>
                        <View style={styles.rowCenter}>
                          <Text style={{ fontSize: 13, color: '#F59E0B' }}>★</Text>
                          <Text style={styles.historyRatingNum}>
                            {' '}
                            {(t.ratingStars || 5).toFixed(1)}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </StaggeredCardEntrance>
                ))}
              </ScrollView>
            )}
          </ScreenTransition>

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
                    {translate("Trang chủ")}</Text>
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
                    {translate("Lịch sử")}</Text>
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
                    {translate("Cá nhân")}</Text>
                </TouchableOpacity>
              </View>
            )}
        </View>
        {renderPhotoViewerModal()}
        {renderBmbIncidentPhotoModal()}
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

          <ScreenTransition transitionKey={techScreen} style={{ flex: 1 }}>
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
                      {user.fullName} • {user.shiftName || '07:00 - 15:00'}
                    </Text>
                  </View>
                  <View style={styles.rowCenter}>
                    <RealTimeClock style={{ marginRight: 8 }} />
                    <TouchableOpacity
                      style={styles.bellCircleBtn}
                      onPress={() => setTechScreen('NOTI_PROFILE')}
                    >
                      <OutlineIcon name="bell" size={21} color="#0F172A" />
                      {unreadCount > 0 && <View style={styles.bellRedDot} />}
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Thẻ Điểm danh & Trạng thái Ca trực (Chấm công GPS + Camera) */}
                <StaggeredCardEntrance index={0}>
                  <View style={styles.whiteSectionCard}>
                    <View style={styles.cardTopRow}>
                      <View>
                        <Text style={styles.sectionTitleText}>{translate("Điểm danh & Chấm công ca trực")}</Text>
                        <Text style={[styles.cardLocationText, { marginTop: 2 }]}>
                          ⏰ {translate("Giờ chuẩn:")} {new Date().toLocaleDateString('vi-VN')} • Ca: {user.shiftName || '07:00 - 15:00'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.statusPill, (user.isOnDuty || isCurrentlyInShift(user.shiftName)) ? { backgroundColor: '#DCFCE7' } : { backgroundColor: '#F1F5F9' }]}
                        onPress={handleToggleOnDuty}
                        disabled={dutyUpdating}
                      >
                        <Text style={[styles.statusPillText, (user.isOnDuty || isCurrentlyInShift(user.shiftName)) ? { color: '#15803D' } : { color: '#64748B' }]}>
                          {dutyUpdating ? translate('Đang cập nhật...') : (user.isOnDuty || isCurrentlyInShift(user.shiftName)) ? '● ' + translate('Đang trực') : '○ ' + translate('Ngoài ca')}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* THÔNG TIN TỌA ĐỘ VỊ TRÍ GPS & BÁN KÍNH CHẤM CÔNG (RESPONSIVE) */}
                    {renderTechGpsWidget()}

                    {/* 2 Nút Điểm danh To Rõ 46px */}
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { flex: 1, backgroundColor: '#16A34A', height: 46, borderRadius: 10 }]}
                        onPress={handleTechCheckIn}
                        disabled={loading}
                      >
                        <Text style={[styles.primaryActionBtnText, { fontSize: 13.5 }]}>🟢 {translate("Bắt đầu ca làm (Check-in)")}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { flex: 1, backgroundColor: '#DC2626', height: 46, borderRadius: 10 }]}
                        onPress={handleTechCheckOut}
                        disabled={loading}
                      >
                        <Text style={[styles.primaryActionBtnText, { fontSize: 13.5 }]}>🔴 {translate("Kết thúc ca làm (Check-out)")}</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={[styles.cardTopRow, { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' }]}>
                      <Text style={[styles.cardLocationText, { fontSize: 12 }]}>
                        {translate("Sự cố cần xử lý:")} <Text style={{ fontWeight: '700', color: '#0F172A' }}>{assignedCount + inProgressCount}</Text> • {translate("Đã xong:")} <Text style={{ fontWeight: '700', color: '#16A34A' }}>{completedCount}</Text>
                      </Text>
                      <TouchableOpacity onPress={() => setTechScreen('PAYROLL')}>
                        <Text style={styles.seeHistoryLink}>{translate("Bảng lương & Lịch sử >")}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </StaggeredCardEntrance>

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

                {filteredTechHome.map((t, idx) => {
                  const isAssigned = t.status === 'ASSIGNED';
                  const isInProgress = t.status === 'IN_PROGRESS';
                  const prio = t.finalPriority || t.aiSuggestedPriority;
                  return (
                    <StaggeredCardEntrance key={t.id} index={idx}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        style={[
                          styles.resTicketCard,
                          isAssigned && { borderColor: '#3B82F6', borderWidth: 1.5 },
                          isInProgress && { borderColor: '#818CF8', borderWidth: 1.5 },
                        ]}
                        onPress={() => openTechnicianTask(t)}
                      >
                      <View style={styles.cardTopRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                          <Text style={styles.cardCodeText}>{t.ticketCode}</Text>
                          {t.isAnonymous && (
                            <View style={{ backgroundColor: '#F1F5F9', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#CBD5E1' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#475569' }}>👤 {translate('Ẩn danh')}</Text>
                            </View>
                          )}
                          {t.locationVerificationStatus === 'VERIFIED' ? (
                            <View style={{ backgroundColor: '#ECFDF5', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#A7F3D0' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#059669' }}>📍 {translate('Đã xác minh vị trí')}</Text>
                            </View>
                          ) : t.locationVerificationStatus === 'UNVERIFIED' ? (
                            <View style={{ backgroundColor: '#FFFBEB', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#FDE68A' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#D97706' }}>⚠️ {translate('Chưa xác minh vị trí')}</Text>
                            </View>
                          ) : null}
                        </View>
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
                              ? translate('Đã phân công')
                              : isInProgress
                                ? translate('Đang xử lý')
                                : translate('Hoàn thành')}
                          </Text>
                        </View>
                      </View>

                      {prio === 'HIGH' && (
                        <Text style={styles.urgentRedText}>
                          {translate("Ưu tiên: Khẩn cấp")}</Text>
                      )}

                      <Text style={styles.cardMainTitle}>{t.title}</Text>
                      <Text style={styles.cardLocationText}>{t.locationNote}</Text>

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
                            {translate("Giao bởi BMB")} • 5 phút trước
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.techInProgressBar}>
                          <Text style={styles.techInProgressText}>
                            KTV: {user.fullName} • 15 phút trước
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </StaggeredCardEntrance>
                );
              })}
              </ScrollView>
            )}

{techScreen === 'TASK_DETAIL' && activeTicket && (
              <TechnicianStepFlow
                activeTicket={activeTicket}
                loading={loading}
                styles={styles}
                translate={translate}
                formatDateTime={formatDateTime}
                PRIORITY_VN={PRIORITY_VN}
                CATEGORY_SHORT_VN={CATEGORY_SHORT_VN}
                getResidentReportedMedia={getResidentReportedMedia}
                openReportedPhoto={openReportedPhoto}
                failedPhotoUrls={failedPhotoUrls}
                setFailedPhotoUrls={setFailedPhotoUrls}
                renderIncidentProgressTimeline={renderIncidentProgressTimeline}
                onAcceptJob={handleTechAcknowledge}
                techArrivalPhotoUrl={techArrivalPhotoUrl}
                techArrivalGps={techArrivalGps}
                onCaptureArrivalPhoto={handleTechCaptureArrivalPhoto}
                onConfirmArrival={handleTechConfirmArrival}
                technicianGuidance={technicianGuidance}
                technicianGuidanceLoading={technicianGuidanceLoading}
                checkedChecklistItems={checkedChecklistItems}
                setCheckedChecklistItems={setCheckedChecklistItems}
                ticketCosts={ticketCosts}
                matNameInput={matNameInput}
                setMatNameInput={setMatNameInput}
                matQtyInput={matQtyInput}
                setMatQtyInput={setMatQtyInput}
                matUnitInput={matUnitInput}
                setMatUnitInput={setMatUnitInput}
                matPriceInput={matPriceInput}
                setMatPriceInput={setMatPriceInput}
                handleTechSubmitCost={handleTechSubmitCost}
                techProofPhotos={techProofPhotos}
                setTechProofPhotos={setTechProofPhotos}
                techRepairNote={techRepairNote}
                setTechRepairNote={setTechRepairNote}
                handlePickOrCapturePhoto={handlePickOrCapturePhoto}
                onCompleteRepair={handleTechCompleteSubmit}
                onBackHome={() => setTechScreen('HOME')}
                showToast={showToast}
              />
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

                  {(() => {
                    const sortedNotis = [...notifications].sort(
                      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    );
                    const displayed = showAllNotifications ? sortedNotis : sortedNotis.slice(0, 5);
                    if (sortedNotis.length === 0) {
                      return <Text style={styles.techInfoLine}>{translate('Chưa có thông báo công việc.')}</Text>;
                    }
                    return (
                      <>
                        {displayed.map((notification: any) => (
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
                        ))}
                        {sortedNotis.length > 5 && (
                          <TouchableOpacity
                            style={{ paddingVertical: 10, alignItems: 'center' }}
                            onPress={() => setShowAllNotifications(!showAllNotifications)}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '600', color: '#2563EB' }}>
                              {showAllNotifications
                                ? translate('Thu gọn')
                                : `${translate('Xem thêm')} (${sortedNotis.length - 5})`}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </>
                    );
                  })()}
                </View>

                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>{translate("Hồ sơ Kỹ thuật viên")}</Text>
                  <View style={styles.techProfileHeaderRow}>
                    <View style={styles.techAvatarCircle}>
                      <Text style={{ fontSize: 22, fontWeight: '700', color: '#2563EB' }}>
                        {user.fullName ? user.fullName.charAt(0).toUpperCase() : 'K'}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.profileNameText}>{user.fullName}</Text>
                      <View style={styles.specialtyPill}>
                        <Text style={styles.specialtyPillText}>
                          {user.specialtyLabel || 'Điện - Nước'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.techDivider} />

                  <Text style={styles.techProfileLine}>
                    {translate("Số điện thoại:")} {user.phone || '0356 166 863'}
                  </Text>
                  <Text style={styles.techProfileLine}>
                    {translate("Ca trực:")} {user.shiftName || '07:00 - 15:00'} • {(user.isOnDuty || isCurrentlyInShift(user.shiftName)) ? translate('Đang trực') : translate('Ngoài ca')}
                  </Text>
                  <Text style={styles.techProfileLine}>
                    {translate("Đã hoàn thành:")} {completedCount} {translate("sự cố")} • {translate("Đánh giá TB:")} {averageRating} ★
                  </Text>

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
                    {completedHistory.length} {translate("công việc")}
                  </Text>
                </View>

                <View style={styles.searchBarBox}>
                  <TextInput
                    style={styles.searchBarInput}
                    placeholder={translate("Tìm mã sự cố hoặc địa điểm...")}
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

                {filteredTechHistory.map((t, idx) => {
                  const isWaitingAccept = t.status === 'COMPLETED';
                  return (
                    <StaggeredCardEntrance key={t.id} index={idx}>
                      <TouchableOpacity
                        key={t.id}
                        style={styles.resTicketCard}
                        onPress={() => openTechnicianTask(t)}
                      >
                      <View style={styles.cardTopRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                          <Text style={styles.cardCodeText}>{t.ticketCode}</Text>
                          {t.isAnonymous && (
                            <View style={{ backgroundColor: '#F1F5F9', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#CBD5E1' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#475569' }}>👤 {translate('Ẩn danh')}</Text>
                            </View>
                          )}
                          {t.locationVerificationStatus === 'VERIFIED' ? (
                            <View style={{ backgroundColor: '#ECFDF5', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#A7F3D0' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#059669' }}>📍 {translate('Đã xác minh vị trí')}</Text>
                            </View>
                          ) : t.locationVerificationStatus === 'UNVERIFIED' ? (
                            <View style={{ backgroundColor: '#FFFBEB', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#FDE68A' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#D97706' }}>⚠️ {translate('Chưa xác minh vị trí')}</Text>
                            </View>
                          ) : null}
                        </View>
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
                      <Text style={styles.cardLocationText}>{t.locationNote}</Text>

                      {isWaitingAccept ? (
                        <View style={styles.sentPhotoBlueBar}>
                          <Text style={styles.sentPhotoBlueText}>
                            {translate("Đã gửi ảnh nghiệm thu • Đang chờ xác nhận")}</Text>
                        </View>
                      ) : (
                        <View style={styles.closedResidentGreenBar}>
                          <Text style={styles.closedResidentGreenText}>
                            {translate("Cư dân đã nghiệm thu")} • ★ {(t.ratingStars || 5).toFixed(1)}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </StaggeredCardEntrance>
                );
              })}
              </ScrollView>
            )}

            {techScreen === 'PAYROLL' && (
              <ScrollView
                style={styles.scrollArea}
                contentContainerStyle={{ paddingBottom: 28 }}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.subScreenHeader}>
                  <TouchableOpacity onPress={() => setTechScreen('HOME')}>
                    <Text style={styles.backArrowText}>←</Text>
                  </TouchableOpacity>
                  <Text style={styles.subScreenTitle}>{translate("Chấm công & Lương")}</Text>
                </View>

                {/* Thẻ Chấm công Check-in / Check-out */}
                <View style={styles.whiteSectionCard}>
                  <Text style={styles.sectionTitleText}>{translate("Chấm công ca trực")}</Text>
                  <Text style={styles.techDutySub}>
                    {translate("Thời gian chuẩn máy chủ:")} {new Date().toLocaleDateString('vi-VN')}
                  </Text>

                  {/* THÔNG TIN TỌA ĐỘ VỊ TRÍ GPS & BÁN KÍNH CHẤM CÔNG (RESPONSIVE) */}
                  {renderTechGpsWidget()}

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                    <TouchableOpacity
                      style={[styles.primaryActionBtn, { flex: 1, backgroundColor: '#16A34A' }]}
                      onPress={handleTechCheckIn}
                      disabled={loading}
                    >
                      <Text style={styles.primaryActionBtnText}>🟢 Check-in (Vào ca)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.primaryActionBtn, { flex: 1, backgroundColor: '#DC2626' }]}
                      onPress={handleTechCheckOut}
                      disabled={loading}
                    >
                      <Text style={styles.primaryActionBtnText}>🔴 Check-out (Tan ca)</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.cardLocationText, { marginTop: 8, fontSize: 11.5 }]}>
                    * {translate("Giờ chấm công lấy trực tiếp từ máy chủ server, đảm bảo tính minh bạch.")}
                  </Text>
                </View>

                {/* 4 Sub-tabs */}
                <View style={{ flexDirection: 'row', gap: 6, marginVertical: 12 }}>
                  {[
                    { key: 'ATTENDANCE', label: 'Chấm công' },
                    { key: 'OVERTIME', label: 'Tăng ca' },
                    { key: 'SALARY', label: 'Lương của tôi' },
                    { key: 'SCHEDULE', label: 'Lịch & Nghỉ' },
                  ].map((st) => (
                    <TouchableOpacity
                      key={st.key}
                      style={[
                        styles.filterPill,
                        techPayrollSubTab === st.key && styles.filterPillActive,
                        { flex: 1, alignItems: 'center' }
                      ]}
                      onPress={() => setTechPayrollSubTab(st.key as any)}
                    >
                      <Text
                        style={[
                          styles.filterPillText,
                          techPayrollSubTab === st.key && styles.filterPillTextActive,
                        ]}
                      >
                        {translate(st.label)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <ScreenTransition transitionKey={techPayrollSubTab} style={{ flex: 1 }}>
                  {/* Sub-tab 1: Lịch sử chấm công */}
                  {techPayrollSubTab === 'ATTENDANCE' && (
                    <View style={styles.whiteSectionCard}>
                      <Text style={styles.cardBlockTitle}>{translate("Nhật ký chấm công gần đây")}</Text>
                      {myAttendanceLogs.length === 0 ? (
                        <Text style={styles.techInfoLine}>{translate("Chưa có dữ liệu chấm công.")}</Text>
                      ) : (
                        myAttendanceLogs.map((log) => {
                          const punctuality = log.punctualityStatus || 'ON_TIME';
                          const verification = log.verificationStatus || 'VERIFIED';
                          return (
                            <View key={log.id} style={[styles.notiBlueItem, { paddingVertical: 12, marginBottom: 8 }]}>
                              <View style={{ flex: 1 }}>
                                <View style={styles.cardTopRow}>
                                  <Text style={{ fontWeight: '700', color: '#0F172A', fontSize: 14 }}>
                                    {log.date} {log.shiftScheduled ? `• ${log.shiftScheduled}` : ''}
                                  </Text>
                                  <View style={{ flexDirection: 'row', gap: 4 }}>
                                    <View style={[
                                      styles.statusPill,
                                      verification === 'VERIFIED' || verification === 'APPROVED' ? { backgroundColor: '#DCFCE7' } :
                                        verification === 'REJECTED' ? { backgroundColor: '#FEE2E2' } :
                                          verification === 'NEEDS_EXPLANATION' ? { backgroundColor: '#F3E8FF' } : { backgroundColor: '#FEF3C7' }
                                    ]}>
                                      <Text style={[
                                        styles.statusPillText,
                                        verification === 'VERIFIED' || verification === 'APPROVED' ? { color: '#15803D' } :
                                          verification === 'REJECTED' ? { color: '#B91C1C' } :
                                            verification === 'NEEDS_EXPLANATION' ? { color: '#7E22CE' } : { color: '#B45309' }
                                      ]}>
                                        {verification === 'VERIFIED' ? '✓ Hợp lệ' :
                                          verification === 'APPROVED' ? '✓ Đã duyệt' :
                                            verification === 'NEEDS_EXPLANATION' ? '💬 Cần giải trình' :
                                              verification === 'REJECTED' ? '✕ Từ chối' : '⏳ Chờ xem xét'}
                                      </Text>
                                    </View>
                                    {punctuality !== 'ON_TIME' && (
                                      <View style={[styles.statusPill, { backgroundColor: '#FFEDD5' }]}>
                                        <Text style={[styles.statusPillText, { color: '#C2410C' }]}>
                                          {punctuality === 'LATE' ? `Muộn ${log.lateMinutes || 0}p` :
                                            punctuality === 'EARLY_LEAVE' ? `Về sớm ${log.earlyMinutes || 0}p` : punctuality}
                                        </Text>
                                      </View>
                                    )}
                                  </View>
                                </View>

                                <Text style={styles.techNotiBodyText}>
                                  Vào: {new Date(log.checkIn).toLocaleTimeString('vi-VN')} • Ra: {log.checkOut ? new Date(log.checkOut).toLocaleTimeString('vi-VN') : 'Đang trong ca trực'}
                                </Text>

                                {log.checkInGps && (
                                  <View style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 8, marginTop: 6, borderWidth: 1, borderColor: '#E2E8F0' }}>
                                    <Text style={{ fontSize: 11.5, color: '#0F172A', fontWeight: '600' }}>
                                      📍 Tọa độ GPS: {log.checkInGps.latitude?.toFixed(6)}, {log.checkInGps.longitude?.toFixed(6)}
                                    </Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                                      <Text style={{ fontSize: 11.5, color: '#334155' }}>
                                        Khoảng cách: <Text style={{ fontWeight: '700' }}>~{log.checkInGps.distanceMeters ?? log.checkInGps.distanceToBuildingMeters ?? 0}m</Text> • Giới hạn: ≤ 300m
                                      </Text>
                                      <View style={[
                                        styles.statusPill,
                                        (log.checkInGps.isWithinAllowedRadius ?? log.checkInGps.isWithinRadius) ? { backgroundColor: '#DCFCE7' } : { backgroundColor: '#FEE2E2' }
                                      ]}>
                                        <Text style={[
                                          styles.statusPillText,
                                          (log.checkInGps.isWithinAllowedRadius ?? log.checkInGps.isWithinRadius) ? { color: '#15803D' } : { color: '#B91C1C' }
                                        ]}>
                                          {(log.checkInGps.isWithinAllowedRadius ?? log.checkInGps.isWithinRadius) ? '✓ Trong bán kính 300m' : '⚠️ Ngoài bán kính (>300m)'}
                                        </Text>
                                      </View>
                                      <Text style={{ fontSize: 11, color: '#64748B' }}>
                                        (±{log.checkInGps.accuracy ?? log.checkInGps.accuracyMeters ?? 10}m)
                                      </Text>
                                    </View>
                                    {(log.checkInGps.accuracy ?? log.checkInGps.accuracyMeters) > 100 && (
                                      <Text style={{ fontSize: 11, color: '#D97706', marginTop: 2 }}>
                                        ⚠️ Độ chính xác GPS thấp (±{log.checkInGps.accuracy ?? log.checkInGps.accuracyMeters}m &gt; 100m)
                                      </Text>
                                    )}
                                  </View>
                                )}

                                {log.anomalyNotes && (
                                  <View style={{ backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 6, padding: 6, marginTop: 4 }}>
                                    <Text style={{ fontSize: 11.5, color: '#B45309', fontWeight: '600' }}>
                                      ⚠️ Ngoại lệ: {log.anomalyNotes}
                                    </Text>
                                  </View>
                                )}

                                {log.explanationText && (
                                  <Text style={{ fontSize: 11.5, color: '#2563EB', marginTop: 4, fontStyle: 'italic' }}>
                                    💬 Đã giải trình: &quot;{log.explanationText}&quot;
                                  </Text>
                                )}

                                {log.reviewNote && (
                                  <Text style={{ fontSize: 11.5, color: '#475569', marginTop: 2, fontWeight: '600' }}>
                                    📝 Phản hồi BMB: &quot;{log.reviewNote}&quot;
                                  </Text>
                                )}

                                {/* Nút gửi giải trình nếu có ngoại lệ hoặc BMB yêu cầu */}
                                {(verification === 'NEEDS_EXPLANATION' || verification === 'PENDING_REVIEW' || Boolean(log.anomalyNotes)) && (
                                  <View style={{ marginTop: 8 }}>
                                    <TouchableOpacity
                                      style={[styles.primaryActionBtn, { paddingVertical: 5, paddingHorizontal: 12, alignSelf: 'flex-start', backgroundColor: '#6366F1' }]}
                                      onPress={() => {
                                        setTechExplanationInput(log.explanationText || '');
                                        setTechExplanationModal({ visible: true, log });
                                      }}
                                    >
                                      <Text style={[styles.primaryActionBtnText, { fontSize: 11.5 }]}>
                                        💬 {log.explanationText ? 'Cập nhật giải trình' : 'Gửi giải trình cho BMB'}
                                      </Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>

                              <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                                <View style={[styles.unreadPillBadge, { backgroundColor: '#F1F5F9' }]}>
                                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>
                                    {log.billableHours !== undefined && log.billableHours !== null
                                      ? `${log.billableHours}h tính lương`
                                      : log.workHours ? `${log.workHours}h` : 'Đang trực'}
                                  </Text>
                                </View>
                                {log.checkInPhotoUrl && (
                                  <TouchableOpacity
                                    style={{ marginTop: 6 }}
                                    onPress={() => setViewingPhotoModal({
                                      url: log.checkInPhotoUrl,
                                      title: `Ảnh Check-in (${log.date})`,
                                      meta: { techName: log.techName, time: log.checkIn, gps: log.checkInGps }
                                    })}
                                  >
                                    <Text style={{ fontSize: 11, color: '#2563EB', fontWeight: '600' }}>📷 Xem ảnh</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                          );
                        })
                      )}
                    </View>
                  )}

                  {/* Sub-tab 2: Yêu cầu tăng ca */}
                  {techPayrollSubTab === 'OVERTIME' && (
                    <>
                      <View style={styles.whiteSectionCard}>
                        <Text style={styles.cardBlockTitle}>{translate("Gửi yêu cầu tăng ca (OT)")}</Text>

                        <Text style={styles.fieldLabel}>{translate("Khung giờ tăng ca thực tế (Từ giờ - Đến giờ) *")}</Text>
                        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.fieldLabel, { fontSize: 11, marginBottom: 2 }]}>{translate("Bắt đầu (HH:mm)")}</Text>
                            <TextInput
                              style={styles.textInputField}
                              value={otFromTimeInput}
                              onChangeText={(val) => {
                                setOtFromTimeInput(val);
                                const p1 = val.split(':').map(Number);
                                const p2 = otToTimeInput.split(':').map(Number);
                                if (p1.length === 2 && p2.length === 2 && !isNaN(p1[0]) && !isNaN(p2[0])) {
                                  let diff = (p2[0] * 60 + (p2[1] || 0)) - (p1[0] * 60 + (p1[1] || 0));
                                  if (diff <= 0) diff += 24 * 60;
                                  setOtHoursInput(String(Math.round((diff / 60) * 100) / 100));
                                }
                              }}
                              placeholder="17:30"
                              placeholderTextColor="#94A3B8"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.fieldLabel, { fontSize: 11, marginBottom: 2 }]}>{translate("Kết thúc (HH:mm)")}</Text>
                            <TextInput
                              style={styles.textInputField}
                              value={otToTimeInput}
                              onChangeText={(val) => {
                                setOtToTimeInput(val);
                                const p1 = otFromTimeInput.split(':').map(Number);
                                const p2 = val.split(':').map(Number);
                                if (p1.length === 2 && p2.length === 2 && !isNaN(p1[0]) && !isNaN(p2[0])) {
                                  let diff = (p2[0] * 60 + (p2[1] || 0)) - (p1[0] * 60 + (p1[1] || 0));
                                  if (diff <= 0) diff += 24 * 60;
                                  setOtHoursInput(String(Math.round((diff / 60) * 100) / 100));
                                }
                              }}
                              placeholder="19:30"
                              placeholderTextColor="#94A3B8"
                            />
                          </View>
                        </View>

                        <Text style={styles.fieldLabel}>{translate("Tổng giờ tăng ca (0.5 - 8h) *")}</Text>
                        <TextInput
                          style={styles.textInputField}
                          value={otHoursInput}
                          onChangeText={(val) => setOtHoursInput(val.replace(/[^\d.]/g, ''))}
                          keyboardType="numeric"
                          placeholder="2"
                          placeholderTextColor="#94A3B8"
                        />

                        <Text style={styles.fieldLabel}>{translate("Lý do tăng ca *")}</Text>
                        <TextInput
                          style={[styles.textInputField, { height: 60, textAlignVertical: 'top' }]}
                          value={otReasonInput}
                          onChangeText={setOtReasonInput}
                          multiline
                          placeholder={translate("Khắc phục sự cố khẩn cấp sau giờ làm...")}
                          placeholderTextColor="#94A3B8"
                        />

                        <Text style={styles.fieldLabel}>{translate("Mã sự cố liên quan (Tùy chọn)")}</Text>
                        <TextInput
                          style={styles.textInputField}
                          value={otTicketIdInput}
                          onChangeText={setOtTicketIdInput}
                          placeholder="#RF-2026-..."
                          placeholderTextColor="#94A3B8"
                        />

                        <TouchableOpacity
                          style={[styles.primaryActionBtn, { marginTop: 12 }]}
                          onPress={handleTechSubmitOvertime}
                          disabled={loading}
                        >
                          <Text style={styles.primaryActionBtnText}>{translate("Gửi yêu cầu tăng ca")}</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={[styles.whiteSectionCard, { marginTop: 12 }]}>
                        <Text style={styles.cardBlockTitle}>{translate("Yêu cầu đã gửi")}</Text>
                        {myOvertimeRequests.length === 0 ? (
                          <Text style={styles.techInfoLine}>{translate("Chưa có yêu cầu tăng ca nào.")}</Text>
                        ) : (
                          myOvertimeRequests.map((ot) => (
                            <View key={ot.id} style={[styles.notiBlueItem, { paddingVertical: 10 }]}>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontWeight: '700', color: '#0F172A', fontSize: 13.5 }}>
                                  {ot.date} • {ot.hours} giờ {ot.ticketId ? `(${ot.ticketId})` : ''}
                                </Text>
                                <Text style={styles.techNotiBodyText}>{ot.reason}</Text>
                                {ot.reviewNote && (
                                  <Text style={{ fontSize: 11.5, color: '#64748B', fontStyle: 'italic', marginTop: 2 }}>
                                    BMB: {ot.reviewNote}
                                  </Text>
                                )}
                              </View>
                              <View style={[
                                styles.statusPill,
                                ot.status === 'APPROVED' ? { backgroundColor: '#DCFCE7' } : ot.status === 'REJECTED' ? { backgroundColor: '#FEE2E2' } : { backgroundColor: '#FEF3C7' }
                              ]}>
                                <Text style={[
                                  styles.statusPillText,
                                  ot.status === 'APPROVED' ? { color: '#15803D' } : ot.status === 'REJECTED' ? { color: '#B91C1C' } : { color: '#B45309' }
                                ]}>
                                  {ot.status === 'APPROVED' ? 'Đã duyệt' : ot.status === 'REJECTED' ? 'Từ chối' : 'Chờ duyệt'}
                                </Text>
                              </View>
                            </View>
                          ))
                        )}
                      </View>
                    </>
                  )}

                  {/* Sub-tab 3: Lương của tôi (Công thức cố định 5.000.000/180h + Thưởng BMB + Hiệu suất 4 nhóm) */}
                  {techPayrollSubTab === 'SALARY' && (
                    <View style={styles.whiteSectionCard}>
                      <View style={[styles.cardTopRow, { flexWrap: 'wrap', gap: 6 }]}>
                        <Text style={styles.cardBlockTitle}>
                          {translate("Phiếu lương & Hiệu suất tháng")} {myPayrollData?.month || new Date().toISOString().slice(0, 7)}
                        </Text>
                        <View style={[styles.unreadPillBadge, { backgroundColor: myPayrollData?.isLocked ? '#DCFCE7' : '#FEF3C7' }]}>
                          <Text style={{ fontSize: 11.5, fontWeight: '700', color: myPayrollData?.isLocked ? '#15803D' : '#B45309' }}>
                            {myPayrollData?.isLocked ? '🔒 ' + translate('Đã khóa bảng lương') : '⏳ Đang tổng hợp (Chưa khóa)'}
                          </Text>
                        </View>
                      </View>

                      <View style={{ backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#BFDBFE' }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#1E40AF' }}>
                          📌 Quy tắc tính lương cố định:
                        </Text>
                        <Text style={{ fontSize: 11.5, color: '#1E3A8A', marginTop: 3, lineHeight: 17 }}>
                          • Lương cơ bản: <Text style={{ fontWeight: '700' }}>5.000.000 VNĐ / 180 giờ</Text> (~{Number(myPayrollData?.hourlyRate || 27778).toLocaleString('vi-VN')} VNĐ/giờ){'\n'}
                          • Lương theo giờ = (5.000.000 / 180) × Số giờ công hợp lệ{'\n'}
                          • Tổng lương = Lương theo giờ + Tiền thưởng BMB
                        </Text>
                      </View>

                      <View style={styles.techDivider} />
                      <View style={styles.bmbStatRow}>
                        <Text style={styles.bmbStatLabel}>{translate("Tổng giờ công hợp lệ:")}</Text>
                        <Text style={[styles.bmbStatValue, { fontWeight: '800', color: '#0F172A' }]}>
                          {Number(myPayrollData?.validWorkHours ?? myPayrollData?.regularHours ?? 0)} giờ / 180 giờ
                        </Text>
                      </View>
                      <View style={styles.bmbStatRow}>
                        <Text style={styles.bmbStatLabel}>{translate("Đơn giá giờ (5.000.000 / 180):")}</Text>
                        <Text style={styles.bmbStatValue}>
                          ~{Number(myPayrollData?.hourlyRate || 27778).toLocaleString('vi-VN')} đ/giờ
                        </Text>
                      </View>
                      <View style={styles.bmbStatRow}>
                        <Text style={styles.bmbStatLabel}>{translate("Lương theo giờ công:")}</Text>
                        <Text style={[styles.bmbStatValue, { fontWeight: '700', color: '#0F172A' }]}>
                          {Number(myPayrollData?.hourlySalary ?? myPayrollData?.regularPay ?? 0).toLocaleString('vi-VN')} đ
                        </Text>
                      </View>
                      <View style={styles.bmbStatRow}>
                        <Text style={styles.bmbStatLabel}>{translate("Tiền thưởng BMB:")}</Text>
                        <Text style={[styles.bmbStatValue, { color: '#16A34A', fontWeight: '700' }]}>
                          +{Number(myPayrollData?.bmbBonus || 0).toLocaleString('vi-VN')} đ
                        </Text>
                      </View>
                      {myPayrollData?.bmbBonusNote ? (
                        <Text style={{ fontSize: 11.5, color: '#64748B', fontStyle: 'italic', textAlign: 'right', marginBottom: 4 }}>
                          Ghi chú thưởng: &quot;{myPayrollData.bmbBonusNote}&quot;
                        </Text>
                      ) : null}
                      <View style={styles.techDivider} />
                      <View style={styles.bmbStatRow}>
                        <Text style={[styles.bmbStatLabel, { fontWeight: '700', fontSize: 15, color: '#0F172A' }]}>
                          {translate("Tổng lương thực nhận:")}
                        </Text>
                        <Text style={[styles.bmbStatValue, { fontWeight: '800', fontSize: 18, color: '#2563EB' }]}>
                          {Number(myPayrollData?.totalSalary || 0).toLocaleString('vi-VN')} đ
                        </Text>
                      </View>

                      {/* Thống kê Hiệu suất 4 nhóm của KTV */}
                      {myPayrollData?.performance && (
                        <View style={{ marginTop: 14, gap: 10 }}>
                          <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#0F172A' }}>
                            📊 Thống kê hiệu suất làm việc trong tháng
                          </Text>

                          {/* Nhóm 1 & 2 */}
                          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                            <View style={{ flex: 1, minWidth: 140, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E2E8F0' }}>
                              <Text style={{ fontSize: 12, fontWeight: '800', color: '#1E40AF', marginBottom: 4 }}>🕒 1. Giờ công</Text>
                              <Text style={{ fontSize: 11.5, color: '#334155' }}>• Giờ hợp lệ: <Text style={{ fontWeight: '700' }}>{myPayrollData.performance.workHoursGroup?.validWorkHours ?? 0}h</Text></Text>
                              <Text style={{ fontSize: 11.5, color: '#334155' }}>• Ngày làm: <Text style={{ fontWeight: '700' }}>{myPayrollData.performance.workHoursGroup?.workDaysCount ?? 0} ngày</Text></Text>
                              <Text style={{ fontSize: 11.5, color: '#334155' }}>• Nghỉ theo lịch: <Text style={{ fontWeight: '700' }}>{myPayrollData.performance.workHoursGroup?.scheduledLeaveDaysCount ?? 0} ngày</Text></Text>
                              <Text style={{ fontSize: 11.5, color: '#D97706' }}>• Đi trễ: {myPayrollData.performance.workHoursGroup?.lateCheckInCount ?? 0} lần • Về sớm: {myPayrollData.performance.workHoursGroup?.earlyLeaveCount ?? 0} lần</Text>
                            </View>

                            <View style={{ flex: 1, minWidth: 140, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E2E8F0' }}>
                              <Text style={{ fontSize: 12, fontWeight: '800', color: '#0F766E', marginBottom: 4 }}>🛠️ 2. Sự cố</Text>
                              <Text style={{ fontSize: 11.5, color: '#334155' }}>• Được phân công: <Text style={{ fontWeight: '700' }}>{myPayrollData.performance.incidentsGroup?.totalAssignedTickets ?? 0}</Text></Text>
                              <Text style={{ fontSize: 11.5, color: '#334155' }}>• Cao: {myPayrollData.performance.incidentsGroup?.highPriorityCount ?? 0} • TB: {myPayrollData.performance.incidentsGroup?.mediumPriorityCount ?? 0} • Thấp: {myPayrollData.performance.incidentsGroup?.lowPriorityCount ?? 0}</Text>
                              <Text style={{ fontSize: 11.5, color: '#16A34A', fontWeight: '700' }}>• Hoàn thành: {myPayrollData.performance.incidentsGroup?.completedTicketsCount ?? 0} sự cố</Text>
                            </View>
                          </View>

                          {/* Nhóm 3 & 4 */}
                          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                            <View style={{ flex: 1, minWidth: 140, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E2E8F0' }}>
                              <Text style={{ fontSize: 12, fontWeight: '800', color: '#B45309', marginBottom: 4 }}>⚡ 3. Phản hồi (≤15p)</Text>
                              <Text style={{ fontSize: 11.5, color: '#16A34A' }}>• Đúng giờ (≤15p): <Text style={{ fontWeight: '700' }}>{myPayrollData.performance.responseTimeGroup?.onTimeArrivalCount ?? 0} lần</Text></Text>
                              <Text style={{ fontSize: 11.5, color: '#DC2626' }}>• Đến trễ (&gt;15p): <Text style={{ fontWeight: '700' }}>{myPayrollData.performance.responseTimeGroup?.lateArrivalCount ?? 0} lần</Text></Text>
                              <Text style={{ fontSize: 11.5, color: '#B91C1C' }}>• Tổng phút trễ: <Text style={{ fontWeight: '700' }}>{myPayrollData.performance.responseTimeGroup?.totalLateArrivalMinutes ?? 0} phút</Text></Text>
                            </View>

                            <View style={{ flex: 1, minWidth: 140, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E2E8F0' }}>
                              <Text style={{ fontSize: 12, fontWeight: '800', color: '#7C3AED', marginBottom: 4 }}>⭐ 4. Đánh giá cư dân</Text>
                              <Text style={{ fontSize: 11.5, color: '#334155' }}>• Tổng lượt đánh giá: <Text style={{ fontWeight: '700' }}>{myPayrollData.performance.ratingsGroup?.totalRatingsCount ?? 0}</Text></Text>
                              <Text style={{ fontSize: 11.5, color: '#334155' }}>
                                • Điểm trung bình:{' '}
                                <Text style={{ fontWeight: '800', color: '#D97706' }}>
                                  {myPayrollData.performance.ratingsGroup?.averageRating != null
                                    ? `★ ${myPayrollData.performance.ratingsGroup.averageRating} / 5.0`
                                    : 'Chưa có đánh giá'}
                                </Text>
                              </Text>
                            </View>
                          </View>
                        </View>
                      )}

                      {/* Đối soát lương */}
                      <View style={[styles.techDivider, { marginTop: 14 }]} />
                      <Text style={[styles.fieldLabel, { marginTop: 4 }]}>{translate("Phản hồi / Đối soát lương:")}</Text>
                      <TextInput
                        style={styles.textInputField}
                        value={reconcileNoteInput}
                        onChangeText={setReconcileNoteInput}
                        placeholder={translate("Nhập ý kiến đối soát nếu có chênh lệch giờ làm...")}
                        placeholderTextColor="#94A3B8"
                      />
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { marginTop: 8, backgroundColor: '#475569' }]}
                        onPress={handleTechSubmitReconcile}
                        disabled={loading}
                      >
                        <Text style={styles.primaryActionBtnText}>{translate("Gửi phản hồi đối soát")}</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Sub-tab 4: Lịch trực & Nghỉ phép */}
                  {techPayrollSubTab === 'SCHEDULE' && (
                    <>
                      <View style={styles.whiteSectionCard}>
                        <Text style={styles.cardBlockTitle}>{translate("Ca trực & Lịch làm việc")}</Text>
                        <View style={styles.bmbStatRow}>
                          <Text style={styles.bmbStatLabel}>{translate("Ca làm việc quy định:")}</Text>
                          <Text style={[styles.bmbStatValue, { color: '#2563EB', fontWeight: '700' }]}>
                            {myScheduleData?.schedule?.shiftName || user.shiftName || '08:00 - 17:00'}
                          </Text>
                        </View>
                        <View style={styles.bmbStatRow}>
                          <Text style={styles.bmbStatLabel}>{translate("Trạng thái hiện tại:")}</Text>
                          <View style={[styles.statusPill, { backgroundColor: myScheduleData?.schedule?.isCurrentlyInShift ? '#DCFCE7' : '#F1F5F9' }]}>
                            <Text style={[styles.statusPillText, { color: myScheduleData?.schedule?.isCurrentlyInShift ? '#15803D' : '#64748B' }]}>
                              {myScheduleData?.schedule?.isCurrentlyInShift ? translate('Đang trong ca trực') : translate('Ngoài ca')}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Form Xin nghỉ phép */}
                      <View style={[styles.whiteSectionCard, { marginTop: 12 }]}>
                        <Text style={styles.cardBlockTitle}>{translate("Xin nghỉ phép")}</Text>
                        <Text style={styles.fieldLabel}>{translate("Ngày nghỉ (YYYY-MM-DD) *")}</Text>
                        <TextInput
                          style={styles.textInputField}
                          value={leaveDateInput}
                          onChangeText={setLeaveDateInput}
                          placeholder="2026-11-06"
                          placeholderTextColor="#94A3B8"
                        />

                        <Text style={styles.fieldLabel}>{translate("Loại nghỉ phép")}</Text>
                        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                          {[
                            { key: 'ANNUAL', label: 'Phép năm' },
                            { key: 'SICK', label: 'Nghỉ ốm' },
                            { key: 'UNPAID', label: 'Không lương' },
                          ].map((lt) => (
                            <TouchableOpacity
                              key={lt.key}
                              style={[
                                styles.filterPill,
                                leaveTypeInput === lt.key && styles.filterPillActive,
                                { flex: 1, alignItems: 'center' },
                              ]}
                              onPress={() => setLeaveTypeInput(lt.key as any)}
                            >
                              <Text
                                style={[
                                  styles.filterPillText,
                                  leaveTypeInput === lt.key && styles.filterPillTextActive,
                                ]}
                              >
                                {translate(lt.label)}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>

                        <Text style={styles.fieldLabel}>{translate("Lý do xin nghỉ *")}</Text>
                        <TextInput
                          style={[styles.textInputField, { height: 60, textAlignVertical: 'top' }]}
                          value={leaveReasonInput}
                          onChangeText={setLeaveReasonInput}
                          multiline
                          placeholder={translate("Ghi rõ lý do xin nghỉ phép...")}
                          placeholderTextColor="#94A3B8"
                        />

                        <TouchableOpacity
                          style={[styles.primaryActionBtn, { marginTop: 8 }]}
                          onPress={handleTechSubmitLeave}
                          disabled={loading}
                        >
                          <Text style={styles.primaryActionBtnText}>{translate("Gửi đơn xin nghỉ phép")}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Form Đổi ca trực */}
                      <View style={[styles.whiteSectionCard, { marginTop: 12 }]}>
                        <Text style={styles.cardBlockTitle}>{translate("Đổi ca trực")}</Text>
                        <Text style={styles.fieldLabel}>{translate("Ngày đổi ca (YYYY-MM-DD) *")}</Text>
                        <TextInput
                          style={styles.textInputField}
                          value={swapDateInput}
                          onChangeText={setSwapDateInput}
                          placeholder="2026-11-06"
                          placeholderTextColor="#94A3B8"
                        />

                        <Text style={styles.fieldLabel}>{translate("Ca trực đề xuất *")}</Text>
                        <TextInput
                          style={styles.textInputField}
                          value={swapShiftInput}
                          onChangeText={setSwapShiftInput}
                          placeholder="08:00 - 17:00"
                          placeholderTextColor="#94A3B8"
                        />

                        <Text style={styles.fieldLabel}>{translate("Chọn Kỹ thuật viên đổi ca *")}</Text>
                        <TextInput
                          style={styles.textInputField}
                          value={swapTargetTechId}
                          onChangeText={setSwapTargetTechId}
                          placeholder={translate("Nhập ID hoặc tên KTV đối ứng")}
                          placeholderTextColor="#94A3B8"
                        />

                        <Text style={styles.fieldLabel}>{translate("Lý do đổi ca *")}</Text>
                        <TextInput
                          style={[styles.textInputField, { height: 60, textAlignVertical: 'top' }]}
                          value={swapReasonInput}
                          onChangeText={setSwapReasonInput}
                          multiline
                          placeholder={translate("Lý do đổi ca với đồng nghiệp...")}
                          placeholderTextColor="#94A3B8"
                        />

                        <TouchableOpacity
                          style={[styles.primaryActionBtn, { marginTop: 8, backgroundColor: '#0284C7' }]}
                          onPress={handleTechSubmitSwap}
                          disabled={loading}
                        >
                          <Text style={styles.primaryActionBtnText}>{translate("Gửi đề xuất đổi ca")}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Danh sách yêu cầu đã gửi */}
                      <View style={[styles.whiteSectionCard, { marginTop: 12 }]}>
                        <Text style={styles.cardBlockTitle}>{translate("Yêu cầu đã gửi")}</Text>
                        {myScheduleRequests.length === 0 ? (
                          <Text style={styles.techInfoLine}>{translate("Chưa có yêu cầu nào.")}</Text>
                        ) : (
                          myScheduleRequests.map((req) => (
                            <View key={req.id} style={[styles.notiBlueItem, { paddingVertical: 10 }]}>
                              <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  <Text style={{ fontWeight: '700', color: '#0F172A', fontSize: 13.5 }}>
                                    {req.type === 'LEAVE' ? `🏖️ ${translate('Xin nghỉ phép')}` : `🔄 ${translate('Đổi ca')}`} • {req.date}
                                  </Text>
                                </View>
                                <Text style={styles.techNotiBodyText}>{req.reason}</Text>
                                {req.reviewNote && (
                                  <Text style={{ fontSize: 11.5, color: '#64748B', fontStyle: 'italic', marginTop: 2 }}>
                                    BMB: {req.reviewNote}
                                  </Text>
                                )}
                              </View>
                              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                                <View style={[
                                  styles.statusPill,
                                  req.status === 'APPROVED' ? { backgroundColor: '#DCFCE7' } : req.status === 'REJECTED' ? { backgroundColor: '#FEE2E2' } : { backgroundColor: '#FEF3C7' }
                                ]}>
                                  <Text style={[
                                    styles.statusPillText,
                                    req.status === 'APPROVED' ? { color: '#15803D' } : req.status === 'REJECTED' ? { color: '#B91C1C' } : { color: '#B45309' }
                                  ]}>
                                    {req.status === 'APPROVED' ? translate('Đã duyệt') : req.status === 'REJECTED' ? translate('Từ chối') : req.status === 'CANCELLED' ? translate('Đã hủy') : translate('Chờ duyệt')}
                                  </Text>
                                </View>
                                {req.status === 'PENDING' && (
                                  <TouchableOpacity
                                    style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#F1F5F9', borderRadius: 6 }}
                                    onPress={() => handleTechCancelSchedule(req.id)}
                                  >
                                    <Text style={{ fontSize: 11, color: '#DC2626', fontWeight: '600' }}>{translate('Hủy')}</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                          ))
                        )}
                      </View>
                    </>
                  )}
                </ScreenTransition>
              </ScrollView>
            )}
          </ScreenTransition>

          {(techScreen === 'HOME' ||
            techScreen === 'HISTORY' ||
            techScreen === 'NOTI_PROFILE' ||
            techScreen === 'PAYROLL') && (
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
                    {translate("Trang chủ")}</Text>
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
                    {translate("Lịch sử")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.figmaNavTab}
                  onPress={() => setTechScreen('PAYROLL')}
                >
                  <OutlineIcon name="bell" size={21} active={techScreen === 'PAYROLL'} />
                  <Text
                    style={[
                      styles.figmaNavLabel,
                      techScreen === 'PAYROLL' && styles.figmaNavLabelActive,
                    ]}
                  >
                    {translate("Chấm công")}</Text>
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
                    {translate("Hồ sơ")}</Text>
                </TouchableOpacity>
              </View>
            )}
        </View>
        {renderTechCheckInModal()}
        {renderTechExplanationModal()}
        {renderPhotoViewerModal()}
        {renderBmbIncidentPhotoModal()}
      </SafeAreaView>
    );
  }

  // ============================================================================
  // PHÂN HỆ 3: BAN QUẢN LÝ TÒA NHÀ (BMB WEB APPLICATION) — BÁM BỐ CỤC 4 MÀN HÌNH FIGMA BMB
  // ============================================================================
  const bmbPendingCount = tickets.filter((t) => t.status === 'PENDING').length;
  const bmbGuestPendingVerifyCount = tickets.filter(
    (t) => t.isAnonymous && (t.guestVerificationStatus === 'PENDING_VERIFICATION' || (!t.guestVerificationStatus && t.status === 'PENDING' && !t.bmbApprovedById))
  ).length;
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
    if (bmbTicketFilter === 'GUEST_REVIEW') {
      return Boolean(t.isAnonymous);
    }
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
      <View style={[styles.bmbDesktopLayout, isMobileLayout && { flexDirection: 'column' }]}>
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
        {isMobileLayout ? (
          /* THANH ĐIỀU HƯỚNG TRÊN CÙNG & TAB CUỘN NGANG CHO MOBILE / MÀN HÌNH HẸP */
          <View style={{ backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, zIndex: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ResiFixLogoMark size={24} />
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#2563EB', letterSpacing: -0.3 }}>ResiFix BMB</Text>
                <View style={{ backgroundColor: '#EFF6FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, color: '#1D4ED8', fontWeight: '700' }}>Admin</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={handleLogout}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#FEE2E2' }}
              >
                <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#DC2626' }}>🚪 {translate('Đăng xuất')}</Text>
              </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 10, paddingBottom: 2 }}>
              <TouchableOpacity
                style={[{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#F1F5F9' }, bmbNavTab === 'TICKETS' && { backgroundColor: '#2563EB' }]}
                onPress={() => setBmbNavTab('TICKETS')}
              >
                <Text style={[{ fontSize: 12, fontWeight: '600', color: '#475569' }, bmbNavTab === 'TICKETS' && { color: '#FFFFFF', fontWeight: '700' }]}>📋 {translate('Sự cố')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#F1F5F9' }, bmbNavTab === 'TECHNICIANS' && { backgroundColor: '#2563EB' }]}
                onPress={() => setBmbNavTab('TECHNICIANS')}
              >
                <Text style={[{ fontSize: 12, fontWeight: '600', color: '#475569' }, bmbNavTab === 'TECHNICIANS' && { color: '#FFFFFF', fontWeight: '700' }]}>👷 {translate('Kỹ thuật viên')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#F1F5F9' }, bmbNavTab === 'APARTMENTS' && { backgroundColor: '#2563EB' }]}
                onPress={() => setBmbNavTab('APARTMENTS')}
              >
                <Text style={[{ fontSize: 12, fontWeight: '600', color: '#475569' }, bmbNavTab === 'APARTMENTS' && { color: '#FFFFFF', fontWeight: '700' }]}>🏢 {translate('Căn hộ & Cư dân')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#F1F5F9' }, bmbNavTab === 'ATTENDANCE' && { backgroundColor: '#2563EB' }]}
                onPress={() => {
                  setBmbNavTab('ATTENDANCE');
                  void fetchBmbAttendance();
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[{ fontSize: 12, fontWeight: '600', color: '#475569' }, bmbNavTab === 'ATTENDANCE' && { color: '#FFFFFF', fontWeight: '700' }]}>📍 {translate('Chấm công')}</Text>
                  {bmbAttendanceStats.pendingReviewCount > 0 && (
                    <View style={{ backgroundColor: '#EF4444', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>{bmbAttendanceStats.pendingReviewCount}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#F1F5F9' }, bmbNavTab === 'PAYROLL' && { backgroundColor: '#2563EB' }]}
                onPress={() => setBmbNavTab('PAYROLL')}
              >
                <Text style={[{ fontSize: 12, fontWeight: '600', color: '#475569' }, bmbNavTab === 'PAYROLL' && { color: '#FFFFFF', fontWeight: '700' }]}>💰 {translate('Tính lương')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#F1F5F9' }, bmbNavTab === 'NOTIFICATIONS' && { backgroundColor: '#2563EB' }]}
                onPress={() => setBmbNavTab('NOTIFICATIONS')}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[{ fontSize: 12, fontWeight: '600', color: '#475569' }, bmbNavTab === 'NOTIFICATIONS' && { color: '#FFFFFF', fontWeight: '700' }]}>🔔 {translate('Thông báo')}</Text>
                  {unreadCount > 0 && (
                    <View style={{ backgroundColor: '#EF4444', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>{unreadCount}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            </ScrollView>
          </View>
        ) : (
          <View style={styles.bmbSidebar}>
            <ScrollView
              style={styles.bmbSidebarNavigation}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.bmbSidebarBrandRow}>
                <View style={{ marginRight: 9 }}><ResiFixLogoMark size={26} /></View>
                <Text style={styles.bmbSidebarLogoText}>ResiFix BMB</Text>
                <View style={{ flex: 1 }} />
                <RealTimeClock />
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
                <View style={styles.bmbMenuBtnInner}>
                  <Text style={[styles.bmbMenuIcon, bmbNavTab === 'TICKETS' && styles.bmbMenuIconActive]}>📋</Text>
                  <Text
                    style={[
                      styles.bmbMenuBtnText,
                      bmbNavTab === 'TICKETS' && styles.bmbMenuBtnTextActive,
                    ]}
                  >
                    {translate("Quản lý sự cố")}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.bmbMenuBtn,
                  bmbNavTab === 'TECHNICIANS' && styles.bmbMenuBtnActive,
                ]}
                onPress={() => setBmbNavTab('TECHNICIANS')}
              >
                <View style={styles.bmbMenuBtnInner}>
                  <Text style={[styles.bmbMenuIcon, bmbNavTab === 'TECHNICIANS' && styles.bmbMenuIconActive]}>👷</Text>
                  <Text
                    style={[
                      styles.bmbMenuBtnText,
                      bmbNavTab === 'TECHNICIANS' && styles.bmbMenuBtnTextActive,
                    ]}
                  >
                    {translate("Kỹ thuật viên ca trực")}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.bmbMenuBtn,
                  bmbNavTab === 'NOTIFICATIONS' && styles.bmbMenuBtnActive,
                ]}
                onPress={() => setBmbNavTab('NOTIFICATIONS')}
              >
                <View style={styles.rowBetween}>
                  <Text
                    style={[
                      styles.bmbMenuBtnText,
                      bmbNavTab === 'NOTIFICATIONS' && styles.bmbMenuBtnTextActive,
                    ]}
                  >
                    {translate("Thông báo hệ thống")}</Text>
                  {unreadCount > 0 && (
                    <View style={styles.bmbSidebarNewRedTag}>
                      <Text style={styles.bmbSidebarNewRedText}>
                        {unreadCount}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.bmbMenuBtn,
                  bmbNavTab === 'APARTMENTS' && styles.bmbMenuBtnActive,
                ]}
                onPress={() => setBmbNavTab('APARTMENTS')}
              >
                <View style={styles.bmbMenuBtnInner}>
                  <Text style={[styles.bmbMenuIcon, bmbNavTab === 'APARTMENTS' && styles.bmbMenuIconActive]}>🏢</Text>
                  <Text
                    style={[
                      styles.bmbMenuBtnText,
                      bmbNavTab === 'APARTMENTS' && styles.bmbMenuBtnTextActive,
                    ]}
                  >
                    {translate("Căn hộ & Cư dân")}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.bmbMenuBtn,
                  bmbNavTab === 'ATTENDANCE' && styles.bmbMenuBtnActive,
                ]}
                onPress={() => {
                  setBmbNavTab('ATTENDANCE');
                  void fetchBmbAttendance();
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <Text
                    style={[
                      styles.bmbMenuBtnText,
                      bmbNavTab === 'ATTENDANCE' && styles.bmbMenuBtnTextActive,
                    ]}
                  >
                    {translate("Quản lý chấm công")}
                  </Text>
                  {bmbAttendanceStats.pendingReviewCount > 0 && (
                    <View style={{ backgroundColor: '#EF4444', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 }}>
                      <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>
                        {bmbAttendanceStats.pendingReviewCount}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.bmbMenuBtn,
                  bmbNavTab === 'PAYROLL' && styles.bmbMenuBtnActive,
                ]}
                onPress={() => setBmbNavTab('PAYROLL')}
              >
                <View style={styles.bmbMenuBtnInner}>
                  <Text style={[styles.bmbMenuIcon, bmbNavTab === 'PAYROLL' && styles.bmbMenuIconActive]}>💰</Text>
                  <Text
                    style={[
                      styles.bmbMenuBtnText,
                      bmbNavTab === 'PAYROLL' && styles.bmbMenuBtnTextActive,
                    ]}
                  >
                    {translate("Tính lương & Vận hành")}
                  </Text>
                </View>
              </TouchableOpacity>
            </ScrollView>

            {/* Footer Sidebar: Tòa nhà đang quản lý + BMB: Cầm Dương Mỹ Hạnh + Đăng xuất */}
            <View>
              <View style={styles.bmbBuildingStatusBox}>
                <Text style={styles.bmbBuildingSmallLabel}>{translate("TÒA NHÀ ĐANG QUẢN LÝ")}</Text>
                <Text style={styles.bmbBuildingName}>ResiFix Residence</Text>
                <Text style={styles.bmbBuildingOnline}>{translate("Hệ thống hoạt động")}</Text>
              </View>

              <View style={styles.bmbAdminFooter}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, overflow: 'hidden' }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 12 }}>
                      {(user.fullName || 'BMB').split(' ').map((n: string) => n[0]).slice(-2).join('')}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bmbAdminNameText} numberOfLines={1}>
                      {user.fullName || translate('Chưa cập nhật hồ sơ')}
                    </Text>
                    <Text style={{ fontSize: 10.5, color: '#64748B' }}>
                      {translate("Ban Quản trị BMB")}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    handleLogout();
                  }}
                  style={{ paddingVertical: 4, paddingHorizontal: 6 }}
                >
                  <Text style={styles.bmbSidebarLogoutText}>{translate("Đăng xuất")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* ==================================================================== */}
        {/* MÀN HÌNH 01 BMB: QUẢN LÝ SỰ CỐ (DANH SÁCH GIỮA + CHI TIẾT AI PHẢI)   */}
        {/* ==================================================================== */}
        <ScreenTransition transitionKey={bmbNavTab} style={{ flex: 1, flexDirection: isMobileLayout ? 'column' : 'row' }}>
          {bmbNavTab === 'TICKETS' && (
            <View style={[styles.bmbContentTwoCols, isMobileLayout && { flexDirection: 'column', padding: 12, gap: 12 }]}>
              {/* CỘT GIỮA: DANH SÁCH SỰ CỐ TÒA NHÀ - HIỂN THỊ KHI DESKTOP HOẶC CHƯA CHỌN TICKET */}
              {(!isMobileLayout || !bmbSelectedTicket) && (
                <ScrollView
                  style={[styles.bmbCenterColumn, isMobileLayout && { flex: 1 }]}
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
                    <View style={styles.rowCenter}>
                      <RealTimeClock style={{ marginRight: 8 }} />
                      <Text style={styles.bmbDateLabel}>{new Date().toLocaleDateString('vi-VN')}</Text>
                    </View>
                  </View>

                  {/* 4 Thẻ KPI */}
                  <View style={styles.bmbKpiRow}>
                    <StaggeredCardEntrance index={0} style={{ flex: 1 }}>
                      <View style={styles.bmbKpiCard}>
                        <Text style={styles.bmbKpiLabel}>{translate("Chờ duyệt AI")}</Text>
                        <Text style={[styles.bmbKpiNumber, { color: '#EA580C' }]}>
                          {String(bmbPendingCount).padStart(2, '0')}
                        </Text>
                      </View>
                    </StaggeredCardEntrance>

                    <StaggeredCardEntrance index={1} style={{ flex: 1 }}>
                      <View style={styles.bmbKpiCard}>
                        <Text style={styles.bmbKpiLabel}>{translate("Đã phân công")}</Text>
                        <Text style={[styles.bmbKpiNumber, { color: '#2563EB' }]}>
                          {String(bmbAssignedCount).padStart(2, '0')}
                        </Text>
                      </View>
                    </StaggeredCardEntrance>

                    <StaggeredCardEntrance index={2} style={{ flex: 1 }}>
                      <View style={styles.bmbKpiCard}>
                        <Text style={styles.bmbKpiLabel}>{translate("Đang xử lý")}</Text>
                        <Text style={[styles.bmbKpiNumber, { color: '#4F46E5' }]}>
                          {String(bmbInProgressCount).padStart(2, '0')}
                        </Text>
                      </View>
                    </StaggeredCardEntrance>

                    <StaggeredCardEntrance index={3} style={{ flex: 1 }}>
                      <View style={styles.bmbKpiCard}>
                        <Text style={styles.bmbKpiLabel}>{translate("Hoàn thành/Đóng")}</Text>
                        <Text style={[styles.bmbKpiNumber, { color: '#16A34A' }]}>
                          {bmbCompletedCount + bmbClosedCount}
                        </Text>
                      </View>
                    </StaggeredCardEntrance>
                  </View>

                  {/* Thanh tìm kiếm */}
                  <View style={styles.searchBarBox}>
                    <TextInput
                      style={styles.searchBarInput}
                      placeholder={translate("Tìm mã sự cố, căn hộ hoặc thiết bị...")}
                      placeholderTextColor="#94A3B8"
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                    />
                  </View>

                  {/* Hàng lọc trạng thái */}
                  <View style={styles.chipWrapRow}>
                    {[
                      { key: 'ALL', label: `${translate('Tất cả')} (${tickets.length})` },
                      {
                        key: 'PENDING',
                        label: `${translate('Chờ duyệt AI')} (${bmbPendingCount})`,
                      },
                      {
                        key: 'GUEST_REVIEW',
                        label: `👤 ${translate('Duyệt khách vãng lai')} (${bmbGuestPendingVerifyCount})`,
                      },
                      {
                        key: 'ASSIGNED',
                        label: `${translate('Đã phân công')} (${bmbAssignedCount})`,
                      },
                      {
                        key: 'IN_PROGRESS',
                        label: `${translate('Đang xử lý')} (${bmbInProgressCount})`,
                      },
                      {
                        key: 'COMPLETED',
                        label: `${translate('Hoàn thành')} (${bmbCompletedCount})`,
                      },
                      { key: 'CLOSED', label: `${translate('Đã đóng')} (${bmbClosedCount})` },
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
                          {tab.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={[styles.cardTopRow, { marginVertical: 8 }]}>
                    <Text style={{ fontWeight: '700', color: '#0F172A', fontSize: 13.5 }}>
                      {translate("Tất cả sự cố (")}{filteredBmbTickets.length})
                    </Text>
                    <Text style={{ color: '#64748B', fontSize: 12.5 }}>{translate("Mới nhất trước")}</Text>
                  </View>

                  {/* Danh sách Thẻ Sự cố */}
                  {filteredBmbTickets.map((t, idx) => {
                    const isSelected = bmbSelectedTicket?.id === t.id;
                    const isPending = t.status === 'PENDING';
                    const isAssigned = t.status === 'ASSIGNED';
                    const isHigh =
                      (t.finalPriority || t.aiSuggestedPriority) === 'HIGH';
                    const isAnalyzing = t.aiStatus === 'ANALYZING';
                    const isManualReview =
                      t.aiStatus === 'MANUAL_REVIEW' ||
                      (!isAnalyzing && (t.isAiFallbackManual || !t.aiSuggestedCategory));

                    return (
                      <StaggeredCardEntrance key={t.id} index={idx}>
                        <TouchableOpacity
                          style={[
                            styles.resTicketCard,
                            isSelected && { borderColor: '#2563EB', borderWidth: 2 },
                          ]}
                          onPress={() => handleSelectBmbTicket(t)}
                        >
                        <View style={styles.cardTopRow}>
                          <View style={[styles.rowCenter, { flexWrap: 'wrap', gap: 4 }]}>
                            <Text
                              style={[
                                styles.cardCodeText,
                                isSelected && { color: '#2563EB', fontWeight: '800' },
                              ]}
                            >
                              {t.ticketCode}
                            </Text>
                            {t.isAnonymous && (
                              <View style={{ backgroundColor: '#F1F5F9', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#CBD5E1' }}>
                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#475569' }}>👤 {translate('Ẩn danh')}</Text>
                              </View>
                            )}
                            {t.locationVerificationStatus === 'VERIFIED' ? (
                              <View style={{ backgroundColor: '#ECFDF5', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#A7F3D0' }}>
                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#059669' }}>📍 {translate('Đã xác minh vị trí')}</Text>
                              </View>
                            ) : t.locationVerificationStatus === 'UNVERIFIED' ? (
                              <View style={{ backgroundColor: '#FFFBEB', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, borderWidth: 1, borderColor: '#FDE68A' }}>
                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#D97706' }}>⚠️ {translate('Chưa xác minh vị trí')}</Text>
                              </View>
                            ) : null}
                            {isHigh && (
                              <Text style={styles.bmbUrgentInlineDot}> {translate("Khẩn cấp")}</Text>
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
                        <Text style={styles.cardLocationText}>{t.locationNote}</Text>

                        <View style={[styles.cardTopRow, { marginTop: 10, marginBottom: 0 }]}>
                          {isAnalyzing ? (
                            <View style={{ backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#2563EB' }}>
                                ⏳ {translate("Đang phân tích")}
                              </Text>
                            </View>
                          ) : isManualReview && !t.finalCategory ? (
                            <View style={styles.bmbAiTimeoutTag}>
                              <Text style={styles.bmbAiTimeoutText}>
                                ⚠️ {translate("Cần đánh giá thủ công")}</Text>
                            </View>
                          ) : (
                            <View style={styles.bmbAiPurpleMiniTag}>
                              <Text style={styles.bmbAiPurpleMiniText}>
                                {translate(t.finalCategory ? "BMB đã duyệt" : "Gemini:")}{' '}
                                {translate(CATEGORY_SHORT_VN[
                                  t.finalCategory || t.aiSuggestedCategory
                                ] || 'Điện - Nước')}
                              </Text>
                            </View>
                          )}
                          <Text style={{ fontSize: 11.5, color: '#64748B' }}>
                            {formatDateTime(t.createdAt)}</Text>
                        </View>
                      </TouchableOpacity>
                    </StaggeredCardEntrance>
                  );
                })}

                  {/* Thanh phân trang */}
                  <View style={[styles.cardTopRow, { marginTop: 8, paddingBottom: 24 }]}>
                    <Text style={{ fontSize: 12, color: '#64748B' }}>
                      {translate("Hiển thị ")}{filteredBmbTickets.length} {translate("trong tổng số ")}{tickets.length} {translate("sự cố")}</Text>
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
              )}

              {/* CỘT PHẢI: CHI TIẾT SỰ CỐ & TRỢ LÝ QUYẾT ĐỊNH GEMINI FLASH AI */}
              {(!isMobileLayout || bmbSelectedTicket) && (
                <ScrollView
                  style={[styles.bmbRightInspector, isMobileLayout && { flex: 1, borderRadius: 10, padding: 14 }]}
                  showsVerticalScrollIndicator={false}
                >
                  {bmbSelectedTicket ? (
                    <View>
                      {isMobileLayout && (
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#EFF6FF', borderRadius: 8, alignSelf: 'flex-start' }}
                          onPress={() => setBmbSelectedTicket(null)}
                        >
                          <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#2563EB' }}>
                            ← {translate('Quay lại danh sách sự cố')}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <View style={styles.cardTopRow}>
                        <Text style={styles.bmbInspectorTitle}>
                          {translate("Chi tiết sự cố ")}{bmbSelectedTicket.ticketCode}
                        </Text>
                        <TouchableOpacity onPress={() => setBmbSelectedTicket(null)}>
                          <Text style={{ fontSize: 18, color: '#64748B', fontWeight: '700', padding: 4 }}>✕</Text>
                        </TouchableOpacity>
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
                          {formatDateTime(bmbSelectedTicket.createdAt)}</Text>
                      </View>

                      <Text style={styles.bmbSmallSectionHead}>
                        {bmbSelectedTicket.isAnonymous
                          ? translate("DUYỆT BÁO CÁO KHÁCH VÃNG LAI (XÁC MINH QR & GPS)")
                          : translate("THÔNG TIN CƯ DÂN PHẢN ÁNH")}
                      </Text>

                      {bmbSelectedTicket.isAnonymous ? (
                        (() => {
                          const gv = bmbSelectedTicket.guestVerification || {};
                          const gvStatus: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' =
                            bmbSelectedTicket.guestVerificationStatus ||
                            gv.guestVerificationStatus ||
                            (bmbSelectedTicket.bmbAdminNote?.startsWith('[TỪ CHỐI')
                              ? 'REJECTED'
                              : bmbSelectedTicket.status !== 'PENDING' || bmbSelectedTicket.bmbApprovedById
                                ? 'VERIFIED'
                                : 'PENDING_VERIFICATION');
                          const qrTypeLabel =
                            gv.qrType === 'APARTMENT' || bmbSelectedTicket.locationNote?.includes('ROOM:') || bmbSelectedTicket.locationNote?.includes('Căn hộ')
                              ? 'QR Căn hộ'
                              : 'QR Khu vực chung';
                          const anomalyList: string[] = Array.isArray(gv.anomalyFlags) ? gv.anomalyFlags : [];

                          return (
                            <View style={{
                              backgroundColor: gvStatus === 'REJECTED' ? '#FEF2F2' : gvStatus === 'VERIFIED' ? '#F0FDF4' : '#FFFBEB',
                              borderWidth: 1.5,
                              borderColor: gvStatus === 'REJECTED' ? '#FCA5A5' : gvStatus === 'VERIFIED' ? '#86EFAC' : '#FCD34D',
                              borderRadius: 10,
                              padding: 12,
                              marginTop: 6,
                              marginBottom: 10,
                            }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                                <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#0F172A' }}>
                                  👤 {translate("Khách vãng lai")} • {translate(qrTypeLabel)}
                                </Text>
                                <View style={{
                                  backgroundColor: gvStatus === 'REJECTED' ? '#FEE2E2' : gvStatus === 'VERIFIED' ? '#DCFCE7' : '#FEF3C7',
                                  paddingHorizontal: 8,
                                  paddingVertical: 2.5,
                                  borderRadius: 6,
                                  borderWidth: 1,
                                  borderColor: gvStatus === 'REJECTED' ? '#F87171' : gvStatus === 'VERIFIED' ? '#4ADE80' : '#FBBF24',
                                }}>
                                  <Text style={{
                                    fontSize: 11,
                                    fontWeight: '800',
                                    color: gvStatus === 'REJECTED' ? '#B91C1C' : gvStatus === 'VERIFIED' ? '#15803D' : '#B45309',
                                  }}>
                                    {gvStatus === 'REJECTED'
                                      ? `✕ ${translate('Đã từ chối báo cáo')}`
                                      : gvStatus === 'VERIFIED'
                                        ? `✓ ${translate('BMB đã xác minh hợp lệ')}`
                                        : `⏳ ${translate('Chờ BMB xác minh')}`}
                                  </Text>
                                </View>
                              </View>

                              <Text style={{ fontSize: 12, color: '#334155', marginBottom: 3 }}>
                                🕒 <Text style={{ fontWeight: '700' }}>{translate('Thời gian gửi:')}</Text> {formatDateTime(bmbSelectedTicket.createdAt)}
                                {gv.capturedAt ? ` • 📷 Chụp lúc: ${formatDateTime(gv.capturedAt)}` : ''}
                              </Text>
                              <Text style={{ fontSize: 12, color: '#334155', marginBottom: 3 }}>
                                🏷️ <Text style={{ fontWeight: '700' }}>{translate('Mã QR & Loại:')}</Text> {gv.qrCode || bmbSelectedTicket.area?.qrCode || 'QR ResiFix'} ({translate(qrTypeLabel)})
                              </Text>
                              <Text style={{ fontSize: 12, color: '#334155', marginBottom: 3 }}>
                                📍 <Text style={{ fontWeight: '700' }}>{translate('Trạng thái GPS:')}</Text>{' '}
                                {bmbSelectedTicket.locationVerificationStatus === 'VERIFIED' ? '✓ Đã xác minh trong tòa nhà' : '⚠️ Cần kiểm tra vị trí'}{' '}
                                {typeof gv.gpsLatitude === 'number' && typeof gv.gpsLongitude === 'number'
                                  ? `(${gv.gpsLatitude.toFixed(5)}, ${gv.gpsLongitude.toFixed(5)})`
                                  : ''}
                                {gv.gpsAccuracy ? ` • Sai số ±${gv.gpsAccuracy}m` : ''}
                                {gv.distanceMeters !== null && gv.distanceMeters !== undefined ? ` • Cách tâm ~${gv.distanceMeters}m` : ''}
                              </Text>
                              <Text style={{ fontSize: 11.5, color: '#475569', fontStyle: 'italic' }}>
                                {bmbSelectedTicket.locationVerificationReason || translate("Đã ghi nhận dữ liệu vị trí từ thiết bị khách vãng lai.")}
                              </Text>

                              {anomalyList.length > 0 && (
                                <View style={{ backgroundColor: '#FEF2F2', borderRadius: 6, padding: 8, marginTop: 6, borderWidth: 1, borderColor: '#FECACA' }}>
                                  <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#B91C1C' }}>
                                    ⚠️ {translate('Dấu hiệu cần lưu ý:')} {anomalyList.join(' • ')}
                                  </Text>
                                </View>
                              )}

                              {gvStatus === 'VERIFIED' && gv.verifiedByName && (
                                <Text style={{ fontSize: 11.5, color: '#15803D', marginTop: 6, fontWeight: '600' }}>
                                  ✓ {translate('Người duyệt:')} {gv.verifiedByName} ({formatDateTime(gv.verifiedAt)})
                                </Text>
                              )}

                              {gvStatus === 'REJECTED' && (
                                <View style={{ backgroundColor: '#FFFFFF', borderRadius: 6, padding: 8, marginTop: 6, borderWidth: 1, borderColor: '#FCA5A5' }}>
                                  <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#B91C1C' }}>
                                    ✕ {translate('Lý do từ chối:')} {gv.rejectionReason || bmbSelectedTicket.bmbAdminNote || 'Không đạt yêu cầu xác minh'}
                                  </Text>
                                  {gv.verifiedByName && (
                                    <Text style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                                      {translate('Người từ chối:')} {gv.verifiedByName} • {formatDateTime(gv.verifiedAt)}
                                    </Text>
                                  )}
                                </View>
                              )}

                              {/* Hai nút hành động BMB: Duyệt báo cáo / Từ chối báo cáo */}
                              {gvStatus === 'PENDING_VERIFICATION' && (
                                <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#FDE68A' }}>
                                  <View style={{ flexDirection: 'row', gap: 8 }}>
                                    <TouchableOpacity
                                      style={{
                                        flex: 1,
                                        backgroundColor: '#16A34A',
                                        paddingVertical: 9,
                                        borderRadius: 8,
                                        alignItems: 'center',
                                        opacity: bmbGuestVerifyBusy ? 0.6 : 1,
                                      }}
                                      onPress={() => handleBmbVerifyGuestReport(bmbSelectedTicket.id, 'APPROVE')}
                                      disabled={bmbGuestVerifyBusy}
                                    >
                                      <Text style={{ color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' }}>
                                        ✓ {translate('Duyệt báo cáo hợp lệ')}
                                      </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                      style={{
                                        flex: 1,
                                        backgroundColor: '#DC2626',
                                        paddingVertical: 9,
                                        borderRadius: 8,
                                        alignItems: 'center',
                                        opacity: bmbGuestVerifyBusy ? 0.6 : 1,
                                      }}
                                      onPress={() => setShowBmbGuestRejectInput((prev) => !prev)}
                                      disabled={bmbGuestVerifyBusy}
                                    >
                                      <Text style={{ color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' }}>
                                        ✕ {translate('Từ chối báo cáo')}
                                      </Text>
                                    </TouchableOpacity>
                                  </View>

                                  {showBmbGuestRejectInput && (
                                    <View style={{ marginTop: 8, backgroundColor: '#FFFFFF', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5' }}>
                                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#B91C1C', marginBottom: 4 }}>
                                        {translate('Nhập lý do từ chối báo cáo khách vãng lai *')}
                                      </Text>
                                      <TextInput
                                        style={[styles.bmbWebInput, { marginBottom: 8, fontSize: 12.5 }]}
                                        value={bmbGuestRejectReason}
                                        onChangeText={setBmbGuestRejectReason}
                                        placeholder={translate('VD: Ảnh chụp mờ không rõ thiết bị, vị trí GPS ngoài tòa nhà...')}
                                        placeholderTextColor="#94A3B8"
                                      />
                                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                                        <TouchableOpacity
                                          style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#F1F5F9' }}
                                          onPress={() => {
                                            setShowBmbGuestRejectInput(false);
                                            setBmbGuestRejectReason('');
                                          }}
                                        >
                                          <Text style={{ fontSize: 12, color: '#475569', fontWeight: '600' }}>{translate('Hủy')}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                          style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6, backgroundColor: '#DC2626' }}
                                          onPress={() => handleBmbVerifyGuestReport(bmbSelectedTicket.id, 'REJECT')}
                                          disabled={bmbGuestVerifyBusy}
                                        >
                                          <Text style={{ fontSize: 12, color: '#FFFFFF', fontWeight: '700' }}>
                                            {translate('Xác nhận Từ chối')}
                                          </Text>
                                        </TouchableOpacity>
                                      </View>
                                    </View>
                                  )}
                                </View>
                              )}
                            </View>
                          );
                        })()
                      ) : null}

                      <View style={[styles.cardTopRow, { marginTop: 6 }]}>
                        <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#0F172A', flex: 1 }}>
                          {bmbSelectedTicket.locationNote}
                        </Text>
                        <View style={styles.qrVerifiedPill}>
                          <Text style={styles.qrVerifiedPillText}>{translate("Đã xác thực QR")}</Text>
                        </View>
                      </View>

                      <Text style={styles.bmbInspectorDesc}>
                        {bmbSelectedTicket.description}
                      </Text>

                      {/* KHU VỰC ẢNH HIỆN TRƯỜNG (CHỈ LẤY ẢNH SCENE_BEFORE BAN ĐẦU) */}
                      {(() => {
                        const residentMedia = getResidentReportedMedia(bmbSelectedTicket);

                        return (
                          <View style={{ marginVertical: 12 }}>
                            <View style={[styles.cardTopRow, { marginBottom: 8 }]}>
                              <Text style={styles.bmbSmallSectionHead}>
                                {translate("ẢNH HIỆN TRƯỜNG")}
                              </Text>
                              {residentMedia.length > 0 && (
                                <View style={[styles.statusPill, { backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 2 }]}>
                                  <Text style={[styles.statusPillText, { color: '#2563EB', fontWeight: '700', fontSize: 11.5 }]}>
                                    {residentMedia.length} {translate("ảnh")}
                                  </Text>
                                </View>
                              )}
                            </View>

                            {residentMedia.length === 0 ? (
                              <View style={{
                                backgroundColor: '#F8FAFC',
                                borderWidth: 1,
                                borderColor: '#E2E8F0',
                                borderRadius: 8,
                                paddingVertical: 12,
                                paddingHorizontal: 14,
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 10,
                              }}>
                                <Text style={{ fontSize: 18 }}>📷</Text>
                                <Text style={{ fontSize: 13, color: '#64748B', fontStyle: 'italic' }}>
                                  {translate("Chưa có ảnh hiện trường.")}
                                </Text>
                              </View>
                            ) : (
                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                                {residentMedia.map((item, idx) => (
                                  <TouchableOpacity
                                    key={item.id || idx}
                                    style={{
                                      width: 76,
                                      height: 76,
                                      borderRadius: 8,
                                      borderWidth: 1.5,
                                      borderColor: '#CBD5E1',
                                      overflow: 'hidden',
                                      backgroundColor: '#F1F5F9',
                                      position: 'relative',
                                    }}
                                    activeOpacity={0.8}
                                    onPress={() => openReportedPhoto(residentMedia, idx)}
                                  >
                                    {failedPhotoUrls[item.url] ? (
                                      <View style={{ flex: 1, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', padding: 4 }}>
                                        <Text style={{ fontSize: 16 }}>⚠️</Text>
                                        <Text style={{ fontSize: 9, color: '#DC2626', textAlign: 'center', fontWeight: '600' }}>
                                          {translate("Lỗi tải ảnh")}
                                        </Text>
                                      </View>
                                    ) : (
                                      <Image
                                        source={{ uri: item.url }}
                                        style={{ width: '100%', height: '100%' }}
                                        resizeMode="cover"
                                        onError={() => setFailedPhotoUrls((prev) => ({ ...prev, [item.url]: true }))}
                                      />
                                    )}
                                    <View style={{
                                      position: 'absolute',
                                      bottom: 3,
                                      right: 3,
                                      backgroundColor: 'rgba(15, 23, 42, 0.72)',
                                      borderRadius: 4,
                                      paddingHorizontal: 4,
                                      paddingVertical: 1,
                                    }}>
                                      <Text style={{ color: '#FFFFFF', fontSize: 9.5, fontWeight: '700' }}>
                                        🔍 {idx + 1}
                                      </Text>
                                    </View>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            )}
                          </View>
                        );
                      })()}

                      {/* TIẾN ĐỘ XỬ LÝ SỰ CỐ & SLA (BMB INSPECTOR) */}
                      {renderIncidentProgressTimeline(bmbSelectedTicket, 'BMB')}

                      {bmbSelectedTicket.hasArrivedOnSite && bmbSelectedTicket.arrivalPhotoUrl ? (
                        <View style={[styles.whiteSectionCard, { marginTop: 10 }]}>
                          <Text style={styles.cardBlockTitle}>📍 {translate('Xác nhận KTV đến hiện trường')}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <TouchableOpacity
                              onPress={() =>
                                setViewingPhotoModal({
                                  url: bmbSelectedTicket.arrivalPhotoUrl,
                                  title: translate('Ảnh KTV xác nhận tại hiện trường'),
                                  meta: {
                                    techName: bmbSelectedTicket.assignedTech?.fullName || 'KTV',
                                    time: bmbSelectedTicket.arrivedAt,
                                  },
                                })
                              }
                            >
                              <Image
                                source={{ uri: bmbSelectedTicket.arrivalPhotoUrl }}
                                style={{ width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1' }}
                              />
                            </TouchableOpacity>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#0F172A' }}>
                                👷 {bmbSelectedTicket.assignedTech?.fullName || 'KTV'}
                              </Text>
                              {bmbSelectedTicket.arrivedAt ? (
                                <Text style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                                  🕒 {translate('Đến lúc:')} {formatDateTime(bmbSelectedTicket.arrivedAt)}
                                </Text>
                              ) : null}
                              {(() => {
                                const fromIso = bmbSelectedTicket.assignedAt || bmbSelectedTicket.bmbApprovedAt;
                                const toIso = bmbSelectedTicket.arrivedAt;
                                if (!fromIso || !toIso) return null;
                                const mins = Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000);
                                if (isNaN(mins) || mins < 0) return null;
                                return (
                                  <Text style={{ fontSize: 12, fontWeight: '700', marginTop: 2, color: mins <= 15 ? '#15803D' : '#B91C1C' }}>
                                    ⏱️ {translate('Phản hồi')} {mins} {translate('phút')}{' '}
                                    {mins <= 15 ? translate('(Đúng giờ ≤ 15p)') : `(${translate('Trễ')} ${mins - 15} ${translate('phút')})`}
                                  </Text>
                                );
                              })()}
                            </View>
                          </View>
                        </View>
                      ) : null}

                      {/* HỘP GỢI Ý TỪ GEMINI FLASH AI */}
                      <View style={styles.bmbGeminiPurpleCard}>
                        <View style={styles.cardTopRow}>
                          <Text style={styles.bmbGeminiCardTitle}>
                            {translate(
                              bmbSelectedTicket.aiStatus === 'ANALYZING'
                                ? "Trợ lý AI Gemini"
                                : bmbSelectedTicket.aiStatus === 'MANUAL_REVIEW' || bmbSelectedTicket.isAiFallbackManual
                                  ? "Phân loại sự cố"
                                  : "Gợi ý phân loại từ Gemini"
                            )}
                          </Text>
                          <View
                            style={[
                              styles.bmbLatencyGreenPill,
                              bmbSelectedTicket.aiStatus === 'ANALYZING' && {
                                backgroundColor: '#EFF6FF',
                                borderColor: '#BFDBFE',
                              },
                              (bmbSelectedTicket.aiStatus === 'MANUAL_REVIEW' ||
                                bmbSelectedTicket.isAiFallbackManual) && {
                                backgroundColor: '#FEF2F2',
                                borderColor: '#FECACA',
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.bmbLatencyGreenText,
                                bmbSelectedTicket.aiStatus === 'ANALYZING' && { color: '#2563EB' },
                                (bmbSelectedTicket.aiStatus === 'MANUAL_REVIEW' ||
                                  bmbSelectedTicket.isAiFallbackManual) && { color: '#DC2626' },
                              ]}
                            >
                              {translate(
                                bmbSelectedTicket.aiStatus === 'ANALYZING'
                                  ? "Đang phân tích"
                                  : bmbSelectedTicket.aiStatus === 'MANUAL_REVIEW' ||
                                    bmbSelectedTicket.isAiFallbackManual ||
                                    !bmbSelectedTicket.aiSuggestedCategory
                                    ? "Cần đánh giá thủ công"
                                    : "Đã phân tích"
                              )}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.bmbAiSummaryBullet}>
                          {translate("Tóm tắt: ")}
                          {bmbSelectedTicket.aiStatus === 'ANALYZING'
                            ? translate("AI đang phân tích mô tả và ảnh hiện trường trong nền. BMB có thể phân loại và giao việc ngay mà không cần chờ AI.")
                            : bmbSelectedTicket.aiSummary?.replace(/^\[Trợ lý AI ResiFix\]\s*/, '') ||
                            bmbSelectedTicket.description ||
                            bmbSelectedTicket.title}
                        </Text>

                        {bmbSelectedTicket.aiDiscrepancyNotes && (
                          <View style={{ backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 8, padding: 8, marginTop: 8 }}>
                            <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#B45309' }}>
                              ⚠️ {translate("Điểm mâu thuẫn / Cần kiểm tra:")}
                            </Text>
                            <Text style={{ fontSize: 11.5, color: '#92400E', marginTop: 2 }}>
                              {bmbSelectedTicket.aiDiscrepancyNotes}
                            </Text>
                          </View>
                        )}

                        {bmbSelectedTicket.aiSuggestedCategory && bmbSelectedTicket.aiSuggestedPriority && (
                          <Text style={styles.bmbRiskR1Hint}>
                            {translate("Gợi ý ban đầu")} · {translate(CATEGORY_VN[bmbSelectedTicket.aiSuggestedCategory])} · {translate(PRIORITY_VN[bmbSelectedTicket.aiSuggestedPriority])}
                          </Text>
                        )}

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
                            {translate(CATEGORY_VN[bmbCategory] || 'Hệ thống Điện - Nước')}
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
                          <Text style={{ color: bmbPriority === 'HIGH' ? '#DC2626' : '#64748B' }}>⌄</Text>
                        </TouchableOpacity>

                        <Text style={styles.bmbRiskR1Hint}>
                          {translate("BMB có thể điều chỉnh gợi ý của AI trước khi duyệt.")}
                        </Text>
                      </View>

                      {/* GỢI Ý KỸ THUẬT VIÊN THEO CHUYÊN MÔN & KHOẢNG CÁCH */}
                      <View style={{ marginTop: 14, marginBottom: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <Text style={[styles.fieldLabel, { marginTop: 0, marginBottom: 0 }]}>
                            {translate("Kỹ thuật viên gợi ý")}
                          </Text>
                          {loadingSuggestions && (
                            <Text style={{ fontSize: 11, color: '#64748B' }}>
                              {translate("Đang tìm KTV phù hợp...")}
                            </Text>
                          )}
                        </View>

                        {!bmbCategory ? (
                          <Text style={{ fontSize: 12, color: '#64748B', fontStyle: 'italic', marginBottom: 6 }}>
                            {translate("Chọn danh mục để xem gợi ý kỹ thuật viên")}
                          </Text>
                        ) : suggestedTechnicians.length > 0 ? (
                          <View style={{ gap: 8, marginBottom: 8 }}>
                            {suggestedTechnicians.map((tech: any) => {
                              const isSelected = bmbTechId === tech.id;
                              return (
                                <TouchableOpacity
                                  key={tech.id}
                                  onPress={() => setBmbTechId(tech.id)}
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: 10,
                                    borderRadius: 8,
                                    borderWidth: 1.5,
                                    borderColor: isSelected ? '#2563EB' : '#E2E8F0',
                                    backgroundColor: isSelected ? '#EFF6FF' : '#F8FAFC',
                                  }}
                                >
                                  <View style={{ flex: 1, marginRight: 8 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      <Text style={{ fontSize: 13, fontWeight: '700', color: isSelected ? '#1E40AF' : '#1E293B' }}>
                                        {tech.fullName}
                                      </Text>
                                      <View style={{ backgroundColor: '#DBEAFE', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                                        <Text style={{ fontSize: 10.5, fontWeight: '600', color: '#1E40AF' }}>
                                          {tech.specialtyLabel || tech.specialty}
                                        </Text>
                                      </View>
                                    </View>
                                    <Text style={{ fontSize: 11.5, color: isSelected ? '#1D4ED8' : '#64748B', marginTop: 3 }}>
                                      {tech.reason}
                                    </Text>
                                  </View>
                                  <View style={{
                                    paddingHorizontal: 8,
                                    paddingVertical: 4,
                                    borderRadius: 6,
                                    backgroundColor: isSelected ? '#2563EB' : '#FFFFFF',
                                    borderWidth: 1,
                                    borderColor: isSelected ? '#2563EB' : '#CBD5E1',
                                  }}>
                                    <Text style={{ fontSize: 11, fontWeight: '700', color: isSelected ? '#FFFFFF' : '#475569' }}>
                                      {isSelected ? translate('✓ Đang chọn') : translate('Chọn')}
                                    </Text>
                                  </View>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        ) : suggestionsMessage ? (
                          <Text style={{ fontSize: 12, color: '#64748B', fontStyle: 'italic', marginBottom: 6 }}>
                            {suggestionsMessage}
                          </Text>
                        ) : null}
                      </View>

                      {/* Phân công Kỹ thuật viên đang trực */}
                      <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                        {translate("Phân công kỹ thuật viên")}
                      </Text>
                      {(() => {
                        const selTech = technicians.find((x) => x.id === bmbTechId) || technicians[0];
                        const isSelTechEligible = Boolean(
                          selTech &&
                          selTech.isEligibleForAssignment !== false &&
                          selTech.isOnDuty &&
                          selTech.isCheckedIn &&
                          !selTech.isCheckedOut &&
                          !selTech.onLeave
                        );
                        return (
                          <>
                            <TouchableOpacity
                              style={[
                                styles.bmbDropdownBox,
                                !isSelTechEligible && { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
                              ]}
                              onPress={() => {
                                if (technicians.length > 0) {
                                  const idx = technicians.findIndex((x) => x.id === bmbTechId);
                                  const nextTech = technicians[(idx + 1) % technicians.length];
                                  if (nextTech) setBmbTechId(nextTech.id);
                                }
                              }}
                            >
                              <Text style={[styles.bmbDropdownValue, !isSelTechEligible && { color: '#DC2626' }]}>
                                {selTech?.fullName || (technicians.length > 0 ? technicians[0]?.fullName : translate('Chưa có KTV'))}{' '}
                                ({selTech?.shiftName || 'Ca sáng'})
                                {!isSelTechEligible ? ' [Ngoài ca / Đã kết thúc]' : ' [Đang trực]'}
                              </Text>
                              <Text style={{ color: !isSelTechEligible ? '#DC2626' : '#64748B' }}>⌄</Text>
                            </TouchableOpacity>

                            {!isSelTechEligible && (
                              <Text style={{ fontSize: 11.5, color: '#DC2626', marginTop: 4, fontWeight: '600' }}>
                                ⚠️ Kỹ thuật viên đã kết thúc ca hoặc không còn trực. Vui lòng chọn kỹ thuật viên khác.
                              </Text>
                            )}

                            <View style={[styles.techDivider, { marginTop: 16 }]} />

                            {(() => {
                              const gvSt = bmbSelectedTicket?.isAnonymous
                                ? (bmbSelectedTicket.guestVerificationStatus ||
                                  bmbSelectedTicket.guestVerification?.guestVerificationStatus ||
                                  (bmbSelectedTicket.bmbAdminNote?.startsWith('[TỪ CHỐI')
                                    ? 'REJECTED'
                                    : bmbSelectedTicket.status !== 'PENDING' || bmbSelectedTicket.bmbApprovedById
                                      ? 'VERIFIED'
                                      : 'PENDING_VERIFICATION'))
                                : 'VERIFIED';
                              const isGuestBlocked = bmbSelectedTicket?.isAnonymous && gvSt !== 'VERIFIED';

                              return (
                                <>
                                  {isGuestBlocked && (
                                    <Text style={{ fontSize: 11.5, color: gvSt === 'REJECTED' ? '#DC2626' : '#D97706', marginBottom: 8, fontWeight: '700' }}>
                                      {gvSt === 'REJECTED'
                                        ? '✕ Báo cáo khách vãng lai này đã bị từ chối, không được đưa vào danh sách phân công KTV.'
                                        : '⏳ Vui lòng bấm "Duyệt báo cáo hợp lệ" ở mục xác minh phía trên trước khi phân công KTV.'}
                                    </Text>
                                  )}
                                  <TouchableOpacity
                                    style={[
                                      styles.bmbWebLoginBtn,
                                      (loading || !bmbSelectedTicket || !bmbTechId || !isSelTechEligible || isGuestBlocked) && { opacity: 0.6 },
                                      (!isSelTechEligible || isGuestBlocked) && { backgroundColor: '#94A3B8' },
                                    ]}
                                    onPress={() => handleBmbDispatch()}
                                    disabled={loading || !bmbSelectedTicket || !bmbTechId || !isSelTechEligible || isGuestBlocked}
                                  >
                                    <Text style={styles.bmbWebLoginBtnText}>
                                      {translate("Xác nhận & Giao việc")}
                                    </Text>
                                  </TouchableOpacity>
                                </>
                              );
                            })()}
                          </>
                        );
                      })()}
                    </View>
                  ) : (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
                      <Text style={{ fontSize: 32, marginBottom: 12 }}>📋</Text>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#334155' }}>
                        {translate('Chưa chọn sự cố nào')}
                      </Text>
                      <Text style={{ fontSize: 13, color: '#64748B', textAlign: 'center', marginTop: 4, maxWidth: 260 }}>
                        {translate('Vui lòng bấm chọn một sự cố từ danh sách bên trái để xem chi tiết và phê duyệt.')}
                      </Text>
                    </View>
                  )}
                </ScrollView>
              )}
            </View>
          )}

          {/* ==================================================================== */}
          {/* MÀN HÌNH 02 BMB: KỸ THUẬT VIÊN CA TRỰC & WORKLOAD (FIGMA 02 BMB)     */}
          {/* ==================================================================== */}
          {bmbNavTab === 'TECHNICIANS' && (
            <View style={[styles.bmbContentTwoCols, isMobileLayout && { flexDirection: 'column', padding: 12, gap: 12 }]}>
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
                  {translate("Kỹ thuật viên & Tải công việc")}</Text>
                <Text style={styles.bmbPageSubtitle}>
                  {translate("Theo dõi và điều phối công việc cho kỹ thuật viên")}</Text>

                <TouchableOpacity style={styles.technicianAddButton} onPress={openCreateTechnician}>
                  <Text style={styles.technicianAddButtonText}>+ {translate('Thêm kỹ thuật viên')}</Text>
                </TouchableOpacity>

                <View style={[styles.chipWrapRow, { marginTop: 12 }]}>
                  <View style={styles.bmbStatPill}>
                    <Text style={styles.bmbStatPillText}>{translate('Đang trực:')} {onDutyTechnicianCount} KTV</Text>
                  </View>
                  <View style={styles.bmbStatPill}>
                    <Text style={styles.bmbStatPillText}>{translate('Đang xử lý:')} {openTechnicianWorkCount} việc</Text>
                  </View>
                  <View style={styles.bmbStatPill}>
                    <Text style={styles.bmbStatPillText}>{translate('Sẵn sàng:')} {availableTechnicianCount} KTV</Text>
                  </View>
                </View>

                {technicians.length === 0 ? (
                  <View style={{ padding: 32, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 12, marginTop: 16 }}>
                    <Text style={{ color: '#64748B', fontSize: 13, fontWeight: '500' }}>
                      {translate('Chưa có kỹ thuật viên nào đang hoạt động trong hệ thống.')}
                    </Text>
                  </View>
                ) : (
                  technicians.map((tech: any, idx: number) => {
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
                            {(() => {
                              const isEligible = tech.isEligibleForAssignment !== false && tech.isOnDuty && tech.isCheckedIn && !tech.isCheckedOut && !tech.onLeave;
                              return (
                                <View
                                  style={[
                                    styles.statusPill,
                                    {
                                      alignSelf: 'flex-start',
                                      backgroundColor: isEligible ? '#DCFCE7' : '#FEE2E2',
                                    },
                                  ]}
                                >
                                  <Text
                                    style={{
                                      fontSize: 11.5,
                                      fontWeight: '700',
                                      color: isEligible ? '#15803D' : '#DC2626',
                                    }}
                                  >
                                    {isEligible
                                      ? translate('Đang trực')
                                      : tech.onLeave
                                        ? translate('Nghỉ phép')
                                        : tech.isCheckedOut
                                          ? translate('Đã kết thúc ca')
                                          : translate('Ngoài ca')}
                                  </Text>
                                </View>
                              );
                            })()}
                          </View>
                        </View>

                        {tech.isOnDuty && (
                          <>
                            <Text style={[styles.cardLocationText, { marginTop: 10 }]}>
                              {translate('Chuyên môn:')} {tech.specialtyLabel}
                            </Text>
                            <Text
                              style={{
                                fontSize: 12.5,
                                fontWeight: '600',
                                color: isHighLoad ? '#D97706' : '#059669',
                                marginTop: 6,
                              }}
                            >
                              {activeJobsCount === 0
                                ? translate('0 việc (Đang rảnh)')
                                : isHighLoad
                                  ? `${translate('Đang xử lý:')} ${activeJobsCount} việc (${translate('Tải cao')})`
                                  : `${translate('Đang xử lý:')} ${activeJobsCount} việc`}
                            </Text>

                            <View style={[styles.rowBetween, { marginTop: 12, gap: 10 }]}>
                              {(() => {
                                const isEligible = tech.isEligibleForAssignment !== false && tech.isOnDuty && tech.isCheckedIn && !tech.isCheckedOut && !tech.onLeave;
                                return (
                                  <TouchableOpacity
                                    style={[
                                      styles.bmbWorkloadBtn,
                                      isAssignSelected && styles.bmbWorkloadBtnBlueActive,
                                      !isEligible && { opacity: 0.5, backgroundColor: '#F1F5F9' },
                                    ]}
                                    onPress={() => {
                                      if (!isEligible) {
                                        showToast('Kỹ thuật viên đã kết thúc ca hoặc không còn trực. Vui lòng chọn kỹ thuật viên khác.');
                                        return;
                                      }
                                      setBmbAssignTargetTech(tech);
                                      setBmbTechId(tech.id);
                                    }}
                                  >
                                    <Text
                                      style={[
                                        styles.bmbWorkloadBtnText,
                                        isAssignSelected && { color: '#FFFFFF' },
                                        !isEligible && { color: '#94A3B8' },
                                      ]}
                                    >
                                      {!isEligible
                                        ? translate('Không thể giao')
                                        : isAssignSelected
                                          ? translate('Đang chọn giao việc')
                                          : translate('Giao việc')}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })()}

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
                                      ? `${translate('Đang xem')} (${activeJobsCount})`
                                      : `${translate('Xem việc')} (${activeJobsCount})`}
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
                  }))}
              </ScrollView>

              {/* CỘT PHẢI: 2 KHỐI XẾP DỌC (GIAO VIỆC MỚI + VIỆC ĐANG LÀM CỦA KTV) */}
              <ScrollView
                style={styles.bmbRightInspector}
                showsVerticalScrollIndicator={false}
              >
                {/* Khối trên: Giao việc mới cho KTV */}
                <View style={styles.bmbBlueOutlinePanel}>
                  <Text style={styles.bmbPanelBlueTitle}>
                    {translate("Giao việc cho:")}{' '}
                    {bmbAssignTargetTech?.fullName || (technicians.length > 0 ? technicians[0]?.fullName : translate('Chưa chọn KTV'))}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
                    {translate("Chuyên môn:")}{' '}
                    {bmbAssignTargetTech?.specialtyLabel || 'Điện - Nước'}
                  </Text>

                  <Text style={styles.fieldLabel}>
                    {translate("Chọn sự cố chờ phân công:")}</Text>

                  {pendingTicketsForRadio.map((pt) => {
                    const isRadioChecked = bmbRadioTicketId === pt.id;
                    const isHigh = (pt.finalPriority || pt.aiSuggestedPriority) === 'HIGH';
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
                          <View style={[
                            styles.radioDotCircle,
                            isRadioChecked && styles.radioDotCircleActive,
                          ]}>
                            {isRadioChecked && <View style={styles.radioDotInner} />}
                          </View>
                          <Text style={{ fontWeight: '700', color: '#2563EB', fontSize: 13, marginRight: 8 }}>
                            {pt.ticketCode}
                          </Text>
                          {isHigh && (
                            <View style={styles.bmbMiniOrangeBadge}>
                              <Text style={styles.bmbMiniOrangeText}>{translate('Ưu tiên cao')}</Text>
                            </View>
                          )}
                          <View style={styles.bmbMiniPurpleBadge}>
                            <Text style={styles.bmbMiniPurpleText}>
                              {CATEGORY_SHORT_VN[pt.aiSuggestedCategory] || 'Điện - Nước'}
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

                  <Text style={styles.fieldLabel}>{translate("Ghi chú điều phối (Tùy chọn):")}</Text>
                  <TextInput
                    style={styles.bmbWebInput}
                    value={bmbNote}
                    onChangeText={setBmbNote}
                    placeholder={translate("Mang theo dụng cụ cần thiết...")}
                    placeholderTextColor="#94A3B8"
                  />

                  <TouchableOpacity
                    style={[
                      styles.bmbWebLoginBtn,
                      { marginTop: 14 },
                      (loading || pendingTicketsForRadio.length === 0 || !bmbAssignTargetTech?.id || !bmbRadioTicketId) && { opacity: 0.6 },
                    ]}
                    onPress={() =>
                      handleBmbDispatch(
                        bmbRadioTicketId,
                        bmbAssignTargetTech?.id || bmbTechId
                      )
                    }
                    disabled={loading || pendingTicketsForRadio.length === 0 || !bmbAssignTargetTech?.id || !bmbRadioTicketId}
                  >
                    <Text style={styles.bmbWebLoginBtnText}>
                      {translate("Xác nhận giao việc")}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Khối dưới: Việc đang làm của KTV */}
                <View style={[styles.bmbBlueOutlinePanel, { borderColor: '#E2E8F0', marginTop: 14 }]}>
                  <Text style={[styles.bmbPanelBlueTitle, { color: '#0F172A' }]}>
                    {translate("Việc đang làm của")}:{' '}
                    {bmbViewingWorkloadTech?.fullName || (technicians[0]?.fullName ?? 'Kỹ thuật viên')}
                    {viewingTechTickets.length > 0 ? ` (${viewingTechTickets.length})` : ''}
                  </Text>

                  {viewingTechTickets.length > 0 ? (
                    viewingTechTickets.map((vTicket) => (
                      <View key={vTicket.id} style={styles.bmbActiveJobItem}>
                        <Text style={{ fontWeight: '700', fontSize: 13, color: '#0F172A' }}>
                          {vTicket.ticketCode} • {vTicket.title}
                        </Text>
                        <Text style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                          {vTicket.status === 'IN_PROGRESS' ? translate('Đang xử lý') : translate('Đã phân công')} • {vTicket.locationNote}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.techInfoLine, { marginTop: 8 }]}>
                      {translate('Không có sự cố nào đang thực hiện.')}
                    </Text>
                  )}
                </View>
              </ScrollView>
            </View>
          )}

          {/* ==================================================================== */}
          {/* MÀN HÌNH 03 BMB: TRUNG TÂM THÔNG BÁO & CLOUD STATUS (FIGMA 03 BMB)   */}
          {/* ==================================================================== */}
          {bmbNavTab === 'NOTIFICATIONS' && (
            <View style={[styles.bmbContentTwoCols, isMobileLayout && { flexDirection: 'column', padding: 12, gap: 12 }]}>
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
                      {translate("Cập nhật thời gian thực")}</Text>
                  </View>
                  <TouchableOpacity onPress={handleMarkAllNotificationsRead}>
                    <Text style={{ color: '#1D61E7', fontWeight: '700', fontSize: 13 }}>
                      {translate("Đánh dấu đã đọc tất cả")}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.chipWrapRow, { marginTop: 12 }]}>
                  {[
                    { key: 'ALL', label: `${translate('Tất cả')} (${notifications.length})` },
                    { key: 'UNREAD', label: `${translate('Chưa đọc')} (${unreadCount})` },
                    { key: 'URGENT', label: `${translate('Khẩn cấp')} (${urgentNotificationCount})` },
                    { key: 'TECH', label: `${translate('Kỹ thuật viên')} (${technicianNotificationCount})` },
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
                ) : (
                  <>
                    {(() => {
                      const sorted = [...filteredBmbNotifications].sort(
                        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                      );
                      const displayed = showAllBmbNotifications ? sorted : sorted.slice(0, 5);
                      return (
                        <>
                          {displayed.map((notification) => (
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
                          {sorted.length > 5 && (
                            <TouchableOpacity
                              style={{
                                paddingVertical: 10,
                                alignItems: 'center',
                                backgroundColor: '#F8FAFC',
                                borderRadius: 8,
                                marginTop: 8,
                                borderWidth: 1,
                                borderColor: '#E2E8F0',
                              }}
                              onPress={() => setShowAllBmbNotifications(!showAllBmbNotifications)}
                            >
                              <Text style={{ fontSize: 13, fontWeight: '700', color: '#2563EB' }}>
                                {showAllBmbNotifications
                                  ? translate('Thu gọn')
                                  : `${translate('Xem thêm')} (${sorted.length - 5})`}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </>
                      );
                    })()}
                  </>
                )}
              </ScrollView>

              {/* CỘT PHẢI: THÔNG TIN VẬN HÀNH & LIÊN HỆ KHẨN CẤP */}
              <ScrollView
                style={styles.bmbRightInspector}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.bmbInspectorTitle}>{translate('Thông tin vận hành')}</Text>

                {/* Khối Quản lý Liên hệ Khẩn cấp */}
                <View style={[styles.cleanInfoCard, { borderColor: '#DC2626', marginTop: 12 }]}>
                  <View style={styles.rowBetween}>
                    <Text style={[styles.cleanInfoCardTitle, { color: '#DC2626' }]}>
                      🚨 {translate('Liên hệ quản lý khẩn cấp')}
                    </Text>
                    <TouchableOpacity onPress={() => setEditingEmergencyContact(!editingEmergencyContact)}>
                      <Text style={{ color: '#2563EB', fontWeight: '700', fontSize: 12 }}>
                        {editingEmergencyContact ? translate('Hủy') : translate('Chỉnh sửa')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {!editingEmergencyContact ? (
                    <Text style={[styles.cardLocationText, { marginTop: 4, fontWeight: '600', color: '#0F172A' }]}>
                      {emergencyContact.managerName} – {emergencyContact.managerPhone}
                    </Text>
                  ) : (
                    <View style={{ marginTop: 8 }}>
                      <Text style={styles.fieldLabel}>{translate('Họ và tên:')}</Text>
                      <TextInput
                        style={[styles.bmbWebInput, { marginBottom: 6 }]}
                        value={emergencyNameInput}
                        onChangeText={setEmergencyNameInput}
                        placeholder="Đặng Thành Quyết"
                      />
                      <Text style={styles.fieldLabel}>{translate('Số điện thoại:')}</Text>
                      <TextInput
                        style={[styles.bmbWebInput, { marginBottom: 8 }]}
                        value={emergencyPhoneInput}
                        onChangeText={(v) => setEmergencyPhoneInput(v.replace(/[^\d]/g, '').slice(0, 10))}
                        placeholder="0913402803"
                        keyboardType="phone-pad"
                        maxLength={10}
                      />
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { paddingVertical: 8 }]}
                        onPress={handleSaveEmergencyContact}
                        disabled={loading}
                      >
                        <Text style={styles.primaryActionBtnText}>{translate('Lưu liên hệ')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                <View style={styles.cleanInfoCard}>
                  <Text style={styles.cleanInfoCardTitle}>{translate('Trợ lý AI')}</Text>
                  <Text style={styles.cleanInfoCardDesc}>
                    {translate('Gợi ý phân loại tự động và đánh giá độ khẩn cấp.')}
                  </Text>
                </View>

                <View style={styles.cleanInfoCard}>
                  <Text style={styles.cleanInfoCardTitle}>{translate('Hộp thư thông báo')}</Text>
                  <Text style={styles.cleanInfoCardDesc}>
                    {translate('Lưu trữ các cập nhật trạng thái sự cố và phân công.')}
                  </Text>
                </View>

                <View style={styles.techDivider} />

                <Text style={styles.cardBlockTitle}>{translate('Hoạt động hôm nay')}</Text>
                <View style={styles.bmbStatRow}>
                  <Text style={styles.bmbStatLabel}>{translate('Sự cố mới:')}</Text>
                  <Text style={styles.bmbStatValue}>{ticketsCreatedToday}</Text>
                </View>
                <View style={styles.bmbStatRow}>
                  <Text style={styles.bmbStatLabel}>{translate('Thông báo mới:')}</Text>
                  <Text style={styles.bmbStatValue}>{notificationsCreatedToday}</Text>
                </View>
              </ScrollView>
            </View>
          )}

          {/* ==================================================================== */}
          {/* MÀN HÌNH 04 BMB: QUẢN LÝ CĂN HỘ & CƯ DÂN                             */}
          {/* ==================================================================== */}
          {bmbNavTab === 'APARTMENTS' && (
            <View style={[styles.bmbContentTwoCols, isMobileLayout && { flexDirection: 'column', padding: 12, gap: 12 }]}>
              {/* CỘT TRÁI: DANH SÁCH CĂN HỘ & LỊCH SỬ SỬA CHỮA */}
              <ScrollView style={styles.bmbCenterColumn} showsVerticalScrollIndicator={false}>
                <View style={styles.cardTopRow}>
                  <View>
                    <Text style={styles.bmbPageTitle}>{translate("Quản lý Căn hộ & Lịch sử sửa chữa")}</Text>
                    <Text style={styles.bmbPageSubtitle}>
                      {translate("Theo dõi cư dân, mã QR phòng và lịch sử bảo trì")}
                    </Text>
                  </View>
                </View>

                {/* Bộ lọc Tòa (G, F, E), Tầng (1..5) và Trạng thái */}
                <View style={{ backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, marginVertical: 10, borderWidth: 1, borderColor: '#E2E8F0' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E293B' }}>
                      🏢 {translate("Hệ thống 75 Căn hộ")} • {translate("Đại học Duy Tân, Hòa Khánh Nam, Đà Nẵng")}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#64748B' }}>
                      {apartments.filter((a) => a.residents && a.residents.length > 0).length}/{apartments.length || 75} {translate("phòng đang ở")}
                    </Text>
                  </View>

                  {/* Hàng 1: Lọc theo Tòa */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', width: 60 }}>{translate("Tòa:")}</Text>
                    {(['ALL', 'G', 'F', 'E'] as const).map((b) => {
                      const isSel = apartmentFilterBlock === b;
                      const label = b === 'ALL' ? 'Tất cả 3 tòa (75)' : `Tòa ${b} (25)`;
                      return (
                        <TouchableOpacity
                          key={b}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 6,
                            backgroundColor: isSel ? '#2563EB' : '#FFFFFF',
                            borderWidth: 1,
                            borderColor: isSel ? '#1D4ED8' : '#CBD5E1',
                          }}
                          onPress={() => setApartmentFilterBlock(b)}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: isSel ? '#FFFFFF' : '#334155' }}>
                            {translate(label)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Hàng 2: Lọc theo Tầng */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', width: 60 }}>{translate("Tầng:")}</Text>
                    {(['ALL', 1, 2, 3, 4, 5] as const).map((fl) => {
                      const isSel = apartmentFilterFloor === fl;
                      const label = fl === 'ALL' ? 'Tất cả tầng' : `Tầng ${fl}`;
                      return (
                        <TouchableOpacity
                          key={String(fl)}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 6,
                            backgroundColor: isSel ? '#2563EB' : '#FFFFFF',
                            borderWidth: 1,
                            borderColor: isSel ? '#1D4ED8' : '#CBD5E1',
                          }}
                          onPress={() => setApartmentFilterFloor(fl)}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: isSel ? '#FFFFFF' : '#334155' }}>
                            {translate(label)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Hàng 3: Lọc theo Trạng thái */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', width: 60 }}>{translate("Trạng thái:")}</Text>
                    {(['ALL', 'OCCUPIED', 'VACANT'] as const).map((st) => {
                      const isSel = apartmentFilterStatus === st;
                      const label = st === 'ALL' ? 'Tất cả' : st === 'OCCUPIED' ? 'Đang ở' : 'Còn trống';
                      return (
                        <TouchableOpacity
                          key={st}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 6,
                            backgroundColor: isSel ? '#2563EB' : '#FFFFFF',
                            borderWidth: 1,
                            borderColor: isSel ? '#1D4ED8' : '#CBD5E1',
                          }}
                          onPress={() => setApartmentFilterStatus(st)}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: isSel ? '#FFFFFF' : '#334155' }}>
                            {translate(label)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Danh sách thẻ căn hộ hiển thị mã QR thật và thông tin chuẩn */}
                <View style={[styles.chipWrapRow, { marginVertical: 8 }]}>
                  {apartments
                    .filter((apt) => {
                      if (apartmentFilterBlock !== 'ALL' && !apt.apartmentCode.startsWith(apartmentFilterBlock)) return false;
                      if (apartmentFilterFloor !== 'ALL' && apt.floorNumber !== apartmentFilterFloor) return false;
                      const hasResidents = apt.residents && apt.residents.length > 0;
                      if (apartmentFilterStatus === 'OCCUPIED' && !hasResidents) return false;
                      if (apartmentFilterStatus === 'VACANT' && hasResidents) return false;
                      return true;
                    })
                    .map((apt) => {
                      const isSel = selectedApartment?.apartmentCode === apt.apartmentCode;
                      const hasResidents = apt.residents && apt.residents.length > 0;
                      const qrVal = apt.roomQrCode || apt.qrCode || `ROOM:${apt.apartmentCode}`;
                      return (
                        <TouchableOpacity
                          key={apt.apartmentCode}
                          style={[
                            styles.bmbRadioTicketBox,
                            isSel && styles.bmbRadioTicketBoxSelected,
                            { minWidth: 260, flex: 1, margin: 4, padding: 12 }
                          ]}
                          onPress={() => handleSelectApartment(apt)}
                        >
                          {/* Hàng trên: Tên phòng và Huy hiệu trạng thái */}
                          <View style={styles.cardTopRow}>
                            <Text style={{ fontWeight: '900', fontSize: 16, color: '#1E40AF' }}>
                              Căn {apt.apartmentCode}
                            </Text>
                            <View style={[styles.statusPill, { backgroundColor: hasResidents ? '#DCFCE7' : '#F1F5F9' }]}>
                              <Text style={[styles.statusPillText, { color: hasResidents ? '#15803D' : '#64748B', fontSize: 11 }]}>
                                {translate(hasResidents ? `Đang ở (${apt.residents.length})` : 'Còn trống')}
                              </Text>
                            </View>
                          </View>

                          {/* Thân thẻ: Thông tin bên trái, Mã QR đen trắng bên phải */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                              <Text style={[styles.cardLocationText, { fontWeight: '700', color: '#0F172A' }]}>
                                {apt.buildingBlock} • Tầng {apt.floorNumber}
                              </Text>
                              <Text style={[styles.cardLocationText, { fontSize: 11.5, color: '#64748B', marginTop: 2 }]} numberOfLines={1}>
                                {apt.buildingAddress || 'Đại học Duy Tân, Hòa Khánh Nam, Đà Nẵng'}
                              </Text>
                              <Text style={[styles.techInfoLine, { marginTop: 4, fontSize: 12 }]}>
                                Chủ hộ: {apt.representative?.fullName || 'Chưa gán'}
                              </Text>
                              <Text style={{ fontSize: 11, color: '#7C3AED', fontWeight: '700', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
                                {qrVal}
                              </Text>
                            </View>

                            {/* Mã QR thật dạng pixel matrix độc lập */}
                            <View style={{ alignItems: 'center' }}>
                              <View style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 6, padding: 2, backgroundColor: '#FFFFFF' }}>
                                <QrCodeView value={qrVal} size={58} quietZone={1} />
                              </View>
                              <TouchableOpacity
                                style={{
                                  marginTop: 4,
                                  backgroundColor: '#EFF6FF',
                                  borderWidth: 1,
                                  borderColor: '#BFDBFE',
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  borderRadius: 4,
                                }}
                                onPress={() => setZoomQrApartment(apt)}
                              >
                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#1D4ED8' }}>
                                  🔍 {translate("Phóng to & In")}
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                </View>

                {/* Modal Phóng to Mã QR Căn hộ & In / Tải file SVG */}
                {zoomQrApartment && (
                  <Modal
                    visible={zoomQrApartment !== null}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setZoomQrApartment(null)}
                  >
                    <View style={styles.technicianModalOverlay}>
                      <View style={[styles.technicianModalCard, { maxWidth: 420, alignItems: 'center' }]}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: '#2563EB', letterSpacing: 1, textTransform: 'uppercase' }}>
                          {translate("Tem mã QR Căn hộ chính thức")}
                        </Text>
                        <Text style={{ fontSize: 26, fontWeight: '900', color: '#0F172A', marginTop: 4 }}>
                          Căn {zoomQrApartment.apartmentCode}
                        </Text>
                        <Text style={{ fontSize: 13, color: '#475569', marginTop: 2, textAlign: 'center' }}>
                          {zoomQrApartment.buildingBlock} • Tầng {zoomQrApartment.floorNumber}
                        </Text>
                        <Text style={{ fontSize: 12, color: '#64748B', marginTop: 2, textAlign: 'center' }}>
                          {zoomQrApartment.buildingAddress || 'Đại học Duy Tân, Hòa Khánh Nam, Đà Nẵng'}
                        </Text>

                        {/* Khung QR to sắc nét */}
                        <View style={{
                          width: 236,
                          height: 236,
                          marginVertical: 14,
                          padding: 8,
                          backgroundColor: '#FFFFFF',
                          borderWidth: 2,
                          borderColor: '#0284C7',
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                          shadowColor: '#000',
                          shadowOpacity: 0.08,
                          shadowRadius: 10,
                          elevation: 4,
                        }}>
                          <QrCodeView
                            value={zoomQrApartment.roomQrCode || zoomQrApartment.qrCode || `ROOM:${zoomQrApartment.apartmentCode}`}
                            size={220}
                            quietZone={3}
                          />
                        </View>

                        {/* Huy hiệu mã QR */}
                        <View style={{ backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 8 }}>
                          <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontWeight: '800', fontSize: 14, color: '#1E293B' }}>
                            {zoomQrApartment.roomQrCode || zoomQrApartment.qrCode || `ROOM:${zoomQrApartment.apartmentCode}`}
                          </Text>
                        </View>

                        <Text style={{ fontSize: 12, color: '#166534', backgroundColor: '#DCFCE7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 16 }}>
                          ✓ {translate("Mã QR hoạt động hợp lệ • Gắn liền vĩnh viễn với phòng")}
                        </Text>

                        {/* Các nút hành động: In, Tải SVG, Đóng */}
                        <View style={{ width: '100%', gap: 8 }}>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <TouchableOpacity
                              style={[styles.primaryActionBtn, { flex: 1, backgroundColor: '#0284C7', paddingVertical: 10 }]}
                              onPress={() => {
                                const bAddress = zoomQrApartment.buildingAddress || 'Đại học Duy Tân, Hòa Khánh Nam, Đà Nẵng';
                                const locStr = `${zoomQrApartment.buildingBlock} • Tầng ${zoomQrApartment.floorNumber}`;
                                printQrCode(zoomQrApartment.apartmentCode, locStr, bAddress);
                              }}
                            >
                              <Text style={styles.primaryActionBtnText}>🖨️ {translate("In tem QR")}</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.primaryActionBtn, { flex: 1, backgroundColor: '#0F766E', paddingVertical: 10 }]}
                              onPress={() => {
                                downloadQrSvg(zoomQrApartment.apartmentCode);
                                showToast(translate(`Đã tải file SVG mã QR căn ${zoomQrApartment.apartmentCode}`));
                              }}
                            >
                              <Text style={styles.primaryActionBtnText}>⬇️ {translate("Tải file SVG")}</Text>
                            </TouchableOpacity>
                          </View>

                          <TouchableOpacity
                            style={[styles.technicianCancelButton, { width: '100%', paddingVertical: 9, alignItems: 'center' }]}
                            onPress={() => setZoomQrApartment(null)}
                          >
                            <Text style={styles.technicianCancelButtonText}>{translate("Đóng")}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </Modal>
                )}

                {/* Lịch sử sửa chữa của căn hộ được chọn */}
                {selectedApartment && (
                  <View style={[styles.whiteSectionCard, { marginTop: 14 }]}>
                    <View style={styles.cardTopRow}>
                      <View>
                        <Text style={styles.cardBlockTitle}>
                          {translate("Lịch sử sửa chữa căn")} {selectedApartment.apartmentCode}
                        </Text>
                        <Text style={styles.techDutySub}>
                          {apartmentRepairsFullHistory ? translate("Toàn bộ lịch sử") : translate("Lịch sử sửa chữa (3 tháng)")}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleToggleApartmentRepairsHistory(!apartmentRepairsFullHistory)}
                      >
                        <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#2563EB' }}>
                          {apartmentRepairsFullHistory ? translate("3 tháng gần nhất") : translate("Xem toàn bộ lịch sử")}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {apartmentRepairs.length === 0 ? (
                      <Text style={[styles.techInfoLine, { marginTop: 10 }]}>
                        {translate("Không có sự cố nào trong khoảng thời gian này.")}
                      </Text>
                    ) : (
                      apartmentRepairs.map((rp) => (
                        <View key={rp.id} style={[styles.notiBlueItem, { paddingVertical: 10 }]}>
                          <View style={{ flex: 1 }}>
                            <View style={styles.cardTopRow}>
                              <Text style={styles.cardCodeText}>{rp.ticketCode}</Text>
                              <View style={[styles.statusPill, { backgroundColor: '#F1F5F9' }]}>
                                <Text style={[styles.statusPillText, { color: '#475569' }]}>{rp.status}</Text>
                              </View>
                            </View>
                            <Text style={styles.cardMainTitle}>{rp.title}</Text>
                            <Text style={styles.cardLocationText}>
                              KTV: {rp.assignedTech?.fullName || 'Chưa giao'} • {formatDateTime(rp.createdAt)}
                            </Text>
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </ScrollView>

              {/* CỘT PHẢI: QUẢN LÝ TÀI KHOẢN CƯ DÂN */}
              <ScrollView style={styles.bmbRightInspector} showsVerticalScrollIndicator={false}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.bmbPanelBlueTitle}>{translate("Danh sách Cư dân")}</Text>
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { paddingVertical: 6, paddingHorizontal: 12 }]}
                    onPress={() => {
                      setSelectedResident(null);
                      setResidentModalError(null);
                      setResidentForm({
                        fullName: '',
                        phone: '',
                        email: '',
                        apartmentCode: selectedApartment?.apartmentCode || 'G101',
                        buildingBlock: selectedApartment?.buildingBlock || 'Tòa G',
                        floorNumber: selectedApartment?.floorNumber || 1,
                        residencyRole: 'TENANT',
                        moveInDate: new Date().toISOString().slice(0, 10),
                        moveOutDate: '',
                        isRepresentative: false,
                      });
                      setResidentModalMode('create');
                    }}
                  >
                    <Text style={styles.primaryActionBtnText}>+ {translate("Thêm cư dân")}</Text>
                  </TouchableOpacity>
                </View>

                <TextInput
                  style={[styles.bmbWebInput, { marginVertical: 10 }]}
                  value={residentSearchQuery}
                  onChangeText={setResidentSearchQuery}
                  placeholder={translate("Tìm kiếm theo tên, SĐT, căn hộ...")}
                  placeholderTextColor="#94A3B8"
                />

                {residentsList
                  .filter((r) =>
                    !residentSearchQuery ||
                    r.fullName?.toLowerCase().includes(residentSearchQuery.toLowerCase()) ||
                    r.phone?.includes(residentSearchQuery) ||
                    r.apartmentCode?.toLowerCase().includes(residentSearchQuery.toLowerCase())
                  )
                  .map((res) => {
                    const roleLabel = res.residencyRole === 'OWNER' ? 'Chủ sở hữu' : res.residencyRole === 'MEMBER' ? 'Thành viên hộ' : 'Khách thuê';
                    const roleColor = res.residencyRole === 'OWNER' ? '#D97706' : res.residencyRole === 'MEMBER' ? '#7C3AED' : '#2563EB';
                    const roleBg = res.residencyRole === 'OWNER' ? '#FEF3C7' : res.residencyRole === 'MEMBER' ? '#F3E8FF' : '#EFF6FF';

                    return (
                      <View key={res.id} style={[styles.bmbRadioTicketBox, { marginBottom: 8 }]}>
                        <View style={styles.cardTopRow}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={{ fontWeight: '700', fontSize: 14, color: '#0F172A' }}>
                              {res.fullName}
                            </Text>
                            <View style={[styles.statusPill, { backgroundColor: roleBg }]}>
                              <Text style={[styles.statusPillText, { color: roleColor, fontWeight: '600' }]}>{roleLabel}</Text>
                            </View>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            {res.isActivated === false && (
                              <View style={[styles.statusPill, { backgroundColor: '#FEF3C7' }]}>
                                <Text style={[styles.statusPillText, { color: '#D97706' }]}>
                                  {translate('Chờ OTP')}
                                </Text>
                              </View>
                            )}
                            <View style={[styles.statusPill, res.isActive ? { backgroundColor: '#DCFCE7' } : { backgroundColor: '#FEE2E2' }]}>
                              <Text style={[styles.statusPillText, res.isActive ? { color: '#15803D' } : { color: '#B91C1C' }]}>
                                {res.isActive ? translate('Hoạt động') : translate('Đã khóa')}
                              </Text>
                            </View>
                          </View>
                        </View>
                        <Text style={styles.cardLocationText}>
                          SĐT: {res.phone} • {res.email ? `Email: ${res.email} • ` : ''}Căn: {res.apartmentCode || 'Chưa gán'}
                        </Text>
                        {res.moveInDate && (
                          <Text style={[styles.cardLocationText, { fontSize: 11, color: '#64748B', marginTop: 2 }]}>
                            Ngày vào: {res.moveInDate} {res.moveOutDate ? `• Rời: ${res.moveOutDate}` : ''}
                          </Text>
                        )}

                        <View style={[styles.rowBetween, { marginTop: 8 }]}>
                          <TouchableOpacity
                            style={styles.technicianEditButton}
                            onPress={() => {
                              setSelectedResident(res);
                              setResidentModalError(null);
                              setResidentForm({
                                fullName: res.fullName,
                                phone: res.phone,
                                email: res.email || '',
                                apartmentCode: res.apartmentCode || 'G101',
                                buildingBlock: res.buildingBlock || 'Tòa G',
                                floorNumber: res.floorNumber || 1,
                                residencyRole: res.residencyRole || (res.isRepresentative ? 'OWNER' : 'TENANT'),
                                moveInDate: res.moveInDate || new Date().toISOString().slice(0, 10),
                                moveOutDate: res.moveOutDate || '',
                                isRepresentative: Boolean(res.isRepresentative),
                              });
                              setResidentModalMode('edit');
                            }}
                          >
                            <Text style={styles.technicianEditButtonText}>{translate('Sửa')}</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.technicianEditButton, { borderColor: '#D97706' }]}
                            onPress={() => {
                              setSelectedResident(res);
                              setNewPasswordInput('');
                              setResidentModalMode('reset_password');
                            }}
                          >
                            <Text style={[styles.technicianEditButtonText, { color: '#D97706' }]}>
                              {translate('Đặt lại MK')}
                            </Text>
                          </TouchableOpacity>

                          {res.apartmentCode && (
                            <TouchableOpacity
                              style={[styles.technicianDeleteButton, { borderColor: '#D97706' }]}
                              onPress={() => handleResidentDeparture(res.id)}
                            >
                              <Text style={[styles.technicianDeleteButtonText, { color: '#D97706' }]}>
                                {translate('Chuyển đi')}
                              </Text>
                            </TouchableOpacity>
                          )}

                          <TouchableOpacity
                            style={[styles.technicianDeleteButton, { borderColor: '#EF4444', backgroundColor: '#FEF2F2' }]}
                            onPress={() => handleDeleteResident(res.id, res.fullName)}
                          >
                            <Text style={[styles.technicianDeleteButtonText, { color: '#DC2626' }]}>
                              {translate('Xóa tài khoản')}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
              </ScrollView>
            </View>
          )}

          {/* ==================================================================== */}
          {/* MÀN HÌNH 04B BMB: QUẢN LÝ CHẤM CÔNG KỸ THUẬT VIÊN (ĐƠN GIẢN HÓA 3.0) */}
          {/* ==================================================================== */}
          {bmbNavTab === 'ATTENDANCE' && (
            <View style={[styles.bmbContentTwoCols, isMobileLayout && { flexDirection: 'column', padding: 12, gap: 12 }]}>
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {/* Tiêu đề & Nút làm mới */}
                <View style={[styles.cardTopRow, { flexWrap: 'wrap', gap: 10 }]}>
                  <View>
                    <Text style={styles.bmbPageTitle}>{translate("Quản lý Chấm công Kỹ thuật viên")}</Text>
                    <Text style={styles.bmbPageSubtitle}>
                      {translate("Theo dõi trực quan trạng thái ca trực, đi sớm/đúng giờ/đi trễ, về sớm/muộn và giờ công hợp lệ")}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { backgroundColor: '#2563EB', paddingVertical: 8, paddingHorizontal: 16 }]}
                    onPress={() => fetchBmbAttendance()}
                  >
                    <Text style={styles.primaryActionBtnText}>🔄 {translate("Làm mới dữ liệu")}</Text>
                  </TouchableOpacity>
                </View>

                {/* 1. TỔNG QUAN PHÍA TRÊN (6 THẺ KPI RÕ RÀNG) */}
                <View style={[styles.bmbKpiRow, { flexWrap: 'wrap' }]}>
                  <StaggeredCardEntrance index={0}>
                    <View style={[styles.bmbKpiCard, { minWidth: 130 }]}>
                      <Text style={styles.bmbKpiLabel}>🔵 {translate("Đang trực")}</Text>
                      <Text style={[styles.bmbKpiNumber, { color: '#2563EB' }]}>{bmbAttendanceStats.currentlyOnDutyCount}</Text>
                    </View>
                  </StaggeredCardEntrance>
                  <StaggeredCardEntrance index={1}>
                    <View style={[styles.bmbKpiCard, { minWidth: 130 }]}>
                      <Text style={styles.bmbKpiLabel}>🟢 {translate("Đã kết thúc ca")}</Text>
                      <Text style={[styles.bmbKpiNumber, { color: '#16A34A' }]}>{bmbAttendanceStats.completedShiftCount}</Text>
                    </View>
                  </StaggeredCardEntrance>
                  <StaggeredCardEntrance index={2}>
                    <View style={[styles.bmbKpiCard, { minWidth: 130 }]}>
                      <Text style={styles.bmbKpiLabel}>🟠 {translate("Đi trễ")}</Text>
                      <Text style={[styles.bmbKpiNumber, { color: '#D97706' }]}>{bmbAttendanceStats.lateCount}</Text>
                    </View>
                  </StaggeredCardEntrance>
                  <StaggeredCardEntrance index={3}>
                    <View style={[styles.bmbKpiCard, { minWidth: 130 }]}>
                      <Text style={styles.bmbKpiLabel}>🟡 {translate("Về sớm")}</Text>
                      <Text style={[styles.bmbKpiNumber, { color: '#EA580C' }]}>{bmbAttendanceStats.earlyLeaveCount}</Text>
                    </View>
                  </StaggeredCardEntrance>
                  <StaggeredCardEntrance index={4}>
                    <View style={[styles.bmbKpiCard, { minWidth: 130 }]}>
                      <Text style={styles.bmbKpiLabel}>⚪ {translate("Chưa check-in")}</Text>
                      <Text style={[styles.bmbKpiNumber, { color: '#64748B' }]}>{bmbAttendanceStats.notCheckedInCount}</Text>
                    </View>
                  </StaggeredCardEntrance>
                  <StaggeredCardEntrance index={5}>
                    <View style={[styles.bmbKpiCard, { minWidth: 130 }]}>
                      <Text style={styles.bmbKpiLabel}>🔴 {translate("Cần xem xét")}</Text>
                      <Text style={[styles.bmbKpiNumber, { color: bmbAttendanceStats.pendingReviewCount > 0 ? '#DC2626' : '#64748B' }]}>
                        {bmbAttendanceStats.pendingReviewCount}
                      </Text>
                    </View>
                  </StaggeredCardEntrance>
                </View>

                {/* Cảnh báo bất thường từ Backend */}
                {bmbAnomalies.length > 0 && (
                  <View style={[styles.cleanInfoCard, { borderColor: '#F59E0B', backgroundColor: '#FFFBEB', marginBottom: 14, padding: 12 }]}>
                    <Text style={{ fontWeight: '700', color: '#B45309', fontSize: 13.5 }}>⚠️ {translate("Cảnh báo chấm công cần xử lý:")}</Text>
                    {bmbAnomalies.map((anom, idx) => (
                      <Text key={idx} style={{ fontSize: 12.5, color: '#B45309', marginTop: 3 }}>• {anom}</Text>
                    ))}
                  </View>
                )}

                {/* 3. BỘ LỌC ĐƠN GIẢN (Ngày/Tháng, KTV, Trạng thái + Nút mở rộng bộ lọc nâng cao) */}
                <View style={[styles.whiteSectionCard, { marginBottom: 14, padding: 14 }]}>
                  <View style={[styles.cardTopRow, { marginBottom: 10, flexWrap: 'wrap', gap: 8 }]}>
                    <Text style={[styles.cardBlockTitle, { fontSize: 14, marginBottom: 0 }]}>🔍 {translate("Bộ lọc chấm công")}</Text>
                    <TouchableOpacity
                      style={{
                        backgroundColor: showAdvancedAttendanceFilters ? '#EFF6FF' : '#F8FAFC',
                        borderWidth: 1,
                        borderColor: showAdvancedAttendanceFilters ? '#93C5FD' : '#CBD5E1',
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 8,
                      }}
                      onPress={() => setShowAdvancedAttendanceFilters((prev) => !prev)}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: showAdvancedAttendanceFilters ? '#1D4ED8' : '#475569' }}>
                        ⚙️ {showAdvancedAttendanceFilters ? translate("Thu gọn bộ lọc nâng cao & Tọa độ") : translate("Bộ lọc nâng cao & Cấu hình tọa độ tòa nhà")}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Dòng 1: Lọc Ngày & Tháng */}
                  <View style={{ flexDirection: Platform.OS === 'web' ? 'row' : 'column', gap: 10, marginBottom: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fieldLabel, { fontSize: 11.5, marginBottom: 3 }]}>{translate("Ngày (YYYY-MM-DD):")}</Text>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TextInput
                          style={[styles.bmbWebInput, { flex: 1, paddingVertical: 6, fontSize: 12.5 }]}
                          value={bmbAttendanceFilterDate}
                          onChangeText={(val) => {
                            setBmbAttendanceFilterDate(val);
                            void fetchBmbAttendance({ date: val });
                          }}
                          placeholder="VD: 2026-11-25"
                          placeholderTextColor="#94A3B8"
                        />
                        <TouchableOpacity
                          style={[styles.bmbFilterChip, { justifyContent: 'center', marginBottom: 0 }]}
                          onPress={() => {
                            const today = new Date().toISOString().slice(0, 10);
                            setBmbAttendanceFilterDate(today);
                            void fetchBmbAttendance({ date: today });
                          }}
                        >
                          <Text style={styles.bmbFilterChipText}>{translate("Hôm nay")}</Text>
                        </TouchableOpacity>
                        {bmbAttendanceFilterDate ? (
                          <TouchableOpacity
                            style={[styles.bmbFilterChip, { justifyContent: 'center', marginBottom: 0, backgroundColor: '#F1F5F9' }]}
                            onPress={() => {
                              setBmbAttendanceFilterDate('');
                              void fetchBmbAttendance({ date: '' });
                            }}
                          >
                            <Text style={[styles.bmbFilterChipText, { color: '#DC2626' }]}>✕</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fieldLabel, { fontSize: 11.5, marginBottom: 3 }]}>{translate("Tháng (YYYY-MM):")}</Text>
                      <TextInput
                        style={[styles.bmbWebInput, { paddingVertical: 6, fontSize: 12.5 }]}
                        value={bmbAttendanceFilterMonth}
                        onChangeText={(val) => {
                          setBmbAttendanceFilterMonth(val);
                          void fetchBmbAttendance({ month: val });
                        }}
                        placeholder="VD: 2026-11"
                        placeholderTextColor="#94A3B8"
                      />
                    </View>
                  </View>

                  {/* Dòng 2: Lọc theo KTV */}
                  <View style={{ marginBottom: 10 }}>
                    <Text style={[styles.fieldLabel, { fontSize: 11.5, marginBottom: 3 }]}>{translate("Kỹ thuật viên:")}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                        <TouchableOpacity
                          style={[
                            styles.bmbFilterChip,
                            bmbAttendanceFilterTech === 'ALL' && styles.bmbFilterChipActive,
                            { paddingHorizontal: 10, paddingVertical: 4, marginBottom: 0 }
                          ]}
                          onPress={() => {
                            setBmbAttendanceFilterTech('ALL');
                            void fetchBmbAttendance({ techId: 'ALL' });
                          }}
                        >
                          <Text style={[
                            styles.bmbFilterChipText,
                            bmbAttendanceFilterTech === 'ALL' && styles.bmbFilterChipTextActive,
                            { fontSize: 12 }
                          ]}>
                            {translate("Tất cả KTV")}
                          </Text>
                        </TouchableOpacity>
                        {technicians.map((t) => (
                          <TouchableOpacity
                            key={t.id}
                            style={[
                              styles.bmbFilterChip,
                              bmbAttendanceFilterTech === t.id && styles.bmbFilterChipActive,
                              { paddingHorizontal: 10, paddingVertical: 4, marginBottom: 0 }
                            ]}
                            onPress={() => {
                              setBmbAttendanceFilterTech(t.id);
                              void fetchBmbAttendance({ techId: t.id });
                            }}
                          >
                            <Text style={[
                              styles.bmbFilterChipText,
                              bmbAttendanceFilterTech === t.id && styles.bmbFilterChipTextActive,
                              { fontSize: 12 }
                            ]}>
                              {t.fullName}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>

                  {/* Dòng 3: Chip lọc theo Trạng thái */}
                  <View>
                    <Text style={[styles.fieldLabel, { fontSize: 11.5, marginBottom: 3 }]}>{translate("Trạng thái ca trực:")}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      {[
                        { key: 'ALL', label: 'Tất cả' },
                        { key: 'ON_DUTY', label: '🔵 Đang trực' },
                        { key: 'COMPLETED', label: '🟢 Đã kết thúc' },
                        { key: 'LATE', label: '🟠 Đi trễ' },
                        { key: 'EARLY_LEAVE', label: '🟡 Về sớm' },
                        { key: 'PENDING_REVIEW', label: '🔴 Cần xem xét' },
                        { key: 'VERIFIED', label: '✓ Hợp lệ' },
                        { key: 'REJECTED', label: '✕ Bị từ chối' },
                      ].map((st) => (
                        <TouchableOpacity
                          key={st.key}
                          style={[
                            styles.bmbFilterChip,
                            bmbAttendanceFilterStatus === st.key && styles.bmbFilterChipActive,
                            { paddingHorizontal: 10, paddingVertical: 4, marginBottom: 0 }
                          ]}
                          onPress={() => {
                            setBmbAttendanceFilterStatus(st.key);
                            void fetchBmbAttendance({ status: st.key });
                          }}
                        >
                          <Text style={[
                            styles.bmbFilterChipText,
                            bmbAttendanceFilterStatus === st.key && styles.bmbFilterChipTextActive,
                            { fontSize: 11.5 }
                          ]}>
                            {translate(st.label)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Bộ lọc nâng cao & Cấu hình tọa độ tòa nhà (Ẩn mặc định cho gọn) */}
                  {showAdvancedAttendanceFilters && (
                    <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', gap: 10 }}>
                      <View>
                        <Text style={[styles.fieldLabel, { fontSize: 11.5, marginBottom: 4 }]}>{translate("Lọc theo Tòa nhà:")}</Text>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          {['ALL', 'Tòa S1', 'Tòa S2', 'Tòa S3'].map((b) => (
                            <TouchableOpacity
                              key={b}
                              style={[
                                styles.bmbFilterChip,
                                bmbAttendanceFilterBuilding === b && styles.bmbFilterChipActive,
                                { paddingHorizontal: 10, paddingVertical: 5, marginBottom: 0 }
                              ]}
                              onPress={() => {
                                setBmbAttendanceFilterBuilding(b);
                                void fetchBmbAttendance({ buildingBlock: b });
                              }}
                            >
                              <Text style={[
                                styles.bmbFilterChipText,
                                bmbAttendanceFilterBuilding === b && styles.bmbFilterChipTextActive,
                                { fontSize: 11.5 }
                              ]}>
                                {b === 'ALL' ? translate('Tất cả tòa nhà') : b}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      <View style={{ backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, borderLeftWidth: 4, borderLeftColor: bmbBuildingLocation?.isConfirmed ? '#16A34A' : '#F59E0B' }}>
                        <View style={[styles.cardTopRow, { flexWrap: 'wrap', gap: 8 }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontWeight: '800', fontSize: 13.5, color: '#0F172A' }}>
                              🏢 {bmbBuildingLocation?.buildingName || DEFAULT_BUILDING_LOCATION.buildingName} ({bmbBuildingLocation?.isConfirmed ? '✓ Đã xác nhận chuẩn' : '⚠️ Chưa xác nhận tọa độ'})
                            </Text>
                            <Text style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                              📍 GPS: ({bmbBuildingLocation?.latitude ?? DEFAULT_BUILDING_LOCATION.latitude}, {bmbBuildingLocation?.longitude ?? DEFAULT_BUILDING_LOCATION.longitude}) • Bán kính hợp lệ: ≤ {bmbBuildingLocation?.allowedRadiusMeters ?? DEFAULT_BUILDING_LOCATION.allowedRadiusMeters}m
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={[
                              styles.primaryActionBtn,
                              { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: bmbBuildingLocation?.isConfirmed ? '#0284C7' : '#EA580C' }
                            ]}
                            onPress={() => {
                              if (bmbBuildingLocation) {
                                setBmbBuildingForm({
                                  buildingName: bmbBuildingLocation.buildingName || DEFAULT_BUILDING_LOCATION.buildingName,
                                  buildingAddress: bmbBuildingLocation.buildingAddress || DEFAULT_BUILDING_LOCATION.buildingAddress,
                                  latitude: String(bmbBuildingLocation.latitude ?? DEFAULT_BUILDING_LOCATION.latitude),
                                  longitude: String(bmbBuildingLocation.longitude ?? DEFAULT_BUILDING_LOCATION.longitude),
                                  allowedRadiusMeters: String(bmbBuildingLocation.allowedRadiusMeters ?? DEFAULT_BUILDING_LOCATION.allowedRadiusMeters),
                                  note: '',
                                });
                              }
                              setBmbBuildingModalVisible(true);
                            }}
                          >
                            <Text style={[styles.primaryActionBtnText, { fontSize: 12 }]}>
                              {bmbBuildingLocation?.isConfirmed ? '⚙️ Chỉnh sửa tọa độ' : '⚠️ Xác nhận tọa độ BMB'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  )}
                </View>

                {/* Trạng thái điểm danh KTV chưa bắt đầu / nghỉ theo lịch trong ngày */}
                {bmbTechnicianRosterStatus.some((r) => r.rosterStatus === 'NOT_STARTED' || r.rosterStatus === 'ABSENT' || r.rosterStatus === 'ON_LEAVE') && (
                  <View style={[styles.whiteSectionCard, { marginBottom: 14, padding: 12 }]}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: '#334155', marginBottom: 8 }}>
                      👷 {translate("Kỹ thuật viên chưa check-in / Nghỉ theo lịch trong ngày")}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {bmbTechnicianRosterStatus
                        .filter((r) => r.rosterStatus === 'NOT_STARTED' || r.rosterStatus === 'ABSENT' || r.rosterStatus === 'ON_LEAVE')
                        .map((r) => {
                          const isLeave = r.rosterStatus === 'ON_LEAVE';
                          const isAbsent = r.rosterStatus === 'ABSENT';
                          return (
                            <View
                              key={`${r.techId}-${r.date}`}
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 8,
                                backgroundColor: isLeave ? '#F8FAFC' : isAbsent ? '#FEF2F2' : '#F1F5F9',
                                borderWidth: 1,
                                borderColor: isLeave ? '#CBD5E1' : isAbsent ? '#FECACA' : '#E2E8F0',
                                borderRadius: 10,
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                              }}
                            >
                              <View>
                                <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#0F172A' }}>
                                  {r.techName} <Text style={{ fontWeight: '400', color: '#64748B' }}>({r.shiftScheduled})</Text>
                                </Text>
                                <Text style={{ fontSize: 11, fontWeight: '700', color: isLeave ? '#475569' : isAbsent ? '#DC2626' : '#64748B' }}>
                                  {isLeave ? '⚪ Nghỉ theo lịch' : isAbsent ? '🔴 Vắng mặt theo lịch (Chưa check-in)' : '⚪ Chưa bắt đầu ca'}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                    </View>
                  </View>
                )}

                {/* 2. DANH SÁCH CHẤM CÔNG GỌN GÀNG, DỄ QUÉT NHANH */}
                {(() => {
                  const displayedAttendanceLogs = bmbAttendanceLogs.filter((log: any) => {
                    if (bmbAttendanceFilterTech !== 'ALL' && log.techId !== bmbAttendanceFilterTech) {
                      return false;
                    }
                    return true;
                  });

                  return (
                    <View style={[styles.whiteSectionCard, { width: '100%', maxWidth: '100%' }]}>
                      <View style={[styles.cardTopRow, { flexWrap: 'wrap', gap: 6, marginBottom: 12 }]}>
                        <Text style={styles.cardBlockTitle}>
                          {translate("Danh sách chấm công Kỹ thuật viên")} ({displayedAttendanceLogs.length} {translate("ca trực")})
                        </Text>
                        <Text style={[styles.cardLocationText, { fontSize: 12 }]}>
                          💡 {translate("Bấm vào từng ca trực để xem tọa độ GPS chi tiết, ảnh xác thực & duyệt ngoại lệ")}
                        </Text>
                      </View>

                      {displayedAttendanceLogs.length === 0 ? (
                        <View style={{ paddingVertical: 40, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 10, marginVertical: 8 }}>
                          <Text style={{ fontSize: 24, marginBottom: 8 }}>📋</Text>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#475569' }}>
                            {translate("Không tìm thấy dữ liệu chấm công phù hợp bộ lọc.")}
                          </Text>
                          <Text style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 4 }}>
                            {translate("Hãy chọn 'Tất cả' hoặc thay đổi mốc thời gian để xem các ca trực khác.")}
                          </Text>
                        </View>
                      ) : (
                        displayedAttendanceLogs.map((log: any) => {
                          const verification = log.verificationStatus || 'VERIFIED';
                          const hasAnom = Boolean(log.anomalyNotes);
                          const isPendingReview = verification === 'PENDING_REVIEW' || verification === 'NEEDS_EXPLANATION';
                          const isRejected = verification === 'REJECTED';
                          const isLate = (log.lateArrivalMinutes ?? log.lateMinutes ?? 0) > 0;
                          const isEarlyLeave = (log.earlyLeaveMinutes ?? log.earlyMinutes ?? 0) > 0;
                          const gpsValid = log.gpsValid !== undefined
                            ? Boolean(log.gpsValid)
                            : Boolean(log.checkInGps && (log.checkInGps.isWithinAllowedRadius ?? log.checkInGps.isWithinRadius) !== false);

                          const arrivalLabel =
                            log.arrivalLabel ||
                            (isLate ? `Đi trễ ${log.lateMinutes || 0} phút` : 'Đúng giờ');
                          const departureLabel =
                            log.departureLabel ||
                            (!log.checkOut
                              ? 'Đang trong ca'
                              : isEarlyLeave
                              ? `Về sớm ${log.earlyMinutes || 0} phút`
                              : 'Đúng giờ');
                          const gpsLabel =
                            log.gpsStatusLabel ||
                            (log.checkInGps ? (gpsValid ? 'GPS hợp lệ' : 'GPS bất thường') : 'Thiếu GPS');
                          const validHours =
                            log.validWorkHours !== undefined
                              ? log.validWorkHours
                              : isRejected
                              ? 0
                              : (log.billableHours ?? log.workHours ?? 0);

                          // Màu sắc kết hợp chữ rõ ràng: Xanh (Hợp lệ/Đúng giờ), Vàng/Cam (Đi trễ/Về sớm), Đỏ (Bất thường/Từ chối), Xám (Chưa kết thúc)
                          const cardBorderColor =
                            isPendingReview || isRejected || !gpsValid
                              ? '#F87171'
                              : isLate || isEarlyLeave || hasAnom
                              ? '#F59E0B'
                              : '#E2E8F0';

                          return (
                            <TouchableOpacity
                              key={log.id}
                              activeOpacity={0.85}
                              onPress={() => setSelectedAttendanceDetailModal(log)}
                              style={{
                                width: '100%',
                                backgroundColor: isPendingReview ? '#FFFDF7' : '#FFFFFF',
                                borderRadius: 12,
                                borderWidth: 1.5,
                                borderColor: cardBorderColor,
                                padding: 14,
                                marginBottom: 10,
                              }}
                            >
                              {/* Hàng 1: Tên KTV, Ngày, Ca phân công & Trạng thái ca */}
                              <View style={[styles.cardTopRow, { flexWrap: 'wrap', gap: 8, marginBottom: 8 }]}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 220 }}>
                                  <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#BFDBFE' }}>
                                    <Text style={{ fontSize: 18 }}>👷</Text>
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontWeight: '800', fontSize: 15, color: '#0F172A' }}>
                                      {log.techName}
                                    </Text>
                                    <Text style={{ fontSize: 12, color: '#475569', marginTop: 1 }}>
                                      📅 <Text style={{ fontWeight: '700' }}>{log.date}</Text> • 🕒 Ca phân công: <Text style={{ fontWeight: '700' }}>{log.shiftScheduled || '07:00 - 15:00'}</Text>
                                    </Text>
                                  </View>
                                </View>

                                {/* Trạng thái ca trực & xác minh */}
                                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <View style={[
                                    styles.statusPill,
                                    !log.checkOut ? { backgroundColor: '#DBEAFE' } : { backgroundColor: '#DCFCE7' }
                                  ]}>
                                    <Text style={[
                                      styles.statusPillText,
                                      !log.checkOut ? { color: '#1D4ED8' } : { color: '#15803D' }
                                    ]}>
                                      {!log.checkOut ? '🔵 Đang trực' : '🟢 Đã kết thúc'}
                                    </Text>
                                  </View>

                                  <View style={[
                                    styles.statusPill,
                                    verification === 'VERIFIED' || verification === 'APPROVED' ? { backgroundColor: '#DCFCE7' } :
                                      verification === 'REJECTED' ? { backgroundColor: '#FEE2E2' } : { backgroundColor: '#FEF3C7' }
                                  ]}>
                                    <Text style={[
                                      styles.statusPillText,
                                      verification === 'VERIFIED' || verification === 'APPROVED' ? { color: '#15803D' } :
                                        verification === 'REJECTED' ? { color: '#B91C1C' } : { color: '#B45309' }
                                    ]}>
                                      {verification === 'VERIFIED' ? '✓ Hợp lệ' :
                                        verification === 'APPROVED' ? '✓ BMB đã duyệt' :
                                          verification === 'NEEDS_EXPLANATION' ? '🔴 Cần giải trình' :
                                            verification === 'REJECTED' ? '✕ Đã từ chối' : '🔴 Cần BMB xem xét'}
                                    </Text>
                                  </View>
                                </View>
                              </View>

                              {/* Hàng 2: Giờ Check-in / Check-out & 4 chỉ số tóm tắt rõ ràng */}
                              <View style={{
                                flexDirection: 'row',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                backgroundColor: '#F8FAFC',
                                borderRadius: 10,
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                                borderWidth: 1,
                                borderColor: '#E2E8F0',
                                gap: 10,
                              }}>
                                {/* Giờ Check-in & Check-out */}
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                                  <View>
                                    <Text style={{ fontSize: 11, color: '#64748B', fontWeight: '600' }}>Giờ Check-in</Text>
                                    <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#0F172A' }}>
                                      {log.checkIn ? new Date(log.checkIn).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                    </Text>
                                  </View>
                                  <View>
                                    <Text style={{ fontSize: 11, color: '#64748B', fontWeight: '600' }}>Giờ Check-out</Text>
                                    <Text style={{ fontSize: 13.5, fontWeight: '800', color: log.checkOut ? '#0F172A' : '#2563EB' }}>
                                      {log.checkOut ? new Date(log.checkOut).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Chưa check-out'}
                                    </Text>
                                  </View>
                                </View>

                                {/* 4 Badge thông tin chính: Đi sớm/trễ, Về sớm/muộn, GPS, Giờ công hợp lệ */}
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                  {/* Badge Giờ vào */}
                                  <View style={{
                                    backgroundColor: isLate ? '#FEF3C7' : '#DCFCE7',
                                    paddingHorizontal: 8,
                                    paddingVertical: 4,
                                    borderRadius: 6,
                                  }}>
                                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: isLate ? '#B45309' : '#15803D' }}>
                                      {isLate ? `🟠 ${arrivalLabel}` : `🟢 Vào: ${arrivalLabel}`}
                                    </Text>
                                  </View>

                                  {/* Badge Giờ ra */}
                                  <View style={{
                                    backgroundColor: !log.checkOut ? '#E2E8F0' : isEarlyLeave ? '#FEF3C7' : '#DCFCE7',
                                    paddingHorizontal: 8,
                                    paddingVertical: 4,
                                    borderRadius: 6,
                                  }}>
                                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: !log.checkOut ? '#475569' : isEarlyLeave ? '#B45309' : '#15803D' }}>
                                      {!log.checkOut ? '⚪ Đang trong ca' : isEarlyLeave ? `🟠 ${departureLabel}` : `🟢 Ra: ${departureLabel}`}
                                    </Text>
                                  </View>

                                  {/* Badge GPS */}
                                  <View style={{
                                    backgroundColor: gpsValid ? '#DCFCE7' : '#FEE2E2',
                                    paddingHorizontal: 8,
                                    paddingVertical: 4,
                                    borderRadius: 6,
                                  }}>
                                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: gpsValid ? '#15803D' : '#B91C1C' }}>
                                      {gpsValid ? '📍 GPS hợp lệ' : `⚠️ ${gpsLabel}`}
                                    </Text>
                                  </View>

                                  {/* Tổng giờ công hợp lệ */}
                                  <View style={{
                                    backgroundColor: '#EFF6FF',
                                    borderWidth: 1,
                                    borderColor: '#BFDBFE',
                                    paddingHorizontal: 10,
                                    paddingVertical: 4,
                                    borderRadius: 6,
                                  }}>
                                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#1D4ED8' }}>
                                      ⏱️ {validHours}h hợp lệ
                                    </Text>
                                  </View>
                                </View>
                              </View>

                              {/* Hàng 3: Tóm tắt ngoại lệ (nếu có) & Nút mở chi tiết */}
                              <View style={[styles.cardTopRow, { marginTop: 8, marginBottom: 0, flexWrap: 'wrap', gap: 8 }]}>
                                <Text style={{ fontSize: 11.5, color: hasAnom ? '#B45309' : '#64748B', fontWeight: hasAnom ? '700' : '500', flex: 1 }} numberOfLines={1}>
                                  {hasAnom
                                    ? `⚠️ Ngoại lệ: ${log.anomalyNotes}`
                                    : log.explanationText
                                    ? `💬 KTV giải trình: "${log.explanationText}"`
                                    : '✓ Đầy đủ dữ liệu đối soát'}
                                </Text>
                                <TouchableOpacity
                                  style={{
                                    backgroundColor: isPendingReview ? '#2563EB' : '#F1F5F9',
                                    paddingHorizontal: 12,
                                    paddingVertical: 5,
                                    borderRadius: 6,
                                  }}
                                  onPress={() => setSelectedAttendanceDetailModal(log)}
                                >
                                  <Text style={{ fontSize: 11.5, fontWeight: '700', color: isPendingReview ? '#FFFFFF' : '#2563EB' }}>
                                    🔍 {isPendingReview ? translate("Xem chi tiết & Xét duyệt") : translate("Chi tiết chấm công")}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </View>
                  );
                })()}
              </ScrollView>

              {/* 4. MODAL CHI TIẾT KỸ THUẬT CHẤM CÔNG (TỌA ĐỘ GPS, KHOẢNG CÁNH, ẢNH, LỊCH SỬ AUDIT & XÉT DUYỆT) */}
              <Modal
                visible={selectedAttendanceDetailModal !== null}
                transparent
                animationType="fade"
                onRequestClose={() => setSelectedAttendanceDetailModal(null)}
              >
                <View style={styles.technicianModalOverlay}>
                  <AnimatedModalContent
                    visible={selectedAttendanceDetailModal !== null}
                    style={[styles.technicianModalCard, { width: 640, maxWidth: '95%', maxHeight: '90%' }]}
                  >
                    {selectedAttendanceDetailModal && (
                      <ScrollView showsVerticalScrollIndicator={false}>
                        <View style={[styles.cardTopRow, { marginBottom: 8 }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.technicianModalTitle}>
                              📋 {translate("Chi tiết Chấm công & Đối soát")}
                            </Text>
                            <Text style={styles.technicianModalDescription}>
                              👷 <Text style={{ fontWeight: '700', color: '#0F172A' }}>{selectedAttendanceDetailModal.techName}</Text> • Ngày {selectedAttendanceDetailModal.date} • Ca phân công: {selectedAttendanceDetailModal.shiftScheduled || '07:00 - 15:00'}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={{ padding: 6, backgroundColor: '#F1F5F9', borderRadius: 16 }}
                            onPress={() => setSelectedAttendanceDetailModal(null)}
                          >
                            <Text style={{ fontSize: 14, fontWeight: '800', color: '#475569' }}>✕</Text>
                          </TouchableOpacity>
                        </View>

                        {/* Tổng hợp giờ công & trạng thái */}
                        <View style={{ backgroundColor: '#F0F9FF', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#BAE6FD' }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: '#0369A1' }}>
                            ⏱️ Tổng giờ thực tế: {selectedAttendanceDetailModal.workHours ?? 0}h • Giờ công hợp lệ: {selectedAttendanceDetailModal.validWorkHours ?? selectedAttendanceDetailModal.billableHours ?? selectedAttendanceDetailModal.workHours ?? 0}h
                          </Text>
                          <Text style={{ fontSize: 12, color: '#0284C7', marginTop: 4 }}>
                            • Giờ vào: {selectedAttendanceDetailModal.arrivalLabel || 'Đúng giờ'} • Giờ ra: {selectedAttendanceDetailModal.departureLabel || 'Đúng giờ'} • Trạng thái: {selectedAttendanceDetailModal.verificationStatus}
                          </Text>
                        </View>

                        {/* Chi tiết GPS & Ảnh Check-in / Check-out */}
                        <View style={{ flexDirection: windowWidth > 640 ? 'row' : 'column', gap: 10, marginBottom: 12 }}>
                          {/* Cột Check-in */}
                          <View style={{ flex: 1, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#E2E8F0' }}>
                            <Text style={{ fontWeight: '800', fontSize: 13, color: '#16A34A', marginBottom: 4 }}>
                              🟢 CHECK-IN: {formatDateTime(selectedAttendanceDetailModal.checkIn)}
                            </Text>
                            {selectedAttendanceDetailModal.checkInGps ? (
                              <View style={{ gap: 2 }}>
                                <Text style={{ fontSize: 12, color: '#0F172A', fontWeight: '600' }}>
                                  📍 Tọa độ GPS: {selectedAttendanceDetailModal.checkInGps.latitude?.toFixed(6)}, {selectedAttendanceDetailModal.checkInGps.longitude?.toFixed(6)}
                                </Text>
                                <Text style={{ fontSize: 12, color: '#334155' }}>
                                  📏 Khoảng cách đến tòa nhà: <Text style={{ fontWeight: '700' }}>~{selectedAttendanceDetailModal.checkInGps.distanceMeters ?? 0}m</Text> (Cho phép ≤ 300m)
                                </Text>
                                <Text style={{ fontSize: 12, color: '#334155' }}>
                                  🎯 Độ chính xác vị trí: ±{selectedAttendanceDetailModal.checkInGps.accuracy ?? 10}m
                                </Text>
                                {selectedAttendanceDetailModal.checkInMapUrl && (
                                  <TouchableOpacity
                                    style={{ marginTop: 4 }}
                                    onPress={() => Linking.openURL(selectedAttendanceDetailModal.checkInMapUrl)}
                                  >
                                    <Text style={{ fontSize: 12, color: '#2563EB', fontWeight: '700' }}>🗺️ Mở vị trí trên Google Maps</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            ) : (
                              <Text style={{ fontSize: 12, color: '#94A3B8' }}>Không có dữ liệu GPS Check-in</Text>
                            )}
                            {selectedAttendanceDetailModal.checkInPhotoUrl && (
                              <TouchableOpacity
                                style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                                onPress={() => setViewingPhotoModal({
                                  url: selectedAttendanceDetailModal.checkInPhotoUrl,
                                  title: `Ảnh Check-in - ${selectedAttendanceDetailModal.techName}`,
                                  meta: { time: selectedAttendanceDetailModal.checkIn, gps: selectedAttendanceDetailModal.checkInGps, techName: selectedAttendanceDetailModal.techName, date: selectedAttendanceDetailModal.date }
                                })}
                              >
                                <Image
                                  source={{ uri: selectedAttendanceDetailModal.checkInPhotoUrl }}
                                  style={{ width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1' }}
                                />
                                <Text style={{ fontSize: 12, color: '#2563EB', fontWeight: '700' }}>📷 Phóng to ảnh Check-in</Text>
                              </TouchableOpacity>
                            )}
                          </View>

                          {/* Cột Check-out */}
                          <View style={{ flex: 1, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#E2E8F0' }}>
                            <Text style={{ fontWeight: '800', fontSize: 13, color: selectedAttendanceDetailModal.checkOut ? '#DC2626' : '#64748B', marginBottom: 4 }}>
                              🔴 CHECK-OUT: {selectedAttendanceDetailModal.checkOut ? formatDateTime(selectedAttendanceDetailModal.checkOut) : 'Chưa check-out'}
                            </Text>
                            {selectedAttendanceDetailModal.checkOutGps ? (
                              <View style={{ gap: 2 }}>
                                <Text style={{ fontSize: 12, color: '#0F172A', fontWeight: '600' }}>
                                  📍 Tọa độ GPS: {selectedAttendanceDetailModal.checkOutGps.latitude?.toFixed(6)}, {selectedAttendanceDetailModal.checkOutGps.longitude?.toFixed(6)}
                                </Text>
                                <Text style={{ fontSize: 12, color: '#334155' }}>
                                  📏 Khoảng cách đến tòa nhà: <Text style={{ fontWeight: '700' }}>~{selectedAttendanceDetailModal.checkOutGps.distanceMeters ?? 0}m</Text>
                                </Text>
                                <Text style={{ fontSize: 12, color: '#334155' }}>
                                  🎯 Độ chính xác vị trí: ±{selectedAttendanceDetailModal.checkOutGps.accuracy ?? 10}m
                                </Text>
                                {selectedAttendanceDetailModal.checkOutMapUrl && (
                                  <TouchableOpacity
                                    style={{ marginTop: 4 }}
                                    onPress={() => Linking.openURL(selectedAttendanceDetailModal.checkOutMapUrl)}
                                  >
                                    <Text style={{ fontSize: 12, color: '#2563EB', fontWeight: '700' }}>🗺️ Mở vị trí trên Google Maps</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            ) : (
                              <Text style={{ fontSize: 12, color: '#94A3B8' }}>
                                {selectedAttendanceDetailModal.checkOut ? 'Không có dữ liệu GPS Check-out' : 'KTV đang trong ca trực'}
                              </Text>
                            )}
                            {selectedAttendanceDetailModal.checkOutPhotoUrl && (
                              <TouchableOpacity
                                style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                                onPress={() => setViewingPhotoModal({
                                  url: selectedAttendanceDetailModal.checkOutPhotoUrl,
                                  title: `Ảnh Check-out - ${selectedAttendanceDetailModal.techName}`,
                                  meta: { time: selectedAttendanceDetailModal.checkOut, gps: selectedAttendanceDetailModal.checkOutGps, techName: selectedAttendanceDetailModal.techName, date: selectedAttendanceDetailModal.date }
                                })}
                              >
                                <Image
                                  source={{ uri: selectedAttendanceDetailModal.checkOutPhotoUrl }}
                                  style={{ width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1' }}
                                />
                                <Text style={{ fontSize: 12, color: '#2563EB', fontWeight: '700' }}>📷 Phóng to ảnh Check-out</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>

                        {/* Lý do ngoại lệ / Giải trình KTV / Quyết định BMB */}
                        {selectedAttendanceDetailModal.anomalyNotes && (
                          <View style={{ backgroundColor: '#FFFBEB', borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#FDE68A' }}>
                            <Text style={{ fontSize: 12.5, color: '#B45309', fontWeight: '700' }}>
                              ⚠️ Lý do ngoại lệ: {selectedAttendanceDetailModal.anomalyNotes}
                            </Text>
                          </View>
                        )}

                        {selectedAttendanceDetailModal.explanationText && (
                          <View style={{ backgroundColor: '#F5F3FF', borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#DDD6FE' }}>
                            <Text style={{ fontSize: 12.5, color: '#6D28D9', fontWeight: '700' }}>
                              💬 Giải trình từ KTV: <Text style={{ fontWeight: '400', fontStyle: 'italic' }}>&quot;{selectedAttendanceDetailModal.explanationText}&quot;</Text>
                            </Text>
                          </View>
                        )}

                        {selectedAttendanceDetailModal.reviewNote && (
                          <View style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' }}>
                            <Text style={{ fontSize: 12.5, color: '#334155' }}>
                              📝 <Text style={{ fontWeight: '700' }}>Quyết định BMB ({selectedAttendanceDetailModal.reviewedBy || 'BMB'}):</Text> &quot;{selectedAttendanceDetailModal.reviewNote}&quot; ({formatDateTime(selectedAttendanceDetailModal.reviewedAt)})
                            </Text>
                          </View>
                        )}

                        {/* Lịch sử BMB đối soát (Audit Trail) */}
                        {Array.isArray(selectedAttendanceDetailModal.auditLogs) && selectedAttendanceDetailModal.auditLogs.length > 0 && (
                          <View style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0' }}>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4 }}>
                              📜 Lịch sử xác minh & BMB đối soát:
                            </Text>
                            {selectedAttendanceDetailModal.auditLogs.map((al: any, aIdx: number) => (
                              <Text key={aIdx} style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
                                • [{formatDateTime(al.performedAt || al.timestamp)}] <Text style={{ fontWeight: '700', color: '#334155' }}>{al.performedByName || al.actorName || 'Hệ thống'}</Text> ({al.action}): {al.note}
                              </Text>
                            ))}
                          </View>
                        )}

                        {/* Các nút thao tác đối soát của BMB */}
                        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 6 }}>
                          <TouchableOpacity
                            style={[styles.primaryActionBtn, { paddingVertical: 9, paddingHorizontal: 14, backgroundColor: '#16A34A', borderRadius: 8 }]}
                            onPress={() => {
                              const targetLog = selectedAttendanceDetailModal;
                              setSelectedAttendanceDetailModal(null);
                              setSelectedAttendanceForReview(targetLog);
                              setBmbReviewAction('APPROVE');
                              setBmbAdjustedHours(String(targetLog.workHours || 8));
                              setBmbReviewNote('Đã kiểm tra minh chứng, hợp lệ tính công.');
                              setShowAttendanceReviewModal(true);
                            }}
                          >
                            <Text style={[styles.primaryActionBtnText, { fontSize: 12.5, fontWeight: '700' }]}>✓ {translate("Phê duyệt tính lương")}</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.primaryActionBtn, { paddingVertical: 9, paddingHorizontal: 14, backgroundColor: '#8B5CF6', borderRadius: 8 }]}
                            onPress={() => {
                              const targetLog = selectedAttendanceDetailModal;
                              setSelectedAttendanceDetailModal(null);
                              setSelectedAttendanceForReview(targetLog);
                              setBmbReviewAction('REQUEST_EXPLANATION');
                              setBmbAdjustedHours('');
                              setBmbReviewNote('Yêu cầu giải trình rõ lý do chênh lệch vị trí GPS / đi muộn.');
                              setShowAttendanceReviewModal(true);
                            }}
                          >
                            <Text style={[styles.primaryActionBtnText, { fontSize: 12.5, fontWeight: '700' }]}>💬 {translate("Yêu cầu giải trình")}</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.primaryActionBtn, { paddingVertical: 9, paddingHorizontal: 14, backgroundColor: '#DC2626', borderRadius: 8 }]}
                            onPress={() => {
                              const targetLog = selectedAttendanceDetailModal;
                              setSelectedAttendanceDetailModal(null);
                              setSelectedAttendanceForReview(targetLog);
                              setBmbReviewAction('REJECT');
                              setBmbAdjustedHours('0');
                              setBmbReviewNote('Không công nhận ca trực do vi phạm quy chế chấm công.');
                              setShowAttendanceReviewModal(true);
                            }}
                          >
                            <Text style={[styles.primaryActionBtnText, { fontSize: 12.5, fontWeight: '700' }]}>✕ {translate("Từ chối ca trực")}</Text>
                          </TouchableOpacity>
                        </View>
                      </ScrollView>
                    )}
                  </AnimatedModalContent>
                </View>
              </Modal>
            </View>
          )}

          {/* ==================================================================== */}
          {/* MÀN HÌNH 05 BMB: CHẤM CÔNG & TÍNH LƯƠNG KỸ THUẬT VIÊN                 */}
          {/* ==================================================================== */}
          {bmbNavTab === 'PAYROLL' && (
            <View style={[styles.bmbContentTwoCols, isMobileLayout && { flexDirection: 'column', padding: 12, gap: 12 }]}>
              {/* CỘT TRÁI: BẢNG LƯƠNG & DUYỆT TĂNG CA */}
              <ScrollView style={styles.bmbCenterColumn} showsVerticalScrollIndicator={false}>
                <View style={styles.cardTopRow}>
                  <View>
                    <Text style={styles.bmbPageTitle}>{translate("Chấm công & Tính lương Kỹ thuật viên")}</Text>
                    <Text style={styles.bmbPageSubtitle}>
                      {translate("Mô hình Lương cố định tháng + Tăng ca (OT) được duyệt")}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.primaryActionBtn,
                      bmbPayrollSummary?.isLocked
                        ? { backgroundColor: '#10B981' }
                        : { backgroundColor: '#2563EB' }
                    ]}
                    onPress={handleBmbLockMonth}
                    disabled={loading || bmbPayrollSummary?.isLocked}
                  >
                    <Text style={styles.primaryActionBtnText}>
                      {bmbPayrollSummary?.isLocked
                        ? '🔒 ' + translate('Đã khóa bảng lương')
                        : '🔒 ' + translate('Khóa bảng lương tháng')}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Sub-tabs BMB Payroll */}
                <View style={[styles.chipWrapRow, { marginVertical: 12 }]}>
                  {[
                    { key: 'SUMMARY', label: 'Bảng lương tổng hợp' },
                    { key: 'OVERTIME', label: `Duyệt tăng ca (${bmbOvertimeRequests.filter((o) => o.status === 'PENDING').length})` },
                    { key: 'ATTENDANCE', label: 'Nhật ký chấm công' },
                    { key: 'SCHEDULE', label: `Đổi ca/Nghỉ (${scheduleRequests.filter((r) => r.status === 'PENDING').length})` },
                    { key: 'COSTS', label: `Chi phí vật tư (${costReport?.pendingCount || 0})` },
                    { key: 'SLA', label: `SLA & Giám sát (${slaDashboard?.breachedCount || 0})` },
                    { key: 'CONFIG', label: 'Cấu hình lương' },
                  ].map((pt) => (
                    <TouchableOpacity
                      key={pt.key}
                      style={[
                        styles.bmbFilterChip,
                        bmbPayrollTab === pt.key && styles.bmbFilterChipActive,
                      ]}
                      onPress={() => setBmbPayrollTab(pt.key as any)}
                    >
                      <Text
                        style={[
                          styles.bmbFilterChipText,
                          bmbPayrollTab === pt.key && styles.bmbFilterChipTextActive,
                        ]}
                      >
                        {translate(pt.label)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Sub-tab 1: Bảng lương tổng hợp & Thống kê hiệu suất 4 nhóm (Phần G) */}
                <ScreenTransition transitionKey={bmbPayrollTab} style={{ flex: 1 }}>
                  {bmbPayrollTab === 'SUMMARY' && (
                    <View style={styles.whiteSectionCard}>
                      {/* Header chọn tháng & Công thức cố định */}
                      <View style={[styles.cardTopRow, { flexWrap: 'wrap', gap: 10, marginBottom: 10 }]}>
                        <View>
                          <Text style={styles.cardBlockTitle}>
                            {translate("Bảng lương & Hiệu suất KTV tháng")} {bmbPayrollSummary?.month || bmbPayrollMonth}
                          </Text>
                          <Text style={{ fontSize: 12, color: '#64748B' }}>
                            Lương cơ bản cố định: <Text style={{ fontWeight: '700', color: '#0F172A' }}>5.000.000 VNĐ / 180 giờ</Text> (~27.778 VNĐ/giờ) + Tiền thưởng BMB
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <TextInput
                            style={[styles.bmbWebInput, { width: 110, paddingVertical: 5, fontSize: 12.5, marginBottom: 0 }]}
                            value={bmbPayrollMonth}
                            onChangeText={(val) => {
                              setBmbPayrollMonth(val);
                              if (/^\d{4}-\d{2}$/.test(val.trim())) {
                                void fetchBmbPayrollSummary(val.trim());
                              }
                            }}
                            placeholder="YYYY-MM"
                            placeholderTextColor="#94A3B8"
                          />
                          <TouchableOpacity
                            style={[styles.bmbFilterChip, { marginBottom: 0, paddingVertical: 6 }]}
                            onPress={() => void fetchBmbPayrollSummary(bmbPayrollMonth)}
                          >
                            <Text style={styles.bmbFilterChipText}>🔄 {translate("Tải tháng")}</Text>
                          </TouchableOpacity>
                          <View style={{ backgroundColor: '#EFF6FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#BFDBFE' }}>
                            <Text style={{ fontWeight: '800', fontSize: 14.5, color: '#2563EB' }}>
                              Tổng quỹ lương: {Number(bmbPayrollSummary?.totalPayout || 0).toLocaleString('vi-VN')} đ
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Thẻ quy tắc công thức */}
                      <View style={{ backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, marginBottom: 14, borderWidth: 1, borderColor: '#E2E8F0' }}>
                        <Text style={{ fontSize: 12, color: '#334155', lineHeight: 18 }}>
                          📐 <Text style={{ fontWeight: '800', color: '#0F172A' }}>Công thức tính lương:</Text> <Text style={{ fontWeight: '700', color: '#1D4ED8' }}>Lương theo giờ = (5.000.000 / 180) × Số giờ công hợp lệ</Text> • <Text style={{ fontWeight: '700', color: '#15803D' }}>Tổng lương = Lương theo giờ + Tiền thưởng BMB</Text> (Giờ công chỉ tính từ chấm công ca làm, không cộng trùng thời gian xử lý sự cố).
                        </Text>
                      </View>

                      {(bmbPayrollSummary?.payrolls || []).map((p: any) => {
                        const perf = p.performance || {};
                        const wg = perf.workHoursGroup || {};
                        const ig = perf.incidentsGroup || {};
                        const rg = perf.responseTimeGroup || {};
                        const rtg = perf.ratingsGroup || {};
                        const isExpanded = expandedPayrollTechId === p.techId;
                        const isSavingBonus = bmbSavingBonusTechId === p.techId;
                        const bonusInputVal = bmbBonusInputs[p.techId] !== undefined ? bmbBonusInputs[p.techId] : String(p.bmbBonus ?? 0);
                        const bonusNoteVal = bmbBonusNotes[p.techId] !== undefined ? bmbBonusNotes[p.techId] : (p.bmbBonusNote || '');

                        return (
                          <View
                            key={p.techId}
                            style={{
                              backgroundColor: '#FFFFFF',
                              borderRadius: 14,
                              borderWidth: 1.5,
                              borderColor: '#E2E8F0',
                              padding: 16,
                              marginBottom: 16,
                            }}
                          >
                            {/* 1. TỔNG QUAN KTV & CÔNG THỨC LƯƠNG */}
                            <View style={[styles.cardTopRow, { flexWrap: 'wrap', gap: 10, marginBottom: 12 }]}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 220 }}>
                                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#BFDBFE' }}>
                                  <Text style={{ fontSize: 20 }}>👷</Text>
                                </View>
                                <View>
                                  <Text style={{ fontWeight: '800', fontSize: 16, color: '#0F172A' }}>
                                    {p.fullName}
                                  </Text>
                                  <Text style={{ fontSize: 12, color: '#64748B', marginTop: 1 }}>
                                    {p.specialtyLabel || 'Điện - Nước'} • {p.buildingBlock || 'Tòa S1'} • Ca: {p.shiftName || '07:00 - 15:00'}
                                  </Text>
                                </View>
                              </View>

                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={{ fontSize: 11, color: '#64748B', fontWeight: '600' }}>TỔNG LƯƠNG THÁNG</Text>
                                <Text style={{ fontWeight: '900', fontSize: 20, color: '#16A34A' }}>
                                  {Number(p.totalSalary || 0).toLocaleString('vi-VN')} VNĐ
                                </Text>
                              </View>
                            </View>

                            {/* Bảng tóm tắt 5 chỉ số lương tổng quan */}
                            <View style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              gap: 8,
                              backgroundColor: '#F8FAFC',
                              borderRadius: 10,
                              padding: 12,
                              borderWidth: 1,
                              borderColor: '#E2E8F0',
                              marginBottom: 12,
                            }}>
                              <View style={{ flex: 1, minWidth: 120 }}>
                                <Text style={{ fontSize: 11, color: '#64748B' }}>Tổng giờ công hợp lệ</Text>
                                <Text style={{ fontSize: 14.5, fontWeight: '800', color: '#0F172A', marginTop: 2 }}>
                                  {p.validWorkHours ?? p.regularHours ?? 0}h / 180h
                                </Text>
                              </View>
                              <View style={{ flex: 1, minWidth: 120 }}>
                                <Text style={{ fontSize: 11, color: '#64748B' }}>Đơn giá giờ (5tr / 180h)</Text>
                                <Text style={{ fontSize: 14.5, fontWeight: '700', color: '#334155', marginTop: 2 }}>
                                  ~{Number(p.hourlyRate || 27778).toLocaleString('vi-VN')} đ/h
                                </Text>
                              </View>
                              <View style={{ flex: 1, minWidth: 120 }}>
                                <Text style={{ fontSize: 11, color: '#64748B' }}>Lương theo giờ</Text>
                                <Text style={{ fontSize: 14.5, fontWeight: '800', color: '#2563EB', marginTop: 2 }}>
                                  {Number(p.hourlySalary ?? p.regularPay ?? 0).toLocaleString('vi-VN')} đ
                                </Text>
                              </View>
                              <View style={{ flex: 1, minWidth: 120 }}>
                                <Text style={{ fontSize: 11, color: '#64748B' }}>Tiền thưởng BMB</Text>
                                <Text style={{ fontSize: 14.5, fontWeight: '800', color: '#16A34A', marginTop: 2 }}>
                                  +{Number(p.bmbBonus || 0).toLocaleString('vi-VN')} đ
                                </Text>
                              </View>
                              <View style={{ flex: 1, minWidth: 120 }}>
                                <Text style={{ fontSize: 11, color: '#64748B' }}>Tổng lương</Text>
                                <Text style={{ fontSize: 14.5, fontWeight: '900', color: '#15803D', marginTop: 2 }}>
                                  {Number(p.totalSalary || 0).toLocaleString('vi-VN')} đ
                                </Text>
                              </View>
                            </View>

                            {/* 2. HIỂN THỊ HIỆU SUẤT 4 NHÓM RÕ RÀNG */}
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                              {/* Nhóm 1: Giờ công */}
                              <View style={{ flex: 1, minWidth: 190, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E2E8F0' }}>
                                <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#1E40AF', marginBottom: 6 }}>
                                  🕒 Nhóm 1 — Giờ công
                                </Text>
                                <Text style={{ fontSize: 12, color: '#334155', marginBottom: 2 }}>
                                  • Giờ công hợp lệ: <Text style={{ fontWeight: '700' }}>{wg.validWorkHours ?? p.validWorkHours ?? 0} giờ</Text>
                                </Text>
                                <Text style={{ fontSize: 12, color: '#334155', marginBottom: 2 }}>
                                  • Số ngày làm: <Text style={{ fontWeight: '700' }}>{wg.workDaysCount ?? 0} ngày</Text>
                                </Text>
                                <Text style={{ fontSize: 12, color: '#334155', marginBottom: 2 }}>
                                  • Ngày nghỉ theo lịch: <Text style={{ fontWeight: '700' }}>{wg.scheduledLeaveDaysCount ?? 0} ngày</Text>
                                </Text>
                                <Text style={{ fontSize: 12, color: '#D97706' }}>
                                  • Đi trễ: <Text style={{ fontWeight: '700' }}>{wg.lateCheckInCount ?? 0} lần</Text> • Về sớm: <Text style={{ fontWeight: '700' }}>{wg.earlyLeaveCount ?? 0} lần</Text>
                                </Text>
                              </View>

                              {/* Nhóm 2: Sự cố */}
                              <View style={{ flex: 1, minWidth: 190, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E2E8F0' }}>
                                <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#0F766E', marginBottom: 6 }}>
                                  🛠️ Nhóm 2 — Sự cố trong tháng
                                </Text>
                                <Text style={{ fontSize: 12, color: '#334155', marginBottom: 2 }}>
                                  • Tổng được phân công: <Text style={{ fontWeight: '700' }}>{ig.totalAssignedTickets ?? 0} sự cố</Text>
                                </Text>
                                <Text style={{ fontSize: 12, color: '#334155', marginBottom: 2 }}>
                                  • Mức Cao: <Text style={{ fontWeight: '700', color: '#DC2626' }}>{ig.highPriorityCount ?? 0}</Text> • TB: <Text style={{ fontWeight: '700', color: '#D97706' }}>{ig.mediumPriorityCount ?? 0}</Text> • Thấp: <Text style={{ fontWeight: '700', color: '#2563EB' }}>{ig.lowPriorityCount ?? 0}</Text>
                                </Text>
                                <Text style={{ fontSize: 12, color: '#16A34A', fontWeight: '700' }}>
                                  • Đã hoàn thành: {ig.completedTicketsCount ?? 0} sự cố
                                </Text>
                              </View>

                              {/* Nhóm 3: Thời gian phản hồi hiện trường */}
                              <View style={{ flex: 1, minWidth: 190, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E2E8F0' }}>
                                <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#B45309', marginBottom: 6 }}>
                                  ⚡ Nhóm 3 — Thời gian phản hồi (≤15p)
                                </Text>
                                <Text style={{ fontSize: 12, color: '#16A34A', marginBottom: 2 }}>
                                  • Đến đúng giờ (≤15p): <Text style={{ fontWeight: '700' }}>{rg.onTimeArrivalCount ?? 0} lần</Text>
                                </Text>
                                <Text style={{ fontSize: 12, color: '#DC2626', marginBottom: 2 }}>
                                  • Đến hiện trường trễ (&gt;15p): <Text style={{ fontWeight: '700' }}>{rg.lateArrivalCount ?? 0} lần</Text>
                                </Text>
                                <Text style={{ fontSize: 12, color: '#B91C1C', marginBottom: 2 }}>
                                  • Tổng số phút trễ: <Text style={{ fontWeight: '700' }}>{rg.totalLateArrivalMinutes ?? 0} phút</Text>
                                </Text>
                                {(rg.pendingArrivalCount ?? 0) > 0 && (
                                  <Text style={{ fontSize: 11, color: '#64748B' }}>
                                    • Chưa check-in hiện trường: {rg.pendingArrivalCount} sự cố
                                  </Text>
                                )}
                              </View>

                              {/* Nhóm 4: Đánh giá */}
                              <View style={{ flex: 1, minWidth: 190, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E2E8F0' }}>
                                <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#7C3AED', marginBottom: 6 }}>
                                  ⭐ Nhóm 4 — Đánh giá cư dân
                                </Text>
                                <Text style={{ fontSize: 12, color: '#334155', marginBottom: 2 }}>
                                  • Tổng lượt đánh giá: <Text style={{ fontWeight: '700' }}>{rtg.totalRatingsCount ?? 0} lượt</Text>
                                </Text>
                                <Text style={{ fontSize: 12, color: '#334155' }}>
                                  • Điểm trung bình:{' '}
                                  <Text style={{ fontWeight: '800', color: '#D97706' }}>
                                    {rtg.averageRating != null ? `★ ${rtg.averageRating} / 5.0` : 'Chưa có đánh giá'}
                                  </Text>
                                </Text>
                              </View>
                            </View>

                            {/* 3. BMB NHẬP TIỀN THƯỞNG THỦ CÔNG (Phần G4) */}
                            <View style={{
                              backgroundColor: '#F0FDF4',
                              borderRadius: 10,
                              padding: 12,
                              borderWidth: 1,
                              borderColor: '#BBF7D0',
                              marginBottom: 10,
                            }}>
                              <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#166534', marginBottom: 6 }}>
                                🎁 {translate("BMB xét thưởng thủ công theo hiệu suất tháng")} (VNĐ)
                              </Text>
                              <View style={{ flexDirection: Platform.OS === 'web' ? 'row' : 'column', gap: 8, alignItems: Platform.OS === 'web' ? 'center' : 'stretch' }}>
                                <View style={{ flex: 1 }}>
                                  <TextInput
                                    style={[styles.bmbWebInput, { backgroundColor: '#FFFFFF', marginBottom: 0, paddingVertical: 7, fontSize: 13 }]}
                                    value={bonusInputVal}
                                    editable={!bmbPayrollSummary?.isLocked}
                                    keyboardType="numeric"
                                    onChangeText={(val) =>
                                      setBmbBonusInputs((prev) => ({ ...prev, [p.techId]: val.replace(/[^\d]/g, '') }))
                                    }
                                    placeholder="Nhập số tiền thưởng (VD: 500000)"
                                    placeholderTextColor="#94A3B8"
                                  />
                                </View>
                                <View style={{ flex: 1.5 }}>
                                  <TextInput
                                    style={[styles.bmbWebInput, { backgroundColor: '#FFFFFF', marginBottom: 0, paddingVertical: 7, fontSize: 12.5 }]}
                                    value={bonusNoteVal}
                                    editable={!bmbPayrollSummary?.isLocked}
                                    onChangeText={(val) =>
                                      setBmbBonusNotes((prev) => ({ ...prev, [p.techId]: val }))
                                    }
                                    placeholder="Ghi chú lý do thưởng (VD: Phản hồi nhanh, đánh giá 5 sao...)"
                                    placeholderTextColor="#94A3B8"
                                  />
                                </View>
                                <TouchableOpacity
                                  style={[
                                    styles.primaryActionBtn,
                                    {
                                      backgroundColor: bmbPayrollSummary?.isLocked ? '#94A3B8' : '#16A34A',
                                      paddingVertical: 9,
                                      paddingHorizontal: 14,
                                    }
                                  ]}
                                  disabled={Boolean(bmbPayrollSummary?.isLocked) || isSavingBonus}
                                  onPress={() => void handleSaveBmbBonus(p.techId, p.fullName)}
                                >
                                  <Text style={[styles.primaryActionBtnText, { fontSize: 12.5 }]}>
                                    {isSavingBonus ? translate("Đang lưu...") : '💾 ' + translate("Lưu tiền thưởng")}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                              {p.bmbBonusUpdatedAt && (
                                <Text style={{ fontSize: 11, color: '#15803D', marginTop: 4 }}>
                                  ✓ Cập nhật gần nhất bởi {p.bmbBonusUpdatedBy || 'BMB'} lúc {formatDateTime(p.bmbBonusUpdatedAt)} {p.bmbBonusNote ? `— "${p.bmbBonusNote}"` : ''}
                                </Text>
                              )}
                            </View>

                            {/* 4. NÚT MỞ RỘNG CHI TIẾT (Lịch sử chấm công, Danh sách sự cố & sự cố trễ, Lịch sử tiền thưởng) */}
                            <TouchableOpacity
                              style={{
                                alignSelf: 'flex-start',
                                backgroundColor: '#F1F5F9',
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderRadius: 8,
                              }}
                              onPress={() => setExpandedPayrollTechId(isExpanded ? null : p.techId)}
                            >
                              <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>
                                {isExpanded ? '▲ Thu gọn chi tiết tháng' : '▼ Xem chi tiết sự cố đến trễ, lịch sử chấm công & lịch sử tiền thưởng'}
                              </Text>
                            </TouchableOpacity>

                            <CollapsibleDrawer expanded={Boolean(isExpanded)}>
                              <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', gap: 12 }}>
                                {/* Chi tiết từng sự cố đến hiện trường trễ (>15 phút) */}
                                <View>
                                  <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#B91C1C', marginBottom: 4 }}>
                                    🚨 Chi tiết các sự cố đến hiện trường trễ (&gt; 15 phút):
                                  </Text>
                                  {Array.isArray(rg.lateTicketsDetail) && rg.lateTicketsDetail.length > 0 ? (
                                    rg.lateTicketsDetail.map((lt: any, idx: number) => (
                                      <View key={lt.ticketId || idx} style={{ backgroundColor: '#FEF2F2', borderRadius: 8, padding: 8, marginBottom: 4, borderWidth: 1, borderColor: '#FECACA' }}>
                                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#991B1B' }}>
                                          • [{lt.ticketCode}] {lt.title} — Phản hồi: {lt.responseMinutes} phút (Trễ {lt.lateMinutes} phút so với ngưỡng 15p)
                                        </Text>
                                        <Text style={{ fontSize: 11, color: '#7F1D1D', marginTop: 2 }}>
                                          Phân công: {formatDateTime(lt.assignedAt)} → Check-in hiện trường: {formatDateTime(lt.acknowledgedAt)}
                                        </Text>
                                      </View>
                                    ))
                                  ) : (
                                    <Text style={{ fontSize: 12, color: '#16A34A', fontWeight: '600' }}>
                                      ✓ Không có sự cố nào đến hiện trường trễ quá 15 phút trong tháng.
                                    </Text>
                                  )}
                                </View>

                                {/* Danh sách sự cố được phân công trong tháng */}
                                <View>
                                  <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#0F172A', marginBottom: 4 }}>
                                    🛠️ Danh sách sự cố được phân công trong tháng ({Array.isArray(perf.monthTicketsDetail) ? perf.monthTicketsDetail.length : 0}):
                                  </Text>
                                  {Array.isArray(perf.monthTicketsDetail) && perf.monthTicketsDetail.length > 0 ? (
                                    perf.monthTicketsDetail.map((mt: any, mIdx: number) => (
                                      <View key={mt.ticketId || mIdx} style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 8, marginBottom: 4, borderWidth: 1, borderColor: '#E2E8F0' }}>
                                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#0F172A' }}>
                                          • [{mt.ticketCode}] {mt.title} ({mt.priority}) — Trạng thái: {mt.status}
                                        </Text>
                                        <Text style={{ fontSize: 11.5, color: '#475569', marginTop: 2 }}>
                                          Thời gian phản hồi hiện trường:{' '}
                                          {mt.arrivalStatus === 'ON_TIME'
                                            ? `🟢 Đúng giờ (${mt.responseMinutes} phút ≤ 15p)`
                                            : mt.arrivalStatus === 'LATE'
                                            ? `🔴 Đến trễ (${mt.responseMinutes} phút — Trễ ${mt.lateMinutes} phút)`
                                            : '⚪ Chưa đủ dữ liệu / Chưa check-in hiện trường'}{' '}
                                          {mt.ratingStars ? `• Đánh giá: ★ ${mt.ratingStars}/5` : ''}
                                        </Text>
                                      </View>
                                    ))
                                  ) : (
                                    <Text style={{ fontSize: 12, color: '#64748B' }}>Chưa có sự cố nào được phân công trong tháng này.</Text>
                                  )}
                                </View>

                                {/* Lịch sử chấm công trong tháng */}
                                <View>
                                  <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#0F172A', marginBottom: 4 }}>
                                    🕒 Lịch sử chấm công trong tháng ({Array.isArray(p.attendanceLogs) ? p.attendanceLogs.length : 0} ca):
                                  </Text>
                                  {Array.isArray(p.attendanceLogs) && p.attendanceLogs.length > 0 ? (
                                    p.attendanceLogs.slice(0, 10).map((al: any) => (
                                      <Text key={al.id} style={{ fontSize: 11.5, color: '#334155', marginBottom: 2 }}>
                                        • Ngày {al.date} ({al.shiftScheduled || '07:00 - 15:00'}): {al.billableHours ?? al.workHours ?? 0}h hợp lệ — {al.verificationStatus}
                                      </Text>
                                    ))
                                  ) : (
                                    <Text style={{ fontSize: 12, color: '#64748B' }}>Chưa có bản ghi chấm công trong tháng.</Text>
                                  )}
                                </View>

                                {/* Lịch sử thay đổi tiền thưởng BMB */}
                                <View>
                                  <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#166534', marginBottom: 4 }}>
                                    📜 Lịch sử cập nhật tiền thưởng BMB:
                                  </Text>
                                  {Array.isArray(p.bmbBonusHistory) && p.bmbBonusHistory.length > 0 ? (
                                    p.bmbBonusHistory.map((bh: any, bIdx: number) => (
                                      <Text key={bIdx} style={{ fontSize: 11.5, color: '#334155', marginBottom: 2 }}>
                                        • [{formatDateTime(bh.updatedAt)}] <Text style={{ fontWeight: '700' }}>{bh.updatedByName}</Text>: +{Number(bh.bonusAmount || 0).toLocaleString('vi-VN')} đ — &quot;{bh.note}&quot;
                                      </Text>
                                    ))
                                  ) : (
                                    <Text style={{ fontSize: 12, color: '#64748B' }}>Chưa có lịch sử điều chỉnh tiền thưởng trong tháng này.</Text>
                                  )}
                                </View>
                              </View>
                            </CollapsibleDrawer>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Sub-tab 2: Duyệt tăng ca */}
                  {bmbPayrollTab === 'OVERTIME' && (
                    <View style={styles.whiteSectionCard}>
                      <Text style={styles.cardBlockTitle}>{translate("Danh sách yêu cầu tăng ca")}</Text>
                      {bmbOvertimeRequests.length === 0 ? (
                        <Text style={styles.techInfoLine}>{translate("Chưa có yêu cầu tăng ca nào.")}</Text>
                      ) : (
                        bmbOvertimeRequests.map((ot: any) => (
                          <View key={ot.id} style={[styles.notiBlueItem, { paddingVertical: 12, marginBottom: 8 }]}>
                            <View style={{ flex: 1 }}>
                              <View style={styles.cardTopRow}>
                                <Text style={{ fontWeight: '700', fontSize: 14, color: '#0F172A' }}>
                                  {ot.techName} • {ot.hours} giờ ({ot.date})
                                </Text>
                                <View style={[
                                  styles.statusPill,
                                  ot.status === 'APPROVED' ? { backgroundColor: '#DCFCE7' } : ot.status === 'REJECTED' ? { backgroundColor: '#FEE2E2' } : { backgroundColor: '#FEF3C7' }
                                ]}>
                                  <Text style={[
                                    styles.statusPillText,
                                    ot.status === 'APPROVED' ? { color: '#15803D' } : ot.status === 'REJECTED' ? { color: '#B91C1C' } : { color: '#B45309' }
                                  ]}>
                                    {ot.status}
                                  </Text>
                                </View>
                              </View>
                              <Text style={styles.cardLocationText}>
                                Lý do: {ot.reason} {ot.ticketId ? `• Sự cố: ${ot.ticketId}` : ''}
                              </Text>

                              {ot.status === 'PENDING' && (
                                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                                  <TouchableOpacity
                                    style={[styles.primaryActionBtn, { paddingVertical: 6, paddingHorizontal: 14, backgroundColor: '#16A34A' }]}
                                    onPress={() => handleBmbReviewOvertime(ot.id, 'APPROVED', ot.hours)}
                                  >
                                    <Text style={styles.primaryActionBtnText}>✓ {translate("Duyệt")}</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[styles.primaryActionBtn, { paddingVertical: 6, paddingHorizontal: 14, backgroundColor: '#DC2626' }]}
                                    onPress={() => handleBmbReviewOvertime(ot.id, 'REJECTED')}
                                  >
                                    <Text style={styles.primaryActionBtnText}>✕ {translate("Từ chối")}</Text>
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          </View>
                        ))
                      )}
                    </View>
                  )}

                  {/* Sub-tab 3: Nhật ký chấm công & Cảnh báo bất thường */}
                  {bmbPayrollTab === 'ATTENDANCE' && (
                    <View style={styles.whiteSectionCard}>
                      <View style={[styles.cleanInfoCard, { borderColor: '#2563EB', backgroundColor: '#EFF6FF', marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={{ fontWeight: '700', color: '#1D4ED8', fontSize: 13 }}>
                            💡 {translate("Chức năng Quản lý Chấm công đã được nâng cấp chuyên sâu:")}
                          </Text>
                          <Text style={{ fontSize: 12, color: '#1E40AF', marginTop: 2 }}>
                            {translate("Hỗ trợ lọc theo ngày/tháng/KTV/tòa, xem GPS bản đồ, ảnh camera có watermark và xét duyệt ngoại lệ.")}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.primaryActionBtn, { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#2563EB' }]}
                          onPress={() => {
                            setBmbNavTab('ATTENDANCE');
                            void fetchBmbAttendance();
                          }}
                        >
                          <Text style={[styles.primaryActionBtnText, { fontSize: 12 }]}>{translate("Mở Quản lý chấm công")}</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.cardBlockTitle}>{translate("Nhật ký chấm công toàn bộ KTV")}</Text>
                      {bmbAnomalies.length > 0 && (
                        <View style={[styles.cleanInfoCard, { borderColor: '#F59E0B', backgroundColor: '#FFFBEB', marginBottom: 12 }]}>
                          <Text style={{ fontWeight: '700', color: '#B45309', fontSize: 13 }}>⚠️ {translate("Cảnh báo bất thường:")}</Text>
                          {bmbAnomalies.map((anom, idx) => (
                            <Text key={idx} style={{ fontSize: 12, color: '#B45309', marginTop: 2 }}>• {anom}</Text>
                          ))}
                        </View>
                      )}

                      {bmbAttendanceLogs.map((log: any) => (
                        <View key={log.id} style={[styles.notiBlueItem, { paddingVertical: 10, marginBottom: 6 }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontWeight: '700', fontSize: 13.5, color: '#0F172A' }}>
                              {log.techName} • {log.date}
                            </Text>
                            <Text style={styles.cardLocationText}>
                              Vào: {new Date(log.checkIn).toLocaleTimeString('vi-VN')} • Ra: {log.checkOut ? new Date(log.checkOut).toLocaleTimeString('vi-VN') : 'Chưa check-out'}
                            </Text>
                          </View>
                          <View style={[styles.unreadPillBadge, { backgroundColor: '#F1F5F9' }]}>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>
                              {log.workHours ? `${log.workHours}h` : 'Đang trực'}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Sub-tab 4: Cấu hình lương */}
                  {bmbPayrollTab === 'CONFIG' && (
                    <View style={styles.whiteSectionCard}>
                      <Text style={styles.cardBlockTitle}>{translate("Cấu hình mức lương & hệ số tăng ca")}</Text>
                      <Text style={styles.fieldLabel}>{translate("Lương cơ bản mặc định (VND/tháng):")}</Text>
                      <TextInput
                        style={styles.bmbWebInput}
                        value={String(payrollConfig.baseSalaryDefault)}
                        onChangeText={(val) => setPayrollConfig((c) => ({ ...c, baseSalaryDefault: Number(val) || 0 }))}
                        keyboardType="numeric"
                      />
                      <Text style={styles.fieldLabel}>{translate("Giờ làm việc tiêu chuẩn trong tháng (giờ):")}</Text>
                      <TextInput
                        style={styles.bmbWebInput}
                        value={String(payrollConfig.standardMonthlyHours)}
                        onChangeText={(val) => setPayrollConfig((c) => ({ ...c, standardMonthlyHours: Number(val) || 0 }))}
                        keyboardType="numeric"
                      />
                      <Text style={styles.fieldLabel}>{translate("Hệ số tăng ca ngày thường:")}</Text>
                      <TextInput
                        style={styles.bmbWebInput}
                        value={String(payrollConfig.otMultiplierNormal)}
                        onChangeText={(val) => setPayrollConfig((c) => ({ ...c, otMultiplierNormal: Number(val) || 0 }))}
                        keyboardType="numeric"
                      />
                      <Text style={styles.fieldLabel}>{translate("Phụ cấp ăn trưa/đi lại (VND):")}</Text>
                      <TextInput
                        style={styles.bmbWebInput}
                        value={String(payrollConfig.standardAllowance)}
                        onChangeText={(val) => setPayrollConfig((c) => ({ ...c, standardAllowance: Number(val) || 0 }))}
                        keyboardType="numeric"
                      />
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { marginTop: 14 }]}
                        onPress={async () => {
                          try {
                            const res = await fetch(`${API_BASE_URL}/payroll/admin/config`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                              body: JSON.stringify(payrollConfig),
                            });
                            const data = await res.json();
                            showToast(data.message || 'Đã lưu cấu hình lương thành công.');
                          } catch {
                            showToast('Lỗi khi lưu cấu hình.');
                          }
                        }}
                      >
                        <Text style={styles.primaryActionBtnText}>{translate("Lưu cấu hình lương")}</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Sub-tab: Đổi ca & Nghỉ phép */}
                  {bmbPayrollTab === 'SCHEDULE' && (
                    <View style={styles.whiteSectionCard}>
                      <View style={styles.cardTopRow}>
                        <Text style={styles.cardBlockTitle}>{translate("Duyệt Đổi ca & Nghỉ phép KTV")}</Text>
                        <View style={[styles.unreadPillBadge, { backgroundColor: '#EFF6FF' }]}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>
                            {scheduleRequests.filter((r) => r.status === 'PENDING').length} {translate("yêu cầu chờ duyệt")}
                          </Text>
                        </View>
                      </View>
                      {scheduleRequests.length === 0 ? (
                        <Text style={styles.techInfoLine}>{translate("Chưa có yêu cầu nào từ kỹ thuật viên.")}</Text>
                      ) : (
                        scheduleRequests.map((r: any) => {
                          const isPending = r.status === 'PENDING';
                          return (
                            <View key={r.id} style={[styles.notiBlueItem, { paddingVertical: 12, marginBottom: 10 }]}>
                              <View style={{ flex: 1 }}>
                                <View style={styles.cardTopRow}>
                                  <Text style={{ fontWeight: '700', fontSize: 14, color: '#0F172A' }}>
                                    {r.type === 'LEAVE' ? `🏖️ [Nghỉ phép] ${r.techName}` : `🔄 [Đổi ca] ${r.techName}`}
                                  </Text>
                                  <View style={[
                                    styles.statusPill,
                                    r.status === 'APPROVED' ? { backgroundColor: '#DCFCE7' } : r.status === 'REJECTED' ? { backgroundColor: '#FEE2E2' } : { backgroundColor: '#FEF3C7' }
                                  ]}>
                                    <Text style={[
                                      styles.statusPillText,
                                      r.status === 'APPROVED' ? { color: '#15803D' } : r.status === 'REJECTED' ? { color: '#B91C1C' } : { color: '#B45309' }
                                    ]}>
                                      {r.status === 'APPROVED' ? translate('Đã duyệt') : r.status === 'REJECTED' ? translate('Từ chối') : translate('Chờ duyệt')}
                                    </Text>
                                  </View>
                                </View>
                                <Text style={styles.cardLocationText}>
                                  {r.type === 'LEAVE' ? `Loại: ${r.leaveType || 'Phép năm'} • Ngày: ${r.date}` : `Ca: ${r.shiftName || '08:00 - 17:00'} • Ngày: ${r.date}`}
                                </Text>
                                <Text style={[styles.techNotiBodyText, { marginTop: 4 }]}>
                                  {translate("Lý do:")} {r.reason}
                                </Text>
                                {r.reviewNote && (
                                  <Text style={{ fontSize: 11.5, color: '#64748B', fontStyle: 'italic', marginTop: 2 }}>
                                    Ghi chú BMB: {r.reviewNote}
                                  </Text>
                                )}

                                {isPending && r.type === 'LEAVE' && (
                                  <View style={{ marginTop: 8 }}>
                                    <Text style={[styles.fieldLabel, { fontSize: 11 }]}>{translate("Bàn giao công việc cho KTV (nếu còn việc đang làm):")}</Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                                      {technicians.filter((t) => t.id !== r.techId).map((t) => (
                                        <TouchableOpacity
                                          key={t.id}
                                          style={[
                                            styles.filterPill,
                                            scheduleHandoverTechId[r.id] === t.id && styles.filterPillActive,
                                            { paddingVertical: 4, paddingHorizontal: 8 }
                                          ]}
                                          onPress={() => setScheduleHandoverTechId((prev) => ({ ...prev, [r.id]: t.id }))}
                                        >
                                          <Text style={[
                                            styles.filterPillText,
                                            scheduleHandoverTechId[r.id] === t.id && styles.filterPillTextActive,
                                            { fontSize: 11 }
                                          ]}>
                                            {t.fullName}
                                          </Text>
                                        </TouchableOpacity>
                                      ))}
                                    </View>
                                  </View>
                                )}

                                {isPending && (
                                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                                    <TouchableOpacity
                                      style={[styles.primaryActionBtn, { flex: 1, backgroundColor: '#16A34A', paddingVertical: 8 }]}
                                      onPress={() => handleBmbReviewSchedule(r.id, 'APPROVED', scheduleHandoverTechId[r.id])}
                                      disabled={loading}
                                    >
                                      <Text style={styles.primaryActionBtnText}>✓ {translate("Duyệt")}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[styles.primaryActionBtn, { flex: 1, backgroundColor: '#DC2626', paddingVertical: 8 }]}
                                      onPress={() => handleBmbReviewSchedule(r.id, 'REJECTED')}
                                      disabled={loading}
                                    >
                                      <Text style={styles.primaryActionBtnText}>✕ {translate("Từ chối")}</Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                            </View>
                          );
                        })
                      )}
                    </View>
                  )}

                  {/* Sub-tab: Chi phí sửa chữa & Vật tư */}
                  {bmbPayrollTab === 'COSTS' && (
                    <View style={styles.whiteSectionCard}>
                      <Text style={styles.cardBlockTitle}>{translate("Báo cáo Chi phí sửa chữa & Vật tư")}</Text>

                      {/* Cards thống kê */}
                      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
                        <View style={[styles.notiBlueItem, { flex: 1, paddingVertical: 8 }]}>
                          <Text style={[styles.fieldLabel, { fontSize: 11 }]}>{translate("Đã phê duyệt")}</Text>
                          <Text style={{ fontSize: 16, fontWeight: '800', color: '#16A34A' }}>
                            {Number(costReport?.totalApprovedCost || 0).toLocaleString('vi-VN')} đ
                          </Text>
                        </View>
                        <View style={[styles.notiBlueItem, { flex: 1, paddingVertical: 8 }]}>
                          <Text style={[styles.fieldLabel, { fontSize: 11 }]}>{translate("Chờ xét duyệt")}</Text>
                          <Text style={{ fontSize: 16, fontWeight: '800', color: '#D97706' }}>
                            {Number(costReport?.totalPendingCost || 0).toLocaleString('vi-VN')} đ
                          </Text>
                        </View>
                      </View>

                      {/* Cảnh báo bất thường nếu có chi phí > 5 triệu */}
                      {(costReport?.anomalies || []).length > 0 && (
                        <View style={{ backgroundColor: '#FEF2F2', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', marginBottom: 12 }}>
                          <Text style={{ fontWeight: '700', color: '#B91C1C', fontSize: 12.5 }}>
                            🚨 {translate("Cảnh báo bất thường:")} Phát hiện {(costReport?.anomalies || []).length} phiếu chi phí vượt hạn mức thẩm định (trên 5.000.000 VND).
                          </Text>
                        </View>
                      )}

                      <Text style={[styles.cardBlockTitle, { fontSize: 13.5, marginTop: 4 }]}>
                        {translate("Danh sách đề xuất chi phí")} ({costReport?.tickets?.length || 0})
                      </Text>

                      {(costReport?.tickets || []).length === 0 ? (
                        <Text style={styles.techInfoLine}>{translate("Chưa có đề xuất chi phí nào.")}</Text>
                      ) : (
                        costReport.tickets.map((c: any) => {
                          const isPending = c.status === 'PENDING_APPROVAL';
                          return (
                            <View key={c.ticketId} style={[styles.notiBlueItem, { paddingVertical: 12, marginBottom: 10 }]}>
                              <View style={{ flex: 1 }}>
                                <View style={styles.cardTopRow}>
                                  <Text style={{ fontWeight: '700', fontSize: 14, color: '#0F172A' }}>
                                    {c.ticketCode} • {Number(c.totalCost || 0).toLocaleString('vi-VN')} đ
                                  </Text>
                                  <View style={[
                                    styles.statusPill,
                                    c.status === 'APPROVED' ? { backgroundColor: '#DCFCE7' } : c.status === 'REJECTED' ? { backgroundColor: '#FEE2E2' } : { backgroundColor: '#FEF3C7' }
                                  ]}>
                                    <Text style={[
                                      styles.statusPillText,
                                      c.status === 'APPROVED' ? { color: '#15803D' } : c.status === 'REJECTED' ? { color: '#B91C1C' } : { color: '#B45309' }
                                    ]}>
                                      {c.status === 'APPROVED' ? translate('Đã duyệt') : c.status === 'REJECTED' ? translate('Từ chối') : translate('Chờ duyệt')}
                                    </Text>
                                  </View>
                                </View>
                                <Text style={styles.cardLocationText}>{c.ticketTitle}</Text>
                                {(c.items || []).map((it: any, i: number) => (
                                  <Text key={i} style={[styles.techNotiBodyText, { fontSize: 12 }]}>
                                    • {it.materialName} ({it.quantity} {it.unit} x {Number(it.unitPrice).toLocaleString('vi-VN')} đ = {Number(it.totalPrice).toLocaleString('vi-VN')} đ)
                                  </Text>
                                ))}
                                {Number(c.otherCost || 0) > 0 && (
                                  <Text style={[styles.techNotiBodyText, { fontSize: 12, fontStyle: 'italic' }]}>
                                    • Phụ phí khác: {Number(c.otherCost).toLocaleString('vi-VN')} đ
                                  </Text>
                                )}

                                {isPending && (
                                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                                    <TouchableOpacity
                                      style={[styles.primaryActionBtn, { flex: 1, backgroundColor: '#16A34A', paddingVertical: 8 }]}
                                      onPress={() => handleBmbReviewCost(c.ticketId, 'APPROVED')}
                                      disabled={loading}
                                    >
                                      <Text style={styles.primaryActionBtnText}>✓ {translate("Duyệt chi phí")}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[styles.primaryActionBtn, { flex: 1, backgroundColor: '#DC2626', paddingVertical: 8 }]}
                                      onPress={() => handleBmbReviewCost(c.ticketId, 'REJECTED')}
                                      disabled={loading}
                                    >
                                      <Text style={styles.primaryActionBtnText}>✕ {translate("Từ chối chi phí")}</Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                            </View>
                          );
                        })
                      )}
                    </View>
                  )}

                  {/* Sub-tab: SLA & Giám sát Leo thang */}
                  {bmbPayrollTab === 'SLA' && (
                    <View style={styles.whiteSectionCard}>
                      <Text style={styles.cardBlockTitle}>{translate("Giám sát SLA & Cảnh báo Leo thang")}</Text>

                      {/* Nút phát tín hiệu khẩn cấp BMB */}
                      <View style={{ backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', marginVertical: 10 }}>
                        <Text style={{ fontWeight: '700', color: '#991B1B', fontSize: 13, marginBottom: 4 }}>
                          🚨 {translate("Cảnh báo khẩn cấp hệ thống")}
                        </Text>
                        <Text style={{ fontSize: 12, color: '#7F1D1D', marginBottom: 8 }}>
                          {translate("Phát tín hiệu trực tiếp bỏ qua hàng đợi AI, gửi thông báo khẩn tới toàn bộ KTV và Quản lý tòa nhà.")}
                        </Text>
                        <TouchableOpacity
                          style={[styles.primaryActionBtn, { backgroundColor: '#DC2626', paddingVertical: 8 }]}
                          onPress={handleEmergencyBroadcast}
                          disabled={loading}
                        >
                          <Text style={styles.primaryActionBtnText}>🚨 {translate("Phát tín hiệu khẩn cấp")}</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Thống kê SLA */}
                      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
                        <View style={[styles.notiBlueItem, { flex: 1, paddingVertical: 8 }]}>
                          <Text style={[styles.fieldLabel, { fontSize: 11 }]}>{translate("Đúng hạn")}</Text>
                          <Text style={{ fontSize: 18, fontWeight: '800', color: '#16A34A' }}>
                            {slaDashboard?.onTrackCount || 0}
                          </Text>
                        </View>
                        <View style={[styles.notiBlueItem, { flex: 1, paddingVertical: 8 }]}>
                          <Text style={[styles.fieldLabel, { fontSize: 11 }]}>{translate("Sắp quá hạn")}</Text>
                          <Text style={{ fontSize: 18, fontWeight: '800', color: '#D97706' }}>
                            {slaDashboard?.atRiskCount || 0}
                          </Text>
                        </View>
                        <View style={[styles.notiBlueItem, { flex: 1, paddingVertical: 8 }]}>
                          <Text style={[styles.fieldLabel, { fontSize: 11 }]}>{translate("Quá hạn SLA")}</Text>
                          <Text style={{ fontSize: 18, fontWeight: '800', color: '#DC2626' }}>
                            {slaDashboard?.breachedCount || 0}
                          </Text>
                        </View>
                      </View>

                      <Text style={[styles.cardBlockTitle, { fontSize: 13.5, marginTop: 4 }]}>
                        {translate("Sự cố đang giám sát SLA")} ({slaDashboard?.activeTrackings?.length || 0})
                      </Text>

                      {(slaDashboard?.activeTrackings || []).length === 0 ? (
                        <Text style={styles.techInfoLine}>{translate("Không có sự cố nào đang theo dõi SLA.")}</Text>
                      ) : (
                        slaDashboard.activeTrackings.map((t: any) => {
                          const status = t.status || 'ON_TRACK';
                          const bg = status === 'BREACHED' ? '#FEE2E2' : status === 'AT_RISK' ? '#FEF3C7' : status === 'PAUSED' ? '#F1F5F9' : '#DCFCE7';
                          const fg = status === 'BREACHED' ? '#B91C1C' : status === 'AT_RISK' ? '#B45309' : status === 'PAUSED' ? '#64748B' : '#15803D';
                          const label = status === 'BREACHED' ? 'Quá hạn SLA' : status === 'AT_RISK' ? 'Sắp quá hạn' : status === 'PAUSED' ? 'Tạm dừng' : 'Đúng hạn';
                          return (
                            <View key={t.ticketId} style={[styles.notiBlueItem, { paddingVertical: 12, marginBottom: 10 }]}>
                              <View style={{ flex: 1 }}>
                                <View style={styles.cardTopRow}>
                                  <Text style={{ fontWeight: '700', fontSize: 14, color: '#0F172A' }}>
                                    {t.ticketCode} • {t.ticketTitle}
                                  </Text>
                                  <View style={[styles.statusPill, { backgroundColor: bg }]}>
                                    <Text style={[styles.statusPillText, { color: fg }]}>{translate(label)}</Text>
                                  </View>
                                </View>
                                <Text style={styles.cardLocationText}>
                                  Ưu tiên: {translate(PRIORITY_VN[t.priority] || t.priority)} • Danh mục: {translate(CATEGORY_SHORT_VN[t.category] || t.category)}
                                </Text>
                                <Text style={[styles.techNotiBodyText, { fontSize: 11.5, marginTop: 2 }]}>
                                  Hạn xử lý: {t.resolutionDeadline ? new Date(t.resolutionDeadline).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : 'N/A'}
                                </Text>
                                {t.escalationLevel > 0 && (
                                  <Text style={{ fontSize: 11.5, color: '#DC2626', fontWeight: '700', marginTop: 3 }}>
                                    ⚠️ Cấp leo thang {t.escalationLevel}: Đã kích hoạt báo động cấp quản lý
                                  </Text>
                                )}

                                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                                  <TouchableOpacity
                                    style={[
                                      styles.primaryActionBtn,
                                      { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: status === 'PAUSED' ? '#16A34A' : '#64748B' }
                                    ]}
                                    onPress={() => handleBmbTogglePauseSla(t.ticketId, status === 'PAUSED')}
                                    disabled={loading}
                                  >
                                    <Text style={[styles.primaryActionBtnText, { fontSize: 11.5 }]}>
                                      {status === 'PAUSED' ? `▶ ${translate('Tiếp tục SLA')}` : `⏸ ${translate('Tạm dừng SLA')}`}
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            </View>
                          );
                        })
                      )}
                    </View>
                  )}
                </ScreenTransition>
              </ScrollView>

              {/* CỘT PHẢI: QUY CHẾ VÀ HỖ TRỢ ĐỐI SOÁT */}
              <ScrollView style={styles.bmbRightInspector} showsVerticalScrollIndicator={false}>
                <Text style={styles.bmbPanelBlueTitle}>{translate("Quy chế & Khiếu nại lương")}</Text>
                <View style={[styles.cleanInfoCard, { marginTop: 10 }]}>
                  <Text style={styles.cleanInfoCardTitle}>{translate("Nguyên tắc tính lương:")}</Text>
                  <Text style={styles.cleanInfoCardDesc}>
                    • Lương tháng cố định chi trả vào ngày 05 hàng tháng.{'\n'}
                    • Giờ tăng ca (OT) chỉ được tính khi có phê duyệt từ Ban Quản Lý (BMB).{'\n'}
                    • Tăng ca khẩn cấp trong ca đêm được hỗ trợ duyệt bù sau khi có xác nhận nghiệm thu sự cố.
                  </Text>
                </View>

                <Text style={[styles.cardBlockTitle, { marginTop: 14 }]}>{translate("Yêu cầu đối soát từ KTV")}</Text>
                {(bmbPayrollSummary?.reconcileRequests || []).length === 0 ? (
                  <Text style={styles.techInfoLine}>{translate("Không có khiếu nại nào.")}</Text>
                ) : (
                  (bmbPayrollSummary?.reconcileRequests || []).map((rc: any) => (
                    <View key={rc.id} style={[styles.notiBlueItem, { marginBottom: 6 }]}>
                      <Text style={{ fontWeight: '700', fontSize: 13, color: '#0F172A' }}>
                        {rc.techName} • Tháng {rc.month}
                      </Text>
                      <Text style={styles.cardLocationText}>{rc.note}</Text>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          )}
        </ScreenTransition>
      </View>
      <Modal
        visible={technicianDialogMode !== null}
        transparent
        animationType="fade"
        onRequestClose={closeTechnicianDialog}
      >
        <View style={styles.technicianModalOverlay}>
          <AnimatedModalContent visible={technicianDialogMode !== null} style={styles.technicianModalCard}>
            {technicianDialogMode === 'delete' ? (
              <>
                <Text style={styles.technicianModalTitle}>{translate('Xóa kỹ thuật viên')}</Text>
                <Text style={styles.technicianModalDescription}>
                  {translate('Bạn có chắc muốn vô hiệu hóa')} {selectedTechnician?.fullName}?
                </Text>
                <Text style={styles.technicianModalHint}>
                  {translate('Tài khoản sẽ bị vô hiệu hóa; lịch sử công việc vẫn được giữ lại.')}
                </Text>
                {technicianActiveTicketsCount > 0 && (
                  <View style={{ marginVertical: 10 }}>
                    <Text style={[styles.fieldLabel, { color: '#B45309', fontWeight: '700' }]}>
                      ⚠️ {translate('KTV đang có')} {technicianActiveTicketsCount} {translate('sự cố chưa xong. Chọn KTV nhận bàn giao:')}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {technicians
                        .filter((t) => t.id !== selectedTechnician?.id)
                        .map((t) => {
                          const isSel = handoverTechId === t.id;
                          return (
                            <TouchableOpacity
                              key={t.id}
                              style={[
                                styles.shiftPresetChip,
                                isSel && styles.shiftPresetChipActive,
                              ]}
                              onPress={() => setHandoverTechId(t.id)}
                            >
                              <Text
                                style={[
                                  styles.shiftPresetChipText,
                                  isSel && styles.shiftPresetChipTextActive,
                                ]}
                              >
                                {t.fullName} ({t.specialtyLabel || 'KTV'})
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                    </View>
                  </View>
                )}
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
                  {translate(technicianDialogMode === 'edit' ? 'Sửa kỹ thuật viên' : 'Thêm tài khoản mới')}
                </Text>
                {technicianDialogMode === 'create' && (
                  <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 8, padding: 3, marginBottom: 12 }}>
                    <TouchableOpacity
                      style={{ flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 }}
                      onPress={() => {
                        setTechnicianDialogMode(null);
                        setResidentForm({
                          fullName: '',
                          phone: '',
                          email: '',
                          apartmentCode: 'G101',
                          buildingBlock: 'Tòa G',
                          floorNumber: 1,
                          residencyRole: 'OWNER',
                          moveInDate: new Date().toISOString().slice(0, 10),
                          moveOutDate: '',
                          isRepresentative: true,
                        });
                        setResidentModalMode('create');
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#64748B' }}>🏢 {translate('Cư dân')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 6, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#2563EB' }}>👷 {translate('Kỹ thuật viên')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <ScrollView
                  style={styles.technicianFormScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.technicianFieldLabel}>{translate('Họ và tên *')}</Text>
                  <TextInput
                    style={[styles.technicianFormInput, technicianFieldErrors.fullName && styles.inputErrorBorder]}
                    value={technicianForm.fullName}
                    onChangeText={(fullName) => {
                      setTechnicianForm((current) => ({ ...current, fullName }));
                      if (technicianFieldErrors.fullName) {
                        setTechnicianFieldErrors((errs) => ({ ...errs, fullName: undefined }));
                      }
                    }}
                    placeholder={translate('Nhập họ và tên')}
                    placeholderTextColor="#94A3B8"
                    autoCapitalize="words"
                    maxLength={100}
                  />
                  {technicianFieldErrors.fullName ? (
                    <Text style={styles.inlineFieldError}>{technicianFieldErrors.fullName}</Text>
                  ) : null}

                  <Text style={styles.technicianFieldLabel}>{translate('Số điện thoại *')}</Text>
                  <TextInput
                    style={[styles.technicianFormInput, technicianFieldErrors.phone && styles.inputErrorBorder]}
                    value={technicianForm.phone}
                    onChangeText={(phone) => {
                      const digitsOnly = phone.replace(/\D/g, '').slice(0, 10);
                      setTechnicianForm((current) => ({ ...current, phone: digitsOnly }));
                      if (technicianFieldErrors.phone) {
                        setTechnicianFieldErrors((errs) => ({ ...errs, phone: undefined }));
                      }
                    }}
                    placeholder="0905 xxx xxx"
                    placeholderTextColor="#94A3B8"
                    keyboardType="phone-pad"
                    maxLength={10}
                  />
                  {technicianFieldErrors.phone ? (
                    <Text style={styles.inlineFieldError}>{technicianFieldErrors.phone}</Text>
                  ) : null}

                  <Text style={styles.technicianFieldLabel}>{translate('Email (tùy chọn)')}</Text>
                  <TextInput
                    style={[styles.technicianFormInput, technicianFieldErrors.email && styles.inputErrorBorder]}
                    value={technicianForm.email}
                    onChangeText={(email) => {
                      setTechnicianForm((current) => ({ ...current, email }));
                      if (technicianFieldErrors.email) {
                        setTechnicianFieldErrors((errs) => ({ ...errs, email: undefined }));
                      }
                    }}
                    placeholder="email@example.com"
                    placeholderTextColor="#94A3B8"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    maxLength={100}
                  />
                  {technicianFieldErrors.email ? (
                    <Text style={styles.inlineFieldError}>{technicianFieldErrors.email}</Text>
                  ) : null}

                  <Text style={styles.technicianFieldLabel}>
                    {translate(technicianDialogMode === 'edit' ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu ban đầu *')}
                  </Text>
                  <TextInput
                    style={[styles.technicianFormInput, technicianFieldErrors.password && styles.inputErrorBorder]}
                    value={technicianForm.password}
                    onChangeText={(password) => {
                      setTechnicianForm((current) => ({ ...current, password }));
                      if (technicianFieldErrors.password) {
                        setTechnicianFieldErrors((errs) => ({ ...errs, password: undefined }));
                      }
                    }}
                    placeholder={translate(technicianDialogMode === 'edit' ? 'Để trống nếu giữ nguyên mật khẩu' : 'Ít nhất 6 ký tự')}
                    placeholderTextColor="#94A3B8"
                    secureTextEntry
                    autoCapitalize="none"
                    maxLength={128}
                  />
                  {technicianFieldErrors.password ? (
                    <Text style={styles.inlineFieldError}>{technicianFieldErrors.password}</Text>
                  ) : null}

                  <Text style={styles.technicianFieldLabel}>{translate('Chuyên môn *')}</Text>
                  <View style={styles.technicianSpecialtyChoices}>
                    {CATEGORIES_LIST.map((specialty) => (
                      <TouchableOpacity
                        key={specialty}
                        style={[
                          styles.technicianSpecialtyChoice,
                          technicianForm.specialty === specialty && styles.technicianSpecialtyChoiceActive,
                        ]}
                        onPress={() => {
                          setTechnicianForm((current) => ({ ...current, specialty }));
                          if (technicianFieldErrors.specialty) {
                            setTechnicianFieldErrors((errs) => ({ ...errs, specialty: undefined }));
                          }
                        }}
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
                  {technicianFieldErrors.specialty ? (
                    <Text style={styles.inlineFieldError}>{technicianFieldErrors.specialty}</Text>
                  ) : null}

                  <Text style={styles.technicianFieldLabel}>{translate('Khung giờ hoạt động/Ca trực (24 giờ) *')}</Text>

                  {/* Preset ca trực mẫu */}
                  <View style={styles.shiftPresetRow}>
                    {SHIFT_PRESETS.map((preset) => {
                      const isSelected =
                        technicianForm.shiftStartTime === preset.start &&
                        technicianForm.shiftEndTime === preset.end;
                      return (
                        <TouchableOpacity
                          key={preset.label}
                          style={[
                            styles.shiftPresetChip,
                            isSelected && styles.shiftPresetChipActive,
                          ]}
                          onPress={() => {
                            setTechnicianForm((cur) => ({
                              ...cur,
                              shiftStartTime: preset.start,
                              shiftEndTime: preset.end,
                            }));
                            if (technicianFieldErrors.shift) {
                              setTechnicianFieldErrors((errs) => ({ ...errs, shift: undefined }));
                            }
                          }}
                        >
                          <Text
                            style={[
                              styles.shiftPresetChipText,
                              isSelected && styles.shiftPresetChipTextActive,
                            ]}
                          >
                            {translate(preset.label)} ({preset.start}-{preset.end})
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Bộ chọn Giờ bắt đầu - Giờ kết thúc (24h) */}
                  <View style={styles.shiftSelectorContainer}>
                    <View style={styles.shiftTimeCol}>
                      <Text style={styles.shiftSubLabel}>{translate('Giờ bắt đầu')}</Text>
                      <TouchableOpacity
                        style={[styles.timePickerBox, technicianFieldErrors.shift && styles.inputErrorBorder]}
                        onPress={() => setTimePickerTarget('start')}
                      >
                        <Text style={styles.timePickerValue}>{technicianForm.shiftStartTime}</Text>
                        <Text style={styles.timePickerDropdownArrow}>⌄</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.shiftDividerHyphen}>—</Text>

                    <View style={styles.shiftTimeCol}>
                      <Text style={styles.shiftSubLabel}>{translate('Giờ kết thúc')}</Text>
                      <TouchableOpacity
                        style={[styles.timePickerBox, technicianFieldErrors.shift && styles.inputErrorBorder]}
                        onPress={() => setTimePickerTarget('end')}
                      >
                        <Text style={styles.timePickerValue}>{technicianForm.shiftEndTime}</Text>
                        <Text style={styles.timePickerDropdownArrow}>⌄</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  {technicianFieldErrors.shift ? (
                    <Text style={styles.inlineFieldError}>{technicianFieldErrors.shift}</Text>
                  ) : null}

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

                {/* Overlay bộ chọn giờ (24h) */}
                {timePickerTarget !== null && (
                  <View style={styles.timePickerOverlay}>
                    <View style={styles.timePickerCard}>
                      <View style={styles.cardTopRow}>
                        <Text style={styles.timePickerTitle}>
                          {translate(timePickerTarget === 'start' ? 'Chọn giờ bắt đầu (24 giờ)' : 'Chọn giờ kết thúc (24 giờ)')}
                        </Text>
                        <TouchableOpacity onPress={() => setTimePickerTarget(null)}>
                          <Text style={{ fontSize: 16, color: '#64748B', fontWeight: '700' }}>✕</Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={styles.timePickerSectionTitle}>{translate('Chọn giờ (00 - 23)')}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                        <View style={styles.timePickerHoursRow}>
                          {HOURS_24.map((hour) => {
                            const currentSelectedHour = (timePickerTarget === 'start'
                              ? technicianForm.shiftStartTime
                              : technicianForm.shiftEndTime
                            ).slice(0, 2);
                            const isHActive = currentSelectedHour === hour;
                            return (
                              <TouchableOpacity
                                key={hour}
                                style={[styles.hourChip, isHActive && styles.hourChipActive]}
                                onPress={() => {
                                  const currentMinute = (timePickerTarget === 'start'
                                    ? technicianForm.shiftStartTime
                                    : technicianForm.shiftEndTime
                                  ).slice(3, 5) || '00';
                                  const newTime = `${hour}:${currentMinute}`;
                                  setTechnicianForm((cur) => ({
                                    ...cur,
                                    [timePickerTarget === 'start' ? 'shiftStartTime' : 'shiftEndTime']: newTime,
                                  }));
                                  if (technicianFieldErrors.shift) {
                                    setTechnicianFieldErrors((errs) => ({ ...errs, shift: undefined }));
                                  }
                                }}
                              >
                                <Text style={[styles.hourChipText, isHActive && styles.hourChipTextActive]}>
                                  {hour}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </ScrollView>

                      <Text style={styles.timePickerSectionTitle}>{translate('Chọn phút')}</Text>
                      <View style={styles.timePickerMinutesRow}>
                        {MINUTES_STEPS.map((minute) => {
                          const currentSelectedMin = (timePickerTarget === 'start'
                            ? technicianForm.shiftStartTime
                            : technicianForm.shiftEndTime
                          ).slice(3, 5);
                          const isMActive = currentSelectedMin === minute;
                          return (
                            <TouchableOpacity
                              key={minute}
                              style={[styles.minuteChip, isMActive && styles.minuteChipActive]}
                              onPress={() => {
                                const currentHour = (timePickerTarget === 'start'
                                  ? technicianForm.shiftStartTime
                                  : technicianForm.shiftEndTime
                                ).slice(0, 2) || '08';
                                const newTime = `${currentHour}:${minute}`;
                                setTechnicianForm((cur) => ({
                                  ...cur,
                                  [timePickerTarget === 'start' ? 'shiftStartTime' : 'shiftEndTime']: newTime,
                                }));
                                if (technicianFieldErrors.shift) {
                                  setTechnicianFieldErrors((errs) => ({ ...errs, shift: undefined }));
                                }
                              }}
                            >
                              <Text style={[styles.minuteChipText, isMActive && styles.minuteChipTextActive]}>
                                :{minute}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <TouchableOpacity
                        style={styles.timePickerDoneBtn}
                        onPress={() => setTimePickerTarget(null)}
                      >
                        <Text style={styles.timePickerDoneText}>{translate('Xác nhận giờ')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}
          </AnimatedModalContent>
        </View></Modal>

      {/* Modal Quản lý Cư dân (Thêm / Sửa / Đặt lại mật khẩu) */}
      <Modal
        visible={residentModalMode !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setResidentModalMode(null)}
      >
        <View style={styles.technicianModalOverlay}>
          <View style={styles.technicianModalCard}>
            {residentModalMode === 'reset_password' ? (
              <>
                <Text style={styles.technicianModalTitle}>{translate('Đặt lại mật khẩu cư dân')}</Text>
                <Text style={styles.technicianModalDescription}>
                  {translate('Cư dân:')} {selectedResident?.fullName} ({selectedResident?.phone})
                </Text>
                <Text style={styles.fieldLabel}>{translate('Mật khẩu mới (tùy chọn, để trống để tự sinh mật khẩu tạm)')}</Text>
                <TextInput
                  style={styles.technicianFormInput}
                  value={newPasswordInput}
                  onChangeText={setNewPasswordInput}
                  secureTextEntry
                  placeholder="Để trống để tự tạo mật khẩu tạm thời 10 ký tự"
                  placeholderTextColor="#94A3B8"
                />
                <View style={styles.technicianModalActions}>
                  <TouchableOpacity
                    style={styles.technicianCancelButton}
                    onPress={() => setResidentModalMode(null)}
                  >
                    <Text style={styles.technicianCancelButtonText}>{translate('Hủy')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { flex: 1, paddingVertical: 10 }]}
                    onPress={handleResetResidentPassword}
                  >
                    <Text style={styles.primaryActionBtnText}>{translate('Xác nhận đặt lại')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.technicianModalTitle}>
                  {translate(residentModalMode === 'edit' ? 'Sửa thông tin cư dân' : 'Thêm tài khoản mới')}
                </Text>
                {residentModalMode === 'create' && (
                  <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 8, padding: 3, marginBottom: 12 }}>
                    <TouchableOpacity
                      style={{ flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 6, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#2563EB' }}>🏢 {translate('Cư dân')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 }}
                      onPress={() => {
                        setResidentModalMode(null);
                        openCreateTechnician();
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#64748B' }}>👷 {translate('Kỹ thuật viên')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <ScrollView style={styles.technicianFormScroll} showsVerticalScrollIndicator={false}>
                  {residentModalMode === 'create' && (
                    <View style={{ backgroundColor: '#EFF6FF', borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#BFDBFE' }}>
                      <Text style={{ fontSize: 13, color: '#1E40AF', lineHeight: 18 }}>
                        {translate('ℹ️ Hệ thống sẽ tự động tạo mật khẩu tạm thời an toàn. Sau khi bấm "Lưu thông tin", mật khẩu sẽ được hiển thị để bạn bàn giao cho cư dân.')}
                      </Text>
                    </View>
                  )}

                  {residentModalError && (
                    <View style={{ backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#F87171', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                      <Text style={{ color: '#B91C1C', fontSize: 13, fontWeight: '700', lineHeight: 18 }}>
                        ⚠️ {residentModalError}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.technicianFieldLabel}>{translate('Họ và tên *')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={residentForm.fullName}
                    onChangeText={(val) => {
                      setResidentModalError(null);
                      setResidentForm((f) => ({ ...f, fullName: val }));
                    }}
                    placeholder="Nguyễn Văn A"
                    placeholderTextColor="#94A3B8"
                  />

                  <Text style={styles.technicianFieldLabel}>{translate('Số điện thoại *')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={residentForm.phone}
                    onChangeText={(val) => {
                      setResidentModalError(null);
                      setResidentForm((f) => ({ ...f, phone: val.replace(/[^\d]/g, '').slice(0, 10) }));
                    }}
                    keyboardType="phone-pad"
                    maxLength={10}
                    placeholder="0905123456"
                    placeholderTextColor="#94A3B8"
                  />

                  <Text style={styles.technicianFieldLabel}>{translate('Email cư dân (dùng để khôi phục mật khẩu khi quên)')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={residentForm.email}
                    onChangeText={(val) => {
                      setResidentModalError(null);
                      setResidentForm((f) => ({ ...f, email: val }));
                    }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    placeholder="email@example.com"
                    placeholderTextColor="#94A3B8"
                  />

                  {/* LỰA CHỌN CĂN HỘ PHÂN CẤP (TÒA -> TẦNG -> PHÒNG) */}
                  <Text style={[styles.technicianFieldLabel, { marginTop: 14 }]}>
                    {translate('Căn hộ cư trú (Hệ thống 75 phòng Tòa G, F, E) *')}
                  </Text>

                  {/* 1. Chọn Tòa: G, F, E */}
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', marginTop: 4, marginBottom: 4 }}>
                    {translate('1. Tòa nhà:')}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {(['G', 'F', 'E'] as const).map((blockCode) => {
                      const isSel = residentForm.buildingBlock.includes(blockCode) || residentForm.apartmentCode.startsWith(blockCode);
                      return (
                        <TouchableOpacity
                          key={blockCode}
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 6,
                            alignItems: 'center',
                            backgroundColor: isSel ? '#2563EB' : '#F1F5F9',
                            borderWidth: 1,
                            borderColor: isSel ? '#1D4ED8' : '#CBD5E1',
                          }}
                          onPress={() => {
                            setResidentModalError(null);
                            const newBlock = `Tòa ${blockCode}`;
                            const fl = residentForm.floorNumber || 1;
                            const currRoomNum = residentForm.apartmentCode.slice(2) || '01';
                            const newCode = `${blockCode}${fl}${currRoomNum}`;
                            setResidentForm((f) => ({
                              ...f,
                              buildingBlock: newBlock,
                              apartmentCode: newCode,
                            }));
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '700', color: isSel ? '#FFFFFF' : '#334155' }}>
                            Tòa {blockCode}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* 2. Chọn Tầng: 1..5 */}
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', marginTop: 8, marginBottom: 4 }}>
                    {translate('2. Tầng số:')}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {[1, 2, 3, 4, 5].map((fl) => {
                      const isSel = residentForm.floorNumber === fl;
                      return (
                        <TouchableOpacity
                          key={fl}
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 6,
                            alignItems: 'center',
                            backgroundColor: isSel ? '#2563EB' : '#F1F5F9',
                            borderWidth: 1,
                            borderColor: isSel ? '#1D4ED8' : '#CBD5E1',
                          }}
                          onPress={() => {
                            setResidentModalError(null);
                            const bCode = residentForm.apartmentCode[0] || 'G';
                            const currRoomNum = residentForm.apartmentCode.slice(2) || '01';
                            const newCode = `${bCode}${fl}${currRoomNum}`;
                            setResidentForm((f) => ({
                              ...f,
                              floorNumber: fl,
                              apartmentCode: newCode,
                            }));
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '700', color: isSel ? '#FFFFFF' : '#334155' }}>
                            Tầng {fl}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* 3. Chọn Phòng: 01..05 */}
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', marginTop: 8, marginBottom: 4 }}>
                    {translate('3. Số phòng:')}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {[1, 2, 3, 4, 5].map((rm) => {
                      const rmStr = String(rm).padStart(2, '0');
                      const bCode = residentForm.apartmentCode[0] || 'G';
                      const fl = residentForm.floorNumber || 1;
                      const targetCode = `${bCode}${fl}${rmStr}`;
                      const isSel = residentForm.apartmentCode === targetCode;
                      return (
                        <TouchableOpacity
                          key={rm}
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 6,
                            alignItems: 'center',
                            backgroundColor: isSel ? '#2563EB' : '#F1F5F9',
                            borderWidth: 1,
                            borderColor: isSel ? '#1D4ED8' : '#CBD5E1',
                          }}
                          onPress={() => {
                            setResidentModalError(null);
                            setResidentForm((f) => ({
                              ...f,
                              apartmentCode: targetCode,
                            }));
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '700', color: isSel ? '#FFFFFF' : '#334155' }}>
                            Phòng {rmStr}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Thẻ hiển thị xác nhận phòng đã chọn */}
                  <View style={{ backgroundColor: '#F0FDF4', borderColor: '#86EFAC', borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 10, marginBottom: 6 }}>
                    <Text style={{ fontWeight: '800', color: '#166534', fontSize: 14 }}>
                      ✓ Căn hộ đã chọn: Căn {residentForm.apartmentCode} ({residentForm.buildingBlock}, Tầng {residentForm.floorNumber})
                    </Text>
                    <Text style={{ color: '#15803D', fontSize: 12, marginTop: 4 }}>
                      🏢 Địa chỉ: Đại học Duy Tân, Hòa Khánh Nam, Đà Nẵng
                    </Text>
                    <Text style={{ color: '#7C3AED', fontSize: 12, fontWeight: '700', marginTop: 2 }}>
                      Mã QR phòng cố định: ROOM:{residentForm.apartmentCode}
                    </Text>
                  </View>

                  {/* Vai trò cư trú */}
                  <Text style={[styles.technicianFieldLabel, { marginTop: 12 }]}>{translate('Vai trò cư trú *')}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    {(['OWNER', 'TENANT', 'MEMBER'] as const).map((r) => {
                      const label = r === 'OWNER' ? 'Chủ sở hữu' : r === 'TENANT' ? 'Khách thuê' : 'Thành viên';
                      const isSel = (residentForm.residencyRole || 'TENANT') === r;
                      return (
                        <TouchableOpacity
                          key={r}
                          style={{
                            flex: 1,
                            paddingVertical: 10,
                            borderRadius: 6,
                            alignItems: 'center',
                            backgroundColor: isSel ? '#2563EB' : '#F1F5F9',
                            borderWidth: 1,
                            borderColor: isSel ? '#1D4ED8' : '#CBD5E1',
                          }}
                          onPress={() => setResidentForm((f) => ({ ...f, residencyRole: r, isRepresentative: r === 'OWNER' }))}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '600', color: isSel ? '#FFFFFF' : '#334155' }}>
                            {translate(label)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={[styles.technicianFieldLabel, { marginTop: 12 }]}>{translate('Ngày chuyển vào *')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={residentForm.moveInDate}
                    onChangeText={(val) => setResidentForm((f) => ({ ...f, moveInDate: val }))}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#94A3B8"
                  />

                  <Text style={styles.technicianFieldLabel}>{translate('Ngày chuyển đi dự kiến (tùy chọn)')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={residentForm.moveOutDate}
                    onChangeText={(val) => setResidentForm((f) => ({ ...f, moveOutDate: val }))}
                    placeholder="YYYY-MM-DD (để trống nếu chưa xác định)"
                    placeholderTextColor="#94A3B8"
                  />
                </ScrollView>

                <View style={styles.technicianModalActions}>
                  <TouchableOpacity
                    style={styles.technicianCancelButton}
                    onPress={() => {
                      setResidentModalError(null);
                      setResidentModalMode(null);
                    }}
                  >
                    <Text style={styles.technicianCancelButtonText}>{translate('Hủy')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { flex: 1, paddingVertical: 10, opacity: residentModalBusy ? 0.7 : 1 }]}
                    disabled={residentModalBusy}
                    onPress={handleSaveResident}
                  >
                    {residentModalBusy ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.primaryActionBtnText}>{translate('Lưu thông tin')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal Thông báo Mật khẩu tạm thời cho BMB */}
      <Modal
        visible={createdTempPasswordData !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setCreatedTempPasswordData(null)}
      >
        <View style={styles.technicianModalOverlay}>
          <View style={styles.technicianModalCard}>
            <Text style={styles.technicianModalTitle}>{translate('Mật khẩu tạm thời của Cư dân')}</Text>
            <Text style={styles.technicianModalDescription}>
              {translate('Tài khoản đã được cập nhật trên hệ thống. Hãy sao chép mật khẩu bên dưới và bàn giao trực tiếp cho cư dân:')}
            </Text>
            <View style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 12, marginVertical: 10, borderWidth: 1, borderColor: '#E2E8F0' }}>
              <Text style={{ fontSize: 13, color: '#334155' }}>
                <Text style={{ fontWeight: '700' }}>Cư dân:</Text> {createdTempPasswordData?.residentName} ({createdTempPasswordData?.phone})
              </Text>
              <Text style={{ fontSize: 13, color: '#334155', marginTop: 4 }}>
                <Text style={{ fontWeight: '700' }}>Căn hộ:</Text> {createdTempPasswordData?.apartmentCode}
              </Text>
            </View>

            <View style={{ backgroundColor: '#EFF6FF', borderRadius: 8, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#BFDBFE', marginVertical: 8 }}>
              <Text style={{ fontSize: 12, color: '#1E40AF', fontWeight: '600', marginBottom: 4 }}>
                {translate('MẬT KHẨU TẠM THỜI (HIỂN THỊ 1 LẦN DUY NHẤT)')}
              </Text>
              <Text style={{ fontSize: 24, fontWeight: '800', letterSpacing: 2, color: '#1D4ED8', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
                {createdTempPasswordData?.temporaryPassword}
              </Text>
              <TouchableOpacity
                style={{ marginTop: 10, backgroundColor: '#2563EB', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 }}
                onPress={() => {
                  if (createdTempPasswordData?.temporaryPassword) {
                    if (typeof navigator !== 'undefined' && (navigator as any).clipboard) {
                      (navigator as any).clipboard.writeText(createdTempPasswordData.temporaryPassword);
                    }
                    showToast(translate('✓ Đã sao chép mật khẩu vào bộ nhớ tạm!'));
                  }
                }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 13 }}>📋 {translate('Sao chép mật khẩu')}</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 12, color: '#B45309', backgroundColor: '#FEF3C7', padding: 10, borderRadius: 6, marginVertical: 6 }}>
              {translate('⚠️ Vì lý do an toàn, mật khẩu tạm thời này chỉ hiển thị một lần. Cư dân sẽ bắt buộc đổi mật khẩu mới ở lần đăng nhập đầu tiên.')}
            </Text>

            <TouchableOpacity
              style={[styles.primaryActionBtn, { marginTop: 12, paddingVertical: 12 }]}
              onPress={() => setCreatedTempPasswordData(null)}
            >
              <Text style={styles.primaryActionBtnText}>{translate('Đã ghi nhận & Đóng')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal Đổi mật khẩu lần đầu bắt buộc cho Cư dân */}
      <Modal
        visible={showFirstLoginPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => { }}
      >
        <View style={styles.technicianModalOverlay}>
          <View style={styles.technicianModalCard}>
            <Text style={styles.technicianModalTitle}>{translate('Đổi mật khẩu lần đầu')}</Text>
            <Text style={styles.technicianModalDescription}>
              {translate('Để bảo vệ an toàn cho tài khoản, quý cư dân vui lòng thiết lập mật khẩu mới trước khi bắt đầu sử dụng ứng dụng.')}
            </Text>

            <View style={{ marginTop: 12 }}>
              <Text style={styles.fieldLabel}>{translate('Mật khẩu tạm thời hiện tại *')}</Text>
              <TextInput
                style={styles.technicianFormInput}
                value={firstLoginCurrentPassword}
                onChangeText={setFirstLoginCurrentPassword}
                secureTextEntry
                placeholder={translate('Nhập mật khẩu tạm đã nhận')}
                placeholderTextColor="#94A3B8"
              />

              <Text style={[styles.fieldLabel, { marginTop: 10 }]}>{translate('Mật khẩu mới (tối thiểu 6 ký tự) *')}</Text>
              <TextInput
                style={styles.technicianFormInput}
                value={firstLoginNewPassword}
                onChangeText={setFirstLoginNewPassword}
                secureTextEntry
                placeholder={translate('Nhập mật khẩu mới')}
                placeholderTextColor="#94A3B8"
              />

              <Text style={[styles.fieldLabel, { marginTop: 10 }]}>{translate('Xác nhận mật khẩu mới *')}</Text>
              <TextInput
                style={styles.technicianFormInput}
                value={firstLoginConfirmPassword}
                onChangeText={setFirstLoginConfirmPassword}
                secureTextEntry
                placeholder={translate('Nhập lại mật khẩu mới')}
                placeholderTextColor="#94A3B8"
              />

              <TouchableOpacity
                style={[styles.primaryActionBtn, { marginTop: 20, paddingVertical: 12 }, firstLoginBusy && { opacity: 0.6 }]}
                onPress={handleChangePasswordFirstLogin}
                disabled={firstLoginBusy}
              >
                {firstLoginBusy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryActionBtnText}>{translate('Xác nhận & Bắt đầu sử dụng')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {renderAttendanceReviewModal()}
      {renderPhotoViewerModal()}
      {renderBmbIncidentPhotoModal()}
      {renderBuildingLocationModal()}
    </SafeAreaView>
  );
}

// ============================================================================
// STYLESHEET ĐỒNG BỘ CHO 15 MÀN HÌNH FIGMA (MOBILE + BMB WEB)
// ============================================================================
// ============================================================================
// STYLESHEET RESIFIX DESIGN SYSTEM -- ENTERPRISE SAAS (MOBILE + BMB WEB)
// ============================================================================
const styles = StyleSheet.create({
  // --- Canvas & Containers ---
  screenBg: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 28) + 10 : 0,
  },
  loginScroll: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 36,
    paddingBottom: 24,
  },
  mobileFrame: {
    width: '100%',
    maxWidth: 412,
  },
  mobileShell: {
    flex: 1,
    width: '100%',
    maxWidth: 412,
    alignSelf: 'center',
    backgroundColor: '#F8FAFC',
    ...(Platform.OS === 'web'
      ? {
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 10,
      }
      : {}),
  },
  scrollArea: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },

  // --- Màn hình 00: BMB Web Login (Split-Card 2 cột Enterprise) ---
  bmbLoginOuterBg: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  bmbLoginSplitCard: {
    width: '100%',
    maxWidth: 920,
    minHeight: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 3,
  },
  bmbLoginLeftBlue: {
    flex: 1,
    backgroundColor: '#1E40AF',
    padding: 40,
    justifyContent: 'space-between',
  },
  bmbLoginBrandText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  bmbLoginHeroTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 24,
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  bmbLoginRightWhite: {
    flex: 1.15,
    backgroundColor: '#FFFFFF',
    padding: 40,
    justifyContent: 'center',
  },
  bmbLoginFormHeading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  bmbWebInput: {
    height: 44,
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
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  bmbWebLoginBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // --- BMB Desktop 3-Column Layout & Sidebar ---
  bmbWebRoot: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  bmbDesktopLayout: {
    flex: 1,
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
  },
  bmbSidebar: {
    width: Platform.OS === 'web' ? 240 : '100%',
    minHeight: 0,
    backgroundColor: '#FFFFFF',
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    padding: 16,
    justifyContent: 'space-between',
  },
  bmbSidebarNavigation: {
    flex: 1,
    minHeight: 0,
  },
  bmbSidebarFooter: {
    flexShrink: 0,
  },
  bmbSidebarBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bmbSidebarLogoText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#2563EB',
    letterSpacing: -0.3,
  },
  bmbSidebarSubText: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 18,
    fontWeight: '500',
  },
  bmbWorkspaceHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    marginBottom: 8,
    letterSpacing: 0.6,
  },
  bmbMenuBtn: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 3,
  },
  bmbMenuBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bmbMenuIcon: {
    fontSize: 16,
    opacity: 0.85,
  },
  bmbMenuIconActive: {
    opacity: 1,
  },
  bmbMenuBtnActive: {
    backgroundColor: '#EFF6FF',
  },
  bmbMenuBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  bmbMenuBtnTextActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  bmbSidebarNewRedTag: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 3,
    marginLeft: 16,
  },
  bmbSidebarNewRedText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#DC2626',
  },
  bmbBuildingStatusBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  bmbBuildingSmallLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.4,
  },
  bmbBuildingName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  bmbBuildingOnline: {
    fontSize: 11,
    color: '#10B981',
    marginTop: 3,
    fontWeight: '600',
  },
  bmbAdminFooter: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 12,
  },
  bmbAdminNameText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  bmbSidebarLogoutText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#EF4444',
  },

  // --- BMB Technicians Management ---
  technicianAddButton: {
    alignSelf: 'flex-end',
    marginTop: 10,
    marginBottom: 8,
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  technicianAddButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  technicianActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  technicianEditButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  technicianEditButtonText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
  },
  technicianDeleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  technicianDeleteButtonText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '700',
  },
  technicianEmptyState: {
    marginTop: 18,
    padding: 24,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  technicianEmptyText: {
    color: '#64748B',
    fontSize: 13.5,
  },
  technicianModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  technicianModalCard: {
    width: 500,
    maxWidth: '100%',
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
  },
  technicianModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  technicianModalDescription: {
    color: '#334155',
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: 6,
  },
  technicianModalHint: {
    color: '#64748B',
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 6,
  },
  technicianFormScroll: {
    flexShrink: 1,
    minHeight: 0,
    maxHeight: 520,
    marginTop: 4,
  },
  technicianFieldLabel: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 5,
  },
  technicianFormInput: {
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
    fontSize: 13.5,
  },
  technicianSpecialtyChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  technicianSpecialtyChoice: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  technicianSpecialtyChoiceActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  technicianSpecialtyChoiceText: {
    color: '#475569',
    fontSize: 11.5,
    fontWeight: '600',
  },
  technicianSpecialtyChoiceTextActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  technicianDutyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 6,
  },
  technicianDutyIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
    backgroundColor: '#94A3B8',
  },
  technicianDutyIndicatorActive: {
    backgroundColor: '#10B981',
  },
  technicianDutyText: {
    color: '#334155',
    fontSize: 12.5,
    fontWeight: '600',
  },
  technicianFormError: {
    color: '#DC2626',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  technicianModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  technicianCancelButton: {
    minWidth: 84,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  technicianCancelButtonText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
  technicianSaveButton: {
    minWidth: 104,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#2563EB',
  },
  technicianSaveButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  technicianConfirmDeleteButton: {
    minWidth: 104,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#EF4444',
  },
  technicianConfirmDeleteText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  technicianDisabledButton: {
    opacity: 0.5,
  },

  // --- Real-time Clock & Form Controls ---
  realTimeClockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  realTimeClockText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#334155',
    letterSpacing: 0.4,
  },
  inlineFieldError: {
    color: '#DC2626',
    fontSize: 11.5,
    marginTop: 4,
    marginBottom: 2,
    fontWeight: '600',
  },
  inputErrorBorder: {
    borderColor: '#EF4444',
  },
  shiftPresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  shiftPresetChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  shiftPresetChipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  shiftPresetChipText: {
    fontSize: 11.5,
    color: '#475569',
    fontWeight: '600',
  },
  shiftPresetChipTextActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  shiftSelectorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  shiftTimeCol: {
    flex: 1,
  },
  shiftSubLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 4,
    fontWeight: '600',
  },
  timePickerBox: {
    height: 40,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timePickerValue: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  timePickerDropdownArrow: {
    fontSize: 12,
    color: '#64748B',
  },
  shiftDividerHyphen: {
    fontSize: 16,
    color: '#94A3B8',
    fontWeight: '700',
    marginTop: 14,
  },
  timePickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99,
    padding: 16,
  },
  timePickerCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 6,
  },
  timePickerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  timePickerSectionTitle: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 10,
    marginBottom: 6,
  },
  timePickerHoursRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  hourChip: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hourChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  hourChipText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#334155',
  },
  hourChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  timePickerMinutesRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  },
  minuteChip: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  minuteChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  minuteChipText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#334155',
  },
  minuteChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  timePickerDoneBtn: {
    height: 40,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timePickerDoneText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // --- BMB Dashboard Two-Columns & KPIs ---
  bmbContentTwoCols: {
    flex: 1,
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    padding: 20,
    gap: 16,
  },
  bmbCenterColumn: {
    flex: 1.35,
  },
  bmbRightInspector: {
    flex: 0.95,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  bmbPageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  bmbPageSubtitle: {
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 2,
  },
  bmbDateLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  bmbKpiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 12,
    gap: 10,
  },
  bmbKpiCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 4,
    elevation: 1,
  },
  bmbKpiLabel: {
    fontSize: 11.5,
    color: '#64748B',
    marginBottom: 4,
    fontWeight: '600',
  },
  bmbKpiNumber: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  bmbFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 6,
    marginBottom: 6,
  },
  bmbFilterChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  bmbFilterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  bmbFilterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  bmbUrgentInlineDot: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#DC2626',
  },
  bmbAiPurpleMiniTag: {
    backgroundColor: '#FAF5FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  bmbAiPurpleMiniText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7C3AED',
  },
  bmbAiTimeoutTag: {
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  bmbAiTimeoutText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  pageNumActive: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 3,
  },
  pageNumInactive: {
    fontSize: 12,
    color: '#64748B',
    marginHorizontal: 5,
  },
  bmbInspectorTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  bmbSmallSectionHead: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  qrVerifiedPill: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  qrVerifiedPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  bmbInspectorDesc: {
    fontSize: 13,
    color: '#334155',
    marginTop: 8,
    lineHeight: 19,
  },
  bmbAttachmentThumb: {
    width: 60,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    overflow: 'hidden',
  },
  bmbGeminiPurpleCard: {
    backgroundColor: '#FAF5FF',
    borderWidth: 1,
    borderColor: '#E9D5FF',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  bmbGeminiCardTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#7C3AED',
    flex: 1,
  },
  bmbLatencyGreenPill: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  bmbLatencyGreenText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#059669',
  },
  bmbAiSummaryBullet: {
    fontSize: 12,
    color: '#334155',
    marginTop: 4,
    marginBottom: 3,
    lineHeight: 17,
  },
  bmbDropdownBox: {
    height: 40,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bmbDropdownValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  bmbRiskR1Hint: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 8,
    lineHeight: 15,
  },

  // --- Workload & Status Cards ---
  bmbStatPill: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 6,
    marginBottom: 6,
  },
  bmbStatPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  bmbTechInitialsCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  bmbTechInitialsText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#2563EB',
  },
  workloadTrack: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    marginTop: 6,
    overflow: 'hidden',
  },
  workloadFill: {
    height: '100%',
    borderRadius: 3,
  },
  bmbWorkloadBtn: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bmbWorkloadBtnBlueActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  bmbWorkloadBtnIndigoActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  bmbWorkloadBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#2563EB',
  },
  bmbBlueOutlinePanel: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    padding: 14,
  },
  bmbPanelBlueTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#2563EB',
    marginBottom: 4,
  },
  bmbRadioTicketBox: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 11,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  bmbRadioTicketBoxSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  radioDotCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  radioDotCircleActive: {
    borderColor: '#2563EB',
  },
  radioDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
  },
  bmbMiniOrangeBadge: {
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  bmbMiniOrangeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#D97706',
  },
  bmbMiniPurpleBadge: {
    backgroundColor: '#FAF5FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  bmbMiniPurpleText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#7C3AED',
  },
  bmbActiveJobItem: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cleanInfoCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 10,
  },
  cleanInfoCardTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 3,
  },
  cleanInfoCardDesc: {
    fontSize: 11.5,
    color: '#64748B',
    lineHeight: 16,
  },
  bmbStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  bmbStatLabel: {
    fontSize: 12.5,
    color: '#64748B',
  },
  bmbStatValue: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  bmbAlertRedCard: {
    backgroundColor: '#FEF2F2',
    borderLeftWidth: 3,
    borderLeftColor: '#EF4444',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  bmbAlertOrangeCard: {
    backgroundColor: '#FFFBEB',
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
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
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },

  // --- Mobile Brand & Login ---
  brandCenter: {
    alignItems: 'center',
    marginBottom: 20,
    gap: 0,
  },
  appIconBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  appIconSymbol: {
    fontSize: 28,
    color: '#FFFFFF',
  },
  brandTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#2563EB',
    marginTop: 6,
    letterSpacing: -0.5,
  },
  brandSub: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 3,
    textAlign: 'center',
  },
  geminiBadgePill: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    backgroundColor: '#FAF5FF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
  },
  geminiBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#7C3AED',
  },
  loginCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  loginCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  loginCardSub: {
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 3,
    marginBottom: 12,
    lineHeight: 17,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginTop: 8,
    marginBottom: 5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
  },
  inputPrefixIcon: {
    fontSize: 15,
    marginRight: 8,
    color: '#64748B',
  },
  textInputField: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
  },
  eyeIcon: {
    fontSize: 15,
    paddingLeft: 8,
  },
  eyeIconText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#64748B',
  },
  rememberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 16,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  rememberText: {
    fontSize: 12.5,
    color: '#475569',
  },
  forgotText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#2563EB',
  },
  loginSubmitBtn: {
    backgroundColor: '#2563EB',
    height: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  loginSubmitText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  demoSwitchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 6,
  },
  demoChip: {
    flex: 1,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  demoChipText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#2563EB',
    textAlign: 'center',
  },

  // --- Mobile Resident Home & CTA ---
  resHomeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  aptSmallLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  aptBigTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  bellCircleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  bellRedDot: {
    position: 'absolute',
    top: 6,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  ctaHeroCard: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  ctaTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  qrFrameIcon: {
    fontSize: 18,
    color: '#2563EB',
    marginRight: 8,
    fontWeight: '800',
  },
  ctaHeroTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  ctaHeroDesc: {
    fontSize: 12.5,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 12,
  },
  ctaPrimaryBtn: {
    backgroundColor: '#2563EB',
    height: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 4,
    elevation: 3,
  },
  ctaPrimaryBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitleText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  seeHistoryLink: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#2563EB',
  },
  pillsScroll: {
    marginBottom: 12,
    flexGrow: 0,
  },
  chipWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  filterPill: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 6,
  },
  filterPillActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  resTicketCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 3,
    elevation: 1,
  },
  resTicketCardCompleted: {
    borderColor: '#10B981',
    borderWidth: 1.5,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardCodeText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#64748B',
  },
  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardMainTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 3,
  },
  cardLocationText: {
    fontSize: 12,
    color: '#64748B',
  },
  completedActionBar: {
    marginTop: 10,
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  completedActionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  resolvedGreenBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  resolvedGreenBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  cardFooterGrayBar: {
    marginTop: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardFooterGrayText: {
    fontSize: 11.5,
    color: '#64748B',
  },

  // --- Technician Duty & Task Card ---
  techDutyCard: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  techDutyTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  techDutySub: {
    fontSize: 12.5,
    color: '#475569',
    lineHeight: 18,
  },
  urgentRedText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
    marginBottom: 3,
  },
  techAssignActionBar: {
    marginTop: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  acceptJobBlueBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  acceptJobBlueBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  assignedTimeMeta: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#2563EB',
  },
  techInProgressBar: {
    marginTop: 10,
    backgroundColor: '#EEF2FF',
    borderRadius: 8,
    padding: 8,
  },
  techInProgressText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4F46E5',
  },
  techDetailTopCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#34D399',
  },
  techInfoLine: {
    fontSize: 12.5,
    color: '#1E293B',
    marginBottom: 6,
    lineHeight: 18,
  },
  residentDescGray: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 10,
    lineHeight: 18,
  },
  residentGrayThumb: {
    width: '31%',
    height: 72,
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
  },
  techCapturedBox: {
    width: '48%',
    height: 88,
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
  },
  techAddPhotoDashedBox: {
    width: '48%',
    height: 88,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#93C5FD',
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8,
  },
  techPlusIcon: {
    fontSize: 20,
    color: '#2563EB',
    marginBottom: 3,
  },
  techAddPhotoBlueText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#2563EB',
    textAlign: 'center',
  },
  techNotiUrgentBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  techNotiUrgentTag: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#DC2626',
    marginBottom: 3,
  },
  techNotiAcceptedBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  techNotiAcceptedTag: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#059669',
    marginBottom: 3,
  },
  techNotiBodyText: {
    fontSize: 12.5,
    color: '#0F172A',
    lineHeight: 18,
  },
  techProfileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  techAvatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  specialtyPill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  specialtyPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#2563EB',
  },
  techDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 10,
  },
  techProfileLine: {
    fontSize: 13,
    color: '#0F172A',
    marginBottom: 6,
    lineHeight: 19,
  },
  waitingResidentBanner: {
    backgroundColor: '#CCFBF1',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
    marginBottom: 8,
  },
  waitingResidentBannerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
  },
  sentPhotoBlueBar: {
    marginTop: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 8,
  },
  sentPhotoBlueText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
  },
  closedResidentGreenBar: {
    marginTop: 8,
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    padding: 8,
  },
  closedResidentGreenText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
  },

  // --- Sub-screens, Forms, Proof & Details ---
  subScreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  subScreenHeaderBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
    gap: 8,
  },
  rowCenterFlex: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 8,
  },
  backArrowText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginRight: 8,
  },
  subScreenTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    flexShrink: 1,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 6,
    marginBottom: 8,
  },
  qrDashedBtn: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#60A5FA',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  qrDashedBtnText: {
    color: '#2563EB',
    fontSize: 13.5,
    fontWeight: '700',
  },
  qrRecognizedBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#34D399',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  qrRecognizedTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#047857',
    lineHeight: 17,
  },
  qrRecognizedSub: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 3,
  },
  photoGridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  photoSlotCard: {
    width: '31%',
    height: 106,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
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
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removePhotoX: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  slotPreviewImg: {
    width: 48,
    height: 48,
    borderRadius: 6,
    marginBottom: 4,
  },
  photoSlotCaption: {
    fontSize: 10.5,
    color: '#64748B',
    textAlign: 'center',
  },
  addPhotoDashedSlot: {
    width: '31%',
    height: 106,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  addPhotoPlus: {
    fontSize: 22,
    color: '#64748B',
    marginBottom: 3,
  },
  addPhotoLabel: {
    fontSize: 10.5,
    color: '#64748B',
    textAlign: 'center',
  },
  descBoxContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 10,
    marginBottom: 12,
  },
  descTextArea: {
    minHeight: 70,
    fontSize: 14,
    color: '#0F172A',
    textAlignVertical: 'top',
  },
  charCountText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#059669',
  },
  geminiInfoBox: {
    backgroundColor: '#FAF5FF',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  geminiInfoText: {
    color: '#7E22CE',
    fontSize: 12,
    lineHeight: 17,
  },
  stickyBottomBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  whiteSectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 3,
    elevation: 1,
  },
  cardBlockTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  timelineContainer: {
    marginTop: 4,
  },
  timelineHeaderBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    marginBottom: 12,
  },
  timelineMetaLine: {
    fontSize: 12,
    color: '#334155',
    marginVertical: 2,
  },
  timelineStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  timelineLeftCol: {
    alignItems: 'center',
    width: 20,
    marginRight: 10,
  },
  timelineRightCol: {
    flex: 1,
    paddingBottom: 14,
  },
  timelineStepTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timelineStepTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  timelineStepMeta: {
    fontSize: 11.5,
    color: '#64748B',
  },
  timelineStepDuration: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  timelineStepNoteBox: {
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 4,
  },
  timelineStepNoteText: {
    fontSize: 11.5,
    color: '#475569',
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  timelineText: {
    fontSize: 12.5,
    color: '#475569',
    flex: 1,
  },
  timelineLine: {
    width: 2,
    height: 14,
    backgroundColor: '#CBD5E1',
    marginLeft: 4,
    marginVertical: 2,
  },
  proofGreenBorderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#10B981',
  },
  proofCompareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  proofHalfCol: {
    width: '48%',
  },
  proofBoxBefore: {
    height: 86,
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  proofPlaceholderText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 3,
  },
  proofBoxAfter: {
    height: 86,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#6EE7B7',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  greenCheckCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  proofAfterSmallText: {
    fontSize: 11,
    color: '#059669',
    marginTop: 3,
    fontWeight: '600',
  },
  proofLabelBefore: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  proofLabelAfter: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  techNoteGrayBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  techNoteGrayText: {
    fontSize: 12.5,
    color: '#475569',
    lineHeight: 17,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },
  starIcon: {
    fontSize: 26,
    color: '#F59E0B',
  },
  ratingInputBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    minHeight: 56,
    fontSize: 13,
    color: '#0F172A',
    textAlignVertical: 'top',
  },
  confirmCloseGreenBtn: {
    backgroundColor: '#10B981',
    height: 46,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmCloseGreenText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  unreadPillBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
  },
  unreadPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#2563EB',
  },
  notiBlueItem: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 11,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  notiItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 18,
  },
  notiItemTime: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 4,
  },
  blueUnreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
    marginTop: 3,
  },
  profileAvatarWrapper: {
    alignItems: 'center',
    marginVertical: 8,
  },
  profileAvatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EFF6FF',
    borderWidth: 2,
    borderColor: '#DBEAFE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  profileNameText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  profileInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  profileInfoIconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  profileInfoValue: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  logoutRedOutlineBtn: {
    marginTop: 14,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutRedOutlineText: {
    color: '#DC2626',
    fontSize: 13.5,
    fontWeight: '700',
  },
  totalCountBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  totalCountText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#475569',
  },
  searchBarBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 10,
  },
  searchBarInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
  },
  historyFooterBar: {
    marginTop: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyClosedDate: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  historyTechName: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  historyRatingNum: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  figmaBottomNav: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 10,
    paddingBottom: Platform.OS === 'android' ? 12 : 14,
    minHeight: 62,
  },
  figmaNavTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  figmaNavLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 4,
    fontWeight: '600',
  },
  figmaNavLabelActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toastBanner: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  toastText: {
    color: '#1D4ED8',
    fontWeight: '700',
    fontSize: 12.5,
    textAlign: 'center',
  },
  emergencyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 3,
    elevation: 1,
  },
  emergencyIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emergencyTitle: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#DC2626',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emergencyContactName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  emergencyCallBtn: {
    backgroundColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  emergencyCallBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11.5,
  },
  loginRoleSelectorRow: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: 8,
  },
  loginRoleChip: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginRoleChipActive: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  loginRoleChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
  },
  loginRoleChipTextActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  primaryActionBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12.5,
  },
});
