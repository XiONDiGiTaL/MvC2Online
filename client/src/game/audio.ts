// Procedural audio. Nothing is bundled or sampled: every hit, whoosh and note
// is synthesised from oscillators and white noise at runtime, so the build
// stays free of licensed audio while still sounding like a fighting game.
//
// Browsers block audio until a user gesture, so installAudioUnlock() arms a
// one-shot listener and every play call is a no-op until the context exists.

export type Sfx =
  | "hit"
  | "heavy"
  | "block"
  | "whiff"
  | "jump"
  | "land"
  | "fireball"
  | "hyper"
  | "ko"
  | "round"
  | "tag"
  | "ui"
  | "select";

const MUTE_KEY = "mvc2.muted";

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let musicTimer: number | null = null;
let musicStep = 0;
let muted = false;

try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  muted = false;
}

function makeNoise(context: AudioContext): AudioBuffer {
  const buf = context.createBuffer(1, Math.floor(context.sampleRate * 0.5), context.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ac) return ac;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ac = new Ctor();
  } catch {
    return null;
  }
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ac.destination);

  sfxBus = ac.createGain();
  sfxBus.gain.value = 0.85;
  sfxBus.connect(master);

  musicBus = ac.createGain();
  musicBus.gain.value = 0.2;
  musicBus.connect(master);

  noiseBuffer = makeNoise(ac);
  return ac;
}

/** Call once at startup: the first click or keypress unlocks playback. */
export function installAudioUnlock() {
  if (typeof window === "undefined") return;
  const unlock = () => {
    const c = context();
    if (c && c.state === "suspended") void c.resume();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    /* storage unavailable: mute still applies for this session */
  }
  if (master && ac) {
    master.gain.cancelScheduledValues(ac.currentTime);
    master.gain.setTargetAtTime(value ? 0 : 0.9, ac.currentTime, 0.02);
  }
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  slideTo?: number,
  delay = 0
) {
  const c = ctx();
  if (!c || !sfxBus) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(0.02, dur * 0.4));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(sfxBus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(
  dur: number,
  filter: BiquadFilterType,
  freq: number,
  q: number,
  gain: number,
  slideTo?: number,
  delay = 0
) {
  const c = ctx();
  if (!c || !sfxBus || !noiseBuffer) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const bq = c.createBiquadFilter();
  bq.type = filter;
  bq.frequency.setValueAtTime(freq, t0);
  bq.Q.value = q;
  if (slideTo !== undefined) bq.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(Math.max(0.0002, gain), t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bq);
  bq.connect(g);
  g.connect(sfxBus);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function ctx() {
  return context();
}

export function playSfx(name: Sfx) {
  const c = ctx();
  if (!c || muted) return;
  if (c.state === "suspended") void c.resume();

  switch (name) {
    case "hit":
      noise(0.09, "bandpass", 1200, 1.1, 0.5);
      tone(185, 0.1, "square", 0.16, 70);
      break;
    case "heavy":
      noise(0.16, "bandpass", 700, 0.9, 0.55);
      tone(120, 0.18, "sawtooth", 0.22, 48);
      break;
    case "block":
      noise(0.07, "highpass", 2600, 0.7, 0.32);
      tone(540, 0.05, "square", 0.1, 380);
      break;
    case "whiff":
      noise(0.11, "bandpass", 1400, 1.4, 0.16, 320);
      break;
    case "jump":
      tone(280, 0.1, "triangle", 0.16, 640);
      break;
    case "land":
      tone(150, 0.12, "sine", 0.22, 55);
      noise(0.07, "lowpass", 420, 0.7, 0.14);
      break;
    case "fireball":
      tone(200, 0.24, "sawtooth", 0.14, 760);
      noise(0.2, "lowpass", 900, 0.8, 0.12, 320);
      break;
    case "hyper":
      tone(180, 0.42, "sawtooth", 0.16, 520);
      tone(240, 0.42, "sawtooth", 0.1, 700);
      tone(320, 0.4, "triangle", 0.08, 900);
      noise(0.4, "bandpass", 1600, 0.8, 0.12, 700);
      break;
    case "ko":
      tone(110, 0.6, "sine", 0.34, 38);
      noise(0.45, "lowpass", 320, 0.7, 0.24, 90);
      break;
    case "round":
      tone(620, 0.1, "square", 0.14);
      tone(930, 0.14, "square", 0.12, undefined, 0.1);
      break;
    case "tag":
      tone(340, 0.14, "triangle", 0.16, 520);
      break;
    case "ui":
      tone(520, 0.05, "square", 0.1, 660);
      break;
    case "select":
      tone(760, 0.06, "square", 0.12, 1140);
      break;
  }
}

// ------------------------------------------------------------------ music
// A sixteen-step minor-pentatonic loop: bass, arpeggio and a hat, scheduled a
// little ahead of time so it survives jitter.
const STEP_MS = 118;
const BASS = [0, 0, 7, 0, 3, 3, 10, 3, 5, 5, 12, 5, 7, 7, 3, 0];
const ARP = [12, 7, 15, 7, 12, 19, 15, 7, 12, 7, 15, 7, 10, 17, 15, 7];
const ROOT_HZ = 55;

function noteAt(semis: number) {
  return ROOT_HZ * Math.pow(2, semis / 12);
}

function scheduleStep(step: number) {
  const c = ctx();
  if (!c || !musicBus) return;
  const t0 = c.currentTime + 0.02;
  const i = step % 16;

  // bass
  const bass = c.createOscillator();
  const bg = c.createGain();
  bass.type = "square";
  bass.frequency.setValueAtTime(noteAt(BASS[i]), t0);
  bg.gain.setValueAtTime(0.0001, t0);
  bg.gain.exponentialRampToValueAtTime(0.16, t0 + 0.012);
  bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
  bass.connect(bg);
  bg.connect(musicBus);
  bass.start(t0);
  bass.stop(t0 + 0.18);

  // arpeggio
  if (i % 2 === 0) {
    const arp = c.createOscillator();
    const ag = c.createGain();
    arp.type = "triangle";
    arp.frequency.setValueAtTime(noteAt(ARP[i] + 12), t0);
    ag.gain.setValueAtTime(0.0001, t0);
    ag.gain.exponentialRampToValueAtTime(0.06, t0 + 0.01);
    ag.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    arp.connect(ag);
    ag.connect(musicBus);
    arp.start(t0);
    arp.stop(t0 + 0.15);
  }

  // hat
  if (noiseBuffer) {
    const hat = c.createBufferSource();
    hat.buffer = noiseBuffer;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6500;
    const hg = c.createGain();
    hg.gain.setValueAtTime(0.05, t0);
    hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
    hat.connect(hp);
    hp.connect(hg);
    hg.connect(musicBus);
    hat.start(t0);
    hat.stop(t0 + 0.05);
  }
}

export function startMusic() {
  const c = ctx();
  if (!c || musicTimer !== null) return;
  if (c.state === "suspended") void c.resume();
  musicStep = 0;
  scheduleStep(musicStep++);
  musicTimer = window.setInterval(() => scheduleStep(musicStep++), STEP_MS);
}

export function stopMusic() {
  if (musicTimer !== null) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }
}

export function musicPlaying() {
  return musicTimer !== null;
}
