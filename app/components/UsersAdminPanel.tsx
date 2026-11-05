"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type OperatorRow = { id: string; login: string; role: string };

type UsersAdminPanelProps = {
  /** Mniejsze odstępy w modalu na ekranie głównym. */
  compact?: boolean;
};

export function UsersAdminPanel({ compact = false }: UsersAdminPanelProps) {
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newLogin, setNewLogin] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"ADMIN" | "OPERATOR">("OPERATOR");
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const [resetOperatorId, setResetOperatorId] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const [roleOperatorId, setRoleOperatorId] = useState("");
  const [roleValue, setRoleValue] = useState<"ADMIN" | "OPERATOR">("OPERATOR");
  const [roleMessage, setRoleMessage] = useState<string | null>(null);

  const loadOperators = useCallback(async () => {
    setLoadError(null);
    const response = await fetch("/api/admin/operators");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setLoadError(typeof data.error === "string" ? data.error : "Nie udalo sie pobrac listy uzytkownikow.");
      setOperators([]);
      return;
    }
    const data = await response.json();
    setOperators(data.items ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadOperators();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOperators]);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setCreateMessage(null);
    const response = await fetch("/api/admin/operators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: newLogin.trim(),
        password: newPassword,
        role: newRole,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setCreateMessage(data.error ?? "Nie udalo sie utworzyc uzytkownika.");
      return;
    }
    setCreateMessage("Uzytkownik utworzony.");
    setNewLogin("");
    setNewPassword("");
    await loadOperators();
  }

  async function submitPasswordReset(event: FormEvent) {
    event.preventDefault();
    setResetMessage(null);
    if (!resetOperatorId) {
      setResetMessage("Wybierz uzytkownika.");
      return;
    }
    const response = await fetch(`/api/admin/operators/${encodeURIComponent(resetOperatorId)}/password`, {
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

  async function changeRole(event: FormEvent) {
    event.preventDefault();
    setRoleMessage(null);
    if (!roleOperatorId) {
      setRoleMessage("Wybierz uzytkownika.");
      return;
    }
    const target = operators.find((operator) => operator.id === roleOperatorId);
    const roleLabel = roleValue === "ADMIN" ? "administratora" : "operatora";
    if (!window.confirm(`Nadac uzytkownikowi ${target?.login ?? ""} uprawnienia: ${roleLabel}?`)) {
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
    setRoleMessage(`Uprawnienia: ${roleValue === "ADMIN" ? "administrator" : "operator"}.`);
    await loadOperators();
  }

  const sectionClass = compact ? "space-y-3" : "space-y-4";

  return (
    <div id="users" className={sectionClass}>
      <div>
        <h2 className={`font-semibold text-blue-900 ${compact ? "text-base" : "text-lg"}`}>Zarzadzanie uzytkownikami</h2>
        <p className="mt-1 text-sm text-blue-700">
          Konta do logowania w LOC. Haslo min. 8 znakow. Login: litery, cyfry, kropka, myslnik, podkreslnik.
        </p>
      </div>

      {loading ? <p className="text-sm text-blue-700">Ladowanie listy…</p> : null}
      {loadError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</p> : null}

      <div className={`overflow-y-auto rounded-xl border border-blue-100 bg-blue-50/40 ${compact ? "max-h-40" : "max-h-52"}`}>
        {operators.length === 0 && !loading ? (
          <p className="p-3 text-sm text-blue-700">Brak uzytkownikow.</p>
        ) : (
          <ul className="divide-y divide-blue-100 text-sm">
            {operators.map((operator) => (
              <li key={operator.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span className="font-mono font-semibold text-blue-950">{operator.login}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-blue-800 ring-1 ring-blue-200">
                  {operator.role === "ADMIN" ? "Administrator" : "Operator"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="space-y-2 rounded-xl border border-blue-100 bg-white p-3" onSubmit={createUser}>
        <h3 className="text-sm font-medium text-blue-900">Nowy uzytkownik</h3>
        <input
          className="w-full rounded-lg border border-blue-200 p-2.5 text-sm"
          placeholder="Login (np. iga)"
          autoComplete="off"
          value={newLogin}
          onChange={(e) => setNewLogin(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-blue-200 p-2.5 text-sm"
          type="password"
          placeholder="Haslo startowe (min. 8 znakow)"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <select
          className="w-full rounded-lg border border-blue-200 p-2.5 text-sm"
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as "ADMIN" | "OPERATOR")}
        >
          <option value="OPERATOR">Operator (skanowanie magazynu)</option>
          <option value="ADMIN">Administrator</option>
        </select>
        {createMessage ? <p className="text-sm text-blue-800">{createMessage}</p> : null}
        <button className="w-full rounded-xl bg-blue-700 py-2.5 text-sm font-semibold text-white" type="submit">
          Dodaj uzytkownika
        </button>
      </form>

      <form className="space-y-2 rounded-xl border border-blue-100 bg-white p-3" onSubmit={submitPasswordReset}>
        <h3 className="text-sm font-medium text-blue-900">Zmiana hasla</h3>
        <select
          className="w-full rounded-lg border border-blue-200 p-2.5 text-sm"
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
          className="w-full rounded-lg border border-blue-200 p-2.5 text-sm"
          type="password"
          placeholder="Nowe haslo"
          autoComplete="new-password"
          value={resetPassword}
          onChange={(e) => setResetPassword(e.target.value)}
        />
        {resetMessage ? <p className="text-sm text-blue-800">{resetMessage}</p> : null}
        <button
          className="w-full rounded-xl border border-blue-300 bg-blue-50 py-2.5 text-sm font-semibold text-blue-900"
          type="submit"
        >
          Ustaw nowe haslo
        </button>
      </form>

      <form className="space-y-2 rounded-xl border border-blue-100 bg-white p-3" onSubmit={changeRole}>
        <h3 className="text-sm font-medium text-blue-900">Uprawnienia</h3>
        <p className="text-xs text-blue-600">Nie mozna odebrac roli ostatniemu administratorowi.</p>
        <select
          className="w-full rounded-lg border border-blue-200 p-2.5 text-sm"
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
          className="w-full rounded-lg border border-blue-200 p-2.5 text-sm"
          value={roleValue}
          onChange={(e) => setRoleValue(e.target.value as "ADMIN" | "OPERATOR")}
        >
          <option value="OPERATOR">Operator</option>
          <option value="ADMIN">Administrator</option>
        </select>
        {roleMessage ? <p className="text-sm text-blue-800">{roleMessage}</p> : null}
        <button
          className="w-full rounded-xl border border-blue-300 bg-white py-2.5 text-sm font-semibold text-blue-900"
          type="submit"
        >
          Zapisz uprawnienia
        </button>
      </form>
    </div>
  );
}
