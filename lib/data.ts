/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "crypto";
import type { MovementType, OperatorDraft, User, SaleItemInput, SaleSessionDetail, SaleSessionSummary } from "@/lib/types";
import {
  applyMovement as applyMovementLocal,
  createLocation as createLocationLocal,
  deleteLocationIfEmptyLocal,
  updateLocationLocal,
  findUserByLogin as findUserByLoginLocal,
  findUserById as findUserByIdLocal,
  updateUserPassword as updateUserPasswordLocal,
  updateOperatorRole as updateOperatorRoleLocal,
  getCurrentStock as getCurrentStockLocal,
  getRecentMovements as getRecentMovementsLocal,
  getPickStatusByReferences as getPickStatusByReferencesLocal,
  getRestoreSuggestions as getRestoreSuggestionsLocal,
  getModelRestoreSuggestions as getModelRestoreSuggestionsLocal,
  getOperatorDraftLocal,
  listLocations as listLocationsLocal,
  listSkuLocations as listSkuLocationsLocal,
  listLocationModelOrderLocal,
  getLocationModelOrderArrayLocal,
  setLocationModelOrderLocal,
  setLocationPickOrderLocal,
  mergeLocationModelOrderLocal,
  reconcileLocationLocal,
  moveEntireLocationLocal,
  setOperatorDraftLocal,
} from "@/lib/store";
import {
  createSaleSessionLocal,
  getSaleSessionLocal,
  listSaleSessionsLocal,
  readSaleAttachmentLocal,
  type SaleAttachmentBuffer,
} from "@/lib/salesStore";
import type { LocationType, Zone } from "@/lib/types";
import { getSupabaseClient, isSupabaseConfigured, isSupabasePrivileged } from "@/lib/supabase";
import { modelsInScanOrder, buildLocationModelOrder, modelsOnLocationFromItems } from "@/lib/modelOrder";
import { parseSkuModel } from "@/lib/skuModel";
import { resolveSingleSourceLocation } from "@/lib/stockSource";

type MovementInput = {
  operatorId: string;
  movementType: MovementType;
  sku: string;
  qty?: number;
  fromLocationCode?: string;
  toLocationCode?: string;
  referenceNo?: string;
};

function mapSupabaseError(error: { code?: string; message?: string; details?: string } | null, fallback: string) {
  if (!error) return fallback;
  const blob = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  if (
    error.code === "PGRST205" ||
    blob.includes("could not find the table")
  ) {
    return "Brak tabeli w API bazy (schema cache). Zrestartuj PostgREST albo uruchom SQL z supabase/schema.sql.";
  }
  if (error.code === "PGRST200") {
    return "Nie mozna polaczyc danych magazynowych (brak relacji w API). Skontaktuj sie z administratorem.";
  }
  if (error.code === "42501") {
    return "Brak uprawnien (RLS). Sprawdz policies oraz mapowanie operatora.";
  }
  const hint = [error.code, error.message, error.details].filter(Boolean).join(" — ");
  return hint ? `${fallback} (${hint})` : fallback;
}

const STOCK_CURRENT_PAGE_SIZE = 1000;

type StockCurrentRow = { location_code: string; sku: string; qty: number };

/** PostgREST domyslnie zwraca max 1000 wierszy — pobieramy stan stronami. */
async function fetchAllStockCurrentRows(supabase: ReturnType<typeof getSupabaseClient>): Promise<StockCurrentRow[]> {
  const rows: StockCurrentRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("stock_current")
      .select("location_code,sku,qty")
      .order("location_code", { ascending: true })
      .order("sku", { ascending: true })
      .range(offset, offset + STOCK_CURRENT_PAGE_SIZE - 1);
    if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac stanu"));
    const page = (data ?? []) as StockCurrentRow[];
    rows.push(...page);
    if (page.length < STOCK_CURRENT_PAGE_SIZE) break;
    offset += STOCK_CURRENT_PAGE_SIZE;
  }
  return rows;
}

function mapLocationRow(row: any) {
  return {
    code: row.code,
    name: row.name,
    parentZone: row.parent_zone as Zone,
    locationType: row.location_type as LocationType,
    isActive: row.is_active,
    barcodeValue: row.barcode_value ?? undefined,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export async function listLocations() {
  if (!isSupabaseConfigured) return listLocationsLocal();
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("locations")
    .select("code,name,parent_zone,location_type,is_active,barcode_value,sort_order")
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac lokalizacji"));
  return ((data ?? []) as any[]).map(mapLocationRow);
}

export async function listSkuLocations(sku: string) {
  if (!isSupabaseConfigured) return listSkuLocationsLocal(sku);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const normalizedSku = sku.trim().toUpperCase();
  const { data: stockRows, error: stockErr } = await supabase
    .from("stock_current")
    .select("location_code,qty")
    .eq("sku", normalizedSku)
    .order("location_code", { ascending: true });
  if (stockErr) throw new Error(mapSupabaseError(stockErr, "Nie udalo sie pobrac lokalizacji SKU"));

  const rows = (stockRows ?? []) as Array<{ location_code: string; qty: number }>;
  const codes = rows.map((row) => row.location_code);
  const metaByCode = new Map<string, { parentZone: Zone; locationType: LocationType; sortOrder: number }>();
  if (codes.length) {
    const { data: locationRows, error: locationErr } = await supabase
      .from("locations")
      .select("code,parent_zone,location_type,sort_order")
      .in("code", codes);
    if (locationErr) throw new Error(mapSupabaseError(locationErr, "Nie udalo sie pobrac metadanych lokalizacji"));
    for (const row of (locationRows ?? []) as Array<{
      code: string;
      parent_zone: Zone;
      location_type: LocationType;
      sort_order: number;
    }>) {
      metaByCode.set(row.code, {
        parentZone: row.parent_zone,
        locationType: row.location_type,
        sortOrder: Number(row.sort_order ?? 0),
      });
    }
  }

  const mapped = rows.map((row) => {
    const meta = metaByCode.get(row.location_code);
    return {
      locationCode: row.location_code,
      qty: row.qty,
      parentZone: meta?.parentZone,
      locationType: meta?.locationType,
      sortOrder: meta?.sortOrder,
    };
  });

  const { comparePickStockLocations } = await import("@/lib/pickPriority");
  return mapped.sort(comparePickStockLocations);
}

export async function getCurrentStock() {
  if (!isSupabaseConfigured) return getCurrentStockLocal();
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const data = await fetchAllStockCurrentRows(supabase);
  return data.map((row) => ({
    locationCode: row.location_code,
    sku: row.sku,
    qty: row.qty,
  }));
}

export async function getRecentMovements(limit = 30) {
  if (!isSupabaseConfigured) return getRecentMovementsLocal(limit);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("stock_movements")
    .select("id,created_at,operator_id,movement_type,sku,qty,from_location_code,to_location_code,reference_no")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac historii"));
  return ((data ?? []) as any[]).map((row) => ({
    id: String(row.id),
    createdAt: row.created_at,
    operatorId: row.operator_id,
    movementType: row.movement_type,
    sku: row.sku,
    qty: row.qty,
    fromLocationCode: row.from_location_code ?? undefined,
    toLocationCode: row.to_location_code ?? undefined,
    referenceNo: row.reference_no ?? undefined,
  }));
}

export async function getPickStatusByReferences(references: string[]) {
  const unique = [...new Set(references.map((ref) => ref.trim()).filter(Boolean))];
  if (!unique.length) return [];
  if (!isSupabaseConfigured) return getPickStatusByReferencesLocal(unique);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const { aggregatePickStatus } = await import("@/lib/pickStatus");
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("stock_movements")
    .select("movement_type,sku,qty,from_location_code,to_location_code,reference_no")
    .in("reference_no", unique);
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac statusu zbierania"));
  const movements = ((data ?? []) as any[]).map((row) => ({
    movementType: row.movement_type,
    sku: row.sku,
    qty: row.qty,
    fromLocationCode: row.from_location_code,
    toLocationCode: row.to_location_code,
    referenceNo: row.reference_no,
  }));
  return aggregatePickStatus(movements, unique);
}

export async function applyMovement(input: MovementInput) {
  if (!isSupabaseConfigured) return applyMovementLocal(input);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const qty = input.qty ?? 1;
  const sku = input.sku.trim().toUpperCase();
  let from = input.fromLocationCode?.trim().toUpperCase();
  let to = input.toLocationCode?.trim().toUpperCase();

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
    const locations = await listSkuLocations(sku);
    from = resolveSingleSourceLocation(sku, qty, locations, from);
  }

  if (from) {
    const { data: fromRows, error: fromErr } = await supabase
      .from("stock_current")
      .select("qty")
      .eq("location_code", from)
      .eq("sku", sku)
      .limit(1);
    if (fromErr) throw new Error(mapSupabaseError(fromErr, "Nie mozna zweryfikowac stanu zrodlowego"));
    const currentQty = fromRows?.[0]?.qty ?? 0;
    if (currentQty < qty) {
      throw new Error("Brak wystarczajacej ilosci na lokalizacji zrodlowej");
    }
  }

  const payload = {
    operator_id: input.operatorId,
    movement_type: input.movementType,
    sku,
    qty,
    from_location_code: from ?? null,
    to_location_code: to ?? null,
    reference_no: input.referenceNo ?? null,
  };

  const { data, error } = await supabase
    .from("stock_movements")
    .insert(payload)
    .select("id,created_at,operator_id,movement_type,sku,qty,from_location_code,to_location_code,reference_no")
    .single();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie zapisac ruchu"));

  if (input.movementType === "ADD" && to) {
    const { model } = parseSkuModel(sku);
    if (model) {
      await mergeLocationModelOrder(to, [model], input.operatorId);
    }
  }

  return {
    id: String(data.id),
    createdAt: data.created_at,
    operatorId: data.operator_id,
    movementType: data.movement_type,
    sku: data.sku,
    qty: data.qty,
    fromLocationCode: data.from_location_code ?? undefined,
    toLocationCode: data.to_location_code ?? undefined,
    referenceNo: data.reference_no ?? undefined,
  };
}

export async function getRestoreSuggestions(sku: string) {
  if (!isSupabaseConfigured) return getRestoreSuggestionsLocal(sku);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const normalizedSku = sku.trim().toUpperCase();

  const { data: stockRows, error: stockError } = await supabase
    .from("stock_current")
    .select("location_code")
    .eq("sku", normalizedSku);
  if (stockError) throw new Error(mapSupabaseError(stockError, "Nie udalo sie pobrac sugestii"));

  const { data: historyRows, error: historyError } = await supabase
    .from("stock_movements")
    .select("to_location_code,from_location_code")
    .eq("sku", normalizedSku)
    .order("created_at", { ascending: false })
    .limit(200);
  if (historyError) throw new Error(mapSupabaseError(historyError, "Nie udalo sie pobrac sugestii"));

  const currentLocations = (stockRows ?? [])
    .map((row) => row.location_code)
    .filter((code): code is string => Boolean(code))
    .filter((code) => !["TMP", "SPRZEDAZ", "USZKODZONE"].includes(code));

  const preferred = (historyRows ?? [])
    .flatMap((row) => [row.to_location_code, row.from_location_code])
    .filter((code): code is string => Boolean(code))
    .filter((code) => !["TMP", "SPRZEDAZ", "USZKODZONE"].includes(code));

  const lastLocation = preferred[0] ?? null;
  const counts = new Map<string, number>();
  for (const locationCode of preferred) {
    counts.set(locationCode, (counts.get(locationCode) ?? 0) + 1);
  }
  const topLocation = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    lastLocation,
    topLocation,
    currentLocations,
    suggestions: [lastLocation, topLocation, ...currentLocations].filter(
      (value, idx, arr): value is string => Boolean(value) && arr.indexOf(value) === idx,
    ),
  };
}

export async function getModelRestoreSuggestions(sku: string) {
  if (!isSupabaseConfigured) return getModelRestoreSuggestionsLocal(sku);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const normalizedSku = sku.trim().toUpperCase();
  const { model } = parseSkuModel(normalizedSku);
  const excluded = new Set(["TMP", "SPRZEDAZ", "USZKODZONE"]);

  const [stockResult, locationResult] = await Promise.all([
    fetchAllStockCurrentRows(supabase),
    supabase.from("locations").select("code,name"),
  ]);
  if (locationResult.error) {
    throw new Error(mapSupabaseError(locationResult.error, "Nie udalo sie pobrac sugestii"));
  }
  const stockRows = stockResult.filter((row) => row.qty > 0);

  const locationNames = new Map<string, string>();
  for (const row of locationResult.data ?? []) {
    if (row.code) locationNames.set(String(row.code).toUpperCase(), String(row.name ?? ""));
  }

  const byLocation = new Map<string, { qty: number; skus: Set<string> }>();
  for (const row of stockRows ?? []) {
    const locationCode = String(row.location_code ?? "").toUpperCase();
    const rowSku = String(row.sku ?? "").toUpperCase();
    const qty = Number(row.qty ?? 0);
    if (!locationCode || !rowSku || qty <= 0) continue;
    if (excluded.has(locationCode)) continue;
    if (parseSkuModel(rowSku).model !== model) continue;
    const entry = byLocation.get(locationCode) ?? { qty: 0, skus: new Set<string>() };
    entry.qty += qty;
    entry.skus.add(rowSku);
    byLocation.set(locationCode, entry);
  }

  const locationList = [...byLocation.entries()]
    .map(([locationCode, { qty, skus }]) => ({
      locationCode,
      locationName: locationNames.get(locationCode) ?? null,
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

export async function createLocation(input: {
  code: string;
  name: string;
  parentZone: Zone;
  locationType: LocationType;
}) {
  if (!isSupabaseConfigured) return createLocationLocal(input);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const existing = await listLocations();
  const nextSort = existing.reduce((max, loc) => Math.max(max, loc.sortOrder ?? 0), 0) + 10;
  const payload = {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    parent_zone: input.parentZone,
    location_type: input.locationType,
    is_active: true,
    barcode_value: `LOC-${input.code.trim().toUpperCase()}`,
    sort_order: nextSort,
  };
  const { data, error } = await supabase
    .from("locations")
    .insert(payload)
    .select("code,name,parent_zone,location_type,is_active,barcode_value,sort_order")
    .single();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie dodac lokalizacji"));
  return mapLocationRow(data);
}

export async function updateLocation(
  code: string,
  input: {
    name?: string;
    parentZone?: Zone;
    locationType?: LocationType;
    isActive?: boolean;
  },
) {
  const c = code.trim().toUpperCase();
  if (!c) throw new Error("Brak kodu lokalizacji");
  if (!isSupabaseConfigured) return updateLocationLocal(c, input);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.parentZone !== undefined) payload.parent_zone = input.parentZone;
  if (input.locationType !== undefined) payload.location_type = input.locationType;
  if (input.isActive !== undefined) payload.is_active = input.isActive;
  if (Object.keys(payload).length === 0) throw new Error("Brak pol do aktualizacji");

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("locations")
    .update(payload)
    .eq("code", c)
    .select("code,name,parent_zone,location_type,is_active,barcode_value,sort_order")
    .single();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie zaktualizowac lokalizacji"));
  if (!data) throw new Error("Brak lokalizacji");
  return mapLocationRow(data);
}

export async function setLocationPickOrder(codes: string[]) {
  if (!isSupabaseConfigured) return setLocationPickOrderLocal(codes);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const all = await listLocations();
  const known = new Set(all.map((loc) => loc.code));
  const unique = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))].filter((code) =>
    known.has(code),
  );
  const remaining = all.map((loc) => loc.code).filter((code) => !unique.includes(code));
  const ordered = [...unique, ...remaining];
  const supabase = getSupabaseClient();
  for (let index = 0; index < ordered.length; index += 1) {
    const { error } = await supabase.from("locations").update({ sort_order: index * 10 }).eq("code", ordered[index]);
    if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie zapisac kolejnosci lokalizacji"));
  }
  return listLocations();
}

export async function deleteLocationIfEmpty(code: string) {
  const c = code.trim().toUpperCase();
  if (!c) throw new Error("Brak kodu lokalizacji");
  if (!isSupabaseConfigured) {
    deleteLocationIfEmptyLocal(c);
    return;
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data: rows, error: stockErr } = await supabase
    .from("stock_current")
    .select("qty")
    .eq("location_code", c);
  if (stockErr) throw new Error(mapSupabaseError(stockErr, "Nie mozna sprawdzic stanu lokalizacji"));
  const sumQty = (rows ?? []).reduce((acc, row) => acc + (Number(row.qty) || 0), 0);
  if (sumQty !== 0) {
    throw new Error("Lokalizacja nie jest pusta — najpierw przenies lub zdejmij towar");
  }
  const { error: delErr } = await supabase.from("locations").delete().eq("code", c);
  if (delErr) throw new Error(mapSupabaseError(delErr, "Nie udalo sie usunac lokalizacji"));
}

function normalizeOperatorPasswordHash(raw: string | null | undefined): string | null {
  if (!raw) return null;
  /** Usuwa spacje/CR z wklejonego hasha (częsty błąd po kopiowaniu z SQL). */
  const compact = raw.replace(/\s+/g, "").trim();
  return compact || null;
}

export async function findUserByLogin(login: string): Promise<User | null> {
  if (!isSupabaseConfigured) {
    return findUserByLoginLocal(login) ?? null;
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const rawLogin = login.trim();
  if (!rawLogin) return null;

  const selectCols = "id,login,role,password_hash,is_active";
  const pick = (data: {
    id: string;
    login: string;
    role: string;
    password_hash: string | null;
    is_active: boolean;
  } | null) => {
    if (!data || !data.is_active) return null;
    const passwordHash = normalizeOperatorPasswordHash(data.password_hash);
    if (!passwordHash) return null;
    return {
      id: data.id,
      login: data.login,
      passwordHash,
      role: data.role as User["role"],
    };
  };

  const byExact = await supabase.from("operators").select(selectCols).eq("login", rawLogin).limit(1).maybeSingle();
  if (byExact.error) throw new Error(mapSupabaseError(byExact.error, "Nie udalo sie pobrac uzytkownika"));
  const exact = pick(byExact.data);
  if (exact) return exact;

  const byCi = await supabase.from("operators").select(selectCols).ilike("login", rawLogin).limit(1).maybeSingle();
  if (byCi.error) throw new Error(mapSupabaseError(byCi.error, "Nie udalo sie pobrac uzytkownika"));
  return pick(byCi.data);
}

export async function findOperatorById(operatorId: string): Promise<User | null> {
  const id = operatorId.trim();
  if (!id) return null;
  if (!isSupabaseConfigured) {
    return findUserByIdLocal(id) ?? null;
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("operators")
    .select("id,login,role,password_hash,is_active")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac uzytkownika"));
  if (!data || !data.is_active) return null;
  const passwordHash = normalizeOperatorPasswordHash(data.password_hash);
  if (!passwordHash) return null;
  return {
    id: data.id,
    login: data.login,
    passwordHash,
    role: data.role as User["role"],
  };
}

export async function listOperatorsForAdmin() {
  if (!isSupabaseConfigured) {
    const admin = findUserByLoginLocal("admin");
    return admin ? [{ id: admin.id, login: admin.login, role: admin.role, isActive: true }] : [];
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("operators")
    .select("id,login,role,is_active,created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac operatorow"));
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    login: row.login,
    role: row.role,
    isActive: row.is_active,
  }));
}

export async function createOperator(input: { login: string; password: string; role: "ADMIN" | "OPERATOR" }) {
  if (!isSupabaseConfigured) {
    throw new Error("Tworzenie operatorow wymaga Supabase (lokalny tryb ma tylko konto admin).");
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.hash(input.password, 10);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("operators")
    .insert({
      id: randomUUID(),
      login: input.login.trim(),
      role: input.role,
      password_hash: passwordHash,
      is_active: true,
      auth_user_id: null,
    })
    .select("id,login,role,is_active")
    .single();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie utworzyc operatora"));
  return { id: data.id, login: data.login, role: data.role, isActive: data.is_active };
}

export async function setOperatorPassword(operatorId: string, password: string) {
  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.hash(password, 10);
  if (!isSupabaseConfigured) {
    updateUserPasswordLocal(operatorId, passwordHash);
    return;
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("operators")
    .update({ password_hash: passwordHash })
    .eq("id", operatorId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie zmienic hasla"));
  if (!data?.id) {
    throw new Error(
      "Nie zaktualizowano hasla (0 wierszy). Sesja moze wskazywac inny identyfikator niz rekord w tabeli operators — wyloguj sie i zaloguj ponownie.",
    );
  }
}

export async function setOperatorRole(operatorId: string, role: "ADMIN" | "OPERATOR") {
  const id = operatorId.trim();
  if (!id) throw new Error("Brak identyfikatora operatora");

  const operators = await listOperatorsForAdmin();
  const target = operators.find((entry) => entry.id === id);
  if (!target) throw new Error("Nie znaleziono operatora");

  if (role === "OPERATOR" && target.role === "ADMIN") {
    const activeAdmins = operators.filter((entry) => entry.role === "ADMIN" && entry.isActive);
    if (activeAdmins.length <= 1) {
      throw new Error("Nie mozna odebrac roli ostatniemu administratorowi.");
    }
  }

  if (!isSupabaseConfigured) {
    updateOperatorRoleLocal(id, role);
    return { id, login: target.login, role };
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("operators")
    .update({ role })
    .eq("id", id)
    .select("id,login,role,is_active")
    .maybeSingle();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie zmienic roli operatora"));
  if (!data?.id) throw new Error("Nie znaleziono operatora");
  return { id: data.id, login: data.login, role: data.role as "ADMIN" | "OPERATOR", isActive: data.is_active };
}

function normalizeDraft(draft: Partial<OperatorDraft>): OperatorDraft {
  const cleanQueue = (rows: unknown): Array<{ sku: string; qty: number }> =>
    Array.isArray(rows)
      ? rows
          .map((line) => ({
            sku: String((line as { sku?: unknown }).sku ?? "").trim().toUpperCase(),
            qty: Math.max(1, Math.floor(Number((line as { qty?: unknown }).qty) || 1)),
          }))
          .filter((line) => line.sku.length > 0)
      : [];
  return {
    activeLocationCode: draft.activeLocationCode?.trim().toUpperCase() || null,
    fromLocationCode: draft.fromLocationCode?.trim().toUpperCase() ?? "",
    toLocationCode: draft.toLocationCode?.trim().toUpperCase() ?? "",
    addQueue: cleanQueue(draft.addQueue),
    moveQueue: cleanQueue(draft.moveQueue),
    reconcileQueue: cleanQueue(draft.reconcileQueue),
  };
}

export async function listLocationModelOrder(locationCode?: string) {
  if (!isSupabaseConfigured) return listLocationModelOrderLocal(locationCode);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  let query = supabase.from("location_model_order").select("location_code,model,sort_order").order("sort_order", { ascending: true });
  if (locationCode) {
    query = query.eq("location_code", locationCode.trim().toUpperCase());
  }
  const { data, error } = await query;
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac kolejnosci modeli"));
  return ((data ?? []) as any[]).map((row) => ({
    locationCode: row.location_code,
    model: row.model,
    sortOrder: row.sort_order,
  }));
}

export async function getLocationModelOrderArray(locationCode: string): Promise<string[]> {
  const rows = await listLocationModelOrder(locationCode);
  return rows
    .filter((row) => row.locationCode === locationCode.trim().toUpperCase())
    .sort((a, b) => a.sortOrder - b.sortOrder || a.model.localeCompare(b.model))
    .map((row) => row.model);
}

export async function setLocationModelOrder(
  locationCode: string,
  models: string[],
  updatedBy?: string,
) {
  const code = locationCode.trim().toUpperCase();
  if (!code) throw new Error("Brak kodu lokalizacji");
  const normalized = models.map((m) => m.trim().toUpperCase()).filter(Boolean);
  if (!isSupabaseConfigured) {
    setLocationModelOrderLocal(code, normalized, updatedBy);
    return;
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { error: delErr } = await supabase.from("location_model_order").delete().eq("location_code", code);
  if (delErr) throw new Error(mapSupabaseError(delErr, "Nie udalo sie wyczyscic kolejnosci modeli"));
  if (normalized.length === 0) return;
  const payload = normalized.map((model, index) => ({
    location_code: code,
    model,
    sort_order: index * 10,
    updated_by: updatedBy ?? null,
  }));
  const { error: insErr } = await supabase.from("location_model_order").insert(payload);
  if (insErr) throw new Error(mapSupabaseError(insErr, "Nie udalo sie zapisac kolejnosci modeli"));
}

export async function mergeLocationModelOrder(
  locationCode: string,
  scannedModels: string[],
  updatedBy?: string,
) {
  if (!isSupabaseConfigured) {
    mergeLocationModelOrderLocal(locationCode, scannedModels, updatedBy);
    return;
  }
  const existing = await getLocationModelOrderArray(locationCode);
  const { mergeModelOrder } = await import("@/lib/modelOrder");
  await setLocationModelOrder(locationCode, mergeModelOrder(existing, scannedModels), updatedBy);
}

export async function reconcileLocation(
  operatorId: string,
  locationCode: string,
  items: Array<{ sku: string; qty: number }>,
) {
  if (!isSupabaseConfigured) {
    reconcileLocationLocal(operatorId, locationCode, items);
    return;
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const code = locationCode.trim().toUpperCase();
  const target = new Map<string, number>();
  for (const item of items) {
    const sku = item.sku.trim().toUpperCase();
    if (!sku) continue;
    target.set(sku, (target.get(sku) ?? 0) + Math.max(1, Math.floor(item.qty)));
  }
  const allStock = await getCurrentStock();
  const current = allStock.filter((row) => row.locationCode === code);
  for (const row of current) {
    const targetQty = target.get(row.sku) ?? 0;
    if (row.qty > targetQty) {
      await applyMovement({
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
      await applyMovement({
        operatorId,
        movementType: "ADD",
        sku,
        qty: targetQty - currentQty,
        toLocationCode: code,
      });
    }
  }
  const existing = await getLocationModelOrderArray(code);
  const scannedModels = modelsInScanOrder(items);
  const modelsOnLocation = modelsOnLocationFromItems(items);
  const nextOrder = buildLocationModelOrder(existing, scannedModels, modelsOnLocation);
  await setLocationModelOrder(code, nextOrder, operatorId);
}

export async function moveEntireLocation(
  operatorId: string,
  fromLocationCode: string,
  toLocationCode: string,
) {
  const from = fromLocationCode.trim().toUpperCase();
  const to = toLocationCode.trim().toUpperCase();
  if (!from || !to) throw new Error("Brak lokalizacji zrodlowej lub docelowej");
  if (from === to) throw new Error("Lokalizacja zrodlowa i docelowa musza byc rozne");

  if (!isSupabaseConfigured) {
    return moveEntireLocationLocal(operatorId, from, to);
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }

  const allLocations = await listLocations();
  if (!allLocations.some((loc) => loc.code === from && loc.isActive)) {
    throw new Error("Brak aktywnej lokalizacji zrodlowej");
  }
  if (!allLocations.some((loc) => loc.code === to && loc.isActive)) {
    throw new Error("Brak aktywnej lokalizacji docelowej");
  }

  const allStock = await getCurrentStock();
  const rows = allStock.filter((row) => row.locationCode === from);
  if (rows.length === 0) {
    throw new Error("Lokalizacja zrodlowa jest pusta — nie ma czego przenosic");
  }

  for (const row of rows) {
    await applyMovement({
      operatorId,
      movementType: "MOVE",
      sku: row.sku,
      qty: row.qty,
      fromLocationCode: from,
      toLocationCode: to,
      referenceNo: `LOC_MOVE:${from}->${to}`,
    });
  }

  const sourceModels = await getLocationModelOrderArray(from);
  const stockModels = modelsInScanOrder(rows.map((row) => ({ sku: row.sku })));
  const modelsToMerge = sourceModels.length > 0 ? sourceModels : stockModels;
  if (modelsToMerge.length > 0) {
    await mergeLocationModelOrder(to, modelsToMerge, operatorId);
  }
  await setLocationModelOrder(from, [], operatorId);

  return {
    fromLocationCode: from,
    toLocationCode: to,
    movedSkuCount: rows.length,
    movedPieceCount: rows.reduce((sum, row) => sum + row.qty, 0),
  };
}

export async function getOperatorDraft(operatorId: string): Promise<OperatorDraft> {
  const id = operatorId.trim();
  if (!id) throw new Error("Brak operatora");
  if (!isSupabaseConfigured) {
    return getOperatorDraftLocal(id);
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("operator_drafts").select("payload").eq("operator_id", id).maybeSingle();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac draftu"));
  return normalizeDraft((data?.payload ?? {}) as Partial<OperatorDraft>);
}

export async function saveOperatorDraft(operatorId: string, draft: Partial<OperatorDraft>): Promise<OperatorDraft> {
  const id = operatorId.trim();
  if (!id) throw new Error("Brak operatora");
  const normalized = normalizeDraft(draft);
  if (!isSupabaseConfigured) {
    setOperatorDraftLocal(id, normalized);
    return normalized;
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("operator_drafts")
    .upsert({ operator_id: id, payload: normalized }, { onConflict: "operator_id" })
    .select("payload")
    .single();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie zapisac draftu"));
  return normalizeDraft((data?.payload ?? {}) as Partial<OperatorDraft>);
}

export type { SaleAttachmentBuffer };

export async function listSaleSessions(limit = 50): Promise<SaleSessionSummary[]> {
  if (!isSupabaseConfigured) return listSaleSessionsLocal(limit);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("sale_sessions")
    .select("id,created_at,operator_id,note,sale_items(qty,sku),sale_attachments(id)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac historii sprzedazy"));

  return (data ?? []).map((row: any) => {
    const items = Array.isArray(row.sale_items) ? row.sale_items : [];
    const attachments = Array.isArray(row.sale_attachments) ? row.sale_attachments : [];
    return {
      id: String(row.id),
      createdAt: row.created_at,
      operatorId: row.operator_id,
      itemCount: items.length,
      pieceCount: items.reduce((sum: number, item: { qty?: number }) => sum + Number(item.qty ?? 0), 0),
      photoCount: attachments.length,
      note: row.note ?? undefined,
    };
  });
}

export async function getSaleSession(id: string): Promise<SaleSessionDetail | null> {
  if (!isSupabaseConfigured) return getSaleSessionLocal(id);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("sale_sessions")
    .select(
      "id,created_at,operator_id,note,sale_items(id,sku,qty,from_location_code,movement_id,note,sort_order),sale_attachments(id,item_id,mime_type,original_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac sprzedazy"));
  if (!data) return null;

  const items = (Array.isArray(data.sale_items) ? data.sale_items : []).slice().sort((a: any, b: any) => {
    return Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
  });
  const attachments = Array.isArray(data.sale_attachments) ? data.sale_attachments : [];
  const attachmentsByItem = new Map<string, any[]>();
  for (const attachment of attachments) {
    const itemId = attachment.item_id ? String(attachment.item_id) : "";
    if (!itemId) continue;
    const list = attachmentsByItem.get(itemId) ?? [];
    list.push(attachment);
    attachmentsByItem.set(itemId, list);
  }

  const mappedItems = items.map((item: any) => ({
    id: String(item.id),
    sku: item.sku ?? undefined,
    qty: Number(item.qty ?? 0),
    fromLocationCode: item.from_location_code ?? undefined,
    movementId: item.movement_id != null ? String(item.movement_id) : undefined,
    note: item.note ?? undefined,
    attachments: (attachmentsByItem.get(String(item.id)) ?? []).map((attachment: any) => ({
      id: String(attachment.id),
      mimeType: attachment.mime_type,
      originalName: attachment.original_name ?? undefined,
      url: `/api/sales/attachments/${attachment.id}`,
    })),
  }));

  return {
    id: String(data.id),
    createdAt: data.created_at,
    operatorId: data.operator_id,
    itemCount: mappedItems.length,
    pieceCount: mappedItems.reduce((sum, item) => sum + item.qty, 0),
    photoCount: attachments.length,
    note: data.note ?? undefined,
    items: mappedItems,
  };
}

async function saveSaleAttachmentFile(sessionId: string, attachmentId: string, buffer: Buffer, mimeType: string) {
  const fs = await import("fs");
  const path = await import("path");
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const relPath = path.join(sessionId, `${attachmentId}.${ext}`);
  const root = path.join(process.cwd(), "logs", "sales");
  const absPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, buffer);
  return relPath.replace(/\\/g, "/");
}

export async function createSaleSession(
  operatorId: string,
  items: SaleItemInput[],
  attachments: SaleAttachmentBuffer[],
  note?: string,
): Promise<SaleSessionDetail> {
  if (!isSupabaseConfigured) {
    return createSaleSessionLocal(operatorId, items, attachments, note);
  }
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  if (items.length === 0) throw new Error("Lista sprzedazy jest pusta.");

  const supabase = getSupabaseClient();
  const { data: sessionRow, error: sessionError } = await supabase
    .from("sale_sessions")
    .insert({ operator_id: operatorId, note: note?.trim() || null })
    .select("id,created_at,operator_id,note")
    .single();
  if (sessionError) throw new Error(mapSupabaseError(sessionError, "Nie udalo sie zapisac sprzedazy"));

  const sessionId = String(sessionRow.id);
  const attachmentByKey = new Map(attachments.map((entry) => [entry.clientKey, entry]));

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const sku = item.sku?.trim().toUpperCase();
    let movementId: number | null = null;

    if (sku) {
      const movement = await applyMovement({
        operatorId,
        movementType: "MOVE_TO_SALE",
        sku,
        qty: item.qty,
        fromLocationCode: item.fromLocationCode,
        referenceNo: sessionId,
      });
      movementId = Number(movement.id);
    }

    const { data: itemRow, error: itemError } = await supabase
      .from("sale_items")
      .insert({
        session_id: sessionId,
        sku: sku || null,
        qty: item.qty,
        from_location_code: item.fromLocationCode?.trim().toUpperCase() || null,
        movement_id: movementId,
        note: item.note?.trim() || null,
        sort_order: index,
      })
      .select("id")
      .single();
    if (itemError) throw new Error(mapSupabaseError(itemError, "Nie udalo sie zapisac pozycji sprzedazy"));

    if (item.clientKey) {
      const file = attachmentByKey.get(item.clientKey);
      if (file) {
        const attachmentId = randomUUID();
        const storagePath = await saveSaleAttachmentFile(sessionId, attachmentId, file.buffer, file.mimeType);
        const { error: attachmentError } = await supabase.from("sale_attachments").insert({
          id: attachmentId,
          session_id: sessionId,
          item_id: itemRow.id,
          storage_path: storagePath,
          mime_type: file.mimeType,
          original_name: file.originalName ?? null,
        });
        if (attachmentError) throw new Error(mapSupabaseError(attachmentError, "Nie udalo sie zapisac zdjecia"));
      }
    }
  }

  const detail = await getSaleSession(sessionId);
  if (!detail) throw new Error("Nie udalo sie odczytac zapisanej sprzedazy.");
  return detail;
}

export async function readSaleAttachment(id: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!isSupabaseConfigured) return readSaleAttachmentLocal(id);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("sale_attachments")
    .select("storage_path,mime_type")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac zalacznika"));
  if (!data?.storage_path) return null;

  const fs = await import("fs");
  const path = await import("path");
  const absPath = path.join(process.cwd(), "logs", "sales", data.storage_path);
  if (!fs.existsSync(absPath)) return null;
  return { buffer: fs.readFileSync(absPath), mimeType: data.mime_type };
}
