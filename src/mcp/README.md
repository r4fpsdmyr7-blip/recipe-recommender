# T-030 · MCP Server 适配层定案

> 任务：`tasks.md §4.2 T-030` · 映射 FR-030 / FR-048 / AC-14 / SC-009 / NFR-008
> 实现：`src/mcp/` · CLI 入口 `rr serve-mcp` · 零第三方依赖 / 纯 ESM / Node ≥20
> [AIGC] 本记录由 AI 依据 `SPEC.md` / `plan.md §6.2 §6.3` 生成，待人工审查（P-10）

---

## 1. 范围与硬约束

| 约束 | 落地 |
|------|------|
| stdio 本地传输、不监听网络端口 | `src/mcp/` 无任何 `node:` 导入；`input` / `output` 全注入；静态断言禁 `createServer` / `listen` / `fetch` / `WebSocket` |
| SDK 许可存疑 → 退化为零依赖最小层 | 未引入 MCP SDK，自实现 JSONL 帧 + JSON-RPC 2.0 子集 |
| 工具描述与返回值不含身体数据 | 描述内零数字；入参 / 出参在**类型层**拒绝浮点与身体字段名；整帧序列化后再过一次护栏 |
| 错误信息不得含个人数值 | `McpError.message` 只拼稳定码；`tools/call` 失败文本只有一个稳定码，不回显异常文本 |
| 零内置兜底 | 四个业务端口全部注入，缺失即 `ERR_MCP_PORT`；不伪造计划、台账或语言包 |

## 2. 帧与协议

- **帧格式**：newline-delimited JSON（JSONL），一条消息一行、UTF-8；`JSON.stringify` 会转义行内换行，因此帧内不可能出现裸换行。
- **缓冲**：`serveMcp` 按 `\n` 切分并保留跨 chunk 残片；输入流结束时的无换行尾帧也会处理。
- **协议版本**：`2024-11-05`，`initialize` 回 `capabilities.tools` 与 `serverInfo`；不做静默版本协商。
- **方法集**：`initialize` / `ping` / `tools/list` / `tools/call` / `resources/list` / `prompts/list`。
- **通知**：`notifications/*`（以及一切无 `id` 消息）一律返回 `null`，**不回帧**。
- **JSON-RPC 错误码**：`-32700` 解析、`-32600` 请求形状、`-32601` 未知方法、`-32602` 参数形状、`-32603` 出参护栏回退。

错误分两层，刻意区分：

| 层次 | 表现 | 例子 |
|------|------|------|
| 协议 / 参数层 | JSON-RPC `error`，`message` 为稳定码 | 非法 JSON、未知方法、额外参数键、参数含浮点 |
| 工具执行层 | `tools/call` 结果 `isError: true`，文本只有一个稳定码 | 端口缺失、端口回传身体数据 |

## 3. 四个工具（`plan.md §6.3`）

| Tool | 输入（不含身体数据） | 注入端口 | 返回固定键集 |
|------|---------------------|----------|--------------|
| `rr_generate_plan` | `level` `date` `profile_ref` `lang` `guideline` `calendar` | `generatePlan` | `status` `plan_ref` `plan_markdown` `verdict` |
| `rr_validate_plan` | `plan_ref` `level` | `validatePlan` | `status` `verdict` `violations` |
| `rr_query_ledger` | `type` `last` | `queryLedger` | `status` `type` `rows` `entries` |
| `rr_list_locales` | 无 | `listLocales` | `status` `locales` |

- `profile_ref` / `plan_ref` 是**本地引用 ID**，不是身体档案正文；形状限制为 Canonical ID（字母数字起头、`[A-Za-z0-9._:/-]`、≤128 字符）。
- `inputSchema.additionalProperties = false`：额外键（例如 `weight_kg`）在参数层即被 `ERR_MCP_ARGS` 拒绝。
- 整数参数只允许 `[0, 1000]` 的计数；其它值必须是字符串 Canonical ID。**浮点在类型层进不来**，与 T-020 日志端口同构。
- `rr_list_locales` 不预置语言标签列表（T-031 才产出 `locales/`）；缺端口时如实返回 `ERR_MCP_PORT`，不假装已有七语言包。

## 4. 隐私护栏（FR-048 / FR-053）

`assertSafePayload` 递归检查工具返回值：

1. 只允许 `null` / `boolean` / `string` / `[0, 10000]` 的整数 / 数组 / 普通对象；
2. **任何浮点数一律拒绝**（身体数值几乎总带小数）；`function` / `undefined` / `bigint` 拒绝；
3. 对象键命中 `BODY_KEY`（`weight_kg` / `height_cm` / `body_fat` / `bmr_kcal` / `age` / `bmi` …）即拒绝；
4. 字符串命中 `FORBIDDEN_MARKERS` 或 `BODY_TEXT`（中文字段名、`kg` / `cm` 人体单位、`bmr` 等）即拒绝；
5. `serveMcp` 在**整帧序列化之后**再跑一次 `assertSafeText`，作为最后一道防线；命中则改写为 `ERR_MCP_PRIVACY` 错误帧，不回显原帧。

刻意**不误伤** `profile_ref` / `plan_ref`：白名单是精确字段名匹配，不做宽泛前缀拦截。

`MCP_ERROR` 稳定码共 10 个：`ERR_MCP_INVALID` / `REQUEST` / `PARSE` / `METHOD` / `ARGS` / `TOOL` / `PORT` / `PRIVACY` / `PAYLOAD` / `TRANSPORT`。

## 5. CLI 接线与 P1 取证口径

- `src/cli/args.js` 保留 `COMMANDS` 作为 **P1 阶段冻结的七命令快照**（T-019 五条 + T-020 两条），新增阶段分层注册表 `P2_COMMANDS = ['serve-mcp']` 与解析白名单 `ALL_COMMANDS = [...COMMANDS, ...P2_COMMANDS]`。
- 这样 `tests/unit/cli.test.js` / `privacy.test.js` 与 `reviews/agent-p1.mjs` 的 **P1 判定一字未改、也未放宽**；`locales` / `feedback` 仍是越界命令。
- `src/cli/serve-mcp.js` 只做桥接：要求注入 `mcpInput` / `mcpOutput`，缺失即 `CliError(ERR_CLI_PORT)` → `runCli` exit `3`。
- **stdio 例外**：`rr serve-mcp` 的协议输出直接写入注入的 `mcpOutput`，`runCli` 返回**零条** `key=value` 行，以免污染 MCP 帧流。这是 `src/cli/run.js` 输出契约中唯一显式登记的例外。
- 原生异常文本在桥接层被折叠为稳定码，绝不回传（FR-048）。

## 6. 边界（不得越界解读）

- 本任务**只交付 MCP 适配层**；计划正文、校验规则、台账、七语言包、区域映射分别归 T-012 / T-013 / T-015 / T-031 / T-032 / T-033 / T-035。
- `tools/call` 的可用能力完全取决于注入端口；**默认无端口时四个工具均返回 `ERR_MCP_PORT`**，不代表产品端到端可用。
- `AC-14` 仍是 P0 登记的 **RED** 基线；本任务不把任何 `ac-*.md` 改为 GREEN，不改 `tasks.md` 勾选项，不改 P1 门禁 `verdict=BLOCKED`。
- `plan.md §6.3` 的「输出计划 Markdown」由注入端口提供；MCP 层只负责脱敏与传输，不生成营养内容。
- 未改 `ci.yml`（P0 已跟踪基线，且 TOKENS 是 T-021 动态提取的唯一权威规则）；CI 接入留 T-042。
