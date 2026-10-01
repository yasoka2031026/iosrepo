import { NATIVE_HOST_NAME } from "../shared/types.js";

/**
 * Abstraction over `chrome.runtime.Port` so the controller logic in
 * background.ts can be unit-tested (via MockNativePort, test/nativePort mocks)
 * without a real native messaging host or a Chrome runtime.
 */
export interface NativePort {
  postMessage(message: object): void;
  onMessage(listener: (message: unknown) => void): void;
  onDisconnect(listener: () => void): void;
  disconnect(): void;
}

export class ChromeNativePort implements NativePort {
  private readonly port: chrome.runtime.Port;

  constructor(hostName: string = NATIVE_HOST_NAME) {
    this.port = chrome.runtime.connectNative(hostName);
  }

  postMessage(message: object): void {
    this.port.postMessage(message);
  }

  onMessage(listener: (message: unknown) => void): void {
    this.port.onMessage.addListener(listener);
  }

  onDisconnect(listener: () => void): void {
    this.port.onDisconnect.addListener(listener);
  }

  disconnect(): void {
    this.port.disconnect();
  }
}
