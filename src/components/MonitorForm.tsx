"use client";

import { useState, useEffect, useRef } from "react";
import { genHealthToken } from "@/lib/health-token";
import type { Monitor, MonitorKind } from "@prisma/client";
import { CopyField } from "@/components/CopyField";

// Seit dem Dienste-Konzept (2026-11-11) nur noch drei Arten. TCP, Keyword und
// Ping (nie implementiert) erscheinen nur noch beim Bearbeiten bestehender Monitore.
const KIND_OPTIONS: { value: MonitorKind; label: string; hint: string; legacy?: boolean }[] = [
  { value: "HEALTH", label: "Spec-Health", hint: "Bearer-geschützte Health-Route nach Alerd Health Spec" },
  { value: "HTTP", label: "Erreichbarkeit", hint: "antwortet die URL mit dem erwarteten Status" },
  { value: "PUSH", label: "Push", hint: "die Quelle meldet sich selbst an einer Ingest-URL" },
  { value: "KEYWORD", label: "Keyword (alt)", hint: "Body muss den Suchtext enthalten", legacy: true },
  { value: "TCP", label: "TCP (alt)", hint: "Ziel als host:port", legacy: true },
  { value: "PING", label: "Ping (alt, nicht implementiert)", hint: "wird nicht geprüft", legacy: true },
];

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
      {children}
    </span>
  );
}
const hint = "mt-1 text-xs text-[var(--fg-dim)]";

export function MonitorForm({
  action,
  monitor,
  submitLabel,
}: {
  action: (fd: FormData) => void | Promise<void>;
  monitor?: Monitor;
  submitLabel: string;
}) {
  const [kind, setKind] = useState<MonitorKind>(monitor?.kind ?? "HEALTH");
  const [bearerToken, setBearerToken] = useState(monitor?.bearerToken ?? "");
  // Neuer HEALTH-Monitor ohne Token: einmalig einen generieren, damit man ihn
  // direkt kopieren kann. Bestehende Monitore bleiben wie sie sind.
  const didInitToken = useRef(false);
  useEffect(() => {
    if (!didInitToken.current && !monitor && kind === "HEALTH" && !bearerToken) {
      setBearerToken(genHealthToken());
      didInitToken.current = true;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const targetHint =
    kind === "TCP" ? "z. B. db.example.com:5432"
    : kind === "PING" ? "z. B. server.example.com"
    : kind === "PUSH" ? "Quelle, nur informativ — z. B. coolify.example.com"
    : "volle URL, z. B. https://otrs.example.com";

  return (
    <form action={action} className="space-y-5">
      <div>
        <Label>Name</Label>
        <input name="name" required defaultValue={monitor?.name ?? ""} placeholder="z. B. OTRS Produktion" />
      </div>

      <div>
        <Label>Art der Überwachung</Label>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as MonitorKind)}>
          {KIND_OPTIONS.filter((o) => !o.legacy || o.value === monitor?.kind).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className={hint}>{KIND_OPTIONS.find((o) => o.value === kind)?.hint}</p>
      </div>

      <div>
        <Label>Ziel</Label>
        <input name="target" required defaultValue={monitor?.target ?? ""} placeholder={targetHint} />
        <p className={hint}>{targetHint}</p>
      </div>

      {kind === "HEALTH" && (
        <div className="panel space-y-5 p-4">
          <p className="text-sm font-semibold text-[var(--fg-dim)]">Health-Spec-Einstellungen</p>
          <div>
            <Label>health-pfad</Label>
            <input name="healthPath" defaultValue={monitor?.healthPath ?? "/health"} placeholder="/health" />
            <p className={hint}>separater Spec-Endpunkt — NICHT die öffentliche Coolify-Liveness /api/health</p>
          </div>
          <div>
            <Label>bearer-token</Label>
            <div className="flex items-center gap-2">
              {/* Passwort-Manager (1Password/LastPass/Bitwarden) via data-*-ignore
                  überspringen — das Feld ist ein API-Token, kein Login; Autofill
                  überschrieb es sonst mit einem gespeicherten Passwort. */}
              <input
                name="bearerToken"
                type="text"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                placeholder="leer = offene Route"
                className="min-w-0 flex-1"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                data-form-type="other"
              />
              <button
                type="button"
                onClick={() => setBearerToken(genHealthToken())}
                className="btn btn--ghost shrink-0 !text-[var(--fg-dim)]"
              >
                {bearerToken ? "neu" : "generieren"}
              </button>
              {bearerToken && <CopyField value={bearerToken} label="kopieren" />}
            </div>
            <p className={hint}>
              Alerd sendet ihn beim Pollen als <code>Authorization: Bearer …</code> — leg genau diesen Token
              in deiner App als erwarteten Wert ab. Leer lassen, wenn die Route offen ist.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>antwortzeit → orange ab (ms)</Label>
              <input name="degradedAboveMs" type="number" defaultValue={monitor?.degradedAboveMs ?? ""} placeholder="Fallback, optional" />
            </div>
            <div>
              <Label>antwortzeit → rot ab (ms)</Label>
              <input name="downAboveMs" type="number" defaultValue={monitor?.downAboveMs ?? ""} placeholder="Fallback, optional" />
            </div>
          </div>
        </div>
      )}

      {(kind === "HTTP" || kind === "KEYWORD") && (
        <div>
          <Label>http-methode</Label>
          <input name="method" defaultValue={monitor?.method ?? "GET"} placeholder="GET" />
        </div>
      )}

      {kind === "HTTP" && (
        <div>
          <Label>erwarteter status</Label>
          <input name="expectedStatus" type="number" defaultValue={monitor?.expectedStatus ?? ""} placeholder="leer = jeder 2xx zählt als UP" />
        </div>
      )}

      {kind === "KEYWORD" && (
        <div>
          <Label>suchtext im body</Label>
          <input name="keyword" defaultValue={monitor?.keyword ?? ""} placeholder='z. B. "ok"' />
        </div>
      )}

      {kind === "PUSH" ? (
        <p className={`${hint} panel p-4`}>
          Push wird nicht gepollt — die Quelle schickt Events selbst. Die Ingest-URL
          zum Eintragen (z. B. in Coolifys Webhook-Notification) erscheint nach dem
          Speichern auf der Monitor-Detailseite.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>intervall (sek)</Label>
            <input name="intervalSec" type="number" min={5} defaultValue={monitor?.intervalSec ?? 60} />
          </div>
          <div>
            <Label>timeout (ms)</Label>
            <input name="timeoutMs" type="number" min={100} defaultValue={monitor?.timeoutMs ?? 10000} />
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input name="enabled" type="checkbox" defaultChecked={monitor?.enabled ?? true} />
        <span className="font-medium text-[var(--fg-dim)]">
          {kind === "PUSH" ? "aktiv (nimmt Events an)" : "aktiv (wird gepollt)"}
        </span>
      </label>

      <div className="flex gap-3 pt-2">
        <button type="submit" className="btn">{submitLabel}</button>
        <a href="/services" className="btn btn--ghost !text-[var(--fg-dim)]">abbrechen</a>
      </div>
    </form>
  );
}
