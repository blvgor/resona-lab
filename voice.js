// Microphone → pitch. The analysis itself is detectPitch (pitch.js); here are the device, smoothing and note names.
import { detectPitch } from './pitch.js';

export const VOICE = Object.freeze({
  FFT_SIZE: 2048,
  SMOOTH_FRAMES: 5,
  MIN_CLARITY: 0.8
});

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(freq) {
  if (!(freq > 0)) return '';
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

// Median over the last `size` frames; a dropped frame (null) counts as a gap. Returns null when the window is all gaps.
export function createSmoother(size = VOICE.SMOOTH_FRAMES) {
  const history = [];
  return value => {
    history.push(Number.isFinite(value) ? value : null);
    if (history.length > size) history.shift();
    const valid = history.filter(v => v !== null).sort((a, b) => a - b);
    // A mostly silent window is silence, not a note.
    if (valid.length * 2 < history.length || !valid.length) return null;
    return valid[Math.floor(valid.length / 2)];
  };
}

export function createVoice(options = {}) {
  const { AudioContext: Context = globalThis.AudioContext || globalThis.webkitAudioContext } = options;
  let ctx = null, stream = null, analyser = null, buffer = null;
  let smooth = createSmoother(), clarity = 0;

  async function start() {
    // Resolved only on a press: touching navigator.mediaDevices at load reads as a microphone request in some hosts.
    const mediaDevices = 'mediaDevices' in options ? options.mediaDevices : globalThis.navigator?.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return { ok: false, reason: 'unavailable' };
    try {
      stream = await mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
    } catch (error) {
      stream = null;
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError' || error.name === 'PermissionDeniedError');
      return { ok: false, reason: denied ? 'denied' : 'unavailable' };
    }
    try {
      if (!Context) throw new Error('no Web Audio');
      ctx = new Context();
      if (ctx.state === 'suspended') await ctx.resume();
      analyser = ctx.createAnalyser();
      analyser.fftSize = VOICE.FFT_SIZE;
      buffer = new Float32Array(analyser.fftSize);
      // Not connected to the destination: the microphone is never played back.
      ctx.createMediaStreamSource(stream).connect(analyser);
      smooth = createSmoother();
      return { ok: true };
    } catch {
      stop();
      return { ok: false, reason: 'unavailable' };
    }
  }

  function stop() {
    if (stream) for (const track of stream.getTracks()) track.stop();
    if (ctx) ctx.close().catch(() => {});
    stream = null; ctx = null; analyser = null; buffer = null;
  }

  function read() {
    if (!analyser) return null;
    analyser.getFloatTimeDomainData(buffer);
    const pitch = detectPitch(buffer, ctx.sampleRate);
    const ok = pitch && pitch.clarity >= VOICE.MIN_CLARITY;
    if (ok) clarity = pitch.clarity;
    const freq = smooth(ok ? pitch.freq : null);
    return freq === null ? null : { freq, clarity, note: noteName(freq) };
  }

  return { start, stop, read };
}
