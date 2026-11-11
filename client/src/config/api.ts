import { Platform } from 'react-native';

/**
 * CẤU HÌNH ĐỊA CHỈ BACKEND CHUẨN CHO CẢ WEB & MOBILE
 */
export const getApiBaseUrl = (): string => {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      return `http://${window.location.hostname}:5000/api`;
    }
    return 'http://localhost:5000/api';
  }
  return 'https://silver-guests-wink.loca.lt/api'; // Trên điện thoại: Gọi qua LocalTunnel (hoặc ngrok) để truy cập cổng 5000 của máy tính
};

export const API_BASE_URL = getApiBaseUrl();
export const AUTH_SESSION_STORAGE_KEY = 'resifix.auth.session';

