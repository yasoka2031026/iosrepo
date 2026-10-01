import type { DatabaseSync } from "node:sqlite";

export interface GlossaryEntry {
  gameId: string | null;
  sourceTerm: string;
  translatedTerm: string;
  priority: number;
}

/**
 * Backs blueprint §6.4 `glossary`. A `gameId: null` row is the global
 * dictionary; game-specific entries take priority over global ones, and
 * within the same scope, higher `priority` wins.
 *
 * §3.2/§8.2: this store only ever holds short term -> term pairs entered by
 * the local user (C3). It is not the community-sharing feature described in
 * the blueprint's V1 scope, which is out of scope for this MVP.
 */
export class GlossaryStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS glossary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT,
        source_term TEXT NOT NULL,
        translated_term TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        UNIQUE(game_id, source_term)
      )
    `);
  }

  upsert(entry: GlossaryEntry): void {
    this.db
      .prepare(
        `INSERT INTO glossary (game_id, source_term, translated_term, priority)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(game_id, source_term) DO UPDATE SET
           translated_term = excluded.translated_term,
           priority = excluded.priority`
      )
      .run(entry.gameId, entry.sourceTerm, entry.translatedTerm, entry.priority);
  }

  remove(gameId: string | null, sourceTerm: string): void {
    this.db.prepare(`DELETE FROM glossary WHERE game_id IS ? AND source_term = ?`).run(gameId, sourceTerm);
  }

  /** Exact-match lookup only (blueprint §4.5: "用語集適用チェック... 完全一致があれば即時返却"). */
  lookup(gameId: string, sourceText: string): GlossaryEntry | null {
    const row = this.db
      .prepare(
        `SELECT game_id as gameId, source_term as sourceTerm, translated_term as translatedTerm, priority
         FROM glossary
         WHERE source_term = ? AND (game_id = ? OR game_id IS NULL)
         ORDER BY (game_id IS NOT NULL) DESC, priority DESC
         LIMIT 1`
      )
      .get(sourceText, gameId) as GlossaryEntry | undefined;
    return row ?? null;
  }

  listAll(gameId?: string): GlossaryEntry[] {
    const rows = gameId
      ? this.db
          .prepare(
            `SELECT game_id as gameId, source_term as sourceTerm, translated_term as translatedTerm, priority
             FROM glossary WHERE game_id = ? OR game_id IS NULL ORDER BY priority DESC`
          )
          .all(gameId)
      : this.db
          .prepare(
            `SELECT game_id as gameId, source_term as sourceTerm, translated_term as translatedTerm, priority
             FROM glossary ORDER BY priority DESC`
          )
          .all();
    return rows as unknown as GlossaryEntry[];
  }
}
