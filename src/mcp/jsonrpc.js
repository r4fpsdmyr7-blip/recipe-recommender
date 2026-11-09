// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-030 · 零依赖 stdio JSON-RPC 层（FR-030 / FR-048 / NFR-008 / SC-009）。
 *
 * MCP stdio transport 的帧约定是 **newline-delimited JSON**：每条消息占一行、
 * UTF-8、行内换行由 `JSON.stringify` 转义。本模块不监听任何端口、不发起任何
 * 请求；输入 / 输出流由组合根注入，因此可在纯内存下完成端到端取证。
 *
 * 支持方法：`initialize` / `ping` / `tools/list` / `tools/call` /
 * `resources/list` / `prompts/list`；`notifications/*` 一律不回帧。
 *
 * 错误分层（FR-048：错误信息同样不得含个人数值）：
 * - 帧解析 / 请求形状 / 参数形状 → JSON-RPC `error`，`message` 为稳定码；
 * - 工具执行期错误（端口缺失 / 隐私拒绝） → `isError: true` 的 `tools/call` 结果，
 *   文本只有一个稳定码，绝不回显异常文本或注入值。
 */
import { MCP_ERROR, McpError, mcpError } from './errors.js';
import {
  TOOLS,
  TOOL_NAMES,
  assertToolArgs,
  assertSafePayload,
} from './tools.js';

/** MCP 协议版本（本实现只支持此版本，不做静默协商）。 */
export const PROTOCOL_VERSION = '2024-11-05';

/** @type {Readonly<{name: string, version: string}>} */
export const SERVER_INFO = Object.freeze({
  name: 'recipe-recommender',
  version: '0.1.0-dev',
});

/** @param {unknown} value @returns {boolean} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** @param {unknown} request @returns {boolean} */
const isNotification = (request) => !Object.hasOwn(/** @type {object} */ (request), 'id')
  || /** @type {any} */ (request).id === null;

/** @param {any} request */
const idOf = (request) => (isRecord(request) && request.id !== undefined ? request.id : null);

/**
 * 解析单条 JSONL 帧。
 * @param {unknown} line
 * @returns {Record<string, any>}
 * @throws {McpError} `ERR_MCP_PARSE`
 */
export function parseFrame(line) {
  if (typeof line !== 'string') throw mcpError(MCP_ERROR.PARSE);
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw mcpError(MCP_ERROR.PARSE);
  }
  if (!isRecord(parsed)) throw mcpError(MCP_ERROR.PARSE);
  return /** @type {Record<string, any>} */ (parsed);
}

/**
 * 编码单条 JSONL 帧（末尾换行；行内换行由 JSON 转义，保证一消息一行）。
 * @param {unknown} message
 * @returns {string}
 */
export function encodeFrame(message) {
  return `${JSON.stringify(message)}\n`;
}

/** @param {any} id @param {unknown} result */
const okResult = (id, result) => ({ jsonrpc: '2.0', id, result });

/** @param {any} id @param {number} code @param {string} message */
const rpcError = (id, code, message) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, data: { code: message } },
});

/** @param {string} code */
const toolFailure = (code) => ({
  content: [Object.freeze({ type: 'text', text: code })],
  isError: true,
});

/** @param {unknown} error @param {string} fallback @returns {string} */
const codeOf = (error, fallback) => (error instanceof McpError ? error.code : fallback);

/**
 * @typedef {Readonly<{
 *   tools: ReadonlyArray<object>,
 *   handlers: Readonly<Record<string, (args: Readonly<Record<string, unknown>>) => Promise<unknown>>>,
 *   protocolVersion: string,
 *   serverInfo: Readonly<{name: string, version: string}>,
 * }>} McpContext
 */

/**
 * 处理一条已解析的 JSON-RPC 请求。
 * @param {unknown} request
 * @param {McpContext} context
 * @returns {Promise<Record<string, any> | null>} 通知返回 `null`（不回帧）
 */
export async function handleRequest(request, context) {
  const req = /** @type {any} */ (request);
  const id = idOf(req);
  if (!isRecord(req) || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return rpcError(id, -32600, MCP_ERROR.REQUEST);
  }
  if (isNotification(req)) return null;

  const params = isRecord(req.params) ? req.params : {};

  switch (req.method) {
    case 'initialize':
      return okResult(id, {
        protocolVersion: context.protocolVersion,
        capabilities: { tools: Object.freeze({}) },
        serverInfo: context.serverInfo,
      });
    case 'ping':
      return okResult(id, {});
    case 'tools/list':
      return okResult(id, { tools: context.tools ?? TOOLS });
    case 'resources/list':
      return okResult(id, { resources: [] });
    case 'prompts/list':
      return okResult(id, { prompts: [] });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string' || !TOOL_NAMES.includes(name)) {
        return okResult(id, toolFailure(MCP_ERROR.TOOL));
      }
      let args;
      try {
        args = assertToolArgs(name, params.arguments);
      } catch (error) {
        return rpcError(id, -32602, codeOf(error, MCP_ERROR.ARGS));
      }
      try {
        const handler = context.handlers[name];
        if (typeof handler !== 'function') throw mcpError(MCP_ERROR.PORT);
        const payload = assertSafePayload(await handler(args));
        return okResult(id, {
          content: [Object.freeze({ type: 'text', text: JSON.stringify(payload) })],
          isError: false,
        });
      } catch (error) {
        return okResult(id, toolFailure(codeOf(error, MCP_ERROR.PAYLOAD)));
      }
    }
    default:
      return rpcError(id, -32601, MCP_ERROR.METHOD);
  }
}
