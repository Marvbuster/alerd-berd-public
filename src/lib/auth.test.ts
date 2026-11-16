import { describe, it, expect } from "vitest";
import { sha256hex } from "./auth";

describe("sha256hex", () => {
  it("bekannte Vektoren (NIST)", async () => {
    expect(await sha256hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("64 Hex-Zeichen, lowercase", async () => {
    const h = await sha256hex("alerd");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("deterministisch + inputsensitiv", async () => {
    expect(await sha256hex("x")).toBe(await sha256hex("x"));
    expect(await sha256hex("x")).not.toBe(await sha256hex("y"));
  });
});
