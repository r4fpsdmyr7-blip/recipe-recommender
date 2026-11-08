// SPDX-License-Identifier: GPL-3.0-only
/** T-017 · 反馈与修订域稳定错误码与脱敏错误对象（FR-049 / plan.md §9 / P-11）。 */

export const FEEDBACK_ERROR = Object.freeze({
  INVALID: 'ERR_FEEDBACK_INVALID',
  ISSUE: 'ERR_FEEDBACK_ISSUE',
  TIMELINE: 'ERR_FEEDBACK_TIMELINE',
  KIND: 'ERR_FEEDBACK_KIND',
  EVIDENCE: 'ERR_FEEDBACK_EVIDENCE',
  GUARDRAIL: 'ERR_FEEDBACK_GUARDRAIL',
  PATCH: 'ERR_FEEDBACK_PATCH',
  ANNOTATION: 'ERR_FEEDBACK_ANNOTATION',
  LEDGER: 'ERR_FEEDBACK_LEDGER',
  CHANGELOG: 'ERR_FEEDBACK_CHANGELOG',
  STATUS: 'ERR_FEEDBACK_STATUS',
  APPEND: 'ERR_FEEDBACK_APPEND',
  FS: 'ERR_FEEDBACK_FS',
});

/**
 * @typedef {Readonly<{code: string, field: string, hint: string}>} FeedbackIssue
 */

/** @param {string} code @param {string} field @param {string} hint */
export function feedbackIssue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

export class FeedbackError extends Error {
  /** @param {ReadonlyArray<FeedbackIssue>} issues */
  constructor(issues) {
    super(`${FEEDBACK_ERROR.INVALID}: ${issues.map((i) => i.code).join(',')}`);
    this.name = 'FeedbackError';
    this.code = FEEDBACK_ERROR.INVALID;
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })));
  }
}
