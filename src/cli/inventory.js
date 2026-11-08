// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-020 · 本地数据清单与导出格式（FR-028 / FR-047 / FR-049 / SC-013 / AC-17）。
 *
 * 口径（plan.md §9「数据位置 / 数据主体权利」）：
 * - **用户数据** = 根目录 7 个文件 + `_exports` / `data/calendar` / `logs` / `plans` / `profiles`
 *   五个目录下的全部文件。用户的档案、台账、计划、时令缓存、日志、既有导出都在此列。
 * - **程序数据** = `data/guideline/`（内置指南系数）、`src/`、规格文档等，**永不**进入清单：
 *   既不导出（用户数据权利只覆盖用户自己的数据），更不被删除（删了程序就跑不了）。
 *
 * 导出格式是**可反解析**的单一 UTF-8 Markdown：每个文件一节，围栏长度按正文里最长的反引号
 * 连续段自适应加长，因此正文含 ``` 也不会被围栏吃掉 —— 这是「导出完整可读」的可执行定义。
 *
 * 本模块零 IO：文件读取一律经注入的 `FsPort`，不 `import 'node:*'`、不联网（FR-048）。
 */
import { CLI_ERROR, CliError, cliIssue } from './errors.js';

/** 用户数据：根目录文件（顺序即清单展示顺序，最终按路径排序）。 */
export const DATA_ROOT_FILES = Object.freeze([
  'changelog.md',
  'daily-plan.md',
  'feedback.md',
  'history.md',
  'periodic-plan.md',
  'rr.config.json',
  'weekly-plan.md',
]);

/** 用户数据：目录（递归包含，路径以 POSIX 分隔）。 */
export const DATA_DIRS = Object.freeze([
  '_exports',
  'data/calendar',
  'logs',
  'plans',
  'profiles',
]);

/** 默认导出位置（在 `_exports/` 下，因此既属用户数据、又需在导出时排除自身）。 */
export const EXPORT_PATH = '_exports/rr-export.md';

/** 导出格式版本（写入 `version=` 行；解析缺省时按 1 处理）。 */
export const EXPORT_VERSION = 1;

/** 导出内容必须是可 diff 的纯 ASCII 相对路径（FR-028 / P-11）。 */
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

const HEADER = '# rr-export';
const FILE_HEADING = /^## file: (.+)$/;
const VERSION_LINE = /^version=(\d+)$/;
const FENCE = /^`{3,}$/;

/**
 * 路径形状：可打印 ASCII、相对、POSIX 分隔、无空段 / `.` / `..`。
 * 这是**格式层**的门禁（导出正文必须可 diff、可剪切），不涉及「是否用户数据」。
 * @param {unknown} value
 * @returns {boolean}
 */
function isRelativeAsciiPath(value) {
  if (typeof value !== 'string' || !PRINTABLE_ASCII.test(value)) return false;
  if (value.startsWith('/') || value.includes('\\')) return false;
  return !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

/**
 * 该路径是否属于用户数据（不含程序数据）。
 * 归属判断只在**清单层**做：`data/guideline/` 是程序数据，`src/` 与规格文档同理。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDataPath(value) {
  if (!isRelativeAsciiPath(value)) return false;
  const path = /** @type {string} */ (value);
  if (DATA_ROOT_FILES.includes(path)) return true;
  return DATA_DIRS.some((dir) => path.length > dir.length + 1 && path.startsWith(`${dir}/`));
}

/**
 * 列出全部用户数据（排序后的 POSIX 相对路径）。
 * 目录不存在即为空，不视为错误（E-05 口径：首次运行 / 删除后重跑都要能过）。
 * @param {import('../io/ports.js').FsPort} fsPort
 * @returns {Promise<string[]>}
 */
export async function listDataFiles(fsPort) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const file of DATA_ROOT_FILES) {
    if (await fsPort.exists(file)) found.add(file);
  }
  for (const dir of DATA_DIRS) {
    const entries = await fsPort.list(dir);
    for (const entry of Array.isArray(entries) ? entries : []) {
      const path = String(entry).replace(/\\/g, '/');
      if (isDataPath(path)) found.add(path);
    }
  }
  return [...found].sort();
}

/**
 * 围栏长度：正文中最长反引号连续段 + 1，下限 3。
 * 保证**任何**正文行都不可能等于围栏行，于是无需转义即可无损往返。
 * @param {string} text
 */
function fenceFor(text) {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return Math.max(3, longest + 1);
}

/** @param {string} field @param {string} hint */
function fail(field, hint) {
  throw new CliError([cliIssue(CLI_ERROR.FILE, field, hint)]);
}

/**
 * 构造导出文本（纯函数）。
 * 只校验路径**形状**（安全相对 ASCII 路径）；「这些路径是不是用户数据」由清单层保证，
 * 因此本函数可作为最小往返单元独立使用，且不越权替调用方判断归属。
 * @param {Array<{path: string, text: string}>} files
 * @returns {string}
 * @throws {CliError} 路径形状不合规、或同一路径重复出现
 */
export function buildExportText(files) {
  const list = Array.isArray(files) ? files : [];
  const lines = [HEADER, `version=${EXPORT_VERSION}`, ''];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const entry of list) {
    const path = String(entry?.path ?? '');
    if (!isRelativeAsciiPath(path)) fail('(export).path', 'action.cli.export_path');
    if (seen.has(path)) fail('(export).path', 'action.cli.export_dup');
    seen.add(path);
    const text = String(entry?.text ?? '');
    const fence = '`'.repeat(fenceFor(text));
    // 节头后留一空行，正文逐行原样写入（含行尾空串，故行尾换行也能无损还原）。
    lines.push(`## file: ${path}`, '', fence, ...text.split('\n'), fence, '');
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return `${lines.join('\n')}\n`;
}

/**
 * 反解析导出文本（`buildExportText` 的逆运算）。
 * @param {string} text
 * @returns {Readonly<{version: number, files: ReadonlyArray<Readonly<{path: string, text: string}>>}>}
 * @throws {CliError} 结构不合规（缺头、围栏未闭合、出现无法识别的小节）
 */
export function parseExportText(text) {
  const lines = String(text).split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (lines[i] !== HEADER) fail('(export).text', 'action.cli.export_format');
  i += 1;

  /** @type {number|null} */
  let version = null;
  /** @type {Array<{path: string, text: string}>} */
  const files = [];

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const versioned = VERSION_LINE.exec(line);
    if (versioned) {
      version = Number(versioned[1]);
      i += 1;
      continue;
    }
    const heading = FILE_HEADING.exec(line);
    if (!heading) fail('(export).text', 'action.cli.export_format');
    const path = /** @type {RegExpExecArray} */ (heading)[1];
    if (!isRelativeAsciiPath(path)) fail('(export).path', 'action.cli.export_path');
    i += 1;

    while (i < lines.length && lines[i].trim() === '') i += 1;
    const fence = lines[i];
    if (fence === undefined || !FENCE.test(fence)) fail('(export).text', 'action.cli.export_format');
    i += 1;

    /** @type {string[]} */
    const content = [];
    while (i < lines.length && lines[i] !== fence) {
      content.push(lines[i]);
      i += 1;
    }
    if (i >= lines.length) fail('(export).text', 'action.cli.export_format');
    i += 1;
    files.push({ path, text: content.join('\n') });
  }

  return Object.freeze({
    version: version ?? EXPORT_VERSION,
    files: Object.freeze(files.map((file) => Object.freeze(file))),
  });
}
