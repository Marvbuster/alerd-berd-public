import { translate as _t } from "@/i18n/translate";
import { getLocale as _getLocale } from "next-intl/server";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { inviteState } from "@/lib/invite";
import { resetPassword } from "./actions";
import { AlerdLogo } from "@/components/AlerdLogo";

export async function generateMetadata(): Promise<Metadata> {
  const _locale = await _getLocale();
  return { title: _t(_locale, "metadata.reset") };
}
export const dynamic = "force-dynamic";

function FORM_ERRORS(_locale: string = "de"): Record<string, string> { return ({
  pw_short: _t(_locale, "reset.m50456e30ae"),
  pw_mismatch: _t(_locale, "reset.m943de6dfe4"),
}); }

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string }>;
}) {
  const _locale = await _getLocale();
  const sp = await searchParams;
  const code = sp.code ?? "";
  const field =
    "w-full rounded-md border border-[var(--fg-faint)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--cyan)]";

  const reset = code
    ? await prisma.passwordReset.findUnique({
        where: { code },
        include: { user: { select: { email: true } } },
      })
    : null;
  const state = reset ? inviteState(reset) : null;
  const usable = reset && state === "ok";

  const statusNote =
    !reset
      ? _t(_locale, "reset.me2f812e512")
      : state === "used"
        ? _t(_locale, "reset.ma90f77b2b2")
        : state === "expired"
          ? _t(_locale, "reset.mcbd75e6ff7")
          : null;

  return (
    <main className="grid min-h-[calc(100dvh-84px)] place-items-center px-5 py-10">
      <div className="panel auth-card">
        <AlerdLogo size={80} className="mb-6" />
        <h1 className="auth-heading">{_t(_locale, "reset.m8bce7305a2")}</h1>
        <p className="auth-description">{_t(_locale, "reset.ma51b396e71")}</p>

        {!usable ? (
          <p className="text-sm text-[var(--fg-dim)]">
            {statusNote}
            <br />
            <span className="mt-3 block text-xs">{_t(_locale, "reset.m2d7c08f9e8")}</span>
          </p>
        ) : (
          <form action={resetPassword} autoComplete="on">
            <input type="hidden" name="code" value={code} />

            <p className="mb-5 text-xs text-[var(--fg-dim)]">
              {_t(_locale, "reset.m05a4b198a2")}<span className="text-[var(--fg)]">{reset.user.email}</span> {_t(_locale, "reset.me69d71bb19")}</p>

            <label htmlFor="password" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
              {_t(_locale, "reset.m23e50782ed")}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className={`${field} mb-4`}
            />

            <label htmlFor="password2" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
              {_t(_locale, "reset.me4c6bd360b")}</label>
            <input
              id="password2"
              name="password2"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className={field}
            />

            {sp.error && FORM_ERRORS(_locale)[sp.error] && (
              <p className="mt-3 text-xs" style={{ color: "var(--down)" }}>{FORM_ERRORS(_locale)[sp.error]}</p>
            )}

            <button type="submit" className="btn mt-6 w-full !text-[var(--fg)]">{_t(_locale, "reset.me9855fd226")}</button>
          </form>
        )}
      </div>
    </main>
  );
}
