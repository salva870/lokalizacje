import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getReplenishmentPlan } from "@/lib/data";
import { logServerError } from "@/lib/logger";

export async function GET() {
  try {
    await requireSession();
    const plan = await getReplenishmentPlan();
    return NextResponse.json(plan);
  } catch (error) {
    await logServerError("GET /api/replenishment/plan", error);
    const message = error instanceof Error ? error.message : "Blad pobierania planu uzupelnienia";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
