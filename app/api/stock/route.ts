import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCurrentStock, getRecentMovements } from "@/lib/data";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const [stock, recentMovements] = await Promise.all([getCurrentStock(), getRecentMovements(50)]);
    return NextResponse.json({ stock, recentMovements });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Blad odczytu stanu" },
      { status: 500 },
    );
  }
}
