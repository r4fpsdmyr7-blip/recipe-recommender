// SPDX-License-Identifier: GPL-3.0-only
/** T-015 · 去重域稳定错误码与脱敏错误对象（FR-049 / plan.md §9 / P-11）。 */

export const DEDUP_ERROR = Object.freeze({
  INVALID: 'ERR_DEDUP_INVALID',
  CANDIDATE: 'ERR_DEDUP_CANDIDATE',
  LEDGER: 'ERR_DEDUP_LEDGER',
  WINDOW: 'ERR_DEDUP_WINDOW',
  DATE: 'ERR_DEDUP_DATE',
  ID: 'ERR_DEDUP_ID',
  VERSION: 'ERR_DEDUP_VERSION',
  CYCLE: 'ERR_DEDUP_CYCLE',
  WEEK: 'ERR_DEDUP_WEEK',
  APPEND: 'ERR_DEDUP_APPEND',
  FS: 'ERR_DEDUP_FS',
});

/**
 * @typedef {Readonly<{code: string, field: string, hint: string}>} DedupIssue
 */

/** @param {string} code @param {string} field @param {string} hint */
export function dedupIssue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

export class DedupError extends Error {
  /** @param {ReadonlyArray<DedupIssue>} issues */
  constructor(issues) {
    super(`${DEDUP_ERROR.INVALID}: ${issues.map((i) => i.code).join(',')}`);
    this.name = 'DedupError';
    this.code = DEDUP_ERROR.INVALID;
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })));
  }
}
