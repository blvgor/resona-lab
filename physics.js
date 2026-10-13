// Kirchhoff–Love thin plate, simply supported on all four edges.
// Exact modal frequencies; truncated modal forced response.
export const MATERIALS = {
  aluminum: { name: 'Алюминий', E: 69e9, rho: 2700, nu: 0.33 },
  steel: { name: 'Сталь', E: 200e9, rho: 7850, nu: 0.30 },
  brass: { name: 'Латунь', E: 100e9, rho: 8500, nu: 0.34 },
  titanium: { name: 'Титан', E: 116e9, rho: 4500, nu: 0.34 }
};

export function naturalFrequency(m, n, plate) {
  const mat = MATERIALS[plate.material] || MATERIALS.aluminum;
  const h = plate.thickness / 1000;
  const a = plate.length / 100, b = a / plate.aspect;
  const D = mat.E * h ** 3 / (12 * (1 - mat.nu ** 2));
  return Math.PI / 2 * Math.sqrt(D / (mat.rho * h)) * ((m / a) ** 2 + (n / b) ** 2);
}

export function basis(m, n, x, y) {
  return Math.sin(m * Math.PI * x) * Math.sin(n * Math.PI * y);
}

export function responseCoefficients(preset, plate, frequency, damping = 0.015, mix = preset.mix) {
  const frequencies = [naturalFrequency(preset.m, preset.n, plate), naturalFrequency(preset.n, preset.m, plate)];
  const terms = frequencies.map((fn, i) => {
    const ratio = frequency / fn;
    const re = 1 - ratio ** 2, im = 2 * damping * ratio;
    const denominator = re ** 2 + im ** 2;
    const drive = i === 0 ? 1 : preset.m === preset.n ? 0 : mix;
    const dimensional = (2 * Math.PI * fn) ** 2;
    return { re: drive * re / (denominator * dimensional), im: -drive * im / (denominator * dimensional) };
  });
  const norm = Math.max(1e-30, Math.hypot(terms[0].re, terms[0].im) + Math.hypot(terms[1].re, terms[1].im));
  return { terms: terms.map(t => ({ re: t.re / norm, im: t.im / norm })), gain: norm, frequencies };
}

export function createField(preset, plate, frequency, damping, mix, size = 192, manual = false) {
  const response = responseCoefficients(preset, plate, frequency, damping, mix);
  let modes = [{ m: preset.m, n: preset.n, ...response.terms[0] }, { m: preset.n, n: preset.m, ...response.terms[1] }];
  if (manual) {
    modes = [];
    for (let m = 1; m <= 9; m++) for (let n = 1; n <= 9; n++) {
      const fn = naturalFrequency(m, n, plate), w = 2 * Math.PI * fn, drive = 2 * Math.PI * frequency;
      const re = w * w - drive * drive, im = 2 * damping * w * drive;
      const f = basis(m, n, .37, .43), den = re * re + im * im;
      modes.push({ m, n, re: f * re / den, im: -f * im / den, fn });
    }
    modes.sort((a,b) => Math.hypot(b.re,b.im) - Math.hypot(a.re,a.im));
    // Keep the strongest 16 modal responses; the full 81-mode basis sets their weights.
    const norm = modes.slice(0,16).reduce((sum,t) => sum + Math.hypot(t.re,t.im),0);
    response.dominantMode = { m: modes[0].m, n: modes[0].n, frequency: modes[0].fn };
    modes = modes.slice(0,16).map(t => ({ ...t, re: t.re / norm, im: t.im / norm }));
  }
  const values = new Float32Array(size * size), signed = new Float32Array(size * size);
  const gx = new Float32Array(size * size), gy = new Float32Array(size * size);
  const real = new Float32Array(size * size), imaginary = new Float32Array(size * size);
  const realX = new Float32Array(size * size), realY = new Float32Array(size * size);
  const imaginaryX = new Float32Array(size * size), imaginaryY = new Float32Array(size * size);
  // Choose a display phase from the dominant modal coefficient, not from arbitrary time.
  const dominant = modes.reduce((a,b) => Math.hypot(a.re,a.im) >= Math.hypot(b.re,b.im) ? a : b);
  const phase = Math.atan2(dominant.im, dominant.re);
  const table = Array.from({length:10}, (_,m) => Float32Array.from({length:size}, (_,i) => Math.sin(m * Math.PI * i / (size - 1))));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const j = y * size + x;
    let re = 0, im = 0;
    for (const mode of modes) {
      const p = table[mode.m][x] * table[mode.n][y];
      re += mode.re * p; im += mode.im * p;
    }
    values[j] = re * re + im * im;
    real[j] = re; imaginary[j] = im;
    signed[j] = re * Math.cos(phase) + im * Math.sin(phase);
  }
  const maximum = Math.max(...values);
  if (manual && maximum > 0) for (let i=0;i<values.length;i++) { values[i] /= maximum; signed[i] /= Math.sqrt(maximum); real[i] /= Math.sqrt(maximum); imaginary[i] /= Math.sqrt(maximum); }
  // Recompute gradients after response normalization.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const j = y * size + x;
    gx[j] = (values[y * size + Math.min(size - 1, x + 1)] - values[y * size + Math.max(0, x - 1)]) * (size - 1) / 2;
    gy[j] = (values[Math.min(size - 1, y + 1) * size + x] - values[Math.max(0, y - 1) * size + x]) * (size - 1) / 2;
    const left=y*size+Math.max(0,x-1),right=y*size+Math.min(size-1,x+1),top=Math.max(0,y-1)*size+x,bottom=Math.min(size-1,y+1)*size+x;
    realX[j]=(real[right]-real[left])*(size-1)/2;realY[j]=(real[bottom]-real[top])*(size-1)/2;
    imaginaryX[j]=(imaginary[right]-imaginary[left])*(size-1)/2;imaginaryY[j]=(imaginary[bottom]-imaginary[top])*(size-1)/2;
  }
  return { size, values, signed, gx, gy, real, imaginary, realX, realY, imaginaryX, imaginaryY, response, maximum };
}

export function sampleGrid(grid, size, x, y) {
  const tx = Math.min(size - 1.001, Math.max(0, x * (size - 1)));
  const ty = Math.min(size - 1.001, Math.max(0, y * (size - 1)));
  const ix = Math.floor(tx), iy = Math.floor(ty), fx = tx - ix, fy = ty - iy, j = iy * size + ix;
  return (grid[j] * (1 - fx) + grid[j + 1] * fx) * (1 - fy) + (grid[j + size] * (1 - fx) + grid[j + size + 1] * fx) * fy;
}

const pairs = [[1,3],[2,3],[1,2],[1,4],[2,4],[1,5],[3,4],[2,5],[3,5],[1,6],[2,6],[4,5],[3,6],[1,7],[4,6],[2,7],[3,7],[5,6],[4,7],[5,7],[6,7]];
const names = [['Орбита','Пересечение'],['Лепестки','Паруса'],['Прилив','Развилка'],['Крылья','Меридиан'],['Четырёхлистник','Решётка'],['Двойное кольцо','Компас'],['Ирис','Контрапункт'],['Бутон','Каскад'],['Мандала','Переплетение'],['Волна','Горизонты'],['Розетка','Ступени'],['Созвездие','Лабиринт'],['Венок','Мозаика'],['Три орбиты','Калейдоскоп'],['Лотос','Кружево'],['Соцветие','Ритм'],['Звёздный сад','Паутинка'],['Корона','Ткань'],['Георгин','Плетение'],['Хризантема','Соты'],['Микрокосм','Гобелен']];
export const PRESETS = pairs.flatMap(([m,n], i) => [1,-1].map((mix,j) => ({ id: i * 2 + j, m, n, mix, name: names[i][j], category: m + n >= 9 ? 'intricate' : j === 0 ? 'curves' : 'geometric' })));
for (let m = 2; m <= 7; m++) PRESETS.push({ id: PRESETS.length, m, n: m, mix: 0, name: ['Окна','Квадранты','Плитка','Колоннада','Шахматная доска','Архитектура'][m - 2], category: m >= 5 ? 'intricate' : 'geometric' });

export const DEFAULT_STATE = {
  preset: 0, material: 'aluminum', thickness: 1.5, length: 30, aspect: 1, damping: 0.015,
  frequency: 0, mix: 1, tuning: 'patterns', count: 40000, grain: 1.2, spread: 1.2,
  color: '#e7d7b1', background: '#090a09', exposure: 1, view: 'sand', running: true,
  exportSize: 3840, transparent: false, margins: true
};

export function validateState(candidate = {}) {
  const s = { ...DEFAULT_STATE };
  for (const key of Object.keys(s)) if (typeof candidate[key] === typeof s[key]) s[key] = candidate[key];
  const clamp = (key, min, max) => s[key] = Math.max(min, Math.min(max, Number.isFinite(s[key]) ? s[key] : DEFAULT_STATE[key]));
  clamp('preset', 0, PRESETS.length - 1); s.preset = Math.round(s.preset);
  clamp('thickness', .5, 4); clamp('length', 15, 60); clamp('aspect', 1, 2);
  clamp('damping', .005, .08); clamp('frequency', 20, 16000); clamp('mix', -1, 1);
  clamp('count', 10000, 80000); s.count = Math.round(s.count);
  clamp('grain', .5, 2.8); clamp('spread', .3, 3); clamp('exposure', .4, 1.8);
  if (!MATERIALS[s.material]) s.material = DEFAULT_STATE.material;
  if (!['sand','contours','field'].includes(s.view)) s.view = 'sand';
  if (!['patterns','manual'].includes(s.tuning)) s.tuning = 'patterns';
  if (![1080,2160,3840].includes(s.exportSize)) s.exportSize = 3840;
  for (const key of ['color','background']) if (!/^#[0-9a-f]{6}$/i.test(s[key])) s[key] = DEFAULT_STATE[key];
  return s;
}
