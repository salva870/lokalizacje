#!/usr/bin/env node
/**
 * Reset hasła operatora w Supabase tym samym algorytmem co aplikacja (bcrypt).
 *
 * Użycie (w katalogu projektu, z tymi samymi zmienniami co backend):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/reset-admin-password.mjs [login] [nowe_haslo]
 *
 * Domyślnie: login admin, hasło DivotiAdmin2026!
 */

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const login = (process.argv[2] || "admin").trim();
const newPassword = process.argv[3] || "DivotiAdmin2026!";

if (!url || !key) {
  console.error("Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w środowisku.");
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error("Hasło musi mieć min. 8 znaków (tak jak w API logowania).");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const passwordHash = await bcrypt.hash(newPassword, 10);

let row = null;
const sel = "id,login,is_active";
const r1 = await supabase.from("operators").select(sel).eq("login", login).maybeSingle();
if (r1.error) {
  console.error("Odczyt operators:", r1.error.message);
  process.exit(1);
}
row = r1.data;
if (!row) {
  const r2 = await supabase.from("operators").select(sel).ilike("login", login).limit(1).maybeSingle();
  if (r2.error) {
    console.error("Odczyt operators:", r2.error.message);
    process.exit(1);
  }
  row = r2.data;
}

if (!row) {
  console.error(
    `Brak wiersza w tabeli operators dla loginu „${login}”. Sprawdź dokładną wartość kolumny login w Supabase.`,
  );
  process.exit(1);
}

const { data: updated, error: updErr } = await supabase
  .from("operators")
  .update({ password_hash: passwordHash, is_active: true })
  .eq("id", row.id)
  .select("id,login,is_active");

if (updErr) {
  console.error("Update:", updErr.message);
  process.exit(1);
}
if (!updated?.length) {
  console.error("Update nie zmienił żadnego wiersza (RLS? złe id?).");
  process.exit(1);
}

console.log("Zaktualizowano operatora:", updated.map((r) => `${r.login} (${r.id})`).join(", "));
console.log("Możesz zalogować się hasłem ustawionym w tym skrypcie.");
