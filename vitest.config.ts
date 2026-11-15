import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Never read the real .env (it holds live API keys); tests set fake ones in tests/setup.ts.
  envDir: fileURLToPath(new URL("./tests/helpers", import.meta.url)),
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    pool: "forks",
    isolate: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
