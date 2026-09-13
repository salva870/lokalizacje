import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireRole } from "@/lib/auth";
import { createOperator, listOperatorsForAdmin } from "@/lib/data";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";

const createSchema = z.object({
  login: z.string().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/),
  password: z.string().min(8).max(128),
  role: z.enum(["ADMIN", "OPERATOR"]).default("OPERATOR"),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    requireRole(session.role, ["ADMIN"]);
    return NextResponse.json({ items: await listOperatorsForAdmin() });
  } catch (error) {
    await logServerError("GET /api/admin/operators", error);
    const message = error instanceof Error ? error.message : "Blad odczytu operatorow";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request);
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    requireRole(session.role, ["ADMIN"]);

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Niepoprawne dane operatora" }, { status: 400 });

    const item = await createOperator(parsed.data);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    await logServerError("POST /api/admin/operators", error);
    const message = error instanceof Error ? error.message : "Blad tworzenia operatora";
    const status = message === "Forbidden" || message === "Forbidden origin" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
