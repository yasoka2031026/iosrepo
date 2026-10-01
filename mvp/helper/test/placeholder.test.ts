import { describe, expect, it } from "vitest";
import { countTokenOccurrences, protectPlaceholders, restorePlaceholders } from "../src/translation/placeholder.js";

describe("placeholder protection", () => {
  it("tokenizes printf-, .NET-, mustache-, and tag-style placeholders", () => {
    const source = "Hello %s, you found {0} <color=red>gold</color>! ({{count}} left)";
    const { protectedText, tokens } = protectPlaceholders(source);

    expect(tokens).toContain("%s");
    expect(tokens).toContain("{0}");
    expect(tokens).toContain("<color=red>");
    expect(tokens).toContain("</color>");
    expect(tokens).toContain("{{count}}");
    expect(protectedText).not.toContain("%s");
    expect(protectedText).not.toContain("<color=red>");
  });

  it("round-trips: protect then restore reproduces the original text exactly", () => {
    const source = "Damage: %d, target: {0}, <b>critical!</b>";
    const { protectedText, tokens } = protectPlaceholders(source);
    const restored = restorePlaceholders(protectedText, tokens);
    expect(restored).toBe(source);
  });

  it("restores through arbitrary surrounding (translated) text, not just the original position", () => {
    const source = "You found %s!";
    const { tokens } = protectPlaceholders(source);
    // Simulate a translated sentence that reorders/embeds the token differently.
    const translated = `0 を見つけた!`;
    const restored = restorePlaceholders(translated, tokens);
    expect(restored).toBe("%s を見つけた!");
  });

  it("detects placeholder loss (translator dropped the token)", () => {
    const source = "Press %s to continue";
    const { tokens } = protectPlaceholders(source);
    const brokenOutput = "続けるには押してください"; // token missing entirely
    const counts = countTokenOccurrences(brokenOutput, tokens.length);
    expect(counts[0]).toBe(0);
  });

  it("restorePlaceholders returns null when a token index is out of range (corruption)", () => {
    const restored = restorePlaceholders("5", ["%s"]);
    expect(restored).toBeNull();
  });
});
