// Idempotenter Admin-Seed + Mandanten-Backfill. Läuft beim Container-Start nach
// `migrate deploy`. Legt den Admin aus der Env an (ADMIN_EMAIL/ADMIN_PASSWORD;
// Passwort = Env ist die Quelle der Wahrheit, da es noch keine In-App-Änderung
// gibt) und weist alle noch besitzerlosen Monitore/Kanäle dem Admin zu, damit die
// vor der Multi-User-Umstellung angelegten Daten dem ersten Admin gehören.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email || !password) {
    console.log("[seed-admin] ADMIN_EMAIL/ADMIN_PASSWORD nicht gesetzt — übersprungen.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "ADMIN", active: true },
    create: { email, name: "Admin", passwordHash, role: "ADMIN", active: true },
  });

  const [m, c] = await Promise.all([
    prisma.monitor.updateMany({ where: { ownerId: null }, data: { ownerId: admin.id } }),
    prisma.alertChannel.updateMany({ where: { ownerId: null }, data: { ownerId: admin.id } }),
  ]);

  console.log(`[seed-admin] admin=${email} · backfill monitors=${m.count} channels=${c.count}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("[seed-admin] Fehler:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
