import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

interface QrScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onScannedCode: (qrCode: string) => void;
  roleTitle?: string;
}

const SAMPLE_QR_CODES = [
  { code: 'AC-B02', name: 'Máy lạnh sảnh B (Tầng 1)' },
  { code: 'WP-1204', name: 'Ống nước bồn rửa (Căn A-1204)' },
  { code: 'HL-B12', name: 'Đèn hành lang khu B (Tầng 12)' },
  { code: 'ELV-02', name: 'Thang máy khách số 02 (Sảnh B)' },
  { code: 'PK-B1-02', name: 'Đầu đọc thẻ từ (Hầm B1)' },
];

export default function QrScannerModal({
  visible,
  onClose,
  onScannedCode,
  roleTitle = 'Quét mã QR Thiết bị Tòa nhà (FR05)',
}: QrScannerModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [cameraKey, setCameraKey] = useState(1);

  // Tự động xin quyền và tạo độ trễ 250ms khi mở Modal để Android kịp khởi tạo SurfaceView
  useEffect(() => {
    let timer: any;
    if (visible) {
      setScanned(false);
      setManualCode('');
      setCameraReady(false);

      if (permission && !permission.granted && permission.canAskAgain) {
        requestPermission();
      }

      timer = setTimeout(() => {
        setCameraReady(true);
        setCameraKey((prev) => prev + 1);
      }, 250);
    } else {
      setCameraReady(false);
    }
    return () => clearTimeout(timer);
  }, [visible, permission?.granted]);

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

    let cleanCode = data.trim().toUpperCase();
    try {
      if (cleanCode.startsWith('{')) {
        const parsed = JSON.parse(data);
        if (parsed.qrCode) cleanCode = String(parsed.qrCode).toUpperCase();
      } else if (cleanCode.includes('/')) {
        const parts = cleanCode.split('/');
        cleanCode = parts[parts.length - 1];
      }
    } catch {
      // Giữ nguyên chuỗi gốc
    }

    onScannedCode(cleanCode);
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
        <View style={styles.modalCard}>
          {/* Header Modal */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.headerTitle}>📷 {roleTitle}</Text>
              <Text style={styles.headerSub}>
                Hướng camera vào tem QR dán trên thiết bị để tự động điền thông tin
              </Text>
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
                <Text style={styles.permissionText}>Đang kiểm tra quyền Camera...</Text>
              </View>
            ) : !permission.granted ? (
              <View style={styles.centerBox}>
                <Text style={{ fontSize: 34, marginBottom: 8 }}>🔒</Text>
                <Text style={styles.permissionText}>
                  Ứng dụng cần quyền truy cập Camera để quét mã QR thiết bị (FR05).
                </Text>
                <TouchableOpacity
                  style={styles.grantBtn}
                  onPress={handleRequestPermission}
                >
                  <Text style={styles.grantBtnText}>Cấp quyền Camera ngay</Text>
                </TouchableOpacity>
              </View>
            ) : !cameraReady ? (
              <View style={styles.centerBox}>
                <ActivityIndicator color="#38BDF8" size="large" />
                <Text style={styles.permissionText}>Đang khởi động ống kính...</Text>
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
                    Đặt mã QR thiết bị vào giữa khung ngắm
                  </Text>
                </View>

                {/* Nút làm mới ống kính hoặc đổi Camera Trước/Sau nếu máy Android bị kẹt phần cứng */}
                <View style={styles.cameraControlBar}>
                  <TouchableOpacity
                    style={styles.camSmallBtn}
                    onPress={() => setCameraKey((prev) => prev + 1)}
                  >
                    <Text style={styles.camSmallBtnText}>🔄 Làm mới Cam</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.camSmallBtn}
                    onPress={() =>
                      setFacing((prev) => (prev === 'back' ? 'front' : 'back'))
                    }
                  >
                    <Text style={styles.camSmallBtnText}>🔁 Đổi Cam</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Ô nhập mã thủ công nếu tem QR bị mờ rách */}
          <Text style={styles.sectionLabel}>Hoặc nhập mã thiết bị nếu tem QR bị mờ:</Text>
          <View style={styles.manualRow}>
            <TextInput
              style={styles.manualInput}
              placeholder="VD: WP-1204, AC-B02..."
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
              <Text style={styles.manualConfirmText}>Tra cứu</Text>
            </TouchableOpacity>
          </View>

          {/* Danh sách mã QR mẫu trong Database để bấm test nhanh khi thuyết trình */}
          <Text style={styles.sectionLabel}>
            ⚡ Chọn nhanh tem QR thiết bị mẫu (Dùng khi Demo):
          </Text>
          <View style={styles.quickChipsWrap}>
            {SAMPLE_QR_CODES.map((item) => (
              <TouchableOpacity
                key={item.code}
                style={styles.quickQrChip}
                onPress={() => {
                  onScannedCode(item.code);
                  onClose();
                }}
              >
                <Text style={styles.quickQrCode}>{item.code}</Text>
                <Text style={styles.quickQrName}>{item.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
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
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerTitle: { fontSize: 16.5, fontWeight: '800', color: '#0F172A' },
  headerSub: { fontSize: 12, color: '#64748B', marginTop: 2 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 15, fontWeight: '800', color: '#334155' },
  cameraContainer: {
    width: '100%',
    height: 260,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    marginBottom: 12,
  },
  cameraActiveWrapper: {
    width: '100%',
    height: 260,
    position: 'relative',
  },
  cameraPreview: {
    width: '100%',
    height: 260,
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
    marginTop: 10,
    marginBottom: 12,
    lineHeight: 19,
  },
  grantBtn: {
    backgroundColor: '#1D61E7',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  grantBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13.5 },
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
    width: 160,
    height: 160,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: '#38BDF8',
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 10 },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 10,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 10,
  },
  scanHintText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
    marginTop: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 4,
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
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  camSmallBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 2,
  },
  manualRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  manualInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13.5,
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
  },
  manualConfirmBtn: {
    backgroundColor: '#1D61E7',
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualConfirmText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  quickChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickQrChip: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  quickQrCode: { fontSize: 12, fontWeight: '800', color: '#1D4ED8' },
  quickQrName: { fontSize: 10.5, color: '#475569' },
});