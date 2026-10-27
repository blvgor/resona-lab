import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch } from '../pitch.js';

const sine = (freq, sampleRate, { size = 2048, amplitude = .4, phase = .3, harmonics = 0 } = {}) =>
  Float32Array.from({ length: size }, (_, i) => {
    const t = i / sampleRate;
    return amplitude * (Math.sin(2 * Math.PI * freq * t + phase) + harmonics * Math.sin(4 * Math.PI * freq * t));
  });

test('Pure sines at 220, 440 and 880 Hz are detected within ±1 %', () => {
  for (const sampleRate of [44100, 48000]) for (const freq of [220, 440, 880]) {
    const result = detectPitch(sine(freq, sampleRate), sampleRate);
    assert.ok(result, `${freq} Hz @ ${sampleRate}`);
    assert.ok(Math.abs(result.freq - freq) / freq < .01, `${freq} Hz @ ${sampleRate} → ${result.freq}`);
    assert.ok(result.clarity > .8 && result.clarity <= 1, `clarity ${result.clarity}`);
  }
});

test('A voice-like tone with a strong second harmonic keeps its fundamental', () => {
  const result = detectPitch(sine(196, 48000, { harmonics: .8 }), 48000);
  assert.ok(result && Math.abs(result.freq - 196) / 196 < .01, `→ ${result && result.freq}`);
});

test('Silence and near-silence give null', () => {
  assert.equal(detectPitch(new Float32Array(2048), 48000), null);
  assert.equal(detectPitch(sine(440, 48000, { amplitude: .005 }), 48000), null);
});

test('Tones outside 70–1500 Hz give null', () => {
  assert.equal(detectPitch(sine(40, 48000, { size: 4096 }), 48000), null);
  assert.equal(detectPitch(sine(3000, 48000), 48000), null);
});
