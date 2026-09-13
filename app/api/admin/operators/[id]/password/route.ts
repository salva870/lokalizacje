import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireRole } from "@/lib/auth";
import { setOperatorPassword } from "@/lib/data";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";

const bodySchema = z.object({
  password: z.string().min(8).max(128),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertTrustedOrigin(request);
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    requireRole(session.role, ["ADMIN"]);

    const { id } = await context.params;
    const operatorId = decodeURIComponent(id ?? "").trim();
    if (!operatorId) return NextResponse.json({ error: "Brak identyfikatora operatora" }, { status: 400 });

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Niepoprawne dane" }, { status: 400 });

    await setOperatorPassword(operatorId, parsed.data.password);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await logServerError("PATCH /api/admin/operators/[id]/password", error);
    const message = error instanceof Error ? error.message : "Blad zmiany hasla operatora";
    const status = message === "Forbidden" || message === "Forbidden origin" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
