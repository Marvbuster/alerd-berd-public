// Öffentliche Adresse dieser Alerd-Instanz, für Links und Bilder in Mails und als
// Rückfall, wenn eine Anfrage keinen Host mitbringt. Gesetzt über ALERD_PUBLIC_URL.
// Der Fallback ist die einzige Stelle mit der Prod-Domain im Code; das OSS-Sync
// ersetzt ihn durch einen generischen Wert.
export const DEFAULT_PUBLIC_URL = "https://alerd.example.com";

export function publicUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ALERD_PUBLIC_URL || DEFAULT_PUBLIC_URL).replace(/\/+$/, "");
}

export function publicHost(env: NodeJS.ProcessEnv = process.env): string {
  return new URL(publicUrl(env)).host;
}
