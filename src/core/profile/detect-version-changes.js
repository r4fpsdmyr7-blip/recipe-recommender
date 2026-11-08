// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-012 · 档案版本 vs 计划头部版本检测（FR-004 / FR-005 / FR-014、E-04、§9 不变式 4）。
 *
 * 「每份计划头部版本集合 ⊆ 档案当前版本集合（否则触发重算）」。
 * 计划头部按 plan.md §5.2 只携带版本 **ID 字符串**；档案侧为 T-010
 * normalizeVersions() 产出的 `{ id, updated_at, defaulted }`。因此检测口径是
 * **ID 比对**：updated_at 只存在于档案侧，不参与与计划头部的比较，
 * 更不能从日期推断版本变化（E-08 不得猜测）。
 *
 * 本文件只产出「变化描述」，零 IO、零写文件、零面向人文案；
 * 真正的时间线切分与写入在 src/core/planner/（plan.md §7.3 / P-05）。
 */
import { VERSION_KEYS, compareVersions } from './versions.js';
import { RECALC_ERROR, RecalcError, recalcIssue } from './recalc-errors.js';

const VERSION_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** 三类重算原因的 Canonical ID；面向人的文案归 T-018 / T-031（P-11）。 */
export const RECALC_REASON = Object.freeze({
  BODY: 'plan.recalc.body',
  RESIDENCE: 'plan.recalc.residence',
  RULE: 'plan.recalc.rule',
});

/** E-04：档案版本号与计划头部不一致。 */
export const RECALC_SOURCE = 'E-04';

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从档案或计划头部读出五个版本 ID。
 * 同时接受两种合法形状：计划头部的字符串 ID、T-010 规范化的版本条目对象。
 * 任一侧不完整 / 含未知键 / ID 非法都 MUST 拒绝，不得猜测补齐（E-08）。
 *
 * @param {unknown} source
 * @param {'INVALID'|'HEADER'} code 档案侧用 INVALID，计划头部侧用 HEADER
 * @param {'profile'|'plan_header'} field
 * @param {import('./recalc-errors.js').RecalcIssue[]} problems
 * @returns {Record<string, string>}
 */
function readVersionIds(source, code, field, problems) {
  /** @type {Record<string, string>} */
  const ids = {};
  const versions = isRecord(source) ? /** @type {Record<string, unknown>} */ (source).versions : undefined;
  if (!isRecord(versions)) {
    problems.push(recalcIssue(RECALC_ERROR[code], `${field}.versions`, `action.recalc.${field}.versions_object`));
    return ids;
  }

  const entries = /** @type {Record<string, unknown>} */ (versions);
  for (const key of Object.keys(entries)) {
    if (!VERSION_KEYS.includes(key)) {
      problems.push(recalcIssue(RECALC_ERROR[code], `${field}.versions`, `action.recalc.${field}.versions_unknown_key`));
    }
  }

  for (const key of VERSION_KEYS) {
    const entry = entries[key];
    const id = typeof entry === 'string'
      ? entry
      : (isRecord(entry) ? /** @type {Record<string, unknown>} */ (entry).id : undefined);
    if (typeof id !== 'string' || !VERSION_ID.test(id)) {
      problems.push(recalcIssue(RECALC_ERROR[code], `${field}.versions.${key}`, `action.recalc.${field}.version_id`));
      continue;
    }
    ids[key] = id;
  }
  return ids;
}

/**
 * 检测档案与计划头部的版本差异。
 *
 * @param {unknown} profile 档案（含 T-010 规范化 versions，或等价的 ID 映射）
 * @param {unknown} planHeader 计划头部（含 versions: Record<string, string>）
 * @returns {Readonly<{
 *   changed: ReadonlyArray<string>,
 *   needs_recalc: boolean,
 *   reason_keys: ReadonlyArray<string>,
 *   version_ids: Readonly<Record<string, string>>,
 *   source: string
 * }>}
 * @throws {RecalcError} 任一侧版本集合不合法
 */
export function detectVersionChanges(profile, planHeader) {
  /** @type {import('./recalc-errors.js').RecalcIssue[]} */
  const problems = [];
  const current = readVersionIds(profile, 'INVALID', 'profile', problems);
  const header = readVersionIds(planHeader, 'HEADER', 'plan_header', problems);
  if (problems.length > 0) throw new RecalcError(problems);

  // 复用 T-010 的 VERSION_KEYS 顺序与 compareVersions；两侧都只给 { id }，
  // updated_at 均为 undefined，等价于纯 ID 比对（计划头部不含时间戳）。
  const changed = compareVersions(
    Object.fromEntries(VERSION_KEYS.map((key) => [key, { id: current[key] }])),
    Object.fromEntries(VERSION_KEYS.map((key) => [key, { id: header[key] }])),
  );

  /** @type {string[]} */
  const reasonKeys = [];
  if (changed.includes('body') || changed.includes('rx')) reasonKeys.push(RECALC_REASON.BODY);
  if (changed.includes('loc') || changed.includes('st')) reasonKeys.push(RECALC_REASON.RESIDENCE);
  if (changed.includes('rule')) reasonKeys.push(RECALC_REASON.RULE);

  // version_ids 只记录发生变化的键：它们就是计划头部要标注的「所依据版本号」。
  const versionIds = Object.fromEntries(changed.map((key) => [key, current[key]]));

  return Object.freeze({
    changed: Object.freeze([...changed]),
    needs_recalc: changed.length > 0,
    reason_keys: Object.freeze(reasonKeys),
    version_ids: Object.freeze(versionIds),
    source: RECALC_SOURCE,
  });
}
