import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireRole } from "@/lib/auth";
import { findDuplicateAddRisks } from "@/lib/addDuplicateGuard";
import { applyMovement, getCurrentStock, getRestoreSuggestions } from "@/lib/data";

const movementSchema = z.object({
  movementType: z.enum([
    "ADD",
    "REMOVE",
    "MOVE",
    "RESTORE_FROM_TMP",
    "MOVE_TO_SALE",
    "SALE_FINALIZE",
  ]),
  sku: z.string().min(1).max(120),
  qty: z.number().int().min(1).max(1000).optional(),
  fromLocationCode: z.string().max(64).optional(),
  toLocationCode: z.string().max(64).optional(),
  referenceNo: z.string().max(120).optional(),
  confirmDuplicateAdd: z.boolean().optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    requireRole(session.role, ["ADMIN", "OPERATOR"]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = movementSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Niepoprawne dane operacji" }, { status: 400 });
  }

  try {
    if (parsed.data.movementType === "RESTORE_FROM_TMP") {
      const suggestions = await getRestoreSuggestions(parsed.data.sku);
      return NextResponse.json({
        simulated: true,
        message: "Przywracanie z TMP nie zmienia stanu. To tylko sugestia odlozenia.",
        suggestions,
      });
    }

    if (parsed.data.movementType === "ADD") {
      const toLocation = parsed.data.toLocationCode?.trim();
      const sku = parsed.data.sku.trim();
      const qty = parsed.data.qty ?? 1;
      if (toLocation && sku && qty > 0 && !parsed.data.confirmDuplicateAdd) {
        const stock = await getCurrentStock();
        const risks = findDuplicateAddRisks(stock, toLocation, [{ sku, qty }]);
        if (risks.length > 0) {
          return NextResponse.json(
            {
              error:
                "Dodajesz tyle samo sztuk tego kodu produktu, ile juz jest na tej lokalizacji — mozliwe podwojenie stanu.",
              code: "DUPLICATE_ADD_MODEL_QTY",
              locationCode: toLocation.toUpperCase(),
              risks,
            },
            { status: 409 },
          );
        }
      }
    }

    const movement = await applyMovement({
      operatorId: session.sub,
      movementType: parsed.data.movementType,
      sku: parsed.data.sku,
      qty: parsed.data.qty,
      fromLocationCode: parsed.data.fromLocationCode,
      toLocationCode: parsed.data.toLocationCode,
      referenceNo: parsed.data.referenceNo,
    });
    return NextResponse.json({ movement });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Blad operacji" },
      { status: 400 },
    );
  }
}
