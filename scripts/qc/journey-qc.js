#!/usr/bin/env node
/**
 * Journey Builder Configuration QC Engine
 * ==========================================
 * Validates journey JSON files in journeys/examples/ (or a specified path)
 * against the journey rule set and the JSON schema.
 *
 * Usage:
 *   node scripts/qc/journey-qc.js                                   # scan all in journeys/examples/
 *   node scripts/qc/journey-qc.js journeys/examples/welcome-series.json
 *   node scripts/qc/journey-qc.js --json report/journey-qc.json     # also write JSON report
 *   node scripts/qc/journey-qc.js --fail-on-warning
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more errors found
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Schema validation using Ajv
// ---------------------------------------------------------------------------
let Ajv;
let ajvValidate = null;

try {
  Ajv = require('ajv');
  const ajv = new (Ajv.default || Ajv)({ allErrors: true, strict: false });
  const schemaPath = path.join(PROJECT_ROOT, 'journeys', 'schemas', 'journey-schema.json');
  if (fs.existsSync(schemaPath)) {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    ajvValidate = ajv.compile(schema);
  }
} catch (_) {
  // Ajv not installed — schema validation skipped, rule-based checks still run
}

// ---------------------------------------------------------------------------
// Rules & reporters
// ---------------------------------------------------------------------------
const journeyRules = require('./rules/journey-rules');
const { printFileResults, printSummary } = require('./reporters/console-reporter');
const { buildReport, writeReport }        = require('./reporters/json-reporter');

// ---------------------------------------------------------------------------
// CLI arg parsing
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

if (targetPaths.length === 0) {
  const defaultDir = path.join(PROJECT_ROOT, 'journeys', 'examples');
  if (fs.existsSync(defaultDir)) {
    targetPaths = fs.readdirSync(defaultDir)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(defaultDir, f));
  }
}

if (targetPaths.length === 0) {
  console.error('No journey JSON files found. Provide a path or add .json files to journeys/examples/');
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

  let journey;
  try {
    journey = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (e) {
    allFileResults.push({
      filePath: absPath,
      type: 'journey',
      results: [{
        rule: 'JRN-PARSE',
        severity: 'error',
        message: `JSON parse error: ${e.message}`,
        hint: 'Ensure the file is valid JSON. Use a JSON validator (jsonlint.com) to find syntax errors.',
      }],
    });
    continue;
  }

  const results = [];

  // Schema validation first
  if (ajvValidate) {
    const valid = ajvValidate(journey);
    if (!valid) {
      (ajvValidate.errors || []).forEach(err => {
        results.push({
          rule: 'JRN-SCHEMA',
          severity: 'error',
          message: `Schema violation at "${err.instancePath || '/'}": ${err.message}`,
          hint: `Expected: ${JSON.stringify(err.params)}. Check the journey schema at journeys/schemas/journey-schema.json.`,
        });
      });
    }
  }

  // Rule-based checks
  journeyRules.forEach(rule => {
    try {
      results.push(...rule(journey));
    } catch (err) {
      results.push({
        rule: 'INTERNAL',
        severity: 'warning',
        message: `Rule threw an exception: ${err.message}`,
        hint: 'This is a QC tool bug — please report it.',
      });
    }
  });

  allFileResults.push({ filePath: absPath, type: 'journey', results });
  printFileResults(path.relative(PROJECT_ROOT, absPath), results, 'journey');
}

// ---------------------------------------------------------------------------
// Summary + optional JSON report
// ---------------------------------------------------------------------------
printSummary(allFileResults);

if (jsonOutputPath) {
  const report = buildReport(allFileResults, 'journey-qc');
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
