// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-017 · `feedback.md` / `changelog.md` 的 ASCII Markdown 台账（FR-022 / FR-023）。
 *
 * 反馈台账 8 列（ID / 日期 / 类别 / 发起层 / 问题 / 处理 / 状态 / 落点）；
 * 变更记录 7 列（ID / 日期 / 版本键 / 版本 ID / 来源 / 原因 / 关联反馈 ID）。
 * 两本台账都**只追加**：写后复验「历史字节前缀不变 + 新增部分恰好等于该行」，
 * 覆盖写伪装成 append 立即抛 ERR_FEEDBACK_APPEND（§9 不变式 5）。
 *
 * 状态流转以「追加新行」表达（事件溯源），绝不就地改写历史行；
 * E-05 首次运行只写表头、零虚构历史记录。工作区文件不入库（P-14）。
 */
import { FEEDBACK_ERROR, FeedbackError, feedbackIssue } from './errors.js';
import {
  FEEDBACK_PATH,
  CHANGELOG_PATH,
  FEEDBACK_COLUMNS,
  CHANGELOG_COLUMNS,
  validateFeedbackEntry,
  validateChangelogEntry,
} from './contract.js';
import { buildFeedbackEntry, buildChangelogEntry } from './classify.js';

const F_HEADER = `| ${FEEDBACK_COLUMNS.join(' | ')} |`;
const F_SEPARATOR = `|${FEEDBACK_COLUMNS.map(() => '---').join('|')}|`;
const C_HEADER = `| ${CHANGELOG_COLUMNS.join(' | ')} |`;
const C_SEPARATOR = `|${CHANGELOG_COLUMNS.map(() => '---').join('|')}|`;

export function renderFeedbackHeader() {
  return ['# feedback-ledger', F_HEADER, F_SEPARATOR, ''].join('\n');
}
export function renderChangelogHeader() {
  return ['# changelog', C_HEADER, C_SEPARATOR, ''].join('\n');
}

/** @param {unknown} entry */
export function renderFeedbackLine(entry) {
  const row = validateFeedbackEntry(entry);
  return `| ${FEEDBACK_COLUMNS.map((k) => row[k]).join(' | ')} |`;
}
/** @param {unknown} entry */
export function renderChangelogLine(entry) {
  const row = validateChangelogEntry(entry);
  return `| ${CHANGELOG_COLUMNS.map((k) => row[k]).join(' | ')} |`;
}

/**
 * 通用表格解析：跳过标题 / 表头 / 分隔行，其余每行按固定列数解析，
 * 损坏行、非法 Canonical ID、未知状态一律拒绝，不静默跳过（FR-041）。
 * @param {string} text @param {ReadonlyArray<string>} columns
 * @param {string} header @param {string} separator @param {(cells: string[]) => any} make
 * @param {string} code @param {string} field
 */
function parseTable(text, columns, header, separator, make, code, field) {
  if (typeof text !== 'string') {
    throw new FeedbackError([feedbackIssue(code, `${field}.text`, 'action.feedback.ledger_text')]);
  }
  /** @type {Array<import('./errors.js').FeedbackIssue>} */
  const problems = [];
  /** @type {Array<any>} */
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (trimmed === header || trimmed === separator) continue;
    if (/^\|[\s|-]+\|$/.test(trimmed)) continue;
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      problems.push(feedbackIssue(code, `${field}.line`, 'action.feedback.ledger_line'));
      continue;
    }
    const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== columns.length) {
      problems.push(feedbackIssue(code, `${field}.line`, 'action.feedback.ledger_columns'));
      continue;
    }
    try {
      rows.push(make(cells));
    } catch {
      problems.push(feedbackIssue(code, `${field}.row`, 'action.feedback.ledger_row'));
    }
  }
  if (problems.length > 0) throw new FeedbackError(problems);
  return Object.freeze(rows);
}

/** @param {string} text */
export function parseFeedbackText(text) {
  return parseTable(text, FEEDBACK_COLUMNS, F_HEADER, F_SEPARATOR,
    (cells) => validateFeedbackEntry(Object.fromEntries(FEEDBACK_COLUMNS.map((k, i) => [k, cells[i]]))),
    FEEDBACK_ERROR.LEDGER, '(feedback)');
}
/** @param {string} text */
export function parseChangelogText(text) {
  return parseTable(text, CHANGELOG_COLUMNS, C_HEADER, C_SEPARATOR,
    (cells) => validateChangelogEntry(Object.fromEntries(CHANGELOG_COLUMNS.map((k, i) => [k, cells[i]]))),
    FEEDBACK_ERROR.CHANGELOG, '(changelog)');
}

/** @param {unknown} fsPort */
function validateFsPort(fsPort) {
  const methods = ['readText', 'writeText', 'appendText', 'exists'];
  if (!fsPort || methods.some((m) => typeof /** @type {any} */ (fsPort)[m] !== 'function')) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.FS, '(fsPort)', 'action.feedback.inject_fs_port'),
    ]);
  }
}

/**
 * 只追加一行到指定台账。
 * @param {unknown} fsPort @param {string} path @param {string} header
 * @param {(e: unknown) => string} renderLine @param {(t: string) => ReadonlyArray<any>} parse
 * @param {unknown} entry @param {string} code
 */
async function appendRow(fsPort, path, header, renderLine, parse, entry, code) {
  validateFsPort(fsPort);
  if (typeof path !== 'string' || path.length === 0) {
    throw new FeedbackError([feedbackIssue(FEEDBACK_ERROR.FS, '(path)', 'action.feedback.ledger_path')]);
  }
  const existing = await /** @type {any} */ (fsPort).exists(path);
  if (!existing || (await /** @type {any} */ (fsPort).readText(path)) === '') {
    await /** @type {any} */ (fsPort).writeText(path, header);
  }
  const before = await /** @type {any} */ (fsPort).readText(path);
  const line = `${renderLine(entry)}\n`;
  await /** @type {any} */ (fsPort).appendText(path, line);
  const after = await /** @type {any} */ (fsPort).readText(path);
  if (!after.startsWith(before) || after.slice(before.length) !== line) {
    throw new FeedbackError([
      feedbackIssue(FEEDBACK_ERROR.APPEND, path, 'action.feedback.ledger_append_only'),
    ]);
  }
  return Object.freeze({
    path,
    line,
    historical_unchanged: true,
    entries_before: parse(before).length,
    entries_after: parse(after).length,
    code,
  });
}

/** @param {unknown} fsPort @param {string} path @param {unknown} entry */
export function appendFeedbackEntry(fsPort, path, entry) {
  return appendRow(fsPort, path, renderFeedbackHeader(), renderFeedbackLine, parseFeedbackText,
    entry, FEEDBACK_ERROR.LEDGER);
}

/** @param {unknown} fsPort @param {string} path @param {unknown} entry */
export function appendChangelogEntry(fsPort, path, entry) {
  return appendRow(fsPort, path, renderChangelogHeader(), renderChangelogLine, parseChangelogText,
    entry, FEEDBACK_ERROR.CHANGELOG);
}

/**
 * 一次性登记反馈行 + `rule-` 版本行（A / D1 修订，AC-10 / plan.md §7.3）。
 * B / C / D2 不产生规则版本，只登记反馈行。
 * @param {unknown} fsPort
 * @param {{
 *   classification: unknown, landing: string, ruleVersionId: string,
 *   feedbackPath?: string, changelogPath?: string
 * }} options
 */
export async function appendFeedbackRecord(fsPort, options) {
  const o = options && typeof options === 'object' ? /** @type {Record<string, any>} */ (options) : {};
  const feedbackPath = o.feedbackPath ?? FEEDBACK_PATH;
  const changelogPath = o.changelogPath ?? CHANGELOG_PATH;
  const c = /** @type {Record<string, any>} */ (o.classification ?? {});
  const feedbackLine = await appendFeedbackEntry(fsPort, feedbackPath,
    buildFeedbackEntry(/** @type {any} */ (c), o.landing));
  let changelogLine = null;
  if (c.action === 'A' || c.action === 'D1') {
    changelogLine = await appendChangelogEntry(fsPort, changelogPath,
      buildChangelogEntry(/** @type {any} */ (c), o.ruleVersionId));
  }
  return Object.freeze({
    feedback_line: feedbackLine,
    changelog_line: changelogLine,
    rule_version_id: changelogLine ? o.ruleVersionId : null,
  });
}
