// SPDX-License-Identifier: GPL-3.0-only
/** 核心域「反馈 A/B/C/D 状态机与修订护栏」统一出口（plan.md §4 / §6.1 / FR-022～027）。 */

export { FEEDBACK_ERROR, FeedbackError, feedbackIssue } from './errors.js';
export {
  FEEDBACK_PATH,
  CHANGELOG_PATH,
  FEEDBACK_ACTION,
  FEEDBACK_CATEGORY,
  FEEDBACK_STATUS,
  FEEDBACK_TRANSITIONS,
  FEEDBACK_COLUMNS,
  CHANGELOG_COLUMNS,
  CHANGELOG_VERSION_KEYS,
  GUARDRAIL_FIELD_KEYS,
  ISSUE_KINDS,
  ISSUE_DIRECTIONS,
  PLAN_LEVELS,
  isRecord,
  isCanonicalId,
  isIsoDate,
  isRuleVersionId,
  validateIssue,
  validateTimeline,
  validatePatch,
  validateFeedbackEntry,
  validateChangelogEntry,
  nextRuleVersionId,
  transitionFeedbackStatus,
  latestStatusById,
} from './contract.js';
export { classifyFeedback, buildFeedbackEntry, buildChangelogEntry } from './classify.js';
export {
  FEEDBACK_PREFIX,
  FEEDBACK_ANNOTATION_VERSION,
  buildRevisionAnnotation,
  stripRevisionAnnotations,
} from './annotation.js';
export {
  renderFeedbackHeader,
  renderFeedbackLine,
  parseFeedbackText,
  appendFeedbackEntry,
  renderChangelogHeader,
  renderChangelogLine,
  parseChangelogText,
  appendChangelogEntry,
  appendFeedbackRecord,
} from './ledger.js';
export { applyUpstreamRevision, applyDownstreamRevision } from './revision.js';
export { buildFeedbackCheckSection, renderFeedbackCheckIndex } from './section.js';
