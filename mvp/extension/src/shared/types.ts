/** Mirrors mvp/helper/src's message shapes (blueprint §4.1 native-messaging-bridge). */

export const NATIVE_HOST_NAME = "com.liveyaku.helper";

export type ContextTag = "ui_label" | "dialogue" | "item_description" | "unknown";

export interface GlossaryEntry {
  gameId: string | null;
  sourceTerm: string;
  translatedTerm: string;
  priority: number;
}

export interface TranslateResult {
  gameId: string;
  sourceText: string;
  translatedText: string;
  source: "glossary" | "cache" | "model" | "fallback_original";
  valid: boolean;
  invalidReason?: string;
}

export type HostRequest =
  | { type: "ping" }
  | { type: "translate"; gameId: string; sourceText: string; contextTag: ContextTag }
  | { type: "match_profile"; processName: string }
  | { type: "detect_protection"; runningProcessNames: string[] }
  | { type: "glossary_list"; gameId?: string }
  | { type: "glossary_upsert"; gameId: string | null; sourceTerm: string; translatedTerm: string; priority?: number }
  | { type: "glossary_remove"; gameId: string | null; sourceTerm: string };

export type HostResponse =
  | { type: "pong" }
  | { type: "translate_result"; result: TranslateResult }
  | { type: "match_profile_result"; result: unknown }
  | { type: "detect_protection_result"; result: unknown }
  | { type: "glossary_list_result"; entries: GlossaryEntry[] }
  | { type: "glossary_upsert_result"; ok: true }
  | { type: "glossary_remove_result"; ok: true }
  | { type: "error"; error: string };

export type ConnectionStatus = "connected" | "disconnected";
