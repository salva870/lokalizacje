import type { LocationType, Zone } from "@/lib/types";

/** Domyślne opisy typów lokalizacji (edytowalne w panelu admina). */
export const defaultLocationTypeLabels: Record<LocationType, string> = {
  DISPLAY: "Wieszak w sklepie",
  WYSTAWA: "Wystawa",
  BUFFER: "Bufor tymczasowy (np. TMP)",
  RESERVED: "Rezerwa / sprzedaz (np. SPRZEDAZ)",
  BACKROOM_BOX: "Karton na zapleczu",
  BACKROOM_SHELF: "Polka na zapleczu",
  INACTIVE: "Nieaktywna (ukryta przy wyborze)",
  DAMAGED: "Uszkodzone (poza picklista i sumami)",
};

/** @deprecated Użyj getLocationTypeLabels() lub defaultLocationTypeLabels */
export const locationTypeLabels: Record<LocationType, string> = defaultLocationTypeLabels;

export const zoneLabels: Record<Zone, string> = {
  SKLEP: "Sklep (wieszaki, sala)",
  ZAPLECZE: "Zaplecze / magazyn",
};

export function defaultLocationTypeForZone(zone: Zone): LocationType {
  return zone === "SKLEP" ? "DISPLAY" : "BACKROOM_BOX";
}

export function formatLocationType(type: LocationType, labels?: Record<LocationType, string>): string {
  const map = labels ?? defaultLocationTypeLabels;
  return map[type] ?? type;
}

export type StockLocationEntry = {
  locationCode: string;
  qty: number;
  parentZone?: Zone;
  locationType?: LocationType;
};

/** Do etykiety na kafelku: preferuj SKLEP, potem zaplecze. */
export function pickLocationsPreferSklep(entries: StockLocationEntry[]): StockLocationEntry[] {
  if (entries.length === 0) return [];
  const sklep = entries.filter((e) => e.parentZone === "SKLEP");
  if (sklep.length > 0) return sklep;
  return entries;
}

export function formatLocationEntries(entries: StockLocationEntry[]): string {
  const picked = pickLocationsPreferSklep(entries);
  if (picked.length === 0) return "—";
  return picked.map((e) => `${e.locationCode} (${e.qty})`).join(", ");
}
