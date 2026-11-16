import "server-only";
import { currentUser } from "@/lib/auth";

// Übergangs-Shim: isAdmin() lebt weiter (Nav zeigt den Admin-Bereich), liest aber
// jetzt die echte Rolle des eingeloggten Users. requireUser/requireAdmin kommen
// direkt aus @/lib/auth (dort die autoritativen Guards).
export { requireUser, requireAdmin } from "@/lib/auth";

export async function isAdmin(): Promise<boolean> {
  return (await currentUser())?.role === "ADMIN";
}
