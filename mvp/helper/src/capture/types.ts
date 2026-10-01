/**
 * Contract that a real capture source must satisfy (blueprint §4.3, §4.3.1a).
 *
 * In production, TextEvents are produced by `hook-dll` (a native DLL loaded
 * inside the target game process, see docs/steam-jp-realtime-translation-blueprint.md
 * §4.2/§4.3.5) or by the OCR fallback engine (§4.3.4). Neither is implemented
 * in this repository: this sandbox cannot build or run Windows-native code,
 * and there is no real game process to hook into or capture from.
 *
 * `MockCaptureSource` (mockCaptureSource.ts) implements this same interface
 * with simulated events, so the rest of the pipeline (profile matching,
 * protection detection, translation) can be built and tested for real.
 */

export type EngineKind =
  | "unity_mono"
  | "unity_il2cpp"
  | "unreal"
  | "godot"
  | "custom"
  | "unknown";

export type ContextTag = "ui_label" | "dialogue" | "item_description" | "unknown";

export interface TextEvent {
  gameId: string;
  processName: string;
  sourceText: string;
  contextTag: ContextTag;
  /** Present only when the capture source can attribute a hook target (§4.3.1a). Absent for OCR-sourced events. */
  hookApi?: string;
  capturedAt: string;
}

export interface CaptureSource {
  /** Human-readable identifier for logging/diagnostics, e.g. "mock" | "hook-dll" | "ocr-fallback". */
  readonly kind: string;
  start(onEvent: (event: TextEvent) => void): void;
  stop(): void;
}
