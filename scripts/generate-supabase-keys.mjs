#!/usr/bin/env node
/**
 * Generuje sekrety dla lokalnego PostgREST (kompatybilne z @supabase/supabase-js).
 * Uzycie: node scripts/generate-supabase-keys.mjs
 */
import { randomBytes } from "crypto";
import { SignJWT } from "jose";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env");

function upsertEnv(lines, key, value) {
  const prefix = `${key}=`;
  const idx = lines.findIndex((line) => line.startsWith(prefix));
  const next = `${prefix}${value}`;
  if (idx >= 0) lines[idx] = next;
  else lines.push(next);
}

const jwtSecret = randomBytes(48).toString("base64url");
const postgresPassword = randomBytes(24).toString("base64url");
const pgrstDbPassword = randomBytes(24).toString("base64url");
const secretKey = new TextEncoder().encode(jwtSecret);

async function makeJwt(role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("supabase")
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("3650d")
    .sign(secretKey);
}

const serviceRoleKey = await makeJwt("service_role");
const anonKey = await makeJwt("anon");

const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const lines = existing.split("\n").filter((line, idx, arr) => line.length > 0 || idx === arr.length - 1);

upsertEnv(lines, "POSTGRES_PASSWORD", postgresPassword);
upsertEnv(lines, "PGRST_DB_PASSWORD", pgrstDbPassword);
upsertEnv(lines, "PGRST_JWT_SECRET", jwtSecret);
upsertEnv(lines, "SUPABASE_URL", "http://lokalizacje-rest");
upsertEnv(lines, "SUPABASE_ANON_KEY", anonKey);
upsertEnv(lines, "SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey);

const integrationKey = randomBytes(32).toString("hex");
upsertEnv(lines, "LOC_INTEGRATION_API_KEY", integrationKey);

writeFileSync(envPath, `${lines.filter(Boolean).join("\n")}\n`, { mode: 0o600 });

console.log("Zaktualizowano .env (Postgres + PostgREST + klucze Supabase JS).");
console.log("SUPABASE_URL=http://lokalizacje-rest");
console.log("LOC_INTEGRATION_API_KEY zapisany — skopiuj tez do picklist/.env");
