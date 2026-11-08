// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 · `rr ledger` —— 查询只追加台账（FR-029 / FR-015 / FR-017 / FR-026）。
 *
 * 只读：台账是事件溯源，本命令绝不回改历史行（P-05）。
 * 输出**原样透传**台账行而非重新序列化，保证 `rr ledger` 的输出与文件字节一致、
 * 便于人工比对与 diff；`--last n` 取尾部 n 行（`--last 0` 合法，返回空集）。
 */
import { HISTORY_PATH } from '../core/dedup/index.js';
import { FEEDBACK_PATH, CHANGELOG_PATH } from '../core/feedback/index.js';
import { CLI_ERROR, CliError, cliIssue } from './errors.js';
import { line, requirePort } from './shared.js';

/** 三类台账的只读位置（FR-015 / FR-017 / FR-026）。 */
export const LEDGER_PATHS = Object.freeze({
  dedup: HISTORY_PATH,
  feedback: FEEDBACK_PATH,
  changelog: CHANGELOG_PATH,
});

const SEPARATOR = /^\|[\s:|-]+\|$/;

/**
 * 提取数据行：跳过注释、表头与分隔行，其余原样返回（含首尾竖线）。
 * @param {string} text
 * @returns {string[]}
 */
export function ledgerRows(text) {
  const rows = [];
  let headerSeen = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('|')) continue;
    if (SEPARATOR.test(trimmed)) continue;
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }
    rows.push(trimmed);
  }
  return rows;
}

/**
 * @param {Record<string, unknown>} options
 * @param {Record<string, any>} deps
 * @returns {Promise<string[]>}
 */
export async function runLedger(options, deps) {
  const fsPort = requirePort(deps, 'fsPort', 'action.cli.port.fs');
  const type = options.type;
  if (typeof type !== 'string' || !Object.hasOwn(LEDGER_PATHS, type)) {
    throw new CliError([cliIssue(CLI_ERROR.TYPE, '(options).type', 'action.cli.type')]);
  }
  const path = LEDGER_PATHS[/** @type {keyof typeof LEDGER_PATHS} */ (type)];

  // 台账不存在 == 尚未发生任何事件（E-05：首次只写表头），不是错误。
  const exists = await fsPort.exists(path);
  const rows = exists ? ledgerRows(await fsPort.readText(path)) : [];

  const limit = typeof options.last === 'number' ? options.last : rows.length;
  const selected = limit <= 0 ? [] : rows.slice(Math.max(0, rows.length - limit));

  return [
    line('command', 'ledger'),
    line('type', type),
    line('count', selected.length),
    ...selected.map((row) => line('row', row)),
    line('status', 'ok'),
  ];
}
