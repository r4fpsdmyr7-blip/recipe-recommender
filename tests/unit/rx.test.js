// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-011 · computeRx(body, guidelineAdapter) 单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-011 / SPEC.md FR-002 / FR-003 / FR-032、
 * AC-01 / AC-16 / SC-003、plan.md §4 / §6.1 / §8。
 * 依赖 T-010：用 loadProfile 加载两份虚构 fixture 后取其 body。
 * 本文件不改变任何 AC 红态基线（AC-01 / AC-16 仍为 RED）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createLocalFsPort, ERR } from '../../src/io/index.js';
import { createMemoryFs } from '../fixtures/index.js';
import { loadProfile } from '../../src/core/profile/index.js';
import { computeRx, RX_FIELDS } from '../../src/core/rx/index.js';
import {
  loadGuidelineAdapter,
  validateGuidelineAdapter,
  RX_ERROR,
  RxValidationError,
} from '../../src/core/guideline/index.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../../examples/profiles/', import.meta.url));
const DATA_FILE = 'data/guideline/generic-guideline.json';

/** 内联的中立通用基线（与仓库数据文件同构，便于构造自定义适配器）。 */
function baseAdapter() {
  return {
    id: 'generic-guideline',
    version: '0.1.0',
    source: 'neutral-baseline',
    notice_key: 'guideline.generic.neutral_baseline',
    coefficients: {
      energy_factor: [1.1, 1.15],
      protein_g_per_kg: [1.4, 1.5],
      fat_energy_ratio: [0.25, 0.3],
      carb_energy_ratio: [0.45, 0.55],
      fiber_g: [25, 30],
      water_ml_per_kg: [30, 35],
    },
    protein_floor_g_per_kg: 1.2,
    targets: { salt_g: [0, 4.5], oil_g: [25, 30], added_sugar_g: [0, 20] },
    limits: { salt_g_max_exclusive: 5, oil_g: [25, 30], added_sugar_g_max_exclusive: 25 },
  };
}

/** @param {Record<string, any>} overrides */
function customAdapter(overrides = {}) {
  return { ...structuredClone(baseAdapter()), ...overrides };
}

/** AC-01 Given 的虚构男性身体数据。 */
function maleBody() {
  return { bmr_kcal: 1450, weight_kg: 65, body_fat_pct: 20 };
}

const isRxError = (v) => v instanceof RxValidationError;

test('T-011 · 仓库中的中立通用基线数据文件可经 fsPort 加载且契约合法', async () => {
  const fs = createLocalFsPort({ root: ROOT });
  const adapter = await loadGuidelineAdapter(fs, 'generic-guideline');
  assert.equal(adapter.id, 'generic-guideline');
  assert.equal(adapter.source, 'neutral-baseline');
  assert.match(adapter.version, /^\d+\.\d+\.\d+/);
  assert.deepEqual(validateGuidelineAdapter(adapter), []);
});

test('T-011 · computeRx 推导九项处方（FR-002），AC-01 区间与 BMR 护栏对齐', () => {
  const rx = computeRx(maleBody(), baseAdapter());
  assert.deepEqual(RX_FIELDS, [
    'energy_kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g',
    'water_ml', 'salt_g', 'oil_g', 'added_sugar_g',
  ]);
  for (const key of RX_FIELDS) {
    assert.ok(Array.isArray(rx[key]) && rx[key].length === 2, `${key} 应为 [min,max]`);
    assert.ok(rx[key][0] <= rx[key][1], `${key} 区间须有序`);
  }
  assert.ok(rx.energy_kcal[0] >= 1550 && rx.energy_kcal[1] <= 1700, 'AC-01：能量落在 1550–1700');
  assert.ok(rx.energy_kcal[0] >= 1450, 'AC-01：能量不低于 BMR 1450');
  assert.ok(rx.protein_g[0] >= 88 && rx.protein_g[1] <= 100, 'AC-01：蛋白落在 88–100 g');
  assert.equal(rx.floor_rule, 'energy_kcal.min >= body.bmr_kcal');
});

test('T-011 · 输出当前生效指南适配器的对照表且盐/油/糖上限合规（AC-01 / FR-003）', () => {
  const rx = computeRx(maleBody(), baseAdapter());
  const c = rx.comparison;
  assert.equal(c.adapter_id, 'generic-guideline');
  assert.equal(c.adapter_version, '0.1.0');
  assert.equal(c.source, 'neutral-baseline', 'SC-012 / AC-16：来源可追溯');
  assert.deepEqual(c.violations, []);
  assert.equal(c.compliant, true);
  const row = (key) => c.rows.find((r) => r.key === key);
  for (const key of ['salt_g', 'oil_g', 'added_sugar_g']) {
    assert.ok(row(key), `对照表缺 ${key}`);
    assert.equal(row(key).status, 'within');
  }
  assert.ok(row('salt_g').max < 5, '盐 < 5 g');
  assert.equal(row('oil_g').min, 25);
  assert.equal(row('oil_g').max, 30);
  assert.ok(row('added_sugar_g').max < 25, '添加糖 < 25 g');
  assert.equal(rx.guideline.notice_key, 'guideline.generic.neutral_baseline');
});

test('T-011 · 能量低于 BMR 时强制抬升并留痕（FR-002 / SC-003）', () => {
  const low = customAdapter({
    coefficients: { ...baseAdapter().coefficients, energy_factor: [0.5, 0.6] },
  });
  const rx = computeRx(maleBody(), low);
  assert.equal(rx.guardrails.energy_adjusted, true);
  assert.ok(rx.energy_kcal[0] >= 1450, '护栏强制：总能量不得低于 BMR');
  assert.ok(rx.energy_kcal[1] >= rx.energy_kcal[0], '抬升后区间仍有序');
  assert.equal(rx.guardrails.energy_floor_kcal, 1450);
});

test('T-011 · 蛋白低于保肌下限时强制抬升并留痕（FR-002）', () => {
  const low = customAdapter({
    coefficients: { ...baseAdapter().coefficients, protein_g_per_kg: [0.5, 0.6] },
  });
  const rx = computeRx(maleBody(), low);
  assert.equal(rx.guardrails.protein_adjusted, true);
  assert.ok(rx.protein_g[0] >= rx.guardrails.protein_floor_g);
  assert.ok(rx.protein_g[1] >= rx.protein_g[0]);
});

test('T-011 · 指南适配器可插拔：换一个合规适配器即改变推导结果与来源标注（FR-003 / AC-16）', () => {
  const a = computeRx(maleBody(), baseAdapter());
  const other = customAdapter({
    id: 'user-baseline',
    version: '0.2.0',
    source: 'user-provided',
    coefficients: { ...baseAdapter().coefficients, energy_factor: [1.2, 1.3] },
  });
  const b = computeRx(maleBody(), other);
  assert.notDeepEqual(a.energy_kcal, b.energy_kcal);
  assert.equal(b.comparison.adapter_id, 'user-baseline');
  assert.equal(b.comparison.source, 'user-provided');
  assert.ok(b.energy_kcal[0] >= 1450, '换适配器后护栏仍生效');
});

test('T-011 · FR-032：指南数据文件只含量化指标，不含原文 / 图表 / 外部 URL', () => {
  const raw = JSON.parse(readFileSync(new URL(`../../${DATA_FILE}`, import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(raw).sort(), [
    'coefficients', 'id', 'limits', 'notice_key', 'protein_floor_g_per_kg',
    'source', 'targets', 'version',
  ].sort());
  const text = JSON.stringify(raw);
  assert.ok(!/https?:\/\//.test(text), '不得含外部 URL');
  assert.ok(!/[\u4e00-\u9fff]/.test(text), '不得含指南原文中文段落');
  assert.ok(!/\.(png|jpg|svg|pdf)/i.test(text), '不得含图表引用');
});

test('T-011 · 适配器契约校验拒绝存疑 / 越界 / 额外键（E-09 / FR-032）', () => {
  const bad = [
    customAdapter({ extra_prose: '指南第一章原文……' }),
    customAdapter({ targets: { ...baseAdapter().targets, salt_g: [0, 6] } }),
    customAdapter({ coefficients: { ...baseAdapter().coefficients, energy_factor: [1.5, 1.1] } }),
    (() => { const a = baseAdapter(); delete a.limits; return a; })(),
    customAdapter({ id: 'UPPER CASE' }),
  ];
  for (const adapter of bad) {
    assert.ok(validateGuidelineAdapter(adapter).length > 0);
    assert.throws(
      () => computeRx(maleBody(), adapter),
      (e) => isRxError(e) && e.issues.some((i) => i.code === RX_ERROR.ADAPTER),
    );
  }
});

test('T-011 · 加载器拒绝路径穿越并原样传播 IO 错误码', async () => {
  const fs = createMemoryFs();
  for (const id of ['../secret', 'a/b', '', 'A BC']) {
    await assert.rejects(
      () => loadGuidelineAdapter(fs, id),
      (e) => isRxError(e) && e.issues.some((i) => i.code === RX_ERROR.ADAPTER),
      String(id),
    );
  }
  await assert.rejects(
    () => loadGuidelineAdapter(fs, 'missing-guideline'),
    (e) => e.code === ERR.FS_NOT_FOUND,
  );
  const broken = createMemoryFs({ files: { [DATA_FILE]: '{not json' } });
  await assert.rejects(
    () => loadGuidelineAdapter(broken, 'generic-guideline'),
    (e) => isRxError(e) && e.issues.some((i) => i.code === RX_ERROR.JSON),
  );
});

test('T-011 · body 缺失必需数值一律拒绝，错误不含身体数值', () => {
  const probe = '98765';
  for (const body of [{ weight_kg: 65 }, { bmr_kcal: 1450 }, { bmr_kcal: 98765, weight_kg: 0 }]) {
    assert.throws(
      () => computeRx(body, baseAdapter()),
      (e) => isRxError(e) && e.issues.some((i) => i.code === RX_ERROR.BODY),
    );
  }
  try {
    computeRx({ bmr_kcal: 'not-a-number', weight_kg: 65 }, baseAdapter());
    assert.fail('应拒绝');
  } catch (e) {
    assert.ok(isRxError(e));
    assert.ok(!e.message.includes(probe));
    assert.match(e.message, /ERR_RX_/);
    for (const i of e.issues) {
      assert.match(i.code, /^ERR_RX_[A-Z_]+$/);
      assert.equal(typeof i.field, 'string');
      assert.match(i.hint, /^[a-z][a-z0-9._-]*$/);
    }
  }
});

test('T-011 · 与 T-010 衔接：两份虚构 fixture 的 body 均可推导且满足各自 BMR', async () => {
  const fs = createLocalFsPort({ root: EXAMPLES });
  const adapter = baseAdapter();
  for (const file of ['global-average-male.json', 'global-average-female.json']) {
    const profile = await loadProfile(file, fs);
    const rx = computeRx(profile.body, adapter);
    assert.ok(rx.energy_kcal[0] >= profile.body.bmr_kcal, file);
    assert.equal(rx.comparison.compliant, true, file);
    assert.equal(rx.guardrails.energy_floor_kcal, profile.body.bmr_kcal);
  }
});

test('T-011 · 纯函数、确定性、零 IO：不注入 fsPort / clock / net 即可复现', () => {
  const body = maleBody();
  const adapter = baseAdapter();
  const beforeBody = structuredClone(body);
  const beforeAdapter = structuredClone(adapter);
  const first = computeRx(body, adapter);
  const second = computeRx(body, adapter);
  assert.deepEqual(first, second);
  assert.deepEqual(body, beforeBody, '不得原地改写 body');
  assert.deepEqual(adapter, beforeAdapter, '不得原地改写适配器');
  assert.equal(first.guideline.id, 'generic-guideline');
});
