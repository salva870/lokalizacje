import type { LocationType, Zone } from "@/lib/types";

/** Typy, z których picklista może pobierać towar (w tej kolejności priorytetu). */
export const PICKABLE_LOCATION_TYPES: LocationType[] = [
  "DISPLAY",
  "WYSTAWA",
  "BACKROOM_BOX",
  "BACKROOM_SHELF",
];

/** Niższa liczba = wyższy priorytet przy automatycznym wyborze lokalizacji. */
export const pickLocationTypePriority: Record<LocationType, number> = {
  DISPLAY: 1,
  WYSTAWA: 2,
  BACKROOM_BOX: 3,
  BACKROOM_SHELF: 4,
  BUFFER: 100,
  RESERVED: 100,
  INACTIVE: 100,
  DAMAGED: 100,
};

export type PickStockLocation = {
  locationCode: string;
  qty: number;
  parentZone?: Zone;
  locationType?: LocationType;
  sortOrder?: number;
};

export function isPickableLocationType(type: LocationType | undefined): boolean {
  if (!type) return false;
  return PICKABLE_LOCATION_TYPES.includes(type);
}

export function pickTypePriority(type: LocationType | undefined): number {
  if (!type) return 999;
  return pickLocationTypePriority[type] ?? 999;
}

export function comparePickStockLocations(a: PickStockLocation, b: PickStockLocation): number {
  const typeDiff = pickTypePriority(a.locationType) - pickTypePriority(b.locationType);
  if (typeDiff !== 0) return typeDiff;
  const sortA = a.sortOrder ?? 999999;
  const sortB = b.sortOrder ?? 999999;
  if (sortA !== sortB) return sortA - sortB;
  return a.locationCode.localeCompare(b.locationCode);
}

export function filterPickableLocations(
  locations: PickStockLocation[],
  minQty = 1,
): PickStockLocation[] {
  const needed = Math.max(1, minQty);
  return locations
    .filter((row) => isPickableLocationType(row.locationType) && row.qty >= needed)
    .sort(comparePickStockLocations);
}

/** Najlepszy tier priorytetu wśród dostępnych lokalizacji. */
export function bestPickTier(locations: PickStockLocation[], minQty = 1): PickStockLocation[] {
  const pickable = filterPickableLocations(locations, minQty);
  if (pickable.length === 0) return [];
  const best = pickTypePriority(pickable[0].locationType);
  return pickable.filter((row) => pickTypePriority(row.locationType) === best);
}

export function pickDefaultStockLocation(
  locations: PickStockLocation[],
  minQty = 1,
): PickStockLocation | null {
  const tier = bestPickTier(locations, minQty);
  return tier[0] ?? null;
}

/**
 * Wymaga wyboru lokalizacji przez operatora / picklistę:
 * - 2+ wieszaki w sklepie (DISPLAY + SKLEP), albo
 * - 2+ lokalizacje na tym samym, najwyższym poziomie priorytetu.
 */
export function needsPickLocationChoice(locations: PickStockLocation[], minQty = 1): boolean {
  const needed = Math.max(1, minQty);
  const enough = locations.filter((row) => row.qty >= needed);
  const shopDisplays = enough.filter(
    (row) => row.locationType === "DISPLAY" && row.parentZone === "SKLEP",
  );
  if (shopDisplays.length >= 2) return true;

  const tier = bestPickTier(locations, minQty);
  return tier.length >= 2;
}

/** Kandydaci do wyboru (najwyższy tier; przy remisie — wszystkie z tieru). */
export function pickLocationChoiceCandidates(
  locations: PickStockLocation[],
  minQty = 1,
): PickStockLocation[] {
  return bestPickTier(locations, minQty);
}
