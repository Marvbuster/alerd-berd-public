import { createMonitor } from "@/lib/actions";
import { MonitorForm } from "@/components/MonitorForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default function NewMonitor() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-7">
      <PageHeader title="Neuer Monitor" description="Einen Dienst mit Alerd im Blick behalten." icon="monitor" />

      <details className="panel mb-6 p-4" open>
        <summary className="cursor-pointer text-xs font-medium text-[var(--fg-dim)]">
          Kurzanleitung
        </summary>
        <div className="mt-3 space-y-2 text-sm text-[var(--fg-dim)]">
          <p>
            Wähl zuerst die <span className="text-[var(--fg)]">Art</span>, danach passen sich die
            Felder darunter an. Was welche Art prüft, steht jeweils als Hinweis unter der Auswahl.
          </p>
          <ul className="space-y-1.5 border-l border-[var(--fg-faint)] pl-4">
            <li><span className="text-[var(--fg)]">name</span> — wie der Monitor im Board heißt, frei wählbar.</li>
            <li><span className="text-[var(--fg)]">ziel</span> — je nach Art eine volle URL oder <code>host:port</code>.</li>
            <li><span className="text-[var(--fg)]">HEALTH</span> — zusätzlich der tiefe Health-Pfad (die Spec-Route, nicht die flache <code>/api/health</code>). Der Bearer-Token wird dir generiert: kopieren, in deiner App als erwarteten Token ablegen, Alerd sendet genau den beim Pollen. Offene Route: Feld leeren. Die beiden ms-Schwellen sind optionale Fallbacks, wenn der Dienst keine eigenen mitliefert.</li>
            <li><span className="text-[var(--fg)]">intervall / timeout</span> — wie oft geprüft wird und wie lange Alerd auf Antwort wartet.</li>
            <li><span className="text-[var(--fg)]">PUSH</span> — wird nicht gepollt; die Ingest-URL zum Eintragen (z. B. in Coolify) erscheint nach dem Speichern auf der Detailseite.</li>
            <li><span className="text-[var(--fg)]">aktiv</span> — an, damit der Monitor gepollt wird bzw. Events annimmt.</li>
          </ul>
          <p>
            Alarm-Kanäle (E-Mail, Web-Push) stellst du einmalig unter{" "}
            <a href="/settings" className="text-[var(--up)] underline">Einstellungen</a> ein, nicht pro Monitor.
          </p>
          <p>
            Soll ein eigener Dienst per <span className="text-[var(--fg)]">HEALTH</span> überwacht werden,
            muss er den Alerd-Health-Contract liefern. Die Anleitung dafür steht in{" "}
            <a href="/llms.txt" className="text-[var(--up)] underline">llms.txt</a>: die gibst du zusammen
            mit deinem API-Key (aus <a href="/settings/keys" className="text-[var(--up)] underline">Keys</a>) einem
            Coding-Agent, der baut dir die <code>/health</code>-Route, danach trägst du sie hier als
            Monitor ein.
          </p>
        </div>
      </details>

      <div className="panel p-5 sm:p-7"><MonitorForm action={createMonitor} submitLabel="Monitor anlegen" /></div>
    </main>
  );
}
