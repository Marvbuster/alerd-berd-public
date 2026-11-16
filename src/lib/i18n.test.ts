import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import { acceptedLocale, defaultLocale, resolveLocale } from "@/i18n/locale";
import { messageCode, translate, translateMessage } from "@/i18n/translate";
import { analysisRecommendation, analysisRisk, dependencyPhase, isBaselineMessage, isLiveSeenMessage } from "./dependency-phase";
import { dependencyPushText, languagePrompt } from "../../scripts/dependency-worker-lib.mjs";

function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  return Object.assign({}, ...Object.entries(value as object).map(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key)));
}
function argumentsOf(ast: ReturnType<IntlMessageFormat["getAst"]>): string[] {
  const names = new Set<string>();
  for (const element of ast) {
    if (element.type !== 0 && "value" in element && typeof element.value === "string") names.add(element.value);
    if ("options" in element) for (const option of Object.values(element.options)) for (const name of argumentsOf(option.value)) names.add(name);
  }
  return [...names].sort();
}

describe("message catalogs", () => {
  const german = flatten(de), english = flatten(en);
  it("has identical namespaces and keys", () => {
    expect(Object.keys(english).sort()).toEqual(Object.keys(german).sort());
  });
  it.each(Object.keys(german))("%s is valid ICU with identical arguments", key => {
    const a = new IntlMessageFormat(german[key], "de", undefined, { ignoreTag: true });
    const b = new IntlMessageFormat(english[key], "en", undefined, { ignoreTag: true });
    expect(argumentsOf(b.getAst())).toEqual(argumentsOf(a.getAst()));
  });
  it("localizes stable action codes, including nested messages", () => {
    const code = messageCode("actions.m59f13e83da");
    expect(code).not.toContain("Name ist Pflicht");
    expect(translateMessage("de", code)).toBe("Name ist Pflicht.");
    expect(translateMessage("en", code)).toBe("Name is required.");
    expect(translateMessage("en", "A technical error")).toBe("A technical error");
    expect(translateMessage("en", "i18n:invalid")).toBe("i18n:invalid");
  });
});

describe("locale cascade", () => {
  it("uses cookie, account, browser, environment, then English", () => {
    expect(resolveLocale({ cookie: "de", user: "en", acceptLanguage: "en", fallback: "en" })).toBe("de");
    expect(resolveLocale({ cookie: "fr", user: "de", acceptLanguage: "en" })).toBe("de");
    expect(resolveLocale({ user: "fr", acceptLanguage: "de-CH;q=0.9,en;q=0.8", fallback: "en" })).toBe("de");
    expect(resolveLocale({ acceptLanguage: "fr", fallback: "de" })).toBe("de");
    expect(defaultLocale("unsupported")).toBe("en");
  });
  it("respects quality values and ignores rejected or malformed language ranges", () => {
    expect(acceptedLocale("de;q=0,en-GB;q=0.8")).toBe("en");
    expect(acceptedLocale("fr;q=1,de;q=0.2,en;q=0.9")).toBe("en");
    expect(acceptedLocale("en;q=no,de;q=0.5")).toBe("de");
    expect(acceptedLocale("*")).toBeNull();
  });
});

describe("bilingual assistant and worker", () => {
  it.each([["sicher", "safe"], ["prüfen", "review"], ["riskant", "risky"]])("normalizes %s and %s", (german, english) => {
    expect(analysisRisk(`## Risiko\n${german}`)).toBe(german);
    expect(analysisRisk(`## Risk\n${english}`)).toBe(german);
    expect(analysisRisk(`**Risk:** ${english}`)).toBe(german);
  });
  it("finds English recommendations without treating review as safe", () => {
    const text = "## Risk\nsafe\n\n## Rationale\nNo breaking change.\n\n## Recommendation\nprepare";
    expect(analysisRecommendation(text)).toEqual({ safe: true, recommendation: "## Recommendation\nprepare" });
    expect(analysisRecommendation(text.replace("safe", "review")).safe).toBe(false);
    expect(analysisRecommendation("No evidence").safe).toBe(false);
  });
  it("recognizes stored German and English baseline and live markers", () => {
    for (const locale of ["de", "en"]) {
      expect(isBaselineMessage(translate(locale, "dependency_phase.baselinePrefix") + " npm ci")).toBe(true);
      expect(isLiveSeenMessage(translate(locale, "dependency_phase.liveSeenPrefix") + " 1.2.3")).toBe(true);
    }
  });
  it("uses the owner's language for worker push and prompts", () => {
    expect(dependencyPushText("READY_TO_PUSH", { appName: "App", label: "Next 16" }, "en")?.title).toBe("App: update prepared");
    const prompt = "Antworte auf Deutsch mit Risiko (sicher/prüfen/riskant), Begründung, Quellen mit URL, Unsicherheiten und Empfehlung.";
    expect(languagePrompt("de", prompt)).toBe(prompt);
    expect(languagePrompt("en", prompt)).toContain("Respond entirely in English");
    expect(languagePrompt("en", prompt)).toContain("Risk (safe/review/risky)");
  });
  it("localizes phases without changing status or actor codes", () => {
    const phase = dependencyPhase({ status: "READY_TO_PUSH", updatedAt: new Date(), workerLockedUntil: null, workerAttemptAt: null, lastError: null }, new Date(), {}, "en");
    expect(phase.actor).toBe("user");
    expect(phase.title).toBe("Your turn");
    expect(phase.detail).toContain("All checks passed");
  });
});
