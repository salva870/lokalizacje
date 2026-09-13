import { SignJWT, jwtVerify } from "jose";
import { getAuthSecret } from "@/lib/authSecret";
import { getSessionGeneration } from "@/lib/sessionGeneration";

export const ACCESS_COOKIE = "loc_access";
export const REFRESH_COOKIE = "loc_refresh";
export const LEGACY_SESSION_COOKIE = "loc_session";

export const ACCESS_MAX_AGE_SEC = 30 * 60;
export const REFRESH_MAX_AGE_SEC = 60 * 60 * 24 * 7;

export type SessionPayload = {
  sub: string;
  login: string;
  role: "ADMIN" | "OPERATOR";
};

export type SessionCookieJar = {
  set: (
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: "lax";
      path: string;
      maxAge: number;
    },
  ) => unknown;
  delete: (name: string) => unknown;
};

export function sessionCookieOptions(maxAge: number, secure: boolean) {
  return {
    httpOnly: true as const,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function signAccessToken(session: SessionPayload): Promise<string> {
  const gen = await getSessionGeneration();
  return new SignJWT({ login: session.login, role: session.role, typ: "access", gen })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_MAX_AGE_SEC}s`)
    .sign(getAuthSecret());
}

export async function signRefreshToken(session: SessionPayload): Promise<string> {
  const gen = await getSessionGeneration();
  return new SignJWT({ login: session.login, role: session.role, typ: "refresh", gen })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.sub)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_MAX_AGE_SEC}s`)
    .sign(getAuthSecret());
}

function parseSessionPayload(payload: Record<string, unknown>): SessionPayload | null {
  if (!payload.sub || typeof payload.login !== "string" || typeof payload.role !== "string") {
    return null;
  }
  if (payload.role !== "ADMIN" && payload.role !== "OPERATOR") {
    return null;
  }
  return {
    sub: String(payload.sub),
    login: payload.login,
    role: payload.role,
  };
}

export async function verifySessionToken(
  token: string | undefined,
  expectedTyp: "access" | "refresh",
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (payload.typ !== expectedTyp) return null;
    const gen = typeof payload.gen === "number" ? payload.gen : Number(payload.gen);
    const current = await getSessionGeneration();
    if (!Number.isInteger(gen) || gen !== current) return null;
    return parseSessionPayload(payload as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function writeSessionCookies(jar: SessionCookieJar, session: SessionPayload, secure: boolean) {
  const [access, refresh] = await Promise.all([signAccessToken(session), signRefreshToken(session)]);
  jar.set(ACCESS_COOKIE, access, sessionCookieOptions(ACCESS_MAX_AGE_SEC, secure));
  jar.set(REFRESH_COOKIE, refresh, sessionCookieOptions(REFRESH_MAX_AGE_SEC, secure));
  jar.delete(LEGACY_SESSION_COOKIE);
}

export function clearSessionCookies(jar: SessionCookieJar) {
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  jar.delete(LEGACY_SESSION_COOKIE);
}

export function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/robots.txt") return true;
  if (pathname === "/login") return true;
  if (pathname === "/api/auth/login" || pathname === "/api/auth/logout") return true;
  if (pathname === "/api/system/readiness") return true;
  if (pathname.startsWith("/api/integration/")) return true;
  return false;
}

export function safeInternalPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (value.startsWith("/login") || value.startsWith("/api/")) return "/";
  return value;
}
