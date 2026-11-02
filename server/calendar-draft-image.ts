import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';

export const MAX_PNG_BYTES = 2_621_440;
export const MAX_BRIDGE_BYTES = 4 * Math.ceil(MAX_PNG_BYTES / 3) + 4096;
const MAX_PIXELS = 16_000_000;

// Require canonical Base64: Buffer.from alone silently accepts malformed input.
export function decodeDraftPng(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0 ||
      value.length > 4 * Math.ceil(MAX_PNG_BYTES / 3) || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid Base64');
  }
  const png = Buffer.from(value, 'base64');
  if (png.length > MAX_PNG_BYTES || png.toString('base64') !== value) throw new Error('Invalid Base64');
  validatePng(png);
  return png;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePng(png: Buffer): void {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Not PNG');
  let offset = 8, width = 0, height = 0, depth = 0, channels = 0, interlace = 0;
  let sawHeader = false, sawPalette = false, sawData = false, endedData = false, sawEnd = false;
  const data: Buffer[] = [];
  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error('Truncated PNG');
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new Error('Truncated chunk');
    const type = png.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase() ||
        crc32(png.subarray(offset + 4, end - 4)) !== png.readUInt32BE(end - 4)) throw new Error('Invalid chunk');
    const chunk = png.subarray(offset + 8, end - 4);
    if (!sawHeader && type !== 'IHDR') throw new Error('Missing header');
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) throw new Error('Invalid header');
      sawHeader = true;
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8];
      const color = chunk[9];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
      interlace = chunk[12];
      if (!width || !height || width * height > MAX_PIXELS || !depths[color]?.includes(depth) ||
          chunk[10] !== 0 || chunk[11] !== 0 || interlace > 1) throw new Error('Unsupported PNG');
    } else if (type === 'PLTE') {
      if (sawPalette || sawData || !length || length % 3 || length > 768 ||
          [0, 4].includes(png[25]) || (png[25] === 3 && length / 3 > 2 ** depth)) throw new Error('Invalid palette');
      sawPalette = true;
    } else if (type === 'IDAT') {
      if (endedData || (png[25] === 3 && !sawPalette)) throw new Error('Invalid image data order');
      sawData = true; data.push(chunk);
    } else if (type === 'IEND') {
      if (!sawData || length !== 0 || end !== png.length) throw new Error('Invalid end');
      sawEnd = true;
    } else {
      if (type[0] === type[0].toUpperCase()) throw new Error('Unknown critical chunk');
      if (sawData) endedData = true;
    }
    offset = end;
  }
  if (!sawEnd) throw new Error('Missing end');
  // Bound decompression and validate scanline lengths/filters (including Adam7).
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows = passes.map(([x, y, dx, dy]) => {
    const w = Math.max(0, Math.ceil((width - x) / dx));
    const h = Math.max(0, Math.ceil((height - y) / dy));
    return { bytes: Math.ceil(w * channels * depth / 8), count: w ? h : 0 };
  });
  const expected = rows.reduce((sum, row) => sum + (row.bytes + 1) * row.count, 0);
  if (expected > 64 * 1024 * 1024) throw new Error('Decoded PNG too large');
  const compressed = Buffer.concat(data);
  // Node's info:true result is not modeled by the installed @types/node overload.
  const result = inflateSync(compressed, { maxOutputLength: expected + 1, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
  const inflated = result.buffer;
  if (result.engine.bytesWritten !== compressed.length) throw new Error('Trailing compressed data');
  if (inflated.length !== expected) throw new Error('Invalid scanlines');
  let rowOffset = 0;
  for (const row of rows) for (let i = 0; i < row.count; i++) {
    if (inflated[rowOffset] > 4) throw new Error('Invalid filter');
    rowOffset += row.bytes + 1;
  }
}

export function parseDraftMetadata(month: unknown, generatedAt: unknown): { yearMonth: string; generatedAt: string } {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      typeof generatedAt !== 'string' || (generatedAt !== '' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(generatedAt) ||
      !Number.isFinite(Date.parse(generatedAt))))) throw new Error('Invalid draft metadata');
  if (generatedAt !== '') {
    const [year, mon, day] = generatedAt.slice(0, 10).split('-').map(Number);
    const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (mon < 1 || mon > 12 || day < 1 || day > days[mon - 1]) throw new Error('Invalid date');
  }
  return { yearMonth: month, generatedAt: generatedAt === '' ? '' : new Date(generatedAt).toISOString() };
}
