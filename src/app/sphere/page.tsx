import { SphereView } from "@/components/sphere/SphereView";
import { loadMonitorNodes } from "@/lib/monitor-view";
import { requireUser } from "@/lib/auth";

// DB-getrieben — nie zur Build-Zeit rendern (Docker-Build hat nur eine Dummy-URL)
export const dynamic = "force-dynamic";

export default async function SpherePage() {
  const user = await requireUser();
  const nodes = await loadMonitorNodes(user.id);
  return <SphereView nodes={nodes} canEdit={true} />;
}
