// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-010 · loadProfile(path, fsPort) 单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-010 / SPEC.md FR-001, E-08, AC-01, AC-12, SC-014；
 * 数据契约：plan.md §5.1；IO 注入：plan.md §3 / §10。
 * 本文件只做核心域单元测试，不改变任何 AC 红态基线（AC-01 / AC-12 仍为 RED）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { createLocalFsPort, ERR } from '../../src/io/index.js';
import { createMemoryFs } from '../fixtures/index.js';
import {
  loadProfile,
  parseProfile,
  compareVersions,
  VERSION_KINDS,
  PROFILE_ERROR,
  ProfileValidationError,
} from '../../src/core/profile/index.js';

const EXAMPLES_DIR = fileURLToPath(new URL('../../examples/profiles/', import.meta.url));

/** 完全虚构的最小合法 Profile（数值取自 AC-01 Given 的虚构示例量级）。 */
function baseProfile() {
  return {
    schema_version: '0.1.0-fixture',
    body: {
      height_cm: 168,
      weight_kg: 65,
      bmi: 23,
      body_fat_pct: 20,
      water_pct: 56,
      bmr_kcal: 1450,
      muscle_kg: 49,
      bone_kg: 2.6,
      protein_pct: 19.5,
      age_years: 30,
      sex: 'male',
    },
    nutrition_rx: {
      energy_kcal: [1550, 1700],
      protein_g: [88, 100],
      floor_rule: 'energy_kcal.min >= body.bmr_kcal',
    },
    goal: { type: 'maintain', note_key: 'goal.maintain.fictional' },
    locale_policy: {
      declared_nationality: null,
      declared_residence: null,
      output_language: 'en',
      expected_source: 'auto:fallback',
    },
    privacy: {
      storage: 'local-only',
      upload: false,
      telemetry: false,
      real_person_data: false,
    },
  };
}

/** @param {unknown} value */
function isProfileError(value) {
  return value instanceof ProfileValidationError;
}

test('T-010 · 两份完全虚构 fixture 可由 loadProfile 读取（AC-01 / AC-15 / AC-16 Given）', async () => {
  const fs = createLocalFsPort({ root: EXAMPLES_DIR });
  const male = await loadProfile('global-average-male.json', fs);
  const female = await loadProfile('global-average-female.json', fs);

  assert.equal(male.fixture_id, 'FIX-GLOBAL-AVG-M-01');
  assert.equal(male.body.bmr_kcal, 1450);
  assert.deepEqual(male.nutrition_rx.energy_kcal, [1550, 1700]);
  assert.deepEqual(male.nutrition_rx.protein_g, [88, 100]);
  assert.equal(female.fixture_id, 'FIX-GLOBAL-AVG-F-01');
  assert.equal(female.locale_policy.output_language, 'la');
  assert.equal(female.locale_policy.expected_source, 'user');
  assert.equal(male.fictional, true);
  assert.equal(female.fictional, true);
});

test('parseProfile 是纯函数：返回规范化 Profile 且不修改输入对象', () => {
  const raw = baseProfile();
  const before = structuredClone(raw);
  const profile = parseProfile(raw);
  assert.deepEqual(raw, before, '输入对象不得被原地改写');
  assert.notEqual(profile, raw);
  assert.equal(profile.schema_version, '0.1.0-fixture');
  assert.equal(profile.body.bmr_kcal, 1450);
});

test('versions 缺省补 fixture-* 默认值并显式标注，不猜测最后更新日期', () => {
  const profile = parseProfile(baseProfile());
  assert.equal(profile.versioning.source, 'fixture-default');
  assert.deepEqual(profile.versioning.defaulted, [...VERSION_KINDS, 'rule']);
  assert.deepEqual(
    VERSION_KINDS,
    ['body', 'rx', 'loc', 'st'],
    '四类数据版本：身体 / 处方 / 居住地 / 节气（FR-001 / plan.md §5.1）',
  );
  assert.equal(profile.versions.body.id, 'fixture-body');
  assert.equal(profile.versions.st.id, 'fixture-st');
  assert.equal(profile.versions.body.updated_at, null, 'E-08：不得用猜测值填充');
  assert.equal(profile.versions.body.defaulted, true);
});

test('显式声明的五类版本（四数据 + rule）可解析，updated_at 为 ISO 日期', () => {
  const raw = baseProfile();
  raw.versions = {
    body: { id: 'body-2026-11-01', updated_at: '2026-11-01' },
    rx: { id: 'rx-2026-11-01', updated_at: '2026-11-01' },
    loc: { id: 'loc-2026-10-20', updated_at: '2026-10-20' },
    st: { id: 'st-2026-01-01', updated_at: '2026-01-01' },
    rule: { id: 'rule-0.1.0', updated_at: '2026-11-01' },
  };
  const profile = parseProfile(raw);
  assert.equal(profile.versioning.source, 'declared');
  assert.deepEqual(profile.versioning.defaulted, []);
  assert.equal(profile.versions.rule.id, 'rule-0.1.0');
  assert.equal(profile.versions.body.defaulted, false);
});

test('四类版本号比对返回发生变化的版本键（T-012 detectVersionChanges 的基础）', () => {
  const a = parseProfile(baseProfile()).versions;
  const b = structuredClone(a);
  b.rx.id = 'rx-2026-11-08';
  b.loc.updated_at = '2026-11-08';
  assert.deepEqual(compareVersions(a, b), ['rx', 'loc']);
  assert.deepEqual(compareVersions(a, structuredClone(a)), []);
});

test('versions 只给一部分时一律拒绝，不得用猜测值补齐其余项（E-08）', () => {
  const raw = baseProfile();
  raw.versions = { body: { id: 'body-2026-11-01', updated_at: '2026-11-01' } };
  assert.throws(
    () => parseProfile(raw),
    (error) => isProfileError(error) && error.issues.some((i) => i.code === PROFILE_ERROR.VERSION),
  );
});

test('E-08 · 缺 bmr_kcal 或非有限数值一律拒绝，不回填猜测值', () => {
  for (const bad of [undefined, null, '1450', Number.NaN, Number.POSITIVE_INFINITY]) {
    const raw = baseProfile();
    if (bad === undefined) delete raw.body.bmr_kcal;
    else raw.body.bmr_kcal = bad;
    assert.throws(
      () => parseProfile(raw),
      (error) => isProfileError(error) && error.issues.some((i) => i.code === PROFILE_ERROR.BMR_MISSING),
    );
  }
});

test('E-08 · 体脂明显越界一律拒绝（引擎物理可行性边界，非医学阈值）', () => {
  for (const pct of [-1, 0, 2.9, 70.1, 95, '20']) {
    const raw = baseProfile();
    raw.body.body_fat_pct = pct;
    assert.throws(
      () => parseProfile(raw),
      (error) => isProfileError(error) && error.issues.some((i) => i.code === PROFILE_ERROR.BODY_FAT_RANGE),
    );
  }
  for (const pct of [3, 20, 28, 70]) {
    const raw = baseProfile();
    raw.body.body_fat_pct = pct;
    assert.doesNotThrow(() => parseProfile(raw));
  }
});

test('E-08 · 能量下限低于 BMR 一律拒绝，且区间必须有序', () => {
  const below = baseProfile();
  below.nutrition_rx.energy_kcal = [1400, 1700];
  assert.throws(
    () => parseProfile(below),
    (error) => isProfileError(error) && error.issues.some((i) => i.code === PROFILE_ERROR.ENERGY_FLOOR),
  );

  const reversed = baseProfile();
  reversed.nutrition_rx.energy_kcal = [1700, 1550];
  assert.throws(
    () => parseProfile(reversed),
    (error) => isProfileError(error) && error.issues.some((i) => i.code === PROFILE_ERROR.SCHEMA),
  );

  const exact = baseProfile();
  exact.nutrition_rx.energy_kcal = [1450, 1700];
  assert.doesNotThrow(() => parseProfile(exact), '能量下限等于 BMR 合法');
});

test('E-08 · 非法 BCP 47 语言标签拒绝；语法合法但未内置的语言不拒绝（E-11 回退链）', () => {
  for (const bad of ['', 'zh_CN', '中文', '-en', 'en-', 'en--US', '1234', 'e', 42]) {
    const raw = baseProfile();
    raw.locale_policy.output_language = bad;
    assert.throws(
      () => parseProfile(raw),
      (error) => isProfileError(error) && error.issues.some((i) => i.code === PROFILE_ERROR.LANGUAGE_TAG),
      String(bad),
    );
  }
  for (const ok of ['en', 'zh-Hans', 'la', 'pt-BR', 'xx-Private']) {
    const raw = baseProfile();
    raw.locale_policy.output_language = ok;
    assert.doesNotThrow(() => parseProfile(raw), ok);
  }
});

test('E-08 · 非 ISO 3166-1 alpha-2 地区码拒绝；中国香港/澳门/台湾为中国的地区级合法条目', () => {
  for (const ok of ['CN', 'US', 'GB', 'FR', 'DE', 'RU', 'HK', 'MO', 'TW']) {
    const raw = baseProfile();
    raw.locale_policy.declared_nationality = ok;
    assert.doesNotThrow(() => parseProfile(raw), ok);
  }
  for (const bad of ['ZZ', 'XX', 'UK', 'EU', 'cn', 'ABC', 'C1', 42]) {
    const raw = baseProfile();
    raw.locale_policy.declared_residence = bad;
    assert.throws(
      () => parseProfile(raw),
      (error) => isProfileError(error) && error.issues.some((i) => i.code === PROFILE_ERROR.REGION_CODE),
      String(bad),
    );
  }
});

test('基础 schema 必填字段缺失一律拒绝（E-08 不得用猜测值填充）', () => {
  for (const [mutate, field] of [
    [(p) => delete p.schema_version, 'schema_version'],
    [(p) => delete p.body, 'body'],
    [(p) => delete p.nutrition_rx, 'nutrition_rx'],
    [(p) => delete p.locale_policy, 'locale_policy'],
    [(p) => delete p.privacy, 'privacy'],
    [(p) => delete p.nutrition_rx.floor_rule, 'nutrition_rx.floor_rule'],
  ]) {
    const raw = baseProfile();
    mutate(raw);
    assert.throws(
      () => parseProfile(raw),
      (error) => isProfileError(error) && error.issues.some((i) => i.code === PROFILE_ERROR.SCHEMA && i.field === field),
    );
  }
});

test('隐私字段声明不合规一律拒绝（FR-034 / SC-014）', () => {
  const raw = baseProfile();
  raw.privacy.upload = true;
  assert.throws(
    () => parseProfile(raw),
    (error) => isProfileError(error) && error.issues.some((i) => i.code === PROFILE_ERROR.PRIVACY),
  );
});

test('校验错误只含稳定码与字段路径，不含任何身体数值（FR-049 / plan.md §9）', () => {
  const raw = baseProfile();
  const probe = '87654';
  raw.body.body_fat_pct = 87654;
  raw.body.bmr_kcal = 87655;
  try {
    parseProfile(raw);
    assert.fail('应拒绝');
  } catch (error) {
    assert.ok(isProfileError(error));
    assert.ok(!error.message.includes(probe), '错误消息不得出现身体数值');
    assert.ok(!JSON.stringify(error.issues).includes('87655'));
    assert.match(error.message, /ERR_PROFILE_/);
    for (const issue of error.issues) {
      assert.match(issue.code, /^ERR_PROFILE_[A-Z_]+$/);
      assert.equal(typeof issue.field, 'string');
      assert.equal(typeof issue.hint, 'string');
    }
  }
});

test('loadProfile 只用注入的 fsPort：内存替身可加载，IO 错误码原样传播', async () => {
  const fs = createMemoryFs({ files: { 'profiles/demo.json': JSON.stringify(baseProfile()) } });
  const profile = await loadProfile('profiles/demo.json', fs);
  assert.equal(profile.body.bmr_kcal, 1450);
  assert.deepEqual(fs.writes(), [], '加载 Profile 不得写文件');

  await assert.rejects(
    () => loadProfile('missing.json', fs),
    (error) => error.code === ERR.FS_NOT_FOUND,
  );
  await assert.rejects(
    () => loadProfile('../outside.json', fs),
    (error) => error.code === ERR.FS_PATH_ESCAPE,
  );

  const broken = createMemoryFs({ files: { 'bad.json': '{not json' } });
  await assert.rejects(
    () => loadProfile('bad.json', broken),
    (error) => isProfileError(error) && error.issues.some((i) => i.code === PROFILE_ERROR.JSON),
  );
});

test('核心域无网络出口：不注入 netPort / clockPort 亦可确定性加载', async () => {
  const fs = createMemoryFs({ files: { 'p.json': JSON.stringify(baseProfile()) } });
  const first = await loadProfile('p.json', fs);
  const second = await loadProfile('p.json', fs);
  assert.deepEqual(first, second, '同一输入结果确定一致（plan.md §3 核心域确定性）');
});
