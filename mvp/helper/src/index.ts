#!/usr/bin/env node
/**
 * LiveYaku local helper entrypoint (blueprint §4.1/§4.2).
 *
 * Wires together: Native Messaging stdio protocol <-> protection detector /
 * profile matcher <-> translation pipeline. Speaks stdin/stdout exactly as
 * Chrome's Native Messaging host contract expects, so a real browser
 * extension can `chrome.runtime.connectNative` to this process unmodified
 * (see extension/src/background/nativePort.ts).
 *
 * NOT implemented here (Windows-only, cannot be built/run in this sandbox,
 * see mvp/README.md and docs/steam-jp-realtime-translation-blueprint.md):
 *   - hook-injector / hook-dll (real process injection, §4.3)
 *   - overlay-renderer (§4.4)
 *   - OCR fallback capture (§4.3.4)
 * In their place, capture/mockCaptureSource.ts can be wired in for demos.
 *
 * IMPORTANT: stdout is reserved for the Native Messaging binary protocol.
 * All diagnostic logging goes to stderr.
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

import { createCredentialStore } from "./credentials/credentialStore.js";
import { NativeMessagingStreamDecoder, encodeMessage } from "./ipc/nativeMessaging.js";
import { loadProfilesFromJson, matchProfile } from "./profiles/gameProfiles.js";
import { detectProtection, loadProtectionRegistryFromJson } from "./profiles/protectionRegistry.js";
import { TranslationCache } from "./translation/cache.js";
import { ClaudeTranslationClient, MockTranslationClient, type TranslationClient } from "./translation/claudeClient.js";
import { GlossaryStore } from "./translation/glossary.js";
import { TranslationPipeline } from "./translation/pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function log(message: string): void {
  process.stderr.write(`[liveyaku-helper] ${message}\n`);
}

async function main() {
  const gameProfiles = loadProfilesFromJson(
    JSON.parse(readFileSync(join(__dirname, "data/game_profiles.sample.json"), "utf8"))
  );
  const protectionRegistry = loadProtectionRegistryFromJson(
    JSON.parse(readFileSync(join(__dirname, "data/protection_registry.sample.json"), "utf8"))
  );

  const dbPath = process.env.LIVEYAKU_DB_PATH ?? ":memory:";
  const db = new DatabaseSync(dbPath);
  const glossary = new GlossaryStore(db);
  const cache = new TranslationCache(db);

  const credentialStore = createCredentialStore();
  const apiKey = await credentialStore.getApiKey().catch(() => null);
  let client: TranslationClient;
  if (apiKey) {
    client = new ClaudeTranslationClient({ apiKey });
    log(`translation client: Claude API (model=${client.modelId})`);
  } else {
    client = new MockTranslationClient();
    log("translation client: MOCK (no API key found via credential store; set ANTHROPIC_API_KEY for real translations)");
  }

  const pipeline = new TranslationPipeline({ glossary, cache, client });

  log(`loaded ${gameProfiles.length} game profile(s), ${protectionRegistry.length} protection registry entr(y/ies)`);
  log("listening on stdin for Native Messaging frames...");

  const decoder = new NativeMessagingStreamDecoder(
    (message) => void handleMessage(message),
    (error) => log(`decode error: ${error.message}`)
  );
  process.stdin.on("data", (chunk) => decoder.push(chunk));
  process.stdin.on("end", () => process.exit(0));

  async function handleMessage(message: unknown): Promise<void> {
    if (typeof message !== "object" || message === null || !("type" in message)) {
      process.stdout.write(encodeMessage({ error: "malformed_message" }));
      return;
    }
    const msg = message as Record<string, unknown>;
    const requestId = msg.requestId;
    const reply = (payload: Record<string, unknown>) =>
      process.stdout.write(encodeMessage({ ...payload, requestId }));
    try {
      switch (msg.type) {
        case "translate": {
          const result = await pipeline.translate({
            gameId: String(msg.gameId),
            sourceText: String(msg.sourceText),
            contextTag: (msg.contextTag as never) ?? "unknown",
          });
          reply({ type: "translate_result", result });
          return;
        }
        case "match_profile": {
          const result = matchProfile(String(msg.processName), gameProfiles);
          reply({ type: "match_profile_result", result });
          return;
        }
        case "detect_protection": {
          const result = detectProtection(
            { runningProcessNames: (msg.runningProcessNames as string[]) ?? [] },
            protectionRegistry
          );
          reply({ type: "detect_protection_result", result });
          return;
        }
        case "glossary_list": {
          const entries = glossary.listAll(msg.gameId ? String(msg.gameId) : undefined);
          reply({ type: "glossary_list_result", entries });
          return;
        }
        case "glossary_upsert": {
          glossary.upsert({
            gameId: msg.gameId ? String(msg.gameId) : null,
            sourceTerm: String(msg.sourceTerm),
            translatedTerm: String(msg.translatedTerm),
            priority: Number(msg.priority ?? 0),
          });
          reply({ type: "glossary_upsert_result", ok: true });
          return;
        }
        case "glossary_remove": {
          glossary.remove(msg.gameId ? String(msg.gameId) : null, String(msg.sourceTerm));
          reply({ type: "glossary_remove_result", ok: true });
          return;
        }
        case "ping": {
          reply({ type: "pong" });
          return;
        }
        default:
          reply({ error: "unknown_message_type", type: msg.type });
      }
    } catch (error) {
      log(`handler error: ${error instanceof Error ? error.stack : String(error)}`);
      reply({ error: "internal_error" });
    }
  }
}

main().catch((error) => {
  log(`fatal: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
