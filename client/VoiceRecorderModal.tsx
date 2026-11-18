import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  StyleSheet,
  Platform,
} from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import {
  UiActivityIndicator as ActivityIndicator,
  UiText as Text,
  UiTouchableOpacity as TouchableOpacity,
  UiView as View,
  useUiPreferences,
} from './UiPreferences';

interface VoiceRecorderModalProps {
  visible: boolean;
  onClose: () => void;
  onTranscribed: (text: string) => void;
  apiBaseUrl: string;
  token?: string;
}

const DEMO_VOICE_SAMPLES = [
  {
    icon: '💡',
    title: 'Đèn chiếu sáng',
    text: 'Bóng đèn hành lang khu B tầng 12 bị chớp tắt liên tục, khu vực rất tối và nguy hiểm.',
  },
  {
    icon: '🚰',
    title: 'Đường ống nước',
    text: 'Đường ống nước bồn rửa bị nứt rò rỉ, nước chảy tràn nhiều ra sàn gây trơn trượt.',
  },
  {
    icon: '🛗',
    title: 'Thang máy',
    text: 'Thang máy khách số 2 phát ra tiếng kêu to bất thường và rung lắc khi di chuyển.',
  },
  {
    icon: '🚪',
    title: 'Cửa & Thẻ từ',
    text: 'Đầu đọc thẻ từ hầm gửi xe B1 bị chập chờn không nhận diện được thẻ của cư dân.',
  },
];

export default function VoiceRecorderModal({
  visible,
  onClose,
  onTranscribed,
  apiBaseUrl,
  token,
}: VoiceRecorderModalProps) {
  const { t } = useUiPreferences();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const timerRef = useRef<any>(null);
  const recognitionRef = useRef<any>(null);

  // Dọn dẹp tài nguyên khi unmount hoặc đóng modal
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  // Bắt đầu ghi âm
  const startRecording = async () => {
    try {
      setErrorMessage(null);
      setRecordingDuration(0);

      // Nếu đang chạy trên Web Browser, ưu tiên thử Web Speech API
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const SpeechRecognition =
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

        if (SpeechRecognition) {
          const recognizer = new SpeechRecognition();
          recognizer.lang = 'vi-VN';
          recognizer.continuous = false;
          recognizer.interimResults = false;

          recognizer.onstart = () => {
            setIsRecording(true);
            timerRef.current = setInterval(() => {
              setRecordingDuration((prev) => prev + 1);
            }, 1000);
          };

          recognizer.onresult = (event: any) => {
            const transcript = event.results?.[0]?.[0]?.transcript;
            if (transcript) {
              onTranscribed(transcript);
              onClose();
            }
          };

          recognizer.onerror = (e: any) => {
            console.warn('Web speech error:', e);
            setErrorMessage(t('Không thể nhận diện qua Web Speech. Vui lòng thử lại hoặc chọn câu mẫu bên dưới!'));
            stopRecording();
          };

          recognizer.onend = () => {
            setIsRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);
          };

          recognitionRef.current = recognizer;
          recognizer.start();
          return;
        }
      }

      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setErrorMessage(
          t('Ứng dụng cần quyền truy cập Microphone để ghi âm giọng nói. Vui lòng cấp quyền trong Cài đặt!')
        );
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Lỗi khởi động ghi âm:', err);
      setErrorMessage(t('Không thể khởi động Microphone. Kiểm tra lại thiết bị hoặc chọn câu nói mẫu!'));
      setIsRecording(false);
    }
  };

  // Dừng ghi âm và gửi lên Backend chuyển thành văn bản
  const stopRecording = async () => {
    if (timerRef.current) clearInterval(timerRef.current);

    // Xử lý dừng Web Speech nếu có
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      setIsRecording(false);
      return;
    }

    if (!recorder.isRecording) {
      setIsRecording(false);
      return;
    }

    try {
      setIsRecording(false);
      setIsTranscribing(true);

      await recorder.stop();
      const uri = recorder.uri;

      if (!uri) {
        throw new Error('Không lấy được file âm thanh');
      }

      // Đọc file âm thanh dưới dạng Base64
      const audioResponse = await fetch(uri);
      const audioBlob = await audioResponse.blob();
      const base64Audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = (reader.result as string) || '';
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });

      // Gửi sang Backend để Gemini AI chuyển thành văn bản tiếng Việt
      const res = await fetch(`${apiBaseUrl}/tickets/transcribe-voice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify({
          audioBase64: base64Audio,
          mimeType: audioBlob.type || (Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4'),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.text) {
          onTranscribed(data.text);
          onClose();
          return;
        }
      }

      throw new Error('Transcription unavailable');
    } catch (err: any) {
      console.error('Lỗi xử lý file ghi âm:', err);
      setErrorMessage(t('Lỗi khi chuyển đổi giọng nói. Vui lòng thử lại hoặc chọn câu mẫu!'));
    } finally {
      setIsTranscribing(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.headerTitle}>
                {t('🎤 Nhấn để nói (Voice-to-Text)')}
              </Text>
              <Text style={styles.headerSub}>
                {t('Nói tiếng Việt tự nhiên, AI sẽ tự động chép thành mô tả sự cố')}
              </Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Khung tương tác Ghi âm */}
          <View style={styles.recordBox}>
            {isTranscribing ? (
              <View style={styles.centerCol}>
                <ActivityIndicator size="large" color="#7E22CE" />
                <Text style={styles.statusText}>
                  {t('⏳ Đang dùng AI chuyển giọng nói sang văn bản...')}
                </Text>
              </View>
            ) : isRecording ? (
              <View style={styles.centerCol}>
                <View style={styles.pulsingMicCircle}>
                  <Text style={{ fontSize: 32 }}>🎙️</Text>
                </View>
                <Text style={styles.recordingTimer}>{formatTimer(recordingDuration)}</Text>
                <Text style={styles.recordingHint}>
                  {t('🔴 Đang lắng nghe... Hãy nói to và rõ ràng')}
                </Text>
                <TouchableOpacity
                  style={styles.stopBtn}
                  onPress={stopRecording}
                >
                  <Text style={styles.stopBtnText}>
                    {t('⏹️ Dừng & Hoàn tất')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.centerCol}>
                <TouchableOpacity
                  style={styles.startMicCircle}
                  onPress={startRecording}
                >
                  <Text style={{ fontSize: 36 }}>🎤</Text>
                </TouchableOpacity>
                <Text style={styles.tapToStartText}>
                  {t('Nhấn vào micro để bắt đầu nói')}
                </Text>
                <Text style={styles.tapToStartSub}>
                  {t('Hỗ trợ đầy đủ tiếng Việt có dấu, lọc tạp âm thông minh')}
                </Text>
              </View>
            )}

            {errorMessage && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}
          </View>

          {/* Danh sách câu mẫu demo nhanh */}
          <Text style={styles.sectionTitle}>
            {t('⚡ Câu nói mẫu (Dùng khi Demo không tiện nói):')}
          </Text>
          <View style={styles.presetsWrap}>
            {DEMO_VOICE_SAMPLES.map((sample, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.presetChip}
                onPress={() => {
                  onTranscribed(sample.text);
                  onClose();
                }}
              >
                <Text style={styles.presetIcon}>{sample.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.presetTitle}>{t(sample.title)}</Text>
                  <Text style={styles.presetText} numberOfLines={2}>
                    {sample.text}
                  </Text>
                </View>
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
  closeBtnText: { fontSize: 16, fontWeight: '700', color: '#64748B' },
  recordBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 180,
  },
  centerCol: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  startMicCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F3E8FF',
    borderWidth: 2,
    borderColor: '#A855F7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  tapToStartText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6B21A8',
    marginBottom: 4,
  },
  tapToStartSub: {
    fontSize: 11.5,
    color: '#94A3B8',
    textAlign: 'center',
  },
  pulsingMicCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FEE2E2',
    borderWidth: 2,
    borderColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  recordingTimer: {
    fontSize: 22,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 1,
    marginBottom: 4,
  },
  recordingHint: {
    fontSize: 12,
    color: '#B91C1C',
    fontWeight: '600',
    marginBottom: 14,
  },
  stopBtn: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  stopBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  statusText: {
    fontSize: 13,
    color: '#6B21A8',
    fontWeight: '600',
    marginTop: 12,
  },
  errorBox: {
    marginTop: 10,
    backgroundColor: '#FEF2F2',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    fontSize: 11.5,
    color: '#DC2626',
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#475569',
    marginTop: 14,
    marginBottom: 8,
  },
  presetsWrap: {
    gap: 6,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 8,
  },
  presetIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  presetTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  presetText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
});
