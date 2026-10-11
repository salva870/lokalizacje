#!/usr/bin/env node
/**
 * Blokuje build, gdy w repo wraca legacy UI (dropdown / stare sciezki),
 * ktore w Next.js nadpisuje kanoniczny panel z kafelkami.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const forbiddenIfCanonicalExists = [
  {
    legacy: "app/page.tsx",
    canonical: "app/(protected)/page.tsx",
    hint: "Strona glowna LOC: tylko app/(protected)/page.tsx (kafle operacji). Nie przywracaj app/page.tsx.",
  },
  {
    legacy: "app/admin/page.tsx",
    canonical: "app/(protected)/admin/page.tsx",
    hint: "Admin: tylko app/(protected)/admin/page.tsx.",
  },
  {
    legacy: "app/settings/page.tsx",
    canonical: "app/(protected)/settings/page.tsx",
    hint: "Ustawienia: tylko app/(protected)/settings/page.tsx.",
  },
];

let failed = false;

for (const { legacy, canonical, hint } of forbiddenIfCanonicalExists) {
  const legacyPath = path.join(root, legacy);
  const canonicalPath = path.join(root, canonical);
  if (fs.existsSync(legacyPath) && fs.existsSync(canonicalPath)) {
    console.error(`\n[check-canonical-routes] Konflikt routingu:\n  legacy:    ${legacy}\n  kanoniczny: ${canonical}\n  ${hint}\n`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("[check-canonical-routes] OK — brak legacy stron konfliktujacych z (protected).");
