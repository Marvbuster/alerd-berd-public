import { currentUser } from "@/lib/auth";
import { loadDependencyNotifications } from "@/lib/dependency-notifications";

// Lesender Endpunkt für den Nachrichten-Hub im Header, den der Client pollt.
// Gescopt auf den eingeloggten User, ohne Caching.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ items: await loadDependencyNotifications(user.id) }, { headers: { "cache-control": "no-store" } });
}
