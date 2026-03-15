/**
 * Journey QC Rules
 * =================
 * Each rule receives the parsed journey JSON object
 * and returns an array of QCResult objects.
 *
 * QCResult shape:
 *   { rule, severity, message, hint }
 *
 * severity: 'error' | 'warning' | 'info'
 */

'use strict';

// ---------------------------------------------------------------------------
// Rule: JRN-001 – Journey must have a goal defined
// ---------------------------------------------------------------------------
function checkGoalDefined(journey) {
  const results = [];
  if (!journey.goals || journey.goals.length === 0) {
    results.push({
      rule: 'JRN-001',
      severity: 'warning',
      message: `Journey "${journey.name}" has no goal defined.`,
      hint: 'Define at least one journey goal (e.g., ContactMeetsCriteria) to measure conversion and enable Einstein Engagement Scoring.',
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rule: JRN-002 – Every EMAIL activity must reference an email asset
// ---------------------------------------------------------------------------
function checkEmailActivitiesHaveAsset(journey) {
  const results = [];
  const emailActivities = (journey.activities || []).filter(a => a.type === 'EMAILV2');
  emailActivities.forEach(activity => {
    const emailId =
      (activity.configurationArguments && activity.configurationArguments.triggeredSend &&
       activity.configurationArguments.triggeredSend.emailId) ||
      (activity.arguments && activity.arguments.triggeredSend &&
       activity.arguments.triggeredSend.emailId);
    if (!emailId) {
      results.push({
        rule: 'JRN-002',
        severity: 'error',
        message: `Email activity "${activity.name}" (key: ${activity.key}) is not linked to an email asset.`,
        hint: 'Set configurationArguments.triggeredSend.emailId to the SFMC email ID before publishing.',
      });
    }
  });
  return results;
}

// ---------------------------------------------------------------------------
// Rule: JRN-003 – WAIT activities must have a defined duration
// ---------------------------------------------------------------------------
function checkWaitActivitiesHaveDuration(journey) {
  const results = [];
  const waitActivities = (journey.activities || []).filter(a => a.type === 'WAIT');
  waitActivities.forEach(activity => {
    const config = activity.configurationArguments || {};
    const hasDuration = config.waitDuration !== undefined || config.waitUnit !== undefined ||
                        config.specificTime !== undefined || config.waitEndDateAttributeExpression;
    if (!hasDuration) {
      results.push({
        rule: 'JRN-003',
        severity: 'error',
        message: `Wait activity "${activity.name}" (key: ${activity.key}) has no duration configured.`,
        hint: 'Set configurationArguments.waitDuration and waitUnit (e.g., {"waitDuration": 3, "waitUnit": "DAYS"}).',
      });
    }
  });
  return results;
}

// ---------------------------------------------------------------------------
// Rule: JRN-004 – Decision splits must have outcomes for all branches
// ---------------------------------------------------------------------------
function checkDecisionSplitOutcomes(journey) {
  const results = [];
  const splitActivities = (journey.activities || []).filter(
    a => a.type === 'MULTICRITERIADECISION' || a.type === 'ENGAGEMENTSPLIT' || a.type === 'RANDOMSPLIT'
  );
  splitActivities.forEach(activity => {
    const outcomes = activity.outcomes || [];
    if (outcomes.length < 2) {
      results.push({
        rule: 'JRN-004',
        severity: 'error',
        message: `Split activity "${activity.name}" (key: ${activity.key}) has fewer than 2 outcome paths (found: ${outcomes.length}).`,
        hint: 'Every decision split must define at least 2 outcome paths (branches). Add a default/else branch.',
      });
    }
    // Check each outcome points to a valid activity key
    const activityKeys = new Set((journey.activities || []).map(a => a.key));
    outcomes.forEach(outcome => {
      if (outcome.next && !activityKeys.has(outcome.next)) {
        results.push({
          rule: 'JRN-004',
          severity: 'error',
          message: `Split "${activity.name}": outcome "${outcome.key}" points to non-existent activity key "${outcome.next}".`,
          hint: `Ensure "${outcome.next}" is defined in the activities array.`,
        });
      }
    });
  });
  return results;
}

// ---------------------------------------------------------------------------
// Rule: JRN-005 – Journey must have an exit condition or max-duration safeguard
// ---------------------------------------------------------------------------
function checkExitCriteria(journey) {
  const results = [];
  const hasExits = journey.exits && journey.exits.length > 0;
  const hasExitActivity = (journey.activities || []).some(a => a.type === 'EXIT');
  if (!hasExits && !hasExitActivity) {
    results.push({
      rule: 'JRN-005',
      severity: 'warning',
      message: `Journey "${journey.name}" has no explicit exit criteria.`,
      hint: 'Define exit criteria to prevent contacts from being stuck. Add journey exits or an EXIT activity at the end of each path.',
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rule: JRN-006 – Activity names must be descriptive (not default)
// ---------------------------------------------------------------------------
const DEFAULT_NAMES = new Set([
  'Email', 'Wait', 'Random Split', 'Engagement Split', 'Decision Split',
  'Update Contact', 'REST', 'SMS', 'Push', 'Activity 1', 'New Activity',
]);

function checkActivityNames(journey) {
  const results = [];
  (journey.activities || []).forEach(activity => {
    if (DEFAULT_NAMES.has(activity.name)) {
      results.push({
        rule: 'JRN-006',
        severity: 'warning',
        message: `Activity "${activity.name}" (key: ${activity.key}) is using a default/generic name.`,
        hint: 'Use descriptive names like "Send Welcome Email – Day 0" or "Wait 3 Days After Open" for clarity in reporting.',
      });
    }
  });
  return results;
}

// ---------------------------------------------------------------------------
// Rule: JRN-007 – Entry mode best practices
// ---------------------------------------------------------------------------
function checkEntryMode(journey) {
  const results = [];
  if (!journey.entryMode) return results;
  // Re-engagement and welcome journeys should NOT allow multiple entrances
  const lcName = (journey.name || '').toLowerCase();
  if (
    (lcName.includes('welcome') || lcName.includes('onboarding')) &&
    journey.entryMode === 'MultipleEntrances'
  ) {
    results.push({
      rule: 'JRN-007',
      severity: 'warning',
      message: `Welcome/Onboarding journey "${journey.name}" uses MultipleEntrances entry mode.`,
      hint: 'Onboarding journeys should typically use "SingleEntrance" or "NoReEntry" to prevent subscribers from receiving the welcome series multiple times.',
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rule: JRN-008 – Journey key uniqueness format
// ---------------------------------------------------------------------------
function checkJourneyKey(journey) {
  const results = [];
  if (!journey.key) {
    results.push({
      rule: 'JRN-008',
      severity: 'error',
      message: 'Journey is missing a key.',
      hint: 'Set a unique journey key using a consistent naming convention: e.g., "welcome-series-v2" or "cart-abandonment-2025".',
    });
  } else if (journey.key === 'undefined' || journey.key === 'null' || journey.key === 'new') {
    results.push({
      rule: 'JRN-008',
      severity: 'error',
      message: `Journey key "${journey.key}" is a reserved or placeholder value.`,
      hint: 'Replace with a meaningful unique key before publishing.',
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rule: JRN-009 – Random split percentages must sum to 100
// ---------------------------------------------------------------------------
function checkRandomSplitPercentages(journey) {
  const results = [];
  const randomSplits = (journey.activities || []).filter(a => a.type === 'RANDOMSPLIT');
  randomSplits.forEach(activity => {
    const outcomes = activity.outcomes || [];
    const total = outcomes.reduce((sum, o) => {
      const pct = (o.metaData && o.metaData.percent) ? parseFloat(o.metaData.percent) : 0;
      return sum + pct;
    }, 0);
    if (outcomes.length > 0 && Math.abs(total - 100) > 0.01) {
      results.push({
        rule: 'JRN-009',
        severity: 'error',
        message: `Random split "${activity.name}" percentages sum to ${total}%, not 100%.`,
        hint: 'Random split outcome percentages must sum exactly to 100%. Adjust metaData.percent values.',
      });
    }
  });
  return results;
}

// ---------------------------------------------------------------------------
// Rule: JRN-010 – Description should be populated
// ---------------------------------------------------------------------------
function checkJourneyDescription(journey) {
  const results = [];
  if (!journey.description || journey.description.trim().length < 10) {
    results.push({
      rule: 'JRN-010',
      severity: 'info',
      message: `Journey "${journey.name}" has a missing or very short description.`,
      hint: 'Add a description that explains the journey purpose, trigger, and audience for documentation and team collaboration.',
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rule: JRN-011 – Tags should be present for organisation
// ---------------------------------------------------------------------------
function checkJourneyTags(journey) {
  const results = [];
  if (!journey.tags || journey.tags.length === 0) {
    results.push({
      rule: 'JRN-011',
      severity: 'info',
      message: `Journey "${journey.name}" has no tags.`,
      hint: 'Add tags (e.g., "transactional", "lifecycle", "q1-2025", "retention") for filtering in Journey Builder and Analytics Builder.',
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rule: JRN-012 – No orphaned activities (activities with no incoming path)
// ---------------------------------------------------------------------------
function checkOrphanedActivities(journey) {
  const results = [];
  const activities = journey.activities || [];
  if (activities.length <= 1) return results;

  // Build set of all activity keys that are referenced as "next" from some outcome
  const referencedKeys = new Set();
  activities.forEach(activity => {
    (activity.outcomes || []).forEach(outcome => {
      if (outcome.next) referencedKeys.add(outcome.next);
    });
  });

  // The first activity (entry point) can be unreferenced — skip it by finding entry trigger keys
  const triggerNextKeys = (journey.triggers || []).map(t => t.metaData && t.metaData.entryActivityKey).filter(Boolean);
  const triggerSet = new Set(triggerNextKeys);

  activities.forEach(activity => {
    if (!referencedKeys.has(activity.key) && !triggerSet.has(activity.key)) {
      // Only warn if not the only activity and there are triggers with a defined flow
      if (triggerNextKeys.length > 0) {
        results.push({
          rule: 'JRN-012',
          severity: 'warning',
          message: `Activity "${activity.name}" (key: ${activity.key}) may be orphaned — no other activity points to it.`,
          hint: 'Check that this activity is connected to the journey flow. Orphaned activities are unreachable.',
        });
      }
    }
  });
  return results;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
module.exports = [
  checkJourneyKey,
  checkGoalDefined,
  checkExitCriteria,
  checkEntryMode,
  checkActivityNames,
  checkEmailActivitiesHaveAsset,
  checkWaitActivitiesHaveDuration,
  checkDecisionSplitOutcomes,
  checkRandomSplitPercentages,
  checkOrphanedActivities,
  checkJourneyDescription,
  checkJourneyTags,
];
