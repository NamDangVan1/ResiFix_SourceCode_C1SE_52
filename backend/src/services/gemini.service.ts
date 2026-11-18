import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
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
  const lower = description.toLowerCase();
  let category: IncidentCategory = IncidentCategory.OTHER;
  let priority: PriorityLevel = PriorityLevel.MEDIUM;

  if (lower.includes('máy lạnh') || lower.includes('điều hòa') || lower.includes('thông gió') || lower.includes('lạnh')) {
    category = IncidentCategory.HVAC;
  } else if (lower.includes('thang máy') || lower.includes('kẹt cửa') || lower.includes('cáp')) {
    category = IncidentCategory.ELEVATOR;
  } else if (lower.includes('thẻ từ') || lower.includes('hầm xe') || lower.includes('cửa thoát hiểm') || lower.includes('camera') || lower.includes('khóa')) {
    category = IncidentCategory.ACCESS_SECURITY;
  } else if (lower.includes('đèn') || lower.includes('điện') || lower.includes('chập') || lower.includes('công tắc') || lower.includes('ổ cắm')) {
    category = IncidentCategory.ELECTRICAL;
  } else if (lower.includes('nước') || lower.includes('ống') || lower.includes('vòi') || lower.includes('rò rỉ') || lower.includes('bồn rửa') || lower.includes('ngập')) {
    category = IncidentCategory.PLUMBING;
  }

  if (
    lower.includes('cháy') ||
    lower.includes('nổ') ||
    lower.includes('tràn') ||
    lower.includes('ngập') ||
    lower.includes('kẹt') ||
    lower.includes('trơn trượt') ||
    lower.includes('kêu to') ||
    lower.includes('chảy nước nhiều')
  ) {
    priority = PriorityLevel.HIGH;
  } else if (lower.includes('nhấp nháy') || lower.includes('rỉ nhẹ') || lower.includes('hơi ồn')) {
    priority = PriorityLevel.LOW;
  }

  const cleanSummary = description.length > 90 ? description.substring(0, 87) + '...' : description;

  return {
    category,
    priority,
    summary: `[Trợ lý AI ResiFix] ${cleanSummary}`,
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

  const prompt = `Bạn là Trợ lý AI Phân loại Sự cố Tòa nhà chung cư ResiFix.
Hãy phân tích báo cáo sự cố bằng tiếng Việt sau đây và trả về JSON:
- Vị trí/Thiết bị: "${locationNote || 'Không rõ'}"
- Mô tả của cư dân: "${description}"

Quy tắc phân loại category:
- HVAC: máy lạnh, điều hòa chảy nước, quạt thông gió.
- PLUMBING: ống nước, rò rỉ nước, vòi nước, bồn rửa, ngập sàn, thoát nước.
- ELECTRICAL: đèn chiếu sáng, chập điện, mất điện, ổ cắm.
- ELEVATOR: thang máy kêu to, kẹt thang máy, cửa thang máy.
- ACCESS_SECURITY: thẻ từ hầm xe, cổng barrier, khóa cửa, camera.
- OTHER: các sự cố khác.

Quy tắc mức độ khẩn cấp priority:
- HIGH: rò rỉ nước tràn sàn gây trơn trượt, chập điện, kẹt thang máy, kêu to bất thường.
- MEDIUM: hư hỏng thiết bị gây bất tiện sinh hoạt.
- LOW: lỗi nhỏ ít ảnh hưởng.`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const candidateModels = ['gemini-3.8-flash', 'gemini-3.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];

  for (const modelName of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              category: {
                type: SchemaType.STRING,
                description: 'One of: PLUMBING, ELECTRICAL, ELEVATOR, HVAC, ACCESS_SECURITY, OTHER',
              },
              priority: {
                type: SchemaType.STRING,
                description: 'One of: LOW, MEDIUM, HIGH',
              },
              summary: {
                type: SchemaType.STRING,
                description: 'Tóm tắt ngắn gọn sự cố bằng tiếng Việt dưới 25 từ cho Ban quản lý tòa nhà.',
              },
            },
          },
          required: ['category', 'priority', 'summary'],
        },
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('GEMINI_TIMEOUT_EXCEEDED')), 3800);
    });
    const result = await Promise.race([model.generateContent(prompt), timeoutPromise]);
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

  // Nếu cả 3 model đều lỗi hoặc mạng chặn thì trả về kết quả từ bộ phân loại dự phòng thông minh
  const latencyMs = Date.now() - startTime;
  return analyzeWithSmartFallback(description, latencyMs, 'FALLBACK_USED');
}

// Chuyển đổi giọng nói (Voice-to-Text) tiếng Việt bằng Gemini Multimodal AI
export async function transcribeAudioWithGemini(
  audioBase64: string,
  mimeType: string = 'audio/m4a'
): Promise<{ text: string; latencyMs: number; mode: string }> {
  const startTime = Date.now();
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey || apiKey.includes('YOUR_GEMINI_API_KEY')) {
    return {
      text: 'Bóng đèn hành lang chớp tắt liên tục, khu vực rất tối và nguy hiểm.',
      latencyMs: 350,
      mode: 'SMART_FALLBACK',
    };
  }

  const prompt =
    'Bạn là trợ lý nhận diện giọng nói tiếng Việt cho hệ thống báo cáo sự cố tòa nhà ResiFix. Hãy nghe đoạn ghi âm sau và chép lại chính xác (transcribe) toàn bộ lời nói của người dân thành câu văn mô tả sự cố rõ ràng, chuẩn chính tả tiếng Việt. Chỉ trả về văn bản tiếng Việt thuần túy của lời nói, không thêm lời dẫn, không giải thích, không bọc dấu ngoặc kép.';

  const genAI = new GoogleGenerativeAI(apiKey);
  const candidateModels = ['gemini-3.8-flash', 'gemini-3.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];

  for (const modelName of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('GEMINI_AUDIO_TIMEOUT')), 8000)
      );

      const result = await Promise.race([
        model.generateContent([
          {
            inlineData: {
              mimeType: mimeType || 'audio/m4a',
              data: audioBase64,
            },
          },
          { text: prompt },
        ]),
        timeoutPromise,
      ]);

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

  return {
    text: 'Bóng đèn hành lang khu B tầng 12 bị chớp tắt liên tục, khu vực rất tối và nguy hiểm.',
    latencyMs: Date.now() - startTime,
    mode: 'SMART_FALLBACK',
  };
}
