"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Me = { login: string; role: "ADMIN" | "OPERATOR" };

export default function SettingsPage() {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      if (!cancelled) {
        setUser(data.user ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main className="min-h-screen bg-blue-50 px-3 py-4 text-blue-950">
      <div className="mx-auto max-w-lg space-y-4">
        <header className="rounded-xl bg-white p-4 shadow">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-semibold text-blue-900">Konto</h1>
            <nav className="flex flex-wrap gap-2 text-sm">
              <Link className="rounded-lg border border-blue-200 px-3 py-1.5 text-blue-800 hover:bg-blue-50" href="/">
                Panel skanowania
              </Link>
              {user?.role === "ADMIN" ? (
                <Link className="rounded-lg border border-blue-200 px-3 py-1.5 text-blue-800 hover:bg-blue-50" href="/admin">
                  Administrator
                </Link>
              ) : null}
            </nav>
          </div>
          <p className="mt-2 text-sm text-blue-700">
            Informacje o zalogowanym uzytkowniku. Zmiana hasla w kolejnej wersji (Supabase Auth lub panel administratora).
          </p>
        </header>

        <section className="rounded-xl bg-white p-4 shadow">
          {loading ? (
            <p className="text-sm text-blue-700">Wczytywanie...</p>
          ) : user ? (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-medium text-blue-800">Login</dt>
                <dd className="mt-1 text-blue-950">{user.login}</dd>
              </div>
              <div>
                <dt className="font-medium text-blue-800">Rola</dt>
                <dd className="mt-1 text-blue-950">
                  {user.role === "ADMIN" ? "Administrator" : "Operator"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-red-600">Brak danych sesji.</p>
          )}
        </section>

        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white"
            onClick={logout}
          >
            Wyloguj
          </button>
        </div>
      </div>
    </main>
  );
}
