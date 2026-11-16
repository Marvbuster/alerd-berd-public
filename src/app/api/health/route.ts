import { NextResponse } from "next/server";

// Coolify-Healthcheck — bewusst ohne DB-Zugriff, damit die App während
// "prisma migrate deploy" nicht als unhealthy durchgestartet wird.
export async function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
