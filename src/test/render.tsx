import { render as renderReact, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import type { ReactElement, ReactNode } from "react";

export function render(ui: ReactElement, options: RenderOptions & { locale?: "de" | "en" } = {}) {
  const { locale = "de", ...rest } = options;
  return renderReact(ui, { wrapper: ({ children }: { children: ReactNode }) => <NextIntlClientProvider locale={locale} messages={locale === "de" ? de : en} timeZone="Europe/Berlin">{children}</NextIntlClientProvider>, ...rest });
}
