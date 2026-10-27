import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTES, glowColor, hexToRgb } from '../palettes.js';

// Story 25 of the spec, verbatim.
const expected = [
  ['Sand', '#090a09', '#e7d7b1', null],
  ['Red wave', '#1a0204', '#ffe2da', ['#2a0206', '#8f0d16', '#ff3b3b']],
  ['Lavender', '#24132f', '#fff1fb', ['#3b2350', '#b07ad6', '#f2b8e6']],
  ['Cobalt', '#05062a', '#e3e6ff', ['#0a0a5e', '#2f2bff', '#8f7bff']],
  ['Embers', '#0d0705', '#ffd6a0', ['#1a0a04', '#a63a0a', '#ffb347']],
  ['Moss', '#060a06', '#dff2c8', ['#0a1408', '#2e6b3a', '#b6e08a']]
];

test('Six palettes with the names and colours of story 25; Sand first and without glow', () => {
  assert.equal(PALETTES.length, 6);
  assert.equal(PALETTES[0].id, 'sand');
  assert.equal(PALETTES[0].glowAmount, 0);
  assert.equal(new Set(PALETTES.map(p => p.id)).size, 6);
  PALETTES.forEach((p, i) => {
    const [name, background, sand, glow] = expected[i];
    assert.equal(p.name, name);
    assert.equal(p.background, background);
    assert.equal(p.sand, sand);
    assert.equal(p.glow.length, 3);
    for (const c of p.glow) assert.match(c, /^#[0-9a-f]{6}$/);
    if (glow) {
      assert.deepEqual(p.glow, glow);
      assert.ok(p.glowAmount >= .6 && p.glowAmount <= .85, `${p.id} glowAmount ${p.glowAmount}`);
    }
  });
});

test('glowColor hits the three stops at amplitude 0, 0.5 and 1, blends between them and clamps outside', () => {
  const red = PALETTES[1];
  assert.deepEqual(glowColor(red, 0), [0x2a, 0x02, 0x06]);
  assert.deepEqual(glowColor(red, .5), [0x8f, 0x0d, 0x16]);
  assert.deepEqual(glowColor(red, 1), [0xff, 0x3b, 0x3b]);
  assert.deepEqual(glowColor(red, -3), [0x2a, 0x02, 0x06]);
  assert.deepEqual(glowColor(red, 7), [0xff, 0x3b, 0x3b]);
  const quarter = glowColor(red, .25);
  quarter.forEach((v, i) => assert.ok(Math.abs(v - ([0x2a, 0x02, 0x06][i] + [0x8f, 0x0d, 0x16][i]) / 2) < 1e-9));
  assert.deepEqual(hexToRgb('#ff3b3b'), [255, 59, 59]);
});
