import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCurrentStock } from "@/lib/data";
import { lookupSkuInStock } from "@/lib/skuLookup";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? url.searchParams.get("sku") ?? "").trim();
  const size = (url.searchParams.get("size") ?? url.searchParams.get("rozmiar") ?? "").trim();

  if (!query) {
    return NextResponse.json({ error: "Podaj kod SKU (parametr q)" }, { status: 400 });
  }

  const stock = await getCurrentStock();
  const result = lookupSkuInStock(stock, query, size);
  if (!result) {
    return NextResponse.json({ error: "Brak zapytania" }, { status: 400 });
  }

  return NextResponse.json(result);
}
