// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-030 · MCP Server 单测（FR-030 / FR-048 / AC-14 / SC-009 / NFR-008）。
 *
 * ATDD 先红后绿：本文件先于 `src/mcp/` 实现落盘，初态必须为 RED。
 * 取证口径与 P1 一致：
 * - 真实身体数据令牌正则动态取自 `.github/workflows/ci.yml` 的唯一权威规则（T-021 口径）；
 * - 网络出口用静态扫描 + 内存流端到端取证，不真的开端口；
 * - 负向探针主动注入身体数据 / 伪造端口，确认被拒绝而非被回显。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  MCP_ERROR,
  TOOL_NAMES,
  TOOLS,
  FORBIDDEN_MARKERS,
  PROTOCOL_VERSION,
  SERVER_INFO,
  parseFrame,
  encodeFrame,
  handleRequest,
  MCP_COMMAND,
  createMcpServer,
  serveMcp,
  assertSafePayload,
} from '../../src/mcp/index.js';
import { COMMANDS, P2_COMMANDS, ALL_COMMANDS, parseArgs } from '../../src/cli/args.js';
import { EXIT, runCli } from '../../src/cli/run.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const mcpSources = () => readdirSync(join(ROOT, 'src/mcp'), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.js'))
  .map((e) => `src/mcp/${e.name}`)
  .sort();

/** CI 唯一权威规则：本文件不复制任何真实数据字面量，否则静态扫描会自命中。 */
const TOKEN_RULE = (() => {
  const m = /const TOKENS = \/(.+?)\/;/.exec(read('.github/workflows/ci.yml'));
  assert.ok(m, 'ci.yml 必须保留 TOKENS 唯一权威规则');
  return m[1];
})();
const bodyTokens = () => new RegExp(TOKEN_RULE);
/** 负向探针用的令牌在运行时还原，源码里不出现其字面量。 */
const TOKEN_PARTS = TOKEN_RULE.split('|').map((s) => s.replace(/\\(.)/g, '$1'));
const REAL_TOKEN = TOKEN_PARTS[0];
const KCAL_TOKEN = TOKEN_PARTS[1];
const PCT_TOKEN = TOKEN_PARTS[2];

const PORTS = Object.freeze({
  generatePlan: () => ({
    status: 'ok',
    plan_ref: 'plan.day.2026-11-10',
    plan_markdown: '# demo plan',
    verdict: 'ok',
  }),
  validatePlan: () => ({ status: 'ok', verdict: 'ok', violations: [] }),
  queryLedger: () => ({ status: 'ok', type: 'dedup', rows: 0, entries: [] }),
  listLocales: () => ({ status: 'ok', locales: ['zh-Hans', 'en'] }),
});

const server = () => createMcpServer(PORTS);
const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

/** @param {string[]} lines */
async function* inputOf(lines) {
  for (const l of lines) yield l;
}
/** 内存输出流：不碰真实 stdout。 */
function memoryOutput() {
  const chunks = [];
  return { chunks, write: (s) => { chunks.push(s); } };
}
const framesOf = (output) => output.chunks.join('').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l));

// ------------------------------------------------- FR-030 · 工具注册与静态边界

test('T-030 · 四个 rr_ 工具注册，描述与模式零身体数据（FR-030 / FR-048）', () => {
  assert.deepEqual([...TOOL_NAMES], [
    'rr_generate_plan', 'rr_validate_plan', 'rr_query_ledger', 'rr_list_locales',
  ]);
  assert.ok(Object.isFrozen(TOOL_NAMES));
  assert.equal(TOOLS.length, TOOL_NAMES.length);
  for (const tool of TOOLS) {
    assert.ok(TOOL_NAMES.includes(tool.name));
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 0);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    // 描述里连一个数字都不出现，比「事后正则清洗」更强（T-020 日志同构）。
    assert.ok(!/\d/.test(tool.description), `${tool.name} 描述不得含数字`);
    assert.ok(!FORBIDDEN_MARKERS.some((m) => tool.description.toLowerCase().includes(m)));
    assert.ok(!bodyTokens().test(JSON.stringify(tool)));
  }
});

test('T-030 · src/mcp 零依赖、零网络监听、SPDX 齐备（NFR-008 / FR-030）', () => {
  const files = mcpSources();
  assert.ok(files.length >= 3, `MCP 实现文件数=${files.length}`);
  const tokens = bodyTokens();
  for (const p of files) {
    const src = read(p);
    assert.ok(src.startsWith('// SPDX-License-Identifier: GPL-3.0-only'), `${p} 缺 SPDX`);
    assert.ok(!/from\s+['"]node:/.test(src), `${p} 不得导入 node: 内置模块`);
    assert.ok(!/require\s*\(/.test(src), `${p} 不得使用 require`);
    assert.ok(!/createServer|createConnection|\.listen\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(src),
      `${p} 不得出现网络监听 / 对外请求`);
    assert.ok(!tokens.test(src), `${p} 命中真实身体数据令牌`);
  }
  assert.ok(existsSync(join(ROOT, 'src/mcp/README.md')), '模块必须带 README 定案');
});

test('T-030 · 命令名固定且 P1 命令集快照不被 P2 改写（FR-029 / P-02）', () => {
  assert.equal(MCP_COMMAND, 'serve-mcp');
  assert.deepEqual([...COMMANDS].sort(),
    ['acceptance', 'delete-data', 'export-data', 'init', 'ledger', 'plan', 'validate']);
  assert.deepEqual([...P2_COMMANDS], ['serve-mcp']);
  assert.deepEqual([...ALL_COMMANDS], [...COMMANDS, 'serve-mcp']);
  assert.ok(Object.isFrozen(ALL_COMMANDS));
  assert.deepEqual(parseArgs(['serve-mcp']).options, {});
  for (const outOfScope of ['locales', 'feedback']) {
    assert.throws(() => parseArgs([outOfScope]), /ERR_CLI_COMMAND/, `${outOfScope} 仍不得越界`);
  }
});

// ------------------------------------------------- FR-030 · JSON-RPC / JSONL 帧

test('T-030 · JSONL 帧解析与编码：单行、可往返、错误码稳定', () => {
  const msg = request(1, 'ping');
  const frame = encodeFrame(msg);
  assert.ok(frame.endsWith('\n'));
  assert.equal(frame.slice(0, -1).split('\n').length, 1);
  assert.deepEqual(parseFrame(frame.trim()), msg);
  assert.throws(() => parseFrame('{not json'), (e) => e.code === MCP_ERROR.PARSE);
  assert.throws(() => parseFrame('null'), (e) => e.code === MCP_ERROR.PARSE);
});

test('T-030 · initialize / ping / tools/list 握手与能力集（FR-030）', async () => {
  const ctx = server().context;
  const init = await handleRequest(request('a', 'initialize', { protocolVersion: PROTOCOL_VERSION }), ctx);
  assert.equal(init.jsonrpc, '2.0');
  assert.equal(init.id, 'a');
  assert.equal(init.result.protocolVersion, PROTOCOL_VERSION);
  assert.ok(Object.hasOwn(init.result.capabilities, 'tools'));
  assert.deepEqual(init.result.serverInfo, SERVER_INFO);
  assert.ok(!bodyTokens().test(JSON.stringify(init)));

  const pong = await handleRequest(request(2, 'ping'), ctx);
  assert.deepEqual(pong.result, {});

  const list = await handleRequest(request(3, 'tools/list'), ctx);
  assert.deepEqual(list.result.tools.map((t) => t.name), [...TOOL_NAMES]);
});

test('T-030 · 通知不回帧、未知方法与非法请求返回稳定错误码（FR-048）', async () => {
  const ctx = server().context;
  assert.equal(await handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx), null);
  const unknown = await handleRequest(request(4, 'nope'), ctx);
  assert.equal(unknown.error.code, -32601);
  assert.equal(unknown.error.message, MCP_ERROR.METHOD);
  const bad = await handleRequest({ jsonrpc: '1.0', id: 5, method: 'ping' }, ctx);
  assert.equal(bad.error.code, -32600);
  assert.equal(bad.error.message, MCP_ERROR.REQUEST);
  assert.ok(!bodyTokens().test(JSON.stringify([unknown, bad])));
});

// ------------------------------------------------- FR-030 / FR-048 · 工具调用与脱敏

test('T-030 · 四个工具可调用，返回值走固定键集且零身体数据（FR-030 / FR-048）', async () => {
  const ctx = server().context;
  const calls = [
    ['rr_generate_plan', { level: 'day', date: '2026-11-10', profile_ref: 'profile.demo' }],
    ['rr_validate_plan', { plan_ref: 'plan.day.2026-11-10', level: 'day' }],
    ['rr_query_ledger', { type: 'dedup', last: 3 }],
    ['rr_list_locales', {}],
  ];
  const expectedKeys = {
    rr_generate_plan: ['plan_markdown', 'plan_ref', 'status', 'verdict'],
    rr_validate_plan: ['status', 'verdict', 'violations'],
    rr_query_ledger: ['entries', 'rows', 'status', 'type'],
    rr_list_locales: ['locales', 'status'],
  };
  let id = 10;
  for (const [name, args] of calls) {
    const res = await handleRequest(request(id, 'tools/call', { name, arguments: args }), ctx);
    assert.equal(res.result.isError, false, name);
    assert.equal(res.result.content.length, 1);
    assert.equal(res.result.content[0].type, 'text');
    const payload = JSON.parse(res.result.content[0].text);
    assert.deepEqual(Object.keys(payload).sort(), expectedKeys[name], name);
    assert.ok(!bodyTokens().test(JSON.stringify(res)), name);
    assert.equal(await assertSafePayload(payload), payload);
    id += 1;
  }
});

test('T-030 · 端口缺失返回 ERR_MCP_PORT，不内置兜底、不回显异常文本（FR-030）', async () => {
  const ctx = createMcpServer({}).context;
  for (const name of TOOL_NAMES) {
    const res = await handleRequest(request(20, 'tools/call', { name, arguments: {} }), ctx);
    assert.equal(res.result.isError, true, name);
    assert.equal(res.result.content[0].text, MCP_ERROR.PORT, name);
  }
});

test('T-030 · 负向探针：端口回传身体数据被 ERR_MCP_PRIVACY 拒绝且不回显（FR-048）', async () => {
  const leak = createMcpServer({
    ...PORTS,
    generatePlan: () => ({ status: 'ok', plan_ref: 'plan.day.demo', weight_kg: Number(REAL_TOKEN) }),
  }).context;
  const res = await handleRequest(request(30, 'tools/call', {
    name: 'rr_generate_plan', arguments: { level: 'day' },
  }), leak);
  assert.equal(res.result.isError, true);
  assert.equal(res.result.content[0].text, MCP_ERROR.PRIVACY);
  assert.ok(!bodyTokens().test(JSON.stringify(res)), '不得回显真实身体数据令牌');
  assert.ok(!JSON.stringify(res).includes(REAL_TOKEN.slice(0, 2)), '不得回显注入数值');

  const textLeak = createMcpServer({
    ...PORTS,
    generatePlan: () => ({ status: 'ok', plan_ref: 'plan.day.demo', plan_markdown: `body_fat ${PCT_TOKEN}` }),
  }).context;
  const res2 = await handleRequest(request(31, 'tools/call', {
    name: 'rr_generate_plan', arguments: { level: 'day' },
  }), textLeak);
  assert.equal(res2.result.isError, true);
  assert.equal(res2.result.content[0].text, MCP_ERROR.PRIVACY);
});

test('T-030 · 负向探针：注入身体数据参数与未知工具被拒（FR-048）', async () => {
  const ctx = server().context;
  const badArg = await handleRequest(request(40, 'tools/call', {
    name: 'rr_generate_plan', arguments: { level: 'day', weight_kg: Number(REAL_TOKEN) },
  }), ctx);
  assert.equal(badArg.error.code, -32602);
  assert.equal(badArg.error.message, MCP_ERROR.ARGS);
  assert.ok(!JSON.stringify(badArg).includes(REAL_TOKEN.slice(0, 2)));

  const noTool = await handleRequest(request(41, 'tools/call', { name: 'rr_unknown' }), ctx);
  assert.equal(noTool.result.isError, true);
  assert.equal(noTool.result.content[0].text, MCP_ERROR.TOOL);
});

test('T-030 · assertSafePayload 在类型层拒绝浮点与身体字段（FR-048）', () => {
  assert.doesNotThrow(() => assertSafePayload({ status: 'ok', rows: 0, ok: true, id: null }));
  assert.throws(() => assertSafePayload({ weight_kg: 70 }), (e) => e.code === MCP_ERROR.PRIVACY);
  assert.throws(() => assertSafePayload({ rows: 1.5 }), (e) => e.code === MCP_ERROR.PRIVACY);
  assert.throws(() => assertSafePayload({ bmr_kcal: Number(KCAL_TOKEN) }), (e) => e.code === MCP_ERROR.PRIVACY);
  assert.throws(() => assertSafePayload({ text: 'height_cm=170' }), (e) => e.code === MCP_ERROR.PRIVACY);
});

// ------------------------------------------------- FR-030 · stdio 端到端

test('T-030 · serveMcp 全内存 stdio 往返，跨 chunk 组帧，零对外请求（NFR-008）', async () => {
  const output = memoryOutput();
  const input = inputOf([
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}\n',
    '{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
    '{"jsonrpc":"2.0","id":3,',
    '"method":"ping"}\n',
    '{broken json\n',
  ]);
  const stats = await serveMcp({ input, output, ports: PORTS });
  const frames = framesOf(output);
  assert.equal(frames.length, 4, '三条请求 + 一条解析错误；通知不回帧');
  assert.deepEqual(frames.map((f) => f.id), [1, 2, 3, null]);
  assert.equal(frames[3].error.message, MCP_ERROR.PARSE);
  assert.equal(stats.notifications, 1);
  assert.equal(stats.responses, 4);
  assert.ok(output.chunks.join('').split('\n').every((l) => !l.includes('key=value')));
  assert.ok(!bodyTokens().test(output.chunks.join('')));
});

test('T-030 · runCli serve-mcp 走注入 stdio，返回零 key=value 行（FR-030）', async () => {
  const output = memoryOutput();
  const input = inputOf(['{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n']);
  const result = await runCli(['serve-mcp'], {
    mcpInput: input, mcpOutput: output, mcpPorts: PORTS,
  });
  assert.equal(result.exit, EXIT.OK);
  assert.deepEqual(result.lines, [], 'stdio 协议不得混入 key=value 输出');
  const frames = framesOf(output);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].result.tools.length, 4);
});

test('T-030 · runCli serve-mcp 缺 stdio 端口即 exit 3 / ERR_CLI_PORT（FR-030）', async () => {
  const result = await runCli(['serve-mcp'], {});
  assert.equal(result.exit, EXIT.PORT);
  const text = result.lines.join('\n');
  assert.ok(text.includes('ERR_CLI_PORT'));
  assert.ok(text.endsWith('status=error'));
  assert.ok(!bodyTokens().test(text));
});
