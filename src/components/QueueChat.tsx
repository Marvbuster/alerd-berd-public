"use client";

import { useRouter } from "next/navigation";
import { DependencyAssistant } from "./DependencyAssistant";

// Update-Chat direkt in der Warteschlange: dasselbe Fenster wie unter Dienste,
// geöffnet über ?chat=<appId>. Schließen führt zurück zur reinen Warteschlange.
export function QueueChat(props: Omit<React.ComponentProps<typeof DependencyAssistant>, "onClose">) {
  const router = useRouter();
  return <DependencyAssistant {...props} onClose={() => router.replace("/queue", { scroll: false })} />;
}
