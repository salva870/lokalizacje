import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getModelRestoreSuggestions } from "@/lib/data";
import { logServerError } from "@/lib/logger";

export async function GET(request: Request) {
  try {
    await requireSession();
    const url = new URL(request.url);
    const sku = url.searchParams.get("sku")?.trim() ?? "";
    if (!sku) {
      return NextResponse.json({ error: "Brak parametru SKU" }, { status: 400 });
    }
    const suggestion = await getModelRestoreSuggestions(sku);
    return NextResponse.json(suggestion);
  } catch (error) {
    await logServerError("GET /api/restore-suggestions", error);
    const message = error instanceof Error ? error.message : "Blad pobierania sugestii";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
