import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const files = [
  ["manifest.json", "manifest.json"],
  ["src/popup/popup.html", "popup/popup.html"],
  ["src/options/options.html", "options/options.html"],
];

for (const [from, to] of files) {
  const destPath = join(root, "dist", to);
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(join(root, from), destPath);
}

console.log(`copied ${files.length} static file(s) into dist/`);
