import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getSaleSession } from "@/lib/data";
import { logServerError } from "@/lib/logger";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireSession();
    const { id } = await context.params;
    const sale = await getSaleSession(id);
    if (!sale) {
      return NextResponse.json({ error: "Nie znaleziono sprzedazy" }, { status: 404 });
    }
    return NextResponse.json({ sale });
  } catch (error) {
    await logServerError("GET /api/sales/[id]", error);
    const message = error instanceof Error ? error.message : "Blad pobierania sprzedazy";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
