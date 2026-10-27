import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoice, noteName, createSmoother } from '../voice.js';

test('noteName names equal-tempered notes relative to A4 = 440 Hz', () => {
  assert.equal(noteName(440), 'A4');
  assert.equal(noteName(261.63), 'C4');
  assert.equal(noteName(466.16), 'A#4');
  assert.equal(noteName(110), 'A2');
  assert.equal(noteName(452), 'A4'); // +46 cents still rounds to A4
  assert.equal(noteName(1046.5), 'C6');
});

test('The median smoother ignores a single octave jump and a dropped frame', () => {
  const smooth = createSmoother(5);
  let out;
  for (const f of [220, 221, 440, 219, null]) out = smooth(f);
  assert.ok(Math.abs(out - 220) <= 1, `median ${out}`);
  // Nothing but silence for a whole window → null.
  for (let i = 0; i < 5; i++) out = smooth(null);
  assert.equal(out, null);
});

test('voice.start reports unavailable without a microphone API and denied on a refused permission', async () => {
  const none = createVoice({ mediaDevices: null });
  assert.deepEqual(await none.start(), { ok: false, reason: 'unavailable' });
  assert.equal(none.read(), null);

  const refuse = name => ({ getUserMedia: () => Promise.reject(Object.assign(new Error('no'), { name })) });
  assert.deepEqual(await createVoice({ mediaDevices: refuse('NotAllowedError') }).start(), { ok: false, reason: 'denied' });
  assert.deepEqual(await createVoice({ mediaDevices: refuse('SecurityError') }).start(), { ok: false, reason: 'denied' });
  assert.deepEqual(await createVoice({ mediaDevices: refuse('NotFoundError') }).start(), { ok: false, reason: 'unavailable' });
});
