import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inviteState } from "@/lib/invite";
import { revokeInvite, setUserActive } from "./actions";
import { InviteForm } from "./InviteForm";
import { CopyField } from "@/components/CopyField";
import { ResetLink } from "./ResetLink";
import { publicHost } from "@/lib/public-url";

export const dynamic = "force-dynamic";

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function AdminUsersPage() {
  const admin = await requireAdmin();

  const [h, [users, invites]] = await Promise.all([
    headers(),
    Promise.all([
      prisma.user.findMany({
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: { id: true, email: true, name: true, role: true, active: true, _count: { select: { monitors: true } } },
      }),
      prisma.invite.findMany({ orderBy: { createdAt: "desc" } }),
    ]),
  ]);

  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? publicHost()}`;
  const openInvites = invites.filter((i) => inviteState(i) === "ok");

  return (
    <>

      {/* Konten */}
      <h2 className="mb-2 text-xs font-medium text-[var(--fg-dim)]">Konten</h2>
      <div className="panel divide-y divide-[var(--fg-faint)]">
        {users.map((u) => {
          const self = u.id === admin.id;
          return (
            <div key={u.id} className={`px-4 py-3 ${u.active ? "" : "opacity-50"}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="tag shrink-0">{u.role}</span>
                    <span className="truncate">{u.name ? `${u.name} · ${u.email}` : u.email}</span>
                    {!u.active && <span className="tag shrink-0">gesperrt</span>}
                  </div>
                  <div className="text-xs text-[var(--fg-dim)]">{u._count.monitors} Monitore</div>
                </div>
                {!self && (
                  <form action={setUserActive.bind(null, u.id, !u.active)} className="shrink-0">
                    <button type="submit" className={`btn btn--ghost ${u.active ? "!text-[var(--down)]" : "!text-[var(--up)]"}`}>
                      {u.active ? "sperren" : "entsperren"}
                    </button>
                  </form>
                )}
              </div>
              {!self && <ResetLink userId={u.id} />}
            </div>
          );
        })}
      </div>

      {/* Offene Einladungen */}
      <h2 className="mb-2 mt-8 text-xs font-medium text-[var(--fg-dim)]">Offene Einladungen</h2>
      {openInvites.length === 0 ? (
        <p className="panel px-4 py-4 text-sm text-[var(--fg-dim)]">Keine offenen Einladungen.</p>
      ) : (
        <div className="panel divide-y divide-[var(--fg-faint)]">
          {openInvites.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="tag shrink-0">{i.role}</span>
                  <span className="truncate">{i.email}</span>
                </div>
                <div className="text-xs text-[var(--fg-dim)]">gültig bis {fmt(i.expiresAt)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <CopyField value={`${base}/signup?code=${i.code}`} label="link kopieren" />
                <form action={revokeInvite.bind(null, i.id)}>
                  <button type="submit" className="btn btn--ghost !text-[var(--down)]">zurückziehen</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <InviteForm />
    </>
  );
}
