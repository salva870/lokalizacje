import { parseSkuModel } from "@/lib/skuModel";

export type StockRow = { locationCode: string; sku: string; qty: number };

export type StockExportCsvRow = {
  model: string;
  kod_modelu: string;
  lokalizacja: string;
  stan_magazynowy_na_lokalizacji: number;
  stan_magazynowy_sumaryczny_niezalezny_od_lokalizacji: number;
};

const CSV_HEADERS: (keyof StockExportCsvRow)[] = [
  "model",
  "kod_modelu",
  "lokalizacja",
  "stan_magazynowy_na_lokalizacji",
  "stan_magazynowy_sumaryczny_niezalezny_od_lokalizacji",
];

function escapeCsvCell(value: string | number): string {
  const text = String(value);
  if (/[;"\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildStockExportRows(stock: StockRow[]): StockExportCsvRow[] {
  const totalBySku = new Map<string, number>();
  for (const row of stock) {
    if (row.qty <= 0) continue;
    const sku = row.sku.trim().toUpperCase();
    totalBySku.set(sku, (totalBySku.get(sku) ?? 0) + row.qty);
  }

  const rows: StockExportCsvRow[] = [];
  for (const row of stock) {
    if (row.qty <= 0) continue;
    const sku = row.sku.trim().toUpperCase();
    const { model } = parseSkuModel(sku);
    rows.push({
      model,
      kod_modelu: sku,
      lokalizacja: row.locationCode.trim().toUpperCase(),
      stan_magazynowy_na_lokalizacji: row.qty,
      stan_magazynowy_sumaryczny_niezalezny_od_lokalizacji: totalBySku.get(sku) ?? row.qty,
    });
  }

  rows.sort((a, b) => {
    const byModel = a.model.localeCompare(b.model, "pl");
    if (byModel !== 0) return byModel;
    const bySku = a.kod_modelu.localeCompare(b.kod_modelu, "pl");
    if (bySku !== 0) return bySku;
    return a.lokalizacja.localeCompare(b.lokalizacja, "pl");
  });

  return rows;
}

/** CSV z separatorem `;` i BOM UTF-8 (Excel w PL). */
export function stockExportToCsv(stock: StockRow[]): string {
  const exportRows = buildStockExportRows(stock);
  const lines = [
    CSV_HEADERS.join(";"),
    ...exportRows.map((row) =>
      CSV_HEADERS.map((key) => escapeCsvCell(row[key])).join(";"),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
