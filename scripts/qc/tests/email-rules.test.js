'use strict';

/**
 * Email QC Rules — Unit Tests
 * ============================
 * Tests every rule exported from scripts/qc/rules/email-rules.js.
 * Each rule is exercised with a passing case (no results expected)
 * and one or more failing cases (specific result severities expected).
 *
 * Runner: Node.js built-in test runner  (node --test)
 * Usage:  npm test
 *         node --test scripts/qc/tests/email-rules.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// Load the rules array
const rules = require(path.join(__dirname, '..', 'rules', 'email-rules'));

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock HTML root node from a list of tag descriptors.
 * Each descriptor: { tag, attrs: { key: value, ... } }
 */
function makeRoot(tagDescriptors = []) {
  const childNodes = tagDescriptors.map(({ tag, attrs = {} }) => ({
    tagName: tag,
    attrs: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    childNodes: [],
    children:   [],
  }));
  return { tagName: 'root', attrs: [], childNodes, children: childNodes };
}

/**
 * Run a single named rule against (root, raw) and return its results array.
 */
function runRule(ruleFn, root, raw) {
  return ruleFn(root, raw);
}

/**
 * Find the rule function by checking its source for a rule ID string.
 * Rules are in the exported array; we identify by the rule ID they emit.
 */
function ruleById(id) {
  for (const fn of rules) {
    const src = fn.toString();
    if (src.includes(`'${id}'`) || src.includes(`"${id}"`)) return fn;
  }
  throw new Error(`Rule ${id} not found in email-rules.js`);
}

// ─── Minimal valid HTML base ─────────────────────────────────────────────────

const VALID_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Test Email</title>
  <style>
    @media only screen and (max-width:480px){ .wrapper { width:100% !important; } }
  </style>
</head>
<body>
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Preview text</span>
  <div class="wrapper" style="max-width:600px;">
    <p style="color:#333;">Hello</p>
    <a href="%%=RedirectTo('https://example.com')=%%" alias="CTA">Click</a>
  </div>
  <div class="footer">
    <a href="%%subscription_center_url%%">Manage Preferences</a>
    <a href="%%unsub_center_url%%">Unsubscribe</a>
    <p>%%Member_Busname%% %%Member_Addr%% %%Member_City%%, %%Member_State%% %%Member_PostalCode%%</p>
  </div>
</body>
</html>`;

// ─── EMAIL-001: Unsubscribe link ─────────────────────────────────────────────

describe('EMAIL-001 — Unsubscribe link', () => {
  const rule = ruleById('EMAIL-001');

  it('passes when %%unsub_center_url%% is present', () => {
    const results = runRule(rule, makeRoot(), VALID_HTML);
    assert.equal(results.length, 0);
  });

  it('errors when no unsubscribe reference found', () => {
    const raw = '<html><body><p>No unsub here.</p></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
    assert.equal(results[0].rule, 'EMAIL-001');
  });
});

// ─── EMAIL-002: Physical address ─────────────────────────────────────────────

describe('EMAIL-002 — Physical mailing address', () => {
  const rule = ruleById('EMAIL-002');

  it('passes when %%Member_Addr%% is present', () => {
    const results = runRule(rule, makeRoot(), VALID_HTML);
    assert.equal(results.length, 0);
  });

  it('errors when no Member_Addr found', () => {
    const raw = '<html><body><p>No address.</p></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
    assert.equal(results[0].rule, 'EMAIL-002');
  });
});

// ─── EMAIL-003: Alt text on images ───────────────────────────────────────────

describe('EMAIL-003 — Image alt text', () => {
  const rule = ruleById('EMAIL-003');

  it('passes when all images have alt attributes', () => {
    const root = makeRoot([{ tag: 'img', attrs: { src: 'a.jpg', alt: 'Banner' } }]);
    const results = runRule(rule, root, '<img src="a.jpg" alt="Banner" />');
    assert.equal(results.length, 0);
  });

  it('passes when image has empty alt (decorative)', () => {
    const root = makeRoot([{ tag: 'img', attrs: { src: 'a.jpg', alt: '' } }]);
    const results = runRule(rule, root, '<img src="a.jpg" alt="" />');
    assert.equal(results.length, 0);
  });

  it('errors when an image is missing the alt attribute', () => {
    const root = makeRoot([{ tag: 'img', attrs: { src: 'a.jpg' } }]);
    const results = runRule(rule, root, '<img src="a.jpg" />');
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
    assert.equal(results[0].rule, 'EMAIL-003');
  });

  it('warns when alt text exceeds 100 characters', () => {
    const longAlt = 'A'.repeat(101);
    const root = makeRoot([{ tag: 'img', attrs: { src: 'a.jpg', alt: longAlt } }]);
    const results = runRule(rule, root, `<img src="a.jpg" alt="${longAlt}" />`);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
  });
});

// ─── EMAIL-004: Link tracking (RedirectTo / alias) ───────────────────────────

describe('EMAIL-004 — Link tracking', () => {
  const rule = ruleById('EMAIL-004');

  it('passes for unsub/preference links (exempt from RedirectTo check)', () => {
    const raw = '<a href="%%unsub_center_url%%">Unsub</a>';
    const root = makeRoot([{ tag: 'a', attrs: { href: '%%unsub_center_url%%', alias: 'Unsub' } }]);
    const results = runRule(rule, root, raw);
    assert.equal(results.filter(r => r.rule === 'EMAIL-004' && r.severity === 'warning').length, 0);
  });

  it('warns when a non-system link does not use RedirectTo', () => {
    const root = makeRoot([{ tag: 'a', attrs: { href: 'https://example.com', alias: 'Link' } }]);
    const raw  = '<a href="https://example.com" alias="Link">Click</a>';
    const results = runRule(rule, root, raw);
    const warnings = results.filter(r => r.severity === 'warning');
    assert.ok(warnings.length >= 1, 'Expected at least one warning for missing RedirectTo');
  });

  it('info when link is missing alias attribute', () => {
    const root = makeRoot([{ tag: 'a', attrs: { href: '%%=RedirectTo("https://a.com")=%%' } }]);
    const raw  = '<a href="%%=RedirectTo(&quot;https://a.com&quot;)=%%">Link</a>';
    const results = runRule(rule, root, raw);
    const infos = results.filter(r => r.severity === 'info');
    assert.ok(infos.length >= 1, 'Expected info for missing alias');
  });

  it('passes anchors and mailto links without RedirectTo requirement', () => {
    const root = makeRoot([
      { tag: 'a', attrs: { href: '#top',                alias: 'Top' } },
      { tag: 'a', attrs: { href: 'mailto:a@b.com',      alias: 'Email' } },
      { tag: 'a', attrs: { href: 'tel:+15550001234',    alias: 'Call' } },
    ]);
    const raw = '<a href="#top" alias="Top">Top</a><a href="mailto:a@b.com" alias="Email">E</a>';
    const results = runRule(rule, root, raw);
    const warnings = results.filter(r => r.severity === 'warning');
    assert.equal(warnings.length, 0);
  });
});

// ─── EMAIL-005: Viewport meta tag ────────────────────────────────────────────

describe('EMAIL-005 — Viewport meta tag', () => {
  const rule = ruleById('EMAIL-005');

  it('passes when viewport meta is present', () => {
    const results = runRule(rule, makeRoot(), VALID_HTML);
    assert.equal(results.length, 0);
  });

  it('errors when viewport meta is absent', () => {
    const raw = '<html><head><title>T</title></head><body></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
    assert.equal(results[0].rule, 'EMAIL-005');
  });
});

// ─── EMAIL-006: DOCTYPE declaration ──────────────────────────────────────────

describe('EMAIL-006 — DOCTYPE declaration', () => {
  const rule = ruleById('EMAIL-006');

  it('passes when <!DOCTYPE html> is present', () => {
    const results = runRule(rule, makeRoot(), VALID_HTML);
    assert.equal(results.length, 0);
  });

  it('passes when DOCTYPE appears after an AMPscript preamble block', () => {
    const raw = '%%[\nSET @x = 1\n]%%\n<!DOCTYPE html>\n<html><body></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 0);
  });

  it('errors when no DOCTYPE is present', () => {
    const raw = '<html><body></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
    assert.equal(results[0].rule, 'EMAIL-006');
  });
});

// ─── EMAIL-007: Inline styles ────────────────────────────────────────────────

describe('EMAIL-007 — Inline styles', () => {
  const rule = ruleById('EMAIL-007');

  it('passes when layout elements have inline style attributes', () => {
    const root = makeRoot([
      { tag: 'div', attrs: { style: 'color:red' } },
      { tag: 'td',  attrs: { style: 'padding:10px' } },
      { tag: 'p',   attrs: { style: 'font-size:14px' } },
      { tag: 'div', attrs: { style: 'margin:0' } },
      { tag: 'div', attrs: { style: 'background:#fff' } },
      { tag: 'div', attrs: { style: 'width:600px' } },
    ]);
    const results = runRule(rule, root, '<div style="color:red"></div>');
    assert.equal(results.length, 0);
  });

  it('warns when many layout elements have no inline styles', () => {
    const root = makeRoot([
      { tag: 'div', attrs: {} },
      { tag: 'div', attrs: {} },
      { tag: 'div', attrs: {} },
      { tag: 'div', attrs: {} },
      { tag: 'div', attrs: {} },
      { tag: 'div', attrs: {} },
    ]);
    const results = runRule(rule, root, '<div></div><div></div><div></div>');
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
    assert.equal(results[0].rule, 'EMAIL-007');
  });
});

// ─── EMAIL-008: Spam trigger words ───────────────────────────────────────────

describe('EMAIL-008 — Spam trigger words', () => {
  const rule = ruleById('EMAIL-008');

  it('passes on clean marketing copy', () => {
    const raw = '<!DOCTYPE html><html><body><p>Shop our new collection today.</p></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 0);
  });

  it('warns when spam trigger words are found in body text', () => {
    const raw = '<!DOCTYPE html><html><body><p>Click here to earn extra cash!</p></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
    assert.equal(results[0].rule, 'EMAIL-008');
  });
});

// ─── EMAIL-009: Title tag ────────────────────────────────────────────────────

describe('EMAIL-009 — Title tag', () => {
  const rule = ruleById('EMAIL-009');

  it('passes when a non-empty title is present', () => {
    const results = runRule(rule, makeRoot(), VALID_HTML);
    assert.equal(results.length, 0);
  });

  it('warns when title tag is empty', () => {
    const raw = '<!DOCTYPE html><html><head><title></title></head><body></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
    assert.equal(results[0].rule, 'EMAIL-009');
  });

  it('warns when no title tag at all', () => {
    const raw = '<!DOCTYPE html><html><head></head><body></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
  });
});

// ─── EMAIL-010: Table widths ──────────────────────────────────────────────────

describe('EMAIL-010 — Table widths', () => {
  const rule = ruleById('EMAIL-010');

  it('passes when table has explicit width attribute', () => {
    const root = makeRoot([{ tag: 'table', attrs: { width: '600' } }]);
    const results = runRule(rule, root, '<table width="600"></table>');
    assert.equal(results.length, 0);
  });

  it('passes when table has width in style attribute', () => {
    const root = makeRoot([{ tag: 'table', attrs: { style: 'width:600px' } }]);
    const results = runRule(rule, root, '<table style="width:600px"></table>');
    assert.equal(results.length, 0);
  });

  it('is info when table has neither width attr nor style width', () => {
    const root = makeRoot([{ tag: 'table', attrs: {} }]);
    const results = runRule(rule, root, '<table></table>');
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'info');
    assert.equal(results[0].rule, 'EMAIL-010');
  });
});

// ─── EMAIL-011: Email width ───────────────────────────────────────────────────

describe('EMAIL-011 — Email max-width', () => {
  const rule = ruleById('EMAIL-011');

  it('passes when max-width is within 650px', () => {
    const raw = '<!DOCTYPE html><html><body><div style="max-width:600px"></div></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 0);
  });

  it('passes when no max-width is specified', () => {
    const raw = '<!DOCTYPE html><html><body></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 0);
  });

  it('warns when max-width exceeds 650px', () => {
    const raw = '<!DOCTYPE html><html><body><div style="max-width:700px"></div></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
    assert.equal(results[0].rule, 'EMAIL-011');
  });
});

// ─── EMAIL-012: AMPscript delimiters ─────────────────────────────────────────

describe('EMAIL-012 — AMPscript delimiters', () => {
  const rule = ruleById('EMAIL-012');

  it('passes when %%[ / ]%% are balanced', () => {
    const raw = '%%[\nSET @x = 1\n]%%\n<html>%%=v(@x)=%%</html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 0);
  });

  it('errors when %%[ has no matching ]%%', () => {
    const raw = '%%[\nSET @x = 1\n<html><body></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    const errors = results.filter(r => r.severity === 'error' && r.rule === 'EMAIL-012');
    assert.ok(errors.length >= 1);
  });

  it('errors when %%=...=%% inline expressions are unbalanced', () => {
    const raw = '%%[ SET @x=1 ]%%\n<p>%%=v(@x)%% oops</p>';
    const results = runRule(rule, makeRoot(), raw);
    const errors = results.filter(r => r.severity === 'error' && r.rule === 'EMAIL-012');
    assert.ok(errors.length >= 1);
  });
});

// ─── EMAIL-013: AMPscript IF/ENDIF and FOR/NEXT ───────────────────────────────

describe('EMAIL-013 — AMPscript IF/ENDIF and FOR/NEXT', () => {
  const rule = ruleById('EMAIL-013');

  it('passes when IF/ENDIF are balanced', () => {
    const raw = '%%[ IF 1==1 THEN\nSET @x=1\nENDIF ]%%';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 0);
  });

  it('passes when FOR/NEXT are balanced', () => {
    const raw = '%%[ FOR @i = 1 TO 3 DO\nSET @x = @i\nNEXT @i ]%%';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 0);
  });

  it('errors when IF has no ENDIF', () => {
    const raw = '%%[ IF 1==1 THEN\nSET @x=1\n ]%%';
    const results = runRule(rule, makeRoot(), raw);
    const errors = results.filter(r => r.severity === 'error' && r.rule === 'EMAIL-013');
    assert.ok(errors.length >= 1);
  });

  it('errors when FOR has no NEXT', () => {
    const raw = '%%[ FOR @i = 1 TO 3 DO\nSET @x = @i\n ]%%';
    const results = runRule(rule, makeRoot(), raw);
    const errors = results.filter(r => r.severity === 'error' && r.rule === 'EMAIL-013');
    assert.ok(errors.length >= 1);
  });
});

// ─── EMAIL-014: Preheader text ────────────────────────────────────────────────

describe('EMAIL-014 — Preheader text', () => {
  const rule = ruleById('EMAIL-014');

  it('passes when mso-hide:all preheader pattern is present', () => {
    const results = runRule(rule, makeRoot(), VALID_HTML);
    assert.equal(results.length, 0);
  });

  it('passes when preheader class is used', () => {
    const raw = '<html><body><span class="preheader">Preview</span></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 0);
  });

  it('warns when no preheader pattern is found', () => {
    const raw = '<!DOCTYPE html><html><body><p>Content</p></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
    assert.equal(results[0].rule, 'EMAIL-014');
  });
});

// ─── EMAIL-015: No JavaScript in email ───────────────────────────────────────

describe('EMAIL-015 — No JavaScript', () => {
  const rule = ruleById('EMAIL-015');

  it('passes on HTML with no scripts', () => {
    const results = runRule(rule, makeRoot(), VALID_HTML);
    assert.equal(results.length, 0);
  });

  it('errors when <script> tag is present', () => {
    const raw = '<html><body><script>alert(1)</script></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    const errors = results.filter(r => r.severity === 'error' && r.rule === 'EMAIL-015');
    assert.ok(errors.length >= 1);
  });

  it('errors when inline event handler is present', () => {
    const raw = '<html><body><a onclick="doSomething()">Click</a></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    const errors = results.filter(r => r.severity === 'error' && r.rule === 'EMAIL-015');
    assert.ok(errors.length >= 1);
  });
});

// ─── EMAIL-016: Subscription center ─────────────────────────────────────────

describe('EMAIL-016 — Subscription center URL', () => {
  const rule = ruleById('EMAIL-016');

  it('passes when %%subscription_center_url%% is present', () => {
    const results = runRule(rule, makeRoot(), VALID_HTML);
    assert.equal(results.length, 0);
  });

  it('warns when no subscription_center_url is found', () => {
    const raw = '<html><body><a href="%%unsub_center_url%%">Unsub</a></body></html>';
    const results = runRule(rule, makeRoot(), raw);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
    assert.equal(results[0].rule, 'EMAIL-016');
  });
});
