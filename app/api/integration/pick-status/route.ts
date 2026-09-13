import { NextResponse } from "next/server";
import { z } from "zod";
import { getPickStatusByReferences } from "@/lib/data";
import { assertIntegrationKey } from "@/lib/integrationAuth";
import { logServerError } from "@/lib/logger";

const bodySchema = z.object({
  references: z.array(z.string().min(1).max(120)).min(1).max(200),
});

export async function POST(request: Request) {
  try {
    assertIntegrationKey(request);
    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Niepoprawne dane" }, { status: 400 });
    }

    const results = await getPickStatusByReferences(parsed.data.references);
    const references = Object.fromEntries(results.map((entry) => [entry.referenceNo, entry]));

    return NextResponse.json({ ok: true, references });
  } catch (error) {
    await logServerError("POST /api/integration/pick-status", error);
    const message = error instanceof Error ? error.message : "Blad statusu zbierania";
    const status = message === "Unauthorized" ? 401 : message === "Integration API disabled" ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
