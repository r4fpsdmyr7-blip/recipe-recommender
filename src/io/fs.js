// SPDX-License-Identifier: GPL-3.0-only
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { createHash } from 'node:crypto';
import { ERR, ioError } from './ports.js';

/**
 * 本地文件系统端口。所有路径 MUST 为相对路径且落在 root 内，防止越界写入。
 * 写入统一 UTF-8、LF 由 .gitattributes 约束，保证 Markdown 可 diff。
 * @param {{root?: string, encoding?: BufferEncoding}} [options]
 * @returns {import('./ports.js').FsPort}
 */
export function createLocalFsPort({ root, encoding = 'utf8' } = {}) {
  if (typeof root !== 'string' || root.length === 0) {
    throw ioError(ERR.FS_PATH_ESCAPE, 'fs 端口需要 root');
  }
  const base = path.resolve(root);

  /** @param {string} relPath */
  const resolve = (relPath) => {
    if (typeof relPath !== 'string' || relPath.length === 0 || path.isAbsolute(relPath)) {
      throw ioError(ERR.FS_PATH_ESCAPE, '必须使用非空相对路径');
    }
    const absolute = path.resolve(base, relPath);
    if (absolute !== base && !absolute.startsWith(base + path.sep)) {
      throw ioError(ERR.FS_PATH_ESCAPE, '路径越出工作区');
    }
    return absolute;
  };

  /** @param {unknown} error */
  const isMissing = (error) => /** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT';

  /** @param {string} relPath */
  const readText = async (relPath) => {
    try {
      return await fsp.readFile(resolve(relPath), encoding);
    } catch (error) {
      if (isMissing(error)) throw ioError(ERR.FS_NOT_FOUND, '文件不存在', error);
      throw error;
    }
  };

  /** @param {string} relPath @param {string} text */
  const writeText = async (relPath, text) => {
    const absolute = resolve(relPath);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, text, encoding);
  };

  const port = {
    resolve,
    readText,
    readJson: async (relPath) => JSON.parse(await readText(relPath)),
    writeText,
    appendText: async (relPath, text) => {
      const absolute = resolve(relPath);
      await fsp.mkdir(path.dirname(absolute), { recursive: true });
      await fsp.appendFile(absolute, text, encoding);
    },
    exists: async (relPath) => {
      try {
        await fsp.access(resolve(relPath));
        return true;
      } catch {
        return false;
      }
    },
    list: async (relDir = '') => {
      const absolute = resolve(relDir === '' ? '.' : relDir);
      /** @type {string[]} */
      const found = [];
      /** @param {string} dir @param {string} prefix */
      const walk = async (dir, prefix) => {
        let entries;
        try {
          entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (error) {
          if (isMissing(error)) return;
          throw error;
        }
        for (const entry of entries) {
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
          else if (entry.isFile()) found.push(relative);
        }
      };
      await walk(absolute, relDir === '' ? '' : relDir.replace(/\\/g, '/'));
      return found.sort();
    },
    remove: async (relPath) => {
      try {
        await fsp.unlink(resolve(relPath));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
    hash: async (relPath) => createHash('sha256').update(await readText(relPath), 'utf8').digest('hex'),
  };
  return port;
}
