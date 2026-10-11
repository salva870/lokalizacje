import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listStockBulkAnomalies } from "@/lib/data";
import { logServerError } from "@/lib/logger";
import { shouldShowHomeStockAlert } from "@/lib/stockBulkAnomaly";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const anomalies = await listStockBulkAnomalies();
    const open = anomalies.filter((entry) => !entry.rolledBack);
    const showHomeAlert = shouldShowHomeStockAlert(anomalies);
    return NextResponse.json({ ok: true, anomalies, openCount: open.length, showHomeAlert });
  } catch (error) {
    await logServerError("GET /api/system/stock-anomalies", error);
    const message = error instanceof Error ? error.message : "Nie udalo sie pobrac anomalii";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
