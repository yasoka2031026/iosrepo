import type { BuiltPrompt } from "./promptBuilder.js";

export interface TranslationClient {
  readonly modelId: string;
  translate(prompt: BuiltPrompt): Promise<string>;
}

/**
 * Deterministic stand-in for the real Anthropic API call, used in tests and
 * local development without an API key. It performs no real translation —
 * it deterministically transforms the input so tests can assert on
 * placeholder round-tripping without needing network access or burning
 * real API calls.
 */
export class MockTranslationClient implements TranslationClient {
  readonly modelId = "mock-translation-client";

  async translate(prompt: BuiltPrompt): Promise<string> {
    const parsed = JSON.parse(prompt.user) as { source_text: string };
    return `[MOCK-JA] ${parsed.source_text}`;
  }
}

export interface ClaudeTranslationClientOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Real Anthropic API-backed client (blueprint §4.5, §5). Requires
 * `@anthropic-ai/sdk` and a valid API key (see credentials/credentialStore.ts,
 * §4.6 — never sourced from browser-extension storage).
 */
export class ClaudeTranslationClient implements TranslationClient {
  readonly modelId: string;
  private clientPromise: Promise<import("@anthropic-ai/sdk").default> | undefined;

  constructor(private readonly options: ClaudeTranslationClientOptions) {
    this.modelId = options.model ?? "claude-fable-5-1";
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = import("@anthropic-ai/sdk").then((mod) => new mod.default({ apiKey: this.options.apiKey }));
    }
    return this.clientPromise;
  }

  async translate(prompt: BuiltPrompt): Promise<string> {
    const client = await this.getClient();
    const response = await client.messages.create({
      model: this.modelId,
      max_tokens: this.options.maxTokens ?? 512,
      temperature: 0.2,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude API returned no text content");
    }
    return textBlock.text;
  }
}
