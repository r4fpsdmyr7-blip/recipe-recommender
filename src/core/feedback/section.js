// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-017 · 每份周 / 日计划 MUST 含「上级反馈检查」章节（FR-026）。
 *
 * 输出是**未渲染的结构化对象 + 确定性纯 ASCII 结构索引**：四类 A/B/C/D 恒齐全，
 * 各带检查结果数与所登记 ID；标题文案、免责声明、语言包归 T-018 / T-031。
 * 零反馈时四类仍齐全且计数为 0，绝不虚构记录（E-05）。
 */
import { FEEDBACK_ERROR, FeedbackError, feedbackIssue } from './errors.js';
import { FEEDBACK_CATEGORY, isCanonicalId, isRecord } from './contract.js';

const SECTION_NOTICE_KEYS = Object.freeze([
  'plan.notice.disclaimer',
  'plan.marker.aigc',
  'feedback.notice.check_completed',
]);

/** @param {unknown} classifications */
export function buildFeedbackCheckSection(classifications) {
  if (!Array.isArray(classifications)) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.ISSUE, '(classifications)', 'action.feedback.classification_array'),
    ]);
  }
  /** @type {Record<string, {checked: number, ids: string[]}>} */
  const groups = {};
  for (const category of Object.values(FEEDBACK_CATEGORY)) groups[category] = { checked: 0, ids: [] };
  for (const [index, raw] of classifications.entries()) {
    if (!isRecord(raw) || typeof raw.category !== 'string' || !isCanonicalId(raw.issue_id)) {
      throw new FeedbackError([
        feedbackIssue(FEEDBACK_ERROR.ISSUE, `(classifications)[${index}]`, 'action.feedback.classification_object'),
      ]);
    }
    const c = /** @type {Record<string, any>} */ (raw);
    const bucket = groups[c.category];
    if (!bucket) {
      throw new FeedbackError([
        feedbackIssue(FEEDBACK_ERROR.ISSUE, `(classifications)[${index}].category`, 'action.feedback.category'),
      ]);
    }
    bucket.checked += 1;
    bucket.ids.push(c.issue_id);
  }
  return Object.freeze({
    checks: Object.freeze(Object.fromEntries(Object.entries(groups).map(([k, v]) => [
      k, Object.freeze({ checked: v.checked, ids: Object.freeze(v.ids) }),
    ]))),
    notice_keys: SECTION_NOTICE_KEYS,
  });
}

/** @param {unknown} section */
export function renderFeedbackCheckIndex(section) {
  if (!isRecord(section) || !isRecord(section.checks)) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.ISSUE, '(section)', 'action.feedback.section_object'),
    ]);
  }
  const checks = /** @type {Record<string, any>} */ (section.checks);
  const lines = ['# feedback-check'];
  for (const category of Object.values(FEEDBACK_CATEGORY)) {
    const bucket = checks[category];
    if (!bucket || !Array.isArray(bucket.ids)) {
      throw new FeedbackError([
        feedbackIssue(FEEDBACK_ERROR.ISSUE, `(section).${category}`, 'action.feedback.section_category'),
      ]);
    }
    lines.push(`${category}_count=${bucket.checked} ${category}_ids=${bucket.ids.join(',')}`);
  }
  lines.push(`notice_keys=${(/** @type {Record<string, any>} */ (section).notice_keys ?? []).join(',')}`);
  return `${lines.join('\n')}\n`;
}
