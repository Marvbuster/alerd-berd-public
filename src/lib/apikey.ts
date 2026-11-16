import { randomBytes } from "node:crypto";

// Self-Service-API-Key eines Users. Klartext `alrd_<base64url(24)>` wird nur
// einmal angezeigt; gespeichert ist sha256hex(key) (siehe @/lib/auth). `keyLabel`
// liefert das wiedererkennbare Präfix für die Liste (ohne den ganzen Key).

export const API_KEY_PREFIX = "alrd_";

export function genApiKey(): string {
  return API_KEY_PREFIX + randomBytes(24).toString("base64url");
}

export function keyLabel(key: string): string {
  return key.slice(0, 12) + "…";
}
