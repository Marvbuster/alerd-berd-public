"use server";

import { messageCode as _code, errorMessage } from "@/i18n/translate";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { coolifyBaseUrl, fetchCoolifyApplications } from "@/lib/coolify-client";
import { encryptCredential } from "@/lib/credentials";
import { syncCoolifyConnection } from "@/lib/coolify";

export type CoolifyActionState = { ok?: boolean; message?: string };

export async function saveConnection(_prev: CoolifyActionState, form: FormData): Promise<CoolifyActionState> {
  const user = await requireUser();
  const label = String(form.get("label") ?? "").trim();
  const token = String(form.get("token") ?? "").trim();
  if (!label) return { ok: false, message: _code("actions.mfa1ebfef6b") };
  if (label.length > 100) return { ok: false, message: _code("actions.md345888258") };
  if (!token) return { ok: false, message: _code("actions.mfff929ae86") };
  if (token.length > 2000) return { ok: false, message: _code("actions.m68e4447a48") };
  if (/\s/.test(token)) return { ok: false, message: _code("actions.maedfe36aa4") };
  let baseUrl: string;
  let tokenEncrypted: string;
  try {
    baseUrl = coolifyBaseUrl(String(form.get("baseUrl") ?? "").trim());
    tokenEncrypted = encryptCredential(token, `${user.id}:${baseUrl}`);
    await fetchCoolifyApplications(baseUrl, token);
  } catch (error) {
    return { ok: false, message: errorMessage(error, _code("actions.m6423a56be0")) };
  }
  const connection = await prisma.coolifyConnection.upsert({
    where: { ownerId_baseUrl: { ownerId: user.id, baseUrl } },
    create: { ownerId: user.id, label, baseUrl, tokenEncrypted },
    update: { label, tokenEncrypted },
  });
  const result = await syncCoolifyConnection(connection.id, user.id);
  revalidatePath("/coolify"); revalidatePath("/services"); revalidatePath("/settings", "layout");
  return result;
}

export async function syncConnection(id: string, _prev: CoolifyActionState, _form: FormData): Promise<CoolifyActionState> {
  const user = await requireUser();
  const result = await syncCoolifyConnection(id, user.id);
  revalidatePath("/coolify"); revalidatePath("/services"); revalidatePath("/settings", "layout");
  return result;
}

export async function linkMonitor(applicationId: string, _prev: CoolifyActionState, form: FormData): Promise<CoolifyActionState> {
  const user = await requireUser();
  const monitorId = String(form.get("monitorId") ?? "");
  const [app, monitor] = await Promise.all([
    prisma.coolifyApplication.findFirst({ where: { id: applicationId, missingSince: null, hiddenAt: null, connection: { ownerId: user.id } }, select: { id: true } }),
    prisma.monitor.findFirst({ where: { id: monitorId, ownerId: user.id }, select: { id: true } }),
  ]);
  if (!app || !monitor) return { ok: false, message: _code("actions.m82b148c435") };
  await prisma.monitorCoolifyApplication.upsert({
    where: { monitorId_applicationId: { monitorId, applicationId } },
    create: { monitorId, applicationId }, update: {},
  });
  revalidatePath("/coolify"); revalidatePath("/services"); revalidatePath("/settings", "layout");
  revalidatePath("/versions");
  revalidatePath("/");
  revalidatePath(`/monitors/${monitorId}`);
  return { ok: true, message: _code("actions.m20d3326cfe") };
}

export async function unlinkMonitor(applicationId: string, monitorId: string) {
  const user = await requireUser();
  await prisma.monitorCoolifyApplication.deleteMany({
    where: { applicationId, monitorId, monitor: { ownerId: user.id }, application: { connection: { ownerId: user.id } } },
  });
  revalidatePath("/coolify"); revalidatePath("/services"); revalidatePath("/settings", "layout");
  revalidatePath("/versions");
  revalidatePath("/");
  revalidatePath(`/monitors/${monitorId}`);
}

export async function setApplicationHidden(applicationId: string, hidden: boolean, _prev: CoolifyActionState, _form: FormData): Promise<CoolifyActionState> {
  const user = await requireUser();
  if (typeof hidden !== "boolean") return { ok: false, message: _code("actions.m5c657fdcd1") };
  const result = await prisma.coolifyApplication.updateMany({
    where: { id: applicationId, connection: { ownerId: user.id } },
    data: { hiddenAt: hidden ? new Date() : null },
  });
  if (!result.count) return { ok: false, message: _code("actions.md305398a11") };
  revalidatePath("/coolify"); revalidatePath("/services"); revalidatePath("/settings", "layout");
  revalidatePath("/versions");
  return { ok: true, message: _code(hidden ? "actions.appHidden" : "actions.appShown") };
}

export async function deleteConnection(id: string) {
  const user = await requireUser();
  await prisma.coolifyConnection.deleteMany({ where: { id, ownerId: user.id } });
  revalidatePath("/coolify"); revalidatePath("/services"); revalidatePath("/settings", "layout");
  revalidatePath("/versions");
}
