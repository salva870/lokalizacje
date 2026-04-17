import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { findUserByLogin } from "@/lib/data";

const COOKIE_NAME = "loc_session";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "change-this-in-env");

type SessionPayload = {
  sub: string;
  login: string;
  role: "ADMIN" | "OPERATOR";
};

export async function signIn(login: string, password: string) {
  const user = findUserByLogin(login);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  const token = await new SignJWT({ login: user.login, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("3d")
    .sign(secret);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 3,
  });

  return { id: user.id, login: user.login, role: user.role };
}

export async function signOut() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub || typeof payload.login !== "string" || typeof payload.role !== "string") {
      return null;
    }
    return { sub: payload.sub, login: payload.login, role: payload.role as SessionPayload["role"] };
  } catch {
    return null;
  }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

export function requireRole(role: SessionPayload["role"], allowed: SessionPayload["role"][]) {
  if (!allowed.includes(role)) {
    throw new Error("Forbidden");
  }
}
