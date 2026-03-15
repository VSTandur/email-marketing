#!/usr/bin/env node
/**
 * Pre-Send Checklist Runner
 * ==========================
 * Runs the complete pre-send checklist before an email/journey goes live.
 * Combines email QC, journey QC, and additional deployment-readiness checks.
 *
 * Usage:
 *   node scripts/qc/pre-send-checklist.js
 *   node scripts/qc/pre-send-checklist.js --json report/pre-send.json
 *
 * Exit codes:
 *   0 — all checklist items pass
 *   1 — one or more blocking items fail
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const { printSummary } = require('./reporters/console-reporter');
const { buildReport, writeReport } = require('./reporters/json-reporter');

// ---------------------------------------------------------------------------
// ANSI helpers (no external dep)
// ---------------------------------------------------------------------------
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  grey:   '\x1b[90m',
};

function pass(label) {
  console.log(`  ${C.green}✔${C.reset} ${label}`);
}
function fail(label, hint) {
  console.log(`  ${C.red}✖${C.reset} ${C.bold}${label}${C.reset}`);
  if (hint) console.log(`    ${C.grey}→ ${hint}${C.reset}`);
}
function warn(label, hint) {
  console.log(`  ${C.yellow}⚠${C.reset} ${label}`);
  if (hint) console.log(`    ${C.grey}→ ${hint}${C.reset}`);
}
function section(title) {
  console.log(`\n${C.bold}${C.cyan}▶ ${title}${C.reset}`);
  console.log(`${C.grey}${'─'.repeat(60)}${C.reset}`);
}

// ---------------------------------------------------------------------------
// Checklist categories
// ---------------------------------------------------------------------------

const checklistResults = {
  blocking:    [],   // errors that prevent send
  advisory:    [],   // warnings (send at risk)
  passed:      [],   // all-clear items
};

function addCheck(category, label, hint = '') {
  checklistResults[category].push({ label, hint });
}

// ---------------------------------------------------------------------------
// SECTION 1 — Email Template Integrity
// ---------------------------------------------------------------------------
section('1 / 8  Email Template Integrity');

const templateDir = path.join(PROJECT_ROOT, 'templates', 'email-templates');
const htmlFiles = fs.existsSync(templateDir)
  ? fs.readdirSync(templateDir).filter(f => f.endsWith('.html'))
  : [];

if (htmlFiles.length === 0) {
  fail('No HTML email templates found in templates/email-templates/');
  addCheck('blocking', 'No HTML templates found', 'Add at least one .html template before sending.');
} else {
  pass(`Found ${htmlFiles.length} email template(s)`);
  addCheck('passed', `Found ${htmlFiles.length} email template(s)`);
}

// Run email QC and capture exit code
try {
  const reportDir = path.join(PROJECT_ROOT, 'report');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  execSync(`node "${path.join(PROJECT_ROOT, 'scripts', 'qc', 'email-qc.js')}" --json "${path.join(reportDir, 'email-qc.json')}"`, {
    stdio: 'pipe',
    cwd: PROJECT_ROOT,
  });
  pass('Email QC passed — no blocking errors');
  addCheck('passed', 'Email content QC passed');
} catch (e) {
  fail('Email QC found errors — review report/email-qc.json', 'Run: node scripts/qc/email-qc.js for details.');
  addCheck('blocking', 'Email QC errors detected', 'Run: node scripts/qc/email-qc.js');
}

// ---------------------------------------------------------------------------
// SECTION 2 — Journey Configuration Integrity
// ---------------------------------------------------------------------------
section('2 / 8  Journey Configuration Integrity');

const journeyDir = path.join(PROJECT_ROOT, 'journeys', 'examples');
const journeyFiles = fs.existsSync(journeyDir)
  ? fs.readdirSync(journeyDir).filter(f => f.endsWith('.json'))
  : [];

if (journeyFiles.length === 0) {
  warn('No journey config files found in journeys/examples/');
  addCheck('advisory', 'No journey config files found', 'Add journey JSON exports to journeys/examples/ to enable automated journey QC.');
} else {
  pass(`Found ${journeyFiles.length} journey config(s)`);
  addCheck('passed', `Found ${journeyFiles.length} journey config(s)`);

  try {
    const reportDir = path.join(PROJECT_ROOT, 'report');
    execSync(`node "${path.join(PROJECT_ROOT, 'scripts', 'qc', 'journey-qc.js')}" --json "${path.join(reportDir, 'journey-qc.json')}"`, {
      stdio: 'pipe',
      cwd: PROJECT_ROOT,
    });
    pass('Journey QC passed — no blocking errors');
    addCheck('passed', 'Journey config QC passed');
  } catch (e) {
    fail('Journey QC found errors — review report/journey-qc.json', 'Run: node scripts/qc/journey-qc.js for details.');
    addCheck('blocking', 'Journey QC errors detected', 'Run: node scripts/qc/journey-qc.js');
  }
}

// ---------------------------------------------------------------------------
// SECTION 3 — Required Template Elements
// ---------------------------------------------------------------------------
section('3 / 8  Required CAN-SPAM / CASL Compliance Elements');

htmlFiles.forEach(file => {
  const raw = fs.readFileSync(path.join(templateDir, file), 'utf8');
  const checks = [
    { label: `[${file}] Unsubscribe link`,   pass: /%%unsub_center_url%%/i.test(raw) },
    { label: `[${file}] Physical address`,   pass: /%%Member_Addr%%/i.test(raw) },
    { label: `[${file}] Subscription center`, pass: /%%subscription_center_url%%/i.test(raw) },
  ];
  checks.forEach(c => {
    if (c.pass) {
      pass(c.label);
      addCheck('passed', c.label);
    } else {
      fail(c.label, 'Required by CAN-SPAM. Add the missing element to the email footer.');
      addCheck('blocking', c.label, 'Required by CAN-SPAM.');
    }
  });
});

// ---------------------------------------------------------------------------
// SECTION 4 — AMPscript Syntax Sanity
// ---------------------------------------------------------------------------
section('4 / 8  AMPscript Syntax Sanity');

htmlFiles.forEach(file => {
  const raw = fs.readFileSync(path.join(templateDir, file), 'utf8');
  const openBlocks  = (raw.match(/%%\[/g) || []).length;
  const closeBlocks = (raw.match(/\]%%/g) || []).length;
  const ifCount     = (raw.match(/\bIF\b/g) || []).length;
  const endifCount  = (raw.match(/\bENDIF\b/g) || []).length;

  if (openBlocks !== closeBlocks) {
    fail(`[${file}] AMPscript %%[ / ]%% mismatch (${openBlocks} open, ${closeBlocks} close)`);
    addCheck('blocking', `AMPscript block mismatch in ${file}`, 'Every %%[ must have a matching ]%%.');
  } else {
    pass(`[${file}] AMPscript block delimiters balanced`);
    addCheck('passed', `AMPscript blocks balanced in ${file}`);
  }

  if (ifCount !== endifCount) {
    fail(`[${file}] AMPscript IF/ENDIF mismatch (${ifCount} IF, ${endifCount} ENDIF)`);
    addCheck('blocking', `AMPscript IF/ENDIF mismatch in ${file}`, 'Every IF requires a matching ENDIF.');
  } else {
    pass(`[${file}] AMPscript IF/ENDIF balanced`);
    addCheck('passed', `AMPscript IF/ENDIF balanced in ${file}`);
  }
});

// ---------------------------------------------------------------------------
// SECTION 5 — Mobile Responsiveness
// ---------------------------------------------------------------------------
section('5 / 8  Mobile Responsiveness');

htmlFiles.forEach(file => {
  const raw = fs.readFileSync(path.join(templateDir, file), 'utf8');
  const hasViewport   = /<meta[^>]+viewport[^>]*>/i.test(raw);
  const hasMediaQuery = /@media\s+only\s+screen|@media\s+screen/i.test(raw);

  if (hasViewport) {
    pass(`[${file}] Viewport meta tag present`);
    addCheck('passed', `Viewport meta tag in ${file}`);
  } else {
    fail(`[${file}] Missing viewport meta tag`);
    addCheck('blocking', `Missing viewport meta tag in ${file}`);
  }

  if (hasMediaQuery) {
    pass(`[${file}] Media query / mobile styles present`);
    addCheck('passed', `Mobile media query in ${file}`);
  } else {
    warn(`[${file}] No media queries found — mobile rendering may be poor`);
    addCheck('advisory', `No media queries in ${file}`, 'Add @media only screen and (max-width: 480px) responsive styles.');
  }
});

// ---------------------------------------------------------------------------
// SECTION 6 — No JavaScript in Email
// ---------------------------------------------------------------------------
section('6 / 8  Security — No JavaScript in Email');

htmlFiles.forEach(file => {
  const raw = fs.readFileSync(path.join(templateDir, file), 'utf8');
  if (/<script[\s>]/i.test(raw) || /\bon\w+\s*=/i.test(raw)) {
    fail(`[${file}] JavaScript detected in email HTML`);
    addCheck('blocking', `JavaScript found in ${file}`, 'Remove all <script> tags and inline event handlers.');
  } else {
    pass(`[${file}] No JavaScript found`);
    addCheck('passed', `No JavaScript in ${file}`);
  }
});

// ---------------------------------------------------------------------------
// SECTION 7 — Subject Line & Preheader
// ---------------------------------------------------------------------------
section('7 / 8  Subject Line & Preheader');

htmlFiles.forEach(file => {
  const raw = fs.readFileSync(path.join(templateDir, file), 'utf8');
  const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
  const titleText  = titleMatch ? titleMatch[1].replace(/%%[^%]+%%/g, 'X').trim() : '';

  if (!titleText) {
    warn(`[${file}] Empty or missing <title> (used as subject line reference)`);
    addCheck('advisory', `Empty title in ${file}`, 'Use a meaningful <title> with personalization tokens.');
  } else if (titleText.length > 70) {
    warn(`[${file}] <title> is ${titleText.length} chars — aim for under 60 chars for mobile preview`);
    addCheck('advisory', `Long title in ${file}`, 'Keep subject lines under 60 characters for mobile preview.');
  } else {
    pass(`[${file}] <title> / subject reference OK (${titleText.length} chars)`);
    addCheck('passed', `Title length OK in ${file}`);
  }

  const hasPreheader = /mso-hide:all|display:\s*none.*font-size:\s*0|class=["'][^"']*preheader/i.test(raw);
  if (hasPreheader) {
    pass(`[${file}] Preheader element detected`);
    addCheck('passed', `Preheader in ${file}`);
  } else {
    warn(`[${file}] No preheader element found`);
    addCheck('advisory', `No preheader in ${file}`, 'Add hidden preheader text after <body> for better inbox preview.');
  }
});

// ---------------------------------------------------------------------------
// SECTION 8 — SQL & Data Extension Validation
// ---------------------------------------------------------------------------
section('8 / 8  SQL Query Files Presence');

const sqlSegDir     = path.join(PROJECT_ROOT, 'sql', 'segmentation');
const sqlAnalyticsDir = path.join(PROJECT_ROOT, 'sql', 'analytics');
const hasSqlSeg     = fs.existsSync(sqlSegDir) && fs.readdirSync(sqlSegDir).some(f => f.endsWith('.sql'));
const hasSqlAnalytics = fs.existsSync(sqlAnalyticsDir) && fs.readdirSync(sqlAnalyticsDir).some(f => f.endsWith('.sql'));

if (hasSqlSeg) {
  pass('Segmentation SQL queries present');
  addCheck('passed', 'Segmentation SQL files present');
} else {
  warn('No segmentation SQL files found in sql/segmentation/');
  addCheck('advisory', 'Missing segmentation SQL', 'Add audience segmentation queries to sql/segmentation/.');
}

if (hasSqlAnalytics) {
  pass('Analytics/reporting SQL queries present');
  addCheck('passed', 'Analytics SQL files present');
} else {
  warn('No analytics SQL files found in sql/analytics/');
  addCheck('advisory', 'Missing analytics SQL', 'Add performance reporting queries to sql/analytics/.');
}

// ---------------------------------------------------------------------------
// FINAL REPORT
// ---------------------------------------------------------------------------
const args          = process.argv.slice(2);
const jsonArgIdx    = args.indexOf('--json');
const jsonOutputPath = jsonArgIdx !== -1 && args[jsonArgIdx + 1]
  ? path.resolve(args[jsonArgIdx + 1])
  : null;

const blockingCount = checklistResults.blocking.length;
const advisoryCount = checklistResults.advisory.length;
const passedCount   = checklistResults.passed.length;

console.log(`\n${C.bold}${'═'.repeat(60)}${C.reset}`);
console.log(`${C.bold}  PRE-SEND CHECKLIST SUMMARY${C.reset}`);
console.log(`${'═'.repeat(60)}`);
console.log(`  ${C.green}✔ Passed   : ${passedCount}${C.reset}`);
console.log(`  ${C.yellow}⚠ Advisory : ${advisoryCount}${C.reset}`);
console.log(`  ${C.red}✖ Blocking : ${blockingCount}${C.reset}`);
console.log(`${'═'.repeat(60)}`);

if (blockingCount > 0) {
  console.log(`\n${C.red}${C.bold}  ✖ PRE-SEND CHECKLIST FAILED${C.reset}`);
  console.log(`${C.red}  Resolve all blocking issues before deploying:${C.reset}`);
  checklistResults.blocking.forEach(item => {
    console.log(`    ${C.red}•${C.reset} ${item.label}`);
    if (item.hint) console.log(`      ${C.grey}→ ${item.hint}${C.reset}`);
  });
  console.log();
} else {
  console.log(`\n${C.green}${C.bold}  ✔ PRE-SEND CHECKLIST PASSED — Safe to deploy!${C.reset}\n`);
}

// Persist checklist report as JSON
if (jsonOutputPath) {
  const report = {
    generatedAt: new Date().toISOString(),
    summary: { passed: passedCount, advisory: advisoryCount, blocking: blockingCount,
                overallStatus: blockingCount === 0 ? 'PASS' : 'FAIL' },
    blocking: checklistResults.blocking,
    advisory: checklistResults.advisory,
    passed:   checklistResults.passed,
  };
  const dir = path.dirname(jsonOutputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(jsonOutputPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`  📄 Pre-send checklist report written to: ${jsonOutputPath}`);
}

process.exit(blockingCount > 0 ? 1 : 0);
