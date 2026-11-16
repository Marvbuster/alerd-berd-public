"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { startSession } from "@/lib/session";
import { inviteState } from "@/lib/invite";

// Passwort-Reset einlösen: gleiche Zustands-Logik wie Invite (inviteState ist
// generisch über { usedAt, expiresAt }), nur dass der User schon existiert — wir
// setzen seinen passwordHash neu, statt ein Konto anzulegen.
export async function resetPassword(fd: FormData) {
  const code = String(fd.get("code") ?? "");
  const pw = String(fd.get("password") ?? "");
  const pw2 = String(fd.get("password2") ?? "");

  const errUrl = (e: string) => `/reset?code=${encodeURIComponent(code)}&error=${e}`;

  if (pw.length < 8) redirect(errUrl("pw_short"));
  if (pw !== pw2) redirect(errUrl("pw_mismatch"));

  const reset = code ? await prisma.passwordReset.findUnique({ where: { code } }) : null;
  if (!reset) redirect(errUrl("code"));

  const state = inviteState(reset);
  if (state !== "ok") redirect(errUrl(state)); // "used" | "expired"

  const passwordHash = await bcrypt.hash(pw, 12);

  try {
    await prisma.$transaction(async (tx) => {
      // Reset zuerst einlösen; der usedAt-Guard lässt das nur einmal zu
      // (schützt gegen doppelte Einlösung bei Parallel-Requests).
      const used = await tx.passwordReset.updateMany({
        where: { id: reset.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count === 0) throw new Error("already-used");
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "already-used") redirect(errUrl("used"));
    throw e;
  }

  await startSession(reset.userId);
  redirect("/");
}
