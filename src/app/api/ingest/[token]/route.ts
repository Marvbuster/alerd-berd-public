import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyResult, type Probe } from "@/lib/check";
import { mapCoolifyEvent, type CoolifyEvent } from "@/lib/coolify-ingest";

// Push-Ingest für Quellen, die sich nicht pollen lassen (z. B. der Coolify-Server).
// Die Quelle postet ihre Events hierher; das Token im Pfad IST die Auth (Coolify
// kann keinen Secret-Header setzen). Wir docken an denselben applyResult-Kern an
// wie der Poll-Pfad → Check-Historie, Live-Status, Incident + Alarm identisch.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Coolify liefert bei Fehlern erneut aus → gegen Duplikate deduplizieren.
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const monitor = await prisma.monitor.findFirst({
    where: { ingestToken: token, kind: "PUSH", enabled: true },
  });
  if (!monitor) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: CoolifyEvent;
  try {
    body = (await req.json()) as CoolifyEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body.event !== "string" || !body.event) {
    return NextResponse.json({ error: "missing event" }, { status: 400 });
  }

  const { status, summary, eventKey } = mapCoolifyEvent(body);

  // App-/Dienst-Events ignorieren: kein Check, keine Statusänderung — aber 200,
  // sonst wertet Coolify es als Fehlzustellung.
  if (status === null) {
    return NextResponse.json({ ok: true, ignored: body.event }, { status: 200 });
  }

  // Idempotenz: identisches Event innerhalb des Fensters → stillschweigend ok.
  const last = await prisma.check.findFirst({
    where: { monitorId: monitor.id },
    orderBy: { checkedAt: "desc" },
    select: { payload: true, checkedAt: true },
  });
  if (last?.payload && Date.now() - last.checkedAt.getTime() < DEDUPE_WINDOW_MS) {
    const lastKey = mapCoolifyEvent(last.payload as unknown as CoolifyEvent).eventKey;
    if (lastKey === eventKey) {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
  }

  const probe: Probe = {
    status,
    responseMs: null,
    statusCode: null,
    error: status === "DOWN" ? summary : null,
    payload: body,
  };
  const result = await applyResult(monitor, probe);

  return NextResponse.json({ ok: true, event: body.event, status: result.status }, { status: 200 });
}
