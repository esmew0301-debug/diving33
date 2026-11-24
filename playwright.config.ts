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
    // traces record a screencast of every page, which slows the shared machine; opt in with PW_TRACE=1
    trace: process.env.PW_TRACE ? "retain-on-failure" : "off",
  },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/api/state",
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 300_000,
    env: { PGLITE_DIR: "memory", GROUP_COUNT: "4", GROUP_CAPACITY: "4", NEXT_DIST_DIR: ".next-e2e", HOST_PASSWORD: process.env.E2E_HOST_PASSWORD || "e2e-host-pw", ENABLE_TEST_HOOKS: "1" },
  },
});
