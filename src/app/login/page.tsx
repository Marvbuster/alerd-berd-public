import type { Metadata } from "next";
import { login } from "./actions";
import { AlerdLogo } from "@/components/AlerdLogo";

export const metadata: Metadata = { title: "Alerd Berd — Login" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const field =
    "w-full rounded-md border border-[var(--fg-faint)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--cyan)]";

  return (
    <main className="grid min-h-[calc(100dvh-84px)] place-items-center px-5 py-10">
      <form action={login} autoComplete="on" className="panel auth-card">
        <AlerdLogo size={92} className="mb-6" />
        <h1 className="auth-heading">Alles im Blick.</h1>
        <p className="auth-description">Melde dich bei deinem Alerd Berd an.</p>

        <input type="hidden" name="next" value={sp.next ?? "/"} />

        <label htmlFor="email" className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
          E-Mail
        </label>
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
          Passwort
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={field}
        />

        {sp.error && <p className="mt-3 text-xs" style={{ color: "var(--down)" }}>falsche E-Mail oder Passwort</p>}

        <button type="submit" className="btn mt-6 w-full">Anmelden</button>
      </form>
    </main>
  );
}
