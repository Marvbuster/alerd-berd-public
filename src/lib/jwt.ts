import { SignJWT, jwtVerify } from "jose";

// Reine JWT-Signatur/-Prüfung (jose, HS256) — KEINE next/headers-Importe, damit
// das auch im Proxy (Edge-tauglich) läuft. Cookie-IO liegt in session.ts.
// Secret: AUTH_SECRET, ≥32 Zeichen, Hard-Fail (lieber kaputt als unsicher).

export const SESSION_COOKIE = "alerd_session";
const SESSION_TTL = "30d";

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen).");
  }
  return new TextEncoder().encode(s);
}

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const userId = payload.userId;
    return typeof userId === "string" && userId ? { userId } : null;
  } catch {
    return null;
  }
}
