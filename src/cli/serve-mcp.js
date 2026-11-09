// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-030 · `rr serve-mcp` CLI 桥接（FR-029 / FR-030 / FR-048）。
 *
 * 本文件只做三件事：校验 stdio 端口是否注入、调用 `serveMcp`、把原生异常折叠为稳定码。
 * `src/cli` 继续保持零 `node:` 导入；真实流由调用方注入，因此离线门禁可以用内存流取证。
 *
 * 输出契约例外：MCP 帧直接写入 `mcpOutput`，本处理器返回零条 `key=value` 行，
 * 否则会污染 stdio 帧流（详见 `src/mcp/README.md §5`）。
 */
import { serveMcp } from '../mcp/index.js';
import { CLI_ERROR, CliError, cliIssue } from './errors.js';

/**
 * 启动 stdio MCP Server，阻塞到输入流结束。
 * @param {Readonly<Record<string, unknown>>} options `serve-mcp` 无 CLI 参数，恒为 `{}`
 * @param {Record<string, any>} [deps] 需注入 `mcpInput` / `mcpOutput`，可选 `mcpPorts`
 * @returns {Promise<ReadonlyArray<string>>} 空数组（stdio 例外）
 * @throws {CliError} `ERR_CLI_PORT`（端口缺失或服务异常）
 */
export async function runServeMcp(options, deps = {}) {
  const injected = deps ?? {};
  const { mcpInput, mcpOutput, mcpPorts } = injected;
  /** @type {import('./errors.js').CliIssue[]} */
  const issues = [];
  if (!mcpInput || typeof mcpInput[Symbol.asyncIterator] !== 'function') {
    issues.push(cliIssue(CLI_ERROR.PORT, '(ports).mcpInput', 'action.cli.port'));
  }
  if (!mcpOutput || typeof mcpOutput.write !== 'function') {
    issues.push(cliIssue(CLI_ERROR.PORT, '(ports).mcpOutput', 'action.cli.port'));
  }
  if (issues.length > 0) throw new CliError(issues);

  try {
    await serveMcp({ input: mcpInput, output: mcpOutput, ports: mcpPorts ?? {} });
  } catch {
    // 不回传原生异常文本 / 帧正文（FR-048）：统一折叠为端口级稳定码。
    throw new CliError([cliIssue(CLI_ERROR.PORT, '(ports).serveMcp', 'action.cli.port')]);
  }
  return Object.freeze([]);
}
