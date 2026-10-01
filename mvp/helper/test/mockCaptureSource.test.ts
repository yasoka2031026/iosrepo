import { describe, expect, it } from "vitest";
import { MockCaptureSource } from "../src/capture/mockCaptureSource.js";
import type { TextEvent } from "../src/capture/types.js";

describe("MockCaptureSource", () => {
  it("emits all scripted events synchronously when intervalMs is omitted", () => {
    const source = new MockCaptureSource({
      gameId: "0000001",
      processName: "SampleUnityMono.exe",
      script: [
        { sourceText: "Start Game", contextTag: "ui_label" },
        { sourceText: "You have died.", contextTag: "dialogue" },
      ],
    });
    const received: TextEvent[] = [];
    source.start((event) => received.push(event));

    expect(received).toHaveLength(2);
    expect(received[0].sourceText).toBe("Start Game");
    expect(received[0].gameId).toBe("0000001");
    expect(received[1].contextTag).toBe("dialogue");
  });

  it("stop() prevents further scheduled emissions", () => {
    const source = new MockCaptureSource({
      gameId: "g",
      processName: "p.exe",
      script: [{ sourceText: "x", contextTag: "ui_label" }],
      intervalMs: 1000,
    });
    let count = 0;
    source.start(() => {
      count += 1;
    });
    source.stop();
    expect(count).toBe(0);
  });
});
