export type PickStatusLocation = { locationCode: string; netQty: number };

export type PickStatusEntry = {
  referenceNo: string;
  sku: string;
  netQty: number;
  locations: PickStatusLocation[];
};

type MovementRow = {
  movementType: string;
  sku: string;
  qty: number;
  fromLocationCode?: string | null;
  toLocationCode?: string | null;
  referenceNo?: string | null;
};

export function aggregatePickStatus(
  movements: MovementRow[],
  references: string[],
): PickStatusEntry[] {
  const refSet = new Set(references);
  const byRef = new Map<string, { sku: string; locs: Map<string, number> }>();

  for (const movement of movements) {
    const referenceNo = movement.referenceNo?.trim();
    if (!referenceNo || !refSet.has(referenceNo)) continue;
    const sku = movement.sku.trim().toUpperCase();
    if (!byRef.has(referenceNo)) {
      byRef.set(referenceNo, { sku, locs: new Map() });
    }
    const bucket = byRef.get(referenceNo)!;
    if (!bucket.sku) bucket.sku = sku;

    if (movement.movementType === "REMOVE" && movement.fromLocationCode) {
      const code = movement.fromLocationCode.toUpperCase();
      bucket.locs.set(code, (bucket.locs.get(code) || 0) + (movement.qty || 0));
    } else if (movement.movementType === "ADD" && movement.toLocationCode) {
      const code = movement.toLocationCode.toUpperCase();
      bucket.locs.set(code, (bucket.locs.get(code) || 0) - (movement.qty || 0));
    }
  }

  return references.map((referenceNo) => {
    const bucket = byRef.get(referenceNo);
    if (!bucket) {
      return { referenceNo, sku: "", netQty: 0, locations: [] };
    }
    const locations = [...bucket.locs.entries()]
      .filter(([, netQty]) => netQty > 0)
      .map(([locationCode, netQty]) => ({ locationCode, netQty }));
    const netQty = locations.reduce((sum, loc) => sum + loc.netQty, 0);
    return { referenceNo, sku: bucket.sku, netQty, locations };
  });
}
