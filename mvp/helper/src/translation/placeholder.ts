/**
 * Placeholder protection (blueprint §4.5, §7.3 TR1). Game UI strings often
 * embed runtime substitutions (`%s`, `{0}`, `%1$s`) or Unity rich-text tags
 * (`<color=red>...</color>`) that must survive translation byte-for-byte.
 *
 * Tokens use Private Use Area characters (U+E000 range) as delimiters, which
 * cannot appear in ordinary game text, so they cannot collide with real
 * content and survive round-tripping through an LLM that is told to treat
 * them as opaque.
 */

const TOKEN_OPEN = "";
const TOKEN_CLOSE = "";

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /%\d*\$?[sdif]/g, // printf-style: %s, %d, %1$s
  /\{\d+(:[^}]*)?\}/g, // .NET-style: {0}, {1:00}
  /\{\{[a-zA-Z0-9_.]+\}\}/g, // mustache-style: {{playerName}}
  /<\/?[a-zA-Z][a-zA-Z0-9=#,._ -]*>/g, // rich-text / markup tags: <color=red>, </color>, <b>
];

export interface ProtectResult {
  protectedText: string;
  tokens: string[];
}

export function protectPlaceholders(sourceText: string): ProtectResult {
  const tokens: string[] = [];
  let protectedText = sourceText;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    protectedText = protectedText.replace(pattern, (match) => {
      const index = tokens.length;
      tokens.push(match);
      return `${TOKEN_OPEN}${index}${TOKEN_CLOSE}`;
    });
  }
  return { protectedText, tokens };
}

/** Returns null if a token index in `text` doesn't correspond to a captured placeholder (corruption). */
export function restorePlaceholders(text: string, tokens: string[]): string | null {
  const tokenPattern = new RegExp(`${TOKEN_OPEN}(\\d+)${TOKEN_CLOSE}`, "g");
  let corrupted = false;
  const restored = text.replace(tokenPattern, (_match, indexStr: string) => {
    const index = Number(indexStr);
    const original = tokens[index];
    if (original === undefined) {
      corrupted = true;
      return "";
    }
    return original;
  });
  return corrupted ? null : restored;
}

/**
 * §7.3 TR1 integrity check: every placeholder token emitted during
 * protection must still be present, exactly once, in the model's output
 * before restoration. Used by outputValidator.ts.
 */
export function countTokenOccurrences(text: string, tokenCount: number): number[] {
  const counts = new Array(tokenCount).fill(0);
  const tokenPattern = new RegExp(`${TOKEN_OPEN}(\\d+)${TOKEN_CLOSE}`, "g");
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(text)) !== null) {
    const index = Number(match[1]);
    if (index >= 0 && index < tokenCount) {
      counts[index] += 1;
    }
  }
  return counts;
}
