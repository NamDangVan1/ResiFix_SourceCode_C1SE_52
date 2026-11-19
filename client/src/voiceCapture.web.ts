export async function startVoiceCapture(signal: AbortSignal) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Trình duyệt chưa hỗ trợ ghi âm. Hãy mở bằng HTTPS hoặc dùng Expo Go.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((err) => {
    if (err.name === 'NotAllowedError') throw new Error('Vui lòng cấp quyền micro trong Cài đặt để ghi âm.');
    throw err;
  });
  const release = () => stream.getTracks().forEach(track => track.stop());
  if (signal.aborted) {
    release();
    return null;
  }
  try {
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const finished = new Promise<void>(resolve => { recorder.onstop = () => { release(); resolve(); }; });
    recorder.start();
    function stopRecorder() {
      try { if (recorder.state !== 'inactive') recorder.stop(); } finally { release(); }
    }
    return {
      discard: stopRecorder,
      async stop() {
        stopRecorder();
        await finished;
        const blob = new Blob(chunks, { type: recorder.mimeType });
        if (!blob.size) throw new Error('Bản ghi trống hoặc chưa hoàn chỉnh. Vui lòng ghi lại.');
        if (blob.size > 7.4 * 1024 * 1024) throw new Error('Bản ghi quá lớn. Vui lòng ghi một đoạn ngắn hơn.');
        const audioBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('Không đọc được file ghi âm.'));
          reader.readAsDataURL(blob);
        });
        return { audioBase64, mimeType: blob.type };
      },
    };
  } catch (err) {
    release();
    throw err;
  }
}
