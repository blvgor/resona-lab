// The law of sand motion, shared by the CPU (tests, previews) and the GPU (SAND_GLSL).
// The field is analytic: w(x, y) = Σ (re + i·im) · sin(mπx) · sin(nπy), x, y ∈ [0, 1] over the plate.
// Sand drifts down the gradient of u = re² + im² towards nodal lines.

export const MAX_MODES = 16;

// Velocities are in normalized units per second. They are the old per-frame constants
// of advanceParticles (tuned at 60 Hz) multiplied by 60, so a 60 Hz step reproduces it exactly.
export const SAND = Object.freeze({
  STEP_MAX: 1.08,            // per-axis drift cap (was 0.018 per frame)
  GAIN_MAX: 42,              // cap of the gradient gain (was 0.7 per frame)
  NEWTON: 66,                // gain of the u/|∇u|² Newton-like step (was 1.1 per frame)
  EPSILON: 0.0002,           // keeps the Newton step finite at saddle points
  JITTER_SPREAD: 0.072,      // jitter per unit of `spread` (was 0.0012 per frame)
  JITTER_AMPLITUDE: 0.12,    // extra jitter ∝ √u, so sand on antinodes keeps dancing (was 0.002)
  JITTER_MAX: 0.12,          // cap of the √u jitter (was 0.002)
  REF_DT: 1 / 60,            // jitter is a random walk: it scales with √(REF_DT / dt)
  MIN_DT: 1 / 240            // floor for dt in the random-walk scaling
});

export function evalField(modes, x, y) {
  let re = 0, im = 0, reX = 0, reY = 0, imX = 0, imY = 0;
  const count = Math.min(modes.length, MAX_MODES);
  for (let i = 0; i < count; i++) {
    const { m, n, re: cr, im: ci } = modes[i];
    const kx = m * Math.PI, ky = n * Math.PI;
    const sx = Math.sin(kx * x), sy = Math.sin(ky * y);
    const b = sx * sy, bx = kx * Math.cos(kx * x) * sy, by = ky * sx * Math.cos(ky * y);
    re += cr * b; im += ci * b;
    reX += cr * bx; reY += cr * by;
    imX += ci * bx; imY += ci * by;
  }
  return { re, im, reX, reY, imX, imY };
}

// rnd: two uniform numbers in [0, 1) for the jitter; without it the result is the pure drift.
// dt: the integration step the caller will use (only the jitter depends on it).
export function sandVelocity(modes, x, y, { spread = 1.2, rnd = null, dt = SAND.REF_DT } = {}) {
  const f = evalField(modes, x, y);
  const u = f.re * f.re + f.im * f.im;
  const gx = 2 * (f.re * f.reX + f.im * f.imX);
  const gy = 2 * (f.re * f.reY + f.im * f.imY);
  const scale = Math.min(SAND.GAIN_MAX, u / (gx * gx + gy * gy + SAND.EPSILON) * SAND.NEWTON);
  const clampStep = v => Math.max(-SAND.STEP_MAX, Math.min(SAND.STEP_MAX, v));
  let vx = clampStep(-gx * scale), vy = clampStep(-gy * scale);
  if (rnd) {
    const jitter = (SAND.JITTER_SPREAD * spread + Math.min(SAND.JITTER_MAX, Math.sqrt(u) * SAND.JITTER_AMPLITUDE))
      * Math.sqrt(SAND.REF_DT / Math.max(dt, SAND.MIN_DT));
    vx += (rnd[0] - .5) * jitter;
    vy += (rnd[1] - .5) * jitter;
  }
  return { vx, vy, u };
}

// Packs modes into the layout of uModesA / uModesB: vec4(m, n, re, im) × MAX_MODES.
export function packModes(modes) {
  const count = Math.min(modes.length, MAX_MODES), data = new Float32Array(MAX_MODES * 4);
  for (let i = 0; i < count; i++) data.set([modes[i].m, modes[i].n, modes[i].re, modes[i].im], i * 4);
  return { data, count };
}

const glslFloat = v => {
  const s = String(v);
  return /[.e]/.test(s) ? s : `${s}.0`;
};

const constants = Object.entries(SAND).map(([name, value]) => `const float SAND_${name} = ${glslFloat(value)};`).join('\n');

// GLSL ES 3.00 fragment for the sand update and background passes. Needs highp: mode arguments reach 9π.
export const SAND_GLSL = `
precision highp float;
precision highp int;

uniform vec4 uModesA[${MAX_MODES}];
uniform vec4 uModesB[${MAX_MODES}];
uniform int uCountA;
uniform int uCountB;
uniform float uMorph;

const float SAND_PI = 3.141592653589793;
${constants}

// w = (re, im); d = (reX, reY, imX, imY)
void sandAddMode(vec4 md, vec2 p, inout vec2 w, inout vec4 d) {
  vec2 k = md.xy * SAND_PI;
  vec2 s = sin(k * p);
  vec2 c = cos(k * p);
  float b = s.x * s.y;
  float bx = k.x * c.x * s.y;
  float by = k.y * s.x * c.y;
  w += md.zw * b;
  d += vec4(md.z * bx, md.z * by, md.w * bx, md.w * by);
}

// The two sets are blended on re/im (before squaring), so a morph is a real field, not a cross-fade of energies.
void sandField(vec2 p, out vec2 w, out vec4 d) {
  vec2 wa = vec2(0.0), wb = vec2(0.0);
  vec4 da = vec4(0.0), db = vec4(0.0);
  if (uMorph < 1.0) {
    for (int i = 0; i < ${MAX_MODES}; i++) { if (i >= uCountA) break; sandAddMode(uModesA[i], p, wa, da); }
  }
  if (uMorph > 0.0) {
    for (int i = 0; i < ${MAX_MODES}; i++) { if (i >= uCountB) break; sandAddMode(uModesB[i], p, wb, db); }
  }
  w = mix(wa, wb, uMorph);
  d = mix(da, db, uMorph);
}

vec2 fieldRI(vec2 p) {
  vec2 w;
  vec4 d;
  sandField(p, w, d);
  return w;
}

float fieldU(vec2 p) {
  vec2 w = fieldRI(p);
  return dot(w, w);
}

// rnd: two uniform numbers in [0, 1); dt: the step the caller integrates with, in seconds.
vec2 sandVelocity(vec2 p, float spread, vec2 rnd, float dt) {
  vec2 w;
  vec4 d;
  sandField(p, w, d);
  float u = dot(w, w);
  vec2 g = 2.0 * vec2(w.x * d.x + w.y * d.z, w.x * d.y + w.y * d.w);
  float scale = min(SAND_GAIN_MAX, u / (dot(g, g) + SAND_EPSILON) * SAND_NEWTON);
  vec2 v = clamp(-g * scale, -SAND_STEP_MAX, SAND_STEP_MAX);
  float jitter = (SAND_JITTER_SPREAD * spread + min(SAND_JITTER_MAX, sqrt(u) * SAND_JITTER_AMPLITUDE))
    * sqrt(SAND_REF_DT / max(dt, SAND_MIN_DT));
  return v + (rnd - 0.5) * jitter;
}
`;
