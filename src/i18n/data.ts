import { translateMessage } from "./translate";

export function localizedTitle(value: { title: string; titleEn?: string }, locale: string): string {
  return translateMessage(locale, locale === "en" && value.titleEn ? value.titleEn : value.title);
}
