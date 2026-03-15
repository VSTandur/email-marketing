'use strict';

/**
 * Journey QC Rules — Unit Tests
 * ================================
 * Tests every rule exported from scripts/qc/rules/journey-rules.js.
 * Each rule is exercised with a passing case (no results expected)
 * and one or more failing cases (specific result severities expected).
 *
 * Runner: Node.js built-in test runner  (node --test)
 * Usage:  npm test
 *         node --test scripts/qc/tests/journey-rules.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// Load the rules array
const rules = require(path.join(__dirname, '..', 'rules', 'journey-rules'));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Find a rule function by the rule ID string it emits. */
function ruleById(id) {
  for (const fn of rules) {
    const src = fn.toString();
    if (src.includes(`'${id}'`) || src.includes(`"${id}"`)) return fn;
  }
  throw new Error(`Rule ${id} not found in journey-rules.js`);
}

/** Build a minimal valid journey that all rules should accept. */
function validJourney(overrides = {}) {
  return Object.assign({
    key:         'welcome-series-v1',
    name:        'Welcome Series',
    description: 'Sends a 3-email welcome sequence to new subscribers joining via web form.',
    status:      'Draft',
    entryMode:   'SingleEntrance',
    tags:        ['lifecycle', 'welcome', 'onboarding'],
    goals: [
      {
        id:   'goal-1',
        name: 'Goal: First Purchase',
        metaData: { isExitCriteria: true },
        criteria: { type: 'ContactMeetsCriteria', schema: {} },
      },
    ],
    exits: [
      { id: 'exit-1', metaData: {}, criteria: { type: 'ContactMeetsCriteria', schema: {} } },
    ],
    triggers: [
      {
        id:       'trigger-1',
        type:     'ContactAudienceActivity',
        metaData: { entryActivityKey: 'email-day0' },
      },
    ],
    activities: [
      {
        key:  'email-day0',
        name: 'Send Welcome Email — Day 0',
        type: 'EMAILV2',
        outcomes: [{ key: 'outcome-1', next: 'wait-3days' }],
        configurationArguments: { triggeredSend: { emailId: 'abc123' } },
      },
      {
        key:  'wait-3days',
        name: 'Wait 3 Days',
        type: 'WAIT',
        outcomes: [{ key: 'outcome-2', next: 'email-day3' }],
        configurationArguments: { waitDuration: 3, waitUnit: 'DAYS' },
      },
      {
        key:  'email-day3',
        name: 'Send Follow-Up Email — Day 3',
        type: 'EMAILV2',
        outcomes: [{ key: 'outcome-3', next: 'exit-activity' }],
        configurationArguments: { triggeredSend: { emailId: 'def456' } },
      },
      {
        key:      'exit-activity',
        name:     'Exit — Journey Complete',
        type:     'EXIT',
        outcomes: [],
        configurationArguments: {},
      },
    ],
  }, overrides);
}

// ─── JRN-001: Journey goal ────────────────────────────────────────────────────

describe('JRN-001 — Journey goal', () => {
  const rule = ruleById('JRN-001');

  it('passes when a goal is defined', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('warns when no goals are defined', () => {
    const j = validJourney({ goals: [] });
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
    assert.equal(results[0].rule, 'JRN-001');
  });

  it('warns when goals field is absent', () => {
    const j = validJourney();
    delete j.goals;
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
  });
});

// ─── JRN-002: Email activities must reference an email asset ─────────────────

describe('JRN-002 — Email activities have email asset', () => {
  const rule = ruleById('JRN-002');

  it('passes when all EMAILV2 activities have an emailId', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('errors when an EMAILV2 activity has no emailId', () => {
    const j = validJourney();
    j.activities[0].configurationArguments.triggeredSend.emailId = undefined;
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
    assert.equal(results[0].rule, 'JRN-002');
  });

  it('errors when configurationArguments is entirely missing', () => {
    const j = validJourney();
    delete j.activities[0].configurationArguments;
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
  });
});

// ─── JRN-003: Wait activities must have duration ──────────────────────────────

describe('JRN-003 — Wait activities have duration', () => {
  const rule = ruleById('JRN-003');

  it('passes when WAIT activity has waitDuration', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('passes when WAIT uses specificTime instead of duration', () => {
    const j = validJourney();
    j.activities[1].configurationArguments = { specificTime: '2025-12-01T09:00:00Z' };
    const results = rule(j);
    assert.equal(results.length, 0);
  });

  it('errors when WAIT activity has no duration configuration', () => {
    const j = validJourney();
    j.activities[1].configurationArguments = {};
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
    assert.equal(results[0].rule, 'JRN-003');
  });
});

// ─── JRN-004: Decision splits must have ≥2 outcomes and valid next keys ───────

describe('JRN-004 — Decision split outcomes', () => {
  const rule = ruleById('JRN-004');

  it('passes when there are no split activities', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('passes when split has 2+ valid outcomes', () => {
    const j = validJourney();
    j.activities.push({
      key:  'split-1',
      name: 'Engagement Split — Opened vs Not',
      type: 'ENGAGEMENTSPLIT',
      outcomes: [
        { key: 'o-open',  next: 'email-day3',    metaData: {} },
        { key: 'o-noopen', next: 'exit-activity', metaData: {} },
      ],
      configurationArguments: {},
    });
    const results = rule(j);
    assert.equal(results.length, 0);
  });

  it('errors when split has fewer than 2 outcomes', () => {
    const j = validJourney();
    j.activities.push({
      key:  'split-bad',
      name: 'Bad Split',
      type: 'ENGAGEMENTSPLIT',
      outcomes: [{ key: 'o1', next: 'email-day3', metaData: {} }],
      configurationArguments: {},
    });
    const results = rule(j);
    const errors = results.filter(r => r.severity === 'error' && r.rule === 'JRN-004');
    assert.ok(errors.length >= 1);
  });

  it('errors when an outcome next key does not exist', () => {
    const j = validJourney();
    j.activities.push({
      key:  'split-broken',
      name: 'Split With Dangling Ref',
      type: 'ENGAGEMENTSPLIT',
      outcomes: [
        { key: 'o1', next: 'email-day3',    metaData: {} },
        { key: 'o2', next: 'nonexistent-key', metaData: {} },
      ],
      configurationArguments: {},
    });
    const results = rule(j);
    const errors = results.filter(r => r.severity === 'error' && r.rule === 'JRN-004');
    assert.ok(errors.length >= 1);
  });
});

// ─── JRN-005: Exit criteria ───────────────────────────────────────────────────

describe('JRN-005 — Exit criteria', () => {
  const rule = ruleById('JRN-005');

  it('passes when journey has exits defined', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('passes when journey has an EXIT activity but no exits array', () => {
    const j = validJourney({ exits: [] });
    // validJourney has an EXIT activity
    const results = rule(j);
    assert.equal(results.length, 0);
  });

  it('warns when neither exits nor EXIT activity exists', () => {
    const j = validJourney({ exits: [] });
    j.activities = j.activities.filter(a => a.type !== 'EXIT');
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
    assert.equal(results[0].rule, 'JRN-005');
  });
});

// ─── JRN-006: Activity names must be descriptive ──────────────────────────────

describe('JRN-006 — Descriptive activity names', () => {
  const rule = ruleById('JRN-006');

  it('passes when all activities have descriptive names', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('warns when an activity uses a default name like "Email"', () => {
    const j = validJourney();
    j.activities[0].name = 'Email';
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
    assert.equal(results[0].rule, 'JRN-006');
  });

  it('warns for each activity with a default name', () => {
    const j = validJourney();
    j.activities[0].name = 'Email';
    j.activities[1].name = 'Wait';
    const results = rule(j);
    assert.equal(results.length, 2);
  });
});

// ─── JRN-007: Entry mode best practices ──────────────────────────────────────

describe('JRN-007 — Entry mode best practices', () => {
  const rule = ruleById('JRN-007');

  it('passes when welcome journey uses SingleEntrance', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('warns when welcome journey uses MultipleEntrances', () => {
    const j = validJourney({ entryMode: 'MultipleEntrances', name: 'Welcome Series Onboarding' });
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'warning');
    assert.equal(results[0].rule, 'JRN-007');
  });

  it('passes when non-welcome journey uses MultipleEntrances', () => {
    const j = validJourney({ entryMode: 'MultipleEntrances', name: 'Flash Sale Promo' });
    const results = rule(j);
    assert.equal(results.length, 0);
  });

  it('passes when no entryMode is set', () => {
    const j = validJourney();
    delete j.entryMode;
    const results = rule(j);
    assert.equal(results.length, 0);
  });
});

// ─── JRN-008: Journey key uniqueness format ───────────────────────────────────

describe('JRN-008 — Journey key format', () => {
  const rule = ruleById('JRN-008');

  it('passes when journey has a valid key', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('errors when journey key is absent', () => {
    const j = validJourney();
    delete j.key;
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
    assert.equal(results[0].rule, 'JRN-008');
  });

  it('errors when journey key is the placeholder value "undefined"', () => {
    const j = validJourney({ key: 'undefined' });
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
  });

  it('errors when journey key is the placeholder value "new"', () => {
    const j = validJourney({ key: 'new' });
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
  });
});

// ─── JRN-009: Random split percentages ───────────────────────────────────────

describe('JRN-009 — Random split percentages sum to 100', () => {
  const rule = ruleById('JRN-009');

  it('passes when there are no RANDOMSPLIT activities', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('passes when RANDOMSPLIT percentages sum to exactly 100', () => {
    const j = validJourney();
    j.activities.push({
      key:  'random-1',
      name: 'A/B Test Split — 50/50',
      type: 'RANDOMSPLIT',
      outcomes: [
        { key: 'A', next: 'email-day0', metaData: { percent: '50' } },
        { key: 'B', next: 'email-day3', metaData: { percent: '50' } },
      ],
      configurationArguments: {},
    });
    const results = rule(j);
    assert.equal(results.length, 0);
  });

  it('errors when RANDOMSPLIT percentages do not sum to 100', () => {
    const j = validJourney();
    j.activities.push({
      key:  'random-bad',
      name: 'A/B Test Split — Off',
      type: 'RANDOMSPLIT',
      outcomes: [
        { key: 'A', next: 'email-day0', metaData: { percent: '60' } },
        { key: 'B', next: 'email-day3', metaData: { percent: '50' } },
      ],
      configurationArguments: {},
    });
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'error');
    assert.equal(results[0].rule, 'JRN-009');
  });
});

// ─── JRN-010: Journey description ────────────────────────────────────────────

describe('JRN-010 — Journey description', () => {
  const rule = ruleById('JRN-010');

  it('passes when description is meaningful (>=10 chars)', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('is info when description is absent', () => {
    const j = validJourney();
    delete j.description;
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'info');
    assert.equal(results[0].rule, 'JRN-010');
  });

  it('is info when description is too short', () => {
    const j = validJourney({ description: 'Short' });
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'info');
  });
});

// ─── JRN-011: Journey tags ────────────────────────────────────────────────────

describe('JRN-011 — Journey tags', () => {
  const rule = ruleById('JRN-011');

  it('passes when tags are defined', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('is info when tags are empty array', () => {
    const j = validJourney({ tags: [] });
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'info');
    assert.equal(results[0].rule, 'JRN-011');
  });

  it('is info when tags field is absent', () => {
    const j = validJourney();
    delete j.tags;
    const results = rule(j);
    assert.equal(results.length, 1);
    assert.equal(results[0].severity, 'info');
  });
});

// ─── JRN-012: No orphaned activities ─────────────────────────────────────────

describe('JRN-012 — No orphaned activities', () => {
  const rule = ruleById('JRN-012');

  it('passes when all activities are reachable', () => {
    const results = rule(validJourney());
    assert.equal(results.length, 0);
  });

  it('passes when there is only one activity (trivially connected)', () => {
    const j = validJourney();
    j.activities = [j.activities[0]];
    const results = rule(j);
    assert.equal(results.length, 0);
  });

  it('warns when an activity is not referenced by any path', () => {
    const j = validJourney();
    // Add a disconnected activity
    j.activities.push({
      key:  'orphan-activity',
      name: 'Orphaned SMS',
      type: 'SMS',
      outcomes: [],
      configurationArguments: {},
    });
    const results = rule(j);
    const warnings = results.filter(r => r.severity === 'warning' && r.rule === 'JRN-012');
    // orphan-activity is not referenced by any outcome.next, so it should be flagged
    assert.ok(warnings.some(w => w.message.includes('orphan-activity')));
  });
});
