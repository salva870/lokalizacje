import { headers } from "next/headers";

export function isSecureFromHeaders(h: { get: (name: string) => string | null }): boolean {
  const forced = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (forced === "true" || forced === "1") return true;
  if (forced === "false" || forced === "0") return false;

  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return true;
  if (proto === "http") return false;

  return process.env.NODE_ENV === "production";
}

/**
 * Czy ustawić flagę Secure na ciasteczkach sesji.
 * Najpierw X-Forwarded-Proto (nginx), potem produkcja = Secure.
 */
export async function sessionCookieSecure(): Promise<boolean> {
  return isSecureFromHeaders(await headers());
}
