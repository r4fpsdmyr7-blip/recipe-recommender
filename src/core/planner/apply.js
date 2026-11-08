// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-012 · 把重算限制在「计划日期 > 运行日」的未来计划（P-05 / AC-06 / SC-006）。
 *
 * 流程（顺序即护栏）：
 *   1. 由注入的 ClockPort 取运行日，按 §7.3 切分为 historical / future；
 *   2. 写入前对**全部**计划文件取 SHA-256 基线；
 *   3. 仅对 future 调用 writeText（幂等替换重算标注行），historical 零写入；
 *   4. 写入后复取 historical 哈希，与基线不一致立即抛 ERR_RECALC_TIMELINE。
 *
 * 边界：本任务只写「重算标注 + 依据版本号」，不重新生成热量 / 蛋白 / 菜谱正文；
 * 计划正文重算归 T-013（五级计划）与 T-016（四餐明细），因此 AC-05 / AC-06
 * 在本任务完成后仍保持 RED（P-02，不得提前转绿）。
 */
import { RECALC_ERROR, RecalcError, recalcIssue } from '../profile/recalc-errors.js';
import { isIsoDate, splitPlanFilesByDate } from './split.js';
import { buildRecalcAnnotation, stripRecalcAnnotations } from './annotation.js';

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {import('../../io/ports.js').FsPort} fsPort
 * @param {{
 *   clock: import('../../io/ports.js').ClockPort,
 *   planFiles: unknown,
 *   change: unknown
 * }} options
 * @returns {Promise<Readonly<{
 *   run_date: string,
 *   updated: ReadonlyArray<string>,
 *   untouched: ReadonlyArray<string>,
 *   annotation: string | null
 * }>>}
 */
export async function applyRecalcToFuture(fsPort, options) {
  /** @type {import('../profile/recalc-errors.js').RecalcIssue[]} */
  const problems = [];
  const opts = isRecord(options) ? /** @type {Record<string, unknown>} */ (options) : {};
  if (!fsPort || ['hash', 'readText', 'writeText'].some((m) => typeof fsPort[m] !== 'function')) {
    problems.push(recalcIssue(RECALC_ERROR.FS, '(fsPort)', 'action.recalc.inject_fs_port'));
  }
  if (!isRecord(opts.clock) || typeof /** @type {Record<string, unknown>} */ (opts.clock).today !== 'function') {
    problems.push(recalcIssue(RECALC_ERROR.CLOCK, '(clock)', 'action.recalc.inject_clock'));
  }
  if (!isRecord(opts.change) || typeof /** @type {Record<string, unknown>} */ (opts.change).needs_recalc !== 'boolean') {
    problems.push(recalcIssue(RECALC_ERROR.CHANGE, '(change)', 'action.recalc.change_object'));
  }
  if (problems.length > 0) throw new RecalcError(problems);

  const clock = /** @type {import('../../io/ports.js').ClockPort} */ (opts.clock);
  const change = /** @type {Record<string, unknown>} */ (opts.change);
  const runDate = clock.today();
  if (!isIsoDate(runDate)) {
    throw new RecalcError([recalcIssue(RECALC_ERROR.DATE, '(run_date)', 'action.recalc.run_date')]);
  }

  const { historical, future } = splitPlanFilesByDate(opts.planFiles, runDate);
  const allPaths = [...historical, ...future].map((f) => /** @type {string} */ (f.path));

  // 无需重算：零写入，全部文件原样保留（SC-006）。
  if (change.needs_recalc !== true) {
    return Object.freeze({
      run_date: runDate,
      updated: Object.freeze([]),
      untouched: Object.freeze(allPaths),
      annotation: null,
    });
  }

  const annotation = buildRecalcAnnotation(change);

  // ① 写入前基线：覆盖全部文件，使后续任何历史改动都能被对照出来。
  /** @type {Map<string, string>} */
  const before = new Map();
  for (const path of allPaths) {
    try {
      before.set(path, await fsPort.hash(path));
    } catch {
      throw new RecalcError([recalcIssue(RECALC_ERROR.FS, '(snapshot)', 'action.recalc.snapshot')]);
    }
  }

  // ② 只写未来计划；正文原样保留，仅整行替换头部重算标注。
  for (const file of future) {
    const path = /** @type {string} */ (file.path);
    let text;
    try {
      text = await fsPort.readText(path);
    } catch {
      throw new RecalcError([recalcIssue(RECALC_ERROR.FS, '(future)', 'action.recalc.read_future')]);
    }
    const body = stripRecalcAnnotations(text);
    await fsPort.writeText(path, `${annotation}\n${body}`);
  }

  // ③ 时间线复验：已执行历史快照哈希 MUST 与写入前一致（SC-006）。
  for (const file of historical) {
    const path = /** @type {string} */ (file.path);
    let after;
    try {
      after = await fsPort.hash(path);
    } catch {
      after = '(unreadable)';
    }
    if (after !== before.get(path)) {
      throw new RecalcError([
        recalcIssue(RECALC_ERROR.TIMELINE, path, 'action.recalc.timeline.immutable'),
      ]);
    }
  }

  return Object.freeze({
    run_date: runDate,
    updated: Object.freeze(future.map((f) => /** @type {string} */ (f.path))),
    untouched: Object.freeze(historical.map((f) => /** @type {string} */ (f.path))),
    annotation,
  });
}
