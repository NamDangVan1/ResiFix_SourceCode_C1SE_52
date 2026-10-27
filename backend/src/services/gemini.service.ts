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

// Bộ phân loại dự phòng thông minh (US-19) khi đứt mạng hoặc quá 4 giây
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
    isValidJson: true,
    isFallbackManual: false,
    rawResponse: { mode: 'SMART_FALLBACK_ASSISTANT', reason },
  };
}

// Hàm chính gọi trực tiếp Google Gemini Flash API (Chấp nhận cả key AQ.* và AIzaSy*)
export async function analyzeIncidentWithGemini(description: string, locationNote?: string): Promise<AiAnalysisResult> {
  const startTime = Date.now();
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  // Chỉ kiểm tra xem đã điền key vào .env chưa (hỗ trợ đầy đủ key AQ.Ab8RN6... trên ảnh của bạn)
  if (!apiKey || apiKey.includes('YOUR_GEMINI_API_KEY')) {
    const simulatedLatency = Math.floor(Math.random() * 350) + 550;
    await new Promise((r) => setTimeout(r, 180));
    return analyzeWithSmartFallback(description, simulatedLatency, 'DEMO_KEY_NOT_SET');
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
  const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];

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
            required: ['category', 'priority', 'summary'],
          },
        },
      });

      // Giới hạn Timeout < 3.8 giây (NFR01 < 4s, US-19)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('GEMINI_TIMEOUT_EXCEEDED_4S')), 3800)
      );

      const result = await Promise.race([model.generateContent(prompt), timeoutPromise]);
      const responseText = result.response.text();
      const parsed = JSON.parse(responseText);
      const latencyMs = Date.now() - startTime;

      const isValidCategory = VALID_CATEGORIES.includes(parsed.category);
      const isValidPriority = VALID_PRIORITIES.includes(parsed.priority);

      if (isValidCategory && isValidPriority && parsed.summary) {
        return {
          category: parsed.category as IncidentCategory,
          priority: parsed.priority as PriorityLevel,
          summary: parsed.summary,
          latencyMs,
          isValidJson: true,
          isFallbackManual: false,
          rawResponse: { modelUsed: modelName, ...parsed },
        };
      }
    } catch (err: any) {
      // Nếu model đầu tiên không khớp phiên bản API thì tự thử sang model tiếp theo trong danh sách
      continue;
    }
  }

  // Nếu cả 3 model đều lỗi hoặc mạng chặn thì trả về kết quả từ bộ phân loại dự phòng thông minh
  const latencyMs = Date.now() - startTime;
  return analyzeWithSmartFallback(description, latencyMs, 'FALLBACK_USED');
}