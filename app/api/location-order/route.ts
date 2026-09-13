import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { listLocations, setLocationPickOrder } from "@/lib/data";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";

const putSchema = z.object({
  codes: z.array(z.string().min(1).max(64)).min(1).max(500),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const items = await listLocations();
    return NextResponse.json({
      items,
      codes: items.map((loc) => loc.code),
    });
  } catch (error) {
    await logServerError("GET /api/location-order", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Blad odczytu kolejnosci lokalizacji" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    assertTrustedOrigin(request);
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Niepoprawna kolejnosc lokalizacji" }, { status: 400 });
    const items = await setLocationPickOrder(parsed.data.codes);
    return NextResponse.json({
      items,
      codes: items.map((loc) => loc.code),
    });
  } catch (error) {
    await logServerError("PUT /api/location-order", error);
    const message = error instanceof Error ? error.message : "Blad zapisu kolejnosci lokalizacji";
    const status = message === "Forbidden origin" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
