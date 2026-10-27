// User settings: validation and safe persistence. localStorage is touched only here, always inside try/catch.
import { MATERIALS, PRESETS } from './physics.js';
import { PALETTES } from './palettes.js';

export const STORAGE_KEY = 'resona.play.v1';

export const DEFAULTS = Object.freeze({
  preset: 0, material: 'aluminum', thickness: 1.5, length: 30, proportion: 'screen', view: 'sand',
  damping: 0.015, mix: 1,
  tuning: 'patterns', frequency: 404.7, count: 'auto', grain: 1.2, spread: 1.2, exposure: 1,
  palette: 'sand', custom: null, glowAmount: null,
  soundOn: false, exportScale: 2, transparent: false, onboarded: false
});

const PROPORTIONS = ['screen', 1, 4 / 3, 1.5, 2];
const COLOR = /^#[0-9a-f]{6}$/i;

const number = (min, max, round = false) => v => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const c = Math.max(min, Math.min(max, v));
  return round ? Math.round(c) : c;
};
const oneOf = list => v => list.includes(v) ? v : undefined;
const bool = v => typeof v === 'boolean' ? v : undefined;

function customColors(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || !COLOR.test(v.background) || !COLOR.test(v.sand)) return undefined;
  if (!Array.isArray(v.glow) || v.glow.length !== 3 || !v.glow.every(c => COLOR.test(c))) return undefined;
  return { background: v.background, sand: v.sand, glow: [...v.glow] };
}

// Each rule returns the cleaned value, or undefined to fall back to the default.
const RULES = {
  preset: number(0, PRESETS.length - 1, true),
  material: v => Object.hasOwn(MATERIALS, v) ? v : undefined,
  thickness: number(0.5, 4),
  length: number(15, 60),
  proportion: v => v === 'screen' ? v : PROPORTIONS.find(p => typeof p === 'number' && typeof v === 'number' && Math.abs(p - v) < 1e-6),
  view: oneOf(['sand', 'contours', 'field']),
  damping: number(0.005, 0.08),
  mix: number(-1, 1),
  tuning: oneOf(['patterns', 'manual']),
  frequency: number(20, 16000),
  count: v => v === 'auto' ? v : number(20000, 600000, true)(v),
  grain: number(0.5, 2.8),
  spread: number(0.3, 3),
  exposure: number(0.4, 1.8),
  palette: oneOf([...PALETTES.map(p => p.id), 'custom']),
  custom: customColors,
  glowAmount: v => v === null ? null : number(0, 1)(v),
  soundOn: bool,
  exportScale: oneOf([1, 2, '4k']),
  transparent: bool,
  onboarded: bool
};

export function validateSettings(candidate) {
  const source = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
  const settings = {};
  for (const key of Object.keys(DEFAULTS)) {
    const value = Object.hasOwn(source, key) ? RULES[key](source[key]) : undefined;
    settings[key] = value === undefined ? DEFAULTS[key] : value;
  }
  if (settings.palette === 'custom' && !settings.custom) settings.palette = DEFAULTS.palette;
  return settings;
}

// The default argument is resolved inside try: reading localStorage itself throws when storage is blocked.
export function loadSettings(storage) {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    const raw = store ? store.getItem(STORAGE_KEY) : null;
    return validateSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return validateSettings(null);
  }
}

export function saveSettings(settings, storage) {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    if (store) store.setItem(STORAGE_KEY, JSON.stringify(validateSettings(settings)));
    return true;
  } catch {
    return false;
  }
}
