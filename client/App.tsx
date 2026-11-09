import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  Platform,
  Image,
  StatusBar,
  Alert,
  Modal,
  Linking,
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
import { ScreenTransition, AnimatedModalContent } from './Transitions';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================================
// CẤU HÌNH ĐỊA CHỈ BACKEND CHUẨN CHO CẢ WEB & ĐIỆN THOẠI
// ============================================================================
const getApiBaseUrl = () => {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      return `http://${window.location.hostname}:5000/api`;
    }
    return 'http://localhost:5000/api';
  }
  return 'https://silver-guests-wink.loca.lt/api'; // Trên điện thoại: Gọi qua LocalTunnel (hoặc ngrok) để truy cập cổng 5000 của máy tính
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

// Đặt true khi nhóm cần nút demo đăng nhập nhanh, false để màn hình đúng Figma.
const SHOW_DEMO_SHORTCUTS = false;

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
    'HOME' | 'TASK_DETAIL' | 'NOTI_PROFILE' | 'HISTORY' | 'PAYROLL'
  >('HOME');
  const [bmbNavTab, setBmbNavTab] = useState<'TICKETS' | 'TECHNICIANS' | 'NOTIFICATIONS' | 'APARTMENTS' | 'ATTENDANCE' | 'PAYROLL'>('TICKETS');

  // Thông báo mở rộng / thu gọn
  const [showAllNotifications, setShowAllNotifications] = useState(false);
  const [showAllBmbNotifications, setShowAllBmbNotifications] = useState(false);

  // Đăng nhập 3 vai trò
  const [selectedLoginRole, setSelectedLoginRole] = useState<'RESIDENT' | 'TECHNICIAN' | 'BMB'>('RESIDENT');

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
  const [selectedResident, setSelectedResident] = useState<any | null>(null);
  const [residentForm, setResidentForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    apartmentCode: 'A-1204',
    buildingBlock: 'Tòa S1',
    floorNumber: 12,
    password: '',
    isRepresentative: false,
  });
  const [newPasswordInput, setNewPasswordInput] = useState('');

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
  const [otherCostInput, setOtherCostInput] = useState('0');

  // SLA & Escalation
  const [ticketSlas, setTicketSlas] = useState<Record<string, any>>({});
  const [slaDashboard, setSlaDashboard] = useState<any | null>(null);

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
  const [bmbAttendanceStats, setBmbAttendanceStats] = useState({
    totalLogs: 0,
    verifiedCount: 0,
    pendingReviewCount: 0,
    lateCount: 0,
    totalBillableHours: 0,
    totalDisputedHours: 0,
  });
  const [selectedAttendanceForReview, setSelectedAttendanceForReview] = useState<any | null>(null);
  const [bmbReviewAction, setBmbReviewAction] = useState<'APPROVE' | 'REJECT' | 'REQUEST_EXPLANATION'>('APPROVE');
  const [bmbReviewNote, setBmbReviewNote] = useState('');
  const [bmbAdjustedHours, setBmbAdjustedHours] = useState('');
  const [showAttendanceReviewModal, setShowAttendanceReviewModal] = useState(false);
  const [viewingPhotoModal, setViewingPhotoModal] = useState<{ url: string; title: string; meta?: any } | null>(null);

  // Cấu hình tọa độ tòa nhà BMB (Bảo mật GPS & Xác thực chấm công)
  const [bmbBuildingLocation, setBmbBuildingLocation] = useState<any | null>(null);
  const [bmbBuildingModalVisible, setBmbBuildingModalVisible] = useState(false);
  const [bmbBuildingForm, setBmbBuildingForm] = useState({
    buildingName: 'Tòa nhà ResiFix SkyView',
    buildingAddress: '123 Đường Nguyễn Hữu Thọ, Phường Tân Hưng, Quận 7, TP.HCM',
    latitude: '10.7324',
    longitude: '106.6992',
    allowedRadiusMeters: '300',
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
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotCooldown, setForgotCooldown] = useState(0);
  const [forgotBusy, setForgotBusy] = useState(false);

  const [showActivationModal, setShowActivationModal] = useState(false);
  const [activationEmail, setActivationEmail] = useState('');
  const [activationOtp, setActivationOtp] = useState('');
  const [activationNewPassword, setActivationNewPassword] = useState('');
  const [activationConfirmPassword, setActivationConfirmPassword] = useState('');
  const [activationCooldown, setActivationCooldown] = useState(0);
  const [activationBusy, setActivationBusy] = useState(false);

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
  const [isVoiceUsed, setIsVoiceUsed] = useState(false);

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
    const id = (overrideId ?? phoneInput).trim();
    const pass = overridePass ?? passwordInput;
    if (!id || !pass) {
      showToast(translate('Vui lòng nhập đầy đủ thông tin đăng nhập.'));
      return;
    }
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
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.isPendingActivation) {
          setActivationEmail(data.email || (id.includes('@') ? id : ''));
          setActivationOtp('');
          setActivationNewPassword('');
          setActivationConfirmPassword('');
          setShowActivationModal(true);
          showToast(data.message || 'Tài khoản chưa được kích hoạt. Vui lòng nhập mã OTP để kích hoạt.');
          return;
        }
        showToast(data.message || translate('Sai thông tin đăng nhập!'));
        return;
      }
      const userRole = data.user?.role;
      if (userRole !== selectedLoginRole) {
        const roleLabels: Record<string, string> = {
          BMB: 'BMB / Admin',
          TECHNICIAN: 'Kỹ thuật viên',
          RESIDENT: 'Cư dân',
        };
        showToast(
          `Tài khoản thuộc vai trò ${roleLabels[userRole] || userRole}, không khớp với lựa chọn ${roleLabels[selectedLoginRole]}!`
        );
        return;
      }
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

  const handleRequestForgotOtp = async () => {
    const cleanEmail = forgotEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      showToast('Vui lòng nhập địa chỉ email hợp lệ.');
      return;
    }
    try {
      setForgotBusy(true);
      const res = await fetch(`${API_BASE_URL}/auth/otp/request-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.message || 'Không thể yêu cầu mã OTP lúc này.');
        return;
      }
      setForgotStep(2);
      setForgotCooldown(60);
      showToast(data.message || 'Mã OTP đã được gửi đến email của bạn.');
    } catch {
      showToast('Không thể kết nối đến máy chủ.');
    } finally {
      setForgotBusy(false);
    }
  };

  const handleResetPassword = async () => {
    const cleanEmail = forgotEmail.trim().toLowerCase();
    const cleanOtp = forgotOtp.trim();
    if (!cleanEmail) {
      showToast('Vui lòng nhập email.');
      return;
    }
    if (cleanOtp.length !== 6) {
      showToast('Mã OTP phải gồm chính xác 6 chữ số.');
      return;
    }
    if (forgotNewPassword.length < 12 || forgotNewPassword.length > 128) {
      showToast('Mật khẩu mới phải có độ dài từ 12 đến 128 ký tự.');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      showToast('Mật khẩu xác nhận không khớp.');
      return;
    }
    try {
      setForgotBusy(true);
      const res = await fetch(`${API_BASE_URL}/auth/otp/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({
          email: cleanEmail,
          otp: cleanOtp,
          newPassword: forgotNewPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.message || 'Đặt lại mật khẩu thất bại.');
        return;
      }
      showToast('✓ Đặt lại mật khẩu thành công! Vui lòng đăng nhập lại.');
      setShowForgotModal(false);
      setForgotStep(1);
      setForgotOtp('');
      setForgotNewPassword('');
      setForgotConfirmPassword('');
      setPasswordInput('');
    } catch {
      showToast('Không thể kết nối đến máy chủ.');
    } finally {
      setForgotBusy(false);
    }
  };

  const handleRequestActivationOtp = async () => {
    const cleanEmail = activationEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      showToast('Vui lòng nhập địa chỉ email hợp lệ.');
      return;
    }
    try {
      setActivationBusy(true);
      const res = await fetch(`${API_BASE_URL}/auth/otp/request-activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.message || 'Không thể gửi lại mã OTP lúc này.');
        return;
      }
      setActivationCooldown(60);
      showToast(data.message || 'Đã gửi mã OTP kích hoạt đến email của bạn.');
    } catch {
      showToast('Không thể kết nối đến máy chủ.');
    } finally {
      setActivationBusy(false);
    }
  };

  const handleActivateAccount = async () => {
    const cleanEmail = activationEmail.trim().toLowerCase();
    const cleanOtp = activationOtp.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      showToast('Vui lòng nhập địa chỉ email hợp lệ.');
      return;
    }
    if (cleanOtp.length !== 6) {
      showToast('Mã OTP phải gồm chính xác 6 chữ số.');
      return;
    }
    if (activationNewPassword.length < 12 || activationNewPassword.length > 128) {
      showToast('Mật khẩu mới phải từ 12 đến 128 ký tự.');
      return;
    }
    if (activationNewPassword !== activationConfirmPassword) {
      showToast('Mật khẩu xác nhận không khớp.');
      return;
    }
    try {
      setActivationBusy(true);
      const res = await fetch(`${API_BASE_URL}/auth/otp/activate-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'bypass-tunnel-reminder': 'true' },
        body: JSON.stringify({
          email: cleanEmail,
          otp: cleanOtp,
          newPassword: activationNewPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.message || 'Kích hoạt tài khoản thất bại.');
        return;
      }
      showToast('✓ Kích hoạt tài khoản thành công! Bạn có thể đăng nhập ngay.');
      setShowActivationModal(false);
      setPasswordInput(activationNewPassword);
      setPhoneInput(cleanEmail);
      setActivationOtp('');
      setActivationNewPassword('');
      setActivationConfirmPassword('');
    } catch {
      showToast('Không thể kết nối đến máy chủ.');
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

        // Tải danh sách căn hộ & cư dân cho BMB (độc lập, không chặn luồng)
        void Promise.allSettled([
          fetch(`${API_BASE_URL}/management/apartments`, { headers })
            .then((r) => r.json())
            .then((d) => {
              if (d?.apartments) {
                setApartments(d.apartments);
                if (!selectedApartment && d.apartments.length > 0) {
                  setSelectedApartment(d.apartments[0]);
                }
              }
            })
            .catch(() => undefined),
          fetch(`${API_BASE_URL}/management/residents`, { headers })
            .then((r) => r.json())
            .then((d) => {
              if (d?.residents) setResidentsList(d.residents);
            })
            .catch(() => undefined),
        ]);

        // Tải bảng lương và chấm công BMB (độc lập)
        void fetch(`${API_BASE_URL}/payroll/admin/summary`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.success) setBmbPayrollSummary(d);
          })
          .catch(() => undefined);

        void fetch(`${API_BASE_URL}/payroll/admin/attendance`, { headers })
          .then((r) => r.json())
          .then((d) => {
            if (d?.attendanceLogs) setBmbAttendanceLogs(d.attendanceLogs);
            if (d?.anomalies) setBmbAnomalies(d.anomalies);
            if (d?.success) {
              setBmbAttendanceStats({
                totalLogs: d.totalLogs || (d.attendanceLogs ? d.attendanceLogs.length : 0),
                verifiedCount: d.verifiedCount || 0,
                pendingReviewCount: d.pendingReviewCount || 0,
                lateCount: d.lateCount || 0,
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
                latitude: String(d.buildingLocation.latitude ?? 10.7324),
                longitude: String(d.buildingLocation.longitude ?? 106.6992),
                allowedRadiusMeters: String(d.buildingLocation.allowedRadiusMeters ?? 300),
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
        } catch (netErr) {
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
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
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
    const cleanName = residentForm.fullName.trim();
    const digitsOnly = residentForm.phone.replace(/[^\d]/g, '');
    const cleanEmail = residentForm.email.trim();
    const cleanPass = residentForm.password.trim();

    if (cleanName.length < 2 || !/^0\d{9}$/.test(digitsOnly)) {
      showToast(translate('Vui lòng nhập họ tên (tối thiểu 2 ký tự) và SĐT hợp lệ (đúng 10 số, bắt đầu bằng 0).'));
      return;
    }

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      showToast(translate('Vui lòng nhập địa chỉ email hợp lệ để hệ thống gửi mã OTP kích hoạt tài khoản.'));
      return;
    }

    // Kiểm tra mật khẩu khi thêm cư dân:
    // - Cho phép để trống để cư dân tự tạo mật khẩu qua OTP
    // - Nếu BMB chủ động nhập: yêu cầu tối thiểu 12 ký tự
    if (residentModalMode === 'create' && cleanPass) {
      if (cleanPass.length < 12 || cleanPass.length > 128) {
        showToast(translate('Mật khẩu ban đầu phải từ 12 đến 128 ký tự (hoặc để trống để cư dân tự tạo qua OTP).'));
        return;
      }
    }

    try {
      setLoading(true);
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
          ...residentForm,
          fullName: cleanName,
          phone: digitsOnly,
          email: cleanEmail || null,
          password: cleanPass || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate(isEdit ? 'Đã cập nhật thông tin cư dân.' : 'Đã thêm cư dân thành công.'));
        setResidentModalMode(null);
        if (data.resident) {
          setResidentsList((prev) => {
            if (isEdit) {
              return prev.map((item) => (item.id === data.resident.id ? { ...item, ...data.resident } : item));
            }
            return [data.resident, ...prev.filter((item) => item.id !== data.resident.id)];
          });
        }
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi lưu cư dân.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  const handleResetResidentPassword = async () => {
    if (!selectedResident || newPasswordInput.trim().length < 12) {
      showToast(translate('Mật khẩu mới tối thiểu 12 ký tự để đảm bảo an toàn.'));
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/management/residents/${selectedResident.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({ newPassword: newPasswordInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        showToast(translate(data.message || 'Đã đặt lại mật khẩu thành công!'));
        setResidentModalMode(null);
        setNewPasswordInput('');
      } else {
        showToast(data?.message || translate('Lỗi khi đặt lại mật khẩu.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
  };





  const handleResidentDeparture = async (resId: string) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/management/residents/${resId}/departure`, {
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
        showToast(data.message || translate('Đã cập nhật ngày rời phòng cho cư dân.'));
        await fetchAllData();
      } else {
        showToast(data?.message || translate('Lỗi khi ghi nhận rời phòng.'));
      }
    } catch {
      showToast(translate('Không kết nối được Backend. Vui lòng thử lại.'));
    } finally {
      setLoading(false);
    }
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
        setBmbAttendanceStats({
          totalLogs: data.totalLogs || data.attendanceLogs.length,
          verifiedCount: data.verifiedCount || 0,
          pendingReviewCount: data.pendingReviewCount || 0,
          lateCount: data.lateCount || 0,
          totalBillableHours: data.totalBillableHours || 0,
          totalDisputedHours: data.totalDisputedHours || 0,
        });
      }
    } catch (err) {
      console.warn('Lỗi khi tải danh sách chấm công BMB:', err);
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
              placeholder="VD: Tòa nhà ResiFix SkyView"
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={{ marginVertical: 6 }}>
            <Text style={styles.fieldLabel}>{translate('Địa chỉ tòa nhà *')}</Text>
            <TextInput
              style={styles.technicianFormInput}
              value={bmbBuildingForm.buildingAddress}
              onChangeText={(val) => setBmbBuildingForm((f) => ({ ...f, buildingAddress: val }))}
              placeholder="VD: 123 Đường Nguyễn Hữu Thọ, Phường Tân Hưng, Quận 7"
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
                placeholder="10.7324"
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
                placeholder="106.6992"
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
    setBmbSelectedTicket(t);
    setBmbCategory(t.finalCategory || t.aiSuggestedCategory || 'OTHER');
    setBmbPriority(t.finalPriority || t.aiSuggestedPriority || 'MEDIUM');
    setBmbNote(t.bmbAdminNote || '');
    if (t.assignedTechId) setBmbTechId(t.assignedTechId);
  };

  const openResidentTicket = (ticket: any) => {
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
    const other = Number(otherCostInput) || 0;

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





  // Quét QR tự động điền thiết bị (Màn hình 02 Cư dân)
  const [qrModalVisible, setQrModalVisible] = useState(false);

  // Hàm xử lý khi Camera quét được mã QR thiết bị (FR05, US-09)
  const handleQrCodeDetected = async (rawCode: string) => {
    const cleanCode = rawCode.trim().toUpperCase();
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
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success || !data?.asset) {
        showToast(data?.message || translate('QR code was not found in the active asset list.'));
        return;
      }
      setScannedAsset({
        qrCode: data.asset.qrCode,
        assetName: data.asset.assetName,
        locationLabel: data.asset.locationLabel,
      });
      showToast(translate(`QR code identified: ${data.asset.assetName}`));
    } catch {
      showToast(translate(`Could not look up QR code "${cleanCode}". Check the backend connection and try again.`));
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
        setActiveTicket(data.ticket || { ...ticketObj, status: 'IN_PROGRESS' });
        setTechScreen('TASK_DETAIL');
      }
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
                  : `${translate('Nhập mã OTP 6 số đã gửi tới:')} ${forgotEmail}`}
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
                    placeholder="123456"
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

        {/* Modal Kích hoạt tài khoản cư dân */}
        <Modal
          visible={showActivationModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowActivationModal(false)}
        >
          <View style={styles.technicianModalOverlay}>
            <AnimatedModalContent visible={showActivationModal} style={styles.technicianModalCard}>
              <Text style={styles.technicianModalTitle}>{translate('Kích hoạt tài khoản Cư dân')}</Text>
              <Text style={styles.technicianModalDescription}>
                {translate('Vui lòng nhập mã OTP đã nhận qua email và thiết lập mật khẩu bảo mật (từ 12 đến 128 ký tự).')}
              </Text>

              <View style={{ marginTop: 12 }}>
                <Text style={styles.fieldLabel}>{translate('Địa chỉ Email *')}</Text>
                <TextInput
                  style={styles.technicianFormInput}
                  value={activationEmail}
                  onChangeText={setActivationEmail}
                  placeholder="cu_dan@resifix.vn"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <Text style={[styles.fieldLabel, { marginTop: 10 }]}>{translate('Mã OTP 6 chữ số *')}</Text>
                <TextInput
                  style={styles.technicianFormInput}
                  value={activationOtp}
                  onChangeText={setActivationOtp}
                  placeholder="123456"
                  keyboardType="numeric"
                  maxLength={6}
                />

                <Text style={[styles.fieldLabel, { marginTop: 10 }]}>
                  {translate('Mật khẩu mới (12-128 ký tự) *')}
                </Text>
                <TextInput
                  style={styles.technicianFormInput}
                  value={activationNewPassword}
                  onChangeText={setActivationNewPassword}
                  secureTextEntry
                  placeholder="Nhập tối thiểu 12 ký tự"
                />

                <Text style={[styles.fieldLabel, { marginTop: 10 }]}>
                  {translate('Xác nhận mật khẩu mới *')}
                </Text>
                <TextInput
                  style={styles.technicianFormInput}
                  value={activationConfirmPassword}
                  onChangeText={setActivationConfirmPassword}
                  secureTextEntry
                  placeholder="Nhập lại mật khẩu mới"
                />

                <View style={{ flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', marginTop: 12 }}>
                  <TouchableOpacity
                    onPress={handleRequestActivationOtp}
                    disabled={activationCooldown > 0 || activationBusy}
                  >
                    <Text style={{ fontSize: 13, color: activationCooldown > 0 ? '#94A3B8' : '#0284C7', fontWeight: '600' }}>
                      {activationCooldown > 0
                        ? `${translate('Gửi lại mã OTP sau')} (${activationCooldown}s)`
                        : translate('Gửi lại mã OTP')}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                  <TouchableOpacity
                    style={[styles.technicianCancelButton, { flex: 1 }]}
                    onPress={() => setShowActivationModal(false)}
                    disabled={activationBusy}
                  >
                    <Text style={styles.technicianCancelButtonText}>{translate('Hủy')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.bmbWebLoginBtn, { flex: 2 }, activationBusy && { opacity: 0.6 }]}
                    onPress={handleActivateAccount}
                    disabled={activationBusy}
                  >
                    {activationBusy ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.bmbWebLoginBtnText}>{translate('Kích hoạt ngay')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </AnimatedModalContent>
          </View></Modal>
      </>
    );

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

              <View style={[styles.loginRoleSelectorRow, { marginBottom: 14 }]}>
                {[
                  { key: 'BMB', label: 'BMB / Admin' },
                  { key: 'TECHNICIAN', label: 'Kỹ thuật viên' },
                  { key: 'RESIDENT', label: 'Cư dân' },
                ].map((r) => (
                  <TouchableOpacity
                    key={r.key}
                    style={[
                      styles.loginRoleChip,
                      selectedLoginRole === r.key && styles.loginRoleChipActive,
                    ]}
                    onPress={() => {
                      setSelectedLoginRole(r.key as any);
                      if (r.key === 'BMB') {
                        setLoginMode('BMB_WEB');
                        setPhoneInput('myhanh.bmb@resifix.vn');
                      } else if (r.key === 'TECHNICIAN') {
                        setLoginMode('MOBILE');
                        setPhoneInput('0356166863');
                      } else {
                        setLoginMode('MOBILE');
                        setPhoneInput('0905123456');
                      }
                    }}
                  >
                    <Text style={[styles.loginRoleChipText, selectedLoginRole === r.key && styles.loginRoleChipTextActive]}>
                      {translate(r.label)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

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
                      setActivationEmail(phoneInput.includes('@') ? phoneInput : '');
                      setActivationOtp('');
                      setActivationNewPassword('');
                      setActivationConfirmPassword('');
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

              {/* Thanh chuyển nhanh sang giao diện Mobile App để tiện Demo trên cùng 1 máy */}
              <View style={[styles.demoSwitchRow, { marginTop: 20 }]}>
                <TouchableOpacity
                  style={styles.demoChip}
                  onPress={() => {
                    setLoginMode('MOBILE');
                  }}
                >
                  <Text style={styles.demoChipText}>{translate("Xem giao diện Mobile")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.demoChip}
                  onPress={() => {
                    setPhoneInput('myhanh.bmb@resifix.vn');
                    handleLogin('myhanh.bmb@resifix.vn', '123456');
                  }}
                >
                  <Text style={styles.demoChipText}>{translate("Vào nhanh BMB Web")}</Text>
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
            <View style={styles.brandCenter}>
              <ResiFixLogoMark size={60} />
              <Text style={styles.brandTitle}>ResiFix</Text>
              <Text style={styles.brandSub}>
                {translate("Hệ thống Quản lý & Khắc phục Sự cố Tòa nhà")}</Text>
              <View style={styles.geminiBadgePill}>
                <Text style={styles.geminiBadgeText}>{translate("Trợ lý Gemini AI hỗ trợ")}</Text>
              </View>
            </View>

            {toastMsg && (
              <View style={styles.toastBanner}>
                <Text style={styles.toastText}>{toastMsg}</Text>
              </View>
            )}

            <View style={styles.loginCard}>
              <Text style={styles.loginCardTitle}>{translate("Đăng nhập tài khoản")}</Text>

              <View style={[styles.loginRoleSelectorRow, { marginBottom: 14 }]}>
                {[
                  { key: 'RESIDENT', label: 'Cư dân' },
                  { key: 'TECHNICIAN', label: 'Kỹ thuật viên' },
                  { key: 'BMB', label: 'BMB / Admin' },
                ].map((r) => (
                  <TouchableOpacity
                    key={r.key}
                    style={[
                      styles.loginRoleChip,
                      selectedLoginRole === r.key && styles.loginRoleChipActive,
                    ]}
                    onPress={() => {
                      setSelectedLoginRole(r.key as any);
                      if (r.key === 'BMB') {
                        setLoginMode('BMB_WEB');
                        setPhoneInput('myhanh.bmb@resifix.vn');
                      } else if (r.key === 'TECHNICIAN') {
                        setLoginMode('MOBILE');
                        setPhoneInput('0356166863');
                      } else {
                        setLoginMode('MOBILE');
                        setPhoneInput('0905123456');
                      }
                    }}
                  >
                    <Text style={[styles.loginRoleChipText, selectedLoginRole === r.key && styles.loginRoleChipTextActive]}>
                      {translate(r.label)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.loginCardSub}>
                {translate("Sử dụng số điện thoại đã đăng ký với Ban quản lý tòa nhà")}</Text>

              <Text style={styles.fieldLabel}>{translate("Số điện thoại *")}</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.textInputField}
                  value={phoneInput}
                  onChangeText={(val) => setPhoneInput(val.replace(/[^\d]/g, '').slice(0, 10))}
                  placeholder="0905 xxx xxx"
                  placeholderTextColor="#94A3B8"
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>

              <Text style={styles.fieldLabel}>{translate("Mật khẩu *")}</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.textInputField}
                  value={passwordInput}
                  onChangeText={setPasswordInput}
                  secureTextEntry={!showPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#94A3B8"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={{ paddingHorizontal: 6 }}>
                  <Text style={styles.eyeIconText}>{showPassword ? translate('Ẩn') : translate('Hiện')}</Text>
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
                  setActivationEmail(phoneInput.includes('@') ? phoneInput : '');
                  setActivationOtp('');
                  setActivationNewPassword('');
                  setActivationConfirmPassword('');
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
            </View>

            <View style={styles.demoSwitchRow}>
              <TouchableOpacity
                style={styles.demoChip}
                onPress={() => {
                  setSelectedLoginRole('RESIDENT');
                  setLoginMode('MOBILE');
                  setPhoneInput('0905123456');
                  handleLogin('0905123456', '123456');
                }}
              >
                <Text style={styles.demoChipText}>Cư dân A-1204</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.demoChip}
                onPress={() => {
                  setSelectedLoginRole('TECHNICIAN');
                  setLoginMode('MOBILE');
                  setPhoneInput('0356166863');
                  handleLogin('0356166863', '123456');
                }}
              >
                <Text style={styles.demoChipText}>KTV Nam</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.demoChip}
                onPress={() => {
                  setSelectedLoginRole('BMB');
                  setLoginMode('BMB_WEB');
                  setPhoneInput('myhanh.bmb@resifix.vn');
                  handleLogin('myhanh.bmb@resifix.vn', '123456');
                }}
              >
                <Text style={styles.demoChipText}>BMB Web</Text>
              </TouchableOpacity>
            </View>
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
                    Căn hộ {user.apartmentCode || 'A-1204'} • {user.buildingBlock || 'Tòa S1'}
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

              <View style={styles.ctaHeroCard}>
                <View style={styles.ctaTitleRow}>
                  <Text style={styles.ctaHeroTitle}>{translate("Phát hiện sự cố tòa nhà?")}</Text>
                </View>
                <Text style={styles.ctaHeroDesc}>
                  {translate("Báo cáo nhanh sự cố với hình ảnh hiện trường hoặc quét mã QR thiết bị.")}</Text>
                <TouchableOpacity
                  style={styles.ctaPrimaryBtn}
                  onPress={() => setResScreen('CREATE_REPORT')}
                >
                  <Text style={styles.ctaPrimaryBtnText}>{translate("+ Báo cáo sự cố")}</Text>
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
                    onPress={() => openResidentTicket(t)}
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
                          KTV: {t.assignedTech?.fullName || 'Đặng Văn Nam'} • 15 phút trước
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
                  <Text style={styles.subScreenTitle}>{translate("Tạo báo cáo sự cố")}</Text>
                </View>

                <Text style={styles.stepTitle}>{translate("1. Vị trí & Thiết bị gặp sự cố *")}</Text>
                <TouchableOpacity
                  style={styles.qrDashedBtn}
                  onPress={() => setQrModalVisible(true)}
                >
                  <Text style={styles.qrDashedBtnText}>
                    {translate("Quét mã QR thiết bị để tự động điền")}</Text>
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
                      {translate("Đã nhận diện: ")}{scannedAsset.assetName}
                    </Text>
                    <Text style={styles.qrRecognizedSub}>
                      {translate("Mã thiết bị: ")}{scannedAsset.qrCode} {translate("• Vị trí: ")}{scannedAsset.locationLabel}
                    </Text>
                    <TouchableOpacity onPress={() => setScannedAsset(null)} style={{ marginTop: 4 }}>
                      <Text style={styles.seeHistoryLink}>{translate('Bỏ thiết bị đã chọn')}</Text>
                    </TouchableOpacity>
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
                        setIsVoiceUsed(true);
                        setReportDesc(
                          'Máy lạnh ở sảnh B tầng 1 bị chảy nước nhiều xuống sàn gây trơn trượt, có tiếng kêu to.'
                        );
                        showToast('Đã nhận diện giọng nói tiếng Việt!');
                      }}
                    >
                      <Text style={styles.voicePillText}>{translate("Nhập giọng nói")}</Text>
                    </TouchableOpacity>
                  </View>
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
                  style={[styles.loginSubmitBtn, (loading || reportDesc.trim().length < 10) && { opacity: 0.6 }]}
                  onPress={handleSubmitReport}
                  disabled={loading || reportDesc.trim().length < 10}
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
                    {translate("Bằng chứng khắc phục từ Kỹ thuật viên")}</Text>
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
                        <View style={styles.greenCheckCircle}>
                          <Text style={{ color: '#059669', fontWeight: '800', fontSize: 18 }}>
                            ✓
                          </Text>
                        </View>
                        <Text style={styles.proofAfterSmallText}>Đường ống đã thay mới</Text>
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

              {filteredHistoryTickets.map((t) => (
                <TouchableOpacity
                  key={t.id}
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
      </SafeAreaView>
    );
  }

  // ============================================================================
  // PHÂN HỆ 2: KỸ THUẬT VIÊN (TECHNICIAN) — BÁM BỐ CỤC 5 MÀN HÌNH FIGMA KTV
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

              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.techDutyCard}
                onPress={handleToggleOnDuty}
                disabled={dutyUpdating}
              >
                <View style={styles.cardTopRow}>
                  <Text style={styles.techDutyTitle}>
                    {translate("Trạng thái ca trực")}
                  </Text>
                  <View style={[styles.statusPill, (user.isOnDuty || isCurrentlyInShift(user.shiftName)) ? { backgroundColor: '#DCFCE7' } : { backgroundColor: '#F1F5F9' }]}>
                    <Text style={[styles.statusPillText, (user.isOnDuty || isCurrentlyInShift(user.shiftName)) ? { color: '#15803D' } : { color: '#64748B' }]}>
                      {dutyUpdating ? translate('Đang cập nhật...') : (user.isOnDuty || isCurrentlyInShift(user.shiftName)) ? translate('Đang trực') : translate('Ngoài ca')}
                    </Text>
                  </View>
                </View>
                <Text style={styles.techDutySub}>
                  {translate("Sự cố cần xử lý:")} {assignedCount + inProgressCount} • {translate("Đã hoàn thành:")} {completedCount}
                </Text>
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
                    {translate("Vị trí:")} {activeTicket.locationNote || 'Căn hộ A-1204 (Tòa S1 - Tầng 12)'}
                  </Text>
                  <Text style={styles.techInfoLine}>
                    {translate("Mã thiết bị:")}{' '}
                    {activeTicket.asset?.qrCode || 'WP-1204 - Đường ống bồn rửa'}
                  </Text>
                  <Text style={[styles.techInfoLine, { marginBottom: 0 }]}>
                    {translate("Độ ưu tiên:")} {translate(PRIORITY_VN[activeTicket.finalPriority || activeTicket.aiSuggestedPriority] || 'Bình thường')} • {translate("Danh mục:")}{' '}
                    {translate(CATEGORY_SHORT_VN[
                      activeTicket.finalCategory || activeTicket.aiSuggestedCategory
                    ] || 'Điện - Nước')}
                  </Text>
                </View>

                {/* Thẻ SLA & Cam kết dịch vụ */}
                <View style={styles.whiteSectionCard}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardBlockTitle}>{translate("Tiến độ SLA")}</Text>
                    {(() => {
                      const sla = ticketSlas[activeTicket.id];
                      const status = sla?.status || 'ON_TRACK';
                      const bg = status === 'BREACHED' ? '#FEE2E2' : status === 'AT_RISK' ? '#FEF3C7' : status === 'PAUSED' ? '#F1F5F9' : '#DCFCE7';
                      const fg = status === 'BREACHED' ? '#B91C1C' : status === 'AT_RISK' ? '#B45309' : status === 'PAUSED' ? '#64748B' : '#15803D';
                      const label = status === 'BREACHED' ? 'Quá hạn SLA' : status === 'AT_RISK' ? 'Sắp quá hạn' : status === 'PAUSED' ? 'Tạm dừng' : 'Đúng hạn';
                      return (
                        <View style={[styles.statusPill, { backgroundColor: bg }]}>
                          <Text style={[styles.statusPillText, { color: fg }]}>{translate(label)}</Text>
                        </View>
                      );
                    })()}
                  </View>
                  <Text style={styles.cardLocationText}>
                    Hạn phản hồi: {ticketSlas[activeTicket.id]?.responseDeadline ? new Date(ticketSlas[activeTicket.id].responseDeadline).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '30 phút'} •
                    Hạn hoàn thành: {ticketSlas[activeTicket.id]?.resolutionDeadline ? new Date(ticketSlas[activeTicket.id].resolutionDeadline).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '24 giờ'}
                  </Text>
                  {ticketSlas[activeTicket.id]?.escalationLevel > 0 && (
                    <Text style={{ fontSize: 11.5, color: '#DC2626', fontWeight: '700', marginTop: 4 }}>
                      ⚠️ Leo thang cấp độ {ticketSlas[activeTicket.id].escalationLevel}: Đã thông báo cấp quản lý
                    </Text>
                  )}
                </View>

                {/* Thẻ Đề xuất chi phí & Vật tư sửa chữa */}
                <View style={styles.whiteSectionCard}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardBlockTitle}>{translate("Chi phí sửa chữa")}</Text>
                    {ticketCosts[activeTicket.id] && (
                      <View style={[styles.statusPill, {
                        backgroundColor: ticketCosts[activeTicket.id].status === 'APPROVED' ? '#DCFCE7' : ticketCosts[activeTicket.id].status === 'REJECTED' ? '#FEE2E2' : '#FEF3C7'
                      }]}>
                        <Text style={[styles.statusPillText, {
                          color: ticketCosts[activeTicket.id].status === 'APPROVED' ? '#15803D' : ticketCosts[activeTicket.id].status === 'REJECTED' ? '#B91C1C' : '#B45309'
                        }]}>
                          {ticketCosts[activeTicket.id].status === 'APPROVED' ? translate('Đã phê duyệt') : ticketCosts[activeTicket.id].status === 'REJECTED' ? translate('Từ chối') : translate('Chờ duyệt')}
                        </Text>
                      </View>
                    )}
                  </View>

                  {ticketCosts[activeTicket.id] ? (
                    <View style={{ marginTop: 6 }}>
                      {(ticketCosts[activeTicket.id].items || []).map((it: any, idx: number) => (
                        <View key={idx} style={styles.bmbStatRow}>
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
                        <Text style={[styles.bmbStatLabel, { fontWeight: '700', color: '#0F172A' }]}>{translate("Tổng dự toán:")}</Text>
                        <Text style={[styles.bmbStatValue, { fontWeight: '800', color: '#2563EB', fontSize: 15 }]}>
                          {Number(ticketCosts[activeTicket.id].totalCost || 0).toLocaleString('vi-VN')} đ
                        </Text>
                      </View>
                      {ticketCosts[activeTicket.id].reviewNote && (
                        <Text style={{ fontSize: 11.5, color: '#64748B', fontStyle: 'italic', marginTop: 4 }}>
                          BMB: {ticketCosts[activeTicket.id].reviewNote}
                        </Text>
                      )}
                    </View>
                  ) : (
                    <View style={{ marginTop: 6 }}>
                      <Text style={[styles.cardLocationText, { marginBottom: 6 }]}>
                        {translate("Nếu cần thay mới linh kiện hoặc phát sinh vật tư, gửi đề xuất để BMB phê duyệt:")}
                      </Text>
                      <Text style={styles.fieldLabel}>{translate("Tên vật tư thay thế *")}</Text>
                      <TextInput
                        style={styles.textInputField}
                        value={matNameInput}
                        onChangeText={setMatNameInput}
                        placeholder={translate("Ví dụ: Ống nhựa PVC D21, Van khóa...")}
                        placeholderTextColor="#94A3B8"
                      />
                      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 6 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.fieldLabel}>{translate("Số lượng")}</Text>
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
                          <Text style={styles.fieldLabel}>{translate("Đơn vị")}</Text>
                          <TextInput
                            style={styles.textInputField}
                            value={matUnitInput}
                            onChangeText={setMatUnitInput}
                            placeholder="Cái"
                            placeholderTextColor="#94A3B8"
                          />
                        </View>
                        <View style={{ flex: 1.5 }}>
                          <Text style={styles.fieldLabel}>{translate("Đơn giá (VND)")}</Text>
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
                        onPress={() => handleTechSubmitCost(activeTicket.id)}
                        disabled={loading}
                      >
                        <Text style={styles.primaryActionBtnText}>{translate("Gửi đề xuất chi phí")}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
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
                    {translate("Ảnh nghiệm thu sau khi sửa (Bắt buộc ít nhất 1 ảnh) *")}</Text>
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
                          showToast(translate('Đã tải lên ảnh nghiệm thu sau sửa chữa!'));
                        })
                      }
                    >
                      <Text style={styles.techPlusIcon}>＋</Text>
                      <Text style={styles.techAddPhotoBlueText}>
                        {translate("+ Chụp ảnh hoàn thành (")}{techProofPhotos.length})
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {techProofPhotos.length === 0 && (
                    <Text style={[styles.inlineFieldError, { marginTop: 6 }]}>
                      {translate('Cần tải lên ít nhất 1 ảnh nghiệm thu')}
                    </Text>
                  )}
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
                    maxLength={500}
                  />
                </View>
              </ScrollView>

              {activeTicket.status !== 'COMPLETED' && activeTicket.status !== 'CLOSED' && (
                <View style={styles.stickyBottomBar}>
                  <TouchableOpacity
                    style={[styles.confirmCloseGreenBtn, (loading || techProofPhotos.length === 0) && { opacity: 0.6 }]}
                    onPress={() => handleTechCompleteSubmit(activeTicket)}
                    disabled={loading || techProofPhotos.length === 0}
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
                              <Text style={[styles.cardLocationText, { fontSize: 11.5, marginTop: 2 }]}>
                                📍 Check-in cách tòa nhà: ~{log.checkInGps.distanceMeters}m (±{log.checkInGps.accuracy}m)
                                {log.checkInGps.isWithinAllowedRadius ? ' • Trong bán kính hợp lệ' : ' • ⚠️ Ngoài bán kính 300m'}
                              </Text>
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
                                💬 Đã giải trình: "{log.explanationText}"
                              </Text>
                            )}

                            {log.reviewNote && (
                              <Text style={{ fontSize: 11.5, color: '#475569', marginTop: 2, fontWeight: '600' }}>
                                📝 Phản hồi BMB: "{log.reviewNote}"
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

              {/* Sub-tab 3: Lương của tôi */}
              {techPayrollSubTab === 'SALARY' && (
                <View style={styles.whiteSectionCard}>
                  <Text style={styles.cardBlockTitle}>
                    {translate("Phiếu lương tháng")} {myPayrollData?.month || new Date().toISOString().slice(0, 7)}
                  </Text>
                  <View style={[styles.unreadPillBadge, { alignSelf: 'flex-start', marginVertical: 6, backgroundColor: myPayrollData?.isLocked ? '#DCFCE7' : '#FEF3C7' }]}>
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: myPayrollData?.isLocked ? '#15803D' : '#B45309' }}>
                      {myPayrollData?.isLocked ? '🔒 ' + translate('Đã khóa bảng lương') : '⏳ Đang tổng hợp (Chưa khóa)'}
                    </Text>
                  </View>

                  <View style={styles.techDivider} />
                  <View style={styles.bmbStatRow}>
                    <Text style={styles.bmbStatLabel}>{translate("Lương cơ bản:")}</Text>
                    <Text style={styles.bmbStatValue}>
                      {Number(myPayrollData?.baseSalary || 10000000).toLocaleString('vi-VN')} đ
                    </Text>
                  </View>
                  <View style={styles.bmbStatRow}>
                    <Text style={styles.bmbStatLabel}>
                      {translate("Tiền tăng ca:")} ({myPayrollData?.approvedOtHours || 0}h x 1.5)
                    </Text>
                    <Text style={[styles.bmbStatValue, { color: '#16A34A' }]}>
                      +{Number(myPayrollData?.otPay || 0).toLocaleString('vi-VN')} đ
                    </Text>
                  </View>
                  <View style={styles.bmbStatRow}>
                    <Text style={styles.bmbStatLabel}>{translate("Phụ cấp:")}</Text>
                    <Text style={styles.bmbStatValue}>
                      +{Number(myPayrollData?.standardAllowance || 730000).toLocaleString('vi-VN')} đ
                    </Text>
                  </View>
                  <View style={styles.techDivider} />
                  <View style={styles.bmbStatRow}>
                    <Text style={[styles.bmbStatLabel, { fontWeight: '700', fontSize: 15, color: '#0F172A' }]}>
                      {translate("Tổng thực nhận:")}
                    </Text>
                    <Text style={[styles.bmbStatValue, { fontWeight: '800', fontSize: 17, color: '#2563EB' }]}>
                      {Number(myPayrollData?.totalSalary || 10730000).toLocaleString('vi-VN')} đ
                    </Text>
                  </View>

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

        {/* ==================================================================== */}
        {/* MÀN HÌNH 01 BMB: QUẢN LÝ SỰ CỐ (DANH SÁCH GIỮA + CHI TIẾT AI PHẢI)   */}
        {/* ==================================================================== */}
        <ScreenTransition transitionKey={bmbNavTab} style={{ flex: 1, flexDirection: 'row' }}>
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
                <View style={styles.rowCenter}>
                  <RealTimeClock style={{ marginRight: 8 }} />
                  <Text style={styles.bmbDateLabel}>{new Date().toLocaleDateString('vi-VN')}</Text>
                </View>
              </View>

              {/* 4 Thẻ KPI */}
              <View style={styles.bmbKpiRow}>
                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Chờ duyệt AI")}</Text>
                  <Text style={[styles.bmbKpiNumber, { color: '#EA580C' }]}>
                    {String(bmbPendingCount).padStart(2, '0')}
                  </Text>
                </View>

                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Đã phân công")}</Text>
                  <Text style={[styles.bmbKpiNumber, { color: '#2563EB' }]}>
                    {String(bmbAssignedCount).padStart(2, '0')}
                  </Text>
                </View>

                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Đang xử lý")}</Text>
                  <Text style={[styles.bmbKpiNumber, { color: '#4F46E5' }]}>
                    {String(bmbInProgressCount).padStart(2, '0')}
                  </Text>
                </View>

                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Hoàn thành/Đóng")}</Text>
                  <Text style={[styles.bmbKpiNumber, { color: '#16A34A' }]}>
                    {bmbCompletedCount + bmbClosedCount}
                  </Text>
                </View>
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
                            isSelected && { color: '#2563EB', fontWeight: '800' },
                          ]}
                        >
                          {t.ticketCode}
                        </Text>
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
                      {isFallbackWarning && isPending ? (
                        <View style={styles.bmbAiTimeoutTag}>
                          <Text style={styles.bmbAiTimeoutText}>
                            {translate("Cần phân loại thủ công")}</Text>
                        </View>
                      ) : (
                        <View style={styles.bmbAiPurpleMiniTag}>
                          <Text style={styles.bmbAiPurpleMiniText}>
                            {translate("Gemini:")}{' '}
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
                      {formatDateTime(bmbSelectedTicket.createdAt)}</Text>
                  </View>

                  <Text style={styles.bmbSmallSectionHead}>
                    {translate("THÔNG TIN CƯ DÂN PHẢN ÁNH")}</Text>
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

                  {Array.isArray(bmbSelectedTicket.photos) && bmbSelectedTicket.photos.length > 0 && (
                    <View style={[styles.rowCenter, { marginVertical: 10, gap: 8 }]}>
                      {bmbSelectedTicket.photos.map((photoUrl: string, pIdx: number) => (
                        <Image
                          key={pIdx}
                          source={{ uri: photoUrl }}
                          style={styles.bmbAttachmentThumb}
                          resizeMode="cover"
                        />
                      ))}
                      <Text style={{ fontSize: 12, color: '#64748B' }}>
                        {bmbSelectedTicket.photos.length} {translate('ảnh đính kèm')}
                      </Text>
                    </View>
                  )}

                  {/* HỘP GỢI Ý TỪ GEMINI FLASH AI */}
                  <View style={styles.bmbGeminiPurpleCard}>
                    <View style={styles.cardTopRow}>
                      <Text style={styles.bmbGeminiCardTitle}>
                        {translate("Gợi ý phân loại từ Gemini")}
                      </Text>
                      <View style={styles.bmbLatencyGreenPill}>
                        <Text style={styles.bmbLatencyGreenText}>
                          {translate("Tự động")}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.bmbAiSummaryBullet}>
                      {translate("Tóm tắt: ")}{bmbSelectedTicket.aiSummary || bmbSelectedTicket.title}
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
                            {selTech?.fullName || 'Đặng Văn Nam'}{' '}
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

                        <TouchableOpacity
                          style={[
                            styles.bmbWebLoginBtn,
                            (loading || !bmbSelectedTicket || !bmbTechId || !isSelTechEligible) && { opacity: 0.6 },
                            !isSelTechEligible && { backgroundColor: '#94A3B8' },
                          ]}
                          onPress={() => handleBmbDispatch()}
                          disabled={loading || !bmbSelectedTicket || !bmbTechId || !isSelTechEligible}
                        >
                          <Text style={styles.bmbWebLoginBtnText}>
                            {translate("Xác nhận & Giao việc")}
                          </Text>
                        </TouchableOpacity>
                      </>
                    );
                  })()}
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
                  {translate("Giao việc cho:")}{' '}
                  {bmbAssignTargetTech?.fullName || 'Đặng Văn Nam'}
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
          <View style={styles.bmbContentTwoCols}>
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

              {/* Danh sách thẻ căn hộ */}
              <View style={[styles.chipWrapRow, { marginVertical: 12 }]}>
                {apartments.map((apt) => {
                  const isSel = selectedApartment?.apartmentCode === apt.apartmentCode;
                  return (
                    <TouchableOpacity
                      key={apt.apartmentCode}
                      style={[
                        styles.bmbRadioTicketBox,
                        isSel && styles.bmbRadioTicketBoxSelected,
                        { minWidth: 200, flex: 1, margin: 4 }
                      ]}
                      onPress={() => handleSelectApartment(apt)}
                    >
                      <View style={styles.cardTopRow}>
                        <Text style={{ fontWeight: '800', fontSize: 15, color: '#2563EB' }}>
                          Căn {apt.apartmentCode}
                        </Text>
                        <View style={[styles.statusPill, { backgroundColor: '#DCFCE7' }]}>
                          <Text style={[styles.statusPillText, { color: '#15803D', fontSize: 11 }]}>
                            {translate("Đang ở")}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.cardLocationText}>
                        {apt.buildingBlock} • Tầng {apt.floorNumber}
                      </Text>
                      <Text style={[styles.cardLocationText, { color: '#7C3AED', fontWeight: '700' }]}>
                        Mã QR Phòng: {apt.qrCode}
                      </Text>
                      <Text style={[styles.techInfoLine, { marginTop: 4 }]}>
                        Chủ hộ: {apt.representative?.fullName || 'Chưa gán'} ({apt.residents?.length || 0} người)
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

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
                    setResidentForm({
                      fullName: '',
                      phone: '',
                      email: '',
                      apartmentCode: selectedApartment?.apartmentCode || 'A-1204',
                      buildingBlock: 'Tòa S1',
                      floorNumber: 12,
                      password: '',
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
                .map((res) => (
                  <View key={res.id} style={[styles.bmbRadioTicketBox, { marginBottom: 8 }]}>
                    <View style={styles.cardTopRow}>
                      <Text style={{ fontWeight: '700', fontSize: 14, color: '#0F172A' }}>
                        {res.fullName} {res.isRepresentative && '⭐ (Chủ hộ)'}
                      </Text>
                      <View style={[styles.statusPill, res.isActive ? { backgroundColor: '#DCFCE7' } : { backgroundColor: '#FEE2E2' }]}>
                        <Text style={[styles.statusPillText, res.isActive ? { color: '#15803D' } : { color: '#B91C1C' }]}>
                          {res.isActive ? 'Hoạt động' : 'Đã khóa'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.cardLocationText}>
                      SĐT: {res.phone} • Căn: {res.apartmentCode || 'Chưa gán'}
                    </Text>

                    <View style={[styles.rowBetween, { marginTop: 8 }]}>
                      <TouchableOpacity
                        style={styles.technicianEditButton}
                        onPress={() => {
                          setSelectedResident(res);
                          setResidentForm({
                            fullName: res.fullName,
                            phone: res.phone,
                            email: res.email || '',
                            apartmentCode: res.apartmentCode || 'A-1204',
                            buildingBlock: res.buildingBlock || 'Tòa S1',
                            floorNumber: res.floorNumber || 12,
                            password: '',
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
                          style={[styles.technicianDeleteButton, { borderColor: '#64748B' }]}
                          onPress={() => handleResidentDeparture(res.id)}
                        >
                          <Text style={[styles.technicianDeleteButtonText, { color: '#64748B' }]}>
                            {translate('Rời phòng')}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
            </ScrollView>
          </View>
        )}

        {/* ==================================================================== */}
        {/* MÀN HÌNH 04B BMB: QUẢN LÝ CHẤM CÔNG KỸ THUẬT VIÊN (GPS & CAMERA)      */}
        {/* ==================================================================== */}
        {bmbNavTab === 'ATTENDANCE' && (
          <View style={styles.bmbContentTwoCols}>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {/* Tiêu đề & Nút làm mới */}
              <View style={styles.cardTopRow}>
                <View>
                  <Text style={styles.bmbPageTitle}>{translate("Quản lý Chấm công Kỹ thuật viên")}</Text>
                  <Text style={styles.bmbPageSubtitle}>
                    {translate("Giám sát GPS, ảnh camera nhận diện ca trực, xét duyệt ngoại lệ & tính lương minh bạch (50.000 VNĐ/giờ)")}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.primaryActionBtn, { backgroundColor: '#2563EB', paddingVertical: 8, paddingHorizontal: 16 }]}
                  onPress={() => fetchBmbAttendance()}
                >
                  <Text style={styles.primaryActionBtnText}>🔄 {translate("Làm mới dữ liệu")}</Text>
                </TouchableOpacity>
              </View>

              {/* Hàng KPI Thống kê Chấm công */}
              <View style={styles.bmbKpiRow}>
                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Tổng lượt chấm công")}</Text>
                  <Text style={[styles.bmbKpiNumber, { color: '#0F172A' }]}>{bmbAttendanceStats.totalLogs}</Text>
                </View>
                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Hợp lệ / Đã duyệt")}</Text>
                  <Text style={[styles.bmbKpiNumber, { color: '#16A34A' }]}>{bmbAttendanceStats.verifiedCount}</Text>
                </View>
                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Đi muộn / Về sớm")}</Text>
                  <Text style={[styles.bmbKpiNumber, { color: '#D97706' }]}>{bmbAttendanceStats.lateCount}</Text>
                </View>
                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Chờ BMB xem xét")}</Text>
                  <Text style={[styles.bmbKpiNumber, { color: bmbAttendanceStats.pendingReviewCount > 0 ? '#DC2626' : '#64748B' }]}>
                    {bmbAttendanceStats.pendingReviewCount}
                  </Text>
                </View>
                <View style={styles.bmbKpiCard}>
                  <Text style={styles.bmbKpiLabel}>{translate("Tổng giờ tính lương")}</Text>
                  <Text style={[styles.bmbKpiNumber, { color: '#2563EB' }]}>{bmbAttendanceStats.totalBillableHours}h</Text>
                </View>
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

              {/* THANH BỘ LỌC ĐA NĂNG (Ngày, Tháng, KTV, Tòa nhà, Trạng thái) */}
              <View style={[styles.whiteSectionCard, { marginBottom: 14, padding: 14 }]}>
                <Text style={[styles.cardBlockTitle, { fontSize: 14, marginBottom: 8 }]}>🔍 {translate("Bộ lọc tra cứu chấm công")}</Text>

                {/* Dòng 1: Lọc Ngày, Tháng, Tòa nhà */}
                <View style={{ flexDirection: Platform.OS === 'web' ? 'row' : 'column', gap: 10, marginBottom: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fieldLabel, { fontSize: 11.5, marginBottom: 3 }]}>{translate("Lọc theo ngày (YYYY-MM-DD):")}</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TextInput
                        style={[styles.bmbWebInput, { flex: 1, paddingVertical: 6, fontSize: 12.5 }]}
                        value={bmbAttendanceFilterDate}
                        onChangeText={(val) => {
                          setBmbAttendanceFilterDate(val);
                          void fetchBmbAttendance({ date: val });
                        }}
                        placeholder="VD: 2026-11-08"
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
                    <Text style={[styles.fieldLabel, { fontSize: 11.5, marginBottom: 3 }]}>{translate("Lọc theo tháng (YYYY-MM):")}</Text>
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

                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fieldLabel, { fontSize: 11.5, marginBottom: 3 }]}>{translate("Tòa nhà:")}</Text>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {['ALL', 'Tòa S1', 'Tòa S2', 'Tòa S3'].map((b) => (
                        <TouchableOpacity
                          key={b}
                          style={[
                            styles.bmbFilterChip,
                            bmbAttendanceFilterBuilding === b && styles.bmbFilterChipActive,
                            { paddingHorizontal: 8, paddingVertical: 5, marginBottom: 0 }
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
                            {b === 'ALL' ? translate('Tất cả') : b}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
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
                  <Text style={[styles.fieldLabel, { fontSize: 11.5, marginBottom: 3 }]}>{translate("Trạng thái xác minh & Đi muộn:")}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                    {[
                      { key: 'ALL', label: 'Tất cả trạng thái' },
                      { key: 'VERIFIED', label: '✓ Hợp lệ / Đã duyệt' },
                      { key: 'PENDING_REVIEW', label: '⏳ Chờ BMB xem xét' },
                      { key: 'LATE', label: '⚠️ Đi muộn / Về sớm' },
                      { key: 'EXCEPTION', label: '🚨 Có ngoại lệ GPS / Ảnh' },
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
              </View>

              {/* THÔNG TIN VÀ XÁC NHẬN TỌA ĐỘ TÒA NHÀ BMB */}
              <View style={[styles.whiteSectionCard, { borderLeftWidth: 4, borderLeftColor: bmbBuildingLocation?.isConfirmed ? '#16A34A' : '#F59E0B' }]}>
                <View style={styles.cardTopRow}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={[styles.cardBlockTitle, { marginBottom: 0 }]}>
                        🏢 {bmbBuildingLocation?.buildingName || 'Tòa nhà ResiFix SkyView'}
                      </Text>
                      <View style={[
                        styles.statusPill,
                        bmbBuildingLocation?.isConfirmed ? { backgroundColor: '#DCFCE7' } : { backgroundColor: '#FEF3C7' }
                      ]}>
                        <Text style={[
                          styles.statusPillText,
                          bmbBuildingLocation?.isConfirmed ? { color: '#15803D' } : { color: '#B45309' }
                        ]}>
                          {bmbBuildingLocation?.isConfirmed ? '✓ Đã xác nhận chuẩn' : '⚠️ Chưa xác nhận tọa độ'}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                      📍 {bmbBuildingLocation?.buildingAddress || '123 Đường Nguyễn Hữu Thọ, Q7, TP.HCM'} • GPS: ({bmbBuildingLocation?.latitude ?? 10.7324}, {bmbBuildingLocation?.longitude ?? 106.6992}) • Bán kính: {bmbBuildingLocation?.allowedRadiusMeters ?? 300}m
                    </Text>
                    {bmbBuildingLocation?.isConfirmed ? (
                      <Text style={{ fontSize: 11, color: '#16A34A', marginTop: 3 }}>
                        ✓ Người xác nhận: {bmbBuildingLocation?.confirmedByName || 'BMB Quản lý'} ({formatDateTime(bmbBuildingLocation?.confirmedAt)})
                      </Text>
                    ) : (
                      <Text style={{ fontSize: 11, color: '#D97706', marginTop: 3, fontWeight: '600' }}>
                        ⚠️ Tọa độ chưa được BMB xác nhận thực địa. Tất cả ca chấm công sẽ tạm gắn cờ CHỜ XÁC MINH để chống gian lận.
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.primaryActionBtn,
                      { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: bmbBuildingLocation?.isConfirmed ? '#0284C7' : '#EA580C', alignSelf: 'center' }
                    ]}
                    onPress={() => {
                      if (bmbBuildingLocation) {
                        setBmbBuildingForm({
                          buildingName: bmbBuildingLocation.buildingName || '',
                          buildingAddress: bmbBuildingLocation.buildingAddress || '',
                          latitude: String(bmbBuildingLocation.latitude ?? 10.7324),
                          longitude: String(bmbBuildingLocation.longitude ?? 106.6992),
                          allowedRadiusMeters: String(bmbBuildingLocation.allowedRadiusMeters ?? 300),
                          note: '',
                        });
                      }
                      setBmbBuildingModalVisible(true);
                    }}
                  >
                    <Text style={styles.primaryActionBtnText}>
                      {bmbBuildingLocation?.isConfirmed ? '⚙️ Chỉnh sửa tọa độ' : '⚠️ Xác nhận tọa độ BMB'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* DANH SÁCH CHI TIẾT CÁC CA CHẤM CÔNG */}
              <View style={styles.whiteSectionCard}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardBlockTitle}>
                    {translate("Danh sách ca chấm công")} ({bmbAttendanceLogs.length} {translate("bản ghi")})
                  </Text>
                  <Text style={[styles.cardLocationText, { fontSize: 12 }]}>
                    * {bmbBuildingLocation?.buildingName || 'Tòa nhà ResiFix'} ({bmbBuildingLocation?.latitude ?? 10.7324}, {bmbBuildingLocation?.longitude ?? 106.6992}) • Bán kính hợp lệ: ≤ {bmbBuildingLocation?.allowedRadiusMeters ?? 300}m
                  </Text>
                </View>

                {bmbAttendanceLogs.length === 0 ? (
                  <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                    <Text style={{ fontSize: 14, color: '#64748B' }}>{translate("Không tìm thấy dữ liệu chấm công phù hợp bộ lọc.")}</Text>
                  </View>
                ) : (
                  bmbAttendanceLogs.map((log: any) => {
                    const punctuality = log.punctualityStatus || 'ON_TIME';
                    const verification = log.verificationStatus || 'VERIFIED';
                    const hasAnom = Boolean(log.anomalyNotes);
                    return (
                      <View
                        key={log.id}
                        style={[
                          styles.notiBlueItem,
                          {
                            padding: 14,
                            marginBottom: 12,
                            borderColor: hasAnom || verification === 'PENDING_REVIEW' ? '#F59E0B' : '#E2E8F0',
                            borderWidth: 1,
                            backgroundColor: verification === 'PENDING_REVIEW' ? '#FFFDF7' : '#FFFFFF',
                          }
                        ]}
                      >
                        {/* Hàng 1: Thông tin KTV, Ca trực & Badges */}
                        <View style={styles.cardTopRow}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ fontSize: 16 }}>👷</Text>
                            </View>
                            <View>
                              <Text style={{ fontWeight: '800', fontSize: 15, color: '#0F172A' }}>
                                {log.techName}
                              </Text>
                              <Text style={styles.cardLocationText}>
                                📞 {log.techPhone || '0901234567'} • 🏢 {log.buildingBlock || 'Tòa S1'} • 📅 {log.date}
                              </Text>
                            </View>
                          </View>

                          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                            {/* Badge Xác minh */}
                            <View style={[
                              styles.statusPill,
                              verification === 'VERIFIED' ? { backgroundColor: '#DCFCE7' } :
                              verification === 'APPROVED' ? { backgroundColor: '#DBEAFE' } :
                              verification === 'NEEDS_EXPLANATION' ? { backgroundColor: '#F3E8FF' } :
                              verification === 'REJECTED' ? { backgroundColor: '#FEE2E2' } : { backgroundColor: '#FEF3C7' }
                            ]}>
                              <Text style={[
                                styles.statusPillText,
                                verification === 'VERIFIED' ? { color: '#15803D' } :
                                verification === 'APPROVED' ? { color: '#1D4ED8' } :
                                verification === 'NEEDS_EXPLANATION' ? { color: '#7E22CE' } :
                                verification === 'REJECTED' ? { color: '#B91C1C' } : { color: '#B45309' }
                              ]}>
                                {verification === 'VERIFIED' ? '✓ Tự động hợp lệ' :
                                 verification === 'APPROVED' ? '✓ BMB đã duyệt' :
                                 verification === 'NEEDS_EXPLANATION' ? '💬 Yêu cầu giải trình' :
                                 verification === 'REJECTED' ? '✕ Bị từ chối' : '⏳ Chờ BMB duyệt'}
                              </Text>
                            </View>

                            {/* Badge Đúng giờ / Muộn */}
                            <View style={[
                              styles.statusPill,
                              punctuality === 'ON_TIME' ? { backgroundColor: '#F0FDF4' } :
                              punctuality === 'ON_TRACK' ? { backgroundColor: '#EFF6FF' } : { backgroundColor: '#FFEDD5' }
                            ]}>
                              <Text style={[
                                styles.statusPillText,
                                punctuality === 'ON_TIME' ? { color: '#16A34A' } :
                                punctuality === 'ON_TRACK' ? { color: '#2563EB' } : { color: '#C2410C' }
                              ]}>
                                {punctuality === 'ON_TIME' ? '🟢 Đúng giờ' :
                                 punctuality === 'LATE' ? `⚠️ Đi muộn ${log.lateMinutes || 0}p` :
                                 punctuality === 'EARLY_LEAVE' ? `⚠️ Về sớm ${log.earlyMinutes || 0}p` :
                                 punctuality === 'LATE_AND_EARLY' ? `⚠️ Muộn ${log.lateMinutes || 0}p & Về sớm ${log.earlyMinutes || 0}p` :
                                 '🔵 Đang trực'}
                              </Text>
                            </View>
                          </View>
                        </View>

                        {/* Ca trực phân công */}
                        <View style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 8, marginVertical: 8 }}>
                          <Text style={{ fontSize: 12, color: '#475569' }}>
                            🕒 <Text style={{ fontWeight: '700' }}>{translate("Lịch phân công:")}</Text> {log.shiftScheduled || '07:00 - 15:00'} (Ca làm việc chính thức)
                          </Text>
                        </View>

                        {/* Hàng 2: Chi tiết Check-in & Check-out (2 cột) */}
                        <View style={{ flexDirection: Platform.OS === 'web' ? 'row' : 'column', gap: 12, marginVertical: 6 }}>
                          {/* Cột Check-in */}
                          <View style={{ flex: 1, backgroundColor: '#FAFAFA', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#F1F5F9' }}>
                            <View style={styles.cardTopRow}>
                              <Text style={{ fontWeight: '700', fontSize: 13, color: '#16A34A' }}>🟢 CHECK-IN</Text>
                              <Text style={{ fontSize: 11, color: '#64748B' }}>{formatDateTime(log.checkIn)}</Text>
                            </View>

                            {/* GPS Snapshot */}
                            {log.checkInGps ? (
                              <View style={{ marginTop: 6 }}>
                                <Text style={{ fontSize: 12, color: '#334155' }}>
                                  📍 Khoảng cách: <Text style={{ fontWeight: '700' }}>~{log.checkInGps.distanceMeters}m</Text> (Độ chính xác: ±{log.checkInGps.accuracy}m)
                                </Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                  <View style={[
                                    styles.statusPill,
                                    log.checkInGps.isWithinAllowedRadius ? { backgroundColor: '#DCFCE7' } : { backgroundColor: '#FEE2E2' }
                                  ]}>
                                    <Text style={[
                                      styles.statusPillText,
                                      log.checkInGps.isWithinAllowedRadius ? { color: '#15803D' } : { color: '#B91C1C' }
                                    ]}>
                                      {log.checkInGps.isWithinAllowedRadius ? '✓ Trong bán kính 300m' : '⚠️ Vượt bán kính cho phép'}
                                    </Text>
                                  </View>
                                  {log.checkInMapUrl && (
                                    <TouchableOpacity onPress={() => Linking.openURL(log.checkInMapUrl)}>
                                      <Text style={{ fontSize: 11.5, color: '#2563EB', fontWeight: '700' }}>🗺️ Bản đồ</Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              </View>
                            ) : (
                              <Text style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 4 }}>📍 Không có dữ liệu GPS</Text>
                            )}

                            {/* Ảnh Check-in */}
                            {log.checkInPhotoUrl ? (
                              <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <TouchableOpacity
                                  onPress={() => setViewingPhotoModal({
                                    url: log.checkInPhotoUrl,
                                    title: `Ảnh Check-in - ${log.techName}`,
                                    meta: { time: log.checkIn, gps: log.checkInGps, techName: log.techName, date: log.date }
                                  })}
                                >
                                  <Image
                                    source={{ uri: log.checkInPhotoUrl }}
                                    style={{ width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1' }}
                                  />
                                </TouchableOpacity>
                                <View>
                                  <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#0F172A' }}>📷 Ảnh Check-in</Text>
                                  <Text style={{ fontSize: 10.5, color: '#64748B' }}>Có gắn timestamp server</Text>
                                </View>
                              </View>
                            ) : null}
                          </View>

                          {/* Cột Check-out */}
                          <View style={{ flex: 1, backgroundColor: '#FAFAFA', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#F1F5F9' }}>
                            <View style={styles.cardTopRow}>
                              <Text style={{ fontWeight: '700', fontSize: 13, color: log.checkOut ? '#DC2626' : '#64748B' }}>
                                🔴 CHECK-OUT
                              </Text>
                              <Text style={{ fontSize: 11, color: '#64748B' }}>
                                {log.checkOut ? formatDateTime(log.checkOut) : 'Chưa check-out'}
                              </Text>
                            </View>

                            {/* GPS Snapshot */}
                            {log.checkOutGps ? (
                              <View style={{ marginTop: 6 }}>
                                <Text style={{ fontSize: 12, color: '#334155' }}>
                                  📍 Khoảng cách: <Text style={{ fontWeight: '700' }}>~{log.checkOutGps.distanceMeters}m</Text> (Độ chính xác: ±{log.checkOutGps.accuracy}m)
                                </Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                  <View style={[
                                    styles.statusPill,
                                    log.checkOutGps.isWithinAllowedRadius ? { backgroundColor: '#DCFCE7' } : { backgroundColor: '#FEE2E2' }
                                  ]}>
                                    <Text style={[
                                      styles.statusPillText,
                                      log.checkOutGps.isWithinAllowedRadius ? { color: '#15803D' } : { color: '#B91C1C' }
                                    ]}>
                                      {log.checkOutGps.isWithinAllowedRadius ? '✓ Trong bán kính 300m' : '⚠️ Vượt bán kính cho phép'}
                                    </Text>
                                  </View>
                                  {log.checkOutMapUrl && (
                                    <TouchableOpacity onPress={() => Linking.openURL(log.checkOutMapUrl)}>
                                      <Text style={{ fontSize: 11.5, color: '#2563EB', fontWeight: '700' }}>🗺️ Bản đồ</Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              </View>
                            ) : (
                              <Text style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 4 }}>
                                {log.checkOut ? '📍 Không có dữ liệu GPS' : '⏳ KTV đang trong ca trực'}
                              </Text>
                            )}

                            {/* Ảnh Check-out */}
                            {log.checkOutPhotoUrl ? (
                              <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <TouchableOpacity
                                  onPress={() => setViewingPhotoModal({
                                    url: log.checkOutPhotoUrl,
                                    title: `Ảnh Check-out - ${log.techName}`,
                                    meta: { time: log.checkOut, gps: log.checkOutGps, techName: log.techName, date: log.date }
                                  })}
                                >
                                  <Image
                                    source={{ uri: log.checkOutPhotoUrl }}
                                    style={{ width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1' }}
                                  />
                                </TouchableOpacity>
                                <View>
                                  <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#0F172A' }}>📷 Ảnh Check-out</Text>
                                  <Text style={{ fontSize: 10.5, color: '#64748B' }}>Có gắn timestamp server</Text>
                                </View>
                              </View>
                            ) : null}
                          </View>
                        </View>

                        {/* Hàng 3: Bóc tách giờ làm & Tiền lương chuẩn 50.000 VNĐ/giờ */}
                        <View style={{ backgroundColor: '#F0F9FF', borderRadius: 8, padding: 10, marginVertical: 6, borderWidth: 1, borderColor: '#BAE6FD' }}>
                          <View style={styles.cardTopRow}>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#0369A1' }}>
                              ⏱️ Giờ công: {log.workHours || 0}h thực tế • {log.billableHours ?? log.workHours ?? 0}h tính lương
                              {log.nightHours ? ` (Trong đó: ${log.nightHours}h ca đêm 22h-6h)` : ''}
                            </Text>
                            <Text style={{ fontSize: 14, fontWeight: '800', color: '#0284C7' }}>
                              Ước tính: {Number(((log.regularHours ?? (log.billableHours ?? log.workHours ?? 0)) * 50000) + ((log.nightHours || 0) * 50000 * 1.3)).toLocaleString('vi-VN')} đ
                            </Text>
                          </View>
                          <Text style={{ fontSize: 11, color: '#0284C7', marginTop: 2 }}>
                            * Đơn giá: 50.000 VNĐ/giờ tiêu chuẩn • Ca đêm (22:00 - 06:00) phụ trội +30% (65.000 VNĐ/giờ).
                          </Text>
                        </View>

                        {/* Ngoại lệ / Bất thường phát hiện tự động */}
                        {log.anomalyNotes && (
                          <View style={{ backgroundColor: '#FFFBEB', borderRadius: 8, padding: 8, marginVertical: 4, borderWidth: 1, borderColor: '#FDE68A' }}>
                            <Text style={{ fontSize: 12, color: '#B45309', fontWeight: '700' }}>
                              ⚠️ Ghi chú ngoại lệ: {log.anomalyNotes}
                            </Text>
                          </View>
                        )}

                        {/* Giải trình từ Kỹ thuật viên */}
                        {log.explanationText && (
                          <View style={{ backgroundColor: '#F5F3FF', borderRadius: 8, padding: 8, marginVertical: 4, borderWidth: 1, borderColor: '#DDD6FE' }}>
                            <Text style={{ fontSize: 12, color: '#6D28D9', fontWeight: '700' }}>
                              💬 Giải trình từ KTV: <Text style={{ fontWeight: '400', fontStyle: 'italic' }}>"{log.explanationText}"</Text>
                            </Text>
                          </View>
                        )}

                        {/* Ghi chú duyệt của BMB */}
                        {log.reviewNote && (
                          <View style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 8, marginVertical: 4 }}>
                            <Text style={{ fontSize: 12, color: '#334155' }}>
                              📝 <Text style={{ fontWeight: '700' }}>Quyết định BMB ({log.reviewedBy || 'BMB'}):</Text> "{log.reviewNote}" ({formatDateTime(log.reviewedAt)})
                            </Text>
                          </View>
                        )}

                        {/* Lịch sử xác minh & chỉnh sửa (Audit Trail) */}
                        {Array.isArray(log.auditLogs) && log.auditLogs.length > 0 && (
                          <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#F1F5F9' }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748B', marginBottom: 4 }}>
                              📜 Lịch sử xác minh & Audit log:
                            </Text>
                            {log.auditLogs.map((al: any, aIdx: number) => (
                              <Text key={aIdx} style={{ fontSize: 11, color: '#64748B', marginLeft: 6 }}>
                                • [{formatDateTime(al.timestamp)}] <Text style={{ fontWeight: '600' }}>{al.actorName}</Text> ({al.action}): {al.note}
                              </Text>
                            ))}
                          </View>
                        )}

                        {/* Hàng nút bấm Hành động dành cho BMB */}
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <TouchableOpacity
                            style={[styles.primaryActionBtn, { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#16A34A' }]}
                            onPress={() => {
                              setSelectedAttendanceForReview(log);
                              setBmbReviewAction('APPROVE');
                              setBmbAdjustedHours(String(log.workHours || 8));
                              setBmbReviewNote('Đã kiểm tra minh chứng, hợp lệ tính công.');
                              setShowAttendanceReviewModal(true);
                            }}
                          >
                            <Text style={[styles.primaryActionBtnText, { fontSize: 12 }]}>✓ {translate("Phê duyệt tính lương")}</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.primaryActionBtn, { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#8B5CF6' }]}
                            onPress={() => {
                              setSelectedAttendanceForReview(log);
                              setBmbReviewAction('REQUEST_EXPLANATION');
                              setBmbAdjustedHours('');
                              setBmbReviewNote('Yêu cầu giải trình rõ lý do chênh lệch vị trí GPS / đi muộn.');
                              setShowAttendanceReviewModal(true);
                            }}
                          >
                            <Text style={[styles.primaryActionBtnText, { fontSize: 12 }]}>💬 {translate("Yêu cầu giải trình")}</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.primaryActionBtn, { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#DC2626' }]}
                            onPress={() => {
                              setSelectedAttendanceForReview(log);
                              setBmbReviewAction('REJECT');
                              setBmbAdjustedHours('0');
                              setBmbReviewNote('Chấm công không hợp lệ hoặc không có mặt tại tòa nhà.');
                              setShowAttendanceReviewModal(true);
                            }}
                          >
                            <Text style={[styles.primaryActionBtnText, { fontSize: 12 }]}>✕ {translate("Từ chối tính công")}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </ScrollView>
          </View>
        )}

        {/* ==================================================================== */}
        {/* MÀN HÌNH 05 BMB: CHẤM CÔNG & TÍNH LƯƠNG KỸ THUẬT VIÊN                 */}
        {/* ==================================================================== */}
        {bmbNavTab === 'PAYROLL' && (
          <View style={styles.bmbContentTwoCols}>
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

              {/* Sub-tab 1: Bảng lương tổng hợp */}
              <ScreenTransition transitionKey={bmbPayrollTab} style={{ flex: 1 }}>
              {bmbPayrollTab === 'SUMMARY' && (
                <View style={styles.whiteSectionCard}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardBlockTitle}>
                      {translate("Bảng lương tháng")} {bmbPayrollSummary?.month || new Date().toISOString().slice(0, 7)}
                    </Text>
                    <Text style={{ fontWeight: '800', fontSize: 16, color: '#2563EB' }}>
                      Tổng: {Number(bmbPayrollSummary?.totalPayout || 0).toLocaleString('vi-VN')} đ
                    </Text>
                  </View>

                  {(bmbPayrollSummary?.payrolls || []).map((p: any) => (
                    <View key={p.techId} style={[styles.notiBlueItem, { paddingVertical: 12, marginBottom: 8 }]}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.cardTopRow}>
                          <Text style={{ fontWeight: '700', fontSize: 14.5, color: '#0F172A' }}>
                            {p.fullName} ({p.specialtyLabel || 'Điện - Nước'})
                          </Text>
                          <Text style={{ fontWeight: '800', fontSize: 15, color: '#16A34A' }}>
                            {Number(p.totalSalary).toLocaleString('vi-VN')} đ
                          </Text>
                        </View>
                        <Text style={styles.cardLocationText}>
                          Lương CB: {Number(p.baseSalary).toLocaleString('vi-VN')} đ • OT: {p.otHours}h (+{Number(p.otPay).toLocaleString('vi-VN')} đ) • Phụ cấp: +{Number(p.allowance).toLocaleString('vi-VN')} đ
                        </Text>
                      </View>
                    </View>
                  ))}
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
                  {translate(technicianDialogMode === 'edit' ? 'Sửa kỹ thuật viên' : 'Thêm kỹ thuật viên')}
                </Text>
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
                <Text style={styles.fieldLabel}>{translate('Mật khẩu mới (tối thiểu 12 ký tự) *')}</Text>
                <TextInput
                  style={styles.technicianFormInput}
                  value={newPasswordInput}
                  onChangeText={setNewPasswordInput}
                  secureTextEntry
                  placeholder="••••••••"
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
                  {translate(residentModalMode === 'edit' ? 'Sửa thông tin cư dân' : 'Thêm cư dân mới')}
                </Text>
                <ScrollView style={styles.technicianFormScroll} showsVerticalScrollIndicator={false}>
                  <Text style={styles.technicianFieldLabel}>{translate('Họ và tên *')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={residentForm.fullName}
                    onChangeText={(val) => setResidentForm((f) => ({ ...f, fullName: val }))}
                    placeholder="Nguyễn Văn A"
                    placeholderTextColor="#94A3B8"
                  />

                  <Text style={styles.technicianFieldLabel}>{translate('Số điện thoại *')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={residentForm.phone}
                    onChangeText={(val) => setResidentForm((f) => ({ ...f, phone: val.replace(/[^\d]/g, '').slice(0, 10) }))}
                    keyboardType="phone-pad"
                    maxLength={10}
                    placeholder="0905123456"
                    placeholderTextColor="#94A3B8"
                  />
<Text style={styles.technicianFieldLabel}>
  {translate('Email cư dân (để nhận OTP kích hoạt) *')}
</Text>
<TextInput
  style={styles.technicianFormInput}
  value={residentForm.email}
  onChangeText={(val) =>
    setResidentForm((f) => ({ ...f, email: val }))
  }
  keyboardType="email-address"
  autoCapitalize="none"
  placeholder="email@example.com"
/>

{residentModalMode === 'create' && (
  <>
    <Text style={styles.technicianFieldLabel}>
      {translate('Mật khẩu ban đầu (không bắt buộc)')}
    </Text>
    <TextInput
      style={styles.technicianFormInput}
      value={residentForm.password}
      onChangeText={(val) =>
        setResidentForm((f) => ({ ...f, password: val }))
      }
      secureTextEntry
      autoCapitalize="none"
      placeholder={translate('Để trống nếu cư dân tự tạo qua OTP, hoặc nhập tối thiểu 12 ký tự')}
      placeholderTextColor="#94A3B8"
    />
  </>
)}
                  <Text style={styles.technicianFieldLabel}>{translate('Mã căn hộ *')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={residentForm.apartmentCode}
                    onChangeText={(val) => setResidentForm((f) => ({ ...f, apartmentCode: val.toUpperCase() }))}
                    placeholder="A-1204"
                    placeholderTextColor="#94A3B8"
                  />

                  <Text style={styles.technicianFieldLabel}>{translate('Tòa / Khối *')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={residentForm.buildingBlock}
                    onChangeText={(val) => setResidentForm((f) => ({ ...f, buildingBlock: val }))}
                    placeholder="Tòa S1"
                    placeholderTextColor="#94A3B8"
                  />

                  <Text style={styles.technicianFieldLabel}>{translate('Tầng số *')}</Text>
                  <TextInput
                    style={styles.technicianFormInput}
                    value={String(residentForm.floorNumber)}
                    onChangeText={(val) => setResidentForm((f) => ({ ...f, floorNumber: Number(val) || 1 }))}
                    keyboardType="numeric"
                    placeholder="12"
                    placeholderTextColor="#94A3B8"
                  />

                  <TouchableOpacity
                    style={[styles.checkboxRow, { marginTop: 10 }]}
                    onPress={() => setResidentForm((f) => ({ ...f, isRepresentative: !f.isRepresentative }))}
                  >
                    <View style={[styles.checkbox, residentForm.isRepresentative && styles.checkboxChecked]}>
                      {residentForm.isRepresentative && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                    <Text style={styles.rememberText}>{translate('Người đại diện căn hộ (Chủ hộ)')}</Text>
                  </TouchableOpacity>
                </ScrollView>

                <View style={styles.technicianModalActions}>
                  <TouchableOpacity
                    style={styles.technicianCancelButton}
                    onPress={() => setResidentModalMode(null)}
                  >
                    <Text style={styles.technicianCancelButtonText}>{translate('Hủy')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { flex: 1, paddingVertical: 10 }]}
                    onPress={handleSaveResident}
                  >
                    <Text style={styles.primaryActionBtnText}>{translate('Lưu thông tin')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
      {renderAttendanceReviewModal()}
      {renderPhotoViewerModal()}
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
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
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
    height: 46,
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
    height: 42,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
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
    fontSize: 16,
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
  descBottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  charCountText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#059669',
  },
  voicePillBtn: {
    backgroundColor: '#FAF5FF',
    borderWidth: 1,
    borderColor: '#E9D5FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  voicePillText: {
    color: '#7E22CE',
    fontSize: 12,
    fontWeight: '700',
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
