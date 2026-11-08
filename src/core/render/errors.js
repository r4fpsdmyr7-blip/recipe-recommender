// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-018 render domain errors (FR-049 / plan.md section 9 / P-11).
 *
 * Messages contain stable codes only. No natural language, no body values.
 * Every concrete rejection is carried as an issue with a Canonical ID hint.
 */

export const RENDER_ERROR = Object.freeze({
  INVALID: 'ERR_RENDER_INVALID',
  PLAN: 'ERR_RENDER_PLAN',
  HEADER: 'ERR_RENDER_HEADER',
  NOTICE: 'ERR_RENDER_NOTICE',
  PACK: 'ERR_RENDER_PACK',
  PACK_KEY: 'ERR_RENDER_PACK_KEY',
  PACK_TAG: 'ERR_RENDER_PACK_TAG',
  PACK_STRING: 'ERR_RENDER_PACK_STRING',
  FORMATTER: 'ERR_RENDER_FORMATTER',
  FORMATTER_OUTPUT: 'ERR_RENDER_FORMATTER_OUTPUT',
  SECTION: 'ERR_RENDER_SECTION',
  DATA: 'ERR_RENDER_DATA',
  INVARIANT: 'ERR_RENDER_INVARIANT',
});

/**
 * @typedef {Readonly<{code: string, field: string, hint: string}>} RenderIssue
 */

/** @param {string} code @param {string} field @param {string} hint */
export function renderIssue(code, field, hint) {
  return Object.freeze({ code, field, hint });
}

export class RenderError extends Error {
  /** @param {ReadonlyArray<RenderIssue>} issues */
  constructor(issues) {
    super(`${RENDER_ERROR.INVALID}: ${issues.map((i) => i.code).join(',')}`);
    this.name = 'RenderError';
    this.code = RENDER_ERROR.INVALID;
    this.issues = Object.freeze(issues.map((i) => Object.freeze({ ...i })));
  }
}
