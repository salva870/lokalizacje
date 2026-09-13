import { NextResponse } from "next/server";
import { z } from "zod";
import { applyMovement, listSkuLocations } from "@/lib/data";
import { assertIntegrationKey } from "@/lib/integrationAuth";
import { isLocationChoiceRequiredError, resolveSingleSourceLocation } from "@/lib/stockSource";
import { logServerError } from "@/lib/logger";

const lineSchema = z.object({
  sku: z.string().min(1).max(120),
  qty: z.number().int().min(1).max(10000).optional(),
  fromLocationCode: z.string().min(1).max(64).optional(),
  referenceNo: z.string().min(1).max(120).optional(),
});

const bodySchema = z.object({
  action: z.enum(["pick", "unpick"]),
  lines: z.array(lineSchema).min(1).max(200),
});

function picklistOperatorId() {
  return (process.env.LOC_PICKLIST_OPERATOR_ID || "u-admin-1").trim() || "u-admin-1";
}

export async function POST(request: Request) {
  try {
    assertIntegrationKey(request);
    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Niepoprawne dane" }, { status: 400 });
    }

    const operatorId = picklistOperatorId();
    const resolved: Array<{
      sku: string;
      qty: number;
      fromLocationCode: string;
      referenceNo?: string;
    }> = [];

    for (const line of parsed.data.lines) {
      const sku = line.sku.trim().toUpperCase();
      const qty = line.qty ?? 1;
      const locations = await listSkuLocations(sku);
      if (parsed.data.action === "pick") {
        const fromLocationCode = resolveSingleSourceLocation(sku, qty, locations, line.fromLocationCode);
        resolved.push({ sku, qty, fromLocationCode, referenceNo: line.referenceNo });
      } else {
        const fromLocationCode = line.fromLocationCode?.trim().toUpperCase();
        if (!fromLocationCode) {
          return NextResponse.json({ error: "Brak lokalizacji do przywrocenia stanu" }, { status: 400 });
        }
        resolved.push({ sku, qty, fromLocationCode, referenceNo: line.referenceNo });
      }
    }

    const movements = [];
    for (const line of resolved) {
      const movement = await applyMovement({
        operatorId,
        movementType: parsed.data.action === "pick" ? "REMOVE" : "ADD",
        sku: line.sku,
        qty: line.qty,
        fromLocationCode: parsed.data.action === "pick" ? line.fromLocationCode : undefined,
        toLocationCode: parsed.data.action === "unpick" ? line.fromLocationCode : undefined,
        referenceNo: line.referenceNo ?? `PICKLIST:${parsed.data.action}`,
      });
      movements.push({
        ...movement,
        fromLocationCode: line.fromLocationCode,
      });
    }

    return NextResponse.json({ ok: true, movements });
  } catch (error) {
    if (isLocationChoiceRequiredError(error)) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          sku: error.sku,
          locations: error.locations,
        },
        { status: 409 },
      );
    }
    await logServerError("POST /api/integration/pick", error);
    const message = error instanceof Error ? error.message : "Blad zbierania";
    const status = message === "Unauthorized" ? 401 : message === "Integration API disabled" ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
