import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revokeApiKey } from "./actions";
import { NewKeyForm } from "./NewKeyForm";
import { CopyField } from "@/components/CopyField";

export const dynamic = "force-dynamic";

function fmt(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export default async function KeysPage() {
  const user = await requireUser();
  const keys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>

      <p className="mb-4 text-xs text-[var(--fg-dim)]">
        Persönliche Keys für den Health-Contract unter <code>/spec/*</code>. Sende sie als
        <code> Authorization: Bearer alrd_…</code>. Einstieg und Links stehen offen in
        <Link href="/llms.txt" className="ml-1 !text-[var(--cyan)]">llms.txt</Link>.
      </p>

      {keys.length === 0 ? (
        <p className="panel px-4 py-4 text-sm text-[var(--fg-dim)]">Noch keine Keys.</p>
      ) : (
        <div className="panel divide-y divide-[var(--fg-faint)]">
          {keys.map((k) => {
            const revoked = k.revokedAt != null;
            return (
              <div key={k.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-4 ${revoked ? "opacity-50" : ""}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    {revoked && <span className="tag">widerrufen</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--fg-dim)]">
                    <code className="text-[var(--fg)]">{k.prefix}</code>
                    <span>angelegt {fmt(k.createdAt)}</span>
                    <span>{k.lastUsedAt ? `zuletzt ${fmt(k.lastUsedAt)}` : "noch nie genutzt"}</span>
                  </div>
                </div>
                {!revoked && (
                  <div className="flex items-center gap-2">
                    {k.secret && <CopyField value={k.secret} label="key kopieren" />}
                    <form action={revokeApiKey.bind(null, k.id)}>
                      <button type="submit" className="btn btn--ghost !text-[var(--down)]">widerrufen</button>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <NewKeyForm />
    </>
  );
}
