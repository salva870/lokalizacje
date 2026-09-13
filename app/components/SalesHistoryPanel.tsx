"use client";

import { useEffect, useState } from "react";
import type { SaleSessionDetail, SaleSessionSummary } from "@/lib/types";

function formatSaleDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SalesHistoryPanelProps = {
  onClose: () => void;
};

export function SalesHistoryPanel({ onClose }: SalesHistoryPanelProps) {
  const [items, setItems] = useState<SaleSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SaleSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/sales?limit=80")
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Blad pobierania historii");
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Blad pobierania historii");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void fetch(`/api/sales/${encodeURIComponent(selectedId)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Blad pobierania szczegolow");
        if (!cancelled) setDetail(data.sale ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Blad pobierania szczegolow");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className="fixed inset-0 z-[57] flex items-end justify-center bg-amber-950/55 p-3 sm:items-center">
      <div className="flex max-h-[min(92vh,860px)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-amber-100 px-4 pb-3 pt-4">
          <div>
            <h2 className="text-lg font-semibold text-amber-950">Historia sprzedazy</h2>
            <p className="mt-1 text-sm text-amber-800">Zapisane listy sprzedazy z data i godzina.</p>
          </div>
          <button
            type="button"
            className="rounded-xl border border-amber-200 px-3 py-2 text-sm text-amber-900"
            onClick={onClose}
          >
            Zamknij
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          {loading ? <p className="text-sm text-amber-800">Wczytywanie...</p> : null}

          {!loading && !selectedId ? (
            items.length === 0 ? (
              <p className="text-sm text-amber-800">Brak zapisanych sprzedazy.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="w-full rounded-2xl border border-amber-200 bg-amber-50/40 px-3 py-3 text-left hover:border-amber-400"
                      onClick={() => setSelectedId(entry.id)}
                    >
                      <p className="font-semibold text-amber-950">{formatSaleDate(entry.createdAt)}</p>
                      <p className="mt-1 text-xs text-amber-800">
                        {entry.pieceCount} szt. · {entry.itemCount} poz.
                        {entry.photoCount > 0 ? ` · ${entry.photoCount} zdj.` : ""}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {selectedId ? (
            <div className="space-y-3">
              <button
                type="button"
                className="rounded-lg border border-amber-200 px-2 py-1 text-xs font-semibold text-amber-900"
                onClick={() => setSelectedId(null)}
              >
                ← Wstecz do listy
              </button>
              {detailLoading ? <p className="text-sm text-amber-800">Wczytywanie szczegolow...</p> : null}
              {detail ? (
                <>
                  <p className="text-sm font-semibold text-amber-950">Sprzedaz: {formatSaleDate(detail.createdAt)}</p>
                  {detail.note ? <p className="text-xs text-amber-800">{detail.note}</p> : null}
                  <ul className="space-y-2">
                    {detail.items.map((item) => (
                      <li key={item.id} className="rounded-xl border border-amber-100 bg-amber-50/30 p-3 text-sm">
                        {item.sku ? (
                          <p className="font-mono font-semibold text-amber-950">
                            {item.sku} · {item.qty} szt.
                            {item.fromLocationCode ? (
                              <span className="ml-2 font-sans text-xs font-normal text-amber-700">
                                z {item.fromLocationCode}
                              </span>
                            ) : null}
                          </p>
                        ) : (
                          <p className="font-semibold text-amber-950">Produkt bez kodu · {item.qty} szt.</p>
                        )}
                        {item.note ? <p className="mt-1 text-xs text-amber-800">{item.note}</p> : null}
                        {item.attachments.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.attachments.map((attachment) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={attachment.id}
                                src={attachment.url}
                                alt={attachment.originalName ?? "Zdjecie produktu"}
                                className="h-20 w-20 rounded-lg border border-amber-200 object-cover"
                              />
                            ))}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
