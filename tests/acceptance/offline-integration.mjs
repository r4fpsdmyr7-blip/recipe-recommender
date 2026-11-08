// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-021 · 离线集成用例（AC-12 / AC-17 / SC-008 / SC-013 / NFR-001 / NFR-009 / FR-051）。
 *
 * 这是 `tasks.md T-021` 的主产出：把 T-010～T-020 的既有能力用**注入端口**串成真实链路，
 * 在「断网 + LLM 关闭 + 网络端口禁用」下跑一遍完整核心功能，并给出可复现的门禁结论。
 * 本模块**不新增任何业务规则**，只做装配、观察与断言。
 *
 * 三条可证形式（不靠「恰好没发生」）：
 * 1. **缺席模式**：deps 里根本没有 netPort / llmPort，五级计划照常产出；
 * 2. **哨兵模式**：注入「一调用即违规并抛错」的网络 / LLM / 在线翻译禁用端口，全链路零触碰；
 * 3. **字节一致**：两种模式的五份计划正文逐字节相同 —— 核心链路对外部服务零依赖（FR-051 / NFR-009）。
 *
 * 硬约束：
 * - 命名不是 `*.test.js` / `*.test.mjs`（`tasks.md §2` / `tests/acceptance/README.md` 的护栏）：
 *   本模块由 `tests/unit/offline-integration.test.js` import 断言，也可独立 CLI 运行输出报告。
 * - **零磁盘写入**：文件一律走 `createMemoryFs`，本模块只 import `node:fs` 的读取类 API。
 * - 零第三方依赖；语言包 / 区域策略 / 验收执行器全部注入替身（T-031 / T-032 / T-004 边界），
 *   绝不预置 `locales/` 或内置区域映射表。
 * - **不改动 P0 基线**：`ac-*.md` 状态仍由 T-022 门禁及后续映射任务按 P-02 处理，本任务只提供
 *   AC-12 / AC-17 的可执行取证，不擅自把状态改为 GREEN。
 *
 * 用法：
 *   node tests/acceptance/offline-integration.mjs      # 输出稳定 key=value 报告，exit 0/1
 *   import { runOfflineIntegration } from './offline-integration.mjs';  # 供单测 / CI 复用
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { createFixedClock, createMemoryFs } from '../fixtures/index.js';
import { LANGUAGE_PACK_KEYS } from '../../src/core/render/index.js';
import { createLogPort } from '../../src/io/index.js';
import { assertSafeCalendarUrl } from '../../src/io/net.js';
import {
  EXPORT_PATH,
  createIntlFormatter,
  listDataFiles,
  parseExportText,
  runCli,
} from '../../src/cli/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

/** AC-17 第一段的五级计划；与 `src/core/planner/period.js` 的 `PLAN_LEVELS` 同序。 */
export const OFFLINE_LEVELS = Object.freeze(['year', 'season', 'month', 'week', 'day']);

/** AC-12 只要求月 / 周 / 日三份。 */
export const AC12_LEVELS = Object.freeze(['month', 'week', 'day']);

/** 两种离线装配：端口缺席 / 禁用哨兵。 */
export const OFFLINE_MODES = Object.freeze(['absent', 'sentinel']);

const PROFILE_PATH = 'profiles/local.json';
const GUIDELINE_PATH = 'data/guideline/generic-guideline.json';
const CACHE_PATH = 'data/calendar/solar-terms-2026.md';
const DAY_FILE = 'plans/2026-11-07.md';
const CLOCK_ISO = '2026-11-06T20:00:00+08:00';

/** 虚构档案的私有字段：日志 / CLI 输出 / 计划正文均不得携带（P-14）。 */
const PRIVATE_SENTINELS = Object.freeze([
  'FIX-GLOBAL-AVG-M-01', 'body_fat_pct', 'muscle_kg', 'water_pct', 'bone_kg',
]);

const POLICY = Object.freeze({
  language_tag: 'en',
  guideline_id: 'generic-guideline',
  calendar_id: 'solar-terms',
  unit_system: 'metric',
  locale_source: 'auto:fallback',
});

/** 合成只读时令缓存（T-014 格式；ID / 日期均为虚构值，不含任何个人数据）。 */
const CACHE_TEXT = [
  '# calendar-cache',
  'calendar_id=solar-terms',
  'adapter_id=solar-terms',
  'adapter_version=v1',
  'kind=solar-terms',
  'year=2026',
  'status=verified',
  'version=v1',
  'downloaded_at=2026-01-01T00:00:00Z',
  'timezone=UTC+08:00',
  'source_count=2',
  'sources=https://a.example/terms|https://b.example/terms',
  'diff_vs_previous=none',
  'notice_keys=calendar.notice.estimated',
  'term id=term.fixture_c longitude_deg=225 at=2026-11-07T12:00:00+08:00 date=2026-11-07',
  'term id=term.fixture_d longitude_deg=255 at=2026-12-07T11:00:00+08:00 date=2026-12-07',
  '',
  '',
].join('\n');

/** 语言包替身：键集齐备，值只是稳定占位，不含自然语言（T-031 边界）。 */
function languagePack(tag) {
  return Object.freeze({
    tag,
    strings: Object.freeze(Object.fromEntries(LANGUAGE_PACK_KEYS.map((key) => [key, `S:${key}`]))),
    fallback_keys: Object.freeze([]),
  });
}

/** 把 `key=value` 行折叠成对象（同键取首值，仅用于读取确定字段）。 */
function fieldsOf(lines) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const text of lines) {
    const at = text.indexOf('=');
    if (at > 0 && !(text.slice(0, at) in out)) out[text.slice(0, at)] = text.slice(at + 1);
  }
  return out;
}

/** 禁用哨兵：任何网络调用都会留下稳定违规码并抛错，绝不记录 URL（P-14）。 */
function forbiddenNetPort(violations, attempts) {
  return Object.freeze({
    isOffline: () => true,
    requests: () => attempts.map(() => Object.freeze({ url: 'redacted', at: 'none' })),
    download: async () => {
      violations.push('net.download');
      attempts.push('net.download');
      throw new Error('ERR_T021_NETWORK_DISABLED');
    },
  });
}

/** 禁用哨兵：LLM 增强默认关闭，任何调用即视为违反 FR-051。 */
function forbiddenLlmPort(violations) {
  const refuse = (event) => async () => {
    violations.push(event);
    throw new Error('ERR_T021_LLM_DISABLED');
  };
  return Object.freeze({
    enabled: () => false,
    complete: refuse('llm.complete'),
    generate: refuse('llm.generate'),
  });
}

/** 禁用哨兵：在线翻译属外部服务，离线链路不得触碰（NFR-009）。 */
function forbiddenTranslationPort(violations) {
  return Object.freeze({
    translate: async () => {
      violations.push('translation.translate');
      throw new Error('ERR_T021_TRANSLATION_DISABLED');
    },
  });
}

/**
 * 构造离线装配。默认 `absent`：deps 里不存在网络 / LLM 端口。
 * `sentinel` 则注入三个禁用哨兵，把「零调用」变成可证事实而非巧合。
 * @param {{mode?: string}} [options]
 */
export function createOfflineHarness({ mode = 'absent' } = {}) {
  if (!OFFLINE_MODES.includes(mode)) throw new Error('ERR_T021_MODE');
  const violations = [];
  const attempts = [];
  const fsPort = createMemoryFs({ files: {
    [PROFILE_PATH]: readFileSync(join(ROOT, 'examples/profiles/global-average-male.json'), 'utf8'),
    [GUIDELINE_PATH]: readFileSync(join(ROOT, GUIDELINE_PATH), 'utf8'),
    [CACHE_PATH]: CACHE_TEXT,
  } });
  const logPort = createLogPort();
  const deps = {
    fsPort,
    logPort,
    clock: createFixedClock(CLOCK_ISO),
    env: Object.freeze({}),
    resolveLocalePolicy: () => POLICY,
    loadLanguagePack: (tag) => languagePack(tag),
    intlFormatter: createIntlFormatter({ locale: 'en' }),
    acceptanceRunner: async () => ({ red: 19, green: 0 }),
  };
  if (mode === 'sentinel') {
    deps.netPort = forbiddenNetPort(violations, attempts);
    deps.llmPort = forbiddenLlmPort(violations);
    deps.translationPort = forbiddenTranslationPort(violations);
  }
  return {
    mode,
    deps,
    fsPort,
    logPort,
    violations,
    attempts,
    llmEnabled: false,
    diskWrites: 0,
  };
}

// -------------------------------------------------------------- 静态扫描

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** 相对仓库根的 POSIX 路径，便于报告里稳定复现。 */
function relative(full) {
  return full.slice(ROOT.length + 1).replace(/\\/g, '/');
}

/** 去掉整行注释后再扫描，避免把「不得依赖 LLM」这类约束文字误判为实现。 */
function codeOnly(text) {
  return text.split('\n').filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line)).join('\n');
}

/**
 * 真实数据静态扫描：令牌正则**动态取自 CI 的唯一权威规则**，
 * 因此本文件不复制任何真实数据字面量（否则扫描器会自命中，见 ci.yml 自身排除说明）。
 */
function scanPrivacy() {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const matched = /const TOKENS = \/(.+?)\/;/.exec(ci);
  if (!matched) throw new Error('ERR_T021_TOKEN_RULE_MISSING');
  const tokens = new RegExp(matched[1]);
  const excluded = new Set([
    '.github/workflows/ci.yml',
    'tests/acceptance/offline-integration.mjs',
  ]);
  const files = walk(ROOT).filter((full) => !excluded.has(relative(full)));
  const tokensHit = files.filter((full) => {
    try {
      return tokens.test(readFileSync(full, 'utf8'));
    } catch {
      return false;
    }
  }).map(relative);

  const dietPlanDirs = ['diet-plan', '_diet-plan', 'diet-plan-import']
    .filter((name) => existsSync(join(ROOT, name)));
  const ignoreProfiles = /^\/profiles\/$/m.test(readFileSync(join(ROOT, '.gitignore'), 'utf8'));
  const fixture = JSON.parse(readFileSync(join(ROOT, 'examples/profiles/global-average-male.json'), 'utf8'));

  return {
    fixtureFictional: fixture.fictional === true,
    fixtureNoRealPerson: fixture.privacy?.real_person_data === false
      && fixture.privacy?.upload === false && fixture.privacy?.telemetry === false,
    ignoreProfiles,
    dietPlanDirs,
    tokensHit,
    scannedFiles: files.length,
  };
}

/**
 * 实现源码静态扫描：`src/core/` + `src/cli/` 不得有任何直接网络出口 / LLM / 在线翻译入口；
 * 唯一的对外出口是 `src/io/net.js`，且受 `assertSafeCalendarUrl` 约束（FR-048）。
 */
function scanSources() {
  const dirs = [join(ROOT, 'src/core'), join(ROOT, 'src/cli')];
  const files = dirs.flatMap(walk).filter((full) => /\.js$/.test(full));
  const networkExits = [];
  const llmRefs = [];
  let onlineTranslation = 0;
  for (const full of files) {
    const code = codeOnly(readFileSync(full, 'utf8'));
    if (/\bfetch\s*\(|globalThis\.fetch|from\s+['"]node:https?['"]|XMLHttpRequest\b|https?\.(?:get|request)\s*\(/.test(code)) {
      networkExits.push(relative(full));
    }
    if (/\bllmPort\b|\bopenai\b|\banthropic\b|\bllm\.(?:complete|generate)\s*\(/.test(code)) {
      llmRefs.push(relative(full));
    }
    if (/\.translate\s*\(|\btranslationPort\b/.test(code)) onlineTranslation += 1;
  }
  return { networkExits, llmRefs, onlineTranslation, scannedFiles: files.length };
}

/** FR-048：节气 / 季节数据下载请求不得携带任何个人参数。 */
function checkCalendarUrl() {
  const allowed = (url) => {
    try {
      assertSafeCalendarUrl(url);
      return true;
    } catch {
      return false;
    }
  };
  return {
    rejectsQuery: !allowed('https://a.example/terms?q=fixture'),
    rejectsFragment: !allowed('https://a.example/terms#section'),
    rejectsUserinfo: !allowed('https://user:secret@a.example/terms'),
    rejectsHttp: !allowed('http://a.example/terms'),
    acceptsCleanHttps: allowed('https://a.example/terms'),
  };
}

// -------------------------------------------------------------- 主集成入口

/**
 * 跑一遍完整离线集成（纯装配，零磁盘写入）。
 * @param {{modes?: ReadonlyArray<string>}} [options]
 * @returns {Promise<object>} 结构化报告；`checks[]` 是逐项门禁，`ok` 恒等于逐项全过
 */
export async function runOfflineIntegration({ modes = OFFLINE_MODES } = {}) {
  /** @type {Record<string, Record<string, {exit: number, status: string, file: string, text: string}>>} */
  const plans = {};
  /** @type {Array<{mode: string, label: string, exit: number, lines: string[]}>} */
  const commands = [];
  /** @type {Record<string, string[]>} */
  const requests = {};
  /** @type {Record<string, string[]>} */
  const violations = {};
  /** @type {string[]} */
  const cliLines = [];
  /** @type {string[]} */
  const logs = [];
  let validateChecked = 0;
  let exportFiles = 0;
  let exportInfo = { version: 0, files: 0 };
  let deleteStatus = { deleted: 0, residue: -1, programDataKept: false };
  let diskWrites = 0;

  for (const mode of modes) {
    const harness = createOfflineHarness({ mode });
    /** @param {string} label @param {string[]} argv */
    const run = async (label, argv) => {
      const result = await runCli(argv, harness.deps);
      commands.push({ mode, label, exit: result.exit, lines: [...result.lines] });
      cliLines.push(...result.lines);
      return result;
    };

    await run('init', ['init', '--profile', PROFILE_PATH]);
    plans[mode] = {};
    for (const level of OFFLINE_LEVELS) {
      const result = await run(`plan.${level}`, ['plan', '--level', level, '--profile', PROFILE_PATH]);
      const fields = fieldsOf(result.lines);
      const file = fields.file ?? '';
      plans[mode][level] = {
        exit: result.exit,
        status: fields.status ?? '',
        file,
        text: file !== '' && await harness.fsPort.exists(file)
          ? await harness.fsPort.readText(file)
          : '',
      };
    }

    const validated = await run('validate', [
      'validate', '--level', 'day', '--profile', PROFILE_PATH, '--file', DAY_FILE,
    ]);
    validateChecked = Number(fieldsOf(validated.lines).checked ?? 0);
    await run('ledger', ['ledger', '--type', 'dedup']);

    const exported = await run('export-data', ['export-data']);
    exportFiles = Number(fieldsOf(exported.lines).files ?? 0);
    const exportText = await harness.fsPort.readText(EXPORT_PATH);
    const parsed = parseExportText(exportText);
    exportInfo = { version: parsed.version, files: parsed.files.length };

    const removed = await run('delete-data', ['delete-data', '--confirm']);
    const removedFields = fieldsOf(removed.lines);
    // 独立复验：不采信命令自报的 residue，重新扫一遍清单。
    const scannedResidue = (await listDataFiles(harness.fsPort)).length;
    deleteStatus = {
      deleted: Number(removedFields.deleted ?? 0),
      residue: Number(removedFields.residue ?? -1) === 0 && scannedResidue === 0 ? 0 : -1,
      programDataKept: await harness.fsPort.exists(GUIDELINE_PATH),
    };

    await run('acceptance', ['acceptance', '--red-check', '--ac', 'all']);

    requests[mode] = mode === 'sentinel'
      ? harness.deps.netPort.requests().map(() => 'net.download')
      : [];
    violations[mode] = [...harness.violations];
    logs.push(...harness.logPort.lines());
    diskWrites += harness.diskWrites;
  }

  const privacy = scanPrivacy();
  const staticScan = scanSources();
  const calendarUrl = checkCalendarUrl();
  const consent = { granted: false, transfers: OFFLINE_MODES.flatMap((m) => requests[m] ?? []) };
  const allViolations = OFFLINE_MODES.flatMap((m) => violations[m] ?? []);

  /** @type {Array<{id: string, ok: boolean, detail: string}>} */
  const checks = [];
  /** @param {string} id @param {boolean} ok @param {string} detail */
  const check = (id, ok, detail) => checks.push({ id, ok, detail });

  const generated = Object.values(plans).every((byLevel) => OFFLINE_LEVELS.every((level) => {
    const plan = byLevel[level];
    return plan && plan.exit === 0 && plan.status === 'ok' && plan.file.startsWith('plans/')
      && plan.text.length > 0;
  }));
  check('levels.all_generated', generated, `five levels x ${modes.length} modes`);

  const ac12 = Object.values(plans).every((byLevel) => AC12_LEVELS.every((level) => byLevel[level]?.exit === 0));
  check('ac12.month_week_day', ac12, 'month/week/day succeed with local calendar cache');

  const zeroRequests = Object.values(requests).every((list) => list.length === 0)
    && allViolations.every((v) => !v.startsWith('net.'));
  check('network.zero_requests', zeroRequests, 'no outbound request in any mode');

  const llmDisabled = allViolations.every((v) => !v.startsWith('llm.')) && staticScan.llmRefs.length === 0;
  check('llm.disabled', llmDisabled, 'LLM enhancement off and never referenced by core');

  const equal = OFFLINE_LEVELS.every((level) => plans.absent?.[level]?.text === plans.sentinel?.[level]?.text);
  check('determinism.modes_equal', modes.length < 2 || equal, 'plan bytes identical across port modes');

  const complete = Object.values(plans).every((byLevel) => OFFLINE_LEVELS.every((level) => {
    const text = byLevel[level]?.text ?? '';
    const rxFields = ['energy_kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g',
      'water_ml', 'salt_g', 'oil_g', 'added_sugar_g'];
    return text.includes('```rr-data') && text.includes('[AIGC]')
      && text.includes('plan.notice.disclaimer') && text.includes('plan.notice.estimated')
      && text.includes('guardrail.energy_floor_kcal=') && text.includes('guardrail.protein_floor_g=')
      && rxFields.every((f) => text.includes(`rx.${f}.min=`) && text.includes(`rx.${f}.max=`))
      && ['body', 'rx', 'loc', 'st', 'rule'].every((k) => text.includes(`version.${k}=`));
  }));
  check('plans.complete', complete, 'canonical data / notices / 9 rx / guardrails / versions');

  const commandsOk = commands.every((c) => c.exit === 0) && validateChecked === 28
    && exportFiles > 0 && deleteStatus.deleted > 0 && deleteStatus.residue === 0
    && deleteStatus.programDataKept;
  check('commands.offline_ok', commandsOk, 'init/plan/validate/ledger/export/delete/acceptance');

  const cleanOutput = cliLines.every((line) => /^[a-z][a-z0-9._-]*=[\x20-\x7E]*$/.test(line))
    && PRIVATE_SENTINELS.every((s) => !cliLines.join('\n').includes(s))
    && PRIVATE_SENTINELS.every((s) => !logs.join('\n').includes(s))
    && !/\d/.test(logs.join('\n'));
  check('privacy.output_and_logs', cleanOutput, 'CLI lines and log lines carry no body data');

  const cleanPlans = Object.values(plans).every((byLevel) => OFFLINE_LEVELS.every((level) => {
    const text = byLevel[level]?.text ?? '';
    return PRIVATE_SENTINELS.every((s) => !text.includes(s))
      && text.includes('guardrail.energy_floor_kcal=');
  }));
  check('privacy.plan_bodies', cleanPlans, 'BMR floor kept by FR-002, private fields absent');

  const privacyOk = privacy.fixtureFictional && privacy.fixtureNoRealPerson && privacy.ignoreProfiles
    && privacy.dietPlanDirs.length === 0 && privacy.tokensHit.length === 0;
  check('privacy.static_scan', privacyOk, 'fictional fixture / no real tokens / profiles ignored');

  const sourcesOk = staticScan.networkExits.length === 0 && staticScan.llmRefs.length === 0
    && staticScan.onlineTranslation === 0;
  check('static.zero_external_exits', sourcesOk, 'core + cli have no fetch / LLM / translation');

  const urlOk = calendarUrl.rejectsQuery && calendarUrl.rejectsFragment
    && calendarUrl.rejectsUserinfo && calendarUrl.rejectsHttp && calendarUrl.acceptsCleanHttps;
  check('static.calendar_url_safe', urlOk, 'query / fragment / userinfo / http rejected');

  check('consent.no_transfer', consent.granted === false && consent.transfers.length === 0
    && allViolations.every((v) => !v.startsWith('translation.')),
  'no consent granted, no external transfer attempted');

  check('data_subject.offline', exportInfo.version === 1 && exportInfo.files > 0
    && deleteStatus.deleted > 0 && deleteStatus.residue === 0 && deleteStatus.programDataKept,
  'export readable, delete leaves no residue, program data kept');

  const ok = checks.every((c) => c.ok);
  return Object.freeze({
    ok,
    checks: Object.freeze(checks.map((c) => Object.freeze(c))),
    modes: Object.freeze([...modes]),
    plans,
    commands,
    requests,
    violations,
    cliLines,
    logs,
    privacy,
    staticScan,
    calendarUrl,
    consent,
    export: exportInfo,
    exportFiles,
    deleteStatus,
    validateChecked,
    diskWrites,
  });
}

/**
 * 稳定报告：纯 ASCII `key=value`，确定性、可 diff（FR-028）。
 * @param {Awaited<ReturnType<typeof runOfflineIntegration>>} report
 */
export function formatReport(report) {
  const totalRequests = report.modes.reduce((n, m) => n + (report.requests[m] ?? []).length, 0);
  const llmCalls = report.modes.reduce((n, m) => n + (report.violations[m] ?? [])
    .filter((v) => v.startsWith('llm.')).length, 0);
  return [
    'scenario=offline_integration',
    `levels=${OFFLINE_LEVELS.length}`,
    `modes=${report.modes.length}`,
    `commands=${report.commands.length}`,
    `checks=${report.checks.length}`,
    `failed=${report.checks.filter((c) => !c.ok).length}`,
    `requests=${totalRequests}`,
    `llm_calls=${llmCalls}`,
    `validate_checked=${report.validateChecked}`,
    `export_files=${report.export.files}`,
    `deleted=${report.deleteStatus.deleted}`,
    `residue=${report.deleteStatus.residue}`,
    `disk_writes=${report.diskWrites}`,
    ...report.checks.map((c) => `check.${c.id}=${c.ok ? 'ok' : 'fail'}`),
    `status=${report.ok ? 'ok' : 'error'}`,
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runOfflineIntegration();
  process.stdout.write(`${formatReport(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
