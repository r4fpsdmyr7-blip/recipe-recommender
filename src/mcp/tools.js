// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-030 · MCP 工具注册表与脱敏护栏（FR-030 / FR-048 / AC-14 / SC-009）。
 *
 * 三条定案（与 T-020 日志端口同构，避免「事后正则清洗」的伪安全）：
 * 1. **入参类型层拒绝**：所有工具参数只接受 Canonical ID 形态字符串或小型整数计数；
 *    浮点、自由文本、额外键一律 `ERR_MCP_ARGS`，身体数值因此进不了 MCP 层。
 * 2. **出参类型层拒绝**：`assertSafePayload` 只允许 null / boolean / 字符串 / 小整数，
 *    浮点、身体字段名、身体数据标记文本一律 `ERR_MCP_PRIVACY`。
 * 3. **端口注入**：四个工具的业务能力全部由调用方注入，缺失即 `ERR_MCP_PORT`，
 *    **不内置任何兜底实现**（T-019 定案）；本模块零 IO、零 `node:` 导入。
 *
 * 工具描述刻意不含任何数字；`profile_ref` / `plan_ref` 只是本地引用 ID，
 * 绝不承载身高、体重、体脂等身体数值（FR-048）。
 */
import { MCP_ERROR, mcpError } from './errors.js';

/** 四个工具名，顺序即 `tools/list` 返回顺序。 */
export const TOOL_NAMES = Object.freeze([
  'rr_generate_plan',
  'rr_validate_plan',
  'rr_query_ledger',
  'rr_list_locales',
]);

const LEVELS = Object.freeze(['year', 'season', 'month', 'week', 'day']);
const LEDGER_TYPES = Object.freeze(['dedup', 'feedback', 'changelog']);

/** Canonical ID / ISO 日期 / BCP 47 语言标签 / 本地引用 ID 的共同形状。 */
const CANONICAL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * @param {Record<string, object>} properties
 * @returns {Readonly<{type: string, properties: Readonly<Record<string, object>>, additionalProperties: boolean}>}
 */
const schema = (properties) => Object.freeze({
  type: 'object',
  properties: Object.freeze(properties),
  additionalProperties: false,
});

/** @type {ReadonlyArray<Readonly<{name: string, description: string, inputSchema: object}>>} */
export const TOOLS = Object.freeze([
  Object.freeze({
    name: 'rr_generate_plan',
    description: 'Generate a local recipe plan and return sanitized markdown with a stable verdict.',
    inputSchema: schema({
      level: { type: 'string', enum: LEVELS },
      date: { type: 'string' },
      profile_ref: { type: 'string' },
      lang: { type: 'string' },
      guideline: { type: 'string' },
      calendar: { type: 'string' },
    }),
  }),
  Object.freeze({
    name: 'rr_validate_plan',
    description: 'Validate a local plan reference and return a consistency verdict with canonical ids.',
    inputSchema: schema({
      plan_ref: { type: 'string' },
      level: { type: 'string', enum: LEVELS },
    }),
  }),
  Object.freeze({
    name: 'rr_query_ledger',
    description: 'Return a sanitized summary of a local ledger without personal values.',
    inputSchema: schema({
      type: { type: 'string', enum: LEDGER_TYPES },
      last: { type: 'integer' },
    }),
  }),
  Object.freeze({
    name: 'rr_list_locales',
    description: 'List the supported BCP language tags.',
    inputSchema: schema({}),
  }),
]);

/** 身体数据标记：出现在任何返回字符串里即拒绝（FR-048 / FR-053）。 */
export const FORBIDDEN_MARKERS = Object.freeze([
  'body_fat', 'bodyfat', 'weight_kg', 'height_cm', 'bmr_kcal',
  'waist_cm', 'hip_cm', 'birth_date', 'blood_pressure',
]);

/** 身体字段名精确匹配（不误伤 `profile_ref` / `plan_ref` 这类本地引用 ID）。 */
const BODY_KEY = /^(?:body(?:_fat|fat|weight)?|weight(?:_kg)?|height(?:_cm)?|age|bmr(?:_kcal)?|fat|waist(?:_cm)?|hip(?:_cm)?|birth(?:_date)?|bmi|blood_pressure)$/i;

/** 自由文本里的身体数据痕迹（含中文字段名与人体单位）。 */
const BODY_TEXT = /(?:body[_ -]?fat|bodyfat|\bbmr\b|\d+(?:\.\d+)?\s*(?:kg|cm)\b|体重|身高|体脂|腰围|臀围)/i;

/**
 * 校验任意返回字符串不含身体数据标记。
 * @param {unknown} text
 * @returns {string}
 * @throws {McpError} `ERR_MCP_PRIVACY` / `ERR_MCP_PAYLOAD`
 */
export function assertSafeText(text) {
  if (typeof text !== 'string') throw mcpError(MCP_ERROR.PAYLOAD);
  const lower = text.toLowerCase();
  if (FORBIDDEN_MARKERS.some((marker) => lower.includes(marker)) || BODY_TEXT.test(text)) {
    throw mcpError(MCP_ERROR.PRIVACY);
  }
  return text;
}

/**
 * 递归校验工具返回值：数值只允许 `[0, 10000]` 的整数计数，浮点一律拒绝。
 * 这是「身体数值在类型层被拒」的可执行断言，不依赖对数值语义的猜测。
 * @param {unknown} value
 * @returns {unknown} 原值（便于链式调用）
 * @throws {McpError} `ERR_MCP_PRIVACY` / `ERR_MCP_PAYLOAD`
 */
export function assertSafePayload(value) {
  visit(value);
  return value;
}

/** @param {unknown} value @returns {void} */
function visit(value) {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 10000) {
      throw mcpError(MCP_ERROR.PRIVACY);
    }
    return;
  }
  if (typeof value === 'string') {
    assertSafeText(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visit(item);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (BODY_KEY.test(key) || FORBIDDEN_MARKERS.some((marker) => lower.includes(marker))) {
        throw mcpError(MCP_ERROR.PRIVACY);
      }
      visit(item);
    }
    return;
  }
  throw mcpError(MCP_ERROR.PAYLOAD);
}

/**
 * 工具参数白名单校验：额外键、浮点、自由文本一律拒绝。
 * @param {string} name
 * @param {unknown} args
 * @returns {Readonly<Record<string, unknown>>}
 * @throws {McpError} `ERR_MCP_TOOL` / `ERR_MCP_ARGS`
 */
export function assertToolArgs(name, args) {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw mcpError(MCP_ERROR.TOOL);
  const input = args === undefined ? {} : args;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw mcpError(MCP_ERROR.ARGS);
  }
  /** @type {Record<string, any>} */
  const properties = /** @type {any} */ (tool.inputSchema).properties;
  for (const [key, value] of Object.entries(input)) {
    const rule = properties[key];
    if (!rule) throw mcpError(MCP_ERROR.ARGS);
    if (rule.type === 'integer') {
      if (!Number.isInteger(value) || value < 0 || value > 1000) {
        throw mcpError(MCP_ERROR.ARGS);
      }
      continue;
    }
    if (typeof value !== 'string' || !CANONICAL.test(value)) {
      throw mcpError(MCP_ERROR.ARGS);
    }
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) {
      throw mcpError(MCP_ERROR.ARGS);
    }
  }
  return Object.freeze({ ...input });
}

/**
 * 四个工具的执行端口。业务能力全部注入，缺失即 `ERR_MCP_PORT`、不内置兜底。
 * @param {Record<string, (args: Readonly<Record<string, unknown>>) => unknown>} [ports]
 * @returns {Readonly<Record<string, (args: Readonly<Record<string, unknown>>) => Promise<unknown>>>}
 */
export function createToolHandlers(ports = {}) {
  const source = ports ?? {};
  /** @param {string} key */
  const invoke = async (key, args) => {
    const port = source[key];
    if (typeof port !== 'function') throw mcpError(MCP_ERROR.PORT);
    return port(args);
  };
  return Object.freeze({
    rr_generate_plan: (args) => invoke('generatePlan', args),
    rr_validate_plan: (args) => invoke('validatePlan', args),
    rr_query_ledger: (args) => invoke('queryLedger', args),
    rr_list_locales: (args) => invoke('listLocales', args),
  });
}
