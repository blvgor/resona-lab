import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATE, PRESETS, naturalFrequency, modeSet } from '../physics.js';

const plateFor = aspect => ({ material: 'aluminum', thickness: 1.5, length: 30, aspect });

// Independent max |w| estimate on a finer grid than the one modeSet normalizes on.
function maxAmplitude(modes, size = 97) {
  let max = 0;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = i / (size - 1), y = j / (size - 1);
    let re = 0, im = 0;
    for (const md of modes) {
      const b = Math.sin(md.m * Math.PI * x) * Math.sin(md.n * Math.PI * y);
      re += md.re * b; im += md.im * b;
    }
    max = Math.max(max, Math.hypot(re, im));
  }
  return max;
}

test('modeSet: presets give at most 16 modes normalized to max|w|≈1 on aspect 0.5, 1 and 2', () => {
  for (const aspect of [0.5, 1, 2]) for (const preset of PRESETS) {
    const plate = plateFor(aspect);
    const set = modeSet({ preset, plate, frequency: 1234, damping: 0.015, mix: preset.mix, manual: false });
    assert.ok(set.modes.length >= 1 && set.modes.length <= 16);
    for (const md of set.modes) assert.ok(Number.isFinite(md.re) && Number.isFinite(md.im) && md.m >= 1 && md.n >= 1);
    // Pattern mode ignores the frequency argument and sits on the preset's own resonance.
    assert.ok(Math.abs(set.frequency - naturalFrequency(preset.m, preset.n, plate)) < 1e-9);
    const max = maxAmplitude(set.modes);
    assert.ok(max > 0.95 && max < 1.05, `preset ${preset.id} aspect ${aspect}: max ${max}`);
    assert.ok(Number.isInteger(set.dominant.m) && Number.isInteger(set.dominant.n));
  }
});

test('modeSet: manual frequency takes the 16 strongest of 81 modes, normalized, across the audible range', () => {
  for (const aspect of [0.5, 1, 2]) for (const frequency of [20, 404.7, 1000, 5000, 16000]) {
    const set = modeSet({ preset: PRESETS[0], plate: plateFor(aspect), frequency, damping: 0.015, mix: 1, manual: true });
    assert.equal(set.modes.length, 16);
    assert.equal(set.frequency, frequency);
    const max = maxAmplitude(set.modes);
    assert.ok(max > 0.95 && max < 1.05, `f ${frequency} aspect ${aspect}: max ${max}`);
  }
  const a = modeSet({ preset: PRESETS[0], plate: plateFor(1), frequency: 404.7, damping: 0.015, mix: 1, manual: true });
  const b = modeSet({ preset: PRESETS[0], plate: plateFor(1), frequency: 1000, damping: 0.015, mix: 1, manual: true });
  assert.notDeepEqual(a.dominant, b.dominant);
});

test('modeSet: the default plate in pattern mode reproduces the (1,3)±(3,1) pair at 404.7 Hz', () => {
  const set = modeSet({ preset: PRESETS[0], plate: { ...DEFAULT_STATE }, frequency: 0, damping: 0.015, mix: 1, manual: false });
  assert.ok(set.frequency > 404 && set.frequency < 405);
  const pairs = set.modes.map(md => `${md.m},${md.n}`).sort();
  assert.deepEqual(pairs, ['1,3', '3,1']);
});

test('modeSet: manual modes share one phase, so the field is real and its zeros are nodal lines, not points', () => {
  for (const frequency of [728.5, 1173.7, 3440]) {
    const set = modeSet({ preset: PRESETS[0], plate: plateFor(1), frequency, damping: 0.015, mix: 1, manual: true });
    for (const t of set.modes) assert.equal(t.im, 0);
    assert.ok(set.modes.some(t => t.re !== 0));
  }
});
