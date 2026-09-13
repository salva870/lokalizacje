import { jwtVerify, SignJWT } from "jose";
import { getAuthSecret } from "@/lib/authSecret";

const TRUST_COOKIE = "loc_device_trust";

type IpState = { failures: number; lockUntil: number };

const ipState = new Map<string, IpState>();

const MAX_FAILURES = 10;
const LOCK_MS = 30 * 60 * 1000;

export function clientIpFromRequest(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return "unknown";
}

export async function hasValidDeviceTrustCookie(cookieHeader: string | null): Promise<boolean> {
  if (!cookieHeader) return false;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${TRUST_COOKIE}=([^;]+)`));
  const raw = match?.[1];
  if (!raw) return false;
  try {
    await jwtVerify(decodeURIComponent(raw), getAuthSecret());
    return true;
  } catch {
    return false;
  }
}

export function isLoginIpLocked(ip: string, trustedDevice: boolean): boolean {
  if (trustedDevice) return false;
  const s = ipState.get(ip);
  if (!s || s.lockUntil <= 0) return false;
  const now = Date.now();
  if (now >= s.lockUntil) {
    ipState.delete(ip);
    return false;
  }
  return true;
}

export function recordLoginFailure(ip: string, trustedDevice: boolean): void {
  if (trustedDevice) return;
  const now = Date.now();
  const prev = ipState.get(ip) ?? { failures: 0, lockUntil: 0 };
  if (prev.lockUntil > 0 && now < prev.lockUntil) return;
  if (prev.lockUntil > 0 && now >= prev.lockUntil) {
    ipState.delete(ip);
  }
  const cur = ipState.get(ip) ?? { failures: 0, lockUntil: 0 };
  const nextFailures = cur.failures + 1;
  if (nextFailures >= MAX_FAILURES) {
    ipState.set(ip, { failures: 0, lockUntil: now + LOCK_MS });
  } else {
    ipState.set(ip, { failures: nextFailures, lockUntil: 0 });
  }
}

export function clearLoginFailures(ip: string): void {
  ipState.delete(ip);
}

export async function createDeviceTrustCookieValue(): Promise<string> {
  const token = await new SignJWT({ typ: "device_trust", v: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("180d")
    .sign(getAuthSecret());
  return token;
}

export function trustCookieName() {
  return TRUST_COOKIE;
}

export function trustCookieOptions(maxAgeSec: number, secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}
