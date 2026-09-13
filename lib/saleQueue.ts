import {
  needsPickLocationChoice,
  pickLocationChoiceCandidates,
  pickDefaultStockLocation,
  type PickStockLocation,
} from "@/lib/pickPriority";
import { isDamagedStockAt } from "@/lib/stockClassification";
import type { Location, LocationType } from "@/lib/types";

export type SaleQueueLine = {
  id: string;
  sku?: string;
  qty: number;
  fromLocationCode?: string;
  note?: string;
  photoPreview?: string;
};

export function buildSkuLocationRows(
  sku: string,
  qty: number,
  stock: Array<{ locationCode: string; sku: string; qty: number }>,
  locations: Location[],
): PickStockLocation[] {
  const skuNorm = sku.trim().toUpperCase();
  const needed = Math.max(1, qty);
  const locByCode = new Map(locations.map((loc) => [loc.code.toUpperCase(), loc]));
  return stock
    .filter((row) => row.sku.toUpperCase() === skuNorm && row.qty >= needed)
    .filter((row) => !isDamagedStockAt(row.locationCode, locByCode.get(row.locationCode.toUpperCase())?.locationType))
    .map((row) => {
      const meta = locByCode.get(row.locationCode.toUpperCase());
      return {
        locationCode: row.locationCode,
        qty: row.qty,
        parentZone: meta?.parentZone,
        locationType: meta?.locationType,
        sortOrder: meta?.sortOrder,
      };
    });
}

export type SaleLocationResolution =
  | { status: "resolved"; fromLocationCode: string }
  | { status: "choice"; options: Array<{ locationCode: string; qty: number }> }
  | { status: "missing"; message: string };

export function resolveSaleLineLocation(
  line: Pick<SaleQueueLine, "sku" | "qty" | "fromLocationCode">,
  stock: Array<{ locationCode: string; sku: string; qty: number }>,
  locations: Location[],
): SaleLocationResolution {
  const sku = line.sku?.trim().toUpperCase();
  if (!sku) {
    return { status: "resolved", fromLocationCode: "" };
  }

  if (line.fromLocationCode?.trim()) {
    return { status: "resolved", fromLocationCode: line.fromLocationCode.trim().toUpperCase() };
  }

  const rows = buildSkuLocationRows(sku, line.qty, stock, locations);
  if (rows.length === 0) {
    return { status: "missing", message: `Brak stanu dla ${sku}.` };
  }

  if (needsPickLocationChoice(rows, line.qty)) {
    return {
      status: "choice",
      options: pickLocationChoiceCandidates(rows, line.qty).map((row) => ({
        locationCode: row.locationCode,
        qty: row.qty,
      })),
    };
  }

  const chosen = pickDefaultStockLocation(rows, line.qty);
  if (!chosen) {
    return { status: "missing", message: `Brak dostepnego stanu dla ${sku}.` };
  }

  return { status: "resolved", fromLocationCode: chosen.locationCode };
}
