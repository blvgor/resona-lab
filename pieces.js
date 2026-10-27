// Kinematics of grabbed pieces of sand: held → flying (inertia, friction, wall bounces, spin) → homing
// (a slightly underdamped spring back to where the piece was taken from) → home (removed).
// Positions are normalized window coordinates; the motion itself runs in screen space (x·aspect, y),
// so bounces and the spring are round on screen. Speeds are in screen heights per second.

export const PIECES = Object.freeze({
  MAX: 8,
  THROW_SPEED: 0.9,      // release faster than this flies; slower springs straight home
  FLIGHT_SEC: 1.5,       // longest flight before homing
  STOP_SPEED: 0.15,      // a flight slower than this starts homing early
  FRICTION: 1.2,         // exponential velocity decay in flight, 1/s
  RESTITUTION: 0.6,      // share of the normal speed kept after a wall bounce
  SPIN: 1,               // spin from the throw velocity across the home → piece arm
  SPIN_BASE: 0.5,        // spin from the horizontal throw velocity, so every throw turns a little
  MAX_SPIN: 12,          // rad/s
  SPIN_FRICTION: 1,      // 1/s
  SPRING: 40,            // homing stiffness, 1/s²
  SPRING_DAMPING: 7,     // homing damping, 1/s (ζ ≈ 0.55: a light overshoot)
  SETTLE_DIST: 0.004,    // close enough to home to start fading
  SETTLE_SPEED: 0.03,
  HOMING_MAX_SEC: 1.4,   // fade starts no later than this, so homing always ends
  FADE_SEC: 0.3,         // weight falls 1 → 0 over the last part of homing
  SUBSTEP: 1 / 120
});

const smoothstep = t => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

export function createPieces({ max = PIECES.MAX } = {}) {
  const live = new Map();
  let sequence = 0;

  function grab(x, y, radius, aspect) {
    let slot = -1, evicted = null;
    for (let s = 0; s < max; s++) if (!live.has(s)) { slot = s; break; }
    if (slot < 0) {
      // The oldest piece gives up its slot; its sand returns to the field on its own.
      let oldest = null;
      for (const p of live.values()) if (!oldest || p.seq < oldest.seq) oldest = p;
      slot = evicted = oldest.slot;
      live.delete(slot);
    }
    live.set(slot, {
      slot, seq: ++sequence, cx: x, cy: y, ox: x, oy: y, vx: 0, vy: 0, angle: 0, omega: 0, radius,
      aspect: aspect > 0 ? aspect : 1, phase: 'held', speed: 0, weight: 1, flight: 0, homing: 0, fade: -1
    });
    return { slot, evicted };
  }

  function hold(slot, x, y) {
    const p = live.get(slot);
    if (p && p.phase === 'held') { p.cx = x; p.cy = y; }
  }

  function release(slot, vx, vy) {
    const p = live.get(slot);
    if (!p || p.phase !== 'held') return null;
    const sx = vx * p.aspect, sy = vy, speed = Math.hypot(sx, sy);
    if (speed >= PIECES.THROW_SPEED) {
      const ax = (p.cx - p.ox) * p.aspect, ay = p.cy - p.oy;
      const arm = Math.max(Math.hypot(ax, ay), p.radius * Math.min(p.aspect, 1));
      const spin = PIECES.SPIN * (ax * sy - ay * sx) / arm + PIECES.SPIN_BASE * sx;
      p.omega = Math.max(-PIECES.MAX_SPIN, Math.min(PIECES.MAX_SPIN, spin));
      p.vx = vx; p.vy = vy; p.speed = speed; p.phase = 'flying';
    } else {
      p.vx = vx; p.vy = vy; p.speed = speed; p.phase = 'homing';
    }
    return { phase: p.phase };
  }

  function fly(p, h, aspect, events) {
    const r = p.radius * Math.min(aspect, 1), decay = Math.exp(-PIECES.FRICTION * h);
    let x = p.cx * aspect, y = p.cy, vx = p.vx * aspect * decay, vy = p.vy * decay;
    x += vx * h; y += vy * h;
    const hit = speed => { events.push({ type: 'bounce', slot: p.slot, speed }); p.omega *= PIECES.RESTITUTION; };
    if (x < r) { x = r; if (vx < 0) { hit(-vx); vx = -vx * PIECES.RESTITUTION; } }
    if (x > aspect - r) { x = aspect - r; if (vx > 0) { hit(vx); vx = -vx * PIECES.RESTITUTION; } }
    if (y < r) { y = r; if (vy < 0) { hit(-vy); vy = -vy * PIECES.RESTITUTION; } }
    if (y > 1 - r) { y = 1 - r; if (vy > 0) { hit(vy); vy = -vy * PIECES.RESTITUTION; } }
    p.cx = x / aspect; p.cy = y; p.vx = vx / aspect; p.vy = vy;
    p.angle += p.omega * h; p.omega *= Math.exp(-PIECES.SPIN_FRICTION * h);
    p.speed = Math.hypot(vx, vy);
    p.flight += h;
    if (p.flight >= PIECES.FLIGHT_SEC || p.speed < PIECES.STOP_SPEED) {
      p.phase = 'homing';
      events.push({ type: 'homing', slot: p.slot });
    }
  }

  // Returns true when the piece has arrived.
  function home(p, h, aspect) {
    const k = PIECES.SPRING, c = PIECES.SPRING_DAMPING;
    let x = p.cx * aspect, y = p.cy, vx = p.vx * aspect, vy = p.vy;
    const dx = x - p.ox * aspect, dy = y - p.oy;
    vx += (-k * dx - c * vx) * h; vy += (-k * dy - c * vy) * h;
    x += vx * h; y += vy * h;
    p.omega += (-k * p.angle - c * p.omega) * h;
    p.angle += p.omega * h;
    // Only the window bounds the way home: a piece taken nearer than its radius to an edge must reach that spot.
    x = Math.max(0, Math.min(aspect, x)); y = Math.max(0, Math.min(1, y));
    p.cx = x / aspect; p.cy = y; p.vx = vx / aspect; p.vy = vy;
    p.speed = Math.hypot(vx, vy);
    p.homing += h;
    const settled = Math.hypot(x - p.ox * aspect, y - p.oy) < PIECES.SETTLE_DIST && p.speed < PIECES.SETTLE_SPEED;
    if (p.fade < 0 && (settled || p.homing >= PIECES.HOMING_MAX_SEC)) p.fade = 0;
    if (p.fade >= 0) {
      p.fade += h;
      p.weight = 1 - smoothstep(p.fade / PIECES.FADE_SEC);
    }
    return p.fade >= PIECES.FADE_SEC;
  }

  function step(dt, aspect) {
    const events = [];
    if (!(dt > 0)) return events;
    const a = aspect > 0 ? aspect : 1;
    const substeps = Math.max(1, Math.ceil(dt / PIECES.SUBSTEP)), h = dt / substeps;
    for (const p of [...live.values()]) {
      p.aspect = a;
      if (p.phase === 'held') continue;
      for (let i = 0; i < substeps; i++) {
        if (p.phase === 'flying') { fly(p, h, a, events); continue; }
        if (home(p, h, a)) {
          live.delete(p.slot);
          events.push({ type: 'home', slot: p.slot });
          break;
        }
      }
    }
    return events;
  }

  function list() {
    return [...live.values()].sort((a, b) => a.slot - b.slot).map(p => ({
      slot: p.slot, cx: p.cx, cy: p.cy, ox: p.ox, oy: p.oy, angle: p.angle, radius: p.radius,
      phase: p.phase, speed: p.speed, weight: p.weight
    }));
  }

  return { grab, hold, release, step, list };
}
