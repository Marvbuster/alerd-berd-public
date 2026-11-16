import { cookies } from "next/headers";
import { signSession, verifySession, SESSION_COOKIE } from "./jwt";

// Cookie-IO fürs Session-JWT. getSession() prüft nur Signatur+Expiry (kein
// DB-Roundtrip) — die User-Daten lädt currentUser() in auth.ts.

export { SESSION_COOKIE };
const MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage

export async function startSession(userId: string): Promise<void> {
  const token = await signSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function getSession(): Promise<{ userId: string } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
