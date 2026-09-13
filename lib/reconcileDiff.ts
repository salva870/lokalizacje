import { parseSkuModel } from "@/lib/skuModel";

export type ReconcileStockLine = { sku: string; qty: number };

export type ReconcileQtyChange = { sku: string; fromQty: number; toQty: number };

export type ReconcileDiff = {
  /** SKU obecne w skanie, ktorych nie bylo na lokalizacji. */
  added: ReconcileStockLine[];
  /** SKU z dotychczasowego stanu, ktorych nie ma w skanie. */
  removed: ReconcileStockLine[];
  /** Ten sam SKU, inna ilosc. */
  qtyChanged: ReconcileQtyChange[];
};

export type ReconcileDiffOptions = {
  /** Kolejnosc modeli zapisana na lokalizacji (do sortowania „brakuje”). */
  savedModelOrder?: string[];
};

function aggregateBySku(lines: ReconcileStockLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of lines) {
    const sku = row.sku.trim().toUpperCase();
    if (!sku) continue;
    map.set(sku, (map.get(sku) ?? 0) + Math.max(0, Math.floor(row.qty)));
  }
  return map;
}

/** Pierwsze pojawienie SKU w kolejce (kolejnosc listy do zapisania). */
export function buildSkuScanOrder(scanned: ReconcileStockLine[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const row of scanned) {
    const sku = row.sku.trim().toUpperCase();
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    order.push(sku);
  }
  return order;
}

function sortRemovedBySavedModelOrder(
  items: ReconcileStockLine[],
  savedModelOrder: string[],
): ReconcileStockLine[] {
  if (savedModelOrder.length === 0) return items;
  const modelRank = new Map(savedModelOrder.map((model, index) => [model.trim().toUpperCase(), index]));
  const indexed = items.map((item, index) => ({ item, index }));
  return indexed
    .sort((a, b) => {
      const modelA = parseSkuModel(a.item.sku).model;
      const modelB = parseSkuModel(b.item.sku).model;
      const ra = modelRank.get(modelA) ?? Number.MAX_SAFE_INTEGER;
      const rb = modelRank.get(modelB) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      const sizeCmp = parseSkuModel(a.item.sku).size.localeCompare(parseSkuModel(b.item.sku).size, undefined, {
        numeric: true,
      });
      if (sizeCmp !== 0) return sizeCmp;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/** Porownanie zapisanego stanu lokalizacji z nowym skanem. */
export function diffReconcileStock(
  currentAtLocation: ReconcileStockLine[],
  scanned: ReconcileStockLine[],
  options?: ReconcileDiffOptions,
): ReconcileDiff {
  const current = aggregateBySku(currentAtLocation);
  const next = aggregateBySku(scanned);
  const scanOrder = buildSkuScanOrder(scanned);
  const added: ReconcileStockLine[] = [];
  const removed: ReconcileStockLine[] = [];
  const qtyChanged: ReconcileQtyChange[] = [];

  for (const sku of scanOrder) {
    const toQty = next.get(sku);
    if (toQty == null) continue;
    if (!current.has(sku)) {
      added.push({ sku, qty: toQty });
      continue;
    }
    const fromQty = current.get(sku) ?? 0;
    if (fromQty !== toQty) {
      qtyChanged.push({ sku, fromQty, toQty });
    }
  }

  for (const [sku, fromQty] of current) {
    if (!next.has(sku)) {
      removed.push({ sku, qty: fromQty });
    }
  }

  return {
    added,
    removed: sortRemovedBySavedModelOrder(removed, options?.savedModelOrder ?? []),
    qtyChanged,
  };
}

export function reconcileDiffHasChanges(diff: ReconcileDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.qtyChanged.length > 0;
}
