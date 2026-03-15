#!/usr/bin/env node
/**
 * Email Content QC Engine
 * ========================
 * Scans all HTML email templates in templates/email-templates/
 * (or a specified directory/file) against the full rule set.
 *
 * Usage:
 *   node scripts/qc/email-qc.js                               # scan all templates
 *   node scripts/qc/email-qc.js templates/email-templates/cart-abandonment.html
 *   node scripts/qc/email-qc.js --json report/email-qc.json   # also write JSON report
 *   node scripts/qc/email-qc.js --fail-on-warning             # exit 1 on warnings too
 *
 * Exit codes:
 *   0 — all checks passed (no errors)
 *   1 — one or more errors found
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Resolve project root relative to this script
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Inline minimal HTML parser (no external dep needed for our checks)
//
// NOTE: This produces a flat list of all tag nodes rather than a nested tree.
// All nodes are stored as direct children of `root`, so parent-child
// relationships are not preserved. This is intentional and sufficient for
// the current rule set, because:
//   - Rules that need structural checks (DOCTYPE, JS, AMPscript balance)
//     operate on the raw string directly.
//   - Rules that query tags (findAll: img, a, table, etc.) only need a flat
//     list to iterate — they don't require nesting.
// If future rules need true parent-child traversal, replace this with a
// full parser (e.g. node-html-parser or parse5).
// ---------------------------------------------------------------------------
function parseHTML(raw) {
  const root = { tagName: 'root', attrs: [], childNodes: [] };
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*?)?)\s*\/?>/gi;
  let m;
  const nodes = [];
  while ((m = tagRe.exec(raw)) !== null) {
    const tag  = m[1].toLowerCase();
    const attrStr = m[2] || '';
    const attrs = [];
    const attrRe = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi;
    let am;
    while ((am = attrRe.exec(attrStr)) !== null) {
      attrs.push({ name: am[1].toLowerCase(), value: am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : (am[4] || '')) });
    }
    nodes.push({ tagName: tag, attrs, childNodes: [], children: [] });
  }
  root.childNodes = nodes;
  root.children   = nodes;
  return root;
}

// ---------------------------------------------------------------------------
// Load rules
// ---------------------------------------------------------------------------
const emailRules = require('./rules/email-rules');
const { printFileResults, printSummary } = require('./reporters/console-reporter');
const { buildReport, writeReport }        = require('./reporters/json-reporter');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let targetPaths    = [];
let jsonOutputPath = null;
let failOnWarning  = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json' && args[i + 1]) {
    jsonOutputPath = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--fail-on-warning') {
    failOnWarning = true;
  } else {
    targetPaths.push(args[i]);
  }
}

// Default: scan all HTML files in templates/email-templates/
if (targetPaths.length === 0) {
  const defaultDir = path.join(PROJECT_ROOT, 'templates', 'email-templates');
  if (fs.existsSync(defaultDir)) {
    targetPaths = fs.readdirSync(defaultDir)
      .filter(f => f.endsWith('.html') || f.endsWith('.htm'))
      .map(f => path.join(defaultDir, f));
  }
}

if (targetPaths.length === 0) {
  console.error('No email templates found to check. Provide a path or add .html files to templates/email-templates/');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Run checks
// ---------------------------------------------------------------------------
const allFileResults = [];

for (const filePath of targetPaths) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.warn(`⚠ File not found: ${absPath} — skipping`);
    continue;
  }

  const raw  = fs.readFileSync(absPath, 'utf8');
  const root = parseHTML(raw);

  // Run every rule
  const results = emailRules.flatMap(rule => {
    try {
      return rule(root, raw);
    } catch (err) {
      return [{
        rule: 'INTERNAL',
        severity: 'warning',
        message: `Rule threw an exception: ${err.message}`,
        hint: 'This is a QC tool bug — please report it.',
      }];
    }
  });

  allFileResults.push({ filePath: absPath, type: 'email', results });
  printFileResults(path.relative(PROJECT_ROOT, absPath), results, 'email');
}

// ---------------------------------------------------------------------------
// Summary + optional JSON report
// ---------------------------------------------------------------------------
printSummary(allFileResults);

if (jsonOutputPath) {
  const report = buildReport(allFileResults, 'email-qc');
  writeReport(report, jsonOutputPath);
}

// ---------------------------------------------------------------------------
// Exit code
// ---------------------------------------------------------------------------
const hasErrors   = allFileResults.some(f => f.results.some(r => r.severity === 'error'));
const hasWarnings = allFileResults.some(f => f.results.some(r => r.severity === 'warning'));

if (hasErrors || (failOnWarning && hasWarnings)) {
  process.exit(1);
}
process.exit(0);
