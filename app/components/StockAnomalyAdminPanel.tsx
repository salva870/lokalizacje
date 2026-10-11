"use client";

import { useCallback, useEffect, useState } from "react";
import type { StockBulkAnomaly } from "@/lib/stockBulkAnomaly";

type Props = {
  onStockChanged?: () => void;
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "medium" });
}

export function StockAnomalyAdminPanel({ onStockChanged }: Props) {
  const [anomalies, setAnomalies] = useState<StockBulkAnomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/system/stock-anomalies", { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Nie udalo sie pobrac anomalii.");
        setAnomalies([]);
        return;
      }
      setAnomalies(Array.isArray(data.anomalies) ? data.anomalies : []);
    } catch {
      setError("Blad polaczenia podczas ladowania anomalii.");
      setAnomalies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rollback = async (batchId: string) => {
    const batch = anomalies.find((entry) => entry.id === batchId);
    if (!batch || batch.rolledBack) return;
    const ok = window.confirm(
      `Wycofac masowe przywrocenie stanow z ${formatWhen(batch.startedAt)}?\n\n` +
        `Zdejmie ${batch.totalQty} szt. z ${batch.distinctLocations} lokalizacji (${batch.addCount} operacji ADD z picklisty).`,
    );
    if (!ok) return;
    setBusyId(batchId);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/system/stock-anomalies/${encodeURIComponent(batchId)}/rollback`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Nie udalo sie wycofac paczki.");
        return;
      }
      setMessage(`Wycofano ${data.reversedCount ?? 0} przywrocen stanu.`);
      onStockChanged?.();
      await load();
    } catch {
      setError("Blad sieci podczas wycofywania.");
    } finally {
      setBusyId(null);
    }
  };

  const open = anomalies.filter((entry) => !entry.rolledBack);

  return (
    <section id="stock-anomalies" className="scroll-mt-4 rounded-2xl border border-rose-200 bg-rose-50/40 p-4">
      <h2 className="text-base font-semibold text-rose-950">Anomalie masowych zmian stanów</h2>
      <p className="mt-1 text-sm text-rose-900">
        Paczki jednoczesnych przywróceń stanu z picklisty (ADD z referencją PL:). Baner na stronie głównej znika po 48 h
        od ostatniej otwartej anomalii.
      </p>

      {message ? <p className="mt-3 text-sm font-medium text-emerald-800">{message}</p> : null}
      {error ? <p className="mt-3 text-sm font-medium text-rose-800">{error}</p> : null}

      {loading ? (
        <p className="mt-3 text-sm text-rose-800">Ladowanie…</p>
      ) : anomalies.length === 0 ? (
        <p className="mt-3 text-sm text-rose-800">Brak wykrytych paczek w ostatnich miesiacach.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {anomalies.map((batch) => (
            <li key={batch.id} className="rounded-xl border border-rose-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-rose-950">{formatWhen(batch.startedAt)}</p>
                  <p className="mt-0.5 text-xs text-rose-900">
                    {batch.addCount}× przywroc (ADD) · {batch.distinctLocations} lok. · {batch.totalQty} szt. ·{" "}
                    {batch.distinctSkus} SKU
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-rose-700">{batch.id}</p>
                </div>
                {batch.rolledBack ? (
                  <span className="rounded-lg bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase text-emerald-900">
                    Wycofane
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === batch.id}
                    className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                    onClick={() => void rollback(batch.id)}
                  >
                    {busyId === batch.id ? "…" : "Wycofaj przywrocenia"}
                  </button>
                )}
              </div>
              {batch.lines.length > 0 ? (
                <ul className="mt-2 max-h-[min(70vh,32rem)] space-y-0.5 overflow-y-auto font-mono text-[10px] text-rose-800">
                  {batch.lines.map((line) => (
                    <li key={line.id}>
                      {line.sku} · {line.qty} szt. → {line.locationCode}
                      {line.referenceNo ? ` · ${line.referenceNo}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!loading && open.length > 0 ? (
        <p className="mt-3 text-xs text-rose-800">
          Otwarte paczki: {open.length}. Najnowsza: {formatWhen(open[0].startedAt)}.
        </p>
      ) : null}
    </section>
  );
}
