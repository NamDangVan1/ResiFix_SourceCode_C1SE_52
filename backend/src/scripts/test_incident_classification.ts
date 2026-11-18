import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { analyzeIncidentWithGemini } from '../services/gemini.service';

test('offline suggestions reflect the faulty equipment and reported hazard', async () => {
  const key = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    for (const [description, category, priority] of [
      ['Đèn ở hầm xe nhấp nháy nhẹ', 'ELECTRICAL', 'LOW'],
      ['Máy lạnh ngừng làm mát, chưa có khói', 'HVAC', 'MEDIUM'],
      ['Nước tràn từ đường ống làm sàn trơn trượt', 'PLUMBING', 'HIGH'],
      ['Có người mắc kẹt trong thang máy', 'ELEVATOR', 'HIGH'],
      ['Camera hầm xe mất hình', 'ACCESS_SECURITY', 'MEDIUM'],
      ['Tường ở hầm xe bong sơn', 'OTHER', 'MEDIUM'],
    ]) {
      const result = await analyzeIncidentWithGemini(description);
      assert.deepEqual([result.category, result.priority, result.isFallbackManual], [category, priority, true]);
    }
  } finally {
    if (key !== undefined) process.env.GEMINI_API_KEY = key;
  }
});

test('only validated model output is attributed to Gemini', async (t) => {
  const key = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'local-test';
  let output = JSON.stringify({ category: 'HVAC', priority: 'MEDIUM', summary: 'Máy lạnh ngừng làm mát.' });
  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async () => ({ response: { text: () => output } }),
  }));
  try {
    assert.equal((await analyzeIncidentWithGemini('Máy lạnh hỏng')).isFallbackManual, false);
    output = JSON.stringify({ category: 'INVALID', priority: 'HIGH', summary: 'test' });
    assert.equal((await analyzeIncidentWithGemini('Máy lạnh hỏng')).isFallbackManual, true);
  } finally {
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
  }
});
