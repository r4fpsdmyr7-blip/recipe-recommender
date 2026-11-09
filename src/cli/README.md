# `src/cli/` · CLI 适配层（T-019 / T-020）

> [AIGC] 本文件由 AI 依据 `SPEC.md v0.4.0-draft` / `plan.md §4 §6.2 §9` / `tasks.md T-019 T-020` 生成 ·
> 审计追踪 ID：`RR-T019-20261108-0001`（T-019）、`RR-T020-20261108-0001`（T-020）· 待人工审查（P-10）

命令集：`rr init` / `rr plan` / `rr validate` / `rr ledger` / `rr acceptance`（T-019）
+ `rr export-data` / `rr delete-data`（T-020）。
映射：`FR-029`、`FR-040`、`FR-041`、`FR-046`、`FR-028`、`FR-033`、`FR-047`、`FR-048`、`FR-049`、`FR-050`、
`AC-12`、`AC-14`、`AC-17`、`SC-009`、`SC-013`、`NFR-002`。

## 1. 模块划分

| 文件 | 职责 | 关键约束 |
| --- | --- | --- |
| `errors.js` | `CLI_ERROR` 稳定码 + `CliError` | `code` 恒为 `ERR_CLI_INVALID`，具体码在 `issues[].code`（同 T-010～T-018 口径） |
| `args.js` | `parseArgs(argv)` → `{command, options}` | 每命令显式选项白名单；重复拒绝；值不得含控制字符 / 竖线 / 反引号 / 绝对路径 |
| `config.js` | `parseConfigText` / `resolveOverrides` | 四层优先级 `CLI > env > config > auto`；固定键集 `lang/guideline/calendar/country` |
| `intl.js` | `createIntlFormatter({locale})` | 只用运行时内置 `Intl`（非第三方、非在线），只影响呈现 |
| `shared.js` | 行构造、端口校验、配置文件读取、issue 展开 | 输出行 `key=value` 且值仅可打印 ASCII |
| `init.js` | `rr init` | 校验档案 → 建三本台账表头 + `rr.config.json`；幂等（E-05 只追加） |
| `plan.js` | `rr plan` | 组合根：档案 → 策略 → 缓存 → 处方 → 计划 → 语言包 → 渲染 → 落盘 |
| `validate.js` | `rr validate` | 以 `rr-data` 规范数据区为准复算比对（与语言 / 排版解耦） |
| `ledger.js` | `rr ledger` | 只读；行**原样透传**，不重新序列化 |
| `acceptance.js` | `rr acceptance` | 只做参数转发与红绿汇报，驱动仍在 `tests/acceptance/` |
| `inventory.js` | 数据清单 + 导出格式 | 用户数据全量、程序数据永不入册；围栏长度自适应、可无损反解析 |
| `export-data.js` | `rr export-data` | 逐字节导出用户数据；终端与日志只出计数与稳定码 |
| `delete-data.js` | `rr delete-data` | 缺 `--confirm` 零删除；删后复验 `residue=0`，非 0 失败关闭 |
| `run.js` | `runCli(argv, deps)` | 退出码契约 + 错误展开；解析失败不进入任何命令 |

配套 IO 端口：`src/io/log.js`（T-020 日志适配器，见 §6）。

## 2. 口径细化（本轮定案）

| ID | 结论 |
| --- | --- |
| `FR-029` | 命令集严格限定为七条（T-019 五条 + T-020 两条）；`locales` 归 T-031、`serve-mcp` 归 T-030、`feedback` 归 M2 细化，**不出现在本任务** |
| `FR-046` | 本层只做「取值 + 记录来源」，**不决定任何策略值**；国籍 → 居住地 → 回退归 T-032 `resolveLocalePolicy` |
| `FR-046` | 来源分三层（`cli` / `env` / `config`），env 变量名是稳定契约：`RR_LANG` / `RR_GUIDELINE` / `RR_CALENDAR` / `RR_COUNTRY` |
| `FR-046` | 失败关闭：任一层出现非法值即拒绝，env 的空串视为「未设置」，CLI / 配置层的空串视为配置错误 |
| `FR-041` | 输出只有 `key=value`，值仅可打印 ASCII；错误只有 `error=<稳定码>` + `issue=<码>:<字段>:<提示>`，零自然语句 |
| `FR-028` | 同输入两次运行输出与落盘字节完全一致；无时间戳、无随机数、无环境推断 |
| `FR-043` | `intlFormatter` 只做区域呈现；`render` 侧仍校验其输出确定 / 单行 / 不含竖线与反引号 |
| `FR-007` | `--date` 只覆盖**运行日**，不伪造运行时刻：日级仍要求业务时区 20:00 触发 |
| `AC-12` | `rr plan` 只读当年时令缓存，**零对外请求**（断网 + 缓存即可产出全部层级） |
| `AC-14` | `--red-check` 若发现已绿场景，判定基线被绕过并失败（`ERR_CLI_DRIFT`），不继续 |
| `SC-009` | 从零到第一份日计划 = `rr init --profile <p>` + `rr plan --level day` = **2 步** |
| `P-14` | CLI 输出与错误永不携带身体数值；计划正文只允许 BMR 作为护栏下限出现（`FR-002` 要求） |
| `P-11` | `src/cli/*.js` 零 `node:` 导入（只经注入端口），首行 SPDX 头；输出行构造做 ASCII 门禁 |

### 2.1 T-020 追加定案

| ID | 结论 |
| --- | --- |
| `FR-049` | **用户数据** = 根目录 7 个文件（`changelog.md` / `daily-plan.md` / `feedback.md` / `history.md` / `periodic-plan.md` / `rr.config.json` / `weekly-plan.md`）+ 5 个目录（`_exports` / `data/calendar` / `logs` / `plans` / `profiles`）。`data/guideline/` 是内置程序数据，**不导出、不删除** |
| `FR-049` | 删除必须显式 `--confirm`：缺失即 `ERR_CLI_CONFIRM` 且**一次文件读写都不发生**，删除不可撤销不能靠默认值 |
| `FR-049` | 删除后重新扫清单复验，`residue=0` 才算成功；非 0 即 `ERR_CLI_RESIDUE` 失败关闭（`SC-013` 无残留）。代价是错误路径不输出 `deleted` 计数——见 §6.3 |
| `FR-047` | 导出含**用户全部数据原样内容**（含身体档案）：这是用户拿回自己数据的唯一途径，不做脱敏；脱敏等于不给数据 |
| `FR-047` | 但 CLI 输出行与日志行**零身体数值**：`files` / `deleted` / `residue` 只是计数，事件只有 Canonical ID |
| `FR-048` | 两条命令**不引用 `netPort`**，源码零 `node:` / 零 `fetch` / 零硬编码 URL；「零上传」由源码可静态证明，不靠运行期断言 |
| `FR-050` | 清单一律 POSIX 相对路径、纯 ASCII；格式层只校验路径**形状**（安全相对 ASCII），归属判断只在清单层 |
| `NFR-002` | 日志值**只接受字符串**且必须是 Canonical ID / 稳定码：`typeof value === 'number'` 直接拒绝，身体数值在类型层就进不了日志 |
| `FR-028` | 导出确定：同输入两次字节一致、纯 LF、单一结尾换行、零时间戳；围栏长度 = 正文最长反引号段 + 1，故正文含 ``` 也不截断 |

## 3. 端口契约（`runCli(argv, deps)`）

| 端口 | 必需性 | 归属 | 缺失时 |
| --- | --- | --- | --- |
| `fsPort` | 全部命令 | T-002 | `ERR_CLI_PORT.(deps).fsPort` |
| `clock` | `plan` / `validate`（推导文件时） | T-002 | `ERR_CLI_PORT.(deps).clock` |
| `resolveLocalePolicy` | `plan` | **T-032** | `ERR_CLI_PORT.(deps).resolveLocalePolicy` |
| `loadLanguagePack` | `plan` | **T-031** | `ERR_CLI_PORT.(deps).loadLanguagePack` |
| `acceptanceRunner` | `acceptance` | T-004 驱动 | `ERR_CLI_PORT.(deps).acceptanceRunner` |
| `intlFormatter` | 可选 | T-019 | 缺省用 `createIntlFormatter({locale})` |
| `logPort` | `export-data` / `delete-data` | T-020 | `ERR_CLI_PORT.(deps).logPort`（exit 3） |
| `netPort` | 仅测试断言零请求 | T-002 | 本任务不使用 |

**端口缺失即失败，不内置兜底实现**——否则会把 T-031 的七语言包与 T-032 的区域映射偷偷复刻一份。

## 4. 退出码

| 码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 用法错误（命令 / 参数层） |
| `2` | 业务拒绝（档案、计划、校验、渲染等域错误） |
| `3` | 端口缺失（未注入必需依赖） |

## 5. 校验记录（2026-11-08）

| 项 | 结果 |
| --- | --- |
| `node --test tests/unit/cli.test.js` | **44 / 44** |
| `node --test tests/unit/log.test.js` | **10 / 10** |
| `node --test tests/unit/privacy.test.js` | **18 / 18** |
| `npm test`（全量，含 T-020） | **278 / 278** |
| `npm run acceptance` | 19/19 RED · 红态基线有效（exit 0 仅代表基线完整，P-02） |
| `npm run spec-check` | PASS |
| 负向探针 `reviews/t019-negative.mjs` | 38 项弱化逐项检出，全部字节级还原 |
| 先红证据（T-019） | 实现前 `npm test` = 207 tests / 206 pass / **1 fail**（`ERR_MODULE_NOT_FOUND: src/cli/index.js`） |
| 先红证据（T-020） | 实现前 `npm test` = 252 tests / 249 pass / **3 fail**（`log.test.js` / `privacy.test.js` / 命令集断言；根因 `does not provide an export named 'LOG_ERROR'`） |

## 6. 数据主体命令口径（T-020）

### 6.1 清单与导出格式

- 清单口径见 §2.1 第一行；`listDataFiles` 排序输出 POSIX 相对路径，目录缺失即空（E-05：首次运行与删除后重跑都要能过）。
- 导出格式：`# rr-export` + `version=1` + 每文件一节（`## file: <path>` + 围栏）。围栏长度 `= max(3, 正文最长反引号连续段 + 1)`，因此正文里的 ``` 永远不可能与围栏混淆，`parseExportText(buildExportText(x)) === x` 可无损往返。
- `buildExportText` / `parseExportText` 只校验路径**形状**，不判断归属——否则这个纯函数就无法作为最小往返单元独立使用（本轮实现即因此修正过一次分层错误）。

### 6.2 导出计数

`files=` 报**清单条目数**（含目标文件自身）。当导出目标落在清单内（重跑 `export-data`）时，正文会排除目标文件以避免自引用，故「正文条目数」最多比 `files` 小 1。选择这个语义是因为：`files` 是清单规模的可观测指标，自引用排除是写入细节，两者混为一谈会让「上次的导出算不算我的数据」变得不可判断。

### 6.3 残留即失败关闭

`delete-data` 删除后重新扫清单，`residue != 0` 时抛 `ERR_CLI_RESIDUE`（exit 2）。**已知代价**：错误路径整体替换成功输出，`deleted` 计数不输出。取舍是「宁可少报一个计数，也不能报告成功却没删净」——`SC-013` 的「无残留」是可验收结论，不是可参考提示。重跑 `rr delete-data --confirm` 幂等，可作为重试手段。

该路径由故障注入单测固定：把 `FsPort.remove` 换成「跳过 `data/` 下所有文件」，`delete-data` 必须 exit 2 且报 `ERR_CLI_RESIDUE`，而不是报告成功（Round 12 探针 NEG-31 暴露的门禁缺口，已补独立取证断言）。

### 6.4 日志适配器（`src/io/log.js`）

- 行格式固定 `level=<三档> event=<Canonical ID> code=<ok|ERR_*>`（可选 `field=<Canonical ID>`），零时间戳、零数字、零自然语句。
- 值只接受**字符串**且必须匹配 Canonical ID / 稳定码正则；数值、布尔、`null`、数组、对象一律 `ERR_LOG_VALUE`。身体数值因此在类型层就进不了日志，无需事后清洗。
- 固定键集白名单 `{event, code, field?}`：`body` / `note` / `path` 等未知键直接拒绝，防止「顺手把上下文塞进日志」把个人信息带出去。
- 零 IO：不落盘、不联网、不读环境；落地只经注入的 `sink`，缺省不写任何地方。
- 端口缺失即 `ERR_CLI_PORT`（exit 3）：数据主体操作不允许「无审计痕迹地完成」。

## 7. 边界

- `AC-12` / `AC-14` / `AC-17` 仍需 T-021 / T-034 / T-041 与验收驱动转绿，本任务完成后**仍为 RED**。
- 年为单位的**联网刷新**入口不在 T-019 命令集内：`rr plan` 只读缓存（`FR-012` 下层只读）。
- 语言包内容（`locales/`）与区域映射表（`data/region/`）分别归 T-031 / T-033，本目录**不含任何译文或映射数据**。
- 导出不加密、不打包：`FR-049` 只要求「用户能一次性拿走」，格式可读优先；传输与备份不属本任务。

---

## 8. T-030 追加定案（`rr serve-mcp`）

> 本节由 T-030 追加；上文 §1～§7 是 T-019 / T-020 的 P1 定案，保留不改作为历史取证。

- `src/cli/args.js` 的 `COMMANDS` 保持**七条 P1 快照一字不改**；新增 `P2_COMMANDS`（`['serve-mcp']`）与 `ALL_COMMANDS`（解析白名单 = P1 ∪ P2）。`cli.test.js` / `privacy.test.js` / `reviews/agent-p1.mjs` 的 P1 判定因此既未被改写、也未被放宽；`locales` / `feedback` 仍是越界命令。
- `src/cli/serve-mcp.js` 是唯一新增处理器，只做端口校验与桥接，不生成计划 / 台账 / 译文。MCP 实现全部在 `src/mcp/`（见该目录 README）。
- `mcpInput` / `mcpOutput` 未注入即 `CliError(ERR_CLI_PORT)` → `runCli` exit `3`，与 T-019 端口缺失口径一致；`mcpPorts` 可缺省，此时四个 `rr_` 工具各自返回 `ERR_MCP_PORT`。
- **输出契约唯一例外**：MCP 帧直接写注入流，处理器返回零条 `key=value` 行、`status=` 收尾对该命令不适用，否则会污染 stdio 帧流。此例外由 `tests/unit/mcp.test.js` 固定断言。
- 原生异常文本在桥接层折叠为稳定码，不回传客户端（FR-048）。
- 本追加**不改任何 P0 基线、不改 `ac-*.md` 状态、不改 `tasks.md` 勾选项，也不把 P1 门禁 `BLOCKED` 改写为通过**。
