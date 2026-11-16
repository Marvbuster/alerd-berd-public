import { randomBytes } from "node:crypto";

// Invite-Logik, seiteneffektfrei (eigener Vitest-Test). Der Code steht im
// Signup-Link (/signup?code=…) und ist die Einlösung; die Bindung an die E-Mail
// macht die DB (Invite.email), nicht der User.

export function genInviteCode(): string {
  return randomBytes(18).toString("base64url");
}

export type InviteState = "ok" | "used" | "expired";

export function inviteState(
  invite: { usedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): InviteState {
  if (invite.usedAt) return "used";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "ok";
}
