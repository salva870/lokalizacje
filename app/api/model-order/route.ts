import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listLocationModelOrder } from "@/lib/data";
import { logServerError } from "@/lib/logger";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const rows = await listLocationModelOrder();
    return NextResponse.json({ items: rows });
  } catch (error) {
    await logServerError("GET /api/model-order", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Blad odczytu kolejnosci" }, { status: 500 });
  }
}
