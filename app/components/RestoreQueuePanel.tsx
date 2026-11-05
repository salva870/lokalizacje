"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ModelProductImage } from "@/app/components/ModelProductImage";
import { summarizeScanQueue, parseSkuModel } from "@/lib/skuModel";
import { ScanTotalsBadge } from "@/app/components/ScanQueuePanel";

export type RestoreLocationHint = {
  locationCode: string;
  locationName: string | null;
  qty: number;
  variantCount: number;
};

export type RestoreQueueEntry = {
  sku: string;
  qty: number;
  loading?: boolean;
  model?: string;
  suggestedLocation?: string | null;
  suggestedLocationName?: string | null;
  locations?: RestoreLocationHint[];
};

type RestoreQueuePanelProps = {
  queue: RestoreQueueEntry[];
  emptyHint: string;
  onClear: () => void;
  onAdjustQty: (sku: string, qty: number) => void;
  onRemove: (sku: string) => void;
  onOpenLocationPreview?: (locationCode: string, models: string[]) => void;
};

type GuideModel = {
  model: string;
  scannedQty: number;
  lines: Array<{ sku: string; size: string; qty: number }>;
  expectedQty: number | null;
  otherLocations: RestoreLocationHint[];
};

type GuideStop = {
  key: string;
  locationCode: string | null;
  locationName: string | null;
  pieceCount: number;
  models: GuideModel[];
};

function modelOf(entry: RestoreQueueEntry): string {
  return (entry.model || parseSkuModel(entry.sku).model).trim().toUpperCase();
}

function expectedModelQty(entry: RestoreQueueEntry): number | null {
  const loc = entry.suggestedLocation?.trim().toUpperCase();
  if (!loc) return null;
  const here = entry.locations?.find((row) => row.locationCode.trim().toUpperCase() === loc);
  return here ? here.qty : null;
}

function buildGuideStops(queue: RestoreQueueEntry[]): GuideStop[] {
  const buckets = new Map<string, GuideStop>();

  for (const entry of queue) {
    const loc = entry.suggestedLocation?.trim().toUpperCase() || "";
    const key = loc || "__NONE__";
    let stop = buckets.get(key);
    if (!stop) {
      stop = {
        key,
        locationCode: loc || null,
        locationName: entry.suggestedLocationName ?? null,
        pieceCount: 0,
        models: [],
      };
      buckets.set(key, stop);
    }
    const model = modelOf(entry);
    const { size } = parseSkuModel(entry.sku);
    const qty = Math.max(1, Number(entry.qty) || 1);
    stop.pieceCount += qty;
    let modelRow = stop.models.find((row) => row.model === model);
    if (!modelRow) {
      const locations = entry.locations ?? [];
      const here = loc
        ? locations.find((row) => row.locationCode.trim().toUpperCase() === loc)
        : null;
      modelRow = {
        model,
        scannedQty: 0,
        lines: [],
        expectedQty: here ? here.qty : null,
        otherLocations: locations.filter((row) => row.locationCode.trim().toUpperCase() !== loc),
      };
      stop.models.push(modelRow);
    }
    modelRow.scannedQty += qty;
    const line = modelRow.lines.find((row) => row.sku === entry.sku);
    if (line) line.qty += qty;
    else modelRow.lines.push({ sku: entry.sku, size, qty });
  }

  const stops = [...buckets.values()];
  const known = stops.filter((stop) => stop.locationCode);
  const unknown = stops.filter((stop) => !stop.locationCode);
  return [...known, ...unknown];
}

export function RestoreQueuePanel({
  queue,
  emptyHint,
  onClear,
  onAdjustQty,
  onRemove,
  onOpenLocationPreview,
}: RestoreQueuePanelProps) {
  const totals = summarizeScanQueue(queue);
  const [guideIndex, setGuideIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const stops = useMemo(() => buildGuideStops(queue), [queue]);
  const guideOpen = guideIndex != null && stops.length > 0;
  const stop = guideOpen ? stops[Math.min(guideIndex!, stops.length - 1)] : null;
  const loading = queue.some((entry) => entry.loading);

  useEffect(() => {
    const list = listRef.current;
    if (!list || queue.length === 0) return;
    list.scrollTop = list.scrollHeight;
  }, [queue.length]);

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {totals.totalPieces > 0 ? (
          <ScanTotalsBadge
            totalPieces={totals.totalPieces}
            modelCount={totals.modelCount}
            className="flex-1 border-cyan-300/70 bg-cyan-50 px-3 py-2 text-cyan-950"
          />
        ) : (
          <p className="text-sm text-cyan-800">{emptyHint}</p>
        )}
        {queue.length > 0 ? (
          <button
            type="button"
            className="shrink-0 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
            onClick={onClear}
          >
            Wyczysc skany
          </button>
        ) : null}
      </div>

      {queue.length > 0 ? (
        <button
          type="button"
          className="w-full rounded-2xl bg-cyan-700 py-3.5 text-sm font-bold text-white shadow-md disabled:opacity-50"
          disabled={loading}
          onClick={() => setGuideIndex(0)}
        >
          {loading ? "Szukam wieszakow…" : "Pokaz gdzie odwiesic"}
        </button>
      ) : null}

      {queue.length > 0 ? (
        <ul ref={listRef} className="max-h-[32rem] space-y-2 overflow-y-auto rounded-xl border border-cyan-100 p-2 text-sm">
          {queue.map((entry, index) => {
            const model = modelOf(entry);
            const { size } = parseSkuModel(entry.sku);
            const expected = expectedModelQty(entry);
            const suggested = entry.suggestedLocation?.trim().toUpperCase() || "";
            const otherLocations = (entry.locations ?? []).filter(
              (row) => row.locationCode.trim().toUpperCase() !== suggested,
            );
            return (
              <li key={entry.sku} className="rounded-xl border border-cyan-200/80 bg-white p-2.5">
                <div className="flex gap-2.5">
                  <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-xs font-bold text-cyan-900">
                    {index + 1}
                  </span>
                  <ModelProductImage model={model} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-bold text-blue-950">{model}</p>
                    <p className="font-mono text-xs text-cyan-800">{size ? `rozmiar ${size}` : entry.sku}</p>
                    {entry.loading ? (
                      <p className="mt-1 text-xs font-semibold text-cyan-700">Szukam wieszaka…</p>
                    ) : suggested ? (
                      <div className="mt-1.5 rounded-xl bg-cyan-50 px-2.5 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-700">Odwies na</p>
                        <p className="font-mono text-xl font-bold leading-tight text-cyan-950">{suggested}</p>
                        {entry.suggestedLocationName ? (
                          <p className="text-xs font-semibold text-cyan-800">{entry.suggestedLocationName}</p>
                        ) : null}
                        {expected != null ? (
                          <p className="mt-1 text-xs leading-relaxed text-cyan-950">
                            Na tym wieszaku powinno być <strong>{expected}</strong> szt. modelu {model}.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs font-semibold text-amber-900">
                        Brak wieszaka w systemie — tego modelu nie ma poza TMP.
                      </p>
                    )}
                    {otherLocations.length > 0 ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-amber-900">
                        Ten model wisi też na:{" "}
                        {otherLocations.map((row) => `${row.locationCode} (${row.qty} szt.)`).join(", ")}.
                      </p>
                    ) : null}
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300 bg-white text-lg font-bold text-blue-900"
                        onClick={() => onAdjustQty(entry.sku, entry.qty - 1)}
                        aria-label={`Zmniejsz liczbe ${entry.sku}`}
                      >
                        −
                      </button>
                      <div className="min-w-8 text-center text-sm font-semibold text-blue-900">{entry.qty}</div>
                      <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300 bg-white text-lg font-bold text-blue-900"
                        onClick={() => onAdjustQty(entry.sku, entry.qty + 1)}
                        aria-label={`Zwieksz liczbe ${entry.sku}`}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-red-200 bg-white px-2 py-1 text-[10px] font-medium text-red-700"
                        onClick={() => onRemove(entry.sku)}
                      >
                        Usun
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {guideOpen && stop ? (
        <div className="fixed inset-0 z-[70] flex flex-col bg-cyan-950/70 p-3 sm:items-center sm:justify-center">
          <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-2 border-b border-cyan-100 px-4 py-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-700">
                  Lokalizacja {Math.min(guideIndex!, stops.length - 1) + 1} z {stops.length}
                </p>
                <h2 className="mt-0.5 text-lg font-semibold text-cyan-950">
                  {stop.locationCode ? "Odwies na tym wieszaku" : "Brak wieszaka w systemie"}
                </h2>
              </div>
              <button
                type="button"
                className="rounded-xl border border-cyan-200 px-3 py-1.5 text-sm font-semibold text-cyan-900"
                onClick={() => setGuideIndex(null)}
              >
                Zamknij
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {stop.locationCode ? (
                <p className="font-mono text-3xl font-bold text-cyan-950">
                  {stop.locationCode}
                  {stop.locationName ? (
                    <span className="mt-1 block font-sans text-base font-semibold text-cyan-800">
                      {stop.locationName}
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="text-sm text-amber-900">
                  Tych modeli nie ma na zadnym wieszaku (poza TMP). Nie dopisujemy stanu — sprawdz recznie albo
                  dodaj je osobno w trybie dodawania.
                </p>
              )}

              <p className="mt-3 text-sm font-semibold text-cyan-950">
                Odwies tu {stop.pieceCount} {stop.pieceCount === 1 ? "sztuke" : "sztuk"}
                {stop.models.length > 1 ? ` (${stop.models.length} modeli)` : ""}
              </p>

              <ul className="mt-3 space-y-3">
                {stop.models.map((model) => (
                  <li key={model.model} className="rounded-2xl border border-cyan-200 bg-cyan-50/50 p-3">
                    <div className="flex gap-3">
                      <ModelProductImage model={model.model} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-bold text-blue-950">{model.model}</p>
                        <p className="mt-1 text-sm text-cyan-950">
                          Do odwieszenia: <strong>{model.scannedQty}</strong> szt.
                        </p>
                        <p className="mt-0.5 text-xs text-cyan-900">
                          {model.lines
                            .map((line) => (line.size ? `${line.size} × ${line.qty}` : `${line.sku} × ${line.qty}`))
                            .join(", ")}
                        </p>
                        {stop.locationCode && model.expectedQty != null ? (
                          <p className="mt-2 text-xs leading-relaxed text-cyan-950">
                            Na tym wieszaku system ma teraz <strong>{model.expectedQty}</strong> szt. tego modelu.
                            Policz je zanim odwiesisz — jesli liczba sie zgadza, to wlasciwy wieszak.
                          </p>
                        ) : null}
                        {stop.locationCode && onOpenLocationPreview ? (
                          <button
                            type="button"
                            className="mt-2 text-xs font-semibold text-indigo-700 underline underline-offset-2"
                            onClick={() => {
                              setGuideIndex(null);
                              onOpenLocationPreview(stop.locationCode!, [model.model]);
                            }}
                          >
                            Podglad zawartosci wieszaka
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {model.otherLocations.length > 0 ? (
                      <p className="mt-2 text-xs leading-relaxed text-amber-900">
                        Ten model wisi tez na:{" "}
                        {model.otherLocations
                          .map((row) => `${row.locationCode} (${row.qty} szt.)`)
                          .join(", ")}
                        . Porownaj liczby, zanim odwiesisz.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-2 border-t border-cyan-100 p-3">
              <button
                type="button"
                className="flex-1 rounded-2xl border border-cyan-200 py-3 text-sm font-semibold text-cyan-900 disabled:opacity-40"
                disabled={guideIndex === 0}
                onClick={() => setGuideIndex((idx) => Math.max(0, (idx ?? 0) - 1))}
              >
                Poprzednia
              </button>
              <button
                type="button"
                className="flex-1 rounded-2xl bg-cyan-700 py-3 text-sm font-bold text-white disabled:opacity-40"
                disabled={guideIndex != null && guideIndex >= stops.length - 1}
                onClick={() => setGuideIndex((idx) => Math.min(stops.length - 1, (idx ?? 0) + 1))}
              >
                Nastepna lokalizacja
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
