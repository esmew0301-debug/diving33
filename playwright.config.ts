import { defineConfig } from "@playwright/test";

// Spins up an isolated server with a throwaway in-memory database on port 3100.
export default defineConfig({
  testDir: "e2e",
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    channel: process.env.PW_CHANNEL || "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/api/state",
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 300_000,
    env: { PGLITE_DIR: "memory", GROUP_COUNT: "4", GROUP_CAPACITY: "4", NEXT_DIST_DIR: ".next-e2e" },
  },
});
