import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { inviteState } from "@/lib/invite";
import { resetPassword } from "./actions";
import { AlerdLogo } from "@/components/AlerdLogo";

export const metadata: Metadata = { title: "Alerd Berd — Passwort zurücksetzen" };
export const dynamic = "force-dynamic";

const FORM_ERRORS: Record<string, string> = {
  pw_short: "Passwort zu kurz (mindestens 8 Zeichen)",
  pw_mismatch: "Passwörter stimmen nicht überein",
};

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string }>;
}) {
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
      ? "Code unbekannt — der Link ist ungültig."
      : state === "used"
        ? "Dieser Link wurde bereits benutzt."
        : state === "expired"
          ? "Dieser Link ist abgelaufen."
          : null;

  return (
    <main className="grid min-h-[calc(100dvh-84px)] place-items-center px-5 py-10">
      <div className="panel auth-card">
        <AlerdLogo size={80} className="mb-6" />
        <h1 className="auth-heading">Neues Passwort.</h1>
        <p className="auth-description">Richte deinen Zugang wieder ein.</p>

        {!usable ? (
          <p className="text-sm text-[var(--fg-dim)]">
            {statusNote}
            <br />
            <span className="mt-3 block text-xs">Frag den Alerd-Betreiber nach einem neuen Reset-Link.</span>
          </p>
        ) : (
          <form action={resetPassword} autoComplete="on">
            <input type="hidden" name="code" value={code} />

            <p className="mb-5 text-xs text-[var(--fg-dim)]">
              Neues Passwort für <span className="text-[var(--fg)]">{reset.user.email}</span> setzen.
            </p>

            <label htmlFor="password" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
              neues passwort
            </label>
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
              passwort wiederholen
            </label>
            <input
              id="password2"
              name="password2"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className={field}
            />

            {sp.error && FORM_ERRORS[sp.error] && (
              <p className="mt-3 text-xs" style={{ color: "var(--down)" }}>{FORM_ERRORS[sp.error]}</p>
            )}

            <button type="submit" className="btn mt-6 w-full !text-[var(--fg)]">passwort setzen</button>
          </form>
        )}
      </div>
    </main>
  );
}
