import { currentUser } from "@/lib/auth";
import { loadQueue } from "@/lib/dependency-queue-load";
import { getLocale } from "next-intl/server";

// Lesender Endpunkt für die Warteschlangen-Seite, die der Client pollt.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await loadQueue(user.id, undefined, await getLocale()), { headers: { "cache-control": "no-store" } });
}
