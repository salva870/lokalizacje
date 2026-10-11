"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  groupQueueByModel,
  parseSkuModel,
  type ModelGroup,
  type ScanQueueLine,
} from "@/lib/skuModel";
import { sortGroupsByModelOrder } from "@/lib/modelOrder";

function toggleSetValue(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

type MoveModelPickerProps = {
  sourceLocationCode: string;
  stockRows: Array<{ sku: string; qty: number }>;
  moveQueue: ScanQueueLine[];
  onToggleModel: (model: string, selected: boolean) => void;
  onToggleSku: (sku: string, selected: boolean) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
};

export function isMoveSkuFullyQueued(
  sku: string,
  stockQty: number,
  moveQueue: ScanQueueLine[],
): boolean {
  const skuNorm = sku.trim().toUpperCase();
  const queued = moveQueue.find((line) => line.sku === skuNorm);
  return queued != null && queued.qty >= stockQty;
}

export function isMoveModelFullyQueued(
  model: string,
  stockRows: Array<{ sku: string; qty: number }>,
  moveQueue: ScanQueueLine[],
): boolean {
  const normalized = model.trim().toUpperCase();
  const modelStock = stockRows.filter((row) => parseSkuModel(row.sku).model === normalized);
  if (modelStock.length === 0) return false;
  return modelStock.every((row) =>
    isMoveSkuFullyQueued(row.sku, row.qty, moveQueue),
  );
}

export function isMoveModelPartiallyQueued(
  model: string,
  stockRows: Array<{ sku: string; qty: number }>,
  moveQueue: ScanQueueLine[],
): boolean {
  const normalized = model.trim().toUpperCase();
  const modelStock = stockRows.filter((row) => parseSkuModel(row.sku).model === normalized);
  const anyQueued = modelStock.some((row) =>
    moveQueue.some((line) => line.sku === row.sku.trim().toUpperCase()),
  );
  const fully = isMoveModelFullyQueued(normalized, stockRows, moveQueue);
  return anyQueued && !fully;
}

function ModelCheckbox({
  model,
  fullyQueued,
  partiallyQueued,
  onToggle,
}: {
  model: string;
  fullyQueued: boolean;
  partiallyQueued: boolean;
  onToggle: (selected: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = partiallyQueued;
  }, [partiallyQueued]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      className="mt-0.5 h-5 w-5 shrink-0 rounded border-blue-300 text-blue-800"
      checked={fullyQueued}
      onChange={(event) => onToggle(event.target.checked)}
      aria-label={`Przenies caly model ${model}`}
    />
  );
}

function SizeCheckbox({
  sku,
  checked,
  onToggle,
  label,
}: {
  sku: string;
  checked: boolean;
  onToggle: (selected: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 shrink-0 rounded border-blue-300 text-blue-800"
      checked={checked}
      onChange={(event) => onToggle(event.target.checked)}
      aria-label={`Przenies rozmiar ${label}`}
    />
  );
}

export function MoveModelPicker({
  sourceLocationCode,
  stockRows,
  moveQueue,
  onToggleModel,
  onToggleSku,
  onSelectAll,
  onClearSelection,
}: MoveModelPickerProps) {
  const [collapsedModels, setCollapsedModels] = useState<Set<string>>(() => new Set());
  const [modelOrder, setModelOrder] = useState<string[]>([]);

  useEffect(() => {
    if (!sourceLocationCode) {
      setModelOrder([]);
      return;
    }
    void fetch(`/api/locations/${encodeURIComponent(sourceLocationCode)}/model-order`)
      .then((response) => (response.ok ? response.json() : { models: [] }))
      .then((data) => setModelOrder(Array.isArray(data.models) ? data.models : []))
      .catch(() => setModelOrder([]));
  }, [sourceLocationCode]);

  const modelGroups = useMemo((): ModelGroup[] => {
    const groups = groupQueueByModel(stockRows.map((row) => ({ sku: row.sku, qty: row.qty })));
    if (modelOrder.length === 0) return groups;
    return sortGroupsByModelOrder(groups, modelOrder);
  }, [stockRows, modelOrder]);

  const queuedSkuCount = useMemo(
    () =>
      stockRows.filter((row) => isMoveSkuFullyQueued(row.sku, row.qty, moveQueue)).length,
    [moveQueue, stockRows],
  );

  if (!sourceLocationCode || modelGroups.length === 0) {
    return (
      <p className="mt-3 rounded-xl border border-dashed border-blue-200 bg-blue-50/40 px-3 py-2 text-xs text-blue-700">
        {sourceLocationCode
          ? "Brak modeli na tej lokalizacji."
          : "Zeskanuj lokalizacje Z, aby wybrac rozmiary do przeniesienia."}
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Rozmiary na {sourceLocationCode}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-800"
            onClick={onSelectAll}
          >
            Zaznacz wszystko
          </button>
          <button
            type="button"
            className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-800"
            onClick={onClearSelection}
          >
            Odznacz
          </button>
        </div>
      </div>
      {queuedSkuCount > 0 ? (
        <p className="text-xs text-blue-700">
          Zaznaczone rozmiary: {queuedSkuCount}/{stockRows.length}
        </p>
      ) : (
        <p className="text-xs text-blue-600">
          Rozwin model i zaznacz jeden lub wiecej rozmiarow (checkbox przy rozmiarze), albo caly model.
        </p>
      )}
      <ul className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-blue-100 p-2 text-sm">
        {modelGroups.map((group) => {
          const fullyQueued = isMoveModelFullyQueued(group.model, stockRows, moveQueue);
          const partiallyQueued = isMoveModelPartiallyQueued(group.model, stockRows, moveQueue);
          const collapsed = collapsedModels.has(group.model);
          return (
            <li key={group.model} className="rounded-xl border border-blue-200/80 bg-blue-50/60 px-2 py-2">
              <div className="flex items-start gap-2">
                <ModelCheckbox
                  model={group.model}
                  fullyQueued={fullyQueued}
                  partiallyQueued={partiallyQueued}
                  onToggle={(selected) => onToggleModel(group.model, selected)}
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
                    onClick={() => toggleSetValue(setCollapsedModels, group.model)}
                    aria-expanded={!collapsed}
                  >
                    <span className="font-mono text-sm font-bold text-blue-950">
                      <span className="mr-1.5 text-xs text-blue-500" aria-hidden>
                        {collapsed ? "▶" : "▼"}
                      </span>
                      {group.model}
                    </span>
                    <span className="text-xs font-semibold text-blue-700">
                      {group.totalQty} szt. · {group.lines.length} rozmiarow
                    </span>
                  </button>
                  {!collapsed ? (
                    <ul className="mt-1.5 space-y-1">
                      {group.lines.map((line) => {
                        const stockRow = stockRows.find(
                          (row) => row.sku.trim().toUpperCase() === line.sku.trim().toUpperCase(),
                        );
                        const stockQty = stockRow?.qty ?? line.qty;
                        const skuQueued = isMoveSkuFullyQueued(line.sku, stockQty, moveQueue);
                        const queued = moveQueue.find((entry) => entry.sku === line.sku.trim().toUpperCase());
                        return (
                          <li
                            key={line.sku}
                            className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100/80 bg-white/80 px-2 py-1.5 text-xs"
                          >
                            <SizeCheckbox
                              sku={line.sku}
                              checked={skuQueued}
                              label={line.size ? `${group.model} ${line.size}` : line.sku}
                              onToggle={(selected) => onToggleSku(line.sku, selected)}
                            />
                            <span className="min-w-0 flex-1 font-mono text-blue-900">
                              {line.size ? `rozmiar ${line.size}` : line.sku}
                            </span>
                            <span className="text-blue-700">
                              {queued ? `${queued.qty}/${stockQty}` : `0/${stockQty}`} szt.
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
