// One-shot bootstrap: create the "PlaywrightIntegrateTestrail" TestRail project,
// walk every tests/*.spec.ts, create one section per spec + one case per test,
// then rewrite the spec's `caseIds(info, ...)` call with the new Cxxx id
// (R-prefixed Excel row refs are preserved alongside for traceability).
//
// Usage:
//   npx tsx scripts/testrail-bootstrap.ts            # dry-run (default)
//   npx tsx scripts/testrail-bootstrap.ts --apply    # actually hits TestRail + rewrites specs
//
// Env (required for --apply): TESTRAIL_URL, TESTRAIL_USER, TESTRAIL_API_KEY
//
// Idempotent via testrail/case-map.json — rerun-safe: cases already minted
// are skipped. Delete the mapping file to start fresh (requires manual
// TestRail cleanup first).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(REPO_ROOT, "tests");
const MAPPING_DIR = path.join(REPO_ROOT, "testrail");
const MAPPING_PATH = path.join(MAPPING_DIR, "case-map.json");
const PROJECT_NAME = "PlaywrightIntegrateTestrail";
const SUITE_NAME = "PlaywrightIntegrateTestrail";
const SUITE_DESCRIPTION =
  "Bootstrapped from Playwright specs by scripts/testrail-bootstrap.ts. One section per spec file, one case per test(…) block. Case titles mirror Playwright test titles.";
const PROJECT_ANNOUNCEMENT = SUITE_DESCRIPTION;
// This TestRail instance has a globally-required `custom_version` field. Default
// matches the tmdev tenant version. Override with CASE_CUSTOM_VERSION env.
const CASE_CUSTOM_VERSION = process.env.CASE_CUSTOM_VERSION ?? "7.4.1";

const APPLY = process.argv.includes("--apply");

interface Cfg {
  baseUrl: string;
  user: string;
  apiKey: string;
}

const cfg: Cfg = {
  baseUrl: (process.env.TESTRAIL_URL ?? "").replace(/\/$/, ""),
  user: process.env.TESTRAIL_USER ?? "",
  apiKey: process.env.TESTRAIL_API_KEY ?? "",
};

function requireEnv(): void {
  const missing: string[] = [];
  if (!cfg.baseUrl) missing.push("TESTRAIL_URL");
  if (!cfg.user) missing.push("TESTRAIL_USER");
  if (!cfg.apiKey) missing.push("TESTRAIL_API_KEY");
  if (missing.length) {
    console.error(`[bootstrap] missing env: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!/^https?:\/\//.test(cfg.baseUrl)) {
    cfg.baseUrl = `https://${cfg.baseUrl}`;
  }
}

async function api<T = any>(
  method: "GET" | "POST",
  pathSegment: string,
  body?: unknown,
): Promise<T> {
  const auth = Buffer.from(`${cfg.user}:${cfg.apiKey}`).toString("base64");
  const res = await fetch(`${cfg.baseUrl}/index.php?/api/v2${pathSegment}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`TestRail ${res.status} ${method} ${pathSegment}: ${text}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

interface ParsedTest {
  testLineIdx: number;
  caseLineIdx: number;
  title: string;
  oldIds: string[];
}

// Parse a spec file: find every `test(...)` / `test.skip|only|fixme(...)` block,
// then scan up to 25 lines forward for the first `caseIds(info, ...)` call.
function parseSpec(text: string): ParsedTest[] {
  const lines = text.split(/\r?\n/);
  const tests: ParsedTest[] = [];
  // Capture the opening quote and only close on the matching quote so titles
  // containing the opposite quote char aren't truncated.
  const testRe = /\btest(?:\.(?:skip|only|fixme))?\s*\(\s*(["'`])((?:\\.|(?!\1).)*)\1/;
  // Match `caseIds(info)` with or without args — the no-args form is valid
  // and must be captured so the next test doesn't steal its caseIds call.
  const caseRe = /caseIds\s*\(\s*info\s*(?:,\s*([^)]*))?\)/;
  for (let i = 0; i < lines.length; i++) {
    const tm = lines[i].match(testRe);
    if (!tm) continue;
    const title = tm[2];
    let caseLine = -1;
    let argsRaw = "";
    for (let j = i; j < Math.min(i + 25, lines.length); j++) {
      const cm = lines[j].match(caseRe);
      if (cm) {
        caseLine = j;
        argsRaw = cm[1];
        break;
      }
    }
    if (caseLine === -1) continue;
    const oldIds = argsRaw
      .split(",")
      .map((s) => s.trim().replace(/^["'`]|["'`]$/g, ""))
      .filter(Boolean);
    tests.push({ testLineIdx: i, caseLineIdx: caseLine, title, oldIds });
  }
  return tests;
}

interface SpecPlan {
  file: string;
  sectionName: string;
  tests: ParsedTest[];
}

async function discoverPlan(): Promise<SpecPlan[]> {
  const entries = await fs.readdir(TESTS_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".spec.ts"))
    .map((e) => e.name)
    .sort();
  const plan: SpecPlan[] = [];
  for (const file of files) {
    const text = await fs.readFile(path.join(TESTS_DIR, file), "utf8");
    const tests = parseSpec(text);
    if (tests.length === 0) continue;
    plan.push({
      file,
      sectionName: file.replace(/\.spec\.ts$/, ""),
      tests,
    });
  }
  return plan;
}

interface CaseMap {
  projectId: number | null;
  suiteId: number | null;
  sections: Record<string, number>;
  cases: Record<string, number>;
}

async function loadMapping(): Promise<CaseMap> {
  try {
    const raw = await fs.readFile(MAPPING_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return { projectId: null, suiteId: null, sections: {}, cases: {} };
    }
    throw err;
  }
}

async function saveMapping(map: CaseMap): Promise<void> {
  await fs.mkdir(MAPPING_DIR, { recursive: true });
  await fs.writeFile(MAPPING_PATH, JSON.stringify(map, null, 2) + "\n");
}

async function ensureProject(map: CaseMap): Promise<void> {
  if (map.projectId) {
    console.log(`[bootstrap] reusing project ${map.projectId}`);
  } else {
    const existing = await api<any>("GET", `/get_projects`);
    const projects = Array.isArray(existing) ? existing : existing?.projects ?? [];
    const hit = projects.find((p: any) => p.name === PROJECT_NAME);
    if (hit) {
      console.log(`[bootstrap] project "${PROJECT_NAME}" already exists (id=${hit.id}) — reusing`);
      map.projectId = hit.id;
    } else {
      const created = await api<any>("POST", `/add_project`, {
        name: PROJECT_NAME,
        announcement: PROJECT_ANNOUNCEMENT,
        show_announcement: true,
        suite_mode: 1,
      });
      map.projectId = created.id;
      console.log(`[bootstrap] created project "${PROJECT_NAME}" (id=${map.projectId})`);
    }
  }
  await ensureSuite(map);
}

async function ensureSuite(map: CaseMap): Promise<void> {
  if (map.suiteId) {
    console.log(`[bootstrap] reusing suite ${map.suiteId}`);
    return;
  }
  // Detect single- vs multi-suite via /get_project. suite_mode: 1=single,
  // 2=single+baselines, 3=multi.
  const project = await api<any>("GET", `/get_project/${map.projectId}`);
  const multi = project.suite_mode === 3;
  const existing = await api<any[]>("GET", `/get_suites/${map.projectId}`);
  const suites = Array.isArray(existing) ? existing : [];
  if (!multi) {
    if (suites.length === 0) throw new Error(`no suite in single-suite project ${map.projectId}`);
    map.suiteId = suites[0].id;
    console.log(`[bootstrap] single-suite project — using suite ${map.suiteId}`);
  } else {
    const hit = suites.find((s) => s.name === SUITE_NAME);
    if (hit) {
      map.suiteId = hit.id;
      console.log(`[bootstrap] suite "${SUITE_NAME}" already exists (id=${map.suiteId}) — reusing`);
    } else {
      const created = await api<any>("POST", `/add_suite/${map.projectId}`, {
        name: SUITE_NAME,
        description: SUITE_DESCRIPTION,
      });
      map.suiteId = created.id;
      console.log(`[bootstrap] created suite "${SUITE_NAME}" (id=${map.suiteId})`);
    }
  }
  await saveMapping(map);
}

async function ensureSection(map: CaseMap, sectionName: string): Promise<number> {
  if (map.sections[sectionName]) return map.sections[sectionName];
  const created = await api<any>("POST", `/add_section/${map.projectId}`, {
    suite_id: map.suiteId,
    name: sectionName,
  });
  map.sections[sectionName] = created.id;
  console.log(`  [section] "${sectionName}" (id=${created.id})`);
  await saveMapping(map);
  return created.id;
}

async function ensureCase(
  map: CaseMap,
  sectionId: number,
  file: string,
  title: string,
  oldIds: string[],
): Promise<number> {
  const key = `${file}::${title}`;
  if (map.cases[key]) return map.cases[key];
  const refs = oldIds.length ? oldIds.join(", ") : undefined;
  const created = await api<any>("POST", `/add_case/${sectionId}`, {
    title: title.slice(0, 250),
    refs,
    custom_version: CASE_CUSTOM_VERSION,
  });
  map.cases[key] = created.id;
  await saveMapping(map);
  return created.id;
}

// Rewrite each spec's `caseIds(info, ...)` call to put the new Cxxx first,
// followed by any R-prefixed Excel refs (preserved for grep). Pre-existing
// Cxxx values are dropped — the new one supersedes them.
async function rewriteSpecs(plan: SpecPlan[], map: CaseMap): Promise<void> {
  for (const spec of plan) {
    const full = path.join(TESTS_DIR, spec.file);
    const text = await fs.readFile(full, "utf8");
    const lines = text.split(/\r?\n/);
    const tests = parseSpec(text);
    for (const t of tests) {
      const key = `${spec.file}::${t.title}`;
      const newId = map.cases[key];
      if (!newId) continue;
      const rPrefs = t.oldIds.filter((id) => /^R\d/i.test(id) || /\.R\d/i.test(id));
      const kept = [`C${newId}`, ...rPrefs];
      const quoted = kept.map((s) => `"${s}"`).join(", ");
      lines[t.caseLineIdx] = lines[t.caseLineIdx].replace(
        /caseIds\s*\(\s*info\s*,\s*[^)]+\)/,
        `caseIds(info, ${quoted})`,
      );
    }
    await fs.writeFile(full, lines.join("\n"));
    console.log(`  [rewrite] ${spec.file}`);
  }
}

function printDryRunPlan(plan: SpecPlan[]): void {
  const totalTests = plan.reduce((n, s) => n + s.tests.length, 0);
  console.log(`\n[dry-run] would create:`);
  console.log(`  project: ${PROJECT_NAME} (single-suite mode)`);
  console.log(`  sections: ${plan.length}`);
  console.log(`  cases:    ${totalTests}`);
  console.log(`\nper-section breakdown:`);
  for (const s of plan) {
    console.log(`  ${s.sectionName.padEnd(42)} ${String(s.tests.length).padStart(3)} tests`);
  }
  console.log(`\nsample cases (first 3 per section, first 3 sections):`);
  for (const s of plan.slice(0, 3)) {
    console.log(`  [${s.sectionName}]`);
    for (const t of s.tests.slice(0, 3)) {
      console.log(`    • ${t.title}   (refs: ${t.oldIds.join(", ")})`);
    }
  }
  console.log(`\nRerun with --apply to actually create them.`);
}

async function main(): Promise<void> {
  const plan = await discoverPlan();
  if (!APPLY) {
    printDryRunPlan(plan);
    return;
  }
  requireEnv();
  const map = await loadMapping();
  await ensureProject(map);
  let created = 0;
  let skipped = 0;
  for (const spec of plan) {
    const sectionId = await ensureSection(map, spec.sectionName);
    for (const t of spec.tests) {
      const key = `${spec.file}::${t.title}`;
      if (map.cases[key]) {
        skipped++;
        continue;
      }
      await ensureCase(map, sectionId, spec.file, t.title, t.oldIds);
      created++;
      if (created % 25 === 0) console.log(`    …created ${created} cases so far`);
    }
  }
  console.log(`\n[bootstrap] cases created: ${created}, reused from mapping: ${skipped}`);
  console.log(`[bootstrap] rewriting specs with new Cxxx ids…`);
  await rewriteSpecs(plan, map);
  console.log(`[bootstrap] done. Mapping saved to ${path.relative(REPO_ROOT, MAPPING_PATH)}`);
}

main().catch((err) => {
  console.error(`\n[bootstrap] FAILED: ${err.message}`);
  process.exit(1);
});
