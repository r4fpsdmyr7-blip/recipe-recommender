// SPDX-License-Identifier: GPL-3.0-only
// [AIGC] T-022 · 工具链门禁单测（lint / coverage） · 审计追踪 ID: RR-T022-20261108-0001
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LINT = readFileSync(join(ROOT, 'scripts/lint.mjs'), 'utf8');
const COV = readFileSync(join(ROOT, 'scripts/coverage.mjs'), 'utf8');
const CI = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');

test('T-022 · lint 十项门禁 ID 固定、唯一且无恒真结论', () => {
  const ids = [...LINT.matchAll(/check\('([^']+)'/g)].map((m) => m[1]);
  assert.equal(ids.length, 10);
  assert.equal(new Set(ids).size, 10);
  for (const id of [
    'spdx.all_sources', 'syntax.all_sources', 'boundary.cli_no_node_imports',
    'boundary.render_ascii', 'boundary.acceptance_naming', 'boundary.no_third_party',
    'types.port_typedefs', 'types.jsdoc_contracts', 'safety.no_dynamic_eval',
    'safety.gates_readonly',
  ]) assert.ok(ids.includes(id), `缺门禁 ${id}`);
  assert.ok(!/check\('[^']+',\s*true\s*,/.test(LINT), '出现恒真门禁结论');
});

test('T-022 · lint 真跑 node --check 且明确登记类型检查不等价（不假绿）', () => {
  assert.match(LINT, /execFileSync\(process\.execPath, \['--check'/);
  assert.match(LINT, /syntaxErrors\.length === 0/);
  assert.match(LINT, /不等价于完整类型检查/);
  assert.match(LINT, /待人工裁决/);
});

test('T-022 · lint 总判定必须是逐项全过，不得有恒真总开关', () => {
  assert.match(LINT, /const ok = checks\.every\(\(c\) => c\.ok\);/);
  assert.match(LINT, /process\.exitCode = ok \? 0 : 1;/);
});

test('T-022 · coverage 阈值固定 80 且 line / branch / function 三列同时受检', () => {
  assert.match(COV, /const THRESHOLD = 80;/);
  const ids = [...COV.matchAll(/id: 'coverage\.([^']+)'/g)].map((m) => m[1]);
  for (const id of ['tests_green', 'line', 'branch', 'functions', 'summary_found']) {
    assert.ok(ids.includes(id), `缺门禁 ${id}`);
  }
  assert.equal((COV.match(/>= THRESHOLD/g) ?? []).length, 3, '三列必须都过阈值');
});

test('T-022 · coverage 不得跳过测试实际结果，且总判定恒等于逐项全过', () => {
  assert.match(COV, /testExit === 0 && testFail === 0 && testPass > 0/);
  assert.match(COV, /const ok = checks\.every\(\(c\) => c\.ok\);/);
  assert.match(COV, /--experimental-test-coverage/);
  assert.match(COV, /process\.exitCode = ok \? 0 : 1;/);
});

test('T-022 · 工具链脚本与门禁报告零第三方依赖、零真实数据令牌字面量', () => {
  // 令牌规则动态取自 ci.yml 唯一权威规则，不复制字面量（先红阶段的实测教训）。
  const matched = /const TOKENS = \/(.+?)\/;/.exec(CI);
  assert.ok(matched, 'ci.yml 唯一权威令牌规则缺失');
  const tokens = new RegExp(matched[1]);
  const report = readFileSync(join(ROOT, 'reports/t022-gate.md'), 'utf8');
  for (const [name, text] of [['lint.mjs', LINT], ['coverage.mjs', COV], ['t022-gate.md', report]]) {
    assert.ok(!tokens.test(text), `${name} 复制了真实数据令牌字面量`);
    assert.ok(!/from ['"](?!node:|\.\.)[a-z@]/i.test(text), `${name} 出现第三方包导入`);
  }
  assert.ok(LINT.startsWith('// SPDX-License-Identifier: GPL-3.0-only'));
  assert.ok(COV.startsWith('// SPDX-License-Identifier: GPL-3.0-only'));
});
