import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Öffentlicher VAPID-Key für den Client (PushManager.subscribe). null = nicht konfiguriert.
export async function GET() {
  return NextResponse.json({ key: process.env.VAPID_PUBLIC_KEY || null });
}
