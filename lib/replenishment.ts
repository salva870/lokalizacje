import { comparePickStockLocations, type PickStockLocation } from "@/lib/pickPriority";
import { isExcludedFromPickAndRestore, isDamagedStockAt } from "@/lib/stockClassification";
import { parseSkuModel } from "@/lib/skuModel";
import type { LocationType, Zone } from "@/lib/types";

export const DEFAULT_MODEL_SHOP_DISPLAY_TARGET = 2;

export type ReplenishmentLocationMeta = {
  code: string;
  name: string;
  parentZone: Zone;
  locationType: LocationType;
  sortOrder?: number;
  isActive: boolean;
};

export type ReplenishmentStockRow = {
  locationCode: string;
  sku: string;
  qty: number;
};

export type ReplenishmentTransfer = {
  id: string;
  model: string;
  sku: string;
  size: string;
  fromLocationCode: string;
  fromLocationName: string;
  toLocationCode: string;
  toLocationName: string;
  qty: number;
  currentShopQty: number;
  targetQty: number;
};

export type ReplenishmentPlan = {
  transfers: ReplenishmentTransfer[];
  modelTargets: Array<{ model: string; targetQty: number }>;
};

function normalizeTargetMap(
  modelTargets: Map<string, number> | Record<string, number> | undefined,
): Map<string, number> {
  if (!modelTargets) return new Map();
  if (modelTargets instanceof Map) {
    return new Map(
      [...modelTargets.entries()].map(([model, qty]) => [model.trim().toUpperCase(), Math.max(0, Math.floor(qty))]),
    );
  }
  return new Map(
    Object.entries(modelTargets).map(([model, qty]) => [model.trim().toUpperCase(), Math.max(0, Math.floor(qty))]),
  );
}

function targetQtyForModel(model: string, targets: Map<string, number>): number {
  const key = model.trim().toUpperCase();
  const custom = targets.get(key);
  if (custom !== undefined) return custom;
  return DEFAULT_MODEL_SHOP_DISPLAY_TARGET;
}

function locationMetaByCode(
  locations: ReplenishmentLocationMeta[],
): Map<string, ReplenishmentLocationMeta> {
  return new Map(locations.map((loc) => [loc.code.trim().toUpperCase(), loc]));
}

function isReplenishableShopLocation(
  code: string,
  meta: ReplenishmentLocationMeta | undefined,
): boolean {
  if (!meta?.isActive) return false;
  if (meta.parentZone !== "SKLEP") return false;
  return !isExcludedFromPickAndRestore(code, meta.locationType);
}

function isReplenishableBackroomLocation(
  code: string,
  meta: ReplenishmentLocationMeta | undefined,
): boolean {
  if (!meta?.isActive) return false;
  if (meta.parentZone !== "ZAPLECZE") return false;
  if (isDamagedStockAt(code, meta.locationType)) return false;
  return true;
}

function pickRowFromMeta(meta: ReplenishmentLocationMeta): PickStockLocation {
  return {
    locationCode: meta.code,
    qty: 1,
    parentZone: meta.parentZone,
    locationType: meta.locationType,
    sortOrder: meta.sortOrder,
  };
}

/**
 * Plan przeniesien z zaplecza do sklepu: tylko to, co da sie fizycznie przeniesc.
 * Modele bez stanu w strefie SKLEP nie wchodza do planu.
 */
export function buildReplenishmentPlan(
  stock: ReplenishmentStockRow[],
  locations: ReplenishmentLocationMeta[],
  modelTargets?: Map<string, number> | Record<string, number>,
): ReplenishmentPlan {
  const targets = normalizeTargetMap(modelTargets);
  const metaByCode = locationMetaByCode(locations);
  const locationNames = new Map(locations.map((loc) => [loc.code.trim().toUpperCase(), loc.name]));

  const modelsOnShop = new Set<string>();
  for (const row of stock) {
    const qty = Math.max(0, Math.floor(row.qty));
    if (qty <= 0) continue;
    const locCode = row.locationCode.trim().toUpperCase();
    const meta = metaByCode.get(locCode);
    if (!isReplenishableShopLocation(locCode, meta)) continue;
    modelsOnShop.add(parseSkuModel(row.sku).model);
  }

  const backroomBySku = new Map<string, Map<string, number>>();
  for (const row of stock) {
    const qty = Math.max(0, Math.floor(row.qty));
    if (qty <= 0) continue;
    const locCode = row.locationCode.trim().toUpperCase();
    const meta = metaByCode.get(locCode);
    if (!isReplenishableBackroomLocation(locCode, meta)) continue;
    const sku = row.sku.trim().toUpperCase();
    const bucket = backroomBySku.get(sku) ?? new Map<string, number>();
    bucket.set(locCode, (bucket.get(locCode) ?? 0) + qty);
    backroomBySku.set(sku, bucket);
  }

  const sortedBackroomLocations = (sku: string): string[] => {
    const bucket = backroomBySku.get(sku);
    if (!bucket || bucket.size === 0) return [];
    const rows: PickStockLocation[] = [];
    for (const [locationCode, qty] of bucket.entries()) {
      if (qty <= 0) continue;
      const meta = metaByCode.get(locationCode);
      if (!meta) continue;
      rows.push({ ...pickRowFromMeta(meta), locationCode, qty });
    }
    return rows.sort(comparePickStockLocations).map((row) => row.locationCode);
  };

  const takeFromBackroom = (sku: string, amount: number): Array<{ fromLocationCode: string; qty: number }> => {
    const bucket = backroomBySku.get(sku);
    if (!bucket || amount <= 0) return [];
    const order = sortedBackroomLocations(sku);
    const chunks: Array<{ fromLocationCode: string; qty: number }> = [];
    let left = amount;
    for (const fromCode of order) {
      const available = bucket.get(fromCode) ?? 0;
      if (available <= 0) continue;
      const take = Math.min(left, available);
      bucket.set(fromCode, available - take);
      chunks.push({ fromLocationCode: fromCode, qty: take });
      left -= take;
      if (left <= 0) break;
    }
    return chunks;
  };

  const transfers: ReplenishmentTransfer[] = [];
  const modelsInPlan = new Set<string>();

  const shopRows = stock
    .map((row) => ({
      locationCode: row.locationCode.trim().toUpperCase(),
      sku: row.sku.trim().toUpperCase(),
      qty: Math.max(0, Math.floor(row.qty)),
    }))
    .filter((row) => row.sku && row.locationCode)
    .sort(
      (a, b) =>
        a.locationCode.localeCompare(b.locationCode) ||
        parseSkuModel(a.sku).model.localeCompare(parseSkuModel(b.sku).model) ||
        a.sku.localeCompare(b.sku),
    );

  for (const row of shopRows) {
    const meta = metaByCode.get(row.locationCode);
    if (!isReplenishableShopLocation(row.locationCode, meta)) continue;
    const { model, size } = parseSkuModel(row.sku);
    if (!modelsOnShop.has(model)) continue;

    const targetQty = targetQtyForModel(model, targets);
    const need = targetQty - row.qty;
    if (need <= 0) continue;

    const chunks = takeFromBackroom(row.sku, need);
    if (chunks.length === 0) continue;

    modelsInPlan.add(model);
    for (const chunk of chunks) {
      const id = `${chunk.fromLocationCode}:${row.locationCode}:${row.sku}:${transfers.length}`;
      transfers.push({
        id,
        model,
        sku: row.sku,
        size,
        fromLocationCode: chunk.fromLocationCode,
        fromLocationName: locationNames.get(chunk.fromLocationCode) ?? chunk.fromLocationCode,
        toLocationCode: row.locationCode,
        toLocationName: locationNames.get(row.locationCode) ?? row.locationCode,
        qty: chunk.qty,
        currentShopQty: row.qty,
        targetQty,
      });
    }
  }

  const modelTargetsList = [...modelsInPlan]
    .sort((a, b) => a.localeCompare(b))
    .map((model) => ({ model, targetQty: targetQtyForModel(model, targets) }));

  return { transfers, modelTargets: modelTargetsList };
}
