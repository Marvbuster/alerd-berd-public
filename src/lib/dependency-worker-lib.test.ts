import { describe, expect, it } from "vitest";
import {
  baselineHint, lockstepDrift, lockstepHint, needsPrismaGenerate, sandboxScripts, changedTypeNames, wordHits, npmResolveHint, clip, bumpKind, changelogSection, versionFromTag, importPatterns, parseGrepCounts, nextRelevantFiles, pickSourceFiles, typesTarget, changedTypeFiles, claudeArgs, commitSha, dependencyPushText, evaluateLive, jobLabel, jobPackages, validateManifestChanges, gitBranch, healthUrls, probeText, githubUrl, jobUids, liveFactsText, mergeBuildEnvNames, modelArg, packageDir, parseBuildEnv, parseStream, placeholderFor, repositoryPath, validateManifestChange,
} from "../../scripts/dependency-worker-lib.mjs";

const pkg = (deps: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "app", version: "1.0.0", scripts: { build: "next build" }, dependencies: deps, ...extra });

describe("validateManifestChange", () => {
  it("akzeptiert genau den next-Bump auf die Zielversion", () => {
    expect(() => validateManifestChange(pkg({ next: "16.4.5", react: "19.0.0" }), pkg({ next: "16.4.6", react: "19.0.0" }), "next", "16.4.6")).not.toThrow();
    expect(() => validateManifestChange(pkg({ next: "^16.4.5" }), pkg({ next: "^16.4.6" }), "next", "16.4.6")).not.toThrow();
  });

  it("lehnt andere Versionen, weitere Dependencies und Feldänderungen ab", () => {
    expect(() => validateManifestChange(pkg({ next: "16.4.5" }), pkg({ next: "16.4.7" }), "next", "16.4.6")).toThrow(/Zielversion/);
    expect(() => validateManifestChange(pkg({ next: "16.4.5", react: "19.0.0" }), pkg({ next: "16.4.6", react: "19.1.0" }), "next", "16.4.6")).toThrow(/Unerwartete/);
    expect(() => validateManifestChange(pkg({ next: "16.4.5" }), pkg({ next: "16.4.6" }, { scripts: { postinstall: "curl evil" } }), "next", "16.4.6")).toThrow(/scripts/);
    expect(() => validateManifestChange(pkg({ next: "16.4.5" }), pkg({ next: "16.4.5" }), "next", "16.4.6")).toThrow(/keine Änderung für next/);
  });

  it("behandelt Punkte und Pluszeichen der Zielversion wörtlich", () => {
    expect(() => validateManifestChange(pkg({ next: "16.4.5" }), pkg({ next: "16x4x6" }), "next", "16.4.6")).toThrow();
    expect(() => validateManifestChange(pkg({ next: "16.4.5" }), pkg({ next: "16.5.0-canary.1+abc" }), "next", "16.5.0-canary.1+abc")).not.toThrow();
  });
});

describe("Eingaben aus Coolify/GitHub", () => {
  it("lässt nur GitHub-owner/repo zu", () => {
    expect(githubUrl("Marvbuster/alerd-board")).toBe("https://github.com/Marvbuster/alerd-board.git");
    expect(() => githubUrl("../etc")).toThrow();
    expect(() => githubUrl("a/b c")).toThrow();
  });

  it("weist Option-Injection und Pfadflucht ab", () => {
    expect(() => gitBranch("--upload-pack=x")).toThrow();
    expect(() => gitBranch("main..x")).toThrow();
    expect(gitBranch("release/16.x")).toBe("release/16.x");
    expect(() => commitSha("HEAD")).toThrow();
    expect(() => repositoryPath("../package.json", "Manifest", "package.json")).toThrow();
    expect(() => repositoryPath("/etc/package.json", "Manifest", "package.json")).toThrow();
    expect(() => repositoryPath("evilpackage.json", "Manifest", "package.json")).toThrow();
    expect(repositoryPath("./admin/package.json", "Manifest", "package.json")).toBe("admin/package.json");
  });

  it("verlangt Manifest und Lockfile im selben Verzeichnis", () => {
    expect(packageDir({ manifestPath: "admin/package.json", lockfilePath: "admin/package-lock.json" })).toBe("admin");
    expect(packageDir({ manifestPath: "package.json", lockfilePath: "package-lock.json" })).toBe("");
    expect(() => packageDir({ manifestPath: "admin/package.json", lockfilePath: "package-lock.json" })).toThrow();
  });
});

describe("Isolation und Claude-Aufruf", () => {
  it("vergibt pro Job stabile, getrennte UIDs außerhalb des System-Bereichs", () => {
    const a = jobUids("cmh123"), b = jobUids("cmh123");
    expect(a).toEqual(b);
    expect(a.claude).toBe(a.build + 1);
    expect(a.build).toBeGreaterThanOrEqual(200_000);
    expect(a.build % 2).toBe(0);
  });

  it("nutzt den Opus-Alias und gibt WebFetch gezielt frei", () => {
    expect(modelArg("claude-opus-4-8")).toBe("opus");
    expect(modelArg(undefined)).toBe("opus");
    expect(() => modelArg("--dangerously")).toThrow();
    const args = claudeArgs({ prompt: "x", model: "opus", sessionId: null });
    expect(args).toEqual(expect.arrayContaining(["--restricted", "--permission-mode", "plan", "--tools", "Read,Glob,Grep,WebFetch,WebSearch"]));
    expect(args.join(" ")).not.toMatch(/Bash|Edit|Write/);
    expect(claudeArgs({ prompt: "x", model: "opus", sessionId: "0d8f6c2e-1a2b-4c3d-9e8f-123456789abc" })).toContain("--resume");
    expect(() => claudeArgs({ prompt: "x", model: "opus", sessionId: "--x" })).toThrow();
  });

  it("liest Antwort und Session-ID aus stream-json", () => {
    const stream = [
      JSON.stringify({ type: "system", session_id: "s-1" }),
      "kein json",
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Risiko: sicher" }] } }),
      JSON.stringify({ type: "result", session_id: "s-1", result: "Risiko: sicher", num_turns: 2, duration_ms: 740, usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 300, cache_creation_input_tokens: 60 } }),
    ].join("\n");
    expect(parseStream(stream)).toEqual({
      sessionId: "s-1", text: "Risiko: sicher",
      usage: { reported: true, inputTokens: 120, outputTokens: 40, cacheReadTokens: 300, cacheCreationTokens: 60, totalTokens: 520, turns: 2, durationMs: 740 },
    });
    expect(parseStream("").text).toMatch(/keine Textantwort/);
    expect(parseStream("").usage.reported).toBe(false);
  });
});

describe("evaluateLive", () => {
  const publishedAt = new Date("2026-11-11T20:00:00Z");
  const at = (minutes: number) => new Date(publishedAt.getTime() + minutes * 60_000);
  const monitor = (extra: Record<string, unknown> = {}) => ({ name: "Example Server", enabled: true, version: "16.4.6", status: "UP", reportedAt: at(3), incidents: 0, ...extra });

  it("ist live, wenn jeder meldende Monitor frisch die Zielversion zeigt", () => {
    expect(evaluateLive({ targetVersion: "16.4.6", publishedAt, now: at(4), monitors: [monitor()] }).state).toBe("live");
    expect(evaluateLive({ targetVersion: "16.4.6", publishedAt, now: at(4), monitors: [monitor({ status: "DEGRADED" })] }).state).toBe("live");
  });

  it("wartet auf alte Version, alte Meldung oder einen DOWN-Monitor", () => {
    for (const m of [monitor({ version: "16.4.5" }), monitor({ reportedAt: at(-1) }), monitor({ status: "DOWN" })]) {
      expect(evaluateLive({ targetVersion: "16.4.6", publishedAt, now: at(5), monitors: [m] }).state).toBe("waiting");
    }
  });

  it("wartet, bis der Deploy sich gesetzt hat (alter Container weg)", () => {
    const fresh = evaluateLive({ targetVersion: "16.4.6", publishedAt, now: at(4), monitors: [monitor({ firstSeenAt: at(3) })] });
    expect(fresh).toMatchObject({ state: "waiting", settling: true });
    expect(evaluateLive({ targetVersion: "16.4.6", publishedAt, now: at(5.5), monitors: [monitor({ firstSeenAt: at(3) })] }).state).toBe("live");
  });

  it("meldet nach dem Timeout den konkreten Grund", () => {
    const result = evaluateLive({ targetVersion: "16.4.6", publishedAt, now: at(31), monitors: [monitor({ version: "16.4.5" })] });
    expect(result.state).toBe("timeout");
    expect(result.reason).toMatch(/meldet weiter 16\.4\.5/);
  });

  it("kann ohne meldenden Monitor nichts verifizieren", () => {
    expect(evaluateLive({ targetVersion: "16.4.6", publishedAt, now: at(1), monitors: [] }).state).toBe("unmonitored");
    expect(evaluateLive({ targetVersion: "16.4.6", publishedAt, now: at(1), monitors: [monitor({ enabled: false })] }).state).toBe("unmonitored");
  });

  it("fasst die Fakten für Claude zusammen", () => {
    expect(liveFactsText([{ name: "A", version: "16.4.6", status: "UP", fresh: true, incidents: 0 }], "16.4.6")).toMatch(/A: meldet 16\.4\.6 \(Ziel\), Status UP, keine Incidents/);
  });
});

describe("Health-Messung nach dem Deploy", () => {
  it("baut nur sichere https-Ziele aus den Coolify-Domains", () => {
    expect(healthUrls("https://app.example.com,https://www.example.com")).toEqual(["https://app.example.com/api/health", "https://www.example.com/api/health"]);
    expect(healthUrls("http://a.example.com https://10.0.0.1 https://localhost https://intern")).toEqual([]);
    expect(healthUrls("app.example.com")).toEqual(["https://app.example.com/api/health"]);
    expect(healthUrls(null)).toEqual([]);
    expect(healthUrls("https://a.de,https://b.de,https://c.de,https://d.de")).toHaveLength(3);
  });

  it("gibt Claude Header und flache Felder als Fakten", () => {
    const text = probeText([{ url: "https://a.de/api/health", status: 200, encoding: "gzip", type: "application/json", json: { status: "ok", uptimeSeconds: 238, nested: { x: 1 } } }]);
    expect(text).toMatch(/HTTP 200, content-encoding: gzip/);
    expect(text).toMatch(/uptimeSeconds=238/);
    expect(text).not.toMatch(/nested/);
    expect(probeText([{ url: "https://a.de/api/health", error: "Timeout" }])).toMatch(/fehlgeschlagen \(Timeout\)/);
  });
});

describe("Build-Variablen", () => {
  it("liest NAME=wert, Kommentare und Anführungszeichen", () => {
    expect(parseBuildEnv("# Platzhalter\nDATABASE_URI=mongodb://x\nPAYLOAD_SECRET=\"abc\"\nEMPTY")).toEqual({ DATABASE_URI: "mongodb://x", PAYLOAD_SECRET: "abc", EMPTY: "" });
  });
  it("lehnt Sandbox-Variablen und kaputte Namen ab", () => {
    expect(() => parseBuildEnv("NODE_OPTIONS=--require x")).toThrow(/nicht erlaubt/);
    expect(() => parseBuildEnv("LD_PRELOAD=/x.so")).toThrow(/nicht erlaubt/);
    expect(() => parseBuildEnv("1BAD=x")).toThrow(/Ungültiger/);
  });
  it("wählt passende Platzhalter", () => {
    expect(placeholderFor("DATABASE_URI")).toBe("postgres://dummy:dummy@localhost:5432/dummy");
    expect(placeholderFor("MONGODB_URI")).toMatch(/^mongodb:/);
    expect(placeholderFor("PAYLOAD_SECRET").length).toBeGreaterThan(32);
    expect(placeholderFor("NEXT_PUBLIC_SERVER_URL")).toBe("https://example.invalid");
  });
  it("ergänzt nur fehlende Namen", () => {
    expect(mergeBuildEnvNames("DATABASE_URI=mongodb://x", ["DATABASE_URI", "PAYLOAD_SECRET", "PATH"])).toBe("DATABASE_URI=mongodb://x\nPAYLOAD_SECRET=dummy-build-placeholder-0123456789abcdef");
  });
});

describe("dependencyPushText", () => {
  it("meldet nur Schritte, bei denen du dran bist oder die enden", () => {
    expect(dependencyPushText("READY_FOR_REVIEW", { appName: "Weedscore", label: "Next 16.4.6" })).toEqual({ title: "Weedscore: Analyse fertig", body: "Next 16.4.6 ist analysiert, du bist dran." });
    expect(dependencyPushText("ANALYZING", { appName: "x", label: "x 1.0.0" })).toBeNull();
    expect(dependencyPushText("RUNNING", { appName: "x", label: "x 1.0.0" })).toBeNull();
  });
});

describe("gebündelte Updates", () => {
  const before = JSON.stringify({ name: "app", dependencies: { next: "16.4.5", jose: "^6.2.3", zod: "^4.4.3" } });
  it("erlaubt genau die freigegebenen Pakete", () => {
    const after = JSON.stringify({ name: "app", dependencies: { next: "16.4.6", jose: "^6.2.4", zod: "^4.4.3" } });
    expect(() => validateManifestChanges(before, after, [{ name: "next", version: "16.4.6" }, { name: "jose", version: "6.2.4" }])).not.toThrow();
    expect(() => validateManifestChanges(before, after, [{ name: "next", version: "16.4.6" }])).toThrow(/Unerwartete/);
  });
  it("verlangt eine Änderung für jedes Paket", () => {
    const after = JSON.stringify({ name: "app", dependencies: { next: "16.4.6", jose: "^6.2.3", zod: "^4.4.3" } });
    expect(() => validateManifestChanges(before, after, [{ name: "next", version: "16.4.6" }, { name: "jose", version: "6.2.4" }])).toThrow(/jose/);
  });
  it("liest alte und neue Jobs und benennt sie kurz", () => {
    expect(jobPackages({ packageName: "next", targetVersion: "16.4.6" })).toEqual([{ name: "next", version: "16.4.6", from: null }]);
    const list = jobPackages({ packageName: "next", targetVersion: "16.4.6", packages: [{ name: "jose", version: "6.2.4", from: "6.2.3" }, { name: "bad name", version: "1" }] });
    expect(list).toEqual([{ name: "jose", version: "6.2.4", from: "6.2.3" }]);
    expect(jobLabel([{ name: "next", version: "16.4.6" }, { name: "jose", version: "6.2.4" }])).toBe("Next 16.4.6, jose 6.2.4");
    expect(jobLabel([{ name: "a", version: "1.0.0" }, { name: "b", version: "1.0.0" }, { name: "c", version: "1.0.0" }])).toBe("3 Pakete");
  });
});

describe("Kontext der lokalen Analyse", () => {
  it("liest Versionen aus Release-Tags, auch in Monorepos", () => {
    expect(versionFromTag("v19.2.9", "react")).toBe("19.2.9");
    expect(versionFromTag("6.2.17", "jose")).toBe("6.2.17");
    expect(versionFromTag("@tailwindcss/postcss@4.3.5", "@tailwindcss/postcss")).toBe("4.3.5");
    expect(versionFromTag("@tailwindcss/vite@4.3.5", "@tailwindcss/postcss")).toBeNull();
    expect(versionFromTag("nightly", "react")).toBeNull();
  });

  it("schneidet den Changelog zwischen Ziel- und Ausgangsversion aus", () => {
    const text = "# Changelog\n\n## [4.3.5] - 2026-10-01\n- Fix A\n\n## 4.3.4\n- Fix B\n\n## [4.3.0]\n- Alt\n";
    expect(changelogSection(text, "4.3.0", "4.3.5")).toBe("## [4.3.5] - 2026-10-01\n- Fix A\n\n## 4.3.4\n- Fix B");
    expect(changelogSection(text, "4.3.0", "4.3.50")).toBe("");
    expect(changelogSection(text, "4.3.0", "4.3")).toBe("");
  });

  it("benennt die Art des Sprungs", () => {
    expect(bumpKind("19.2.4", "19.2.9")).toBe("Patch");
    expect(bumpKind("4.3.0", "4.4.1")).toBe("Minor");
    expect(bumpKind("15.5.0", "16.0.0")).toBe("Major");
    expect(bumpKind(null, "1.0.0")).toBe("unbekannt");
  });
});

describe("Quelltext für die lokale Analyse", () => {
  it("zählt Import-Spezifizierer und liest git grep -c", () => {
    expect(importPatterns("jose")).toContain('from "jose"');
    expect(importPatterns("jose")).toContain("import('jose/");
    expect(importPatterns("jose")).toHaveLength(16);
    expect(parseGrepCounts("lib/session.ts:3\nsrc/a:b.ts:1\nkaputt\nx.ts:0\n")).toEqual([{ path: "lib/session.ts", count: 3 }, { path: "src/a:b.ts", count: 1 }]);
  });

  it("findet bei next Proxy, Config und Route-Handler", () => {
    expect(nextRelevantFiles(["src/app/api/x/route.test.ts", "src/proxy.ts", "next.config.mjs", "src/app/api/health/route.ts", "app/route.js", "src/app/page.tsx", "node_modules/x/route.ts", "src/lib/router.ts"]))
      .toEqual(["src/proxy.ts", "next.config.mjs", "src/app/api/health/route.ts", "app/route.js"]);
  });

  it("wählt abwechselnd pro Paket, ohne Doppelte und ohne Lockfiles", () => {
    const picked = pickSourceFiles([
      { pkg: "react", files: [{ path: "a.tsx", count: 9 }, { path: "b.tsx", count: 8 }, { path: "c.tsx", count: 7 }, { path: "package.json", count: 99 }, { path: "src/a.test.tsx", count: 99 }] },
      { pkg: "jose", files: [{ path: "lib/session.ts", count: 2 }, { path: "a.tsx", count: 1 }, { path: "../etc/passwd", count: 50 }] },
    ], 3);
    expect(picked).toEqual([{ path: "a.tsx", pkgs: ["react", "jose"] }, { path: "lib/session.ts", pkgs: ["jose"] }, { path: "b.tsx", pkgs: ["react"] }]);
  });
});

describe("Typ-Diff für @types-Pakete", () => {
  it("findet das Paket, das im Code importiert wird", () => {
    expect(typesTarget("@types/heic-convert")).toBe("heic-convert");
    expect(typesTarget("@types/babel__core")).toBe("@babel/core");
    expect(typesTarget("@types/node")).toBeNull();
    expect(typesTarget("react")).toBeNull();
  });

  it("vergleicht nur Typdateien und lädt nur geänderte", () => {
    const before = [{ name: "/index.d.ts", hash: "a", size: 500 }, { name: "/old.d.ts", hash: "x", size: 10 }, { name: "/README.md", hash: "r", size: 9 }, { name: "/same.d.ts", hash: "s", size: 5 }];
    const after = [{ name: "/index.d.ts", hash: "b", size: 563 }, { name: "/new.d.mts", hash: "n", size: 20 }, { name: "/README.md", hash: "r2", size: 9 }, { name: "/same.d.ts", hash: "s", size: 5 }];
    expect(changedTypeFiles(before, after)).toEqual({ total: 3, files: [
      { name: "/old.d.ts", status: "entfernt", size: 10 },
      { name: "/new.d.mts", status: "neu", size: 20 },
      { name: "/index.d.ts", status: "geändert", size: 563 },
    ] });
    expect(changedTypeFiles(before, after, 1).files).toHaveLength(1);
    const twins = changedTypeFiles([{ name: "/browser.d.ts", hash: "a", size: 1 }, { name: "/index.d.ts", hash: "a", size: 1 }], [{ name: "/browser.d.ts", hash: "b", size: 1 }, { name: "/index.d.ts", hash: "b", size: 1 }]);
    expect(twins.files.map((f) => f.name)).toEqual(["/browser.d.ts"]);
  });
});

describe("baselineHint", () => {
  const repo = "/data/dependency-workspaces/jobs/o1/j1/repo";
  it("Datei außerhalb des Repos: Einzel-Klon statt Env", () => {
    const out = "Error: ENOENT: no such file or directory, open '/data/dependency-workspaces/jobs/o1/j1/specs/x3dh-vectors.json'";
    const hint = baselineHint(out, repo);
    expect(hint).toContain("../specs/x3dh-vectors.json");
    expect(hint).toContain("außerhalb des Repos");
    expect(hint).not.toContain("Env-Variable");
  });
  it("Datei im Repo fehlt: nicht eingecheckt", () => {
    expect(baselineHint(`ENOENT: no such file or directory, open '${repo}/fixtures/a.json'`, repo)).toContain("fixtures/a.json fehlt im Git-Stand");
  });
  it("fehlender Prisma-Client: Prisma-Hinweis statt allgemeinem Env-Hinweis", () => {
    expect(baselineHint("Type error: Module '\"@prisma/client\"' has no exported member 'PrismaClient'.", repo)).toContain("Prisma-Client");
  });
  it("Browser-Test in der Sandbox: Hinweis auf test:e2e", () => {
    expect(baselineHint("Your system is missing the dependency: Xvfb", repo)).toContain("test:e2e");
  });
  it("sonst der Env-Hinweis", () => {
    expect(baselineHint("Error: DATABASE_URL is not set", repo)).toContain("Build-Variablen");
  });
});

describe("npmResolveHint", () => {
  const err = "npm install fehlgeschlagen (1): npm error Cannot read properties of null (reading 'edgesOut')";
  it("nennt die vitest-Pakete", () => {
    expect(npmResolveHint(err, ["next", "vitest", "@vitest/coverage-v8"])).toContain("vitest und @vitest/coverage-v8 abwählen");
  });
  it("ohne vitest allgemein", () => {
    expect(npmResolveHint(err, ["next"])).toContain("Einzelne Pakete abwählen");
  });
  it("anderer Fehler: kein Hinweis", () => {
    expect(npmResolveHint("npm error code ERESOLVE", ["vitest"])).toBeNull();
  });
});

describe("clip", () => {
  const emoji = "ok 🙂";
  it("schneidet kein halbes Surrogat-Paar ab", () => {
    expect(clip(emoji, 4)).toBe("ok \uFFFD");
    expect(clip(emoji, 4).isWellFormed()).toBe(true);
  });
  it("Ende behalten, Anfang mitten im Emoji", () => {
    expect(clip("🙂 fertig", -8).isWellFormed()).toBe(true);
    expect(clip("🙂 fertig", -8).endsWith("fertig")).toBe(true);
  });
  it("kurzer Text bleibt gleich, null wird leer", () => {
    expect(clip("abc", 10)).toBe("abc");
    expect(clip(null, 10)).toBe("");
  });
});

describe("changedTypeNames", () => {
  const diff = [
    "--- a/a/server.d.ts", "+++ b/b/server.d.ts",
    "+export interface HeadersDescriptor {", "+    Link?: string;", "+}",
    "-    nonce?: string;", "+    nonce?: NonceOption | undefined;",
    "-    headersLengthHint?: number | undefined;", "+    maxHeadersLength?: number | undefined;",
    "-    onHeaders?: ((headers: Headers) => void) | undefined;",
    "-    options?: string;",
    "- * Kommentar mit renderToString: bleibt außen vor",
    "-export function renderToStaticMarkup(element: ReactNode): string;",
  ].join("\n");

  it("nimmt nur Namen aus entfernten oder geänderten Zeilen, ohne Kommentare und Allerweltsnamen", () => {
    expect(changedTypeNames(diff)).toEqual(["nonce", "headersLengthHint", "onHeaders", "renderToStaticMarkup"]);
  });

  it("findet nichts, wenn nur Kommentare oder neue Zeilen dazukommen", () => {
    expect(changedTypeNames("+export type Neu = string;\n- * alter Kommentar")).toEqual([]);
  });
});

describe("wordHits", () => {
  it("ordnet git-grep-Treffer den Namen zu und listet die ohne Treffer", () => {
    const out = "app/page.tsx:3:nonce\napp/page.tsx:9:nonce\nlib/x.ts:1:onHeaders\n";
    expect(wordHits(out, ["nonce", "onHeaders", "headersLengthHint"])).toEqual({
      treffer: { nonce: ["app/page.tsx:3", "app/page.tsx:9"], onHeaders: ["lib/x.ts:1"] },
      ohneTreffer: ["headersLengthHint"],
    });
  });
});

describe("needsPrismaGenerate", () => {
  const pkg = { dependencies: { "@prisma/client": "7.10.0" }, devDependencies: { prisma: "7.10.0" } };
  it("braucht Prisma-CLI und ein Schema", () => {
    expect(needsPrismaGenerate(pkg, new Set(["prisma/schema.prisma"]))).toBe(true);
    expect(needsPrismaGenerate(pkg, new Set(["prisma.config.ts"]))).toBe(true);
    expect(needsPrismaGenerate(pkg, new Set())).toBe(false);
    expect(needsPrismaGenerate({ dependencies: { "@prisma/client": "7.10.0" } }, new Set(["prisma/schema.prisma"]))).toBe(false);
  });
  it("beachtet einen eigenen Schema-Pfad aus package.json", () => {
    expect(needsPrismaGenerate({ ...pkg, prisma: { schema: "db/schema.prisma" } }, new Set(["db/schema.prisma"]))).toBe(true);
  });
});

describe("sandboxScripts", () => {
  it("überspringt Browser-Tests, Unit-Tests laufen", () => {
    expect(sandboxScripts({ build: "next build", test: "cypress run", lint: "eslint ." })).toEqual(["build"]);
    expect(sandboxScripts({ typecheck: "tsc --noEmit", build: "next build", test: "vitest run" })).toEqual(["typecheck", "build", "test"]);
    expect(sandboxScripts({ test: "playwright test" })).toEqual([]);
    expect(sandboxScripts({ test: "start-server-and-test dev 3000 cy:run" })).toEqual([]);
    expect(sandboxScripts(undefined)).toEqual([]);
  });
  it("eigene alerd:-Skripte haben Vorrang und laufen allein", () => {
    const scripts = { build: "next build && sentry-cli upload", test: "vitest run", "alerd:build": "next build", "alerd:test": "vitest run --dir src" };
    expect(sandboxScripts(scripts)).toEqual(["alerd:build", "alerd:test"]);
    expect(sandboxScripts({ test: "cypress run", "alerd:typecheck": "tsc --noEmit" })).toEqual(["alerd:typecheck"]);
  });
  it("andere alerd-Namen zählen nicht", () => {
    expect(sandboxScripts({ build: "next build", "alerd:lint": "eslint ." })).toEqual(["build"]);
  });
  it("ein Paket namens cypress-irgendwas allein ist kein Browser-Test", () => {
    expect(sandboxScripts({ test: "vitest run --dir cypress-utils" })).toEqual(["test"]);
  });
});

describe("lockstepDrift", () => {
  const lock = (domVersion: string) => ({
    packages: {
      "node_modules/framer-motion": { version: "12.7.5", dependencies: { tslib: "^2.4.0", "motion-dom": "^12.7.5", "motion-utils": "^12.7.5" } },
      "node_modules/motion-dom": { version: domVersion },
      "node_modules/motion-utils": { version: "12.7.5" },
      "node_modules/tslib": { version: "2.8.1" },
    },
  });
  const list = [{ name: "framer-motion", version: "12.7.5" }];

  it("findet ein Geschwister, das npm auf eine neuere Minor zieht", () => {
    expect(lockstepDrift(lock("12.43.0"), list)).toEqual([{ name: "framer-motion", version: "12.7.5", dep: "motion-dom", resolved: "12.43.0" }]);
    expect(lockstepHint(lockstepDrift(lock("12.43.0"), list))).toContain("framer-motion 12.7.5 passt zu motion-dom 12.7.x, npm nimmt aber motion-dom 12.43.0");
  });

  it("lässt passende Familien und fremde Carets in Ruhe", () => {
    expect(lockstepDrift(lock("12.7.6"), list)).toEqual([]);
    expect(lockstepHint([])).toBeNull();
    expect(lockstepDrift({ packages: { "node_modules/x": { version: "2.4.1", dependencies: { tslib: "^2.3.0" } }, "node_modules/tslib": { version: "2.8.1" } } }, [{ name: "x" }])).toEqual([]);
  });
});
