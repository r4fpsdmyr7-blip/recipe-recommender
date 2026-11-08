// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-015 · 去重台账 `history.md`：结构化 Markdown 表格、解析与**只追加**写入。
 *
 * plan.md §5.3 规定台账登记日期 / 层级 / 周期标识 / 主菜与主食 Canonical ID /
 * 所用版本，且只追加；§9 不变式 5 要求历史行不删除、不回改。本文件是唯一
 * 触碰 FsPort 的位置：`applyDedup()` 保持纯函数，台账 IO 由调用方显式触发。
 *
 * E-05：首次运行无台账时只写表头（零历史行），绝不虚构历史记录。
 * 台账内容全部为 ASCII Canonical ID，工作区文件不入库（P-14）。
 */
import { DEDUP_ERROR, DedupError, dedupIssue } from './errors.js';
import {
  LEDGER_COLUMNS,
  formatVersionIds,
  parseVersionIds,
  validateLedgerEntry,
} from './contract.js';

const HEADER_LINE = `| ${LEDGER_COLUMNS.join(' | ')} |`;
const SEPARATOR = `|${LEDGER_COLUMNS.map(() => '---').join('|')}|`;

export function renderLedgerHeader() {
  return [
    '# dedup-ledger',
    HEADER_LINE,
    SEPARATOR,
    '',
  ].join('\n');
}

/** @param {unknown} entry */
export function renderLedgerLine(entry) {
  const row = validateLedgerEntry(entry);
  const cells = [
    row.date,
    row.level,
    row.period_id,
    row.main_id,
    row.staple_id,
    row.combo_fp,
    formatVersionIds(/** @type {Record<string, string>} */ (row.version_ids)),
    row.cycle_key ?? '-',
    row.source,
  ];
  return `| ${cells.join(' | ')} |`;
}

/** 解析台账文本；损坏行 / 篡改指纹 / 版本缺键一律拒绝，不静默跳过（FR-018）。 */
export function parseLedgerText(text) {
  if (typeof text !== 'string') {
    throw new DedupError([
      dedupIssue(DEDUP_ERROR.LEDGER, '(ledger).text', 'action.dedup.ledger_text'),
    ]);
  }
  /** @type {Array<import('./errors.js').DedupIssue>} */
  const problems = [];
  /** @type {Array<ReturnType<typeof validateLedgerEntry>>} */
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (trimmed === HEADER_LINE || trimmed === SEPARATOR) continue;
    if (/^\|[\s|-]+\|$/.test(trimmed)) continue;
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      problems.push(dedupIssue(DEDUP_ERROR.LEDGER, '(ledger).line', 'action.dedup.ledger_line'));
      continue;
    }
    const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== LEDGER_COLUMNS.length) {
      problems.push(dedupIssue(DEDUP_ERROR.LEDGER, '(ledger).line', 'action.dedup.ledger_columns'));
      continue;
    }
    const versions = parseVersionIds(cells[6], problems, '(ledger).version_ids');
    rows.push(validateLedgerEntry({
      date: cells[0],
      level: cells[1],
      period_id: cells[2],
      main_id: cells[3],
      staple_id: cells[4],
      combo_fp: cells[5],
      version_ids: versions,
      cycle_key: cells[7] === '-' ? null : cells[7],
      source: cells[8],
    }));
  }
  if (problems.length > 0) throw new DedupError(problems);
  return Object.freeze(rows);
}

/** @param {unknown} fsPort */
function validateFsPort(fsPort) {
  const methods = ['readText', 'writeText', 'appendText', 'exists'];
  if (!fsPort || methods.some((m) => typeof /** @type {any} */ (fsPort)[m] !== 'function')) {
    throw new DedupError([
      dedupIssue(DEDUP_ERROR.FS, '(fsPort)', 'action.dedup.inject_fs_port'),
    ]);
  }
}

/**
 * 只追加登记一行。写后复验「历史字节前缀不变 + 新增部分恰好等于该行」，
 * 破坏即报错，避免以覆盖写伪装成追加（§9 不变式 5 / P-05）。
 *
 * @param {import('../../io/ports.js').FsPort} fsPort
 * @param {string} path 工作区相对路径（默认 `history.md`，在仓库外）
 * @param {unknown} entry
 */
export async function appendDedupEntry(fsPort, path, entry) {
  validateFsPort(fsPort);
  if (typeof path !== 'string' || path.length === 0) {
    throw new DedupError([dedupIssue(DEDUP_ERROR.FS, '(path)', 'action.dedup.ledger_path')]);
  }
  const row = validateLedgerEntry(entry);
  const existing = await fsPort.exists(path);
  if (!existing || (await fsPort.readText(path)) === '') {
    await fsPort.writeText(path, renderLedgerHeader());
  }
  const before = await fsPort.readText(path);
  const line = `${renderLedgerLine(row)}\n`;
  await fsPort.appendText(path, line);
  const after = await fsPort.readText(path);
  if (!after.startsWith(before) || after.slice(before.length) !== line) {
    throw new DedupError([
      dedupIssue(DEDUP_ERROR.APPEND, path, 'action.dedup.ledger_append_only'),
    ]);
  }
  return Object.freeze({
    path,
    line,
    historical_unchanged: true,
    entries_before: parseLedgerText(before).length,
    entries_after: parseLedgerText(after).length,
  });
}
