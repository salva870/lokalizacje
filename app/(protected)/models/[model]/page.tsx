"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { StockQtyDisplay, DamagedStockIcon } from "@/app/components/StockQtyDisplay";
import { buildLocationTypeMap } from "@/lib/stockClassification";
import { parseSkuModel } from "@/lib/skuModel";
import { stockRowsForModel, type StockRow } from "@/lib/stockViews";
import type { Location } from "@/lib/types";

export default function ModelStockPage() {
  const params = useParams();
  const modelParam = params.model;
  const modelCode = decodeURIComponent(Array.isArray(modelParam) ? modelParam[0] : String(modelParam ?? "")).trim().toUpperCase();

  const [ready, setReady] = useState(false);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busyRef = useRef(false);

  const locationTypes = useMemo(() => buildLocationTypeMap(locations), [locations]);

  async function loadStock() {
    const [stockRes, locationsRes] = await Promise.all([fetch("/api/stock"), fetch("/api/locations")]);
    if (!stockRes.ok) {
      setError("Nie udalo sie pobrac stanow.");
      return false;
    }
    const stockData = await stockRes.json();
    setStock(stockData.stock ?? []);
    if (locationsRes.ok) {
      const locationsData = await locationsRes.json();
      setLocations(locationsData.items ?? []);
    }
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        window.location.replace("/login");
        return;
      }
      const ok = await loadStock();
      if (!cancelled) {
        setReady(true);
        if (!ok) setError("Nie udalo sie pobrac stanow.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const group = useMemo(
    () => stockRowsForModel(stock, modelCode, { locationTypes }),
    [stock, modelCode, locationTypes],
  );

  const changeQty = useCallback(
    async (locationCode: string, sku: string, currentQty: number, delta: number) => {
      if (busyRef.current) return;
      const key = `${locationCode}:${sku}`;
      busyRef.current = true;
      setBusyKey(key);
      setSaveMessage(null);
      try {
        const response = await fetch("/api/movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            delta < 0
              ? { movementType: "REMOVE", sku, qty: 1, fromLocationCode: locationCode }
              : { movementType: "ADD", sku, qty: 1, toLocationCode: locationCode },
          ),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Nie udalo sie zapisac zmiany.");
        }
        await loadStock();
        setSaveMessage(delta < 0 ? `Zdjeto 1 szt. z ${locationCode}.` : `Dodano 1 szt. na ${locationCode}.`);
      } catch (err) {
        setSaveMessage(err instanceof Error ? err.message : "Nie udalo sie zapisac zmiany.");
      } finally {
        busyRef.current = false;
        setBusyKey(null);
      }
    },
    [],
  );

  if (!ready) {
    return (
      <main className="min-h-screen bg-blue-50 px-3 py-4">
        <p className="mx-auto max-w-lg rounded-xl bg-white p-4 text-sm text-blue-800 shadow">Wczytywanie...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-blue-50 px-3 py-4 text-blue-950">
      <div className="mx-auto max-w-lg space-y-4">
        <header className="rounded-xl bg-white p-4 shadow">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-semibold text-blue-900">Model {modelCode}</h1>
            <Link className="rounded-lg border border-blue-200 px-3 py-1.5 text-sm text-blue-800 hover:bg-blue-50" href="/">
              Panel skanowania
            </Link>
          </div>
          <p className="mt-2 text-sm text-blue-700">Rozmiary, lokalizacje i ilosci dla tego modelu.</p>
          <button
            type="button"
            className={`mt-3 rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              editMode ? "border-amber-400 bg-amber-50 text-amber-950" : "border-blue-300 bg-white text-blue-900"
            }`}
            onClick={() => {
              setEditMode((prev) => !prev);
              setSaveMessage(null);
            }}
          >
            {editMode ? "Zakoncz edycje" : "Edytuj stany"}
          </button>
          {saveMessage ? <p className="mt-2 text-xs font-medium text-blue-800">{saveMessage}</p> : null}
        </header>

        {error ? <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}

        {!group ? (
          <section className="rounded-xl bg-white p-4 text-sm text-blue-700 shadow">
            Brak stanu dla modelu <strong className="font-mono">{modelCode}</strong>.
          </section>
        ) : (
          <>
            <section className="rounded-xl bg-white p-4 shadow">
              <p className="text-sm text-blue-800">
                Lacznie:{" "}
                <strong>
                  <StockQtyDisplay qty={group.totalQty} damagedQty={group.damagedQty} />
                </strong>{" "}
                · {group.lines.length} rozmiarow
              </p>
            </section>

            <section className="space-y-3">
              {group.lines.map((line) => (
                <article key={line.sku} className="rounded-xl bg-white p-4 shadow">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-mono text-lg font-semibold text-blue-900">{line.sku}</h2>
                    <span className="text-sm text-blue-700">
                      Rozmiar {line.size || parseSkuModel(line.sku).size || "—"} ·{" "}
                      <StockQtyDisplay qty={line.qty} damagedQty={line.damagedQty} />
                    </span>
                  </div>
                  {line.locations.length === 0 ? (
                    <p className="mt-2 text-sm text-blue-600">Brak przypisanych lokalizacji.</p>
                  ) : (
                    <ul className="mt-3 divide-y divide-blue-100 rounded-lg border border-blue-100 text-sm">
                      {line.locations.map((loc) => {
                        const lineKey = `${loc.locationCode}:${line.sku}`;
                        const lineBusy = busyKey === lineKey;
                        return (
                          <li key={`${line.sku}-${loc.locationCode}`} className="flex justify-between gap-2 px-3 py-2">
                            <span className={`font-semibold ${loc.damaged ? "text-amber-900" : "text-blue-900"}`}>
                              {loc.locationCode}
                            </span>
                            {editMode ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-300 bg-white text-base font-bold text-blue-900 disabled:opacity-40"
                                  disabled={Boolean(busyKey) || loc.qty <= 0}
                                  onClick={() => void changeQty(loc.locationCode, line.sku, loc.qty, -1)}
                                >
                                  −
                                </button>
                                <span className="min-w-6 text-center text-xs font-semibold tabular-nums">
                                  {lineBusy ? "…" : loc.qty}
                                </span>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-300 bg-white text-base font-bold text-blue-900 disabled:opacity-40"
                                  disabled={Boolean(busyKey)}
                                  onClick={() => void changeQty(loc.locationCode, line.sku, loc.qty, 1)}
                                >
                                  +
                                </button>
                              </div>
                            ) : loc.damaged ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-950"
                                title={`${loc.qty} uszkodzonych`}
                              >
                                <DamagedStockIcon className="h-3.5 w-3.5" />
                                <span className="font-semibold tabular-nums">{loc.qty}</span>
                              </span>
                            ) : (
                              <span className="text-blue-700">{loc.qty} szt.</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
