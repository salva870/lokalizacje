import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { Location, MovementType, StockMovement, User, Role } from "@/lib/types";
import type { OperatorDraft } from "@/lib/types";
import { mergeModelOrder, modelsInScanOrder, buildLocationModelOrder, modelsOnLocationFromItems } from "@/lib/modelOrder";
import { comparePickStockLocations } from "@/lib/pickPriority";
import { parseSkuModel } from "@/lib/skuModel";
import { resolveSingleSourceLocation } from "@/lib/stockSource";
import { aggregatePickStatus } from "@/lib/pickStatus";

/** Admin w trybie bez Supabase — hash bcrypt; hasło startowe jest ustawione w polu logowania (dev). */
const users: User[] = [
  {
    id: "u-admin-1",
    login: "admin",
    passwordHash: "$2b$10$rIESkSgnoSDOOEJgkNv5iOXtTLajHAa0RxFm6exLdLr0R1EwWVFOe",
    role: "ADMIN",
  },
];

const locations: Location[] = [
  { code: "W1", name: "Wieszak 1", parentZone: "SKLEP", locationType: "DISPLAY", isActive: true, barcodeValue: "LOC-W1", sortOrder: 0 },
  { code: "W2", name: "Wieszak 2", parentZone: "SKLEP", locationType: "DISPLAY", isActive: true, barcodeValue: "LOC-W2", sortOrder: 10 },
  { code: "TMP", name: "Tymczasowe", parentZone: "SKLEP", locationType: "BUFFER", isActive: true, barcodeValue: "LOC-TMP", sortOrder: 20 },
  { code: "SPRZEDAZ", name: "Sprzedaz/Rezerwacja", parentZone: "SKLEP", locationType: "RESERVED", isActive: true, barcodeValue: "LOC-SPRZEDAZ", sortOrder: 30 },
  { code: "KARTON_1", name: "Karton 1", parentZone: "ZAPLECZE", locationType: "BACKROOM_BOX", isActive: true, barcodeValue: "LOC-KARTON_1", sortOrder: 40 },
  { code: "USZKODZONE", name: "Uszkodzone", parentZone: "ZAPLECZE", locationType: "DAMAGED", isActive: true, barcodeValue: "LOC-USZKODZONE", sortOrder: 50 },
];

const stockMap = new Map<string, number>();
const stockMovements: StockMovement[] = [];
const locationModelOrder = new Map<string, Map<string, number>>();
const draftByOperator = new Map<string, OperatorDraft>();
const draftsFilePath = path.join(process.cwd(), "logs", "operator-drafts.json");

function defaultDraft(): OperatorDraft {
  return {
    activeLocationCode: null,
    fromLocationCode: "",
    toLocationCode: "",
    addQueue: [],
    moveQueue: [],
    reconcileQueue: [],
  };
}

function loadDraftsFromDisk() {
  try {
    if (!fs.existsSync(draftsFilePath)) return;
    const raw = fs.readFileSync(draftsFilePath, "utf8");
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw) as Record<string, Partial<OperatorDraft>>;
    for (const [operatorId, value] of Object.entries(parsed)) {
      draftByOperator.set(operatorId, {
        activeLocationCode: value.activeLocationCode ?? null,
        fromLocationCode: value.fromLocationCode ?? "",
        toLocationCode: value.toLocationCode ?? "",
        addQueue: Array.isArray(value.addQueue)
          ? value.addQueue
              .map((line) => ({ sku: String(line.sku ?? "").trim().toUpperCase(), qty: Math.max(1, Number(line.qty) || 1) }))
              .filter((line) => line.sku.length > 0)
          : [],
        moveQueue: Array.isArray(value.moveQueue)
          ? value.moveQueue
              .map((line) => ({ sku: String(line.sku ?? "").trim().toUpperCase(), qty: Math.max(1, Number(line.qty) || 1) }))
              .filter((line) => line.sku.length > 0)
          : [],
        reconcileQueue: Array.isArray(value.reconcileQueue)
          ? value.reconcileQueue
              .map((line) => ({ sku: String(line.sku ?? "").trim().toUpperCase(), qty: Math.max(1, Number(line.qty) || 1) }))
              .filter((line) => line.sku.length > 0)
          : [],
      });
    }
  } catch {
    // ignore invalid file
  }
}

function flushDraftsToDisk() {
  try {
    fs.mkdirSync(path.dirname(draftsFilePath), { recursive: true });
    const payload = Object.fromEntries(draftByOperator.entries());
    fs.writeFileSync(draftsFilePath, JSON.stringify(payload), "utf8");
  } catch {
    // ignore disk write errors in local mode
  }
}

loadDraftsFromDisk();

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
  return [...locations].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.code.localeCompare(b.code),
  );
}

export function createLocation(input: {
  code: string;
  name: string;
  parentZone: "SKLEP" | "ZAPLECZE";
  locationType: "DISPLAY" | "WYSTAWA" | "BUFFER" | "RESERVED" | "BACKROOM_BOX" | "BACKROOM_SHELF" | "INACTIVE" | "DAMAGED";
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
    barcodeValue: `LOC-${code}`,
    sortOrder: locations.reduce((max, loc) => Math.max(max, loc.sortOrder ?? 0), 0) + 10,
  } as const;
  locations.push(location);
  return location;
}

export function updateLocationLocal(
  code: string,
  input: {
    name?: string;
    parentZone?: "SKLEP" | "ZAPLECZE";
    locationType?: Location["locationType"];
    isActive?: boolean;
  },
) {
  const c = code.trim().toUpperCase();
  const loc = locations.find((entry) => entry.code === c);
  if (!loc) throw new Error("Brak lokalizacji");
  if (input.name !== undefined) loc.name = input.name.trim();
  if (input.parentZone !== undefined) loc.parentZone = input.parentZone;
  if (input.locationType !== undefined) loc.locationType = input.locationType;
  if (input.isActive !== undefined) loc.isActive = input.isActive;
  return loc;
}

export function deleteLocationIfEmptyLocal(code: string) {
  const c = code.trim().toUpperCase();
  if (!c) throw new Error("Brak kodu lokalizacji");
  for (const [key, qty] of stockMap.entries()) {
    const [locationCode] = key.split("::");
    if (locationCode === c && qty > 0) {
      throw new Error("Lokalizacja nie jest pusta");
    }
  }
  const idx = locations.findIndex((location) => location.code === c);
  if (idx < 0) throw new Error("Brak lokalizacji");
  for (const key of [...stockMap.keys()]) {
    if (key.startsWith(`${c}::`)) {
      stockMap.delete(key);
    }
  }
  locations.splice(idx, 1);
}

export function setLocationPickOrderLocal(codes: string[]) {
  const known = new Set(locations.map((loc) => loc.code));
  const unique = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))].filter((code) =>
    known.has(code),
  );
  const remaining = locations.map((loc) => loc.code).filter((code) => !unique.includes(code));
  const ordered = [...unique, ...remaining];
  for (let index = 0; index < ordered.length; index += 1) {
    const loc = locations.find((entry) => entry.code === ordered[index]);
    if (loc) loc.sortOrder = index * 10;
  }
  return listLocations();
}

export function listSkuLocations(sku: string) {
  const normalizedSku = sku.trim().toUpperCase();
  const result: Array<{
    locationCode: string;
    qty: number;
    parentZone?: "SKLEP" | "ZAPLECZE";
    locationType?: Location["locationType"];
    sortOrder?: number;
  }> = [];
  for (const [key, qty] of stockMap.entries()) {
    const [locationCode, keySku] = key.split("::");
    if (keySku === normalizedSku) {
      const loc = locations.find((entry) => entry.code === locationCode);
      result.push({
        locationCode,
        qty,
        parentZone: loc?.parentZone,
        locationType: loc?.locationType,
        sortOrder: loc?.sortOrder,
      });
    }
  }
  return result.sort(comparePickStockLocations);
}

export function listLocationModelOrderLocal(locationCode?: string) {
  const result: Array<{ locationCode: string; model: string; sortOrder: number }> = [];
  for (const [code, orderMap] of locationModelOrder.entries()) {
    if (locationCode && code !== locationCode.trim().toUpperCase()) continue;
    for (const [model, sortOrder] of orderMap.entries()) {
      result.push({ locationCode: code, model, sortOrder });
    }
  }
  return result.sort((a, b) =>
    a.locationCode === b.locationCode ? a.sortOrder - b.sortOrder : a.locationCode.localeCompare(b.locationCode),
  );
}

export function getLocationModelOrderArrayLocal(locationCode: string): string[] {
  const code = locationCode.trim().toUpperCase();
  const orderMap = locationModelOrder.get(code);
  if (!orderMap) return [];
  return [...orderMap.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([model]) => model);
}

export function setLocationModelOrderLocal(locationCode: string, models: string[], updatedBy?: string) {
  void updatedBy;
  const code = locationCode.trim().toUpperCase();
  const orderMap = new Map<string, number>();
  models.forEach((model, index) => {
    const normalized = model.trim().toUpperCase();
    if (normalized) orderMap.set(normalized, index * 10);
  });
  locationModelOrder.set(code, orderMap);
}

export function mergeLocationModelOrderLocal(locationCode: string, scannedModels: string[], updatedBy?: string) {
  void updatedBy;
  const existing = getLocationModelOrderArrayLocal(locationCode);
  setLocationModelOrderLocal(locationCode, mergeModelOrder(existing, scannedModels));
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
  let from = input.fromLocationCode?.trim().toUpperCase();
  let to = input.toLocationCode?.trim().toUpperCase();

  if (!sku) {
    throw new Error("SKU jest wymagane");
  }

  if (input.movementType === "ADD") {
    if (!to) {
      throw new Error("Brak lokalizacji docelowej dla dodawania");
    }
    from = undefined;
  } else if (input.movementType === "REMOVE") {
    if (!from) {
      throw new Error("Brak lokalizacji zrodlowej dla zdejmowania");
    }
  } else if (input.movementType === "MOVE") {
    if (!from || !to) {
      throw new Error("Przeniesienie wymaga lokalizacji zrodlowej i docelowej");
    }
  } else if (input.movementType === "MOVE_TO_SALE" || input.movementType === "SALE_FINALIZE") {
    to = undefined;
    from = resolveSingleSourceLocation(sku, qty, listSkuLocations(sku), from);
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

  if (input.movementType === "ADD" && to) {
    const { model } = parseSkuModel(sku);
    if (model) {
      mergeLocationModelOrderLocal(to, [model], input.operatorId);
    }
  }

  return movement;
}

export function reconcileLocationLocal(
  operatorId: string,
  locationCode: string,
  items: Array<{ sku: string; qty: number }>,
) {
  const code = locationCode.trim().toUpperCase();
  if (!code) throw new Error("Brak kodu lokalizacji");
  if (!locations.some((loc) => loc.code === code)) throw new Error("Brak lokalizacji");

  const target = new Map<string, number>();
  for (const item of items) {
    const sku = item.sku.trim().toUpperCase();
    if (!sku) continue;
    target.set(sku, (target.get(sku) ?? 0) + Math.max(1, Math.floor(item.qty)));
  }

  const current = getCurrentStock().filter((row) => row.locationCode === code);
  for (const row of current) {
    const targetQty = target.get(row.sku) ?? 0;
    if (row.qty > targetQty) {
      applyMovement({
        operatorId,
        movementType: "REMOVE",
        sku: row.sku,
        qty: row.qty - targetQty,
        fromLocationCode: code,
      });
    }
  }
  for (const [sku, targetQty] of target.entries()) {
    const currentQty = current.find((row) => row.sku === sku)?.qty ?? 0;
    if (targetQty > currentQty) {
      applyMovement({
        operatorId,
        movementType: "ADD",
        sku,
        qty: targetQty - currentQty,
        toLocationCode: code,
      });
    }
  }
  const existing = getLocationModelOrderArrayLocal(code);
  const scannedModels = modelsInScanOrder(items);
  const modelsOnLocation = modelsOnLocationFromItems(items);
  const nextOrder = buildLocationModelOrder(existing, scannedModels, modelsOnLocation);
  setLocationModelOrderLocal(code, nextOrder, operatorId);
}

export function moveEntireLocationLocal(operatorId: string, fromLocationCode: string, toLocationCode: string) {
  const from = fromLocationCode.trim().toUpperCase();
  const to = toLocationCode.trim().toUpperCase();
  if (!from || !to) throw new Error("Brak lokalizacji zrodlowej lub docelowej");
  if (from === to) throw new Error("Lokalizacja zrodlowa i docelowa musza byc rozne");
  if (!locations.some((loc) => loc.code === from && loc.isActive)) {
    throw new Error("Brak aktywnej lokalizacji zrodlowej");
  }
  if (!locations.some((loc) => loc.code === to && loc.isActive)) {
    throw new Error("Brak aktywnej lokalizacji docelowej");
  }

  const rows = getCurrentStock().filter((row) => row.locationCode === from);
  if (rows.length === 0) {
    throw new Error("Lokalizacja zrodlowa jest pusta — nie ma czego przenosic");
  }

  for (const row of rows) {
    applyMovement({
      operatorId,
      movementType: "MOVE",
      sku: row.sku,
      qty: row.qty,
      fromLocationCode: from,
      toLocationCode: to,
      referenceNo: `LOC_MOVE:${from}->${to}`,
    });
  }

  const sourceModels = getLocationModelOrderArrayLocal(from);
  const stockModels = modelsInScanOrder(rows.map((row) => ({ sku: row.sku })));
  const modelsToMerge = sourceModels.length > 0 ? sourceModels : stockModels;
  if (modelsToMerge.length > 0) {
    mergeLocationModelOrderLocal(to, modelsToMerge, operatorId);
  }
  setLocationModelOrderLocal(from, [], operatorId);

  return {
    fromLocationCode: from,
    toLocationCode: to,
    movedSkuCount: rows.length,
    movedPieceCount: rows.reduce((sum, row) => sum + row.qty, 0),
  };
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

export function getPickStatusByReferences(references: string[]) {
  const unique = [...new Set(references.map((ref) => ref.trim()).filter(Boolean))];
  if (!unique.length) return [];
  const movements = stockMovements.filter(
    (movement) => movement.referenceNo && unique.includes(movement.referenceNo),
  );
  return aggregatePickStatus(movements, unique);
}

const EXCLUDED_RESTORE_LOCATIONS = new Set(["TMP", "SPRZEDAZ", "USZKODZONE"]);

export type ModelRestoreSuggestion = {
  model: string;
  suggestedLocation: string | null;
  suggestedLocationName: string | null;
  locations: Array<{ locationCode: string; locationName: string | null; qty: number; variantCount: number }>;
};

function locationNameByCode(code: string): string | null {
  return locations.find((entry) => entry.code === code)?.name ?? null;
}

export function getRestoreSuggestions(sku: string) {
  const normalizedSku = sku.trim().toUpperCase();
  const currentLocations = listSkuLocations(normalizedSku)
    .map((item) => item.locationCode)
    .filter((code) => !EXCLUDED_RESTORE_LOCATIONS.has(code));

  const history = stockMovements.filter((movement) => movement.sku === normalizedSku);
  const preferred = history
    .flatMap((movement) => [movement.toLocationCode, movement.fromLocationCode])
    .filter((locationCode): locationCode is string => Boolean(locationCode))
    .filter((code) => !EXCLUDED_RESTORE_LOCATIONS.has(code));

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

/** Sugestia lokalizacji na podstawie innych wariantow tego samego modelu juz na stanie. */
export function getModelRestoreSuggestions(sku: string): ModelRestoreSuggestion {
  const normalizedSku = sku.trim().toUpperCase();
  const { model } = parseSkuModel(normalizedSku);
  const byLocation = new Map<string, { qty: number; skus: Set<string> }>();

  for (const row of getCurrentStock()) {
    if (row.qty <= 0) continue;
    if (EXCLUDED_RESTORE_LOCATIONS.has(row.locationCode)) continue;
    if (parseSkuModel(row.sku).model !== model) continue;
    const entry = byLocation.get(row.locationCode) ?? { qty: 0, skus: new Set<string>() };
    entry.qty += row.qty;
    entry.skus.add(row.sku);
    byLocation.set(row.locationCode, entry);
  }

  const locationList = [...byLocation.entries()]
    .map(([locationCode, { qty, skus }]) => ({
      locationCode,
      locationName: locationNameByCode(locationCode),
      qty,
      variantCount: skus.size,
    }))
    .sort((a, b) => b.qty - a.qty || a.locationCode.localeCompare(b.locationCode));

  const top = locationList[0] ?? null;
  return {
    model,
    suggestedLocation: top?.locationCode ?? null,
    suggestedLocationName: top?.locationName ?? null,
    locations: locationList,
  };
}

export function findUserByLogin(login: string) {
  return users.find((u) => u.login.toLowerCase() === login.trim().toLowerCase());
}

export function findUserById(id: string) {
  return users.find((u) => u.id === id) ?? null;
}

export function updateUserPassword(userId: string, passwordHash: string) {
  const user = users.find((u) => u.id === userId);
  if (!user) {
    throw new Error("Nie znaleziono uzytkownika");
  }
  user.passwordHash = passwordHash;
}

export function updateOperatorRole(userId: string, role: Role) {
  const user = users.find((u) => u.id === userId);
  if (!user) {
    throw new Error("Nie znaleziono operatora");
  }
  user.role = role;
}

export function getOperatorDraftLocal(operatorId: string): OperatorDraft {
  return draftByOperator.get(operatorId) ?? defaultDraft();
}

export function setOperatorDraftLocal(operatorId: string, draft: OperatorDraft) {
  draftByOperator.set(operatorId, {
    activeLocationCode: draft.activeLocationCode?.trim().toUpperCase() || null,
    fromLocationCode: draft.fromLocationCode.trim().toUpperCase(),
    toLocationCode: draft.toLocationCode.trim().toUpperCase(),
    addQueue: draft.addQueue.map((line) => ({ sku: line.sku.trim().toUpperCase(), qty: Math.max(1, Math.floor(line.qty)) })),
    moveQueue: draft.moveQueue.map((line) => ({ sku: line.sku.trim().toUpperCase(), qty: Math.max(1, Math.floor(line.qty)) })),
    reconcileQueue: draft.reconcileQueue.map((line) => ({ sku: line.sku.trim().toUpperCase(), qty: Math.max(1, Math.floor(line.qty)) })),
  });
  flushDraftsToDisk();
}
