import { NextResponse } from "next/server";
import { z } from "zod";
import { isDamagedStockAt } from "@/lib/stockClassification";
import { parseSkuModel } from "@/lib/skuModel";
import { getCurrentStock, listLocations } from "@/lib/data";
import { assertIntegrationKey } from "@/lib/integrationAuth";
import { getLocationTypeLabels } from "@/lib/locationTypeLabelsSettings";
import { PICKABLE_LOCATION_TYPES, pickLocationTypePriority } from "@/lib/pickPriority";
import type { LocationType, Zone } from "@/lib/types";

const bodySchema = z.object({
  skus: z.array(z.string().min(1).max(120)).max(2000).optional(),
  /** Wszystkie warianty modelu (Parent SKU) — do zamiany rozmiaru w pickliście. */
  parentSku: z.string().min(1).max(120).optional(),
});

export type IntegrationStockEntry = {
  locationCode: string;
  qty: number;
  parentZone?: Zone;
  locationType?: LocationType;
  sortOrder?: number;
  locationName?: string;
};

export async function POST(request: Request) {
  try {
    assertIntegrationKey(request);
    const raw = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Niepoprawne dane" }, { status: 400 });
    }

    const [allStock, allLocations, locationTypeLabels] = await Promise.all([
      getCurrentStock(),
      listLocations(),
      getLocationTypeLabels(),
    ]);

    const metaByCode = new Map(
      allLocations.map((loc) => [
        loc.code,
        {
          parentZone: loc.parentZone,
          locationType: loc.locationType,
          sortOrder: loc.sortOrder ?? 0,
          locationName: loc.name,
        },
      ]),
    );

    const requested = parsed.data.skus?.map((sku) => sku.trim().toUpperCase()).filter(Boolean);
    const parentSkuNorm = parsed.data.parentSku?.trim().toUpperCase() || null;
    const items: Record<string, IntegrationStockEntry[]> = {};

    const pushRow = (sku: string, locationCode: string, qty: number) => {
      const meta = metaByCode.get(locationCode);
      if (isDamagedStockAt(locationCode, meta?.locationType)) return;
      (items[sku] ??= []).push({
        locationCode,
        qty,
        parentZone: meta?.parentZone,
        locationType: meta?.locationType,
        sortOrder: meta?.sortOrder,
        locationName: meta?.locationName,
      });
    };

    if (parentSkuNorm) {
      for (const row of allStock) {
        const sku = String(row.sku ?? "").trim().toUpperCase();
        if (!sku || parseSkuModel(sku).model !== parentSkuNorm) continue;
        pushRow(sku, row.locationCode, row.qty);
      }
      for (const sku of requested ?? []) {
        items[sku] ??= [];
      }
    } else if (requested && requested.length > 0) {
      const stockBySku = new Map<string, typeof allStock>();
      for (const row of allStock) {
        const sku = String(row.sku ?? "").trim().toUpperCase();
        if (!sku) continue;
        const list = stockBySku.get(sku) ?? [];
        list.push(row);
        stockBySku.set(sku, list);
      }
      for (const sku of requested) {
        const rows = stockBySku.get(sku) ?? [];
        for (const row of rows) {
          pushRow(sku, row.locationCode, row.qty);
        }
        items[sku] ??= [];
      }
    } else {
      for (const row of allStock) {
        pushRow(row.sku, row.locationCode, row.qty);
      }
    }

    const locationOrder = [...allLocations]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.code.localeCompare(b.code))
      .map((loc) => loc.code);

    return NextResponse.json({
      items,
      locationOrder,
      locationMeta: Object.fromEntries(
        allLocations.map((loc) => [
          loc.code,
          {
            parentZone: loc.parentZone,
            locationType: loc.locationType,
            sortOrder: loc.sortOrder ?? 0,
            name: loc.name,
          },
        ]),
      ),
      pickableLocationTypes: PICKABLE_LOCATION_TYPES,
      pickTypePriority: pickLocationTypePriority,
      locationTypeLabels,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Blad odczytu stanow";
    const status = message === "Unauthorized" ? 401 : message === "Integration API disabled" ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
