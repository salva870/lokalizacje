"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatMovementRoute,
  formatMovementTimestamp,
  movementSizeLabel,
  movementTypeLabel,
} from "@/lib/formatMovementLog";
import type { StockMovement } from "@/lib/types";

type Props = {
  model: string;
  onClose: () => void;
};

export function ModelChangeLogOverlay({ model, onClose }: Props) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/models/${encodeURIComponent(model)}/movements?limit=400`,
        { headers: { Accept: "application/json" } },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Nie udalo sie pobrac logu.");
        setMovements([]);
        return;
      }
      setMovements(Array.isArray(data.movements) ? data.movements : []);
    } catch {
      setError("Blad polaczenia z serwerem.");
      setMovements([]);
    } finally {
      setLoading(false);
    }
  }, [model]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/65 p-2 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-log-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(92vh,40rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-indigo-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-indigo-100 bg-indigo-50/80 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Log zmian stanu</p>
              <h2 id="model-log-title" className="truncate font-mono text-lg font-bold text-indigo-950">
                {model}
              </h2>
              <p className="mt-0.5 text-xs text-indigo-700">
                Wszystkie rozmiary tego modelu — niezaleznie od lokalizacji, z ktorej otworzyles log.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-sm font-semibold text-indigo-900"
              onClick={onClose}
            >
              Zamknij
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-2 sm:px-3">
          {loading ? (
            <p className="px-2 py-8 text-center text-sm text-indigo-700">Ladowanie logu…</p>
          ) : error ? (
            <div className="px-2 py-6 text-center">
              <p className="text-sm font-medium text-red-700">{error}</p>
              <button
                type="button"
                className="mt-3 rounded-xl border border-indigo-200 px-3 py-1.5 text-sm font-semibold text-indigo-900"
                onClick={() => void load()}
              >
                Sprobuj ponownie
              </button>
            </div>
          ) : movements.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-indigo-700">Brak zarejestrowanych zmian dla tego modelu.</p>
          ) : (
            <table className="w-full min-w-[32rem] border-collapse text-left text-xs sm:text-sm">
              <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur">
                <tr className="border-b border-indigo-100 text-indigo-800">
                  <th className="px-2 py-2 font-semibold">Data</th>
                  <th className="px-2 py-2 font-semibold">Operacja</th>
                  <th className="px-2 py-2 font-semibold">Rozm.</th>
                  <th className="px-2 py-2 font-semibold">Szt.</th>
                  <th className="px-2 py-2 font-semibold">Lokalizacje</th>
                  <th className="hidden px-2 py-2 font-semibold sm:table-cell">Referencja</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((row) => (
                  <tr key={row.id} className="border-b border-indigo-50 align-top hover:bg-indigo-50/40">
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-indigo-900">
                      {formatMovementTimestamp(row.createdAt)}
                    </td>
                    <td className="px-2 py-2 font-medium text-indigo-950">{movementTypeLabel(row.movementType)}</td>
                    <td className="px-2 py-2 font-mono text-indigo-900">{movementSizeLabel(row.sku)}</td>
                    <td className="px-2 py-2 tabular-nums font-semibold text-indigo-950">{row.qty}</td>
                    <td className="px-2 py-2 font-mono text-indigo-800">{formatMovementRoute(row)}</td>
                    <td className="hidden max-w-[8rem] truncate px-2 py-2 font-mono text-[10px] text-indigo-600 sm:table-cell">
                      {row.referenceNo || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && movements.length > 0 ? (
          <footer className="shrink-0 border-t border-indigo-100 px-4 py-2 text-center text-[11px] text-indigo-600">
            {movements.length} ostatnich wpisow (wszystkie rozmiary modelu)
          </footer>
        ) : null}
      </div>
    </div>
  );
}
