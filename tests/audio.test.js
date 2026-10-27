import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, foldTone } from '../audio.js';

test('foldTone moves any plate frequency by whole octaves into 110–880 Hz', () => {
  // Expected values by hand: 55·2 = 110, 1000/2 = 500, 16000/32 = 500, 20·8 = 160, 404.7 stays.
  assert.equal(foldTone(55), 110);
  assert.equal(foldTone(404.7), 404.7);
  assert.equal(foldTone(1000), 500);
  assert.equal(foldTone(16000), 500);
  assert.equal(foldTone(20), 160);
  for (const hz of [21, 81, 109.9, 880, 881, 2500, 9999]) {
    const f = foldTone(hz);
    assert.ok(f >= 110 && f < 880, `${hz} → ${f}`);
    const octaves = Math.log2(f / hz);
    assert.ok(Math.abs(octaves - Math.round(octaves)) < 1e-9, `${hz} → ${f} is a whole number of octaves`);
  }
});

test('Without Web Audio every call is a quiet no-op and there is no stream', () => {
  const audio = createAudio({ AudioContext: null });
  assert.doesNotThrow(() => {
    audio.unlock();
    audio.setEnabled(true);
    audio.setTone(404.7);
    audio.rustle(1);
    audio.gliss(0, 0.5);
    audio.glissEnd(0);
    audio.gather(1);
    audio.thump(1);
    audio.note(440);
    audio.pause();
    audio.resume();
  });
  assert.equal(audio.stream(), null);
});
