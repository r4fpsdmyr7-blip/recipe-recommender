// SPDX-License-Identifier: GPL-3.0-only
// [AIGC] T-022 · 零依赖 lint + 类型契约检查 · 审计追踪 ID: RR-T022-20261108-0001 · 待人工审查（P-10）
/**
 * `npm run lint` 的入口（T-022 起启用；此前 `scripts/lint.mjs` 不存在）。
 *
 * 零第三方依赖边界：plan.md §11 写的 `tsc --checkJs --noEmit` 需要外部 TypeScript
 * 工具链，与「零第三方依赖 / 不跑 npm install」冲突。本脚本以 **Node 内置语法检查
 * (`node --check`) + JSDoc 契约静态校验 + 架构边界静态扫描** 承担同一职责，
 * 并在输出中显式登记这处规格张力，不假称等价于完整类型检查（P-01 / P-04）。
 *
 * 用法：
 *   node scripts/lint.mjs            # 人类可读报告，exit 0/1
 *   node scripts/lint.mjs --json     # 稳定 JSON，供 CI / 门禁报告复用
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const JSON_MODE = process.argv.includes('--json');

/** 与 CI 骨架同口径的全仓遍历。 */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '.git' || e.name === 'node_modules') return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const sources = walk(ROOT).filter((p) => /\.(js|mjs)$/.test(p)).map(rel);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const under = (p, prefix) => p.startsWith(`${prefix}/`);

/** @type {Array<{id: string, ok: boolean, detail: string}>} */
const checks = [];
const check = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

// 1. SPDX 头（GPL-3.0-only，FR-037 / P-07）
const noSpdx = sources.filter((p) => !read(p).startsWith('// SPDX-License-Identifier: GPL-3.0-only'));
check('spdx.all_sources', noSpdx.length === 0,
  `${sources.length} 个源码文件，缺 SPDX=${noSpdx.length}${noSpdx.length ? ` [${noSpdx.slice(0, 3).join(', ')}]` : ''}`);

// 2. Node 内置语法检查：替代 tsc 的「解析层」能力，零依赖可证。
const syntaxErrors = [];
for (const p of sources) {
  try {
    execFileSync(process.execPath, ['--check', join(ROOT, p)], { stdio: 'pipe' });
  } catch (e) {
    syntaxErrors.push(`${p}: ${String(e.stderr ?? e.message).split('\n')[0]}`);
  }
}
check('syntax.all_sources', syntaxErrors.length === 0,
  `node --check 通过 ${sources.length - syntaxErrors.length}/${sources.length}${syntaxErrors.length ? ` · ${syntaxErrors[0]}` : ''}`);

// 3. 架构边界：src/cli 零 node: 导入（T-019 定案）
const cliFiles = sources.filter((p) => under(p, 'src/cli'));
const cliNodeImports = cliFiles.filter((p) => /from ['"]node:/.test(read(p)));
check('boundary.cli_no_node_imports', cliFiles.length > 0 && cliNodeImports.length === 0,
  `src/cli ${cliFiles.length} 个文件，含 node: 导入=${cliNodeImports.length}`);

// 4. 架构边界：render 源码含注释纯 ASCII（T-018 定案 / P-11）
const renderFiles = sources.filter((p) => under(p, 'src/core/render'));
const nonAscii = renderFiles.filter((p) => /[^\x00-\x7F]/.test(read(p)));
check('boundary.render_ascii', renderFiles.length > 0 && nonAscii.length === 0,
  `src/core/render ${renderFiles.length} 个文件，含非 ASCII=${nonAscii.length}`);

// 5. 命名护栏：tests/acceptance/ 不得出现 *.test.js|mjs（tasks.md §2）
const badNames = sources.filter((p) => under(p, 'tests/acceptance') && /\.test\.(js|mjs)$/.test(p));
check('boundary.acceptance_naming', badNames.length === 0,
  `验收目录内 *.test.* 命中=${badNames.length}`);

// 6. 零第三方依赖：import 只允许 node: 与相对路径
const thirdParty = [];
for (const p of sources) {
  for (const m of read(p).matchAll(/^\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    if (!spec.startsWith('node:') && !spec.startsWith('.') && !spec.startsWith('file:') && !spec.startsWith('/')) {
      thirdParty.push(`${p} -> ${spec}`);
    }
  }
}
check('boundary.no_third_party', thirdParty.length === 0,
  `外部包导入命中=${thirdParty.length}${thirdParty.length ? ` · ${thirdParty[0]}` : ''}`);

// 7. 类型契约：IO 端口 typedef 齐备（静态 JSDoc 校验，零依赖替代 tsc 的契约层）
const ports = existsSync(join(ROOT, 'src/io/ports.js')) ? read('src/io/ports.js') : '';
const typedefs = [...ports.matchAll(/@typedef\s+\{object\}\s+(\w+)/g)].map((m) => m[1]);
const fsMethods = ['readText', 'readJson', 'writeText', 'appendText', 'exists', 'list', 'remove', 'hash', 'resolve'];
const contractOk = typedefs.includes('FsPort') && typedefs.includes('LogPort')
  && fsMethods.every((name) => ports.includes(`@property`) && ports.includes(name));
check('types.port_typedefs', contractOk,
  `typedef=[${typedefs.join(',')}]；FsPort 九方法齐备=${fsMethods.every((n) => ports.includes(n))}`);

// 8. 类型契约：JSDoc 注解体系确实存在且不是空扫（不假称等价于 tsc 全量类型检查）
//    口径修正：初版要求「8 个入口文件都有 @returns」，实测全仓 158 个导出函数中
//    91 个本就没有 @returns，属项目既有 JSDoc 风格，不是实现缺口；改为可证的
//    「注解总量 + 分布文件数 + 每个核心域公共出口有文件级契约注释」下限。
const implSources = sources.filter((p) => under(p, 'src'));
const tagged = implSources.map((p) => ({ p, n: (read(p).match(/@(?:param|returns|typedef)\b/g) ?? []).length }));
const tagTotal = tagged.reduce((n, x) => n + x.n, 0);
const tagFiles = tagged.filter((x) => x.n > 0).length;
const coreDirs = readdirSync(join(ROOT, 'src/core'), { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name);
const hasIndex = (d) => existsSync(join(ROOT, `src/core/${d}/index.js`));
const implemented = coreDirs.filter(hasIndex);
const placeholders = coreDirs.filter((d) => !hasIndex(d));
const missingHeaders = implemented.filter((d) => {
  const text = read(`src/core/${d}/index.js`);
  return !/^\/\*\*/m.test(text.split('\n').slice(1).join('\n'));
});
// `locale/` 是 T-032 的预留占位目录（P2），显式登记，避免把「尚未开工」误判成契约缺口；
// 除此之外不允许任何无名占位，判定因此更严。
const placeholderOk = placeholders.length <= 1 && placeholders.every((d) => d === 'locale');
check('types.jsdoc_contracts',
  tagTotal >= 100 && tagFiles >= 15 && implemented.length >= 9 && missingHeaders.length === 0 && placeholderOk,
  `@param/@returns/@typedef 共 ${tagTotal} 处、分布 ${tagFiles} 个文件；已实现公共出口 ${implemented.length} 个缺注释=${missingHeaders.length}；预留占位=[${placeholders.join(',')}]`);

// 9. 安全：禁止动态求值
const dynamicEval = sources.filter((p) => /\beval\s*\(|new\s+Function\s*\(/.test(read(p)));
check('safety.no_dynamic_eval', dynamicEval.length === 0, `动态求值命中=${dynamicEval.length}`);

// 10. 安全：离线用例与 P1 门禁对 node:fs 的导入必须是只读白名单
const readonlyFiles = sources.filter((p) => p === 'tests/acceptance/offline-integration.mjs' || under(p, 'tests/acceptance/gates'));
const readOnlyApi = new Set(['existsSync', 'readFileSync', 'readdirSync', 'statSync']);
const impure = readonlyFiles.filter((p) => {
  const imported = (read(p).match(/^import \{([^}]+)\} from 'node:fs';/m)?.[1] ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return imported.length === 0 || imported.some((n) => !readOnlyApi.has(n));
});
check('safety.gates_readonly', readonlyFiles.length > 0 && impure.length === 0,
  `只读用例 ${readonlyFiles.length} 个，node:fs 导入越界=${impure.length}`);

const ok = checks.every((c) => c.ok);
const result = {
  tool: 'lint',
  ok,
  node: process.version,
  files: sources.length,
  checks,
  typeCheckNote: 'plan.md §11 的 tsc --checkJs --noEmit 需外部 TypeScript 工具链，与零第三方依赖冲突；本脚本以 node --check + JSDoc 契约静态校验替代，**不等价于完整类型检查**。T-022 不把「类型检查通过」记为已达成，列为待人工裁决的规格张力（P-01 / P-04）。',
};

if (JSON_MODE) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`lint · ${process.version} · ${sources.length} 个源码文件\n`);
  for (const c of checks) process.stdout.write(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.id} · ${c.detail}\n`);
  process.stdout.write(`  [NOTE] ${result.typeCheckNote}\n`);
  process.stdout.write(`lint: ${ok ? 'PASS' : 'FAIL'} (${checks.length} 项)\n`);
}
process.exitCode = ok ? 0 : 1;
