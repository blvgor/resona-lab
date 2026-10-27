// All of Resona's sound, synthesized with Web Audio (no files).
// One master bus feeds both the speakers and a MediaStream for video recording.
// Every method is a quiet no-op until unlock() has created the context, and when Web Audio is missing.

export const AUDIO = Object.freeze({
  TONE_MIN: 110,          // the hum lives in 110–880 Hz: plate frequencies are folded by octaves
  TONE_MAX: 880,
  GLIDE_SEC: 0.08,        // hum pitch slide
  HUM_LEVEL: 0.06,
  MASTER: 0.9,
  RUSTLE_LEVEL: 0.22,
  GLISS_LEVEL: 0.05,
  GATHER_LEVEL: 0.05,
  THUMP_LEVEL: 0.5,
  NOTE_LEVEL: 0.12
});

export function foldTone(hz) {
  if (!(hz > 0) || !Number.isFinite(hz)) return AUDIO.TONE_MIN;
  let f = hz;
  while (f < AUDIO.TONE_MIN) f *= 2;
  while (f >= AUDIO.TONE_MAX) f /= 2;
  return f;
}

const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

export function createAudio({ AudioContext: Context = globalThis.AudioContext || globalThis.webkitAudioContext } = {}) {
  let ctx = null, master = null, out = null, recordDest = null;
  let hum = null, noise = null, rustleGain = null;
  let enabled = false, paused = false, tone = 220;
  const glisses = new Map();

  function build() {
    ctx = new Context({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 0;
    // A gentle limiter keeps stacked effects (many bounces, a shock) from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    master.connect(limiter);
    out = limiter;
    out.connect(ctx.destination);
    if (ctx.createMediaStreamDestination) {
      recordDest = ctx.createMediaStreamDestination();
      out.connect(recordDest);
    }
    buildHum();
    buildNoise();
  }

  // The hum: a sine with a soft octave and fifth above, through a lowpass, slowly breathing.
  function buildHum() {
    const bus = ctx.createGain();
    bus.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.Q.value = 0.4;
    bus.connect(filter);
    filter.connect(master);
    const partials = [[1, 1, 'sine'], [2, 0.18, 'sine'], [3, 0.06, 'triangle']].map(([k, level, type]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = tone * k;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(bus);
      osc.start();
      return { osc, k };
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const depth = ctx.createGain();
    depth.gain.value = AUDIO.HUM_LEVEL * 0.25;
    lfo.connect(depth);
    depth.connect(bus.gain);
    lfo.start();
    hum = { bus, partials };
  }

  function buildNoise() {
    const length = ctx.sampleRate * 2, buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    noise = buffer;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3200;
    band.Q.value = 0.7;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 900;
    rustleGain = ctx.createGain();
    rustleGain.gain.value = 0;
    src.connect(band);
    band.connect(high);
    high.connect(rustleGain);
    rustleGain.connect(master);
    src.start();
  }

  const ready = () => ctx && !paused;
  const now = () => ctx.currentTime;

  function setTone(hz) {
    tone = foldTone(hz);
    if (!ctx) return;
    for (const { osc, k } of hum.partials) osc.frequency.setTargetAtTime(tone * k, now(), AUDIO.GLIDE_SEC / 3);
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    if (!ctx) return;
    master.gain.setTargetAtTime(enabled ? AUDIO.MASTER : 0, now(), 0.06);
    hum.bus.gain.setTargetAtTime(enabled ? AUDIO.HUM_LEVEL : 0, now(), 0.25);
  }

  function rustle(strength) {
    if (!ready() || !enabled) return;
    const s = clamp01(strength), g = rustleGain.gain, t = now();
    const target = AUDIO.RUSTLE_LEVEL * (0.15 + 0.85 * s) * s;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, 0.0001), t);
    g.linearRampToValueAtTime(Math.max(g.value, target), t + 0.015);
    g.setTargetAtTime(0, t + 0.03, 0.09);
  }

  // A soft voice per flying piece; its pitch rises with speed above the hum.
  function gliss(slot, speed) {
    if (!ready() || !enabled) return;
    const s = clamp01(speed), t = now();
    let v = glisses.get(slot);
    if (!v) {
      const osc = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      osc.type = 'triangle';
      osc.frequency.value = tone * (1 + s);
      g.gain.value = 0;
      osc.connect(g);
      if (pan) { g.connect(pan); pan.connect(master); } else g.connect(master);
      osc.start();
      v = { osc, g, pan };
      glisses.set(slot, v);
    }
    v.osc.frequency.setTargetAtTime(tone * 2 ** (s * 1.6), t, 0.05);
    v.g.gain.setTargetAtTime(AUDIO.GLISS_LEVEL * (0.25 + 0.75 * s), t, 0.05);
  }

  function setPan(slot, x) {
    const v = glisses.get(slot);
    if (v && v.pan && ctx) v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, x * 2 - 1)) * 0.7, now(), 0.05);
  }

  function glissEnd(slot) {
    const v = glisses.get(slot);
    if (!v) return;
    glisses.delete(slot);
    const t = now();
    v.g.gain.setTargetAtTime(0, t, 0.08);
    v.osc.stop(t + 0.6);
  }

  function blip(hz, at, level, decay, type = 'sine') {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(g);
    g.connect(master);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }

  // "The sound gathers": a short rising shimmer of grains that lands on the hum's own pitch.
  function gather(strength) {
    if (!ready() || !enabled) return;
    const s = clamp01(strength), t = now(), steps = 6;
    for (let i = 0; i < steps; i++) {
      const k = i / (steps - 1);
      const hz = tone * 2 ** (-1 + k) * (1 + (Math.random() - 0.5) * 0.02 * (1 - k));
      blip(hz * 2, t + i * 0.045, AUDIO.GATHER_LEVEL * s * (0.3 + 0.7 * k), 0.22 + 0.25 * k);
    }
  }

  // A dull hit: a falling low sine plus a short lowpassed noise knock.
  function thump(strength) {
    if (!ready() || !enabled) return;
    const s = clamp01(strength), t = now();
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.28);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(AUDIO.THUMP_LEVEL * s + 0.0002, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.5);
    const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
    src.buffer = noise;
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    ng.gain.setValueAtTime(AUDIO.THUMP_LEVEL * 0.5 * s + 0.0002, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(master);
    src.start(t, Math.random());
    src.stop(t + 0.12);
  }

  // A plucked note for the piano keys: soft attack, long decay, an octave shimmer above.
  function note(hz) {
    if (!ready() || !enabled) return;
    const f = foldTone(hz) < 220 ? foldTone(hz) * 2 : foldTone(hz), t = now();
    blip(f, t, AUDIO.NOTE_LEVEL, 1.4, 'triangle');
    blip(f * 2, t, AUDIO.NOTE_LEVEL * 0.25, 0.7, 'sine');
  }

  return {
    unlock() {
      if (!Context) return;
      try {
        if (!ctx) {
          build();
          setTone(tone);
          setEnabled(enabled);
        }
        if (ctx.state === 'suspended' && !paused) ctx.resume();
      } catch {
        ctx = null;
      }
    },
    setEnabled,
    setTone,
    rustle,
    gliss,
    glissPan: setPan,
    glissEnd,
    gather,
    thump,
    note,
    pause() {
      paused = true;
      if (ctx && ctx.state === 'running') ctx.suspend();
    },
    resume() {
      paused = false;
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    stream() { return recordDest ? recordDest.stream : null; }
  };
}
