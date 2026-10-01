import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "./helpers/sqlite.js";
import { GlossaryStore } from "../src/translation/glossary.js";

describe("GlossaryStore (§6.4)", () => {
  let db: DatabaseSync;
  let glossary: GlossaryStore;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    glossary = new GlossaryStore(db);
  });

  it("returns null when there is no match", () => {
    expect(glossary.lookup("game1", "Sword")).toBeNull();
  });

  it("prefers a game-specific entry over a global one with the same source term", () => {
    glossary.upsert({ gameId: null, sourceTerm: "Sword", translatedTerm: "剣", priority: 0 });
    glossary.upsert({ gameId: "game1", sourceTerm: "Sword", translatedTerm: "ソード", priority: 0 });

    expect(glossary.lookup("game1", "Sword")?.translatedTerm).toBe("ソード");
    expect(glossary.lookup("game2", "Sword")?.translatedTerm).toBe("剣");
  });

  it("upsert overwrites an existing entry for the same (gameId, sourceTerm)", () => {
    glossary.upsert({ gameId: "game1", sourceTerm: "HP", translatedTerm: "体力", priority: 0 });
    glossary.upsert({ gameId: "game1", sourceTerm: "HP", translatedTerm: "ヒットポイント", priority: 1 });
    const hit = glossary.lookup("game1", "HP");
    expect(hit?.translatedTerm).toBe("ヒットポイント");
    expect(hit?.priority).toBe(1);
  });

  it("remove deletes an entry", () => {
    glossary.upsert({ gameId: "game1", sourceTerm: "MP", translatedTerm: "マナ", priority: 0 });
    glossary.remove("game1", "MP");
    expect(glossary.lookup("game1", "MP")).toBeNull();
  });

  it("listAll(gameId) includes both global and game-specific entries", () => {
    glossary.upsert({ gameId: null, sourceTerm: "OK", translatedTerm: "OK", priority: 0 });
    glossary.upsert({ gameId: "game1", sourceTerm: "Attack", translatedTerm: "攻撃", priority: 0 });
    glossary.upsert({ gameId: "game2", sourceTerm: "Defend", translatedTerm: "防御", priority: 0 });

    const entries = glossary.listAll("game1");
    const terms = entries.map((e) => e.sourceTerm);
    expect(terms).toContain("OK");
    expect(terms).toContain("Attack");
    expect(terms).not.toContain("Defend");
  });
});
