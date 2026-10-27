import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestures, GESTURE } from '../gestures.js';

const W = 1000, H = 800;
const types = intents => intents.map(i => i.type);

test('A fast mouse sweep without buttons breaks; a slow one only hovers', () => {
  const g = createGestures({ width: W, height: H });
  const fast = [];
  for (let i = 0; i <= 10; i++) fast.push(...g.move({ x: 100 + i * 30, y: 400, t: 1000 + i * 10, buttons: 0, id: 1 }));
  const breaks = fast.filter(i => i.type === 'break');
  assert.ok(breaks.length >= 5, types(fast).join());
  const last = breaks.at(-1);
  // 30 px per 10 ms = 3000 px/s = 3 widths per second, to the right.
  assert.ok(Math.abs(last.vx - 3) < 0.05 && Math.abs(last.vy) < 1e-9, `${last.vx}, ${last.vy}`);
  assert.ok(Math.abs(last.x - 0.4) < 1e-9 && Math.abs(last.y - 0.5) < 1e-9);
  assert.ok(last.strength > 0 && last.strength <= 1);

  const slow = [];
  for (let i = 0; i <= 10; i++) slow.push(...g.move({ x: 500 + i * 2, y: 300, t: 3000 + i * 16, buttons: 0, id: 1 }));
  assert.ok(slow.length > 0 && slow.every(i => i.type === 'hover'), types(slow).join());

  // Faster sweeps break harder.
  const faster = createGestures({ width: W, height: H });
  let strongest = 0;
  for (let i = 0; i <= 10; i++) for (const it of faster.move({ x: 100 + i * 60, y: 400, t: 1000 + i * 10, buttons: 0, id: 1 }))
    if (it.type === 'break') strongest = it.strength;
  assert.ok(strongest > last.strength);
});

test('Mouse press, drag and jerk: grab, drag, then throw with the speed of the last ~60 ms', () => {
  const g = createGestures({ width: W, height: H });
  assert.deepEqual(g.down({ x: 500, y: 400, t: 0, pointerType: 'mouse', id: 1 }), [{ type: 'grab', x: 0.5, y: 0.5 }]);
  const drags = [];
  // Slow drag for 300 ms…
  for (let i = 1; i <= 15; i++) drags.push(...g.move({ x: 500 + i * 2, y: 400, t: i * 20, buttons: 1, id: 1 }));
  // …then a jerk: 40 px down every 10 ms for 80 ms.
  for (let i = 1; i <= 8; i++) drags.push(...g.move({ x: 530, y: 400 + i * 40, t: 300 + i * 10, buttons: 1, id: 1 }));
  assert.ok(drags.length === 23 && drags.every(i => i.type === 'drag'), types(drags).join());
  assert.ok(Math.abs(drags.at(-1).y - 720 / 800) < 1e-9);
  const up = g.up({ x: 530, y: 720, t: 381, id: 1 });
  assert.equal(up.length, 1);
  assert.equal(up[0].type, 'throw');
  // 40 px / 10 ms = 4000 px/s = 5 heights per second downwards, no horizontal speed.
  assert.ok(Math.abs(up[0].vy - 5) < 0.4, `vy ${up[0].vy}`);
  assert.ok(Math.abs(up[0].vx) < 0.05, `vx ${up[0].vx}`);
});

test('Holding still before release throws with ~zero speed', () => {
  const g = createGestures({ width: W, height: H });
  g.down({ x: 500, y: 400, t: 0, pointerType: 'mouse', id: 1 });
  for (let i = 1; i <= 5; i++) g.move({ x: 500 + i * 40, y: 400, t: i * 10, buttons: 1, id: 1 });
  const [thrown] = g.up({ x: 700, y: 400, t: 400, id: 1 });
  assert.equal(thrown.type, 'throw');
  assert.ok(Math.hypot(thrown.vx, thrown.vy) < 0.2, `${thrown.vx}`);
});

test('Double click shocks at the click point', () => {
  const g = createGestures({ width: W, height: H });
  g.down({ x: 300, y: 200, t: 1000, pointerType: 'mouse', id: 1 });
  g.up({ x: 300, y: 200, t: 1080, id: 1 });
  const second = g.down({ x: 305, y: 203, t: 1200, pointerType: 'mouse', id: 1 });
  assert.deepEqual(types(second), ['shock']);
  assert.ok(Math.abs(second[0].x - 0.305) < 1e-9 && Math.abs(second[0].y - 203 / 800) < 1e-9);
  assert.deepEqual(g.up({ x: 305, y: 203, t: 1260, id: 1 }), []);
  // Too slow or too far is not a double click.
  const h = createGestures({ width: W, height: H });
  h.down({ x: 300, y: 200, t: 0, pointerType: 'mouse', id: 1 }); h.up({ x: 300, y: 200, t: 50, id: 1 });
  assert.deepEqual(types(h.down({ x: 300, y: 200, t: 50 + GESTURE.DOUBLE_MS + 50, pointerType: 'mouse', id: 1 })), ['grab']);
  h.up({ x: 300, y: 200, t: 500, id: 1 });
  assert.deepEqual(types(h.down({ x: 360, y: 200, t: 560, pointerType: 'mouse', id: 1 })), ['grab']);
});

test('Touch: a stroke within 120 ms of contact breaks; a press held longer grabs, drags and throws', () => {
  const g = createGestures({ width: W, height: H });
  assert.deepEqual(g.down({ x: 200, y: 400, t: 0, pointerType: 'touch', id: 7 }), []);
  const stroke = [];
  for (let i = 1; i <= 6; i++) stroke.push(...g.move({ x: 200 + i * 30, y: 400, t: i * 12, buttons: 1, id: 7 }));
  assert.ok(stroke.length > 0 && stroke.every(i => i.type === 'break'), types(stroke).join());
  assert.ok(stroke.at(-1).vx > 1);
  assert.deepEqual(g.up({ x: 380, y: 400, t: 80, id: 7 }), []);

  const h = createGestures({ width: W, height: H });
  h.down({ x: 500, y: 400, t: 1000, pointerType: 'touch', id: 3 });
  // A finger that rests produces no move events: the grab arrives with tick().
  assert.deepEqual(h.tick(1000 + GESTURE.FLICK_MS - 20), []);
  assert.deepEqual(h.tick(1000 + GESTURE.FLICK_MS + 30), [{ type: 'grab', x: 0.5, y: 0.5 }]);
  const moved = [];
  for (let i = 1; i <= 5; i++) moved.push(...h.move({ x: 500 - i * 30, y: 400, t: 1200 + i * 10, buttons: 1, id: 3 }));
  assert.deepEqual([...new Set(types(moved))], ['drag']);
  const [thrown] = h.up({ x: 350, y: 400, t: 1255, id: 3 });
  assert.equal(thrown.type, 'throw');
  assert.ok(thrown.vx < -2, `${thrown.vx}`);

  // Without tick(): a slow move after the delay grabs first, then drags.
  const k = createGestures({ width: W, height: H });
  k.down({ x: 500, y: 400, t: 0, pointerType: 'touch', id: 4 });
  assert.deepEqual(types(k.move({ x: 503, y: 400, t: 200, buttons: 1, id: 4 })), ['grab', 'drag']);
});

test('Double tap shocks', () => {
  const g = createGestures({ width: W, height: H });
  g.down({ x: 100, y: 100, t: 0, pointerType: 'touch', id: 1 });
  assert.deepEqual(g.up({ x: 100, y: 100, t: 60, id: 1 }), []);
  assert.deepEqual(types(g.down({ x: 110, y: 104, t: 200, pointerType: 'touch', id: 2 })), ['shock']);
});

test('Wheel scrubs the frequency: up raises, down lowers, proportional to the delta', () => {
  const g = createGestures({ width: W, height: H });
  const [up] = g.wheel({ deltaY: -100, t: 0 });
  const [down] = g.wheel({ deltaY: 50, t: 10 });
  assert.equal(up.type, 'scrub');
  assert.ok(up.delta > 0 && down.delta < 0);
  assert.ok(Math.abs(up.delta + 2 * down.delta) < 1e-9);
  assert.ok(Math.abs(up.delta - 100 * GESTURE.WHEEL_SEMITONES) < 1e-9);
  assert.deepEqual(g.wheel({ deltaY: 0, t: 20 }), []);
});

test('Two fingers moving up and down on touch scrub the frequency', () => {
  const g = createGestures({ width: W, height: H });
  g.down({ x: 400, y: 500, t: 0, pointerType: 'touch', id: 1 });
  const second = g.down({ x: 600, y: 500, t: 30, pointerType: 'touch', id: 2 });
  assert.ok(second.every(i => i.type !== 'grab' && i.type !== 'shock'));
  const out = [];
  for (let i = 1; i <= 4; i++) {
    out.push(...g.move({ x: 400, y: 500 - i * 12, t: 30 + i * 16, buttons: 1, id: 1 }));
    out.push(...g.move({ x: 600, y: 500 - i * 12, t: 32 + i * 16, buttons: 1, id: 2 }));
  }
  const scrubs = out.filter(i => i.type === 'scrub');
  assert.ok(scrubs.length > 0 && out.every(i => i.type === 'scrub'), types(out).join());
  const total = scrubs.reduce((sum, s) => sum + s.delta, 0);
  // 48 px up in total.
  assert.ok(Math.abs(total - 48 / GESTURE.SCRUB_PX) < 1e-9, `${total}`);
  for (let i = 1; i <= 2; i++) out.push(...g.move({ x: 400, y: 452 + i * 24, t: 120 + i * 16, buttons: 1, id: 1 }), ...g.move({ x: 600, y: 452 + i * 24, t: 122 + i * 16, buttons: 1, id: 2 }));
  assert.ok(out.filter(i => i.type === 'scrub').reduce((s, x) => s + x.delta, 0) < total, 'moving down lowers');
  // Lifting fingers ends the scrub without throws or grabs.
  assert.deepEqual(g.up({ x: 400, y: 500, t: 200, id: 1 }), []);
  assert.deepEqual(g.move({ x: 600, y: 300, t: 210, buttons: 1, id: 2 }), []);
  assert.deepEqual(g.up({ x: 600, y: 300, t: 220, id: 2 }), []);
});

test('A second finger on a grabbed piece lets the piece go before scrubbing', () => {
  const g = createGestures({ width: W, height: H });
  g.down({ x: 400, y: 500, t: 0, pointerType: 'touch', id: 1 });
  g.tick(200);
  const second = g.down({ x: 600, y: 500, t: 250, pointerType: 'touch', id: 2 });
  assert.deepEqual(second, [{ type: 'throw', vx: 0, vy: 0 }]);
});

test('resize changes the normalization', () => {
  const g = createGestures({ width: W, height: H });
  g.resize(500, 400);
  assert.deepEqual(g.down({ x: 250, y: 100, t: 0, pointerType: 'mouse', id: 1 }), [{ type: 'grab', x: 0.5, y: 0.25 }]);
});
