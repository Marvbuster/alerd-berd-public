import { loadMonitorNodes } from "@/lib/monitor-view";
import { alertingConfigured } from "@/lib/alert";
import { requireUser } from "@/lib/auth";
import { RegistryLive } from "@/components/RegistryLive";

// DB-getrieben — nie zur Build-Zeit rendern (Docker-Build hat nur eine Dummy-URL)
export const dynamic = "force-dynamic";

export default async function Home() {
  // Multi-Tenant: jeder sieht nur seine eigenen Monitore. RegistryLive seedet
  // damit und aktualisiert sich danach per SSE. Eingeloggt = Owner = darf bearbeiten.
  const user = await requireUser();
  const nodes = await loadMonitorNodes(user.id);
  const showAlerting = alertingConfigured();

  return (
    <main className="mx-auto max-w-[1480px] px-4 py-8 sm:px-7">
      <RegistryLive initial={nodes} showAlerting={showAlerting} canEdit={true} />
    </main>
  );
}
