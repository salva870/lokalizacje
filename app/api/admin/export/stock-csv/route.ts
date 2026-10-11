import { NextResponse } from "next/server";
import { getSession, requireRole } from "@/lib/auth";
import { getCurrentStock } from "@/lib/data";
import { stockExportToCsv } from "@/lib/stockExportCsv";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    requireRole(session.role, ["ADMIN"]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const stock = await getCurrentStock();
    const csv = stockExportToCsv(stock);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `lokalizacje-stany-${date}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udalo sie wygenerowac eksportu.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
