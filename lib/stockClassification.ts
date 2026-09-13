import type { Location, LocationType } from "@/lib/types";

export const DEFAULT_DAMAGED_LOCATION_CODE = "USZKODZONE";

export function isDamagedLocationType(type: LocationType | undefined): boolean {
  return type === "DAMAGED";
}

export function isDamagedStockAt(locationCode: string, locationType?: LocationType): boolean {
  if (isDamagedLocationType(locationType)) return true;
  return locationCode.trim().toUpperCase() === DEFAULT_DAMAGED_LOCATION_CODE;
}

export function buildLocationTypeMap(
  locations: Array<Pick<Location, "code" | "locationType">>,
): Map<string, LocationType> {
  return new Map(locations.map((loc) => [loc.code.toUpperCase(), loc.locationType]));
}

export function isExcludedFromPickAndRestore(locationCode: string, locationType?: LocationType): boolean {
  const code = locationCode.trim().toUpperCase();
  if (code === "TMP" || code === "SPRZEDAZ") return true;
  return isDamagedStockAt(code, locationType);
}
