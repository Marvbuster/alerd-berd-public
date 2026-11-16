import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";
import Link from "next/link";
import { AlerdLogo } from "@/components/AlerdLogo";

export default function NotFound() {
  const _locale = _useLocale();
  return <main className="mx-auto max-w-lg px-6 py-20 text-center"><AlerdLogo size={100} className="mx-auto mb-7" /><h1 className="text-3xl font-semibold">{_t(_locale, "app.m239caa9d84")}</h1><p className="mt-3 text-[var(--fg-dim)]">{_t(_locale, "app.m770fbbdfde")}</p><Link href="/services" className="btn mt-7">{_t(_locale, "app.m33a8a2cfd0")}</Link></main>;
}
