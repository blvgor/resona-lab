// Ribbon thumbnails: a still "sand" picture of a preset, painted on the CPU from a small field grid.
// Moved from renderer.js paintPreview; the edges are cut like the engine's edge rule, so no frame of sand.
import { createField, naturalFrequency, sampleGrid } from './physics.js';
import { hexToRgb } from './palettes.js';

export const THUMB = Object.freeze({
  FIELD_SIZE: 80,
  EDGE: 0.04,          // plate edges are nodal lines; leave them empty
  LINE_PX: 2.1,        // half-width of a nodal line, in thumbnail pixels
  SEED: 73
});

function random(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function paintThumb(canvas, preset, plate, colors = { background: '#090a09', sand: '#e7d7b1' }) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const frequency = naturalFrequency(preset.m, preset.n, plate);
  const field = createField(preset, plate, frequency, plate.damping ?? 0.015, preset.mix, THUMB.FIELD_SIZE, false);
  const bg = hexToRgb(colors.background), sand = hexToRgb(colors.sand), rnd = random(THUMB.SEED);
  const image = ctx.createImageData(size, size);
  const lo = THUMB.EDGE, hi = 1 - THUMB.EDGE, sharpness = (size / THUMB.LINE_PX) ** 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = (x + 0.5) / size, sy = (y + 0.5) / size, j = (y * size + x) * 4, r = rnd();
    let intensity = 0;
    if (sx > lo && sx < hi && sy > lo && sy < hi) {
      const value = sampleGrid(field.values, field.size, sx, sy);
      const gradient = Math.hypot(sampleGrid(field.gx, field.size, sx, sy), sampleGrid(field.gy, field.size, sx, sy));
      // Distance to the nearest node by one Newton step on u: u / |∇u| (×2 for u ≈ w²).
      const distance = 2 * value / (gradient + 1e-6);
      const prob = Math.exp(-distance * distance * sharpness);
      intensity = Math.min(1, prob * (0.45 + r * 0.75) + (r > 0.993 ? 0.12 : 0));
    }
    for (let k = 0; k < 3; k++) image.data[j + k] = Math.round(bg[k] + (sand[k] - bg[k]) * intensity);
    image.data[j + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
