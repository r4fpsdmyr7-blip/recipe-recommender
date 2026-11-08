// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-012 · 版本变更检测与重算切分单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-012 / SPEC.md FR-004 / FR-005 / FR-014、E-04、
 * AC-05 / AC-06、SC-006、P-05、§9 不变式 3/4；plan.md §5.2 / §7.3。
 * 依赖 T-010（版本集合 / compareVersions）、T-011（computeRx）、
 * T-002（createFixedClock / createMemoryFs 确定性替身）。
 * 本文件不改变任何 AC 红态基线（AC-05 / AC-06 仍为 RED）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFixedClock, createMemoryFs } from '../fixtures/index.js';
import {
  detectVersionChanges,
  RECALC_ERROR,
  RecalcError,
} from '../../src/core/profile/index.js';
import {
  splitPlanFilesByDate,
  buildRecalcAnnotation,
  applyRecalcToFuture,
} from '../../src/core/planner/index.js';
import { computeRx } from '../../src/core/rx/index.js';

/** 完全虚构的版本集合；不引入任何真实身体数据。 */
function versions(tag = '2026-11-01') {
  return Object.fromEntries(
    ['body', 'rx', 'loc', 'st', 'rule'].map((k) => [k, `${k}-${tag}`]),
  );
}

function profile(tag = '2026-11-08') {
  const v = versions(tag);
  return {
    versions: Object.fromEntries(
      Object.entries(v).map(([k, id]) => [k, { id, updated_at: tag, defaulted: false }]),
    ),
  };
}

function header(tag = '2026-11-01', planDate = '2026-11-06') {
  return { period_id: '2026-W45', plan_date: planDate, versions: versions(tag) };
}

const RUN_DATE = '2026-11-06';
const clock = () => createFixedClock('2026-11-06T20:00:00+08:00');

function planFiles() {
  return [
    { path: 'plans/2026-11-05-daily.md', plan_date: '2026-11-05' },
    { path: 'plans/2026-11-06-daily.md', plan_date: '2026-11-06' },
    { path: 'plans/2026-11-07-daily.md', plan_date: '2026-11-07' },
    { path: 'plans/2026-11-08-daily.md', plan_date: '2026-11-08' },
  ];
}

function planStore() {
  return {
    'plans/2026-11-05-daily.md': '# 已执行计划 A\n',
    'plans/2026-11-06-daily.md': '# 运行日计划 B\n',
    'plans/2026-11-07-daily.md': '# 未来计划 C\n',
    'plans/2026-11-08-daily.md': '# 未来计划 D\n',
  };
}

const isRecalcError = (v) => v instanceof RecalcError;

test('T-012 · 身体数据 / 处方版本变更触发「已按新体测重算」（FR-004 / E-04）', () => {
  const current = profile('2026-11-08');
  current.versions.loc.id = 'loc-2026-11-01';
  current.versions.st.id = 'st-2026-11-01';
  current.versions.rule.id = 'rule-2026-11-01';
  const change = detectVersionChanges(current, header('2026-11-01'));
  assert.deepEqual(change.changed, ['body', 'rx']);
  assert.equal(change.needs_recalc, true);
  assert.deepEqual(change.reason_keys, ['plan.recalc.body']);
  assert.deepEqual(change.version_ids, {
    body: 'body-2026-11-08', rx: 'rx-2026-11-08',
  });
  assert.equal(change.source, 'E-04');
});

test('T-012 · 居住地 / 气候版本变更触发「已按新居住地重算」（FR-005 / FR-014 / AC-05）', () => {
  const current = profile('2026-11-01');
  current.versions.loc.id = 'loc-2026-11-08';
  current.versions.st.id = 'st-2026-11-08';
  const change = detectVersionChanges(current, header('2026-11-01'));
  assert.deepEqual(change.changed, ['loc', 'st']);
  assert.deepEqual(change.reason_keys, ['plan.recalc.residence']);
  assert.equal(change.version_ids.loc, 'loc-2026-11-08');
});

test('T-012 · 版本一致时不触发重算；rule 变化单独标注', () => {
  const same = detectVersionChanges(profile('2026-11-01'), header('2026-11-01'));
  assert.equal(same.needs_recalc, false);
  assert.deepEqual(same.changed, []);
  assert.deepEqual(same.reason_keys, []);

  const current = profile('2026-11-01');
  current.versions.rule.id = 'rule-2026-11-09';
  const r = detectVersionChanges(current, header('2026-11-01'));
  assert.deepEqual(r.changed, ['rule']);
  assert.deepEqual(r.reason_keys, ['plan.recalc.rule']);
});

test('T-012 · 计划头部 / 档案版本集合不合规一律拒绝，错误只含稳定码', () => {
  const bad = [
    [profile('2026-11-08'), { versions: { body: 'body-1' } }],
    [profile('2026-11-08'), { versions: { ...versions(), body: '' } }],
    [{}, header('2026-11-01')],
    [profile('2026-11-08'), null],
  ];
  for (const [p, h] of bad) {
    assert.throws(
      () => detectVersionChanges(p, h),
      (e) => isRecalcError(e) && e.issues.length > 0,
    );
  }
  try {
    detectVersionChanges(profile('2026-11-08'), { versions: { body: 'x' } });
    assert.fail('应拒绝');
  } catch (e) {
    assert.ok(isRecalcError(e));
    assert.match(e.message, /ERR_RECALC_/);
    assert.ok(!e.message.includes('98765'));
    for (const i of e.issues) {
      assert.match(i.code, /^ERR_RECALC_[A-Z_]+$/);
      assert.equal(typeof i.field, 'string');
      assert.match(i.hint, /^[a-z][a-z0-9._-]*$/);
    }
  }
});

test('T-012 · 按「计划日期 ≤ 运行日」切分，等号归历史（P-05 / AC-06）', () => {
  const before = structuredClone(planFiles());
  const { historical, future, run_date } = splitPlanFilesByDate(planFiles(), RUN_DATE);
  assert.equal(run_date, RUN_DATE);
  assert.deepEqual(historical.map((f) => f.plan_date), ['2026-11-05', '2026-11-06']);
  assert.deepEqual(future.map((f) => f.plan_date), ['2026-11-07', '2026-11-08']);
  assert.deepEqual(planFiles(), before, '纯函数不得改写输入');
});

test('T-012 · 非法日期 / 非法运行日一律拒绝（E-04 护栏前置）', () => {
  for (const d of ['2026-13-01', '2026-11-6', 'not-a-date', '']) {
    assert.throws(
      () => splitPlanFilesByDate([{ path: 'p.md', plan_date: d }], RUN_DATE),
      (e) => isRecalcError(e) && e.issues.some((i) => i.code === RECALC_ERROR.DATE),
      d,
    );
  }
  assert.throws(
    () => splitPlanFilesByDate(planFiles(), 'bad'),
    (e) => isRecalcError(e) && e.issues.some((i) => i.code === RECALC_ERROR.DATE),
  );
});

test('T-012 · 重算标注含原因 Canonical ID 与依据版本号，且为可 diff 的 ASCII 单行', () => {
  const change = detectVersionChanges(profile('2026-11-08'), header('2026-11-01'));
  const line = buildRecalcAnnotation(change);
  assert.match(line, /^<!-- rr-recalc /);
  assert.ok(!/[\r\n]/.test(line), '单行');
  assert.ok(/^[\x20-\x7E]+$/.test(line), '纯 ASCII');
  assert.ok(line.includes('plan.recalc.body'));
  assert.ok(line.includes('body-2026-11-08'));
  assert.ok(!line.includes('已按'), '面向人文案由 T-018 语言包渲染（P-11）');
});

test('T-012 · 仅未来计划被修改，历史文件逐字节不变（AC-06 / SC-006 / P-05）', async () => {
  const fs = createMemoryFs({ files: planStore() });
  const files = planFiles();
  const hashBefore = {};
  for (const f of files) hashBefore[f.path] = await fs.hash(f.path);
  const change = detectVersionChanges(profile('2026-11-08'), header('2026-11-01'));

  const result = await applyRecalcToFuture(fs, { clock: clock(), planFiles: files, change });

  assert.equal(result.run_date, RUN_DATE);
  assert.deepEqual(result.updated, [
    'plans/2026-11-07-daily.md', 'plans/2026-11-08-daily.md',
  ]);
  assert.deepEqual(result.untouched, [
    'plans/2026-11-05-daily.md', 'plans/2026-11-06-daily.md',
  ]);
  assert.deepEqual(fs.writes().map((w) => w.path).sort(), [...result.updated].sort(),
    '历史路径零写入');
  for (const path of result.untouched) {
    assert.equal(await fs.hash(path), hashBefore[path], `${path} 哈希不变`);
    assert.equal(await fs.readText(path), planStore()[path], `${path} 内容逐字节不变`);
  }
  for (const path of result.updated) {
    assert.match(await fs.readText(path), /^<!-- rr-recalc /, `${path} 头部含重算标注`);
    assert.ok((await fs.readText(path)).includes('# 未来'), '原正文保留');
  }
});

test('T-012 · 无需重算时零写入；重复重算不叠加标注行', async () => {
  const fs = createMemoryFs({ files: planStore() });
  const noChange = detectVersionChanges(profile('2026-11-01'), header('2026-11-01'));
  const none = await applyRecalcToFuture(fs, { clock: clock(), planFiles: planFiles(), change: noChange });
  assert.deepEqual(none.updated, []);
  assert.deepEqual(fs.writes(), []);

  const change = detectVersionChanges(profile('2026-11-08'), header('2026-11-01'));
  await applyRecalcToFuture(fs, { clock: clock(), planFiles: planFiles(), change });
  await applyRecalcToFuture(fs, { clock: clock(), planFiles: planFiles(), change });
  const text = await fs.readText('plans/2026-11-07-daily.md');
  assert.equal((text.match(/<!-- rr-recalc /g) ?? []).length, 1, '只保留一行标注');
});

test('T-012 · T-012 × T-011：版本变更后按新 body 重算处方仍不低于新 BMR（AC-06 Then 1）', async () => {
  const { readFileSync } = await import('node:fs');
  const adapter = JSON.parse(readFileSync(
    new URL('../../data/guideline/generic-guideline.json', import.meta.url), 'utf8',
  ));
  const newBody = { bmr_kcal: 1500, weight_kg: 66, body_fat_pct: 20 };
  const rx = computeRx(newBody, adapter);
  assert.ok(rx.energy_kcal[0] >= newBody.bmr_kcal, '重算后能量仍 ≥ 新 BMR');
  assert.equal(rx.guardrails.energy_floor_kcal, newBody.bmr_kcal);
  assert.equal(rx.comparison.compliant, true);
});

test('T-012 · 历史文件被意外改写时立即检出并抛 TIMELINE 错误', async () => {
  const fs = createMemoryFs({ files: planStore() });
  const originalHash = fs.hash.bind(fs);
  let calls = 0;
  fs.hash = async (path) => {
    calls += 1;
    // 模拟重算流程中历史文件被外部误改：第二次读取哈希时返回不同值。
    if (path.endsWith('2026-11-05-daily.md') && calls > 4) return 'tampered';
    return originalHash(path);
  };
  const change = detectVersionChanges(profile('2026-11-08'), header('2026-11-01'));
  await assert.rejects(
    () => applyRecalcToFuture(fs, { clock: clock(), planFiles: planFiles(), change }),
    (e) => isRecalcError(e) && e.issues.some((i) => i.code === RECALC_ERROR.TIMELINE),
  );
});

test('T-012 · 确定性：同一输入两次切分与重算结果一致，且错误不含身体数值', () => {
  const a = splitPlanFilesByDate(planFiles(), RUN_DATE);
  const b = splitPlanFilesByDate(planFiles(), RUN_DATE);
  assert.deepEqual(a, b);
  const change = detectVersionChanges(profile('2026-11-08'), header('2026-11-01'));
  assert.deepEqual(buildRecalcAnnotation(change), buildRecalcAnnotation(change));
  assert.ok(!JSON.stringify(change).includes('98765'));
});
