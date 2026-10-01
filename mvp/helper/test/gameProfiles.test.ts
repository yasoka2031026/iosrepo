import { describe, expect, it } from "vitest";
import gameProfilesSample from "../src/data/game_profiles.sample.json" with { type: "json" };
import { loadProfilesFromJson, matchProfile } from "../src/profiles/gameProfiles.js";

describe("matchProfile", () => {
  const profiles = loadProfilesFromJson(gameProfilesSample);

  it("auto-applies a verified profile (case-insensitive exe match)", () => {
    const result = matchProfile("samPleUnityMono.exe", profiles);
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.profile.engine).toBe("unity_mono");
      expect(result.requiresManualApproval).toBe(false);
    }
  });

  it("requires manual approval for a community_unverified profile (§7.4 OP3)", () => {
    const result = matchProfile("SampleUnreal.exe", profiles);
    expect(result.status).toBe("requires_manual_approval");
    if (result.status === "requires_manual_approval") {
      expect(result.profile.moderation_status).toBe("community_unverified");
      expect(result.requiresManualApproval).toBe(true);
    }
  });

  it("returns unmatched for an unknown process", () => {
    const result = matchProfile("NotAGame.exe", profiles);
    expect(result.status).toBe("unmatched");
  });

  it("distinguishes unity_mono from unity_il2cpp (§4.3.1a)", () => {
    const mono = matchProfile("SampleUnityMono.exe", profiles);
    const il2cpp = matchProfile("SampleUnityIl2cpp.exe", profiles);
    expect(mono.status === "matched" && mono.profile.engine).toBe("unity_mono");
    expect(il2cpp.status === "matched" && il2cpp.profile.engine).toBe("unity_il2cpp");
  });
});
