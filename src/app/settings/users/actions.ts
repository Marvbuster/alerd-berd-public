"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { genInviteCode } from "@/lib/invite";
import type { Role } from "@prisma/client";
import { publicHost } from "@/lib/public-url";

export type InviteState = { link?: string; error?: string };
export type ResetState = { link?: string; error?: string };

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage
const RESET_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? publicHost();
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

// Legt eine E-Mail-gebundene Einladung an und gibt den Signup-Link einmalig
// zurück (Admin verschickt ihn selbst). Für useActionState in der InviteForm.
export async function createInvite(_prev: InviteState, fd: FormData): Promise<InviteState> {
  const admin = await requireAdmin();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const role = (String(fd.get("role") ?? "USER") === "ADMIN" ? "ADMIN" : "USER") as Role;
  if (!email || !email.includes("@")) return { error: "Gültige E-Mail angeben." };

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { error: "Für diese E-Mail gibt es schon ein Konto." };

  const code = genInviteCode();
  await prisma.invite.create({
    data: {
      code,
      email,
      role,
      createdById: admin.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
  revalidatePath("/settings/users");
  return { link: `${await baseUrl()}/signup?code=${code}` };
}

export async function revokeInvite(id: string) {
  await requireAdmin();
  // Nur offene (noch nicht eingelöste) Invites löschen.
  const res = await prisma.invite.deleteMany({ where: { id, usedAt: null } });
  if (res.count === 0) throw new Error("Einladung nicht gefunden oder schon eingelöst.");
  revalidatePath("/settings/users");
}

export async function setUserActive(id: string, active: boolean) {
  const admin = await requireAdmin();
  if (id === admin.id) throw new Error("Eigenes Konto kann nicht deaktiviert werden.");
  await prisma.user.update({ where: { id }, data: { active } });
  revalidatePath("/settings/users");
}

// Erstellt für einen bestehenden User einen Reset-Link (/reset?code=…) und gibt
// ihn einmalig zurück (Admin verschickt ihn selbst). Ältere offene Resets des
// Users werden verworfen, damit nur ein Link gilt. Für useActionState (ResetLink).
export async function createPasswordReset(_prev: ResetState, fd: FormData): Promise<ResetState> {
  const admin = await requireAdmin();
  const userId = String(fd.get("userId") ?? "");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { error: "Konto nicht gefunden." };

  const code = genInviteCode();
  await prisma.$transaction([
    prisma.passwordReset.deleteMany({ where: { userId, usedAt: null } }),
    prisma.passwordReset.create({
      data: { code, userId, createdById: admin.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    }),
  ]);
  return { link: `${await baseUrl()}/reset?code=${code}` };
}
