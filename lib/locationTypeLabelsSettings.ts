import type { LocationType } from "@/lib/types";
import { defaultLocationTypeLabels } from "@/lib/locationMeta";
import { getSupabaseClient, isSupabaseConfigured, isSupabasePrivileged } from "@/lib/supabase";

const SETTING_KEY = "location_type_labels";

type LabelsMap = Record<LocationType, string>;

let localOverrides: Partial<LabelsMap> = {};

function mergeLabels(overrides: Partial<LabelsMap>): LabelsMap {
  return { ...defaultLocationTypeLabels, ...overrides };
}

export function getDefaultLocationTypeLabels(): LabelsMap {
  return { ...defaultLocationTypeLabels };
}

export function getLocationTypeLabelsSync(): LabelsMap {
  return mergeLabels(localOverrides);
}

export function setLocationTypeLabelsLocal(overrides: Partial<LabelsMap>) {
  localOverrides = { ...overrides };
}

export async function getLocationTypeLabels(): Promise<LabelsMap> {
  if (!isSupabaseConfigured || !isSupabasePrivileged) {
    return getLocationTypeLabelsSync();
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", SETTING_KEY).maybeSingle();
  if (error || !data?.value) {
    return getLocationTypeLabelsSync();
  }
  try {
    const parsed = JSON.parse(data.value) as Partial<LabelsMap>;
    localOverrides = parsed;
    return mergeLabels(parsed);
  } catch {
    return getLocationTypeLabelsSync();
  }
}

export async function saveLocationTypeLabels(overrides: Partial<LabelsMap>): Promise<LabelsMap> {
  const merged = mergeLabels(overrides);
  const payload: Partial<LabelsMap> = {};
  for (const type of Object.keys(defaultLocationTypeLabels) as LocationType[]) {
    const next = overrides[type]?.trim();
    if (next && next !== defaultLocationTypeLabels[type]) {
      payload[type] = next;
    }
  }

  if (!isSupabaseConfigured || !isSupabasePrivileged) {
    localOverrides = payload;
    return mergeLabels(payload);
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("app_settings").upsert(
    { key: SETTING_KEY, value: JSON.stringify(payload) },
    { onConflict: "key" },
  );
  if (error) throw new Error("Nie udalo sie zapisac nazw typow lokalizacji");
  localOverrides = payload;
  return mergeLabels(payload);
}

export function formatLocationTypeLabel(type: LocationType, labels?: LabelsMap): string {
  const map = labels ?? getLocationTypeLabelsSync();
  return map[type] ?? type;
}
