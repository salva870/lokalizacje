"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { shouldShowHomeStockAlert, type StockBulkAnomaly } from "@/lib/stockBulkAnomaly";

type Props = {
  userRole: "ADMIN" | "OPERATOR" | null;
};

export function StockAnomalyHomeBanner({ userRole }: Props) {
  const [visible, setVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/system/stock-anomalies", { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setVisible(false);
        return;
      }
      const anomalies = Array.isArray(data.anomalies) ? (data.anomalies as StockBulkAnomaly[]) : [];
      setVisible(
        typeof data.showHomeAlert === "boolean" ? data.showHomeAlert : shouldShowHomeStockAlert(anomalies),
      );
    } catch {
      setVisible(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!visible) return null;

  return (
    <section className="mt-4 rounded-2xl border border-rose-300 bg-rose-50/95 px-4 py-3 shadow-sm">
      <p className="text-sm font-semibold text-rose-950">Uwaga: podejrzana masowa zmiana stanów</p>
      <p className="mt-1 text-xs leading-relaxed text-rose-900">
        System wykrył jednoczesne przywrócenia stanu na wielu lokalizacjach (np. po błędnym działaniu w pickliście).
        {userRole === "ADMIN"
          ? " Szczegóły i ewentualne wycofanie znajdziesz w panelu administratora."
          : " Poinformuj administratora magazynu."}
      </p>
      {userRole === "ADMIN" ? (
        <Link
          href="/admin#stock-anomalies"
          className="mt-3 inline-flex rounded-xl bg-rose-800 px-4 py-2 text-xs font-bold text-white shadow-sm active:bg-rose-900"
        >
          Otwórz panel administratora
        </Link>
      ) : null}
    </section>
  );
}
