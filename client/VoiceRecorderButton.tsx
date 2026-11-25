import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { startVoiceCapture } from './src/voiceCapture';
import { UiText as Text, UiTouchableOpacity as Button, UiView as View, useUiPreferences } from './UiPreferences';

type Props = {
  apiBaseUrl: string;
  token: string | null;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onTranscribed: (text: string) => void;
};

type Capture = NonNullable<Awaited<ReturnType<typeof startVoiceCapture>>>;

const buttonLabels = {
  idle: '🎤 Nhấn để nói',
  starting: 'Đang mở micro…',
  recording: 'Đang ghi âm · Nhấn để dừng',
  processing: 'Đang xử lý…',
  error: '🎤 Nhấn để thử lại',
} as const;

export default function VoiceRecorderButton({ apiBaseUrl, token, disabled, onBusyChange, onTranscribed }: Props) {
  const { t } = useUiPreferences();
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'processing' | 'error'>('idle');
  const [error, setError] = useState('');
  const session = useRef<AbortController | null>(null);
  const capture = useRef<Capture | null>(null);

  const cancel = useCallback(() => {
    session.current?.abort();
    session.current = null;
    capture.current?.discard();
    capture.current = null;
    onBusyChange(false);
  }, [onBusyChange]);

  useEffect(() => cancel, [cancel]);

  function close() {
    cancel();
    setPhase('idle');
  }

  async function start() {
    if (session.current) return;
    const controller = new AbortController();
    session.current = controller;
    onBusyChange(true);
    setPhase('starting');
    try {
      const recording = await startVoiceCapture(controller.signal);
      if (controller.signal.aborted) {
        recording?.discard();
        return;
      }
      if (!recording) throw new Error('Không thể mở micro.');
      capture.current = recording;
      setPhase('recording');
    } catch (err) {
      if (controller.signal.aborted) return;
      cancel();
      setError(err instanceof Error ? err.message : 'Không thể mở micro.');
      setPhase('error');
    }
  }

  async function stop() {
    const recording = capture.current;
    const controller = session.current;
    if (!recording || !controller) return;
    capture.current = null;
    setPhase('processing');
    try {
      const audio = await recording.stop();
      if (controller.signal.aborted) return;
      const response = await fetch(`${apiBaseUrl}/tickets/transcribe-voice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
        },
        body: JSON.stringify(audio),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success || typeof data.text !== 'string' || !data.text.trim()) {
        const fallback = response.status === 413 ? 'Bản ghi quá lớn. Vui lòng ghi một đoạn ngắn hơn.'
          : 'Không nhận được bản phiên âm từ AI. Bạn có thể nhập mô tả thủ công vào ô bên dưới hoặc nhấn để thử lại.';
        throw new Error(typeof data?.message === 'string' ? data.message : fallback);
      }
      if (controller.signal.aborted) return;
      onTranscribed(data.text.trim());
      close();
    } catch (err) {
      if (controller.signal.aborted) return;
      cancel();
      const message = err instanceof Error ? err.message : 'Không nhận được bản phiên âm từ AI. Bạn có thể nhập mô tả thủ công vào ô bên dưới.';
      setError(err instanceof TypeError ? 'Không kết nối được backend. Vui lòng thử lại.' : message);
      setPhase('error');
    }
  }

  return (
    <View style={styles.controls}>
      <View style={styles.row}>
        <Button accessibilityRole="button" style={styles.button}
          disabled={disabled || phase === 'starting' || phase === 'processing'}
          onPress={phase === 'recording' ? stop : start}>
          <Text accessibilityLiveRegion="polite" style={styles.label}>{t(buttonLabels[phase])}</Text>
        </Button>
        {phase !== 'idle' && phase !== 'error' && (
          <Button accessibilityRole="button" style={styles.button} onPress={close}>
            <Text style={styles.label}>{t('Hủy')}</Text>
          </Button>
        )}
      </View>
      {phase === 'error' && <Text accessibilityLiveRegion="polite" style={styles.error}>{t(error)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { marginTop: 8, gap: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { color: '#B91C1C', fontSize: 13 },
  button: { backgroundColor: '#FAF5FF', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  label: { color: '#7E22CE', textAlign: 'center', fontWeight: '700' },
});
