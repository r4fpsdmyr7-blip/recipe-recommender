// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-020 · 日志适配器单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-020；SPEC.md FR-047、FR-049、AC-17、SC-013、NFR-002；
 * plan.md §9「日志与异常」；constitution.md P-14。
 *
 * 核心可证形式：**日志值只接受字符串且必须是 Canonical ID 或稳定码**，
 * 于是「身体数值」在类型层就无法进入日志（`typeof value === 'number'` 直接拒绝），
 * 不需要事后做正则清洗。日志行因此**零数字、零中文、零空格正文**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOG_ERROR, LogError, LOG_KEYS, LOG_LEVEL, createLogPort } from '../../src/io/index.js';

const isLogError = (value) => value instanceof LogError;
const hasCode = (error, code) => isLogError(error) && error.issues.some((i) => i.code === code);
const LINE = /^level=(info|warn|error) event=[a-z][a-z0-9._-]* code=(ok|ERR_[A-Z_]+)( field=[a-z][a-z0-9._-]*)?$/;

/** @param {() => unknown} fn */
function grab(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

test('T-020 · 日志行格式固定为 level / event / code（可选 field），全 ASCII 零自然语句（FR-041 / P-14）', () => {
  assert.deepEqual([...LOG_KEYS].sort(), ['code', 'event', 'field']);
  assert.deepEqual({ ...LOG_LEVEL }, { INFO: 'info', WARN: 'warn', ERROR: 'error' });

  const log = createLogPort();
  assert.equal(log.record({ event: 'cli.plan', code: 'ok' }), 'level=info event=cli.plan code=ok');
  assert.equal(log.record({ event: 'privacy.export', code: 'ok', field: 'file' }),
    'level=info event=privacy.export code=ok field=file');
  assert.equal(log.record({ event: 'privacy.delete', code: 'ERR_FS_NOT_FOUND' }),
    'level=info event=privacy.delete code=ERR_FS_NOT_FOUND');
  for (const line of log.lines()) {
    assert.match(line, LINE);
    assert.ok(!/\d/.test(line), '日志行不含任何数字（身体数值无从进入）');
  }
});

test('T-020 · 数值类型一律拒绝：身体数值在类型层就进不了日志（FR-047 / FR-049）', () => {
  const log = createLogPort();
  for (const value of [1450, 0, 68.4, NaN, true, null, ['x'], { a: 1 }]) {
    const error = grab(() => log.record({ event: 'cli.plan', code: 'ok', field: value }));
    assert.ok(hasCode(error, LOG_ERROR.VALUE), `应拒绝 ${String(value)}`);
    assert.equal(error.issues[0].field, 'field');
    assert.match(error.issues[0].hint, /^action\.log\.[a-z._]+$/);
  }
  assert.deepEqual(log.lines(), [], '被拒绝的记录不落任何行');
});

test('T-020 · 值必须是 Canonical ID / 稳定码，中文、空格、URL、凭据一律拒绝（FR-048 / P-14）', () => {
  const log = createLogPort();
  const bad = ['cli plan', '计划', 'https://a.example/?q=1', 'a@b', 'a=b', 'a|b', 'a`b', 'cli.plan\n', ''];
  for (const value of bad) {
    assert.ok(hasCode(grab(() => log.record({ event: value, code: 'ok' })), LOG_ERROR.EVENT),
      `event 应拒绝 ${JSON.stringify(value)}`);
    assert.ok(hasCode(grab(() => log.record({ event: 'cli.plan', code: 'ok', field: value })),
      LOG_ERROR.VALUE), `field 应拒绝 ${JSON.stringify(value)}`);
  }
  assert.deepEqual(log.lines(), []);
});

test('T-020 · code 只接受 ok 或 ERR_[A-Z_]+ 稳定码（P-14）', () => {
  const log = createLogPort();
  for (const code of ['OK', 'err_x', 'ERR_plan', 'ERR_PLAN_', 'ERR_', 'ERR_PLAN-1', 'done', '']) {
    assert.ok(hasCode(grab(() => log.record({ event: 'cli.plan', code })), LOG_ERROR.CODE),
      `应拒绝 code ${JSON.stringify(code)}`);
  }
  assert.equal(log.record({ event: 'cli.plan', code: 'ERR_CLI_INVALID' }),
    'level=info event=cli.plan code=ERR_CLI_INVALID');
});

test('T-020 · 固定键集白名单：未知键与缺必需键一律拒绝（FR-032 口径 / P-14）', () => {
  const log = createLogPort();
  assert.ok(hasCode(grab(() => log.record({ event: 'cli.plan', code: 'ok', note: 'x' })), LOG_ERROR.KEYS));
  assert.ok(hasCode(grab(() => log.record({ event: 'cli.plan', code: 'ok', body: { bmr_kcal: 1450 } })), LOG_ERROR.KEYS));
  assert.ok(hasCode(grab(() => log.record({ event: 'cli.plan', code: 'ok', path: 'profiles/a.json' })), LOG_ERROR.KEYS));
  assert.ok(hasCode(grab(() => log.record({ code: 'ok' })), LOG_ERROR.EVENT));
  assert.ok(hasCode(grab(() => log.record({ event: 'cli.plan' })), LOG_ERROR.CODE));
  assert.ok(hasCode(grab(() => log.record({})), LOG_ERROR.EVENT));
  assert.ok(hasCode(grab(() => log.record(null)), LOG_ERROR.INVALID));
  assert.ok(hasCode(grab(() => log.record('cli.plan')), LOG_ERROR.INVALID));
});

test('T-020 · 错误对象只携带稳定码与字段，不含原始输入（FR-049）', () => {
  const error = grab(() => createLogPort().record({ event: 'cli.plan', code: 'ok', field: 'bmr_kcal=1450' }));
  assert.ok(isLogError(error));
  assert.equal(error.code, LOG_ERROR.INVALID);
  assert.match(error.message, /^ERR_LOG_INVALID: ERR_LOG_[A-Z_,]+$/);
  assert.ok(!error.message.includes('1450'), '错误消息不含身体数值');
  for (const issue of error.issues) {
    assert.match(issue.code, /^ERR_LOG_[A-Z_]+$/);
    assert.match(issue.hint, /^action\.log\.[a-z._]+$/);
  }
});

test('T-020 · level 可调且只允许三档，其余一律拒绝（NFR-002）', () => {
  const warn = createLogPort({ level: LOG_LEVEL.WARN });
  assert.equal(warn.record({ event: 'cli.plan', code: 'ok' }), 'level=warn event=cli.plan code=ok');
  for (const level of ['debug', 'INFO', '', 1]) {
    assert.ok(hasCode(grab(() => createLogPort({ level })), LOG_ERROR.VALUE), `应拒绝 level ${JSON.stringify(level)}`);
  }
});

test('T-020 · sink 收到与返回值完全相同的行；entries 冻结且顺序稳定（FR-028）', () => {
  const seen = [];
  const log = createLogPort({ sink: (line) => seen.push(line) });
  const first = log.record({ event: 'cli.init', code: 'ok' });
  const second = log.record({ event: 'cli.plan', code: 'ERR_CLI_INVALID', field: 'level' });
  assert.deepEqual(seen, [first, second]);
  assert.deepEqual(log.lines(), [first, second]);
  const entries = log.entries();
  assert.ok(Object.isFrozen(entries));
  assert.ok(entries.every((entry) => Object.isFrozen(entry)));
  assert.deepEqual(entries.map((entry) => entry.event), ['cli.init', 'cli.plan']);
  assert.deepEqual(entries[1].code, 'ERR_CLI_INVALID');
  assert.equal(entries[0].level, 'info');
  assert.equal(typeof createLogPort().record({ event: 'x.y', code: 'ok' }), 'string');
});

test('T-020 · 默认无 sink：不落盘、不抛错、零副作用（离线优先 NFR-001）', () => {
  const log = createLogPort();
  assert.equal(typeof log.record, 'function');
  assert.doesNotThrow(() => log.record({ event: 'cli.plan', code: 'ok' }));
  assert.equal(log.lines().length, 1);
  assert.equal(log.sink, undefined, '默认不暴露 sink，避免隐式写入');
});

test('T-020 · 同输入两次记录完全一致，行内不含时间戳 / 随机数（FR-028）', () => {
  const a = createLogPort();
  const b = createLogPort();
  for (const entry of [
    { event: 'privacy.export', code: 'ok' },
    { event: 'privacy.delete', code: 'ok', field: 'file' },
  ]) {
    assert.equal(a.record(entry), b.record(entry));
  }
  assert.deepEqual(a.lines(), b.lines());
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(a.lines().join('\n')), '日志零时间戳');
});
