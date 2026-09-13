import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);
export const isSupabasePrivileged = Boolean(url && serviceRoleKey);

export function getSupabaseClient() {
  if (!url || (!anonKey && !serviceRoleKey)) {
    throw new Error("Supabase nie jest skonfigurowany");
  }
  return createClient(url, serviceRoleKey || anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
