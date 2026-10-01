import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    server: {
      // node:sqlite is still experimental and absent from Node's builtinModules
      // list, so Vite's automatic node:-prefix externalization doesn't catch it.
      deps: { external: [/^node:sqlite$/] },
    },
  },
});
