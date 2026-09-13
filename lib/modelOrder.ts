import { parseSkuModel } from "@/lib/skuModel";

export type LocationModelOrderRow = {
  locationCode: string;
  model: string;
  sortOrder: number;
};

function normalizeModel(model: string): string {
  return model.trim().toUpperCase();
}

/** Kolejnosc modeli wg pierwszego pojawienia sie SKU w kolejce skanow. */
export function modelsInScanOrder(queue: Array<{ sku: string }>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of queue) {
    const { model } = parseSkuModel(line.sku);
    const normalized = normalizeModel(model);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** Unikalne modele obecne w partii SKU (kolejnosc skanow). */
export function modelsOnLocationFromItems(items: Array<{ sku: string }>): string[] {
  return modelsInScanOrder(items);
}

/**
 * Kolejnosc modeli na lokalizacji po aktualizacji stanu / skanowaniu:
 * 1. Modele z biezacej sesji — wg pierwszego skanu w partii,
 * 2. Istniejace modele nadal na stanie, ale spoza partii — zachowuja wczesniejsza kolejnosc,
 * 3. Modele zdjete ze stanu — wypadaja z listy.
 */
export function buildLocationModelOrder(
  existing: string[],
  scannedBatch: string[],
  modelsOnLocation: string[],
): string[] {
  const onLocation = new Set(modelsOnLocation.map(normalizeModel).filter(Boolean));
  const seen = new Set<string>();
  const result: string[] = [];

  for (const model of scannedBatch) {
    const normalized = normalizeModel(model);
    if (!normalized || !onLocation.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  for (const model of existing) {
    const normalized = normalizeModel(model);
    if (!onLocation.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

/** Po dodaniu skanow: nowe modele tylko na koncu. Juz zapisanych nie przesuwaj. */
export function mergeModelOrder(existing: string[], scannedBatch: string[]): string[] {
  const existingNorm = existing.map(normalizeModel).filter(Boolean);
  const seen = new Set(existingNorm);
  const appended: string[] = [];
  for (const model of scannedBatch) {
    const normalized = normalizeModel(model);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    appended.push(normalized);
  }
  return [...existingNorm, ...appended];
}

export function sortGroupsByModelOrder<T extends { model: string }>(
  groups: T[],
  order: string[] | Map<string, number>,
): T[] {
  const rank =
    order instanceof Map
      ? order
      : new Map(order.map((model, index) => [normalizeModel(model), index * 10]));
  const indexed = groups.map((group, index) => ({ group, index }));
  return indexed
    .sort((a, b) => {
      const ra = rank.get(normalizeModel(a.group.model)) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(normalizeModel(b.group.model)) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.index - b.index;
    })
    .map((entry) => entry.group);
}

export function orderArrayToSortMap(models: string[]): Map<string, number> {
  return new Map(models.map((model, index) => [normalizeModel(model), index * 10]));
}

export function sortMapToModelArray(orderMap: Map<string, number>): string[] {
  return [...orderMap.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([model]) => model);
}
