import { translate as _t } from "@/i18n/translate";
import { getLocale as _getLocale } from "next-intl/server";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { inviteState } from "@/lib/invite";
import { signup } from "./actions";
import { AlerdLogo } from "@/components/AlerdLogo";

export async function generateMetadata(): Promise<Metadata> {
  const _locale = await _getLocale();
  return { title: _t(_locale, "metadata.signup") };
}
export const dynamic = "force-dynamic";

function FORM_ERRORS(_locale: string = "de"): Record<string, string> { return ({
  pw_short: _t(_locale, "signup.m50456e30ae"),
  pw_mismatch: _t(_locale, "signup.m943de6dfe4"),
  exists: _t(_locale, "signup.m9221873631"),
}); }

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string }>;
}) {
  const _locale = await _getLocale();
  const sp = await searchParams;
  const code = sp.code ?? "";
  const field =
    "w-full rounded-md border border-[var(--fg-faint)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--cyan)]";

  const invite = code ? await prisma.invite.findUnique({ where: { code } }) : null;
  const state = invite ? inviteState(invite) : null;
  const usable = invite && state === "ok";

  const statusNote =
    !invite
      ? _t(_locale, "signup.me2f812e512")
      : state === "used"
        ? _t(_locale, "signup.ma83d12fc93")
        : state === "expired"
          ? _t(_locale, "signup.m95d8052f5b")
          : null;

  return (
    <main className="grid min-h-[calc(100dvh-84px)] place-items-center px-5 py-10">
      <div className="panel auth-card">
        <AlerdLogo size={80} className="mb-6" />
        <h1 className="auth-heading">{_t(_locale, "signup.m1c5d875802")}</h1>
        <p className="auth-description">{_t(_locale, "signup.mff9ecf1c1f")}</p>

        {!usable ? (
          <p className="text-sm text-[var(--fg-dim)]">
            {statusNote}
            <br />
            <span className="mt-3 block text-xs">{_t(_locale, "signup.md25265e006")}</span>
          </p>
        ) : (
          <form action={signup} autoComplete="on">
            <input type="hidden" name="code" value={code} />

            <p className="mb-5 text-xs text-[var(--fg-dim)]">
              {_t(_locale, "signup.m3bb39a6033")}<span className="text-[var(--fg)]">{invite.email}</span>{_t(_locale, "signup.md308d99e08")}</p>

            <label htmlFor="name" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
              {_t(_locale, "signup.m2f3c0e5bd1")}</label>
            <input id="name" name="name" autoComplete="name" className={`${field} mb-4`} />

            <label htmlFor="password" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
              {_t(_locale, "signup.m33c5ebbb01")}</label>
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
              {_t(_locale, "signup.me4c6bd360b")}</label>
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

            <button type="submit" className="btn mt-6 w-full !text-[var(--fg)]">{_t(_locale, "signup.mb57d50274b")}</button>
          </form>
        )}
      </div>
    </main>
  );
}
