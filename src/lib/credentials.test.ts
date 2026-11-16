import { afterEach, describe, expect, it, vi } from "vitest";
import { credentialsConfigured, decryptCredential, encryptCredential } from "./credentials";

afterEach(() => vi.unstubAllEnvs());

describe("encrypted credentials", () => {
  it("requires a dedicated 32-byte key", () => {
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
    expect(credentialsConfigured()).toBe(false);
    expect(() => encryptCredential("token", "owner:origin")).toThrow("64 Hex");
  });
  it("round trips with fresh IVs and binds ciphertext to its context", () => {
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "ab".repeat(32));
    const encrypted = encryptCredential("private-token", "alice:origin");
    expect(encrypted).not.toContain("private-token");
    expect(encryptCredential("private-token", "alice:origin")).not.toBe(encrypted);
    expect(decryptCredential(encrypted, "alice:origin")).toBe("private-token");
    expect(() => decryptCredential(encrypted, "bob:origin")).toThrow();
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptCredential(parts.join("."), "alice:origin")).toThrow();
    vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "cd".repeat(32));
    expect(() => decryptCredential(encrypted, "alice:origin")).toThrow();
  });
});
