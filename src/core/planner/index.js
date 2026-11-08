// SPDX-License-Identifier: GPL-3.0-only
/** 核心域「计划时间线 / 重算 / 五级计划生成」统一出口（plan.md §6.1 / §7）。 */

// T-012 · 时间线切分与重算标注
export { isIsoDate, splitPlanFilesByDate } from './split.js';
export {
  RECALC_PREFIX,
  RECALC_ANNOTATION_VERSION,
  buildRecalcAnnotation,
  stripRecalcAnnotations,
} from './annotation.js';
export { applyRecalcToFuture } from './apply.js';

// T-013 · 五级计划生成器（未渲染的结构化计划对象）
export { PLAN_ERROR, PlanError, planIssue } from './errors.js';
export {
  PLAN_LEVELS,
  DAY_TRIGGER_HOUR,
  TRIGGER,
  addDays,
  mondayOf,
  isoWeekOf,
  describePeriod,
  resolvePlanPeriod,
  resolvePeriodicDispatch,
} from './period.js';
export { CALENDAR_STATUS, readCalendarView } from './calendar.js';
export {
  validatePlanContext,
  buildPlan,
  planYear,
  planSeason,
  planMonth,
  planWeek,
  planDay,
  validatePlanHierarchy,
} from './plan.js';
export {
  PERIODIC_PATH,
  buildPeriodicPlan,
  writePeriodicPlan,
} from './periodic.js';
