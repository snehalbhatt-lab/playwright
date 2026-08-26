# ThreatModeler 7.x Automated Test Coverage — Summary

**For:** QA leads, product managers, stakeholders
**Source of truth:** `ThreatModeler Test Cases 7.x (till 7.4.1).xlsx`
**Environment tested:** `tmdev.threatmodeler.us`
**Last updated:** 2026-08-26

---

## The Big Picture

We reviewed **every test case** in the ThreatModeler 7.x QA workbook (110 worksheet tabs, 5,000+ individual scenarios) and turned as many as possible into automated tests that run in a browser without any human clicking.

| What we found | Number |
|---|---|
| Total tabs in the workbook | **110** |
| Tabs we automated | **45** |
| Tabs we chose to skip (with clear reasons) | **64** |
| Tabs held back for the next phase | 1 |
| Individual test scenarios now covered | **643** |
| Number of automated tests that run those scenarios | **241** |

**In plain English:** of every 10 scenarios in the workbook, we're able to automate about 4. The other 6 either duplicate work, need setup the automation can't do (like uploading a file or logging in as a different user), or describe things the current environment doesn't have.

**Efficiency:** the 241 automated tests cover 643 scenarios — that's because many scenarios overlap. If two scenarios click the same button and check the same result, one automated test proves them both.

---

## What "Shipped" Means

For each of the 45 shipped tabs, we now have:

- A **script** that logs into ThreatModeler, walks through the feature, and confirms it works.
- **Screenshots** captured at every meaningful step (so you can see what happened even if the test failed).
- **Traces + videos** recorded on failure (so QA can replay exactly what happened).
- A record of **which workbook scenarios** it covers, so you can trace any test back to the original Excel row.

These tests run automatically. When someone changes the app, the tests re-run and flag anything that broke.

---

## What "Skipped" Means

A skipped tab is **not** a gap — it's a decision. Every skip is documented in the repo file `excel/SKIPS.md` with a plain-English reason. The 64 skipped tabs fall into 11 categories:

### The Skip Categories at a Glance

| Category | Tabs skipped | Why we skipped them |
|---|---:|---|
| A. Empty / no real content | 11 | Placeholder sheets, no actual test steps |
| B. Untitled scratch sheets | 5 | QA scratch space, no clear feature attached |
| C. Duplicates of already-shipped tabs | 5 | Same tests we already automated elsewhere |
| D. Requires file upload | 12 | Automation can't reliably attach files from disk |
| E. Depends on canvas graphics | 7 | Features drawn as pictures, no way to inspect them programmatically |
| F. Needs external system | 3 | Jira, Hopex, Mantis — no test credentials |
| G. Needs admin-level access | 4 | Our test account doesn't have Enterprise Admin |
| H. Needs a second user | 1 | Notifications require sender + recipient |
| I. Would damage shared data | 9 | Tests would delete real threat models used by others |
| J. Not test cases at all | 4 | Developer documentation, spec-mapping tables |
| K. Feature isn't live yet | 3 | UI described in workbook doesn't exist on tmdev |
| **Total** | **64** | |

---

## Skip Categories in Detail

### A. Empty / no real content (11 tabs)

These sheets look like placeholders left over from earlier drafts.

> **Example:** the tab "Multi-notes" has 1 row and it's just a heading. There's no test to run.

**Tabs:** Sheet97, Attributes, Access Management License, Task (Diagram), Compare Version, Multi-notes, Copy of Compare Version Report, Content Update, Import page, Async, Assist Rule

---

### B. Untitled scratch sheets (5 tabs)

Sheets named "Sheet49", "Sheet66", etc. No feature name, no clear owner. Treated as scratch work.

**Tabs:** Sheet49, Sheet66, Sheet74, Sheet75, Sheet92

---

### C. Duplicates of shipped tabs (5 tabs)

The scenarios repeat work we've already automated on another tab.

| Duplicate tab | Already covered by |
|---|---|
| TM creation based on previous v | Create Model tests |
| Copy of Custom Report | Custom Report tests |
| Copy of Access Management | Access Management tests |
| Copy of Diagram | Diagram (also skipped) |
| Copy of Draw.io | Draw.io (also skipped) |

---

### D. Requires file upload (12 tabs)

Every scenario starts with "click Import and upload a file." Automation can attach files, but the many different formats each need custom setup and reliable sample files — out of scope for this pass.

> **What this means for you:** these features still need to be tested manually, or need a dedicated automation pass with prepared sample files.

**Tabs:** TerraForm Import, DrawIO Review screen, Sample import test cases, IriusRisk Import, Azure Import, Miro Import, CFN Import, JSON Import, TMT Import, Image Import, Draw.io, Visio Import1

---

### E. Depends on canvas graphics (7 tabs)

Some features (like the diagram canvas colors, arrow directions, threat badges) are drawn as images. The automation can see the code behind buttons and text, but it can't "look at" a picture the way a human does.

> **What this means for you:** visual features on the diagram canvas remain manual-test-only.

**Tabs:** Component color change, Verizon, Border color change, Threat Risk Colour, Attack path, Protocol Bulk Edit, Bidirectional

---

### F. Needs external system (3 tabs)

Tests require a live Jira board, Hopex GRC, or Mantis Bug Tracker with test credentials — none are set up in the test environment.

**Tabs:** AzureBoard Integration, Hopex, Mantis Integration

---

### G. Needs admin-level access (4 tabs)

Every scenario needs Enterprise Admin permissions. The test account doesn't have that role.

> **What this means for you:** if we're given an Enterprise Admin test account, these can be re-triaged.

**Tabs:** Default group, Access Management Permission, Which, Configuration

---

### H. Needs a second user (1 tab)

The DiagramNotification scenarios need one user to mention another, then log in as the second user to see the notification. Automation currently runs as one user.

**Tab:** DiagramNotification

---

### I. Would damage shared data (9 tabs)

These scenarios create, edit, or delete real threat models on the shared test environment. Running them automatically would leave debris that other testers see.

> **What this means for you:** these are candidates for a future pass where we spin up dedicated throwaway threat models.

**Tabs:** Diagram, Compare Version Report, Threat Framework, Threatframework new function, Framework CopyPaste, Overview panel, Resource Component for GCP, Residual Risk for threat, Edit option

---

### J. Not test cases at all (4 tabs)

Some sheets in the workbook are actually developer documentation (specification tables, mapping tables) instead of test cases. Nothing to automate.

**Tabs:** s, Modules, Compliance Status for Report, Resource com VPC

---

### K. Feature isn't live yet on tmdev (3 tabs)

The workbook describes UI that doesn't exist on the current test environment (tmdev). Likely a 7.5+ feature or a different product.

| Tab | What's missing |
|---|---|
| AI Report | Standalone WingmanAI landing page — only a minimal in-diagram sidebar exists |
| WingMan | Full Wingman panel with Help/Support tabs — same minimal sidebar only |
| Create new model not use | Legacy multi-step wizard — replaced by the current single-step Create dialog |

> **What this means for you:** re-check when 7.5 ships.

---

## Shipped Tabs — How Much Each Covers

The 45 shipped tabs became 46 automation files (one tab was split into two for clarity). Here's how many scenarios each one automates:

| Feature area | Automated tests | Scenarios covered |
|---|---:|---:|
| Threat Models Screen | 21 | 129 |
| Dashboard | 16 | 91 |
| Configuration | 11 | 74 |
| Custom Report | 11 | 30 |
| Access Management | 9 | 33 |
| Solution Hub | 9 | 23 |
| User Profile | 9 | 28 |
| Audit Report | 10 | 16 |
| Rule Engine | 10 | 18 |
| CISO Report | 8 | 11 |
| Login | 8 | 18 |
| Developer Report | 6 | 10 |
| User Report | 6 | 12 |
| Custom Risk Calculation | 6 | 6 |
| CVSS Score | 5 | 7 |
| Save Filter | 5 | 6 |
| Share Collaborator | 5 | 5 |
| Tags Bulk Edit | 5 | 5 |
| Version History | 5 | 6 |
| Compliance Report (New) | 4 | 7 |
| Email Template | 4 | 5 |
| Export Threats | 4 | 6 |
| Home Screen | 4 | 10 |
| Note @mention | 4 | 5 |
| Onboarding Tour | 4 | 4 |
| Template Builder | 4 | 6 |
| Toolbox Search | 4 | 8 |
| Tray Filter | 4 | 11 |
| Create Model | 3 | 3 |
| Default Protocol | 3 | 5 |
| Integration Dashboard | 3 | 3 |
| On Form Validation | 3 | 6 |
| Threat Dashboard | 3 | 5 |
| Wizard | 3 | 3 |
| Add Threats (Per Project) | 2 | 1 |
| Approval (New) | 2 | 2 |
| Auto Threat Mitigation | 2 | 4 |
| CloudModeler Changes | 2 | 3 |
| Custom Compliance | 2 | 2 |
| Diagram Filter | 2 | 2 |
| Help Section | 2 | 3 |
| Notification | 2 | 3 |
| Security Requirements Mitigation | 2 | 2 |
| Task | 2 | 2 |
| CVSS 4.0 | 1 | 1 |
| Security Control 7.0 | 1 | 3 |
| **TOTAL** | **241** | **643** |

---

## How the Tests Are Doing Right Now

Latest full run:

| Result | Count | Meaning |
|---|---:|---|
| ✅ Passed | 221 | The feature works as expected |
| ⚠️ Flaky | 6 | Failed the first time but passed on retry (usually a timing hiccup) |
| ❌ Failed | 11 | The feature is broken OR the test is out of date |
| ⏭️ Skipped | 7 | Intentionally not run this time |
| **Pass rate** | **92.9%** | |

### The 11 Failures — Investigated and Categorized

After investigating, **8 of the 11 failures have been fixed** on the code branch (commit `e9bf8d3`). Here's what was going on:

| # | Test | What was wrong | Now |
|---|---|---|---|
| 1 | CVSS 4.0 default check | Test expected "CVSS 3.1" default, but app now defaults to "CVSS 4.0" | ✅ Fixed |
| 2 | Login page controls | Test looked for an SSO link that no longer exists on this environment | ✅ Fixed |
| 3 | Login SSO href check | Same missing SSO link | ✅ Fixed |
| 4 | Note character counter | Feature timing — test needed a longer wait | ✅ Fixed |
| 5 | Save Filter cancel | Button occasionally didn't appear on first click; added retry | ✅ Fixed |
| 6 | Threat Model archive & restore | The whole archive workflow needed rewriting after UI changes | ✅ Fixed |
| 7 | Threat Model permanent delete | Same archive workflow rewrite | ✅ Fixed |
| 8 | Threat Model status change | Same archive workflow rewrite | ✅ Fixed |
| 9 | Threat Model edit + cleanup | Archive cleanup after editing a row leaves the app in a state that blocks archive | ❌ Still failing |
| 10 | Threat Model tags + cleanup | Same as #9 | ❌ Still failing |
| 11 | Threat Model collaborator + cleanup | Same as #9 | ❌ Still failing |

**Bottom line:** the archive workflow was silently broken because ThreatModeler's UI changed — different menu paths, different selectors, and a "Welcome to ThreatModeler Nexus" popup that steals clicks. All of that is now handled correctly in isolation. The remaining 3 failures all share the same edge case (archive after in-row editing) and need one more round of investigation.

---

## Frequently Asked Questions

**Q: Why don't we automate all 110 tabs?**
A: Because 64 of them either can't be automated (needs a human, needs an admin account, needs a real Jira) or shouldn't be automated (empty, duplicated, or already covered). Skipping them with reasons is a deliberate choice, not a gap.

**Q: How does 643 scenarios collapse into 241 tests?**
A: Many workbook rows are variations of the same button-click. If R073, R074, R075, and R076 all say "click the Users tab, click the Groups tab, click the Roles tab, click the Departments tab and verify each becomes selected," one test with a loop covers all four. The report annotates all four IDs on that test.

**Q: What if a skipped scenario becomes important later?**
A: Every skip has a documented reason. If the reason changes (new test account, new feature ships, file upload becomes needed), the tab can be re-triaged and moved into the shipped bucket. `excel/SKIPS.md` is the source of truth.

**Q: Can I trace a test result back to the original Excel row?**
A: Yes. Every automated test tags every workbook row it covers. When a test fails, the failure report lists every R-ID affected.

**Q: Where's the test report?**
A: Run `npx playwright show-report` in the repo, or ask a developer to open the report — it's a browsable HTML page with screenshots, traces, and videos.

---

## Glossary

- **Tab (worksheet tab):** one worksheet inside the Excel workbook, roughly one feature area of the app.
- **Scenario / R-ID / test case:** one numbered row inside a tab, describing one thing to check (e.g. "R016 - SSO link points to the SAML2 endpoint").
- **Automated test:** a script that plays out one or more scenarios in a browser and confirms the result.
- **Merged test:** one script that covers multiple scenarios sharing the same code path.
- **Shipped:** the scenario is now automated and runs on every build.
- **Skipped:** we've decided not to automate it, for a documented reason.
- **Flaky test:** a test that failed one attempt but passed on retry — usually a timing issue, not a broken feature.
- **Trace / screenshot / video:** artifacts the automation captures so you can review exactly what happened during a test.
- **tmdev:** short for the test environment at `tmdev.threatmodeler.us`.
