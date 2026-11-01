import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, sha256Hex, newSessionToken } from "../src/worker/crypto";
import { credentialsSchema } from "../src/shared/schemas";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const { hash, salt } = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash, salt)).toBe(true);
    expect(await verifyPassword("wrong horse", hash, salt)).toBe(false);
  });

  it("uses a fresh salt for each hash", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).toHaveLength(32); // 16 random bytes as hex
  });
});

describe("session tokens", () => {
  it("generates 32-byte hex tokens that differ each time", () => {
    const t1 = newSessionToken();
    const t2 = newSessionToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });

  it("stores only a SHA-256 digest, never the raw token", async () => {
    const token = newSessionToken();
    const digest = await sha256Hex(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(token);
  });
});

describe("credentials validation", () => {
  it("normalises email and rejects short passwords", () => {
    const ok = credentialsSchema.parse({ email: "  Student@Example.COM ", password: "longenough" });
    expect(ok.email).toBe("student@example.com");
    expect(credentialsSchema.safeParse({ email: "a@b.co", password: "short" }).success).toBe(false);
    expect(credentialsSchema.safeParse({ email: "not-an-email", password: "longenough" }).success).toBe(false);
  });
});
