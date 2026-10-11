import { parseSkuModel } from "@/lib/skuModel";
import { skuQtyAtLocation, type StockRow } from "@/lib/stockViews";

export type DuplicateAddRisk = {
  sku: string;
  model: string;
  existingQty: number;
  addingQty: number;
};

/** @deprecated uzyj DuplicateAddRisk */
export type ModelDuplicateAddRisk = DuplicateAddRisk;

export type AddLine = { sku: string; qty: number };

/**
 * Ryzyko podwojenia per kod produktu (SKU): na lokalizacji jest juz tyle samo sztuk
 * tego samego SKU, ile operator dodaje w tej operacji.
 * Nie porownujemy sumy modelu — inny rozmiar tego modelu nie powinien blokowac dodania.
 */
export function findDuplicateAddRisks(
  stock: StockRow[],
  toLocationCode: string,
  lines: AddLine[],
): DuplicateAddRisk[] {
  const to = toLocationCode.trim().toUpperCase();
  if (!to) return [];

  const addingBySku = new Map<string, number>();
  for (const line of lines) {
    const sku = line.sku.trim().toUpperCase();
    const qty = line.qty;
    if (!sku || qty <= 0) continue;
    addingBySku.set(sku, (addingBySku.get(sku) ?? 0) + qty);
  }

  const risks: DuplicateAddRisk[] = [];
  for (const [sku, addingQty] of addingBySku) {
    const existingQty = skuQtyAtLocation(stock, to, sku);
    if (existingQty > 0 && addingQty === existingQty) {
      risks.push({
        sku,
        model: parseSkuModel(sku).model,
        existingQty,
        addingQty,
      });
    }
  }

  risks.sort((a, b) => a.sku.localeCompare(b.sku, "pl"));
  return risks;
}

/** @deprecated */
export const findModelDuplicateAddRisks = findDuplicateAddRisks;
