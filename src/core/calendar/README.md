# `src/core/calendar/` · 历法适配器与节气缓存刷新（T-014）

> [AIGC] 审计追踪 ID：`RR-T014-20261108-0001` · 待人工审查（P-10）

**依据**：`tasks.md` T-014；`SPEC.md` FR-011～013、FR-048、E-01 / E-03、AC-04、SC-005、NFR-001、§9 不变式 2、P-05 / P-11；`plan.md §5.3 / §6.1 / §7.1 / §9`。

**范围**：`refreshCalendarData(year, calendarAdapter, netPort, ctx)` 刷新当年时令缓存；可插拔 `solar-terms` / `gregorian-season` 适配器；≥2 源交叉校验；UTC+8 归一化；失败 `FALLBACK / 未校验` + 人工复核；`readCalendarCache()` 供下层只读；`resolveActiveTerm()` 落实 E-01 暂行规则。

## 文件职责

| 路径 | 职责 |
|------|------|
| `errors.js` | `CALENDAR_ERROR` 12 码、`CalendarError`（只含稳定码 + Canonical ID） |
| `contract.js` | 适配器固定键集白名单、≥2 独立来源、URL 静态隐私护栏、缓存路径 |
| `parse.js` | UTC+8 归一化、中性行格式解析、双源交叉校验、差异计算、版本号、可 diff 缓存文本 |
| `refresh.js` | 刷新主流程、FALLBACK 回退、下层只读视图、E-01 暂行规则 |
| `index.js` | 统一出口 |
| `tests/unit/calendar.test.js` | 20 条先红后绿单测（Round 6 负向探针驱动补 2 条解耦断言） |

`src/io/net.js`（T-002 产出）已提供 `createNetPort` / `assertSafeCalendarUrl`，本任务**直接复用、不改动已跟踪文件**；全部联网经注入的 `createStubNet` 替身，测试零真实网络请求。

## ⚠️ 两处规格张力（需人工裁决，本任务不擅改 SPEC.md）

按 `constitution.md` P-01，行为变更须先改 `SPEC.md`；本任务**零规格改动**，仅取保守解并记录：

### 1. 缓存路径不一致

| 来源 | 路径 |
|------|------|
| `SPEC.md` FR-011 / AC-04 | `_data/solar-terms-YYYY.md` |
| `plan.md §5.3` / `tasks.md` T-014 | `data/calendar/solar-terms-YYYY.md` |

**处理**：默认 `data/calendar/solar-terms-YYYY.md`（tasks.md 产出口径），路径经 `ctx.cachePath` 可注入，`cachePathFor(year, prefix)` 也支持任意前缀；单测已验证 `_data/solar-terms-2027.md` 可写入。**建议**在 T-040 出 CHANGELOG 时或下一轮 SPEC 澄清中统一，勿在代码里硬编码两套路径。

### 2. FR-013「内置近似表」与 FR-012「禁止内置近似表」冲突

- FR-013：联网失败时 MUST 回退上一版缓存 **+ 内置近似表**，标注 `FALLBACK / 未校验`，**不得静默使用近似值**；
- FR-012：季 / 月 / 周 / 日 MUST 只读缓存，**禁止内置或套用固定近似日期表**；
- E-03 / AC-04 第二段：失败 → 沿用上一版缓存 + `FALLBACK` 标注 + 人工复核提示，**未静默使用近似值**。

**处理（按 P-02 以 AC 为准）**：**不内置任何节气名称或日期常量**。失败 / 离线 / 部分来源冲突时：

1. 沿用上一版缓存的全部条目（若存在）；若无上一版缓存则给出**空时令集**，绝不填近似值；
2. 结果带 `status: 'FALLBACK'`、`status_label: 'FALLBACK / 未校验'`、`manual_review_key: calendar.review.manual`、`notice_keys` 含 `calendar.notice.manual_review`；
3. `reason_keys` 明确记录 `offline` / `download_failed` / `source_conflict` / `parse_failed` / `no_previous_cache`；
4. **FALLBACK 不覆写上一版缓存**（零写入），避免回改历史快照（P-05 精神）；标注由年计划渲染层 T-018 呈现。

FR-011 要求「与旧近似表差异」：因无内置近似表，改为 **`diff_vs_previous` = 与上一版缓存的结构化差异**（`added / removed / changed`），并写入缓存文本，语义可审计且不引入近似值。

## 设计决策与边界

### 1. 核心域零时令常量

适配器只描述「去哪里取 / 取几条 / 何种历法」，**不携带任何节气数据**；24 条（季节历 4 条）全部来自 `netPort.download()` 正文。内部一律 Canonical ID（如 `term.fixture_01`），节气名称由 T-031 语言包渲染（P-11）。测试中的 `term.fixture_*` 与合成时刻是**测试替身**，不是近似节气表。

### 2. ≥2 源交叉校验与 UTC+8 归一化

`assertSafeCalendarUrl()` 静态禁止 query / fragment / userinfo / 非 HTTPS，使「请求不含个人参数」可被静态证明（FR-048）；`refreshCalendarData` 签名不接收 Profile，**只把 URL 原样传给 `netPort.download(url)`**。两个来源的响应可以是不同偏移（如 `T02:00:00Z` 与 `T10:00:00+08:00`）：先 `normalizeUtc8()` 统一为北京时间，再逐条比对 `id / longitude_deg / at`；任一不一致即 `calendar.fallback.source_conflict` → FALLBACK，绝不「取多数 / 取第一个」静默放行（E-03）。UTC+8 无夏令时，固定 +8 小时偏移即可正确换算。

### 3. 可 diff 缓存文本

成功时写入纯 ASCII 键值文本：来源 URL、下载时间、版本号、时区、`diff_vs_previous`、`notice_keys`，以及 24 行 `term id=… longitude_deg=… at=… date=…`（AC-04 的节气 / 黄经 / 日期 / 交节时刻）。版本号是条目内容的 FNV-1a 指纹（纯 JS、零 `node:crypto` 依赖，NFR-004）。同输入两次刷新字节一致。

### 4. 下层只读 + 与 T-013 契约衔接

`readCalendarCache(fsPort, cachePath, year)` 零写入、零网络，返回**恰好四键** `{ cache_id, year, status, terms: [{id, at}] }`，可直接喂给 T-013 的 `readCalendarView()`；单测验证 24/24 日期与缓存完全一致（SC-005 / §9 不变式 2），且 FALLBACK 状态会被 T-013 映射为 `plan.review.calendar_fallback` 人工复核键。

### 5. E-01 暂行规则

`resolveActiveTerm(cache, date)` 按已登记 B 类提案暂行：交节 ≥12:00 当日沿用旧节气、次日起新节气；返回值固定带 `rule: 'E-01-provisional'`，提醒上层**尚未固化，待上级采纳**。

### 6. 通用季节历同等约束

适配器 `kind` 可为 `solar-terms`（24 条）或 `gregorian-season`（4 条）；年刷新、双源、UTC+8 落盘、下层只读、失败 FALLBACK 全部同等适用（FR-011～013 注），单测已覆盖。

### 7. 本任务边界

**AC-04 仍为 RED**：本任务只产出缓存与结构化结果，`_data/` 路径统一、下层计划的端到端接线、年计划渲染与人工复核提示呈现归 T-013 后续集成 / T-018 / T-019；可执行业务断言尚不能端到端跑通。`tasks.md` 39 项仍全部 `- [ ]`（P-02）。

## 校验记录（2026-11-08）

| 项 | 结果 |
|----|------|
| 先红证据 | 实现前 `npm test`：71 条 / 70 pass / **1 fail**（`src/core/calendar/index.js` 缺失） |
| 转绿 / 全量 | `calendar.test.js` **20/20**；`npm test` **90/90** |
| 基线回归 | `npm run acceptance` **19/19 RED · 0 GREEN**；`npm run spec-check` PASS；CI 6 job 本地模拟 6/6 |
| 负向探针 | **20/20** 项弱化全部被单测检出、全部字节级还原，见 `reviews/round-6/t014-negative.md` |
| 隐私 / 网络 | 零真实网络请求；下载 URL 无 query / 凭据；核心域零 `node:` 直接 IO；真实身体数据令牌 0 |

**Round 6 探针驱动的覆盖缺口修复**：原 18 条单测把「URL 静态护栏」与「单源拒绝」耦合在同一批 `assert.throws` 里，单独放行 `assertSafeCalendarUrl()` 时会被单源检查掩盖，弱化无法检出。为此补两条独立单测（双源 + 带 query 的 URL；双源但 URL / ID 重复），使 FR-048 与 FR-011 的来源独立性各自可被单独证明。**只增断言，未放宽任何判定标准**，AC 红态与任务勾选状态不变。
