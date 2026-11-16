import { loadMonitorNodes } from "@/lib/monitor-view";
import { currentUser } from "@/lib/auth";

// SSE-Stream über die EIGENEN Monitore — für die Live-Registry und die Sphere.
// EventSource sendet die Session-Cookies mit; wir scopen auf den eingeloggten
// User (kein Cross-Tenant-Leak).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_MS = 8000;

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const ownerId = user.id;

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastSig = "";

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const tick = async () => {
        try {
          const nodes = await loadMonitorNodes(ownerId);
          const sig = nodes
            .map((n) => `${n.id}:${n.lastCheckedMs}:${n.status}:${n.history.length}:${n.enabled ? 1 : 0}:${JSON.stringify(n.coolifyApps)}`)
            .join("|");
          if (sig !== lastSig) {
            lastSig = sig;
            safeEnqueue(`data: ${JSON.stringify(nodes)}\n\n`);
          } else {
            safeEnqueue(`: ping\n\n`);
          }
        } catch {
          // transienter DB-Fehler — nächster Tick versucht es erneut
        }
      };

      await tick();
      timer = setInterval(tick, POLL_MS);

      req.signal.addEventListener("abort", () => {
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* schon geschlossen */
        }
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
