// Test configuration. External providers are ALWAYS mocked: automated runs never send real SMS/email.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://css:css_local_only@localhost:5433/css_test",
  APP_URL: "http://localhost:3000",
  APP_SECRET: "test-secret-test-secret-test-secret-0123456789",
  PHONE_VERIFY_PROVIDER: "mock",
  EMAIL_PROVIDER: "mock",
  CRON_SECRET: "test-cron-secret-123456",
});
