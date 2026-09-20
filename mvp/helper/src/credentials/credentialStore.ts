/**
 * Blueprint §4.6: API keys must never live in the browser extension's
 * `chrome.storage` (plaintext). They belong to the local helper only.
 *
 * `DpapiCredentialStore` is the production backend (Windows DPAPI,
 * per-user encryption) and cannot run in this Linux sandbox — it throws
 * rather than silently falling back to something weaker. `EnvCredentialStore`
 * is an explicit, clearly-labeled PoC/dev substitute for this repository and
 * for local development on non-Windows machines; it must not be treated as
 * the production credential backend.
 */
export interface CredentialStore {
  readonly backend: string;
  getApiKey(): Promise<string | null>;
  setApiKey(apiKey: string): Promise<void>;
  clearApiKey(): Promise<void>;
}

export class EnvCredentialStore implements CredentialStore {
  readonly backend = "env-var-poc";
  private inMemoryOverride: string | null = null;

  constructor(private readonly envVarName = "ANTHROPIC_API_KEY") {}

  async getApiKey(): Promise<string | null> {
    return this.inMemoryOverride ?? process.env[this.envVarName] ?? null;
  }

  async setApiKey(apiKey: string): Promise<void> {
    this.inMemoryOverride = apiKey;
  }

  async clearApiKey(): Promise<void> {
    this.inMemoryOverride = null;
  }
}

export class DpapiCredentialStore implements CredentialStore {
  readonly backend = "windows-dpapi";

  async getApiKey(): Promise<string | null> {
    throw new Error(
      "DpapiCredentialStore requires Windows DPAPI (CryptProtectData) and is not implemented in this " +
        "cross-platform PoC. See docs/steam-jp-realtime-translation-blueprint.md §4.6."
    );
  }

  async setApiKey(): Promise<void> {
    throw new Error("DpapiCredentialStore is not implemented in this PoC (Windows-only, §4.6).");
  }

  async clearApiKey(): Promise<void> {
    throw new Error("DpapiCredentialStore is not implemented in this PoC (Windows-only, §4.6).");
  }
}

export function createCredentialStore(): CredentialStore {
  return process.platform === "win32" ? new DpapiCredentialStore() : new EnvCredentialStore();
}
