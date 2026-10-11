import type { ReplenishmentTransfer } from "@/lib/replenishment";

export type ReplenishmentRouteSuggestion = {
  key: string;
  fromLocationCode: string;
  fromLocationName: string;
  toLocationCode: string;
  toLocationName: string;
  lineCount: number;
  totalQty: number;
  transfers: ReplenishmentTransfer[];
};

/** Grupuje plan uzupelnienia po parze Z → DO (jedno przeniesienie magazynowe). */
export function groupReplenishmentRoutes(transfers: ReplenishmentTransfer[]): ReplenishmentRouteSuggestion[] {
  const map = new Map<string, ReplenishmentRouteSuggestion>();
  for (const transfer of transfers) {
    const from = transfer.fromLocationCode.trim().toUpperCase();
    const to = transfer.toLocationCode.trim().toUpperCase();
    const key = `${from}|${to}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        fromLocationCode: from,
        fromLocationName: transfer.fromLocationName,
        toLocationCode: to,
        toLocationName: transfer.toLocationName,
        lineCount: 0,
        totalQty: 0,
        transfers: [],
      };
      map.set(key, entry);
    }
    entry.transfers.push(transfer);
    entry.lineCount += 1;
    entry.totalQty += transfer.qty;
  }
  return [...map.values()].sort(
    (a, b) =>
      a.toLocationCode.localeCompare(b.toLocationCode, "pl") ||
      a.fromLocationCode.localeCompare(b.fromLocationCode, "pl"),
  );
}
