import { AudioModule } from 'expo-audio';
import { File } from 'expo-file-system';

export async function startVoiceCapture(signal: AbortSignal) {
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  if (signal.aborted) return null;
  if (!permission.granted) throw new Error('Vui lòng cấp quyền micro trong Cài đặt để ghi âm.');

  // Web uses voiceCapture.web.ts. The Expo SDK exposes AudioStream on iOS and Android.
  // eslint-disable-next-line import/namespace
  const stream = new AudioModule.AudioStream({ sampleRate: 16000, channels: 1, encoding: 'int16' });
  let file: File;
  function release() {
    try { stream.stop(); } finally { stream.release(); }
  }
  try {
    await stream.start();
    const { uri } = await stream.startFileRecordingAsync({ format: 'wav' });
    file = new File(uri);
  } catch (err) {
    release();
    throw err;
  }
  return {
    discard() {
      try { release(); } finally { if (file.exists) file.delete(); }
    },
    async stop() {
      try {
        const recording = await stream.stopFileRecordingAsync().finally(release);
        if (!file.exists || file.size <= 44 || recording.duration <= 0 || file.size !== recording.size) {
          throw new Error('Bản ghi trống hoặc chưa hoàn chỉnh. Vui lòng ghi lại.');
        }
        if (file.size > 7.4 * 1024 * 1024) throw new Error('Bản ghi quá lớn. Vui lòng ghi một đoạn ngắn hơn.');
        return { audioBase64: await file.base64(), mimeType: 'audio/wav' };
      } finally {
        if (file.exists) file.delete();
      }
    },
  };
}
