import type { ContextTag } from "../capture/types.js";
import type { TranslationCache } from "./cache.js";
import type { TranslationClient } from "./claudeClient.js";
import type { GlossaryStore } from "./glossary.js";
import { protectPlaceholders, restorePlaceholders } from "./placeholder.js";
import { buildTranslationPrompt } from "./promptBuilder.js";
import { validateTranslationOutput } from "./outputValidator.js";

export type TranslationSource = "glossary" | "cache" | "model" | "fallback_original";

export interface TranslationRequest {
  gameId: string;
  sourceText: string;
  contextTag: ContextTag;
}

export interface TranslationResult {
  gameId: string;
  sourceText: string;
  translatedText: string;
  source: TranslationSource;
  valid: boolean;
  invalidReason?: string;
}

export interface TranslationPipelineOptions {
  glossary: GlossaryStore;
  cache: TranslationCache;
  client: TranslationClient;
  /** Max glossary hints included in the prompt as few-shot context. */
  maxGlossaryHints?: number;
}

/**
 * Orchestrates blueprint §4.5's pipeline: glossary -> cache -> (debounce
 * omitted here; see ipc/nativeMessaging.ts + index.ts for where a real
 * deployment would batch) -> placeholder protection -> Claude API ->
 * output validation (§7.3 TR7) -> placeholder restoration -> cache write.
 *
 * Any validation failure falls back to the original source text rather than
 * ever surfacing unvalidated model output.
 */
export class TranslationPipeline {
  constructor(private readonly options: TranslationPipelineOptions) {}

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const { gameId, sourceText, contextTag } = request;

    const glossaryHit = this.options.glossary.lookup(gameId, sourceText);
    if (glossaryHit) {
      return { gameId, sourceText, translatedText: glossaryHit.translatedTerm, source: "glossary", valid: true };
    }

    const cacheHit = this.options.cache.get(gameId, sourceText);
    if (cacheHit) {
      return { gameId, sourceText, translatedText: cacheHit.translatedText, source: "cache", valid: true };
    }

    const { protectedText, tokens } = protectPlaceholders(sourceText);
    const hints = this.options.glossary
      .listAll(gameId)
      .slice(0, this.options.maxGlossaryHints ?? 5)
      .map((entry) => ({ sourceTerm: entry.sourceTerm, translatedTerm: entry.translatedTerm }));
    const prompt = buildTranslationPrompt({ protectedSourceText: protectedText, contextTag, glossaryHints: hints });

    const rawOutput = await this.options.client.translate(prompt);
    const validation = validateTranslationOutput({
      protectedSourceText: protectedText,
      translatedText: rawOutput,
      placeholderTokenCount: tokens.length,
    });

    if (!validation.valid) {
      return {
        gameId,
        sourceText,
        translatedText: sourceText,
        source: "fallback_original",
        valid: false,
        invalidReason: validation.reason,
      };
    }

    const restored = restorePlaceholders(rawOutput, tokens);
    if (restored === null) {
      return {
        gameId,
        sourceText,
        translatedText: sourceText,
        source: "fallback_original",
        valid: false,
        invalidReason: "placeholder_restore_failed",
      };
    }

    this.options.cache.set({
      gameId,
      sourceText,
      translatedText: restored,
      contextTag,
      modelId: this.options.client.modelId,
      glossaryApplied: hints.length > 0,
    });

    return { gameId, sourceText, translatedText: restored, source: "model", valid: true };
  }
}
