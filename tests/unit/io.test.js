// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import {
  ERR,
  DEFAULT_TIME_ZONE,
  createSystemClock,
  todayInZone,
  isoInZone,
  createLocalFsPort,
  createNetPort,
  assertSafeCalendarUrl,
} from '../../src/io/index.js';
import { createFixedClock, createMemoryFs, createStubNet } from '../fixtures/index.js';

test('固定时钟复现 AC-02 / AC-03 的运行日期', () => {
  const newYear = createFixedClock('2026-01-01T08:00:00+08:00');
  assert.equal(newYear.today(), '2026-01-01');
  assert.equal(newYear.iso(), '2026-01-01T08:00:00+08:00');

  const evening = createFixedClock('2026-11-06T20:00:00+08:00');
  assert.equal(evening.today(), '2026-11-06');
  assert.equal(evening.iso(), '2026-11-06T20:00:00+08:00');
  evening.advance(24 * 60 * 60 * 1000);
  assert.equal(evening.today(), '2026-11-07', '日级次日口径可通过推进时钟验证');
});

test('时区换算按 Asia/Shanghai，UTC 与本地日期可不同', () => {
  const clock = createFixedClock('2026-11-06T16:30:00Z');
  assert.equal(clock.today(), '2026-11-07', 'UTC+8 已进入次日');
  assert.equal(clock.today('UTC'), '2026-11-06');
  assert.equal(todayInZone(new Date('2026-01-01T00:30:00+08:00'), DEFAULT_TIME_ZONE), '2026-01-01');
  assert.match(isoInZone(new Date('2026-01-01T00:30:00+08:00')), /\+08:00$/);
});

test('系统时钟可注入 now，且拒绝无效日期', () => {
  const fixed = new Date('2026-11-02T08:00:00+08:00');
  const clock = createSystemClock({ now: () => fixed });
  assert.equal(clock.today(), '2026-11-02');
  assert.throws(
    () => createSystemClock({ now: () => new Date('invalid') }).now(),
    (error) => error.code === ERR.CLOCK_INVALID,
  );
});

test('内存文件系统支持临时工作区注入与只追加台账', async () => {
  const fs = createMemoryFs({ files: { 'history.md': 'line-1\n' } });
  assert.equal(await fs.readText('history.md'), 'line-1\n');
  assert.equal(await fs.exists('missing.md'), false);
  await fs.writeText('plans/2026-11-07.md', '# daily\n');
  assert.equal(await fs.readText('plans/2026-11-07.md'), '# daily\n');
  await fs.appendText('history.md', 'line-2\n');
  assert.equal(await fs.readText('history.md'), 'line-1\nline-2\n');
  assert.deepEqual(fs.writes().map((entry) => entry.kind), ['write', 'append']);
  assert.deepEqual(await fs.list(), ['history.md', 'plans/2026-11-07.md']);
  assert.deepEqual(await fs.list('plans'), ['plans/2026-11-07.md']);
});

test('内存文件系统哈希基线可证明历史文件逐字节不变（AC-06 / AC-11 前置）', async () => {
  const fs = createMemoryFs({ files: { '2026-11-06.md': '已执行计划' } });
  const baseline = await fs.hash('2026-11-06.md');
  const snapshot = fs.snapshot();
  await fs.writeText('2026-11-07.md', '未来计划');
  assert.equal(await fs.hash('2026-11-06.md'), baseline, '历史文件哈希不变');
  await fs.writeText('2026-11-06.md', '被误改');
  assert.notEqual(await fs.hash('2026-11-06.md'), baseline, '篡改可被检出');
  fs.restore(snapshot);
  assert.equal(await fs.hash('2026-11-06.md'), baseline);
});

test('路径越界一律拒绝，错误只含稳定码', async () => {
  const fs = createMemoryFs();
  for (const bad of ['../secret.md', '/etc/passwd', 'C:/Windows/win.ini', '']) {
    await assert.rejects(
      () => fs.readText(bad),
      (error) => error.code === ERR.FS_PATH_ESCAPE,
    );
  }
  const local = createLocalFsPort({ root: path.join(os.tmpdir(), 'rr-t002-sandbox') });
  await assert.rejects(
    () => local.readText('../outside.md'),
    (error) => error.code === ERR.FS_PATH_ESCAPE,
  );
});

test('本地 fs 端口在临时工作区可读写、追加并计算哈希', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rr-t002-'));
  try {
    const fs = createLocalFsPort({ root });
    await fs.writeText('data/calendar/solar-terms-2027.md', 'A\n');
    assert.equal(await fs.readText('data/calendar/solar-terms-2027.md'), 'A\n');
    await fs.appendText('data/calendar/solar-terms-2027.md', 'B\n');
    assert.equal(await fs.readText('data/calendar/solar-terms-2027.md'), 'A\nB\n');
    assert.match(await fs.hash('data/calendar/solar-terms-2027.md'), /^[a-f0-9]{64}$/);
    assert.deepEqual(await fs.list(), ['data/calendar/solar-terms-2027.md']);
    await fs.remove('data/calendar/solar-terms-2027.md');
    assert.equal(await fs.exists('data/calendar/solar-terms-2027.md'), false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('URL 静态护栏拒绝 http / 查询参数 / 片段 / 凭据（FR-048）', () => {
  assert.equal(assertSafeCalendarUrl('https://example.org/terms/2027.md').host, 'example.org');
  for (const bad of [
    'http://example.org/terms.md',
    'https://example.org/terms.md?city=Shenzhen',
    'https://example.org/terms.md#section',
    'https://user:pass@example.org/terms.md',
    'not-a-url',
  ]) {
    assert.throws(
      () => assertSafeCalendarUrl(bad),
      (error) => error.code === ERR.NET_BLOCKED_URL,
      bad,
    );
  }
});

test('离线 net 端口不发起任何请求，且可注入成功 / 失败响应', async () => {
  const offline = createNetPort({ offline: true });
  assert.equal(offline.isOffline(), true);
  await assert.rejects(
    () => offline.download('https://example.org/terms.md'),
    (error) => error.code === ERR.NET_OFFLINE,
  );
  assert.deepEqual(offline.requests(), [], '断网断言：零对外请求');

  const clock = createFixedClock('2027-01-01T08:00:00+08:00');
  const ok = createNetPort({
    clock,
    allowedHosts: ['example.org'],
    fetchImpl: /** @type {any} */ (async () => ({ ok: true, status: 200, text: async () => '24 节气' })),
  });
  const response = await ok.download('https://example.org/terms/2027.md');
  assert.equal(response.text, '24 节气');
  assert.equal(response.fetchedAt, '2027-01-01T08:00:00+08:00');
  assert.equal(ok.requests().length, 1);

  const failing = createNetPort({
    fetchImpl: /** @type {any} */ (async () => ({ ok: false, status: 503, text: async () => '' })),
  });
  await assert.rejects(
    () => failing.download('https://example.org/terms.md'),
    (error) => error.code === ERR.NET_HTTP,
  );

  const blocked = createNetPort({
    allowedHosts: ['example.org'],
    fetchImpl: /** @type {any} */ (async () => ({ ok: true, status: 200, text: async () => '' })),
  });
  await assert.rejects(
    () => blocked.download('https://other.example/terms.md'),
    (error) => error.code === ERR.NET_BLOCKED_URL,
  );
});

test('下载替身可注入成功、失败与双源不一致', async () => {
  const clock = createFixedClock('2027-01-01T08:00:00+08:00');
  const urlA = 'https://source-a.example/2027.md';
  const urlB = 'https://source-b.example/2027.md';
  const net = createStubNet({
    clock,
    responses: {
      [urlA]: '雨水 2027-02-18',
      [urlB]: { error: ERR.NET_HTTP },
      'https://retry.example/2027.md': ['first', { error: ERR.NET_HTTP }],
    },
  });
  assert.equal((await net.download(urlA)).text, '雨水 2027-02-18');
  await assert.rejects(() => net.download(urlB), (error) => error.code === ERR.NET_HTTP);
  assert.equal((await net.download('https://retry.example/2027.md')).text, 'first');
  await assert.rejects(() => net.download('https://retry.example/2027.md'));
  assert.equal(net.requests().length, 4);

  const offline = createStubNet({ offline: true, responses: { [urlA]: '不应被返回' } });
  await assert.rejects(() => offline.download(urlA), (error) => error.code === ERR.NET_OFFLINE);
  assert.deepEqual(offline.requests(), []);
});

test('三端口组合可复现「固定日期 + 临时工作区 + 下载失败」场景', async () => {
  const clock = createFixedClock('2026-11-06T20:00:00+08:00');
  const fs = createMemoryFs();
  const net = createStubNet({ clock, responses: { 'https://terms.example/2027.md': new Error('injected') } });
  await fs.writeText(`${clock.today()}-daily.md`, '# 2026-11-06\n');
  await assert.rejects(() => net.download('https://terms.example/2027.md'));
  assert.equal(await fs.readText('2026-11-06-daily.md'), '# 2026-11-06\n');
  assert.equal(net.requests()[0].at, '2026-11-06T20:00:00+08:00');
});
