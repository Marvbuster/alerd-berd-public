import { loadMonitorNode } from "@/lib/monitor-view";
import { currentUser } from "@/lib/auth";

// Server-Sent-Events-Stream für die Live-Aktualisierung der Detail-/Modal-Ansicht.
// EventSource sendet die Session-Cookies mit; auf den eingeloggten User gescoped
// (fremder Monitor → wie „gone"). Pusht den VizNode bei Änderung (neuer Check).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_MS = 8000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
          const node = await loadMonitorNode(id, ownerId);
          if (!node) {
            safeEnqueue(`event: gone\ndata: {}\n\n`);
            return;
          }
          // Signatur der veränderlichen Felder — nur bei Änderung neu pushen.
          const sig = `${node.lastCheckedMs}|${node.status}|${node.history.length}|${node.components.length}|${JSON.stringify(node.coolifyApps)}`;
          if (sig !== lastSig) {
            lastSig = sig;
            safeEnqueue(`data: ${JSON.stringify(node)}\n\n`);
          } else {
            safeEnqueue(`: ping\n\n`); // Heartbeat hält die Verbindung offen
          }
        } catch {
          // Transienter DB-Fehler — nächster Tick versucht es erneut.
        }
      };

      await tick(); // sofortiger Erst-Push
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
      "X-Accel-Buffering": "no", // Proxy-Buffering (nginx/Traefik) aus
    },
  });
}
