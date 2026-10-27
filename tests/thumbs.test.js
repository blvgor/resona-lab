import test from 'node:test';
import assert from 'node:assert/strict';
import { paintThumb } from '../thumbs.js';
import { PRESETS } from '../physics.js';

function fakeCanvas(size) {
  const canvas = { width: size, height: size, painted: null };
  canvas.getContext = () => ({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: image => { canvas.painted = image; }
  });
  return canvas;
}

const plate = { material: 'aluminum', thickness: 1.5, length: 30, aspect: 1 };
const colors = { background: '#090a09', sand: '#e7d7b1' };

test('A thumbnail is the background with sand on the nodal lines: dark antinode in the middle, bright ring around', () => {
  const size = 64, canvas = fakeCanvas(size);
  paintThumb(canvas, PRESETS[0], plate, colors);
  const { data } = canvas.painted;
  const px = (x, y) => [...data.slice((y * size + x) * 4, (y * size + x) * 4 + 4)];
  // Preset 0 (Orbit, (1,3)+(3,1)): the centre is an antinode → plain background.
  assert.deepEqual(px(size / 2, size / 2), [9, 10, 9, 255]);
  let bright = 0;
  for (let i = 0; i < data.length; i += 4) {
    assert.equal(data[i + 3], 255);
    // Every pixel lies between background and sand.
    assert.ok(data[i] <= 0xe7 && data[i] >= 9 && data[i + 2] <= 0xb1);
    if (data[i] > 120) bright++;
  }
  const share = bright / (size * size);
  assert.ok(share > 0.01 && share < 0.4, `bright share ${share}`);
});

test('Thumbnails follow the palette colours', () => {
  const canvas = fakeCanvas(32);
  paintThumb(canvas, PRESETS[5], plate, { background: '#1a0204', sand: '#ffe2da' });
  const { data } = canvas.painted;
  assert.deepEqual([...data.slice(0, 3)], [0x1a, 0x02, 0x04]); // corner: edges are cut, plain background
});
