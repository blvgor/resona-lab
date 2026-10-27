// WebGL2 engine: hundreds of thousands of sand grains simulated on the GPU, plus the background pass.
// Grain state lives in float textures (ping-pong): [x, y, vx, vy] and [slot, weight, offX, offY].
// Positions are normalized window coordinates (y down); free velocities are normalized units per second.
// The field and the drift law come from sand.js (SAND_GLSL), evaluated in plate coordinates.
import { SAND_GLSL, MAX_MODES, packModes } from './sand.js';
import { PALETTES, hexToRgb } from './palettes.js';

export const ENGINE = Object.freeze({
  TEX_WIDTH: 1024,
  DEFAULT_COUNT: 160000,
  MIN_COUNT: 1000,
  MAX_COUNT: 1000000,
  MAX_DT: 1 / 30,           // the jitter is a random walk tuned for dt ≤ 1/30 (see sand.js)
  MAX_PIECES: 8,
  MAX_SHOCKS: 4,
  FRICTION: 3.2,            // decay of the free (thrown) velocity, 1/s
  MAX_SPEED: 6,             // screen heights per second
  FLIGHT_DRIFT: 2.5,        // a fast grain feels the field less, so a burst looks ballistic
  BREAK_RADIUS: 0.07,       // short sides, at full strength ×1.4
  BREAK_PUSH: 0.55,         // along the swipe, share of the pointer speed
  BREAK_SPLASH: 0.45,       // away from the swipe line
  BREAK_SCATTER: 0.5,       // random part
  FOLLOW_RATE: 55,          // how fast a grain of a piece catches its target, 1/s at weight 1
  RUBBER: 1.8,              // a grab takes grains up to RUBBER × radius, weight 1 → 0 past the core
  TEAR_START: 0.1,          // rubber stretched this far behind its target starts to let go (screen heights)
  TEAR_END: 0.24,           // …and is fully torn off here; the rigid core never tears
  SHOCK_SEC: 1.2,
  SHOCK_RADIUS: 0.9,        // final ring radius, in screen heights × max(aspect, 1)
  SHOCK_WIDTH: 0.045,
  SHOCK_PUSH: 0.65,         // grains on the front are kicked to this share of the front speed, so it overtakes them
  EDGE_MARGIN: 0.025,       // plate edges are nodal lines: grains closer than this respawn inside
  RESPAWN_MIN: 0.07,
  RESPAWN_MAX: 0.93,
  RESPAWN_SPEED: 0.12,      // a grain still flying faster than this is not respawned yet
  DUST_SHARE: 0.045,        // grains that ignore the field and only tremble, like the old version
  DUST_JITTER: 0.018,
  AGITATE_RATE: 1.8,        // during a morph to a different figure, kicks per grain per second at the peak
  AGITATE_SPEED: 0.8,       // kick speed, screen heights per second: the sand jumps, as on a real plate
  GATHER_SEC: 1.6,          // after a scatter the field gain ramps up, so the figure "sounds" into place
  GATHER_FLOOR: 0.25,
  POINT_SCALE: 1.35,
  POINT_ALPHA: 0.48,
  OUTSIDE_DIM: 0.45,        // background outside a non-full plate
  FPS_SMOOTHING: 0.05
});

const VIEWS = { sand: 0, contours: 1, field: 2 };
const SAND_PALETTE = PALETTES[0];

// The largest rectangle of the given on-screen proportion (w/h) centered in a window of aspect w/h.
export function plateRect(windowAspect, proportion) {
  if (proportion === 'screen' || !(proportion > 0) || !(windowAspect > 0)) return { x: 0, y: 0, w: 1, h: 1 };
  const w = proportion >= windowAspect ? 1 : proportion / windowAspect;
  const h = proportion >= windowAspect ? windowAspect / proportion : 1;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

// One mode set equal to (1 - t)·a + t·b (the field is linear in the coefficients), trimmed to the strongest MAX_MODES.
export function blendModes(a, b, t) {
  const sum = new Map();
  const add = (list, k) => {
    if (!k) return;
    for (const { m, n, re, im } of list) {
      const key = `${m},${n}`, md = sum.get(key) || { m, n, re: 0, im: 0 };
      md.re += re * k; md.im += im * k;
      sum.set(key, md);
    }
  };
  add(a, 1 - t); add(b, t);
  return [...sum.values()]
    .filter(md => md.re !== 0 || md.im !== 0)
    .sort((p, q) => Math.hypot(q.re, q.im) - Math.hypot(p.re, p.im))
    .slice(0, MAX_MODES);
}

// width/height are the window in CSS pixels; scale 1|2 multiplies them, longSide (e.g. 3840) wins over scale.
export function snapshotSize({ width, height, scale = 1, longSide = null, max = Infinity }) {
  let k = longSide ? longSide / Math.max(width, height) : scale;
  k = Math.min(k, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

// 0 for proportional mode sets, 1 for sets with nothing in common (1 − |⟨a, b⟩| / ‖a‖‖b‖ over complex coefficients).
export function modeDistance(a, b) {
  const key = md => `${md.m},${md.n}`;
  const index = new Map(b.map(md => [key(md), md]));
  let re = 0, im = 0, na = 0, nb = 0;
  for (const md of a) {
    na += md.re * md.re + md.im * md.im;
    const o = index.get(key(md));
    if (o) { re += md.re * o.re + md.im * o.im; im += md.re * o.im - md.im * o.re; }
  }
  for (const md of b) nb += md.re * md.re + md.im * md.im;
  if (!(na > 0) || !(nb > 0)) return na === nb ? 0 : 1;
  return Math.max(0, Math.min(1, 1 - Math.hypot(re, im) / Math.sqrt(na * nb)));
}

function engineError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const glslFloat = v => (Number.isInteger(v) ? `${v}.0` : String(v));
const ENGINE_CONSTANTS = Object.entries(ENGINE)
  .filter(([, v]) => typeof v === 'number')
  .map(([k, v]) => `const float E_${k} = ${glslFloat(v)};`).join('\n');

const HASH_GLSL = `
uint hashU(uint x) {
  x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16;
  return x;
}
float hashF(uint x) { return float(hashU(x) >> 8) / 16777216.0; }
`;

const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared by the update and init passes: the static traits of a grain come from its index.
const GRAIN_GLSL = `
uniform int uTexWidth;
uint grainIndex() { ivec2 tc = ivec2(gl_FragCoord.xy); return uint(tc.y * uTexWidth + tc.x); }
bool isDust(uint index) { return hashF(index * 747796405U + 2891336453U) < E_DUST_SHARE; }
`;

const UPDATE_FS = `#version 300 es
${SAND_GLSL}
${ENGINE_CONSTANTS}
${HASH_GLSL}
${GRAIN_GLSL}
uniform sampler2D uState;
uniform sampler2D uMark;
uniform float uDt;
uniform uint uSeed;
uniform float uAspect;
uniform vec4 uPlate;
uniform float uSpread;
uniform float uFieldGain;
uniform vec4 uPieces[${ENGINE.MAX_PIECES}];   // cx, cy, angle, weight
uniform vec4 uBreakSeg;                       // ax, ay, bx, by
uniform vec4 uBreakVel;                       // vx, vy, strength, active
uniform vec4 uShocks[${ENGINE.MAX_SHOCKS}];   // x, y, age, active
uniform float uAgitate;                       // 0..1: the field is changing into a different figure
layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outMark;

void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  uint index = grainIndex();
  vec4 s = texelFetch(uState, tc, 0);
  vec4 mk = texelFetch(uMark, tc, 0);
  vec2 p = s.xy, v = s.zw;
  uint k = hashU(index ^ (uSeed * 0x9E3779B9U));
  vec2 rnd = vec2(hashF(k), hashF(k ^ 0x68bc21ebU));
  vec2 rnd2 = vec2(hashF(k + 0x2545F491U), hashF(k + 0x4F6CDD1DU));
  vec2 sp = vec2(uAspect, 1.0);               // normalized → screen space
  float shortSide = min(uAspect, 1.0);

  // Piece membership: grain follows (cx, cy) + rot(angle)·offset, with strength mark weight × piece weight.
  float eff = 0.0;
  vec2 target = p;
  int slot = int(floor(mk.x + 0.5));
  if (slot >= 0 && slot < ${ENGINE.MAX_PIECES}) {
    vec4 pc = uPieces[slot];
    eff = clamp(mk.y * pc.w, 0.0, 1.0);
    float c = cos(pc.z), sn = sin(pc.z);
    vec2 o = vec2(c * mk.z - sn * mk.w, sn * mk.z + c * mk.w);
    target = pc.xy + o / sp;
    if (mk.y < 0.97) eff *= 1.0 - smoothstep(E_TEAR_START, E_TEAR_END, length((target - p) * sp));
  }
  float freeShare = 1.0 - eff;
  vec2 vs = v * sp;                           // free velocity in screen space

  // Break: a capsule along the pointer path of this frame.
  if (uBreakVel.w > 0.5) {
    vec2 a = uBreakSeg.xy * sp, b = uBreakSeg.zw * sp, q = p * sp, ab = b - a;
    float t = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-10), 0.0, 1.0);
    vec2 dq = q - (a + ab * t);
    float d = length(dq);
    float r = E_BREAK_RADIUS * shortSide * (0.6 + 0.8 * uBreakVel.z);
    if (d < r) {
      float f = 1.0 - d / r;
      f = f * f * (3.0 - 2.0 * f);
      vec2 pv = uBreakVel.xy * sp;
      float speed = length(pv);
      vec2 dir = speed > 1e-6 ? pv / speed : vec2(0.0);
      vec2 side = d > 1e-6 ? dq / d : vec2(-dir.y, dir.x) * sign(rnd.x - 0.5);
      vec2 imp = dir * speed * E_BREAK_PUSH * (0.4 + 1.2 * rnd2.x)
        + side * speed * E_BREAK_SPLASH * rnd2.y
        + (rnd - 0.5) * speed * E_BREAK_SCATTER;
      vs += imp * f * freeShare;
    }
  }

  // Shock rings: grains on the front are carried outwards at about the front speed.
  float ringMax = E_SHOCK_RADIUS * max(uAspect, 1.0);
  for (int i = 0; i < ${ENGINE.MAX_SHOCKS}; i++) {
    vec4 sh = uShocks[i];
    if (sh.w < 0.5) continue;
    float kk = clamp(sh.z / E_SHOCK_SEC, 0.0, 1.0);
    float radius = ringMax * (1.0 - (1.0 - kk) * (1.0 - kk));
    float frontSpeed = 2.0 * ringMax * (1.0 - kk) / E_SHOCK_SEC;
    vec2 dq = p * sp - sh.xy * sp;
    float d = length(dq);
    if (d < 1e-6) continue;
    float band = exp(-pow((d - radius) / (E_SHOCK_WIDTH + 0.05 * kk), 2.0));
    vec2 n = dq / d;
    float want = frontSpeed * E_SHOCK_PUSH * band * freeShare;
    float vr = dot(vs, n);
    if (vr < want) vs += n * (want - vr) * min(1.0, uDt * 30.0);
  }

  // A changing figure makes grains jump, so sand resting on a nodal line shared by both figures redistributes.
  if (uAgitate > 0.0 && hashF(k ^ 0x1B873593U) < uAgitate * E_AGITATE_RATE * uDt) {
    float ang = hashF(k ^ 0x85EBCA6BU) * 6.2831853;
    vs += vec2(cos(ang), sin(ang)) * E_AGITATE_SPEED * (0.4 + rnd.y) * freeShare;
  }

  vs *= exp(-E_FRICTION * uDt);
  float speed = length(vs);
  if (speed > E_MAX_SPEED) { vs *= E_MAX_SPEED / speed; speed = E_MAX_SPEED; }

  // Field drift in plate coordinates.
  vec2 pp = (p - uPlate.xy) / uPlate.zw;
  bool inside = all(greaterThanEqual(pp, vec2(0.0))) && all(lessThanEqual(pp, vec2(1.0)));
  vec2 drift = vec2(0.0);
  if (inside) {
    if (isDust(index)) {
      drift = (rnd - 0.5) * E_DUST_JITTER * sqrt(SAND_REF_DT / max(uDt, SAND_MIN_DT));
    } else {
      drift = sandVelocity(pp, uSpread, rnd, uDt) * uPlate.zw * uFieldGain;
    }
    drift /= 1.0 + speed * E_FLIGHT_DRIFT;
  }
  vec2 next = p + (drift * freeShare + vs / sp) * uDt;

  if (eff > 0.0) {
    float follow = 1.0 - exp(-uDt * E_FOLLOW_RATE * eff);
    follow = mix(follow, 1.0, smoothstep(0.85, 1.0, eff));   // the core is rigid
    next = mix(next, target, follow);
    vs *= 1.0 - follow;
  }

  // Plate edges are nodal lines: a free grain that reaches the margin (or leaves the plate) and has
  // slowed down is thrown back into the middle, as the old advanceParticles did.
  vec2 np = (next - uPlate.xy) / uPlate.zw;
  bool nearEdge = any(lessThan(np, vec2(E_EDGE_MARGIN))) || any(greaterThan(np, vec2(1.0 - E_EDGE_MARGIN)));
  bool broken = any(isnan(next)) || any(isinf(next));
  if (broken || (eff <= 0.0 && nearEdge && length(vs) < E_RESPAWN_SPEED)) {
    next = uPlate.xy + uPlate.zw * mix(vec2(E_RESPAWN_MIN), vec2(E_RESPAWN_MAX), rnd2);
    vs = vec2(0.0);
  }
  outState = vec4(next, vs / sp);
  outMark = mk;
}`;

// Copies the first uOldCount grains from the previous textures and scatters the rest over the plate.
const INIT_FS = `#version 300 es
precision highp float;
precision highp int;
${ENGINE_CONSTANTS}
${HASH_GLSL}
${GRAIN_GLSL}
uniform sampler2D uState;
uniform sampler2D uMark;
uniform int uOldCount;
uniform uint uSeed;
uniform vec4 uPlate;
layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outMark;
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  uint index = grainIndex();
  if (int(index) < uOldCount) {
    outState = texelFetch(uState, tc, 0);
    outMark = texelFetch(uMark, tc, 0);
    return;
  }
  uint k = hashU(index ^ (uSeed * 0x9E3779B9U));
  vec2 r = vec2(hashF(k), hashF(k ^ 0x68bc21ebU));
  float lo = E_EDGE_MARGIN + 0.005;
  outState = vec4(uPlate.xy + uPlate.zw * mix(vec2(lo), vec2(1.0 - lo), r), 0.0, 0.0);
  outMark = vec4(-1.0, 0.0, 0.0, 0.0);
}`;

// Grab marks grains around a point; release clears a slot. State passes through untouched.
const MARK_FS = `#version 300 es
precision highp float;
precision highp int;
${ENGINE_CONSTANTS}
uniform sampler2D uState;
uniform sampler2D uMark;
uniform float uAspect;
uniform vec4 uGrab;       // x, y, radius (screen), slot
uniform float uGrabbing;  // 1 grab, 0 release
layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outMark;
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, tc, 0);
  vec4 mk = texelFetch(uMark, tc, 0);
  outState = s;
  float slot = uGrab.w;
  if (abs(mk.x - slot) < 0.5) mk = vec4(-1.0, 0.0, 0.0, 0.0);
  if (uGrabbing > 0.5) {
    vec2 off = (s.xy - uGrab.xy) * vec2(uAspect, 1.0);
    float d = length(off), r = uGrab.z;
    float w = 1.0 - smoothstep(r, r * E_RUBBER, d);
    float current = mk.x >= 0.0 ? mk.y : 0.0;
    if (w > 0.001 && w > current) mk = vec4(slot, w, off);
  }
  outMark = mk;
}`;

const POINTS_VS = `#version 300 es
precision highp float;
precision highp int;
${ENGINE_CONSTANTS}
${HASH_GLSL}
uniform sampler2D uState;
uniform int uTexWidth;
uniform float uSize;
out float vLight;
void main() {
  int i = gl_VertexID;
  vec4 s = texelFetch(uState, ivec2(i % uTexWidth, i / uTexWidth), 0);
  uint h = hashU(uint(i) * 2654435761U + 0x165667B1U);
  vLight = 0.3 + 0.7 * hashF(h);
  float w = hashF(h ^ 0x5bd1e995U);
  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0);
  gl_PointSize = max(1.0, uSize * (0.65 + w * 0.7));
}`;

const POINTS_FS = `#version 300 es
precision mediump float;
${ENGINE_CONSTANTS}
uniform vec3 uColor;
uniform float uExposure;
in float vLight;
out vec4 outColor;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = (1.0 - smoothstep(0.12, 0.5, length(p))) * E_POINT_ALPHA;
  outColor = vec4(min(uColor * vLight * uExposure, vec3(1.0)), a);
}`;

const BACKGROUND_FS = `#version 300 es
${SAND_GLSL}
${ENGINE_CONSTANTS}
uniform vec2 uResolution;
uniform vec4 uPlate;
uniform float uAspect;
uniform int uView;
uniform vec3 uBackground;
uniform vec3 uSand;
uniform vec3 uGlow[3];
uniform float uGlowAmount;
uniform float uPhase;
uniform float uTransparent;
uniform float uFullPlate;
uniform float uPx;                          // device pixels per CSS pixel
uniform vec4 uShocks[${ENGINE.MAX_SHOCKS}];
out vec4 outColor;

vec3 glow(float t) {
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(uGlow[0], uGlow[1], t * 2.0) : mix(uGlow[1], uGlow[2], (t - 0.5) * 2.0);
}

float line(float s, float level, float fw, float widthPx) {
  return 1.0 - smoothstep(0.5 * widthPx, 0.5 * widthPx + 1.0, abs(s - level) / max(fw, 1e-6));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  uv.y = 1.0 - uv.y;
  vec2 pp = (uv - uPlate.xy) / uPlate.zw;
  bool inside = all(greaterThanEqual(pp, vec2(0.0))) && all(lessThanEqual(pp, vec2(1.0)));
  // Premultiplied colour over an opaque or transparent base.
  float baseA = 1.0 - uTransparent;
  vec4 col = vec4(uBackground * baseA, baseA);
  if (!inside) {
    col.rgb *= E_OUTSIDE_DIM;
  } else {
    bool needField = uGlowAmount > 0.0 || uView != 0;
    if (needField) {
      vec2 w = fieldRI(pp);
      if (uGlowAmount > 0.0) {
        float t = length(w);
        vec3 g = glow(t);
        float ga = mix(1.0, clamp(t, 0.0, 1.0), uTransparent);
        col = mix(col, vec4(g * ga, ga), uGlowAmount * (uView == 0 ? 1.0 : 0.6));
      }
      float s = dot(w, vec2(cos(uPhase), sin(uPhase)));
      if (uView == 1) {
        float fw = fwidth(s);
        float lw = 1.3 * uPx;
        float l = line(s, 0.0, fw, lw);
        float soft = max(max(line(s, 0.25, fw, lw * 0.7), line(s, -0.25, fw, lw * 0.7)),
                         max(line(s, 0.5, fw, lw * 0.7), line(s, -0.5, fw, lw * 0.7))) * 0.38;
        float a = max(l * 0.95, soft);
        col = col * (1.0 - a) + vec4(uSand * a, a);
      } else if (uView == 2) {
        vec3 warm = uSand;
        vec3 cold = vec3(75.0, 130.0, 173.0) / 255.0;
        float a = pow(min(1.0, abs(s)), 0.55) * 0.92;
        col = col * (1.0 - a) + vec4((s >= 0.0 ? warm : cold) * a, a);
      }
    }
  }
  // A faint rim marks a plate that does not fill the window.
  if (uFullPlate < 0.5) {
    vec2 px = uPlate.zw * uResolution;
    vec2 e = min(pp, 1.0 - pp) * px;
    float rim = (1.0 - smoothstep(0.0, 1.5 * uPx, abs(min(e.x, e.y)))) * 0.14;
    col = col * (1.0 - rim) + vec4(uSand * rim, rim);
  }
  // Expanding shock rings.
  float ringMax = E_SHOCK_RADIUS * max(uAspect, 1.0);
  for (int i = 0; i < ${ENGINE.MAX_SHOCKS}; i++) {
    vec4 sh = uShocks[i];
    if (sh.w < 0.5) continue;
    float k = clamp(sh.z / E_SHOCK_SEC, 0.0, 1.0);
    float radius = ringMax * (1.0 - (1.0 - k) * (1.0 - k));
    float d = length((uv - sh.xy) * vec2(uAspect, 1.0));
    float widthN = (2.0 + 10.0 * k) * uPx / uResolution.y;
    float a = exp(-pow((d - radius) / widthN, 2.0)) * (1.0 - k) * (1.0 - k) * 0.3;
    col = col * (1.0 - a) + vec4(uSand * a, a);
  }
  outColor = col;
}`;

export function createEngine(canvas, { count, onError } = {}) {
  let gl = null, lost = false;
  let programs = null, vao = null;
  let buffers = null, cur = 0, texHeight = 1;
  let grains = clampCount(count);
  let cssW = canvas.clientWidth || canvas.width || 1, cssH = canvas.clientHeight || canvas.height || 1, dpr = 1;
  let aspect = cssW / cssH;
  let plate = { x: 0, y: 0, w: 1, h: 1 };
  let look = {
    view: 'sand', background: SAND_PALETTE.background, sand: SAND_PALETTE.sand, glow: [...SAND_PALETTE.glow],
    glowAmount: SAND_PALETTE.glowAmount, grain: 1.2, exposure: 1, spread: 1.2, transparent: false
  };
  let colors = toColors(look);
  let modesA = [], modesB = [], morph = 0, morphSec = 1.2, agitation = 0;
  const pieceData = new Float32Array(ENGINE.MAX_PIECES * 4);
  let shocks = [];
  let pendingBreak = null, lastPointer = null;
  let seed = 1, gatherT = 0;
  let fpsValue = 0, lastFrameT = 0;

  function clampCount(n) {
    if (!Number.isFinite(n)) return ENGINE.DEFAULT_COUNT;
    return Math.round(Math.max(ENGINE.MIN_COUNT, Math.min(ENGINE.MAX_COUNT, n)));
  }

  function toColors(l) {
    const c = hex => hexToRgb(hex).map(v => v / 255);
    return { background: c(l.background), sand: c(l.sand), glow: l.glow.flatMap(c) };
  }

  function getContext() {
    const context = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance'
    });
    if (!context || !context.getExtension('EXT_color_buffer_float')) {
      throw engineError('WebGL2 with float textures is not available', 'NO_WEBGL2');
    }
    return context;
  }

  function compile(vsSource, fsSource) {
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw engineError(`Shader did not compile: ${log}`, 'SHADER');
      }
      return s;
    };
    const program = gl.createProgram();
    const vs = shader(gl.VERTEX_SHADER, vsSource), fs = shader(gl.FRAGMENT_SHADER, fsSource);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw engineError(`Program did not link: ${gl.getProgramInfoLog(program)}`, 'SHADER');
    }
    const locations = new Map();
    const loc = name => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name);
    };
    return { program, loc };
  }

  function makeTarget(height) {
    const texture = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ENGINE.TEX_WIDTH, height, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const state = texture(), mark = texture(), fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, mark, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
      throw engineError('The GPU cannot render to float textures', 'NO_WEBGL2');
    }
    return { state, mark, fbo, height };
  }

  function freeTarget(t) {
    gl.deleteTexture(t.state);
    gl.deleteTexture(t.mark);
    gl.deleteFramebuffer(t.fbo);
  }

  // Runs a full-texture pass reading buffers[cur] (or `from`) and writing into `to`.
  function particlePass(p, to, from = buffers[cur], setup = () => {}) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
    gl.viewport(0, 0, ENGINE.TEX_WIDTH, to.height);
    gl.disable(gl.BLEND);
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.state);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, from.mark);
    gl.uniform1i(p.loc('uState'), 0);
    gl.uniform1i(p.loc('uMark'), 1);
    gl.uniform1i(p.loc('uTexWidth'), ENGINE.TEX_WIDTH);
    setup(p);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const plateVec = () => [plate.x, plate.y, plate.w, plate.h];
  const nextSeed = () => (seed = (seed * 1664525 + 1013904223) >>> 0) || 1;

  // Reallocates for `grains`, keeping the first `keep` grains and scattering the rest.
  function allocate(keep) {
    const height = Math.ceil(grains / ENGINE.TEX_WIDTH);
    const old = buffers;
    const fresh = [makeTarget(height), makeTarget(height)];
    const source = old ? old[cur] : fresh[1];
    particlePass(programs.init, fresh[0], source, p => {
      gl.uniform1i(p.loc('uOldCount'), old ? Math.min(keep, old[cur].height * ENGINE.TEX_WIDTH) : 0);
      gl.uniform1ui(p.loc('uSeed'), nextSeed());
      gl.uniform4fv(p.loc('uPlate'), plateVec());
    });
    if (old) old.forEach(freeTarget);
    buffers = fresh;
    cur = 0;
    texHeight = height;
  }

  function setupGL() {
    gl = getContext();
    vao = gl.createVertexArray();
    programs = {
      update: compile(FULLSCREEN_VS, UPDATE_FS),
      init: compile(FULLSCREEN_VS, INIT_FS),
      mark: compile(FULLSCREEN_VS, MARK_FS),
      points: compile(POINTS_VS, POINTS_FS),
      background: compile(FULLSCREEN_VS, BACKGROUND_FS)
    };
    buffers = null;
    allocate(0);
    gatherT = 0;
  }

  function uploadModes(p) {
    const a = packModes(modesA), b = packModes(modesB);
    gl.uniform4fv(p.loc('uModesA'), a.data);
    gl.uniform4fv(p.loc('uModesB'), b.data);
    gl.uniform1i(p.loc('uCountA'), a.count);
    gl.uniform1i(p.loc('uCountB'), b.count);
    gl.uniform1f(p.loc('uMorph'), morph);
  }

  function shockData() {
    const data = new Float32Array(ENGINE.MAX_SHOCKS * 4);
    shocks.forEach((s, i) => data.set([s.x, s.y, s.age, 1], i * 4));
    return data;
  }

  function simulate(dt) {
    const next = buffers[1 - cur];
    const brk = pendingBreak;
    pendingBreak = null;
    const gain = ENGINE.GATHER_FLOOR + (1 - ENGINE.GATHER_FLOOR) * smooth(gatherT / ENGINE.GATHER_SEC);
    particlePass(programs.update, next, buffers[cur], p => {
      uploadModes(p);
      gl.uniform1f(p.loc('uDt'), dt);
      gl.uniform1ui(p.loc('uSeed'), nextSeed());
      gl.uniform1f(p.loc('uAspect'), aspect);
      gl.uniform4fv(p.loc('uPlate'), plateVec());
      gl.uniform1f(p.loc('uSpread'), look.spread);
      gl.uniform1f(p.loc('uFieldGain'), gain);
      gl.uniform4fv(p.loc('uPieces'), pieceData);
      gl.uniform4fv(p.loc('uShocks'), shockData());
      gl.uniform1f(p.loc('uAgitate'), morph > 0 ? agitation * Math.sin(Math.PI * Math.min(1, morph)) : 0);
      gl.uniform4fv(p.loc('uBreakSeg'), brk ? [brk.ax, brk.ay, brk.bx, brk.by] : [0, 0, 0, 0]);
      gl.uniform4fv(p.loc('uBreakVel'), brk ? [brk.vx, brk.vy, brk.strength, 1] : [0, 0, 0, 0]);
    });
    cur = 1 - cur;
  }

  // Phase of the strongest coefficient of the visible field, for the signed contour/field views.
  function phase() {
    const set = morph > 0 ? blendModes(modesA, modesB, morph) : modesA;
    return set.length ? Math.atan2(set[0].im, set[0].re) : 0;
  }

  // Draws background and sand into the bound framebuffer of size w×h; pxScale = device px per CSS px.
  function render(w, h, pxScale, transparent) {
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    const bg = programs.background;
    gl.useProgram(bg.program);
    uploadModes(bg);
    gl.uniform2f(bg.loc('uResolution'), w, h);
    gl.uniform4fv(bg.loc('uPlate'), plateVec());
    gl.uniform1f(bg.loc('uAspect'), aspect);
    gl.uniform1i(bg.loc('uView'), VIEWS[look.view] ?? 0);
    gl.uniform3fv(bg.loc('uBackground'), colors.background);
    gl.uniform3fv(bg.loc('uSand'), colors.sand);
    gl.uniform3fv(bg.loc('uGlow'), colors.glow);
    gl.uniform1f(bg.loc('uGlowAmount'), look.glowAmount);
    gl.uniform1f(bg.loc('uPhase'), phase());
    gl.uniform1f(bg.loc('uTransparent'), transparent ? 1 : 0);
    gl.uniform1f(bg.loc('uFullPlate'), plate.x <= 0 && plate.y <= 0 && plate.w >= 1 && plate.h >= 1 ? 1 : 0);
    gl.uniform1f(bg.loc('uPx'), pxScale);
    gl.uniform4fv(bg.loc('uShocks'), shockData());
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (look.view !== 'sand') return;
    const pt = programs.points;
    gl.useProgram(pt.program);
    gl.enable(gl.BLEND);
    // Colour blends as usual; alpha accumulates, so the framebuffer stays premultiplied.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, buffers[cur].state);
    gl.uniform1i(pt.loc('uState'), 0);
    gl.uniform1i(pt.loc('uTexWidth'), ENGINE.TEX_WIDTH);
    gl.uniform1f(pt.loc('uSize'), look.grain * pxScale * ENGINE.POINT_SCALE);
    gl.uniform3fv(pt.loc('uColor'), colors.sand);
    gl.uniform1f(pt.loc('uExposure'), look.exposure);
    gl.drawArrays(gl.POINTS, 0, grains);
    gl.disable(gl.BLEND);
  }

  function markPass(slot, grab) {
    if (lost) return;
    particlePass(programs.mark, buffers[1 - cur], buffers[cur], p => {
      gl.uniform1f(p.loc('uAspect'), aspect);
      gl.uniform4fv(p.loc('uGrab'), grab ? [grab.x, grab.y, grab.r, slot] : [0, 0, 0, slot]);
      gl.uniform1f(p.loc('uGrabbing'), grab ? 1 : 0);
    });
    cur = 1 - cur;
  }

  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    lost = true;
    onError?.('The GPU reset its context. Restarting the field');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      setupGL();
      lost = false;
    } catch (error) {
      onError?.(error.message);
    }
  });

  setupGL();

  const engine = {
    canvas,

    setModes(modes, { morphSec: sec = 1.2 } = {}) {
      const next = (modes || []).slice(0, MAX_MODES).map(({ m, n, re, im }) => ({ m, n, re, im }));
      if (!modesA.length || !(sec > 0)) {
        modesA = next; modesB = []; morph = 0;
        return;
      }
      // Mid-morph: fold the visible mix into A, so the new morph starts from exactly what is on screen.
      if (morph > 0) modesA = blendModes(modesA, modesB, morph);
      // Overlapping morphs (a scrub) keep the strongest agitation still running.
      const running = morph > 0 ? agitation * Math.sin(Math.PI * morph) : 0;
      agitation = Math.max(running, modeDistance(modesA, next));
      modesB = next; morph = 0; morphSec = sec;
      // A zero-length step would never start; nudge so frame() knows B is pending.
      morph = 1e-6;
    },

    setLook(next = {}) {
      look = { ...look, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== null)) };
      look.glow = [...look.glow];
      colors = toColors(look);
    },

    setPlate({ x = 0, y = 0, w = 1, h = 1 } = {}) {
      plate = { x, y, w: Math.max(1e-3, w), h: Math.max(1e-3, h) };
    },

    setPointer({ x, y, vx = 0, vy = 0, mode = 'idle', strength = 0 } = {}) {
      const now = performance.now();
      if (mode === 'break') {
        const fresh = lastPointer && now - lastPointer.t < 80;
        const ax = fresh ? lastPointer.x : x - vx / 60, ay = fresh ? lastPointer.y : y - vy / 60;
        if (pendingBreak) Object.assign(pendingBreak, { bx: x, by: y, vx, vy, strength: Math.max(pendingBreak.strength, strength) });
        else pendingBreak = { ax, ay, bx: x, by: y, vx, vy, strength };
      }
      lastPointer = { x, y, t: now };
    },

    grab(slot, { x, y, radius = 0.08, aspect: a = aspect } = {}) {
      if (!(slot >= 0 && slot < ENGINE.MAX_PIECES)) return;
      markPass(slot, { x, y, r: radius * Math.min(a > 0 ? a : aspect, 1) });
    },

    setPieces(list = []) {
      pieceData.fill(0);
      for (const p of list) {
        if (!(p.slot >= 0 && p.slot < ENGINE.MAX_PIECES)) continue;
        pieceData.set([p.cx, p.cy, p.angle || 0, p.weight ?? 1], p.slot * 4);
      }
    },

    release(slot) {
      if (!(slot >= 0 && slot < ENGINE.MAX_PIECES)) return;
      pieceData.fill(0, slot * 4, slot * 4 + 4);
      markPass(slot, null);
    },

    shock(x, y) {
      shocks.push({ x, y, age: 0 });
      if (shocks.length > ENGINE.MAX_SHOCKS) shocks.shift();
    },

    scatter() {
      if (lost) return;
      allocate(0);
      gatherT = 0;
    },

    setCount(n) {
      const next = clampCount(n);
      if (next === grains) return;
      const keep = grains;
      grains = next;
      if (!lost) allocate(keep);
    },

    resize(widthPx, heightPx, pixelRatio = 1) {
      cssW = Math.max(1, widthPx); cssH = Math.max(1, heightPx);
      dpr = Math.max(0.5, Math.min(2, pixelRatio || 1));
      aspect = cssW / cssH;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    },

    frame(dt, { paused = false } = {}) {
      const now = performance.now();
      if (lastFrameT) {
        const inst = 1000 / Math.max(1, now - lastFrameT);
        fpsValue = fpsValue ? fpsValue + (inst - fpsValue) * ENGINE.FPS_SMOOTHING : inst;
      }
      lastFrameT = now;
      if (lost || gl.isContextLost()) return;
      if (!paused && dt > 0) {
        const h = Math.min(dt, ENGINE.MAX_DT);
        if (morph > 0) {
          morph += h / morphSec;
          if (morph >= 1) { modesA = modesB; modesB = []; morph = 0; }
        }
        shocks = shocks.filter(s => (s.age += h) < ENGINE.SHOCK_SEC);
        gatherT += h;
        simulate(h);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      render(canvas.width, canvas.height, dpr, look.transparent);
    },

    fps() { return fpsValue; },

    snapshot({ scale = 1, longSide = null, transparent = look.transparent } = {}) {
      if (lost) return Promise.reject(engineError('The GPU context was lost', 'LOST'));
      const max = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
      const { width, height } = snapshotSize({ width: cssW, height: cssH, scale, longSide, max });
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      render(width, height, width / cssW, transparent);
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(texture);

      // GL rows go bottom-up and are premultiplied; ImageData wants top-down, straight alpha.
      const out = document.createElement('canvas');
      out.width = width; out.height = height;
      const ctx = out.getContext('2d');
      const image = ctx.createImageData(width, height);
      const row = width * 4;
      for (let y = 0; y < height; y++) {
        const src = (height - 1 - y) * row, dst = y * row;
        for (let i = 0; i < row; i += 4) {
          const a = pixels[src + i + 3];
          const k = a > 0 && a < 255 ? 255 / a : 1;
          image.data[dst + i] = Math.min(255, pixels[src + i] * k);
          image.data[dst + i + 1] = Math.min(255, pixels[src + i + 1] * k);
          image.data[dst + i + 2] = Math.min(255, pixels[src + i + 2] * k);
          image.data[dst + i + 3] = a;
        }
      }
      ctx.putImageData(image, 0, 0);
      return new Promise((resolve, reject) => out.toBlob(
        blob => (blob ? resolve(blob) : reject(engineError('Could not build the PNG', 'SNAPSHOT'))), 'image/png'));
    }
  };

  engine.resize(cssW, cssH, globalThis.devicePixelRatio || 1);
  return engine;
}

function smooth(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}
