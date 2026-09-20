const ENABLED_STORAGE_KEY = "liveyaku.translationEnabled";

function setStatus(connected: boolean): void {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  if (!dot || !text) return;
  dot.className = `dot ${connected ? "connected" : "disconnected"}`;
  text.textContent = connected ? "ローカルヘルパーに接続中" : "ローカルヘルパー未接続";
}

async function refreshStatus(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: "get_status" })) as { status?: string } | undefined;
    setStatus(response?.status === "connected");
  } catch {
    setStatus(false);
  }
}

async function initToggle(): Promise<void> {
  const toggle = document.getElementById("enabled-toggle") as HTMLInputElement | null;
  if (!toggle) return;
  const stored = await chrome.storage.local.get(ENABLED_STORAGE_KEY);
  toggle.checked = Boolean(stored[ENABLED_STORAGE_KEY]);
  toggle.addEventListener("change", () => {
    void chrome.storage.local.set({ [ENABLED_STORAGE_KEY]: toggle.checked });
  });
}

function showMvpNote(): void {
  const note = document.getElementById("mvp-note");
  if (note) {
    note.textContent =
      "MVP/PoC: 実際のゲーム内テキスト取得(フック)・オーバーレイ描画は未実装です。翻訳パイプラインとNative Messagingの疎通確認が目的です。";
  }
}

void refreshStatus();
void initToggle();
showMvpNote();
