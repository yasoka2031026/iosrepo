import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DpapiCredentialStore, EnvCredentialStore } from "../src/credentials/credentialStore.js";

describe("EnvCredentialStore (PoC backend, §4.6)", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalEnv;
  });

  it("returns null when nothing is set", async () => {
    const store = new EnvCredentialStore();
    expect(await store.getApiKey()).toBeNull();
  });

  it("reads from the environment variable by default", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-from-env";
    const store = new EnvCredentialStore();
    expect(await store.getApiKey()).toBe("sk-test-from-env");
  });

  it("setApiKey overrides the environment variable, clearApiKey reverts to it", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-env";
    const store = new EnvCredentialStore();
    await store.setApiKey("sk-override");
    expect(await store.getApiKey()).toBe("sk-override");
    await store.clearApiKey();
    expect(await store.getApiKey()).toBe("sk-env");
  });
});

describe("DpapiCredentialStore (production backend, Windows-only)", () => {
  it("throws rather than silently degrading on a non-Windows platform", async () => {
    const store = new DpapiCredentialStore();
    await expect(store.getApiKey()).rejects.toThrow(/DPAPI/);
  });
});
