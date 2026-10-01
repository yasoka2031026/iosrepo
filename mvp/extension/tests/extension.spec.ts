import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = join(__dirname, "..", "dist");
const CHROMIUM_EXECUTABLE =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

async function launchWithExtension(userDataDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    headless: false, // MV3 extension loading is unreliable in headless mode
    executablePath: CHROMIUM_EXECUTABLE,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-sandbox", // required for Chromium running as root in this container
    ],
  });
}

test.describe("LiveYaku extension (MV3, loaded unpacked)", () => {
  test("loads without crashing and exposes a background service worker", async ({}, testInfo) => {
    const context = await launchWithExtension(testInfo.outputPath("user-data"));
    try {
      let [worker] = context.serviceWorkers();
      if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
      expect(worker.url()).toContain("background.js");
    } finally {
      await context.close();
    }
  });

  test("popup renders status banner and toggle without console errors", async ({}, testInfo) => {
    const context = await launchWithExtension(testInfo.outputPath("user-data"));
    try {
      let [worker] = context.serviceWorkers();
      if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
      const extensionId = worker.url().split("/")[2];

      const consoleErrors: string[] = [];
      const page = await context.newPage();
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
      await expect(page.locator("#status-text")).toBeVisible();
      await expect(page.locator("#enabled-toggle")).toBeVisible();
      await expect(page.locator("#status-text")).toHaveText("ローカルヘルパー未接続");

      // Toggle should persist to chrome.storage.local without throwing.
      await page.locator("#enabled-toggle").check();
      await page.waitForTimeout(100);

      expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("; ")}`).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("options page renders the glossary table and disconnected banner", async ({}, testInfo) => {
    const context = await launchWithExtension(testInfo.outputPath("user-data"));
    try {
      let [worker] = context.serviceWorkers();
      if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
      const extensionId = worker.url().split("/")[2];

      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options/options.html`);
      await expect(page.locator("#status-banner")).toHaveClass(/disconnected/);
      await expect(page.locator("#add-form")).toBeVisible();

      // Filling the add form and submitting should not throw even though the
      // native host isn't connected (options.ts must handle the rejection).
      await page.fill("#source-term", "Sword");
      await page.fill("#translated-term", "剣");
      await page.click("#add-form button[type=submit]");
      await page.waitForTimeout(100);
      await expect(page.locator("#status-banner")).toHaveClass(/disconnected/);
    } finally {
      await context.close();
    }
  });
});
