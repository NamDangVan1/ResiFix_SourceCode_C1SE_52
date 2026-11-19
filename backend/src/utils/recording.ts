/** Identify Expo recorder containers from the bytes; native Blob.type can be generic. */
export function recordingMimeType(audio: Buffer, declared: string): string | null {
  if (audio.length < 12) return null;
  if (audio.toString('ascii', 4, 8) === 'ftyp') {
    // A short or interrupted MP4 can have headers but no recorded media.
    let offset = 0;
    let hasAudio = false;
    let hasMetadata = false;
    while (offset + 8 <= audio.length) {
      const size = audio.readUInt32BE(offset);
      const type = audio.toString('ascii', offset + 4, offset + 8);
      let header = 8;
      let length = size || audio.length - offset;
      if (size === 1) {
        if (offset + 16 > audio.length) return null;
        length = Number(audio.readBigUInt64BE(offset + 8));
        header = 16;
      }
      if (length < header || length > audio.length - offset) return null;
      if (type === 'mdat' && length > header) hasAudio = true;
      if (type === 'moov' && length > header) hasMetadata = true;
      offset += length;
    }
    return offset === audio.length && hasAudio && hasMetadata ? 'audio/mp4' : null;
  }
  if (audio.readUInt32BE(0) === 0x1a45dfa3) return 'audio/webm';
  if (audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE') {
    const end = 8 + audio.readUInt32LE(4);
    if (end > audio.length) return null;
    for (let offset = 12; offset + 8 <= end;) {
      const size = audio.readUInt32LE(offset + 4);
      if (offset + 8 + size > end) return null;
      if (audio.toString('ascii', offset, offset + 4) === 'data' && size > 0) return 'audio/wav';
      offset += 8 + size + (size % 2);
    }
    return null;
  }
  if (audio.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (audio.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
  // Raw AAC and MP3 can start with a frame sync instead of container metadata.
  if (audio[0] === 0xff && (audio[1] & 0xf6) === 0xf0) return 'audio/aac';
  if (audio.toString('ascii', 0, 3) === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return /^audio\/(pcm|l16)$/.test(declared) ? declared : null;
}
