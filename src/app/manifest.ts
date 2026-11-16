import type { MetadataRoute } from "next";
import { getLocale } from "next-intl/server";
import { translate } from "@/i18n/translate";

// PWA-Manifest → Home-Screen-Install (Voraussetzung für Web Push auf iOS/Android).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await getLocale();
  return {
    name: "Alerd Berd",
    short_name: "Alerd",
    description: translate(locale, "metadata.manifest"),
    lang: locale,
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
