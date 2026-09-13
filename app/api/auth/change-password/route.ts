import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { setOperatorPassword } from "@/lib/data";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";

const bodySchema = z.object({
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request);
    const session = await requireSession();
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Niepoprawne dane" }, { status: 400 });
    }
    await setOperatorPassword(session.sub, parsed.data.password);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await logServerError("POST /api/auth/change-password", error);
    const message = error instanceof Error ? error.message : "Blad zmiany hasla";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden origin" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
