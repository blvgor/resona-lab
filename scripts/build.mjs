import { mkdir, copyFile } from 'node:fs/promises';

// Every static file the page loads. A new module must be listed here, or the deployed site breaks.
const FILES = [
  'index.html', 'styles.css', 'app.js',
  'physics.js', 'sand.js', 'pieces.js', 'gestures.js', 'pitch.js', 'palettes.js', 'settings.js',
  'engine.js', 'audio.js', 'voice.js', 'recorder.js', 'thumbs.js'
];

await mkdir(new URL('../public/', import.meta.url), { recursive: true });
for (const file of FILES) {
  await copyFile(new URL(`../${file}`, import.meta.url), new URL(`../public/${file}`, import.meta.url));
}
console.log(`Resona: ${FILES.length} static files prepared.`);
