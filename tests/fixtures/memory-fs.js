// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { ERR, ioError } from '../../src/io/ports.js';

/** @param {string} relPath */
function normalize(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw ioError(ERR.FS_PATH_ESCAPE, '必须使用非空相对路径');
  }
  const slashed = relPath.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:\//.test(slashed)) {
    throw ioError(ERR.FS_PATH_ESCAPE, '不接受绝对路径');
  }
  const segments = slashed.split('/').filter((part) => part !== '.' && part !== '');
  if (segments.includes('..')) {
    throw ioError(ERR.FS_PATH_ESCAPE, '路径越出工作区');
  }
  return segments.join('/');
}

/**
 * 内存文件系统替身：无需磁盘临时目录即可注入工作区，
 * 并提供 snapshot / restore 与 hash，用于 AC-06「历史文件逐字节不变」的基线断言。
 * @param {{files?: Record<string, string>}} [options]
 * @returns {import('../../src/io/ports.js').FsPort & {
 *   snapshot: () => Map<string, string>,
 *   restore: (snapshot: Map<string, string>) => void,
 *   writes: () => Array<{path: string, kind: string}>
 * }}
 */
export function createMemoryFs({ files = {} } = {}) {
  /** @type {Map<string, string>} */
  const store = new Map(Object.entries(files).map(([key, value]) => [normalize(key), String(value)]));
  /** @type {Array<{path: string, kind: string}>} */
  const writeLog = [];

  /** @param {string} relPath */
  const readText = async (relPath) => {
    const key = normalize(relPath);
    if (!store.has(key)) throw ioError(ERR.FS_NOT_FOUND, '文件不存在');
    return /** @type {string} */ (store.get(key));
  };

  return {
    resolve: normalize,
    readText,
    readJson: async (relPath) => JSON.parse(await readText(relPath)),
    writeText: async (relPath, text) => {
      const key = normalize(relPath);
      store.set(key, String(text));
      writeLog.push({ path: key, kind: 'write' });
    },
    appendText: async (relPath, text) => {
      const key = normalize(relPath);
      store.set(key, (store.get(key) ?? '') + String(text));
      writeLog.push({ path: key, kind: 'append' });
    },
    exists: async (relPath) => store.has(normalize(relPath)),
    list: async (relDir = '') => {
      const prefix = relDir === '' || relDir === '.' ? '' : `${normalize(relDir)}/`;
      return [...store.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    remove: async (relPath) => {
      store.delete(normalize(relPath));
    },
    hash: async (relPath) => createHash('sha256').update(await readText(relPath), 'utf8').digest('hex'),
    snapshot: () => new Map(store),
    restore: (snapshot) => {
      store.clear();
      for (const [key, value] of snapshot) store.set(key, value);
    },
    writes: () => writeLog.map((entry) => ({ ...entry })),
  };
}
