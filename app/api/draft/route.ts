import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getOperatorDraft, saveOperatorDraft } from "@/lib/data";
import { assertTrustedOrigin } from "@/lib/csrf";
import { logServerError } from "@/lib/logger";

const queueLineSchema = z.object({
  sku: z.string().min(1).max(120),
  qty: z.number().int().min(1).max(10000),
});

const bodySchema = z.object({
  activeLocationCode: z.string().min(1).max(64).nullable(),
  fromLocationCode: z.string().max(64),
  toLocationCode: z.string().max(64),
  addQueue: z.array(queueLineSchema).max(500),
  moveQueue: z.array(queueLineSchema).max(500),
  reconcileQueue: z.array(queueLineSchema).max(500),
});

export async function GET() {
  try {
    const session = await requireSession();
    const draft = await getOperatorDraft(session.sub);
    return NextResponse.json({ draft });
  } catch (error) {
    await logServerError("GET /api/draft", error);
    const message = error instanceof Error ? error.message : "Blad odczytu draftu";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  try {
    assertTrustedOrigin(request);
    const session = await requireSession();
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Niepoprawne dane draftu" }, { status: 400 });
    const draft = await saveOperatorDraft(session.sub, parsed.data);
    return NextResponse.json({ draft });
  } catch (error) {
    await logServerError("PUT /api/draft", error);
    const message = error instanceof Error ? error.message : "Blad zapisu draftu";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden origin" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
