import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireRole } from "@/lib/auth";
import { setOperatorRole } from "@/lib/data";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";

const bodySchema = z.object({
  role: z.enum(["ADMIN", "OPERATOR"]),
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
    if (!parsed.success) return NextResponse.json({ error: "Niepoprawna rola" }, { status: 400 });

    const item = await setOperatorRole(operatorId, parsed.data.role);
    return NextResponse.json({ item });
  } catch (error) {
    await logServerError("PATCH /api/admin/operators/[id]/role", error);
    const message = error instanceof Error ? error.message : "Blad zmiany roli operatora";
    const status =
      message === "Forbidden" || message === "Forbidden origin"
        ? 403
        : message.includes("Nie znaleziono") || message.includes("ostatniemu")
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
