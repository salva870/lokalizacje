#!/usr/bin/env node
/** Sync LOC_INTEGRATION_API_KEY from lokalizacje/.env to picklist/.env */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const locEnv = readFileSync(resolve("/root/lokalizacje/.env"), "utf8");
const match = locEnv.match(/^LOC_INTEGRATION_API_KEY=(.+)$/m);
if (!match?.[1]) {
  console.error("Brak LOC_INTEGRATION_API_KEY w /root/lokalizacje/.env");
  process.exit(1);
}
const key = match[1].trim();
const picklistEnvPath = resolve("/root/dify/docker/picklist/.env");
const lines = existsSync(picklistEnvPath) ? readFileSync(picklistEnvPath, "utf8").split("\n") : [];
const upsert = (k, v) => {
  const prefix = `${k}=`;
  const idx = lines.findIndex((line) => line.startsWith(prefix));
  const next = `${prefix}${v}`;
  if (idx >= 0) lines[idx] = next;
  else lines.push(next);
};
upsert("LOC_API_URL", "http://lokalizacje-app:3000");
upsert("LOC_INTEGRATION_API_KEY", key);
writeFileSync(picklistEnvPath, `${lines.filter(Boolean).join("\n")}\n`, { mode: 0o600 });
console.log("Zaktualizowano picklist/.env");
