import { NextResponse } from "next/server";
import { getSession, requireRole } from "@/lib/auth";
import { getCurrentStock } from "@/lib/data";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(session.role, ["ADMIN", "OPERATOR"]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const stock = await getCurrentStock();
  const rows = stock.flatMap((item) =>
    Array.from({ length: item.qty }, () => ({
      locationCode: item.locationCode,
      sku: item.sku,
    })),
  );
  return NextResponse.json({ items: rows });
}
