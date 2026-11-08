// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-021 · 离线集成用例单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-021；SPEC.md FR-028 / FR-047 / FR-048 / FR-051 / FR-053、
 * AC-12 / AC-17、SC-008 / SC-013 / SC-014、NFR-001 / NFR-009；plan.md §4 / §9。
 *
 * 主产出在 `tests/acceptance/offline-integration.mjs`（**不叫 `*.test.js`**：
 * `tasks.md §2` 与 `tests/acceptance/README.md` 明令 AC 驱动不得被 `node --test` 自动发现）。
 * 本文件是它的门禁入口，被 `npm test` 自动发现，从而让 CI 的 unit job 真正覆盖离线集成。
 *
 * 「断网 + LLM 关闭 + 网络端口禁用」做成三件可证的事，而不是一句断言：
 * 1. **缺席模式**：deps 里根本没有 netPort / llmPort，五级计划照常产出；
 * 2. **哨兵模式**：注入「一调用即违规并抛错」的禁用端口，全链路必须零触碰；
 * 3. **字节一致**：两种模式的五份计划正文完全相同 —— 证明核心链路对外部服务零依赖。
 *
 * 全部身体数值取自 `examples/profiles/` 的**完全虚构**档案（P-14）；日志、CLI 输出、
 * 计划正文、示例与仓库静态扫描均不得出现真实个人数据。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

import {
  OFFLINE_LEVELS,
  AC12_LEVELS,
  OFFLINE_MODES,
  createOfflineHarness,
  runOfflineIntegration,
  formatReport,
} from '../acceptance/offline-integration.mjs';

const INTEGRATION = new URL('../acceptance/offline-integration.mjs', import.meta.url);

/** 虚构档案的私有字段：日志 / CLI 输出 / 计划正文都不得携带。 */
const PRIVATE_SENTINELS = Object.freeze([
  'FIX-GLOBAL-AVG-M-01', 'body_fat_pct', 'muscle_kg', 'water_pct', 'bone_kg',
]);

let cached = null;
/** 集成用例是纯函数式装配（只读仓库、零落盘），可安全复用同一份报告。 */
async function report() {
  if (cached === null) cached = await runOfflineIntegration();
  return cached;
}

const byId = (r, id) => r.checks.find((check) => check.id === id);
const expectCheck = (r, id) => {
  const check = byId(r, id);
  assert.ok(check, `缺少门禁 ${id}`);
  assert.equal(check.ok, true, `${id} 未通过：${check.detail}`);
  return check;
};

// ------------------------------------------------------------- 口径与形态

test('T-021 · 离线层级与模式是固定契约（NFR-001 / AC-12 / AC-17）', () => {
  assert.deepEqual([...OFFLINE_LEVELS], ['year', 'season', 'month', 'week', 'day']);
  assert.deepEqual([...AC12_LEVELS], ['month', 'week', 'day']);
  assert.deepEqual([...OFFLINE_MODES], ['absent', 'sentinel']);
  assert.ok(Object.isFrozen(OFFLINE_LEVELS));
  assert.ok(Object.isFrozen(AC12_LEVELS));
  assert.ok(Object.isFrozen(OFFLINE_MODES));
});

test('T-021 · 集成用例落在 tests/acceptance/ 且不违反 *.test.js 命名护栏（tasks.md §2）', () => {
  const text = readFileSync(INTEGRATION, 'utf8');
  assert.match(text.split('\n')[0], /^\/\/ SPDX-License-Identifier: GPL-3\.0-only$/);
  assert.ok(existsSync(new URL('../acceptance/offline-integration.mjs', import.meta.url)));
  assert.equal(existsSync(new URL('../acceptance/offline-integration.test.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../acceptance/offline-integration.test.mjs', import.meta.url)), false);
  assert.ok(/export async function runOfflineIntegration/.test(text), '必须导出可复用的集成入口');
});

test('T-021 · harness 提供缺席 / 哨兵两种端口装配，初始零违规（FR-051 / NFR-009）', () => {
  for (const mode of OFFLINE_MODES) {
    const harness = createOfflineHarness({ mode });
    assert.ok(harness.fsPort, `${mode} 需要内存文件端口`);
    assert.ok(harness.logPort, `${mode} 需要日志端口`);
    assert.deepEqual(harness.violations, [], `${mode} 初始不得有违规`);
    assert.equal(harness.llmEnabled, false, 'LLM 默认关闭');
    if (mode === 'absent') {
      assert.equal(harness.deps.netPort, undefined, '缺席模式不得注入网络端口');
      assert.equal(harness.deps.llmPort, undefined, '缺席模式不得注入 LLM 端口');
    } else {
      assert.equal(typeof harness.deps.netPort.download, 'function', '哨兵模式需要禁用网络哨兵');
      assert.equal(typeof harness.deps.llmPort.complete, 'function', '哨兵模式需要禁用 LLM 哨兵');
    }
  }
});

// ------------------------------------------------------------- 离线端到端

test('T-021 · 断网下年 / 季 / 月 / 周 / 日五级计划全部成功产出（AC-17 / NFR-001）', async () => {
  const r = await report();
  expectCheck(r, 'levels.all_generated');
  for (const mode of OFFLINE_MODES) {
    for (const level of OFFLINE_LEVELS) {
      const plan = r.plans[mode][level];
      assert.ok(plan, `${mode}/${level} 缺计划`);
      assert.equal(plan.exit, 0, `${mode}/${level} 退出码必须为 0`);
      assert.equal(plan.status, 'ok', `${mode}/${level} 状态必须为 ok`);
      assert.ok(plan.file.startsWith('plans/'), `${mode}/${level} 必须落在 plans/`);
      assert.ok(plan.text.length > 0, `${mode}/${level} 正文不得为空`);
    }
  }
});

test('T-021 · AC-12 的月 / 周 / 日三份计划在断网 + 已有当年缓存下成功（AC-12 / SC-008）', async () => {
  const r = await report();
  expectCheck(r, 'ac12.month_week_day');
  for (const mode of OFFLINE_MODES) {
    for (const level of AC12_LEVELS) {
      assert.equal(r.plans[mode][level].exit, 0, `${mode}/${level} 应成功`);
    }
  }
});

test('T-021 · 全程零对外请求：缺席模式与哨兵模式皆然（SC-008 / FR-047）', async () => {
  const r = await report();
  expectCheck(r, 'network.zero_requests');
  for (const mode of OFFLINE_MODES) {
    assert.deepEqual(r.requests[mode], [], `${mode} 不得产生任何请求`);
    assert.deepEqual(r.violations[mode].filter((v) => v.startsWith('net.')), [],
      `${mode} 网络哨兵不得被触碰`);
  }
});

test('T-021 · LLM 关闭且核心链路零 LLM 依赖（FR-051 / NFR-009 / E-16）', async () => {
  const r = await report();
  expectCheck(r, 'llm.disabled');
  for (const mode of OFFLINE_MODES) {
    assert.deepEqual(r.violations[mode].filter((v) => v.startsWith('llm.')), [],
      `${mode} LLM 哨兵不得被触碰`);
  }
  assert.deepEqual(r.staticScan.llmRefs, [], '实现源码不得出现 LLM 端口引用');
});

test('T-021 · 两种离线模式产出的计划正文逐字节一致（供应商中立 NFR-009）', async () => {
  const r = await report();
  expectCheck(r, 'determinism.modes_equal');
  for (const level of OFFLINE_LEVELS) {
    assert.equal(r.plans.absent[level].text, r.plans.sentinel[level].text,
      `${level} 计划不得受网络 / LLM 端口有无影响`);
  }
});

test('T-021 · 核心功能完整：规范数据区 / 三类通知 / 九项处方 / 护栏 / 版本齐备（FR-028）', async () => {
  const r = await report();
  expectCheck(r, 'plans.complete');
  for (const level of OFFLINE_LEVELS) {
    const text = r.plans.absent[level].text;
    assert.ok(text.includes('```rr-data'), `${level} 缺规范数据区`);
    assert.ok(text.includes('[AIGC]'), `${level} 缺 AIGC 标记`);
    assert.ok(text.includes('plan.notice.disclaimer'), `${level} 缺失责声明`);
    assert.ok(text.includes('plan.notice.estimated'), `${level} 缺估算声明`);
    assert.ok(text.includes('guardrail.energy_floor_kcal='), `${level} 缺热量护栏`);
    assert.ok(text.includes('guardrail.protein_floor_g='), `${level} 缺蛋白护栏`);
    for (const field of ['energy_kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g',
      'water_ml', 'salt_g', 'oil_g', 'added_sugar_g']) {
      assert.ok(text.includes(`rx.${field}.min=`), `${level} 缺处方 ${field}.min`);
      assert.ok(text.includes(`rx.${field}.max=`), `${level} 缺处方 ${field}.max`);
    }
    for (const key of ['body', 'rx', 'loc', 'st', 'rule']) {
      assert.ok(text.includes(`version.${key}=`), `${level} 缺版本 ${key}`);
    }
  }
});

test('T-021 · 全链路核心命令在离线装配下仍可用（SC-009 / AC-17）', async () => {
  const r = await report();
  expectCheck(r, 'commands.offline_ok');
  assert.equal(r.validateChecked, 28, 'rr validate 规范数据区复算 28 项');
  assert.ok(r.exportFiles > 0, 'export-data 必须导出到本地文件');
  assert.equal(r.deleteStatus.residue, 0, 'delete-data 后必须零残留');
  for (const mode of OFFLINE_MODES) {
    const labels = r.commands.filter((c) => c.mode === mode).map((c) => c.label);
    for (const label of ['init', 'plan.year', 'plan.season', 'plan.month', 'plan.week',
      'plan.day', 'validate', 'ledger', 'export-data', 'delete-data', 'acceptance']) {
      assert.ok(labels.includes(label), `${mode} 缺命令 ${label}`);
    }
    for (const command of r.commands.filter((c) => c.mode === mode)) {
      assert.equal(command.exit, 0, `${mode}/${command.label} 必须成功`);
    }
  }
});

// ------------------------------------------------------------- 隐私与静态扫描

test('T-021 · CLI 输出行与日志行零身体数据、日志行零数字（FR-047 / FR-049 / P-14）', async () => {
  const r = await report();
  expectCheck(r, 'privacy.output_and_logs');
  const out = r.cliLines.join('\n');
  const logs = r.logs.join('\n');
  for (const sentinel of PRIVATE_SENTINELS) {
    assert.ok(!out.includes(sentinel), `CLI 输出不得含 ${sentinel}`);
    assert.ok(!logs.includes(sentinel), `日志不得含 ${sentinel}`);
  }
  assert.ok(!/\d/.test(logs), '日志行零数字（T-020 类型层门禁）');
  for (const line of r.cliLines) {
    assert.match(line, /^[a-z][a-z0-9._-]*=[\x20-\x7E]*$/, `输出行格式非法：${line}`);
  }
});

test('T-021 · 计划正文不携带私有身体字段，BMR 作为护栏下限属有意保留（FR-002 / P-14）', async () => {
  const r = await report();
  expectCheck(r, 'privacy.plan_bodies');
  for (const level of OFFLINE_LEVELS) {
    const text = r.plans.absent[level].text;
    for (const sentinel of PRIVATE_SENTINELS) {
      assert.ok(!text.includes(sentinel), `${level} 计划不得含 ${sentinel}`);
    }
    assert.ok(text.includes('guardrail.energy_floor_kcal='), `${level} 应保留 BMR 护栏下限`);
  }
});

test('T-021 · 静态扫描：示例虚构、真实数据零命中、个人档案被忽略（FR-053 / AC-12）', async () => {
  const r = await report();
  expectCheck(r, 'privacy.static_scan');
  assert.equal(r.privacy.fixtureFictional, true, '示例档案必须显式标记 fictional');
  assert.equal(r.privacy.fixtureNoRealPerson, true, '示例档案必须声明 real_person_data=false');
  assert.equal(r.privacy.ignoreProfiles, true, '.gitignore 必须排除 /profiles/');
  assert.deepEqual(r.privacy.dietPlanDirs, [], '仓库内不得出现 diet-plan 数据目录');
  assert.deepEqual(r.privacy.tokensHit, [], '仓库文本文件不得命中真实数据令牌');
});

test('T-021 · 静态扫描：实现源码零网络出口、零在线翻译 / LLM 入口（FR-048 / FR-051）', async () => {
  const r = await report();
  expectCheck(r, 'static.zero_external_exits');
  assert.deepEqual(r.staticScan.networkExits, [], 'src/ 不得出现 fetch / http(s) 客户端');
  assert.deepEqual(r.staticScan.llmRefs, [], 'src/ 不得出现 LLM 端口引用');
  assert.equal(r.staticScan.onlineTranslation, 0, 'src/ 不得出现在线翻译入口');
});

test('T-021 · 节气 / 季节数据下载 URL 不得携带个人参数（FR-048 / AC-17）', async () => {
  const r = await report();
  expectCheck(r, 'static.calendar_url_safe');
  assert.equal(r.calendarUrl.rejectsQuery, true, '带 query 的 URL 必须被拒');
  assert.equal(r.calendarUrl.rejectsFragment, true, '带 fragment 的 URL 必须被拒');
  assert.equal(r.calendarUrl.rejectsUserinfo, true, '带凭据的 URL 必须被拒');
  assert.equal(r.calendarUrl.rejectsHttp, true, '非 HTTPS 必须被拒');
  assert.equal(r.calendarUrl.acceptsCleanHttps, true, '纯 HTTPS 静态 URL 应放行');
});

test('T-021 · 未逐次显式同意时无任何外部传输（AC-17 第三段）', async () => {
  const r = await report();
  expectCheck(r, 'consent.no_transfer');
  assert.equal(r.consent.granted, false, '集成用例默认不授予任何同意');
  assert.deepEqual(r.consent.transfers, [], '不得发生任何对外传输');
});

test('T-021 · export-data / delete-data 在断网下可用且删除后无残留（AC-17 第二段）', async () => {
  const r = await report();
  expectCheck(r, 'data_subject.offline');
  assert.equal(r.export.version, 1, '导出格式版本为 1');
  assert.ok(r.export.files > 0, '导出必须含本地数据条目');
  assert.equal(r.deleteStatus.deleted > 0, true, '必须真实删除过文件');
  assert.equal(r.deleteStatus.residue, 0, '删除后清单必须为空');
  assert.equal(r.deleteStatus.programDataKept, true, '内置程序数据不得被删');
});

test('T-021 · 集成用例零磁盘写入：仓库工作树不被改动（P-14 / FR-047）', async () => {
  const r = await report();
  assert.equal(r.diskWrites, 0, '集成用例只能用内存文件端口');
  for (const mode of OFFLINE_MODES) {
    assert.ok(r.commands.some((c) => c.mode === mode && c.label.startsWith('plan.')),
      `${mode} 应确实执行过计划生成`);
  }
});

test('T-021 · 报告格式确定：纯 ASCII key=value、同输入两次一致（FR-028）', async () => {
  const r = await report();
  const a = formatReport(r);
  const b = formatReport(await runOfflineIntegration());
  assert.equal(a, b, '报告必须确定可 diff');
  assert.match(a, /^status=ok$/m);
  for (const line of a.split('\n').filter(Boolean)) {
    assert.match(line, /^[a-z][a-z0-9._-]*=[\x20-\x7E]*$/, `报告行格式非法：${line}`);
  }
  assert.ok(a.includes('levels=5'));
  assert.ok(a.includes('requests=0'));
  assert.ok(a.includes('llm_calls=0'));
});

test('T-021 · 每一条门禁都必须有独立取证，不允许只靠总开关（P-09 防绕过）', async () => {
  const r = await report();
  assert.ok(r.checks.length >= 12, '门禁条目数不足');
  assert.equal(r.ok, r.checks.every((check) => check.ok), '总开关必须与逐项结论一致');
  const ids = r.checks.map((check) => check.id);
  assert.equal(new Set(ids).size, ids.length, '门禁 ID 不得重复');
  for (const check of r.checks) {
    assert.match(check.id, /^[a-z][a-z0-9._-]*$/);
    assert.equal(typeof check.detail, 'string');
  }
  assert.equal(r.ok, true);
});

// ------------------------------------------------ 独立取证（防「零触碰 / 空扫描」假绿）

test('T-021 · 禁用哨兵必须真的拒绝并留痕，而不是「恰好没被调用」（P-09 / FR-051）', async () => {
  const net = createOfflineHarness({ mode: 'sentinel' });
  await assert.rejects(() => net.deps.netPort.download('https://a.example/terms'),
    /ERR_T021_NETWORK_DISABLED/);
  assert.deepEqual(net.violations, ['net.download'], '网络尝试必须留稳定违规码');
  assert.equal(net.deps.netPort.requests().length, 1, '哨兵必须如实记录每一次尝试');

  const llm = createOfflineHarness({ mode: 'sentinel' });
  await assert.rejects(() => llm.deps.llmPort.complete(), /ERR_T021_LLM_DISABLED/);
  await assert.rejects(() => llm.deps.llmPort.generate(), /ERR_T021_LLM_DISABLED/);
  await assert.rejects(() => llm.deps.translationPort.translate(), /ERR_T021_TRANSLATION_DISABLED/);
  assert.equal(llm.deps.llmPort.enabled(), false, 'LLM 增强默认关闭');
  assert.deepEqual(llm.violations, ['llm.complete', 'llm.generate', 'translation.translate']);
});

test('T-021 · 静态扫描确实覆盖全仓与全部实现源码，不是空扫（FR-053 / P-09）', async () => {
  const r = await report();
  assert.ok(r.privacy.scannedFiles >= 60, `仓库扫描文件数过少：${r.privacy.scannedFiles}`);
  assert.ok(r.staticScan.scannedFiles >= 40, `源码扫描文件数过少：${r.staticScan.scannedFiles}`);

  const root = new URL('../../src/', import.meta.url);
  const countFiles = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, entry) => {
    if (entry.isDirectory()) return n + countFiles(new URL(`${entry.name}/`, dir));
    return n + (entry.name.endsWith('.js') ? 1 : 0);
  }, 0);
  const expected = countFiles(new URL('core/', root)) + countFiles(new URL('cli/', root));
  assert.equal(r.staticScan.scannedFiles, expected, '源码扫描范围必须与 src/core + src/cli 完全一致');
});

test('T-021 · 集成用例源码不具备任何磁盘写入能力（FR-047 / P-14）', () => {
  const text = readFileSync(INTEGRATION, 'utf8');
  for (const api of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync',
    'unlinkSync', 'createWriteStream', 'writeFile(', 'appendFile(']) {
    assert.ok(!text.includes(api), `集成用例不得具备磁盘写入能力：${api}`);
  }
});
