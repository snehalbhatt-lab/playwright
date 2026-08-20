# Excel tabs skipped for the Playwright test generation initiative

Batch triage as of 2026-08-18, updated 2026-08-19. Workbook: `ThreatModeler Test Cases 7.x (till 7.4.1).xlsx` (110 tabs total).

- **Completed to date: 36 tabs.**
- **Skipped: 58 tabs** (categorized below).
- **Remaining deliverable: 16 tabs.**

Each skipped tab lists row count and category. Skip reasons are structural — the tab either has no real test content, duplicates already-shipped work, needs infrastructure (file upload, second user, admin permission, external system, canvas pixel inspection) that Playwright driving the app cannot provide, or is dominated by destructive tenant mutations that would leave residue.

## A. Empty / no scenarios (11)

Tabs with 0 or ≤1 rows of real content — placeholder sheets, orphaned templates.

| Tab | Rows | Content |
|---|---|---|
| Sheet97 | 0 | empty |
| Attributes | 0 | empty |
| Access Management License | 0 | empty |
| Task (Diagram) | 0 | empty |
| Compare Version | 0 | empty |
| Multi-notes | 1 | 0 real |
| Copy of Compare Version Report | 1 | 0 real |
| Content Update | 1 | 0 real |
| Import page | 2 | 1 line |
| Async | 2 | 0 real |
| Assist Rule | 2 | 0 real |

## B. Scratch `Sheet*` sheets (5)

Numbered sheet names with no clear feature association — likely QA scratch space or exported drafts.

| Tab | Rows | Content |
|---|---|---|
| Sheet49 | 13 | 12 rows |
| Sheet66 | 103 | 97 rows |
| Sheet74 | 12 | 11 rows |
| Sheet75 | 23 | 22 rows |
| Sheet92 | 23 | 22 rows |

## C. Duplicates of already-shipped tabs (5)

Same feature, same test cases; coverage lives in the referenced spec.

| Tab | Rows | Duplicate of |
|---|---|---|
| TM creation based on previous v | 12 | `tests/create_model.spec.ts` |
| Copy of Custom Report | 24 | `tests/custom_report.spec.ts` |
| Copy of Access Management | 26 | `tests/access_management.spec.ts` |
| Copy of Diagram | 41 | (Diagram parent — also skipped, see I below) |
| Copy of Draw.io | 41 | Draw.io — also skipped, see D below |

## D. Import-gated — file upload (12)

Prompt rule: skip file-upload / bulk-import cases. Every scenario begins with "Click on Import button and check…" or similar upload-first steps.

| Tab | Rows |
|---|---|
| TerraForm Import | 17 |
| DrawIO Review screen | 17 |
| Sample for import test case in | 21 |
| IriusRisk Import | 22 |
| Azure Import | 24 |
| Miro Import | 26 |
| CFN Import | 27 |
| Json Import | 30 |
| TMT Import | 36 |
| Image Import | 39 |
| Draw.io | 41 |
| Visio Import1 | 43 |

## E. Canvas-blocked (6)

Visual features drawn on `<canvas>` — no DOM to inspect. Verified via probing on Component color change, Verizon, and Protocol Bulk Edit (see memory).

| Tab | Rows | What |
|---|---|---|
| Component color change | 14 | Canvas color palette per component |
| Verizon | 14 | Canvas threat risk badge color |
| Border color change | 19 | Canvas group border color |
| Threat Risk Colour | 20 | Same feature as Verizon |
| Attack path | 21 | Canvas + presentation recording |
| Protocol Bulk Edit | 24 | Right-click multi-selected canvas links → GoJS context menu (no DOM). Verified 2026-08-19: real Playwright right-click at link viewport coords produces no DOM menu; `link.contextMenu` is null. Same blocker as Default Protocol module A. |

## F. Integration-blocked (3)

External systems (Jira Azure Board, Hopex GRC, Mantis Bug Tracker). No credentials seeded, no request stubbing available in this pass.

| Tab | Rows |
|---|---|
| AzureBoard Integration | 4 |
| Hopex | 23 |
| Mantis Integration | 156 |

## G. Permission-blocked — Enterprise Admin required (4)

Every scenario needs Enterprise Admin permissions (create/edit/delete users, mutate departments, change permission grants). The test account (`sbhatt`) does not hold Enterprise Admin on tmdev.

| Tab | Rows |
|---|---|
| Default group | 15 |
| Copy of Access Management | 26 (also under C) |
| Access Management Permission | 337 |
| Which | 351 |
| Configuration | 372 |

## H. Cross-user fixture blocked (1)

Every scenario requires User A to mention User B, then log in as B and inspect the notification panel + click through. Needs a second seeded user + secondary session context.

| Tab | Rows |
|---|---|
| DiagramNotification | 17 |

## I. Destructive-heavy on shared threat models (7)

Tab is dominated by cases that create / mutate / delete real threat-model content that persists on the tenant. Realistic Playwright scope would be a small "dialog-shell" spec — not tracked as a full-tab delivery.

| Tab | Rows | Nature |
|---|---|---|
| Diagram | 688 | Whole diagram module — add/edit/delete/save on canvas + all inner panels |
| Compare Version Report | 36 | ~90% verify content inside downloaded PDF/CSV |
| Threat Framework | 294 | Framework editing (admin-gated) |
| Threatframework new function | 240 | Same |
| Framework CopyPaste | 216 | Same |
| Overview panel | 271 | Cross-cutting model overview with heavy setup |
| Resource Component fot GCP | 136 | GCP resource component library edits |

## J. Mystery / doubtful sheets (3)

Sheets with no clear feature name; content looks like partial drafts. Also includes spec/mapping tables that use a different column format (no Test Scenarios / Test Steps / Expected Result / Priority) and are dev documentation rather than test cases.

| Tab | Rows | Note |
|---|---|---|
| s | 28 | partial draft |
| Modules | 80 (only 13 content rows) | partial draft |
| Compliance Status for Report | 13 | Spec-vs-reality mapping table (columns: SR / SR Status on Diagram / SR Status on Report / Current Status). Two rows flag known implementation bugs. Automating would need destructive SR-status changes + Compliance Report content parity — same class as prior destructive + report-content skips. Verified 2026-08-20. |

## K. Feature not deployed on tmdev (1)

Tab describes a UI that does not exist on `https://tmdev.threatmodeler.us` (7.4.1). No entry point in the main app nav, no matching route, no visible container in the DOM. Likely a 7.5+ feature or a separate product/subdomain.

| Tab | Rows | What is missing on tmdev |
|---|---|---|
| AI Report | 36 real (79 total) | Standalone WingmanAI landing page. Excel describes header + threat model dropdown + prompt-box + "Start from template" + "Attach a report" cards + left nav with Chat Menu / Search / Chats Listing / Delete flow. Live tmdev only exposes an in-diagram 325 px sidebar (`#wingman-conversation-icon` → `.wingman-conversation-container`) with a minimal chat interface — no template cards, no left nav, no chat listing, no threat-model dropdown inside the panel. `/ai-report`, `/wingmanai`, `/wingman` all redirect to `/threatmodels`. Verified 2026-08-20. Only ~3 of 36 rows would map to what exists here (attachment icon, mic icon, prompt input) — poor ROI for a dedicated spec. |

---

# Deliverable candidates (~31 tabs)

Not skipped. To be shipped in the remaining budget.

**Small (< 40 rows)** — Notification (subset). (Shipped: Task, Tags Bulk Edit, Default Protocol, Cloudmodeler diagram filter, CVSS score, Export threats. Skipped: Protocol Bulk Edit — canvas; Compliance Status for Report — spec table, not tests.)

**Medium (40–70 rows)** — Home screen functionality work, Add threats(Per project), Custom Compliance, Notification, Wizard, Resource com VPC, Onboarding Tour, Create new model not use, Bidirectional, WingMan, Edit option, Residual Risk for threat, Security Requirements Mitigatio, NewCompliance Report, Auto Threat Mitigation, Save Filter, Integration Dashboard, CloudModeler (Changes).

**Large (70+ rows)** — Security Control 7.0. (Shipped: Template Builder, Dashboard1. Skipped: AI Report — feature not deployed on tmdev, see K.)

Some tabs above may reveal fresh blockers during Phase 2 probe and get moved into I on delivery. That's expected.
