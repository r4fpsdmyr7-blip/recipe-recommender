// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-017 · 上行（A）与下行（D1 / D2）修订落盘，以及 P-05 时间线复验。
 *
 * 顺序即护栏：
 *   ① ClockPort 注入运行日 → 复用 T-012 `splitPlanFilesByDate` 切分历史 / 未来；
 *   ② 写入前对**全部**计划文件取哈希基线；
 *   ③ 只写未来文件；A / D1 只做「精确命中一次的单行替换」+ 头部标注，
 *      D2 只加提示标注、零正文改动；historical 零写入；
 *   ④ 写入后复验所有未写入文件的哈希，变化即 ERR_FEEDBACK_TIMELINE（SC-006）。
 *
 * FR-025：补丁的 `from_line` 必须已存在且恰好命中一次——上级既不能整篇重写
 * 下级计划，也不能替下级生成尚不存在的具体菜单；正文其余字节（含 E-07 用户
 * 批注、实际执行记录、已完成采购清单）逐字保留。
 *
 * 本文件是唯一触碰 FsPort 的修订入口；分类与标注生成都是纯函数。
 */
import { FEEDBACK_ERROR, FeedbackError, feedbackIssue } from './errors.js';
import { splitPlanFilesByDate, isIsoDate } from '../planner/split.js';
import { isRuleVersionId, validatePatch, isRecord } from './contract.js';
import { FEEDBACK_ACTION, FEEDBACK_STATUS } from './contract.js';
import { buildRevisionAnnotation, stripRevisionAnnotations } from './annotation.js';

/** @param {unknown} fsPort @param {unknown} options */
function preflight(fsPort, options) {
  /** @type {Array<import('./errors.js').FeedbackIssue>} */
  const problems = [];
  if (!fsPort || ['hash', 'readText', 'writeText'].some((m) => typeof /** @type {any} */ (fsPort)[m] !== 'function')) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.FS, '(fsPort)', 'action.feedback.inject_fs_port'));
  }
  const o = isRecord(options) ? /** @type {Record<string, any>} */ (options) : {};
  if (!o.clock || typeof o.clock.today !== 'function') {
    problems.push(feedbackIssue(FEEDBACK_ERROR.FS, '(clock)', 'action.feedback.inject_clock'));
  }
  if (!isRecord(o.classification) || typeof o.classification.action !== 'string') {
    problems.push(feedbackIssue(FEEDBACK_ERROR.ISSUE, '(classification)', 'action.feedback.classification_object'));
  }
  if (!isRuleVersionId(o.ruleVersionId)) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.CHANGELOG, '(ruleVersionId)', 'action.feedback.rule_version_id'));
  }
  if (problems.length > 0) throw new FeedbackError(problems);
  const runDate = o.clock.today();
  if (!isIsoDate(runDate)) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.TIMELINE, '(run_date)', 'action.feedback.date'),
    ]);
  }
  return { o, runDate };
}

/** 精确命中一次的单行替换：0 次 / 多次都拒绝（FR-023 / FR-025）。 */
function replaceExactLine(body, patch) {
  const lines = body.split('\n');
  const hits = lines.filter((line) => line === patch.from_line).length;
  if (hits !== 1) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.PATCH, '(patch).from_line', 'action.feedback.patch_single_hit'),
    ]);
  }
  return lines.map((line) => (line === patch.from_line ? patch.to_line : line)).join('\n');
}

/** @param {unknown} fsPort @param {ReadonlyArray<{path: string}>} files */
async function baselineOf(fsPort, files) {
  /** @type {Map<string, string>} */
  const before = new Map();
  for (const file of files) {
    try {
      before.set(file.path, await /** @type {any} */ (fsPort).hash(file.path));
    } catch {
      throw new FeedbackError([
        feedbackIssue(FEEDBACK_ERROR.FS, '(snapshot)', 'action.feedback.snapshot'),
      ]);
    }
  }
  return before;
}

/** @param {unknown} fsPort @param {Map<string, string>} before @param {ReadonlyArray<string>} paths */
async function verifyUntouched(fsPort, before, paths) {
  for (const path of paths) {
    let after;
    try {
      after = await /** @type {any} */ (fsPort).hash(path);
    } catch {
      after = '(unreadable)';
    }
    if (after !== before.get(path)) {
      throw new FeedbackError([
        feedbackIssue(FEEDBACK_ERROR.TIMELINE, path, 'action.feedback.timeline_immutable'),
      ]);
    }
  }
}

/**
 * A 类：双源取证后**只改上级文件的那个错误点**，并在头部加修订标注。
 * @param {unknown} fsPort
 * @param {{clock: unknown, classification: unknown, target: string, patch: unknown,
 *          planFiles: unknown, ruleVersionId: string}} options
 */
export async function applyUpstreamRevision(fsPort, options) {
  const { o, runDate } = preflight(fsPort, options);
  const c = /** @type {Record<string, any>} */ (o.classification);
  if (c.action !== FEEDBACK_ACTION.A || c.applicable !== true || c.writes_plan_file !== true) {
    throw new FeedbackError([
      feedbackIssue(c.historical === true ? FEEDBACK_ERROR.TIMELINE : FEEDBACK_ERROR.ISSUE,
        '(classification)', 'action.feedback.revision_not_applicable'),
    ]);
  }
  const split = splitPlanFilesByDate(o.planFiles, runDate);
  const futurePaths = split.future.map((f) => /** @type {string} */ (f.path));
  const historicalPaths = split.historical.map((f) => /** @type {string} */ (f.path));
  if (typeof o.target !== 'string' || !futurePaths.includes(o.target)) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.TIMELINE, '(target)', 'action.feedback.target_historical'),
    ]);
  }
  const patch = validatePatch(o.patch);
  const annotation = buildRevisionAnnotation(c, o.ruleVersionId);
  const all = [...split.historical, ...split.future];
  const before = await baselineOf(fsPort, /** @type {any} */ (all));

  let text;
  try {
    text = await /** @type {any} */ (fsPort).readText(o.target);
  } catch {
    throw new FeedbackError([feedbackIssue(FEEDBACK_ERROR.FS, '(target)', 'action.feedback.read_target')]);
  }
  const body = stripRevisionAnnotations(text);
  const changed = replaceExactLine(body, patch);
  await /** @type {any} */ (fsPort).writeText(o.target, `${annotation}\n${changed}`);
  await verifyUntouched(fsPort, before, historicalPaths);

  return Object.freeze({
    run_date: runDate,
    path: o.target,
    updated: Object.freeze([o.target]),
    untouched: Object.freeze(historicalPaths),
    changed_lines: 1,
    annotation,
    rule_version_id: o.ruleVersionId,
  });
}

/**
 * D 类下发：先切分时间线，已执行计划一律零写入；
 * D1 只改未来文件中确有冲突的那一行，D2 只在未来计划头部加提示。
 * @param {unknown} fsPort
 * @param {{clock: unknown, classification: unknown, planFiles: unknown,
 *          patches?: Record<string, unknown>, ruleVersionId: string}} options
 */
export async function applyDownstreamRevision(fsPort, options) {
  const { o, runDate } = preflight(fsPort, options);
  const c = /** @type {Record<string, any>} */ (o.classification);
  if (![FEEDBACK_ACTION.D1, FEEDBACK_ACTION.D2].includes(c.action)
    || c.applicable !== true || c.writes_plan_file !== true) {
    throw new FeedbackError([
      feedbackIssue(c.historical === true ? FEEDBACK_ERROR.TIMELINE : FEEDBACK_ERROR.ISSUE,
        '(classification)', 'action.feedback.revision_not_applicable'),
    ]);
  }
  const split = splitPlanFilesByDate(o.planFiles, runDate);
  const future = split.future.map((f) => /** @type {string} */ (f.path));
  const historical = split.historical.map((f) => /** @type {string} */ (f.path));
  const rawPatches = isRecord(o.patches) ? /** @type {Record<string, unknown>} */ (o.patches) : {};
  if (c.action === FEEDBACK_ACTION.D2 && Object.keys(rawPatches).length > 0) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.ISSUE, '(patches)', 'action.feedback.d2_notice_only'),
    ]);
  }
  for (const key of Object.keys(rawPatches)) {
    if (historical.includes(key)) {
      throw new FeedbackError([
        feedbackIssue(FEEDBACK_ERROR.TIMELINE, key, 'action.feedback.patch_historical'),
      ]);
    }
    if (!future.includes(key)) {
      throw new FeedbackError([
        feedbackIssue(FEEDBACK_ERROR.PATCH, key, 'action.feedback.patch_unknown_path'),
      ]);
    }
    validatePatch(rawPatches[key]);
  }
  const annotation = buildRevisionAnnotation(c, o.ruleVersionId);
  const all = [...split.historical, ...split.future];
  const before = await baselineOf(fsPort, /** @type {any} */ (all));

  /** @type {string[]} */
  const updated = [];
  let changedLines = 0;
  for (const path of future) {
    const patch = rawPatches[path];
    // D1 只处理确有冲突点的文件；D2 对所有未来文件加提示。
    if (c.action === FEEDBACK_ACTION.D1 && patch === undefined) continue;
    let text;
    try {
      text = await /** @type {any} */ (fsPort).readText(path);
    } catch {
      throw new FeedbackError([feedbackIssue(FEEDBACK_ERROR.FS, path, 'action.feedback.read_future')]);
    }
    const body = stripRevisionAnnotations(text);
    let next = body;
    if (c.action === FEEDBACK_ACTION.D1) {
      next = replaceExactLine(body, validatePatch(patch));
      changedLines += 1;
    }
    await /** @type {any} */ (fsPort).writeText(path, `${annotation}\n${next}`);
    updated.push(path);
  }
  await verifyUntouched(fsPort, before, all.map((f) => /** @type {string} */ (f.path)).filter((p) => !updated.includes(p)));

  return Object.freeze({
    run_date: runDate,
    updated: Object.freeze(updated),
    /** 已执行日期一律「已跳过(已执行)」，不回改历史（plan.md §7.2 / AC-11）。 */
    skipped: Object.freeze(historical),
    skipped_status: FEEDBACK_STATUS.SKIPPED_EXECUTED,
    changed_lines: changedLines,
    annotation,
    rule_version_id: o.ruleVersionId,
  });
}
