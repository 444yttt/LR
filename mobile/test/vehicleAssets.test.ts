// Checks the vehicle PNGs themselves: format, framing, alpha cleanliness, and that geometry/credits match the files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { carAspect, carPixels, profiles, shadows } from '../src/vehicleGeometry.ts';
import { vehicleCredits } from '../src/credits.ts';

const dir = new URL('../assets/vehicles/', import.meta.url).pathname;
const files = ['range-rover-l460.png', 'ferrari-296.png', 'bmw-x7.png'];

/** Minimal decoder for 8-bit, non-interlaced RGBA PNGs (what the asset pipeline writes). */
function decode(path: string) {
  const buf = readFileSync(path);
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  let offset = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset), type = buf.subarray(offset + 4, offset + 8).toString();
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; color = data[9]; interlace = data[12]; }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  assert.equal(depth, 8); assert.equal(color, 6, 'RGBA'); assert.equal(interlace, 0);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4, px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= 4 && y ? px[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      px[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { width, height, px, alpha: (x: number, y: number) => px[(y * width + x) * 4 + 3] };
}

const images = files.map(file => decode(dir + file));

test('vehicle PNGs exist, the M4 asset is gone, and sizes match the stage geometry', () => {
  assert.equal(existsSync(dir + '../bmw-m4.png'), false);
  images.forEach((image, i) => {
    assert.deepEqual([image.width, image.height], carPixels[i], files[i]);
    for (const box of [profiles[0][i], profiles[1][i]]) assert.ok(Math.abs(box.w / box.h - carAspect[i]) < 0.01, files[i] + ' box aspect');
    for (const mode of [0, 1]) {
      const car = profiles[mode][i], shadow = shadows[mode][i];
      assert.ok(shadow.x > car.x - 8 && shadow.x + shadow.w < car.x + car.w + 8, files[i] + ' shadow under the car');
    }
  });
});

test('alpha is clean: transparent corners, tight crop, one blob, no light halo', () => {
  images.forEach(({ width: w, height: h, px, alpha }, i) => {
    const name = files[i];
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) assert.equal(alpha(x, y), 0, `${name} corner ${x},${y}`);
    const rowHas = (y: number) => { for (let x = 0; x < w; x++) if (alpha(x, y) > 0) return true; return false; };
    const colHas = (x: number) => { for (let y = 0; y < h; y++) if (alpha(x, y) > 0) return true; return false; };
    assert.ok(rowHas(0) && rowHas(h - 1) && colHas(0) && colHas(w - 1), name + ' tight crop');
    // Connected components on alpha > 0 (4-neighbour flood fill): everything belongs to the car.
    const seen = new Uint8Array(w * h);
    let blobs = 0, largest = 0, total = 0;
    for (let start = 0; start < w * h; start++) {
      if (seen[start] || px[start * 4 + 3] === 0) continue;
      blobs++; let size = 0; const stack = [start]; seen[start] = 1;
      while (stack.length) {
        const k = stack.pop()!; size++;
        const x = k % w, y = (k - x) / w;
        for (const n of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) {
          if (n >= 0 && !seen[n] && px[n * 4 + 3] > 0) { seen[n] = 1; stack.push(n); }
        }
      }
      total += size; largest = Math.max(largest, size);
    }
    assert.ok(largest / total > 0.9995, `${name}: ${blobs} blobs, ${total - largest} px outside the car`);
    // Halo: the anti-aliased fringe (alpha < 160) must carry the car's colour, not the photo's background. Compare each
    // fringe pixel with the mean of the opaque pixels in its 7×7 neighbourhood. Before the edge pass the photos had
    // 7–12 % of fringe pixels off by more than 60 luminance levels; after it, under 3 %.
    let fringe = 0, off = 0;
    const lum = (k: number) => 0.2126 * px[k * 4] + 0.7152 * px[k * 4 + 1] + 0.0722 * px[k * 4 + 2];
    for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
      const k = y * w + x, a = px[k * 4 + 3];
      if (a === 0 || a >= 160) continue;
      let sum = 0, n = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const j = k + dy * w + dx; if (px[j * 4 + 3] === 255) { sum += lum(j); n++; } }
      if (!n) continue;
      fringe++;
      if (Math.abs(lum(k) - sum / n) > 60) off++;
    }
    assert.ok(fringe > 1000, name + ' has anti-aliased edges');
    assert.ok(off / fringe < 0.04, `${name}: ${off}/${fringe} fringe pixels differ from the car next to them`);
  });
});

test('every vehicle image is credited in the app and in ATTRIBUTION.md', () => {
  const record = readFileSync(dir + 'ATTRIBUTION.md', 'utf8');
  assert.deepEqual(vehicleCredits.map(credit => credit.file), files);
  for (const credit of vehicleCredits) {
    assert.ok(record.includes('## ' + credit.file), credit.file);
    assert.ok(record.includes(credit.source), credit.file + ' source');
    assert.ok(record.includes(credit.author), credit.file + ' author');
  }
});
