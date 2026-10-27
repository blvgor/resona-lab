// Pitch of a mono buffer by the normalized square difference function (McLeod pitch method).
// Pure: no Web Audio here, voice.js feeds it analyser frames.

export const PITCH = Object.freeze({
  MIN_FREQ: 70,
  MAX_FREQ: 1500,
  SILENCE_RMS: 0.01,
  PEAK_THRESHOLD: 0.9   // first NSDF peak within 90 % of the highest one wins; avoids octave-down errors
});

function nsdf(samples, maxLag) {
  const size = samples.length, out = new Float64Array(maxLag + 1);
  let m = 0;
  for (let j = 0; j < size; j++) m += 2 * samples[j] * samples[j];
  for (let tau = 0; tau <= maxLag; tau++) {
    if (tau > 0) m -= samples[tau - 1] ** 2 + samples[size - tau] ** 2;
    let r = 0;
    for (let j = 0; j < size - tau; j++) r += samples[j] * samples[j + tau];
    out[tau] = m > 0 ? 2 * r / m : 0;
  }
  return out;
}

// Maxima of each positive lobe after the first zero crossing.
function lobePeaks(n) {
  const peaks = [];
  let tau = 1;
  while (tau < n.length && n[tau] > 0) tau++;
  while (tau < n.length - 1) {
    while (tau < n.length - 1 && n[tau] <= 0) tau++;
    let best = -1;
    while (tau < n.length - 1 && n[tau] > 0) {
      if (n[tau] >= n[tau - 1] && n[tau] >= n[tau + 1] && (best < 0 || n[tau] > n[best])) best = tau;
      tau++;
    }
    if (best > 0) peaks.push(best);
  }
  return peaks;
}

export function detectPitch(samples, sampleRate) {
  if (!samples || samples.length < 64 || !(sampleRate > 0)) return null;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  if (Math.sqrt(energy / samples.length) < PITCH.SILENCE_RMS) return null;

  const maxLag = Math.min(Math.ceil(sampleRate / PITCH.MIN_FREQ) + 1, samples.length - 2);
  const n = nsdf(samples, maxLag);
  const peaks = lobePeaks(n);
  if (!peaks.length) return null;
  const highest = Math.max(...peaks.map(t => n[t]));
  const tau = peaks.find(t => n[t] >= PITCH.PEAK_THRESHOLD * highest);

  // Parabolic interpolation of the peak gives sub-sample lag accuracy.
  const a = n[tau - 1], b = n[tau], c = n[tau + 1], curve = a - 2 * b + c;
  const shift = curve < 0 ? (a - c) / (2 * curve) : 0;
  const freq = sampleRate / (tau + shift);
  if (freq < PITCH.MIN_FREQ || freq > PITCH.MAX_FREQ) return null;
  const clarity = Math.max(0, Math.min(1, b - (a - c) * shift / 4));
  return { freq, clarity };
}
