# `src/core/render/` · Markdown 渲染层（T-018）

> [AIGC] 审计追踪 ID：`RR-T018-20261108-0001` · 待人工审查（P-10）

**依据**：`tasks.md` T-018；`SPEC.md` FR-006、FR-009、FR-028、FR-033、FR-040～044、NFR-006、AC-12、AC-13、SC-011、§9 不变式、P-02 / P-05 / P-11 / P-14；`plan.md §5.2 / §5.4 / §6.1 / §8`；`constitution.md` P-11 门禁清单。

**范围**：`render(planObject, languagePack, intlFormatter)` —— 把 T-013 的**未渲染结构化计划对象**转成用户指定语言的 UTF-8 Markdown（表格化、Git 可 diff）。含头部元数据、五类版本、上承 / 下接、九项处方、护栏、时令、日期、免责声明 / 估算值说明 / `[AIGC]` 标注。**不加载语言包、不实现回退链、不落盘、不调度、不生成菜谱、不联网**：语言包与回退链归 T-031，文件写入与端到端调度归 T-019。因此 AC-12 / AC-13 在本任务完成后**仍为 RED**。

## 文件职责

| 路径 | 职责 |
|------|------|
| `errors.js` | `RENDER_ERROR` 13 码、`RenderError`（消息只拼稳定码，issue 只含 `{code, field, hint}`，hint 全为 Canonical ID） |
| `contract.js` | 固定语言包键集 `LANGUAGE_PACK_KEYS`、三份契约校验（语言包 / 格式化器 / 计划对象）、`resolvePackKey` 三态 |
| `data.js` | 纯 ASCII `rr-data` 规范数据区：`buildRenderData` / `extractCanonicalBlock` / `extractRenderData` |
| `render.js` | 纯函数 `render()`：确定性 Markdown 表格、FR-033 面向用户标注、FR-042 回退 / 缺键标注 |
| `index.js` | 统一出口 |
| `tests/unit/render.test.js` | 40 条先红后绿单测 |

依赖 T-013 `PLAN_LEVELS`、T-011 `RX_FIELDS`、T-010 `VERSION_KEYS`（直接引用具体模块，不经 barrel 拉入 IO 相关实现）。`src/core/render/.gitkeep` 按用户 2026-11-08 裁决留 T-040 统一清理，本任务不删。

## 口径细化（不改 SPEC.md，仅记录工程解释）

| 规格措辞 | 实现口径 |
|---|---|
| FR-041「全部面向用户的字符串外部化」 | `src/core/render/*.js` **全部源码为纯 ASCII**（连注释也不含非 ASCII 字节）。所有标签只是 `render.*` Canonical ID；真实文案由注入的 `languagePack.strings` 提供。CI / 审查可用「非 ASCII 字节扫描」直接判定 |
| FR-042「请求语言 → 基础标签 → 默认 → `en`」 | **回退链本身归 T-031**。本层只消费链的结果：语言包固定三键 `{tag, strings, fallback_keys}`，`fallback_keys` 是经回退链解析出来的键，渲染时前缀 `render.marker.fallback` 显式标注；仍缺的键不抛错、不混排外语，输出 `render.marker.untranslated` + 反引号包裹的原始 Canonical ID |
| FR-033「全部以用户指定语言呈现」 | 免责声明、估算说明、`[AIGC]` 文案全部取自语言包；`[AIGC]` 字面标记是 ASCII 标记而非自然语言。`header.notice_keys` 必须齐备三条基类键，否则 `ERR_RENDER_NOTICE` |
| FR-009「头部写明四个数据版本 + 规则版本、生成日期、周期、上承 / 下接」 | 独立 `metadata` / `versions` / `links` 三张表；`version_ids` 固定键集只有 `body/rx/loc/st/rule`，缺键 / 多余键一律拒绝 |
| FR-043「数值 / 日期 / 单位按区域格式化」 | `intlFormatter` 固定两函数 `{number(value, unitKey), date(value)}`，由 T-031 / T-019 注入；本层只校验其输出确定性、单行、不含表格分隔符与反引号，防止注入破坏 Markdown 结构 |
| FR-044 / NFR-006「切换语言不改任何数值 / 语义」 | 所有机器相关值以**原始反引号 token**呈现，且另有一块 ` ```rr-data ` 规范数据区：只由计划对象推导，**绝不读语言包与格式化器**。两种语言渲染的规范数据区字节相同、反引号 token 序列相同、`extractRenderData()` 深度相等 |
| FR-028「Git 可 diff 结构化 Markdown」 | 纯 LF、无 BOM、无行尾空格、单一结尾换行、键按 ASCII 排序、无时间戳 / 随机数 / 环境变量；两次同参渲染字节一致 |
| P-14「身体数据不出本机」 | 计划对象顶层是固定键集白名单，`body` / `weight_kg` 之类注入即 `ERR_RENDER_PLAN`；渲染输出不含任何身体字段与原始身体数值 |
| `render(planObject, ...)` 的泛型性 | 计划对象可带可选 `sections`（`{id, title_key, columns, rows}` 纯结构化表），供 T-019 把 T-016 采购 / 四餐、T-017 检查章节等结构化对象接入渲染，**渲染层不认识任何业务字段名** |

## 设计决策与边界

### 1. 语言包键集是本任务对 T-031 的契约

`LANGUAGE_PACK_KEYS`（约 70 个 `render.*` 键 + 3 个 `plan.*` 通知键）已冻结、排序、去重、全为 Canonical ID。`locales/_schema/keys.json` 与七个内置语言包（T-031）MUST 覆盖该集合；`validateLanguagePack()` 缺一键即 `ERR_RENDER_PACK_KEY`。额外键（菜品、食材、反馈状态等）允许存在，但键必须是 Canonical ID、值必须是非空单行且不含 `|` / 反引号。语言包外层固定三键，杜绝字段注入。

### 2. 「回退键单独标注」落在渲染层，回退链不落在这里

本层**不**读取 `locales/`、不解析 BCP 47 基础标签、不选择默认语言。T-031 完成链解析后把结果交给本层：命中的普通键直接输出；经回退的键带 `render.marker.fallback`；链也找不到的键带 `render.marker.untranslated`。这样既满足 FR-042「不得静默混入另一语言」，也不会与 T-031 的职责重复实现。

### 3. FR-044 的可执行证据是规范数据区，不是口头约定

可见表格里的数字 / 日期是 `intlFormatter` 的**显示字符串**（允许千分位、日期语序等区域差异）。语义值另有一块纯 ASCII `key=value` 规范数据区钉死：`extractCanonicalBlock()` 与 `extractRenderData()` 可把两种语言的输出还原成同一份记录，成为 FR-044 / SC-011「语言切换后营养数值与去重指纹不变」的机器可校验锚点。数据区拒绝重复键、乱序、非 ASCII 与非规范键，防止被篡改后冒充「语言无关」。

### 4. 核心域零 IO、零自然语言

`render()` 只做校验 + 字符串拼装：不注入 `FsPort` / `ClockPort` / `NetPort`，不 `import node:*`。错误对象沿用本项目既有形态（`code` 恒为 `ERR_RENDER_INVALID`，具体码在 `issues[].code`），消息不含自然语言、身体数值或个人数据。

### 5. 仍红的原因（P-02）

T-018 只产出**渲染能力**。AC-12 需要 T-019 / T-020 / T-021 的断网端到端链路与隐私门禁；AC-13 需要 T-040～042 的社区规范文件与 CI 门禁。T-018 只贡献其中「示例输出含免责声明 / 估算值说明 / `[AIGC]` 标注」这一条。按 P-02，AC 未转绿前 `tasks.md` 一律保持 `- [ ]`。

## 校验记录（2026-11-08）

- 先红：`npm test` 167 条 / 166 pass / **1 fail**（`src/core/render/index.js` 缺失）。
- 转绿：`render.test.js` **40/40**；全量 `npm test` **206/206**。
- 独立负向探针 `reviews/t018-negative.mjs` **56/56 全检出**、全部字节级还原；Round 10 双代理复审 P0 PASS 11/0/0、P1 PASS 31/0/1（唯一 WARN 为已裁决留 T-040 的 `.gitkeep`）。
- `npm run acceptance` **19/19 RED · 0 GREEN**；`npm run spec-check` PASS；已跟踪 diff 与暂存均为空；`tasks.md` 仍 0 `[x]` / 39 `[ ]`。
- 负向探针与双独立代理复审见仓库外 `reviews/round-10/`，本 README 不重复其结论。
