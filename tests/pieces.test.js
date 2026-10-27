import test from 'node:test';
import assert from 'node:assert/strict';
import { createPieces, PIECES } from '../pieces.js';

const DT = 1 / 60;
const run = (pieces, seconds, aspect, onEvents = () => {}) => {
  const all = [];
  for (let t = 0; t < seconds; t += DT) {
    const events = pieces.step(DT, aspect);
    all.push(...events);
    onEvents(events, pieces.list());
  }
  return all;
};

test('A thrown piece bounces off each of the four edges and stays inside', () => {
  const throws = { left: [-6, 0], right: [6, 0], top: [0, -6], bottom: [0, 6] };
  for (const aspect of [0.5, 1, 1.8]) for (const [edge, [vx, vy]] of Object.entries(throws)) {
    const pieces = createPieces();
    const radius = 0.08;
    const { slot } = pieces.grab(0.5, 0.5, radius, aspect);
    pieces.hold(slot, 0.5, 0.5);
    pieces.release(slot, vx, vy);
    assert.equal(pieces.list()[0].phase, 'flying');
    const r = radius * Math.min(aspect, 1); // radius is a share of the short side; screen space is dx·aspect, dy
    const axis = edge === 'left' || edge === 'right' ? 'cx' : 'cy';
    const wall = { left: r / aspect, right: 1 - r / aspect, top: r, bottom: 1 - r }[edge];
    let bounced = false, atBounce = null, reboundFlying = false;
    const events = run(pieces, 0.6, aspect, (frameEvents, list) => {
      const p = list.find(item => item.slot === slot);
      if (!p) return;
      assert.ok(p.cx * aspect >= r - 1e-9 && p.cx * aspect <= aspect - r + 1e-9, `x inside, ${edge}`);
      assert.ok(p.cy >= r - 1e-9 && p.cy <= 1 - r + 1e-9, `y inside, ${edge}`);
      if (!bounced && frameEvents.some(e => e.type === 'bounce' && e.slot === slot)) {
        bounced = true;
        atBounce = Math.abs(p[axis] - wall);
        // The bounce happened at this wall: within one frame of travel from it.
        assert.ok(atBounce < Math.hypot(vx, vy) * DT, `${edge}: bounced ${atBounce} from the wall`);
      } else if (bounced && atBounce !== null && p.phase === 'flying') {
        // Still in flight after the bounce, and moving away from the wall.
        reboundFlying = Math.abs(p[axis] - wall) > atBounce;
        atBounce = null;
      }
    });
    const bounce = events.find(e => e.type === 'bounce' && e.slot === slot);
    assert.ok(bounce, `bounce off ${edge} at aspect ${aspect}`);
    assert.ok(bounce.speed > 0);
    assert.ok(reboundFlying, `${edge} at aspect ${aspect}: flies back from the wall`);
  }
});

test('Bounces lose energy', () => {
  const pieces = createPieces();
  const { slot } = pieces.grab(0.5, 0.5, 0.05, 1);
  pieces.release(slot, 8, 0);
  let before = 0, after = 0, bounced = false;
  for (let i = 0; i < 60 && !bounced; i++) {
    before = pieces.list()[0].speed;
    bounced = pieces.step(DT, 1).some(e => e.type === 'bounce');
    after = pieces.list()[0].speed;
  }
  assert.ok(bounced);
  assert.ok(after < before * 0.9, `${before} → ${after}`);
  assert.ok(PIECES.RESTITUTION > 0 && PIECES.RESTITUTION < 1);
});

test('A thrown piece flies, homes and arrives in finite time, fading its weight at the end', () => {
  const pieces = createPieces();
  const { slot } = pieces.grab(0.3, 0.4, 0.08, 1.5);
  pieces.hold(slot, 0.35, 0.42);
  pieces.release(slot, 3, -2);
  let lastWeight = 1, minWeight = 1, homing = false, home = false, elapsed = 0, angled = false;
  while (!home && elapsed < 10) {
    const events = pieces.step(DT, 1.5);
    elapsed += DT;
    homing ||= events.some(e => e.type === 'homing' && e.slot === slot);
    home = events.some(e => e.type === 'home' && e.slot === slot);
    const p = pieces.list().find(item => item.slot === slot);
    if (p) {
      assert.ok(p.weight <= lastWeight + 1e-12, 'weight never grows back');
      lastWeight = p.weight; minWeight = Math.min(minWeight, p.weight);
      angled ||= Math.abs(p.angle) > 0.05;
    }
  }
  assert.ok(homing, 'went through homing');
  assert.ok(home, `home within 10 s, took ${elapsed.toFixed(2)} s`);
  assert.ok(elapsed >= PIECES.FLIGHT_SEC * 0.5 && elapsed < PIECES.FLIGHT_SEC + 4, `${elapsed}`);
  assert.ok(angled, 'a throw spins the piece');
  assert.ok(minWeight < 0.2, 'weight fades out before arrival');
  assert.deepEqual(pieces.list(), []);
});

test('A slow release springs home without flying; the piece ends near its origin', () => {
  const pieces = createPieces();
  const { slot } = pieces.grab(0.6, 0.6, 0.08, 1);
  pieces.hold(slot, 0.7, 0.65);
  pieces.release(slot, 0.05, 0);
  assert.equal(pieces.list()[0].phase, 'homing');
  let closest = Infinity, home = false;
  for (let i = 0; i < 600 && !home; i++) {
    const events = pieces.step(DT, 1);
    assert.ok(!events.some(e => e.type === 'bounce'));
    home = events.some(e => e.type === 'home');
    const p = pieces.list()[0];
    if (p) closest = Math.min(closest, Math.hypot(p.cx - p.ox, p.cy - p.oy));
  }
  assert.ok(home);
  assert.ok(closest < 0.01, `closest ${closest}`);
});

test('Eight pieces fly at once; the ninth grab evicts the oldest', () => {
  const pieces = createPieces();
  const slots = [];
  for (let i = 0; i < 8; i++) {
    const { slot, evicted } = pieces.grab(0.1 + i * 0.1, 0.5, 0.05, 1);
    assert.equal(evicted, null);
    slots.push(slot);
    pieces.release(slot, 4, 3);
    pieces.step(DT, 1);
  }
  assert.equal(new Set(slots).size, 8);
  assert.ok(slots.every(s => s >= 0 && s < 8));
  assert.equal(pieces.list().length, 8);
  const ninth = pieces.grab(0.5, 0.2, 0.05, 1);
  assert.equal(ninth.evicted, slots[0]);
  assert.equal(ninth.slot, slots[0]);
  const list = pieces.list();
  assert.equal(list.length, 8);
  const reused = list.find(p => p.slot === ninth.slot);
  assert.equal(reused.phase, 'held');
  assert.ok(Math.abs(reused.ox - 0.5) < 1e-12 && Math.abs(reused.oy - 0.2) < 1e-12);
  // The next eviction takes the next oldest.
  assert.equal(pieces.grab(0.5, 0.8, 0.05, 1).evicted, slots[1]);
});

test('A piece grabbed at the very edge comes back to where it was taken', () => {
  for (const [vx, vy] of [[4, 2], [0.05, 0]]) { // a throw, and a slow release
    const pieces = createPieces();
    const { slot } = pieces.grab(0.02, 0.5, 0.08, 1);
    pieces.hold(slot, 0.3, 0.5);
    pieces.release(slot, vx, vy);
    let last = null, home = false;
    for (let i = 0; i < 600 && !home; i++) {
      home = pieces.step(DT, 1).some(e => e.type === 'home' && e.slot === slot);
      if (!home) last = pieces.list().find(p => p.slot === slot);
    }
    assert.ok(home, 'arrived');
    assert.ok(Math.abs(last.cx - last.ox) < PIECES.SETTLE_DIST, `ended ${Math.abs(last.cx - last.ox)} from home`);
    assert.ok(Math.abs(last.cy - last.oy) < PIECES.SETTLE_DIST);
    assert.ok(last.cx >= 0 && last.cx <= 1, 'stays inside the window');
  }
});
