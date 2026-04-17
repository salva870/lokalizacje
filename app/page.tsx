"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

type MovementType = "ADD" | "REMOVE" | "MOVE" | "RESTORE_FROM_TMP" | "MOVE_TO_SALE" | "SALE_FINALIZE";

const movementPresets: MovementType[] = [
  "ADD",
  "REMOVE",
  "MOVE",
  "RESTORE_FROM_TMP",
  "MOVE_TO_SALE",
  "SALE_FINALIZE",
];

const movementLabels: Record<MovementType, string> = {
  ADD: "Dodawanie do lokalizacji",
  REMOVE: "Zdejmowanie z lokalizacji",
  MOVE: "Przeniesienie miedzy lokalizacjami",
  RESTORE_FROM_TMP: "Przywracanie z TMP",
  MOVE_TO_SALE: "Odkladanie na SPRZEDAZ",
  SALE_FINALIZE: "Finalizacja sprzedazy",
};

function normalizeScannedSku(rawValue: string) {
  const compactRaw = rawValue.replace(/\s+/g, "").trim();
  if (!compactRaw) return "";

  const directSkuMatch = compactRaw.match(/[?&]sku=([^&#]+)/i);
  const fromQuery = directSkuMatch?.[1];
  const fromEquals = compactRaw.includes("=") ? compactRaw.split("=").pop() : null;
  const candidate = decodeURIComponent((fromQuery || fromEquals || compactRaw).trim());

  return candidate.replace(/\s+/g, "").toUpperCase();
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [userRole, setUserRole] = useState<"ADMIN" | "OPERATOR" | null>(null);
  const [locations, setLocations] = useState<Array<{ code: string; name: string }>>([]);
  const [stock, setStock] = useState<Array<{ locationCode: string; sku: string; qty: number }>>([]);
  const [movementType, setMovementType] = useState<MovementType>("ADD");
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState(1);
  const [fromLocationCode, setFromLocationCode] = useState("");
  const [toLocationCode, setToLocationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restoreSuggestions, setRestoreSuggestions] = useState<string[]>([]);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerStatus, setScannerStatus] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const scanControlsRef = useRef<{ stop: () => void } | null>(null);

  async function loadData() {
    const [meRes, locationsRes, stockRes] = await Promise.all([
      fetch("/api/auth/me"),
      fetch("/api/locations"),
      fetch("/api/stock"),
    ]);

    if (!meRes.ok) {
      window.location.href = "/login";
      return;
    }

    const meData = await meRes.json();
    const locationsData = await locationsRes.json();
    const stockData = await stockRes.json();
    setUserRole(meData?.user?.role ?? null);
    setLocations(locationsData.items ?? []);
    setStock(stockData.stock ?? []);
    setReady(true);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, []);

  const locationOptions = useMemo(
    () =>
      locations.map((location) => (
        <option key={location.code} value={location.code}>
          {location.code} - {location.name}
        </option>
      )),
    [locations],
  );

  const stockByLocation = useMemo(() => {
    const grouped = new Map<string, Array<{ sku: string; qty: number }>>();
    for (const item of stock) {
      const current = grouped.get(item.locationCode) ?? [];
      current.push({ sku: item.sku, qty: item.qty });
      grouped.set(item.locationCode, current);
    }
    return [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [stock]);

  async function submitMovement(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setRestoreSuggestions([]);

    const response = await fetch("/api/movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movementType,
        sku,
        qty,
        fromLocationCode: fromLocationCode || undefined,
        toLocationCode: toLocationCode || undefined,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Nie udalo sie zapisac ruchu");
      return;
    }
    if (data.simulated) {
      setMessage(data.message ?? "Pokazano sugestie przywracania z TMP.");
      setRestoreSuggestions(data.suggestions?.suggestions ?? []);
      return;
    }

    setMessage("Ruch zapisany");
    setSku("");
    await loadData();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function stopScanner() {
    scanControlsRef.current?.stop();
    scanControlsRef.current = null;
    scanReaderRef.current = null;
    setScannerOpen(false);
    setScannerStatus(null);
  }

  async function openScanner() {
    try {
      setScannerOpen(true);
      setScannerStatus("Uruchamianie aparatu...");
      const reader = new BrowserMultiFormatReader();
      scanReaderRef.current = reader;

      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      const preferredDevice =
        devices.find((device) => /back|rear|environment|tyl/i.test(device.label)) ?? devices[0];
      if (!preferredDevice || !videoRef.current) {
        setScannerStatus("Brak dostepnej kamery.");
        return;
      }

      const controls = await reader.decodeFromVideoDevice(
        preferredDevice.deviceId,
        videoRef.current,
        (result) => {
          if (!result) return;
          setSku(normalizeScannedSku(result.getText()));
          setMessage("SKU odczytane z aparatu.");
          setScannerStatus("Kod odczytany.");
          stopScanner();
        },
      );
      scanControlsRef.current = controls;
      setScannerStatus("Nakieruj aparat na kod kreskowy SKU.");
    } catch {
      setScannerStatus("Nie udalo sie uruchomic aparatu. Sprawdz uprawnienia kamery.");
    }
  }

  useEffect(() => {
    return () => {
      scanControlsRef.current?.stop();
    };
  }, []);

  return (
    <main className="min-h-screen bg-blue-50 px-3 py-4 text-blue-950">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="rounded-xl bg-white p-4 shadow">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-xl font-semibold text-blue-900">Panel skanowania lokalizacji</h1>
            <nav className="flex flex-wrap items-center gap-2">
              <Link
                className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-50"
                href="/settings"
              >
                Konto
              </Link>
              {userRole === "ADMIN" ? (
                <Link
                  className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-50"
                  href="/admin"
                >
                  Administrator
                </Link>
              ) : null}
              <button className="rounded-lg bg-blue-700 px-3 py-2 text-sm text-white" onClick={logout}>
                Wyloguj
              </button>
            </nav>
          </div>
          <p className="mt-2 text-sm text-blue-700">
            Operacje telefonem + podglad stanow. Przywracanie z TMP sluzy jako sugestia odlozenia.
          </p>
        </header>

        {ready ? (
          <>
            <form className="space-y-3 rounded-xl bg-white p-4 shadow" onSubmit={submitMovement}>
              <h2 className="font-medium text-blue-900">Nowy ruch</h2>
              <label className="text-sm font-medium text-blue-800">Akcja</label>
              <select
                className="w-full rounded-lg border border-blue-200 p-2"
                value={movementType}
                onChange={(e) => setMovementType(e.target.value as MovementType)}
              >
                {movementPresets.map((type) => (
                  <option key={type} value={type}>
                    {movementLabels[type]}
                  </option>
                ))}
              </select>
              <div className="space-y-2">
                <label className="text-sm font-medium text-blue-800">SKU (kod kreskowy)</label>
                <div className="flex gap-2">
                  <input
                    className="w-full rounded-lg border border-blue-200 p-2"
                    placeholder="Wpisz lub zeskanuj SKU"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white"
                    onClick={openScanner}
                  >
                    Skanuj
                  </button>
                </div>
              </div>
              <input
                className="w-full rounded-lg border border-blue-200 p-2"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
              />
              <select
                className="w-full rounded-lg border border-blue-200 p-2"
                value={fromLocationCode}
                onChange={(e) => setFromLocationCode(e.target.value)}
              >
                <option value="">Lokalizacja zrodlowa (opcjonalnie)</option>
                {locationOptions}
              </select>
              <select
                className="w-full rounded-lg border border-blue-200 p-2"
                value={toLocationCode}
                onChange={(e) => setToLocationCode(e.target.value)}
              >
                <option value="">Lokalizacja docelowa (opcjonalnie)</option>
                {locationOptions}
              </select>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
              {restoreSuggestions.length > 0 ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-sm text-blue-900">
                  Sugestie odlozenia z TMP: {restoreSuggestions.join(", ")}
                </div>
              ) : null}
              <button className="w-full rounded-lg bg-blue-700 p-3 font-medium text-white">Zapisz ruch</button>
            </form>

            <section className="rounded-xl bg-white p-4 shadow">
              <h2 className="font-medium text-blue-900">Aktualny stan (lista pozycji)</h2>
              <div className="mt-3 space-y-2 text-sm">
                {stock.length === 0 ? <p className="text-blue-700">Brak danych.</p> : null}
                {stock.map((item) => (
                  <div key={`${item.locationCode}-${item.sku}`} className="rounded border border-blue-100 p-2">
                    <strong>{item.locationCode}</strong> | {item.sku} | ilosc: {item.qty}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl bg-white p-4 shadow">
              <h2 className="font-medium text-blue-900">Podglad stanow na lokalizacjach</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {stockByLocation.length === 0 ? <p className="text-sm text-blue-700">Brak danych.</p> : null}
                {stockByLocation.map(([locationCode, items]) => (
                  <div key={locationCode} className="rounded-lg border border-blue-100 p-3">
                    <p className="font-semibold text-blue-900">{locationCode}</p>
                    <div className="mt-2 space-y-1 text-sm">
                      {items.map((item) => (
                        <p key={`${locationCode}-${item.sku}`}>
                          {item.sku}: {item.qty}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {userRole === "ADMIN" ? (
              <section className="rounded-xl border border-blue-200 bg-blue-50/80 p-4 text-sm text-blue-900">
                <p>
                  Zarzadzanie lokalizacjami (dodawanie kartonow, regalow) jest w sekcji{" "}
                  <Link className="font-semibold underline decoration-blue-400 underline-offset-2" href="/admin">
                    Administrator
                  </Link>
                  — widocznej takze na telefonie.
                </p>
              </section>
            ) : null}
          </>
        ) : (
          <section className="rounded-xl bg-white p-4 shadow">
            <p>Wczytywanie...</p>
          </section>
        )}
      </div>
      {scannerOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-blue-950/95 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Skaner kodu kreskowego</h3>
            <button className="rounded-lg bg-white/20 px-3 py-2 text-sm text-white" onClick={stopScanner}>
              Zamknij
            </button>
          </div>
          <p className="mb-3 text-sm text-blue-100">
            {scannerStatus ?? "Nakieruj aparat telefonu na kod kreskowy SKU."}
          </p>
          <video ref={videoRef} className="h-full w-full rounded-xl bg-black object-cover" muted playsInline />
        </div>
      ) : null}
    </main>
  );
}
