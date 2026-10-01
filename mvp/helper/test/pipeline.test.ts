import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "./helpers/sqlite.js";
import { TranslationCache } from "../src/translation/cache.js";
import type { TranslationClient } from "../src/translation/claudeClient.js";
import { MockTranslationClient } from "../src/translation/claudeClient.js";
import { GlossaryStore } from "../src/translation/glossary.js";
import { TranslationPipeline } from "../src/translation/pipeline.js";

class FixedTranslationClient implements TranslationClient {
  readonly modelId = "fixed-test-client";
  constructor(private readonly response: string | ((userJson: string) => string)) {}
  async translate(prompt: { user: string }): Promise<string> {
    return typeof this.response === "function" ? this.response(prompt.user) : this.response;
  }
}

function makePipeline(client: TranslationClient) {
  const db = new DatabaseSync(":memory:");
  const glossary = new GlossaryStore(db);
  const cache = new TranslationCache(db);
  const pipeline = new TranslationPipeline({ glossary, cache, client });
  return { pipeline, glossary, cache };
}

describe("TranslationPipeline (§4.5 end-to-end)", () => {
  it("returns a glossary hit without calling the model", async () => {
    const { pipeline, glossary } = makePipeline(new MockTranslationClient());
    glossary.upsert({ gameId: "game1", sourceTerm: "Start Game", translatedTerm: "ゲーム開始", priority: 0 });

    const result = await pipeline.translate({ gameId: "game1", sourceText: "Start Game", contextTag: "ui_label" });
    expect(result.source).toBe("glossary");
    expect(result.translatedText).toBe("ゲーム開始");
    expect(result.valid).toBe(true);
  });

  it("calls the model on a cache miss, then serves the second identical request from cache", async () => {
    let callCount = 0;
    const client = new FixedTranslationClient((userJson) => {
      callCount += 1;
      const { source_text } = JSON.parse(userJson);
      return `翻訳:${source_text}`;
    });
    const { pipeline } = makePipeline(client);

    const first = await pipeline.translate({ gameId: "game1", sourceText: "Hello", contextTag: "dialogue" });
    expect(first.source).toBe("model");
    expect(callCount).toBe(1);

    const second = await pipeline.translate({ gameId: "game1", sourceText: "Hello", contextTag: "dialogue" });
    expect(second.source).toBe("cache");
    expect(second.translatedText).toBe(first.translatedText);
    expect(callCount).toBe(1); // no second API call
  });

  it("round-trips placeholder tokens through the mock model", async () => {
    const { pipeline } = makePipeline(new MockTranslationClient());
    const result = await pipeline.translate({
      gameId: "game1",
      sourceText: "Press %s to jump",
      contextTag: "ui_label",
    });
    expect(result.valid).toBe(true);
    expect(result.translatedText).toContain("%s");
  });

  it("falls back to the original text when the model output fails validation (§7.3 TR7)", async () => {
    const client = new FixedTranslationClient("a".repeat(5000)); // exceeds absolute length limit
    const { pipeline } = makePipeline(client);

    const result = await pipeline.translate({ gameId: "game1", sourceText: "OK", contextTag: "ui_label" });
    expect(result.valid).toBe(false);
    expect(result.source).toBe("fallback_original");
    expect(result.translatedText).toBe("OK");
  });

  it("does not poison the cache with an invalid (fallback) result", async () => {
    let calls = 0;
    const client = new FixedTranslationClient(() => {
      calls += 1;
      return calls === 1 ? "a".repeat(5000) : "翻訳結果";
    });
    const { pipeline } = makePipeline(client);

    const first = await pipeline.translate({ gameId: "game1", sourceText: "Retry me", contextTag: "ui_label" });
    expect(first.valid).toBe(false);

    const second = await pipeline.translate({ gameId: "game1", sourceText: "Retry me", contextTag: "ui_label" });
    expect(second.source).toBe("model"); // not served from cache, since the failed attempt was never cached
    expect(second.valid).toBe(true);
    expect(calls).toBe(2);
  });
});
