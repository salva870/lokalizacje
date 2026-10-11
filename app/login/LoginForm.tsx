"use client";

import { FormEvent, useState } from "react";
import { safeInternalPath } from "@/lib/sessionToken";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const login = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    setError(null);
    setLoading(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, password }),
    });
    setLoading(false);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 429) {
        setError(data.error ?? "Zbyt wiele prob. Sprobuj pozniej lub z urzadzenia, z ktorego logowales sie wczesniej.");
      } else if (response.status === 503) {
        setError(data.error ?? "Serwer jest chwilowo nieskonfigurowany. Skontaktuj sie z administratorem.");
      } else {
        setError(data.error ?? "Nie udalo sie zalogowac");
      }
      return;
    }
    const next = safeInternalPath(new URLSearchParams(window.location.search).get("next"));
    window.location.replace(next);
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-950 to-blue-800 px-4 py-8">
      <div className="mx-auto mt-14 max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h1 className="text-2xl font-semibold text-blue-900">Lokalizacje Towaru</h1>
        <p className="mt-2 text-sm text-blue-700">Zaloguj sie, aby zarzadzac ruchem towaru.</p>
        <form className="mt-6 space-y-3" method="post" action="/api/auth/login" autoComplete="on" onSubmit={onSubmit}>
          <label className="block" htmlFor="username">
            <span className="sr-only">Login</span>
            <input
              id="username"
              className="w-full rounded-lg border border-blue-200 p-3 text-blue-950 outline-none focus:border-blue-500"
              placeholder="Login"
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              required
            />
          </label>
          <label className="block" htmlFor="password">
            <span className="sr-only">Haslo</span>
            <input
              id="password"
              className="w-full rounded-lg border border-blue-200 p-3 text-blue-950 outline-none focus:border-blue-500"
              placeholder="Haslo"
              type="password"
              name="password"
              autoComplete="current-password"
              enterKeyHint="go"
              required
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-700 px-4 py-3 font-medium text-white hover:bg-blue-800 disabled:opacity-70"
          >
            {loading ? "Logowanie..." : "Zaloguj"}
          </button>
        </form>
      </div>
    </main>
  );
}
