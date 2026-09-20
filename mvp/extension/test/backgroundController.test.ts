import { describe, expect, it, vi } from "vitest";
import { BackgroundController } from "../src/background/background.js";
import type { NativePort } from "../src/background/nativePort.js";

class MockNativePort implements NativePort {
  private messageListener: ((message: unknown) => void) | undefined;
  private disconnectListener: (() => void) | undefined;
  public sent: unknown[] = [];

  postMessage(message: object): void {
    this.sent.push(message);
  }
  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }
  onDisconnect(listener: () => void): void {
    this.disconnectListener = listener;
  }
  disconnect(): void {}

  /** Test helper: simulate the helper process replying. */
  emit(message: unknown): void {
    this.messageListener?.(message);
  }
  simulateDisconnect(): void {
    this.disconnectListener?.();
  }
}

describe("BackgroundController", () => {
  it("reports disconnected before connect() is called", () => {
    const controller = new BackgroundController(() => new MockNativePort());
    expect(controller.getStatus()).toBe("disconnected");
  });

  it("reports connected after connect() succeeds, and notifies listeners", () => {
    const controller = new BackgroundController(() => new MockNativePort());
    const onChange = vi.fn();
    controller.onStatusChange(onChange);
    controller.connect();
    expect(controller.getStatus()).toBe("connected");
    expect(onChange).toHaveBeenCalledWith("connected");
  });

  it("send() rejects immediately when not connected", async () => {
    const controller = new BackgroundController(() => new MockNativePort());
    await expect(controller.send({ type: "ping" })).rejects.toThrow("not_connected");
  });

  it("correlates request/response by requestId and resolves the matching promise", async () => {
    let port!: MockNativePort;
    const controller = new BackgroundController(() => (port = new MockNativePort()));
    controller.connect();

    const promise = controller.translate("game1", "Hello", "ui_label");
    expect(port.sent).toHaveLength(1);
    const sentMessage = port.sent[0] as { type: string; requestId: string };
    expect(sentMessage.type).toBe("translate");

    port.emit({
      type: "translate_result",
      requestId: sentMessage.requestId,
      result: { gameId: "game1", sourceText: "Hello", translatedText: "こんにちは", source: "model", valid: true },
    });

    const result = await promise;
    expect(result.translatedText).toBe("こんにちは");
  });

  it("ignores a response whose requestId does not match any pending request", async () => {
    let port!: MockNativePort;
    const controller = new BackgroundController(() => (port = new MockNativePort()));
    controller.connect();

    const promise = controller.translate("game1", "Hi", "ui_label");
    port.emit({ type: "translate_result", requestId: "not-the-real-id", result: {} });

    port.emit({
      type: "translate_result",
      requestId: (port.sent[0] as { requestId: string }).requestId,
      result: { gameId: "game1", sourceText: "Hi", translatedText: "やあ", source: "model", valid: true },
    });
    await expect(promise).resolves.toMatchObject({ translatedText: "やあ" });
  });

  it("rejects all pending requests and flips to disconnected on port disconnect", async () => {
    let port!: MockNativePort;
    const controller = new BackgroundController(() => (port = new MockNativePort()));
    controller.connect();

    const promise = controller.translate("game1", "Hi", "ui_label");
    port.simulateDisconnect();

    expect(controller.getStatus()).toBe("disconnected");
    await expect(promise).rejects.toThrow("native_port_disconnected");
  });

  it("glossaryUpsert/glossaryList/glossaryRemove round-trip through the port", async () => {
    let port!: MockNativePort;
    const controller = new BackgroundController(() => (port = new MockNativePort()));
    controller.connect();

    const upsertPromise = controller.glossaryUpsert({
      gameId: "game1",
      sourceTerm: "Sword",
      translatedTerm: "剣",
      priority: 0,
    });
    port.emit({ type: "glossary_upsert_result", requestId: (port.sent[0] as { requestId: string }).requestId, ok: true });
    await expect(upsertPromise).resolves.toBeUndefined();

    const listPromise = controller.glossaryList("game1");
    port.emit({
      type: "glossary_list_result",
      requestId: (port.sent[1] as { requestId: string }).requestId,
      entries: [{ gameId: "game1", sourceTerm: "Sword", translatedTerm: "剣", priority: 0 }],
    });
    await expect(listPromise).resolves.toEqual([
      { gameId: "game1", sourceTerm: "Sword", translatedTerm: "剣", priority: 0 },
    ]);
  });
});
