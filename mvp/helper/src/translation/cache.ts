import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ContextTag } from "../capture/types.js";

export interface CacheEntry {
  gameId: string;
  sourceText: string;
  translatedText: string;
  contextTag: ContextTag;
  modelId: string;
  glossaryApplied: boolean;
}

/** §4.5: "空白・改行差異の吸収" — normalize before hashing so cosmetic variance doesn't fragment the cache. */
export function normalizeSourceText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function hashSourceText(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** Backs blueprint §6.3 `translation_cache`. */
export class TranslationCache {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS translation_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        context_tag TEXT,
        model_id TEXT,
        glossary_applied INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(game_id, source_hash)
      )
    `);
  }

  get(gameId: string, sourceText: string): CacheEntry | null {
    const hash = hashSourceText(normalizeSourceText(sourceText));
    const row = this.db
      .prepare(
        `SELECT game_id as gameId, source_text as sourceText, translated_text as translatedText,
                context_tag as contextTag, model_id as modelId, glossary_applied as glossaryApplied
         FROM translation_cache WHERE game_id = ? AND source_hash = ?`
      )
      .get(gameId, hash) as unknown as
      | {
          gameId: string;
          sourceText: string;
          translatedText: string;
          contextTag: ContextTag;
          modelId: string;
          glossaryApplied: number;
        }
      | undefined;
    if (!row) return null;
    return { ...row, glossaryApplied: Boolean(row.glossaryApplied) };
  }

  set(entry: CacheEntry): void {
    const hash = hashSourceText(normalizeSourceText(entry.sourceText));
    this.db
      .prepare(
        `INSERT INTO translation_cache (game_id, source_hash, source_text, translated_text, context_tag, model_id, glossary_applied, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id, source_hash) DO UPDATE SET
           translated_text = excluded.translated_text,
           context_tag = excluded.context_tag,
           model_id = excluded.model_id,
           glossary_applied = excluded.glossary_applied,
           created_at = excluded.created_at`
      )
      .run(
        entry.gameId,
        hash,
        entry.sourceText,
        entry.translatedText,
        entry.contextTag,
        entry.modelId,
        entry.glossaryApplied ? 1 : 0,
        new Date().toISOString()
      );
  }

  size(gameId?: string): number {
    const row = gameId
      ? (this.db.prepare(`SELECT COUNT(*) as n FROM translation_cache WHERE game_id = ?`).get(gameId) as {
          n: number;
        })
      : (this.db.prepare(`SELECT COUNT(*) as n FROM translation_cache`).get() as { n: number });
    return row.n;
  }
}
