import { Platform } from 'react-native';

/**
 * CẤU HÌNH ĐỊA CHỈ BACKEND CHUẨN CHO CẢ WEB & MOBILE
 */
const DEV_LAN_IP = '192.168.1.225'; // IPv4 máy tính Windows chạy Backend (port 5000)

export const getApiBaseUrl = (): string => {
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

export const API_BASE_URL = getApiBaseUrl();
export const AUTH_SESSION_STORAGE_KEY = 'resifix.auth.session';

