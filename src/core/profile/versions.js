// SPDX-License-Identifier: GPL-3.0-only
/**
 * 四类数据版本 + 规则版本（FR-001 / FR-009 / plan.md §5.1、§5.3）。
 *
 * 四类数据版本：body 身体数据 / rx 营养处方 / loc 居住地 / st 节气时令；
 * rule 为当前规则版本。fixture 整体缺省 versions 时由引擎补 `fixture-*` 默认值
 * 并在输出显式标注（plan.md §5.1），updated_at 保持 null —— 不猜测日期（E-08）。
 *
 * 本文件只负责「解析、规范化、比对」；「变更触发重算」由 T-012
 * detectVersionChanges(profile, planHeader) 承担，本任务不越界实现。
 */
import { issue, PROFILE_ERROR } from './errors.js';

/** @type {ReadonlyArray<'body'|'rx'|'loc'|'st'>} */
export const VERSION_KINDS = Object.freeze(['body', 'rx', 'loc', 'st']);

/** @type {ReadonlyArray<string>} */
export const VERSION_KEYS = Object.freeze([...VERSION_KINDS, 'rule']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** @param {unknown} value */
function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * 校验显式声明的 versions 结构，返回问题列表（不抛异常）。
 * @param {unknown} rawVersions
 * @returns {import('./errors.js').ProfileIssue[]}
 */
export function versionIssues(rawVersions) {
  // plan.md §5.1：fixture 允许整体缺省；部分缺省 MUST 拒绝，不得猜测补齐。
  if (rawVersions === undefined || rawVersions === null) return [];
  if (typeof rawVersions !== 'object' || Array.isArray(rawVersions)) {
    return [issue(PROFILE_ERROR.VERSION, 'versions', 'action.profile.versions_object')];
  }

  /** @type {import('./errors.js').ProfileIssue[]} */
  const problems = [];
  /** @type {Record<string, unknown>} */
  const provided = /** @type {Record<string, unknown>} */ (rawVersions);

  for (const key of Object.keys(provided)) {
    if (!VERSION_KEYS.includes(key)) {
      problems.push(issue(PROFILE_ERROR.VERSION, 'versions', 'action.profile.versions_unknown_key'));
    }
  }

  for (const key of VERSION_KEYS) {
    const entry = provided[key];
    if (entry === undefined) {
      problems.push(issue(PROFILE_ERROR.VERSION, `versions.${key}`, 'action.profile.versions_complete'));
      continue;
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(issue(PROFILE_ERROR.VERSION, `versions.${key}`, 'action.profile.version_entry'));
      continue;
    }
    const record = /** @type {Record<string, unknown>} */ (entry);
    if (typeof record.id !== 'string' || !VERSION_ID.test(record.id)) {
      problems.push(issue(PROFILE_ERROR.VERSION, `versions.${key}.id`, 'action.profile.version_id'));
    }
    if (record.updated_at !== null && !isValidIsoDate(record.updated_at)) {
      problems.push(issue(PROFILE_ERROR.VERSION, `versions.${key}.updated_at`, 'action.profile.version_date'));
    }
  }
  return problems;
}

/**
 * 生成规范化版本集合。调用方 MUST 先确认 versionIssues() 为空。
 * @param {unknown} rawVersions
 */
export function normalizeVersions(rawVersions) {
  const declared = rawVersions !== undefined && rawVersions !== null;
  /** @type {Record<string, unknown>} */
  const provided = declared ? /** @type {Record<string, unknown>} */ (rawVersions) : {};
  /** @type {Record<string, unknown>} */
  const versions = {};
  /** @type {string[]} */
  const defaulted = [];

  for (const key of VERSION_KEYS) {
    if (declared) {
      const entry = /** @type {Record<string, unknown>} */ (provided[key]);
      versions[key] = Object.freeze({ id: entry.id, updated_at: entry.updated_at, defaulted: false });
    } else {
      versions[key] = Object.freeze({ id: `fixture-${key}`, updated_at: null, defaulted: true });
      defaulted.push(key);
    }
  }

  return {
    versions: Object.freeze(versions),
    meta: Object.freeze({
      source: declared ? 'declared' : 'fixture-default',
      defaulted: Object.freeze(defaulted),
    }),
  };
}

/**
 * 比对两份规范化版本集合，返回发生变化的版本键（按 VERSION_KEYS 顺序）。
 * 供 T-012 判定重算，本函数不产生任何重算动作。
 * @param {Record<string, any>} current
 * @param {Record<string, any>} expected
 * @returns {string[]}
 */
export function compareVersions(current, expected) {
  /** @type {string[]} */
  const changed = [];
  for (const key of VERSION_KEYS) {
    const a = current?.[key];
    const b = expected?.[key];
    if (!a || !b || a.id !== b.id || a.updated_at !== b.updated_at) changed.push(key);
  }
  return changed;
}
