// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-017 · 计划头部「修订标注 / 上级下发修订标注」（FR-023 / FR-024、P-11）。
 *
 * 与 T-012 重算标注同口径：HTML 注释形式的 **单行纯 ASCII** 稳定键，便于 Git
 * 逐行 diff；内部只有 Canonical ID 与版本号，不写「已即时修订」等面向人文案
 * —— 后者由 T-018 渲染器 / T-031 语言包按 *_keys 生成（P-11 / E-12）。
 *
 * 幂等：重复修订时旧标注行被整行剥离后替换，不叠加多行。
 * 只剥离**文件最开头**符合本模块格式的注释行，正文中任意用户批注（E-07）
 * 一律不扫描、不删除。
 */
import { FEEDBACK_ERROR, FeedbackError, feedbackIssue } from './errors.js';

export const FEEDBACK_PREFIX = '<!-- rr-feedback ';
export const FEEDBACK_ANNOTATION_VERSION = 'v=1';

const ASCII_PRINTABLE = /^[\x20-\x7E]+$/;
const SAFE_VALUE = /^[A-Za-z0-9._:-]{1,64}$/;
const LEADING_ANNOTATION = /^<!-- rr-feedback [\x20-\x7E]*?-->[ \t]*(?:\r?\n|$)/;

/** @param {unknown} classification @param {string} ruleVersionId */
export function buildRevisionAnnotation(classification, ruleVersionId = 'none') {
  if (!classification || typeof classification !== 'object') {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.ANNOTATION, '(classification)', 'action.feedback.classification_object'),
    ]);
  }
  const c = /** @type {Record<string, unknown>} */ (classification);
  const values = [c.issue_id, c.action, c.status, c.target_key, ruleVersionId];
  if (values.some((v) => typeof v !== 'string' || !SAFE_VALUE.test(/** @type {string} */ (v)))) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.ANNOTATION, '(annotation).values', 'action.feedback.annotation_values'),
    ]);
  }
  const line = [
    FEEDBACK_PREFIX,
    [
      FEEDBACK_ANNOTATION_VERSION,
      `id=${c.issue_id}`,
      `action=${c.action}`,
      `status=${c.status}`,
      `target=${c.target_key}`,
      `rule=${ruleVersionId}`,
    ].join(' '),
    ' -->',
  ].join('');
  // 双保险：绝不写出多行 / 非 ASCII 标注。
  if (!ASCII_PRINTABLE.test(line) || /[\r\n]/.test(line)) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.ANNOTATION, '(annotation)', 'action.feedback.annotation_line'),
    ]);
  }
  return line;
}

/** @param {string} text */
export function stripRevisionAnnotations(text) {
  let out = typeof text === 'string' ? text : '';
  for (let guard = 0; guard < 64 && LEADING_ANNOTATION.test(out); guard += 1) {
    out = out.replace(LEADING_ANNOTATION, '');
  }
  return out;
}
