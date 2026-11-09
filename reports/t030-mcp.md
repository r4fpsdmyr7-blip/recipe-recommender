# T-030 报告 · MCP Server `rr serve-mcp`

> 日期：2026-11-09 · 基线提交：`ac2a28d`（未 push，`main...origin/main [ahead 2]`）
> 映射：FR-030 / FR-048 / AC-14 / SC-009 / NFR-008 · `tasks.md §4.2 T-030`
> 状态：**实现完成、未提交、待人工审查（P-10）**
> [AIGC] 本报告由 AI 生成 · 审计追踪 ID：`RR-T030-20261109-0001`

---

## 0. 结论摘要

T-030 按 ATDD 先红后绿完成：14 条新单测，全量 `337/337`，lint `10/10`、
spec-check `PASS`、覆盖率 `94.28 / 83.92 / 98.26`（三列均 ≥80）、独立负向探针 `27/27`。

**P1 出口没有被改动**：P1 门禁仍 `verdict=BLOCKED` / `status=blocked` / exit 2，
`AC-01～19` 仍 19/19 RED，`tasks.md` 仍 `39 [ ] / 0 [x]`，P0 基线零改动。
本次交付**不代表 P1 出口达成、不代表 M3/M4 验收通过、不代表 AC-14 转绿**。

---

## 1. 进度核查（开工前实测）

| 项 | 实测 |
|----|------|
| HEAD / 工作树 | `ac2a28d` · `status_lines=0` · staged 0 · untracked 0 · ahead 2 |
| 基线单测 | `323/323` |
| `src/mcp/` | 仅 `.gitkeep`，无任何实现 |
| P1 门禁 | `node tests/acceptance/gates/p1-gate.mjs` → exit 2 · `verdict=BLOCKED` · `checks=6 failed=0` |
| `tasks.md:102` | T-022 写明「AC-01～12 全部转绿…**未绿不得进入 Phase 2**」 |
| `reports/t022-gate.md §4/§7` | 四选一裁决待人工书面决定；「裁决前不推进 T-030」 |
| CLI 命令集 | `COMMANDS` 冻结为 7 条；`serve-mcp` / `locales` / `feedback` 被 P1 单测与审查器判为越界 |

---

## 2. 门槛与豁免 Issue 登记（`constitution.md §4`）

`constitution.md §4` 规定：临时豁免原则**不允许**由 AI 自行决定，必须记录为 Issue，
说明范围、理由、恢复条件，并经用户确认。据此登记：

| 字段 | 内容 |
|------|------|
| Issue ID | `ISSUE-20261109-T030-GATE` |
| 触发 | 用户本轮显式指令「检查任务进度，推进p2，开始t-030」 |
| 冲突 | `tasks.md:102` 的 P1→P2 阶段门槛；T-022 报告 §4「裁决前不推进 T-030」 |
| 裁决解释 | 按 §4 选项 **D**（维持 `BLOCKED`，P1 不出口；T-022 作为体检报告基线化，**P2 完成后回头补转绿**）理解用户指令。D 是 AI 建议的 A / D 二选一之一，零规格改动、不降低验收强度 |
| **范围** | 仅 T-030 一个任务；仅「开发顺序」层面并行推进，不含任何出口条件、验收标准或基线状态的变更 |
| **理由** | 用户显式要求推进 P2 并开始 T-030；`src/mcp/` 与 P1 核心域无文件重叠，可按阶段分层注册表隔离取证 |
| **恢复条件** | T-022 §4 裁决正式选定后，按裁决结果补做转绿 / 补正文接线；若用户判定本次解释不成立，整体回滚工作树即可（**未 commit、未 push**） |
| **确认来源** | 用户 2026-11-09 消息「检查任务进度，推进p2，开始t-030」；**本条为 AI 对该指令的解释，非用户逐字确认，请人工复核或撤销** |
| 未做的事 | 不改 `SPEC.md` / `plan.md` / `constitution.md` / `tasks.md` / `ac-*.md` / `ci.yml`；不改 P1 `verdict`；不勾 `tasks.md`；不把任何 AC 转 GREEN；不提交 |

> 若用户认为「推进p2」并非对 §4 的裁决，请直接告知，本次全部产物保持未提交状态、可无痕撤销，
> 并回到 T-022 审查点重新选择 A / B / C / D。

---

## 3. ATDD 红→绿记录（P-02 / AC-14）

| 阶段 | 取证 |
|------|------|
| RED | 先写 `tests/unit/mcp.test.js`（14 条断言），运行 `node --test tests/unit/mcp.test.js` → exit 1 · `ERR_MODULE_NOT_FOUND: src/mcp/index.js`，确认实现存在前为红 |
| GREEN | 落盘 `src/mcp/` 四个模块 + CLI 桥接后重跑 → `14/14 pass` |
| 防假绿 | 负向探针 `NEG-05` 对 4 个工具 × 5 类身体数据注入全部要求 `ERR_MCP_PRIVACY` 且不回显；`NEG-06` 断言 P1 门禁仍 BLOCKED / AC 全红 / 零勾选 |

`AC-14` 本身是 T-004 登记的 P0 红态基线，本次**一行未改，仍为 RED**；
T-030 只是它的映射任务之一，不构成转绿（转绿还需 CI 全绿 + DoD，见 `ac-14.md §30`）。

---

## 4. 实现与定案

### 4.1 新增文件

| 文件 | 职责 |
|------|------|
| `src/mcp/errors.js` | 10 个 `MCP_ERROR` 稳定码、`McpError`；`message` 只拼稳定码 |
| `src/mcp/tools.js` | 4 个 `rr_` 工具描述符、参数白名单、`assertSafePayload` / `assertSafeText` 类型层隐私护栏、端口注入 |
| `src/mcp/jsonrpc.js` | JSONL 帧 + JSON-RPC 2.0 子集（`initialize` / `ping` / `tools/list` / `tools/call` / `resources/list` / `prompts/list`） |
| `src/mcp/index.js` | 统一出口、`createMcpServer`、`serveMcp` stdio 组合根（输入 / 输出全注入） |
| `src/mcp/README.md` | 模块定案（帧、协议、四工具、隐私护栏、CLI 接线、边界） |
| `src/cli/serve-mcp.js` | CLI 桥接：端口校验 → `serveMcp` → 原生异常折叠为稳定码 |
| `tests/unit/mcp.test.js` | 14 条红→绿单测 |

### 4.2 修改文件（仅 P1 产物，非 P0 基线）

`src/cli/args.js`（+13 −4）、`src/cli/index.js`（+2 −1）、`src/cli/run.js`（+4）、
`src/cli/README.md`（+13，追加 §8 定案）。

### 4.3 关键决策

1. **零依赖 stdio JSONL**：未引入 MCP SDK（许可存疑时的既定退化路径）；`src/mcp/` 零 `node:` 导入、零网络监听、零 `fetch`；`ci.yml` 的 `privacy-scan` 禁止 `package.json` 出现 `bin`，因此 `rr serve-mcp` 落地为 `runCli(['serve-mcp'], deps)` 可调用入口，stdio 流由宿主注入。
2. **阶段分层命令注册表**：`COMMANDS` 保持 P1 七条快照一字不改，新增 `P2_COMMANDS = ['serve-mcp']` 与解析白名单 `ALL_COMMANDS`。`tests/unit/cli.test.js` / `privacy.test.js` / `reviews/agent-p1.mjs` 的 P1 判定**未改写、未放宽**；`locales` / `feedback` 仍越界。独立探针 `NEG-02` 复算 P1-32 正则口径通过。
3. **隐私在类型层拒绝**：入参只收 Canonical ID 字符串与 `[0,1000]` 整数计数；出参只收 `null` / `boolean` / 字符串 / `[0,10000]` 整数，浮点、身体字段名、身体数据标记文本一律拒；整帧序列化后再过最后一道护栏。工具描述零数字。
4. **零内置兜底**：四个业务端口全注入，缺失即 `ERR_MCP_PORT`；`rr_list_locales` 不预置七语言包（归 T-031）。
5. **stdio 输出例外**：`rr serve-mcp` 的协议帧直写注入流，`runCli` 返回**零条** `key=value` 行，避免污染帧流；该例外由单测与 `NEG-07` 固定。

---

## 5. 校验结果

| 命令 | 结果 |
|------|------|
| `npm test` | **337/337 pass, 0 fail**（基线 323 + T-030 新增 14） |
| `node --test tests/unit/mcp.test.js` | 14/14 pass（红态时 0 pass / 1 fail） |
| `npm run lint` | PASS · 10/10 · 105 个源码文件 · `boundary.cli_no_node_imports=PASS` |
| `npm run spec-check` | PASS · FR 53/53 · AC 19/19 · SC 15/15 · `[NEEDS CLARIFICATION]=0` |
| `node scripts/coverage.mjs` | PASS · line 94.28% / branch 83.92% / functions 98.26%（均 ≥80） |
| `node tests/acceptance/gates/p1-gate.mjs` | exit **2** · `verdict=BLOCKED` · `status=blocked` · `checks=6 failed=0` · `baseline_touched=0` · `scanned_files=105` / `independent_count=105` · `offline_checks=14 failed=0` · `gate.static_privacy=ok` |
| 独立负向探针 `/tmp/t030-probe.mjs` | **27/27 pass**（全仓令牌重扫、P1-32 口径、零网络出口、运行时 fetch 禁用、20 组隐私注入、防假绿、stdio 纯度） |
| P0 基线 diff | `none`（`SPEC.md` / `plan.md` / `constitution.md` / `tasks.md` / `ac-*.md` / `run.mjs` / `scripts/acceptance.mjs` / `ci.yml` 均未改） |
| AC / 勾选 | 19/19 RED · `39 [ ] / 0 [x]` |
| Git | HEAD 仍 `ac2a28d` · 4 改 + 7 新增 · **未 commit / 未 push** |

---

## 6. 边界与未决

- **默认不可用**：未注入 `mcpPorts` 时四个工具全部返回 `ERR_MCP_PORT`。这是真实能力状态，不是端到端产品。
- **`rr serve-mcp` 无独立可执行文件**：`package.json` 无 `bin`（`ci.yml` 明令禁止），入口是 `runCli(['serve-mcp'], deps)`；真实 stdio 需由宿主注入 `process.stdin` / `process.stdout`。
- 计划正文、校验规则、台账、七语言包、区域映射、数据源仍分别归 T-012 / T-013 / T-015 / T-031 / T-032 / T-033 / T-035；本层只做脱敏与传输。
- `ci.yml` **未接入** T-030 门禁（P0 已跟踪基线，`TOKENS` 是 T-021 动态提取的唯一权威规则，P-10）；CI 接入留 T-042。
- T-022 报告登记的三组规格张力（类型检查 `tsc` vs 零依赖、缓存路径、节气内置近似表）与四选一裁决**仍待人工书面决定**，本次未触碰。
- 既有两处 P1 遗留不变：`docs/competitive-research.md:172` M0 滞后文字留 T-040；`.gitkeep` 留 T-040 与其它占位一起清理。
- Round 15 双代理复审证据（`reviews/round-15/`）冻结在 `ac2a28d`；P1 审查器是 P1 定案工具，P2 若需复审应另建 P2 审查器，本次未运行、未修改。

---

## 7. 下一步（等审查）

按项目节奏，本任务到此停下，等用户审查「产出 / 校验结果 / 边界」。

- 若审查通过并要继续 → 用户说「继续 T-031」再推进；
- 提交 / push 须用户**另行显式授权**（P-10）；
- 若用户否决 §2 的门槛解释 → 整体回滚工作树，回到 T-022 裁决点。
