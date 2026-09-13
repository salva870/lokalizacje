import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listSkuLocations } from "@/lib/data";

export async function GET(_: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { sku } = await params;
    return NextResponse.json({ sku: sku.toUpperCase(), locations: await listSkuLocations(sku) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Blad odczytu SKU" },
      { status: 500 },
    );
  }
}
