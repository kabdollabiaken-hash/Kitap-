// 生成 Kitap 图标（PNG）：/api/icon?size=192   /api/icon?size=512&maskable=1
const zlib = require('zlib');

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// 圆角矩形的有符号距离（里面为负）
function sdRound(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d)); // 1 像素的抗锯齿

function render(S, maskable) {
  const scale = maskable ? 0.56 : 0.62;
  const w = S * scale; const h = w * 0.82;
  const x0 = (S - w) / 2; const y0 = (S - h) / 2;
  const pw = w * 0.46; const gap = w * 0.08; const r = w * 0.05; const sw = w * 0.055;
  const pages = [[x0 + pw / 2, y0 + h / 2], [x0 + pw + gap + pw / 2, y0 + h / 2]];
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    for (let x = 0; x < S; x++) {
      const px = x + 0.5; const py = y + 0.5;
      // 底色：绿色（普通图标是圆角，maskable 铺满）
      let a = maskable ? 1 : cover(sdRound(px, py, S / 2, S / 2, S / 2, S / 2, S * 0.22));
      let R = 46; let G = 111; let B = 94;
      // 两页书：白色描边
      let ink = 0;
      for (const [cx, cy] of pages) {
        const d = Math.abs(sdRound(px, py, cx, cy, pw / 2, h / 2, r)) - sw / 2;
        ink = Math.max(ink, cover(d));
      }
      R = R + (255 - R) * ink; G = G + (255 - G) * ink; B = B + (255 - B) * ink;
      const o = y * (S * 4 + 1) + 1 + x * 4;
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

const cache = new Map();
module.exports = (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const size = [180, 192, 512].includes(+q.get('size')) ? +q.get('size') : 192;
  const maskable = q.get('maskable') === '1';
  const key = size + (maskable ? 'm' : '');
  if (!cache.has(key)) cache.set(key, render(size, maskable));
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(cache.get(key));
};
