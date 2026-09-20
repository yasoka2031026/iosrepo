import { countTokenOccurrences } from "./placeholder.js";

export interface ValidationInput {
  protectedSourceText: string;
  translatedText: string;
  placeholderTokenCount: number;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const MAX_LENGTH_MULTIPLIER = 6; // Japanese can run longer than English source, but not unboundedly.
const MAX_ABSOLUTE_LENGTH = 2000; // No legitimate single UI/dialogue string should exceed this.
// eslint-disable-next-line no-control-regex
const DISALLOWED_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
const MARKUP_INJECTION_PATTERNS = [/<script/i, /<iframe/i, /javascript:/i, /on\w+\s*=/i];

/**
 * §7.3 TR7 (prompt injection) defense-in-depth: the overlay renderer treats
 * translated text as plain text only (§7.3), but this validator is the
 * second line of defense at the pipeline boundary. Any failure here means
 * "fall back to displaying the original source text", never "display the
 * model's raw output anyway".
 */
export function validateTranslationOutput(input: ValidationInput): ValidationResult {
  const { translatedText, placeholderTokenCount } = input;

  if (translatedText.length === 0) {
    return { valid: false, reason: "empty_output" };
  }
  if (translatedText.length > MAX_ABSOLUTE_LENGTH) {
    return { valid: false, reason: "exceeds_absolute_length" };
  }
  if (translatedText.length > input.protectedSourceText.length * MAX_LENGTH_MULTIPLIER + 32) {
    return { valid: false, reason: "exceeds_relative_length" };
  }
  if (DISALLOWED_CONTROL_CHARS.test(translatedText)) {
    return { valid: false, reason: "contains_control_characters" };
  }
  if (MARKUP_INJECTION_PATTERNS.some((pattern) => pattern.test(translatedText))) {
    return { valid: false, reason: "contains_markup_injection_pattern" };
  }

  if (placeholderTokenCount > 0) {
    const counts = countTokenOccurrences(translatedText, placeholderTokenCount);
    const brokenIndex = counts.findIndex((count) => count !== 1);
    if (brokenIndex !== -1) {
      return { valid: false, reason: `placeholder_token_${brokenIndex}_count_${counts[brokenIndex]}` };
    }
  }

  return { valid: true };
}
