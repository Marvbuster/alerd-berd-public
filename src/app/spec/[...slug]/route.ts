import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { sha256hex, currentUser } from "@/lib/auth";

// Veröffentlichter Health-Contract (Schema, Beispiel, Guide) — aber NICHT offen.
// Muster wie der APO AI Proxy: llms.txt bleibt offen und zeigt hierher, die
// Guides selbst liegen hinter einem Token (kein offener Spec-Leak). Zugang:
//  1. persönlicher API-Key `Authorization: Bearer alrd_…` (self-service, pro User,
//     widerrufbar) — der normale Weg für Fremddienste/Agents,
//  2. eingeloggte Session (Betreiber klickt im Browser durch),
//  3. globaler SPEC_ACCESS_TOKEN aus der Env (optionaler Fallback/Legacy).
// Dateien liegen als editierbare Quelle in spec/ (nicht in public/), damit kein
// statisches Asset den Schutz umgeht.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allowlist: nur diese Dateinamen werden ausgeliefert (kein Pfad aus dem Request
// landet je in readFile → kein Path-Traversal).
const FILES: Record<string, { file: string; type: string }> = {
  "alerd-health.schema.json": { file: "alerd-health.schema.json", type: "application/json; charset=utf-8" },
  "example-health.json": { file: "example-health.json", type: "application/json; charset=utf-8" },
  "implementing-health.md": { file: "implementing-health.md", type: "text/markdown; charset=utf-8" },
};

function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return m ? m[1] : null;
}

function envTokenOk(token: string): boolean {
  const env = process.env.SPEC_ACCESS_TOKEN;
  if (!env) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(env);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Gültiger, nicht widerrufener API-Key? Setzt lastUsedAt (best effort).
async function apiKeyOk(token: string): Promise<boolean> {
  const keyHash = await sha256hex(token);
  const key = await prisma.apiKey.findUnique({ where: { keyHash }, select: { id: true, revokedAt: true } });
  if (!key || key.revokedAt) return false;
  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return true;
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const token = bearer(req.headers.get("authorization"));
  const authed =
    (token ? envTokenOk(token) || (await apiKeyOk(token)) : false) || (await currentUser()) != null;

  if (!authed) {
    return new NextResponse("unauthorized", {
      status: 401,
      headers: { "www-authenticate": 'Bearer realm="alerd-spec"' },
    });
  }

  const { slug } = await params;
  const name = slug?.length === 1 ? slug[0] : undefined;
  const entry = name ? FILES[name] : undefined;
  if (!entry) return new NextResponse("not found", { status: 404 });

  const data = await readFile(path.join(process.cwd(), "spec", entry.file), "utf8");
  return new NextResponse(data, {
    status: 200,
    headers: { "content-type": entry.type, "cache-control": "no-store" },
  });
}
