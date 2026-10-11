"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { zoneLabels } from "@/lib/locationMeta";
import {
  locationStockBucket,
  locationStockBucketLabels,
  sortLocationsBySavedOrder,
  locationSortRankMap,
  type LocationStockBucket,
} from "@/lib/locationStockView";
import { filterStockModelGroups } from "@/lib/skuLookup";
import { buildLocationTypeMap } from "@/lib/stockClassification";
import { AddDuplicateConfirmModal } from "@/app/components/AddDuplicateConfirmModal";
import { ModelLogButton } from "@/app/components/ModelLogButton";
import { StockQtyDisplay } from "@/app/components/StockQtyDisplay";
import { findModelDuplicateAddRisks, type ModelDuplicateAddRisk } from "@/lib/addDuplicateGuard";
import { groupStockByModel, summarizeStockRows, type StockModelGroup, type StockRow } from "@/lib/stockViews";
import type { Location, Zone } from "@/lib/types";
import {
  ReplenishmentPanel,
  type ReplenishmentLineState,
  type ReplenishmentLineStatus,
} from "@/app/components/ReplenishmentPanel";
import type { ReplenishmentTransfer } from "@/lib/replenishment";

const REPLENISH_STATUS_STORAGE_KEY = "loc-replenishment-line-status";

type StockPanelLocation = Pick<Location, "code" | "name" | "parentZone" | "sortOrder" | "locationType" | "isActive">;

type LocationStockEntry = {
  locationCode: string;
  location: StockPanelLocation | undefined;
  rows: StockRow[];
  summary: ReturnType<typeof summarizeStockRows>;
  models: StockModelGroup[];
  globalSortIndex: number;
};

type StockPanelProps = {
  stock: StockRow[];
  locations: StockPanelLocation[];
  onClose: () => void;
  onStockChanged?: () => void;
  onOpenLocationPreview?: (locationCode: string, models: string[]) => void;
};

function readReplenishmentStatusMap(): Record<string, ReplenishmentLineStatus> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REPLENISH_STATUS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ReplenishmentLineStatus>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeReplenishmentStatusMap(map: Record<string, ReplenishmentLineStatus>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REPLENISH_STATUS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

type OrderRow = { locationCode: string; model: string; sortOrder: number };

function toggleSetValue(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

export function StockPanel({ stock, locations, onClose, onStockChanged, onOpenLocationPreview }: StockPanelProps) {
  const [tab, setTab] = useState<"list" | "byLocation" | "replenish">("list");
  const [locationZoneTab, setLocationZoneTab] = useState<LocationStockBucket>("SKLEP");
  const [orderRows, setOrderRows] = useState<OrderRow[]>([]);
  const [reorderLocation, setReorderLocation] = useState<string | null>(null);
  const [dragModel, setDragModel] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [skuQuery, setSkuQuery] = useState("");
  const [sizeQuery, setSizeQuery] = useState("");
  const [expandedModels, setExpandedModels] = useState<Set<string>>(() => new Set());
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(() => new Set());
  const [expandedLocationModels, setExpandedLocationModels] = useState<Set<string>>(() => new Set());
  const [editMode, setEditMode] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [duplicateRisks, setDuplicateRisks] = useState<ModelDuplicateAddRisk[]>([]);
  const [duplicateLocation, setDuplicateLocation] = useState("");
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const duplicatePendingRef = useRef<null | (() => Promise<void>)>(null);
  const busyRef = useRef(false);
  const [replenishLines, setReplenishLines] = useState<ReplenishmentLineState[]>([]);
  const [replenishModelTargets, setReplenishModelTargets] = useState<Array<{ model: string; targetQty: number }>>([]);
  const [replenishLoading, setReplenishLoading] = useState(false);
  const [replenishBusyId, setReplenishBusyId] = useState<string | null>(null);

  const loadReplenishmentPlan = useCallback(async () => {
    setReplenishLoading(true);
    try {
      const response = await fetch("/api/replenishment/plan");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSaveMessage(typeof data.error === "string" ? data.error : "Nie udalo sie pobrac planu uzupelnienia.");
        setReplenishLines([]);
        setReplenishModelTargets([]);
        return;
      }
      const statusMap = readReplenishmentStatusMap();
      const transfers = Array.isArray(data.transfers) ? (data.transfers as ReplenishmentTransfer[]) : [];
      const lines: ReplenishmentLineState[] = transfers.map((line) => ({
        ...line,
        status: statusMap[line.id] === "picked" || statusMap[line.id] === "done" ? statusMap[line.id]! : "pending",
      }));
      setReplenishLines(lines);
      setReplenishModelTargets(Array.isArray(data.modelTargets) ? data.modelTargets : []);
    } catch {
      setSaveMessage("Blad polaczenia przy pobieraniu planu uzupelnienia.");
      setReplenishLines([]);
      setReplenishModelTargets([]);
    } finally {
      setReplenishLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "replenish") return;
    void loadReplenishmentPlan();
  }, [tab, loadReplenishmentPlan]);

  const persistReplenishStatus = useCallback((lines: ReplenishmentLineState[]) => {
    const map: Record<string, ReplenishmentLineStatus> = {};
    for (const line of lines) {
      if (line.status !== "pending") map[line.id] = line.status;
    }
    writeReplenishmentStatusMap(map);
  }, []);

  const markReplenishPicked = useCallback(
    (id: string) => {
      setReplenishLines((prev) => {
        const next = prev.map((line) => (line.id === id ? { ...line, status: "picked" as const } : line));
        persistReplenishStatus(next);
        return next;
      });
    },
    [persistReplenishStatus],
  );

  const confirmReplenishMove = useCallback(
    async (line: ReplenishmentTransfer) => {
      setReplenishBusyId(line.id);
      setSaveMessage(null);
      try {
        const response = await fetch("/api/movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            movementType: "MOVE",
            sku: line.sku,
            qty: line.qty,
            fromLocationCode: line.fromLocationCode,
            toLocationCode: line.toLocationCode,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setSaveMessage(typeof data.error === "string" ? data.error : "Nie udalo sie zapisac przeniesienia.");
          return;
        }
        setReplenishLines((prev) => {
          const next = prev.map((row) => (row.id === line.id ? { ...row, status: "done" as const } : row));
          persistReplenishStatus(next);
          return next;
        });
        setSaveMessage(`Przeniesiono ${line.qty} szt. ${line.sku} na ${line.toLocationCode}.`);
        onStockChanged?.();
      } finally {
        setReplenishBusyId(null);
      }
    },
    [onStockChanged, persistReplenishStatus],
  );

  const saveReplenishModelTarget = useCallback(
    async (model: string, targetQty: number) => {
      const response = await fetch(`/api/models/${encodeURIComponent(model)}/display-target`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetQty }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Nie udalo sie zapisac celu ekspozycji.");
      }
      await loadReplenishmentPlan();
    },
    [loadReplenishmentPlan],
  );

  useEffect(() => {
    void fetch("/api/model-order")
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setOrderRows(data.items ?? []))
      .catch(() => setOrderRows([]));
  }, [stock]);


  const orderByLocation = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const row of orderRows) {
      let inner = map.get(row.locationCode);
      if (!inner) {
        inner = new Map();
        map.set(row.locationCode, inner);
      }
      inner.set(row.model, row.sortOrder);
    }
    return map;
  }, [orderRows]);

  const locationTypes = useMemo(() => buildLocationTypeMap(locations), [locations]);

  const modelGroups = useMemo(
    () => groupStockByModel(stock, undefined, { locationTypes }),
    [stock, locationTypes],
  );
  const searchActive = Boolean(skuQuery.trim());

  const filteredModelGroups = useMemo(
    () => filterStockModelGroups(modelGroups, skuQuery, sizeQuery),
    [modelGroups, skuQuery, sizeQuery],
  );

  const sortedLocations = useMemo(() => sortLocationsBySavedOrder(locations), [locations]);
  const locationSortRank = useMemo(() => locationSortRankMap(locations), [locations]);

  const stockByLocationCode = useMemo(() => {
    const map = new Map<string, StockRow[]>();
    for (const row of stock) {
      const list = map.get(row.locationCode) ?? [];
      list.push(row);
      map.set(row.locationCode, list);
    }
    return map;
  }, [stock]);

  const byLocation = useMemo((): LocationStockEntry[] => {
    const entries: LocationStockEntry[] = [];
    const seen = new Set<string>();

    for (const loc of sortedLocations) {
      seen.add(loc.code);
      const rows = stockByLocationCode.get(loc.code) ?? [];
      const orderMap = orderByLocation.get(loc.code);
      entries.push({
        locationCode: loc.code,
        location: loc,
        rows,
        summary: summarizeStockRows(rows, { locationTypes }),
        models: groupStockByModel(rows, orderMap, { locationTypes }),
        globalSortIndex: locationSortRank.get(loc.code) ?? entries.length,
      });
    }

    const orphanCodes = [...stockByLocationCode.keys()]
      .filter((code) => !seen.has(code))
      .sort((a, b) => a.localeCompare(b));
    let orphanIndex = sortedLocations.length;
    for (const code of orphanCodes) {
      const rows = stockByLocationCode.get(code) ?? [];
      entries.push({
        locationCode: code,
        location: undefined,
        rows,
        summary: summarizeStockRows(rows, { locationTypes }),
        models: groupStockByModel(rows, orderByLocation.get(code), { locationTypes }),
        globalSortIndex: orphanIndex++,
      });
    }

    return entries.sort((a, b) => a.globalSortIndex - b.globalSortIndex);
  }, [sortedLocations, stockByLocationCode, orderByLocation, locationSortRank, locationTypes]);

  const byLocationByZone = useMemo(() => {
    const buckets: Record<LocationStockBucket, LocationStockEntry[]> = {
      SKLEP: [],
      ZAPLECZE: [],
      OTHER: [],
    };
    for (const entry of byLocation) {
      buckets[locationStockBucket(entry.location)].push(entry);
    }
    return buckets;
  }, [byLocation]);

  const filteredByLocation = useMemo((): LocationStockEntry[] => {
    if (!searchActive) return byLocation;
    return byLocation
      .map((entry) => {
        const models = filterStockModelGroups(entry.models, skuQuery, sizeQuery);
        if (models.length === 0) return null;
        const skuSet = new Set(models.flatMap((group) => group.lines.map((line) => line.sku)));
        const rows = entry.rows.filter((row) => skuSet.has(row.sku));
        return {
          ...entry,
          rows,
          models,
          summary: summarizeStockRows(rows, { locationTypes }),
        };
      })
      .filter((entry): entry is LocationStockEntry => entry !== null);
  }, [byLocation, searchActive, skuQuery, sizeQuery, locationTypes]);

  const filteredByLocationByZone = useMemo(() => {
    const buckets: Record<LocationStockBucket, LocationStockEntry[]> = {
      SKLEP: [],
      ZAPLECZE: [],
      OTHER: [],
    };
    for (const entry of filteredByLocation) {
      buckets[locationStockBucket(entry.location)].push(entry);
    }
    return buckets;
  }, [filteredByLocation]);

  const locationZoneSource = searchActive ? filteredByLocationByZone : byLocationByZone;
  const activeLocationEntries = locationZoneSource[locationZoneTab];

  useEffect(() => {
    if (!searchActive) return;
    setExpandedModels(new Set(filteredModelGroups.map((group) => group.model)));
    setExpandedLocations(new Set(filteredByLocation.map((entry) => entry.locationCode)));
    const matchedLocationModels = new Set<string>();
    for (const entry of filteredByLocation) {
      for (const group of entry.models) {
        matchedLocationModels.add(`${entry.locationCode}::${group.model}`);
      }
    }
    setExpandedLocationModels(matchedLocationModels);
  }, [filteredByLocation, filteredModelGroups, searchActive]);

  const orderedModelsForLocation = useCallback(
    (locationCode: string) => {
      const entry = byLocation.find((row) => row.locationCode === locationCode);
      return entry?.models.map((group) => group.model) ?? [];
    },
    [byLocation],
  );

  const saveOrder = useCallback(async (locationCode: string, models: string[], quiet = false) => {
    if (!quiet) setSaveMessage(null);
    const response = await fetch(`/api/locations/${encodeURIComponent(locationCode)}/model-order`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSaveMessage(data.error ?? "Nie udalo sie zapisac kolejnosci.");
      return false;
    }
    setOrderRows((prev) => {
      const filtered = prev.filter((row) => row.locationCode !== locationCode);
      const next = models.map((model, index) => ({
        locationCode,
        model,
        sortOrder: index * 10,
      }));
      return [...filtered, ...next];
    });
    if (!quiet) setSaveMessage(`Zapisano kolejnosc dla ${locationCode}.`);
    return true;
  }, []);

  const moveModel = useCallback(
    async (locationCode: string, models: StockModelGroup[], fromIndex: number, toIndex: number) => {
      if (toIndex < 0 || toIndex >= models.length || fromIndex === toIndex) return;
      const nextModels = models.map((group) => group.model);
      const [moved] = nextModels.splice(fromIndex, 1);
      nextModels.splice(toIndex, 0, moved);
      await saveOrder(locationCode, nextModels);
    },
    [saveOrder],
  );

  const postStockMovement = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409 && data.code === "DUPLICATE_ADD_MODEL_QTY") {
      setDuplicateRisks((data.risks as ModelDuplicateAddRisk[]) ?? []);
      setDuplicateLocation(typeof data.locationCode === "string" ? data.locationCode : String(payload.toLocationCode ?? ""));
      duplicatePendingRef.current = () =>
        postStockMovement({ ...payload, confirmDuplicateAdd: true });
      setDuplicateModalOpen(true);
      throw new Error("DUPLICATE_ADD_BLOCKED");
    }
    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Nie udalo sie zapisac zmiany.");
    }
  }, []);

  const changeLocationSku = useCallback(
    async (
      locationCode: string,
      sku: string,
      currentQty: number,
      model: string,
      modelQty: number,
      orderedModels: string[],
      delta: number | "remove",
    ) => {
      const key = `${locationCode}:${sku}`;
      if (busyRef.current) return;
      const removeAll = delta === "remove" || (typeof delta === "number" && currentQty + delta <= 0);
      const qtyToRemove = removeAll ? currentQty : Math.abs(typeof delta === "number" ? delta : currentQty);
      if (removeAll) {
        const ok = window.confirm(
          `Usunac bezpowrotnie ${sku} z ${locationCode} (${currentQty} szt.)? Tej zmiany nie da sie cofnac z tego ekranu.`,
        );
        if (!ok) return;
      }
      busyRef.current = true;
      setBusyKey(key);
      setSaveMessage(null);
      try {
        if (delta === "remove" || (typeof delta === "number" && delta < 0)) {
          await postStockMovement({
            movementType: "REMOVE",
            sku,
            qty: qtyToRemove,
            fromLocationCode: locationCode,
          });
          const remainingModelQty = modelQty - qtyToRemove;
          if (remainingModelQty <= 0) {
            const nextModels = orderedModels.filter((entry) => entry !== model);
            if (nextModels.length !== orderedModels.length) {
              await saveOrder(locationCode, nextModels, true);
            }
          }
          setSaveMessage(
            removeAll
              ? `Usunieto ${sku} z ${locationCode}.`
              : `Zdjeto 1 szt. ${sku} z ${locationCode}.`,
          );
        } else {
          const risks = findModelDuplicateAddRisks(stock, locationCode, [{ sku, qty: 1 }]);
          if (risks.length > 0) {
            setDuplicateRisks(risks);
            setDuplicateLocation(locationCode);
            duplicatePendingRef.current = async () => {
              await postStockMovement({
                movementType: "ADD",
                sku,
                qty: 1,
                toLocationCode: locationCode,
                confirmDuplicateAdd: true,
              });
              if (!orderedModels.includes(model)) {
                await saveOrder(locationCode, [...orderedModels, model], true);
              }
              setSaveMessage(`Dodano 1 szt. ${sku} na ${locationCode}.`);
              onStockChanged?.();
            };
            setDuplicateModalOpen(true);
            return;
          }
          await postStockMovement({
            movementType: "ADD",
            sku,
            qty: 1,
            toLocationCode: locationCode,
          });
          if (!orderedModels.includes(model)) {
            await saveOrder(locationCode, [...orderedModels, model], true);
          }
          setSaveMessage(`Dodano 1 szt. ${sku} na ${locationCode}.`);
        }
        onStockChanged?.();
      } catch (error) {
        if (error instanceof Error && error.message === "DUPLICATE_ADD_BLOCKED") return;
        setSaveMessage(error instanceof Error ? error.message : "Nie udalo sie zapisac zmiany.");
      } finally {
        busyRef.current = false;
        setBusyKey(null);
      }
    },
    [onStockChanged, postStockMovement, saveOrder, stock],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-blue-950/55 p-3 sm:items-center">
      <div className="flex max-h-[min(92vh,860px)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-blue-100 bg-white px-4 pb-3 pt-4">
          <div>
            <h2 className="text-lg font-semibold text-blue-900">Stany</h2>
            <p className="mt-1 text-sm text-blue-700">
              {editMode
                ? "Tryb edycji — zmieniaj ilosci (+/−) na modelu lub lokalizacji."
                : "Kolejnosc to indeks na wieszaku (np. 3/20). Wlacz edycje, aby odejmowac i dodawac sztuki."}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                editMode ? "border-amber-400 bg-amber-50 text-amber-950" : "border-blue-300 bg-white text-blue-900"
              }`}
              onClick={() => setEditMode((prev) => !prev)}
            >
              {editMode ? "Zakoncz edycje" : "Edytuj stany"}
            </button>
            <button type="button" className="rounded-xl border border-blue-200 px-3 py-2 text-sm text-blue-900" onClick={onClose}>
              Zamknij
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {saveMessage ? <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-800">{saveMessage}</p> : null}

        <div className={`grid grid-cols-3 gap-2 rounded-2xl border border-blue-100 bg-blue-50/60 p-2 ${saveMessage ? "mt-3" : ""}`}>
          <button
            type="button"
            className={`rounded-2xl p-2 text-xs font-semibold sm:p-3 sm:text-sm ${tab === "list" ? "bg-white shadow" : "text-blue-900"}`}
            onClick={() => setTab("list")}
          >
            Po modelach
          </button>
          <button
            type="button"
            className={`rounded-2xl p-2 text-xs font-semibold sm:p-3 sm:text-sm ${tab === "byLocation" ? "bg-white shadow" : "text-blue-900"}`}
            onClick={() => setTab("byLocation")}
          >
            Na lokalizacjach
          </button>
          <button
            type="button"
            className={`rounded-2xl p-2 text-xs font-semibold sm:p-3 sm:text-sm ${tab === "replenish" ? "bg-white shadow" : "text-violet-900"}`}
            onClick={() => setTab("replenish")}
          >
            Uzupelnianie
          </button>
        </div>

        {tab === "replenish" ? (
          <ReplenishmentPanel
            lines={replenishLines}
            modelTargets={replenishModelTargets}
            loading={replenishLoading}
            busyId={replenishBusyId}
            onRefresh={() => void loadReplenishmentPlan()}
            onMarkPicked={markReplenishPicked}
            onConfirmMove={(line) => void confirmReplenishMove(line)}
            onSaveModelTarget={saveReplenishModelTarget}
            onOpenLocationPreview={onOpenLocationPreview}
          />
        ) : null}

        {tab !== "replenish" ? (
        <>
        {tab === "byLocation" ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-2xl border border-blue-100 bg-blue-50/60 p-1.5">
            {(["SKLEP", "ZAPLECZE", "OTHER"] as LocationStockBucket[]).map((bucket) => (
              <button
                key={bucket}
                type="button"
                className={`rounded-xl px-2 py-2 text-xs font-semibold sm:text-sm ${
                  locationZoneTab === bucket ? "bg-white text-blue-900 shadow" : "text-blue-800"
                }`}
                onClick={() => setLocationZoneTab(bucket)}
              >
                {locationStockBucketLabels[bucket]} ({locationZoneSource[bucket].length})
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
          <p className="text-sm font-semibold text-blue-900">Szukaj po SKU</p>
          <p className="mt-1 text-xs text-blue-700">
            Kod modelu (np. <span className="font-mono">KB-AN-007</span>) + opcjonalnie rozmiar (
            <span className="font-mono">110</span>) → pełny wariant{" "}
            <span className="font-mono">KB-AN-007-110</span>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="text"
              value={skuQuery}
              onChange={(event) => setSkuQuery(event.target.value)}
              placeholder="Kod SKU / model"
              className="min-w-[10rem] flex-1 rounded-xl border border-blue-200 bg-white px-3 py-2 font-mono text-sm text-blue-950"
            />
            <input
              type="text"
              value={sizeQuery}
              onChange={(event) => setSizeQuery(event.target.value)}
              placeholder="Rozmiar (opc.)"
              className="w-28 rounded-xl border border-blue-200 bg-white px-3 py-2 font-mono text-sm text-blue-950"
            />
          </div>

          {searchActive ? (
            <p className="mt-3 text-xs text-blue-700">
              {tab === "list"
                ? filteredModelGroups.length > 0
                  ? `Filtr: ${filteredModelGroups.length} modeli · ${filteredModelGroups.reduce((sum, group) => sum + group.lines.length, 0)} rozmiarow`
                  : "Brak wynikow dla podanego SKU."
                : filteredByLocation.length > 0
                  ? `Filtr: ${filteredByLocation.length} lokalizacji z dopasowanym towarem`
                  : "Brak wynikow dla podanego SKU."}
            </p>
          ) : null}
        </div>

        <div className="mt-4 space-y-2 text-sm">
          {tab === "list" ? (
            filteredModelGroups.length === 0 ? (
              <p className="text-blue-700">{searchActive ? "Brak wynikow wyszukiwania." : "Brak danych."}</p>
            ) : (
              filteredModelGroups.map((group) => {
                const collapsed = !expandedModels.has(group.model);
                return (
                <div key={group.model} className="relative rounded-2xl border border-blue-100 p-3">
                  <ModelLogButton model={group.model} className="absolute right-2 top-2 z-10" />
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-2 pr-14 text-left"
                    onClick={() => toggleSetValue(setExpandedModels, group.model)}
                    aria-expanded={!collapsed}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-xs text-blue-500" aria-hidden>
                        {collapsed ? "▶" : "▼"}
                      </span>
                      <Link
                        href={`/models/${encodeURIComponent(group.model)}`}
                        className="font-semibold text-blue-900 underline decoration-blue-300 underline-offset-2"
                        onClick={(event) => {
                          event.stopPropagation();
                          onClose();
                        }}
                      >
                        {group.model}
                      </Link>
                    </div>
                    <span className="text-xs text-blue-600">
                      <StockQtyDisplay qty={group.totalQty} damagedQty={group.damagedQty} suffix="" compact /> szt. ·{" "}
                      {group.lines.length} rozmiarow
                    </span>
                  </button>
                  {!collapsed ? (
                  <div className="mt-2 space-y-1">
                    {group.lines.map((line) => (
                      <div key={line.sku} className="rounded-xl bg-blue-50/70 px-2 py-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Link
                            href={`/models/${encodeURIComponent(group.model)}`}
                            className="font-mono text-blue-950 underline decoration-blue-200 underline-offset-2"
                            onClick={onClose}
                          >
                            {line.sku}
                          </Link>
                          <StockQtyDisplay qty={line.qty} damagedQty={line.damagedQty} className="text-blue-800" />
                        </div>
                        {editMode ? (
                          <ul className="mt-2 space-y-1.5">
                            {line.locations.map((loc) => {
                              const lineKey = `${loc.locationCode}:${line.sku}`;
                              const lineBusy = busyKey === lineKey;
                              const orderedModels = orderedModelsForLocation(loc.locationCode);
                              return (
                                <li
                                  key={loc.locationCode}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100/80 bg-white/80 px-2 py-1.5"
                                >
                                  <span className="text-xs font-semibold text-blue-900">{loc.locationCode}</span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-300 bg-white text-base font-bold text-blue-900 disabled:opacity-40"
                                      disabled={Boolean(busyKey) || loc.qty <= 0}
                                      onClick={() =>
                                        void changeLocationSku(
                                          loc.locationCode,
                                          line.sku,
                                          loc.qty,
                                          group.model,
                                          group.totalQty,
                                          orderedModels,
                                          -1,
                                        )
                                      }
                                    >
                                      −
                                    </button>
                                    <span className="min-w-6 text-center text-xs font-semibold tabular-nums">
                                      {lineBusy ? "…" : loc.qty}
                                    </span>
                                    <button
                                      type="button"
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-300 bg-white text-base font-bold text-blue-900 disabled:opacity-40"
                                      disabled={Boolean(busyKey)}
                                      onClick={() =>
                                        void changeLocationSku(
                                          loc.locationCode,
                                          line.sku,
                                          loc.qty,
                                          group.model,
                                          group.totalQty,
                                          orderedModels,
                                          1,
                                        )
                                      }
                                    >
                                      +
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="mt-1 text-[11px] text-blue-700">
                            {line.locations.map((loc) => `${loc.locationCode} (${loc.qty})`).join(" · ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  ) : null}
                </div>
              );
              })
            )
          ) : activeLocationEntries.length === 0 ? (
            <p className="text-blue-700">Brak lokalizacji w tej strefie.</p>
          ) : (
            activeLocationEntries.map(({ locationCode, location, summary, models, globalSortIndex }) => {
              const isShop = location?.parentZone === "SKLEP";
              const reorderOpen = reorderLocation === locationCode;
              const orderedModels = models.map((group) => group.model);
              const locationCollapsed = !expandedLocations.has(locationCode);
              const pickOrderLabel = location
                ? `${globalSortIndex + 1}/${sortedLocations.length}`
                : null;
              return (
                <div key={locationCode} className="rounded-2xl border border-blue-100 p-3">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left"
                    onClick={() => toggleSetValue(setExpandedLocations, locationCode)}
                    aria-expanded={!locationCollapsed}
                  >
                    <p className="font-semibold text-blue-900">
                      <span className="mr-2 text-xs text-blue-500" aria-hidden>
                        {locationCollapsed ? "▶" : "▼"}
                      </span>
                      {pickOrderLabel ? (
                        <span className="mr-2 rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-blue-800">
                          {pickOrderLabel}
                        </span>
                      ) : null}
                      {locationCode}
                      {location?.name ? <span className="ml-2 font-normal text-blue-700">— {location.name}</span> : null}
                    </p>
                    <span className="text-xs text-blue-600">
                      {zoneLabel(location?.parentZone)} ·{" "}
                      <StockQtyDisplay qty={summary.totalQty} damagedQty={summary.damagedQty} suffix="" compact /> szt. ·{" "}
                      {summary.modelCount} modeli
                    </span>
                  </button>
                  {!locationCollapsed ? (
                  <>
                  {isShop ? (
                    <button
                      type="button"
                      className="mt-2 rounded-lg border border-blue-200 px-2 py-1 text-xs font-medium text-blue-800"
                      onClick={() => setReorderLocation(reorderOpen ? null : locationCode)}
                    >
                      {reorderOpen ? "Zamknij ukladanie" : "Zmien kolejnosc modeli"}
                    </button>
                  ) : null}
                  <div className="mt-2 space-y-2">
                    {models.length === 0 ? (
                      <p className="rounded-xl bg-blue-50/80 px-3 py-2 text-xs text-blue-700">Brak stanu na tej lokalizacji.</p>
                    ) : null}
                    {models.map((group, index) => {
                      const locationModelKey = `${locationCode}::${group.model}`;
                      const modelCollapsed = !expandedLocationModels.has(locationModelKey);
                      return (
                      <div
                        key={`${locationCode}-${group.model}`}
                        draggable={reorderOpen}
                        onDragStart={() => setDragModel(group.model)}
                        onDragOver={(e) => reorderOpen && e.preventDefault()}
                        onDrop={() => {
                          if (!reorderOpen || !dragModel || dragModel === group.model) return;
                          const fromIndex = models.findIndex((entry) => entry.model === dragModel);
                          void moveModel(locationCode, models, fromIndex, index);
                          setDragModel(null);
                        }}
                        className={`relative rounded-xl bg-blue-50/60 px-2 py-1.5 ${reorderOpen ? "border border-dashed border-blue-300" : ""}`}
                      >
                        {!reorderOpen ? (
                          <ModelLogButton model={group.model} className="absolute right-1 top-1 z-10" />
                        ) : null}
                        <button
                          type="button"
                          className={`flex w-full flex-wrap items-center justify-between gap-2 text-left ${!reorderOpen ? "pr-12" : ""}`}
                          onClick={() => toggleSetValue(setExpandedLocationModels, locationModelKey)}
                          aria-expanded={!modelCollapsed}
                        >
                          <div className="flex items-center gap-2">
                            {!reorderOpen ? (
                              <span className="text-xs text-blue-500" aria-hidden>
                                {modelCollapsed ? "▶" : "▼"}
                              </span>
                            ) : null}
                            {reorderOpen ? (
                              <span className="cursor-grab text-blue-400" aria-hidden>
                                ⠿
                              </span>
                            ) : null}
                            <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-blue-800">
                              {index + 1}/{models.length}
                            </span>
                            <Link
                              href={`/models/${encodeURIComponent(group.model)}`}
                              className="font-medium text-blue-900 underline decoration-blue-200 underline-offset-2"
                              onClick={(event) => {
                                event.stopPropagation();
                                onClose();
                              }}
                            >
                              {group.model}
                            </Link>
                          </div>
                          <div className="flex items-center gap-1">
                            {reorderOpen ? (
                              <>
                                <button
                                  type="button"
                                  className="rounded border border-blue-200 px-1.5 py-0.5 text-xs text-blue-800 disabled:opacity-40"
                                  disabled={index === 0}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void moveModel(locationCode, models, index, index - 1);
                                  }}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="rounded border border-blue-200 px-1.5 py-0.5 text-xs text-blue-800 disabled:opacity-40"
                                  disabled={index === models.length - 1}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void moveModel(locationCode, models, index, index + 1);
                                  }}
                                >
                                  ↓
                                </button>
                              </>
                            ) : null}
                            <span className="text-xs text-blue-700">
                              <StockQtyDisplay qty={group.totalQty} damagedQty={group.damagedQty} suffix="" compact /> szt. ·{" "}
                              {group.lines.length} rozmiarow
                            </span>
                          </div>
                        </button>
                        {!modelCollapsed ? (
                        <ul className="mt-1.5 space-y-1.5">
                          {group.lines.map((line) => {
                            const lineKey = `${locationCode}:${line.sku}`;
                            const lineBusy = busyKey === lineKey;
                            return (
                              <li
                                key={line.sku}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100/80 bg-white/80 px-2.5 py-2"
                              >
                                <span className="font-mono text-xs font-semibold text-blue-900">{line.sku}</span>
                                {editMode ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-300 bg-white text-lg font-bold text-blue-900 disabled:opacity-40"
                                    disabled={Boolean(busyKey) || line.qty <= 0}
                                    onClick={() =>
                                      void changeLocationSku(
                                        locationCode,
                                        line.sku,
                                        line.qty,
                                        group.model,
                                        group.totalQty,
                                        orderedModels,
                                        -1,
                                      )
                                    }
                                    aria-label={`Zmniejsz liczbe ${line.sku}`}
                                  >
                                    −
                                  </button>
                                  <div className="min-w-8 text-center text-sm font-semibold tabular-nums text-blue-900">
                                    {lineBusy ? "…" : line.qty}
                                  </div>
                                  <button
                                    type="button"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-300 bg-white text-lg font-bold text-blue-900 disabled:opacity-40"
                                    disabled={Boolean(busyKey)}
                                    onClick={() =>
                                      void changeLocationSku(
                                        locationCode,
                                        line.sku,
                                        line.qty,
                                        group.model,
                                        group.totalQty,
                                        orderedModels,
                                        1,
                                      )
                                    }
                                    aria-label={`Zwieksz liczbe ${line.sku}`}
                                  >
                                    +
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-lg border border-red-200 bg-white px-2 py-1 text-[10px] font-medium text-red-700 disabled:opacity-40"
                                    disabled={Boolean(busyKey)}
                                    onClick={() =>
                                      void changeLocationSku(
                                        locationCode,
                                        line.sku,
                                        line.qty,
                                        group.model,
                                        group.totalQty,
                                        orderedModels,
                                        "remove",
                                      )
                                    }
                                  >
                                    Usun
                                  </button>
                                </div>
                                ) : (
                                  <StockQtyDisplay qty={line.qty} damagedQty={line.damagedQty} className="text-xs text-blue-800" compact />
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        ) : null}
                      </div>
                    );
                    })}
                  </div>
                  </>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
        </>
        ) : null}
        </div>
      </div>

      <AddDuplicateConfirmModal
        open={duplicateModalOpen}
        locationCode={duplicateLocation}
        risks={duplicateRisks}
        busy={duplicateBusy}
        onCancel={() => {
          setDuplicateModalOpen(false);
          duplicatePendingRef.current = null;
        }}
        onConfirm={() => {
          const run = duplicatePendingRef.current;
          if (!run) {
            setDuplicateModalOpen(false);
            return;
          }
          setDuplicateBusy(true);
          void run()
            .catch((error) => {
              if (error instanceof Error && error.message !== "DUPLICATE_ADD_BLOCKED") {
                setSaveMessage(error.message);
              }
            })
            .finally(() => {
              setDuplicateBusy(false);
              duplicatePendingRef.current = null;
              setDuplicateModalOpen(false);
            });
        }}
      />
    </div>
  );
}

function zoneLabel(zone: Zone | undefined): string {
  if (!zone) return "Strefa: ?";
  return zoneLabels[zone] ?? zone;
}
