import {
  filterPickableLocations,
  needsPickLocationChoice,
  pickDefaultStockLocation,
  pickLocationChoiceCandidates,
  type PickStockLocation,
} from "@/lib/pickPriority";

export type SkuLocationQty = PickStockLocation;

export class LocationChoiceRequiredError extends Error {
  readonly code = "LOCATION_CHOICE_REQUIRED" as const;
  readonly sku: string;
  readonly locations: SkuLocationQty[];

  constructor(sku: string, locations: SkuLocationQty[]) {
    super("Wybierz lokalizacje, z ktorej zdjac towar");
    this.name = "LocationChoiceRequiredError";
    this.sku = sku;
    this.locations = locations;
  }
}

export function isLocationChoiceRequiredError(error: unknown): error is LocationChoiceRequiredError {
  return error instanceof LocationChoiceRequiredError;
}

/**
 * Wybór lokalizacji źródłowej dla picklisty / sprzedaży:
 * tylko typy pickowalne (wieszak → wystawa → karton → półka),
 * auto-wybór gdy jednoznaczny, inaczej błąd z listą kandydatów.
 */
export function resolveSingleSourceLocation(
  sku: string,
  qty: number,
  locations: SkuLocationQty[],
  requested?: string,
): string {
  const needed = Math.max(1, qty);
  const requestedCode = requested?.trim().toUpperCase();
  if (requestedCode) {
    const hit = locations.find((row) => row.locationCode.toUpperCase() === requestedCode);
    if (!hit || hit.qty < needed) {
      throw new Error("Brak wystarczajacej ilosci na lokalizacji zrodlowej");
    }
    return hit.locationCode;
  }

  const pickable = filterPickableLocations(locations, needed);
  if (pickable.length === 0) {
    throw new Error("Brak towaru na dozwolonych lokalizacjach (wieszak, wystawa, karton, polka)");
  }

  if (needsPickLocationChoice(locations, needed)) {
    throw new LocationChoiceRequiredError(sku, pickLocationChoiceCandidates(locations, needed));
  }

  const chosen = pickDefaultStockLocation(locations, needed);
  if (!chosen) {
    throw new Error("Brak towaru na lokalizacjach");
  }
  return chosen.locationCode;
}
