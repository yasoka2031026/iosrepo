import type { GlossaryEntry } from "../shared/types.js";

function setBanner(connected: boolean): void {
  const banner = document.getElementById("status-banner");
  if (!banner) return;
  banner.className = connected ? "connected" : "disconnected";
  banner.textContent = connected
    ? "ローカルヘルパーに接続中"
    : "ローカルヘルパー未接続 — 用語集の読み込み/保存はできません(MVP/PoC: このサンドボックスにはネイティブホストが未インストールです)";
}

function renderRows(entries: GlossaryEntry[]): void {
  const tbody = document.getElementById("glossary-rows");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const entry of entries) {
    const tr = document.createElement("tr");

    const gameCell = document.createElement("td");
    gameCell.textContent = entry.gameId ?? "(グローバル)";
    tr.appendChild(gameCell);

    const sourceCell = document.createElement("td");
    sourceCell.textContent = entry.sourceTerm;
    tr.appendChild(sourceCell);

    const translatedCell = document.createElement("td");
    translatedCell.textContent = entry.translatedTerm;
    tr.appendChild(translatedCell);

    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", () => void removeEntry(entry));
    actionCell.appendChild(deleteButton);
    tr.appendChild(actionCell);

    tbody.appendChild(tr);
  }
}

async function loadGlossary(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: "glossary_list" })) as
      | GlossaryEntry[]
      | { error: string };
    if (Array.isArray(response)) {
      setBanner(true);
      renderRows(response);
    } else {
      setBanner(false);
      renderRows([]);
    }
  } catch {
    setBanner(false);
    renderRows([]);
  }
}

async function removeEntry(entry: GlossaryEntry): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "glossary_remove", gameId: entry.gameId, sourceTerm: entry.sourceTerm });
  } catch {
    // Not connected; nothing to do beyond the banner already reflecting that.
  }
  void loadGlossary();
}

function initForm(): void {
  const form = document.getElementById("add-form") as HTMLFormElement | null;
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const gameIdInput = document.getElementById("game-id") as HTMLInputElement;
    const sourceInput = document.getElementById("source-term") as HTMLInputElement;
    const translatedInput = document.getElementById("translated-term") as HTMLInputElement;

    const entry: GlossaryEntry = {
      gameId: gameIdInput.value.trim() || null,
      sourceTerm: sourceInput.value.trim(),
      translatedTerm: translatedInput.value.trim(),
      priority: 0,
    };
    if (!entry.sourceTerm || !entry.translatedTerm) return;

    void (async () => {
      try {
        await chrome.runtime.sendMessage({ type: "glossary_upsert", entry });
      } catch {
        // Not connected; nothing to do beyond the banner already reflecting that.
      }
      sourceInput.value = "";
      translatedInput.value = "";
      void loadGlossary();
    })();
  });
}

initForm();
void loadGlossary();
