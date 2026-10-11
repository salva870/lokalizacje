import type { StockMovement } from "@/lib/types";

export type StockBulkAnomaly = {
  id: string;
  startedAt: string;
  endedAt: string;
  addCount: number;
  distinctLocations: number;
  distinctSkus: number;
  totalQty: number;
  picklistRestore: boolean;
  rolledBack: boolean;
  movementIds: string[];
  lines: Array<{
    id: string;
    createdAt: string;
    sku: string;
    qty: number;
    locationCode: string;
    referenceNo?: string;
  }>;
};

export const BULK_ROLLBACK_REF_PREFIX = "BULK_ROLLBACK:";

/** Po tym czasie od ostatniej otwartej anomalii ukrywamy baner na stronie glownej. */
export const HOME_STOCK_ALERT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function shouldShowHomeStockAlert(
  anomalies: StockBulkAnomaly[],
  options?: { now?: Date },
): boolean {
  const now = options?.now ?? new Date();
  const open = anomalies.filter((entry) => !entry.rolledBack);
  if (!open.length) return false;
  let latestEndedMs = 0;
  for (const entry of open) {
    const ended = new Date(entry.endedAt).getTime();
    if (!Number.isNaN(ended) && ended > latestEndedMs) {
      latestEndedMs = ended;
    }
  }
  if (!latestEndedMs) return false;
  return now.getTime() - latestEndedMs <= HOME_STOCK_ALERT_MAX_AGE_MS;
}

const CLUSTER_GAP_MS = 20_000;
const MIN_ADD_COUNT = 8;
const MIN_DISTINCT_LOCATIONS = 4;
const LOOKBACK_DAYS = 120;

function isPicklistRestoreAdd(movement: StockMovement): boolean {
  return (
    movement.movementType === "ADD" &&
    Boolean(movement.toLocationCode) &&
    String(movement.referenceNo || "").trim().toUpperCase().startsWith("PL:")
  );
}

function rollbackRefForBatch(batchId: string): string {
  return `${BULK_ROLLBACK_REF_PREFIX}${batchId}`;
}

export function isBulkRollbackReference(referenceNo?: string | null): boolean {
  return String(referenceNo || "").trim().startsWith(BULK_ROLLBACK_REF_PREFIX);
}

export function detectStockBulkAnomalies(
  movements: StockMovement[],
  options?: { now?: Date },
): StockBulkAnomaly[] {
  const now = options?.now ?? new Date();
  const since = now.getTime() - LOOKBACK_DAYS * 86400000;

  const rollbackBatchIds = new Set<string>();
  for (const movement of movements) {
    const ref = String(movement.referenceNo || "").trim();
    if (!ref.startsWith(BULK_ROLLBACK_REF_PREFIX)) continue;
    rollbackBatchIds.add(ref.slice(BULK_ROLLBACK_REF_PREFIX.length));
  }

  const adds = movements
    .filter(isPicklistRestoreAdd)
    .filter((m) => new Date(m.createdAt).getTime() >= since)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const batches: StockBulkAnomaly[] = [];
  let i = 0;
  while (i < adds.length) {
    const cluster: StockMovement[] = [adds[i]];
    let j = i + 1;
    while (j < adds.length) {
      const prev = new Date(cluster[cluster.length - 1].createdAt).getTime();
      const next = new Date(adds[j].createdAt).getTime();
      if (next - prev > CLUSTER_GAP_MS) break;
      cluster.push(adds[j]);
      j++;
    }

    const locations = new Set(
      cluster.map((m) => String(m.toLocationCode || "").trim().toUpperCase()).filter(Boolean),
    );
    const skus = new Set(cluster.map((m) => m.sku.trim().toUpperCase()));
    const totalQty = cluster.reduce((sum, m) => sum + (m.qty || 0), 0);

    if (cluster.length >= MIN_ADD_COUNT && locations.size >= MIN_DISTINCT_LOCATIONS) {
      const startedAt = cluster[0].createdAt;
      const endedAt = cluster[cluster.length - 1].createdAt;
      const id = startedAt;
      batches.push({
        id,
        startedAt,
        endedAt,
        addCount: cluster.length,
        distinctLocations: locations.size,
        distinctSkus: skus.size,
        totalQty,
        picklistRestore: true,
        rolledBack: rollbackBatchIds.has(id),
        movementIds: cluster.map((m) => m.id),
        lines: cluster.map((m) => ({
          id: m.id,
          createdAt: m.createdAt,
          sku: m.sku,
          qty: m.qty,
          locationCode: String(m.toLocationCode || "").toUpperCase(),
          referenceNo: m.referenceNo,
        })),
      });
    }
    i = j;
  }

  return batches.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function movementsForBulkRollback(
  batchId: string,
  movements: StockMovement[],
): StockMovement[] {
  const batch = detectStockBulkAnomalies(movements).find((entry) => entry.id === batchId);
  if (!batch || batch.rolledBack) return [];
  const idSet = new Set(batch.movementIds);
  return movements.filter((m) => idSet.has(m.id) && isPicklistRestoreAdd(m));
}

export { rollbackRefForBatch };
