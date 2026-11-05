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
  const modelName = 'gemini-2.5-flash';
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
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
      error instanceof Error && error.message === 'GEMINI_TIMEOUT_EXCEEDED' ? 'GEMINI_TIMEOUT' : 'GEMINI_UNAVAILABLE'
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
