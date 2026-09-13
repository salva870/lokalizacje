import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, requireRole } from "@/lib/auth";
import { defaultLocationTypeLabels } from "@/lib/locationMeta";
import { getLocationTypeLabels, saveLocationTypeLabels } from "@/lib/locationTypeLabelsSettings";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";
import type { LocationType } from "@/lib/types";

const bodySchema = z.object({
  labels: z.record(z.string(), z.string().min(1).max(120)),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const labels = await getLocationTypeLabels();
    return NextResponse.json({ labels, defaults: defaultLocationTypeLabels });
  } catch (error) {
    await logServerError("GET /api/admin/location-type-labels", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Blad odczytu etykiet" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    assertTrustedOrigin(request);
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    requireRole(session.role, ["ADMIN"]);

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Niepoprawne dane" }, { status: 400 });

    const overrides: Partial<Record<LocationType, string>> = {};
    for (const [key, value] of Object.entries(parsed.data.labels)) {
      const type = key.trim().toUpperCase() as LocationType;
      if (type in defaultLocationTypeLabels) {
        overrides[type] = value.trim();
      }
    }
    const labels = await saveLocationTypeLabels(overrides);
    return NextResponse.json({ labels });
  } catch (error) {
    await logServerError("PUT /api/admin/location-type-labels", error);
    const message = error instanceof Error ? error.message : "Blad zapisu etykiet";
    const status = message === "Forbidden" || message === "Forbidden origin" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
