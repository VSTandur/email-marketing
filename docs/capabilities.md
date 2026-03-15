# Build and QC Automation Capabilities

This document answers the question: **"What can the automated Build and QC system do for Journey Builder and email content design?"**

---

## At a Glance

| Capability | Journey Builder | Email Content |
|---|:---:|:---:|
| Automated structural validation | ✅ | ✅ |
| Compliance checks (CAN-SPAM / CASL) | — | ✅ |
| AMPscript syntax validation | — | ✅ |
| JSON Schema validation | ✅ | — |
| Business rule checks | ✅ (12 rules) | ✅ (16 rules) |
| Pre-send deployment gate | ✅ | ✅ |
| CI/CD pipeline (GitHub Actions) | ✅ | ✅ |
| Machine-readable JSON reports | ✅ | ✅ |
| Fail-on-warning strict mode | ✅ | ✅ |
| Automated unit tests for QC rules | ✅ | ✅ |

---

## Journey Builder — Build and QC Capabilities

### What the Journey QC engine checks automatically

Every journey configuration (`.json` exported from SFMC) is validated by **12 business rules + JSON Schema**:

| Rule | Severity | What it catches |
|------|----------|-----------------|
| **JRN-SCHEMA** | Error | Journey JSON does not match the SFMC Journey Builder REST API schema |
| **JRN-001** | Warning | Journey has no conversion goal — cannot measure performance or trigger Einstein |
| **JRN-002** | Error | An `EMAILV2` activity is not linked to a real email asset ID — will fail to publish |
| **JRN-003** | Error | A `WAIT` activity has no duration set — contacts will be held indefinitely |
| **JRN-004** | Error | A decision/engagement split has fewer than 2 branches, or a branch points to a non-existent activity |
| **JRN-005** | Warning | Journey has no exit criteria — contacts may never leave the journey |
| **JRN-006** | Warning | Activity is using a default/generic name (e.g. "Email", "Wait") — breaks reporting clarity |
| **JRN-007** | Warning | Welcome/Onboarding journey uses `MultipleEntrances` — subscribers would receive the welcome series multiple times |
| **JRN-008** | Error | Journey key is missing or is a placeholder value like `undefined` or `new` |
| **JRN-009** | Error | Random split outcome percentages do not add up to 100% |
| **JRN-010** | Info | Journey description is blank or too short — impacts team documentation |
| **JRN-011** | Info | Journey has no tags — cannot be filtered in Journey Builder or Analytics Builder |
| **JRN-012** | Warning | An activity has no incoming path from any other activity — it is unreachable (orphaned) |

### Journey Build process — step by step

```
1. Design the journey in Journey Builder (SFMC UI)
2. Export the journey definition via SFMC REST API:
      GET /interaction/v1/interactions/key:{yourJourneyKey}
3. Save the JSON to: journeys/examples/<journey-name>.json
4. Run QC locally:
      node scripts/qc/journey-qc.js journeys/examples/<journey-name>.json
5. Fix all errors; address warnings
6. git push → GitHub Actions automatically validates the config in CI
7. QC gate blocks merge if any error is found
```

### Journey QC commands

```bash
# Validate all journey configs
npm run qc:journey

# Validate a single config with console output
node scripts/qc/journey-qc.js journeys/examples/welcome-series.json

# Output a machine-readable JSON report
node scripts/qc/journey-qc.js --json report/journey-qc.json

# Strict mode — fail on warnings too
node scripts/qc/journey-qc.js --fail-on-warning
```

### SSJS Journey Builder API helper

`scripts/ssjs/journey-builder-api.ssjs` provides 13 production-ready SSJS functions for programmatic journey lifecycle management from within SFMC:

| Function | Purpose |
|----------|---------|
| `getAccessToken()` | OAuth 2.0 token acquisition |
| `listJourneys(token, page, pageSize)` | Paginated journey listing |
| `getJourneyByKey(token, key)` | Fetch a journey definition by key |
| `createJourney(token, config)` | Create a new Draft journey |
| `updateJourney(token, id, version, config)` | Update a Draft journey |
| `publishJourney(token, id, version)` | Publish a Draft to Active |
| `pauseJourney(token, id, version)` | Pause an Active journey |
| `resumeJourney(token, id, version)` | Resume a Paused journey |
| `stopJourney(token, id, version)` | Stop and close a journey |
| `fireJourneyEvent(token, eventKey, contactKey, data)` | Inject a single contact via API entry event |
| `bulkFireJourneyEntryFromDE(token, eventKey, deName, max)` | Batch-inject contacts from a Data Extension |
| `getJourneyAuditLog(token, id, version)` | Retrieve the journey audit trail |
| `getContactJourneyStatus(token, journeyKey, contactKey)` | Check where a specific contact is in the journey |

---

## Email Content — Build and QC Capabilities

### What the Email QC engine checks automatically

Every HTML email template is validated by **16 rules**:

| Rule | Severity | What it catches |
|------|----------|-----------------|
| **EMAIL-001** | Error | Missing `%%unsub_center_url%%` — violates CAN-SPAM / CASL |
| **EMAIL-002** | Error | Missing `%%Member_Addr%%` physical address — violates CAN-SPAM |
| **EMAIL-003** | Error / Warning | `<img>` with no `alt` attribute (accessibility + image-blocked fallback) |
| **EMAIL-004** | Warning / Info | Link not wrapped in `RedirectTo()` (breaks SFMC click tracking); missing `alias` attribute |
| **EMAIL-005** | Error | Missing `<meta name="viewport">` — mobile rendering breaks |
| **EMAIL-006** | Error | Missing `<!DOCTYPE html>` — inconsistent rendering across clients |
| **EMAIL-007** | Warning | No inline styles on layout elements — Outlook/Gmail strips `<style>` blocks |
| **EMAIL-008** | Warning | Spam trigger words in body text (`click here`, `free money`, `guaranteed`, etc.) |
| **EMAIL-009** | Warning | `<title>` is missing or empty — some clients show this as the email title |
| **EMAIL-010** | Info | `<table>` with no explicit `width` attribute — Outlook rendering issue |
| **EMAIL-011** | Warning | `max-width` exceeds 650px — clips on many desktop clients |
| **EMAIL-012** | Error | Unbalanced AMPscript delimiters (`%%[`/`]%%` or `%%=`/`=%%`) |
| **EMAIL-013** | Error | AMPscript `IF`/`ENDIF` or `FOR`/`NEXT` statements are unbalanced |
| **EMAIL-014** | Warning | No preheader element — inbox preview text will be pulled from body content |
| **EMAIL-015** | Error | `<script>` tag or inline event handler (`onclick=`) detected — blocked by all clients |
| **EMAIL-016** | Warning | Missing `%%subscription_center_url%%` preference center link |

### Email content Build process — step by step

```
1. Create or edit the email template: templates/email-templates/<name>.html
2. Include required SFMC footer elements:
      <a href="%%subscription_center_url%%">Manage Preferences</a>
      <a href="%%unsub_center_url%%">Unsubscribe</a>
      %%Member_Busname%% %%Member_Addr%% %%Member_City%%, %%Member_State%% %%Member_PostalCode%%
3. Run QC locally:
      node scripts/qc/email-qc.js templates/email-templates/<name>.html
4. Fix all errors; address warnings
5. git push → GitHub Actions validates automatically in CI
6. QC gate blocks merge if any error is found
```

### Email QC commands

```bash
# Check all templates
npm run qc:email

# Check a single template
node scripts/qc/email-qc.js templates/email-templates/cart-abandonment.html

# Output a machine-readable JSON report
node scripts/qc/email-qc.js --json report/email-qc.json

# Strict mode — fail on warnings too (use on main branch)
node scripts/qc/email-qc.js --fail-on-warning
```

---

## Pre-Send Deployment Gate

The pre-send checklist combines both engines into a single **8-section deployment gate** — a single command to run before any campaign goes live:

```bash
npm run qc:presend
```

| Section | What it checks |
|---------|---------------|
| **1. Template integrity** | HTML templates exist; email QC passes with no errors |
| **2. Journey integrity** | Journey configs exist; journey QC passes with no errors |
| **3. CAN-SPAM / CASL compliance** | Unsubscribe link, physical address, subscription center per file |
| **4. AMPscript syntax** | `%%[`/`]%%` balance, `IF`/`ENDIF` balance per file |
| **5. Mobile responsiveness** | Viewport meta tag, `@media` query breakpoints per file |
| **6. Security** | No `<script>` tags or inline JavaScript event handlers |
| **7. Subject & preheader** | `<title>` length ≤ 60 chars, preheader element present |
| **8. SQL files** | Segmentation and analytics SQL queries are present |

**Exit behaviour:**
- `0` — all blocking checks passed (safe to deploy)
- `1` — one or more blocking checks failed (resolve before sending)

---

## CI/CD Pipeline

The GitHub Actions pipeline (`.github/workflows/qc-pipeline.yml`) runs automatically on every push and pull request touching templates, journey configs, QC scripts, or SQL files:

```
push / pull_request
        │
        ├──► email-qc ──────────────────────────────────────────────────┐
        │    • 16 email rules                                            │
        │    • Uploads report/email-qc.json artifact (30 days)          │
        │                                                                │
        ├──► journey-qc ────────────────────────────────────────────────┤
        │    • JSON Schema + 12 journey rules                            │──► pre-send-checklist
        │    • Uploads report/journey-qc.json artifact (30 days)        │    • Full 8-section gate
        │                                                                │    • Needs email-qc + journey-qc
        ├──► sql-lint ──────────────────────────────────────────────────┤
        │    • Non-empty file check                                      │
        │    • SELECT * and unguarded UPDATE/DELETE detection            │
        │                                                                │
        ├──► journey-schema ────────────────────────────────────────────┤
        │    • AJV JSON Schema validation of all journey JSON files      │
        │                                                                ▼
        └──────────────────────────────────────────────────────► qc-gate
                                                                  • Fails PR if ANY job failed
                                                                  • Passes only when all 5 jobs pass
```

**Manual dispatch** supports a `fail_on_warning` flag to enforce a zero-warning policy on main.

---

## QC Test Suite

The QC engine itself is covered by **84 unit tests** (Node.js built-in test runner):

```bash
npm test
```

- `scripts/qc/tests/email-rules.test.js` — 48 tests covering all 16 email rules (pass + fail case each)
- `scripts/qc/tests/journey-rules.test.js` — 36 tests covering all 12 journey rules (pass + fail case each)

This means any rule change or addition is immediately validated, preventing regressions.

---

## Adding Custom Rules

### New email rule

1. Open `scripts/qc/rules/email-rules.js`
2. Add a function: `function checkMyRule(root, raw) { ... return results; }`
3. Push the function to `module.exports` at the bottom
4. Add tests in `scripts/qc/tests/email-rules.test.js`

### New journey rule

1. Open `scripts/qc/rules/journey-rules.js`
2. Add a function: `function checkMyJourneyRule(journey) { ... return results; }`
3. Push the function to `module.exports` at the bottom
4. Add tests in `scripts/qc/tests/journey-rules.test.js`

---

## Quick Reference: All npm Commands

| Command | What it does |
|---------|-------------|
| `npm run qc:email` | Email content QC on all templates |
| `npm run qc:journey` | Journey config QC on all journey JSON files |
| `npm run qc:presend` | Full pre-send deployment gate (combines both) |
| `npm run qc:all` | Run email + journey + pre-send in sequence |
| `npm test` | Run all 84 unit tests for the QC rule engines |

---

## Folder Reference

```
├── .github/workflows/
│   └── qc-pipeline.yml              ← 6-job CI/CD QC pipeline
├── journeys/
│   ├── examples/                    ← Journey JSON configs (exported from SFMC API)
│   └── schemas/
│       └── journey-schema.json      ← JSON Schema for journey validation
├── scripts/
│   ├── qc/
│   │   ├── email-qc.js              ← Email QC engine entry point (CLI)
│   │   ├── journey-qc.js            ← Journey QC engine entry point (CLI)
│   │   ├── pre-send-checklist.js    ← Pre-send deployment gate
│   │   ├── rules/
│   │   │   ├── email-rules.js       ← 16 email QC rule functions
│   │   │   └── journey-rules.js     ← 12 journey QC rule functions
│   │   ├── reporters/
│   │   │   ├── console-reporter.js  ← Colour terminal output
│   │   │   └── json-reporter.js     ← Machine-readable JSON output
│   │   └── tests/
│   │       ├── email-rules.test.js  ← 48 unit tests for email rules
│   │       └── journey-rules.test.js← 36 unit tests for journey rules
│   └── ssjs/
│       └── journey-builder-api.ssjs ← 13-function SFMC SSJS Journey API helper
├── templates/
│   ├── ampscript/                   ← Reusable AMPscript snippets library
│   └── email-templates/             ← HTML email templates (4 ready-to-use)
├── sql/
│   ├── segmentation/                ← Audience segmentation SQL (RFM, engagement score)
│   └── analytics/                   ← Performance analytics SQL (revenue attribution, A/B)
└── docs/
    ├── capabilities.md              ← This file
    └── build-and-qc.md              ← Detailed Build and QC process guide
```
