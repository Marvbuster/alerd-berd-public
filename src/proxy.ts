import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";
import { asLocale, LOCALE_COOKIE, LOCALE_HEADER, resolveLocale } from "@/i18n/locale";

// Next 16: "proxy" (früher "middleware"). Multi-User-Zugangsmodell: ALLES ist
// geschützt, Zugang nur mit gültiger Session (JWT-Cookie, jose/edge-safe). Der
// Proxy prüft hier nur Signatur+Expiry; die autoritative User-/Rollen-/Aktiv-
// Prüfung macht currentUser() (DB) in den Pages/Actions. Mutationen schützen sich
// zusätzlich selbst über requireUser()/requireAdmin().

// Immer offen, in JEDEM Fall — sonst bricht Login, Deploy oder der Webhook:
function isAlwaysPublic(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/signup" || // Invite-Einlösung (Code in der Query ist die Bindung)
    pathname === "/reset" || // Passwort-Reset-Einlösung (Code in der Query ist die Bindung)
    pathname === "/api/health" || // Coolify-Container-Healthcheck — NIE schützen (sonst unhealthy → Rollback)
    pathname === "/api/spec-health" || // eigene Spec-Health; eigener Bearer (SPEC_HEALTH_TOKEN)
    pathname.startsWith("/api/ingest/") || // Push-Webhook; Absicherung ist das Token im Pfad
    pathname === "/api/coolify/sync" || // eigener Bearer, verweigert Zugriff auch ohne Secret
    pathname === "/api/repositories/sync" || // eigener Bearer, Git-Scans getrennt von Health-Checks
    pathname === "/api/run-checks" || // Check-Runner; eigener Bearer (RUN_CHECKS_SECRET)
    pathname.startsWith("/api/local-node/") // lokale Analyse-Node; eigener Bearer (persönlicher API-Key)
  );
}
// NICHT hier gelistet, mit Absicht:
//  - /llms.txt: statisches Asset (Punkt im Pfad) → fällt nicht unter den Matcher,
//    wird direkt aus public/ ausgeliefert, also ohnehin offen. Gewollter
//    Einstiegspunkt, zeigt auf die token-geschützten Guides.
//  - /spec/*: eigener Route-Handler mit eigenem Auth (API-Key/Session/Env-Token).

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // Liveness und Maschinen-Endpunkte bleiben ohne zusätzliche DB-Abfrage.
  if (isAlwaysPublic(pathname) && pathname.startsWith("/api/")) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  const cookie = req.cookies.get(LOCALE_COOKIE)?.value;
  const user = session && !asLocale(cookie) ? await prisma.user.findUnique({ where: { id: session.userId }, select: { locale: true, active: true } }) : null;
  const locale = resolveLocale({ cookie, user: user?.active ? user.locale : null, acceptLanguage: req.headers.get("accept-language") });
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(LOCALE_HEADER, locale);
  // Kontosprache einmal aus der DB holen und als Cookie merken, sonst fragte jeder
  // Request ohne Cookie (auch die Polls im Sekundentakt) die DB. Ohne gespeicherte
  // Kontosprache nur einen Tag, damit Browser- oder Env-Änderungen ankommen.
  const next = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    if (user?.active) response.cookies.set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: asLocale(user.locale) ? 365 * 86_400 : 86_400 });
    return response;
  };
  if (isAlwaysPublic(pathname)) return next();

  // Kein AUTH_SECRET gesetzt (reines Dev-Setup ohne Accounts) → offen lassen,
  // sonst sperrt man sich lokal komplett aus.
  if (!process.env.AUTH_SECRET) return next();

  if (session) return next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

// Auf allem laufen lassen AUSSER Next-internen Assets und statischen Dateien mit
// Endung (die enthalten einen Punkt: /llms.txt, /icon.svg, /sw.js,
// /manifest.webmanifest, /favicon.ico). Die sind entweder bewusst öffentlich oder
// harmlos-statisch; geschützte Seiten/APIs haben keinen Punkt.
export const config = {
  matcher: ["/((?!_next|.*\\.).*)"],
};
