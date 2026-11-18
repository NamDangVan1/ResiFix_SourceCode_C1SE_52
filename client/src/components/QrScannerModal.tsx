import React, { useState, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  UiActivityIndicator as ActivityIndicator,
  UiText as Text,
  UiTextInput as TextInput,
  UiTouchableOpacity as TouchableOpacity,
  UiView as View,
  useUiPreferences,
} from '../context/UiPreferences';
import { AnimatedModalContent } from './Transitions';

interface QrScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onScannedCode: (qrCode: string) => void;
  roleTitle?: string;
}

export default function QrScannerModal({
  visible,
  onClose,
  onScannedCode,
  roleTitle = 'Quét mã QR Thiết bị Tòa nhà (FR05)',
}: QrScannerModalProps) {
  const { t } = useUiPreferences();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [cameraKey, setCameraKey] = useState(1);
  const shouldRequestPermission = Boolean(
    permission && !permission.granted && permission.canAskAgain
  );

  // Tự động xin quyền và tạo độ trễ 250ms khi mở Modal để Android kịp khởi tạo SurfaceView
  useEffect(() => {
    if (!visible) return;

    setScanned(false);
    setManualCode('');
    setCameraReady(false);

    if (shouldRequestPermission) requestPermission();

    const timer = setTimeout(() => {
      setCameraReady(true);
      setCameraKey((prev) => prev + 1);
    }, 250);

    return () => clearTimeout(timer);
  }, [visible, shouldRequestPermission, requestPermission]);

  const handleRequestPermission = async () => {
    setCameraReady(false);
    const res = await requestPermission();
    if (res.granted) {
      setTimeout(() => {
        setCameraReady(true);
        setCameraKey((prev) => prev + 1);
      }, 300);
    }
  };

  const handleBarcodeScanned = ({ data }: { type: string; data: string }) => {
    if (scanned || !data) return;
    setScanned(true);

    let cleanCode = data.trim();
    try {
      if (cleanCode.startsWith('{')) {
        const parsed = JSON.parse(data);
        if (parsed.qrCode) cleanCode = String(parsed.qrCode);
      } else if (/^https?:\/\//i.test(cleanCode)) {
        const parsedUrl = new URL(cleanCode);
        cleanCode = parsedUrl.searchParams.get('data') ||
          parsedUrl.searchParams.get('qrCode') ||
          parsedUrl.pathname.split('/').filter(Boolean).pop() || cleanCode;
      }
    } catch {
      // Giữ nguyên chuỗi gốc
    }

    onScannedCode(cleanCode.trim().toUpperCase());
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <AnimatedModalContent visible={visible} style={styles.modalCard}>
          {/* Header Modal */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.headerTitle}>{t(roleTitle)}</Text>
              <Text style={styles.headerSub}>
                {t("Hướng camera vào tem QR dán trên thiết bị để tự động điền thông tin")}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Khung ngắm Camera thực tế đã fix lỗi màn hình đen trên Android */}
          <View style={styles.cameraContainer}>
            {!permission ? (
              <View style={styles.centerBox}>
                <ActivityIndicator color="#38BDF8" size="large" />
                <Text style={styles.permissionText}>{t("Đang kiểm tra quyền Camera...")}</Text>
              </View>
            ) : !permission.granted ? (
              <View style={styles.centerBox}>
                <Text style={styles.permissionText}>
                  {t("Ứng dụng cần quyền truy cập Camera để quét mã QR thiết bị (FR05).")}</Text>
                <TouchableOpacity
                  style={styles.grantBtn}
                  onPress={handleRequestPermission}
                >
                  <Text style={styles.grantBtnText}>{t("Cấp quyền Camera ngay")}</Text>
                </TouchableOpacity>
              </View>
            ) : !cameraReady ? (
              <View style={styles.centerBox}>
                <ActivityIndicator color="#38BDF8" size="large" />
                <Text style={styles.permissionText}>{t("Đang khởi động ống kính...")}</Text>
              </View>
            ) : (
              <View style={styles.cameraActiveWrapper}>
                <CameraView
                  key={`cam-${cameraKey}-${facing}`}
                  style={styles.cameraPreview}
                  facing={facing}
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr'],
                  }}
                  onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
                />

                {/* Lớp phủ khung ngắm dùng pointerEvents="none" để không chặn SurfaceView của Android */}
                <View pointerEvents="none" style={styles.viewfinderWrapper}>
                  <View style={styles.viewfinderBox}>
                    <View style={[styles.corner, styles.topLeft]} />
                    <View style={[styles.corner, styles.topRight]} />
                    <View style={[styles.corner, styles.bottomLeft]} />
                    <View style={[styles.corner, styles.bottomRight]} />
                  </View>
                  <Text style={styles.scanHintText}>
                    {t("Đặt mã QR thiết bị vào giữa khung ngắm")}</Text>
                </View>

                {/* Nút làm mới ống kính hoặc đổi Camera Trước/Sau nếu máy Android bị kẹt phần cứng */}
                <View style={styles.cameraControlBar}>
                  <TouchableOpacity
                    style={styles.camSmallBtn}
                    onPress={() => setCameraKey((prev) => prev + 1)}
                  >
                    <Text style={styles.camSmallBtnText}>{t("Làm mới")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.camSmallBtn}
                    onPress={() =>
                      setFacing((prev) => (prev === 'back' ? 'front' : 'back'))
                    }
                  >
                    <Text style={styles.camSmallBtnText}>{t("Đổi camera")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Ô nhập mã thủ công nếu tem QR bị mờ rách */}
          <Text style={styles.sectionLabel}>{t("Hoặc nhập mã thiết bị nếu tem QR bị mờ:")}</Text>
          <View style={styles.manualRow}>
            <TextInput
              style={styles.manualInput}
              placeholder={t("VD: WP-1204, AC-B02...")}
              placeholderTextColor="#94A3B8"
              value={manualCode}
              onChangeText={setManualCode}
              autoCapitalize="characters"
            />
            <TouchableOpacity
              style={styles.manualConfirmBtn}
              onPress={() => {
                if (manualCode.trim()) {
                  onScannedCode(manualCode.trim().toUpperCase());
                  onClose();
                }
              }}
            >
              <Text style={styles.manualConfirmText}>{t("Tra cứu")}</Text>
            </TouchableOpacity>
          </View>

        </AnimatedModalContent>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  headerSub: { fontSize: 12, color: '#64748B', marginTop: 2, lineHeight: 17 },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  cameraContainer: {
    width: '100%',
    height: 240,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    marginBottom: 14,
  },
  cameraActiveWrapper: {
    width: '100%',
    height: 240,
    position: 'relative',
  },
  cameraPreview: {
    width: '100%',
    height: 240,
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  permissionText: {
    color: '#E2E8F0',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
    lineHeight: 18,
  },
  grantBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
  },
  grantBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  viewfinderWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinderBox: {
    width: 150,
    height: 150,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#2563EB',
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 8,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 8,
  },
  scanHintText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  cameraControlBar: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 6,
  },
  camSmallBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  camSmallBtnText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  manualRow: {
    flexDirection: 'row',
    gap: 8,
  },
  manualInput: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 13.5,
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
  },
  manualConfirmBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 18,
    borderRadius: 10,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualConfirmText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13.5 },
});

