"use client";

import { useRouter } from "next/navigation";
import { DependencyAssistant } from "./DependencyAssistant";

// Update-Chat direkt in der Warteschlange oder im Sammel-Update: dasselbe Fenster
// wie unter Dienste, geöffnet über ?chat=<appId>. Schließen führt zurück zur Seite.
export function QueueChat({ basePath = "/queue", ...props }: Omit<React.ComponentProps<typeof DependencyAssistant>, "onClose"> & { basePath?: string }) {
  const router = useRouter();
  return <DependencyAssistant {...props} onClose={() => router.replace(basePath, { scroll: false })} />;
}
