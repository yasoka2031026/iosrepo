import type { EngineKind } from "../capture/types.js";

export interface HookTarget {
  api: string;
  signature_pattern: string;
  arg_index: number;
  encoding: "utf8" | "utf16" | "shift_jis";
}

export interface GameProfile {
  profile_id: string;
  steam_app_id: string;
  executable_names: string[];
  engine: EngineKind;
  hook_targets: HookTarget[];
  overlay_hint: { known_fullscreen_exclusive: boolean; recommend_borderless: boolean };
  anticheat_flags: string[];
  anti_tamper_flags: string[];
  /**
   * §7.4 OP3 / §7.4 OP1: unverified or flagged profiles must never be applied
   * automatically. Only "verified" is eligible for MatchResult.applied === true.
   */
  moderation_status: "verified" | "community_unverified" | "flagged_malicious";
  signature: string;
  last_verified_game_version: string;
}

export type MatchOutcome =
  | { status: "matched"; profile: GameProfile; requiresManualApproval: false }
  | { status: "requires_manual_approval"; profile: GameProfile; requiresManualApproval: true }
  | { status: "unmatched" };

/**
 * Matches a running process against the profile registry (blueprint §6.1).
 * Mirrors the flow in §2.2: an exact `moderation_status: "verified"` match is
 * applied automatically; anything else surfaces for explicit user approval
 * rather than being silently activated (§7.4 OP3).
 */
export function matchProfile(processName: string, profiles: GameProfile[]): MatchOutcome {
  const profile = profiles.find((p) =>
    p.executable_names.some((name) => name.toLowerCase() === processName.toLowerCase())
  );
  if (!profile) {
    return { status: "unmatched" };
  }
  if (profile.moderation_status === "verified") {
    return { status: "matched", profile, requiresManualApproval: false };
  }
  return { status: "requires_manual_approval", profile, requiresManualApproval: true };
}

export function loadProfilesFromJson(json: unknown): GameProfile[] {
  if (!Array.isArray(json)) {
    throw new Error("game_profiles JSON must be an array");
  }
  return json as GameProfile[];
}
