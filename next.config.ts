import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pflicht für das schlanke Docker-Runtime-Image (Coolify-Deploy)
  output: "standalone",
  // Die spec/-Quelldateien (Schema, Beispiel, Guide) werden von der
  // /spec/[...slug]-Route zur Laufzeit aus dem Dateisystem gelesen. In den
  // Standalone-Output werden sie nur mitkopiert, wenn sie getraced sind — mit
  // dem globalen "/*"-Key sind sie in jedem Server-Trace enthalten.
  outputFileTracingIncludes: {
    "/*": ["spec/**/*"],
  },
  // Alte Pfade aus der Zeit vor dem zentralen Einstellungsbereich.
  async redirects() {
    return [
      { source: "/keys", destination: "/settings/keys", permanent: true },
      { source: "/admin/users", destination: "/settings/users", permanent: true },
      // Dienste ersetzen Monitore, App-Inventar und Versionen (Konzept 2026-11-11).
      // Vorerst temporär, bis die alten Seiten gelöscht sind. Query und Hash bleiben erhalten.
      { source: "/", destination: "/services", permanent: false },
      { source: "/coolify", destination: "/services", permanent: false },
      { source: "/versions", destination: "/services?filter=updates", permanent: false },
      { source: "/sphere", destination: "/services?view=sphere", permanent: false },
    ];
  },
};

export default nextConfig;
