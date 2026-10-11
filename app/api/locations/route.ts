import { NextResponse } from "next/server";
import { getSession, requireRole } from "@/lib/auth";
import { createLocation, listLocations } from "@/lib/data";
import { createLocationSchema, formatZodLocationError } from "@/lib/locationSchemas";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ items: await listLocations() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Blad odczytu lokalizacji" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    requireRole(session.role, ["ADMIN"]);

    const body = await request.json();
    const parsed = createLocationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodLocationError(parsed.error) }, { status: 400 });
    }

    const location = await createLocation({
      ...parsed.data,
      code: parsed.data.code.toUpperCase(),
    });
    return NextResponse.json({ item: location }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Blad tworzenia lokalizacji";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
