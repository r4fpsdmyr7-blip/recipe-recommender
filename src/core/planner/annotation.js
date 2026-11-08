// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-012 · 计划头部重算标注（FR-004 / FR-005、FR-009、P-11、NFR-007）。
 *
 * 标注是 HTML 注释形式的 **单行纯 ASCII** 稳定键，便于 Git 逐行 diff；
 * 内部只有 Canonical ID 与版本号，不出现「已按新体测重算」等面向人的中文
 * —— 后者由 T-018 渲染器 / T-031 语言包按 reason_keys 生成（P-11 / E-12）。
 *
 * 幂等：重复重算时旧标注行被整行替换，不叠加多行。
 */
import { RECALC_ERROR, RecalcError, recalcIssue } from '../profile/recalc-errors.js';
import { RECALC_REASON } from '../profile/detect-version-changes.js';

export const RECALC_PREFIX = '<!-- rr-recalc ';
export const RECALC_ANNOTATION_VERSION = 'v=1';

const ASCII_PRINTABLE = /^[\x20-\x7E]+$/;
const SAFE_VALUE = /^[A-Za-z0-9._:-]{1,64}$/;
const REASON_KEYS = Object.freeze(Object.values(RECALC_REASON));
const LEADING_ANNOTATION = /^<!-- rr-recalc [\x20-\x7E]*?-->[ \t]*(?:\r?\n|$)/;

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 生成一行重算标注。change MUST 由 detectVersionChanges() 产出。
 * @param {unknown} change
 * @returns {string} 不含换行的单行注释
 * @throws {RecalcError} change 结构不合法或含非 ASCII / 危险字符
 */
export function buildRecalcAnnotation(change) {
  /** @type {import('../profile/recalc-errors.js').RecalcIssue[]} */
  const problems = [];
  if (!isRecord(change)
    || /** @type {Record<string, unknown>} */ (change).needs_recalc !== true
    || !Array.isArray(/** @type {Record<string, unknown>} */ (change).changed)
    || /** @type {Array<unknown>} */ (/** @type {Record<string, unknown>} */ (change).changed).length === 0
    || !Array.isArray(/** @type {Record<string, unknown>} */ (change).reason_keys)
    || !isRecord(/** @type {Record<string, unknown>} */ (change).version_ids)) {
    throw new RecalcError([
      recalcIssue(RECALC_ERROR.CHANGE, '(change)', 'action.recalc.change_object'),
    ]);
  }

  const record = /** @type {Record<string, unknown>} */ (change);
  const changed = /** @type {unknown[]} */ (record.changed);
  const reasons = /** @type {unknown[]} */ (record.reason_keys);
  const versionIds = Object.entries(/** @type {Record<string, unknown>} */ (record.version_ids));
  const source = record.source;

  const values = [changed, reasons, versionIds.flat(), [source]].flat();
  if (values.some((v) => typeof v !== 'string' || !SAFE_VALUE.test(/** @type {string} */ (v)))
    || reasons.some((r) => !REASON_KEYS.includes(/** @type {string} */ (r)))
    || reasons.length === 0
    || versionIds.length !== changed.length) {
    problems.push(recalcIssue(RECALC_ERROR.CHANGE, '(change)', 'action.recalc.change_values'));
  }
  if (source !== 'E-04') {
    problems.push(recalcIssue(RECALC_ERROR.CHANGE, '(change).source', 'action.recalc.change_source'));
  }
  if (problems.length > 0) throw new RecalcError(problems);

  const pairs = versionIds.map(([key, id]) => `${key}:${id}`).join(',');
  const line = [
    RECALC_PREFIX,
    [
      RECALC_ANNOTATION_VERSION,
      `source=${source}`,
      `reasons=${reasons.join(',')}`,
      `changed=${changed.join(',')}`,
      `versions=${pairs}`,
    ].join(' '),
    ' -->',
  ].join('');

  // 双保险：即便上游放行了非常规值，也绝不写出多行 / 非 ASCII 标注。
  if (!ASCII_PRINTABLE.test(line) || /[\r\n]/.test(line)) {
    throw new RecalcError([
      recalcIssue(RECALC_ERROR.CHANGE, '(annotation)', 'action.recalc.annotation_line'),
    ]);
  }
  return line;
}

/**
 * 去掉正文开头已有的重算标注行（可能有多行历史遗留），保留其余正文逐字节不变。
 * 只剥离位于文件最开头、符合本模块格式的注释行，不扫描正文，避免误删用户批注（E-07）。
 * @param {string} text
 * @returns {string}
 */
export function stripRecalcAnnotations(text) {
  let out = text;
  for (let guard = 0; guard < 64 && LEADING_ANNOTATION.test(out); guard += 1) {
    out = out.replace(LEADING_ANNOTATION, '');
  }
  return out;
}
