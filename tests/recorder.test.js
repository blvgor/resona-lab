import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMimeType, startRecording } from '../recorder.js';

test('pickMimeType prefers webm/vp9, then vp8, then mp4', () => {
  assert.deepEqual(pickMimeType(() => true), { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' });
  assert.deepEqual(pickMimeType(t => !t.includes('vp9')), { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' });
  // Safari: only mp4.
  const mp4 = pickMimeType(t => t.startsWith('video/mp4'));
  assert.equal(mp4.ext, 'mp4');
  assert.ok(mp4.mimeType.startsWith('video/mp4'));
  assert.equal(pickMimeType(() => false), null);
});

test('Without MediaRecorder there is no format and recording refuses with a clear code', () => {
  assert.equal(pickMimeType(), null); // Node has no MediaRecorder
  assert.throws(() => startRecording({ captureStream: () => ({}) }, null, {}), error => error.code === 'NO_RECORDER');
});
