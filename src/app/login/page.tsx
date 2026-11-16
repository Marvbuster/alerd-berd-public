import { translate as _t } from "@/i18n/translate";
import { getLocale as _getLocale } from "next-intl/server";
import type { Metadata } from "next";
import { login } from "./actions";
import { AlerdLogo } from "@/components/AlerdLogo";

export async function generateMetadata(): Promise<Metadata> {
  const _locale = await _getLocale();
  return { title: _t(_locale, "metadata.login") };
}
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const _locale = await _getLocale();
  const sp = await searchParams;
  const field =
    "w-full rounded-md border border-[var(--fg-faint)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--cyan)]";

  return (
    <main className="grid min-h-[calc(100dvh-84px)] place-items-center px-5 py-10">
      <form action={login} autoComplete="on" className="panel auth-card">
        <AlerdLogo size={92} className="mb-6" />
        <h1 className="auth-heading">{_t(_locale, "login.mc1c437d67f")}</h1>
        <p className="auth-description">{_t(_locale, "login.mc4de8343e0")}</p>

        <input type="hidden" name="next" value={sp.next ?? "/"} />

        <label htmlFor="email" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
          {_t(_locale, "login.m2fae6fb30b")}</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className={`${field} mb-4`}
        />

        <label htmlFor="password" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
          {_t(_locale, "login.ma36c101570")}</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={field}
        />

        {sp.error && <p className="mt-3 text-xs" style={{ color: "var(--down)" }}>{_t(_locale, "login.m8f2b1448e5")}</p>}

        <button type="submit" className="btn mt-6 w-full">{_t(_locale, "login.ma329a32263")}</button>
      </form>
    </main>
  );
}
