import { parseSkuModel } from "@/lib/skuModel";
import { sortGroupsByModelOrder } from "@/lib/modelOrder";
import { isDamagedStockAt } from "@/lib/stockClassification";
import type { LocationType } from "@/lib/types";

export type StockRow = { locationCode: string; sku: string; qty: number };

export type StockLocationLine = {
  locationCode: string;
  qty: number;
  damaged?: boolean;
};

export type StockModelLine = {
  sku: string;
  size: string;
  /** Stan do sprzedazy / picklisty (bez uszkodzonych). */
  qty: number;
  damagedQty: number;
  locations: StockLocationLine[];
};

export type StockModelGroup = {
  model: string;
  totalQty: number;
  damagedQty: number;
  lines: StockModelLine[];
};

export type StockGroupingOptions = {
  locationTypes?: Map<string, LocationType>;
};

function rowIsDamaged(row: StockRow, options?: StockGroupingOptions): boolean {
  const type = options?.locationTypes?.get(row.locationCode.toUpperCase());
  return isDamagedStockAt(row.locationCode, type);
}

export function groupStockByModel(
  stock: StockRow[],
  modelOrder?: string[] | Map<string, number>,
  options?: StockGroupingOptions,
): StockModelGroup[] {
  const map = new Map<string, StockModelGroup>();
  const encounterOrder: string[] = [];
  for (const row of stock) {
    const sku = row.sku.trim().toUpperCase();
    if (!sku) continue;
    const damaged = rowIsDamaged(row, options);
    const { model, size } = parseSkuModel(sku);
    let group = map.get(model);
    if (!group) {
      group = { model, totalQty: 0, damagedQty: 0, lines: [] };
      map.set(model, group);
      encounterOrder.push(model);
    }
    if (damaged) {
      group.damagedQty += row.qty;
    } else {
      group.totalQty += row.qty;
    }
    let line = group.lines.find((entry) => entry.sku === sku);
    if (!line) {
      line = { sku, size, qty: 0, damagedQty: 0, locations: [] };
      group.lines.push(line);
    }
    if (damaged) {
      line.damagedQty += row.qty;
    } else {
      line.qty += row.qty;
    }
    line.locations.push({ locationCode: row.locationCode, qty: row.qty, damaged });
  }
  for (const group of map.values()) {
    group.lines.sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));
    for (const line of group.lines) {
      line.locations.sort((a, b) => a.locationCode.localeCompare(b.locationCode));
    }
  }
  const groups = encounterOrder.map((model) => map.get(model)!).filter(Boolean);
  if (modelOrder && (modelOrder instanceof Map ? modelOrder.size > 0 : modelOrder.length > 0)) {
    return sortGroupsByModelOrder(groups, modelOrder);
  }
  return groups;
}

export function summarizeStockRows(
  rows: StockRow[],
  options?: StockGroupingOptions,
): { totalQty: number; damagedQty: number; modelCount: number; skuCount: number } {
  const models = new Set<string>();
  const skus = new Set<string>();
  let totalQty = 0;
  let damagedQty = 0;
  for (const row of rows) {
    if (rowIsDamaged(row, options)) {
      damagedQty += row.qty;
    } else {
      totalQty += row.qty;
    }
    skus.add(row.sku);
    models.add(parseSkuModel(row.sku).model);
  }
  return { totalQty, damagedQty, modelCount: models.size, skuCount: skus.size };
}

export function stockRowsForModel(
  stock: StockRow[],
  modelCode: string,
  options?: StockGroupingOptions,
): StockModelGroup | null {
  const normalized = modelCode.trim().toUpperCase();
  return groupStockByModel(stock, undefined, options).find((group) => group.model === normalized) ?? null;
}

export function modelQtyAtLocation(
  stockRows: StockRow[],
  locationCode: string,
  model: string,
): number {
  const loc = locationCode.trim().toUpperCase();
  const targetModel = model.trim().toUpperCase();
  if (!loc || !targetModel) return 0;
  return stockRows
    .filter(
      (row) =>
        row.locationCode.toUpperCase() === loc &&
        parseSkuModel(row.sku).model === targetModel &&
        row.qty > 0,
    )
    .reduce((sum, row) => sum + row.qty, 0);
}
