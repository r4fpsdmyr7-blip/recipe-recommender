// SPDX-License-Identifier: GPL-3.0-only
/** 核心域「档案解析 / 校验 / 版本号比对」统一出口（plan.md §4 / §6.1）。 */

export { PROFILE_ERROR, ProfileValidationError, issue } from './errors.js';
export { ISO3166_1_ALPHA2, isIso3166Alpha2 } from './iso3166-1.js';
export { BODY_FAT_PCT_RANGE, validateProfile } from './validate.js';
export {
  VERSION_KINDS,
  VERSION_KEYS,
  versionIssues,
  normalizeVersions,
  compareVersions,
} from './versions.js';
export { parseProfile, loadProfile } from './load-profile.js';
export { RECALC_ERROR, RecalcError, recalcIssue } from './recalc-errors.js';
export {
  RECALC_REASON,
  RECALC_SOURCE,
  detectVersionChanges,
} from './detect-version-changes.js';
