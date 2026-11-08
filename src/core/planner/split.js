// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-012 · 重算 / 修订公共切分（P-05 / AC-06 / SC-006 / plan.md §7.3）。
 *
 * 「计划日期 ≤ 运行日」的文件是已执行历史快照，任何重算 / 修订不得回改；
 * 等号必须归入历史侧。运行日由注入的 ClockPort.today() 给出，
 * 本文件不直接读取系统时钟，保证 AC-02 / AC-03 / AC-06 可确定性复现。
 *
 * 纯函数：不改写输入数组与元素，不触碰文件系统。
 */
import { RECALC_ERROR, RecalcError, recalcIssue } from '../profile/recalc-errors.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 严格 ISO 日历日期校验：格式 + 真实存在（排除 2026-13-01 / 2026-02-30）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 按运行日切分计划文件清单。
 *
 * @param {unknown} planFiles Array<{ path: string, plan_date: string, ... }>
 * @param {string} runDate YYYY-MM-DD（业务时区下的运行日）
 * @returns {Readonly<{
 *   run_date: string,
 *   historical: ReadonlyArray<Record<string, unknown>>,
 *   future: ReadonlyArray<Record<string, unknown>>
 * }>}
 * @throws {RecalcError} 日期 / 清单不合法，错误码 ERR_RECALC_DATE
 */
export function splitPlanFilesByDate(planFiles, runDate) {
  /** @type {import('../profile/recalc-errors.js').RecalcIssue[]} */
  const problems = [];
  if (!isIsoDate(runDate)) {
    problems.push(recalcIssue(RECALC_ERROR.DATE, '(run_date)', 'action.recalc.run_date'));
  }
  if (!Array.isArray(planFiles)) {
    problems.push(recalcIssue(RECALC_ERROR.DATE, '(plan_files)', 'action.recalc.plan_files'));
  }

  /** @type {Record<string, unknown>[]} */
  const historical = [];
  /** @type {Record<string, unknown>[]} */
  const future = [];
  if (Array.isArray(planFiles)) {
    for (const [index, file] of planFiles.entries()) {
      if (!isRecord(file)
        || typeof /** @type {Record<string, unknown>} */ (file).path !== 'string'
        || /** @type {Record<string, unknown>} */ (file).path.length === 0) {
        problems.push(recalcIssue(RECALC_ERROR.DATE, `plan_files[${index}].path`, 'action.recalc.plan_path'));
        continue;
      }
      const record = /** @type {Record<string, unknown>} */ (file);
      if (!isIsoDate(record.plan_date)) {
        problems.push(recalcIssue(RECALC_ERROR.DATE, `plan_files[${index}].plan_date`, 'action.recalc.plan_date'));
        continue;
      }
      // ISO 日期字符串字典序 == 日历序；等号归历史（P-05）。
      const bucket = /** @type {string} */ (record.plan_date) <= runDate ? historical : future;
      bucket.push(Object.freeze({ ...record }));
    }
  }
  if (problems.length > 0) throw new RecalcError(problems);

  return Object.freeze({
    run_date: runDate,
    historical: Object.freeze(historical),
    future: Object.freeze(future),
  });
}
