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
  onSelectAll: () => void;
  onClearSelection: () => void;
};

export function isMoveModelFullyQueued(
  model: string,
  stockRows: Array<{ sku: string; qty: number }>,
  moveQueue: ScanQueueLine[],
): boolean {
  const normalized = model.trim().toUpperCase();
  const modelStock = stockRows.filter((row) => parseSkuModel(row.sku).model === normalized);
  if (modelStock.length === 0) return false;
  return modelStock.every((row) => {
    const queued = moveQueue.find((line) => line.sku === row.sku.trim().toUpperCase());
    return queued != null && queued.qty >= row.qty;
  });
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
      className="mt-1 h-5 w-5 shrink-0 rounded border-blue-300 text-blue-800"
      checked={fullyQueued}
      onChange={(event) => onToggle(event.target.checked)}
      aria-label={`Przenies model ${model}`}
    />
  );
}

export function MoveModelPicker({
  sourceLocationCode,
  stockRows,
  moveQueue,
  onToggleModel,
  onSelectAll,
  onClearSelection,
}: MoveModelPickerProps) {
  const [expandedModels, setExpandedModels] = useState<Set<string>>(() => new Set());
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

  const selectedCount = useMemo(
    () => modelGroups.filter((group) => isMoveModelFullyQueued(group.model, stockRows, moveQueue)).length,
    [modelGroups, moveQueue, stockRows],
  );

  if (!sourceLocationCode || modelGroups.length === 0) {
    return (
      <p className="mt-3 rounded-xl border border-dashed border-blue-200 bg-blue-50/40 px-3 py-2 text-xs text-blue-700">
        {sourceLocationCode
          ? "Brak modeli na tej lokalizacji."
          : "Zeskanuj lokalizacje Z, aby wybrac modele do przeniesienia."}
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Modele na {sourceLocationCode}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-800"
            onClick={onSelectAll}
          >
            Zaznacz wszystkie
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
      {selectedCount > 0 ? (
        <p className="text-xs text-blue-700">
          Zaznaczone: {selectedCount}/{modelGroups.length} modeli
        </p>
      ) : null}
      <ul className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-blue-100 p-2 text-sm">
        {modelGroups.map((group) => {
          const fullyQueued = isMoveModelFullyQueued(group.model, stockRows, moveQueue);
          const partiallyQueued = isMoveModelPartiallyQueued(group.model, stockRows, moveQueue);
          const collapsed = !expandedModels.has(group.model);
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
                    onClick={() => toggleSetValue(setExpandedModels, group.model)}
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
                        const queued = moveQueue.find((entry) => entry.sku === line.sku);
                        return (
                          <li
                            key={line.sku}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100/80 bg-white/80 px-2 py-1.5 text-xs"
                          >
                            <span className="font-mono text-blue-900">
                              {line.size ? `rozmiar ${line.size}` : line.sku}
                            </span>
                            <span className="text-blue-700">
                              {queued ? `${queued.qty}/${line.qty}` : `0/${line.qty}`} szt.
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
