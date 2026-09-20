// node:sqlite is experimental and absent from Node's builtinModules list, so
// Vite (which vitest uses to transform test files) fails to resolve a
// direct `import { DatabaseSync } from "node:sqlite"`. Routing through
// Node's real createRequire sidesteps Vite's module graph entirely.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
