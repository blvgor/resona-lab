import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATE, PRESETS, modeSet } from '../physics.js';
import { MAX_MODES, SAND, SAND_GLSL, evalField, sandVelocity } from '../sand.js';

// mulberry32, same generator the old particle test used.
function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

test('A sustained simulation keeps a complete nodal ring instead of collapsing into grid minima', () => {
  const { modes } = modeSet({ preset: PRESETS[0], plate: DEFAULT_STATE, frequency: 0, damping: .015, mix: 1, manual: false });
  const rng = random(513), count = 4000, dt = 1 / 60, p = new Float64Array(count * 2);
  for (let i = 0; i < p.length; i += 2) { p[i] = .04 + rng() * .92; p[i + 1] = .04 + rng() * .92; }
  for (let step = 0; step < 1800; step++) for (let i = 0; i < p.length; i += 2) {
    const v = sandVelocity(modes, p[i], p[i + 1], { spread: 1.2, rnd: [rng(), rng()], dt });
    p[i] += v.vx * dt; p[i + 1] += v.vy * dt;
    if (p[i] < .025 || p[i] > .975 || p[i + 1] < .025 || p[i + 1] > .975) { p[i] = .07 + rng() * .86; p[i + 1] = .07 + rng() * .86; }
  }
  const sectors = Array(16).fill(0);
  let settled = 0;
  for (let i = 0; i < p.length; i += 2) {
    assert.ok(Number.isFinite(p[i]) && Number.isFinite(p[i + 1]));
    const { re, im } = evalField(modes, p[i], p[i + 1]);
    if (re * re + im * im < .0004 && Math.hypot(p[i] - .5, p[i + 1] - .5) < .4) {
      settled++;
      const angle = (Math.atan2(p[i + 1] - .5, p[i] - .5) + Math.PI) / (2 * Math.PI);
      sectors[Math.min(15, Math.floor(angle * 16))]++;
    }
  }
  assert.ok(settled > 3500, `${settled} particles settled`);
  assert.ok(sectors.every(n => n > 30), `Angular distribution: ${sectors.join(',')}`);
});

test('evalField derivatives match central finite differences', () => {
  const sets = [
    modeSet({ preset: PRESETS[0], plate: DEFAULT_STATE, frequency: 0, damping: .015, mix: 1, manual: false }).modes,
    modeSet({ preset: PRESETS[30], plate: { ...DEFAULT_STATE, aspect: .6 }, frequency: 0, damping: .015, mix: -1, manual: false }).modes,
    modeSet({ preset: PRESETS[0], plate: { ...DEFAULT_STATE, aspect: 1.7 }, frequency: 2345, damping: .015, mix: 1, manual: true }).modes
  ];
  const h = 1e-6, rng = random(7);
  for (const modes of sets) for (let k = 0; k < 50; k++) {
    const x = .02 + rng() * .96, y = .02 + rng() * .96, f = evalField(modes, x, y);
    const fx1 = evalField(modes, x + h, y), fx0 = evalField(modes, x - h, y);
    const fy1 = evalField(modes, x, y + h), fy0 = evalField(modes, x, y - h);
    const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-4 * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
    near(f.reX, (fx1.re - fx0.re) / (2 * h)); near(f.imX, (fx1.im - fx0.im) / (2 * h));
    near(f.reY, (fy1.re - fy0.re) / (2 * h)); near(f.imY, (fy1.im - fy0.im) / (2 * h));
  }
});

test('sandVelocity descends the energy u and is capped; at a node it only jitters', () => {
  const { modes } = modeSet({ preset: PRESETS[0], plate: DEFAULT_STATE, frequency: 0, damping: .015, mix: 1, manual: false });
  const rng = random(11);
  for (let k = 0; k < 200; k++) {
    const x = .05 + rng() * .9, y = .05 + rng() * .9;
    const v = sandVelocity(modes, x, y, { spread: 1.2 });
    const f = evalField(modes, x, y);
    assert.ok(Math.abs(v.u - (f.re ** 2 + f.im ** 2)) < 1e-12);
    const gx = 2 * (f.re * f.reX + f.im * f.imX), gy = 2 * (f.re * f.reY + f.im * f.imY);
    assert.ok(v.vx * gx + v.vy * gy <= 0, 'moves downhill');
    assert.ok(Math.abs(v.vx) <= SAND.STEP_MAX + 1e-12 && Math.abs(v.vy) <= SAND.STEP_MAX + 1e-12);
  }
  // (0.5, 0.25) is an analytic node of the symmetric (1,3)+(3,1) pair.
  const still = sandVelocity(modes, .5, .25, { spread: 1.2 });
  assert.ok(Math.hypot(still.vx, still.vy) < 1e-9 && still.u < 1e-20);
});

test('SAND constants reach SAND_GLSL by substitution, with the uniform block the engine expects', () => {
  assert.equal(MAX_MODES, 16);
  for (const [name, value] of Object.entries(SAND)) {
    const match = SAND_GLSL.match(new RegExp(`const float SAND_${name} = ([-0-9.e+]+);`));
    assert.ok(match, `SAND_${name} declared in GLSL`);
    assert.equal(Number(match[1]), value, `SAND_${name}`);
    assert.ok(match[1].includes('.') || match[1].includes('e'), `SAND_${name} is a float literal`);
  }
  for (const decl of ['uniform vec4 uModesA[16];', 'uniform vec4 uModesB[16];', 'uniform int uCountA;', 'uniform int uCountB;', 'uniform float uMorph;'])
    assert.ok(SAND_GLSL.includes(decl), decl);
  for (const fn of ['float fieldU(vec2 p)', 'vec2 fieldRI(vec2 p)', 'vec2 sandVelocity(vec2 p, float spread, vec2 rnd, float dt)'])
    assert.ok(SAND_GLSL.includes(fn), fn);
});
