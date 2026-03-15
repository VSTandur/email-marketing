/**
 * Email QC Rules
 * ===============
 * Each rule is a function that receives the parsed HTML root node
 * and the raw HTML string, then returns an array of QCResult objects.
 *
 * QCResult shape:
 *   { rule, severity, message, hint }
 *
 * severity: 'error' | 'warning' | 'info'
 */

'use strict';

/**
 * @typedef {{ rule: string, severity: 'error'|'warning'|'info', message: string, hint: string }} QCResult
 */

// ---------------------------------------------------------------------------
// Spam trigger words (common deliverability red-flags)
// ---------------------------------------------------------------------------
const SPAM_WORDS = [
  'free money', 'click here', 'this is not spam', 'risk-free',
  'guaranteed', 'no obligation', 'winner', 'you have been selected',
  'act now', 'limited time offer', 'double your income', 'earn extra cash',
  'online biz opportunity', 'work from home', '100% free', 'be your own boss',
  'direct email', 'bulk email', 'email marketing', 'mass email',
  'dear friend', 'nigerian', 'make money fast', 'no cost', 'no fees',
  'order now', 'special promotion', 'prize', 'bonus', 'congratulations',
  'incredible deal', 'lowest price', 'miracle', 'revolutionary',
];

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

/** Collect all tag nodes matching a selector-like pattern from parse5 tree. */
function findAll(root, tagName) {
  const results = [];
  function walk(node) {
    if (node.tagName && node.tagName.toLowerCase() === tagName.toLowerCase()) {
      results.push(node);
    }
    (node.childNodes || node.children || []).forEach(walk);
  }
  walk(root);
  return results;
}

function getAttr(node, name) {
  const attrs = node.attrs || node.attributes || {};
  if (Array.isArray(attrs)) {
    const found = attrs.find(a => a.name.toLowerCase() === name.toLowerCase());
    return found ? found.value : null;
  }
  return attrs[name] || null;
}

function innerText(node) {
  let text = '';
  function walk(n) {
    if (n.type === 'text' || n.nodeName === '#text') text += (n.data || n.value || '');
    (n.childNodes || n.children || []).forEach(walk);
  }
  walk(node);
  return text.trim();
}

// ---------------------------------------------------------------------------
// Individual rules
// ---------------------------------------------------------------------------

/**
 * RULE 001 – Unsubscribe link presence
 * CAN-SPAM and CASL require a clear, conspicuous unsubscribe mechanism.
 */
function checkUnsubscribeLink(root, raw) {
  const results = [];
  const hasUnsub = /%%unsub_center_url%%|unsub_center_url|unsubscribe/i.test(raw);
  if (!hasUnsub) {
    results.push({
      rule: 'EMAIL-001',
      severity: 'error',
      message: 'Missing unsubscribe link.',
      hint: 'Add <a href="%%unsub_center_url%%">Unsubscribe</a> to your email footer. Required by CAN-SPAM.',
    });
  }
  return results;
}

/**
 * RULE 002 – Physical mailing address presence
 * CAN-SPAM requires a valid physical postal address in every commercial email.
 */
function checkPhysicalAddress(root, raw) {
  const results = [];
  const hasMemberAddr = /%%Member_Addr%%|%%Member_City%%/i.test(raw);
  if (!hasMemberAddr) {
    results.push({
      rule: 'EMAIL-002',
      severity: 'error',
      message: 'Missing physical mailing address.',
      hint: 'Include %%Member_Busname%% %%Member_Addr%% %%Member_City%%, %%Member_State%% %%Member_PostalCode%% in the footer. Required by CAN-SPAM.',
    });
  }
  return results;
}

/**
 * RULE 003 – Alt text on images
 * Accessibility and plain-text fallback when images are blocked.
 */
function checkImageAltText(root, raw) {
  const results = [];
  const imgs = findAll(root, 'img');
  imgs.forEach((img, i) => {
    const alt = getAttr(img, 'alt');
    if (alt === null || alt === undefined) {
      results.push({
        rule: 'EMAIL-003',
        severity: 'error',
        message: `Image #${i + 1} is missing an alt attribute.`,
        hint: 'Every <img> must have an alt="" attribute (can be empty for decorative images, but must be present).',
      });
    } else if (alt.length > 100) {
      results.push({
        rule: 'EMAIL-003',
        severity: 'warning',
        message: `Image #${i + 1} has a very long alt text (${alt.length} chars).`,
        hint: 'Keep alt text concise — under 100 characters.',
      });
    }
  });
  return results;
}

/**
 * RULE 004 – Links must use RedirectTo() or alias attribute
 * SFMC click tracking requires all links to be wrapped in RedirectTo().
 */
function checkLinkTracking(root, raw) {
  const results = [];
  const links = findAll(root, 'a');
  links.forEach((a, i) => {
    const href = getAttr(a, 'href') || '';
    const alias = getAttr(a, 'alias');
    // Skip system/AMPscript links and anchors
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (href.includes('%%unsub_center_url%%') || href.includes('%%subscription_center_url%%')) return;
    if (!href.includes('RedirectTo') && !href.startsWith('%%=')) {
      results.push({
        rule: 'EMAIL-004',
        severity: 'warning',
        message: `Link #${i + 1} ("${href.substring(0, 60)}") is not wrapped in RedirectTo().`,
        hint: 'Wrap links: href="%%=RedirectTo(\'https://...\')=%%". This enables SFMC click tracking.',
      });
    }
    if (!alias) {
      results.push({
        rule: 'EMAIL-004',
        severity: 'info',
        message: `Link #${i + 1} is missing an alias attribute.`,
        hint: 'Add alias="descriptive name" to all <a> tags for cleaner click reports in SFMC.',
      });
    }
  });
  return results;
}

/**
 * RULE 005 – Viewport meta tag (mobile responsiveness)
 */
function checkViewportMeta(root, raw) {
  const results = [];
  if (!/<meta[^>]+viewport[^>]*>/i.test(raw)) {
    results.push({
      rule: 'EMAIL-005',
      severity: 'error',
      message: 'Missing <meta name="viewport"> tag.',
      hint: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0" /> in the <head>.',
    });
  }
  return results;
}

/**
 * RULE 006 – Doctype declaration
 * SFMC templates often start with an AMPscript %%[ ... ]%% preamble block
 * before the DOCTYPE, which is perfectly valid — we search the whole file.
 */
function checkDoctype(root, raw) {
  const results = [];
  if (!/<!DOCTYPE\s+html/i.test(raw)) {
    results.push({
      rule: 'EMAIL-006',
      severity: 'error',
      message: 'Missing <!DOCTYPE html> declaration.',
      hint: 'Email HTML must include <!DOCTYPE html> to ensure consistent rendering across clients. In SFMC templates it may appear after an opening AMPscript block.',
    });
  }
  return results;
}

/**
 * RULE 007 – Inline styles presence (email client compatibility)
 * Many email clients strip <style> blocks. Warn if no inline styles are found.
 */
function checkInlineStyles(root, raw) {
  const results = [];
  const allTags = findAll(root, 'td').concat(findAll(root, 'div')).concat(findAll(root, 'p'));
  const inlineCount = allTags.filter(n => getAttr(n, 'style')).length;
  if (allTags.length > 5 && inlineCount === 0) {
    results.push({
      rule: 'EMAIL-007',
      severity: 'warning',
      message: 'No inline styles found on layout elements.',
      hint: 'Inline critical styles (padding, color, font-size) for compatibility with Outlook and Gmail which strip <style> blocks.',
    });
  }
  return results;
}

/**
 * RULE 008 – Spam trigger words in visible text
 */
function checkSpamWords(root, raw) {
  const results = [];
  const bodyText = raw.replace(/<[^>]+>/g, ' ').replace(/%%[^%]+%%/g, ' ').toLowerCase();
  const found = SPAM_WORDS.filter(w => bodyText.includes(w.toLowerCase()));
  if (found.length > 0) {
    results.push({
      rule: 'EMAIL-008',
      severity: 'warning',
      message: `Potential spam trigger words detected: "${found.join('", "')}"`,
      hint: 'Consider rephrasing to avoid spam filters. These words are commonly used in phishing/spam emails.',
    });
  }
  return results;
}

/**
 * RULE 009 – HTML <title> tag presence
 * Used by email clients as the preview window title and for accessibility.
 */
function checkTitle(root, raw) {
  const results = [];
  if (/<title>\s*<\/title>/i.test(raw) || !/<title>/i.test(raw)) {
    results.push({
      rule: 'EMAIL-009',
      severity: 'warning',
      message: 'Missing or empty <title> tag.',
      hint: 'Use a descriptive <title> with personalization (e.g., <title>%%=v(@firstName)=%%, your order update</title>).',
    });
  }
  return results;
}

/**
 * RULE 010 – Table layout width check
 * Email layouts using tables should have explicit widths.
 */
function checkTableWidths(root, raw) {
  const results = [];
  const tables = findAll(root, 'table');
  tables.forEach((t, i) => {
    const width = getAttr(t, 'width');
    const style = getAttr(t, 'style') || '';
    if (!width && !style.includes('width')) {
      results.push({
        rule: 'EMAIL-010',
        severity: 'info',
        message: `Table #${i + 1} has no explicit width attribute.`,
        hint: 'Set width="600" (or %) on outer tables for consistent Outlook rendering.',
      });
    }
  });
  return results;
}

/**
 * RULE 011 – Maximum email width guideline (should be ≤ 650px)
 */
function checkEmailWidth(root, raw) {
  const results = [];
  const match = raw.match(/max-width\s*:\s*(\d+)px/i);
  if (match) {
    const w = parseInt(match[1], 10);
    if (w > 650) {
      results.push({
        rule: 'EMAIL-011',
        severity: 'warning',
        message: `Email max-width is ${w}px, which exceeds the recommended 600–650px.`,
        hint: 'Use max-width: 600px for the outer wrapper to ensure correct rendering in most email clients.',
      });
    }
  }
  return results;
}

/**
 * RULE 012 – AMPscript: unclosed %% blocks
 * Detects mismatched %% delimiters which cause AMPscript render errors.
 */
function checkAmpscriptDelimiters(root, raw) {
  const results = [];
  // Count %% occurrences outside of %%[ ... ]%% blocks
  const openBlocks = (raw.match(/%%\[/g) || []).length;
  const closeBlocks = (raw.match(/\]%%/g) || []).length;
  if (openBlocks !== closeBlocks) {
    results.push({
      rule: 'EMAIL-012',
      severity: 'error',
      message: `AMPscript block mismatch: ${openBlocks} opening %%[ vs ${closeBlocks} closing ]%%.`,
      hint: 'Every %%[ must have a matching ]%%. Review your AMPscript blocks for unclosed brackets.',
    });
  }
  // Inline expression check: %%=...=%% pairs
  const inlineMatches = raw.match(/%%=/g) || [];
  const inlineClose = raw.match(/=%%/g) || [];
  if (inlineMatches.length !== inlineClose.length) {
    results.push({
      rule: 'EMAIL-012',
      severity: 'error',
      message: `AMPscript inline expression mismatch: ${inlineMatches.length} %%=  vs  ${inlineClose.length} =%%.`,
      hint: 'Every %%=expression=%% must be properly opened and closed.',
    });
  }
  return results;
}

/**
 * RULE 013 – AMPscript: IF without ENDIF
 */
function checkAmpscriptIfEndif(root, raw) {
  const results = [];
  // Strip strings inside quotes to avoid false positives
  const stripped = raw.replace(/"[^"]*"|'[^']*'/g, '""');
  const ifCount    = (stripped.match(/\bIF\b/g) || []).length;
  const endifCount = (stripped.match(/\bENDIF\b/g) || []).length;
  if (ifCount !== endifCount) {
    results.push({
      rule: 'EMAIL-013',
      severity: 'error',
      message: `AMPscript IF/ENDIF mismatch: ${ifCount} IF vs ${endifCount} ENDIF.`,
      hint: 'Every AMPscript IF block requires a matching ENDIF. Check for missing ENDIF statements.',
    });
  }
  const forCount  = (stripped.match(/\bFOR\b/g) || []).length;
  const nextCount = (stripped.match(/\bNEXT\b/g) || []).length;
  if (forCount !== nextCount) {
    results.push({
      rule: 'EMAIL-013',
      severity: 'error',
      message: `AMPscript FOR/NEXT mismatch: ${forCount} FOR vs ${nextCount} NEXT.`,
      hint: 'Every AMPscript FOR loop requires a matching NEXT statement.',
    });
  }
  return results;
}

/**
 * RULE 014 – Preheader text presence
 * The preheader (inbox preview text) is shown next to the subject line.
 */
function checkPreheader(root, raw) {
  const results = [];
  // Common preheader patterns: hidden span/div with class/style including 'preheader' or display:none + mso-hide
  const hasPreheader =
    /class=["'][^"']*preheader[^"']*["']/i.test(raw) ||
    /mso-hide:all/i.test(raw) ||
    /display:\s*none[^"']*font-size:\s*0/i.test(raw);
  if (!hasPreheader) {
    results.push({
      rule: 'EMAIL-014',
      severity: 'warning',
      message: 'No preheader text element detected.',
      hint: 'Add a hidden preheader span immediately after <body>: <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your preview text here...</span>',
    });
  }
  return results;
}

/**
 * RULE 015 – No JavaScript in email
 * JavaScript is blocked by virtually all email clients and triggers spam filters.
 */
function checkNoJavaScript(root, raw) {
  const results = [];
  if (/<script[\s>]/i.test(raw)) {
    results.push({
      rule: 'EMAIL-015',
      severity: 'error',
      message: '<script> tag found in email HTML.',
      hint: 'JavaScript is unsupported and blocked by all major email clients. Remove all <script> tags.',
    });
  }
  if (/\bon\w+\s*=/i.test(raw)) {
    results.push({
      rule: 'EMAIL-015',
      severity: 'error',
      message: 'Inline JavaScript event handler detected (e.g., onclick=, onload=).',
      hint: 'Remove all JavaScript event handlers from email HTML. They are blocked by email clients.',
    });
  }
  return results;
}

/**
 * RULE 016 – Subscription center URL presence
 */
function checkSubscriptionCenter(root, raw) {
  const results = [];
  if (!/%%subscription_center_url%%/i.test(raw)) {
    results.push({
      rule: 'EMAIL-016',
      severity: 'warning',
      message: 'Missing subscription center / preferences link.',
      hint: 'Add <a href="%%subscription_center_url%%">Manage Preferences</a> to allow subscribers to self-manage without unsubscribing.',
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Export all rules as an array of functions
// ---------------------------------------------------------------------------
module.exports = [
  checkDoctype,
  checkViewportMeta,
  checkTitle,
  checkPreheader,
  checkUnsubscribeLink,
  checkPhysicalAddress,
  checkSubscriptionCenter,
  checkImageAltText,
  checkLinkTracking,
  checkInlineStyles,
  checkSpamWords,
  checkTableWidths,
  checkEmailWidth,
  checkAmpscriptDelimiters,
  checkAmpscriptIfEndif,
  checkNoJavaScript,
];
