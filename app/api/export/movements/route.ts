import { NextResponse } from "next/server";
import { getSession, requireRole } from "@/lib/auth";
import { getRecentMovements } from "@/lib/data";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(session.role, ["ADMIN", "OPERATOR"]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedLimit = Number(searchParams.get("limit") ?? "500");
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(5000, requestedLimit)) : 500;
  const movements = await getRecentMovements(limit);
  return NextResponse.json({ items: movements });
}
