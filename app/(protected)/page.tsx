"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { RestoreQueuePanel, type RestoreQueueEntry } from "@/app/components/RestoreQueuePanel";
import { ScanQueuePanel, ScanTotalsBadge } from "@/app/components/ScanQueuePanel";
import { SaleQueuePanel } from "@/app/components/SaleQueuePanel";
import { SalesHistoryPanel } from "@/app/components/SalesHistoryPanel";
import { LocationPreviewPanel } from "@/app/components/LocationPreviewPanel";
import { SkuPickerEntry } from "@/app/components/SkuPickerEntry";
import { MoveModelPicker } from "@/app/components/MoveModelPicker";
import { MovementIcon, operationVisuals, type OperationMode } from "@/app/components/MovementIcon";
import { StockPanel } from "@/app/components/StockPanel";
import { LocationOrderPanel } from "@/app/components/LocationOrderPanel";
import { playOperationSuccess, playScanBeep, unlockScanFeedback } from "@/lib/appSounds";
import { modelsInScanOrder } from "@/lib/modelOrder";
import { parseSkuModel } from "@/lib/skuModel";
import { createNativeQrDetector, decodeQrCanvas, drawVideoRoi, getInitialScanTier, getScanProfile, nextLowerScanTier } from "@/lib/qrScan";
import { defaultLocationTypeForZone, formatLocationType, locationTypeLabels, zoneLabels } from "@/lib/locationMeta";
import { summarizeScanQueue, groupQueueByModel } from "@/lib/skuModel";
import { summarizeStockRows, modelQtyAtLocation } from "@/lib/stockViews";
import { diffReconcileStock, reconcileDiffHasChanges } from "@/lib/reconcileDiff";
import { buildLocationTypeMap } from "@/lib/stockClassification";
import { resolveSaleLineLocation, type SaleQueueLine } from "@/lib/saleQueue";
import type { LocationType, Zone } from "@/lib/types";

type MovementType = "ADD" | "REMOVE" | "MOVE" | "RESTORE_FROM_TMP" | "MOVE_TO_SALE" | "SALE_FINALIZE";

const movementPresets: OperationMode[] = [
  "ADD",
  "RECONCILE",
  "REMOVE",
  "MOVE",
  "RESTORE_FROM_TMP",
  "MOVE_TO_SALE",
];

const operationGroups: Array<{ title: string; types: OperationMode[]; cols: 2 | 3 }> = [
  { title: "Stan lokalizacji", types: ["ADD", "RECONCILE", "REMOVE"], cols: 3 },
  { title: "Podglad", types: ["PREVIEW"], cols: 2 },
  { title: "Przenoszenie", types: ["MOVE", "RESTORE_FROM_TMP"], cols: 2 },
  { title: "Sprzedaz", types: ["MOVE_TO_SALE"], cols: 2 },
];

/** Krotkie etykiety na kafelki (panel dotykowy). */
const movementTileLabels: Record<OperationMode, string> = {
  ADD: operationVisuals.ADD.label,
  RECONCILE: operationVisuals.RECONCILE.label,
  PREVIEW: operationVisuals.PREVIEW.label,
  REMOVE: operationVisuals.REMOVE.label,
  MOVE: operationVisuals.MOVE.label,
  RESTORE_FROM_TMP: operationVisuals.RESTORE_FROM_TMP.label,
  MOVE_TO_SALE: operationVisuals.MOVE_TO_SALE.label,
  SALE_FINALIZE: operationVisuals.SALE_FINALIZE.label,
};

const movementLabels: Record<OperationMode, string> = {
  ADD: operationVisuals.ADD.hint,
  RECONCILE: operationVisuals.RECONCILE.hint,
  PREVIEW: operationVisuals.PREVIEW.hint,
  REMOVE: operationVisuals.REMOVE.hint,
  MOVE: operationVisuals.MOVE.hint,
  RESTORE_FROM_TMP: operationVisuals.RESTORE_FROM_TMP.hint,
  MOVE_TO_SALE: operationVisuals.MOVE_TO_SALE.hint,
  SALE_FINALIZE: operationVisuals.SALE_FINALIZE.hint,
};

/**
 * Skaner dobiera jakosc do urzadzenia. iPhone startuje na pelnym algorytmie;
 * jesli klatki sie dluzą, schodzi na lzejszy tryb.
 * Male QR (~1 cm): zoom + srodek ramki, 15–25 cm od etykiety.
 */

function looksLikeHttpUrl(raw: string) {
  return /^https?:\/\//i.test(raw.replace(/\s+/g, "").trim());
}

function looksLikeProductQr(raw: string) {
  const compact = raw.replace(/\s+/g, "").trim();
  return /^https?:\/\//i.test(compact) && /[?&#]sku=/i.test(compact);
}

function extractSkuFromProductQr(raw: string) {
  const compact = raw.replace(/\s+/g, "").trim();
  const match = compact.match(/[?&#]sku=([^&#]+)/i);
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]).replace(/\s+/g, "").toUpperCase();
  } catch {
    return match[1].replace(/\s+/g, "").toUpperCase();
  }
}

function normalizeScannedSku(rawValue: string) {
  const compactRaw = rawValue.replace(/\s+/g, "").trim();
  if (!compactRaw) return "";

  if (looksLikeProductQr(compactRaw)) {
    return extractSkuFromProductQr(compactRaw);
  }

  // Plain text SKU (avoid URL "=" heuristics — they break location QR payloads that look like URLs)
  return compactRaw.toUpperCase();
}

type LocationRow = {
  code: string;
  name: string;
  parentZone: Zone;
  locationType: LocationType;
  isActive: boolean;
  barcodeValue?: string;
  sortOrder?: number;
};

type MoveQueueLine = { sku: string; qty: number };

type AddModelLocationHint = {
  locationCode: string;
  locationName: string | null;
  qty: number;
  variantCount: number;
};

type ScanToast = { id: number; text: string };

/** Po udanym skanie — blokada kolejnego odczytu (zapobiega podwojnemu skanowi tego samego QR). */
const SCAN_COOLDOWN_MS = 1800;

/** Powtarzanie listy lokalizacji w sliderze (nieskonczony efekt przewijania). */
const MOVE_DEST_STRIP_REPEAT = 3;

function normalizeLocationScanToken(raw: string) {
  return raw.replace(/\s+/g, "").trim().toUpperCase();
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [userRole, setUserRole] = useState<"ADMIN" | "OPERATOR" | null>(null);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [stock, setStock] = useState<Array<{ locationCode: string; sku: string; qty: number }>>([]);
  const [modelOrderRows, setModelOrderRows] = useState<Array<{ locationCode: string; model: string; sortOrder: number }>>([]);
  const [operationMode, setOperationMode] = useState<OperationMode>("ADD");
  const [sku, setSku] = useState("");
  const [qty] = useState(1);
  const [fromLocationCode, setFromLocationCode] = useState("");
  const [toLocationCode, setToLocationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restoreQueue, setRestoreQueue] = useState<RestoreQueueEntry[]>([]);
  const [restoreNoLocationSku, setRestoreNoLocationSku] = useState<string | null>(null);
  const [restoreAssignSku, setRestoreAssignSku] = useState<string | null>(null);
  const [activeLocationCode, setActiveLocationCode] = useState<string | null>(null);
  const [pendingUnknownLocationCode, setPendingUnknownLocationCode] = useState<string | null>(null);
  const [quickLocationName, setQuickLocationName] = useState("");
  const [quickLocationZone, setQuickLocationZone] = useState<"SKLEP" | "ZAPLECZE">("SKLEP");
  const [quickLocationType, setQuickLocationType] = useState<LocationType>("DISPLAY");

  const [previewHighlightSku, setPreviewHighlightSku] = useState<string | null>(null);
  const [previewFilterModels, setPreviewFilterModels] = useState<string[]>([]);
  const [addVerifyPrompt, setAddVerifyPrompt] = useState<{
    locationCode: string;
    model: string;
    expectedQty: number;
  } | null>(null);
  const [stockOpen, setStockOpen] = useState(false);
  const [locationOrderOpen, setLocationOrderOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  /** Przeniesienie: kolejka SKU z aktywnej lokalizacji + warstwa wyboru „dokąd”. */
  const [moveQueue, setMoveQueue] = useState<MoveQueueLine[]>([]);
  const [moveTargetOpen, setMoveTargetOpen] = useState(false);
  const [moveConfirmOpen, setMoveConfirmOpen] = useState(false);
  const [moveTargetMode, setMoveTargetMode] = useState<"queue" | "entire">("queue");
  const [moveTargetSelectedCode, setMoveTargetSelectedCode] = useState<string | null>(null);
  const [moveBatchBusy, setMoveBatchBusy] = useState(false);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileConfirmOpen, setReconcileConfirmOpen] = useState(false);
  const [saleSourceOpen, setSaleSourceOpen] = useState(false);
  const [saleSourceOptions, setSaleSourceOptions] = useState<Array<{ locationCode: string; qty: number }>>([]);
  const [saleSourceSelected, setSaleSourceSelected] = useState<string | null>(null);
  const [saleBusy, setSaleBusy] = useState(false);
  const [saleQueue, setSaleQueue] = useState<SaleQueueLine[]>([]);
  const [saleHistoryOpen, setSaleHistoryOpen] = useState(false);
  const [saleLocationPick, setSaleLocationPick] = useState<{
    lineId: string;
    sku: string;
    qty: number;
    options: Array<{ locationCode: string; qty: number }>;
  } | null>(null);
  const [saleSubmitBusy, setSaleSubmitBusy] = useState(false);
  const salePhotoFilesRef = useRef<Map<string, File>>(new Map());
  const moveDestScrollRef = useRef<HTMLDivElement | null>(null);
  const moveDestStripRef = useRef<HTMLDivElement | null>(null);

  /** Dodaj stan: kolejka SKU do zapisu na jednej lokalizacji (skan wielu bez zamykania aparatu). */
  const [addQueue, setAddQueue] = useState<MoveQueueLine[]>([]);
  const [addModelLocationHints, setAddModelLocationHints] = useState<AddModelLocationHint[]>([]);
  const [addHintsLoading, setAddHintsLoading] = useState(false);
  const [reconcileQueue, setReconcileQueue] = useState<MoveQueueLine[]>([]);
  const [scanToasts, setScanToasts] = useState<ScanToast[]>([]);
  const scanToastIdRef = useRef(0);
  const addSkuOccurrenceRef = useRef<Map<string, number>>(new Map());
  const lastScanDedupeKeyRef = useRef<string>("");
  const lastScanDedupeAtRef = useRef(0);
  const scanCooldownUntilRef = useRef(0);
  const [scanCooldownMs, setScanCooldownMs] = useState(0);
  const [scanFlash, setScanFlash] = useState(false);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerStatus, setScannerStatus] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const scanControlsRef = useRef<{ stop: () => void } | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const zoomRangeRef = useRef<{ min: number; max: number; step: number } | null>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);
  const scanDecodeIntervalRef = useRef<number | null>(null);
  const scanLoopStopRef = useRef(false);
  const scanProfileRef = useRef(getScanProfile("high"));
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleScanTextRef = useRef<(text: string) => void>(() => {});
  const movementGridRef = useRef<HTMLDivElement | null>(null);
  const draftHydratedRef = useRef(false);
  const draftSaveTimerRef = useRef<number | null>(null);

  const [manualLocationOpen, setManualLocationOpen] = useState(false);
  const [manualLocCode, setManualLocCode] = useState("");
  const [manualLocName, setManualLocName] = useState("");
  const [manualLocZone, setManualLocZone] = useState<"SKLEP" | "ZAPLECZE">("SKLEP");
  const [manualLocType, setManualLocType] = useState<LocationType>("DISPLAY");
  const [manualLocBusy, setManualLocBusy] = useState(false);

  async function loadData(includeDraft = false) {
    const withTimeout = async (url: string, timeoutMs = 10000) => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, { signal: controller.signal });
      } finally {
        window.clearTimeout(timer);
      }
    };

    try {
      const [meRes, locationsRes, stockRes, modelOrderRes, draftRes] = await Promise.all([
        withTimeout("/api/auth/me"),
        withTimeout("/api/locations"),
        withTimeout("/api/stock"),
        withTimeout("/api/model-order"),
        includeDraft ? withTimeout("/api/draft") : Promise.resolve(null),
      ]);

      if (!meRes.ok) {
        window.location.replace("/login");
        return;
      }
      if (!locationsRes.ok || !stockRes.ok) {
        throw new Error("Nie udalo sie pobrac danych startowych");
      }

      const meData = await meRes.json();
      const locationsData = await locationsRes.json();
      const stockData = await stockRes.json();
      setUserRole(meData?.user?.role ?? null);
      setLocations(locationsData.items ?? []);
      setStock(stockData.stock ?? []);
      if (modelOrderRes.ok) {
        const modelOrderData = await modelOrderRes.json();
        setModelOrderRows(modelOrderData.items ?? []);
      } else {
        setModelOrderRows([]);
      }
      if (includeDraft) {
        if (draftRes?.ok) {
          const draftData = await draftRes.json();
          const draft = draftData?.draft;
          const normalizeQueue = (rows: unknown): MoveQueueLine[] =>
            Array.isArray(rows)
              ? rows
                  .map((line) => ({
                    sku: String((line as { sku?: unknown }).sku ?? "")
                      .trim()
                      .toUpperCase(),
                    qty: Math.max(1, Math.floor(Number((line as { qty?: unknown }).qty) || 1)),
                  }))
                  .filter((line) => line.sku.length > 0)
              : [];
          const nextAddQueue = normalizeQueue(draft?.addQueue);
          const nextMoveQueue = normalizeQueue(draft?.moveQueue);
          const nextReconcileQueue = normalizeQueue(draft?.reconcileQueue);
          setActiveLocationCode(draft?.activeLocationCode?.trim()?.toUpperCase() || null);
          setFromLocationCode(draft?.fromLocationCode?.trim()?.toUpperCase() || "");
          setToLocationCode(draft?.toLocationCode?.trim()?.toUpperCase() || "");
          setAddQueue(nextAddQueue);
          setMoveQueue(nextMoveQueue);
          setReconcileQueue(nextReconcileQueue);
          addSkuOccurrenceRef.current.clear();
          for (const line of nextAddQueue) {
            addSkuOccurrenceRef.current.set(line.sku, line.qty);
          }
        }
        draftHydratedRef.current = true;
      }
      setReady(true);
    } catch {
      setError("Nie udalo sie wczytac danych. Odswiez strone.");
      if (includeDraft) draftHydratedRef.current = true;
      setReady(true);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData(true);
  }, []);

  useEffect(() => {
    if (!ready || !draftHydratedRef.current) return;
    if (draftSaveTimerRef.current != null) {
      window.clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = window.setTimeout(() => {
      void fetch("/api/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeLocationCode,
          fromLocationCode,
          toLocationCode,
          addQueue,
          moveQueue,
          reconcileQueue,
        }),
      });
    }, 350);
    return () => {
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [activeLocationCode, addQueue, fromLocationCode, moveQueue, reconcileQueue, ready, toLocationCode]);

  const resolveLocationCodeFromScan = useCallback((token: string) => {
    const normalized = normalizeLocationScanToken(token);
    if (!normalized) return null;
    const byCode = locations.find((location) => location.code.toUpperCase() === normalized);
    if (byCode) return byCode.code;
    const byBarcode = locations.find(
      (location) => (location.barcodeValue ?? "").toUpperCase() === normalized,
    );
    if (byBarcode) return byBarcode.code;
    if (normalized.startsWith("LOC-")) {
      const stripped = normalized.replace(/^LOC-/, "");
      const match = locations.find((location) => location.code.toUpperCase() === stripped);
      return match?.code ?? null;
    }
    return null;
  }, [locations]);

  function resolveMovementPayload() {
    let from = fromLocationCode || undefined;
    let to = toLocationCode || undefined;

    if (operationMode === "ADD") {
      from = undefined;
      if (!to && activeLocationCode) {
        to = activeLocationCode;
      }
    } else if (operationMode === "REMOVE") {
      if (!from && activeLocationCode) {
        from = activeLocationCode;
      }
    } else if (operationMode === "MOVE") {
      if (!from && to && activeLocationCode && activeLocationCode !== to) {
        from = activeLocationCode;
      }
      if (!to && from && activeLocationCode && activeLocationCode !== from) {
        to = activeLocationCode;
      }
    } else if (operationMode === "MOVE_TO_SALE" || operationMode === "SALE_FINALIZE") {
      if (!from && activeLocationCode) {
        const skuNorm = sku.trim().toUpperCase();
        const atActive = stock.find(
          (row) =>
            row.locationCode.toUpperCase() === activeLocationCode.toUpperCase()
            && row.sku.toUpperCase() === skuNorm
            && row.qty > 0,
        );
        if (atActive) {
          from = activeLocationCode;
        }
      }
      to = undefined;
    }

    return { fromLocationCode: from, toLocationCode: to };
  }

  const resolveMoveEndpoints = useCallback(() => {
    const from = fromLocationCode.trim().toUpperCase();
    const to = toLocationCode.trim().toUpperCase();
    const active = activeLocationCode?.trim().toUpperCase() || "";

    if (from && to) return { from, to };
    if (from && !to && active && active !== from) return { from, to: active };
    if (!from && to && active && active !== to) return { from: active, to };
    if (from) return { from, to: "" };
    if (active) return { from: active, to: "" };
    return { from: "", to: "" };
  }, [activeLocationCode, fromLocationCode, toLocationCode]);

  const activeScanQueue =
    operationMode === "ADD" ? addQueue : operationMode === "RECONCILE" ? reconcileQueue : operationMode === "MOVE" ? moveQueue : [];
  const activeScanTotals = useMemo(() => summarizeScanQueue(activeScanQueue), [activeScanQueue]);

  const singleSkuForAddHints = useMemo(() => {
    if (operationMode !== "ADD") return null;
    const groups = groupQueueByModel(addQueue);
    if (groups.length === 1) {
      return groups[0].lines[0]?.sku ?? null;
    }
    if (groups.length === 0 && sku.trim()) {
      return normalizeScannedSku(sku);
    }
    return null;
  }, [operationMode, addQueue, sku]);

  const showAddLocationHints = operationMode === "ADD" && singleSkuForAddHints !== null;

  useEffect(() => {
    if (!showAddLocationHints || !singleSkuForAddHints) {
      setAddModelLocationHints([]);
      return;
    }

    let cancelled = false;
    (async () => {
      setAddHintsLoading(true);
      try {
        const response = await fetch(`/api/restore-suggestions?sku=${encodeURIComponent(singleSkuForAddHints)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) {
          if (!cancelled) setAddModelLocationHints([]);
          return;
        }
        if (!cancelled) {
          setAddModelLocationHints(Array.isArray(data.locations) ? data.locations : []);
        }
      } catch {
        if (!cancelled) setAddModelLocationHints([]);
      } finally {
        if (!cancelled) setAddHintsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showAddLocationHints, singleSkuForAddHints]);

  const reconcileTargetLocationCode = useMemo(
    () => (activeLocationCode?.trim() || toLocationCode.trim()).toUpperCase(),
    [activeLocationCode, toLocationCode],
  );

  const reconcileDiff = useMemo(() => {
    if (!reconcileTargetLocationCode) {
      return { added: [], removed: [], qtyChanged: [] };
    }
    const currentAtLocation = stock
      .filter((row) => row.locationCode.toUpperCase() === reconcileTargetLocationCode)
      .map((row) => ({ sku: row.sku, qty: row.qty }));
    const savedModelOrder = modelOrderRows
      .filter((row) => row.locationCode.toUpperCase() === reconcileTargetLocationCode)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.model.localeCompare(b.model))
      .map((row) => row.model);
    return diffReconcileStock(currentAtLocation, reconcileQueue, { savedModelOrder });
  }, [stock, reconcileQueue, reconcileTargetLocationCode, modelOrderRows]);

  const moveDestinationLocations = useMemo(() => {
    const { from } = resolveMoveEndpoints();
    return locations.filter((loc) => loc.isActive && (!from || loc.code.toUpperCase() !== from));
  }, [locations, resolveMoveEndpoints]);

  const moveSourceLocationCode = useMemo(() => resolveMoveEndpoints().from, [resolveMoveEndpoints]);

  const moveTargetLocationCode = useMemo(() => resolveMoveEndpoints().to, [resolveMoveEndpoints]);

  const moveSourceLocationStock = useMemo(
    () =>
      moveSourceLocationCode
        ? stock.filter((row) => row.locationCode.toUpperCase() === moveSourceLocationCode)
        : [],
    [stock, moveSourceLocationCode],
  );

  const previewLocationCode = useMemo(
    () =>
      operationMode === "PREVIEW"
        ? (activeLocationCode?.trim() || toLocationCode.trim()).toUpperCase()
        : "",
    [operationMode, activeLocationCode, toLocationCode],
  );

  const previewLocationMeta = useMemo(
    () => locations.find((loc) => loc.code.toUpperCase() === previewLocationCode),
    [locations, previewLocationCode],
  );

  const previewLocationStock = useMemo(
    () =>
      previewLocationCode
        ? stock.filter((row) => row.locationCode.toUpperCase() === previewLocationCode)
        : [],
    [stock, previewLocationCode],
  );

  const locationTypeMap = useMemo(() => buildLocationTypeMap(locations), [locations]);

  const moveSourceLocationSummary = useMemo(
    () => summarizeStockRows(moveSourceLocationStock),
    [moveSourceLocationStock],
  );

  const clearActiveLocationAfterSave = useCallback(() => {
    setActiveLocationCode(null);
    setToLocationCode("");
    setFromLocationCode("");
  }, []);

  const moveDestinationStripItems = useMemo(() => {
    const base = moveDestinationLocations;
    if (base.length === 0) return [];
    const out: Array<{ key: string; code: string; name: string }> = [];
    for (let r = 0; r < MOVE_DEST_STRIP_REPEAT; r++) {
      for (const loc of base) {
        out.push({ key: `${loc.code}-strip-${r}`, code: loc.code, name: loc.name });
      }
    }
    return out;
  }, [moveDestinationLocations]);

  const pushScanToast = useCallback((text: string) => {
    const id = ++scanToastIdRef.current;
    setScanToasts((prev) => [...prev, { id, text }]);
    window.setTimeout(() => {
      setScanToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  }, []);

  const applyAddLocationHint = useCallback(
    (locationCode: string) => {
      setActiveLocationCode(locationCode);
      setToLocationCode(locationCode);
      setMessage(`Lokalizacja ustawiona: ${locationCode}`);
      pushScanToast(`Lokalizacja: ${locationCode}`);
    },
    [pushScanToast],
  );

  const attachRestoreSuggestion = useCallback(
    async (skuNorm: string) => {
      try {
        const response = await fetch(`/api/restore-suggestions?sku=${encodeURIComponent(skuNorm)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(typeof data.error === "string" ? data.error : "Nie udalo sie pobrac sugestii lokalizacji.");
          setRestoreQueue((prev) =>
            prev.map((entry) => (entry.sku === skuNorm ? { ...entry, loading: false } : entry)),
          );
          return;
        }
        setRestoreQueue((prev) =>
          prev.map((entry) =>
            entry.sku === skuNorm
              ? {
                  ...entry,
                  loading: false,
                  model: data.model,
                  suggestedLocation: data.suggestedLocation ?? null,
                  suggestedLocationName: data.suggestedLocationName ?? null,
                  locations: Array.isArray(data.locations) ? data.locations : [],
                }
              : entry,
          ),
        );
        if (data.suggestedLocation) {
          const label = data.suggestedLocationName
            ? `${data.suggestedLocation} (${data.suggestedLocationName})`
            : data.suggestedLocation;
          pushScanToast(`${skuNorm} → ${label}`);
        } else {
          pushScanToast(`${skuNorm}: brak lokalizacji`);
          setRestoreNoLocationSku(skuNorm);
        }
      } catch {
        setError("Blad polaczenia przy pobieraniu sugestii lokalizacji.");
        setRestoreQueue((prev) =>
          prev.map((entry) => (entry.sku === skuNorm ? { ...entry, loading: false } : entry)),
        );
      }
    },
    [pushScanToast],
  );

  const beginRestoreAssignFlow = useCallback((skuNorm: string) => {
    setRestoreNoLocationSku(null);
    setRestoreAssignSku(skuNorm);
    setScannerStatus("Zeskanuj lokalizacje, do ktorej chcesz dodac produkt.");
  }, []);

  const beginScanCooldown = useCallback(() => {
    const until = Date.now() + SCAN_COOLDOWN_MS;
    scanCooldownUntilRef.current = until;
    setScanCooldownMs(SCAN_COOLDOWN_MS);
    setScanFlash(true);
    window.setTimeout(() => setScanFlash(false), 240);
    playScanBeep();
  }, []);

  useEffect(() => {
    if (!scannerOpen) {
      scanCooldownUntilRef.current = 0;
      setScanCooldownMs(0);
      setScanFlash(false);
      return;
    }
    const id = window.setInterval(() => {
      const left = Math.max(0, scanCooldownUntilRef.current - Date.now());
      setScanCooldownMs((prev) => (prev === left ? prev : left));
    }, 50);
    return () => window.clearInterval(id);
  }, [scannerOpen]);

  const changeOperationMode = useCallback((next: OperationMode) => {
    unlockScanFeedback();
    if (next !== "MOVE") {
      setMoveTargetOpen(false);
      setMoveTargetSelectedCode(null);
    }
    if (next === "ADD" || next === "RECONCILE") {
      setFromLocationCode("");
    }
    if (next !== "PREVIEW") {
      setPreviewFilterModels([]);
    }
    if (next !== "MOVE_TO_SALE" && next !== "SALE_FINALIZE") {
      setSaleSourceOpen(false);
      setSaleSourceSelected(null);
      setSaleLocationPick(null);
    }
    setOperationMode(next);
  }, []);

  const openLocationPreview = useCallback(
    (locationCode: string, models?: string[]) => {
      const code = locationCode.trim().toUpperCase();
      if (!code) return;
      setPreviewHighlightSku(null);
      setPreviewFilterModels(
        models && models.length > 0 ? models.map((model) => model.trim().toUpperCase()).filter(Boolean) : [],
      );
      setActiveLocationCode(code);
      setToLocationCode(code);
      changeOperationMode("PREVIEW");
    },
    [changeOperationMode],
  );

  const completeRestoreAssignToAdd = useCallback(
    (skuToAdd: string, locationCode: string) => {
      setRestoreAssignSku(null);
      setRestoreNoLocationSku(null);
      changeOperationMode("ADD");
      setAddQueue([{ sku: skuToAdd, qty: 1 }]);
      setActiveLocationCode(locationCode);
      setToLocationCode(locationCode);
      setSku(skuToAdd);
      addSkuOccurrenceRef.current.set(skuToAdd, 1);
      setMessage(`Dodaj do lokalizacji ${locationCode} — potwierdz zapis.`);
      setScannerStatus(null);
    },
    [changeOperationMode],
  );

  const appendToMoveQueue = useCallback((nextSku: string, lineQty: number) => {
    const skuNorm = nextSku.trim().toUpperCase();
    if (!skuNorm) return;
    setMoveQueue((prev) => {
      const idx = prev.findIndex((row) => row.sku === skuNorm);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { sku: skuNorm, qty: copy[idx].qty + Math.max(1, lineQty) };
        return copy;
      }
      return [...prev, { sku: skuNorm, qty: Math.max(1, lineQty) }];
    });
  }, []);

  /** true = obsłużono (MOVE/ADD), false = kontynuuj domyślne zachowanie (inne tryby). */
  const applyProductSkuScan = useCallback(
    (skuNormRaw: string): boolean => {
      const skuNorm = skuNormRaw.trim().toUpperCase();
      if (!skuNorm) return true;

      if (operationMode === "MOVE") {
        appendToMoveQueue(skuNorm, qty);
        setSku(skuNorm);
        const src = moveSourceLocationCode || "BRAK_LOKALIZACJI";
        setMessage(`Dodano do listy przeniesienia: ${skuNorm} (liczba z pola: ${qty}). Zrodlo: ${src}.`);
        setScannerStatus(
          moveSourceLocationCode
            ? moveTargetLocationCode
              ? "Kolejny produkt albo „Przenies wybrane produkty”."
              : "Kolejny produkt albo wybierz lokalizacje DO."
            : "Dodano produkt. Zeskanuj lokalizacje Z (zrodlo) przed zatwierdzeniem.",
        );
        return true;
      }

      if (operationMode === "RESTORE_FROM_TMP") {
        if (restoreAssignSku) {
          setScannerStatus("Zeskanuj lokalizacje docelowa — nie produktu.");
          return true;
        }
        const lineQty = Math.max(1, qty);
        let nextToast = skuNorm;
        setRestoreQueue((prev) => {
          const idx = prev.findIndex((row) => row.sku === skuNorm);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], qty: copy[idx].qty + lineQty, loading: true };
            const occ = (addSkuOccurrenceRef.current.get(skuNorm) ?? 0) + 1;
            addSkuOccurrenceRef.current.set(skuNorm, occ);
            nextToast = occ === 1 ? skuNorm : `${skuNorm} (${occ})`;
            queueMicrotask(() => void attachRestoreSuggestion(skuNorm));
            return copy;
          }
          addSkuOccurrenceRef.current.set(skuNorm, 1);
          nextToast = skuNorm;
          queueMicrotask(() => void attachRestoreSuggestion(skuNorm));
          return [{ sku: skuNorm, qty: lineQty, loading: true, model: parseSkuModel(skuNorm).model }];
        });
        queueMicrotask(() => pushScanToast(nextToast));
        setSku(skuNorm);
        setScannerStatus("Sprawdz sugestie lokalizacji — skanuj kolejny produkt z TMP.");
        return true;
      }

      if (operationMode === "ADD" || operationMode === "RECONCILE") {
        const lineQty = Math.max(1, qty);
        let nextToast = skuNorm;
        const setQueue = operationMode === "RECONCILE" ? setReconcileQueue : setAddQueue;
        setQueue((prev) => {
          const idx = prev.findIndex((r) => r.sku === skuNorm);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { sku: skuNorm, qty: copy[idx].qty + lineQty };
            const occ = (addSkuOccurrenceRef.current.get(skuNorm) ?? 0) + 1;
            addSkuOccurrenceRef.current.set(skuNorm, occ);
            nextToast = occ === 1 ? skuNorm : `${skuNorm} (${occ})`;
            return copy;
          }
          addSkuOccurrenceRef.current.set(skuNorm, 1);
          nextToast = skuNorm;
          return [...prev, { sku: skuNorm, qty: lineQty }];
        });
        queueMicrotask(() => pushScanToast(nextToast));
        setSku(skuNorm);
        const hasDest = Boolean(activeLocationCode?.trim() || toLocationCode.trim());
        if (operationMode === "RECONCILE") {
          setScannerStatus(
            hasDest
              ? "Aktualizacja — skanuj kolejny produkt od lewej do prawej."
              : "Dodano do listy aktualizacji. Zeskanuj lokalizacje przed zapisem.",
          );
        } else {
          setScannerStatus(
            hasDest
              ? "Dodano — skanuj kolejny produkt."
              : "Dodano do kolejki. Zeskanuj/wybierz lokalizacje docelowa przed zapisem.",
          );
        }
        return true;
      }

      if (operationMode === "MOVE_TO_SALE" || operationMode === "SALE_FINALIZE") {
        const lineQty = Math.max(1, qty);
        let nextToast = skuNorm;
        setSaleQueue((prev) => {
          const idx = prev.findIndex((row) => row.sku === skuNorm);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], qty: copy[idx].qty + lineQty };
            const occ = (addSkuOccurrenceRef.current.get(skuNorm) ?? 0) + 1;
            addSkuOccurrenceRef.current.set(skuNorm, occ);
            nextToast = occ === 1 ? skuNorm : `${skuNorm} (${occ})`;
            return copy;
          }
          addSkuOccurrenceRef.current.set(skuNorm, 1);
          nextToast = skuNorm;
          return [...prev, { id: crypto.randomUUID(), sku: skuNorm, qty: lineQty }];
        });
        queueMicrotask(() => pushScanToast(nextToast));
        setSku(skuNorm);
        setScannerStatus("Dodano do listy sprzedazy — skanuj kolejny produkt albo zapisz.");
        return true;
      }

      return false;
    },
    [appendToMoveQueue, attachRestoreSuggestion, moveSourceLocationCode, moveTargetLocationCode, operationMode, pushScanToast, qty, restoreAssignSku, toLocationCode],
  );

  const removeRestoreQueueLine = useCallback((skuNorm: string) => {
    setRestoreQueue((prev) => prev.filter((row) => row.sku !== skuNorm));
  }, []);

  const setRestoreQueueLineQty = useCallback((skuNorm: string, nextQty: number) => {
    const q = Math.max(1, Math.floor(nextQty));
    setRestoreQueue((prev) => prev.map((row) => (row.sku === skuNorm ? { ...row, qty: q } : row)));
  }, []);

  const removeMoveQueueLine = useCallback((skuNorm: string) => {
    setMoveQueue((prev) => prev.filter((row) => row.sku !== skuNorm));
  }, []);

  const setMoveQueueLineQty = useCallback((skuNorm: string, nextQty: number) => {
    const q = Math.max(1, Math.floor(nextQty));
    setMoveQueue((prev) => prev.map((row) => (row.sku === skuNorm ? { ...row, qty: q } : row)));
  }, []);

  const toggleMoveModel = useCallback(
    (model: string, selected: boolean) => {
      const normalized = model.trim().toUpperCase();
      const modelStock = moveSourceLocationStock.filter(
        (row) => parseSkuModel(row.sku).model === normalized,
      );
      if (modelStock.length === 0) return;

      if (selected) {
        setMoveQueue((prev) => {
          const next = [...prev];
          for (const row of modelStock) {
            const sku = row.sku.trim().toUpperCase();
            const idx = next.findIndex((line) => line.sku === sku);
            if (idx >= 0) next[idx] = { sku, qty: row.qty };
            else next.push({ sku, qty: row.qty });
          }
          return next;
        });
        const pieces = modelStock.reduce((sum, row) => sum + row.qty, 0);
        setMessage(`Dodano model ${normalized} (${pieces} szt., ${modelStock.length} rozmiarow).`);
      } else {
        setMoveQueue((prev) => prev.filter((line) => parseSkuModel(line.sku).model !== normalized));
        setMessage(`Usunieto model ${normalized} z listy przeniesienia.`);
      }
    },
    [moveSourceLocationStock],
  );

  const selectAllMoveModels = useCallback(() => {
    if (moveSourceLocationStock.length === 0) return;
    setMoveQueue(
      moveSourceLocationStock.map((row) => ({
        sku: row.sku.trim().toUpperCase(),
        qty: row.qty,
      })),
    );
    setMessage(`Zaznaczono wszystkie modele z ${moveSourceLocationCode}.`);
  }, [moveSourceLocationCode, moveSourceLocationStock]);

  const clearMoveModelSelection = useCallback(() => {
    setMoveQueue([]);
    setMessage("Wyczyszczono liste przeniesienia.");
  }, []);

  const beginMoveFlow = useCallback(
    (mode: "queue" | "entire"): boolean => {
      setError(null);
      setMoveTargetMode(mode);
      const { from, to } = resolveMoveEndpoints();

      if (!from) {
        setError("Najpierw zeskanuj lokalizacje zrodlowa (Z).");
        return false;
      }
      if (mode === "queue" && moveQueue.length === 0) {
        setError("Dodaj co najmniej jeden produkt (skan kodu QR / SKU).");
        return false;
      }
      if (mode === "entire" && moveSourceLocationStock.length === 0) {
        setError("Lokalizacja zrodlowa jest pusta — nie ma czego przenosic.");
        return false;
      }
      if (to) {
        if (to === from) {
          setError("Lokalizacja docelowa musi byc inna niz zrodlowa.");
          return false;
        }
        setMoveTargetSelectedCode(to);
        setMoveConfirmOpen(true);
        return true;
      }
      if (moveDestinationLocations.length === 0) {
        setError("Brak innej aktywnej lokalizacji docelowej w bazie.");
        return false;
      }
      setMoveTargetSelectedCode(moveDestinationLocations[0]?.code ?? null);
      setMoveTargetOpen(true);
      return true;
    },
    [
      moveDestinationLocations,
      moveQueue.length,
      moveSourceLocationStock.length,
      resolveMoveEndpoints,
    ],
  );

  const openMoveTargetLayer = useCallback((): boolean => beginMoveFlow("queue"), [beginMoveFlow]);

  const openMoveEntireLocationLayer = useCallback((): boolean => beginMoveFlow("entire"), [beginMoveFlow]);

  const onMoveDestScroll = useCallback(() => {
    const scrollEl = moveDestScrollRef.current;
    const stripEl = moveDestStripRef.current;
    if (!scrollEl || !stripEl || moveDestinationLocations.length === 0) return;
    const segment = stripEl.scrollWidth / MOVE_DEST_STRIP_REPEAT;
    if (segment <= 0) return;
    const left = scrollEl.scrollLeft;
    const pad = scrollEl.clientWidth * 0.12;
    if (left < pad) {
      scrollEl.scrollLeft += segment;
    } else if (left > segment * (MOVE_DEST_STRIP_REPEAT - 1) - pad) {
      scrollEl.scrollLeft -= segment;
    }
  }, [moveDestinationLocations.length]);

  useEffect(() => {
    if (!moveTargetOpen || moveDestinationStripItems.length === 0) return;
    const scrollEl = moveDestScrollRef.current;
    const stripEl = moveDestStripRef.current;
    if (!scrollEl || !stripEl) return;
    const run = () => {
      const segment = stripEl.scrollWidth / MOVE_DEST_STRIP_REPEAT;
      if (segment > 0) {
        scrollEl.scrollLeft = segment;
      }
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(run));
  }, [moveTargetOpen, moveDestinationStripItems.length, activeLocationCode]);

  async function confirmMoveToTarget() {
    const { from } = resolveMoveEndpoints();
    const to = moveTargetSelectedCode?.trim().toUpperCase();
    if (!from || !to) return;
    if (moveTargetMode === "queue" && moveQueue.length === 0) return;
    setError(null);
    setMessage(null);
    setMoveBatchBusy(true);
    try {
      if (moveTargetMode === "entire") {
        const response = await fetch(`/api/locations/${encodeURIComponent(from)}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toLocationCode: to }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(data.error ?? "Nie udalo sie przeniesc calej lokalizacji");
          return;
        }
        setMessage(
          `Przeniesiono cala lokalizacje ${from} → ${to}: ${data.movedPieceCount ?? "?"} szt., ${data.movedSkuCount ?? "?"} poz.`,
        );
        playOperationSuccess("MOVE");
        setMoveQueue([]);
        setMoveTargetOpen(false);
        setMoveConfirmOpen(false);
        setMoveTargetSelectedCode(null);
        setMoveTargetMode("queue");
        clearActiveLocationAfterSave();
        await loadData();
        return;
      }

      const queueSnapshot = [...moveQueue];
      for (let i = 0; i < queueSnapshot.length; i++) {
        const line = queueSnapshot[i]!;
        const response = await fetch("/api/movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            movementType: "MOVE",
            sku: line.sku,
            qty: line.qty,
            fromLocationCode: from,
            toLocationCode: to,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          const remaining = queueSnapshot.slice(i);
          setMoveQueue(remaining);
          await loadData();
          setError(
            data.error ??
              `Nie udalo sie przeniesc SKU ${line.sku}. Zostalo ${remaining.length} poz. na liscie — popraw i sprobuj ponownie.`,
          );
          return;
        }
      }
      setMessage(`Przeniesiono ${moveQueue.length} poz. z ${from} do ${to}.`);
      playOperationSuccess("MOVE");
      setMoveQueue([]);
      setMoveTargetOpen(false);
      setMoveConfirmOpen(false);
      setMoveTargetSelectedCode(null);
      setMoveTargetMode("queue");
      clearActiveLocationAfterSave();
      await loadData();
    } finally {
      setMoveBatchBusy(false);
    }
  }

  async function submitAddBatch() {
    setError(null);
    setMessage(null);
    const resolved = resolveMovementPayload();
    const to = resolved.toLocationCode?.trim().toUpperCase();
    if (!to) {
      setError("Brak lokalizacji docelowej dla dodawania.");
      return;
    }
    if (addQueue.length === 0) return;

    const queueSnapshot = [...addQueue];
    const modelGroups = groupQueueByModel(queueSnapshot);
    let verifyPrompt: { locationCode: string; model: string; expectedQty: number } | null = null;
    if (modelGroups.length === 1) {
      const model = modelGroups[0].model;
      const addedQty = modelGroups[0].totalQty;
      const previousQty = modelQtyAtLocation(stock, to, model);
      if (previousQty > 0) {
        verifyPrompt = { locationCode: to, model, expectedQty: previousQty + addedQty };
      }
    }

    for (const line of queueSnapshot) {
      const response = await fetch("/api/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movementType: "ADD",
          sku: line.sku,
          qty: line.qty,
          toLocationCode: to,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? `Nie udalo sie zapisac SKU ${line.sku}`);
        return;
      }
    }
    setMessage(`Dodano ${queueSnapshot.length} poz. na ${to}.`);
    playOperationSuccess("ADD");
    const scannedModels = modelsInScanOrder(queueSnapshot);
    if (scannedModels.length > 0) {
      const orderResponse = await fetch(`/api/locations/${encodeURIComponent(to)}/model-order`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appendModels: scannedModels }),
      });
      if (!orderResponse.ok) {
        const orderData = await orderResponse.json().catch(() => ({}));
        setError(orderData.error ?? "Dodano stan, ale nie zapisano kolejnosci modeli na koncu lokalizacji.");
      }
    }
    setAddQueue([]);
    setSku("");
    addSkuOccurrenceRef.current.clear();
    clearActiveLocationAfterSave();
    await loadData();
    if (verifyPrompt) {
      setAddVerifyPrompt(verifyPrompt);
    }
  }

  function requestReconcileSave() {
    setError(null);
    const location = (activeLocationCode?.trim() || toLocationCode.trim()).toUpperCase();
    if (!location) {
      setError("Najpierw zeskanuj albo wybierz lokalizacje do aktualizacji.");
      return;
    }
    if (reconcileQueue.length === 0) {
      setError("Zeskanuj produkty na lokalizacji, potem zapisz stan.");
      return;
    }
    setReconcileConfirmOpen(true);
  }

  async function submitReconcileBatch() {
    setReconcileConfirmOpen(false);
    setError(null);
    setMessage(null);
    const location = (activeLocationCode?.trim() || toLocationCode.trim()).toUpperCase();
    if (!location) {
      setError("Najpierw zeskanuj albo wybierz lokalizacje do aktualizacji.");
      return;
    }
    if (reconcileQueue.length === 0) {
      setError("Zeskanuj produkty na lokalizacji, potem zapisz stan.");
      return;
    }
    setReconcileBusy(true);
    try {
      const response = await fetch(`/api/locations/${encodeURIComponent(location)}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: reconcileQueue }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Nie udalo sie zaktualizowac stanu lokalizacji.");
        return;
      }
      setMessage(`Zaktualizowano stan lokalizacji ${location}: ${reconcileQueue.length} poz.`);
      playOperationSuccess("ADD");
      setReconcileQueue([]);
      setSku("");
      addSkuOccurrenceRef.current.clear();
      clearActiveLocationAfterSave();
      await loadData();
    } finally {
      setReconcileBusy(false);
    }
  }

  async function submitMovement(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setMessage(null);

    if (operationMode === "RESTORE_FROM_TMP") {
      return;
    }

    if (operationMode === "MOVE") {
      if (openMoveTargetLayer()) {
        // no-op
      }
      return;
    }

    if (operationMode === "RECONCILE" && reconcileQueue.length > 0) {
      requestReconcileSave();
      return;
    }

    if (operationMode === "ADD" && addQueue.length > 0) {
      await submitAddBatch();
      return;
    }

    if ((operationMode === "MOVE_TO_SALE" || operationMode === "SALE_FINALIZE") && saleQueue.length > 0) {
      await submitSaleBatch();
      return;
    }

    if (operationMode === "RECONCILE") return;

    const isSale = operationMode === "MOVE_TO_SALE" || operationMode === "SALE_FINALIZE";
    const resolved = resolveMovementPayload();
    let from = resolved.fromLocationCode;

    if (isSale && sku.trim()) {
      const skuNorm = sku.trim().toUpperCase();
      const available = stock.filter((row) => row.sku.toUpperCase() === skuNorm && row.qty > 0);
      if (!from) {
        if (available.length === 1) {
          from = available[0].locationCode;
        } else if (available.length > 1) {
          setSaleSourceOptions(available.map((row) => ({ locationCode: row.locationCode, qty: row.qty })));
          setSaleSourceSelected(null);
          setSaleSourceOpen(true);
          return;
        }
      }
    }

    await postSaleOrMovement({
      movementType: operationMode as MovementType,
      sku,
      qty,
      fromLocationCode: from,
      toLocationCode: isSale ? undefined : resolved.toLocationCode,
    });
  }

  async function postSaleOrMovement(payload: {
    movementType: MovementType;
    sku: string;
    qty: number;
    fromLocationCode?: string;
    toLocationCode?: string;
  }) {
    const response = await fetch("/api/movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (response.status === 409 && data.code === "LOCATION_CHOICE_REQUIRED") {
      setSaleSourceOptions(
        (data.locations ?? []).map((row: { locationCode: string; qty: number }) => ({
          locationCode: row.locationCode,
          qty: row.qty,
        })),
      );
      setSaleSourceSelected(null);
      setSaleSourceOpen(true);
      return;
    }
    if (!response.ok) {
      setError(data.error ?? "Nie udalo sie zapisac ruchu");
      return;
    }
    if (data.simulated) {
      setMessage(data.message ?? "Sugestia lokalizacji (bez zmiany stanu).");
      return;
    }

    setSaleSourceOpen(false);
    setMessage(payload.movementType === "MOVE_TO_SALE" || payload.movementType === "SALE_FINALIZE"
      ? "Sprzedaz zapisana w logu, zdjeto ze stanu"
      : "Ruch zapisany");
    playOperationSuccess(payload.movementType);
    setSku("");
    await loadData();
  }

  async function submitManualRemove(skuNorm: string) {
    setError(null);
    setMessage(null);
    const location = (fromLocationCode.trim() || activeLocationCode?.trim() || "").toUpperCase();
    if (!location) {
      setError("Najpierw wybierz lub zeskanuj lokalizacje, z ktorej zdejmujesz stan.");
      return;
    }
    await postSaleOrMovement({
      movementType: "REMOVE",
      sku: skuNorm,
      qty,
      fromLocationCode: location,
    });
  }

  async function confirmSaleFromLocation() {
    if (!saleSourceSelected) return;
    setSaleBusy(true);
    setError(null);
    try {
      if (saleLocationPick) {
        setSaleQueue((prev) =>
          prev.map((line) =>
            line.id === saleLocationPick.lineId ? { ...line, fromLocationCode: saleSourceSelected } : line,
          ),
        );
        setSaleSourceOpen(false);
        setSaleSourceSelected(null);
        const pick = saleLocationPick;
        setSaleLocationPick(null);
        await submitSaleBatch([
          ...saleQueue.map((line) =>
            line.id === pick.lineId ? { ...line, fromLocationCode: saleSourceSelected } : line,
          ),
        ]);
        return;
      }
      if (!sku.trim()) return;
      await postSaleOrMovement({
        movementType: (operationMode === "SALE_FINALIZE" ? "SALE_FINALIZE" : "MOVE_TO_SALE") as MovementType,
        sku,
        qty,
        fromLocationCode: saleSourceSelected,
      });
    } finally {
      setSaleBusy(false);
    }
  }

  const submitSaleBatch = useCallback(
    async (queueOverride?: SaleQueueLine[]) => {
      const working = queueOverride ?? saleQueue;
      if (working.length === 0) {
        setError("Dodaj produkty do listy sprzedazy.");
        return;
      }

      setError(null);
      setMessage(null);

      const resolved: SaleQueueLine[] = [];
      for (const line of working) {
        if (!line.sku) {
          resolved.push(line);
          continue;
        }
        const resolution = resolveSaleLineLocation(line, stock, locations);
        if (resolution.status === "missing") {
          setError(resolution.message);
          return;
        }
        if (resolution.status === "choice") {
          setSaleLocationPick({
            lineId: line.id,
            sku: line.sku,
            qty: line.qty,
            options: resolution.options,
          });
          setSaleSourceOptions(resolution.options);
          setSaleSourceSelected(null);
          setSaleSourceOpen(true);
          return;
        }
        resolved.push({ ...line, fromLocationCode: resolution.fromLocationCode });
      }

      setSaleSubmitBusy(true);
      try {
        const form = new FormData();
        const items = resolved.map((line) => ({
          sku: line.sku,
          qty: line.qty,
          fromLocationCode: line.fromLocationCode,
          note: line.note,
          clientKey: salePhotoFilesRef.current.has(line.id) ? line.id : undefined,
        }));
        form.append("payload", JSON.stringify({ items }));
        for (const line of resolved) {
          const file = salePhotoFilesRef.current.get(line.id);
          if (file) form.append(line.id, file);
        }

        const response = await fetch("/api/sales", { method: "POST", body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(typeof data.error === "string" ? data.error : "Nie udalo sie zapisac sprzedazy.");
          return;
        }

        setSaleQueue([]);
        salePhotoFilesRef.current.clear();
        addSkuOccurrenceRef.current.clear();
        setSku("");
        setSaleSourceOpen(false);
        setSaleLocationPick(null);
        setMessage("Sprzedaz zapisana — zdjeto ze stanu i dodano do historii.");
        playOperationSuccess("MOVE_TO_SALE");
        await loadData();
      } finally {
        setSaleSubmitBusy(false);
      }
    },
    [locations, saleQueue, stock],
  );

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.replace("/login");
  }

  const stopScanner = useCallback(() => {
    scanLoopStopRef.current = true;
    scanControlsRef.current?.stop();
    scanControlsRef.current = null;
    scanStreamRef.current?.getTracks().forEach((track) => track.stop());
    scanStreamRef.current = null;
    if (videoRef.current) {
      BrowserMultiFormatReader.cleanVideoSource(videoRef.current);
    }
    scanReaderRef.current = null;
    videoTrackRef.current = null;
    zoomRangeRef.current = null;
    setScannerOpen(false);
    setScannerStatus(null);
    setTorchSupported(false);
    setTorchOn(false);
    setZoomSupported(false);
    setZoom(1);
  }, []);

  async function applyVideoEnhancements(track: MediaStreamTrack) {
    videoTrackRef.current = track;
    const caps = track.getCapabilities?.() as MediaTrackCapabilities & {
      torch?: boolean;
      zoom?: { min: number; max: number; step?: number };
    };

    const zoomCaps = caps?.zoom;
    if (zoomCaps && typeof zoomCaps.min === "number" && typeof zoomCaps.max === "number") {
      const step = typeof zoomCaps.step === "number" && zoomCaps.step > 0 ? zoomCaps.step : 0.1;
      zoomRangeRef.current = { min: zoomCaps.min, max: zoomCaps.max, step };
      setZoomSupported(true);
      const initial = Math.min(zoomCaps.max, Math.max(zoomCaps.min, scanProfileRef.current.initialZoom));
      try {
        await track.applyConstraints({ advanced: [{ zoom: initial } as MediaTrackConstraintSet] });
        setZoom(Number(initial.toFixed(2)));
      } catch {
        // ignore
      }
    } else {
      zoomRangeRef.current = null;
      setZoomSupported(false);
      setZoom(1);
    }

    // Torch support is device/browser specific — prefer ZXing helper over raw capability flags.
    setTorchSupported(BrowserMultiFormatReader.mediaStreamIsTorchCompatibleTrack(track));
    if (!BrowserMultiFormatReader.mediaStreamIsTorchCompatibleTrack(track)) {
      setTorchOn(false);
    }
  }

  async function setZoomLevel(nextZoom: number) {
    const track = videoTrackRef.current;
    const range = zoomRangeRef.current;
    if (!track || !range) return;
    const clamped = Math.min(range.max, Math.max(range.min, nextZoom));
    try {
      await track.applyConstraints({ advanced: [{ zoom: clamped } as MediaTrackConstraintSet] });
      setZoom(Number(clamped.toFixed(2)));
    } catch {
      // ignore
    }
  }

  async function toggleTorch() {
    const track = videoTrackRef.current;
    if (!track) return;
    try {
      const next = !torchOn;
      await BrowserMultiFormatReader.mediaStreamSetTorch(track, next);
      setTorchOn(next);
    } catch {
      // ignore
    }
  }

  const removeAddQueueLine = useCallback((skuNorm: string) => {
    setAddQueue((prev) => prev.filter((row) => row.sku !== skuNorm));
    addSkuOccurrenceRef.current.delete(skuNorm);
  }, []);

  const removeReconcileQueueLine = useCallback((skuNorm: string) => {
    setReconcileQueue((prev) => prev.filter((row) => row.sku !== skuNorm));
    addSkuOccurrenceRef.current.delete(skuNorm);
  }, []);

  const setReconcileQueueLineQty = useCallback((skuNorm: string, nextQty: number) => {
    const q = Math.max(1, Math.floor(nextQty));
    setReconcileQueue((prev) => prev.map((row) => (row.sku === skuNorm ? { ...row, qty: q } : row)));
  }, []);

  const clearCurrentScanSession = useCallback(() => {
    const hasQueue =
      (operationMode === "ADD" && addQueue.length > 0) ||
      (operationMode === "RECONCILE" && reconcileQueue.length > 0) ||
      (operationMode === "MOVE" && moveQueue.length > 0) ||
      (operationMode === "RESTORE_FROM_TMP" && restoreQueue.length > 0) ||
      ((operationMode === "MOVE_TO_SALE" || operationMode === "SALE_FINALIZE") && saleQueue.length > 0);
    if (
      hasQueue &&
      !window.confirm("Wyczyscic wszystkie zeskanowane kody i zaczac od nowa? Lokalizacje rowniez zostana zresetowane.")
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    if (operationMode === "ADD") {
      setAddQueue([]);
          addSkuOccurrenceRef.current.clear();
      setAddModelLocationHints([]);
      setActiveLocationCode(null);
      setToLocationCode("");
      setSku("");
    } else if (operationMode === "RECONCILE") {
      setReconcileQueue([]);
          addSkuOccurrenceRef.current.clear();
      setActiveLocationCode(null);
      setToLocationCode("");
      setSku("");
    } else if (operationMode === "RESTORE_FROM_TMP") {
      setRestoreQueue([]);
      setRestoreNoLocationSku(null);
      setRestoreAssignSku(null);
      addSkuOccurrenceRef.current.clear();
      setSku("");
    } else if (operationMode === "MOVE") {
      setMoveQueue([]);
      setFromLocationCode("");
      setToLocationCode("");
      setActiveLocationCode(null);
      setMoveTargetOpen(false);
      setMoveTargetSelectedCode(null);
    } else if (operationMode === "MOVE_TO_SALE" || operationMode === "SALE_FINALIZE") {
      setSaleQueue([]);
      salePhotoFilesRef.current.clear();
      addSkuOccurrenceRef.current.clear();
      setSku("");
      setSaleLocationPick(null);
    }
    setScannerStatus(hasQueue ? "Lista wyczyszczona — mozesz skanowac od nowa." : null);
  }, [addQueue.length, reconcileQueue.length, moveQueue.length, operationMode, restoreQueue.length, saleQueue.length]);

  const handlePreviewProductScan = useCallback(
    (skuNormRaw: string) => {
      const skuNorm = skuNormRaw.trim().toUpperCase();
      if (!skuNorm) return;
      beginScanCooldown();
      setPreviewHighlightSku(skuNorm);

      if (previewLocationCode) {
        const atLocation = stock.filter(
          (row) => row.locationCode.toUpperCase() === previewLocationCode && row.sku.toUpperCase() === skuNorm,
        );
        const qty = atLocation.reduce((sum, row) => sum + row.qty, 0);
        if (qty > 0) {
          setMessage(`${skuNorm} na ${previewLocationCode}: ${qty} szt.`);
          setScannerStatus("Produkt na lokalizacji — skanuj kolejny kod.");
        } else {
          setMessage(`${skuNorm} nie ma na ${previewLocationCode}.`);
          setScannerStatus("Brak tego SKU tutaj — zeskanuj inny produkt lub lokalizacje.");
        }
        return;
      }

      const rows = stock.filter((row) => row.sku.toUpperCase() === skuNorm && row.qty > 0);
      if (rows.length === 0) {
        setMessage(`Brak ${skuNorm} na stanie magazynowym.`);
        setScannerStatus("Brak stanu — zeskanuj lokalizacje lub inny produkt.");
        return;
      }

      const locationCodes = [...new Set(rows.map((row) => row.locationCode))];
      if (locationCodes.length === 1) {
        const code = locationCodes[0]!;
        setActiveLocationCode(code);
        setToLocationCode(code);
        setMessage(`Podglad ${code} — ${skuNorm} (${rows.reduce((s, r) => s + r.qty, 0)} szt.)`);
        setScannerStatus("Lokalizacja ustawiona ze skanu produktu.");
        return;
      }

      setMessage(`${skuNorm} jest na: ${locationCodes.join(", ")}. Wybierz lub zeskanuj lokalizacje.`);
      setScannerStatus("Wiele lokalizacji — wybierz wieszak z listy.");
    },
    [beginScanCooldown, previewLocationCode, stock],
  );

  const setAddQueueLineQty = useCallback((skuNorm: string, nextQty: number) => {
    const q = Math.max(1, Math.floor(nextQty));
    setAddQueue((prev) => prev.map((row) => (row.sku === skuNorm ? { ...row, qty: q } : row)));
  }, []);

  const handleScanText = useCallback(
    (text: string) => {
      if (Date.now() < scanCooldownUntilRef.current) return;

      const dedupeKey = text.replace(/\s+/g, "").trim();
      const now = Date.now();
      if (
        dedupeKey.length > 0 &&
        dedupeKey === lastScanDedupeKeyRef.current &&
        now - lastScanDedupeAtRef.current < SCAN_COOLDOWN_MS
      ) {
        return;
      }
      if (dedupeKey.length > 0) {
        lastScanDedupeKeyRef.current = dedupeKey;
        lastScanDedupeAtRef.current = now;
      }

      setError(null);

      if (looksLikeProductQr(text)) {
        const nextSku = extractSkuFromProductQr(text);
        if (!nextSku) {
          setScannerStatus("Kod QR produktu jest niepoprawny (brak parametru SKU).");
          return;
        }
        if (operationMode === "PREVIEW") {
          handlePreviewProductScan(nextSku);
          return;
        }
        if (applyProductSkuScan(nextSku)) {
          beginScanCooldown();
          return;
        }
        beginScanCooldown();
        setSku(nextSku);
        setMessage("SKU odczytane z kodu QR.");
        setScannerStatus("SKU odczytane — odczekaj na odliczanie, potem kolejny kod.");
        return;
      }

      const resolvedLocation = resolveLocationCodeFromScan(text);
      if (resolvedLocation) {
        if (restoreAssignSku) {
          completeRestoreAssignToAdd(restoreAssignSku.trim().toUpperCase(), resolvedLocation.trim().toUpperCase());
          stopScanner();
          setPendingUnknownLocationCode(null);
          beginScanCooldown();
          return;
        }
        if (operationMode === "MOVE") {
          const normalized = resolvedLocation.trim().toUpperCase();
          const currentFrom = fromLocationCode.trim().toUpperCase();
          if (!currentFrom || currentFrom === normalized) {
            setFromLocationCode(resolvedLocation);
            // w trybie MOVE pierwsza lokalizacja "przenosi się" na lewo (Z)
            if (!toLocationCode.trim()) setActiveLocationCode(null);
            setMessage(`Lokalizacja Z: ${resolvedLocation}`);
            setScannerStatus("Zrodlo ustawione. Zeskanuj produkty i lokalizacje DO.");
          } else {
            setToLocationCode(resolvedLocation);
            setActiveLocationCode(resolvedLocation);
            setMessage(`Lokalizacja DO: ${resolvedLocation}`);
            setScannerStatus("Lokalizacja docelowa ustawiona — mozesz zatwierdzic przeniesienie.");
          }
        } else if (operationMode === "PREVIEW") {
          setPreviewHighlightSku(null);
          setActiveLocationCode(resolvedLocation);
          setToLocationCode(resolvedLocation);
          setMessage(`Podglad lokalizacji: ${resolvedLocation}`);
          setScannerStatus("Zeskanuj produkt (QR) aby podswietlic pozycje na liscie.");
        } else {
          setActiveLocationCode(resolvedLocation);
          setToLocationCode(resolvedLocation);
          if (operationMode === "ADD" || operationMode === "RECONCILE") {
            setFromLocationCode("");
          }
          setMessage(`Aktywna lokalizacja: ${resolvedLocation}`);
          setScannerStatus("Lokalizacja ustawiona — kontynuuj skanowanie (np. kod QR produktu).");
        }
        setPendingUnknownLocationCode(null);
        beginScanCooldown();
        return;
      }

      const candidate = normalizeLocationScanToken(text);
      if (/^[A-Z0-9_-]{2,64}$/.test(candidate)) {
        setPendingUnknownLocationCode(candidate);
        setQuickLocationName(candidate);
        setMessage(`Nieznana lokalizacja: ${candidate}. Mozesz ja zdefiniowac (admin).`);
        setScannerStatus("Lokalizacja nie istnieje w bazie.");
        stopScanner();
        return;
      }

      if (looksLikeHttpUrl(text) && !looksLikeProductQr(text)) {
        setScannerStatus("To wyglada na link, ale nie ma parametru SKU=... Zeskanuj kod QR lokalizacji albo produktu.");
        return;
      }

      const plainSku = normalizeScannedSku(text);
      if (plainSku) {
        if (operationMode === "PREVIEW") {
          handlePreviewProductScan(plainSku);
          return;
        }
        if (restoreAssignSku) {
          setScannerStatus("Zeskanuj lokalizacje docelowa — nie produktu.");
          return;
        }
        if (applyProductSkuScan(plainSku)) {
          beginScanCooldown();
          return;
        }
        beginScanCooldown();
        setSku(plainSku);
        setMessage("SKU zapisane (tekst).");
        setScannerStatus("SKU zapisane — odczekaj na odliczanie, potem kolejny kod.");
        return;
      }

      setScannerStatus("Nie rozpoznano skanu. Uzyj kodu QR produktu (SKU=...) albo kodu lokalizacji.");
    },
    [
      applyProductSkuScan,
      beginScanCooldown,
      completeRestoreAssignToAdd,
      fromLocationCode,
      handlePreviewProductScan,
      operationMode,
      resolveLocationCodeFromScan,
      restoreAssignSku,
      stopScanner,
      toLocationCode,
    ],
  );

  async function openScanner() {
    try {
      unlockScanFeedback();
      scanLoopStopRef.current = false;
      let profile = getScanProfile(getInitialScanTier());
      scanProfileRef.current = profile;

      const startCamera = async () => {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: profile.cameraWidth },
              height: { ideal: profile.cameraHeight },
              frameRate: { ideal: profile.frameRate, max: 30 },
            },
            audio: false,
          });
        } catch {
          try {
            return await navigator.mediaDevices.getUserMedia({
              video: { facingMode: { ideal: "environment" } },
              audio: false,
            });
          } catch {
            return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
        }
      };

      const streamPromise = startCamera();
      setScannerOpen(true);
      setScannerStatus("Uruchamianie aparatu...");
      setZoomSupported(false);
      setTorchSupported(false);
      setTorchOn(false);

      const waitForVideoEl = () =>
        new Promise<HTMLVideoElement | null>((resolve) => {
          const startedAt = performance.now();
          const tick = () => {
            if (videoRef.current) {
              resolve(videoRef.current);
              return;
            }
            if (performance.now() - startedAt > 2500) {
              resolve(null);
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });

      let stream: MediaStream;
      try {
        stream = await streamPromise;
      } catch {
        setScannerStatus("Nie udalo sie uruchomic aparatu. Sprawdz uprawnienia kamery w ustawieniach telefonu.");
        return;
      }

      const video = await waitForVideoEl();
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        setScannerStatus("Brak podgladu kamery. Zamknij i sprobuj ponownie.");
        return;
      }

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
      if (profile.tryHarder) {
        hints.set(DecodeHintType.TRY_HARDER, true);
      }
      const reader = new BrowserMultiFormatReader(hints);
      scanReaderRef.current = reader;

      scanStreamRef.current = stream;
      const cameraTrack = stream.getVideoTracks()[0];
      if (cameraTrack) {
        try {
          cameraTrack.contentHint = "motion";
        } catch {
          // ignore
        }
      }
      BrowserMultiFormatReader.addVideoSource(video, stream);
      video.muted = true;
      video.playsInline = true;
      const played = await BrowserMultiFormatReader.tryPlayVideo(video);
      if (!played) {
        try {
          await video.play();
        } catch {
          setScannerStatus("Nie udalo sie uruchomic podgladu wideo. Dotknij ekranu i sprobuj ponownie.");
          return;
        }
      }

      const track = stream.getVideoTracks()[0] ?? null;
      if (track) {
        await applyVideoEnhancements(track);
      }

      if (!cropCanvasRef.current) {
        cropCanvasRef.current = document.createElement("canvas");
      }
      const cropCanvas = cropCanvasRef.current;
      const nativeDetector = createNativeQrDetector();
      let attemptIndex = 0;
      let busy = false;
      let timeoutId = 0;
      let rafId = 0;
      let slowStreak = 0;

      const scheduleNext = (delayMs: number) => {
        if (scanLoopStopRef.current) return;
        timeoutId = window.setTimeout(() => {
          rafId = window.requestAnimationFrame(() => {
            void runDecodeTick();
          });
        }, delayMs);
      };

      const maybeDowngrade = (elapsedMs: number) => {
        if (elapsedMs <= profile.slowTickMs) {
          slowStreak = Math.max(0, slowStreak - 1);
          return;
        }
        slowStreak += 1;
        if (slowStreak < 3) return;
        const nextTier = nextLowerScanTier(profile.tier);
        if (!nextTier) {
          slowStreak = 0;
          return;
        }
        profile = getScanProfile(nextTier);
        scanProfileRef.current = profile;
        slowStreak = 0;
        attemptIndex = 0;
      };

      const runDecodeTick = async () => {
        if (scanLoopStopRef.current || busy) return;
        if (Date.now() < scanCooldownUntilRef.current) {
          scheduleNext(80);
          return;
        }
        const readerInstance = scanReaderRef.current;
        const videoEl = videoRef.current;
        if (!readerInstance || !videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) {
          scheduleNext(60);
          return;
        }

        busy = true;
        const started = performance.now();
        try {
          let text: string | null = null;
          const tries = Math.max(1, profile.attemptsPerTick);

          if (nativeDetector && profile.useNativeFullFrame) {
            try {
              const fromVideo = await nativeDetector.detect(videoEl);
              text = fromVideo[0]?.rawValue ?? null;
            } catch {
              text = null;
            }
          }

          for (let i = 0; i < tries && !text; i += 1) {
            const attempt = profile.attempts[attemptIndex % profile.attempts.length]!;
            attemptIndex += 1;
            drawVideoRoi(videoEl, cropCanvas, attempt.roi, attempt.decodePx, {
              contrastBoost: attempt.contrastBoost,
              sharpUpscale: attempt.sharpUpscale,
            });
            if (nativeDetector) {
              try {
                const fromCrop = await nativeDetector.detect(cropCanvas);
                text = fromCrop[0]?.rawValue ?? null;
              } catch {
                text = null;
              }
            }
            if (!text) {
              text = decodeQrCanvas(readerInstance, cropCanvas);
            }
          }

          if (text) {
            handleScanTextRef.current(text);
          }
        } finally {
          busy = false;
          const elapsed = performance.now() - started;
          maybeDowngrade(elapsed);
          scheduleNext(Math.max(profile.pauseMs, profile.tier === "low" ? elapsed : Math.min(profile.pauseMs + 40, elapsed * 0.35)));
        }
      };

      scanDecodeIntervalRef.current = 1;
      scanControlsRef.current = {
        stop: () => {
          scanLoopStopRef.current = true;
          if (timeoutId) window.clearTimeout(timeoutId);
          if (rafId) window.cancelAnimationFrame(rafId);
          scanDecodeIntervalRef.current = null;
        },
      };
      scheduleNext(40);

      setScannerStatus(
        "Nakieruj kod na srodek ramki. Dzwiek skanu zalezy od glosnosci mediow telefonu.",
      );
    } catch {
      setScannerStatus("Nie udalo sie uruchomic aparatu. Sprawdz uprawnienia kamery.");
      stopScanner();
    }
  }

  async function createQuickLocation(event: FormEvent) {
    event.preventDefault();
    if (!pendingUnknownLocationCode) return;
    setError(null);
    setMessage(null);
    const response = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: pendingUnknownLocationCode,
        name: quickLocationName || pendingUnknownLocationCode,
        parentZone: quickLocationZone,
        locationType: quickLocationType,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Nie udalo sie dodac lokalizacji.");
      return;
    }
    setActiveLocationCode(pendingUnknownLocationCode);
    setPendingUnknownLocationCode(null);
    setMessage(`Dodano lokalizacje i ustawiono jako aktywna: ${data.item.code}`);
    await loadData();
  }

  async function createManualLocation(event: FormEvent) {
    event.preventDefault();
    const code = manualLocCode.trim().toUpperCase();
    if (!code) return;
    setManualLocBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name: manualLocName.trim() || code,
          parentZone: manualLocZone,
          locationType: manualLocType,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Nie udalo sie dodac lokalizacji.");
        return;
      }
      setActiveLocationCode(data.item.code);
      setManualLocationOpen(false);
      setManualLocCode("");
      setManualLocName("");
      setMessage(`Dodano lokalizacje: ${data.item.code}`);
      await loadData();
    } finally {
      setManualLocBusy(false);
    }
  }

  const onMovementTileKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, tileType: OperationMode) => {
      const keys = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"];
      if (!keys.includes(e.key)) return;
      const len = movementPresets.length;
      const i = movementPresets.indexOf(tileType);
      if (i < 0) return;
      let next = i;
      if (e.key === "ArrowRight") next = Math.min(len - 1, i + 1);
      else if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
      else if (e.key === "ArrowDown") next = i < 3 ? Math.min(4, 3 + Math.min(i, 1)) : Math.min(len - 1, i + 2);
      else if (e.key === "ArrowUp") next = i >= 5 ? i - 2 : i >= 3 ? Math.min(2, i - 3) : i;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = len - 1;
      if (next === i) return;
      e.preventDefault();
      const nextType = movementPresets[next];
      changeOperationMode(nextType);
      requestAnimationFrame(() => {
        movementGridRef.current?.querySelector<HTMLElement>(`[data-movement-tile="${nextType}"]`)?.focus();
      });
    },
    [changeOperationMode],
  );

  useEffect(() => {
    handleScanTextRef.current = handleScanText;
  }, [handleScanText]);

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (reconcileConfirmOpen) {
        e.preventDefault();
        setReconcileConfirmOpen(false);
        return;
      }
      if (moveConfirmOpen) {
        e.preventDefault();
        setMoveConfirmOpen(false);
        return;
      }
      if (scannerOpen) {
        e.preventDefault();
        stopScanner();
        return;
      }
      if (moveTargetOpen) {
        e.preventDefault();
        setMoveTargetOpen(false);
        return;
      }
      if (pendingUnknownLocationCode) {
        e.preventDefault();
        setPendingUnknownLocationCode(null);
        return;
      }
      if (manualLocationOpen) {
        e.preventDefault();
        setManualLocationOpen(false);
        return;
      }
      if (stockOpen) {
        e.preventDefault();
        setStockOpen(false);
        return;
      }
      if (settingsOpen) {
        e.preventDefault();
        setSettingsOpen(false);
        return;
      }
      if (adminOpen) {
        e.preventDefault();
        setAdminOpen(false);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    adminOpen,
    manualLocationOpen,
    moveConfirmOpen,
    moveTargetOpen,
    pendingUnknownLocationCode,
    reconcileConfirmOpen,
    scannerOpen,
    settingsOpen,
    stockOpen,
    stopScanner,
  ]);

  useEffect(() => {
    return () => {
      scanLoopStopRef.current = true;
      scanControlsRef.current?.stop();
      scanControlsRef.current = null;
      if (scanDecodeIntervalRef.current != null) {
        window.clearInterval(scanDecodeIntervalRef.current);
        scanDecodeIntervalRef.current = null;
      }
      scanStreamRef.current?.getTracks().forEach((track) => track.stop());
      scanStreamRef.current = null;
      // Na unmount potrzebujemy aktualnego elementu wideo (ref mogl wskazywac inny wezel niz przy mount).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const videoEl = videoRef.current;
      if (videoEl) {
        BrowserMultiFormatReader.cleanVideoSource(videoEl);
      }
    };
  }, []);

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-blue-50 px-4 text-blue-800">
        <p className="text-sm">Wczytywanie...</p>
      </main>
    );
  }

  return (
    <main
      className="relative min-h-dvh w-full min-w-0 bg-gradient-to-b from-blue-100 to-blue-50 pb-[calc(6rem+env(safe-area-inset-bottom))] text-blue-950"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      {operationMode === "MOVE" && fromLocationCode.trim() ? (
        <button
          type="button"
          className="fixed z-50 flex h-11 min-w-[2.75rem] max-w-[min(42vw,11rem)] items-center justify-center gap-1 rounded-xl border-2 border-blue-800 bg-white px-3 font-mono text-base font-bold tabular-nums tracking-tight text-blue-950 shadow-md ring-1 ring-blue-200/80"
          style={{
            top: "max(0.5rem, env(safe-area-inset-top))",
            left: "max(0.5rem, env(safe-area-inset-left))",
          }}
          onClick={() => setFromLocationCode("")}
          title="Kliknij, aby wyczyscic lokalizacje Z"
        >
          <span className="shrink-0 text-xs text-blue-600">Z</span>
          <span className="truncate">{fromLocationCode.trim().toUpperCase()}</span>
          <span className="shrink-0 text-sm font-semibold text-blue-400" aria-hidden>
            ×
          </span>
        </button>
      ) : null}

      {(operationMode === "MOVE" ? toLocationCode.trim() : activeLocationCode) ? (
        <button
          type="button"
          className="fixed z-50 flex h-11 min-w-[2.75rem] max-w-[min(42vw,11rem)] items-center justify-center gap-1 rounded-xl border-2 border-blue-800 bg-white px-3 font-mono text-base font-bold tabular-nums tracking-tight text-blue-950 shadow-md ring-1 ring-blue-200/80"
          style={{
            top: "max(0.5rem, env(safe-area-inset-top))",
            right: "max(0.5rem, env(safe-area-inset-right))",
          }}
          onClick={() => {
            if (operationMode === "MOVE") {
              setToLocationCode("");
              setActiveLocationCode(null);
            } else {
              setActiveLocationCode(null);
              setToLocationCode("");
            }
          }}
          title={operationMode === "MOVE" ? "Kliknij, aby wyczyscic lokalizacje DO" : "Kliknij, aby wyczyscic aktywna lokalizacje"}
        >
          {operationMode === "MOVE" ? <span className="shrink-0 text-xs text-blue-600">DO</span> : null}
          <span className="truncate">
            {(operationMode === "MOVE" ? toLocationCode.trim() : activeLocationCode) ?? ""}
          </span>
          <span className="shrink-0 text-sm font-semibold text-blue-400" aria-hidden>
            ×
          </span>
        </button>
      ) : null}

      <div
        className={`mx-auto w-full min-w-0 max-w-3xl px-3 pb-28 pt-2 ${activeLocationCode ? "pt-1 sm:pr-[min(12rem,30vw)]" : ""}`}
      >
        {ready ? (
          <>
            <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-blue-600">
              Wybierz operacje
            </p>
            <div ref={movementGridRef} className="space-y-3" role="radiogroup" aria-label="Operacje magazynowe">
              {operationGroups.map((group) => (
                <section key={group.title}>
                  <p className="mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-500">
                    {group.title}
                  </p>
                  <div className={`grid gap-2 ${group.cols === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                    {group.types.map((type) => {
                      const active = operationMode === type;
                      const visual = operationVisuals[type];
                      const compact = group.cols === 3;
                      return (
                        <button
                          key={type}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          data-movement-tile={type}
                          tabIndex={active ? 0 : -1}
                          className={`flex flex-col items-center justify-center rounded-2xl border-2 text-center shadow-sm transition active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            compact
                              ? "min-h-[6.25rem] px-1.5 py-2.5 sm:min-h-[6.75rem] sm:px-3"
                              : "min-h-[6.25rem] px-3 py-3 sm:min-h-[6.75rem] sm:px-4"
                          } ${active ? visual.activeClass : `${visual.idleClass} hover:border-blue-400/80 hover:shadow`}`}
                          onClick={() => {
                            changeOperationMode(type);
                            requestAnimationFrame(() => {
                              movementGridRef.current
                                ?.querySelector<HTMLElement>(`[data-movement-tile="${type}"]`)
                                ?.focus();
                            });
                          }}
                          onKeyDown={(e) => onMovementTileKeyDown(e, type)}
                        >
                          <MovementIcon type={type} active={active} size={compact ? "sm" : "md"} />
                          <span
                            className={`mt-1.5 font-bold leading-tight text-blue-950 ${
                              compact ? "text-[11px] sm:text-sm" : "text-sm sm:text-base"
                            }`}
                          >
                            {movementTileLabels[type]}
                          </span>
                          <span
                            className={`mt-0.5 line-clamp-2 font-normal leading-snug text-blue-600/90 ${
                              compact ? "text-[9px] sm:text-[10px]" : "text-[10px] sm:text-[11px]"
                            }`}
                          >
                            {movementLabels[type]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            {error ? (
              <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}
            {message ? (
              <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
            ) : null}

            {userRole === "ADMIN" ? (
              <button
                type="button"
                className="mt-3 w-full rounded-2xl border-2 border-emerald-600/90 bg-emerald-50 py-3 text-sm font-bold text-emerald-950 shadow-sm transition active:scale-[0.99]"
                onClick={() => {
                  setManualLocationOpen(true);
                  setManualLocCode("");
                  setManualLocName("");
                  setManualLocZone("SKLEP");
                  setManualLocType("DISPLAY");
                }}
              >
                Nowa lokalizacja
              </button>
            ) : null}

            {operationMode === "MOVE" ? (
              <section className="mt-4 rounded-2xl border-2 border-blue-300/80 bg-white p-4 shadow-md">
                <p className="text-sm font-semibold text-blue-900">Przenoszenie — kolejka</p>
                <p className="mt-1 text-xs text-blue-700">
                  1) Zeskanuj lokalizacje Z (zrodlo), potem DO (cel). 2) Zaznacz modele na liscie albo skanuj
                  pojedyncze produkty. 3) Zatwierdz przeniesienie.
                </p>
                <p className="mt-3 text-sm text-blue-800">
                  Z lokalizacji:{" "}
                  <strong className="text-base">{moveSourceLocationCode || "— zeskanuj Z —"}</strong>
                  {moveTargetLocationCode ? (
                    <>
                      {" "}
                      → <strong className="text-base">{moveTargetLocationCode}</strong>
                    </>
                  ) : null}
                </p>
                <MoveModelPicker
                  sourceLocationCode={moveSourceLocationCode}
                  stockRows={moveSourceLocationStock}
                  moveQueue={moveQueue}
                  onToggleModel={toggleMoveModel}
                  onSelectAll={selectAllMoveModels}
                  onClearSelection={clearMoveModelSelection}
                />
                <ScanQueuePanel
                  queue={moveQueue}
                  tone="blue"
                  emptyHint="Brak pozycji — zaznacz model powyzej lub zeskanuj produkty."
                  onClear={clearCurrentScanSession}
                  onAdjustQty={setMoveQueueLineQty}
                  onRemove={removeMoveQueueLine}
                  stock={stock}
                  activeLocationCode={moveSourceLocationCode || null}
                  showStock
                />
                <button
                  type="button"
                  className="mt-4 w-full rounded-2xl bg-blue-800 py-3.5 text-sm font-bold text-white shadow-md active:scale-[0.99] disabled:opacity-50"
                  disabled={
                    !moveSourceLocationCode ||
                    moveQueue.length === 0 ||
                    (!moveTargetLocationCode && moveDestinationLocations.length === 0)
                  }
                  onClick={() => void openMoveTargetLayer()}
                >
                  {moveTargetLocationCode
                    ? `Przenies wybrane produkty (${moveSourceLocationCode} → ${moveTargetLocationCode})`
                    : "Przenies wybrane produkty"}
                </button>
                <button
                  type="button"
                  className="mt-2 w-full rounded-2xl border-2 border-blue-700 bg-white py-3.5 text-sm font-bold text-blue-900 shadow-sm active:scale-[0.99] disabled:opacity-50"
                  disabled={
                    !moveSourceLocationCode ||
                    moveSourceLocationStock.length === 0 ||
                    (!moveTargetLocationCode && moveDestinationLocations.length === 0)
                  }
                  onClick={() => void openMoveEntireLocationLayer()}
                >
                  {moveTargetLocationCode
                    ? `Przenies cala lokalizacje (${moveSourceLocationCode} → ${moveTargetLocationCode})`
                    : "Przenies cala lokalizacje"}
                  {!moveTargetLocationCode && moveSourceLocationSummary.totalQty > 0
                    ? ` (${moveSourceLocationSummary.totalQty} szt., ${moveSourceLocationSummary.skuCount} poz.)`
                    : ""}
                </button>
              </section>
            ) : null}

            {operationMode === "ADD" ? (
              <section className="mt-4 rounded-2xl border-2 border-emerald-400/70 bg-white p-4 shadow-md">
                <p className="text-sm font-semibold text-blue-900">Dodaj stan — kolejka</p>
                <p className="mt-1 text-xs text-blue-700">
                  Ustaw lokalizacje docelowa (skan lub pole w „Dane ruchu”), potem skanuj produkty w aparacie bez
                  zamykania widoku. Toasty potwierdzaja kazdy skan.
                </p>
                <p className="mt-3 text-sm text-blue-800">
                  Lokalizacja:{" "}
                  <strong className="text-base">
                    {activeLocationCode ?? (toLocationCode.trim() ? toLocationCode : "— zeskanuj lub wybierz —")}
                  </strong>
                </p>
                <ScanQueuePanel
                  queue={addQueue}
                  tone="emerald"
                  emptyHint="Brak pozycji — zeskanuj pierwszy produkt."
                  onClear={clearCurrentScanSession}
                  onAdjustQty={setAddQueueLineQty}
                  onRemove={removeAddQueueLine}
                />
                {showAddLocationHints && (addHintsLoading || addModelLocationHints.length > 0) ? (
                  <div className="mt-3 rounded-lg border border-dashed border-blue-300 bg-blue-50/80 p-3 transition-opacity duration-300">
                    <p className="text-xs font-medium text-blue-700">
                      Podpowiedz — gdzie ten model juz lezy (opcjonalnie, nie wybiera za Ciebie)
                    </p>
                    {addHintsLoading ? (
                      <p className="mt-2 text-sm text-blue-600">Ladowanie lokalizacji...</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {addModelLocationHints.map((hint) => (
                          <button
                            key={hint.locationCode}
                            type="button"
                            className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-900 shadow-sm active:bg-blue-100"
                            onClick={() => applyAddLocationHint(hint.locationCode)}
                          >
                            {hint.locationCode}
                            {hint.locationName ? (
                              <span className="ml-1 font-normal text-blue-700">— {hint.locationName}</span>
                            ) : null}
                            <span className="ml-1 text-blue-600">({hint.qty} szt.)</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}

            {operationMode === "RECONCILE" ? (
              <section className="mt-4 rounded-2xl border-2 border-teal-400/70 bg-white p-4 shadow-md">
                <p className="text-sm font-semibold text-teal-950">Aktualizuj stan lokalizacji</p>
                <p className="mt-1 text-xs text-teal-800">
                  1) Wybierz lub zeskanuj lokalizacje. 2) Zeskanuj produkty od lewej do prawej. 3) Zapisz — nadpisze
                  stan (takze gdy lokalizacja byla pusta) i kolejnosc modeli.
                </p>
                <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-teal-700">
                  Lokalizacja
                </label>
                <select
                  className="mt-1 w-full rounded-2xl border border-teal-200 bg-white p-3 text-sm font-semibold text-blue-950"
                  value={(activeLocationCode ?? toLocationCode).trim().toUpperCase()}
                  onChange={(e) => {
                    const code = e.target.value;
                    setActiveLocationCode(code || null);
                    setToLocationCode(code);
                  }}
                >
                  <option value="">— wybierz lub zeskanuj wieszak —</option>
                  {locations
                    .filter((loc) => loc.isActive)
                    .map((loc) => (
                      <option key={loc.code} value={loc.code}>
                        {loc.code} — {loc.name}
                      </option>
                    ))}
                </select>
                <ScanQueuePanel
                  queue={reconcileQueue}
                  tone="emerald"
                  emptyHint="Brak pozycji — zacznij skanowac produkty na wieszaku."
                  onClear={clearCurrentScanSession}
                  onAdjustQty={setReconcileQueueLineQty}
                  onRemove={removeReconcileQueueLine}
                />
                <button
                  type="button"
                  className="mt-4 w-full rounded-2xl bg-teal-700 py-3.5 text-sm font-bold text-white shadow-md active:scale-[0.99] disabled:opacity-50"
                  disabled={reconcileBusy || reconcileQueue.length === 0}
                  onClick={() => requestReconcileSave()}
                >
                  {reconcileBusy ? "Zapisywanie…" : "Zapisz aktualny stan lokalizacji"}
                </button>
              </section>
            ) : null}

            {operationMode === "REMOVE" ? (
              <section className="mt-4 rounded-2xl border-2 border-rose-400/70 bg-white p-4 shadow-md">
                <p className="text-sm font-semibold text-rose-950">Zdejmij stan</p>
                <p className="mt-1 text-xs text-rose-800">
                  Wybierz lokalizacje, potem zeskanuj produkt albo wybierz SKU z podpowiedzi. Kazde zatwierdzenie zdejmuje
                  1 sztuke ze stanu.
                </p>
                <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-rose-700">
                  Lokalizacja
                </label>
                <select
                  className="mt-1 w-full rounded-2xl border border-rose-200 bg-white p-3 text-sm font-semibold text-blue-950"
                  value={(fromLocationCode.trim() || activeLocationCode?.trim() || "").toUpperCase()}
                  onChange={(e) => {
                    const code = e.target.value;
                    setFromLocationCode(code);
                    setActiveLocationCode(code || null);
                  }}
                >
                  <option value="">— wybierz lub zeskanuj wieszak —</option>
                  {locations
                    .filter((loc) => loc.isActive)
                    .map((loc) => (
                      <option key={loc.code} value={loc.code}>
                        {loc.code} — {loc.name}
                      </option>
                    ))}
                </select>
                <SkuPickerEntry
                  stock={stock}
                  locationTypes={locationTypeMap}
                  locationCode={fromLocationCode.trim() || activeLocationCode?.trim() || ""}
                  emptyLocationHint="Najpierw wybierz lub zeskanuj lokalizacje."
                  tone="rose"
                  onPick={(skuNorm) => void submitManualRemove(skuNorm)}
                />
              </section>
            ) : null}

            {operationMode === "RESTORE_FROM_TMP" ? (
              <section className="mt-4 rounded-2xl border-2 border-cyan-400/70 bg-white p-4 shadow-md">
                <p className="text-sm font-semibold text-cyan-950">Przywroc z TMP</p>
                <p className="mt-1 text-xs text-cyan-800">
                  Zeskanuj produkty z tymczasowej lokalizacji — aplikacja podpowie, gdzie odlozyc je na wieszaku
                  (na podstawie innych rozmiarow tego samego modelu). Nie zmienia to stanu magazynowego.
                </p>
                <RestoreQueuePanel
                  queue={restoreQueue}
                  emptyHint="Brak pozycji — zeskanuj pierwszy produkt z TMP."
                  onClear={clearCurrentScanSession}
                  onAdjustQty={setRestoreQueueLineQty}
                  onRemove={removeRestoreQueueLine}
                  onOpenLocationPreview={openLocationPreview}
                />
              </section>
            ) : null}

            {operationMode === "MOVE_TO_SALE" || operationMode === "SALE_FINALIZE" ? (
              <section className="mt-4 rounded-2xl border-2 border-amber-400/70 bg-white p-4 shadow-md">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-amber-950">Sprzedaz — kolejka</p>
                    <p className="mt-1 text-xs text-amber-800">
                      Zeskanuj produkty albo wybierz SKU z podpowiedzi. Przy wielu lokalizacjach wybierz skad zdjac
                      (jak w picklist). Mozesz dodac zdjecie produktu bez kodu przed zapisem.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950"
                    onClick={() => setSaleHistoryOpen(true)}
                  >
                    Historia
                  </button>
                </div>
                <SkuPickerEntry
                  stock={stock}
                  locationTypes={locationTypeMap}
                  excludeDamaged
                  tone="amber"
                  onPick={(skuNorm) => {
                    if (applyProductSkuScan(skuNorm)) {
                      setMessage(`Dodano do listy sprzedazy: ${skuNorm}`);
                    }
                  }}
                />
                <SaleQueuePanel
                  queue={saleQueue}
                  onClear={clearCurrentScanSession}
                  onAdjustQty={(lineId, nextQty) => {
                    const q = Math.max(1, Math.floor(nextQty));
                    setSaleQueue((prev) =>
                      prev
                        .map((line) => (line.id === lineId ? { ...line, qty: q } : line))
                        .filter((line) => line.qty > 0),
                    );
                  }}
                  onRemove={(lineId) => {
                    setSaleQueue((prev) => prev.filter((line) => line.id !== lineId));
                    salePhotoFilesRef.current.delete(lineId);
                  }}
                  onAddPhotoItem={(file, note) => {
                    const id = crypto.randomUUID();
                    salePhotoFilesRef.current.set(id, file);
                    const preview = URL.createObjectURL(file);
                    setSaleQueue((prev) => [...prev, { id, qty: 1, note, photoPreview: preview }]);
                  }}
                  onUpdateNote={(lineId, note) => {
                    setSaleQueue((prev) => prev.map((line) => (line.id === lineId ? { ...line, note } : line)));
                  }}
                />
                <button
                  type="button"
                  className="mt-4 w-full rounded-2xl bg-amber-700 py-3.5 text-sm font-bold text-white shadow-md active:scale-[0.99] disabled:opacity-50"
                  disabled={saleSubmitBusy || saleQueue.length === 0}
                  onClick={() => void submitSaleBatch()}
                >
                  {saleSubmitBusy ? "Zapisywanie…" : "Zapisz sprzedaz"}
                </button>
              </section>
            ) : null}

            {operationMode === "PREVIEW" ? (
              <section className="mt-4 rounded-2xl border-2 border-indigo-400/70 bg-white p-4 shadow-md">
                <p className="text-sm font-semibold text-indigo-950">Podglad lokalizacji</p>
                <p className="mt-1 text-xs text-indigo-800">
                  Zeskanuj wieszak lub karton, potem produkt (QR) — podswietli pozycje na liscie. Mozesz tez wybrac
                  lokalizacje z listy albo wpisac kod produktu recznie.
                </p>
                <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-indigo-700">
                  Lokalizacja
                </label>
                <select
                  className="mt-1 w-full rounded-2xl border border-indigo-200 bg-white p-3 text-sm font-semibold text-blue-950"
                  value={previewLocationCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    setPreviewHighlightSku(null);
                    setPreviewFilterModels([]);
                    setActiveLocationCode(code || null);
                    setToLocationCode(code);
                  }}
                >
                  <option value="">— wybierz lub zeskanuj —</option>
                  {locations
                    .filter((loc) => loc.isActive)
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.code.localeCompare(b.code))
                    .map((loc) => (
                      <option key={loc.code} value={loc.code}>
                        {loc.code} — {loc.name}
                      </option>
                    ))}
                </select>
                <SkuPickerEntry
                  stock={stock}
                  locationTypes={locationTypeMap}
                  locationCode={previewLocationCode}
                  tone="indigo"
                  onPick={handlePreviewProductScan}
                  onSubmitQuery={(raw) => handlePreviewProductScan(normalizeScannedSku(raw))}
                />
                <LocationPreviewPanel
                  locationCode={previewLocationCode}
                  locationName={previewLocationMeta?.name}
                  stockRows={previewLocationStock}
                  locationTypes={locationTypeMap}
                  highlightSku={previewHighlightSku}
                  filterModels={previewFilterModels.length > 0 ? previewFilterModels : undefined}
                  onStockChanged={() => void loadData()}
                />
              </section>
            ) : null}

            <div className="mt-4 grid min-w-0 grid-cols-2 gap-3">
              <button
                type="button"
                className="rounded-2xl border border-blue-200 bg-white p-4 text-left shadow transition active:scale-[0.98]"
                onClick={() => setStockOpen(true)}
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <path d="M3.3 7 12 12l8.7-5M12 22V12" />
                  </svg>
                </span>
                <p className="mt-2 text-sm font-semibold text-blue-900">Stany</p>
                <p className="mt-1 text-xs text-blue-600">Lista / podglad</p>
              </button>
              <button
                type="button"
                className="rounded-2xl border border-blue-200 bg-white p-4 text-left shadow transition active:scale-[0.98]"
                onClick={() => setLocationOrderOpen(true)}
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-teal-800">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
                    <path d="M4 6h16M4 12h10M4 18h7" />
                    <path d="M19 10v10M15 16l4 4 4-4" />
                  </svg>
                </span>
                <p className="mt-2 text-sm font-semibold text-blue-900">Kolejnosc lok.</p>
                <p className="mt-1 text-xs text-blue-600">Drag & drop / picklista</p>
              </button>
              <button
                type="button"
                className="rounded-2xl border border-blue-200 bg-white p-4 text-left shadow transition active:scale-[0.98]"
                onClick={() => setSettingsOpen(true)}
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                  </svg>
                </span>
                <p className="mt-2 text-sm font-semibold text-blue-900">Konto</p>
                <p className="mt-1 text-xs text-blue-600">Haslo, sesja</p>
              </button>
              {userRole === "ADMIN" ? (
                <button
                  type="button"
                  className="rounded-2xl border border-blue-900 bg-blue-900 p-4 text-left text-white shadow transition active:scale-[0.98]"
                  onClick={() => setAdminOpen(true)}
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
                      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                    </svg>
                  </span>
                  <p className="mt-2 text-sm font-semibold">Admin</p>
                  <p className="mt-1 text-xs text-blue-200">Lokalizacje, operatorzy</p>
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-2xl border border-blue-200 bg-white p-4 text-left shadow transition active:scale-[0.98]"
                  onClick={logout}
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <path d="M16 17l5-5-5-5M21 12H9" />
                    </svg>
                  </span>
                  <p className="mt-2 text-sm font-semibold text-blue-900">Wyloguj</p>
                  <p className="mt-1 text-xs text-blue-600">Koniec sesji</p>
                </button>
              )}
            </div>
            {userRole === "ADMIN" ? (
              <button
                type="button"
                className="mt-3 w-full rounded-2xl border border-blue-200 bg-white py-3 text-sm font-semibold text-blue-800 shadow-sm"
                onClick={logout}
              >
                Wyloguj
              </button>
            ) : null}
          </>
        ) : (
          <section className="rounded-2xl bg-white p-6 shadow">
            <p className="text-center text-blue-800">Wczytywanie...</p>
          </section>
        )}
      </div>

      {ready ? (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className={`pointer-events-auto mb-1 flex w-full max-w-lg gap-2 rounded-2xl border-2 border-blue-200/95 bg-white/95 p-2.5 shadow-[0_-8px_40px_rgba(15,23,42,0.18)] backdrop-blur-md ${operationMode === "PREVIEW" || operationMode === "RESTORE_FROM_TMP" ? "justify-center" : ""}`}>
            <button
              type="button"
              className={`rounded-xl border-2 border-blue-950/25 bg-blue-700 py-3.5 text-sm font-bold text-white shadow-md ring-2 ring-blue-400/45 ring-offset-2 ring-offset-white active:scale-[0.98] ${operationMode === "PREVIEW" || operationMode === "RESTORE_FROM_TMP" ? "w-full" : "flex-1"}`}
              onClick={openScanner}
            >
              <span className="inline-flex items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4" aria-hidden>
                  <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                  <path d="M7 12h10" />
                </svg>
                Skanuj
              </span>
            </button>
            {operationMode !== "PREVIEW" && operationMode !== "RESTORE_FROM_TMP" ? (
            <button
              type="button"
              className="flex-1 rounded-xl border-2 border-blue-300/90 bg-white py-3.5 text-sm font-bold text-blue-900 shadow-sm active:scale-[0.98]"
              onClick={() => {
                setError(null);
                if (operationMode === "ADD" && addQueue.length > 0) {
                  void submitAddBatch();
                  return;
                }
                if (operationMode === "RECONCILE" && reconcileQueue.length > 0) {
                  requestReconcileSave();
                  return;
                }
                if (operationMode === "ADD" || operationMode === "RECONCILE") {
                  if (!activeLocationCode?.trim() && !toLocationCode.trim()) {
                    setError("Najpierw zeskanuj lub wybierz lokalizacje.");
                    return;
                  }
                  if (!sku.trim() && (operationMode === "ADD" ? addQueue.length === 0 : reconcileQueue.length === 0)) {
                    setError("Dodaj produkty do kolejki skanowaniem albo wpisz SKU.");
                    return;
                  }
                  if (operationMode === "ADD") void submitMovement();
                  return;
                }
                if (operationMode === "MOVE") {
                  void openMoveTargetLayer();
                  return;
                }
                if (operationMode === "MOVE_TO_SALE" || operationMode === "SALE_FINALIZE") {
                  if (saleQueue.length > 0) {
                    void submitSaleBatch();
                    return;
                  }
                  if (!sku.trim()) {
                    setMessage("Dodaj produkty do listy skanowaniem, wpisaniem recznym albo zdjeciem.");
                    return;
                  }
                }
                if (!sku.trim()) {
                  setMessage("Uzupelnij SKU i parametry ruchu, potem zapisz.");
                  return;
                }
                void submitMovement();
              }}
            >
              {operationMode === "MOVE" ? "Przenies…" : operationMode === "RECONCILE" ? "Aktualizuj…" : operationMode === "MOVE_TO_SALE" || operationMode === "SALE_FINALIZE" ? "Zapisz sprzedaz" : "Zapisz ruch"}
            </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {manualLocationOpen ? (
        <div className="fixed inset-0 z-[52] flex items-end justify-center bg-blue-950/55 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-blue-900">Nowa lokalizacja</h2>
              <button
                type="button"
                className="rounded-xl border border-blue-200 px-3 py-1.5 text-sm text-blue-900"
                onClick={() => setManualLocationOpen(false)}
              >
                Zamknij
              </button>
            </div>
            <p className="mt-2 text-sm text-blue-700">
              Dodaj wieszak lub miejsce w magazynie (tylko administrator). Kod musi byc unikalny.
            </p>
            <form className="mt-4 space-y-3" onSubmit={createManualLocation}>
              <input
                className="w-full rounded-2xl border border-blue-200 p-3 font-mono uppercase"
                placeholder="Kod (np. W12)"
                value={manualLocCode}
                onChange={(e) => setManualLocCode(e.target.value)}
                required
              />
              <input
                className="w-full rounded-2xl border border-blue-200 p-3"
                placeholder="Nazwa"
                value={manualLocName}
                onChange={(e) => setManualLocName(e.target.value)}
              />
              <select
                className="w-full rounded-2xl border border-blue-200 p-3"
                value={manualLocZone}
                onChange={(e) => {
                  const zone = e.target.value as "SKLEP" | "ZAPLECZE";
                  setManualLocZone(zone);
                  setManualLocType(defaultLocationTypeForZone(zone));
                }}
              >
                <option value="SKLEP">{zoneLabels.SKLEP}</option>
                <option value="ZAPLECZE">{zoneLabels.ZAPLECZE}</option>
              </select>
              <div>
                <select
                  className="w-full rounded-2xl border border-blue-200 p-3"
                  value={manualLocType}
                  onChange={(e) =>
                    setManualLocType(
                      e.target.value as
                        | "DISPLAY"
                        | "BUFFER"
                        | "RESERVED"
                        | "BACKROOM_BOX"
                        | "BACKROOM_SHELF"
                        | "INACTIVE",
                    )
                  }
                >
                  {(Object.keys(locationTypeLabels) as Array<keyof typeof locationTypeLabels>).map((type) => (
                    <option key={type} value={type}>
                      {formatLocationType(type)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-blue-600">
                  Typ opisuje przeznaczenie miejsca (wystawa, bufor, karton). Nie blokuje operacji — glownie do
                  porzadku i filtrow w przyszlosci.
                </p>
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <button
                type="submit"
                disabled={manualLocBusy}
                className="w-full rounded-2xl bg-emerald-700 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {manualLocBusy ? "Zapisywanie…" : "Dodaj lokalizacje"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-blue-950/55 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-blue-900">Konto</h2>
              <button
                type="button"
                className="rounded-xl border border-blue-200 px-3 py-1.5 text-sm text-blue-900"
                onClick={() => setSettingsOpen(false)}
              >
                Zamknij
              </button>
            </div>
            <p className="mt-2 text-sm text-blue-700">Ustawienia konta i zmiana hasla.</p>
            <Link
              href="/settings"
              className="mt-4 flex w-full items-center justify-center rounded-2xl bg-blue-700 py-3 text-sm font-semibold text-white"
              onClick={() => setSettingsOpen(false)}
            >
              Otworz panel konta
            </Link>
          </div>
        </div>
      ) : null}

      {adminOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-blue-950/55 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-blue-900">Administrator</h2>
              <button
                type="button"
                className="rounded-xl border border-blue-200 px-3 py-1.5 text-sm text-blue-900"
                onClick={() => setAdminOpen(false)}
              >
                Zamknij
              </button>
            </div>
            <p className="mt-2 text-sm text-blue-700">Lokalizacje, operatorzy, hasla.</p>
            <Link
              href="/admin"
              className="mt-4 flex w-full items-center justify-center rounded-2xl bg-blue-900 py-3 text-sm font-semibold text-white"
              onClick={() => setAdminOpen(false)}
            >
              Otworz panel admina
            </Link>
          </div>
        </div>
      ) : null}

      {moveTargetOpen ? (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-blue-950/60 p-3 sm:items-center">
          <div className="max-h-[min(92vh,880px)] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-blue-900">
                {moveTargetMode === "entire" ? "Dokad przeniesc cala lokalizacje?" : "Dokad przeniesc?"}
              </h2>
              <button
                type="button"
                className="rounded-xl border border-blue-200 px-3 py-1.5 text-sm text-blue-900"
                onClick={() => {
                  setMoveTargetOpen(false);
                  setMoveTargetMode("queue");
                }}
              >
                Zamknij
              </button>
            </div>
            <p className="mt-2 text-sm text-blue-800">
              {moveTargetMode === "entire" ? (
                <>
                  Cala zawartosc lokalizacji <strong>{moveSourceLocationCode}</strong>:{" "}
                  {moveSourceLocationSummary.totalQty} szt., {moveSourceLocationSummary.modelCount} modeli,{" "}
                  {moveSourceLocationSummary.skuCount} rozmiarow. Wybierz lokalizacje docelowa.
                </>
              ) : (
                <>
                  Wybrane produkty z lokalizacji <strong>{moveSourceLocationCode}</strong>. Przewijaj w poziomie — lista
                  powtarza sie w petli.
                </>
              )}
            </p>
            {moveTargetMode === "queue" ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-blue-900">
                {moveQueue.map((line) => (
                  <span key={line.sku} className="rounded-full bg-blue-100 px-2 py-1 font-mono">
                    {line.sku}×{line.qty}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-blue-600">Lokalizacja docelowa</p>
            <div
              ref={moveDestScrollRef}
              onScroll={onMoveDestScroll}
              className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-2 pt-1"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              <div ref={moveDestStripRef} className="flex w-max gap-3">
                {moveDestinationStripItems.map((item) => {
                  const selected = moveTargetSelectedCode === item.code;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setMoveTargetSelectedCode(item.code)}
                      className={`snap-center shrink-0 rounded-2xl border-2 px-5 py-6 text-center shadow-sm transition active:scale-[0.98] ${
                        selected
                          ? "border-blue-700 bg-white ring-2 ring-blue-400/70"
                          : "border-blue-200 bg-white/95 hover:border-blue-400"
                      } w-[30vw] max-w-[150px]`}
                    >
                      <span className="block text-lg font-bold text-blue-950">{item.code}</span>
                      <span className="mt-1 block text-[10px] leading-tight text-blue-600">{item.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="flex-1 rounded-2xl border border-blue-200 py-3 text-sm font-semibold text-blue-900"
                onClick={() => {
                  setMoveTargetOpen(false);
                  setMoveTargetMode("queue");
                }}
              >
                Anuluj
              </button>
              <button
                type="button"
                className="flex-1 rounded-2xl bg-blue-800 py-3 text-sm font-bold text-white disabled:opacity-50"
                disabled={!moveTargetSelectedCode || moveBatchBusy}
                onClick={() => void confirmMoveToTarget()}
              >
                {moveBatchBusy
                  ? "Zapisywanie…"
                  : moveTargetMode === "entire"
                    ? "Przenies cala lokalizacje"
                    : "Zatwierdz przeniesienie"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {restoreNoLocationSku ? (
        <div className="fixed inset-0 z-[56] flex items-end justify-center bg-cyan-950/55 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-cyan-950">Brak lokalizacji dla modelu</h2>
            <p className="mt-2 text-sm text-cyan-900">
              Dla produktu <span className="font-mono font-semibold">{restoreNoLocationSku}</span> (
              {parseSkuModel(restoreNoLocationSku).model}) nie znaleziono innych rozmiarow na lokalizacjach.
            </p>
            <p className="mt-2 text-sm text-cyan-800">Czy chcesz go dodac do jakiejs lokalizacji?</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="flex-1 rounded-2xl border border-cyan-200 py-3 text-sm font-semibold text-cyan-900"
                onClick={() => setRestoreNoLocationSku(null)}
              >
                Nie teraz
              </button>
              <button
                type="button"
                className="flex-1 rounded-2xl bg-cyan-700 py-3 text-sm font-bold text-white"
                onClick={() => {
                  beginRestoreAssignFlow(restoreNoLocationSku);
                  void openScanner();
                }}
              >
                Tak, zeskanuj lokalizacje
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saleSourceOpen ? (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-amber-950/55 p-3 sm:items-center">
          <div className="max-h-[min(92vh,720px)] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-amber-950">Z ktorej lokalizacji zdjac?</h2>
              <button
                type="button"
                className="rounded-xl border border-amber-200 px-3 py-1.5 text-sm text-amber-900"
                onClick={() => setSaleSourceOpen(false)}
              >
                Zamknij
              </button>
            </div>
            <p className="mt-2 text-sm text-amber-900">
              Ten rozmiar jest na kilku lokalizacjach. Sprzedaz zdejmie stan z wybranej lokalizacji.
            </p>
            <p className="mt-2 font-mono text-sm text-amber-950">{saleLocationPick?.sku ?? sku}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {saleSourceOptions.map((opt) => {
                const selected = saleSourceSelected === opt.locationCode;
                return (
                  <button
                    key={opt.locationCode}
                    type="button"
                    onClick={() => setSaleSourceSelected(opt.locationCode)}
                    className={`rounded-2xl border-2 px-3 py-4 text-center transition ${
                      selected
                        ? "border-amber-600 bg-amber-50 ring-2 ring-amber-400/70"
                        : "border-amber-200 bg-white hover:border-amber-400"
                    }`}
                  >
                    <span className="block text-lg font-bold text-amber-950">{opt.locationCode}</span>
                    <span className="mt-1 block text-xs text-amber-700">{opt.qty} szt.</span>
                  </button>
                );
              })}
            </div>
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="flex-1 rounded-2xl border border-amber-200 py-3 text-sm font-semibold text-amber-900"
                onClick={() => setSaleSourceOpen(false)}
              >
                Anuluj
              </button>
              <button
                type="button"
                className="flex-1 rounded-2xl bg-amber-700 py-3 text-sm font-bold text-white disabled:opacity-50"
                disabled={!saleSourceSelected || saleBusy}
                onClick={() => void confirmSaleFromLocation()}
              >
                {saleBusy ? "Zapisywanie…" : "Potwierdz sprzedaz"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addVerifyPrompt ? (
        <div className="fixed inset-0 z-[72] flex items-end justify-center bg-blue-950/60 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-emerald-900">Sprawdz stan modelu</h2>
            <p className="mt-3 text-sm leading-relaxed text-emerald-950">
              Na tej lokalizacji powinno byc teraz{" "}
              <strong>{addVerifyPrompt.expectedQty}</strong> produktow z modelu{" "}
              <span className="font-mono font-semibold">{addVerifyPrompt.model}</span> —{" "}
              <button
                type="button"
                className="font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
                onClick={() => {
                  const prompt = addVerifyPrompt;
                  setAddVerifyPrompt(null);
                  openLocationPreview(prompt.locationCode, [prompt.model]);
                }}
              >
                sprawdz
              </button>
            </p>
            <button
              type="button"
              className="mt-5 w-full rounded-2xl bg-emerald-700 py-3 text-sm font-bold text-white"
              onClick={() => setAddVerifyPrompt(null)}
            >
              OK
            </button>
          </div>
        </div>
      ) : null}

      {moveConfirmOpen ? (
        <div className="fixed inset-0 z-[72] flex items-end justify-center bg-blue-950/60 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-blue-900">
              {moveTargetMode === "entire" ? "Przeniesic cala lokalizacje?" : "Przeniesic produkty?"}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-blue-800">
              {moveTargetMode === "entire" ? (
                <>
                  Cala zawartosc z <strong>{moveSourceLocationCode}</strong> do{" "}
                  <strong>{moveTargetSelectedCode}</strong>: {moveSourceLocationSummary.totalQty} szt.,{" "}
                  {moveSourceLocationSummary.modelCount} modeli, {moveSourceLocationSummary.skuCount} rozmiarow.
                </>
              ) : (
                <>
                  {moveQueue.reduce((sum, line) => sum + line.qty, 0)} szt. ({moveQueue.length} poz.) z{" "}
                  <strong>{moveSourceLocationCode}</strong> do <strong>{moveTargetSelectedCode}</strong>.
                </>
              )}
            </p>
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="rounded-2xl border border-blue-200 py-3 text-sm font-bold text-blue-900"
                onClick={() => setMoveConfirmOpen(false)}
              >
                NIE
              </button>
              <button
                type="button"
                className="rounded-2xl bg-blue-800 py-3 text-sm font-bold text-white disabled:opacity-50"
                disabled={moveBatchBusy}
                onClick={() => void confirmMoveToTarget()}
              >
                {moveBatchBusy ? "Zapisywanie…" : "TAK, przenies"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reconcileConfirmOpen ? (
        <div className="fixed inset-0 z-[72] flex items-end justify-center bg-blue-950/60 p-3 sm:items-center">
          <div className="flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-xl">
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <h2 className="text-lg font-semibold text-blue-900">Nadpisac stan lokalizacji?</h2>
              <p className="mt-3 text-sm leading-relaxed text-blue-800">
                Ta operacja nadpisze aktualny stan lokalizacji{" "}
                <strong>{reconcileTargetLocationCode}</strong> nowym skanem (
                {reconcileQueue.reduce((sum, line) => sum + line.qty, 0)} szt. w{" "}
                {reconcileQueue.length} poz.). Kontynuowac?
              </p>

              <div className="mt-4 space-y-3 text-sm">
                <p className="font-semibold text-blue-900">Roznice wzgledem zapisanego stanu</p>

                {!reconcileDiffHasChanges(reconcileDiff) ? (
                  <p className="rounded-xl bg-blue-50 px-3 py-2 text-blue-800">
                    Brak roznic w SKU i ilosciach wzgledem zapisanego stanu.
                  </p>
                ) : null}

                {reconcileDiff.added.length > 0 ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2">
                    <p className="font-semibold text-emerald-900">
                      Nowe ({reconcileDiff.added.length})
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-800">Nie bylo wczesniej na tej lokalizacji</p>
                    <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto font-mono text-xs text-emerald-950">
                      {reconcileDiff.added.map((row) => (
                        <li key={row.sku} className="flex justify-between gap-2">
                          <span>{row.sku}</span>
                          <span className="shrink-0 tabular-nums">{row.qty} szt.</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {reconcileDiff.removed.length > 0 ? (
                  <div className="rounded-xl border border-red-200 bg-red-50/80 px-3 py-2">
                    <p className="font-semibold text-red-900">
                      Brakuje ({reconcileDiff.removed.length})
                    </p>
                    <p className="mt-0.5 text-xs text-red-800">Bylo zapisane, nie ma w nowym skanie</p>
                    <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto font-mono text-xs text-red-950">
                      {reconcileDiff.removed.map((row) => (
                        <li key={row.sku} className="flex justify-between gap-2">
                          <span>{row.sku}</span>
                          <span className="shrink-0 tabular-nums">{row.qty} szt.</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {reconcileDiff.qtyChanged.length > 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2">
                    <p className="font-semibold text-amber-950">
                      Zmiana ilosci ({reconcileDiff.qtyChanged.length})
                    </p>
                    <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto font-mono text-xs text-amber-950">
                      {reconcileDiff.qtyChanged.map((row) => (
                        <li key={row.sku} className="flex justify-between gap-2">
                          <span>{row.sku}</span>
                          <span className="shrink-0 tabular-nums">
                            {row.fromQty} → {row.toQty} szt.
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-blue-100 p-5">
              <button
                type="button"
                className="rounded-2xl border border-blue-200 py-3 text-sm font-bold text-blue-900"
                onClick={() => setReconcileConfirmOpen(false)}
              >
                NIE
              </button>
              <button
                type="button"
                className="rounded-2xl bg-teal-700 py-3 text-sm font-bold text-white disabled:opacity-50"
                disabled={reconcileBusy}
                onClick={() => void submitReconcileBatch()}
              >
                TAK, nadpisz
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stockOpen ? (
        <StockPanel
          stock={stock}
          locations={locations}
          onClose={() => setStockOpen(false)}
          onStockChanged={() => void loadData()}
        />
      ) : null}

      {saleHistoryOpen ? <SalesHistoryPanel onClose={() => setSaleHistoryOpen(false)} /> : null}

      {locationOrderOpen ? (
        <LocationOrderPanel
          locations={locations}
          onClose={() => setLocationOrderOpen(false)}
          onSaved={(items) => {
            // loadData odswieza pelna liste z API
            void loadData();
            void items;
          }}
        />
      ) : null}

      {pendingUnknownLocationCode ? (
        <div className="fixed inset-0 z-[56] flex items-end justify-center bg-blue-950/55 p-3 sm:items-center">
          <div className="w-full max-w-3xl rounded-3xl bg-amber-50 p-4 shadow-xl ring-1 ring-amber-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-amber-950">Nieznana lokalizacja</h3>
                <p className="mt-1 text-sm text-amber-900">Kod: {pendingUnknownLocationCode}</p>
              </div>
              <button
                type="button"
                className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-amber-950"
                onClick={() => setPendingUnknownLocationCode(null)}
              >
                Zamknij
              </button>
            </div>

            {userRole === "ADMIN" ? (
              <form className="mt-3 space-y-2" onSubmit={createQuickLocation}>
                <input
                  className="w-full rounded-2xl border border-amber-200 bg-white p-3"
                  placeholder="Nazwa lokalizacji"
                  value={quickLocationName}
                  onChange={(e) => setQuickLocationName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="rounded-2xl border border-amber-200 bg-white p-3"
                    value={quickLocationZone}
                    onChange={(e) => setQuickLocationZone(e.target.value as "SKLEP" | "ZAPLECZE")}
                  >
                    <option value="SKLEP">SKLEP</option>
                    <option value="ZAPLECZE">ZAPLECZE</option>
                  </select>
                  <select
                    className="rounded-2xl border border-amber-200 bg-white p-3"
                    value={quickLocationType}
                    onChange={(e) =>
                      setQuickLocationType(
                        e.target.value as
                          | "DISPLAY"
                          | "BUFFER"
                          | "RESERVED"
                          | "BACKROOM_BOX"
                          | "BACKROOM_SHELF"
                          | "INACTIVE",
                      )
                    }
                  >
                    <option value="DISPLAY">DISPLAY</option>
                    <option value="BUFFER">BUFFER</option>
                    <option value="RESERVED">RESERVED</option>
                    <option value="BACKROOM_BOX">BACKROOM_BOX</option>
                    <option value="BACKROOM_SHELF">BACKROOM_SHELF</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>
                <button className="w-full rounded-2xl bg-amber-700 p-3 font-semibold text-white" type="submit">
                  Zapisz nowa lokalizacje
                </button>
              </form>
            ) : (
              <p className="mt-3 text-sm text-amber-950">
                Popros administratora o dodanie lokalizacji albo uzyj listy w operacjach.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {scannerOpen ? (
        <div className="fixed inset-0 z-[60] flex flex-col bg-blue-950/95 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-white">Skaner kodu QR</h3>
            <div className="flex items-center gap-2">
              {(operationMode === "ADD" || operationMode === "RECONCILE" || operationMode === "MOVE") && activeScanTotals.totalPieces > 0 ? (
                <button
                  type="button"
                  className="rounded-xl border border-red-300/40 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-100"
                  onClick={clearCurrentScanSession}
                >
                  Wyczysc
                </button>
              ) : null}
              <button className="rounded-xl bg-white/15 px-3 py-2 text-sm text-white" onClick={stopScanner} type="button">
                Zamknij
              </button>
            </div>
          </div>

          <p className="mb-2 text-sm text-blue-100">{scannerStatus ?? "Nakieruj aparat na kod QR."}</p>

          <div className="relative flex-1 overflow-hidden rounded-3xl bg-black">
            <video
              ref={videoRef}
              className="h-full w-full object-contain"
              style={{ filter: "contrast(1.12) saturate(1.03) brightness(1.03)" }}
              muted
              playsInline
              autoPlay
              onPointerDown={() => unlockScanFeedback()}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`h-[52vmin] w-[52vmin] max-h-[380px] max-w-[380px] rounded-3xl border-[3px] shadow-[0_0_0_9999px_rgba(0,0,0,0.42)] transition ${
                  scanFlash ? "border-emerald-300 bg-emerald-400/25" : "border-white/90"
                }`}
              />
            </div>

            {scanCooldownMs > 0 ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-black/70 text-white shadow-xl ring-4 ring-emerald-400/80">
                  <span className="text-4xl font-black tabular-nums leading-none">
                    {(scanCooldownMs / 1000).toFixed(1)}
                  </span>
                  <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                    nastepny skan
                  </span>
                </div>
              </div>
            ) : null}

            {(operationMode === "ADD" || operationMode === "RECONCILE" || operationMode === "MOVE") && activeScanTotals.totalPieces > 0 ? (
              <div
                className="pointer-events-none absolute z-10 max-w-[min(72vw,16rem)]"
                style={{
                  top: "max(0.5rem, env(safe-area-inset-top))",
                  right: "max(0.5rem, env(safe-area-inset-right))",
                }}
              >
                <ScanTotalsBadge
                  totalPieces={activeScanTotals.totalPieces}
                  modelCount={activeScanTotals.modelCount}
                  compact
                  className="border-emerald-300/50 bg-emerald-500/90 text-black shadow-lg"
                />
              </div>
            ) : null}

            <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-[45px] w-[45px] shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15 text-lg font-bold text-white active:bg-white/25 disabled:opacity-40"
                  onClick={() => {
                    const range = zoomRangeRef.current;
                    if (!range) return;
                    void setZoomLevel(zoom - Math.max(range.step, 0.05) * 3);
                  }}
                  disabled={!zoomSupported}
                  aria-label="Zmniejsz zoom"
                >
                  −
                </button>
                <div className="rounded-xl bg-black/40 px-3 py-2 text-xs font-semibold text-white">
                  Zoom: {zoomSupported ? `${zoom.toFixed(2)}x` : "brak"}
                </div>
                <button
                  type="button"
                  className="inline-flex h-[45px] w-[45px] shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15 text-lg font-bold text-white active:bg-white/25 disabled:opacity-40"
                  onClick={() => {
                    const range = zoomRangeRef.current;
                    if (!range) return;
                    void setZoomLevel(zoom + Math.max(range.step, 0.05) * 3);
                  }}
                  disabled={!zoomSupported}
                  aria-label="Powieksz zoom"
                >
                  +
                </button>
              </div>

              {torchSupported ? (
                <button
                  type="button"
                  className="rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold text-white"
                  onClick={() => void toggleTorch()}
                >
                  Latarka: {torchOn ? "ON" : "OFF"}
                </button>
              ) : (
                <div className="rounded-xl bg-black/30 px-3 py-2 text-xs text-white/80">Latarka: niedostepna</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="pointer-events-none fixed left-1/2 z-[70] flex w-[min(92vw,22rem)] -translate-x-1/2 flex-col gap-2"
        style={{ top: "max(4.25rem, calc(env(safe-area-inset-top) + 3.25rem))" }}
        aria-live="polite"
      >
        {scanToasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border px-4 py-2.5 text-center font-mono text-sm font-semibold tracking-tight shadow-lg ${
              operationMode === "RESTORE_FROM_TMP"
                ? "border-cyan-800/35 bg-cyan-300 text-cyan-950"
                : "border-emerald-700/35 bg-emerald-400 text-black"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </main>
  );
}
