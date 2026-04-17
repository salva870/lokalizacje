"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("ChangeMe123!");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, password }),
    });
    setLoading(false);
    if (!response.ok) {
      const data = await response.json();
      setError(data.error ?? "Nie udalo sie zalogowac");
      return;
    }
    router.push("/");
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-950 to-blue-800 px-4 py-8">
      <div className="mx-auto mt-14 max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h1 className="text-2xl font-semibold text-blue-900">Lokalizacje Towaru</h1>
        <p className="mt-2 text-sm text-blue-700">Zaloguj sie, aby zarzadzac ruchem towaru.</p>
        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <input
            className="w-full rounded-lg border border-blue-200 p-3 text-blue-950 outline-none focus:border-blue-500"
            placeholder="Login"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
          <input
            type="password"
            className="w-full rounded-lg border border-blue-200 p-3 text-blue-950 outline-none focus:border-blue-500"
            placeholder="Haslo"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
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
