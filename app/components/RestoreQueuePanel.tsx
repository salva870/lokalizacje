"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { formatScanTotals, groupQueueByModel, summarizeScanQueue } from "@/lib/skuModel";
import { ScanTotalsBadge } from "@/app/components/ScanQueuePanel";

export type RestoreQueueEntry = {
  sku: string;
  qty: number;
  loading?: boolean;
  model?: string;
  suggestedLocation?: string | null;
  suggestedLocationName?: string | null;
  locations?: Array<{ locationCode: string; locationName: string | null; qty: number; variantCount: number }>;
};

function toggleSetValue(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

type RestoreQueuePanelProps = {
  queue: RestoreQueueEntry[];
  emptyHint: string;
  onClear: () => void;
  onAdjustQty: (sku: string, qty: number) => void;
  onRemove: (sku: string) => void;
  onOpenLocationPreview?: (locationCode: string, models: string[]) => void;
};

function formatLocationHint(entry: RestoreQueueEntry): string {
  if (entry.loading) return "Szukam lokalizacji modelu…";
  if (entry.suggestedLocation) {
    return entry.suggestedLocationName
      ? `${entry.suggestedLocation} — ${entry.suggestedLocationName}`
      : entry.suggestedLocation;
  }
  return "Brak lokalizacji dla tego modelu";
}

function expectedModelQtyAtLocation(entry: RestoreQueueEntry): number | null {
  if (!entry.suggestedLocation || !entry.locations?.length) return null;
  const loc = entry.suggestedLocation.trim().toUpperCase();
  return (
    entry.locations.find((row) => row.locationCode.trim().toUpperCase() === loc)?.qty ?? null
  );
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
  const groups = groupQueueByModel(queue);
  const entryBySku = new Map(queue.map((entry) => [entry.sku, entry]));
  const [expandedModels, setExpandedModels] = useState<Set<string>>(() => new Set());

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

      {groups.length > 0 ? (
        <ul className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-cyan-100 p-2 text-sm">
          {groups.map((group) => {
            const collapsed = !expandedModels.has(group.model);
            const sampleEntry = entryBySku.get(group.lines[0]?.sku ?? "");
            const groupHint = sampleEntry ? formatLocationHint(sampleEntry) : "—";
            const hasLocation = Boolean(sampleEntry?.suggestedLocation);
            const expectedQty = sampleEntry ? expectedModelQtyAtLocation(sampleEntry) : null;
            const modelCode = sampleEntry?.model ?? group.model;
            return (
              <li key={group.model} className="overflow-hidden rounded-xl border border-cyan-200/80 bg-cyan-50/40">
                <div
                  className={`border-b px-3 py-2.5 ${hasLocation ? "border-cyan-200/80 bg-cyan-100/70" : "border-amber-200/80 bg-amber-50/80"}`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-800">
                    {hasLocation ? "Odloz na lokalizacji" : "Brak lokalizacji modelu"}
                  </p>
                  <p className={`mt-0.5 font-mono text-base font-bold ${hasLocation ? "text-cyan-950" : "text-amber-900"}`}>
                    {groupHint}
                  </p>
                  {hasLocation && expectedQty != null ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-cyan-900">
                      Na tej lokalizacji powinno byc teraz{" "}
                      <strong>{expectedQty}</strong> produktow z modelu{" "}
                      <span className="font-mono font-semibold">{modelCode}</span>
                      {onOpenLocationPreview && sampleEntry?.suggestedLocation ? (
                        <>
                          {" "}
                          —{" "}
                          <button
                            type="button"
                            className="font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
                            onClick={() =>
                              onOpenLocationPreview(sampleEntry.suggestedLocation!, [modelCode])
                            }
                          >
                            sprawdz
                          </button>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  {!hasLocation && sampleEntry && !sampleEntry.loading ? (
                    <p className="mt-1 text-xs text-amber-800">
                      Zaproponuj dodanie do lokalizacji po zeskanowaniu produktu.
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-left"
                  onClick={() => toggleSetValue(setExpandedModels, group.model)}
                  aria-expanded={!collapsed}
                >
                  <span className="font-mono text-sm font-bold text-blue-950">
                    <span className="mr-2 text-xs text-cyan-600" aria-hidden>
                      {collapsed ? "▶" : "▼"}
                    </span>
                    {group.model}
                  </span>
                  <span className="text-xs font-semibold text-cyan-800">
                    {group.totalQty} szt. · {group.lines.length} rozmiarow
                  </span>
                </button>
                {!collapsed ? (
                  <ul className="space-y-1.5 px-2 pb-2">
                    {group.lines.map((line) => {
                      const entry = entryBySku.get(line.sku);
                      return (
                        <li
                          key={line.sku}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-100/80 bg-white/90 px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <span className="font-mono text-xs font-semibold text-blue-900">
                              {line.size ? `rozmiar ${line.size}` : line.sku}
                            </span>
                            {line.size ? (
                              <span className="ml-2 font-mono text-[10px] text-blue-500">{line.sku}</span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300 bg-white text-lg font-bold text-blue-900"
                              onClick={() => onAdjustQty(line.sku, line.qty - 1)}
                              aria-label={`Zmniejsz liczbe ${line.sku}`}
                            >
                              −
                            </button>
                            <div className="min-w-8 text-center text-sm font-semibold text-blue-900">{line.qty}</div>
                            <button
                              type="button"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300 bg-white text-lg font-bold text-blue-900"
                              onClick={() => onAdjustQty(line.sku, line.qty + 1)}
                              aria-label={`Zwieksz liczbe ${line.sku}`}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-red-200 bg-white px-2 py-1 text-[10px] font-medium text-red-700"
                              onClick={() => onRemove(line.sku)}
                            >
                              Usun
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
