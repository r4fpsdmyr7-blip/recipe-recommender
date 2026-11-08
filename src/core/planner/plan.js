// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-013 · 五级计划生成器（plan.md §6.1：ctx → **未渲染**的结构化计划对象）。
 *
 * FR-006 年 / 季 / 月 / 周 / 日；FR-007 首日口径；FR-009 计划头部五类版本 +
 * 上承 / 下接；FR-010 非首日补跑的执行窗口；E-02 跨月周归属；§9 不变式 1/2/4。
 *
 * 边界：**不渲染 Markdown**（T-018）、不生成四餐明细 / 采购（T-016）、
 * 不去重（T-015）、不实现历法下载与缓存（T-014）、不做反馈下发（T-017）。
 * 因此 `periodic-plan.md` 只是确定性 ASCII 结构索引（见 periodic.js），
 * AC-02 / AC-03 在本任务完成后仍为 RED（P-02）。
 */
import { RX_FIELDS } from '../rx/index.js';
import { VERSION_KEYS, detectVersionChanges } from '../profile/index.js';
import { PLAN_ERROR, PlanError, planIssue } from './errors.js';
import { isIsoDate } from './split.js';
import { PLAN_LEVELS, DAY_TRIGGER_HOUR, addDays, mondayOf, describePeriod, resolvePlanPeriod } from './period.js';
import { CALENDAR_STATUS, readCalendarView } from './calendar.js';

const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/;
const GUIDELINE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_ID = /^[A-Za-z0-9._-]{1,64}$/;
const LOCALE_SOURCES = Object.freeze(['user', 'auto:nationality', 'auto:residence', 'auto:fallback']);

const BASE_NOTICE_KEYS = Object.freeze([
  'plan.notice.disclaimer',
  'plan.notice.estimated',
  'plan.marker.aigc',
]);

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 校验并规范化生成上下文；供 plan.js / periodic.js 共用。
 * @param {unknown} rawCtx
 * @returns {Readonly<Record<string, unknown>>}
 * @throws {PlanError}
 */
export function validatePlanContext(rawCtx) {
  /** @type {import('./errors.js').PlanIssue[]} */
  const problems = [];
  const ctx = isRecord(rawCtx) ? /** @type {Record<string, unknown>} */ (rawCtx) : {};
  const add = (code, field, hint) => problems.push(planIssue(code, field, hint));

  const clock = ctx.clock;
  if (!isRecord(clock)
    || typeof /** @type {Record<string, unknown>} */ (clock).today !== 'function'
    || typeof /** @type {Record<string, unknown>} */ (clock).iso !== 'function') {
    add(PLAN_ERROR.CLOCK, '(clock)', 'action.plan.inject_clock');
  }

  const profile = ctx.profile;
  if (!isRecord(profile) || !isRecord(/** @type {Record<string, unknown>} */ (profile).body)
    || typeof /** @type {any} */ (profile).body?.bmr_kcal !== 'number'
    || !Number.isFinite(/** @type {any} */ (profile).body.bmr_kcal)) {
    add(PLAN_ERROR.PROFILE, '(profile)', 'action.plan.profile_object');
  }
  const versions = isRecord(profile)
    ? /** @type {Record<string, unknown>} */ (profile).versions
    : undefined;
  /** @type {Record<string, string>} */
  const versionIds = {};
  if (!isRecord(versions)) {
    add(PLAN_ERROR.VERSION, '(profile).versions', 'action.plan.versions_object');
  } else {
    for (const key of VERSION_KEYS) {
      const entry = /** @type {Record<string, unknown>} */ (versions)[key];
      const id = typeof entry === 'string' ? entry : (isRecord(entry) ? entry.id : undefined);
      if (typeof id !== 'string' || !VERSION_ID.test(id)) {
        add(PLAN_ERROR.VERSION, `(profile).versions.${key}`, 'action.plan.version_id');
      } else {
        versionIds[key] = id;
      }
    }
    for (const key of Object.keys(/** @type {Record<string, unknown>} */ (versions))) {
      if (!VERSION_KEYS.includes(key)) {
        add(PLAN_ERROR.VERSION, '(profile).versions', 'action.plan.versions_unknown_key');
      }
    }
  }

  const rx = ctx.rx;
  if (!isRecord(rx)
    || !RX_FIELDS.every((k) => Array.isArray(/** @type {Record<string, unknown>} */ (rx)[k])
      && /** @type {Array<unknown>} */ (/** @type {Record<string, unknown>} */ (rx)[k]).length === 2)
    || !isRecord(/** @type {Record<string, unknown>} */ (rx).guardrails)) {
    add(PLAN_ERROR.RX, '(rx)', 'action.plan.rx_object');
  }
  const bmr = isRecord(profile) ? Number(/** @type {any} */ (profile).body?.bmr_kcal) : NaN;
  if (isRecord(rx) && Array.isArray(/** @type {Record<string, unknown>} */ (rx).energy_kcal)
    && /** @type {Array<number>} */ (/** @type {Record<string, unknown>} */ (rx).energy_kcal)[0] < bmr) {
    add(PLAN_ERROR.RX, '(rx).energy_kcal', 'action.plan.rx_bmr_floor');
  }
  if (typeof ctx.guideline_id !== 'string' || !GUIDELINE_ID.test(ctx.guideline_id)) {
    add(PLAN_ERROR.INVALID, '(guideline_id)', 'action.plan.guideline_id');
  }
  if (typeof ctx.language_tag !== 'string' || !LANGUAGE_TAG.test(ctx.language_tag)) {
    add(PLAN_ERROR.INVALID, '(language_tag)', 'action.plan.language_tag');
  }
  if (typeof ctx.locale_source !== 'string' || !LOCALE_SOURCES.includes(ctx.locale_source)) {
    add(PLAN_ERROR.INVALID, '(locale_source)', 'action.plan.locale_source');
  }
  if (problems.length > 0) throw new PlanError(problems);

  const c = /** @type {any} */ (clock);
  const runDate = c.today();
  const runAt = c.iso();
  if (!isIsoDate(runDate) || typeof runAt !== 'string') {
    throw new PlanError([planIssue(PLAN_ERROR.DATE, '(run_date)', 'action.plan.run_date')]);
  }
  // 先校验缓存视图键集；具体周期范围由 buildPlan 按层级再次筛选。
  const calendarView = readCalendarView(ctx.calendar, runDate, runDate);

  return Object.freeze({
    clock: c,
    profile: /** @type {Record<string, unknown>} */ (profile),
    rx: /** @type {Record<string, unknown>} */ (rx),
    calendar: ctx.calendar,
    calendarView,
    versionIds: Object.freeze(versionIds),
    guidelineId: ctx.guideline_id,
    languageTag: ctx.language_tag,
    localeSource: ctx.locale_source,
    runDate,
    runAt,
    existingHeader: ctx.existing_header,
  });
}

/** @param {Record<string, unknown>} c */
function prescriptionOf(c) {
  const rx = /** @type {Record<string, unknown>} */ (c.rx);
  const out = Object.fromEntries(RX_FIELDS.map((k) => [k, [.../** @type {Array<unknown>} */ (rx[k])]]));
  return Object.freeze(out);
}

/** 上承 / 下接引用；E-02 跨月周按多数天数所属月份定上承。 */
function linksFor(level, period, runDate) {
  const y = Number(period.start_date.slice(0, 4));
  const mm = Number(period.start_date.slice(5, 7));
  const quarterStartMonth = Math.floor((mm - 1) / 3) * 3 + 1;
  const brief = (p) => Object.freeze({
    level: p.level, period_id: p.period_id, title: p.title,
    file_name: p.file_name, start_date: p.start_date, end_date: p.end_date,
  });

  if (level === 'year') {
    return {
      parent: null,
      children: Object.freeze([1, 4, 7, 10].map((m) =>
        brief(describePeriod('season', `${y}-${pad2(m)}-01`)))),
      linkReferences: Object.freeze([]),
    };
  }
  if (level === 'season') {
    return {
      parent: brief(describePeriod('year', `${y}-01-01`)),
      children: Object.freeze([0, 1, 2].map((i) =>
        brief(describePeriod('month', `${y}-${pad2(quarterStartMonth + i)}-01`)))),
      linkReferences: Object.freeze([]),
    };
  }
  if (level === 'month') {
    const weeks = [];
    for (let ws = mondayOf(period.start_date); ws <= period.end_date; ws = addDays(ws, 7)) {
      weeks.push(brief(describePeriod('week', ws)));
    }
    return {
      parent: brief(describePeriod('season', `${y}-${pad2(quarterStartMonth)}-01`)),
      children: Object.freeze(weeks),
      linkReferences: Object.freeze([]),
    };
  }
  if (level === 'week') {
    /** @type {Record<string, number>} */
    const counts = {};
    for (let d = period.start_date; d <= period.end_date; d = addDays(d, 1)) {
      const key = d.slice(0, 7);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const months = Object.keys(counts).sort();
    const majority = months.reduce((best, k) => counts[k] > counts[best] ? k : best, months[0]);
    return {
      parent: brief(describePeriod('month', `${majority}-01`)),
      children: Object.freeze(period.days.map((d) =>
        brief(describePeriod('day', d.plan_date)))),
      linkReferences: Object.freeze(months.filter((k) => k !== majority)
        .map((k) => brief(describePeriod('month', `${k}-01`)))),
    };
  }
  return {
    parent: brief(describePeriod('week', period.target_date)),
    children: Object.freeze([]),
    linkReferences: Object.freeze([]),
  };
}

/** @param {Record<string, unknown>} c */
function recalcOf(c) {
  if (!isRecord(c.existingHeader)) return null;
  try {
    const change = detectVersionChanges(
      /** @type {Record<string, unknown>} */ (c.profile),
      /** @type {Record<string, unknown>} */ (c.existingHeader),
    );
    return Object.freeze({
      needs_recalc: change.needs_recalc,
      reason_keys: change.reason_keys,
      version_ids: change.version_ids,
      source: change.source,
    });
  } catch {
    return null;
  }
}

/**
 * @param {'year'|'season'|'month'|'week'|'day'} level
 * @param {unknown} rawCtx
 * @returns {Readonly<Record<string, unknown>>} 未渲染的结构化计划对象
 */
export function buildPlan(level, rawCtx) {
  const c = /** @type {Record<string, unknown>} */ (validatePlanContext(rawCtx));
  if (!PLAN_LEVELS.includes(level)) {
    throw new PlanError([planIssue(PLAN_ERROR.LEVEL, '(level)', 'action.plan.level')]);
  }
  // 日任务唯一例外：必须由业务时区 20:00 触发（FR-007）。
  if (level === 'day') {
    const hour = Number(/T(\d{2}):/.exec(String(c.runAt))?.[1] ?? NaN);
    if (hour !== DAY_TRIGGER_HOUR) {
      throw new PlanError([planIssue(PLAN_ERROR.WINDOW, '(run_at)', 'action.plan.daily_window')]);
    }
  }

  const period = resolvePlanPeriod(level, /** @type {string} */ (c.runDate), /** @type {string} */ (c.runAt));
  const calendar = readCalendarView(c.calendar, period.start_date, period.end_date);
  const links = linksFor(level, period, /** @type {string} */ (c.runDate));
  const noticeKeys = [...BASE_NOTICE_KEYS];
  if (period.is_catchup) noticeKeys.push('plan.notice.execution_window');
  if (calendar.status === CALENDAR_STATUS.FALLBACK) noticeKeys.push('plan.notice.calendar_fallback');

  const rx = /** @type {Record<string, unknown>} */ (c.rx);
  const guardrails = /** @type {Record<string, unknown>} */ (rx.guardrails);
  const comparison = isRecord(rx.comparison)
    ? /** @type {Record<string, unknown>} */ (rx.comparison)
    : {};

  const header = Object.freeze({
    level,
    period_id: period.period_id,
    title: period.title,
    file_name: period.file_name,
    generated_date: c.runDate,
    generated_at: c.runAt,
    run_date: c.runDate,
    trigger: period.trigger,
    version_ids: c.versionIds,
    parent: links.parent,
    children: links.children,
    link_references: links.linkReferences,
    language_tag: c.languageTag,
    locale_source: c.localeSource,
    guideline_id: c.guidelineId,
    calendar: Object.freeze({ ...calendar }),
    execution_window: period.execution_window,
    notice_keys: Object.freeze(noticeKeys),
  });

  return Object.freeze({
    level,
    period_id: period.period_id,
    file_name: period.file_name,
    period,
    header,
    prescription: prescriptionOf(c),
    comparison: Object.freeze({
      adapter_id: comparison.adapter_id ?? c.guidelineId,
      compliant: comparison.compliant === true,
    }),
    guardrails: Object.freeze({
      energy_floor_kcal: guardrails.energy_floor_kcal,
      protein_floor_g: guardrails.protein_floor_g,
    }),
    calendar: Object.freeze({ ...calendar }),
    days: period.days,
    recalc: recalcOf(c),
  });
}

export const planYear = (ctx) => buildPlan('year', ctx);
export const planSeason = (ctx) => buildPlan('season', ctx);
export const planMonth = (ctx) => buildPlan('month', ctx);
export const planWeek = (ctx) => buildPlan('week', ctx);
export const planDay = (ctx) => buildPlan('day', ctx);

/**
 * 校验「下级不得违反上层的处方、时令主线与版本」（FR-006 / FR-027 / §9）。
 * @param {Record<string, unknown>} parent
 * @param {Record<string, unknown>} child
 * @returns {true}
 * @throws {PlanError}
 */
export function validatePlanHierarchy(parent, child) {
  /** @type {import('./errors.js').PlanIssue[]} */
  const problems = [];
  const add = (code, field, hint) => problems.push(planIssue(code, field, hint));
  const pi = PLAN_LEVELS.indexOf(/** @type {any} */ (parent?.level));
  const ci = PLAN_LEVELS.indexOf(/** @type {any} */ (child?.level));
  if (pi < 0 || ci !== pi + 1) add(PLAN_ERROR.LEVEL, '(level)', 'action.plan.hierarchy_level');
  if (child?.header?.parent?.period_id !== parent?.period_id) {
    add(PLAN_ERROR.HIERARCHY, '(child).header.parent', 'action.plan.hierarchy_parent');
  }
  if (!same(child?.header?.version_ids, parent?.header?.version_ids)) {
    add(PLAN_ERROR.VERSION, '(child).header.version_ids', 'action.plan.hierarchy_versions');
  }
  if (!same(child?.prescription, parent?.prescription)) {
    add(PLAN_ERROR.RX, '(child).prescription', 'action.plan.hierarchy_rx');
  }
  const pc = parent?.calendar;
  const cc = child?.calendar;
  const subset = Array.isArray(cc?.term_ids) && Array.isArray(pc?.term_ids)
    && cc.term_ids.every((id) => pc.term_ids.includes(id));
  const activeOk = cc?.active_term_id == null || pc?.term_ids?.includes(cc.active_term_id);
  if (pc?.cache_id !== cc?.cache_id || !subset || !activeOk) {
    add(PLAN_ERROR.CALENDAR, '(child).calendar', 'action.plan.hierarchy_calendar');
  }
  if (child?.level === 'day'
    && !(child.period?.target_date >= parent.period?.start_date
      && child.period?.target_date <= parent.period?.end_date)) {
    add(PLAN_ERROR.HIERARCHY, '(child).period.target_date', 'action.plan.hierarchy_window');
  }
  if (problems.length > 0) throw new PlanError(problems);
  return true;
}
