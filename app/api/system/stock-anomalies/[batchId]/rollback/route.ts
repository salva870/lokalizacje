import { NextResponse } from "next/server";
import { getSession, requireRole } from "@/lib/auth";
import { rollbackStockBulkAnomaly } from "@/lib/data";
import { logServerError } from "@/lib/logger";

type Params = { params: Promise<{ batchId: string }> };

export async function POST(_request: Request, context: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    requireRole(session.role, ["ADMIN"]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { batchId } = await context.params;
  const decoded = decodeURIComponent(batchId || "").trim();
  if (!decoded) {
    return NextResponse.json({ error: "Brak identyfikatora paczki" }, { status: 400 });
  }

  try {
    const result = await rollbackStockBulkAnomaly(decoded, session.sub);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await logServerError("POST /api/system/stock-anomalies/[batchId]/rollback", error);
    const message = error instanceof Error ? error.message : "Nie udalo sie wycofac anomalii";
    const status = /juz wycofana|nie znaleziono/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
