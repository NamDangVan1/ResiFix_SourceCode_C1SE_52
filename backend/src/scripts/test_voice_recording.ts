import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';
import { recordingMimeType } from '../utils/recording';
import { TranscriptionError, transcribeAudioWithGemini } from '../services/gemini.service';

function box(type: string, payload: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

test('WAV input needs a complete non-empty data chunk', () => {
  const audio = Buffer.alloc(46);
  audio.write('RIFF');
  audio.writeUInt32LE(38, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.write('data', 36);
  audio.writeUInt32LE(2, 40);
  assert.equal(recordingMimeType(audio, ''), 'audio/wav');
  assert.equal(recordingMimeType(audio.subarray(0, 45), 'audio/wav'), null);
  audio.writeUInt32LE(0, 40);
  assert.equal(recordingMimeType(audio, 'audio/wav'), null);
});

test('MP4 uploads require complete media and metadata boxes regardless of Blob.type', () => {
  const header = box('ftyp', Buffer.from('M4A '));
  const sample = Buffer.concat([header, box('mdat', Buffer.from([1])), box('moov', Buffer.from([1]))]);
  assert.equal(recordingMimeType(sample, 'application/octet-stream'), 'audio/mp4');
  assert.equal(recordingMimeType(header, 'audio/mp4'), null);
  assert.equal(recordingMimeType(sample.subarray(0, -1), 'audio/mp4'), null);
  assert.equal(recordingMimeType(Buffer.from('<html>not audio</html>'), 'audio/mp4'), null);
});

test('different Gemini 400 responses produce actionable error codes', async (t) => {
  const oldKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'local-test';
  t.after(() => {
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  });
  let error = new GoogleGenerativeAIFetchError('Invalid key', 400, '', [{ reason: 'API_KEY_INVALID' }]);
  t.mock.method(GoogleGenerativeAI.prototype, 'getGenerativeModel', () => ({
    generateContent: async () => { throw error; },
  }));
  await assert.rejects(transcribeAudioWithGemini('AAAA'), (e) =>
    e instanceof TranscriptionError && e.status === 503 && e.code === 'API_KEY_INVALID');
  error = new GoogleGenerativeAIFetchError('Unable to process input audio', 400);
  await assert.rejects(transcribeAudioWithGemini('AAAA'), (e) =>
    e instanceof TranscriptionError && e.status === 422 && e.code === 'GEMINI_INVALID_AUDIO');
});
