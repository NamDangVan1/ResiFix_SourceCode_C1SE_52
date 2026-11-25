import { GoogleGenerativeAI, GoogleGenerativeAIAbortError, GoogleGenerativeAIFetchError, SchemaType } from '@google/generative-ai';
import { IncidentCategory, PriorityLevel } from '@prisma/client';

export interface AiAnalysisResult {
  category: IncidentCategory;
  priority: PriorityLevel;
  summary: string;
  discrepancyNotes?: string | null;
  latencyMs: number;
  isValidJson: boolean;
  isFallbackManual: boolean;
  rawResponse: any;
}

const VALID_CATEGORIES = Object.values(IncidentCategory);
const VALID_PRIORITIES = Object.values(PriorityLevel);

interface InlineImageData {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

export function buildClassificationPrompt(
  description: string,
  locationNote?: string | null,
  imageCount: number = 0
): string {
  return JSON.stringify({
    description,
    location: locationNote || null,
    hasImages: imageCount > 0,
    imageCount,
  });
}

function normalizeTextForComparison(text: string): string {
  return text
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .replace(/\s+/g, ' ')
    .trim();
}

export function attachDiscrepancyToSummary(
  summary: string,
  discrepancyNotes?: string | null
): { summary: string; discrepancyNotes: string | null } {
  const trimmedSummary = typeof summary === 'string' ? summary.trim() : '';
  const rawNotes = typeof discrepancyNotes === 'string' ? discrepancyNotes.trim() : '';
  const validNotes = rawNotes.length > 0 ? rawNotes : null;

  if (!validNotes) {
    return {
      summary: trimmedSummary,
      discrepancyNotes: null,
    };
  }

  // So sánh chuẩn hóa Unicode, chữ thường và khoảng trắng
  const normSummary = normalizeTextForComparison(trimmedSummary);
  const normNotes = normalizeTextForComparison(validNotes);

  if (normSummary.includes(normNotes)) {
    return {
      summary: trimmedSummary,
      discrepancyNotes: validNotes,
    };
  }

  // Đưa ghi chú vào summary bằng tiền tố "Cần kiểm tra: "
  const prefix = /^cần kiểm tra\s*[:：]\s*/i.test(validNotes) ? '' : 'Cần kiểm tra: ';
  let combined: string;
  if (!trimmedSummary) {
    combined = `${prefix}${validNotes}`.trim();
  } else {
    const sentenceEnd = /[.!?]$/.test(trimmedSummary) ? '' : '.';
    combined = `${trimmedSummary}${sentenceEnd} ${prefix}${validNotes}`.trim();
  }

  // Giữ bản tóm tắt không vượt quá giới hạn 500 ký tự của hệ thống, ưu tiên giữ thông tin kiểm tra
  if (combined.length > 500) {
    const inspectionSentence = `${prefix}${validNotes}`.trim();
    if (inspectionSentence.length >= 490) {
      combined = inspectionSentence.slice(0, 497) + '...';
    } else {
      const remainingLength = 500 - inspectionSentence.length - 5;
      const truncatedSummary = trimmedSummary.slice(0, Math.max(0, remainingLength)).trim() + '...';
      combined = `${truncatedSummary} ${inspectionSentence}`;
    }
  }

  return {
    summary: combined,
    discrepancyNotes: validNotes,
  };
}

async function fetchImageInlineData(url: string): Promise<InlineImageData | null> {
  if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
    return null;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    let mimeType = 'image/jpeg';
    if (contentType.includes('image/png')) mimeType = 'image/png';
    else if (contentType.includes('image/webp')) mimeType = 'image/webp';
    else if (contentType.includes('image/jpeg') || contentType.includes('image/jpg')) mimeType = 'image/jpeg';
    else if (!contentType.startsWith('image/')) return null;

    const arrayBuf = await res.arrayBuffer();
    // Giới hạn dung lượng mỗi ảnh không quá 5MB và không rỗng
    if (arrayBuf.byteLength > 5 * 1024 * 1024 || arrayBuf.byteLength < 50) {
      return null;
    }
    const base64 = Buffer.from(arrayBuf).toString('base64');
    return {
      inlineData: {
        mimeType,
        data: base64,
      },
    };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

// Heuristic fallback is explicitly marked for manual review; it is not reported as Gemini output.
function analyzeWithSmartFallback(
  description: string,
  latencyMs: number,
  reason: string,
  discrepancyNotes?: string | null
): AiAnalysisResult {
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
  const { summary: finalSummary, discrepancyNotes: validDiscrepancy } = attachDiscrepancyToSummary(
    cleanSummary,
    discrepancyNotes
  );

  return {
    category,
    priority,
    summary: finalSummary,
    discrepancyNotes: validDiscrepancy,
    latencyMs,
    isValidJson: false,
    isFallbackManual: true,
    rawResponse: { mode: 'SMART_FALLBACK_ASSISTANT', reason },
  };
}

// Hàm chính gọi Google Gemini Flash API đa phương thức (Ảnh + Mô tả + Vị trí)
export async function analyzeIncidentWithGemini(
  description: string,
  locationNote?: string,
  imageUrls?: string[]
): Promise<AiAnalysisResult> {
  const startTime = Date.now();
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  // Without a Gemini key, let the manager classify the report manually.
  if (!apiKey || apiKey.includes('YOUR_GEMINI_API_KEY')) {
    return analyzeWithSmartFallback(description, Date.now() - startTime, 'GEMINI_KEY_NOT_CONFIGURED');
  }

  // Tải tối đa 3 ảnh hiện trường hợp lệ qua HTTPS
  const validImageUrls = (Array.isArray(imageUrls) ? imageUrls : [])
    .filter((u): u is string => typeof u === 'string' && u.startsWith('https://'))
    .slice(0, 3);

  const downloadedImages = await Promise.all(validImageUrls.map((u) => fetchImageInlineData(u)));
  const validImages: InlineImageData[] = downloadedImages.filter((img): img is InlineImageData => img !== null);

  const instruction = `Bạn là trợ lý AI chuyên gia phân loại bảo trì và kiểm định sự cố tòa nhà của hệ thống ResiFix.
Nhiệm vụ của bạn là phân tích mô tả của người báo cáo, thông tin khu vực/vị trí và các ảnh chụp hiện trường (nếu có).

Quy tắc nghiệp vụ:
1. Phân loại danh mục (category):
   - PLUMBING: Cấp thoát nước, rò rỉ đường ống, vòi nước, bồn rửa, tắc nghẽn, ngập nước.
   - ELECTRICAL: Điện chiếu sáng, bóng đèn, ổ cắm, tủ điện, dây điện, chập điện, mất điện.
   - ELEVATOR: Thang máy, cabin thang, bảng điều khiển thang máy, cửa thang máy.
   - HVAC: Máy lạnh, điều hòa không khí, quạt thông gió, quạt hút.
   - ACCESS_SECURITY: Cửa khóa, đầu đọc thẻ từ, camera giám sát, barrier, an ninh ra vào.
   - OTHER: Khi thiếu bằng chứng hoặc thuộc danh mục khác (sơn tường, cửa gỗ, rác thải...).
2. Đánh giá mức độ ưu tiên (priority):
   - HIGH: Nguy hiểm khẩn cấp (chập điện, cháy nổ, người mắc kẹt trong thang máy, nước ngập tràn gây trơn trượt nguy hiểm).
   - MEDIUM: Thiết bị hỏng làm gián đoạn sinh hoạt bình thường.
   - LOW: Bất tiện nhẹ, rỉ nước nhẹ, nhấp nháy, tiếng ồn nhỏ.
3. Sử dụng ảnh chụp hiện trường và đối chiếu mô tả:
   - Dùng ảnh để quan sát các dấu hiệu vật lý thực tế (nứt vỡ, rò rỉ, cháy đen, bóng đèn hỏng...).
   - Dùng mô tả để hiểu thời điểm, tần suất và ảnh hưởng của sự cố. Phân biệt dấu hiệu có thực với dấu hiệu phủ định ("chưa có khói", "không có mùi khét").
   - Nếu ảnh hiện trường và mô tả có điểm MÂU THUẪN (ví dụ: mô tả vòi nước nhưng ảnh chụp bóng đèn, hoặc mô tả cửa hỏng nhưng ảnh chụp tường bình thường), hoặc có chi tiết cần kiểm tra tại chỗ: ghi rõ điểm mâu thuẫn này vào trường discrepancyNotes và nêu ngắn gọn trong summary để Ban quản lý xác nhận.
   - Chỉ nêu nguyên nhân khi dữ liệu cung cấp đủ căn cứ xác thực; tuyệt đối không phỏng đoán vô căn cứ.
   - Nếu không có ảnh hoặc ảnh không đọc được, tiếp tục phân tích dựa trên mô tả và dữ liệu có thể sử dụng.
   - Không yêu cầu hay xử lý tọa độ GPS hay thông tin tài khoản của người dùng.
4. Tóm tắt (summary):
   - Một câu tiếng Việt ngắn gọn dưới 35 từ, nêu rõ tình trạng sự cố và điểm cần kiểm tra (nếu có).`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_CLASSIFICATION_MODEL?.trim() || 'gemini-3.1-flash-lite';

  let multimodalErr: unknown = null;
  let finalHasImages = false;

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
              description: 'Tóm tắt ngắn gọn sự cố bằng tiếng Việt dưới 35 từ cho Ban quản lý tòa nhà, nêu điểm cần kiểm tra nếu có.',
            },
            discrepancyNotes: {
              type: SchemaType.STRING,
              description: 'Ghi chú điểm mâu thuẫn giữa mô tả và ảnh hoặc chi tiết cần Ban quản lý kiểm tra. Để chuỗi rỗng nếu không có.',
            },
          },
          required: ['category', 'priority', 'summary'],
        },
      },
    });

    let result;
    if (validImages.length > 0) {
      const multimodalPrompt = buildClassificationPrompt(description, locationNote, validImages.length);
      const contentParts: any[] = [...validImages, multimodalPrompt];
      try {
        result = await model.generateContent(contentParts, { timeout: 9000 });
        finalHasImages = true;
      } catch (err) {
        multimodalErr = err;
        console.warn('[Gemini Multimodal Fallback to Text]', (err as any)?.message || err);
        // Thử lại đúng một lần bằng văn bản thuần
        const textOnlyPrompt = buildClassificationPrompt(description, locationNote, 0);
        result = await model.generateContent(textOnlyPrompt, { timeout: 8000 });
        finalHasImages = false;
      }
    } else {
      // Khi không có ảnh đính kèm hoặc tất cả ảnh đều tải lỗi: gọi Gemini bằng văn bản ngay từ đầu
      const textOnlyPrompt = buildClassificationPrompt(description, locationNote, 0);
      result = await model.generateContent(textOnlyPrompt, { timeout: 8000 });
      finalHasImages = false;
    }

    const parsed: unknown = JSON.parse(result.response.text());
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid Gemini response shape.');
    const candidate = parsed as Record<string, unknown>;
    const rawSummary = typeof candidate.summary === 'string' ? candidate.summary.trim() : '';
    const rawDiscrepancyNotes =
      typeof candidate.discrepancyNotes === 'string' && candidate.discrepancyNotes.trim().length > 0
        ? candidate.discrepancyNotes.trim()
        : null;

    const { summary: finalSummary, discrepancyNotes: validDiscrepancyNotes } = attachDiscrepancyToSummary(
      rawSummary,
      rawDiscrepancyNotes
    );

    if (
      !VALID_CATEGORIES.includes(candidate.category as IncidentCategory) ||
      !VALID_PRIORITIES.includes(candidate.priority as PriorityLevel) ||
      !finalSummary ||
      finalSummary.length > 500
    ) {
      throw new Error('Invalid Gemini response values.');
    }

    return {
      category: candidate.category as IncidentCategory,
      priority: candidate.priority as PriorityLevel,
      summary: finalSummary,
      discrepancyNotes: validDiscrepancyNotes,
      latencyMs: Date.now() - startTime,
      isValidJson: true,
      isFallbackManual: false,
      rawResponse: {
        modelUsed: modelName,
        category: candidate.category,
        priority: candidate.priority,
        summary: finalSummary,
        discrepancyNotes: validDiscrepancyNotes,
        hasImages: finalHasImages,
      },
    };
  } catch (error) {
    const isTimeout =
      error instanceof GoogleGenerativeAIAbortError ||
      multimodalErr instanceof GoogleGenerativeAIAbortError;
    return analyzeWithSmartFallback(
      description,
      Date.now() - startTime,
      isTimeout ? 'GEMINI_TIMEOUT' : 'GEMINI_UNAVAILABLE'
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
      if (error.status === 503) {
        throw new TranscriptionError(503, 'Dịch vụ AI phiên âm của Google hiện đang quá tải (503). Vui lòng nhập mô tả sự cố thủ công hoặc thử lại sau ít phút.', 'GEMINI_OVERLOADED');
      }
      if (typeof error.status === 'number' && error.status >= 500) {
        throw new TranscriptionError(503, `Máy chủ AI Google tạm thời gặp sự cố (${error.status}). Vui lòng nhập mô tả thủ công hoặc thử lại sau.`, 'GEMINI_SERVER_ERROR');
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
    if (error instanceof Error && (error.message.includes('fetch failed') || (error as any).code === 'ENOTFOUND')) {
      throw new TranscriptionError(503, 'Không thể kết nối tới máy chủ Google Gemini. Vui lòng kiểm tra kết nối internet hoặc nhập mô tả thủ công.', 'NETWORK_ERROR');
    }
    throw new TranscriptionError(502, 'Không nhận được bản phiên âm từ Gemini. Vui lòng thử lại hoặc nhập mô tả bằng tay.');
  }
}
