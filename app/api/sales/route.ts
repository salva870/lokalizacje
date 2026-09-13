import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSaleSession, listSaleSessions } from "@/lib/data";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";

const itemSchema = z.object({
  sku: z.string().max(120).optional(),
  qty: z.number().int().min(1).max(1000),
  fromLocationCode: z.string().max(64).optional(),
  note: z.string().max(500).optional(),
  clientKey: z.string().max(64).optional(),
});

export async function GET(request: Request) {
  try {
    await requireSession();
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const items = await listSaleSessions(limit);
    return NextResponse.json({ items });
  } catch (error) {
    await logServerError("GET /api/sales", error);
    const message = error instanceof Error ? error.message : "Blad pobierania historii";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request);
    const session = await requireSession();
    const form = await request.formData();
    const payloadRaw = form.get("payload");
    if (typeof payloadRaw !== "string" || !payloadRaw.trim()) {
      return NextResponse.json({ error: "Brak danych sprzedazy" }, { status: 400 });
    }

    const parsedPayload = z
      .object({
        note: z.string().max(500).optional(),
        items: z.array(itemSchema).min(1).max(200),
      })
      .safeParse(JSON.parse(payloadRaw));

    if (!parsedPayload.success) {
      return NextResponse.json({ error: "Niepoprawne dane sprzedazy" }, { status: 400 });
    }

    const attachments = [];
    for (const item of parsedPayload.data.items) {
      if (!item.clientKey) continue;
      const file = form.get(item.clientKey);
      if (!(file instanceof File) || file.size <= 0) continue;
      if (file.size > 8 * 1024 * 1024) {
        return NextResponse.json({ error: "Zdjecie jest za duze (max 8 MB)" }, { status: 400 });
      }
      const mimeType = file.type || "image/jpeg";
      if (!mimeType.startsWith("image/")) {
        return NextResponse.json({ error: "Dozwolone sa tylko pliki graficzne" }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      attachments.push({
        clientKey: item.clientKey,
        buffer,
        mimeType,
        originalName: file.name || undefined,
      });
    }

    const sale = await createSaleSession(
      session.sub,
      parsedPayload.data.items,
      attachments,
      parsedPayload.data.note,
    );

    return NextResponse.json({ sale });
  } catch (error) {
    await logServerError("POST /api/sales", error);
    const message = error instanceof Error ? error.message : "Blad zapisu sprzedazy";
    const status =
      message === "Unauthorized"
        ? 401
        : message === "Forbidden origin"
          ? 403
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
