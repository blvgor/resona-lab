import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, STORAGE_KEY, validateSettings, loadSettings, saveSettings } from '../settings.js';

const memory = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: k => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, String(v)), data };
};
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };

test('Defaults and storage key match the interface', () => {
  assert.equal(STORAGE_KEY, 'resona.play.v1');
  assert.deepEqual(DEFAULTS, {
    preset: 0, material: 'aluminum', thickness: 1.5, length: 30, proportion: 'screen', view: 'sand',
    damping: 0.015, mix: 1, tuning: 'patterns', frequency: 404.7, count: 'auto', grain: 1.2, spread: 1.2, exposure: 1,
    palette: 'sand', custom: null, glowAmount: null, soundOn: false, exportScale: 2, transparent: false, onboarded: false
  });
});

test('Broken JSON, garbage values and a throwing storage all load as DEFAULTS', () => {
  assert.deepEqual(loadSettings(memory()), DEFAULTS);
  assert.deepEqual(loadSettings(memory({ [STORAGE_KEY]: '{not json' })), DEFAULTS);
  assert.deepEqual(loadSettings(memory({ [STORAGE_KEY]: '42' })), DEFAULTS);
  assert.deepEqual(loadSettings(memory({ [STORAGE_KEY]: 'null' })), DEFAULTS);
  assert.deepEqual(loadSettings(memory({ [STORAGE_KEY]: '[1,2,3]' })), DEFAULTS);
  assert.deepEqual(loadSettings(throwing), DEFAULTS);
  assert.deepEqual(loadSettings(null), DEFAULTS);
  const garbage = {
    preset: 'x', material: 'gold', thickness: 'thick', length: NaN, proportion: 7, view: 'webgl', damping: null,
    mix: {}, tuning: 'auto', frequency: Infinity, count: 'many', grain: [], spread: undefined, exposure: true,
    palette: 'neon', custom: 'red', glowAmount: 'bright', soundOn: 'yes', exportScale: 3, transparent: 1, onboarded: 'no',
    __proto__: { evil: 1 }, extra: 'drop me'
  };
  assert.deepEqual(validateSettings(garbage), DEFAULTS);
  assert.deepEqual(loadSettings(memory({ [STORAGE_KEY]: JSON.stringify(garbage) })), DEFAULTS);
});

test('Valid values survive; numbers are clamped like validateState; unions keep their allowed forms', () => {
  const s = validateSettings({
    preset: 47.4, material: 'steel', thickness: 99, length: 1, proportion: 4 / 3, view: 'contours', damping: 0,
    mix: -5, tuning: 'manual', frequency: 5, count: 9_000_000, grain: .1, spread: 9, exposure: 9,
    palette: 'cobalt', custom: { background: '#000000', sand: '#ffffff', glow: ['#111111', '#222222', '#333333'] },
    glowAmount: 2, soundOn: true, exportScale: '4k', transparent: true, onboarded: true
  });
  assert.deepEqual(s, {
    preset: 47, material: 'steel', thickness: 4, length: 15, proportion: 4 / 3, view: 'contours', damping: .005,
    mix: -1, tuning: 'manual', frequency: 20, count: 600000, grain: .5, spread: 3, exposure: 1.8,
    palette: 'cobalt', custom: { background: '#000000', sand: '#ffffff', glow: ['#111111', '#222222', '#333333'] },
    glowAmount: 1, soundOn: true, exportScale: '4k', transparent: true, onboarded: true
  });
  assert.equal(validateSettings({ count: 10 }).count, 20000);
  assert.equal(validateSettings({ count: 150000.6 }).count, 150001);
  assert.equal(validateSettings({ proportion: 2 }).proportion, 2);
  assert.equal(validateSettings({ custom: { background: '#000000', sand: 'url(x)', glow: [] } }).custom, null);
  // A custom palette without custom colours falls back to the default palette.
  assert.equal(validateSettings({ palette: 'custom' }).palette, 'sand');
});

test('saveSettings round-trips through storage and never throws', () => {
  const store = memory();
  const s = { ...DEFAULTS, palette: 'moss', soundOn: true, preset: 5 };
  saveSettings(s, store);
  assert.deepEqual(loadSettings(store), s);
  assert.doesNotThrow(() => saveSettings(s, throwing));
  assert.doesNotThrow(() => saveSettings(s, null));
  assert.doesNotThrow(() => saveSettings(undefined, store));
});
