import type { NativePort } from "./nativePort.js";
import { ChromeNativePort } from "./nativePort.js";
import type {
  ConnectionStatus,
  GlossaryEntry,
  HostRequest,
  HostResponse,
  TranslateResult,
} from "../shared/types.js";

type PendingEntry = { resolve: (value: HostResponse) => void; reject: (error: Error) => void };

/**
 * Testable core of the service worker: request/response correlation over a
 * NativePort, and connection-status tracking. `chrome.runtime.connectNative`
 * only succeeds when a real native messaging host manifest is installed
 * (blueprint §2.2's "常時稼働の制約" / this MVP does not install one), so in
 * this sandbox `getStatus()` will read "disconnected" — that is the
 * correct, honest behavior, not a bug.
 */
export class BackgroundController {
  private status: ConnectionStatus = "disconnected";
  private readonly pending = new Map<string, PendingEntry>();
  private port: NativePort | undefined;
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(private readonly portFactory: () => NativePort) {}

  connect(): void {
    try {
      this.port = this.portFactory();
      this.port.onMessage((message) => this.handleIncoming(message));
      this.port.onDisconnect(() => this.handleDisconnect());
      this.setStatus("connected");
    } catch {
      this.setStatus("disconnected");
    }
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): void {
    this.statusListeners.add(listener);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private handleDisconnect(): void {
    this.setStatus("disconnected");
    for (const [, entry] of this.pending) entry.reject(new Error("native_port_disconnected"));
    this.pending.clear();
  }

  private handleIncoming(message: unknown): void {
    if (typeof message !== "object" || message === null || !("requestId" in message)) return;
    const requestId = String((message as Record<string, unknown>).requestId);
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    entry.resolve(message as unknown as HostResponse);
  }

  send(request: HostRequest, timeoutMs = 5000): Promise<HostResponse> {
    if (this.status !== "connected" || !this.port) {
      return Promise.reject(new Error("not_connected"));
    }
    const requestId = crypto.randomUUID();
    const port = this.port;
    return new Promise<HostResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("request_timeout"));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      port.postMessage({ ...request, requestId });
    });
  }

  async translate(gameId: string, sourceText: string, contextTag: "ui_label" | "dialogue" | "item_description" | "unknown"): Promise<TranslateResult> {
    const response = await this.send({ type: "translate", gameId, sourceText, contextTag });
    if (response.type !== "translate_result") throw new Error(`unexpected_response:${response.type}`);
    return response.result;
  }

  async glossaryList(gameId?: string): Promise<GlossaryEntry[]> {
    const response = await this.send({ type: "glossary_list", gameId });
    if (response.type !== "glossary_list_result") throw new Error(`unexpected_response:${response.type}`);
    return response.entries;
  }

  async glossaryUpsert(entry: GlossaryEntry): Promise<void> {
    const response = await this.send({ type: "glossary_upsert", ...entry });
    if (response.type !== "glossary_upsert_result") throw new Error(`unexpected_response:${response.type}`);
  }

  async glossaryRemove(gameId: string | null, sourceTerm: string): Promise<void> {
    const response = await this.send({ type: "glossary_remove", gameId, sourceTerm });
    if (response.type !== "glossary_remove_result") throw new Error(`unexpected_response:${response.type}`);
  }
}

/**
 * Real extension bootstrap. Guarded so this module can be imported by unit
 * tests (which exercise BackgroundController directly with a mock port)
 * without a `chrome` global present.
 */
function isRealExtensionContext(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime?.id;
}

if (isRealExtensionContext()) {
  const controller = new BackgroundController(() => new ChromeNativePort());
  controller.connect();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
      try {
        switch (message?.type) {
          case "get_status":
            sendResponse({ status: controller.getStatus() });
            return;
          case "translate":
            sendResponse(await controller.translate(message.gameId, message.sourceText, message.contextTag));
            return;
          case "glossary_list":
            sendResponse(await controller.glossaryList(message.gameId));
            return;
          case "glossary_upsert":
            await controller.glossaryUpsert(message.entry);
            sendResponse({ ok: true });
            return;
          case "glossary_remove":
            await controller.glossaryRemove(message.gameId ?? null, message.sourceTerm);
            sendResponse({ ok: true });
            return;
          default:
            sendResponse({ error: "unknown_message_type" });
        }
      } catch (error) {
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true; // keep sendResponse alive for the async work above
  });
}
