"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, sha256hex } from "@/lib/auth";
import { genApiKey, keyLabel } from "@/lib/apikey";

export type NewKeyState = { key?: string; error?: string };

// Legt einen API-Key an. Der Klartext wird gespeichert (secret), damit er in der
// Liste jederzeit kopierbar bleibt; keyHash bleibt für den Spec-Lookup.
export async function createApiKey(_prev: NewKeyState, fd: FormData): Promise<NewKeyState> {
  const user = await requireUser();
  const name = String(fd.get("name") ?? "").trim() || "Key";
  const key = genApiKey();
  const keyHash = await sha256hex(key);
  await prisma.apiKey.create({ data: { userId: user.id, name, prefix: keyLabel(key), keyHash, secret: key } });
  revalidatePath("/settings/keys");
  return { key };
}

export async function revokeApiKey(id: string) {
  const user = await requireUser();
  const res = await prisma.apiKey.updateMany({
    where: { id, userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) throw new Error("Key nicht gefunden.");
  revalidatePath("/settings/keys");
}
