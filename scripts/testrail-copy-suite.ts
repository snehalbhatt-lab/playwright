// One-shot: duplicate a TestRail suite's structure (sections + cases) into a
// new suite in the same project. Preserves section parent hierarchy, case
// titles, templates, refs, type/priority, estimate, and all non-null
// custom_* fields.
//
// Attachments, test results, and run history are NOT copied — the sandbox
// starts clean.
//
// Usage:
//   TESTRAIL_URL=... TESTRAIL_USER=... TESTRAIL_API_KEY=... \
//     npx tsx scripts/testrail-copy-suite.ts \
//       --project 32 --source-suite 120 --name "Access Management 7.0 (Playwright Sandbox)"
//
// Idempotent via testrail/suite-<source>-copy.json — rerun-safe if interrupted.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const MAPPING_DIR = path.join(REPO_ROOT, "testrail");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const PROJECT_ID = Number(argValue("--project") ?? 0);
const SOURCE_SUITE_ID = Number(argValue("--source-suite") ?? 0);
const NEW_SUITE_NAME = argValue("--name") ?? "";

const cfg = {
  baseUrl: (process.env.TESTRAIL_URL ?? "").replace(/\/$/, ""),
  user: process.env.TESTRAIL_USER ?? "",
  apiKey: process.env.TESTRAIL_API_KEY ?? "",
};

function requireEnv(): void {
  const missing: string[] = [];
  if (!cfg.baseUrl) missing.push("TESTRAIL_URL");
  if (!cfg.user) missing.push("TESTRAIL_USER");
  if (!cfg.apiKey) missing.push("TESTRAIL_API_KEY");
  if (!PROJECT_ID) missing.push("--project");
  if (!SOURCE_SUITE_ID) missing.push("--source-suite");
  if (!NEW_SUITE_NAME) missing.push("--name");
  if (missing.length) {
    console.error(`[copy-suite] missing: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!/^https?:\/\//.test(cfg.baseUrl)) cfg.baseUrl = `https://${cfg.baseUrl}`;
}

async function api<T = any>(method: "GET" | "POST", pathSegment: string, body?: unknown): Promise<T> {
  const auth = Buffer.from(`${cfg.user}:${cfg.apiKey}`).toString("base64");
  const res = await fetch(`${cfg.baseUrl}/index.php?/api/v2${pathSegment}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`TestRail ${res.status} ${method} ${pathSegment}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface Mapping {
  sourceSuiteId: number;
  newSuiteId: number | null;
  sections: Record<string, number>; // source section_id → new section_id
  cases: Record<string, number>; // source case_id → new case_id
}

function mappingPath(): string {
  return path.join(MAPPING_DIR, `suite-${SOURCE_SUITE_ID}-copy.json`);
}

async function loadMapping(): Promise<Mapping> {
  try {
    return JSON.parse(await fs.readFile(mappingPath(), "utf8"));
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return { sourceSuiteId: SOURCE_SUITE_ID, newSuiteId: null, sections: {}, cases: {} };
    }
    throw err;
  }
}

async function saveMapping(m: Mapping): Promise<void> {
  await fs.mkdir(MAPPING_DIR, { recursive: true });
  await fs.writeFile(mappingPath(), JSON.stringify(m, null, 2) + "\n");
}

async function ensureSuite(map: Mapping): Promise<void> {
  if (map.newSuiteId) {
    console.log(`[copy-suite] reusing new suite ${map.newSuiteId}`);
    return;
  }
  const source = await api<any>("GET", `/get_suite/${SOURCE_SUITE_ID}`);
  const created = await api<any>("POST", `/add_suite/${PROJECT_ID}`, {
    name: NEW_SUITE_NAME,
    description: `Sandbox copy of suite ${SOURCE_SUITE_ID} "${source.name}". Created by scripts/testrail-copy-suite.ts.`,
  });
  map.newSuiteId = created.id;
  console.log(`[copy-suite] created suite ${map.newSuiteId} "${NEW_SUITE_NAME}"`);
  await saveMapping(map);
}

async function copySections(map: Mapping): Promise<void> {
  const source = await api<any>("GET", `/get_sections/${PROJECT_ID}&suite_id=${SOURCE_SUITE_ID}`);
  const srcSections: any[] = Array.isArray(source) ? source : source.sections ?? [];
  // Walk parents first so new parent_id can be looked up when creating children.
  const byParent = new Map<number | null, any[]>();
  for (const s of srcSections) {
    const p = s.parent_id ?? null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(s);
  }
  const queue: any[] = [...(byParent.get(null) ?? [])];
  while (queue.length) {
    const s = queue.shift()!;
    const key = String(s.id);
    if (!map.sections[key]) {
      const payload: any = {
        suite_id: map.newSuiteId,
        name: s.name,
        description: s.description ?? undefined,
      };
      if (s.parent_id) {
        const newParent = map.sections[String(s.parent_id)];
        if (!newParent) throw new Error(`parent ${s.parent_id} not yet created for section ${s.id}`);
        payload.parent_id = newParent;
      }
      const created = await api<any>("POST", `/add_section/${PROJECT_ID}`, payload);
      map.sections[key] = created.id;
      console.log(`  [section] "${s.name}" (${s.id} → ${created.id})`);
      await saveMapping(map);
    }
    for (const child of byParent.get(s.id) ?? []) queue.push(child);
  }
}

async function fetchAllCases(): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  for (;;) {
    const j = await api<any>(
      "GET",
      `/get_cases/${PROJECT_ID}&suite_id=${SOURCE_SUITE_ID}&limit=250&offset=${offset}`,
    );
    const arr: any[] = Array.isArray(j) ? j : j.cases ?? [];
    all.push(...arr);
    if (arr.length < 250) break;
    offset += 250;
    if (offset > 10000) break; // sanity cap
  }
  return all;
}

// Build the /add_case payload from a source case. Preserves template, type,
// priority, refs, estimate, and all non-null custom_* fields.
// `custom_version` is globally required on this TestRail tenant. If the
// source case has it null, fall back to a default so add_case doesn't fail.
// "6" matches suite 120's established baseline (observed on C14285).
const CUSTOM_VERSION_FALLBACK = process.env.CASE_CUSTOM_VERSION ?? "6";

function buildCasePayload(src: any): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: src.title,
    custom_version: src.custom_version ?? CUSTOM_VERSION_FALLBACK,
  };
  for (const k of ["template_id", "type_id", "priority_id", "refs", "estimate", "milestone_id"]) {
    if (src[k] !== null && src[k] !== undefined) payload[k] = src[k];
  }
  // TestRail stores legacy "unset" as 0 on dropdown fields configured with
  // option ids starting from 1. Posting 0 back fails with "invalid option
  // (available options 1, 2, 3, 4)". Skip zero-valued dropdowns to let
  // TestRail fall back to the field's configured default.
  const dropdownZeroFields = new Set([
    "custom_automation_type",
    "custom_ai_model",
    "custom_ai_type",
    "custom_case_isactive",
    "custom_case_tester",
  ]);
  for (const k of Object.keys(src)) {
    if (!k.startsWith("custom_")) continue;
    if (src[k] === null || src[k] === undefined) continue;
    if (src[k] === 0 && dropdownZeroFields.has(k)) continue;
    payload[k] = src[k];
  }
  return payload;
}

async function copyCases(map: Mapping): Promise<void> {
  const cases = await fetchAllCases();
  console.log(`[copy-suite] copying ${cases.length} cases…`);
  let created = 0;
  let reused = 0;
  let failed = 0;
  for (const c of cases) {
    const key = String(c.id);
    if (map.cases[key]) {
      reused++;
      continue;
    }
    const newSection = map.sections[String(c.section_id)];
    if (!newSection) {
      console.error(`  [skip] C${c.id}: source section ${c.section_id} not in mapping`);
      failed++;
      continue;
    }
    try {
      const payload = buildCasePayload(c);
      const resp = await api<any>("POST", `/add_case/${newSection}`, payload);
      map.cases[key] = resp.id;
      created++;
      if (created % 25 === 0) {
        await saveMapping(map);
        console.log(`    …copied ${created} cases so far`);
      }
    } catch (err) {
      console.error(`  [fail] C${c.id}: ${(err as Error).message}`);
      failed++;
    }
  }
  await saveMapping(map);
  console.log(`[copy-suite] cases created: ${created}, reused: ${reused}, failed: ${failed}`);
}

async function main(): Promise<void> {
  requireEnv();
  const map = await loadMapping();
  await ensureSuite(map);
  await copySections(map);
  await copyCases(map);
  console.log(`[copy-suite] done. Mapping: ${path.relative(REPO_ROOT, mappingPath())}`);
  console.log(`[copy-suite] new suite id: ${map.newSuiteId}`);
}

main().catch((err) => {
  console.error(`\n[copy-suite] FAILED: ${err.message}`);
  process.exit(1);
});
