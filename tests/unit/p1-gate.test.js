// SPDX-License-Identifier: GPL-3.0-only
// [AIGC] T-022 · P1 出口门禁取证（先红后绿，P-02） · 审计追踪 ID: RR-T022-20261108-0001
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  P1_AC_IDS,
  AC_STATUS,
  GATE_CHECK_IDS,
  runP1Gate,
  formatGateReport,
} from '../acceptance/gates/p1-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const GATE_PATH = join(ROOT, 'tests/acceptance/gates/p1-gate.mjs');
const SOURCE = readFileSync(GATE_PATH, 'utf8');

// 顶层只取证一次：门禁本身是真实跑一遍离线集成的，不在每条用例里重复装配。
const report = await runP1Gate();
const lines = formatGateReport(report).split('\n');

test('T-022 · P1 门禁覆盖恰好 AC-01～12，ID 连续且唯一', () => {
  assert.equal(P1_AC_IDS.length, 12);
  assert.deepEqual([...P1_AC_IDS], Array.from({ length: 12 }, (_, k) => String(k + 1).padStart(2, '0')));
  assert.deepEqual(report.rows.map((r) => r.id), [...P1_AC_IDS]);
  assert.equal(new Set(report.rows.map((r) => r.id)).size, 12);
});

test('T-022 · 每条 AC 的状态、证据、缺口、来源四项齐备', () => {
  for (const row of report.rows) {
    assert.ok(Object.values(AC_STATUS).includes(row.status), `${row.id} 状态非法`);
    assert.ok(Array.isArray(row.evidence) && row.evidence.length >= 2, `${row.id} 证据不足`);
    assert.ok(Array.isArray(row.gaps), `${row.id} 缺 gaps 数组`);
    assert.ok(Array.isArray(row.sources) && row.sources.length > 0, `${row.id} 来源不可追溯`);
    assert.ok(row.sources.every((s) => typeof s === 'string' && s.length > 0), `${row.id} 来源为空`);
  }
});

test('T-022 · 场景文本逐字取自 SPEC.md §8，不得删改 / 跳过 / 弱化（P-09 / RK-03）', () => {
  const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');
  for (const row of report.rows) {
    assert.ok(typeof row.scenario === 'string' && row.scenario.length > 40, `${row.id} 场景缺失`);
    assert.ok(spec.includes(row.scenario.trim()), `${row.id} 场景与 SPEC §8 不逐字一致`);
    assert.ok(!/SKIP|skip\s*=\s*true/i.test(row.scenario), `${row.id} 出现跳过标记`);
  }
  assert.ok(report.scenarioCount === 12);
});

test('T-022 · 防假绿：verdict 恒等于「12 条全 E2E_PASS 且六项门禁全过」', () => {
  const allGreen = report.rows.every((r) => r.status === AC_STATUS.E2E);
  const checksOk = report.checks.every((c) => c.ok);
  assert.equal(report.verdict, allGreen && checksOk ? 'PASS' : 'BLOCKED');
  assert.equal(report.ok, allGreen && checksOk);
  assert.equal(report.checks.length, GATE_CHECK_IDS.length);
  assert.equal(new Set(report.checks.map((c) => c.id)).size, report.checks.length);
});

test('T-022 · 非端到端通过的 AC 必须给出具体缺口，不得空口 BLOCKED', () => {
  const pending = report.rows.filter((r) => r.status !== AC_STATUS.E2E);
  assert.ok(pending.length > 0, '取证应如实反映当前尚未端到端打通的 AC');
  for (const row of pending) {
    assert.ok(row.gaps.length > 0, `${row.id} 未给出缺口`);
    assert.ok(row.gaps.every((g) => typeof g === 'string' && g.length > 8), `${row.id} 缺口描述过短`);
  }
});

test('T-022 · 端到端通过的 AC 必须有真实可复算证据，而不是声明式通过', () => {
  const done = report.rows.filter((r) => r.status === AC_STATUS.E2E);
  assert.ok(done.length > 0);
  for (const row of done) {
    assert.ok(row.evidence.length >= 2, `${row.id} 证据不足`);
    assert.ok(row.gaps.length === 0, `${row.id} 通过却仍有缺口`);
  }
});

test('T-022 · AC-01 的处方区间与 BMR 护栏由 rr-data 规范区复算（SC-003）', () => {
  const a1 = report.rows.find((r) => r.id === '01');
  assert.ok(a1);
  const e = a1.evidence.join(' | ');
  assert.match(e, /energy_kcal=1[5-7]\d\d/);
  assert.match(e, /protein_g=9\d/);
  assert.match(e, /salt_g\.max=4\.5/);
  assert.match(e, /oil_g\.max=30/);
  assert.match(e, /added_sugar_g\.max=20/);
  assert.match(e, /energy_floor_kcal=1450/);
  assert.match(e, /guideline_id=generic-guideline/);
});

test('T-022 · AC-12 的端到端取证必须复用 T-021 的 14 条门禁且全部通过', () => {
  const a12 = report.rows.find((r) => r.id === '12');
  assert.equal(a12.status, AC_STATUS.E2E);
  assert.ok(a12.sources.some((s) => s.includes('offline-integration.mjs')));
  assert.equal(report.offline.ok, true);
  assert.equal(report.offline.checks.length, 14);
  assert.equal(report.offline.checks.filter((c) => !c.ok).length, 0);
});

test('T-022 · AC-03 / 05 / 06 不得被声明为端到端通过（计划正文链路未接通）', () => {
  for (const id of ['03', '05', '06']) {
    const row = report.rows.find((r) => r.id === id);
    assert.notEqual(row.status, AC_STATUS.E2E, `AC-${id} 当前不具备端到端正文证据`);
    assert.ok(row.gaps.length > 0);
  }
});

test('T-022 · 六项门禁 ID 固定且逐项有取证结论', () => {
  assert.deepEqual([...GATE_CHECK_IDS], [
    'gate.scenarios_faithful',
    'gate.core_capabilities',
    'gate.offline_integration',
    'gate.static_privacy',
    'gate.no_silent_green',
    'gate.traceability',
  ]);
  for (const c of report.checks) assert.equal(typeof c.ok, 'boolean');
});

test('T-022 · 静态扫描不是空扫：源码文件数与独立清点一致', () => {
  assert.ok(report.scannedFiles > 20, '扫描文件数过少，疑似空扫');
  assert.equal(report.scannedFiles, report.independentlyCounted);
});

test('T-022 · 门禁报告为纯 ASCII key=value 且 status= 收尾', () => {
  assert.ok(lines.every((l) => /^[\x20-\x7E]*$/.test(l)), '报告含非 ASCII');
  assert.ok(lines.slice(0, -1).every((l) => /^[a-z][a-z0-9._-]*=/.test(l)), '行格式不是 key=value');
  assert.match(lines.at(-1), /^status=(ok|blocked|error)$/);
  assert.ok(lines.some((l) => l.startsWith('verdict=')));
  assert.ok(lines.some((l) => l.startsWith('ac.03=')) && lines.some((l) => l.startsWith('ac.12=')));
});

test('T-022 · 门禁模块零磁盘写入、零第三方依赖、零真实身体数据字面量', () => {
  assert.ok(!/\b(writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|createWriteStream)\b/.test(SOURCE));
  assert.ok(!/from ['"](?!node:|\.\.)[a-z@]/i.test(SOURCE), '出现第三方包导入');
  // 令牌正则动态取自 ci.yml 唯一权威规则：本文件与被测模块都不得复制真实数据字面量，
  // 否则 T-021 的 privacy.static_scan 会正确判定为命中（先红阶段已实测）。
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const matched = /const TOKENS = \/(.+?)\/;/.exec(ci);
  assert.ok(matched, 'ci.yml 的唯一权威令牌规则缺失');
  assert.ok(!new RegExp(matched[1]).test(SOURCE), '门禁源码复制了真实数据令牌字面量');
});

test('T-022 · 六项门禁不是恒真总开关：每项都绑定独立取证变量', () => {
  const bindings = [
    "check('gate.scenarios_faithful', faithful,",
    "check('gate.core_capabilities', dirsOk,",
    "check('gate.offline_integration', offline.ok === true && offline.checks.length === 14,",
    "check('gate.static_privacy', privacyOk,",
    "check('gate.no_silent_green', noGreen && noWriteApi,",
    "check('gate.traceability', traceable,",
  ];
  for (const b of bindings) assert.ok(SOURCE.includes(b), `门禁取证被弱化: ${b}`);
  for (const c of report.checks) assert.ok(c.detail.length > 10, `${c.id} 无取证明细`);
});

test('T-022 · 报告 status 与 verdict 一致，且基线零改动', () => {
  assert.equal(lines.at(-1), report.verdict === 'PASS' ? 'status=ok' : 'status=blocked');
  assert.equal(report.baselineTouched, 0);
  assert.ok(lines.includes('baseline_touched=0'));
});

test('T-022 · 结论如实反映 P1 出口尚未达成，且不修改任何 ac-*.md 状态', () => {
  assert.equal(report.verdict, 'BLOCKED');
  assert.equal(report.baselineTouched, 0);
  assert.ok(report.rows.some((r) => r.status === AC_STATUS.GAP));
  assert.ok(report.rows.some((r) => r.status === AC_STATUS.CORE));
});
