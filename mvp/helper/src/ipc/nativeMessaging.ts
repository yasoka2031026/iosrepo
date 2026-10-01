/**
 * Chrome Native Messaging framing (blueprint §4.1/§4.2 `native-messaging-bridge`):
 * each message is a 4-byte little-endian length prefix followed by that many
 * bytes of UTF-8 JSON. This module implements the framing itself as pure,
 * unit-testable code; index.ts wires it to real stdin/stdout.
 *
 * Per Chrome's docs, a message from the extension to the host is capped at
 * 1 MB; host-to-extension messages are capped at 1 GB. We enforce the
 * stricter 1 MB limit uniformly since this module framing is symmetric.
 */

export const MAX_MESSAGE_BYTES = 1024 * 1024;

export function encodeMessage(payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  if (json.byteLength > MAX_MESSAGE_BYTES) {
    throw new Error(`Native Messaging payload exceeds ${MAX_MESSAGE_BYTES} bytes`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.byteLength, 0);
  return Buffer.concat([header, json]);
}

export type DecodedMessageHandler = (message: unknown) => void;
export type DecodeErrorHandler = (error: Error) => void;

/**
 * Incrementally decodes a byte stream (as delivered by stdin 'data' events,
 * which do not respect message boundaries) into complete JSON messages.
 */
export class NativeMessagingStreamDecoder {
  private buffer = Buffer.alloc(0);

  constructor(
    private readonly onMessage: DecodedMessageHandler,
    private readonly onError: DecodeErrorHandler = () => {}
  ) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.buffer.byteLength < 4) return;
      const length = this.buffer.readUInt32LE(0);
      if (length > MAX_MESSAGE_BYTES) {
        this.onError(new Error(`Incoming Native Messaging payload exceeds ${MAX_MESSAGE_BYTES} bytes`));
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (this.buffer.byteLength < 4 + length) return; // wait for more data
      const jsonBytes = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      try {
        this.onMessage(JSON.parse(jsonBytes.toString("utf8")));
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
