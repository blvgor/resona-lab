// Pointer stream → intents. Pure: pixel coordinates and timestamps in, normalized intents out.
// Thresholds live in GESTURE; the decision "throw or drop" belongs to pieces.release, not here.

export const GESTURE = Object.freeze({
  BREAK_SPEED: 1,          // hover speed that breaks the sand, short sides per second
  BREAK_FULL_SPEED: 6,     // hover speed of a full-strength break
  BREAK_MIN_STRENGTH: 0.1,
  FLICK_MIN_STRENGTH: 0.25,
  FLICK_MS: 120,           // touch: a stroke that starts sooner than this breaks; a longer press grabs
  TOUCH_SLOP_PX: 10,       // touch movement below this is still a press
  DOUBLE_MS: 300,          // release → next press, for a double click or tap
  DOUBLE_PX: 24,
  VELOCITY_MS: 60,         // velocities are measured over the last ~60 ms
  HISTORY: 24,             // samples kept per pointer
  WHEEL_SEMITONES: 0.01,   // per pixel of wheel delta: a 100 px mouse notch is one semitone
  SCRUB_PX: 24             // two-finger vertical travel per semitone
});

export function createGestures({ width, height }) {
  let w = width, h = height;
  const pointers = new Map();
  let lastTap = null;

  const norm = (x, y) => ({ x: x / w, y: y / h });

  function record(p, x, y, t) {
    p.samples.push({ x, y, t });
    if (p.samples.length > GESTURE.HISTORY) p.samples.shift();
  }

  // Pixel velocity over the last VELOCITY_MS; falls back to the previous sample when nothing else is that recent.
  function velocityPx(p) {
    const s = p.samples, last = s[s.length - 1];
    if (s.length < 2) return { vx: 0, vy: 0 };
    let ref = s[s.length - 2];
    for (let i = s.length - 2; i >= 0 && last.t - s[i].t <= GESTURE.VELOCITY_MS; i--) ref = s[i];
    const dt = (last.t - ref.t) / 1000;
    return dt > 0 ? { vx: (last.x - ref.x) / dt, vy: (last.y - ref.y) / dt } : { vx: 0, vy: 0 };
  }

  function motion(p) {
    const v = velocityPx(p), last = p.samples[p.samples.length - 1];
    return { ...norm(last.x, last.y), vx: v.vx / w, vy: v.vy / h, speed: Math.hypot(v.vx, v.vy) / Math.min(w, h) };
  }

  const strength = (speed, min) => Math.max(min, Math.min(1, speed / GESTURE.BREAK_FULL_SPEED));
  const breakIntent = (m, min) => ({ type: 'break', x: m.x, y: m.y, vx: m.vx, vy: m.vy, strength: strength(m.speed, min) });
  const dragIntent = m => ({ type: 'drag', x: m.x, y: m.y, vx: m.vx, vy: m.vy });
  const throwIntent = p => { const m = motion(p); return { type: 'throw', vx: m.vx, vy: m.vy }; };

  function isDouble(x, y, t) {
    return lastTap && t - lastTap.t < GESTURE.DOUBLE_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < GESTURE.DOUBLE_PX;
  }

  const activeTouches = () => [...pointers.values()].filter(p => p.touch && p.state !== 'hover');
  const scrubY = () => {
    const list = [...pointers.values()].filter(p => p.state === 'scrub');
    return list.reduce((sum, p) => sum + p.samples[p.samples.length - 1].y, 0) / list.length;
  };

  function down({ x, y, t, pointerType = 'mouse', id = 0 }) {
    const touch = pointerType === 'touch';
    const out = [];
    if (touch) {
      const others = activeTouches().filter(p => p.id !== id);
      if (others.length) {
        // Second finger: whatever the first one did ends quietly, then both fingers scrub.
        if (others.length > 1) return [];
        const first = others[0];
        if (first.state === 'grab') out.push({ type: 'throw', vx: 0, vy: 0 });
        first.state = 'scrub';
        const p = { id, touch, state: 'scrub', samples: [], startT: t, startX: x, startY: y };
        record(p, x, y, t);
        pointers.set(id, p);
        lastTap = null;
        p.lastScrubY = first.lastScrubY = scrubY();
        return out;
      }
    }
    const p = { id, touch, state: 'pending', samples: [], startT: t, startX: x, startY: y };
    record(p, x, y, t);
    pointers.set(id, p);
    if (isDouble(x, y, t)) {
      lastTap = null;
      p.state = 'shock';
      return [{ type: 'shock', ...norm(x, y) }];
    }
    if (!touch) {
      p.state = 'grab';
      out.push({ type: 'grab', ...norm(x, y) });
    }
    return out;
  }

  function promote(p, t) {
    if (p.state === 'pending' && t - p.startT >= GESTURE.FLICK_MS) {
      p.state = 'grab';
      const last = p.samples[p.samples.length - 1];
      return [{ type: 'grab', ...norm(last.x, last.y) }];
    }
    return [];
  }

  function move({ x, y, t, buttons = 0, id = 0 }) {
    let p = pointers.get(id);
    const out = [];
    if (!p) {
      // Only a hovering mouse or pen moves without a press first.
      p = { id, touch: false, state: 'hover', samples: [], startT: t, startX: x, startY: y };
      pointers.set(id, p);
    }
    if (!p.touch && p.state !== 'hover' && !buttons) {
      // The release happened outside the window: finish the press first.
      out.push(...release(p, x, y, t));
    }
    record(p, x, y, t);
    switch (p.state) {
      case 'hover': {
        const m = motion(p);
        out.push(m.speed >= GESTURE.BREAK_SPEED ? breakIntent(m, GESTURE.BREAK_MIN_STRENGTH)
          : { type: 'hover', x: m.x, y: m.y, vx: m.vx, vy: m.vy });
        break;
      }
      case 'pending': {
        const moved = Math.hypot(x - p.startX, y - p.startY) > GESTURE.TOUCH_SLOP_PX;
        if (t - p.startT < GESTURE.FLICK_MS) {
          if (moved) { p.state = 'flick'; out.push(breakIntent(motion(p), GESTURE.FLICK_MIN_STRENGTH)); }
        } else {
          out.push(...promote(p, t), dragIntent(motion(p)));
        }
        break;
      }
      case 'flick': out.push(breakIntent(motion(p), GESTURE.FLICK_MIN_STRENGTH)); break;
      case 'grab': out.push(dragIntent(motion(p))); break;
      case 'scrub': {
        const now = scrubY(), delta = (p.lastScrubY - now) / GESTURE.SCRUB_PX;
        for (const q of pointers.values()) if (q.state === 'scrub') q.lastScrubY = now;
        if (delta !== 0) out.push({ type: 'scrub', delta });
        break;
      }
      default: break; // 'shock', 'ignored'
    }
    return out;
  }

  function release(p, x, y, t) {
    record(p, x, y, t);
    const out = [];
    if (p.state === 'grab') out.push(throwIntent(p));
    const tap = (p.state === 'grab' || p.state === 'pending') && t - p.startT < GESTURE.DOUBLE_MS
      && Math.hypot(x - p.startX, y - p.startY) < GESTURE.DOUBLE_PX;
    lastTap = tap ? { x, y, t } : p.state === 'shock' ? null : lastTap;
    if (p.state === 'scrub') {
      // The remaining finger stays silent until it lifts.
      for (const q of pointers.values()) if (q !== p && q.state === 'scrub') q.state = 'ignored';
    }
    if (p.touch) pointers.delete(p.id);
    else p.state = 'hover';
    return out;
  }

  function up({ x, y, t, id = 0 }) {
    const p = pointers.get(id);
    if (!p || p.state === 'hover') return [];
    return release(p, x, y, t);
  }

  function wheel({ deltaY }) {
    return deltaY ? [{ type: 'scrub', delta: -deltaY * GESTURE.WHEEL_SEMITONES }] : [];
  }

  // A resting finger sends no move events; call tick every frame so a held touch still becomes a grab.
  function tick(t) {
    const out = [];
    for (const p of pointers.values()) out.push(...promote(p, t));
    return out;
  }

  function resize(width2, height2) { w = width2; h = height2; }

  return { down, move, up, wheel, tick, resize };
}
