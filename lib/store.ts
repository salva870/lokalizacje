import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import type { Location, MovementType, StockMovement, User } from "@/lib/types";

const users: User[] = [
  {
    id: "u-admin-1",
    login: "admin",
    passwordHash: bcrypt.hashSync("ChangeMe123!", 10),
    role: "ADMIN",
  },
];

const locations: Location[] = [
  { code: "W1", name: "Wieszak 1", parentZone: "SKLEP", locationType: "DISPLAY", isActive: true },
  { code: "W2", name: "Wieszak 2", parentZone: "SKLEP", locationType: "DISPLAY", isActive: true },
  { code: "TMP", name: "Tymczasowe", parentZone: "SKLEP", locationType: "BUFFER", isActive: true },
  { code: "SPRZEDAZ", name: "Sprzedaz/Rezerwacja", parentZone: "SKLEP", locationType: "RESERVED", isActive: true },
  { code: "KARTON_1", name: "Karton 1", parentZone: "ZAPLECZE", locationType: "BACKROOM_BOX", isActive: true },
];

const stockMap = new Map<string, number>();
const stockMovements: StockMovement[] = [];

function stockKey(locationCode: string, sku: string) {
  return `${locationCode}::${sku}`;
}

function getQty(locationCode: string, sku: string) {
  return stockMap.get(stockKey(locationCode, sku)) ?? 0;
}

function setQty(locationCode: string, sku: string, qty: number) {
  const key = stockKey(locationCode, sku);
  if (qty <= 0) {
    stockMap.delete(key);
    return;
  }
  stockMap.set(key, qty);
}

export function listLocations() {
  return [...locations];
}

export function createLocation(input: {
  code: string;
  name: string;
  parentZone: "SKLEP" | "ZAPLECZE";
  locationType: "DISPLAY" | "BUFFER" | "RESERVED" | "BACKROOM_BOX" | "BACKROOM_SHELF" | "INACTIVE";
}) {
  const code = input.code.trim().toUpperCase();
  if (locations.some((location) => location.code === code)) {
    throw new Error("Lokalizacja o tym kodzie juz istnieje");
  }
  const location = {
    code,
    name: input.name.trim(),
    parentZone: input.parentZone,
    locationType: input.locationType,
    isActive: true,
  } as const;
  locations.push(location);
  return location;
}

export function listSkuLocations(sku: string) {
  const normalizedSku = sku.trim().toUpperCase();
  const result: Array<{ locationCode: string; qty: number }> = [];
  for (const [key, qty] of stockMap.entries()) {
    const [locationCode, keySku] = key.split("::");
    if (keySku === normalizedSku) {
      result.push({ locationCode, qty });
    }
  }
  return result.sort((a, b) => a.locationCode.localeCompare(b.locationCode));
}

export function applyMovement(input: {
  operatorId: string;
  movementType: MovementType;
  sku: string;
  qty?: number;
  fromLocationCode?: string;
  toLocationCode?: string;
  referenceNo?: string;
}) {
  const qty = input.qty ?? 1;
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("Niepoprawna ilosc");
  }

  const sku = input.sku.trim().toUpperCase();
  const from = input.fromLocationCode?.trim().toUpperCase();
  const to = input.toLocationCode?.trim().toUpperCase();

  if (!sku) {
    throw new Error("SKU jest wymagane");
  }

  if (from) {
    const fromQty = getQty(from, sku);
    if (fromQty < qty) {
      throw new Error("Brak wystarczajacej ilosci na lokalizacji zrodlowej");
    }
    setQty(from, sku, fromQty - qty);
  }

  if (to) {
    const toQty = getQty(to, sku);
    setQty(to, sku, toQty + qty);
  }

  const movement: StockMovement = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    operatorId: input.operatorId,
    movementType: input.movementType,
    sku,
    qty,
    fromLocationCode: from,
    toLocationCode: to,
    referenceNo: input.referenceNo,
  };
  stockMovements.unshift(movement);
  return movement;
}

export function getCurrentStock() {
  const result: Array<{ locationCode: string; sku: string; qty: number }> = [];
  for (const [key, qty] of stockMap.entries()) {
    const [locationCode, sku] = key.split("::");
    result.push({ locationCode, sku, qty });
  }
  return result.sort((a, b) => `${a.locationCode}${a.sku}`.localeCompare(`${b.locationCode}${b.sku}`));
}

export function getRecentMovements(limit = 30) {
  return stockMovements.slice(0, limit);
}

export function getRestoreSuggestions(sku: string) {
  const normalizedSku = sku.trim().toUpperCase();
  const currentLocations = listSkuLocations(normalizedSku)
    .map((item) => item.locationCode)
    .filter((code) => !["TMP", "SPRZEDAZ"].includes(code));

  const history = stockMovements.filter((movement) => movement.sku === normalizedSku);
  const preferred = history
    .flatMap((movement) => [movement.toLocationCode, movement.fromLocationCode])
    .filter((locationCode): locationCode is string => Boolean(locationCode))
    .filter((code) => !["TMP", "SPRZEDAZ"].includes(code));

  const lastLocation = preferred[0] ?? null;
  const counts = new Map<string, number>();
  for (const locationCode of preferred) {
    counts.set(locationCode, (counts.get(locationCode) ?? 0) + 1);
  }
  const topLocation =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    lastLocation,
    topLocation,
    currentLocations,
    suggestions: [lastLocation, topLocation, ...currentLocations].filter(
      (value, idx, arr): value is string => Boolean(value) && arr.indexOf(value) === idx,
    ),
  };
}

export function findUserByLogin(login: string) {
  return users.find((u) => u.login.toLowerCase() === login.trim().toLowerCase());
}
