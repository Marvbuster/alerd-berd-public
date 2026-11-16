"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startSession } from "@/lib/session";
import { inviteState } from "@/lib/invite";

export async function signup(fd: FormData) {
  const code = String(fd.get("code") ?? "");
  const name = String(fd.get("name") ?? "").trim() || null;
  const pw = String(fd.get("password") ?? "");
  const pw2 = String(fd.get("password2") ?? "");

  const errUrl = (e: string) => `/signup?code=${encodeURIComponent(code)}&error=${e}`;

  if (pw.length < 8) redirect(errUrl("pw_short"));
  if (pw !== pw2) redirect(errUrl("pw_mismatch"));

  const invite = code ? await prisma.invite.findUnique({ where: { code } }) : null;
  if (!invite) redirect(errUrl("code"));

  const state = inviteState(invite);
  if (state !== "ok") redirect(errUrl(state)); // "used" | "expired"

  const email = invite.email.toLowerCase();
  const passwordHash = await bcrypt.hash(pw, 12);

  let userId: string;
  try {
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email, name, passwordHash, role: invite.role },
      });
      // Invite atomar als eingelöst markieren (usedById @unique → keine Doppel-Einlösung).
      await tx.invite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedById: u.id },
      });
      return u;
    });
    userId = user.id;
  } catch (e) {
    // E-Mail bereits registriert oder Invite parallel eingelöst.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") redirect(errUrl("exists"));
    throw e;
  }

  await startSession(userId);
  redirect("/");
}
