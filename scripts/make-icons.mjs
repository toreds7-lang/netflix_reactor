// Generates public/icon/{16,32,48,128}.png: a red rounded tile with two subtitle lines.
// Run with: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shapes in a 0..1 unit square.
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

function sample(x, y) {
  if (!inRoundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.22)) return null;
  if (inRoundRect(x, y, 0.18, 0.5, 0.82, 0.62, 0.06)) return [255, 255, 255];
  if (inRoundRect(x, y, 0.28, 0.7, 0.72, 0.8, 0.05)) return [255, 214, 102];
  // play triangle
  if (x > 0.4 && x < 0.62 && y > 0.18 && y < 0.42 && Math.abs(y - 0.3) < (x - 0.4) * -0.55 + 0.12) return [255, 255, 255];
  return [229, 9, 20];
}

mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const SS = 4;
  const data = png(size, (px, py) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < SS; i++) {
      for (let j = 0; j < SS; j++) {
        const c = sample((px + (i + 0.5) / SS) / size, (py + (j + 0.5) / SS) / size);
        if (c) {
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
    }
    if (!a) return [0, 0, 0, 0];
    return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / (SS * SS)) * 255)];
  });
  writeFileSync(`public/icon/${size}.png`, data);
}
console.log('icons written to public/icon/');
