import { BrowserMultiFormatReader } from "@zxing/browser";

export type ScanTier = "high" | "medium" | "low";

export type ScanAttempt = {
  roi: number;
  decodePx: number;
  contrastBoost?: boolean;
  sharpUpscale?: boolean;
};

export type ScanProfile = {
  tier: ScanTier;
  cameraWidth: number;
  cameraHeight: number;
  frameRate: number;
  initialZoom: number;
  tryHarder: boolean;
  attemptsPerTick: number;
  pauseMs: number;
  slowTickMs: number;
  useNativeFullFrame: boolean;
  attempts: ScanAttempt[];
};

type NativeQrDetector = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Startowy poziom. iOS zawsze high — Safari klamie hardwareConcurrency=4 nawet na iPhone 16. */
export function getInitialScanTier(): ScanTier {
  if (typeof navigator === "undefined") return "medium";
  if (isIosDevice()) return "high";

  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return "low";

  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memory === "number" && memory <= 3) return "low";
  if (typeof memory === "number" && memory <= 4) return "medium";

  const cores = navigator.hardwareConcurrency || 8;
  if (cores <= 4) return "medium";
  return "high";
}

export function nextLowerScanTier(tier: ScanTier): ScanTier | null {
  if (tier === "high") return "medium";
  if (tier === "medium") return "low";
  return null;
}

const HIGH_ATTEMPTS: ScanAttempt[] = [
  { roi: 0.14, decodePx: 2048, contrastBoost: true, sharpUpscale: true },
  { roi: 0.18, decodePx: 1920, contrastBoost: false, sharpUpscale: true },
  { roi: 0.22, decodePx: 1680, contrastBoost: true, sharpUpscale: false },
  { roi: 0.28, decodePx: 1280 },
  { roi: 0.38, decodePx: 1024 },
  { roi: 0.52, decodePx: 960 },
];

const MEDIUM_ATTEMPTS: ScanAttempt[] = [
  { roi: 0.24, decodePx: 720 },
  { roi: 0.34, decodePx: 640 },
  { roi: 0.18, decodePx: 720 },
  { roi: 0.44, decodePx: 560 },
];

const LOW_ATTEMPTS: ScanAttempt[] = [
  { roi: 0.32, decodePx: 480 },
  { roi: 0.42, decodePx: 480 },
  { roi: 0.24, decodePx: 560 },
];

export function getScanProfile(tier: ScanTier = getInitialScanTier()): ScanProfile {
  const iOS = isIosDevice();
  if (tier === "low") {
    return {
      tier,
      cameraWidth: 960,
      cameraHeight: 540,
      frameRate: 24,
      initialZoom: 2,
      tryHarder: false,
      attemptsPerTick: 1,
      pauseMs: 80,
      slowTickMs: 90,
      useNativeFullFrame: false,
      attempts: LOW_ATTEMPTS,
    };
  }
  if (tier === "medium") {
    return {
      tier,
      cameraWidth: 1280,
      cameraHeight: 720,
      frameRate: 24,
      initialZoom: 2.2,
      tryHarder: false,
      attemptsPerTick: 1,
      pauseMs: 50,
      slowTickMs: 75,
      useNativeFullFrame: false,
      attempts: MEDIUM_ATTEMPTS,
    };
  }
  return {
    tier: "high",
    cameraWidth: iOS ? 3840 : 1920,
    cameraHeight: iOS ? 2160 : 1080,
    frameRate: 30,
    initialZoom: iOS ? 3 : 2.4,
    tryHarder: true,
    attemptsPerTick: iOS ? 4 : 2,
    pauseMs: 28,
    slowTickMs: iOS ? 110 : 80,
    useNativeFullFrame: true,
    attempts: HIGH_ATTEMPTS,
  };
}

export function createNativeQrDetector(): NativeQrDetector | null {
  if (typeof window === "undefined") return null;
  const Detector = (window as Window & { BarcodeDetector?: new (opts: { formats: string[] }) => NativeQrDetector })
    .BarcodeDetector;
  if (!Detector) return null;
  try {
    return new Detector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

function getScanContext(canvas: HTMLCanvasElement, size: number): CanvasRenderingContext2D | null {
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  return canvas.getContext("2d", { alpha: false, willReadFrequently: true });
}

function boostGrayscaleContrastOnCanvas(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const { data } = imageData;
  const factor = 1.55;
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let v = (g - 128) * factor + 128;
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    const u = v | 0;
    data[i] = u;
    data[i + 1] = u;
    data[i + 2] = u;
  }
  ctx.putImageData(imageData, 0, 0);
}

export function drawVideoRoi(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  roi: number,
  decodePx: number,
  options?: { contrastBoost?: boolean; sharpUpscale?: boolean },
): CanvasRenderingContext2D | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const side = Math.max(64, Math.round(Math.min(vw, vh) * roi));
  const sx = Math.round((vw - side) / 2);
  const sy = Math.round((vh - side) / 2);
  const ctx = getScanContext(canvas, decodePx);
  if (!ctx) return null;
  const upscale = decodePx > side;
  const sharp = options?.sharpUpscale === true;
  ctx.imageSmoothingEnabled = upscale && !sharp;
  ctx.imageSmoothingQuality = upscale && !sharp ? "high" : "low";
  try {
    ctx.drawImage(video, sx, sy, side, side, 0, 0, decodePx, decodePx);
  } catch {
    return null;
  }
  if (options?.contrastBoost) {
    boostGrayscaleContrastOnCanvas(ctx, decodePx, decodePx);
  }
  return ctx;
}

export function decodeQrCanvas(reader: BrowserMultiFormatReader, canvas: HTMLCanvasElement): string | null {
  try {
    return reader.decodeFromCanvas(canvas).getText();
  } catch {
    return null;
  }
}

export function tryDecodeQrRoi(
  reader: BrowserMultiFormatReader,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  roi: number,
  decodePx: number,
  options?: { contrastBoost?: boolean; sharpUpscale?: boolean },
): string | null {
  const ctx = drawVideoRoi(video, canvas, roi, decodePx, options);
  if (!ctx) return null;
  try {
    return reader.decodeFromCanvas(canvas).getText();
  } catch {
    return null;
  }
}
