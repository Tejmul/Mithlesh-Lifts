import { defineConfig, devices } from "@playwright/test";

// End-to-end test against a local dev server using MOCK phone + email providers.
// Prereqs: `docker compose up -d`, `npm run db:test:prepare`.
const PORT = 3456;
const DATABASE_URL = "postgresql://css:css_local_only@localhost:5433/css_test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL,
      APP_URL: `http://localhost:${PORT}`,
      APP_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123456789",
      PHONE_VERIFY_PROVIDER: "mock",
      EMAIL_PROVIDER: "mock",
      CRON_SECRET: "e2e-cron-secret-123456",
    },
  },
});
