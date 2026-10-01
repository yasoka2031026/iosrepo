import { describe, expect, it } from "vitest";
import { validateTranslationOutput } from "../src/translation/outputValidator.js";

describe("validateTranslationOutput (§7.3 TR7 prompt-injection defense)", () => {
  it("accepts a well-formed translation with intact placeholder tokens", () => {
    const result = validateTranslationOutput({
      protectedSourceText: "Hello 0!",
      translatedText: "こんにちは0!",
      placeholderTokenCount: 1,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects output where a placeholder token was dropped", () => {
    const result = validateTranslationOutput({
      protectedSourceText: "Hello 0!",
      translatedText: "こんにちは!",
      placeholderTokenCount: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/placeholder_token_0/);
  });

  it("rejects output where a placeholder token was duplicated", () => {
    const result = validateTranslationOutput({
      protectedSourceText: "Hello 0!",
      translatedText: "00",
      placeholderTokenCount: 1,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an implausibly long output relative to the source (possible injected content)", () => {
    const longOutput = "あ".repeat(500);
    const result = validateTranslationOutput({
      protectedSourceText: "OK",
      translatedText: longOutput,
      placeholderTokenCount: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("exceeds_relative_length");
  });

  it("rejects output containing markup-injection patterns (e.g. an injected <script> tag)", () => {
    const result = validateTranslationOutput({
      protectedSourceText: "click here",
      translatedText: "ここをクリック<script>alert(1)</script>",
      placeholderTokenCount: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("contains_markup_injection_pattern");
  });

  it("rejects output containing disallowed control characters", () => {
    const result = validateTranslationOutput({
      protectedSourceText: "ok",
      translatedText: "ok\u0007bell",
      placeholderTokenCount: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("contains_control_characters");
  });

  it("rejects empty output", () => {
    const result = validateTranslationOutput({
      protectedSourceText: "ok",
      translatedText: "",
      placeholderTokenCount: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("empty_output");
  });
});
