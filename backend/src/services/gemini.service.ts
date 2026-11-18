import { GoogleGenerativeAI, GoogleGenerativeAIAbortError, SchemaType } from '@google/generative-ai';
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

// Chuyển đổi giọng nói (Voice-to-Text) tiếng Việt bằng Gemini Multimodal AI
export async function transcribeAudioWithGemini(
  audioBase64: string,
  mimeType: string = 'audio/m4a'
): Promise<{ text: string; latencyMs: number; mode: string }> {
  const startTime = Date.now();
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey || apiKey.includes('YOUR_GEMINI_API_KEY')) {
    throw new Error('GEMINI_KEY_NOT_CONFIGURED');
  }

  const prompt =
    'Bạn là trợ lý nhận diện giọng nói tiếng Việt cho hệ thống báo cáo sự cố tòa nhà ResiFix. Hãy nghe đoạn ghi âm sau và chép lại chính xác (transcribe) toàn bộ lời nói của người dân thành câu văn mô tả sự cố rõ ràng, chuẩn chính tả tiếng Việt. Chỉ trả về văn bản tiếng Việt thuần túy của lời nói, không thêm lời dẫn, không giải thích, không bọc dấu ngoặc kép.';

  const genAI = new GoogleGenerativeAI(apiKey);
  const candidateModels = ['gemini-3.8-flash', 'gemini-3.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];

  for (const modelName of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([
          {
            inlineData: {
              mimeType: mimeType || 'audio/m4a',
              data: audioBase64,
            },
          },
          { text: prompt },
      ], { timeout: 8000 });

      const transcribed = result.response.text().trim();
      if (transcribed) {
        return {
          text: transcribed,
          latencyMs: Date.now() - startTime,
          mode: modelName,
        };
      }
    } catch (err: any) {
      console.warn(`Lỗi Gemini Audio (${modelName}):`, err?.message || err);
      continue;
    }
  }

  throw new Error('GEMINI_TRANSCRIPTION_UNAVAILABLE');
}
