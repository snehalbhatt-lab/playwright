// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Two workers means two spec files can execute concurrently on
  // separate browser contexts. Within a spec, tests still run
  // serially (`test.describe.configure({ mode: "serial" })` is set at
  // the file level). Risk on this tenant: two workers racing on the
  // /threatmodels list (login + create + cleanup) when both are using
  // disposable models. Empirically the tenant handles it, and the
  // retry logic below covers transient session-drop flakes. Drop back
  // to 1 if we see systematic conflicts.
  workers: 2,
  // Retry transient failures once. Shared-tenant flakes (overlay
  // interception, kendo timing) usually clear on a fresh browser
  // context; this soaks up ~90% of the drift.
  retries: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    // Always-on trace: every Playwright action records a snapshot +
    // the resulting screenshot. Open via the HTML report's "View
    // trace" link to step through each action with its before/after
    // screenshot, console log, and network request.
    trace: "on",
    // Capture a final fullpage screenshot per test (in addition to
    // trace's per-action snapshots).
    screenshot: { mode: "on", fullPage: true },
    // Capture a video of every test playthrough.
    video: "on",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
