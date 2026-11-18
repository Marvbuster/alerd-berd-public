import { describe, expect, it } from "vitest";
import { extractTopLevel } from "./npm-packument";

async function* split(text: string, size: number) { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }

const doc = {
  _id: "demo", name: "demo", "dist-tags": { latest: "2.0.0", next: "3.0.0-rc.1" },
  versions: { "1.0.0": { name: "demo", time: "nicht dieser", scripts: { build: "echo \"}{\"" } }, "2.0.0": { "dist-tags": { latest: "x" } } },
  time: { created: "2020-01-01T00:00:00.000Z", "1.0.0": "2020-01-02T00:00:00.000Z", "2.0.0": "2021-01-01T00:00:00.000Z" },
  readme: "Text mit \"time\": {\"1.0.0\": \"falsch\"} und Klammern ]]}}",
};

describe("extractTopLevel", () => {
  it("liest nur time und dist-tags der obersten Ebene, auch über beliebige Chunk-Grenzen", async () => {
    const text = JSON.stringify(doc, null, 1);
    for (const size of [1, 3, 7, 64, text.length]) {
      const out = await extractTopLevel(split(text, size));
      expect(out).toEqual({ "dist-tags": doc["dist-tags"], time: doc.time });
    }
  });
  it("liefert leer, wenn die Felder fehlen", async () => {
    expect(await extractTopLevel(split(JSON.stringify({ name: "x", versions: {} }), 5))).toEqual({});
  });
});
