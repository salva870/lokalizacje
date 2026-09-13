import { parseSkuModel } from "@/lib/skuModel";
import { isDamagedStockAt } from "@/lib/stockClassification";
import { stockRowsForModel, type StockModelGroup, type StockRow } from "@/lib/stockViews";
import type { LocationType } from "@/lib/types";

export type SkuLocationRow = { locationCode: string; qty: number };

export type SkuLookupResult = {
  query: string;
  sizeQuery: string;
  variantSku: string;
  model: string;
  variantLocations: SkuLocationRow[];
  variantQty: number;
  modelGroup: StockModelGroup | null;
  /** true, gdy szukamy konkretnego rozmiaru (SKU-rozmiar albo osobne pole rozmiaru). */
  hasVariantQuery: boolean;
};

/** Parent SKU + rozmiar → pełny kod wariantu (np. KB-AN-007 + 110 → KB-AN-007-110). */
export function buildVariantSku(parentSku: string, size: string | number | null | undefined): string {
  const parent = String(parentSku ?? "").trim().toUpperCase();
  const sizeStr = String(size ?? "").trim();
  if (!parent) return "";
  if (!sizeStr || sizeStr === "N/A") return parent;
  return `${parent}-${sizeStr}`.toUpperCase();
}

function locationsForSku(stock: StockRow[], sku: string): SkuLocationRow[] {
  const normalized = sku.trim().toUpperCase();
  if (!normalized) return [];
  return stock
    .filter((row) => row.sku === normalized)
    .map((row) => ({ locationCode: row.locationCode, qty: row.qty }))
    .sort((a, b) => a.locationCode.localeCompare(b.locationCode));
}

function resolveModelCode(stock: StockRow[], query: string, sizeQuery: string, variantSku: string): string {
  const q = query.trim().toUpperCase();
  if (sizeQuery) {
    return parseSkuModel(buildVariantSku(q, sizeQuery)).model;
  }
  if (stock.some((row) => row.sku.startsWith(`${q}-`))) {
    return q;
  }
  const exact = stock.find((row) => row.sku === q);
  if (exact) {
    return parseSkuModel(exact.sku).model;
  }
  return parseSkuModel(q).model;
}

/** Wyszukuje wariant (dokładny SKU) oraz cały model w bieżącym stanie magazynu. */
export function lookupSkuInStock(
  stock: StockRow[],
  query: string,
  sizeQuery = "",
): SkuLookupResult | null {
  const q = query.trim().toUpperCase();
  if (!q) return null;

  const sizeStr = String(sizeQuery ?? "").trim();
  const parsedQuery = parseSkuModel(q);
  const isModelOnly =
    !sizeStr && stock.some((row) => row.sku.startsWith(`${q}-`));
  const variantSku = sizeStr ? buildVariantSku(q, sizeStr) : isModelOnly ? "" : q;
  const model = resolveModelCode(stock, q, sizeStr, variantSku);
  const hasVariantQuery = Boolean(sizeStr) || (!isModelOnly && parsedQuery.size !== "");

  const variantLocations = variantSku ? locationsForSku(stock, variantSku) : [];
  const variantQty = variantLocations.reduce((sum, row) => sum + row.qty, 0);
  const modelGroup = stockRowsForModel(stock, model);

  return {
    query: q,
    sizeQuery: sizeStr,
    variantSku,
    model,
    variantLocations,
    variantQty,
    modelGroup,
    hasVariantQuery,
  };
}

/** Zawęża grupy modeli do dopasowanego kodu / rozmiaru (bez osobnego widoku podglądu). */
function isExactVariantSkuQuery(
  q: string,
  parsedQuery: { model: string; size: string },
  groups: StockModelGroup[],
): boolean {
  if (groups.some((g) => g.lines.some((l) => l.sku === q))) return true;
  if (!parsedQuery.size) return false;
  // Prefiks modelu (np. S-T-0 → S-T-034): filtruj listę, nie szukaj dokładnego wariantu S-T-0.
  if (groups.some((g) => g.model.startsWith(q) && g.model !== q)) return false;
  return groups.some((g) => g.model === parsedQuery.model);
}

function groupMatchesQuery(group: StockModelGroup, q: string): boolean {
  return (
    group.model === q ||
    group.model.startsWith(q) ||
    group.lines.some(
      (line) =>
        line.sku === q ||
        line.sku.startsWith(q) ||
        line.sku.startsWith(`${q}-`) ||
        line.sku.includes(q),
    )
  );
}

export function filterStockModelGroups(
  groups: StockModelGroup[],
  query: string,
  sizeQuery = "",
): StockModelGroup[] {
  const q = query.trim().toUpperCase();
  if (!q) return groups;

  const sizeStr = String(sizeQuery ?? "").trim();
  const parsedQuery = parseSkuModel(q);

  return groups
    .map((group) => {
      if (!groupMatchesQuery(group, q) && !sizeStr) return null;

      let lines = group.lines;

      if (sizeStr) {
        const variantSku = buildVariantSku(
          group.model === q || group.model.startsWith(q) ? group.model : parsedQuery.model || q,
          sizeStr,
        );
        lines = lines.filter(
          (line) =>
            line.sku === variantSku ||
            line.size === sizeStr ||
            line.sku.endsWith(`-${sizeStr}`),
        );
      } else if (isExactVariantSkuQuery(q, parsedQuery, groups)) {
        if (groups.some((g) => g.model === parsedQuery.model)) {
          const variantSku = buildVariantSku(parsedQuery.model, parsedQuery.size);
          lines = lines.filter((line) => line.sku === q || line.sku === variantSku);
        } else {
          lines = lines.filter((line) => line.sku === q);
        }
      }

      if (lines.length === 0) return null;

      return {
        ...group,
        lines,
        totalQty: lines.reduce((sum, line) => sum + line.qty, 0),
        damagedQty: lines.reduce((sum, line) => sum + line.damagedQty, 0),
      };
    })
    .filter((group): group is StockModelGroup => group !== null);
}

export type SkuSuggestion = {
  sku: string;
  qty: number;
};

function skuMatchesSuggestionQuery(sku: string, query: string): boolean {
  return sku === query || sku.startsWith(query) || sku.includes(query);
}

/** Podpowiedzi konkretnych SKU ze stanu (do wyboru z listy, bez recznego rozmiaru). */
export function searchSkuSuggestions(
  stock: StockRow[],
  query: string,
  options?: {
    locationCode?: string;
    limit?: number;
    excludeDamaged?: boolean;
    locationTypes?: Map<string, LocationType>;
  },
): SkuSuggestion[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];

  const limit = options?.limit ?? 12;
  const locationFilter = options?.locationCode?.trim().toUpperCase() || "";
  const qtyBySku = new Map<string, number>();

  for (const row of stock) {
    if (row.qty <= 0) continue;
    const sku = row.sku.trim().toUpperCase();
    if (!sku || !skuMatchesSuggestionQuery(sku, q)) continue;

    if (options?.excludeDamaged && options.locationTypes) {
      const type = options.locationTypes.get(row.locationCode.toUpperCase());
      if (isDamagedStockAt(row.locationCode, type)) continue;
    }

    if (locationFilter && row.locationCode.toUpperCase() !== locationFilter) continue;

    qtyBySku.set(sku, (qtyBySku.get(sku) ?? 0) + row.qty);
  }

  return [...qtyBySku.entries()]
    .map(([sku, qty]) => ({ sku, qty }))
    .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }))
    .slice(0, limit);
}
