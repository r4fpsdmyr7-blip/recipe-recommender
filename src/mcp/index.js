// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-030 · MCP Server 统一出口与 stdio 组合根（FR-030 / FR-048 / AC-14 / SC-009 / NFR-008）。
 *
 * 组合根是唯一知道「流」的地方：`input` 只需是异步可迭代对象、`output` 只需有
 * `write(string)`。生产环境可注入 `process.stdin` / `process.stdout`，测试环境注入
 * 内存流；本模块不导入 `node:*`、不监听端口、不读取环境变量。
 *
 * 命令名 `rr serve-mcp` 由 `src/cli/` 桥接；四个工具的业务端口由调用方注入，
 * 缺失时工具返回 `ERR_MCP_PORT`，**不内置兜底、不伪造计划或台账**。
 */
import { MCP_ERROR, McpError, mcpError, mcpIssue } from './errors.js';
import {
  TOOLS,
  TOOL_NAMES,
  FORBIDDEN_MARKERS,
  assertSafeText,
  assertSafePayload,
  assertToolArgs,
  createToolHandlers,
} from './tools.js';
import {
  PROTOCOL_VERSION,
  SERVER_INFO,
  parseFrame,
  encodeFrame,
  handleRequest,
} from './jsonrpc.js';

export {
  MCP_ERROR, McpError, mcpError, mcpIssue,
  TOOLS, TOOL_NAMES, FORBIDDEN_MARKERS,
  assertSafeText, assertSafePayload, assertToolArgs, createToolHandlers,
  PROTOCOL_VERSION, SERVER_INFO, parseFrame, encodeFrame, handleRequest,
};

/** `plan.md §6.2` 登记的 CLI 命令名。 */
export const MCP_COMMAND = 'serve-mcp';

/**
 * 创建一个无状态 MCP Server 句柄。
 * @param {Record<string, (args: Readonly<Record<string, unknown>>) => unknown>} [ports]
 * @returns {Readonly<{
 *   context: import('./jsonrpc.js').McpContext,
 *   tools: ReadonlyArray<object>,
 *   handle: (request: unknown) => Promise<Record<string, any> | null>,
 * }>}
 */
export function createMcpServer(ports = {}) {
  const handlers = createToolHandlers(ports);
  const context = Object.freeze({
    tools: TOOLS,
    handlers,
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: SERVER_INFO,
  });
  return Object.freeze({
    context,
    tools: TOOLS,
    handle: (request) => handleRequest(request, context),
  });
}

/**
 * 启动 stdio JSONL 服务，直到输入流结束。
 * @param {{
 *   input: AsyncIterable<string>,
 *   output: {write: (text: string) => unknown},
 *   ports?: Record<string, (args: Readonly<Record<string, unknown>>) => unknown>,
 * }} [options]
 * @returns {Promise<Readonly<{
 *   requests: number, responses: number, notifications: number,
 *   errors: number, frames: number,
 * }>>}
 * @throws {McpError} `ERR_MCP_TRANSPORT`（流端口缺失）
 */
export async function serveMcp(options = {}) {
  const { input, output, ports = {} } = options ?? {};
  if (!input || typeof input[Symbol.asyncIterator] !== 'function') {
    throw mcpError(MCP_ERROR.TRANSPORT);
  }
  if (!output || typeof output.write !== 'function') {
    throw mcpError(MCP_ERROR.TRANSPORT);
  }

  const server = createMcpServer(ports);
  const stats = { requests: 0, responses: 0, notifications: 0, errors: 0, frames: 0 };

  /** 最终一道出参护栏：连序列化后的整帧都不许出现身体数据标记。 */
  const writeFrame = (frame) => {
    let text;
    try {
      text = encodeFrame(frame);
      assertSafeText(text);
    } catch {
      text = encodeFrame({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: MCP_ERROR.PRIVACY, data: { code: MCP_ERROR.PRIVACY } },
      });
      stats.errors += 1;
    }
    output.write(text);
    stats.responses += 1;
    stats.frames += 1;
  };

  /** @param {string} raw */
  const processLine = async (raw) => {
    const line = raw.trim();
    if (!line) return;
    stats.requests += 1;
    /** @type {Record<string, any> | null} */
    let response;
    try {
      response = await server.handle(parseFrame(line));
    } catch {
      response = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: MCP_ERROR.PARSE, data: { code: MCP_ERROR.PARSE } },
      };
      stats.errors += 1;
    }
    if (response === null) {
      stats.notifications += 1;
      return;
    }
    writeFrame(response);
  };

  let buffer = '';
  for await (const chunk of input) {
    buffer += typeof chunk === 'string' ? chunk : String(chunk);
    let at = buffer.indexOf('\n');
    while (at >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      await processLine(line);
      at = buffer.indexOf('\n');
    }
  }
  if (buffer.trim()) await processLine(buffer);

  return Object.freeze({ ...stats });
}
