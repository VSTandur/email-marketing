/**
 * Console Reporter
 * -----------------
 * Renders QC results to stdout with colour-coded severity levels.
 * Works in Node.js environments (CI terminals, local dev).
 */

'use strict';

// Simple ANSI colour helpers — no external dependency needed
const ANSI = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  white:   '\x1b[37m',
  grey:    '\x1b[90m',
  bgRed:   '\x1b[41m',
  bgGreen: '\x1b[42m',
};

const SEVERITY_ICON = {
  error:   `${ANSI.red}✖ ERROR  ${ANSI.reset}`,
  warning: `${ANSI.yellow}⚠ WARN   ${ANSI.reset}`,
  info:    `${ANSI.cyan}ℹ INFO   ${ANSI.reset}`,
};

/**
 * Print a QC run summary for a single file.
 *
 * @param {string}   filePath  - Path of the file checked
 * @param {object[]} results   - Array of QCResult objects
 * @param {'email'|'journey'} type - Type of check
 */
function printFileResults(filePath, results, type) {
  const errors   = results.filter(r => r.severity === 'error');
  const warnings = results.filter(r => r.severity === 'warning');
  const infos    = results.filter(r => r.severity === 'info');

  const statusIcon = errors.length > 0
    ? `${ANSI.bgRed}${ANSI.white} FAIL ${ANSI.reset}`
    : `${ANSI.bgGreen}${ANSI.white} PASS ${ANSI.reset}`;

  const label = type === 'email' ? '📧 Email' : '🗺  Journey';
  console.log(`\n${statusIcon} ${ANSI.bold}${label}: ${filePath}${ANSI.reset}`);
  console.log(`${ANSI.grey}${'─'.repeat(72)}${ANSI.reset}`);

  if (results.length === 0) {
    console.log(`  ${ANSI.green}✔ No issues found.${ANSI.reset}`);
    return;
  }

  results.forEach(r => {
    const icon = SEVERITY_ICON[r.severity] || SEVERITY_ICON.info;
    console.log(`  ${icon} [${ANSI.bold}${r.rule}${ANSI.reset}] ${r.message}`);
    console.log(`${ANSI.grey}           → ${r.hint}${ANSI.reset}`);
  });

  console.log(`${ANSI.grey}${'─'.repeat(72)}${ANSI.reset}`);
  const parts = [];
  if (errors.length > 0)   parts.push(`${ANSI.red}${errors.length} error(s)${ANSI.reset}`);
  if (warnings.length > 0) parts.push(`${ANSI.yellow}${warnings.length} warning(s)${ANSI.reset}`);
  if (infos.length > 0)    parts.push(`${ANSI.cyan}${infos.length} info(s)${ANSI.reset}`);
  console.log(`  Summary: ${parts.join('  ')}`);
}

/**
 * Print an overall summary across all files.
 *
 * @param {object[]} allFileResults - Array of { filePath, results } objects
 */
function printSummary(allFileResults) {
  const totalFiles   = allFileResults.length;
  const passedFiles  = allFileResults.filter(f => f.results.every(r => r.severity !== 'error')).length;
  const failedFiles  = totalFiles - passedFiles;
  const totalErrors  = allFileResults.reduce((s, f) => s + f.results.filter(r => r.severity === 'error').length, 0);
  const totalWarnings = allFileResults.reduce((s, f) => s + f.results.filter(r => r.severity === 'warning').length, 0);
  const totalInfos   = allFileResults.reduce((s, f) => s + f.results.filter(r => r.severity === 'info').length, 0);

  console.log(`\n${ANSI.bold}${'═'.repeat(72)}${ANSI.reset}`);
  console.log(`${ANSI.bold}  QC SUMMARY${ANSI.reset}`);
  console.log(`${'═'.repeat(72)}`);
  console.log(`  Files checked : ${totalFiles}`);
  console.log(`  ${ANSI.green}Passed        : ${passedFiles}${ANSI.reset}`);
  console.log(`  ${failedFiles > 0 ? ANSI.red : ANSI.green}Failed        : ${failedFiles}${ANSI.reset}`);
  console.log(`  ${ANSI.red}Errors        : ${totalErrors}${ANSI.reset}`);
  console.log(`  ${ANSI.yellow}Warnings      : ${totalWarnings}${ANSI.reset}`);
  console.log(`  ${ANSI.cyan}Info          : ${totalInfos}${ANSI.reset}`);
  console.log(`${'═'.repeat(72)}\n`);

  if (failedFiles > 0) {
    console.log(`${ANSI.red}${ANSI.bold}  ✖ QC FAILED — resolve all errors before deploying.${ANSI.reset}\n`);
  } else {
    console.log(`${ANSI.green}${ANSI.bold}  ✔ All checks passed.${ANSI.reset}\n`);
  }
}

module.exports = { printFileResults, printSummary };
