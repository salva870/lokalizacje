import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getLocationModelOrderArray, listLocationModelOrder, mergeLocationModelOrder, setLocationModelOrder } from "@/lib/data";
import { logServerError } from "@/lib/logger";
import { assertTrustedOrigin } from "@/lib/csrf";

type RouteContext = { params: Promise<{ code: string }> };

const putSchema = z.object({
  models: z.array(z.string().min(1).max(120)).max(500),
});

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { code } = await context.params;
    const normalized = decodeURIComponent(code ?? "").trim().toUpperCase();
    if (!normalized) return NextResponse.json({ error: "Brak kodu lokalizacji" }, { status: 400 });
    const rows = await listLocationModelOrder(normalized);
    const models = await getLocationModelOrderArray(normalized);
    return NextResponse.json({ locationCode: normalized, models, rows });
  } catch (error) {
    await logServerError("GET /api/locations/[code]/model-order", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Blad odczytu kolejnosci" }, { status: 500 });
  }
}

const patchSchema = z.object({
  appendModels: z.array(z.string().min(1).max(120)).max(500),
});

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertTrustedOrigin(request);
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { code } = await context.params;
    const normalized = decodeURIComponent(code ?? "").trim().toUpperCase();
    if (!normalized) return NextResponse.json({ error: "Brak kodu lokalizacji" }, { status: 400 });
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Niepoprawne dane kolejnosci" }, { status: 400 });
    await mergeLocationModelOrder(
      normalized,
      parsed.data.appendModels.map((m) => m.trim().toUpperCase()),
      session.sub,
    );
    const models = await getLocationModelOrderArray(normalized);
    return NextResponse.json({ locationCode: normalized, models });
  } catch (error) {
    await logServerError("PATCH /api/locations/[code]/model-order", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Blad aktualizacji kolejnosci" }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    assertTrustedOrigin(request);
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { code } = await context.params;
    const normalized = decodeURIComponent(code ?? "").trim().toUpperCase();
    if (!normalized) return NextResponse.json({ error: "Brak kodu lokalizacji" }, { status: 400 });
    const body = await request.json();
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Niepoprawne dane kolejnosci" }, { status: 400 });
    await setLocationModelOrder(normalized, parsed.data.models, session.sub);
    const models = await getLocationModelOrderArray(normalized);
    return NextResponse.json({ locationCode: normalized, models });
  } catch (error) {
    await logServerError("PUT /api/locations/[code]/model-order", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Blad zapisu kolejnosci" }, { status: 500 });
  }
}
