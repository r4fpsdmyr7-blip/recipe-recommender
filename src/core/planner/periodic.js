// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-013 · 三层合并视图 `periodic-plan.md`（FR-008 / plan.md §5.3 / P-05）。
 *
 * **只写确定性 ASCII 结构索引**：文件清单、周期标识、版本 ID、刷新标记与
 * 执行窗口。语言包渲染的表格、免责声明文案、[AIGC] 人可读标注全部归 T-018；
 * 因此本任务不产出 `2026-annual.md` / `2026-Q1.md` / `2026-01-month.md`
 * 三份渲染文件，**AC-02 仍为 RED**（P-02）。
 *
 * plan.md §5.3：滚动速查「仅在指向未来周期时刷新」。写前会校验三层周期
 * 结束日期均 > 运行日，否则拒绝刷新且不产生任何写入（P-05 / §7.3）。
 */
import { PLAN_ERROR, PlanError, planIssue } from './errors.js';
import { isIsoDate } from './split.js';
import { describePeriod, resolvePlanPeriod, resolvePeriodicDispatch } from './period.js';
import { validatePlanContext } from './plan.js';

export const PERIODIC_PATH = 'periodic-plan.md';

const LOW_LEVELS = Object.freeze(['year', 'season', 'month']);
const NOTICE_KEYS = Object.freeze([
  'plan.notice.disclaimer', 'plan.notice.estimated', 'plan.marker.aigc',
]);

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 构建三层合并视图对象（未渲染）。
 * @param {unknown} rawCtx 与 planYear 等相同的生成上下文
 */
export function buildPeriodicPlan(rawCtx) {
  const c = /** @type {Record<string, unknown>} */ (validatePlanContext(rawCtx));
  const runDate = /** @type {string} */ (c.runDate);
  const dispatch = resolvePeriodicDispatch(runDate);
  const y = Number(runDate.slice(0, 4));
  const mm = Number(runDate.slice(5, 7));
  const quarterStartMonth = Math.floor((mm - 1) / 3) * 3 + 1;

  const layers = LOW_LEVELS.map((level, i) => {
    const p = resolvePlanPeriod(level, runDate, /** @type {string} */ (c.runAt));
    const parent = i === 0
      ? null
      : (i === 1
        ? describePeriod('year', `${y}-01-01`)
        : describePeriod('season', `${y}-${String(quarterStartMonth).padStart(2, '0')}-01`));
    return Object.freeze({
      level,
      period_id: p.period_id,
      title: p.title,
      file_name: p.file_name,
      start_date: p.start_date,
      end_date: p.end_date,
      refreshed: dispatch.includes(level),
      parent: parent ? Object.freeze({
        level: parent.level, period_id: parent.period_id, file_name: parent.file_name,
      }) : null,
      execution_window: p.execution_window,
    });
  });

  return Object.freeze({
    path: PERIODIC_PATH,
    run_date: runDate,
    generated_at: c.runAt,
    version_ids: c.versionIds,
    calendar: Object.freeze({
      cache_id: c.calendarView.cache_id,
      year: c.calendarView.year,
      status: c.calendarView.status,
    }),
    layers: Object.freeze(layers),
    notice_keys: NOTICE_KEYS,
  });
}

/**
 * 把三层合并视图写成确定性 ASCII 结构索引。
 *
 * @param {import('../../io/ports.js').FsPort} fsPort
 * @param {unknown} view buildPeriodicPlan() 的输出
 * @param {string} runDate YYYY-MM-DD
 * @returns {Promise<Readonly<{path: string, bytes: number, layers: number}>>}
 * @throws {PlanError} 视图不合法 / 未指向未来周期 / 端口不可用
 */
export async function writePeriodicPlan(fsPort, view, runDate) {
  if (!fsPort || typeof fsPort.writeText !== 'function') {
    throw new PlanError([planIssue(PLAN_ERROR.FS, '(fsPort)', 'action.plan.inject_fs_port')]);
  }
  if (!isRecord(view) || !Array.isArray(/** @type {Record<string, unknown>} */ (view).layers)
    || /** @type {Array<unknown>} */ (/** @type {Record<string, unknown>} */ (view).layers).length !== 3) {
    throw new PlanError([planIssue(PLAN_ERROR.VIEW, '(view)', 'action.plan.view_object')]);
  }
  if (!isIsoDate(runDate)) {
    throw new PlanError([planIssue(PLAN_ERROR.DATE, '(run_date)', 'action.plan.run_date')]);
  }
  const v = /** @type {Record<string, unknown>} */ (view);
  const layers = /** @type {Array<Record<string, unknown>>} */ (v.layers);
  // P-05：滚动速查仅在全部三层都指向未来周期时刷新。
  if (!layers.every((l) => typeof l.end_date === 'string' && l.end_date > runDate)) {
    throw new PlanError([planIssue(PLAN_ERROR.TIMELINE, '(view).layers', 'action.plan.view_future')]);
  }

  const ids = /** @type {Record<string, unknown>} */ (v.version_ids);
  const cal = /** @type {Record<string, unknown>} */ (v.calendar);
  const lines = [
    '# periodic-plan',
    `generated_at=${v.generated_at}`,
    `run_date=${v.run_date}`,
    `version_ids=${Object.entries(ids).map(([k, id]) => `${k}:${id}`).join(',')}`,
    `calendar_cache_id=${cal.cache_id}`,
    `calendar_status=${cal.status}`,
    `notice_keys=${/** @type {Array<string>} */ (v.notice_keys).join(',')}`,
    ...layers.map((l) => [
      `layer level=${l.level}`,
      `period_id=${l.period_id}`,
      `file_name=${l.file_name}`,
      `start_date=${l.start_date}`,
      `end_date=${l.end_date}`,
      `refreshed=${l.refreshed}`,
      `parent=${l.parent ? l.parent.period_id : 'none'}`,
      `remaining_days=${l.execution_window.remaining_days}`,
    ].join(' ')),
    '',
  ];
  const text = lines.join('\n');
  await fsPort.writeText(PERIODIC_PATH, text);
  return Object.freeze({ path: PERIODIC_PATH, bytes: text.length, layers: layers.length });
}
