import { after, NextResponse } from "next/server";
import { scanDueRepositories } from "@/lib/repository-watch";
import { runChecks } from "@/lib/check";
import { sendDueDailyUpdateDigests } from "@/lib/daily-update-digest";
import { pruneOldChecks } from "@/lib/check-retention";

// Von einem externen Scheduler (Coolify Scheduled Task / Cron) getriggert.
// Schutz über gemeinsames Bearer-Secret (RUN_CHECKS_SECRET).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.RUN_CHECKS_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runChecks();
  // Fällige Git-Scans (alle 15 Minuten pro Repo, sofort nach einem Push) nach
  // der Antwort, damit langsame GitHub-Abrufe die Health-Checks nicht aufhalten.
  // Höchstens fünf pro Lauf, Leases verhindern doppelte Scans.
  after(async () => {
    await Promise.all([
      scanDueRepositories().catch((error) => console.error("[repositories] scan failed:", error)),
      sendDueDailyUpdateDigests().catch((error) => console.error("[digest] send failed:", error)),
      // Checks älter als 14 Tage, im Takt der Läufe, höchstens 50.000 Zeilen pro Lauf.
      pruneOldChecks().catch((error) => console.error("[checks] prune failed:", error)),
    ]);
  });
  return NextResponse.json(summary, { status: 200 });
}
