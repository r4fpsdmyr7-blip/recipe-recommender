// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-017 · 输入契约：问题 / 时间线 / 修订补丁 / 台账行校验（plan.md §5.3 / §6.1）。
 *
 * A/B/C/D 类别**不由调用方注入**：issue 只描述可观测事实（问题类型、流向、
 * 层级、日期、取证来源），由 classify.js 的映射表推导动作（FR-022）。
 * 核心域零自然语句、零身体数值；所有字段都是 ASCII Canonical ID 或 ISO 日期
 * （P-11 / FR-041）。固定键集白名单：额外键一律拒绝，防注入与防复制原文。
 */
import { FEEDBACK_ERROR, FeedbackError, feedbackIssue } from './errors.js';

export const FEEDBACK_PATH = 'feedback.md';
export const CHANGELOG_PATH = 'changelog.md';

/** 五个动作与四个类别（D1 / D2 同属 D 类，FR-022 / FR-024）。 */
export const FEEDBACK_ACTION = Object.freeze({ A: 'A', B: 'B', C: 'C', D1: 'D1', D2: 'D2' });
export const FEEDBACK_CATEGORY = Object.freeze({ A: 'A', B: 'B', C: 'C', D: 'D' });

/** 状态是 Canonical ID；`待采纳 / 待接收 / 待对齐` 的中文标签归 T-031 语言包。 */
export const FEEDBACK_STATUS = Object.freeze({
  PENDING_ADOPTION: 'status.pending_adoption',
  PENDING_RECEIVE: 'status.pending_receive',
  PENDING_ALIGNMENT: 'status.pending_alignment',
  REVISED_INPLACE: 'status.revised_inplace',
  REVISED_DOWNSTREAM: 'status.revised_downstream',
  VERSION_RECALC: 'status.version_recalc',
  SKIPPED_EXECUTED: 'status.skipped_executed',
  ADOPTED: 'status.adopted',
  REJECTED: 'status.rejected',
  ALIGNED: 'status.aligned',
});

const S = FEEDBACK_STATUS;
/** plan.md §5.3：`待采纳 / 待接收 / 待对齐 → 已*`；终态不可再流转。 */
export const FEEDBACK_TRANSITIONS = Object.freeze({
  [S.PENDING_ADOPTION]: Object.freeze([S.ADOPTED, S.REJECTED]),
  [S.PENDING_RECEIVE]: Object.freeze([S.REVISED_DOWNSTREAM, S.SKIPPED_EXECUTED]),
  [S.PENDING_ALIGNMENT]: Object.freeze([S.ALIGNED, S.SKIPPED_EXECUTED]),
  [S.REVISED_INPLACE]: Object.freeze([]),
  [S.REVISED_DOWNSTREAM]: Object.freeze([]),
  [S.VERSION_RECALC]: Object.freeze([]),
  [S.SKIPPED_EXECUTED]: Object.freeze([]),
  [S.ADOPTED]: Object.freeze([]),
  [S.REJECTED]: Object.freeze([]),
  [S.ALIGNED]: Object.freeze([]),
});

/** FR-022：ID / 日期 / 类别 / 发起层 / 问题 / 处理 / 状态 / 落点。 */
export const FEEDBACK_COLUMNS = Object.freeze([
  'id', 'date', 'category', 'origin_level', 'issue_key', 'handling_key', 'status', 'landing',
]);
export const CHANGELOG_COLUMNS = Object.freeze([
  'id', 'date', 'version_key', 'version_id', 'source_key', 'reason_key', 'feedback_id',
]);
/** plan.md §5.3：`body-` / `rx-` / `loc-` / `st-` / `rule-` 五类版本。 */
export const CHANGELOG_VERSION_KEYS = Object.freeze(['body', 'rx', 'loc', 'st', 'rule']);

/** FR-027：以下字段属于护栏，任何反馈修订都不得触碰。 */
export const GUARDRAIL_FIELD_KEYS = Object.freeze([
  'guardrail.energy_floor',
  'guardrail.protein_floor',
  'guardrail.dedup_short_term',
  'guardrail.safety_taboo',
  'guardrail.fat_loss_goal',
  'guardrail.period_scope',
  'guardrail.schedule_config',
]);

export const ISSUE_KINDS = Object.freeze(['fact_error', 'coverage_gap', 'data_change', 'framework_change']);
export const ISSUE_DIRECTIONS = Object.freeze(['up', 'down']);
export const PLAN_LEVELS = Object.freeze(['day', 'week', 'month', 'season', 'year']);

const ISSUE_KEYS = Object.freeze([
  'id', 'date', 'kind', 'direction', 'origin_level', 'target_level',
  'plan_date', 'issue_key', 'target_key', 'evidence_ids',
]);
const TIMELINE_KEYS = Object.freeze(['run_date']);
const PATCH_KEYS = Object.freeze(['field_key', 'from_line', 'to_line']);

const CANONICAL_ID = /^[a-z][a-z0-9._-]{0,63}$/;
const SOURCE_ID = /^source\.[a-z0-9._-]{1,60}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RULE_VERSION = /^rule-\d{4}$/;
/** 带捕获组，供 nextRuleVersionId 复算序号（与上面的校验正则分开，避免 hit[1] 为 undefined）。 */
const RULE_VERSION_SEQ = /^rule-(\d{4})$/;
const ASCII_LINE = /^[\x20-\x7E]{1,200}$/;

/** @param {unknown} value */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** @param {unknown} value */
export function isCanonicalId(value) {
  return typeof value === 'string' && CANONICAL_ID.test(value);
}
/** @param {unknown} value */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
/** @param {unknown} value */
export function isRuleVersionId(value) {
  return typeof value === 'string' && RULE_VERSION.test(value);
}

/** @param {Array<import('./errors.js').FeedbackIssue>} problems */
export function fail(problems) {
  if (problems.length > 0) throw new FeedbackError(problems);
}

/**
 * @param {unknown} value @param {ReadonlyArray<string>} allowed
 * @param {Array<import('./errors.js').FeedbackIssue>} problems
 * @param {string} field @param {string} code @param {string} hint
 */
function keysOk(value, allowed, problems, field, code, hint) {
  if (!isRecord(value)) {
    problems.push(feedbackIssue(code, field, hint));
    return null;
  }
  const keys = Object.keys(/** @type {Record<string, unknown>} */ (value));
  if (keys.some((k) => !allowed.includes(k)) || !allowed.every((k) => keys.includes(k))) {
    problems.push(feedbackIssue(code, field, hint));
    return null;
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** 问题对象：只描述事实，不含 A/B/C/D 标签。 */
export function validateIssue(raw) {
  /** @type {Array<import('./errors.js').FeedbackIssue>} */
  const problems = [];
  const r = keysOk(raw, ISSUE_KEYS, problems, '(issue)', FEEDBACK_ERROR.ISSUE, 'action.feedback.issue_keys');
  if (!r) fail(problems);
  const v = /** @type {Record<string, unknown>} */ (r);

  for (const key of ['id', 'issue_key', 'target_key']) {
    if (!isCanonicalId(v[key])) {
      problems.push(feedbackIssue(FEEDBACK_ERROR.ISSUE, `(issue).${key}`, 'action.feedback.canonical_id'));
    }
  }
  for (const key of ['date', 'plan_date']) {
    if (!isIsoDate(v[key])) {
      problems.push(feedbackIssue(FEEDBACK_ERROR.ISSUE, `(issue).${key}`, 'action.feedback.date'));
    }
  }
  if (!ISSUE_KINDS.includes(/** @type {string} */ (v.kind))) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.KIND, '(issue).kind', 'action.feedback.kind'));
  }
  if (!ISSUE_DIRECTIONS.includes(/** @type {string} */ (v.direction))) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.KIND, '(issue).direction', 'action.feedback.direction'));
  }
  for (const key of ['origin_level', 'target_level']) {
    if (!PLAN_LEVELS.includes(/** @type {string} */ (v[key]))) {
      problems.push(feedbackIssue(FEEDBACK_ERROR.ISSUE, `(issue).${key}`, 'action.feedback.level'));
    }
  }
  const evidence = v.evidence_ids;
  if (!Array.isArray(evidence)) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.EVIDENCE, '(issue).evidence_ids', 'action.feedback.evidence_array'));
  } else if (evidence.some((e) => typeof e !== 'string' || !SOURCE_ID.test(e))
    || new Set(evidence).size !== evidence.length) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.EVIDENCE, '(issue).evidence_ids', 'action.feedback.evidence_source'));
  }
  fail(problems);
  return Object.freeze({
    id: v.id,
    date: v.date,
    kind: v.kind,
    direction: v.direction,
    origin_level: v.origin_level,
    target_level: v.target_level,
    plan_date: v.plan_date,
    issue_key: v.issue_key,
    target_key: v.target_key,
    evidence_ids: Object.freeze([.../** @type {Array<string>} */ (evidence)]),
  });
}

/** 时间线固定键集只有 run_date；历史 / 未来由 P-05 推导，不可注入放宽。 */
export function validateTimeline(raw) {
  /** @type {Array<import('./errors.js').FeedbackIssue>} */
  const problems = [];
  const r = keysOk(raw, TIMELINE_KEYS, problems, '(timeline)', FEEDBACK_ERROR.TIMELINE, 'action.feedback.timeline_keys');
  if (!r) fail(problems);
  if (!isIsoDate(r.run_date)) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.TIMELINE, '(timeline).run_date', 'action.feedback.date'));
  }
  fail(problems);
  return Object.freeze({ run_date: /** @type {string} */ (r.run_date) });
}

/**
 * 修订补丁：只允许**单行、精确命中一次**的替换（FR-023「只改错误点」/
 * FR-025「不整篇重写、不生成新菜单」），且字段不得属于 FR-027 七类护栏。
 */
export function validatePatch(raw) {
  /** @type {Array<import('./errors.js').FeedbackIssue>} */
  const problems = [];
  const r = keysOk(raw, PATCH_KEYS, problems, '(patch)', FEEDBACK_ERROR.PATCH, 'action.feedback.patch_keys');
  if (!r) fail(problems);
  if (!isCanonicalId(r.field_key)) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.PATCH, '(patch).field_key', 'action.feedback.canonical_id'));
  }
  if (GUARDRAIL_FIELD_KEYS.includes(/** @type {string} */ (r.field_key))) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.GUARDRAIL, '(patch).field_key', 'action.feedback.guardrail_immutable'));
  }
  for (const key of ['from_line', 'to_line']) {
    const line = r[key];
    if (typeof line !== 'string' || !ASCII_LINE.test(line)
      || !String(line).includes(String(r.field_key))) {
      problems.push(feedbackIssue(FEEDBACK_ERROR.PATCH, `(patch).${key}`, 'action.feedback.patch_line'));
    }
  }
  if (r.from_line === r.to_line) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.PATCH, '(patch).to_line', 'action.feedback.patch_noop'));
  }
  fail(problems);
  return Object.freeze({ field_key: r.field_key, from_line: r.from_line, to_line: r.to_line });
}

/** @param {unknown} raw */
export function validateFeedbackEntry(raw) {
  /** @type {Array<import('./errors.js').FeedbackIssue>} */
  const problems = [];
  const r = keysOk(raw, FEEDBACK_COLUMNS, problems, '(feedback).entry', FEEDBACK_ERROR.LEDGER, 'action.feedback.entry_keys');
  if (!r) fail(problems);
  for (const key of ['id', 'issue_key', 'handling_key', 'landing']) {
    if (!isCanonicalId(r[key])) {
      problems.push(feedbackIssue(FEEDBACK_ERROR.LEDGER, `(feedback).${key}`, 'action.feedback.canonical_id'));
    }
  }
  if (!isIsoDate(r.date)) problems.push(feedbackIssue(FEEDBACK_ERROR.LEDGER, '(feedback).date', 'action.feedback.date'));
  if (!Object.values(FEEDBACK_CATEGORY).includes(/** @type {string} */ (r.category))) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.LEDGER, '(feedback).category', 'action.feedback.category'));
  }
  if (!PLAN_LEVELS.includes(/** @type {string} */ (r.origin_level))) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.LEDGER, '(feedback).origin_level', 'action.feedback.level'));
  }
  if (!Object.values(S).includes(/** @type {string} */ (r.status))) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.STATUS, '(feedback).status', 'action.feedback.status'));
  }
  fail(problems);
  return Object.freeze(Object.fromEntries(FEEDBACK_COLUMNS.map((k) => [k, r[k]])));
}

/** @param {unknown} raw */
export function validateChangelogEntry(raw) {
  /** @type {Array<import('./errors.js').FeedbackIssue>} */
  const problems = [];
  const r = keysOk(raw, CHANGELOG_COLUMNS, problems, '(changelog).entry', FEEDBACK_ERROR.CHANGELOG, 'action.feedback.entry_keys');
  if (!r) fail(problems);
  for (const key of ['id', 'version_id', 'source_key', 'reason_key', 'feedback_id']) {
    if (!isCanonicalId(r[key])) {
      problems.push(feedbackIssue(FEEDBACK_ERROR.CHANGELOG, `(changelog).${key}`, 'action.feedback.canonical_id'));
    }
  }
  if (!isIsoDate(r.date)) problems.push(feedbackIssue(FEEDBACK_ERROR.CHANGELOG, '(changelog).date', 'action.feedback.date'));
  if (!CHANGELOG_VERSION_KEYS.includes(/** @type {string} */ (r.version_key))) {
    problems.push(feedbackIssue(FEEDBACK_ERROR.CHANGELOG, '(changelog).version_key', 'action.feedback.version_key'));
  }
  fail(problems);
  return Object.freeze(Object.fromEntries(CHANGELOG_COLUMNS.map((k) => [k, r[k]])));
}

/** 规则版本序号由已有变更记录复算，不由日期或调用方猜测（E-08 / FR-023）。 */
export function nextRuleVersionId(entries) {
  if (!Array.isArray(entries)) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.CHANGELOG, '(changelog).entries', 'action.feedback.changelog_array'),
    ]);
  }
  let max = 0;
  for (const e of entries) {
    if (!isRecord(e) || e.version_key !== 'rule' || typeof e.version_id !== 'string') continue;
    const hit = RULE_VERSION_SEQ.exec(e.version_id);
    if (hit) max = Math.max(max, Number(hit[1]));
  }
  return `rule-${String(max + 1).padStart(4, '0')}`;
}

/** 状态流转返回**新行**（台账只追加，绝不就地改写历史行，§9 不变式 5）。 */
export function transitionFeedbackStatus(entry, nextStatus) {
  const row = validateFeedbackEntry(entry);
  const allowed = FEEDBACK_TRANSITIONS[/** @type {string} */ (row.status)] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.STATUS, '(feedback).status', 'action.feedback.transition'),
    ]);
  }
  return Object.freeze({ ...row, status: nextStatus });
}

/** 事件溯源口径：同一 ID 的最后一行即当前状态。 */
export function latestStatusById(rows, id) {
  if (!Array.isArray(rows) || typeof id !== 'string') {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.LEDGER, '(feedback).rows', 'action.feedback.ledger_array'),
    ]);
  }
  let current = null;
  for (const row of rows) {
    if (isRecord(row) && row.id === id) current = /** @type {string} */ (row.status);
  }
  return current;
}
