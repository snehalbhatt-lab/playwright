import fs from "node:fs/promises";
import path from "node:path";
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

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

interface PendingAttachment {
  filename: string;
  contentType: string;
  path?: string;
  body?: Buffer;
}

interface TRResult {
  case_id: number;
  status_id: number;
  comment?: string;
  elapsed?: string;
  // Internal only — stripped before POSTing results payload.
  _attachments?: PendingAttachment[];
}

// Env-gated: unset credentials ⇒ reporter is a no-op. Install in
// playwright.config.js reporter array; it stays quiet locally until the
// TESTRAIL_* env vars are populated (CI secrets).
//
// Attachments: by default uploads screenshots + traces for failing/blocked
// tests only (passing tests don't need them). Config:
//   TESTRAIL_ATTACH_ON        = never | failures | always   (default: failures)
//   TESTRAIL_ATTACH_INCLUDE   = comma-list of content types (default: image/png,application/zip)
//   TESTRAIL_ATTACH_MAX_BYTES = per-file size cap (default: 10485760 = 10 MiB)
export default class TestRailReporter implements Reporter {
  private results = new Map<number, TRResult>();
  private runId?: number;
  // Populated after the run is known. If undefined, no filtering happens;
  // if a Set, only case_ids in the Set are pushed. Prevents TestRail's
  // all-or-nothing 400 ("case Cxxx unknown or not part of the test run")
  // when a test is dual-tagged across suites.
  private runCaseIds?: Set<number>;
  private cfg = {
    baseUrl: normalizeBaseUrl(process.env.TESTRAIL_URL ?? ""),
    user: process.env.TESTRAIL_USER ?? "",
    apiKey: process.env.TESTRAIL_API_KEY ?? "",
    projectId: Number(process.env.TESTRAIL_PROJECT_ID ?? 0),
    suiteId: process.env.TESTRAIL_SUITE_ID ? Number(process.env.TESTRAIL_SUITE_ID) : undefined,
    runId: process.env.TESTRAIL_RUN_ID ? Number(process.env.TESTRAIL_RUN_ID) : undefined,
    runName: process.env.TESTRAIL_RUN_NAME ?? `Playwright ${new Date().toISOString()}`,
    closeRun: process.env.TESTRAIL_CLOSE_RUN === "true",
    attachOn: (process.env.TESTRAIL_ATTACH_ON ?? "failures") as "never" | "failures" | "always",
    attachInclude: new Set(
      (process.env.TESTRAIL_ATTACH_INCLUDE ?? "image/png,application/zip")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    attachMaxBytes: Number(process.env.TESTRAIL_ATTACH_MAX_BYTES ?? 10 * 1024 * 1024),
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
      return;
    }
    try {
      this.runCaseIds = await this.fetchRunCaseIds(this.runId!);
    } catch (err) {
      console.warn(`[TestRail] couldn't fetch run case_ids (will not filter): ${(err as Error).message}`);
    }
  }

  // Fetches every case_id in the run via /get_tests (paginated). Used to
  // drop out-of-scope case ids from the push payload — e.g., when a test is
  // dual-tagged with ids from a different suite.
  private async fetchRunCaseIds(runId: number): Promise<Set<number>> {
    const ids = new Set<number>();
    let offset = 0;
    for (;;) {
      const resp = await this.api<any>("GET", `/get_tests/${runId}&limit=250&offset=${offset}`);
      const tests = Array.isArray(resp) ? resp : resp?.tests ?? [];
      for (const t of tests) if (typeof t.case_id === "number") ids.add(t.case_id);
      if (tests.length < 250) break;
      offset += 250;
      if (offset > 10000) break; // sanity cap
    }
    return ids;
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
      _attachments: this.collectAttachments(result),
    };
    // last-write-wins: Playwright calls onTestEnd again on retry; the final
    // retry's status overwrites earlier attempts in the map.
    for (const case_id of ids) this.results.set(case_id, { case_id, ...base });
  }

  async onEnd(_: FullResult): Promise<void> {
    if (!this.enabled() || !this.runId || this.results.size === 0) return;
    try {
      const payload = Array.from(this.results.values()).map(
        // Strip the internal _attachments field before POST.
        ({ _attachments: _ignored, ...r }) => r,
      );
      // Filter out case_ids that aren't in this run (dual-tagged tests
      // can carry ids from a different suite). TestRail rejects the whole
      // batch otherwise with a 400.
      const filterByRun = (r: TRResult) =>
        !this.runCaseIds || this.runCaseIds.has(r.case_id);
      const localOrdered = Array.from(this.results.values()).filter(filterByRun);
      const filteredPayload = payload.filter(filterByRun);
      if (filteredPayload.length === 0) {
        console.warn(
          `[TestRail] no case_ids match run ${this.runId} — nothing to push ` +
            `(reporter saw ${this.results.size} tagged results)`,
        );
        return;
      }
      if (filteredPayload.length < payload.length) {
        console.log(
          `[TestRail] filtered ${payload.length - filteredPayload.length} out-of-scope case_ids; pushing ${filteredPayload.length}`,
        );
      }
      const created = await this.api<any>("POST", `/add_results_for_cases/${this.runId}`, {
        results: filteredPayload,
      });
      await this.uploadAttachmentsFor(localOrdered, Array.isArray(created) ? created : []);
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

  // Pull attachments off a Playwright TestResult, filtered by content type.
  // Returns both path-backed (auto screenshot/trace/video) and body-backed
  // (per-step capture() calls) attachments in a unified shape.
  private collectAttachments(r: TestResult): PendingAttachment[] {
    if (this.cfg.attachOn === "never") return [];
    if (this.cfg.attachOn === "failures" && r.status === "passed") return [];
    const out: PendingAttachment[] = [];
    for (const a of r.attachments) {
      if (!this.cfg.attachInclude.has(a.contentType)) continue;
      const filename = a.path ? path.basename(a.path) : `${a.name}${extensionFor(a.contentType)}`;
      if (a.path) out.push({ filename, contentType: a.contentType, path: a.path });
      else if (a.body) out.push({ filename, contentType: a.contentType, body: a.body });
    }
    return out;
  }

  private async uploadAttachmentsFor(
    localOrdered: TRResult[],
    created: Array<{ id?: number }>,
  ): Promise<void> {
    if (this.cfg.attachOn === "never") return;
    let uploaded = 0;
    let skipped = 0;
    for (let i = 0; i < localOrdered.length; i++) {
      const local = localOrdered[i];
      if (!local._attachments?.length) continue;
      const resultId = created[i]?.id;
      if (!resultId) continue;
      for (const a of local._attachments) {
        try {
          const body = a.body ?? (await fs.readFile(a.path!));
          if (body.length > this.cfg.attachMaxBytes) {
            console.warn(
              `[TestRail] skip attachment ${a.filename} (${body.length}B > ${this.cfg.attachMaxBytes}B)`,
            );
            skipped++;
            continue;
          }
          await this.uploadAttachment(resultId, a.filename, a.contentType, body);
          uploaded++;
        } catch (err) {
          console.error(
            `[TestRail] attachment ${a.filename} → result ${resultId} failed: ${(err as Error).message}`,
          );
          skipped++;
        }
      }
    }
    if (uploaded || skipped) {
      console.log(`[TestRail] attachments uploaded: ${uploaded}, skipped: ${skipped}`);
    }
  }

  private async uploadAttachment(
    resultId: number,
    filename: string,
    contentType: string,
    body: Buffer,
  ): Promise<void> {
    const form = new FormData();
    // Node 18+'s global Blob accepts Buffer directly (via ArrayBufferLike).
    form.append("attachment", new Blob([new Uint8Array(body)], { type: contentType }), filename);
    const auth = Buffer.from(`${this.cfg.user}:${this.cfg.apiKey}`).toString("base64");
    const res = await fetch(
      `${this.cfg.baseUrl}/index.php?/api/v2/add_attachment_to_result/${resultId}`,
      {
        method: "POST",
        // Don't set Content-Type — fetch sets it with the multipart boundary.
        headers: { Authorization: `Basic ${auth}` },
        body: form,
      },
    );
    if (!res.ok) {
      throw new Error(`TestRail ${res.status}: ${await res.text()}`);
    }
  }

  private async api<T = any>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
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

function extensionFor(ct: string): string {
  if (ct === "image/png") return ".png";
  if (ct === "image/jpeg") return ".jpg";
  if (ct === "application/zip") return ".zip";
  if (ct === "video/webm") return ".webm";
  if (ct === "text/plain" || ct === "text/markdown") return ".txt";
  return "";
}
