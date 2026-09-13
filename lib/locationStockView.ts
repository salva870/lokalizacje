import type { Zone } from "@/lib/types";

export type LocationStockBucket = "SKLEP" | "ZAPLECZE" | "OTHER";

export type LocationSortable = { code: string; sortOrder?: number; parentZone?: Zone };

export const locationStockBucketLabels: Record<LocationStockBucket, string> = {
  SKLEP: "Sklep",
  ZAPLECZE: "Zaplecze",
  OTHER: "Pozostałe",
};

export function locationStockBucket(loc: { parentZone?: Zone } | undefined): LocationStockBucket {
  if (!loc?.parentZone) return "OTHER";
  if (loc.parentZone === "SKLEP") return "SKLEP";
  if (loc.parentZone === "ZAPLECZE") return "ZAPLECZE";
  return "OTHER";
}

/** Ta sama kolejnosc co w panelu admina / pickliscie (sort_order). */
export function sortLocationsBySavedOrder<T extends LocationSortable>(locations: T[]): T[] {
  return [...locations].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.code.localeCompare(b.code));
}

export function locationSortRankMap(locations: LocationSortable[]): Map<string, number> {
  return new Map(sortLocationsBySavedOrder(locations).map((loc, index) => [loc.code, index]));
}
