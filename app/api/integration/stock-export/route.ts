import { NextResponse } from "next/server";
import { getCurrentStock, listLocations } from "@/lib/data";
import { assertIntegrationKey } from "@/lib/integrationAuth";
import { logServerError } from "@/lib/logger";
import { buildStockExportJson } from "@/lib/stockExportJson";

/**
 * GET /api/integration/stock-export
 *
 * JSON z realnymi stanami LOC per SKU i lokalizacja (ten sam zakres co eksport CSV).
 * Autoryzacja wyłącznie nagłówkiem `X-Loc-Integration-Key` (nigdy w URL).
 * Tylko odczyt: endpoint nie zmienia żadnych danych.
 */
export async function GET(request: Request) {
  try {
    assertIntegrationKey(request);

    const [stock, locations] = await Promise.all([getCurrentStock(), listLocations()]);
    const locationTypeByCode = new Map(
      locations.map((loc) => [loc.code.trim().toUpperCase(), loc.locationType] as const),
    );

    const document = buildStockExportJson(stock, locationTypeByCode, new Date());

    return NextResponse.json(document, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    await logServerError("GET /api/integration/stock-export", error);
    const message = error instanceof Error ? error.message : "Blad eksportu stanow";
    const status =
      message === "Unauthorized" ? 401 : message === "Integration API disabled" ? 503 : 500;
    const publicMessage =
      status === 500 ? "Nie udalo sie wygenerowac eksportu stanow." : message;
    return NextResponse.json({ error: publicMessage }, { status });
  }
}
