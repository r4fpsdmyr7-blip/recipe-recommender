// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-013 · 五级周期解析与合并调度（FR-006～010 / AC-02 / AC-03 / P-05）。
 *
 * 口径（SPEC §6.2）：新周期首日产出**该新周期本身**，唯一例外是每日 20:00
 * 产出次日计划。年 / 季 / 月三个低频层级合并为同一调度，按月份条件产出 1–3 层。
 *
 * 「季」按日历季度 Q1–Q4（AC-02 的 2026-Q1）；节气主线不在此计算，
 * 一律从 T-014 的只读缓存透传（FR-012：禁止内置 / 套用固定近似日期表）。
 * 所有日期运算只用 ECMA-262 内置 Date（UTC 日历日），零第三方依赖、零 IO。
 */
import { PLAN_ERROR, PlanError, planIssue } from './errors.js';
import { isIsoDate, splitPlanFilesByDate } from './split.js';

/** @type {ReadonlyArray<'year'|'season'|'month'|'week'|'day'>} */
export const PLAN_LEVELS = Object.freeze(['year', 'season', 'month', 'week', 'day']);

/** FR-007 唯一例外：日任务固定在业务时区 20:00 触发。 */
export const DAY_TRIGGER_HOUR = 20;

export const TRIGGER = Object.freeze({
  FIRST_DAY: 'plan.trigger.period_first_day',
  CATCHUP: 'plan.trigger.catchup',
  DAILY_2000: 'plan.trigger.daily_2000',
});

const pad2 = (n) => String(n).padStart(2, '0');
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const isoOf = (date) => date.toISOString().slice(0, 10);

/** @param {string} iso @param {number} days */
export function addDays(iso, days) {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoOf(d);
}

/** @param {string} iso @returns {number} 周一 = 0 … 周日 = 6 */
function mondayIndex(iso) {
  return (utc(iso).getUTCDay() + 6) % 7;
}

/** @param {string} iso @returns {string} 所在 ISO 周的周一 */
export function mondayOf(iso) {
  return addDays(iso, -mondayIndex(iso));
}

/** ISO 8601 周编号（以该周周四所在年份为 ISO 年）。 */
export function isoWeekOf(iso) {
  const d = utc(iso);
  const thursday = new Date(d.getTime());
  thursday.setUTCDate(d.getUTCDate() - mondayIndex(iso) + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Thursday = new Date(jan4.getTime());
  jan4Thursday.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() + 6) % 7 + 3);
  const week = 1 + Math.round((thursday.getTime() - jan4Thursday.getTime()) / 604800000);
  return { year, week };
}

/** @param {number} y @param {number} m 1-based */
function monthRange(y, m) {
  const start = `${y}-${pad2(m)}-01`;
  const end = isoOf(new Date(Date.UTC(y, m, 0)));
  return { start, end };
}

/**
 * 轻量周期标识（不含执行窗口 / 日清单），供上承 / 下接引用。
 * @param {'year'|'season'|'month'|'week'|'day'} level
 * @param {string} date YYYY-MM-DD（日级传目标日期本身）
 * @returns {{level: string, period_id: string, title: string, file_name: string,
 *   start_date: string, end_date: string}}
 */
export function describePeriod(level, date) {
  if (!PLAN_LEVELS.includes(level) || !isIsoDate(date)) {
    throw new PlanError([
      planIssue(!PLAN_LEVELS.includes(level) ? PLAN_ERROR.LEVEL : PLAN_ERROR.DATE,
        '(period)', 'action.plan.period'),
    ]);
  }
  return bounds(level, date);
}

/**
 * @param {'year'|'season'|'month'|'week'|'day'} level
 * @param {string} date YYYY-MM-DD
 * @returns {{level: string, period_id: string, title: string, file_name: string,
 *   start_date: string, end_date: string}}
 */
function bounds(level, date) {
  const y = Number(date.slice(0, 4));
  const mm = Number(date.slice(5, 7));
  if (level === 'year') {
    return {
      level, period_id: `${y}`, title: `${y}-annual`, file_name: `${y}-annual.md`,
      start_date: `${y}-01-01`, end_date: `${y}-12-31`,
    };
  }
  if (level === 'season') {
    const q = Math.floor((mm - 1) / 3) + 1;
    const { start, end } = monthRange(y, (q - 1) * 3 + 3);
    return {
      level, period_id: `${y}-Q${q}`, title: `${y}-Q${q}`, file_name: `${y}-Q${q}.md`,
      start_date: `${y}-${pad2((q - 1) * 3 + 1)}-01`, end_date: end,
    };
  }
  if (level === 'month') {
    const { start, end } = monthRange(y, mm);
    return {
      level, period_id: `${y}-${pad2(mm)}`, title: `${y}-${pad2(mm)}-month`,
      file_name: `${y}-${pad2(mm)}-month.md`, start_date: start, end_date: end,
    };
  }
  if (level === 'week') {
    const start = mondayOf(date);
    const { year, week } = isoWeekOf(start);
    const id = `${year}-W${pad2(week)}`;
    return {
      level, period_id: id, title: `${id}-week`, file_name: `${id}-week.md`,
      start_date: start, end_date: addDays(start, 6),
    };
  }
  return {
    level, period_id: date, title: date, file_name: `${date}.md`,
    start_date: date, end_date: date,
  };
}

/** 生成周期内的全部日历日（用于 T-012 时间线切分与完整框架）。 */
function daysOf(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    out.push({ path: d, plan_date: d });
  }
  return out;
}

/**
 * 解析某一层级的周期描述符。
 *
 * @param {string} level
 * @param {string} runDate YYYY-MM-DD（业务时区运行日）
 * @param {string|null} [runAt] 带偏移的 ISO 时间戳；日级非 20:00 一律拒绝
 * @returns {Readonly<Record<string, unknown>>}
 * @throws {PlanError} 层级 / 日期 / 触发窗口不合法
 */
export function resolvePlanPeriod(level, runDate, runAt = null) {
  const problems = [];
  if (!PLAN_LEVELS.includes(level)) {
    problems.push(planIssue(PLAN_ERROR.LEVEL, '(level)', 'action.plan.level'));
  }
  if (!isIsoDate(runDate)) {
    problems.push(planIssue(PLAN_ERROR.DATE, '(run_date)', 'action.plan.run_date'));
  }
  if (problems.length > 0) throw new PlanError(problems);

  if (level === 'day' && typeof runAt === 'string') {
    const hour = Number(/T(\d{2}):/.exec(runAt)?.[1] ?? NaN);
    if (hour !== DAY_TRIGGER_HOUR) {
      throw new PlanError([planIssue(PLAN_ERROR.WINDOW, '(run_at)', 'action.plan.daily_window')]);
    }
  }

  const b = bounds(level, level === 'day' ? addDays(runDate, 1) : runDate);
  const firstDay = level !== 'day' && runDate === b.start_date;
  const isCatchup = level !== 'day' && !firstDay;

  // 复用 T-012 的公共切分：计划日期 ≤ 运行日 = 已执行历史，剩余窗口只含未来日。
  const files = daysOf(b.start_date, b.end_date);
  const { historical, future } = splitPlanFilesByDate(files, runDate);
  const executionWindow = Object.freeze({
    start_date: future[0]?.plan_date ?? null,
    end_date: b.end_date,
    total_days: files.length,
    executed_days: historical.length,
    remaining_days: future.length,
  });

  return Object.freeze({
    ...b,
    run_date: runDate,
    target_date: b.start_date,
    first_day: firstDay,
    is_catchup: isCatchup,
    trigger: level === 'day'
      ? TRIGGER.DAILY_2000
      : (firstDay ? TRIGGER.FIRST_DAY : TRIGGER.CATCHUP),
    execution_window: executionWindow,
    days: Object.freeze(files.map((f) => Object.freeze({ plan_date: f.plan_date, file_name: `${f.plan_date}.md` }))),
  });
}

/**
 * FR-008：年 / 季 / 月合并调度，按月份条件判定产出 1–3 层。
 * @param {string} runDate
 * @returns {ReadonlyArray<'year'|'season'|'month'>}
 */
export function resolvePeriodicDispatch(runDate) {
  if (!isIsoDate(runDate)) {
    throw new PlanError([planIssue(PLAN_ERROR.DATE, '(run_date)', 'action.plan.run_date')]);
  }
  const mm = Number(runDate.slice(5, 7));
  const dd = Number(runDate.slice(8, 10));
  if (dd !== 1) return Object.freeze([]);
  if (mm === 1) return Object.freeze(['year', 'season', 'month']);
  if (mm === 4 || mm === 7 || mm === 10) return Object.freeze(['season', 'month']);
  return Object.freeze(['month']);
}
