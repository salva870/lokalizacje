import { NextResponse } from "next/server";
import { getSession, requireRole, signOut } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";
import { bumpSessionGeneration } from "@/lib/sessionGeneration";

export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request);
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    requireRole(session.role, ["ADMIN"]);

    const generation = await bumpSessionGeneration();
    await signOut();
    return NextResponse.json({
      ok: true,
      generation,
      message: "Wszystkie sesje zostaly uniewaznione. Kazdy musi zalogowac sie ponownie.",
    });
  } catch (error) {
    await logServerError("POST /api/admin/revoke-sessions", error);
    const message = error instanceof Error ? error.message : "Blad uniewaznienia sesji";
    const status = message === "Forbidden" || message === "Forbidden origin" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
