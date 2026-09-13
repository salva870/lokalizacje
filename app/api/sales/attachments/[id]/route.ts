import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { readSaleAttachment } from "@/lib/data";
import { logServerError } from "@/lib/logger";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireSession();
    const { id } = await context.params;
    const file = await readSaleAttachment(id);
    if (!file) {
      return NextResponse.json({ error: "Nie znaleziono zalacznika" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    await logServerError("GET /api/sales/attachments/[id]", error);
    const message = error instanceof Error ? error.message : "Blad pobierania zalacznika";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
