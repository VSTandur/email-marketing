/**
 * JSON Reporter
 * --------------
 * Writes a machine-readable QC report to disk.
 * Consumed by CI systems, dashboards, and the pre-send checklist.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Build a JSON report object from all file results.
 *
 * @param {object[]} allFileResults  - Array of { filePath, type, results }
 * @param {string}   runLabel        - Label for this run (e.g. 'pre-send', 'ci')
 * @returns {object} reportData
 */
function buildReport(allFileResults, runLabel = 'qc-run') {
  const now = new Date().toISOString();

  const totalErrors   = allFileResults.reduce((s, f) => s + f.results.filter(r => r.severity === 'error').length, 0);
  const totalWarnings = allFileResults.reduce((s, f) => s + f.results.filter(r => r.severity === 'warning').length, 0);
  const totalInfos    = allFileResults.reduce((s, f) => s + f.results.filter(r => r.severity === 'info').length, 0);
  const passed        = allFileResults.filter(f => f.results.every(r => r.severity !== 'error')).length;

  return {
    runLabel,
    generatedAt: now,
    summary: {
      totalFiles: allFileResults.length,
      passed,
      failed: allFileResults.length - passed,
      totalErrors,
      totalWarnings,
      totalInfos,
      overallStatus: totalErrors === 0 ? 'PASS' : 'FAIL',
    },
    files: allFileResults.map(f => ({
      filePath: f.filePath,
      type: f.type,
      status: f.results.some(r => r.severity === 'error') ? 'FAIL' : 'PASS',
      errorCount:   f.results.filter(r => r.severity === 'error').length,
      warningCount: f.results.filter(r => r.severity === 'warning').length,
      infoCount:    f.results.filter(r => r.severity === 'info').length,
      issues: f.results,
    })),
  };
}

/**
 * Write the JSON report to an output file.
 *
 * @param {object} reportData  - Report object from buildReport()
 * @param {string} outputPath  - File path to write (created if needed)
 */
function writeReport(reportData, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(reportData, null, 2), 'utf8');
  console.log(`  📄 JSON report written to: ${outputPath}`);
}

module.exports = { buildReport, writeReport };
