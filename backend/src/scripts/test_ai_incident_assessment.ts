import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GoogleGenerativeAI, GoogleGenerativeAIAbortError } from '@google/generative-ai';
import { IncidentCategory, PriorityLevel, TicketStatus } from '@prisma/client';
import { analyzeIncidentWithGemini, attachDiscrepancyToSummary, buildClassificationPrompt } from '../services/gemini.service';
import { aiWorker, AI_STATUS } from '../services/ai_worker';
import { prisma } from '../config/database';

// ============================================================================
// NHÓM 1: CÁC CA KIỂM THỬ ĐỘC LẬP (MOCK FETCH & GEMINI, KHÔNG PHỤ THUỘC NEON/CLOUDINARY)
// ============================================================================

test('1. Gemini analysis without key uses smart fallback and preserves manual review state', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const res = await analyzeIncidentWithGemini('Vòi nước bồn rửa mặt bị rò rỉ rỉ nước liên tục', 'Hành lang B12');
    assert.equal(res.category, IncidentCategory.PLUMBING);
    assert.equal(res.isFallbackManual, true);
    assert.equal(res.isValidJson, false);
    assert.equal(res.discrepancyNotes, null);
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
  }
});

test('2. Có một ảnh tải được và một ảnh tải lỗi: lượt gọi đa phương thức chứa đúng một inlineData, hasImages: true, imageCount: 1', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';

  t.mock.method(globalThis, 'fetch', async (url: any) => {
    const urlStr = String(url);
    if (urlStr === 'https://example.com/ok.jpg') {
      return new Response(Buffer.from('a'.repeat(60)), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    return new Response(null, { status: 404 });
  });

  const calls: any[] = [];
  const mockOutput = JSON.stringify({
    category: 'PLUMBING',
    priority: 'MEDIUM',
    summary: 'Rò rỉ nước tại hành lang.',
    discrepancyNotes: '',
  });

  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async (content: any) => {
      calls.push(content);
      return { response: { text: () => mockOutput } };
    },
  }));

  try {
    const res = await analyzeIncidentWithGemini('Rò rỉ nước', 'Hành lang B', [
      'https://example.com/ok.jpg',
      'https://example.com/broken.jpg',
    ]);

    assert.equal(calls.length, 1, 'Chỉ thực hiện đúng 1 lượt gọi đa phương thức');
    const content = calls[0];
    assert.ok(Array.isArray(content), 'Đối số gửi vào generateContent phải là mảng đa phương thức');

    const inlineDataParts = content.filter((part: any) => part && part.inlineData);
    assert.equal(inlineDataParts.length, 1, 'Chỉ chứa đúng 1 phần inlineData của ảnh tải thành công');
    assert.equal(inlineDataParts[0].inlineData.mimeType, 'image/jpeg');

    const promptPart = content.find((part: any) => typeof part === 'string');
    assert.ok(promptPart, 'Phải có phần prompt dạng chuỗi');
    const parsedPayload = JSON.parse(promptPart as string);
    assert.equal(parsedPayload.hasImages, true);
    assert.equal(parsedPayload.imageCount, 1);
    assert.equal(res.rawResponse.hasImages, true);
    assert.equal(res.category, IncidentCategory.PLUMBING);
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('3. Không có ảnh hoặc mọi ảnh đều tải lỗi: Gemini nhận đúng một yêu cầu văn bản với hasImages: false và imageCount: 0', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';

  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));

  const calls: any[] = [];
  const mockOutput = JSON.stringify({
    category: 'ELECTRICAL',
    priority: 'LOW',
    summary: 'Đèn chớp nháy.',
    discrepancyNotes: '',
  });

  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async (content: any) => {
      calls.push(content);
      return { response: { text: () => mockOutput } };
    },
  }));

  try {
    // Trường hợp A: Mọi ảnh đều tải lỗi
    const resAllFailed = await analyzeIncidentWithGemini('Đèn chớp nháy', 'Tầng 1', [
      'https://example.com/fail1.jpg',
      'https://example.com/fail2.jpg',
    ]);
    assert.equal(calls.length, 1, 'Chỉ gọi Gemini đúng 1 lần bằng văn bản');
    assert.equal(typeof calls[0], 'string', 'Yêu cầu gửi vào generateContent phải là chuỗi văn bản');
    const payload1 = JSON.parse(calls[0]);
    assert.equal(payload1.hasImages, false);
    assert.equal(payload1.imageCount, 0);
    assert.equal(resAllFailed.rawResponse.hasImages, false);

    // Trường hợp B: Không có ảnh đính kèm
    calls.length = 0;
    const resNoImages = await analyzeIncidentWithGemini('Đèn chớp nháy', 'Tầng 1', []);
    assert.equal(calls.length, 1, 'Chỉ gọi Gemini đúng 1 lần bằng văn bản khi không có ảnh');
    assert.equal(typeof calls[0], 'string');
    const payload2 = JSON.parse(calls[0]);
    assert.equal(payload2.hasImages, false);
    assert.equal(payload2.imageCount, 0);
    assert.equal(resNoImages.rawResponse.hasImages, false);
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('4. Gemini từ chối lượt có ảnh rồi chấp nhận lượt văn bản: có đúng hai lượt gọi, lượt hai hasImages: false và rawResponse.hasImages: false', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';

  t.mock.method(globalThis, 'fetch', async () => {
    return new Response(Buffer.from('b'.repeat(60)), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  });

  const calls: any[] = [];
  const mockOutput = JSON.stringify({
    category: 'HVAC',
    priority: 'MEDIUM',
    summary: 'Máy lạnh không mát.',
    discrepancyNotes: '',
  });

  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async (content: any) => {
      calls.push(content);
      if (calls.length === 1) {
        throw new Error('Model rejected multimodal request');
      }
      return { response: { text: () => mockOutput } };
    },
  }));

  try {
    const res = await analyzeIncidentWithGemini('Máy lạnh kêu to', 'Phòng 204', [
      'https://example.com/hvac.png',
    ]);
    assert.equal(calls.length, 2, 'Phải có đúng 2 lượt gọi generateContent');

    // Lượt 1: Đa phương thức
    assert.ok(Array.isArray(calls[0]));
    const firstPromptPart = calls[0].find((p: any) => typeof p === 'string');
    assert.ok(firstPromptPart, 'Lượt 1 phải chứa prompt văn bản');
    const firstPayload = JSON.parse(firstPromptPart as string);
    assert.equal(firstPayload.hasImages, true);
    assert.equal(firstPayload.imageCount, 1);

    // Lượt 2: Văn bản thuần túy giữ nguyên mô tả và khu vực
    assert.equal(typeof calls[1], 'string', 'Lượt 2 phải là chuỗi văn bản không chứa inlineData');
    const secondPayload = JSON.parse(calls[1]);
    assert.equal(secondPayload.description, 'Máy lạnh kêu to');
    assert.equal(secondPayload.location, 'Phòng 204');
    assert.equal(secondPayload.hasImages, false);
    assert.equal(secondPayload.imageCount, 0);

    // Kết quả cuối cùng
    assert.equal(res.isFallbackManual, false);
    assert.equal(res.rawResponse.hasImages, false);
    assert.equal(res.category, IncidentCategory.HVAC);
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('5. Cả lượt đa phương thức và lượt văn bản đều lỗi: trả Smart Fallback và giữ dấu hiệu lỗi', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';

  t.mock.method(globalThis, 'fetch', async () => {
    return new Response(Buffer.from('c'.repeat(60)), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  });

  // Trường hợp A: Timeout ở lượt đầu và lỗi ở lượt 2
  let callsCount = 0;
  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async () => {
      callsCount += 1;
      if (callsCount === 1) {
        throw new GoogleGenerativeAIAbortError('Request timed out');
      }
      throw new Error('Connection failed');
    },
  }));

  try {
    const resTimeout = await analyzeIncidentWithGemini('Mùi khét chập điện ổ cắm', 'Khu A', [
      'https://example.com/socket.jpg',
    ]);
    assert.equal(callsCount, 2);
    assert.equal(resTimeout.isFallbackManual, true);
    assert.equal(resTimeout.category, IncidentCategory.ELECTRICAL);
    assert.equal(resTimeout.priority, PriorityLevel.HIGH);
    assert.equal(resTimeout.rawResponse.reason, 'GEMINI_TIMEOUT');
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
  }

  // Trường hợp B: Lỗi mạng thông thường (UNAVAILABLE)
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  callsCount = 0;
  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async () => {
      callsCount += 1;
      throw new Error('Network error');
    },
  }));

  try {
    const resUnavailable = await analyzeIncidentWithGemini('Ống nước rò rỉ nhẹ', 'Tầng 1', [
      'https://example.com/pipe.jpg',
    ]);
    assert.equal(callsCount, 2);
    assert.equal(resUnavailable.isFallbackManual, true);
    assert.equal(resUnavailable.rawResponse.reason, 'GEMINI_UNAVAILABLE');
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('6. Gemini chỉ nêu mâu thuẫn trong discrepancyNotes: summary và rawResponse.summary đều chứa ghi chú', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';

  const mockOutput = JSON.stringify({
    category: 'PLUMBING',
    priority: 'MEDIUM',
    summary: 'Cư dân báo vòi nước rò rỉ tại sảnh.',
    discrepancyNotes: 'Ảnh chụp bóng đèn, chưa thấy vòi nước.',
  });

  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async () => ({ response: { text: () => mockOutput } }),
  }));

  try {
    const res = await analyzeIncidentWithGemini('Vòi nước rò rỉ', 'Sảnh');
    assert.equal(
      res.summary,
      'Cư dân báo vòi nước rò rỉ tại sảnh. Cần kiểm tra: Ảnh chụp bóng đèn, chưa thấy vòi nước.'
    );
    assert.equal(res.rawResponse.summary, res.summary);
    assert.equal(res.discrepancyNotes, 'Ảnh chụp bóng đèn, chưa thấy vòi nước.');
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('7. summary đã chứa ghi chú với khác biệt nhỏ về chữ hoa hoặc khoảng trắng: ghi chú chỉ xuất hiện một lần', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';

  const mockOutput = JSON.stringify({
    category: 'PLUMBING',
    priority: 'MEDIUM',
    summary: 'Cư dân báo vòi nước rò rỉ tại sảnh. Cần kiểm tra: ảnh chụp bóng đèn,   chưa thấy vòi nước.',
    discrepancyNotes: 'Ảnh chụp bóng đèn, chưa thấy vòi nước.',
  });

  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async () => ({ response: { text: () => mockOutput } }),
  }));

  try {
    const res = await analyzeIncidentWithGemini('Vòi nước rò rỉ', 'Sảnh');
    assert.equal(
      res.summary,
      'Cư dân báo vòi nước rò rỉ tại sảnh. Cần kiểm tra: ảnh chụp bóng đèn,   chưa thấy vòi nước.'
    );
    assert.equal(res.rawResponse.summary, res.summary);
    assert.equal(res.discrepancyNotes, 'Ảnh chụp bóng đèn, chưa thấy vòi nước.');
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('8. Ghi chú thiếu hoặc chỉ có khoảng trắng: summary giữ nguyên sau khi trim và discrepancyNotes bằng null', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';

  const mockOutputWithWhitespaceNotes = JSON.stringify({
    category: 'HVAC',
    priority: 'LOW',
    summary: '   Máy lạnh chạy hơi ồn tại phòng kỹ thuật.   ',
    discrepancyNotes: '   ',
  });

  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async () => ({ response: { text: () => mockOutputWithWhitespaceNotes } }),
  }));

  try {
    const res = await analyzeIncidentWithGemini('Máy lạnh ồn', 'Phòng kỹ thuật');
    assert.equal(res.summary, 'Máy lạnh chạy hơi ồn tại phòng kỹ thuật.');
    assert.equal(res.rawResponse.summary, 'Máy lạnh chạy hơi ồn tại phòng kỹ thuật.');
    assert.equal(res.discrepancyNotes, null);
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

// ============================================================================
// NHÓM 2: CÁC CA TÍCH HỢP AI WORKER VÀ CƠ SỞ DỮ LIỆU NEON POSTGRESQL
// ============================================================================

test('9. aiWorker processTicket updates ticket to COMPLETED and does not overwrite BMB manual classification', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';

  const mockOutput = JSON.stringify({
    category: 'PLUMBING',
    priority: 'LOW',
    summary: 'Ống nước bồn rửa nhỏ giọt nhẹ.',
    discrepancyNotes: null,
  });

  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async () => ({ response: { text: () => mockOutput } }),
  }));

  try {
    // Tạo 1 ticket test trên DB Neon
    const testCode = `#RF-TEST-${Date.now()}`;
    const ticket = await prisma.incidentTicket.create({
      data: {
        ticketCode: testCode,
        title: 'Sự cố test background worker',
        description: 'Vòi nước bồn rửa mặt bị rỉ nước liên tục',
        locationNote: 'Phòng vệ sinh tầng 2 - Tòa S1',
        isVoiceInput: false,
        isQrScannedByRes: true,
        isAnonymous: true,
        aiStatus: AI_STATUS.ANALYZING,
        aiSummary: 'Đang phân tích...',
        status: TicketStatus.PENDING,
        // Giả lập: BMB đã tự phân loại và chỉ định trước khi AI hoàn tất!
        finalCategory: IncidentCategory.ELECTRICAL,
        finalPriority: PriorityLevel.HIGH,
      },
    });

    // Chạy worker xử lý ticket này
    await aiWorker.processTicket(ticket.id);

    // Kiểm tra kết quả sau khi AI hoàn tất
    const updated = await prisma.incidentTicket.findUnique({
      where: { id: ticket.id },
    });

    assert.ok(updated);
    assert.equal(updated.aiStatus, AI_STATUS.COMPLETED);
    assert.equal(updated.aiSuggestedCategory, IncidentCategory.PLUMBING);
    assert.equal(updated.aiSuggestedPriority, PriorityLevel.LOW);
    // BMB's finalCategory and finalPriority MUST NOT BE OVERWRITTEN:
    assert.equal(updated.finalCategory, IncidentCategory.ELECTRICAL);
    assert.equal(updated.finalPriority, PriorityLevel.HIGH);

    // Dọn dẹp ticket test
    await prisma.ticketStatusLog.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.incidentTicket.delete({ where: { id: ticket.id } });
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('10. aiWorker transitions to MANUAL_REVIEW after reaching MAX_RETRIES', async () => {
  const testCode = `#RF-TEST-RETRY-${Date.now()}`;
  const ticket = await prisma.incidentTicket.create({
    data: {
      ticketCode: testCode,
      title: 'Sự cố test retry',
      description: 'Đèn chớp nháy ở sảnh thang máy',
      locationNote: 'Sảnh thang máy Tầng 1',
      isAnonymous: true,
      aiStatus: AI_STATUS.ANALYZING,
      aiRetryCount: 3, // Đã đạt giới hạn thử lại tối đa
      status: TicketStatus.PENDING,
    },
  });

  try {
    await aiWorker.processTicket(ticket.id);

    const updated = await prisma.incidentTicket.findUnique({
      where: { id: ticket.id },
    });

    assert.ok(updated);
    assert.equal(updated.aiStatus, AI_STATUS.MANUAL_REVIEW);
    assert.equal(updated.isAiFallbackManual, true);
    assert.ok(updated.aiError && updated.aiError.includes('thử lại'));
  } finally {
    await prisma.ticketStatusLog.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.incidentTicket.delete({ where: { id: ticket.id } });
  }
});

test('11. Server restart recovery: aiWorker pollPendingTickets picks up ANALYZING tickets from database', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';

  const mockOutput = JSON.stringify({
    category: 'ELEVATOR',
    priority: 'HIGH',
    summary: 'Thang máy cabin bị kẹt giữa tầng 4 và 5.',
    discrepancyNotes: null,
  });

  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async () => ({ response: { text: () => mockOutput } }),
  }));

  const testCode = `#RF-TEST-RESTART-${Date.now()}`;
  // Tạo ticket ở trạng thái ANALYZING (mô phỏng ticket tạo ngay trước khi server sập)
  const ticket = await prisma.incidentTicket.create({
    data: {
      ticketCode: testCode,
      title: 'Sự cố trước restart',
      description: 'Thang máy bị kẹt cửa rung lắc mạnh',
      locationNote: 'Thang máy Tòa S1',
      isAnonymous: true,
      aiStatus: AI_STATUS.ANALYZING,
      aiRetryCount: 0,
      status: TicketStatus.PENDING,
    },
  });

  try {
    // Mô phỏng server khởi động lại: pollPendingTickets được gọi
    await aiWorker.pollPendingTickets();

    const recovered = await prisma.incidentTicket.findUnique({
      where: { id: ticket.id },
    });

    assert.ok(recovered);
    assert.equal(recovered.aiStatus, AI_STATUS.COMPLETED);
    assert.equal(recovered.aiSuggestedCategory, IncidentCategory.ELEVATOR);
    assert.equal(recovered.aiSuggestedPriority, PriorityLevel.HIGH);
  } finally {
    await prisma.ticketStatusLog.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.incidentTicket.delete({ where: { id: ticket.id } });
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    else delete process.env.GEMINI_API_KEY;
  }
});
