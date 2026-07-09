import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { BASE_URL } from "./src/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: BASE_URL } },
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.int.test.ts", "node_modules/**"],
  },
});
