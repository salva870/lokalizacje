"use client";

import { useRef } from "react";
import { formatScanTotals, groupQueueByModel, summarizeScanQueue, type ScanQueueLine } from "@/lib/skuModel";
import type { SaleQueueLine } from "@/lib/saleQueue";

type SaleQueuePanelProps = {
  queue: SaleQueueLine[];
  onClear: () => void;
  onAdjustQty: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
  onAddPhotoItem: (file: File, note?: string) => void;
  onUpdateNote: (lineId: string, note: string) => void;
};

export function SaleQueuePanel({
  queue,
  onClear,
  onAdjustQty,
  onRemove,
  onAddPhotoItem,
  onUpdateNote,
}: SaleQueuePanelProps) {
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const totals = summarizeScanQueue(
    queue.filter((line) => line.sku).map((line) => ({ sku: line.sku!, qty: line.qty }) satisfies ScanQueueLine),
  );
  const skuGroups = groupQueueByModel(
    queue.filter((line) => line.sku).map((line) => ({ sku: line.sku!, qty: line.qty }) satisfies ScanQueueLine),
  );
  const photoLines = queue.filter((line) => !line.sku);

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {queue.length > 0 ? (
          <div className="flex-1 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm font-semibold tabular-nums text-amber-950">
            {formatScanTotals(totals.totalPieces, totals.modelCount) || `${queue.length} poz.`}
            {photoLines.length > 0 ? ` · ${photoLines.length} zdj.` : ""}
          </div>
        ) : (
          <p className="text-sm text-amber-800">Brak pozycji — zeskanuj, wpisz recznie albo dodaj zdjecie bez kodu.</p>
        )}
        {queue.length > 0 ? (
          <button
            type="button"
            className="shrink-0 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
            onClick={onClear}
          >
            Wyczysc liste
          </button>
        ) : null}
      </div>

      {skuGroups.length > 0 ? (
        <ul className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-amber-100 p-2 text-sm">
          {skuGroups.map((group) => (
            <li key={group.model} className="rounded-xl border border-amber-200/80 bg-amber-50/50 px-3 py-2">
              <p className="font-mono text-sm font-bold text-amber-950">{group.model}</p>
              <ul className="mt-2 space-y-1.5">
                {group.lines.map((line) => {
                  const queueLine = queue.find((entry) => entry.sku === line.sku);
                  if (!queueLine) return null;
                  return (
                    <li
                      key={queueLine.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-100/80 bg-white/80 px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-xs font-semibold text-amber-950">{line.sku}</span>
                        {queueLine.fromLocationCode ? (
                          <span className="ml-2 text-[11px] text-amber-700">z {queueLine.fromLocationCode}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-300 bg-white text-base font-bold text-amber-900"
                          onClick={() => onAdjustQty(queueLine.id, queueLine.qty - 1)}
                        >
                          −
                        </button>
                        <span className="min-w-6 text-center text-sm font-semibold tabular-nums">{queueLine.qty}</span>
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-300 bg-white text-base font-bold text-amber-900"
                          onClick={() => onAdjustQty(queueLine.id, queueLine.qty + 1)}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-red-200 px-2 py-1 text-[10px] font-medium text-red-700"
                          onClick={() => onRemove(queueLine.id)}
                        >
                          Usun
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}

      {photoLines.length > 0 ? (
        <ul className="space-y-2 rounded-xl border border-amber-100 p-2">
          {photoLines.map((line) => (
            <li key={line.id} className="rounded-xl border border-amber-200 bg-white p-2">
              <div className="flex gap-3">
                {line.photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={line.photoPreview} alt="" className="h-16 w-16 rounded-lg object-cover" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-amber-950">Produkt bez kodu / poza lokalizacjami</p>
                  <input
                    type="text"
                    value={line.note ?? ""}
                    onChange={(event) => onUpdateNote(line.id, event.target.value)}
                    placeholder="Opcjonalny opis"
                    className="mt-1 w-full rounded-lg border border-amber-200 px-2 py-1 text-xs"
                  />
                </div>
                <button
                  type="button"
                  className="self-start rounded-lg border border-red-200 px-2 py-1 text-[10px] font-medium text-red-700"
                  onClick={() => onRemove(line.id)}
                >
                  Usun
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onAddPhotoItem(file);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900"
          onClick={() => photoInputRef.current?.click()}
        >
          Dodaj zdjecie (bez SKU)
        </button>
      </div>
    </div>
  );
}
