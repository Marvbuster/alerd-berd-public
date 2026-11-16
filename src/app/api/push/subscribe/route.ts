import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { messageCode, translate } from "@/i18n/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Speichert eine Web-Push-Subscription als AlertChannel (kind WEB_PUSH) des
// eingeloggten Users, dedupt über den Endpoint (innerhalb des Users).
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  if (!sub?.endpoint) {
    return NextResponse.json({ error: messageCode("validation.invalidSubscription") }, { status: 400 });
  }

  const existing = await prisma.alertChannel.findMany({ where: { kind: "WEB_PUSH", ownerId: user.id } });
  if (existing.some((c) => (c.config as { endpoint?: string } | null)?.endpoint === sub.endpoint)) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  await prisma.alertChannel.create({
    data: {
      kind: "WEB_PUSH",
      label: (body?.label as string) || translate(await getLocale(), "actions.pushLabel", { device: messageCode("common.device") }),
      config: sub,
      ownerId: user.id,
    },
  });
  return NextResponse.json({ ok: true });
}
