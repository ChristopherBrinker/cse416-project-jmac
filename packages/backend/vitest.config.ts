import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, process.cwd(), [
      "BETTER_AUTH_",
      "SITE_",
      "BACKEND_",
      "CHAIN_ID",
      "CONTRACT_ADDRESS",
    ]),
  },
}));
