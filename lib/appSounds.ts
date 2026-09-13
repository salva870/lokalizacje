import type { MovementType } from "@/lib/types";

type ToneSpec = {
  frequency: number;
  start: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
};

let audioCtx: AudioContext | null = null;
let beepEl: HTMLAudioElement | null = null;
let successEl: HTMLAudioElement | null = null;
let beepWavUrl: string | null = null;
let successWavUrl: string | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (audioCtx && audioCtx.state !== "closed") return audioCtx;
  audioCtx = new AudioCtx();
  return audioCtx;
}

function writeWavPcm(samples: Float32Array, sampleRate: number): Blob {
  const dataSize = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const str = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s * 32767, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

function synthBeep(): Float32Array {
  const sampleRate = 22050;
  const duration = 0.16;
  const n = Math.floor(sampleRate * duration);
  const samples = new Float32Array(n);
  const attack = Math.floor(sampleRate * 0.008);
  const release = Math.floor(sampleRate * 0.05);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let env = 1;
    if (i < attack) env = i / attack;
    else if (i > n - release) env = (n - i) / release;
    const a = Math.sin(2 * Math.PI * 1240 * t);
    const b = Math.sin(2 * Math.PI * 1760 * t);
    samples[i] = (a * 0.62 + b * 0.48) * env * 0.95;
  }
  return samples;
}

function synthSuccess(): Float32Array {
  const sampleRate = 22050;
  const duration = 0.28;
  const n = Math.floor(sampleRate * duration);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = t < 0.04 ? t / 0.04 : Math.max(0, 1 - (t - 0.04) / 0.24);
    const a = Math.sin(2 * Math.PI * 659 * t);
    const b = Math.sin(2 * Math.PI * 880 * t);
    samples[i] = (a * 0.45 + b * 0.4) * env * 0.9;
  }
  return samples;
}

function ensureWavUrls() {
  if (typeof window === "undefined") return;
  if (!beepWavUrl) beepWavUrl = URL.createObjectURL(writeWavPcm(synthBeep(), 22050));
  if (!successWavUrl) successWavUrl = URL.createObjectURL(writeWavPcm(synthSuccess(), 22050));
}

function makeAudioEl(url: string): HTMLAudioElement {
  const el = new Audio(url);
  el.preload = "auto";
  el.volume = 1;
  el.muted = false;
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  return el;
}

function getBeepElement(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  ensureWavUrls();
  if (!beepWavUrl) return null;
  if (!beepEl) beepEl = makeAudioEl(beepWavUrl);
  return beepEl;
}

function playHtmlAudio(el: HTMLAudioElement | null) {
  if (!el) return;
  try {
    el.muted = false;
    el.volume = 1;
    if (el.currentTime > 0) el.currentTime = 0;
    const playPromise = el.play();
    if (playPromise) void playPromise.catch(() => undefined);
  } catch {
    // best effort
  }
}

function playTones(specs: ToneSpec[]) {
  const ctx = getAudioContext();
  if (!ctx || ctx.state === "closed") return;
  if (ctx.state === "suspended") void ctx.resume();
  for (const spec of specs) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = spec.type ?? "sine";
    osc.frequency.value = spec.frequency;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime + spec.start;
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, spec.gain), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.duration);
    osc.start(t0);
    osc.stop(t0 + spec.duration + 0.02);
  }
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // iOS nie wspiera Vibration API
  }
}

/**
 * Wywoluj SYNCHRONICZNIE w obsludze klikniecia (bez await przed tym).
 * iOS / Brave odblokowuja audio tylko w tym samym gescie uzytkownika.
 * Nie odtwarza dzwieku — tylko odblokowuje kontekst.
 */
export function unlockScanFeedback() {
  const ctx = getAudioContext();
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // ignore
    }
  }
  const el = getBeepElement();
  if (!el) return;
  const prevVolume = el.volume;
  el.muted = true;
  el.volume = 0;
  const playPromise = el.play();
  if (playPromise) {
    void playPromise
      .then(() => {
        el.pause();
        el.currentTime = 0;
        el.muted = false;
        el.volume = prevVolume || 1;
      })
      .catch(() => {
        el.muted = false;
        el.volume = prevVolume || 1;
      });
  }
}

export function playScanBeep() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  playHtmlAudio(getBeepElement());
  playTones([
    { frequency: 1180, start: 0, duration: 0.1, gain: 0.42, type: "triangle" },
    { frequency: 1680, start: 0.004, duration: 0.12, gain: 0.34, type: "sine" },
  ]);
  vibrate([35, 25, 35]);
}

const successSounds: Record<MovementType, ToneSpec[]> = {
  ADD: [
    { frequency: 523, start: 0, duration: 0.14, gain: 0.42 },
    { frequency: 659, start: 0.1, duration: 0.14, gain: 0.4 },
    { frequency: 784, start: 0.2, duration: 0.22, gain: 0.45 },
  ],
  REMOVE: [
    { frequency: 620, start: 0, duration: 0.16, gain: 0.38, type: "triangle" },
    { frequency: 440, start: 0.12, duration: 0.2, gain: 0.36 },
  ],
  MOVE: [
    { frequency: 440, start: 0, duration: 0.12, gain: 0.34, type: "triangle" },
    { frequency: 880, start: 0.14, duration: 0.18, gain: 0.42 },
    { frequency: 660, start: 0.28, duration: 0.16, gain: 0.32 },
  ],
  RESTORE_FROM_TMP: [
    { frequency: 392, start: 0, duration: 0.12, gain: 0.34 },
    { frequency: 494, start: 0.1, duration: 0.12, gain: 0.36 },
    { frequency: 587, start: 0.2, duration: 0.12, gain: 0.38 },
    { frequency: 740, start: 0.3, duration: 0.2, gain: 0.42 },
  ],
  MOVE_TO_SALE: [
    { frequency: 988, start: 0, duration: 0.1, gain: 0.4, type: "triangle" },
    { frequency: 1319, start: 0.08, duration: 0.24, gain: 0.44, type: "sine" },
  ],
  SALE_FINALIZE: [
    { frequency: 523, start: 0, duration: 0.16, gain: 0.36 },
    { frequency: 659, start: 0.12, duration: 0.16, gain: 0.38 },
    { frequency: 784, start: 0.24, duration: 0.16, gain: 0.4 },
    { frequency: 1047, start: 0.36, duration: 0.28, gain: 0.46 },
  ],
};

export function playOperationSuccess(movementType: MovementType) {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume();
  ensureWavUrls();
  if (!successEl && successWavUrl) successEl = makeAudioEl(successWavUrl);
  playHtmlAudio(successEl);
  playTones(successSounds[movementType]);
  vibrate(movementType === "SALE_FINALIZE" ? 40 : 22);
}

export const primeAudioFeedback = unlockScanFeedback;
