import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireRole } from "@/lib/auth";
import { deleteLocationIfEmpty, updateLocation } from "@/lib/data";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";

type RouteContext = { params: Promise<{ code: string }> };

const patchLocationSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  parentZone: z.enum(["SKLEP", "ZAPLECZE"]).optional(),
  locationType: z.enum(["DISPLAY", "WYSTAWA", "BUFFER", "RESERVED", "BACKROOM_BOX", "BACKROOM_SHELF", "INACTIVE", "DAMAGED"]).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertTrustedOrigin(request);
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    requireRole(session.role, ["ADMIN"]);

    const { code } = await context.params;
    const normalized = decodeURIComponent(code ?? "").trim();
    if (!normalized) {
      return NextResponse.json({ error: "Brak kodu lokalizacji" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = patchLocationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Niepoprawne dane lokalizacji" }, { status: 400 });
    }

    const item = await updateLocation(normalized, parsed.data);
    return NextResponse.json({ item });
  } catch (error) {
    void logServerError("PATCH /api/locations/[code]", error);
    const message = error instanceof Error ? error.message : "Blad aktualizacji lokalizacji";
    const status = message === "Forbidden" || message === "Forbidden origin" ? 403 : message.includes("Brak") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertTrustedOrigin(request);
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    requireRole(session.role, ["ADMIN"]);

    const { code } = await context.params;
    const normalized = decodeURIComponent(code ?? "").trim();
    if (!normalized) {
      return NextResponse.json({ error: "Brak kodu lokalizacji" }, { status: 400 });
    }

    await deleteLocationIfEmpty(normalized);
    return NextResponse.json({ ok: true });
  } catch (error) {
    void logServerError("DELETE /api/locations/[code]", error);
    const message = error instanceof Error ? error.message : "Blad usuwania lokalizacji";
    const status = message === "Forbidden" || message === "Forbidden origin" ? 403 : message.includes("pusta") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
