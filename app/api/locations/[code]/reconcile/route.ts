import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { reconcileLocation } from "@/lib/data";
import { modelsInScanOrder } from "@/lib/modelOrder";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";

type RouteContext = { params: Promise<{ code: string }> };

const reconcileSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string().min(1).max(120),
        qty: z.number().int().min(1).max(9999),
      }),
    )
    .max(500),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    assertTrustedOrigin(request);
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { code } = await context.params;
    const normalized = decodeURIComponent(code ?? "").trim().toUpperCase();
    if (!normalized) return NextResponse.json({ error: "Brak kodu lokalizacji" }, { status: 400 });
    const body = await request.json();
    const parsed = reconcileSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Niepoprawne dane zczytywania" }, { status: 400 });
    const items = parsed.data.items.map((item) => ({
      sku: item.sku.trim().toUpperCase(),
      qty: item.qty,
    }));
    const models = modelsInScanOrder(items);
    await reconcileLocation(session.sub, normalized, items);
    return NextResponse.json({ ok: true, locationCode: normalized, modelCount: models.length, pieceCount: items.reduce((s, i) => s + i.qty, 0) });
  } catch (error) {
    await logServerError("POST /api/locations/[code]/reconcile", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Blad zczytywania lokalizacji" }, { status: 500 });
  }
}
