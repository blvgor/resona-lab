// Field palettes. The glow is a gradient over the vibration amplitude, drawn under the sand.
// Sand has no glow; its stops only matter if the user turns the glow up by hand.
export const PALETTES = [
  { id: 'sand', name: 'Sand', background: '#090a09', sand: '#e7d7b1', glow: ['#090a09', '#4a4130', '#e7d7b1'], glowAmount: 0 },
  { id: 'red', name: 'Red wave', background: '#1a0204', sand: '#ffe2da', glow: ['#2a0206', '#8f0d16', '#ff3b3b'], glowAmount: 0.85 },
  { id: 'lavender', name: 'Lavender', background: '#24132f', sand: '#fff1fb', glow: ['#3b2350', '#b07ad6', '#f2b8e6'], glowAmount: 0.75 },
  { id: 'cobalt', name: 'Cobalt', background: '#05062a', sand: '#e3e6ff', glow: ['#0a0a5e', '#2f2bff', '#8f7bff'], glowAmount: 0.8 },
  { id: 'ember', name: 'Embers', background: '#0d0705', sand: '#ffd6a0', glow: ['#1a0a04', '#a63a0a', '#ffb347'], glowAmount: 0.7 },
  { id: 'moss', name: 'Moss', background: '#060a06', sand: '#dff2c8', glow: ['#0a1408', '#2e6b3a', '#b6e08a'], glowAmount: 0.6 }
];

export function hexToRgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

// Piecewise-linear over three stops: 0 → glow[0], 0.5 → glow[1], 1 → glow[2]. Channels are 0..255, unrounded.
// The background shader uses the same formula on fieldU.
export function glowColor(palette, amplitude) {
  const t = Math.max(0, Math.min(1, Number.isFinite(amplitude) ? amplitude : 0));
  const [a, b] = t < 0.5 ? [palette.glow[0], palette.glow[1]] : [palette.glow[1], palette.glow[2]];
  const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const from = hexToRgb(a), to = hexToRgb(b);
  return from.map((v, i) => v + (to[i] - v) * k);
}
