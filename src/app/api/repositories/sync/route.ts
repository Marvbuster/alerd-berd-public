import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { scanDueRepositories } from "@/lib/repository-watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const secret = process.env.RUN_CHECKS_SECRET;
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = await scanDueRepositories();
  return NextResponse.json({ scanned: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
}
