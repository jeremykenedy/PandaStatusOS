'use strict';
/*
 * A PNG reader, because the pixel harnesses need the buffer Playwright hands back and this
 * tree ships no image library. Eight-bit only, which is what Chromium's screenshots are, and
 * every filter type, because a screenshot uses all of them.
 *
 * Inflate comes from node's own zlib. Everything else here is the unfilter loop from the PNG
 * specification: each scanline is reconstructed from the one above it, so the whole image has
 * to be walked in order and a single wrong byte shifts every row after it.
 *
 *   const { decode } = require('./png');
 *   const img = decode(await page.screenshot());     // { w, h, ch, data }
 *   const i = (y * img.w + x) * img.ch;              // data[i], data[i+1], data[i+2]
 */
const zlib = require('zlib');

function decode(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error('bit depth ' + depth + ', only 8 is read here');
  if (interlace) throw new Error('interlaced PNG');
  const ch = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[colour];
  if (!ch) throw new Error('colour type ' + colour);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let prev = Buffer.alloc(stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    const line = Buffer.from(raw.slice(q, q + stride)); q += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[x] = v & 255;
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { w, h, ch, data: out };
}

module.exports = { decode };
