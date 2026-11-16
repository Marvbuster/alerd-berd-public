"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { asLocale, LOCALE_COOKIE } from "@/i18n/locale";

export async function setLocale(form: FormData): Promise<void> {
  const user = await requireUser();
  const locale = asLocale(form.get("locale"));
  if (!locale) return;
  await prisma.user.update({ where: { id: user.id }, data: { locale } });
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
}
