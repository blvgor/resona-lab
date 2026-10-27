import test from 'node:test';
import assert from 'node:assert/strict';
import { plateRect, blendModes, snapshotSize, modeDistance } from '../engine.js';
import { evalField, MAX_MODES } from '../sand.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('plateRect: full screen is the whole window, a fixed proportion is the largest centered rectangle', () => {
  assert.deepEqual(plateRect(1.6, 'screen'), { x: 0, y: 0, w: 1, h: 1 });
  // 1:1 on a 16:10 window: full height, width 1/1.6 of the window, centered.
  const square = plateRect(1.6, 1);
  assert.ok(close(square.w, 0.625) && close(square.h, 1) && close(square.x, 0.1875) && close(square.y, 0));
  // 2:1 on a portrait 1:2 window: full width, height a quarter, centered.
  const wide = plateRect(0.5, 2);
  assert.ok(close(wide.w, 1) && close(wide.h, 0.25) && close(wide.x, 0) && close(wide.y, 0.375));
  // The plate keeps its proportion on screen: w·aspect / h equals the requested one.
  for (const [aspect, proportion] of [[1.6, 4 / 3], [0.46, 1.5], [2.2, 2]]) {
    const r = plateRect(aspect, proportion);
    assert.ok(close(r.w * aspect / r.h, proportion, 1e-9), `${aspect} ${proportion}`);
    assert.ok(r.w <= 1 + 1e-12 && r.h <= 1 + 1e-12 && (close(r.w, 1) || close(r.h, 1)));
  }
});

test('blendModes: the blended set reproduces the mix of both fields on re/im', () => {
  const a = [{ m: 1, n: 3, re: 0.6, im: -0.2 }, { m: 3, n: 1, re: 0.5, im: 0.1 }];
  const b = [{ m: 2, n: 5, re: -0.4, im: 0.3 }, { m: 1, n: 3, re: 0.2, im: 0.2 }];
  for (const t of [0, 0.3, 0.75, 1]) {
    const mixed = blendModes(a, b, t);
    for (const [x, y] of [[0.13, 0.71], [0.5, 0.5], [0.88, 0.27], [0.31, 0.06]]) {
      const fa = evalField(a, x, y), fb = evalField(b, x, y), fm = evalField(mixed, x, y);
      for (const k of ['re', 'im', 'reX', 'reY', 'imX', 'imY']) {
        assert.ok(close(fm[k], fa[k] * (1 - t) + fb[k] * t, 1e-9), `${k} at t=${t}`);
      }
    }
  }
});

test('blendModes: never more than MAX_MODES, keeping the strongest', () => {
  const a = Array.from({ length: 12 }, (_, i) => ({ m: 1 + (i % 9), n: 1 + Math.floor(i / 9), re: 0.01 * (i + 1), im: 0 }));
  const b = Array.from({ length: 12 }, (_, i) => ({ m: 1 + (i % 9), n: 5 + Math.floor(i / 9), re: 0, im: 0.5 + 0.01 * i }));
  const mixed = blendModes(a, b, 0.5);
  assert.equal(mixed.length, MAX_MODES);
  // All 12 strong modes of b survive; only the 4 strongest of a make it.
  assert.equal(mixed.filter(md => md.n >= 5).length, 12);
  const weakest = Math.min(...mixed.map(md => Math.hypot(md.re, md.im)));
  assert.ok(close(weakest, 0.5 * 0.09, 1e-12));
});

test('snapshotSize: 1×/2× follow the window, 4K sets the long side, the GPU limit scales both sides down', () => {
  assert.deepEqual(snapshotSize({ width: 1440, height: 900, scale: 1 }), { width: 1440, height: 900 });
  assert.deepEqual(snapshotSize({ width: 1440, height: 900, scale: 2 }), { width: 2880, height: 1800 });
  assert.deepEqual(snapshotSize({ width: 1440, height: 900, longSide: 3840 }), { width: 3840, height: 2400 });
  assert.deepEqual(snapshotSize({ width: 390, height: 844, longSide: 3840 }), { width: 1774, height: 3840 });
  assert.deepEqual(snapshotSize({ width: 1440, height: 900, longSide: 3840, max: 2048 }), { width: 2048, height: 1280 });
});

test('modeDistance: 0 for the same figure at any scale or phase, 1 for disjoint modes, between for a partial change', () => {
  const a = [{ m: 1, n: 3, re: 0.6, im: 0.2 }, { m: 3, n: 1, re: 0.6, im: 0.2 }];
  // Same set times a complex factor (2·e^{i·0.7}): the same figure.
  const k = { re: 2 * Math.cos(0.7), im: 2 * Math.sin(0.7) };
  const scaled = a.map(md => ({ ...md, re: md.re * k.re - md.im * k.im, im: md.re * k.im + md.im * k.re }));
  assert.ok(close(modeDistance(a, scaled), 0, 1e-12));
  assert.ok(close(modeDistance(a, [{ m: 2, n: 5, re: 1, im: 0 }]), 1, 1e-12));
  // Sharing one of two equal modes c: ⟨a, b⟩ = |c|², ‖a‖‖b‖ = 2|c|², so cos = 1/2.
  const half = modeDistance(a, [{ m: 1, n: 3, re: 0.6, im: 0.2 }, { m: 2, n: 5, re: 0.6, im: 0.2 }]);
  assert.ok(close(half, 0.5, 1e-12));
  assert.equal(modeDistance([], a), 1);
});
