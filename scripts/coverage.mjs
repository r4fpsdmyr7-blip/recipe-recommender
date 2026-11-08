// SPDX-License-Identifier: GPL-3.0-only
// [AIGC] T-022 · 覆盖率门禁（SC-002） · 审计追踪 ID: RR-T022-20261108-0001 · 待人工审查（P-10）
/**
 * 用 **Node 内置** `--experimental-test-coverage` 测量并强制 ≥80% 门禁，零第三方依赖。
 *
 * 口径：SC-002 要求「核心逻辑测试覆盖率 ≥ 80%」。Node ≥22 用
 * `--test-coverage-include=src/**` + `--test-coverage-exclude=tests/**`
 * 精确限定核心逻辑；Node 20 尚无这两个 flag，退化为解析全仓 `all files` 行，
 * 并在报告中显式标注口径差异（不假绿、不静默换口径）。两种口径都强制
 * line / branch / function 三列同时 ≥80。
 *
 * 用法：
 *   node scripts/coverage.mjs           # 人类可读报告，exit 0/1
 *   node scripts/coverage.mjs --json    # 稳定 JSON，供 CI / 门禁报告复用
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_MODE = process.argv.includes('--json');
const THRESHOLD = 80;
const MAJOR = Number(process.versions.node.split('.')[0]);
const SCOPED = MAJOR >= 22;

const args = ['--test', '--experimental-test-coverage'];
if (SCOPED) {
  args.push('--test-coverage-include=src/**', '--test-coverage-exclude=tests/**');
}

let output = '';
let testExit = 0;
try {
  output = execFileSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (e) {
  output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  testExit = typeof e.status === 'number' ? e.status : 1;
}

// TAP 覆盖率表的汇总行：# all files | <line> | <branch> | <funcs> |
const summary = /# all files[^\n]*?\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)?\s*\|/.exec(output);
const line = summary ? Number(summary[1]) : 0;
const branch = summary ? Number(summary[2]) : 0;
const func = summary && summary[3] !== undefined ? Number(summary[3]) : 0;
const testPass = Number(/# pass (\d+)/.exec(output)?.[1] ?? 0);
const testFail = Number(/# fail (\d+)/.exec(output)?.[1] ?? 1);

const checks = [
  { id: 'coverage.tests_green', ok: testExit === 0 && testFail === 0 && testPass > 0,
    detail: `node --test exit=${testExit} pass=${testPass} fail=${testFail}` },
  { id: 'coverage.line', ok: line >= THRESHOLD, detail: `${line.toFixed(2)}% >= ${THRESHOLD}%` },
  { id: 'coverage.branch', ok: branch >= THRESHOLD, detail: `${branch.toFixed(2)}% >= ${THRESHOLD}%` },
  { id: 'coverage.functions', ok: func >= THRESHOLD, detail: `${func.toFixed(2)}% >= ${THRESHOLD}%` },
  { id: 'coverage.summary_found', ok: summary !== null, detail: '解析到 all files 汇总行' },
];
const ok = checks.every((c) => c.ok);
const result = {
  tool: 'coverage',
  ok,
  node: process.version,
  scope: SCOPED ? 'src/**（Node ≥22 精确限定核心逻辑）' : '全仓（Node 20 无 include/exclude flag）',
  threshold: THRESHOLD,
  line,
  branch,
  functions: func,
  testPass,
  testFail,
  checks,
  note: '零第三方依赖：使用 Node 内置 --experimental-test-coverage，不引入 c8 / nyc / istanbul。',
};

if (JSON_MODE) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`coverage · ${process.version} · 口径=${result.scope}\n`);
  for (const c of checks) process.stdout.write(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.id} · ${c.detail}\n`);
  process.stdout.write(`  [NOTE] ${result.note}\n`);
  process.stdout.write(`coverage: ${ok ? 'PASS' : 'FAIL'} · line=${line.toFixed(2)}% branch=${branch.toFixed(2)}% functions=${func.toFixed(2)}%\n`);
}
process.exitCode = ok ? 0 : 1;
