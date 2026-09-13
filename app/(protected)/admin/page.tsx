"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { LocationOrderPanel } from "@/app/components/LocationOrderPanel";
import {
  defaultLocationTypeForZone,
  defaultLocationTypeLabels,
  formatLocationType,
  zoneLabels,
} from "@/lib/locationMeta";
import type { LocationType, Zone } from "@/lib/types";

const locationTypeOptions = Object.keys(defaultLocationTypeLabels) as LocationType[];

type LocationRow = {
  code: string;
  name: string;
  parentZone: Zone;
  locationType: LocationType;
  isActive: boolean;
  sortOrder?: number;
};

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [stockRows, setStockRows] = useState<Array<{ locationCode: string; sku: string; qty: number }>>([]);
  const [operators, setOperators] = useState<Array<{ id: string; login: string; role: string }>>([]);
  const [newLocationCode, setNewLocationCode] = useState("");
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationZone, setNewLocationZone] = useState<Zone>("SKLEP");
  const [newLocationType, setNewLocationType] = useState<LocationType>("DISPLAY");
  const [message, setMessage] = useState<string | null>(null);
  const [newOperatorLogin, setNewOperatorLogin] = useState("");
  const [newOperatorPassword, setNewOperatorPassword] = useState("");
  const [operatorMessage, setOperatorMessage] = useState<string | null>(null);
  const [resetOperatorId, setResetOperatorId] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [roleOperatorId, setRoleOperatorId] = useState("");
  const [roleValue, setRoleValue] = useState<"ADMIN" | "OPERATOR">("OPERATOR");
  const [roleMessage, setRoleMessage] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editZone, setEditZone] = useState<Zone>("SKLEP");
  const [editType, setEditType] = useState<LocationType>("DISPLAY");
  const [revokeMessage, setRevokeMessage] = useState<string | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [typeLabels, setTypeLabels] = useState<Record<LocationType, string>>(defaultLocationTypeLabels);
  const [typeLabelsMessage, setTypeLabelsMessage] = useState<string | null>(null);
  const [typeLabelsBusy, setTypeLabelsBusy] = useState(false);

  async function load() {
    const meRes = await fetch("/api/auth/me");
    if (!meRes.ok) {
      window.location.replace("/login");
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

    const labelsRes = await fetch("/api/admin/location-type-labels");
    if (labelsRes.ok) {
      const labelsData = await labelsRes.json();
      if (labelsData.labels) setTypeLabels(labelsData.labels);
    }

    const stockRes = await fetch("/api/stock");
    if (stockRes.ok) {
      const stockData = await stockRes.json();
      setStockRows(stockData.stock ?? []);
    } else {
      setStockRows([]);
    }

    const opRes = await fetch("/api/admin/operators");
    if (opRes.ok) {
      const opData = await opRes.json();
      setOperators(opData.items ?? []);
    }

    setReady(true);
  }

  async function revokeAllSessions() {
    const ok = window.confirm(
      "Wylogowac WSZYSTKICH uzytkownikow na wszystkich urzadzeniach? Kazdy, w tym Ty, bedzie musial zalogowac sie ponownie.",
    );
    if (!ok) return;
    setRevokeBusy(true);
    setRevokeMessage(null);
    try {
      const response = await fetch("/api/admin/revoke-sessions", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRevokeMessage(data.error ?? "Nie udalo sie uniewaznic sesji.");
        return;
      }
      window.location.replace("/login");
    } catch {
      setRevokeMessage("Nie udalo sie uniewaznic sesji.");
    } finally {
      setRevokeBusy(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  function qtyOnLocation(code: string) {
    return stockRows.filter((row) => row.locationCode === code).reduce((acc, row) => acc + row.qty, 0);
  }

  function startEdit(location: LocationRow) {
    setEditingCode(location.code);
    setEditName(location.name);
    setEditZone(location.parentZone);
    setEditType(location.locationType);
    setMessage(null);
  }

  function cancelEdit() {
    setEditingCode(null);
  }

  async function saveEdit(code: string) {
    setMessage(null);
    const response = await fetch(`/api/locations/${encodeURIComponent(code)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        parentZone: editZone,
        locationType: editType,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error ?? "Nie udalo sie zapisac zmian.");
      return;
    }
    setMessage(`Zapisano: ${code}`);
    setEditingCode(null);
    await load();
  }

  async function deleteLocationByCode(code: string) {
    setMessage(null);
    if (!window.confirm(`Usunac pusta lokalizacje ${code}?`)) return;
    const response = await fetch(`/api/locations/${encodeURIComponent(code)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error ?? "Nie udalo sie usunac lokalizacji.");
      return;
    }
    setMessage(`Usunieto: ${code}`);
    await load();
  }

  async function createOperator(event: FormEvent) {
    event.preventDefault();
    setOperatorMessage(null);
    const response = await fetch("/api/admin/operators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: newOperatorLogin,
        password: newOperatorPassword,
        role: "OPERATOR",
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setOperatorMessage(data.error ?? "Nie udalo sie utworzyc uzytkownika.");
      return;
    }
    setOperatorMessage("Uzytkownik utworzony.");
    setNewOperatorLogin("");
    setNewOperatorPassword("");
    await load();
  }

  async function resetOperatorPassword(event: FormEvent) {
    event.preventDefault();
    setResetMessage(null);
    if (!resetOperatorId) {
      setResetMessage("Wybierz uzytkownika.");
      return;
    }
    const response = await fetch(`/api/admin/operators/${resetOperatorId}/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPassword }),
    });
    const data = await response.json();
    if (!response.ok) {
      setResetMessage(data.error ?? "Nie udalo sie zmienic hasla.");
      return;
    }
    setResetMessage("Haslo zmienione.");
    setResetPassword("");
  }

  async function changeOperatorRole(event: FormEvent) {
    event.preventDefault();
    setRoleMessage(null);
    if (!roleOperatorId) {
      setRoleMessage("Wybierz uzytkownika.");
      return;
    }
    const target = operators.find((operator) => operator.id === roleOperatorId);
    const roleLabel = roleValue === "ADMIN" ? "administratora" : "operatora";
    if (
      !window.confirm(
        `Nadac uzytkownikowi ${target?.login ?? ""} uprawnienia: ${roleLabel}?`,
      )
    ) {
      return;
    }
    const response = await fetch(`/api/admin/operators/${encodeURIComponent(roleOperatorId)}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: roleValue }),
    });
    const data = await response.json();
    if (!response.ok) {
      setRoleMessage(data.error ?? "Nie udalo sie zmienic uprawnien.");
      return;
    }
    setRoleMessage(`Uprawnienia zmienione na ${roleValue === "ADMIN" ? "administrator" : "operator"}.`);
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
            <h1 className="text-xl font-semibold text-blue-900">Administrator</h1>
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
            Zarzadzanie uzytkownikami (tylko administrator) oraz lokalizacjami. Dziala na telefonie i na komputerze.
          </p>
        </header>

        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="font-medium text-blue-900">Uzytkownicy (operatorzy)</h2>
          <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-blue-100 text-sm">
            {operators.length === 0 ? (
              <p className="p-3 text-blue-700">Brak uzytkownikow lub brak polaczenia z Supabase.</p>
            ) : (
              <ul className="divide-y divide-blue-100">
                {operators.map((operator) => (
                  <li key={operator.id} className="px-3 py-2">
                    <span className="font-semibold text-blue-900">{operator.login}</span>
                    <span className="text-blue-700">
                      {" "}
                      — {operator.role === "ADMIN" ? "Administrator" : "Operator"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form className="mt-4 space-y-3" onSubmit={createOperator}>
            <h3 className="text-sm font-medium text-blue-900">Nowy operator</h3>
            <input
              className="w-full rounded-lg border border-blue-200 p-2"
              placeholder="Login"
              value={newOperatorLogin}
              onChange={(e) => setNewOperatorLogin(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-blue-200 p-2"
              type="password"
              placeholder="Haslo startowe"
              value={newOperatorPassword}
              onChange={(e) => setNewOperatorPassword(e.target.value)}
            />
            {operatorMessage ? <p className="text-sm text-blue-800">{operatorMessage}</p> : null}
            <button className="w-full rounded-lg bg-blue-700 p-3 font-medium text-white" type="submit">
              Utworz operatora
            </button>
          </form>

          <form className="mt-6 space-y-3" onSubmit={resetOperatorPassword}>
            <h3 className="text-sm font-medium text-blue-900">Reset hasla operatora</h3>
            <select
              className="w-full rounded-lg border border-blue-200 p-2"
              value={resetOperatorId}
              onChange={(e) => setResetOperatorId(e.target.value)}
            >
              <option value="">Wybierz uzytkownika</option>
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.login}
                </option>
              ))}
            </select>
            <input
              className="w-full rounded-lg border border-blue-200 p-2"
              type="password"
              placeholder="Nowe haslo"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
            />
            {resetMessage ? <p className="text-sm text-blue-800">{resetMessage}</p> : null}
            <button className="w-full rounded-lg border border-blue-300 bg-white p-3 font-medium text-blue-900" type="submit">
              Ustaw nowe haslo
            </button>
          </form>

          <form className="mt-6 space-y-3" onSubmit={changeOperatorRole}>
            <h3 className="text-sm font-medium text-blue-900">Zmiana uprawnien</h3>
            <p className="text-xs text-blue-700">
              Tylko administrator moze nadac lub odebrac role administratora. Nie mozna odebrac roli ostatniemu adminowi.
            </p>
            <select
              className="w-full rounded-lg border border-blue-200 p-2"
              value={roleOperatorId}
              onChange={(e) => {
                const id = e.target.value;
                setRoleOperatorId(id);
                const selected = operators.find((operator) => operator.id === id);
                if (selected?.role === "ADMIN" || selected?.role === "OPERATOR") {
                  setRoleValue(selected.role);
                }
              }}
            >
              <option value="">Wybierz uzytkownika</option>
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.login} ({operator.role === "ADMIN" ? "admin" : "operator"})
                </option>
              ))}
            </select>
            <select
              className="w-full rounded-lg border border-blue-200 p-2"
              value={roleValue}
              onChange={(e) => setRoleValue(e.target.value as "ADMIN" | "OPERATOR")}
            >
              <option value="OPERATOR">Operator</option>
              <option value="ADMIN">Administrator</option>
            </select>
            {roleMessage ? <p className="text-sm text-blue-800">{roleMessage}</p> : null}
            <button className="w-full rounded-lg border border-blue-300 bg-white p-3 font-medium text-blue-900" type="submit">
              Zapisz uprawnienia
            </button>
          </form>
        </section>

        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="font-medium text-blue-900">Sesje i dostep</h2>
          <p className="mt-2 text-sm text-blue-700">
            Uniewaznia logowanie na wszystkich telefonach i komputerach. Po tej operacji nikt nie wejdzie do aplikacji bez ponownego logowania.
          </p>
          {revokeMessage ? <p className="mt-2 text-sm text-red-700">{revokeMessage}</p> : null}
          <button
            type="button"
            className="mt-3 w-full rounded-lg border border-red-300 bg-red-50 p-3 font-medium text-red-800 disabled:opacity-60"
            disabled={revokeBusy}
            onClick={() => void revokeAllSessions()}
          >
            {revokeBusy ? "Wylogowywanie..." : "Wyloguj wszystkich uzytkownikow"}
          </button>
        </section>

        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="font-medium text-blue-900">Kolejnosc lokalizacji (picklista)</h2>
          <p className="mt-1 text-sm text-blue-700">
            Ta kolejnosc sluzy do sortowania towaru na picklist.divotikids.pl.
          </p>
          <div className="mt-3">
            <LocationOrderPanel
              embedded
              locations={locations}
              onSaved={(items) => setLocations(items)}
            />
          </div>
        </section>

        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="font-medium text-blue-900">Nazwy typów lokalizacji</h2>
          <p className="mt-1 text-sm text-blue-700">
            Etykiety w aplikacji LOC i picklist (np. „Wieszak w sklepie”, „Wystawa”). Klucze techniczne pozostaja bez zmian.
          </p>
          <form
            className="mt-3 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                setTypeLabelsBusy(true);
                setTypeLabelsMessage(null);
                try {
                  const response = await fetch("/api/admin/location-type-labels", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ labels: typeLabels }),
                  });
                  const data = await response.json().catch(() => ({}));
                  if (!response.ok) throw new Error(data.error ?? "Nie udalo sie zapisac");
                  setTypeLabels(data.labels ?? typeLabels);
                  setTypeLabelsMessage("Zapisano nazwy typow.");
                } catch (error) {
                  setTypeLabelsMessage(error instanceof Error ? error.message : "Blad zapisu");
                } finally {
                  setTypeLabelsBusy(false);
                }
              })();
            }}
          >
            {locationTypeOptions.map((type) => (
              <label key={type} className="block text-sm text-blue-900">
                <span className="font-mono text-xs text-blue-600">{type}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-blue-200 p-2"
                  value={typeLabels[type] ?? ""}
                  onChange={(e) => setTypeLabels((prev) => ({ ...prev, [type]: e.target.value }))}
                />
              </label>
            ))}
            {typeLabelsMessage ? <p className="text-sm text-blue-800">{typeLabelsMessage}</p> : null}
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-700 p-3 font-medium text-white disabled:opacity-60"
              disabled={typeLabelsBusy}
            >
              {typeLabelsBusy ? "Zapisywanie..." : "Zapisz nazwy typow"}
            </button>
          </form>
        </section>

        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="font-medium text-blue-900">Istniejace lokalizacje</h2>
          <div className="mt-3 max-h-[28rem] overflow-y-auto rounded-lg border border-blue-100 text-sm">
            {locations.length === 0 ? (
              <p className="p-3 text-blue-700">Brak zdefiniowanych lokalizacji.</p>
            ) : (
              <ul className="divide-y divide-blue-100">
                {locations.map((location) => {
                  const qty = qtyOnLocation(location.code);
                  const empty = qty === 0;
                  const editing = editingCode === location.code;
                  return (
                    <li key={location.code} className="px-3 py-3">
                      {editing ? (
                        <div className="space-y-2">
                          <p className="font-semibold text-blue-900">{location.code}</p>
                          <input
                            className="w-full rounded-lg border border-blue-200 p-2"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                          <select
                            className="w-full rounded-lg border border-blue-200 p-2"
                            value={editZone}
                            onChange={(e) => {
                              const zone = e.target.value as Zone;
                              setEditZone(zone);
                              setEditType(defaultLocationTypeForZone(zone));
                            }}
                          >
                            <option value="SKLEP">{zoneLabels.SKLEP}</option>
                            <option value="ZAPLECZE">{zoneLabels.ZAPLECZE}</option>
                          </select>
                          <select
                            className="w-full rounded-lg border border-blue-200 p-2"
                            value={editType}
                            onChange={(e) => setEditType(e.target.value as LocationType)}
                          >
                            {locationTypeOptions.map((type) => (
                              <option key={type} value={type}>
                                {formatLocationType(type, typeLabels)}
                              </option>
                            ))}
                          </select>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="flex-1 rounded-lg bg-blue-700 px-2 py-2 text-xs font-medium text-white"
                              onClick={() => void saveEdit(location.code)}
                            >
                              Zapisz
                            </button>
                            <button
                              type="button"
                              className="flex-1 rounded-lg border border-blue-200 px-2 py-2 text-xs font-medium text-blue-900"
                              onClick={cancelEdit}
                            >
                              Anuluj
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-semibold text-blue-900">{location.code}</span>
                            <span className="text-blue-700"> — {location.name}</span>
                            <p className="mt-0.5 text-xs text-blue-600">
                              {zoneLabels[location.parentZone]} · {formatLocationType(location.locationType, typeLabels)} · stan:{" "}
                              {qty}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded-lg border border-blue-200 px-2 py-1 text-xs font-medium text-blue-800"
                              onClick={() => startEdit(location)}
                            >
                              Edytuj
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={!empty}
                              title={empty ? "Usun pusta lokalizacje" : "Tylko pusta lokalizacja moze zostac usunieta"}
                              onClick={() => void deleteLocationByCode(location.code)}
                            >
                              Usun
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
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
              onChange={(e) => {
                const zone = e.target.value as Zone;
                setNewLocationZone(zone);
                setNewLocationType(defaultLocationTypeForZone(zone));
              }}
            >
              <option value="SKLEP">{zoneLabels.SKLEP}</option>
              <option value="ZAPLECZE">{zoneLabels.ZAPLECZE}</option>
            </select>
            <select
              className="w-full rounded-lg border border-blue-200 p-2"
              value={newLocationType}
              onChange={(e) => setNewLocationType(e.target.value as LocationType)}
            >
              {locationTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {formatLocationType(type)}
                </option>
              ))}
            </select>
            <p className="text-xs text-blue-600">
              Strefa (SKLEP/ZAPLECZE) decyduje o priorytecie w picklist. Typ to opis miejsca — opcjonalny, do porzadku.
            </p>
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
