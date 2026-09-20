import { describe, expect, it, vi } from "vitest";
import { MAX_MESSAGE_BYTES, NativeMessagingStreamDecoder, encodeMessage } from "../src/ipc/nativeMessaging.js";

describe("encodeMessage / NativeMessagingStreamDecoder", () => {
  it("round-trips a single message through one push()", () => {
    const onMessage = vi.fn();
    const decoder = new NativeMessagingStreamDecoder(onMessage);
    decoder.push(encodeMessage({ type: "hello", value: 42 }));
    expect(onMessage).toHaveBeenCalledWith({ type: "hello", value: 42 });
  });

  it("decodes a message delivered across multiple fragmented chunks", () => {
    const onMessage = vi.fn();
    const decoder = new NativeMessagingStreamDecoder(onMessage);
    const encoded = encodeMessage({ hello: "world", array: [1, 2, 3] });

    // Simulate stdin delivering the bytes in three arbitrary-sized pieces.
    decoder.push(encoded.subarray(0, 3));
    expect(onMessage).not.toHaveBeenCalled();
    decoder.push(encoded.subarray(3, 6));
    expect(onMessage).not.toHaveBeenCalled();
    decoder.push(encoded.subarray(6));
    expect(onMessage).toHaveBeenCalledWith({ hello: "world", array: [1, 2, 3] });
  });

  it("decodes two consecutive messages delivered in a single chunk", () => {
    const onMessage = vi.fn();
    const decoder = new NativeMessagingStreamDecoder(onMessage);
    const combined = Buffer.concat([encodeMessage({ n: 1 }), encodeMessage({ n: 2 })]);
    decoder.push(combined);
    expect(onMessage).toHaveBeenNthCalledWith(1, { n: 1 });
    expect(onMessage).toHaveBeenNthCalledWith(2, { n: 2 });
  });

  it("rejects encoding a payload over the size limit", () => {
    const huge = { data: "x".repeat(MAX_MESSAGE_BYTES) };
    expect(() => encodeMessage(huge)).toThrow(/exceeds/);
  });

  it("reports an error and resets on malformed JSON instead of throwing", () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const decoder = new NativeMessagingStreamDecoder(onMessage, onError);

    const badJson = Buffer.from("{not valid json", "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(badJson.byteLength, 0);
    decoder.push(Buffer.concat([header, badJson]));

    expect(onError).toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();

    // Decoder should recover for the next message.
    decoder.push(encodeMessage({ ok: true }));
    expect(onMessage).toHaveBeenCalledWith({ ok: true });
  });
});
