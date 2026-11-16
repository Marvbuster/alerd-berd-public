import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { asLocale, LOCALE_COOKIE, LOCALE_HEADER, resolveLocale } from "./locale";

export default getRequestConfig(async () => {
  const requestHeaders = await headers();
  const locale = asLocale((await cookies()).get(LOCALE_COOKIE)?.value) ?? asLocale(requestHeaders.get(LOCALE_HEADER)) ?? resolveLocale({
    acceptLanguage: requestHeaders.get("accept-language"),
  });
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default, timeZone: "Europe/Berlin" };
});
