"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { startSession, endSession } from "@/lib/session";

function safeNext(raw: unknown): string {
  const s = String(raw ?? "/");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export async function login(fd: FormData) {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const pw = String(fd.get("password") ?? "");
  const next = safeNext(fd.get("next"));

  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  // Generische Fehlermeldung für „kein User" UND „falsches Passwort" → keine
  // User-Enumeration. bcrypt.compare nur, wenn der User existiert + aktiv ist.
  const ok = !!user && user.active && (await bcrypt.compare(pw, user.passwordHash));
  if (ok && user) {
    await startSession(user.id);
    redirect(next);
  }
  redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
}

export async function logout() {
  await endSession();
  redirect("/login");
}
