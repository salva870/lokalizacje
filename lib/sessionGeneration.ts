import { getSupabaseClient, isSupabaseConfigured, isSupabasePrivileged } from "@/lib/supabase";

/** Tokeny bez tego pola albo ze starsza generacja sa odrzucane. Wymusza ponowne logowanie. */
export const MIN_SESSION_GENERATION = 2;

const SETTING_KEY = "session_generation";
const CACHE_MS = 1500;

let cached: { value: number; at: number } | null = null;
let localGeneration = MIN_SESSION_GENERATION;

export function invalidateSessionGenerationCache() {
  cached = null;
}

export async function getSessionGeneration(): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let dbGen = MIN_SESSION_GENERATION;
  try {
    dbGen = await readSessionGeneration();
  } catch {
    dbGen = MIN_SESSION_GENERATION;
  }
  const value = Math.max(MIN_SESSION_GENERATION, dbGen, localGeneration);
  cached = { value, at: Date.now() };
  return value;
}

export async function bumpSessionGeneration(): Promise<number> {
  const current = await getSessionGeneration();
  const next = current + 1;
  localGeneration = next;
  await writeSessionGeneration(next);
  invalidateSessionGenerationCache();
  cached = { value: next, at: Date.now() };
  return next;
}

async function readSessionGeneration(): Promise<number> {
  if (!isSupabaseConfigured || !isSupabasePrivileged) return localGeneration;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", SETTING_KEY).maybeSingle();
  if (error || !data?.value) return localGeneration;
  const parsed = Number.parseInt(String(data.value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : localGeneration;
}

async function writeSessionGeneration(value: number): Promise<void> {
  localGeneration = value;
  if (!isSupabaseConfigured || !isSupabasePrivileged) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("app_settings").upsert(
    { key: SETTING_KEY, value: String(value), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) throw new Error("Nie udalo sie zapisac uniewaznienia sesji");
}
