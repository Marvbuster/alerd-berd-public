"use client";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useState, useEffect, useRef } from "react";
import { genHealthToken } from "@/lib/health-token";
import type { Monitor, MonitorKind } from "@prisma/client";
import { CopyField } from "@/components/CopyField";

// Seit dem Dienste-Konzept (2026-11-11) nur noch drei Arten. TCP, Keyword und
// Ping (nie implementiert) erscheinen nur noch beim Bearbeiten bestehender Monitore.
function KIND_OPTIONS(_locale: string = "de"): { value: MonitorKind; label: string; hint: string; legacy?: boolean }[] { return ([
  { value: "HEALTH", label: _t(_locale, "MonitorForm.me6f5858c68"), hint: _t(_locale, "MonitorForm.mab419ae73b") },
  { value: "HTTP", label: _t(_locale, "MonitorForm.mbecf4edf10"), hint: _t(_locale, "MonitorForm.m5279c17454") },
  { value: "PUSH", label: _t(_locale, "MonitorForm.m731ce7ed80"), hint: _t(_locale, "MonitorForm.m4c6e4cc0d5") },
  { value: "KEYWORD", label: _t(_locale, "MonitorForm.mf734b5a889"), hint: _t(_locale, "MonitorForm.m6fbf51add3"), legacy: true },
  { value: "TCP", label: _t(_locale, "MonitorForm.mac281519eb"), hint: _t(_locale, "MonitorForm.m33b63d4520"), legacy: true },
  { value: "PING", label: _t(_locale, "MonitorForm.m211d4e9ea6"), hint: _t(_locale, "MonitorForm.mecbf945472"), legacy: true },
]); }

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
  const _locale = _useLocale();
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
    kind === "TCP" ? _t(_locale, "MonitorForm.m8b684251c5")
    : kind === "PING" ? _t(_locale, "MonitorForm.md2ae9ac639")
    : kind === "PUSH" ? _t(_locale, "MonitorForm.m1930c61458")
    : _t(_locale, "MonitorForm.mcc6bc568dd");

  return (
    <form action={action} className="space-y-5">
      <div>
        <Label>{_t(_locale, "MonitorForm.mdcd1d5223f")}</Label>
        <input name="name" required defaultValue={monitor?.name ?? ""} placeholder={_t(_locale, "MonitorForm.mf00d2842c3")} />
      </div>

      <div>
        <Label>{_t(_locale, "MonitorForm.m10fda91c23")}</Label>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as MonitorKind)}>
          {KIND_OPTIONS(_locale).filter((o) => !o.legacy || o.value === monitor?.kind).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className={hint}>{KIND_OPTIONS(_locale).find((o) => o.value === kind)?.hint}</p>
      </div>

      <div>
        <Label>{_t(_locale, "MonitorForm.mf487ce3960")}</Label>
        <input name="target" required defaultValue={monitor?.target ?? ""} placeholder={targetHint} />
        <p className={hint}>{targetHint}</p>
      </div>

      {kind === "HEALTH" && (
        <div className="panel space-y-5 p-4">
          <p className="text-sm font-semibold text-[var(--fg-dim)]">{_t(_locale, "MonitorForm.m340148d444")}</p>
          <div>
            <Label>{_t(_locale, "MonitorForm.mff927ac76b")}</Label>
            <input name="healthPath" defaultValue={monitor?.healthPath ?? "/health"} placeholder={_t(_locale, "MonitorForm.m0587c50e30")} />
            <p className={hint}>{_t(_locale, "MonitorForm.mc616f0e7f6")}</p>
          </div>
          <div>
            <Label>{_t(_locale, "MonitorForm.mfea84c8972")}</Label>
            <div className="flex items-center gap-2">
              {/* Passwort-Manager (1Password/LastPass/Bitwarden) via data-*-ignore
                  überspringen — das Feld ist ein API-Token, kein Login; Autofill
                  überschrieb es sonst mit einem gespeicherten Passwort. */}
              <input
                name="bearerToken"
                type="text"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                placeholder={_t(_locale, "MonitorForm.m533ce04d17")}
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
                {bearerToken ? _t(_locale, "common.new") : _t(_locale, "common.generate")}
              </button>
              {bearerToken && <CopyField value={bearerToken} label={_t(_locale, "MonitorForm.mdb17ead3ed")} />}
            </div>
            <p className={hint}>
              {_t(_locale, "MonitorForm.md610fa2223")}<code>{_t(_locale, "MonitorForm.md28e460db7")}</code> {_t(_locale, "MonitorForm.m9f19a970f7")}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>{_t(_locale, "MonitorForm.m78a6011c70")}</Label>
              <input name="degradedAboveMs" type="number" defaultValue={monitor?.degradedAboveMs ?? ""} placeholder={_t(_locale, "MonitorForm.m29874fd4f0")} />
            </div>
            <div>
              <Label>{_t(_locale, "MonitorForm.ma1dceaea9e")}</Label>
              <input name="downAboveMs" type="number" defaultValue={monitor?.downAboveMs ?? ""} placeholder={_t(_locale, "MonitorForm.m29874fd4f0")} />
            </div>
          </div>
        </div>
      )}

      {(kind === "HTTP" || kind === "KEYWORD") && (
        <div>
          <Label>{_t(_locale, "MonitorForm.mb34a163c7f")}</Label>
          <input name="method" defaultValue={monitor?.method ?? "GET"} placeholder={_t(_locale, "MonitorForm.m14e30cd163")} />
        </div>
      )}

      {kind === "HTTP" && (
        <div>
          <Label>{_t(_locale, "MonitorForm.m4e2ed3c195")}</Label>
          <input name="expectedStatus" type="number" defaultValue={monitor?.expectedStatus ?? ""} placeholder={_t(_locale, "MonitorForm.mc2c5387cb8")} />
        </div>
      )}

      {kind === "KEYWORD" && (
        <div>
          <Label>{_t(_locale, "MonitorForm.m8cf06272e4")}</Label>
          <input name="keyword" defaultValue={monitor?.keyword ?? ""} placeholder={_t(_locale, "MonitorForm.m2a3dcb4a42")} />
        </div>
      )}

      {kind === "PUSH" ? (
        <p className={`${hint} panel p-4`}>
          {_t(_locale, "MonitorForm.m16994e6161")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>{_t(_locale, "MonitorForm.mce54603941")}</Label>
            <input name="intervalSec" type="number" min={5} defaultValue={monitor?.intervalSec ?? 60} />
          </div>
          <div>
            <Label>{_t(_locale, "MonitorForm.m0941fda287")}</Label>
            <input name="timeoutMs" type="number" min={100} defaultValue={monitor?.timeoutMs ?? 10000} />
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input name="enabled" type="checkbox" defaultChecked={monitor?.enabled ?? true} />
        <span className="font-medium text-[var(--fg-dim)]">
          {kind === "PUSH" ? _t(_locale, "MonitorForm.mdc2de7fb7a") : _t(_locale, "MonitorForm.m02739cea74")}
        </span>
      </label>

      <div className="flex gap-3 pt-2">
        <button type="submit" className="btn">{submitLabel}</button>
        <a href="/services" className="btn btn--ghost !text-[var(--fg-dim)]">{_t(_locale, "MonitorForm.mec9fdf7c14")}</a>
      </div>
    </form>
  );
}
