import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { moveEntireLocation } from "@/lib/data";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";

type RouteContext = { params: Promise<{ code: string }> };

const moveSchema = z.object({
  toLocationCode: z.string().min(1).max(64),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    assertTrustedOrigin(request);
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { code } = await context.params;
    const from = decodeURIComponent(code ?? "").trim().toUpperCase();
    if (!from) return NextResponse.json({ error: "Brak kodu lokalizacji zrodlowej" }, { status: 400 });
    const body = await request.json();
    const parsed = moveSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Niepoprawne dane przeniesienia" }, { status: 400 });
    const to = parsed.data.toLocationCode.trim().toUpperCase();
    const result = await moveEntireLocation(session.sub, from, to);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await logServerError("POST /api/locations/[code]/move", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Blad przenoszenia lokalizacji" },
      { status: 400 },
    );
  }
}
