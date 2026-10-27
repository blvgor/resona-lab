# Resona

Sand on a singing plate, full screen. Sound gathers the sand into a Chladni figure, and you get to break it: swipe to scatter the lines, hold to drag a piece like rubber, flick to throw it. It bounces off the edges and finds its way home. Turn the frequency with the wheel, play figures on the keyboard like a piano, or sing a note into the microphone and the field follows. Save a frame as PNG or record a short video.

[Open Resona](https://resona-lab.vercel.app/) · [Download the source](https://github.com/blvgor/resona-lab/archive/refs/heads/main.zip)

![Resona](docs/preview.png)

## Play

| Gesture | Mouse | Touch |
|---|---|---|
| Break the lines | swipe quickly over the field | a quick stroke right after touching |
| Drag a piece | hold and move | touch, wait a moment, then move |
| Throw | hold and let go mid-motion | the same with a finger |
| Shock wave | double click | double tap |
| Turn the frequency | wheel, trackpad, or the slider under the frequency | two fingers up and down, or the slider |

Keys: A S D F G H J K L play nine figures with their notes, Space pauses (the frame freezes and can be saved), R scatters the sand, Esc closes the panel. Up to eight pieces can fly at once; a ninth lets go of the oldest.

The ribbon at the bottom holds all 48 figures plus Random. When the frequency slider comes to rest, it glides to the nearest resonance so the sand forms clean lines. Settings, behind the button in the top right, open a glass panel:

- **Plate**: material, thickness and width. The note stays the same, and the new plate answers it with its own nearest resonance, so the figure changes.
- **Vibration**: figures or manual frequency, mode mix, damping.
- **Sand**: number of grains, grain size, scatter, brightness.
- **Look**: six palettes (Sand, Red wave, Lavender, Cobalt, Embers, Moss), custom colours, glow strength.
- **Save**: PNG at 1×, 2× or 4K, transparent background, video recording up to 30 seconds.

Sound stays off until you press Sound, and the choice is remembered. Sing a note asks for the microphone only when pressed. Settings live in this browser; there are no accounts, keys or external services.

The number of grains matches the device (200,000 on a computer, 80,000 on a phone). If the field drops below 40 frames per second for three seconds, it uses less sand and says so in the corner.

## Run locally

Node.js 20 or newer; nothing to install.

```sh
npm start
```

Open http://127.0.0.1:4178 in a browser with WebGL2 (a recent Chrome, Safari or Firefox). The server listens on this computer only. On macOS, double-click `start.command` to start the server and open the page.

## How it is built

Static ES modules, no bundler, no dependencies:

- `physics.js`: Kirchhoff–Love plate, 48 presets, and `modeSet`, the modal coefficients sent to the GPU.
- `sand.js`: the law that moves the sand, one source for both JavaScript and GLSL. `engine.js`: WebGL2, grains in float textures, background glow, PNG snapshots.
- `pieces.js`: flight, bounce and return of thrown pieces. `gestures.js`: pointer input turned into intents (break, grab, throw, shock, tune).
- `audio.js`: all sound in Web Audio, no files. `pitch.js` and `voice.js`: the note from the microphone. `recorder.js`: video. `thumbs.js`: ribbon thumbnails.
- `palettes.js` and `settings.js`: palettes and saved settings. `app.js`: the shell that ties it together.

The plate fills the screen. Its physics is that of a square plate stretched over the window, which keeps all 48 figures recognisable on any screen shape: on a rectangular plate the two modes of each figure would split apart in frequency.

## Physical model and limits

A rectangular isotropic Kirchhoff–Love plate, simply supported on all four edges. Shape of a single mode:

`phi_mn(x,y) = sin(m*pi*x/a) * sin(n*pi*y/b)`

`D = E*h^3 / (12*(1-nu^2))`

`f_mn = pi/2 * sqrt(D/(rho*h)) * ((m/a)^2 + (n/b)^2)`

Each figure mixes the mode pair (m,n) and (n,m). Manual mode computes the response of 81 modes to a point force at (0.37a, 0.43b), keeps the 16 strongest, and projects them onto the phase of the dominant mode, so the sand settles on nodal lines rather than points. Modal response: `F_mn / (omega_mn^2 - omega^2 + i*2*zeta*omega_mn*omega)`.

Grains move toward the minima of the vibration amplitude. Their transport, collisions, size, scatter and light are an artistic approximation. Free edges and arbitrary plate shapes are not modelled. This is not an engineering calculation; frequencies come from the model and have not been measured on a real plate.

Materials use typical reference values, not the datasheet of a specific alloy. PNG saves what is on screen: 1× and 2× at the window size, 4K with a 3840 px long side.

## Sources

- Main visual and functional reference: [Resonant / Nika Teiler](https://resonant.xntaylerx.workers.dev/). No code, fonts or graphics were copied.
- [Thin plates, Louisiana](https://math.louisiana.edu/sites/math/files/DuongNguyenPosterSIAMTXLA.pdf): analytical eigenmodes of a simply supported plate.
- [Kirchhoff model, University of Nigeria](https://nijotech.com/index.php/nijotech/article/view/1282): frequencies of rectangular plates.
- [MDN: WebGL2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext), [Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API), [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder).

## Tests

```sh
npm test
```

`node scripts/build.mjs` copies every module into `public/` for Vercel.

## License

MIT, see [LICENSE](LICENSE).
