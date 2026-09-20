import { describe, expect, it } from "vitest";
import protectionRegistrySample from "../src/data/protection_registry.sample.json" with { type: "json" };
import { detectProtection, loadProtectionRegistryFromJson } from "../src/profiles/protectionRegistry.js";

describe("detectProtection", () => {
  const registry = loadProtectionRegistryFromJson(protectionRegistrySample);

  it("detects a known anticheat process by name (D5)", () => {
    const result = detectProtection({ runningProcessNames: ["EasyAntiCheat.exe", "Game.exe"] }, registry);
    expect(result.detected).toBe(true);
    expect(result.matches[0].vendor).toBe("EasyAntiCheat");
    expect(result.matches[0].category).toBe("anticheat");
    expect(result.matches[0].confidence).toBe("high");
  });

  it("detects via known driver module even without a matching process name", () => {
    const result = detectProtection(
      { runningProcessNames: ["Game.exe"], loadedDriverModules: ["BEDaisy.sys"] },
      registry
    );
    expect(result.detected).toBe(true);
    expect(result.matches[0].vendor).toBe("BattlEye");
  });

  it("returns not detected when nothing matches (no false positives from unrelated processes)", () => {
    const result = detectProtection({ runningProcessNames: ["Discord.exe", "Steam.exe"] }, registry);
    expect(result.detected).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it("never flags a heuristic_low anti_tamper entry via process-name match alone (§7.1 T9: detection is structurally incomplete)", () => {
    const result = detectProtection({ runningProcessNames: ["Game.exe"] }, registry);
    expect(result.matches.some((m) => m.vendor === "Denuvo")).toBe(false);
  });
});
