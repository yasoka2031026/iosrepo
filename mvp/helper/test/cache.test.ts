import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "./helpers/sqlite.js";
import { TranslationCache, hashSourceText, normalizeSourceText } from "../src/translation/cache.js";

describe("TranslationCache (§6.3)", () => {
  let db: DatabaseSync;
  let cache: TranslationCache;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    cache = new TranslationCache(db);
  });

  it("returns null on a miss", () => {
    expect(cache.get("game1", "Hello")).toBeNull();
  });

  it("stores and retrieves a translation", () => {
    cache.set({
      gameId: "game1",
      sourceText: "Hello",
      translatedText: "こんにちは",
      contextTag: "ui_label",
      modelId: "mock",
      glossaryApplied: false,
    });
    const hit = cache.get("game1", "Hello");
    expect(hit?.translatedText).toBe("こんにちは");
  });

  it("normalizes whitespace/newline variance so cosmetic differences still hit the cache (§4.5)", () => {
    cache.set({
      gameId: "game1",
      sourceText: "Hello   World",
      translatedText: "こんにちは世界",
      contextTag: "dialogue",
      modelId: "mock",
      glossaryApplied: false,
    });
    const hit = cache.get("game1", "Hello\n  World  ");
    expect(hit?.translatedText).toBe("こんにちは世界");
  });

  it("keeps caches for different games separate even with identical text", () => {
    cache.set({
      gameId: "game1",
      sourceText: "OK",
      translatedText: "OK-game1",
      contextTag: "ui_label",
      modelId: "mock",
      glossaryApplied: false,
    });
    cache.set({
      gameId: "game2",
      sourceText: "OK",
      translatedText: "OK-game2",
      contextTag: "ui_label",
      modelId: "mock",
      glossaryApplied: false,
    });
    expect(cache.get("game1", "OK")?.translatedText).toBe("OK-game1");
    expect(cache.get("game2", "OK")?.translatedText).toBe("OK-game2");
  });

  it("overwrites an existing entry on re-set (upsert)", () => {
    cache.set({
      gameId: "g",
      sourceText: "x",
      translatedText: "old",
      contextTag: "ui_label",
      modelId: "mock",
      glossaryApplied: false,
    });
    cache.set({
      gameId: "g",
      sourceText: "x",
      translatedText: "new",
      contextTag: "ui_label",
      modelId: "mock",
      glossaryApplied: false,
    });
    expect(cache.get("g", "x")?.translatedText).toBe("new");
    expect(cache.size("g")).toBe(1);
  });
});

describe("normalizeSourceText / hashSourceText", () => {
  it("produces the same hash for cosmetically different but equivalent strings", () => {
    const a = hashSourceText(normalizeSourceText("Hello   World"));
    const b = hashSourceText(normalizeSourceText("Hello\nWorld"));
    expect(a).toBe(b);
  });

  it("produces different hashes for different content", () => {
    const a = hashSourceText(normalizeSourceText("Hello"));
    const b = hashSourceText(normalizeSourceText("Goodbye"));
    expect(a).not.toBe(b);
  });
});
