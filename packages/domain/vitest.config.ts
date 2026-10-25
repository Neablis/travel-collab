import { defineConfig } from "vitest/config";
// The setup file pins fast-check's seed, so a witness floor is deterministic (KI-2026-10-14-c).
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/support/fastCheckSeed.setup.ts"] },
});
