export type ScanQueueLine = { sku: string; qty: number };

export type ModelGroup = {
  model: string;
  totalQty: number;
  lines: Array<{ sku: string; size: string; qty: number }>;
};

/** Ostatni segment po myślniku = rozmiar; reszta = model (np. S-S-073-152 → S-S-073 / 152). */
export function parseSkuModel(sku: string): { model: string; size: string } {
  const normalized = sku.trim().toUpperCase();
  const lastDash = normalized.lastIndexOf("-");
  if (lastDash <= 0) {
    return { model: normalized, size: "" };
  }
  return {
    model: normalized.slice(0, lastDash),
    size: normalized.slice(lastDash + 1),
  };
}

export function groupQueueByModel(queue: ScanQueueLine[]): ModelGroup[] {
  const map = new Map<string, ModelGroup>();
  const modelOrder: string[] = [];
  for (const line of queue) {
    const sku = line.sku.trim().toUpperCase();
    if (!sku) continue;
    const { model, size } = parseSkuModel(sku);
    let group = map.get(model);
    if (!group) {
      group = { model, totalQty: 0, lines: [] };
      map.set(model, group);
      modelOrder.push(model);
    }
    group.totalQty += line.qty;
    const existing = group.lines.find((entry) => entry.sku === sku);
    if (existing) {
      existing.qty += line.qty;
    } else {
      group.lines.push({ sku, size, qty: line.qty });
    }
  }
  for (const group of map.values()) {
    group.lines.sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true }));
  }
  return modelOrder.map((model) => map.get(model)!).filter(Boolean);
}

export function summarizeScanQueue(queue: ScanQueueLine[]): { totalPieces: number; modelCount: number } {
  return {
    totalPieces: queue.reduce((sum, line) => sum + line.qty, 0),
    modelCount: groupQueueByModel(queue).length,
  };
}

export function formatModelCountLabel(count: number): string {
  if (count === 1) return "1 model";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} modele`;
  }
  return `${count} modeli`;
}

export function formatScanTotals(totalPieces: number, modelCount: number): string {
  if (totalPieces <= 0) return "";
  if (modelCount <= 0) return `${totalPieces} szt.`;
  return `${totalPieces} szt. · ${formatModelCountLabel(modelCount)}`;
}
