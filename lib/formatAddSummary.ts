export type AddQueueLine = { sku: string; qty: number };

/** Krótki opis dodanych kodów produktu do komunikatów UI. */
export function formatAddedSkusSummary(lines: AddQueueLine[], maxShown = 4): string {
  if (lines.length === 0) return "";
  const parts = lines.map((line) => {
    const sku = line.sku.trim().toUpperCase();
    const q = Math.max(1, Math.floor(line.qty));
    return q > 1 ? `${sku} ×${q}` : sku;
  });
  if (parts.length <= maxShown) return parts.join(", ");
  const head = parts.slice(0, maxShown).join(", ");
  return `${head} (+${parts.length - maxShown} kolejnych)`;
}

export function formatAddSuccessMessage(locationCode: string, lines: AddQueueLine[]): string {
  const loc = locationCode.trim().toUpperCase();
  const skuPart = formatAddedSkusSummary(lines);
  if (lines.length === 1) {
    const line = lines[0]!;
    const q = Math.max(1, Math.floor(line.qty));
    return q > 1
      ? `Dodano ${line.sku.trim().toUpperCase()} (${q} szt.) na lokalizację ${loc}.`
      : `Dodano kod ${line.sku.trim().toUpperCase()} na lokalizację ${loc}.`;
  }
  return `Dodano ${lines.length} poz. (${skuPart}) na lokalizację ${loc}.`;
}
