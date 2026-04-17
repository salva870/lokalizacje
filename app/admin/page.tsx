"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type LocationType = "DISPLAY" | "BUFFER" | "RESERVED" | "BACKROOM_BOX" | "BACKROOM_SHELF" | "INACTIVE";

const locationTypeOptions: LocationType[] = [
  "DISPLAY",
  "BUFFER",
  "RESERVED",
  "BACKROOM_BOX",
  "BACKROOM_SHELF",
  "INACTIVE",
];

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [locations, setLocations] = useState<Array<{ code: string; name: string }>>([]);
  const [newLocationCode, setNewLocationCode] = useState("");
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationZone, setNewLocationZone] = useState<"SKLEP" | "ZAPLECZE">("SKLEP");
  const [newLocationType, setNewLocationType] = useState<LocationType>("DISPLAY");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const meRes = await fetch("/api/auth/me");
    if (!meRes.ok) {
      window.location.href = "/login";
      return;
    }
    const me = await meRes.json();
    const role = me?.user?.role as string | undefined;
    if (role !== "ADMIN") {
      window.location.href = "/";
      return;
    }
    setIsAdmin(true);
    const locRes = await fetch("/api/locations");
    if (!locRes.ok) {
      setReady(true);
      return;
    }
    const locData = await locRes.json();
    setLocations(locData.items ?? []);
    setReady(true);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createNewLocation(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const response = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: newLocationCode,
        name: newLocationName,
        parentZone: newLocationZone,
        locationType: newLocationType,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Nie udalo sie dodac lokalizacji.");
      return;
    }
    setMessage("Lokalizacja dodana.");
    setNewLocationCode("");
    setNewLocationName("");
    await load();
  }

  if (!ready || !isAdmin) {
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
            <h1 className="text-xl font-semibold text-blue-900">Administrator — lokalizacje</h1>
            <nav className="flex flex-wrap gap-2 text-sm">
              <Link className="rounded-lg border border-blue-200 px-3 py-1.5 text-blue-800 hover:bg-blue-50" href="/">
                Panel skanowania
              </Link>
              <Link className="rounded-lg border border-blue-200 px-3 py-1.5 text-blue-800 hover:bg-blue-50" href="/settings">
                Konto
              </Link>
            </nav>
          </div>
          <p className="mt-2 text-sm text-blue-700">
            Dodawanie lokalizacji i typow stref. Dziala na telefonie i na komputerze.
          </p>
        </header>

        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="font-medium text-blue-900">Istniejace lokalizacje</h2>
          <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-blue-100 text-sm">
            {locations.length === 0 ? (
              <p className="p-3 text-blue-700">Brak zdefiniowanych lokalizacji.</p>
            ) : (
              <ul className="divide-y divide-blue-100">
                {locations.map((location) => (
                  <li key={location.code} className="px-3 py-2">
                    <span className="font-semibold text-blue-900">{location.code}</span>
                    <span className="text-blue-700"> — {location.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="font-medium text-blue-900">Nowa lokalizacja</h2>
          <form className="mt-3 space-y-3" onSubmit={createNewLocation}>
            <input
              className="w-full rounded-lg border border-blue-200 p-2"
              placeholder="Kod lokalizacji"
              value={newLocationCode}
              onChange={(e) => setNewLocationCode(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-blue-200 p-2"
              placeholder="Nazwa lokalizacji"
              value={newLocationName}
              onChange={(e) => setNewLocationName(e.target.value)}
            />
            <select
              className="w-full rounded-lg border border-blue-200 p-2"
              value={newLocationZone}
              onChange={(e) => setNewLocationZone(e.target.value as "SKLEP" | "ZAPLECZE")}
            >
              <option value="SKLEP">Strefa: SKLEP</option>
              <option value="ZAPLECZE">Strefa: ZAPLECZE</option>
            </select>
            <select
              className="w-full rounded-lg border border-blue-200 p-2"
              value={newLocationType}
              onChange={(e) => setNewLocationType(e.target.value as LocationType)}
            >
              {locationTypeOptions.map((type) => (
                <option key={type} value={type}>
                  Typ: {type}
                </option>
              ))}
            </select>
            {message ? <p className="text-sm text-blue-800">{message}</p> : null}
            <button className="w-full rounded-lg bg-blue-700 p-3 font-medium text-white" type="submit">
              Dodaj lokalizacje
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
