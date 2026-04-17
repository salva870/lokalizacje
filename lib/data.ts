import type { MovementType } from "@/lib/types";
import {
  applyMovement as applyMovementLocal,
  createLocation as createLocationLocal,
  findUserByLogin as findUserByLoginLocal,
  getCurrentStock as getCurrentStockLocal,
  getRecentMovements as getRecentMovementsLocal,
  getRestoreSuggestions as getRestoreSuggestionsLocal,
  listLocations as listLocationsLocal,
  listSkuLocations as listSkuLocationsLocal,
} from "@/lib/store";
import type { LocationType, Zone } from "@/lib/types";
import { getSupabaseClient, isSupabaseConfigured, isSupabasePrivileged } from "@/lib/supabase";

type MovementInput = {
  operatorId: string;
  movementType: MovementType;
  sku: string;
  qty?: number;
  fromLocationCode?: string;
  toLocationCode?: string;
  referenceNo?: string;
};

function mapSupabaseError(error: { code?: string; message?: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "PGRST205" || error.message?.includes("relation")) {
    return "Brak tabel/widokow w Supabase. Uruchom SQL z pliku supabase/schema.sql.";
  }
  if (error.code === "42501") {
    return "Brak uprawnien (RLS). Sprawdz policies oraz mapowanie operatora.";
  }
  return fallback;
}

export async function listLocations() {
  if (!isSupabaseConfigured) return listLocationsLocal();
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("locations")
    .select("code,name,parent_zone,location_type,is_active")
    .order("code", { ascending: true });
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac lokalizacji"));
  return (data ?? []).map((row) => ({
    code: row.code,
    name: row.name,
    parentZone: row.parent_zone,
    locationType: row.location_type,
    isActive: row.is_active,
  }));
}

export async function listSkuLocations(sku: string) {
  if (!isSupabaseConfigured) return listSkuLocationsLocal(sku);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("stock_current")
    .select("location_code,qty")
    .eq("sku", sku.trim().toUpperCase())
    .order("location_code", { ascending: true });
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac lokalizacji SKU"));
  return (data ?? []).map((row) => ({ locationCode: row.location_code, qty: row.qty }));
}

export async function getCurrentStock() {
  if (!isSupabaseConfigured) return getCurrentStockLocal();
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("stock_current")
    .select("location_code,sku,qty")
    .order("location_code", { ascending: true })
    .order("sku", { ascending: true });
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie pobrac stanu"));
  return (data ?? []).map((row) => ({
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
  return (data ?? []).map((row) => ({
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

export async function applyMovement(input: MovementInput) {
  if (!isSupabaseConfigured) return applyMovementLocal(input);
  if (!isSupabasePrivileged) {
    throw new Error("Brak SUPABASE_SERVICE_ROLE_KEY. Dodaj klucz serwerowy w .env backendu.");
  }
  const supabase = getSupabaseClient();
  const qty = input.qty ?? 1;
  const sku = input.sku.trim().toUpperCase();
  const from = input.fromLocationCode?.trim().toUpperCase();
  const to = input.toLocationCode?.trim().toUpperCase();

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
    .filter((code) => !["TMP", "SPRZEDAZ"].includes(code));

  const preferred = (historyRows ?? [])
    .flatMap((row) => [row.to_location_code, row.from_location_code])
    .filter((code): code is string => Boolean(code))
    .filter((code) => !["TMP", "SPRZEDAZ"].includes(code));

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
  const payload = {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    parent_zone: input.parentZone,
    location_type: input.locationType,
    is_active: true,
    barcode_value: `LOC-${input.code.trim().toUpperCase()}`,
  };
  const { data, error } = await supabase
    .from("locations")
    .insert(payload)
    .select("code,name,parent_zone,location_type,is_active")
    .single();
  if (error) throw new Error(mapSupabaseError(error, "Nie udalo sie dodac lokalizacji"));
  return {
    code: data.code,
    name: data.name,
    parentZone: data.parent_zone,
    locationType: data.location_type,
    isActive: data.is_active,
  };
}

export function findUserByLogin(login: string) {
  return findUserByLoginLocal(login);
}
