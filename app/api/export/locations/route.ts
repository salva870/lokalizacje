import { NextResponse } from "next/server";
import { getSession, requireRole } from "@/lib/auth";
import { listLocations } from "@/lib/data";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requireRole(session.role, ["ADMIN", "OPERATOR"]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const locations = await listLocations();
  return NextResponse.json({ items: locations });
}
