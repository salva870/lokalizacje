import { parseSkuModel } from "@/lib/skuModel";
import type { StockModelGroup, StockModelLine } from "@/lib/stockViews";

export function stockLocationSkuKey(locationCode: string, sku: string): string {
  const loc = locationCode.trim().toUpperCase();
  const normalizedSku = sku.trim().toUpperCase();
  return `${loc}:${normalizedSku}`;
}

export function parseStockLocationSkuKey(key: string): { locationCode: string; sku: string } | null {
  const trimmed = key.trim();
  const sep = trimmed.indexOf(":");
  if (sep <= 0) return null;
  return {
    locationCode: trimmed.slice(0, sep),
    sku: trimmed.slice(sep + 1),
  };
}

export function hasZeroPinsForLocation(pinnedKeys: ReadonlySet<string>, locationCode: string): boolean {
  const loc = locationCode.trim().toUpperCase();
  const prefix = `${loc}:`;
  for (const key of pinnedKeys) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

export function pinZeroStockRow(
  pinnedKeys: ReadonlySet<string>,
  locationCode: string,
  sku: string,
): Set<string> {
  const next = new Set(pinnedKeys);
  next.add(stockLocationSkuKey(locationCode, sku));
  return next;
}

export function unpinZeroStockRow(
  pinnedKeys: ReadonlySet<string>,
  locationCode: string,
  sku: string,
): Set<string> {
  const next = new Set(pinnedKeys);
  next.delete(stockLocationSkuKey(locationCode, sku));
  return next;
}

type LocationQtyRow = { locationCode: string; qty: number; damaged?: boolean };

/** W trybie edycji pokaz lokalizacje ze stanem 0 po ostatnim zdjeciu (mozliwosc +). */
export function mergeStockLocationsWithZeroPins(
  locations: LocationQtyRow[],
  sku: string,
  pinnedKeys: ReadonlySet<string>,
): LocationQtyRow[] {
  const skuNorm = sku.trim().toUpperCase();
  const map = new Map(locations.map((row) => [row.locationCode.toUpperCase(), row]));

  for (const key of pinnedKeys) {
    const parsed = parseStockLocationSkuKey(key);
    if (!parsed || parsed.sku !== skuNorm) continue;
    if (!map.has(parsed.locationCode)) {
      map.set(parsed.locationCode, { locationCode: parsed.locationCode, qty: 0 });
    }
  }

  return [...map.values()].sort((a, b) => a.locationCode.localeCompare(b.locationCode));
}

/** Dodaj sztuki z pinow (qty 0) do listy rozmiarow na jednej lokalizacji. */
export function mergeLocationSkuLinesWithZeroPins(
  lines: StockModelLine[],
  locationCode: string,
  model: string,
  pinnedKeys: ReadonlySet<string>,
): StockModelLine[] {
  const loc = locationCode.trim().toUpperCase();
  const modelNorm = model.trim().toUpperCase();
  const map = new Map(lines.map((line) => [line.sku, line]));

  for (const key of pinnedKeys) {
    const parsed = parseStockLocationSkuKey(key);
    if (!parsed || parsed.locationCode !== loc) continue;
    if (parseSkuModel(parsed.sku).model !== modelNorm) continue;
    if (map.has(parsed.sku)) continue;
    map.set(parsed.sku, {
      sku: parsed.sku,
      size: parseSkuModel(parsed.sku).size,
      qty: 0,
      damagedQty: 0,
      locations: [{ locationCode: loc, qty: 0 }],
    });
  }

  return [...map.values()].sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));
}

/** Gdy caly model zniknal ze stanu na lokalizacji, zostaw go w edycji (piny). */
export function augmentLocationModelGroupsWithZeroPins(
  groups: StockModelGroup[],
  locationCode: string,
  pinnedKeys: ReadonlySet<string>,
): StockModelGroup[] {
  const loc = locationCode.trim().toUpperCase();
  const byModel = new Map(groups.map((group) => [group.model, { ...group, lines: [...group.lines] }]));

  for (const key of pinnedKeys) {
    const parsed = parseStockLocationSkuKey(key);
    if (!parsed || parsed.locationCode !== loc) continue;
    const model = parseSkuModel(parsed.sku).model;
    let group = byModel.get(model);
    if (!group) {
      group = { model, totalQty: 0, damagedQty: 0, lines: [] };
      byModel.set(model, group);
    }
    if (!group.lines.some((line) => line.sku === parsed.sku)) {
      group.lines.push({
        sku: parsed.sku,
        size: parseSkuModel(parsed.sku).size,
        qty: 0,
        damagedQty: 0,
        locations: [{ locationCode: loc, qty: 0 }],
      });
      group.lines.sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));
    }
  }

  return [...byModel.values()];
}
