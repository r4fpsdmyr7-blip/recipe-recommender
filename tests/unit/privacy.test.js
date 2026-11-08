// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-020 · 数据主体权利命令单元测试（ATDD 红→绿）。
 *
 * 验收口径：tasks.md T-020；SPEC.md FR-047 / FR-048 / FR-049 / FR-050、AC-17、SC-013、NFR-002；
 * plan.md §6.2（`rr export-data` / `rr delete-data`）/ §9「数据位置 / 数据主体权利 / 日志与异常」；
 * constitution.md P-14。
 *
 * 三段可执行断言：
 * 1. **导出完整可读**：清单覆盖全部本地数据（含档案、台账、缓存、日志），不含程序数据
 *    （`data/guideline/` 属内置数据，不得混入用户导出，更不得被删除）。
 * 2. **删除无残留**：删除后数据清单为空，程序数据仍在；未显式 `--confirm` 时零删除。
 * 3. **零上传零遥测**：两条命令在断网端口下 `requests()` 恒为空；CLI 输出行与日志行
 *    均不含身体数值（日志只记事件与稳定码）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createMemoryFs, createStubNet } from '../fixtures/index.js';
import { createLogPort } from '../../src/io/index.js';
import {
  CLI_ERROR,
  EXIT,
  COMMANDS,
  COMMAND_OPTIONS,
  parseArgs,
  runCli,
} from '../../src/cli/index.js';
import {
  DATA_ROOT_FILES,
  DATA_DIRS,
  EXPORT_PATH,
  buildExportText,
  parseExportText,
  listDataFiles,
  isDataPath,
} from '../../src/cli/index.js';

const ROOT = new URL('../../', import.meta.url);
const ADAPTER = JSON.parse(readFileSync(new URL('data/guideline/generic-guideline.json', ROOT), 'utf8'));
const PROFILE_TEXT = readFileSync(new URL('examples/profiles/global-average-male.json', ROOT), 'utf8');

/** 虚构档案的特征值：CLI 输出行与日志行都不得出现（P-14 / FR-049）。 */
const BODY_SENTINELS = Object.freeze(['1450', 'FIX-GLOBAL-AVG-M-01', 'body_fat_pct']);

const CACHE_TEXT = [
  '# calendar-cache',
  'calendar_id=calendar-fixture-2026',
  'adapter_id=solar-terms',
  'adapter_version=v1',
  'kind=solar-terms',
  'year=2026',
  'status=verified',
  'version=v1',
  'downloaded_at=2026-01-01T00:00:00Z',
  'timezone=UTC+08:00',
  'source_count=2',
  'sources=https://a.example/t|https://b.example/t',
  'diff_vs_previous=none',
  'notice_keys=calendar.notice.estimated',
  '',
  '',
].join('\n');

/** 计划文件故意内嵌 3 个反引号的 `rr-data` 围栏，用于验证导出围栏长度自适应。 */
const PLAN_TEXT = ['# plan', '', '```rr-data', 'level=day', 'period_id=2026-11-07', '```', ''].join('\n');
const HISTORY_TEXT = ['# dedup-ledger',
  '| date | level | period_id | main_id | staple_id | combo_fp | version_ids | cycle_key | source |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 2026-11-02 | week | 2026-W45 | dish.a | staple.b | fp-1a2b3c4d | body:body-v1,rx:rx-v1,loc:loc-v1,st:st-v1,rule:rule-v1 | - | week_plan |',
  ''].join('\n');

/** 全部本地数据 + 程序数据（后者不得进入清单、不得被删）。 */
function workspace() {
  return createMemoryFs({
    files: {
      'profiles/local.json': PROFILE_TEXT,
      'data/guideline/generic-guideline.json': JSON.stringify(ADAPTER),
      'data/calendar/solar-terms-2026.md': CACHE_TEXT,
      'history.md': HISTORY_TEXT,
      'feedback.md': '# feedback-ledger\n',
      'changelog.md': '# changelog\n',
      'rr.config.json': '{"lang":"en","guideline":null,"calendar":null,"country":null}\n',
      'plans/2026-11-07.md': PLAN_TEXT,
      '_exports/old.md': '# old-export\n',
      'logs/run.log': 'level=info event=cli.plan code=ok\n',
    },
  });
}

/** 期望的完整数据清单（排序后的 POSIX 相对路径）。 */
const EXPECTED = Object.freeze([
  '_exports/old.md',
  'changelog.md',
  'data/calendar/solar-terms-2026.md',
  'feedback.md',
  'history.md',
  'logs/run.log',
  'plans/2026-11-07.md',
  'profiles/local.json',
  'rr.config.json',
]);

function deps(overrides = {}) {
  const fsPort = overrides.fsPort ?? workspace();
  const logPort = overrides.logPort ?? createLogPort();
  const netPort = overrides.netPort ?? createStubNet({ offline: true });
  return { fsPort, logPort, netPort, ...overrides };
}

const fields = (lines) => {
  const out = new Map();
  for (const line of lines) {
    const at = line.indexOf('=');
    if (at > 0) out.set(line.slice(0, at), [...(out.get(line.slice(0, at)) ?? []), line.slice(at + 1)]);
  }
  return out;
};
const one = (lines, key) => (fields(lines).get(key) ?? [])[0];

// ------------------------------------------------- FR-049 · 命令集与参数

test('T-020 · 数据主体命令进入命令集，越界命令仍不在册（FR-029 / FR-049）', () => {
  assert.deepEqual([...COMMANDS].sort(),
    ['acceptance', 'delete-data', 'export-data', 'init', 'ledger', 'plan', 'validate']);
  assert.deepEqual([...COMMAND_OPTIONS['export-data']], ['out']);
  assert.deepEqual([...COMMAND_OPTIONS['delete-data']], ['confirm']);
  for (const outOfScope of ['locales', 'serve-mcp', 'feedback']) {
    assert.ok(!COMMANDS.includes(outOfScope), `${outOfScope} 不属于 T-020`);
  }
});

test('T-020 · export-data 只接受 --out，delete-data 只接受 --confirm 旗标（FR-029）', () => {
  assert.deepEqual(parseArgs(['export-data']).options, {});
  assert.deepEqual(parseArgs(['export-data', '--out', 'x/e.md']).options, { out: 'x/e.md' });
  assert.deepEqual(parseArgs(['delete-data', '--confirm']).options, { confirm: true });

  for (const [argv, code] of [
    [['export-data', '--confirm'], CLI_ERROR.OPTION],
    [['delete-data', '--out', 'x.md'], CLI_ERROR.OPTION],
    [['delete-data', '--confirm=1'], CLI_ERROR.OPTION_VALUE],
    [['export-data', '--out', '/abs/e.md'], CLI_ERROR.OPTION_VALUE],
  ]) {
    let caught = null;
    try {
      parseArgs(argv);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught && caught.issues.some((issue) => issue.code === code), `${argv.join(' ')} 应报 ${code}`);
  }
});

// --------------------------------------------- FR-049 · 数据清单（inventory）

test('T-020 · 数据清单覆盖全部本地数据，且排除内置程序数据（FR-049 / SC-013）', async () => {
  const fsPort = workspace();
  assert.deepEqual(await listDataFiles(fsPort), EXPECTED);
  assert.deepEqual([...DATA_ROOT_FILES].sort(),
    ['changelog.md', 'daily-plan.md', 'feedback.md', 'history.md',
      'periodic-plan.md', 'rr.config.json', 'weekly-plan.md']);
  assert.deepEqual([...DATA_DIRS].sort(), ['_exports', 'data/calendar', 'logs', 'plans', 'profiles']);

  // 程序数据不在清单内：内置指南 / 区域映射 / 源码 / 规格文档。
  for (const path of ['data/guideline/generic-guideline.json', 'src/cli/index.js', 'SPEC.md', 'package.json']) {
    assert.equal(isDataPath(path), false, `${path} 不是用户数据`);
    assert.ok(!(await listDataFiles(fsPort)).includes(path));
  }
  // 到期缓存与导出产物属用户数据。
  for (const path of ['data/calendar/solar-terms-2026.md', '_exports/old.md', 'logs/run.log', 'plans/x.md']) {
    assert.equal(isDataPath(path), true, `${path} 是用户数据`);
  }

  // 端口可能「多给」：`list` 无视 relDir 把整棵树吐出来时，归属过滤必须仍然生效。
  // 否则一个宽松的 FsPort 就能让内置程序数据混进导出、并被 delete-data 删掉（SC-013）。
  const leaky = workspace();
  const overBroad = {
    ...leaky,
    list: async () => [...(await leaky.list(''))].sort(),
  };
  assert.deepEqual(await listDataFiles(overBroad), EXPECTED, '清单不因端口多给而膨胀');
  assert.ok(!(await listDataFiles(overBroad)).includes('data/guideline/generic-guideline.json'));
});

test('T-020 · 空工作区清单为空，不因目录缺失而失败（E-05 口径）', async () => {
  const empty = createMemoryFs({ files: { 'data/guideline/generic-guideline.json': JSON.stringify(ADAPTER) } });
  assert.deepEqual(await listDataFiles(empty), []);
});

// ------------------------------------------------ FR-049 · 一键导出可读格式

test('T-020 · export-data 默认导出到 _exports/rr-export.md，清单与内容完整（FR-049 / AC-17）', async () => {
  const fsPort = workspace();
  const res = await runCli(['export-data'], deps({ fsPort }));
  assert.equal(res.exit, EXIT.OK);
  assert.equal(one(res.lines, 'command'), 'export-data');
  assert.equal(one(res.lines, 'path'), EXPORT_PATH);
  assert.equal(one(res.lines, 'files'), String(EXPECTED.length));
  assert.equal(one(res.lines, 'status'), 'ok');

  const text = await fsPort.readText(EXPORT_PATH);
  const parsed = parseExportText(text);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.files.map((f) => f.path), EXPECTED);
  for (const entry of parsed.files) {
    assert.equal(entry.text, await fsPort.readText(entry.path), `${entry.path} 内容逐字节一致`);
  }
  // 可读性：单一 UTF-8 Markdown，每文件一节。
  assert.match(text, /^# rr-export$/m);
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), '单一结尾换行（FR-028）');
  assert.ok(!/\r/.test(text), '纯 LF');
});

test('T-020 · 导出含用户身体档案（用户主动导出），但 CLI 输出行与日志零身体数值（FR-047 / P-14）', async () => {
  const logPort = createLogPort();
  const fsPort = workspace();
  const res = await runCli(['export-data'], deps({ fsPort, logPort }));

  const text = await fsPort.readText(EXPORT_PATH);
  assert.ok(text.includes('FIX-GLOBAL-AVG-M-01'), '档案本体必须完整导出，否则用户拿不到自己的数据');
  assert.ok(text.includes('"bmr_kcal": 1450'), '身体数值随档案导出');

  const out = res.lines.join('\n');
  for (const sentinel of BODY_SENTINELS) assert.ok(!out.includes(sentinel), `CLI 输出不得含 ${sentinel}`);
  const logs = logPort.lines().join('\n');
  for (const sentinel of BODY_SENTINELS) assert.ok(!logs.includes(sentinel), `日志不得含 ${sentinel}`);
  assert.ok(!/\d/.test(logs), '日志行零数字');
  assert.deepEqual(logPort.lines(), ['level=info event=privacy.export code=ok']);
});

test('T-020 · 导出围栏长度自适应：内容含 ``` 时不截断、可无损反解析（FR-028）', async () => {
  const fsPort = workspace();
  await runCli(['export-data'], deps({ fsPort }));
  const text = await fsPort.readText(EXPORT_PATH);
  const parsed = parseExportText(text);
  const plan = parsed.files.find((f) => f.path === 'plans/2026-11-07.md');
  assert.ok(plan, '计划文件必须在导出中');
  assert.equal(plan.text, PLAN_TEXT);
  assert.ok(plan.text.includes('```rr-data'), '反引号内容未被围栏吃掉');

  // buildExportText 是最小可复现单元：单一文件也要能往返。
  const round = parseExportText(buildExportText([{ path: 'a.md', text: '```\nx\n```\n' }]));
  assert.deepEqual(round.files, [{ path: 'a.md', text: '```\nx\n```\n' }]);
});

test('T-020 · 导出确定：同输入两次字节一致，且不自我递归（FR-028）', async () => {
  const runOnce = async () => {
    const fsPort = workspace();
    await runCli(['export-data'], deps({ fsPort }));
    return fsPort.readText(EXPORT_PATH);
  };
  const a = await runOnce();
  const b = await runOnce();
  assert.equal(a, b);

  // 二次导出：旧导出在清单内，本次目标文件必须排除自己。
  const fsPort = workspace();
  await runCli(['export-data'], deps({ fsPort }));
  const second = await runCli(['export-data'], deps({ fsPort }));
  assert.equal(one(second.lines, 'files'), String(EXPECTED.length + 1), '上一次的导出属本地数据');
  const parsed = parseExportText(await fsPort.readText(EXPORT_PATH));
  assert.ok(!parsed.files.some((f) => f.path === EXPORT_PATH), '不得导出正在写入的自身');
});

test('T-020 · --out 支持子目录且不影响清单（FR-029）', async () => {
  const fsPort = workspace();
  const res = await runCli(['export-data', '--out', 'custom/deep/e.md'], deps({ fsPort }));
  assert.equal(res.exit, EXIT.OK);
  assert.equal(one(res.lines, 'path'), 'custom/deep/e.md');
  assert.equal(one(res.lines, 'files'), String(EXPECTED.length));
  const parsed = parseExportText(await fsPort.readText('custom/deep/e.md'));
  assert.deepEqual(parsed.files.map((f) => f.path), EXPECTED);
});

test('T-020 · 导出零对外请求、零遥测（FR-047 / SC-013）', async () => {
  const netPort = createStubNet({ offline: true });
  const res = await runCli(['export-data'], deps({ netPort }));
  assert.equal(res.exit, EXIT.OK);
  assert.deepEqual(netPort.requests(), []);
});

// -------------------------------------- FR-049 · 一键删除并校验无残留

test('T-020 · delete-data 缺 --confirm 时零删除（失败关闭，FR-049）', async () => {
  const fsPort = workspace();
  const before = fsPort.snapshot();
  const res = await runCli(['delete-data'], deps({ fsPort }));
  assert.equal(res.exit, EXIT.DOMAIN);
  assert.equal(one(res.lines, 'error'), CLI_ERROR.INVALID);
  assert.ok((fields(res.lines).get('issue') ?? []).some((v) => v.startsWith(`${CLI_ERROR.CONFIRM}:`)));
  assert.deepEqual([...fsPort.snapshot().keys()].sort(), [...before.keys()].sort(), '一个文件都不能少');
  assert.equal(fsPort.writes().length, 0, '未产生任何写入');
});

test('T-020 · delete-data --confirm 删净全部本地数据并复验无残留（FR-049 / AC-17）', async () => {
  const fsPort = workspace();
  const logPort = createLogPort();
  const res = await runCli(['delete-data', '--confirm'], deps({ fsPort, logPort }));

  assert.equal(res.exit, EXIT.OK);
  assert.equal(one(res.lines, 'command'), 'delete-data');
  assert.equal(one(res.lines, 'deleted'), String(EXPECTED.length));
  assert.equal(one(res.lines, 'residue'), '0');
  assert.equal(one(res.lines, 'status'), 'ok');

  assert.deepEqual(await listDataFiles(fsPort), [], '数据清单必须清空');
  for (const path of ['profiles/local.json', 'history.md', 'plans/2026-11-07.md',
    'data/calendar/solar-terms-2026.md', 'logs/run.log', '_exports/old.md']) {
    assert.equal(await fsPort.exists(path), false, `${path} 必须已删除（含缓存与日志）`);
  }
  // 程序数据保留：内置指南不是用户数据。
  assert.equal(await fsPort.exists('data/guideline/generic-guideline.json'), true);
  assert.deepEqual(logPort.lines(), ['level=info event=privacy.delete code=ok']);
});

test('T-020 · 删除复验失败关闭：remove 静默漏删时报错而非报告成功（FR-049 / SC-013）', async () => {
  // 故障注入：目录数据删不掉（模拟只读挂载 / 权限不足）。
  const fileSystem = workspace();
  const partial = {
    ...fileSystem,
    remove: async (relPath) => {
      if (!relPath.startsWith('data/')) await fileSystem.remove(relPath);
    },
  };
  const res = await runCli(['delete-data', '--confirm'], deps({ fsPort: partial }));

  assert.equal(res.exit, EXIT.DOMAIN, '有残留就不能退出 0');
  assert.equal(one(res.lines, 'status'), 'error');
  assert.ok((fields(res.lines).get('issue') ?? []).some((v) => v.startsWith(`${CLI_ERROR.RESIDUE}:`)),
    '必须以 ERR_CLI_RESIDUE 指明残留');
  assert.deepEqual(await listDataFiles(partial), ['data/calendar/solar-terms-2026.md'], '残留项仍可查');
});

test('T-020 · 删除幂等：二次执行 deleted=0 且不报错（FR-049）', async () => {
  const fsPort = workspace();
  assert.equal((await runCli(['delete-data', '--confirm'], deps({ fsPort }))).exit, EXIT.OK);
  const second = await runCli(['delete-data', '--confirm'], deps({ fsPort }));
  assert.equal(second.exit, EXIT.OK);
  assert.equal(one(second.lines, 'deleted'), '0');
  assert.equal(one(second.lines, 'residue'), '0');
});

test('T-020 · 删除零对外请求与零身体数值外泄（FR-047 / FR-048）', async () => {
  const netPort = createStubNet({ offline: true });
  const logPort = createLogPort();
  const res = await runCli(['delete-data', '--confirm'], deps({ netPort, logPort }));
  assert.equal(res.exit, EXIT.OK);
  assert.deepEqual(netPort.requests(), []);
  const out = res.lines.join('\n');
  for (const sentinel of BODY_SENTINELS) assert.ok(!out.includes(sentinel));
  assert.ok(!/\d/.test(logPort.lines().join('\n')));
});

test('T-020 · 导出→删除端到端：导出可用、删除后导出只剩空清单（AC-17）', async () => {
  const fsPort = workspace();
  const io = deps({ fsPort });

  const exported = await runCli(['export-data'], io);
  assert.equal(exported.exit, EXIT.OK);
  const first = parseExportText(await fsPort.readText(EXPORT_PATH));
  assert.equal(first.files.length, EXPECTED.length);

  const removed = await runCli(['delete-data', '--confirm'], io);
  assert.equal(removed.exit, EXIT.OK);
  assert.deepEqual(await listDataFiles(fsPort), []);

  const again = await runCli(['export-data'], io);
  assert.equal(again.exit, EXIT.OK);
  assert.equal(one(again.lines, 'files'), '0', '删除后不再有数据可导出');
  assert.deepEqual(parseExportText(await fsPort.readText(EXPORT_PATH)).files, []);
});

// --------------------------------------------------- 横切：源码与脱敏

test('T-020 · 数据命令源码零 `node:` 导入、SPDX 齐备、零硬编码 URL（P-11 / FR-048）', () => {
  const files = ['inventory.js', 'export-data.js', 'delete-data.js'];
  for (const file of files) {
    const text = readFileSync(new URL(`../../src/cli/${file}`, import.meta.url), 'utf8');
    assert.match(text.split('\n')[0], /^\/\/ SPDX-License-Identifier: GPL-3\.0-only$/, `${file} 缺 SPDX 头`);
    assert.ok(!/from\s+'node:/.test(text), `${file} 不得直接导入 node: 内置模块`);
    assert.ok(!/https?:\/\//.test(text), `${file} 不得硬编码外部 URL（FR-048）`);
    assert.ok(!/\bfetch\b/.test(text), `${file} 不得自带网络出口`);
  }
});

test('T-020 · 错误输出只含稳定码与 Canonical 字段，不含文件正文（P-14 / FR-049）', async () => {
  const fsPort = createMemoryFs({
    files: {
      'profiles/local.json': PROFILE_TEXT,
      'plans/secret.md': 'FIX-GLOBAL-AVG-M-01 bmr_kcal 1450\n',
    },
  });
  // 让导出目标指向一个不可写位置：用越界路径触发端口拒绝（不写任何文件）。
  const res = await runCli(['export-data', '--out', '../escape.md'], deps({ fsPort }));
  assert.equal(res.exit, EXIT.USAGE);
  const text = res.lines.join('\n');
  for (const sentinel of BODY_SENTINELS) assert.ok(!text.includes(sentinel));
  assert.ok(!text.includes('secret.md'));
  assert.ok(!/[\u4e00-\u9fff]/.test(text), '输出零自然语句');
});
