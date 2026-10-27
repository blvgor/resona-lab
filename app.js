// Resona shell: DOM, the animation loop, gestures → engine/pieces/audio, keyboard, panel, ribbon, saving, auto quality.
// No physics, shaders or synthesis here — only calls across the module boundaries.
import { PRESETS, MATERIALS, modeSet, naturalFrequency } from './physics.js';
import { PALETTES } from './palettes.js';
import { DEFAULTS, loadSettings, saveSettings, validateSettings } from './settings.js';
import { createEngine, plateRect, snapshotSize } from './engine.js';
import { createPieces } from './pieces.js';
import { createGestures } from './gestures.js';
import { createAudio } from './audio.js';
import { createVoice } from './voice.js';
import { startRecording } from './recorder.js';
import { paintThumb } from './thumbs.js';

const PIECE_RADIUS = 0.08;                 // short sides
const PIANO = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'];
// Nine figures in rising pitch: Orbit, Petals, Wings, Quatrefoil, Iris, Mandala, Constellation, Lotus, Crown.
const PIANO_PRESETS = [0, 2, 6, 8, 12, 16, 22, 28, 34];
const QUALITY = Object.freeze({ MIN_FPS: 40, LOW_SEC: 3, GRACE_SEC: 2.5, STEP: 0.7, FLOOR: 30000 });
const VOICE_EVERY_MS = 90;                 // how often a sung note may retune the plate
const VOICE_MIN_SEMITONES = 0.3;
const MAX_REC_SEC = 30;
const RIBBON_MIN_HZ = 20, RIBBON_MAX_HZ = 16000;
// After wheel / two-finger / ribbon-slider tuning rests, the plate settles on the nearest resonance close by.
const SNAP = Object.freeze({ IDLE_MS: 150, SEC: 0.3, SEMITONES: 0.5, MAX_MODE: 9 });
const WHEEL_LINE_PX = 33;

const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const fmt = (v, digits = 0) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Firefox reports wheel steps in lines (deltaMode 1) or pages (2); everything downstream expects pixels.
const wheelPixels = (e, delta) => e.deltaMode === 1 ? delta * WHEEL_LINE_PX : e.deltaMode === 2 ? delta * innerHeight : delta;

let settings = { ...loadSettings(), view: 'sand', proportion: 'screen' };
const canvas = $('field');
const audio = createAudio();
const voice = createVoice();
const pieces = createPieces();
const gestures = createGestures({ width: innerWidth, height: innerHeight });

let engine;
try {
  engine = createEngine(canvas, { count: initialCount(), onError: message => showStatus(message) });
} catch (error) {
  document.body.classList.add('no-gl');
  $('fatal').hidden = false;
  if (error.code !== 'NO_WEBGL2') $('fatal-text').textContent = `The field did not start: ${error.message}`;
  throw error;
}

let grains = initialCount();
let paused = false;
let held = null;
let current = null;                        // last modeSet result
let pendingScrub = 0;
let voiceOn = false, lastVoiceApply = 0, voiceNote = '';
let recording = null;
let qualityLowSince = null, qualityGraceUntil = 0;

// ---------- device & geometry ----------

function initialCount() {
  if (typeof settings.count === 'number') return settings.count;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(screen.width || innerWidth, screen.height || innerHeight);
  if (coarse && shortSide < 600) return 80000;    // phone
  if (coarse) return 120000;                      // tablet
  return 200000;                                  // desktop
}

const windowAspect = () => innerWidth / innerHeight;

// D01: the full-screen plate runs the physics of a square plate stretched over the window; explicit proportions are honest rectangles.
function plateGeometry() {
  const rect = plateRect(windowAspect(), settings.proportion);
  const aspect = settings.proportion === 'screen' ? 1 : settings.proportion;
  return { rect, plate: { material: settings.material, thickness: settings.thickness, length: settings.length, aspect } };
}

// ---------- physics → engine ----------

function applyModes(morphSec = 1.2) {
  const { rect, plate } = plateGeometry();
  engine.setPlate(rect);
  const manual = settings.tuning === 'manual';
  current = modeSet({
    preset: PRESETS[settings.preset], plate, frequency: settings.frequency,
    damping: settings.damping, mix: settings.mix, manual
  });
  if (!manual) settings.frequency = current.frequency;
  engine.setModes(current.modes, { morphSec });
  audio.setTone(current.frequency);
  renderReadout();
}

function currentColors() {
  if (settings.palette === 'custom' && settings.custom) {
    return { ...settings.custom, glowAmount: settings.glowAmount ?? 0.7 };
  }
  const p = PALETTES.find(item => item.id === settings.palette) || PALETTES[0];
  return { background: p.background, sand: p.sand, glow: [...p.glow], glowAmount: settings.glowAmount ?? p.glowAmount };
}

function applyLook() {
  const c = currentColors();
  engine.setLook({
    view: settings.view, background: c.background, sand: c.sand, glow: c.glow, glowAmount: c.glowAmount,
    grain: settings.grain, exposure: settings.exposure, spread: settings.spread, transparent: false
  });
  const root = document.documentElement.style;
  root.setProperty('--bg', c.background);
  root.setProperty('--sand', c.sand);
  document.querySelector('meta[name="theme-color"]').content = c.background;
}

// ---------- readout (top left) ----------

let shownName = '', shownHz = '', shownNote = null;
function renderReadout() {
  const name = settings.tuning === 'manual'
    ? `Manual · mode (${current.dominant.m}, ${current.dominant.n})`
    : PRESETS[settings.preset].name;
  const hz = fmt(current.frequency, 1);
  if (name !== shownName) {
    shownName = name;
    $('figure-name').textContent = name;
    canvas.setAttribute('aria-label', `Sand on a singing plate: ${name}, ${hz} Hz`);
  }
  if (hz !== shownHz) { shownHz = hz; $('hz-value').textContent = hz; }
  const note = voiceOn ? (voiceNote ? `Voice: ${voiceNote}` : 'Voice: sing a note') : null;
  if (note !== shownNote) {
    shownNote = note;
    $('voice-note').hidden = note === null;
    if (note !== null) $('voice-note').textContent = note;
  }
}

// ---------- status plate (bottom left) ----------

let statusTimer = 0, sticky = null;
function showStatus(message, { accent = false, hold = false } = {}) {
  const el = $('status');
  clearTimeout(statusTimer);
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle('accent', accent);
  // Restart the entrance animation.
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  if (!hold) statusTimer = setTimeout(() => { if (sticky) showStatus(sticky.message, sticky.options); else el.hidden = true; }, 4200);
}
function setSticky(message, options = {}) {
  sticky = message ? { message, options: { ...options, hold: true } } : null;
  if (sticky) showStatus(message, sticky.options);
  else { clearTimeout(statusTimer); $('status').hidden = true; }
}

// ---------- saving ----------

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings(settings), 200);
}

// ---------- figures ----------

function choosePreset(index, { note = false, morphSec = 1.2 } = {}) {
  settings.preset = index;
  settings.tuning = 'patterns';
  settings.mix = PRESETS[index].mix;
  applyModes(morphSec);
  if (note) audio.note(current.frequency);
  markThumb();
  syncPanel();
  persist();
}

function randomPreset() {
  let next = settings.preset;
  while (next === settings.preset) next = Math.floor(Math.random() * PRESETS.length);
  choosePreset(next, { note: true });
}

function setManualFrequency(hz, morphSec) {
  settings.tuning = 'manual';
  settings.frequency = clamp(hz, 20, 16000);
  applyModes(morphSec);
  markThumb();
}

// ---------- gestures ----------

let onboarding = !settings.onboarded;
function firstGesture() {
  if (!onboarding) return;
  onboarding = false;
  settings.onboarded = true;
  persist();
  const hints = $('hints');
  hints.classList.add('leaving');
  setTimeout(() => { hints.hidden = true; }, 450);
}

function handle(intents) {
  for (const it of intents) {
    switch (it.type) {
      case 'break':
        engine.setPointer({ ...it, mode: 'break' });
        audio.rustle(it.strength);
        firstGesture();
        break;
      case 'hover':
        engine.setPointer({ ...it, mode: 'idle' });
        break;
      case 'grab': {
        const { slot, evicted } = pieces.grab(it.x, it.y, PIECE_RADIUS, windowAspect());
        // D02: the evicted piece lets go of its sand before the slot is reused.
        if (evicted !== null) { engine.release(evicted); audio.glissEnd(evicted); }
        engine.grab(slot, { x: it.x, y: it.y, radius: PIECE_RADIUS, aspect: windowAspect() });
        held = slot;
        canvas.classList.add('grabbing');
        firstGesture();
        break;
      }
      case 'drag':
        if (held !== null) pieces.hold(held, it.x, it.y);
        engine.setPointer({ ...it, mode: 'hold' });
        break;
      case 'throw':
        if (held !== null) pieces.release(held, it.vx, it.vy);
        held = null;
        canvas.classList.remove('grabbing');
        break;
      case 'shock':
        engine.shock(it.x, it.y);
        audio.thump(1);
        firstGesture();
        break;
      case 'scrub':
        pendingScrub += it.delta;
        firstGesture();
        break;
      default: break;
    }
  }
}

const pointer = e => ({ x: e.clientX, y: e.clientY, t: e.timeStamp || performance.now(), id: e.pointerId, pointerType: e.pointerType, buttons: e.buttons });
canvas.addEventListener('pointerdown', e => {
  audio.unlock();
  try { canvas.setPointerCapture(e.pointerId); } catch { /* the pointer may already be gone */ }
  handle(gestures.down(pointer(e)));
});
canvas.addEventListener('pointermove', e => {
  // Coalesced samples keep fast flicks accurate where the browser batches moves.
  const samples = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const s of samples.length ? samples : [e]) handle(gestures.move(pointer(s)));
});
canvas.addEventListener('pointerup', e => handle(gestures.up(pointer(e))));
canvas.addEventListener('pointercancel', e => handle(gestures.up(pointer(e))));
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  audio.unlock();
  handle(gestures.wheel({ deltaY: wheelPixels(e, e.deltaY), t: e.timeStamp }));
}, { passive: false });

// Wheel and two-finger scrubs arrive many times a frame; the plate is retuned once per frame.
function flushScrub() {
  if (!pendingScrub) return;
  const delta = pendingScrub;
  pendingScrub = 0;
  setManualFrequency(settings.frequency * 2 ** (delta / 12), 0.25);
  markTuneInput();
  syncPanel();
  persist();
}

// ---------- settling on a resonance ----------
// Between resonances the sand gathers in clumps. Continuous tuning glides freely while it moves; once it has rested
// for SNAP.IDLE_MS, the frequency glides over SNAP.SEC to the nearest naturalFrequency(m, n) of the current plate
// (D01 geometry) if one lies within SNAP.SEMITONES. Typed numbers and the voice never call markTuneInput.

let tuneTouched = false;
let tuneRestFrom = null;                   // step clock of the last continuous tuning input
let tunedHz = 0;                           // the frequency that input left; anything else retuning since cancels the snap
let snap = null;                           // { from, to, start, hz }

function markTuneInput() {
  tuneTouched = true;
  snap = null;
}

function nearestResonance(hz, maxSemitones = SNAP.SEMITONES) {
  const { plate } = plateGeometry();
  let best = null, bestSemis = Infinity;
  for (let m = 1; m <= SNAP.MAX_MODE; m++) {
    for (let n = 1; n <= SNAP.MAX_MODE; n++) {
      const f = naturalFrequency(m, n, plate);
      const semis = Math.abs(12 * Math.log2(f / hz));
      if (semis < bestSemis) { bestSemis = semis; best = f; }
    }
  }
  return bestSemis <= maxSemitones && best >= RIBBON_MIN_HZ && best <= RIBBON_MAX_HZ ? best : null;
}

function settleTuning(now) {
  if (sliderHeld) return;
  if (tuneTouched) {
    tuneTouched = false;
    tuneRestFrom = now;
    tunedHz = settings.frequency;
    return;
  }
  if (tuneRestFrom !== null && now - tuneRestFrom >= SNAP.IDLE_MS) {
    tuneRestFrom = null;
    if (settings.tuning === 'manual' && settings.frequency === tunedHz) {
      const to = nearestResonance(settings.frequency);
      if (to !== null && to !== settings.frequency) snap = { from: settings.frequency, to, start: now, hz: settings.frequency };
    }
  }
  if (!snap) return;
  if (settings.tuning !== 'manual' || settings.frequency !== snap.hz) { snap = null; return; }
  const t = Math.min(1, (now - snap.start) / (SNAP.SEC * 1000));
  const eased = t * t * (3 - 2 * t);
  setManualFrequency(t >= 1 ? snap.to : snap.from * (snap.to / snap.from) ** eased, 0.25);
  snap.hz = settings.frequency;
  syncPanel();
  if (t >= 1) { snap = null; persist(); }
}

// ---------- voice ----------

async function toggleVoice() {
  const button = $('voice-toggle');
  if (voiceOn) {
    voice.stop();
    voiceOn = false;
    voiceNote = '';
    button.setAttribute('aria-pressed', 'false');
    renderReadout();
    return;
  }
  button.setAttribute('aria-pressed', 'true');
  const result = await voice.start();
  if (!result.ok) {
    button.setAttribute('aria-pressed', 'false');
    showStatus(result.reason === 'denied'
      ? 'Microphone blocked. Allow it in your browser settings'
      : 'No microphone found. Connect one and try again');
    return;
  }
  voiceOn = true;
  showStatus('Sing or whistle a note and the field will follow');
  renderReadout();
}

function readVoice(now) {
  if (!voiceOn) return;
  const heard = voice.read();
  voiceNote = heard ? heard.note : '';
  if (heard && now - lastVoiceApply > VOICE_EVERY_MS) {
    const semis = Math.abs(12 * Math.log2(heard.freq / settings.frequency));
    if (settings.tuning !== 'manual' || semis > VOICE_MIN_SEMITONES) {
      lastVoiceApply = now;
      setManualFrequency(heard.freq, 0.35);
      syncPanel();
    }
  }
  renderReadout();
}

// ---------- sound ----------

function setSound(on) {
  settings.soundOn = on;
  audio.unlock();
  audio.setEnabled(on);
  $('sound-toggle').setAttribute('aria-pressed', String(on));
  $('sound-toggle').title = on ? 'Turn sound off' : 'Turn sound on';
  syncPanel();
  persist();
}

// ---------- pause, scatter ----------

function togglePause() {
  paused = !paused;
  setSticky(paused ? 'Paused. The frame is frozen, ready to save' : null, { accent: true });
  qualityGraceUntil = performance.now() + QUALITY.GRACE_SEC * 1000;
}

function scatter() {
  engine.scatter();
  qualityGraceUntil = performance.now() + QUALITY.GRACE_SEC * 1000;
}

// ---------- auto quality ----------

function checkQuality(now) {
  if (settings.count !== 'auto' || paused || document.hidden || now < qualityGraceUntil) { qualityLowSince = null; return; }
  if (engine.fps() >= QUALITY.MIN_FPS || grains <= QUALITY.FLOOR) { qualityLowSince = null; return; }
  qualityLowSince ??= now;
  if (now - qualityLowSince < QUALITY.LOW_SEC * 1000) return;
  grains = Math.max(QUALITY.FLOOR, Math.round(grains * QUALITY.STEP / 1000) * 1000);
  engine.setCount(grains);
  qualityLowSince = null;
  qualityGraceUntil = now + QUALITY.GRACE_SEC * 1000;
  showStatus(`This device was falling behind, so there is less sand: ${fmt(grains)} grains`);
  syncPanel();
}

// ---------- export ----------

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const figureSlug = () => settings.tuning === 'manual' ? 'manual' : String(settings.preset + 1).padStart(2, '0');
const exportOptions = () => settings.exportScale === '4k' ? { longSide: 3840 } : { scale: settings.exportScale };
function exportSize() {
  return snapshotSize({ width: innerWidth, height: innerHeight, ...exportOptions() });
}

async function savePng() {
  const button = $('save-png');
  button.disabled = true;
  try {
    const { width, height } = exportSize();
    const blob = await engine.snapshot({ ...exportOptions(), transparent: settings.transparent });
    download(blob, `resona-${figureSlug()}-${fmt(current.frequency, 1).replace(/\s/g, '').replace(',', '.')}hz-${width}x${height}.png`);
    showStatus(`PNG saved: ${width} × ${height}`);
  } catch (error) {
    showStatus(`Could not save the PNG: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

const clock = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
function toggleRecording() {
  if (recording) { recording.stop(); return; }
  audio.unlock();
  try {
    recording = startRecording(canvas, audio.stream(), {
      maxSec: MAX_REC_SEC,
      onTick: sec => { $('rec-time').textContent = `${clock(sec)} / ${clock(MAX_REC_SEC)}`; },
      onStop: (blob, ext) => {
        recording = null;
        $('rec-indicator').hidden = true;
        $('record').classList.remove('recording');
        $('record-label').textContent = 'Record';
        const d = new Date(), two = n => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
        download(blob, `resona-${figureSlug()}-${stamp}.${ext}`);
        showStatus(settings.soundOn ? 'Video saved' : 'Video saved without sound: sound was off');
      }
    });
  } catch (error) {
    recording = null;
    showStatus(error.code === 'NO_RECORDER' ? 'This browser cannot record video' : `Recording did not start: ${error.message}`);
    return;
  }
  $('rec-indicator').hidden = false;
  $('record').classList.add('recording');
  $('record-label').textContent = 'Stop';
}

// ---------- ribbon ----------

function buildRibbon() {
  const list = $('thumbs');
  list.replaceChildren(...PRESETS.map((preset, i) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'thumb';
    button.dataset.preset = i;
    const key = PIANO_PRESETS.indexOf(i);
    button.setAttribute('aria-label', `${String(i + 1).padStart(2, '0')} · ${preset.name}${key >= 0 ? `, key ${PIANO[key].slice(3)}` : ''}`);
    button.title = preset.name;
    const thumb = document.createElement('canvas');
    thumb.width = thumb.height = 96;
    button.append(thumb);
    if (key >= 0) {
      const badge = document.createElement('span');
      badge.className = 'thumb-key';
      badge.textContent = PIANO[key].slice(3);
      button.append(badge);
    }
    button.addEventListener('click', () => { audio.unlock(); choosePreset(i, { note: true }); });
    li.append(button);
    return li;
  }));
  // A vertical wheel over the ribbon scrolls it sideways.
  list.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { list.scrollLeft += wheelPixels(e, e.deltaY); e.preventDefault(); }
  }, { passive: false });
  paintThumbs();
}

let paintVersion = 0;
function paintThumbs() {
  const version = ++paintVersion;
  const c = currentColors();
  const plate = { material: 'aluminum', thickness: 1.5, length: 30, aspect: 1 };
  const canvases = $$('.thumb canvas');
  let i = 0;
  const batch = () => {
    if (version !== paintVersion) return;
    for (const end = Math.min(canvases.length, i + 8); i < end; i++) paintThumb(canvases[i], PRESETS[i], plate, c);
    if (i < canvases.length) setTimeout(batch, 0);
  };
  setTimeout(batch, 0);
}

function markThumb() {
  for (const b of $$('.thumb')) {
    const active = settings.tuning === 'patterns' && Number(b.dataset.preset) === settings.preset;
    if (active) {
      b.setAttribute('aria-current', 'true');
      const list = $('thumbs'), left = b.offsetLeft - list.offsetLeft;
      if (left < list.scrollLeft || left + b.offsetWidth > list.scrollLeft + list.clientWidth) {
        list.scrollTo({ left: left - list.clientWidth / 2 + b.offsetWidth / 2 });
      }
    } else b.removeAttribute('aria-current');
  }
}

// Log scale 20–16 000 Hz on a 0–1000 slider.
const sliderToHz = v => RIBBON_MIN_HZ * (RIBBON_MAX_HZ / RIBBON_MIN_HZ) ** (v / 1000);
const hzToSlider = hz => 1000 * Math.log(hz / RIBBON_MIN_HZ) / Math.log(RIBBON_MAX_HZ / RIBBON_MIN_HZ);
let sliderHeld = false;
$('ribbon-frequency').addEventListener('pointerdown', () => { sliderHeld = true; });
addEventListener('pointerup', () => { if (sliderHeld) { sliderHeld = false; markTuneInput(); } });
$('ribbon-frequency').addEventListener('input', e => {
  audio.unlock();
  setManualFrequency(sliderToHz(Number(e.target.value)), 0.25);
  markTuneInput();
  syncPanel({ skipRibbon: true });
  firstGesture();
  persist();
});

// ---------- panel ----------

function setPanel(open) {
  const panel = $('panel');
  panel.dataset.open = String(open);
  panel.inert = !open;
  $('panel-toggle').setAttribute('aria-expanded', String(open));
}
$('panel-toggle').addEventListener('click', () => setPanel($('panel').dataset.open !== 'true'));
$('panel-close').addEventListener('click', () => setPanel(false));

// Range controls: [id, settings key, label, what to re-apply].
const RANGES = [
  ['thickness', 'thickness', v => `${fmt(v, 1)} mm`, 'physics'],
  ['length', 'length', v => `${fmt(v)} cm`, 'physics'],
  ['mix', 'mix', v => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v), 2)}`, 'physics'],
  ['damping', 'damping', v => fmt(v, 3), 'physics'],
  ['grain', 'grain', v => fmt(v, 1), 'look'],
  ['spread', 'spread', v => fmt(v, 1), 'look'],
  ['exposure', 'exposure', v => fmt(v, 1), 'look']
];

function paintRange(input) {
  const min = Number(input.min), max = Number(input.max);
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

// Same note, different plate → the plate rings in its own nearest mode, so the figure visibly changes.
function retunePlate() {
  const hz = current.frequency;
  const to = nearestResonance(hz, Infinity) ?? hz;
  setManualFrequency(to, 0.6);
}

const PLATE_KEYS = new Set(['thickness', 'length']);
for (const [id, key, , kind] of RANGES) {
  $(id).addEventListener('input', e => {
    settings[key] = Number(e.target.value);
    if (PLATE_KEYS.has(key)) retunePlate();
    else if (kind === 'physics') applyModes(0.6);
    else applyLook();
    syncPanel();
    persist();
  });
}

$('material').addEventListener('change', e => { settings.material = e.target.value; retunePlate(); syncPanel(); persist(); });

for (const b of $$('[data-tuning]')) {
  b.addEventListener('click', () => {
    if (b.dataset.tuning === 'manual') setManualFrequency(settings.frequency, 0.6);
    else choosePreset(settings.preset);
    syncPanel();
    persist();
  });
}
for (const b of $$('[data-scale]')) {
  b.addEventListener('click', () => {
    settings.exportScale = b.dataset.scale === '4k' ? '4k' : Number(b.dataset.scale);
    syncPanel();
    persist();
  });
}

$('frequency').addEventListener('change', e => {
  const hz = Number(String(e.target.value).replace(',', '.'));
  const valid = Number.isFinite(hz) && hz >= 20 && hz <= 16000;
  e.target.setAttribute('aria-invalid', String(!valid));
  $('frequency-error').hidden = valid;
  if (!valid) return;
  setManualFrequency(hz, 0.6);
  syncPanel();
  persist();
});

$('count').addEventListener('input', e => {
  settings.count = Number(e.target.value);
  grains = settings.count;
  engine.setCount(grains);
  syncPanel();
  persist();
});
$('count-auto').addEventListener('change', e => {
  settings.count = e.target.checked ? 'auto' : grains;
  if (e.target.checked) { grains = initialCount(); engine.setCount(grains); }
  qualityGraceUntil = performance.now() + QUALITY.GRACE_SEC * 1000;
  syncPanel();
  persist();
});
$('scatter').addEventListener('click', scatter);

function buildPalettes() {
  $('palettes').replaceChildren(...PALETTES.map(p => {
    const b = document.createElement('button');
    b.className = 'palette';
    b.dataset.palette = p.id;
    b.title = p.name;
    b.setAttribute('aria-label', `${p.name} palette`);
    b.style.cssText = `--bgc:${p.background};--sandc:${p.sand};--g1:${p.glowAmount ? p.glow[1] : p.background};--g2:${p.glowAmount ? p.glow[2] : p.background}`;
    b.addEventListener('click', () => {
      settings.palette = p.id;
      settings.glowAmount = null;
      applyLook();
      paintThumbs();
      syncPanel();
      persist();
    });
    return b;
  }));
}

const COLOR_INPUTS = ['color-background', 'color-sand', 'color-glow-0', 'color-glow-1', 'color-glow-2'];
for (const id of COLOR_INPUTS) {
  $(id).addEventListener('input', () => {
    const base = currentColors();
    if (settings.palette !== 'custom' && settings.glowAmount === null) settings.glowAmount = base.glowAmount;
    settings.custom = {
      background: $('color-background').value, sand: $('color-sand').value,
      glow: [$('color-glow-0').value, $('color-glow-1').value, $('color-glow-2').value]
    };
    settings.palette = 'custom';
    // A hand-picked glow should be visible: lift it from zero once.
    if (id.startsWith('color-glow') && !(settings.glowAmount > 0)) settings.glowAmount = 0.7;
    applyLook();
    syncPanel();
    persist();
  });
  $(id).addEventListener('change', paintThumbs);
}
$('glow').addEventListener('input', e => { settings.glowAmount = Number(e.target.value); applyLook(); syncPanel(); persist(); });
$('transparent').addEventListener('change', e => { settings.transparent = e.target.checked; persist(); });
$('save-png').addEventListener('click', savePng);
$('record').addEventListener('click', toggleRecording);
$('rec-indicator').addEventListener('click', toggleRecording);
$('reset').addEventListener('click', () => {
  settings = { ...validateSettings({ ...DEFAULTS, onboarded: true, soundOn: settings.soundOn }), view: 'sand', proportion: 'screen' };
  grains = initialCount();
  engine.setCount(grains);
  applyLook();
  applyModes(1.2);
  paintThumbs();
  markThumb();
  syncPanel();
  persist();
  showStatus('Settings reset');
});

function pressed(selector, test) {
  for (const b of $$(selector)) b.setAttribute('aria-pressed', String(test(b)));
}

function syncPanel({ skipRibbon = false } = {}) {
  for (const [id, key, label] of RANGES) {
    const input = $(id);
    if (document.activeElement !== input) input.value = settings[key];
    $(`${id}-out`).textContent = label(settings[key]);
    paintRange(input);
  }
  const preset = PRESETS[settings.preset];
  $('mix').disabled = settings.tuning === 'manual' || preset.m === preset.n;
  $('damping').disabled = settings.tuning !== 'manual';
  $('material').value = settings.material;
  pressed('[data-tuning]', b => b.dataset.tuning === settings.tuning);
  pressed('[data-scale]', b => String(b.dataset.scale) === String(settings.exportScale));
  pressed('[data-palette]', b => b.dataset.palette === settings.palette);

  const freq = $('frequency');
  if (document.activeElement !== freq) {
    freq.value = (Math.round(current.frequency * 10) / 10).toString();
    freq.removeAttribute('aria-invalid');
    $('frequency-error').hidden = true;
  }

  const count = $('count');
  count.value = grains;
  paintRange(count);
  $('count-out').textContent = fmt(grains);
  $('count-auto').checked = settings.count === 'auto';

  const c = currentColors();
  $('palette-name').textContent = settings.palette === 'custom' ? 'Custom colours' : PALETTES.find(p => p.id === settings.palette).name;
  const values = [c.background, c.sand, ...c.glow];
  COLOR_INPUTS.forEach((id, i) => { if (document.activeElement !== $(id)) $(id).value = values[i]; });
  $('glow').value = c.glowAmount;
  $('glow-out').textContent = fmt(c.glowAmount, 2);
  paintRange($('glow'));

  $('transparent').checked = settings.transparent;
  const size = exportSize();
  $('save-caption').textContent = `PNG ${fmt(size.width)} × ${fmt(size.height)} px · video up to ${MAX_REC_SEC} s${settings.soundOn ? ' with sound' : ''}`;

  if (!skipRibbon) $('ribbon-frequency').value = hzToSlider(clamp(current.frequency, RIBBON_MIN_HZ, RIBBON_MAX_HZ));
  paintRange($('ribbon-frequency'));
}

// ---------- keyboard ----------

addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target instanceof Element ? e.target : document.body;
  if (target.closest('select, textarea, input:not([type="range"]):not([type="checkbox"]):not([type="color"])')) return;
  if (e.code === 'Escape') { setPanel(false); return; }
  const piano = PIANO.indexOf(e.code);
  if (piano >= 0) {
    if (e.repeat) return;
    audio.unlock();
    choosePreset(PIANO_PRESETS[piano], { note: true });
    return;
  }
  if (e.code === 'Space') {
    if (target.closest('button, summary')) return;
    e.preventDefault();
    togglePause();
  } else if (e.code === 'KeyR' && !e.repeat) {
    scatter();
  }
});

// A mouse click leaves focus on the button, and Space would then press it again instead of pausing.
document.addEventListener('click', e => {
  if (e.detail > 0 && e.target instanceof Element) e.target.closest('button, summary')?.blur();
});

$('sound-toggle').addEventListener('click', () => setSound(!settings.soundOn));
$('voice-toggle').addEventListener('click', toggleVoice);
$('random').addEventListener('click', () => { audio.unlock(); randomPreset(); });

// First touch anywhere unlocks audio (browsers keep it silent until a gesture).
addEventListener('pointerdown', () => audio.unlock(), { capture: true });

// ---------- window ----------

function resize() {
  engine.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
  gestures.resize(innerWidth, innerHeight);
  applyModes(0.4);
  syncPanel();
  qualityGraceUntil = performance.now() + QUALITY.GRACE_SEC * 1000;
}
let resizeFrame = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(resize);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.pause();
  else {
    audio.resume();
    last = performance.now();
    qualityGraceUntil = last + QUALITY.GRACE_SEC * 1000;
  }
});

// ---------- loop ----------

function step(now, dt) {
  handle(gestures.tick(now));
  flushScrub();
  settleTuning(now);
  readVoice(now);
  if (!paused) {
    for (const ev of pieces.step(dt, windowAspect())) {
      if (ev.type === 'home') { engine.release(ev.slot); audio.gather(0.8); }
      else if (ev.type === 'homing') audio.glissEnd(ev.slot);
      else if (ev.type === 'bounce') audio.thump(Math.min(1, ev.speed / 4) * 0.35);
    }
    for (const p of pieces.list()) {
      if (p.phase !== 'flying') continue;
      audio.gliss(p.slot, Math.min(1, p.speed / 3));
      audio.glissPan(p.slot, p.cx);
    }
  }
  engine.setPieces(pieces.list());
  engine.frame(dt, { paused });
  checkQuality(now);
}

// Console hook for scripted checks where rAF does not run (a hidden preview): resona.manual = true; resona.run(60).
window.resona = {
  engine, pieces, gestures, audio, handle, step, manual: false, t: 0,
  get settings() { return settings; },
  run(frames, dt = 1 / 60) { for (let i = 0; i < frames; i++) { this.t += dt * 1000; step(this.t, dt); } }
};

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (!window.resona.manual) step(now, dt);
  requestAnimationFrame(loop);
}

// ---------- start ----------

$('material').replaceChildren(...Object.entries(MATERIALS).map(([id, m]) => new Option(m.name, id)));
buildPalettes();
buildRibbon();
engine.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
applyLook();
applyModes(0);
markThumb();
syncPanel();
audio.setEnabled(settings.soundOn);
$('sound-toggle').setAttribute('aria-pressed', String(settings.soundOn));
if (onboarding) $('hints').hidden = false;
qualityGraceUntil = performance.now() + QUALITY.GRACE_SEC * 1000;
requestAnimationFrame(loop);

