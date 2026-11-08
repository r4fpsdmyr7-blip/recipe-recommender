// SPDX-License-Identifier: GPL-3.0-only
/** 核心域「短期去重与只追加台账」统一出口（plan.md §4 / §6.1）。 */

export { DEDUP_ERROR, DedupError, dedupIssue } from './errors.js';
export {
  HISTORY_PATH,
  SHORT_TERM_DAYS,
  LOOKBACK_WEEKS,
  WEEK_DAYS,
  MAX_WEEK_OVERLAP,
  DEDUP_STATUS,
  DEDUP_RULE,
  DEDUP_REASON,
  LEDGER_COLUMNS,
  isIsoDate,
  addDays,
  mondayOf,
  comboFingerprint,
  formatVersionIds,
  parseVersionIds,
  validateWindow,
  validateCandidate,
  validateLedgerEntry,
  validateLedgerArray,
  toLedgerEntry,
} from './contract.js';
export {
  renderLedgerHeader,
  renderLedgerLine,
  parseLedgerText,
  appendDedupEntry,
} from './ledger.js';
export { applyDedup, applyDedupWeek } from './apply.js';
