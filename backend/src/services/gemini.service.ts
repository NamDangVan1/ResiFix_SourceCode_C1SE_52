import { GoogleGenerativeAI, GoogleGenerativeAIAbortError, GoogleGenerativeAIFetchError, SchemaType } from '@google/generative-ai';
import { IncidentCategory, PriorityLevel } from '@prisma/client';

export interface AiAnalysisResult {
  category: IncidentCategory;
  priority: PriorityLevel;
  summary: string;
  latencyMs: number;
  isValidJson: boolean;
  isFallbackManual: boolean;
  rawResponse: any;
}

const VALID_CATEGORIES = Object.values(IncidentCategory);
const VALID_PRIORITIES = Object.values(PriorityLevel);

// Heuristic fallback is explicitly marked for manual review; it is not reported as Gemini output.
function analyzeWithSmartFallback(description: string, latencyMs: number, reason: string): AiAnalysisResult {
  const lower = description.normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g, ' ');
  // Location alone (e.g. "hầm xe") does not identify a faulty system.
  const rules: [IncidentCategory, RegExp][] = [
    [IncidentCategory.HVAC, /máy lạnh|điều hoà|điều hòa|quạt (?:thông|hút) gió/],
    [IncidentCategory.ACCESS_SECURITY, /thẻ từ|đầu đọc thẻ|camera|barrier|barie|khóa cửa|khoá cửa/],
    [IncidentCategory.ELECTRICAL, /ổ (?:cắm|điện)|bóng đèn|đèn |chập điện|mất điện|tủ điện|công tắc|dây điện/],
    [IncidentCategory.ELEVATOR, /thang máy|cabin thang/],
    [IncidentCategory.PLUMBING, /ống nước|đường ống|vòi|bồn (?:rửa|cầu)|thoát nước|rò (?:rỉ )?nước|rỉ nước|ngập|nước (?:tràn|rò|rỉ|chảy)/],
  ];
  const category = rules.find(([, pattern]) => pattern.test(lower))?.[0] ?? IncidentCategory.OTHER;
  const symptoms = lower
    .replace(/(?:báo|chữa|chống|phòng) cháy/g, '')
    .replace(/(?:không|chưa) (?:có |bị )?(?:mùi khét|khói|cháy|ngập|kẹt|chập điện|người mắc kẹt|nước tràn|trơn trượt)/g, '');
  let priority: PriorityLevel = PriorityLevel.MEDIUM;
  if (/cháy|bốc khói|phát nổ|tia lửa|mùi khét|chập điện|điện giật|mắc kẹt|người bị kẹt|kẹt (?:trong )?thang|ngập|nước tràn|trơn trượt/.test(symptoms)) {
    priority = PriorityLevel.HIGH;
  } else if (/nhấp nháy|rỉ nhẹ|hơi ồn/.test(symptoms)) {
    priority = PriorityLevel.LOW;
  }

  const cleanSummary = description.length > 90 ? description.substring(0, 87) + '...' : description;

  return {
    category,
    priority,
    summary: cleanSummary,
    latencyMs,
    isValidJson: false,
    isFallbackManual: true,
    rawResponse: { mode: 'SMART_FALLBACK_ASSISTANT', reason },
  };
}

// Hàm chính gọi trực tiếp Google Gemini Flash API (Chấp nhận cả key AQ.* và AIzaSy*)
export async function analyzeIncidentWithGemini(description: string, locationNote?: string): Promise<AiAnalysisResult> {
  const startTime = Date.now();
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  // Without a Gemini key, let the manager classify the report manually.
  if (!apiKey || apiKey.includes('YOUR_GEMINI_API_KEY')) {
    return analyzeWithSmartFallback(description, Date.now() - startTime, 'GEMINI_KEY_NOT_CONFIGURED');
  }

  const instruction = `Phân loại báo cáo bảo trì tòa nhà cho ban quản lý. Dữ liệu đầu vào là mô tả và vị trí do cư dân cung cấp.
Chọn hệ thống cần sửa theo triệu chứng. Vị trí chỉ là ngữ cảnh: đèn hỏng ở hầm xe là ELECTRICAL, máy lạnh rò nước là HVAC.
PLUMBING cho cấp thoát nước; ELEVATOR cho thang máy; ACCESS_SECURITY cho kiểm soát ra vào và camera. Chọn OTHER khi thiếu bằng chứng.
HIGH khi có nguy hiểm đang diễn ra như chập điện, người mắc kẹt hoặc nước tràn gây trơn trượt. MEDIUM cho thiết bị hỏng ảnh hưởng sử dụng; LOW cho bất tiện nhẹ.
Phân biệt dấu hiệu thực tế với dấu hiệu được phủ định. Tóm tắt bằng một câu tiếng Việt ngắn, chỉ nêu thông tin đã báo.`;
  const prompt = JSON.stringify({ description, location: locationNote || null });

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_CLASSIFICATION_MODEL?.trim() || 'gemini-3.1-flash-lite';
  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: instruction,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            category: {
              type: SchemaType.STRING,
              format: 'enum',
              enum: VALID_CATEGORIES,
            },
            priority: {
              type: SchemaType.STRING,
              format: 'enum',
              enum: VALID_PRIORITIES,
            },
            summary: {
              type: SchemaType.STRING,
              description: 'Tóm tắt ngắn gọn sự cố bằng tiếng Việt dưới 25 từ cho Ban quản lý tòa nhà.',
            },
          },
          required: ['category', 'priority', 'summary'],
        },
      },
    });

    const result = await model.generateContent(prompt, { timeout: 7000 });
    const parsed: unknown = JSON.parse(result.response.text());
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid Gemini response shape.');
    const candidate = parsed as Record<string, unknown>;
    const summary = typeof candidate.summary === 'string' ? candidate.summary.trim() : '';

    if (
      !VALID_CATEGORIES.includes(candidate.category as IncidentCategory) ||
      !VALID_PRIORITIES.includes(candidate.priority as PriorityLevel) ||
      !summary || summary.length > 500
    ) {
      throw new Error('Invalid Gemini response values.');
    }

    return {
      category: candidate.category as IncidentCategory,
      priority: candidate.priority as PriorityLevel,
      summary,
      latencyMs: Date.now() - startTime,
      isValidJson: true,
      isFallbackManual: false,
      rawResponse: { modelUsed: modelName, category: candidate.category, priority: candidate.priority, summary },
    };
  } catch (error) {
    return analyzeWithSmartFallback(
      description,
      Date.now() - startTime,
      error instanceof GoogleGenerativeAIAbortError ? 'GEMINI_TIMEOUT' : 'GEMINI_UNAVAILABLE'
    );
  }
}

export class TranscriptionError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

export async function transcribeAudioWithGemini(
  audioBase64: string,
  mimeType = 'audio/mp4'
): Promise<{ text: string; latencyMs: number; mode: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey.includes('YOUR_GEMINI_API_KEY')) {
    throw new TranscriptionError(503, 'Backend chưa cấu hình API key Gemini cho dịch vụ ghi âm.');
  }

  const modelName = process.env.GEMINI_TRANSCRIPTION_MODEL?.trim() || 'gemini-3.1-flash-lite';
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: modelName });
  const startTime = Date.now();
  try {
    const result = await model.generateContent([
      { inlineData: { mimeType, data: audioBase64 } },
      { text: 'Chép lại nguyên văn lời nói trong bản ghi, giữ nguyên ngôn ngữ. Chỉ trả về lời nói. Nếu không nghe được lời nào, trả về [NO_SPEECH].' },
    ], { timeout: 20000 });
    const text = result.response.text().trim();
    if (!text || text === '[NO_SPEECH]') {
      throw new TranscriptionError(422, 'Không nghe rõ lời nói. Vui lòng ghi âm lại.');
    }
    return { text, latencyMs: Date.now() - startTime, mode: modelName };
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    if (error instanceof GoogleGenerativeAIAbortError) {
      throw new TranscriptionError(504, 'Gemini phản hồi quá chậm. Vui lòng thử lại.');
    }
    if (error instanceof GoogleGenerativeAIFetchError) {
      const googleReason = error.errorDetails?.find(detail => detail.reason)?.reason;
      const reason = googleReason && /^[A-Z][A-Z0-9_]{0,79}$/.test(googleReason) ? googleReason : undefined;
      console.warn('[Gemini Audio]', modelName, error.status, reason || 'NO_REASON', mimeType, Buffer.byteLength(audioBase64, 'base64'));
      if (error.status === 429) throw new TranscriptionError(429, 'Gemini đã đạt giới hạn sử dụng. Vui lòng thử lại sau.');
      if (error.status === 401 || error.status === 403 || error.status === 404) {
        throw new TranscriptionError(503, 'Backend chưa truy cập được model phiên âm. Vui lòng kiểm tra cấu hình Gemini.');
      }
      if (error.status === 400) {
        if (reason?.startsWith('API_KEY_') || /API key (?:not valid|expired|is invalid)/i.test(error.message)) {
          throw new TranscriptionError(503, 'Gemini từ chối API key. Hãy kiểm tra GEMINI_API_KEY trong backend/.env và khởi động lại backend.', reason || 'API_KEY_INVALID');
        }
        if (/location is not supported|failed.precondition.*billing/i.test(error.message)) {
          throw new TranscriptionError(503, 'Gemini chưa khả dụng với khu vực hoặc cấu hình thanh toán của dự án Google.', reason || 'GEMINI_PROJECT_UNAVAILABLE');
        }
        if (/unable to process (?:input |the )?audio|invalid audio|audio.*(?:too short|unsupported|corrupt)|unsupported mime/i.test(error.message)) {
          throw new TranscriptionError(422, 'Gemini không đọc được bản ghi này. Hãy ghi lại một câu đầy đủ rồi bấm dừng.', reason || 'GEMINI_INVALID_AUDIO');
        }
        throw new TranscriptionError(502, 'Google trả về lỗi 400 khi phiên âm.', reason || 'GEMINI_INVALID_ARGUMENT');
      }
    }
    throw new TranscriptionError(502, 'Không nhận được bản phiên âm từ Gemini. Vui lòng thử lại.');
  }
}
