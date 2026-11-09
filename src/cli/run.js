// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-019 · CLI 入口与退出码（FR-029 / FR-028）。
 *
 * 输出契约：每行 `key=value`，值只允许可打印 ASCII，`status=` 固定收尾；
 * 错误统一展开为 `error=<稳定码>` + 若干 `issue=<码>:<字段>:<提示>`，绝不拼接正文或身体数值。
 *
 * 退出码是稳定契约：
 * - `0` 成功；
 * - `1` 用法错误（命令 / 参数层）；
 * - `2` 业务拒绝（档案、计划、校验、渲染等域错误）；
 * - `3` 端口缺失（未注入必需依赖，如区域解析器 / 语言包加载器 / 验收执行器）。
 */
import { CLI_ERROR, CliError } from './errors.js';
import { parseArgs } from './args.js';
import { runInit } from './init.js';
import { runPlan } from './plan.js';
import { runValidate } from './validate.js';
import { runLedger } from './ledger.js';
import { runAcceptance } from './acceptance.js';
import { runExportData } from './export-data.js';
import { runDeleteData } from './delete-data.js';
import { runServeMcp } from './serve-mcp.js';
import { errorCode, issueLines, line } from './shared.js';

/** 退出码。 */
export const EXIT = Object.freeze({ OK: 0, USAGE: 1, DOMAIN: 2, PORT: 3 });

const HANDLERS = Object.freeze({
  init: runInit,
  plan: runPlan,
  validate: runValidate,
  ledger: runLedger,
  acceptance: runAcceptance,
  'export-data': runExportData,
  'delete-data': runDeleteData,
  // T-030：stdio 命令；协议帧直接写入注入的 mcpOutput，返回零条 key=value 行。
  'serve-mcp': runServeMcp,
});

/** @param {any} error */
function exitFor(error) {
  if (error instanceof CliError && error.issues.some((issue) => issue.code === CLI_ERROR.PORT)) {
    return EXIT.PORT;
  }
  return EXIT.DOMAIN;
}

/**
 * @param {string} command
 * @param {any} error
 * @param {number} exit
 */
function failure(command, error, exit) {
  return {
    exit,
    lines: [
      line('command', command),
      line('error', errorCode(error)),
      ...issueLines(error),
      line('status', 'error'),
    ],
  };
}

/**
 * 执行一次 CLI 调用。
 * @param {unknown} argv 不含 node / 脚本路径的参数数组
 * @param {Record<string, any>} [deps] 注入端口：fsPort / clock / env / netPort / logPort /
 *   resolveLocalePolicy / loadLanguagePack / intlFormatter / acceptanceRunner
 *   （T-030 追加：mcpInput / mcpOutput / mcpPorts）
 * @returns {Promise<{exit: number, lines: string[]}>}
 */
export async function runCli(argv, deps = {}) {
  /** @type {{command: string, options: Readonly<Record<string, unknown>>}} */
  let parsed;
  try {
    parsed = /** @type {any} */ (parseArgs(argv));
  } catch (error) {
    const fallback = Array.isArray(argv) && typeof argv[0] === 'string' ? argv[0] : 'unknown';
    return failure(fallback, error, EXIT.USAGE);
  }

  try {
    const handler = HANDLERS[/** @type {keyof typeof HANDLERS} */ (parsed.command)];
    const lines = await handler(parsed.options, deps ?? {});
    return { exit: EXIT.OK, lines };
  } catch (error) {
    return failure(parsed.command, error, exitFor(error));
  }
}
