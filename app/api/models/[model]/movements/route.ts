import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getMovementsForModel } from "@/lib/data";
import { logServerError } from "@/lib/logger";

type RouteContext = { params: Promise<{ model: string }> };

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

function decodeModelParam(raw: string) {
  return decodeURIComponent(raw).trim().toUpperCase();
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireSession();
    const { model: modelParam } = await context.params;
    const model = decodeModelParam(modelParam);
    if (!model) {
      return NextResponse.json({ error: "Brak kodu modelu" }, { status: 400 });
    }

    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const limit = parsedQuery.success ? parsedQuery.data.limit ?? 300 : 300;

    const movements = await getMovementsForModel(model, limit);
    return NextResponse.json({ model, movements });
  } catch (error) {
    await logServerError("GET /api/models/[model]/movements", error);
    const message = error instanceof Error ? error.message : "Blad pobierania logu";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
