import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { getSession } from "./session";
import type { Role } from "@prisma/client";

// Zugangsschutz (Multi-User). Session = JWT-Cookie (session.ts), die autoritative
// User-Prüfung läuft hier gegen die DB. sha256hex dient weiter zum Hashen von
// Tokens mit hoher Entropie (ApiKey, ingestToken) — NICHT für Passwörter (bcrypt).

export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type CurrentUser = { id: string; email: string; name: string | null; role: Role };

// Liefert den eingeloggten, AKTIVEN User oder null. Deaktivierte/gelöschte User
// zählen als abgemeldet (Cookie kann noch gültig signiert sein → DB entscheidet).
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, role: true, active: true },
  });
  if (!user || !user.active) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

// Für Pages UND Server Actions: ohne Login → /login. Gibt den User zurück.
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

// Nur ADMIN. Nicht eingeloggt → /login; eingeloggt aber kein Admin → zurück auf
// die Startseite (kein Error-Boundary, saubere UX in Page + Action).
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");
  return user;
}
