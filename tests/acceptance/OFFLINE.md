# 离线集成用例（T-021）

> [AIGC] 本文件由 AI 依据 `SPEC.md v0.4.0-draft` / `tasks.md T-021` / `plan.md §4 §9` 生成 ·
> 审计追踪 ID：`RR-T021-20261108-0001` · 待人工审查（P-10）

**口径**：断网 + LLM 关闭 + 网络端口禁用下生成年 / 季 / 月 / 周 / 日计划，断言零对外请求、核心功能完整、日志与示例不含身体数据。
映射：`FR-028`、`FR-047`、`FR-048`、`FR-051`、`FR-053`、`AC-12`、`AC-17`、`SC-008`、`SC-013`、`SC-014`、`NFR-001`、`NFR-009`。

## 1. 运行

```bash
node tests/acceptance/offline-integration.mjs       # 独立报告（纯 ASCII key=value，exit 0/1）
npm test                                            # 由 tests/unit/offline-integration.test.js 自动覆盖
```

- 主产出 `offline-integration.mjs` **不是** `*.test.js` / `*.test.mjs`：遵守 `tasks.md §2` 与本目录 README 的命名护栏，不会被 `node --test` 误当作红态场景执行。
- 单一实现、两个入口：单测 `import { runOfflineIntegration }` 做断言；独立 CLI 打印稳定报告，两者不会各自演化一套判定。
- **零磁盘写入**：文件一律走 `createMemoryFs`；本模块只 import `node:fs` 的读取类 API（由单测逐项扫描禁止写入 API 名字来取证）。

## 2. 三段可证形式（不靠「恰好没发生」）

| 模式 | 装配 | 证明什么 |
| --- | --- | --- |
| `absent` | deps 里**根本没有** `netPort` / `llmPort` | 核心链路不依赖任何外部服务（NFR-001 / FR-051） |
| `sentinel` | 注入「一调用即留违规码并抛错」的网络 / LLM / 在线翻译禁用端口 | 全链路**零触碰**；哨兵本身由单测主动调用验证「确实会拒绝并留痕」 |
| 两模式比对 | 五份计划正文逐字节相同 | 供应商中立：端口有无不影响业务结果（NFR-009 / FR-028） |

LLM 增强**默认关闭**：`llmEnabled=false`、`deps.llmPort.complete()` 一旦被调用即失败；实现源码静态扫描也确认 `src/core` + `src/cli` 无任何 LLM / 在线翻译 / `fetch` 入口。唯一对外出口是 `src/io/net.js`，且受 `assertSafeCalendarUrl` 静态约束（FR-048）。

## 3. 全链路（`init → 五级 plan → validate → ledger → export-data → delete-data → acceptance`）

每条命令都经 `runCli` 与同一套注入端口执行，`exit` 必须为 0。核心功能完整性逐份计划取证：规范数据区 `rr-data`、三类通知（免责 / 估算 / `[AIGC]`）、九项处方 min/max、两道护栏、五个版本键；`rr validate` 复算 28 项；`export-data` 可无损反解析；`delete-data` 后**重新扫清单**复验零残留（不采信命令自报的 `residue`），内置程序数据保留。

## 4. 十四条门禁

| ID | 结论 |
| --- | --- |
| `levels.all_generated` | 五级 × 两模式全部 `exit=0` / `status=ok` / 正文非空 |
| `ac12.month_week_day` | AC-12 的月 / 周 / 日在已有当年缓存下成功 |
| `network.zero_requests` | 两模式零请求、网络哨兵零触碰 |
| `llm.disabled` | LLM 哨兵零触碰且源码零引用 |
| `determinism.modes_equal` | 两模式计划正文逐字节一致 |
| `plans.complete` | 规范区 / 通知 / 九项处方 / 护栏 / 版本齐备 |
| `commands.offline_ok` | 全链路命令成功、复算 28 项、导出可读、删除零残留 |
| `privacy.output_and_logs` | CLI 行与日志行零私有字段、日志零数字 |
| `privacy.plan_bodies` | 计划正文零私有字段；BMR 作为护栏下限按 FR-002 有意保留 |
| `privacy.static_scan` | 示例显式 `fictional`、仓库无真实数据令牌 / 无 `diet-plan` 目录、个人档案被 `.gitignore` 排除 |
| `static.zero_external_exits` | `src/core` + `src/cli` 零 `fetch` / LLM / 在线翻译 |
| `static.calendar_url_safe` | query / fragment / userinfo / 非 HTTPS 一律拒绝，纯 HTTPS 放行 |
| `consent.no_transfer` | 未授予同意，无任何对外传输尝试 |
| `data_subject.offline` | 导出版本 1 且含条目，删除真实发生且零残留，程序数据保留 |

**防假绿取证**：门禁 ID 必须唯一、数量不少于 12、`ok` 恒等于逐项结论全过；静态扫描的**文件数**与独立 `readdirSync` 计数逐项比对，避免「空扫 = 全通过」；禁用哨兵由单测主动调用验证「确实抛错并留痕」，避免「零触碰 = 门禁有效」。

真实数据令牌正则**动态取自** `.github/workflows/ci.yml`（唯一权威规则），本文件与集成用例都不复制任何真实数据字面量，因此不会被扫描器自命中。

## 5. 校验记录（2026-11-08）

| 项 | 结果 |
| --- | --- |
| 先红证据 | 实现前 `npm test` = **279 tests / 278 pass / 1 fail**（`ERR_MODULE_NOT_FOUND: ../acceptance/offline-integration.mjs`） |
| `node --test tests/unit/offline-integration.test.js` | **23 / 23** |
| `npm test`（全量） | **301 / 301** |
| `node tests/acceptance/offline-integration.mjs` | `status=ok` · `checks=14` · `failed=0` · `requests=0` · `llm_calls=0` · `disk_writes=0` |
| 负向探针 `reviews/t021-negative.mjs` | 23 项弱化逐项检出、全部字节级还原 |
| `npm run acceptance` | 19/19 RED · 0 GREEN（P0 基线未动） |
| `npm run spec-check` | PASS |

## 6. 边界

- **AC-12 / AC-17 仍为 RED**：本任务只提供可执行取证与门禁结论，**不把 `ac-*.md` 状态改为 GREEN**、不勾选 `tasks.md`。按 P-02，转绿须由 T-022（P1 出口门禁）与后续映射任务（T-034 / T-041 / T-042：LLM 离线降级开关、合规文档与静态扫描门禁）在「CI 全绿 + DoD 满足」后统一执行，并需人工审查确认。
- 语言包（`locales/`）与区域策略解析器（`src/core/locale/`）分别归 T-031 / T-032；本用例一律注入替身，**不预置任何译文或区域映射表**。
- 导出文件按 FR-049 **不脱敏**（用户主动拿回自己的数据），因此「不含身体数据」的静态检查对象是日志、示例、CI fixtures、发布物与计划正文，**不是**本地导出文件本身。
- 节气缓存是 T-014 格式的合成虚构数据；本用例不联网刷新，符合 `FR-012` 下层只读与 `AC-12` 的「已存在当年缓存」前提。
- 仓库内不生成 `plans/` / `_exports/` / `logs/` 等运行期产物；全部文件操作发生在内存端口。
