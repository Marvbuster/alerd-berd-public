import type { MetadataRoute } from "next";

// PWA-Manifest → Home-Screen-Install (Voraussetzung für Web Push auf iOS/Android).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Alerd Berd",
    short_name: "Alerd",
    description: "Überwacht Dienste (Health-Checks) und warnt per E-Mail und Push.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#102035",
    theme_color: "#102035",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/alerd-logo.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
