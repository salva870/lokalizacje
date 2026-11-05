import { isDamagedStockAt } from "@/lib/stockClassification";
import { parseSkuModel } from "@/lib/skuModel";
import type { LocationType } from "@/lib/types";

/**
 * JSON eksportu stanów LOC dla aplikacji magazynowej (mag).
 *
 * Źródło i reguły są takie same jak w `stockExportCsv.ts`:
 * - SKU i kod lokalizacji są przycinane i zamieniane na wielkie litery,
 * - pozycje z ilością <= 0 są pomijane,
 * - `totalQty` odpowiada kolumnie `stan_magazynowy_sumaryczny_niezalezny_od_lokalizacji`,
 * - `locations[].qty` odpowiada kolumnie `stan_magazynowy_na_lokalizacji`.
 *
 * Dodatkowo JSON rozdziela stan na sprzedażny (lokalizacje inne niż uszkodzone)
 * i uszkodzony, żeby aplikacja mag mogła porównywać kondycje `sellable` / `damaged`.
 */

export const STOCK_EXPORT_SCHEMA = "loc.stock-export" as const;
export const STOCK_EXPORT_VERSION = 1 as const;

export type StockExportInputRow = { locationCode: string; sku: string; qty: number };

export type StockExportJsonLocation = {
  locationCode: string;
  locationType: LocationType | null;
  damaged: boolean;
  qty: number;
};

export type StockExportJsonItem = {
  sku: string;
  model: string;
  size: string;
  totalQty: number;
  sellableQty: number;
  damagedQty: number;
  locations: StockExportJsonLocation[];
};

export type StockExportJsonDocument = {
  schema: typeof STOCK_EXPORT_SCHEMA;
  version: typeof STOCK_EXPORT_VERSION;
  source: "LOC";
  generatedAt: string;
  itemCount: number;
  locationCount: number;
  totalQty: number;
  items: StockExportJsonItem[];
};

/**
 * @param stock wiersze stanu (taki sam kształt jak z `getCurrentStock()`)
 * @param locationTypeByCode mapa kod lokalizacji -> typ (klucz w wielkich literach)
 * @param generatedAt moment wygenerowania dokumentu
 */
export function buildStockExportJson(
  stock: StockExportInputRow[],
  locationTypeByCode: Map<string, LocationType | undefined>,
  generatedAt: Date,
): StockExportJsonDocument {
  const bySku = new Map<string, Map<string, number>>();

  for (const row of stock) {
    if (!(row.qty > 0)) continue;
    const sku = row.sku.trim().toUpperCase();
    const locationCode = row.locationCode.trim().toUpperCase();
    if (!sku || !locationCode) continue;

    const perLocation = bySku.get(sku) ?? new Map<string, number>();
    perLocation.set(locationCode, (perLocation.get(locationCode) ?? 0) + row.qty);
    bySku.set(sku, perLocation);
  }

  const items: StockExportJsonItem[] = [];
  const locationCodes = new Set<string>();

  for (const [sku, perLocation] of bySku) {
    const { model, size } = parseSkuModel(sku);
    const locations: StockExportJsonLocation[] = [...perLocation.entries()]
      .map(([locationCode, qty]) => {
        const locationType = locationTypeByCode.get(locationCode) ?? null;
        locationCodes.add(locationCode);
        return {
          locationCode,
          locationType,
          damaged: isDamagedStockAt(locationCode, locationType ?? undefined),
          qty,
        };
      })
      .sort((a, b) => a.locationCode.localeCompare(b.locationCode, "pl"));

    const damagedQty = sumQty(locations.filter((loc) => loc.damaged));
    const sellableQty = sumQty(locations.filter((loc) => !loc.damaged));

    items.push({
      sku,
      model,
      size,
      totalQty: damagedQty + sellableQty,
      sellableQty,
      damagedQty,
      locations,
    });
  }

  items.sort((a, b) => a.model.localeCompare(b.model, "pl") || a.sku.localeCompare(b.sku, "pl"));

  return {
    schema: STOCK_EXPORT_SCHEMA,
    version: STOCK_EXPORT_VERSION,
    source: "LOC",
    generatedAt: generatedAt.toISOString(),
    itemCount: items.length,
    locationCount: locationCodes.size,
    totalQty: sumQty(items),
    items,
  };
}

function sumQty(list: Array<{ qty?: number; totalQty?: number }>): number {
  return list.reduce((total, entry) => total + (entry.qty ?? entry.totalQty ?? 0), 0);
}
