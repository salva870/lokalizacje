import type { StockRow } from "@/lib/stockViews";

export type StockLine = { sku: string; qty: number };

export function qtyAtLocation(rows: StockRow[], locationCode: string, sku: string): number {
  const loc = locationCode.trim().toUpperCase();
  const target = sku.trim().toUpperCase();
  if (!loc || !target) return 0;
  return rows
    .filter((row) => row.locationCode.toUpperCase() === loc && row.sku.toUpperCase() === target)
    .reduce((sum, row) => sum + row.qty, 0);
}

export async function fetchStockRows(): Promise<StockRow[]> {
  const response = await fetch("/api/stock", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Nie udalo sie pobrac stanu z serwera.");
  }
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.stock) ? data.stock : [];
}

/** Sprawdza, czy po ADD stan na lokalizacji wzrosl o oczekiwana ilosc (na podstawie stanu sprzed operacji). */
export function findUnconfirmedAdds(
  locationCode: string,
  lines: StockLine[],
  before: StockRow[],
  after: StockRow[],
): string[] {
  const loc = locationCode.trim().toUpperCase();
  const problems: string[] = [];
  for (const line of lines) {
    const sku = line.sku.trim().toUpperCase();
    const delta = Math.max(1, Math.floor(line.qty));
    if (!sku) continue;
    const beforeQty = qtyAtLocation(before, loc, sku);
    const afterQty = qtyAtLocation(after, loc, sku);
    if (afterQty < beforeQty + delta) {
      problems.push(`${sku} (bylo ${beforeQty}, jest ${afterQty}, oczekiwano +${delta})`);
    }
  }
  return problems;
}