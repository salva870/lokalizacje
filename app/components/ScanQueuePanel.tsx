"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import {
  formatScanTotals,
  groupQueueByModel,
  summarizeScanQueue,
  type ScanQueueLine,
} from "@/lib/skuModel";

function toggleSetValue(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

type Tone = "emerald" | "blue";

type ScanQueuePanelProps = {
  queue: ScanQueueLine[];
  tone: Tone;
  emptyHint: string;
  onClear: () => void;
  onAdjustQty: (sku: string, qty: number) => void;
  onRemove: (sku: string) => void;
  stock?: Array<{ locationCode: string; sku: string; qty: number }>;
  activeLocationCode?: string | null;
  showStock?: boolean;
};

const toneStyles: Record<
  Tone,
  { section: string; group: string; line: string; summary: string; clear: string }
> = {
  emerald: {
    section: "border-emerald-100",
    group: "border-emerald-200/80 bg-emerald-50/50",
    line: "border-emerald-100/80 bg-white/80",
    summary: "border-emerald-300/70 bg-emerald-50 text-emerald-950",
    clear: "border-red-200 bg-white text-red-700 hover:bg-red-50",
  },
  blue: {
    section: "border-blue-100",
    group: "border-blue-200/80 bg-blue-50/60",
    line: "border-blue-100/80 bg-white/80",
    summary: "border-blue-300/70 bg-blue-50 text-blue-950",
    clear: "border-red-200 bg-white text-red-700 hover:bg-red-50",
  },
};

export function ScanTotalsBadge({
  totalPieces,
  modelCount,
  className = "",
  compact = false,
}: {
  totalPieces: number;
  modelCount: number;
  className?: string;
  compact?: boolean;
}) {
  const label = formatScanTotals(totalPieces, modelCount);
  if (!label) return null;
  return (
    <div
      className={`rounded-xl border font-semibold tabular-nums tracking-tight ${compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"} ${className}`}
      aria-live="polite"
    >
      {label}
    </div>
  );
}

export function ScanQueuePanel({
  queue,
  tone,
  emptyHint,
  onClear,
  onAdjustQty,
  onRemove,
  stock,
  activeLocationCode,
  showStock = false,
}: ScanQueuePanelProps) {
  const styles = toneStyles[tone];
  const totals = summarizeScanQueue(queue);
  const groups = groupQueueByModel(queue);
  const [expandedModels, setExpandedModels] = useState<Set<string>>(() => new Set());

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {totals.totalPieces > 0 ? (
          <ScanTotalsBadge
            totalPieces={totals.totalPieces}
            modelCount={totals.modelCount}
            className={`flex-1 px-3 py-2 ${styles.summary}`}
          />
        ) : (
          <p className="text-sm text-blue-600">{emptyHint}</p>
        )}
        {queue.length > 0 ? (
          <button
            type="button"
            className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold ${styles.clear}`}
            onClick={onClear}
          >
            Wyczysc skany
          </button>
        ) : null}
      </div>

      {groups.length > 0 ? (
        <ul className={`max-h-64 space-y-2 overflow-y-auto rounded-xl border ${styles.section} p-2 text-sm`}>
          {groups.map((group) => {
            const collapsed = !expandedModels.has(group.model);
            return (
            <li key={group.model} className={`rounded-xl border px-3 py-2 ${styles.group}`}>
              <button
                type="button"
                className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
                onClick={() => toggleSetValue(setExpandedModels, group.model)}
                aria-expanded={!collapsed}
              >
                <span className="font-mono text-sm font-bold text-blue-950">
                  <span className="mr-2 text-xs text-blue-500" aria-hidden>
                    {collapsed ? "▶" : "▼"}
                  </span>
                  {group.model}
                </span>
                <span className="text-xs font-semibold text-blue-700">
                  {group.totalQty} szt. · {group.lines.length} rozmiarow
                </span>
              </button>
              {!collapsed ? (
              <ul className="mt-2 space-y-1.5">
                {group.lines.map((line) => {
                  const available =
                    showStock && stock && activeLocationCode
                      ? (stock.find(
                          (row) =>
                            row.locationCode.toUpperCase() === activeLocationCode.toUpperCase() &&
                            row.sku === line.sku,
                        )?.qty ?? 0)
                      : null;
                  return (
                    <li
                      key={line.sku}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-2 ${styles.line}`}
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-xs font-semibold text-blue-900">
                          {line.size ? `rozmiar ${line.size}` : line.sku}
                        </span>
                        {line.size ? (
                          <span className="ml-2 font-mono text-[10px] text-blue-500">{line.sku}</span>
                        ) : null}
                        {available != null ? (
                          <span className="ml-2 text-[10px] text-blue-600">na stanie: {available}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-300 bg-white text-lg font-bold text-blue-900"
                          onClick={() => onAdjustQty(line.sku, line.qty - 1)}
                          aria-label={`Zmniejsz liczbe ${line.sku}`}
                        >
                          −
                        </button>
                        <div className="min-w-8 text-center text-sm font-semibold text-blue-900">{line.qty}</div>
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-300 bg-white text-lg font-bold text-blue-900"
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
