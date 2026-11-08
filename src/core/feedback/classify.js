// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-017 · `classifyFeedback(issue, timeline)`：A / B / C / D1 / D2 动作推导（FR-022～027）。
 *
 * 分类由「方向 × 问题类型」映射表决定，调用方**不注入类别**，避免把分类结果
 * 当成输入造成自证。A 类额外要求 ≥2 个互不相同的 `source.*` 取证标识（双源取证）。
 *
 * 时间线护栏（P-05 / §9 不变式 3 / SC-006）：`plan_date ≤ run_date` 的已执行
 * 计划一律 `status.skipped_executed`，`applicable=false`、`writes_plan_file=false`，
 * 由 revision.js 保证零写入。C 类只交接 T-012 版本检测，不在此重算计划正文。
 *
 * 纯函数：零 IO、零系统时钟、零面向人文案。
 */
import { FEEDBACK_ERROR, FeedbackError, feedbackIssue } from './errors.js';
import {
  FEEDBACK_ACTION,
  FEEDBACK_CATEGORY,
  FEEDBACK_STATUS,
  validateIssue,
  validateTimeline,
  validateFeedbackEntry,
  validateChangelogEntry,
  isRuleVersionId,
} from './contract.js';

/** 方向 × 类型 → 动作。`down|coverage_gap` 无定义：上级不得向下级提覆盖缺口提案。 */
const ACTION_TABLE = Object.freeze({
  'up|fact_error': FEEDBACK_ACTION.A,
  'up|coverage_gap': FEEDBACK_ACTION.B,
  'up|framework_change': FEEDBACK_ACTION.B,
  'up|data_change': FEEDBACK_ACTION.C,
  'down|data_change': FEEDBACK_ACTION.C,
  'down|fact_error': FEEDBACK_ACTION.D1,
  'down|framework_change': FEEDBACK_ACTION.D2,
});

const REASON_BY_ACTION = Object.freeze({
  [FEEDBACK_ACTION.A]: Object.freeze(['feedback.reason.dual_source', 'feedback.reason.revise_error_point']),
  [FEEDBACK_ACTION.B]: Object.freeze(['feedback.reason.pending_adoption']),
  [FEEDBACK_ACTION.C]: Object.freeze(['feedback.reason.version_change']),
  [FEEDBACK_ACTION.D1]: Object.freeze(['feedback.reason.downstream_fact_conflict']),
  [FEEDBACK_ACTION.D2]: Object.freeze(['feedback.reason.framework_alignment']),
});

const STATUS_BY_ACTION = Object.freeze({
  [FEEDBACK_ACTION.A]: FEEDBACK_STATUS.REVISED_INPLACE,
  [FEEDBACK_ACTION.B]: FEEDBACK_STATUS.PENDING_ADOPTION,
  [FEEDBACK_ACTION.C]: FEEDBACK_STATUS.VERSION_RECALC,
  [FEEDBACK_ACTION.D1]: FEEDBACK_STATUS.PENDING_RECEIVE,
  [FEEDBACK_ACTION.D2]: FEEDBACK_STATUS.PENDING_ALIGNMENT,
});

const HANDLING_BY_ACTION = Object.freeze({
  [FEEDBACK_ACTION.A]: 'feedback.handling.revise_error_point',
  [FEEDBACK_ACTION.B]: 'feedback.handling.propose_adoption',
  [FEEDBACK_ACTION.C]: 'feedback.handling.version_recalc',
  [FEEDBACK_ACTION.D1]: 'feedback.handling.revise_downstream',
  [FEEDBACK_ACTION.D2]: 'feedback.handling.notice_alignment',
});

const WRITES_PLAN = Object.freeze([
  FEEDBACK_ACTION.A, FEEDBACK_ACTION.D1, FEEDBACK_ACTION.D2,
]);

/**
 * @param {unknown} issue 只描述事实（见 contract.validateIssue）
 * @param {unknown} timeline { run_date }
 */
export function classifyFeedback(issue, timeline) {
  const i = validateIssue(issue);
  const t = validateTimeline(timeline);
  const action = ACTION_TABLE[`${i.direction}|${i.kind}`];
  if (!action) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.KIND, '(issue).kind', 'action.feedback.classification_undefined'),
    ]);
  }
  // FR-023：A 类 MUST 双源取证；少于两个独立来源直接拒绝，不做「单源即时修订」。
  if (action === FEEDBACK_ACTION.A && i.evidence_ids.length < 2) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.EVIDENCE, '(issue).evidence_ids', 'action.feedback.dual_source'),
    ]);
  }

  const historical = i.plan_date <= t.run_date;
  const reasonKeys = [...REASON_BY_ACTION[action]];
  if (historical) reasonKeys.push('feedback.reason.timeline_immutable');

  return Object.freeze({
    action,
    category: action.startsWith('D') ? FEEDBACK_CATEGORY.D : /** @type {string} */ (action),
    issue_id: i.id,
    date: i.date,
    plan_date: i.plan_date,
    run_date: t.run_date,
    historical,
    applicable: !historical,
    writes_plan_file: !historical && WRITES_PLAN.includes(action),
    origin_level: i.origin_level,
    target_level: i.target_level,
    issue_key: i.issue_key,
    target_key: i.target_key,
    evidence_ids: i.evidence_ids,
    status: historical ? FEEDBACK_STATUS.SKIPPED_EXECUTED : STATUS_BY_ACTION[action],
    reason_keys: Object.freeze(reasonKeys),
    handoff_keys: Object.freeze(
      action === FEEDBACK_ACTION.C ? ['feedback.handoff.detect_version_changes'] : [],
    ),
  });
}

/** @param {Readonly<Record<string, any>>} classification @param {string} landing */
export function buildFeedbackEntry(classification, landing) {
  if (!classification || typeof classification !== 'object' || typeof classification.action !== 'string') {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.ISSUE, '(classification)', 'action.feedback.classification_object'),
    ]);
  }
  const c = /** @type {Record<string, any>} */ (classification);
  const handling = c.status === FEEDBACK_STATUS.SKIPPED_EXECUTED
    ? 'feedback.handling.skip_executed' : HANDLING_BY_ACTION[c.action];
  return validateFeedbackEntry({
    id: c.issue_id,
    date: c.date,
    category: c.category,
    origin_level: c.origin_level,
    issue_key: c.issue_key,
    handling_key: handling,
    status: c.status,
    landing,
  });
}

/** AC-10 / plan.md §7.3：A 与 D1 的修订都要在变更记录追加一条 `rule-` 版本。 */
export function buildChangelogEntry(classification, ruleVersionId) {
  if (!isRuleVersionId(ruleVersionId)) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.CHANGELOG, '(ruleVersionId)', 'action.feedback.rule_version_id'),
    ]);
  }
  if (!classification || typeof classification !== 'object' || typeof classification.action !== 'string') {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.ISSUE, '(classification)', 'action.feedback.classification_object'),
    ]);
  }
  const c = /** @type {Record<string, any>} */ (classification);
  return validateChangelogEntry({
    id: `cl.${ruleVersionId}`,
    date: c.date,
    version_key: 'rule',
    version_id: ruleVersionId,
    source_key: `feedback.action.${c.action.toLowerCase()}`,
    reason_key: 'feedback.reason.rule_version',
    feedback_id: c.issue_id,
  });
}
