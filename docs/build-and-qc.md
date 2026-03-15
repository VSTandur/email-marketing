# Build and QC Automation Guide

This document describes the end-to-end **Build and QC process** for SFMC email campaigns and Journey Builder configurations — from local development through to production deployment.

---

## Overview

```
Developer / Marketer
       │
       ▼
┌─────────────────┐
│  Edit Template  │  templates/email-templates/*.html
│  or Journey     │  journeys/examples/*.json
└────────┬────────┘
         │  git push / PR
         ▼
┌─────────────────────────────────────────────────────┐
│            GitHub Actions QC Pipeline               │
│                                                     │
│  Job 1: Email Content QC    (email-qc.js)           │
│  Job 2: Journey Config QC   (journey-qc.js)         │
│  Job 3: Pre-Send Checklist  (pre-send-checklist.js) │
│  Job 4: SQL Lint            (structural checks)     │
│  Job 5: Journey Schema      (JSON Schema / AJV)     │
│  Job 6: QC Gate             (all jobs must pass)    │
└────────┬────────────────────────────────────────────┘
         │  All jobs pass
         ▼
┌─────────────────┐
│  PR Approved &  │
│  Merged to Main │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Manual Deployment to SFMC             │
│  (Content Builder + Journey Builder)   │
└─────────────────────────────────────────┘
```

---

## Local Development Workflow

### 1. Install dependencies

```bash
npm install
```

### 2. Run individual QC checks

```bash
# Check all email templates
npm run qc:email

# Check a single template
node scripts/qc/email-qc.js templates/email-templates/cart-abandonment.html

# Check all journey configs
npm run qc:journey

# Check a single journey config
node scripts/qc/journey-qc.js journeys/examples/welcome-series.json

# Run the full pre-send checklist
npm run qc:presend

# Run everything at once
npm run qc:all
```

### 3. Generate JSON reports

Append `--json <output-path>` to any QC command to generate a machine-readable report:

```bash
node scripts/qc/email-qc.js --json report/email-qc.json
node scripts/qc/journey-qc.js --json report/journey-qc.json
node scripts/qc/pre-send-checklist.js --json report/pre-send.json
```

### 4. Fail on warnings (strict mode)

Useful for enforcing zero-warning policy on main branch:

```bash
node scripts/qc/email-qc.js --fail-on-warning
```

---

## Email Content QC Rules

The email QC engine (`scripts/qc/email-qc.js`) checks every `.html` file in `templates/email-templates/` against 16 rules:

| Rule ID     | Severity | Description |
|-------------|----------|-------------|
| EMAIL-001   | Error    | Unsubscribe link (`%%unsub_center_url%%`) must be present |
| EMAIL-002   | Error    | Physical mailing address (`%%Member_Addr%%`) must be present |
| EMAIL-003   | Error    | Every `<img>` must have an `alt` attribute |
| EMAIL-004   | Warning  | Links should use `RedirectTo()` for SFMC click tracking |
| EMAIL-005   | Error    | Viewport meta tag must be present |
| EMAIL-006   | Error    | `<!DOCTYPE html>` declaration must be present |
| EMAIL-007   | Warning  | Layout elements should have inline styles |
| EMAIL-008   | Warning  | Spam trigger words detected in body text |
| EMAIL-009   | Warning  | `<title>` tag should be present and non-empty |
| EMAIL-010   | Info     | Tables should have explicit `width` attributes |
| EMAIL-011   | Warning  | Email `max-width` should not exceed 650px |
| EMAIL-012   | Error    | AMPscript `%%[` / `]%%` delimiters must be balanced |
| EMAIL-013   | Error    | AMPscript `IF`/`ENDIF` and `FOR`/`NEXT` must be balanced |
| EMAIL-014   | Warning  | Preheader text element should be present |
| EMAIL-015   | Error    | No `<script>` tags or JavaScript event handlers |
| EMAIL-016   | Warning  | Subscription center link should be present |

### Adding a Custom Email Rule

1. Open `scripts/qc/rules/email-rules.js`
2. Add a new function following this signature:
   ```js
   function checkMyRule(root, raw) {
     const results = [];
     if (/* your condition */) {
       results.push({
         rule: 'EMAIL-017',
         severity: 'error',       // 'error' | 'warning' | 'info'
         message: 'Descriptive message.',
         hint: 'How to fix it.',
       });
     }
     return results;
   }
   ```
3. Export it by adding `checkMyRule` to the `module.exports` array at the bottom of the file.

---

## Journey Builder QC Rules

The journey QC engine (`scripts/qc/journey-qc.js`) validates every `.json` file in `journeys/examples/` against 12 rules plus the JSON schema:

| Rule ID     | Severity | Description |
|-------------|----------|-------------|
| JRN-SCHEMA  | Error    | Journey JSON must conform to `journeys/schemas/journey-schema.json` |
| JRN-001     | Warning  | Journey should have at least one goal defined |
| JRN-002     | Error    | Email activities must reference an email asset ID |
| JRN-003     | Error    | Wait activities must have a configured duration |
| JRN-004     | Error    | Decision splits must have ≥ 2 outcome paths; each `next` key must exist |
| JRN-005     | Warning  | Journey should define exit criteria |
| JRN-006     | Warning  | Activity names should be descriptive, not default |
| JRN-007     | Warning  | Welcome/Onboarding journeys should not use MultipleEntrances |
| JRN-008     | Error    | Journey key must be set and not a placeholder value |
| JRN-009     | Error    | Random split outcome percentages must sum to 100% |
| JRN-010     | Info     | Journey description should be meaningful |
| JRN-011     | Info     | Journey should have tags for organisation |
| JRN-012     | Warning  | Activities not reachable from any path are orphaned |

### Journey Config File Structure

Journey configurations follow the [SFMC Journey Builder REST API spec](https://developer.salesforce.com/docs/marketing/marketing-cloud/guide/journey-spec.html). Export existing journeys from SFMC via:

```
GET /interaction/v1/interactions/key:{journeyKey}
```

Save the response to `journeys/examples/<journey-name>.json` and commit it for QC to run automatically.

### Adding a Custom Journey Rule

1. Open `scripts/qc/rules/journey-rules.js`
2. Add a new function:
   ```js
   function checkMyJourneyRule(journey) {
     const results = [];
     // journey is the parsed JSON object
     if (!journey.someRequiredField) {
       results.push({
         rule: 'JRN-013',
         severity: 'warning',
         message: `Journey "${journey.name}" is missing someRequiredField.`,
         hint: 'Set someRequiredField in your journey config.',
       });
     }
     return results;
   }
   ```
3. Export it by adding it to the `module.exports` array at the bottom of the file.

---

## CI/CD Pipeline

The pipeline is defined in `.github/workflows/qc-pipeline.yml` and runs automatically on:

- **Push** to any branch (when email templates, journey configs, QC scripts, or SQL files change)
- **Pull Request** to any branch (same path filter)
- **Manual trigger** (with optional `fail_on_warning` input)

### Pipeline Jobs

| Job | Depends On | Description |
|-----|-----------|-------------|
| `email-qc` | — | Runs email QC engine on all templates |
| `journey-qc` | — | Runs journey QC engine on all journey configs |
| `pre-send-checklist` | email-qc, journey-qc | Full pre-send checklist (gates on QC jobs) |
| `sql-lint` | — | Structural checks on SQL files |
| `journey-schema` | — | JSON schema validation of journey configs |
| `qc-status` | all above | Final gate: fails if ANY job failed |

### QC Artifacts

After each pipeline run, QC reports are uploaded as GitHub Actions artifacts:
- `email-qc-report` → `report/email-qc.json`
- `journey-qc-report` → `report/journey-qc.json`
- `pre-send-checklist-report` → `report/pre-send.json`

Artifacts are retained for 30 days.

---

## Adding a New Email Template

1. Create `templates/email-templates/<name>.html`
2. Include required SFMC footer elements:
   ```html
   <a href="%%subscription_center_url%%">Manage Preferences</a>
   <a href="%%unsub_center_url%%">Unsubscribe</a>
   %%Member_Busname%% %%Member_Addr%% %%Member_City%%, %%Member_State%% %%Member_PostalCode%%
   ```
3. Run locally: `node scripts/qc/email-qc.js templates/email-templates/<name>.html`
4. Fix all errors; address warnings
5. Commit and push — CI will validate automatically

---

## Adding a New Journey Configuration

1. Export your journey from SFMC:
   ```
   GET https://{subdomain}.rest.marketingcloudapis.com/interaction/v1/interactions/key:{yourJourneyKey}
   ```
2. Save the JSON response to `journeys/examples/<journey-name>.json`
3. Run locally: `node scripts/qc/journey-qc.js journeys/examples/<journey-name>.json`
4. Fix all errors; address warnings
5. Commit and push — CI validates automatically

---

## SSJS Journey Builder API Helper

`scripts/ssjs/journey-builder-api.ssjs` provides SSJS functions for programmatic journey management directly in SFMC:

| Function | Description |
|----------|-------------|
| `getAccessToken()` | Obtains an OAuth 2.0 access token |
| `listJourneys(token, page, pageSize)` | Lists all journeys with pagination |
| `getJourneyByKey(token, key)` | Fetches a journey definition by key |
| `createJourney(token, config)` | Creates a new journey in Draft status |
| `updateJourney(token, id, version, config)` | Updates a Draft journey |
| `publishJourney(token, id, version)` | Publishes a Draft journey |
| `pauseJourney(token, id, version)` | Pauses an Active journey |
| `resumeJourney(token, id, version)` | Resumes a Paused journey |
| `stopJourney(token, id, version)` | Stops a journey |
| `fireJourneyEvent(token, eventKey, contactKey, data)` | Fires an API entry event |
| `bulkFireJourneyEntryFromDE(token, eventKey, deName, max)` | Batch-enters contacts from a DE |
| `getJourneyAuditLog(token, id, version)` | Fetches the journey audit log |
| `getContactJourneyStatus(token, journeyKey, contactKey)` | Checks a contact's journey status |

> **Security note:** API credentials are read from a `SFMC_API_Config` Data Extension. Never hardcode credentials in SSJS.

---

## Pre-Send Checklist Categories

| Category | Meaning |
|----------|---------|
| **Blocking** | Must be fixed before sending — the pipeline exits with code 1 |
| **Advisory** | Recommended fixes — send proceeds but quality is at risk |
| **Passed** | All-clear on this check |

### Checklist Sections

1. Email Template Integrity (files present, QC passes)
2. Journey Configuration Integrity (configs present, QC passes)
3. CAN-SPAM / CASL Compliance (unsubscribe link, physical address, preference center)
4. AMPscript Syntax Sanity (`%%[`/`]%%` balance, IF/ENDIF balance)
5. Mobile Responsiveness (viewport meta, media queries)
6. Security — No JavaScript in email
7. Subject Line & Preheader (length, presence)
8. SQL Query File Presence

---

## Folder Reference

```
├── .github/workflows/
│   └── qc-pipeline.yml          # Automated CI/CD QC pipeline
├── journeys/
│   ├── examples/                # Journey JSON configs (export from SFMC API)
│   │   ├── welcome-series.json
│   │   └── cart-abandonment.json
│   └── schemas/
│       └── journey-schema.json  # JSON Schema for journey validation
├── scripts/
│   ├── qc/
│   │   ├── email-qc.js          # Email QC engine (CLI entry point)
│   │   ├── journey-qc.js        # Journey QC engine (CLI entry point)
│   │   ├── pre-send-checklist.js# Full pre-send gate runner
│   │   ├── rules/
│   │   │   ├── email-rules.js   # 16 email QC rules
│   │   │   └── journey-rules.js # 12 journey QC rules
│   │   └── reporters/
│   │       ├── console-reporter.js  # Colour terminal output
│   │       └── json-reporter.js     # Machine-readable JSON output
│   └── ssjs/
│       └── journey-builder-api.ssjs # SFMC SSJS Journey API helper
├── templates/
│   ├── ampscript/               # Reusable AMPscript snippets
│   └── email-templates/         # HTML email templates
├── sql/
│   ├── segmentation/            # Audience segmentation SQL
│   └── analytics/               # Performance analytics SQL
├── docs/
│   └── build-and-qc.md          # This file
└── package.json                 # Node.js project and npm scripts
```
