import type { CaptureSource, ContextTag, TextEvent } from "./types.js";

export interface MockScriptEntry {
  sourceText: string;
  contextTag: ContextTag;
  hookApi?: string;
}

export interface MockCaptureSourceOptions {
  gameId: string;
  processName: string;
  /** Fixed sequence of events to emit, in order. Intended for deterministic tests/demos. */
  script: MockScriptEntry[];
  /** Delay between emitted events, ms. 0 emits everything synchronously via `emitAll()`. */
  intervalMs?: number;
}

/**
 * Stand-in for the real `hook-dll` capture path (§4.3, §4.3.1a). Emits a
 * pre-scripted sequence of TextEvents instead of reading them from a live
 * game process. This lets the translation pipeline, cache, and IPC layer be
 * exercised end-to-end without any actual process injection.
 */
export class MockCaptureSource implements CaptureSource {
  readonly kind = "mock";
  private timer: ReturnType<typeof setInterval> | undefined;
  private index = 0;

  constructor(private readonly options: MockCaptureSourceOptions) {}

  start(onEvent: (event: TextEvent) => void): void {
    const interval = this.options.intervalMs ?? 0;
    if (interval <= 0) {
      this.emitAll(onEvent);
      return;
    }
    this.timer = setInterval(() => {
      const next = this.options.script[this.index];
      if (!next) {
        this.stop();
        return;
      }
      this.index += 1;
      onEvent(this.toEvent(next));
    }, interval);
  }

  /** Synchronously emit every scripted entry. Used by tests that don't want to deal with timers. */
  emitAll(onEvent: (event: TextEvent) => void): void {
    for (const entry of this.options.script.slice(this.index)) {
      onEvent(this.toEvent(entry));
    }
    this.index = this.options.script.length;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private toEvent(entry: MockScriptEntry): TextEvent {
    return {
      gameId: this.options.gameId,
      processName: this.options.processName,
      sourceText: entry.sourceText,
      contextTag: entry.contextTag,
      hookApi: entry.hookApi,
      capturedAt: new Date().toISOString(),
    };
  }
}
