export type ProtectionCategory = "anticheat" | "anti_tamper";
export type DetectionConfidence = "high" | "heuristic_low";

export interface ProtectionEntry {
  id: string;
  category: ProtectionCategory;
  process_names: string[];
  service_names: string[];
  known_driver_modules: string[];
  vendor: string;
  detection_confidence: DetectionConfidence;
  updated_at: string;
}

export interface DetectionInput {
  runningProcessNames: string[];
  runningServiceNames?: string[];
  loadedDriverModules?: string[];
}

export interface DetectionResult {
  detected: boolean;
  matches: Array<{ vendor: string; category: ProtectionCategory; confidence: DetectionConfidence }>;
}

/**
 * Blackist-only check per blueprint §4.3.3 (D5): "heuristic detection is
 * deliberately not used because false positives are costly". Anti-tamper
 * entries with `detection_confidence: "heuristic_low"` are included so
 * callers can still show the §7.1 T9 "we can't be sure" warning even when no
 * process-name match fires.
 */
export function detectProtection(
  input: DetectionInput,
  registry: ProtectionEntry[]
): DetectionResult {
  const matches: DetectionResult["matches"] = [];
  for (const entry of registry) {
    const processHit = entry.process_names.some((name) =>
      input.runningProcessNames.some((running) => running.toLowerCase() === name.toLowerCase())
    );
    const serviceHit = (input.runningServiceNames ?? []).some((running) =>
      entry.service_names.some((name) => name.toLowerCase() === running.toLowerCase())
    );
    const driverHit = (input.loadedDriverModules ?? []).some((running) =>
      entry.known_driver_modules.some((name) => name.toLowerCase() === running.toLowerCase())
    );
    if (processHit || serviceHit || driverHit) {
      matches.push({ vendor: entry.vendor, category: entry.category, confidence: entry.detection_confidence });
    }
  }
  return { detected: matches.length > 0, matches };
}

export function loadProtectionRegistryFromJson(json: unknown): ProtectionEntry[] {
  if (!Array.isArray(json)) {
    throw new Error("protection_registry JSON must be an array");
  }
  return json as ProtectionEntry[];
}
