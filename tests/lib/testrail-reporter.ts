import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
  Suite,
  FullConfig,
} from "@playwright/test/reporter";

// TestRail default status_ids: 1=passed, 2=blocked, 3=untested, 4=retest, 5=failed.
// Overridable via env (TESTRAIL_STATUS_PASSED / _BLOCKED / _FAILED) in case a
// tenant customised their statuses.
const STATUS = {
  passed: Number(process.env.TESTRAIL_STATUS_PASSED ?? 1),
  blocked: Number(process.env.TESTRAIL_STATUS_BLOCKED ?? 2),
  failed: Number(process.env.TESTRAIL_STATUS_FAILED ?? 5),
};

interface TRResult {
  case_id: number;
  status_id: number;
  comment?: string;
  elapsed?: string;
}

// Env-gated: unset credentials ⇒ reporter is a no-op. Install in
// playwright.config.js reporter array; it stays quiet locally until the
// TESTRAIL_* env vars are populated (CI secrets).
export default class TestRailReporter implements Reporter {
  private results = new Map<number, TRResult>();
  private runId?: number;
  private cfg = {
    baseUrl: process.env.TESTRAIL_URL ?? "",
    user: process.env.TESTRAIL_USER ?? "",
    apiKey: process.env.TESTRAIL_API_KEY ?? "",
    projectId: Number(process.env.TESTRAIL_PROJECT_ID ?? 0),
    suiteId: process.env.TESTRAIL_SUITE_ID ? Number(process.env.TESTRAIL_SUITE_ID) : undefined,
    runId: process.env.TESTRAIL_RUN_ID ? Number(process.env.TESTRAIL_RUN_ID) : undefined,
    runName: process.env.TESTRAIL_RUN_NAME ?? `Playwright ${new Date().toISOString()}`,
    closeRun: process.env.TESTRAIL_CLOSE_RUN === "true",
  };

  async onBegin(_: FullConfig, __: Suite): Promise<void> {
    if (!this.enabled()) return;
    if (this.cfg.runId) {
      this.runId = this.cfg.runId;
      return;
    }
    try {
      const run = await this.api("POST", `/add_run/${this.cfg.projectId}`, {
        suite_id: this.cfg.suiteId,
        name: this.cfg.runName,
        include_all: true,
      });
      this.runId = run.id;
      console.log(`[TestRail] created run ${this.runId} ("${this.cfg.runName}")`);
    } catch (err) {
      console.error(`[TestRail] failed to create run — reporter disabled for this invocation: ${(err as Error).message}`);
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!this.enabled() || !this.runId) return;
    const ids = this.extractCaseIds(test);
    if (ids.length === 0) return;
    const base = {
      status_id: this.mapStatus(result.status),
      comment: this.buildComment(test, result),
      elapsed: result.duration
        ? `${Math.max(1, Math.round(result.duration / 1000))}s`
        : undefined,
    };
    // last-write-wins: Playwright calls onTestEnd again on retry; the final
    // retry's status overwrites earlier attempts in the map.
    for (const case_id of ids) this.results.set(case_id, { case_id, ...base });
  }

  async onEnd(_: FullResult): Promise<void> {
    if (!this.enabled() || !this.runId || this.results.size === 0) return;
    try {
      await this.api("POST", `/add_results_for_cases/${this.runId}`, {
        results: Array.from(this.results.values()),
      });
      if (this.cfg.closeRun) {
        await this.api("POST", `/close_run/${this.runId}`, {});
      }
      console.log(
        `[TestRail] pushed ${this.results.size} results → run ${this.runId}` +
          (this.cfg.closeRun ? " (closed)" : ""),
      );
    } catch (err) {
      console.error(`[TestRail] failed to push results: ${(err as Error).message}`);
    }
  }

  private enabled(): boolean {
    return !!(this.cfg.baseUrl && this.cfg.user && this.cfg.apiKey && this.cfg.projectId);
  }

  // Pull Cxxx IDs out of `caseIds(info, "C13619", "C13620")`-style annotations.
  // Skips Excel-row refs like "R014" that are also tagged on some specs.
  private extractCaseIds(test: TestCase): number[] {
    return test.annotations
      .filter((a) => a.type === "case" && typeof a.description === "string")
      .flatMap((a) => (a.description as string).split(/[\s,]+/))
      .filter((s) => /^C\d+$/i.test(s))
      .map((s) => Number(s.slice(1)));
  }

  private mapStatus(s: TestResult["status"]): number {
    if (s === "passed") return STATUS.passed;
    if (s === "skipped") return STATUS.blocked;
    return STATUS.failed;
  }

  private buildComment(test: TestCase, r: TestResult): string {
    const title = test.titlePath().slice(1).join(" > ");
    const err = r.error?.message?.slice(0, 2000);
    return err ? `${title}\n\nError:\n${err}` : title;
  }

  private async api(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
    const auth = Buffer.from(`${this.cfg.user}:${this.cfg.apiKey}`).toString("base64");
    const res = await fetch(`${this.cfg.baseUrl}/index.php?/api/v2${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`TestRail ${res.status} ${method} ${path}: ${await res.text()}`);
    }
    return res.json();
  }
}
