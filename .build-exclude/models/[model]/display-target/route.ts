import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getModelShopDisplayTarget, setModelShopDisplayTarget } from "@/lib/data";
import { logServerError } from "@/lib/logger";

const bodySchema = z.object({
  targetQty: z.number().int().min(0).max(99),
});

type RouteContext = { params: Promise<{ model: string }> };

function decodeModelParam(raw: string) {
  return decodeURIComponent(raw).trim().toUpperCase();
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireSession();
    const { model: modelParam } = await context.params;
    const model = decodeModelParam(modelParam);
    const result = await getModelShopDisplayTarget(model);
    return NextResponse.json(result);
  } catch (error) {
    await logServerError("GET /api/models/[model]/display-target", error);
    const message = error instanceof Error ? error.message : "Blad pobierania ustawienia";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    await requireSession();
    const { model: modelParam } = await context.params;
    const model = decodeModelParam(modelParam);
    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Niepoprawna liczba sztuk na ekspozycji" }, { status: 400 });
    }
    const result = await setModelShopDisplayTarget(model, parsed.data.targetQty);
    return NextResponse.json(result);
  } catch (error) {
    await logServerError("PUT /api/models/[model]/display-target", error);
    const message = error instanceof Error ? error.message : "Blad zapisu ustawienia";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
