"use client";

import { FormEvent, useEffect, useState } from "react";

export default function SettingsPage() {
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/me").then((res) => {
      if (!res.ok) window.location.replace("/login");
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (password.length < 8) {
      setError("Haslo musi miec minimum 8 znakow.");
      return;
    }
    if (password !== repeatPassword) {
      setError("Hasla musza byc identyczne.");
      return;
    }
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "Nie udalo sie zmienic hasla");
      return;
    }
    setPassword("");
    setRepeatPassword("");
    setMessage("Haslo zmienione.");
  }

  return (
    <main className="min-h-screen bg-blue-50 px-3 py-4 text-blue-950">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow">
        <h1 className="text-xl font-semibold text-blue-900">Ustawienia konta</h1>
        <p className="mt-2 text-sm text-blue-700">Zmiana hasla operatora.</p>
        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <input
            type="password"
            className="w-full rounded-lg border border-blue-200 p-3"
            placeholder="Nowe haslo"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            type="password"
            className="w-full rounded-lg border border-blue-200 p-3"
            placeholder="Powtorz haslo"
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
          <button className="w-full rounded-lg bg-blue-700 p-3 font-medium text-white" type="submit">
            Zmien haslo
          </button>
        </form>
      </div>
    </main>
  );
}
