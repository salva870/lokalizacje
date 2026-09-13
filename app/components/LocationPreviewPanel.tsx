"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ModelProductImage } from "@/app/components/ModelProductImage";
import { StockQtyDisplay } from "@/app/components/StockQtyDisplay";
import { sortGroupsByModelOrder } from "@/lib/modelOrder";
import { parseSkuModel } from "@/lib/skuModel";
import { groupStockByModel, summarizeStockRows, type StockModelGroup } from "@/lib/stockViews";
import type { LocationType } from "@/lib/types";

function toggleSetValue(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

type DisplaySlot =
  | { kind: "model"; group: StockModelGroup }
  | { kind: "spacer"; key: string };

/** Kotwiczony model zostaje na anchorIndex; reszta przesuwa sie wokol niego. */
function buildAnchoredDisplaySlots(
  groups: StockModelGroup[],
  focusModel: string | null,
  anchorIndex: number | null,
): DisplaySlot[] {
  if (!focusModel || anchorIndex == null) {
    return groups.map((group) => ({ kind: "model" as const, group }));
  }

  const focusIdx = groups.findIndex((group) => group.model === focusModel);
  if (focusIdx < 0) {
    return groups.map((group) => ({ kind: "model" as const, group }));
  }

  const focusGroup = groups[focusIdx];
  const before = groups.slice(0, focusIdx);
  const after = groups.slice(focusIdx + 1);
  const slots: DisplaySlot[] = [];

  for (let i = 0; i < anchorIndex; i++) {
    const group = before[i];
    if (group) {
      slots.push({ kind: "model", group });
    } else {
      slots.push({ kind: "spacer", key: `spacer-${focusModel}-${i}` });
    }
  }

  slots.push({ kind: "model", group: focusGroup });

  for (const group of after) {
    slots.push({ kind: "model", group });
  }

  return slots;
}

type LocationPreviewPanelProps = {
  locationCode: string;
  locationName?: string;
  stockRows: Array<{ sku: string; qty: number }>;
  locationTypes?: Map<string, LocationType>;
  highlightSku?: string | null;
  /** Pokaz tylko wybrane modele (np. po dodaniu stanu). */
  filterModels?: string[];
  onStockChanged?: () => void;
};

export function LocationPreviewPanel({
  locationCode,
  locationName,
  stockRows,
  locationTypes,
  highlightSku = null,
  filterModels,
  onStockChanged,
}: LocationPreviewPanelProps) {
  const [expandedSizesModels, setExpandedSizesModels] = useState<Set<string>>(() => new Set());
  const [modelOrder, setModelOrder] = useState<string[]>([]);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [dragModel, setDragModel] = useState<string | null>(null);
  const [reorderFocusModel, setReorderFocusModel] = useState<string | null>(null);
  const [reorderAnchorIndex, setReorderAnchorIndex] = useState<number | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [stockBusyKey, setStockBusyKey] = useState<string | null>(null);
  const stockBusyRef = useRef(false);

  useEffect(() => {
    if (!locationCode) {
      setModelOrder([]);
      setReorderOpen(false);
      setReorderFocusModel(null);
      setReorderAnchorIndex(null);
      return;
    }
    void fetch(`/api/locations/${encodeURIComponent(locationCode)}/model-order`)
      .then((response) => (response.ok ? response.json() : { models: [] }))
      .then((data) => setModelOrder(Array.isArray(data.models) ? data.models : []))
      .catch(() => setModelOrder([]));
  }, [locationCode]);

  const stockAsRows = useMemo(
    () => stockRows.map((row) => ({ locationCode, sku: row.sku, qty: row.qty })),
    [stockRows, locationCode],
  );

  const modelGroups = useMemo((): StockModelGroup[] => {
    const groups = groupStockByModel(stockAsRows, undefined, { locationTypes });
    if (modelOrder.length === 0) return groups;
    return sortGroupsByModelOrder(groups, modelOrder);
  }, [stockAsRows, modelOrder, locationTypes]);

  const filterModelSet = useMemo(
    () => new Set((filterModels ?? []).map((model) => model.trim().toUpperCase()).filter(Boolean)),
    [filterModels],
  );

  const visibleModelGroups = useMemo(() => {
    if (filterModelSet.size === 0) return modelGroups;
    return modelGroups.filter((group) => filterModelSet.has(group.model.toUpperCase()));
  }, [filterModelSet, modelGroups]);

  const displaySlots = useMemo(
    () => buildAnchoredDisplaySlots(visibleModelGroups, reorderFocusModel, reorderAnchorIndex),
    [visibleModelGroups, reorderFocusModel, reorderAnchorIndex],
  );

  const summary = useMemo(() => summarizeStockRows(stockAsRows, { locationTypes }), [stockAsRows, locationTypes]);

  const highlightNorm = highlightSku?.trim().toUpperCase() ?? "";

  useEffect(() => {
    if (!highlightNorm && filterModelSet.size === 0) return;
    const modelsToExpand = new Set<string>();
    if (highlightNorm) {
      const model = modelGroups.find((group) =>
        group.lines.some((line) => line.sku.toUpperCase() === highlightNorm),
      )?.model;
      if (model) modelsToExpand.add(model);
    }
    for (const model of filterModelSet) {
      if (modelGroups.some((group) => group.model.toUpperCase() === model)) {
        modelsToExpand.add(model);
      }
    }
    if (modelsToExpand.size === 0) return;
    setExpandedSizesModels((prev) => {
      const next = new Set(prev);
      for (const model of modelsToExpand) next.add(model);
      return next;
    });
  }, [filterModelSet, highlightNorm, modelGroups]);

  const saveOrder = useCallback(
    async (models: string[], optimistic = false) => {
      if (!locationCode) return false;
      if (!optimistic) setSaveMessage(null);
      const response = await fetch(`/api/locations/${encodeURIComponent(locationCode)}/model-order`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSaveMessage(typeof data.error === "string" ? data.error : "Nie udalo sie zapisac kolejnosci.");
        return false;
      }
      setModelOrder(models);
      if (!optimistic) setSaveMessage("Zapisano kolejnosc modeli na lokalizacji.");
      return true;
    },
    [locationCode],
  );

  const moveModel = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (toIndex < 0 || toIndex >= modelGroups.length || fromIndex === toIndex) return;
      const nextModels = modelGroups.map((group) => group.model);
      const [moved] = nextModels.splice(fromIndex, 1);
      nextModels.splice(toIndex, 0, moved);
      setModelOrder(nextModels);
      await saveOrder(nextModels, true);
    },
    [modelGroups, saveOrder],
  );

  const selectReorderFocus = useCallback((model: string, anchorIndex: number) => {
    setReorderFocusModel(model);
    setReorderAnchorIndex(anchorIndex);
  }, []);

  const shiftFocusedModel = useCallback(
    (direction: "up" | "down") => {
      if (!reorderFocusModel) return;
      const currentIndex = modelGroups.findIndex((group) => group.model === reorderFocusModel);
      if (currentIndex < 0) return;
      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      void moveModel(currentIndex, nextIndex);
    },
    [modelGroups, moveModel, reorderFocusModel],
  );

  const toggleReorderMode = useCallback(() => {
    setReorderOpen((prev) => {
      const next = !prev;
      if (!next) {
        setReorderFocusModel(null);
        setReorderAnchorIndex(null);
        setDragModel(null);
      }
      return next;
    });
    setSaveMessage(null);
  }, []);

  const changeSkuQty = useCallback(
    async (sku: string, currentQty: number, model: string, delta: number | "remove") => {
      if (!locationCode || stockBusyRef.current) return;
      const removeAll = delta === "remove" || (typeof delta === "number" && currentQty + delta <= 0);
      const qtyToRemove = removeAll ? currentQty : Math.abs(typeof delta === "number" ? delta : currentQty);
      if (removeAll) {
        const ok = window.confirm(`Usunac ${sku} z ${locationCode} (${currentQty} szt.)?`);
        if (!ok) return;
      }
      const key = `${locationCode}:${sku}`;
      stockBusyRef.current = true;
      setStockBusyKey(key);
      setSaveMessage(null);
      try {
        const response = await fetch("/api/movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            delta === "remove" || (typeof delta === "number" && delta < 0)
              ? {
                  movementType: "REMOVE",
                  sku,
                  qty: qtyToRemove,
                  fromLocationCode: locationCode,
                }
              : {
                  movementType: "ADD",
                  sku,
                  qty: 1,
                  toLocationCode: locationCode,
                },
          ),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Nie udalo sie zapisac zmiany.");
        }
        const orderedModels = modelGroups.map((group) => group.model);
        const remainingModelQty =
          (modelGroups.find((group) => group.model === model)?.totalQty ?? 0) +
          (modelGroups.find((group) => group.model === model)?.damagedQty ?? 0);
        if ((delta === "remove" || (typeof delta === "number" && delta < 0)) && remainingModelQty - qtyToRemove <= 0) {
          const nextModels = orderedModels.filter((entry) => entry !== model);
          if (nextModels.length !== orderedModels.length) {
            await saveOrder(nextModels, true);
          }
        } else if (typeof delta === "number" && delta > 0 && !orderedModels.includes(model)) {
          await saveOrder([...orderedModels, model], true);
        }
        setSaveMessage(removeAll ? `Usunieto ${sku}.` : delta === -1 ? `Zdjeto 1 szt.` : `Dodano 1 szt.`);
        onStockChanged?.();
      } catch (error) {
        setSaveMessage(error instanceof Error ? error.message : "Nie udalo sie zapisac zmiany.");
      } finally {
        stockBusyRef.current = false;
        setStockBusyKey(null);
      }
    },
    [locationCode, modelGroups, onStockChanged, saveOrder],
  );

  if (!locationCode) {
    return (
      <p className="mt-3 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 px-3 py-4 text-sm text-indigo-800">
        Zeskanuj kod lokalizacji (wieszak, karton), aby zobaczyc zawartosc ze stanu magazynowego.
      </p>
    );
  }

  if (modelGroups.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 px-3 py-4 text-sm text-indigo-900">
        <p className="font-semibold">{locationCode}{locationName ? ` — ${locationName}` : ""}</p>
        <p className="mt-1 text-indigo-700">Lokalizacja jest pusta — brak zapisanych produktow.</p>
      </div>
    );
  }

  if (filterModelSet.size > 0 && visibleModelGroups.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50/80 px-3 py-4 text-sm text-amber-950">
        <p className="font-semibold">{locationCode}{locationName ? ` — ${locationName}` : ""}</p>
        <p className="mt-1">
          Brak wybranych modeli na tej lokalizacji w stanie magazynowym — sprawdz fizycznie wieszak.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {filterModelSet.size > 0 ? (
        <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          Pokazano tylko {visibleModelGroups.length === 1 ? "model" : "modele"}:{" "}
          <span className="font-mono font-semibold">{[...filterModelSet].join(", ")}</span>
        </p>
      ) : null}
      <div className="rounded-xl border border-indigo-200/90 bg-indigo-50/50 px-3 py-2.5">
        <p className="font-semibold text-indigo-950">
          {locationCode}
          {locationName ? <span className="font-normal text-indigo-700"> — {locationName}</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-indigo-700">
          <StockQtyDisplay qty={summary.totalQty} damagedQty={summary.damagedQty} className="text-indigo-700" /> ·{" "}
          {summary.modelCount} modeli · {summary.skuCount} rozmiarow
        </p>
        <button
          type="button"
          className="mt-2 rounded-lg border border-indigo-300 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-900"
          onClick={toggleReorderMode}
        >
          {reorderOpen ? "Zamknij ukladanie" : "Zmien kolejnosc modeli"}
        </button>
        <button
          type="button"
          className={`mt-2 ml-2 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
            editMode ? "border-amber-400 bg-amber-50 text-amber-950" : "border-indigo-300 bg-white text-indigo-900"
          }`}
          onClick={() => {
            setEditMode((prev) => !prev);
            setSaveMessage(null);
          }}
        >
          {editMode ? "Zakoncz edycje" : "Edytuj stany"}
        </button>
        {saveMessage ? <p className="mt-1 text-xs font-medium text-indigo-800">{saveMessage}</p> : null}
        {reorderOpen ? (
          <p className="mt-1 text-xs text-indigo-700">
            Dotknij kafelka modelu — pojawia sie strzalki. Produkt zostaje na miejscu, reszta przesuwa sie pod spodem.
          </p>
        ) : null}
      </div>

      <ul className="space-y-2">
        {displaySlots.map((slot) => {
          if (slot.kind === "spacer") {
            return (
              <li
                key={slot.key}
                className="pointer-events-none overflow-hidden rounded-2xl border border-transparent opacity-0"
                aria-hidden
              >
                <div className="flex gap-3 p-3">
                  <div className="h-[4.5rem] w-[4.5rem] shrink-0" />
                  <div className="min-h-[2.5rem] flex-1" />
                </div>
              </li>
            );
          }

          const group = slot.group;
          const dataIndex = visibleModelGroups.findIndex((entry) => entry.model === group.model);
          const isFocused = reorderOpen && reorderFocusModel === group.model;
          const badgeNumber = isFocused && reorderAnchorIndex != null ? reorderAnchorIndex + 1 : dataIndex + 1;
          const groupHasHighlight =
            Boolean(highlightNorm) && group.lines.some((line) => line.sku.toUpperCase() === highlightNorm);
          const groupIsFiltered = filterModelSet.has(group.model.toUpperCase());
          const sizesExpanded = expandedSizesModels.has(group.model) || groupHasHighlight || groupIsFiltered;
          const visibleLines = !reorderOpen
            ? sizesExpanded
              ? group.lines
              : group.lines.slice(0, 2)
            : [];
          const hiddenSizeCount = !reorderOpen && !sizesExpanded ? Math.max(0, group.lines.length - 2) : 0;

          return (
            <li
              key={group.model}
              draggable={reorderOpen && !isFocused}
              onDragStart={() => setDragModel(group.model)}
              onDragOver={(event) => reorderOpen && event.preventDefault()}
              onDrop={() => {
                if (!reorderOpen || !dragModel || dragModel === group.model) return;
                const fromIndex = modelGroups.findIndex((entry) => entry.model === dragModel);
                void moveModel(fromIndex, dataIndex);
                setDragModel(null);
              }}
              onClick={() => {
                if (reorderOpen && !isFocused) {
                  selectReorderFocus(group.model, dataIndex);
                }
              }}
              className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-transform duration-200 ${
                isFocused
                  ? "border-indigo-500 ring-2 ring-indigo-300/70"
                  : groupHasHighlight || groupIsFiltered
                    ? "border-amber-400 ring-2 ring-amber-300/60"
                    : reorderOpen
                      ? "cursor-pointer border-dashed border-indigo-300 active:scale-[0.99]"
                      : "border-indigo-200/80"
              }`}
            >
              <div className="flex gap-3 p-3">
                <div className="relative shrink-0">
                  <span className="absolute -left-1 -top-1 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-md bg-indigo-700 px-1 text-[10px] font-bold tabular-nums text-white shadow">
                    {badgeNumber}
                  </span>
                  <ModelProductImage model={group.model} size="md" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-sm font-bold text-blue-950">{group.model}</span>
                      {reorderOpen && !isFocused ? (
                        <span className="mt-1 block text-xs font-medium text-indigo-600">Dotknij, aby przesuwac</span>
                      ) : null}
                      {!reorderOpen ? (
                        <span className="mt-0.5 block text-xs font-semibold text-indigo-700">
                          <StockQtyDisplay qty={group.totalQty} damagedQty={group.damagedQty} suffix="" compact /> szt. ·{" "}
                          {group.lines.length} rozmiarow
                        </span>
                      ) : null}
                    </div>

                    {reorderOpen && isFocused ? (
                      <div
                        className="flex shrink-0 flex-col gap-1.5"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="inline-flex min-h-11 min-w-[3.25rem] items-center justify-center rounded-xl border-2 border-indigo-300 bg-indigo-50 text-lg font-bold text-indigo-900 active:bg-indigo-100 disabled:opacity-35"
                          disabled={dataIndex === 0}
                          onClick={() => shiftFocusedModel("up")}
                          aria-label={`Przesun ${group.model} wyzej`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="inline-flex min-h-11 min-w-[3.25rem] items-center justify-center rounded-xl border-2 border-indigo-300 bg-indigo-50 text-lg font-bold text-indigo-900 active:bg-indigo-100 disabled:opacity-35"
                          disabled={dataIndex === modelGroups.length - 1}
                          onClick={() => shiftFocusedModel("down")}
                          aria-label={`Przesun ${group.model} nizej`}
                        >
                          ↓
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {!reorderOpen && visibleLines.length > 0 ? (
                    <div className={`relative mt-2 ${hiddenSizeCount > 0 || (sizesExpanded && group.lines.length > 2) ? "pb-5" : ""}`}>
                      <ul className="space-y-1">
                        {visibleLines.map((line) => {
                          const lineKey = `${locationCode}:${line.sku}`;
                          const lineBusy = stockBusyKey === lineKey;
                          const model = parseSkuModel(line.sku).model;
                          const isHighlighted = highlightNorm.length > 0 && line.sku.toUpperCase() === highlightNorm;
                          return (
                          <li
                            key={line.sku}
                            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs ${
                              isHighlighted
                                ? "border-amber-400 bg-amber-50 ring-1 ring-amber-300"
                                : "border-indigo-100/80 bg-indigo-50/30"
                            }`}
                          >
                            <span className="font-mono text-blue-900">
                              {line.size ? `rozmiar ${line.size}` : line.sku}
                            </span>
                            {editMode ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-300 bg-white text-base font-bold text-indigo-900 disabled:opacity-40"
                                  disabled={Boolean(stockBusyKey) || line.qty <= 0}
                                  onClick={() => void changeSkuQty(line.sku, line.qty, model, -1)}
                                >
                                  −
                                </button>
                                <span className="min-w-6 text-center text-xs font-semibold tabular-nums">
                                  {lineBusy ? "…" : line.qty}
                                </span>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-300 bg-white text-base font-bold text-indigo-900 disabled:opacity-40"
                                  disabled={Boolean(stockBusyKey)}
                                  onClick={() => void changeSkuQty(line.sku, line.qty, model, 1)}
                                >
                                  +
                                </button>
                              </div>
                            ) : (
                              <StockQtyDisplay qty={line.qty} damagedQty={line.damagedQty} className="text-indigo-800" compact />
                            )}
                          </li>
                          );
                        })}
                      </ul>
                      {hiddenSizeCount > 0 ? (
                        <button
                          type="button"
                          className="absolute -bottom-1 right-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-indigo-200 bg-white text-sm font-bold text-indigo-800 shadow-sm active:bg-indigo-50"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleSetValue(setExpandedSizesModels, group.model);
                          }}
                          aria-label={`Pokaz ${hiddenSizeCount} kolejnych rozmiarow modelu ${group.model}`}
                          title={`Pokaz wiecej (${hiddenSizeCount})`}
                        >
                          ▼
                        </button>
                      ) : null}
                      {sizesExpanded && group.lines.length > 2 ? (
                        <button
                          type="button"
                          className="absolute -bottom-1 right-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-indigo-200 bg-white text-sm font-bold text-indigo-800 shadow-sm active:bg-indigo-50"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleSetValue(setExpandedSizesModels, group.model);
                          }}
                          aria-label={`Zwin rozmiary modelu ${group.model}`}
                          title="Zwin"
                        >
                          ▲
                        </button>
                      ) : null}
                    </div>
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
