// Short videos of the field: canvas.captureStream + the audio bus → MediaRecorder.

const CANDIDATES = [
  ['video/webm;codecs=vp9,opus', 'webm'],
  ['video/webm;codecs=vp8,opus', 'webm'],
  ['video/webm', 'webm'],
  ['video/mp4;codecs=avc1,mp4a', 'mp4'],
  ['video/mp4', 'mp4']
];

const defaultSupport = () => {
  const Recorder = globalThis.MediaRecorder;
  return Recorder && typeof Recorder.isTypeSupported === 'function' ? type => Recorder.isTypeSupported(type) : null;
};

export function pickMimeType(isSupported = defaultSupport()) {
  if (typeof isSupported !== 'function') return null;
  for (const [mimeType, ext] of CANDIDATES) if (isSupported(mimeType)) return { mimeType, ext };
  return null;
}

function recorderError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function startRecording(canvas, audioStream, { maxSec = 30, onTick = () => {}, onStop = () => {} } = {}) {
  const format = pickMimeType();
  if (!format || typeof canvas?.captureStream !== 'function') {
    throw recorderError('This browser cannot record video', 'NO_RECORDER');
  }
  const video = canvas.captureStream(60);
  const tracks = [...video.getVideoTracks(), ...(audioStream ? audioStream.getAudioTracks() : [])];
  const stream = new MediaStream(tracks);
  const recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  const started = performance.now();
  let stopped = false;

  recorder.addEventListener('dataavailable', event => { if (event.data && event.data.size) chunks.push(event.data); });
  recorder.addEventListener('stop', () => {
    clearInterval(timer);
    // Only the canvas track is ours to stop; the audio track belongs to the live audio bus.
    for (const track of video.getVideoTracks()) track.stop();
    onStop(new Blob(chunks, { type: format.mimeType.split(';')[0] }), format.ext);
  });

  const timer = setInterval(() => {
    const sec = (performance.now() - started) / 1000;
    onTick(Math.min(sec, maxSec));
    if (sec >= maxSec) stop();
  }, 250);

  function stop() {
    if (stopped) return;
    stopped = true;
    if (recorder.state !== 'inactive') recorder.stop();
  }

  recorder.start(500);
  onTick(0);
  return { stop, ext: format.ext };
}
