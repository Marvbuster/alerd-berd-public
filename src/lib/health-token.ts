// Bearer-Token für eine Spec-Health-Route. Alerd sendet ihn beim Pollen, die App
// prüft ihn. Prefix alhc_ (Alerd Health Check) zur Abgrenzung vom API-Key alrd_.
// Läuft im Browser und auf dem Server (Web Crypto).
export function genHealthToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `alhc_${b64}`;
}
