import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";
import { createMonitor } from "@/lib/actions";
import { MonitorForm } from "@/components/MonitorForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default function NewMonitor() {
  const _locale = _useLocale();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-7">
      <PageHeader title={_t(_locale, "monitors_new.macc33da8c0")} description={_t(_locale, "monitors_new.m3b6d6157fa")} icon="monitor" />

      <details className="panel mb-6 p-4" open>
        <summary className="cursor-pointer text-xs font-medium text-[var(--fg-dim)]">
          {_t(_locale, "monitors_new.m0303e1896c")}</summary>
        <div className="mt-3 space-y-2 text-sm text-[var(--fg-dim)]">
          <p>
            {_t(_locale, "monitors_new.ma63f8adf5a")}<span className="text-[var(--fg)]">{_t(_locale, "monitors_new.m75df3579c7")}</span>{_t(_locale, "monitors_new.m2edb5af642")}</p>
          <ul className="space-y-1.5 border-l border-[var(--fg-faint)] pl-4">
            <li><span className="text-[var(--fg)]">{_t(_locale, "monitors_new.m82a3537ff0")}</span> {_t(_locale, "monitors_new.m740a91d3a6")}</li>
            <li><span className="text-[var(--fg)]">{_t(_locale, "monitors_new.m200b00229f")}</span> {_t(_locale, "monitors_new.m045bea9fad")}<code>{_t(_locale, "monitors_new.m132c03619c")}</code>.</li>
            <li><span className="text-[var(--fg)]">{_t(_locale, "monitors_new.me5b73ae3b9")}</span> {_t(_locale, "monitors_new.m1a3c02953f")}<code>{_t(_locale, "monitors_new.m7ab8483165")}</code>{_t(_locale, "monitors_new.me13981296b")}</li>
            <li><span className="text-[var(--fg)]">{_t(_locale, "monitors_new.mbce0fec3c1")}</span> {_t(_locale, "monitors_new.mf9207ed511")}</li>
            <li><span className="text-[var(--fg)]">{_t(_locale, "monitors_new.m792aac6770")}</span> {_t(_locale, "monitors_new.m286c111f9a")}</li>
            <li><span className="text-[var(--fg)]">{_t(_locale, "monitors_new.m3139fcc40f")}</span> {_t(_locale, "monitors_new.mc53f3ed13f")}</li>
          </ul>
          <p>
            {_t(_locale, "monitors_new.m8d54696d44")}{" "}
            <a href="/settings" className="text-[var(--up)] underline">{_t(_locale, "monitors_new.mf5750a5d72")}</a> {_t(_locale, "monitors_new.md536b49280")}</p>
          <p>
            {_t(_locale, "monitors_new.mddc7e59892")}<span className="text-[var(--fg)]">{_t(_locale, "monitors_new.me5b73ae3b9")}</span> {_t(_locale, "monitors_new.m39b484ce69")}{" "}
            <a href="/llms.txt" className="text-[var(--up)] underline">{_t(_locale, "monitors_new.mf43a9e2f7d")}</a>{_t(_locale, "monitors_new.mb80e1c70a4")}<a href="/settings/keys" className="text-[var(--up)] underline">{_t(_locale, "monitors_new.mf0d66a79c1")}</a>{_t(_locale, "monitors_new.mbed5a9fc8f")}<code>{_t(_locale, "monitors_new.m0587c50e30")}</code>{_t(_locale, "monitors_new.m224e8b467b")}</p>
        </div>
      </details>

      <div className="panel p-5 sm:p-7"><MonitorForm action={createMonitor} submitLabel={_t(_locale, "monitors_new.mdd08c268b6")} /></div>
    </main>
  );
}
