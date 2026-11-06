# 立项决策记录 · Decision Log / ADR

> 记录日期：2026-11-06　|　对应规格：[`../SPEC.md`](../SPEC.md) `v0.3.0-draft`　|　阶段：SDD **Specify + Clarify（已关闭）→ M1（已产出，待审查）**
> 本文件记录**用户已确认的决策**及其依据，是 `constitution.md` / `plan.md` 的输入。技术选型只在本文件与 `plan.md` 固化，`SPEC.md` 不含实现细节（P-04）。

---

## 1. 立项

| 项 | 决策 |
|----|------|
| 版本控制 | Git，默认分支 `main`，本地仓库 `recipe-recommender/` |
| 首次提交内容 | `SPEC.md`、`docs/competitive-research.md`、`docs/decisions.md`、`LICENSE`、`.gitignore`、`README.md`、`examples/profiles/` |
| 阶段推进 | 立项（M0′）✅ → Specify + Clarify（M0）✅ → **Constitution + Plan（M1）✅ 2026-11-06**；**未写实现代码、未生成 M4 社区规范文件** |
| 远程仓库 | 尚未创建 / 推送；正式 GitHub 仓库名与归属账号见 D-07 |

---

## 2. 已关闭澄清项（对应 SPEC §14）

| ID | 决策 | 规格落点 |
|----|------|----------|
| **D-01 / CL-01** | **Markdown 核心 + CLI + MCP Server** 三层形态 | FR-028～030（MCP 升为 MUST）、§3.1、§6.7 |
| **D-02 / CL-03** | **GPL-3.0**；`LICENSE` 全文随仓库分发 | `LICENSE`、FR-037、P-07、AC-13/18 |
| **D-03 / CL-04** | **核心规则引擎不依赖 LLM**；LLM 仅默认关闭的可选增强，须可离线降级 | FR-051、NFR-001/009、P-13、AC-17 |
| **D-04 / CL-05** | 菜谱 = **Unlicense 的 HowToCook 或用户自建**；营养 = **CC0 的 USDA FDC + 人工校验中国食材子集** | FR-031/032、`THIRD_PARTY_NOTICES.md`（M4） |
| **D-05 / CL-06** | 输出语言 = **用户指定**；v1 内置 `zh-Hans` / `en` / `fr` / `de` / `es` / `ru` / **`la`** | §6.9、FR-040～044、AC-15、SC-011、`locales/` |
| **D-06 / CL-08** | v1 **仅 GitHub Releases + 源码**；包管理器发布延后 | FR-039/052、§10、SC-014 |
| **D-07 / CL-07** | 立项工作名 `recipe-recommender`；正式仓库名 / 归属账号**延后至发布前确认**，不阻塞 Plan | README、CITATION.cff、release workflow |
| **D-08 / CL-09** | **禁止**把 `../diet-plan/` 数据作为示例或内置数据，仅复用方法论；示例必须为**完全虚构的全球平均男女各一份** | FR-034/035/053、P-14、AC-18、`examples/profiles/` |
| **D-09 / CL-10** | 身体数据**纯本地、不上传**，且须符合适用法律（PIPL / GDPR 等）；新增 `PRIVACY.md` 为必需 | FR-047～050、§6.10、§10、P-06/15、AC-17 |
| **D-10 / 新增** | 膳食指南 / 节气等数据**默认按用户国籍或居住地解析**，亦可由用户显式指定，覆盖优先 | FR-003/045/046、AC-16、SC-012 |
| **D-11 / CL-02** | **机械语言否决 → 采用现行 ISO/IEC 标准化实现语言**；具体为 ECMAScript 规范套件 / **ISO/IEC 22275:2018**。详见 **ADR-002（§3）** | NFR-015、P-16、AC-19、SC-015、`plan.md §2` |

> 截至 2026-11-06：`[NEEDS CLARIFICATION]` **= 0**；CL-07 显式延后且不阻塞 Plan。

---

## 3. ADR-002 · 实现语言：机械语言可行性与 ISO 标准化语言选型

| 项 | 内容 |
|----|------|
| 状态 | **Accepted**（用户 2026-11-06 授权：「可以使用机械语言吗，如不行，使用 ISO 指定的语言」） |
| 决策者 | 用户（提出约束） + 本项目（在授权范围内完成选型与取证） |
| 影响 | 关闭 CL-02；决定 `plan.md` 技术栈、目录结构、CI 矩阵与 GPL 源码义务的实现方式 |
| 不改变 | 任何 FR / AC / SC 的业务语义；FR-041 / P-11 的 Canonical ID 内部表示约束保持不变 |

### 3.1 背景

用户原话「**搭建语言使用计算机标准语言，输出语言为用户指定语言**」。后半句已由 D-05 关闭。前半句在 2026-11-06 追问中进一步明确为条件式约束：**优先考察机械语言；若不可行，则采用 ISO 指定的语言**。

原表述的三种可能口径及归属：

| # | 可能含义 | 归属 |
|---|----------|------|
| 1 | **实现语言**采用某种有正式标准的编程语言 | 本 ADR 关闭 |
| 2 | **内部构建表示**采用与自然语言解耦的机器标准标识 | 已独立固化为 FR-041 / P-11，无需二选一，不受本 ADR 影响 |
| 3 | 两者兼指 | 第 1 项按本 ADR，第 2 项保持不变 |

**术语边界**（避免歧义影响结论）：

- **机械语言 / machine language**：处理器直接执行的二进制指令编码（ISA 级），不是可移植的程序源码。
- **汇编 / assembly**：机器指令的符号化表示，仍绑定具体 ISA 且缺少标准库；本 ADR 中结论相同。
- **形式化规格语言**（TLA+ / Z / B 等）：用于写规格与验证，不是运行时实现语言；若用户原意为此，可作为可选的验证工具，但**不能**替代实现语言，也不改变本决策。
- **ISO 指定的语言**：由 ISO/IEC 发布的、状态为 **Published / 现行**的编程语言国际标准所规范的语言。已撤销（Withdrawn）的标准不计入。

### 3.2 决策驱动

| # | 约束来源 | 要求 |
|---|----------|------|
| D1 | 用户 CL-02 | 实现语言须「计算机标准」；机械语言不可行时用 ISO 指定语言 |
| D2 | FR-030 / CL-01 | MUST 提供 MCP Server，优先官方 SDK 生态 |
| D3 | NFR-004 | Windows / macOS / Linux 三平台均可运行核心 CLI |
| D4 | FR-037 / GPL-3.0 | 必须提供 **Corresponding Source**（可修改的首选形式） |
| D5 | P-02 / P-03 / FR-038 | ATDD 红→绿、CI、lint、规格一致性、可审查可 diff |
| D6 | FR-040～046 / NFR-001 | 七语言（含拉丁语）UTF-8、离线、语言与逻辑解耦 |
| D7 | FR-052 | v1 仅 GitHub Releases + 源码，不发包管理器（不要求运行时零安装，但不得引入发布流水线） |

### 3.3 机械语言可行性评估 → ❌ 不采用

| 维度 | 判定 | 理由 |
|------|------|------|
| **平台可移植** | ❌ | 机器语言与 ISA 绑定（x86-64 / ARM64 / RISC-V 互不兼容），违反 NFR-004；每个平台需单独产物与维护链 |
| **必需抽象** | ❌ | 没有 UTF-8 字符串、JSON、文件系统、日期/时区、正则、进程 I/O 等标准抽象。FR-030 的 MCP JSON-RPC over stdio、FR-040～046 的七语言渲染、§6.5 采购清单全部要从零手写 |
| **许可证合规（决定性）** | ❌ | GPL-3.0 以「**source code = preferred form of the work for making modifications to it**」定义源码，并在分发非源码形态时要求随附 **Corresponding Source**。纯机器码不是可修改的首选形式 → **无法满足 GPL-3.0 的源码义务**（FR-037） |
| **SDD / ATDD** | ❌ | AC-01～19 要求可读、可 diff、可 lint、可测试的契约实现；覆盖率、CI 门禁、社区 PR（US-10）无落点 |
| **供应链与维护** | ❌ | 无法审计依赖许可、无法方便地打安全补丁，与 FR-053 静态扫描门禁、SECURITY.md 冲突 |
| **可贡献性** | ❌ | GPL 开源项目若没有人类可修改源码，社区协作与 fork 实质失效 |

> 结论：**机械语言不是「搭建语言」的可行选项**。汇编同理（仅可作为某一平台的极小适配层，不能作为主实现）。因此按用户授权，回退到「ISO 指定的语言」。

### 3.4 ISO 标准化语言候选（2026-11-06 联网核实）

| 语言 | ISO/IEC 标准 | 标准状态 | MCP 官方 SDK | 结论 |
|------|--------------|----------|--------------|------|
| **ECMAScript** | **ISO/IEC 22275:2018** — *ECMAScript® Specification Suite*；语言文本由 **ECMA-262** 年度维护 | ✅ **Published，2025 年复核确认现行**（ISO 官网 stage 90.93） | ✅ **Tier 1**（`@modelcontextprotocol/sdk`，TypeScript SDK，JS 可直接调用） | ✅ **采用** |
| C++ | ISO/IEC 14882:2024（:2011 / :2017 已撤销） | ✅ 现行 | ❌ 无官方 SDK | 备选 B：标准最「正统」，但需自实现 JSON-RPC / stdio 与 i18n，且引入第三方 JSON / ICU 依赖，与 D5 快速迭代、NFR-008 供应链审计相悖 |
| C | ISO/IEC 9899 系列 | ✅ 现行 | ❌ | 不选：抽象层级更低 |
| C# | ISO/IEC 23270:2018 | ❌ **Withdrawn（已撤销）**，且 ISO 版本滞后于现行语言 | ✅ Tier 1 | 不选：不满足「现行 ISO 指定」 |
| Ruby | ISO/IEC 30170 | 覆盖有限 | Tier 3 | 不选 |
| Python / Go / Rust / Java / Swift / Kotlin / PHP | **无 ISO 编程语言标准**（事实标准或厂商规范） | — | 部分 Tier 1/2 | 不选：不符合 D1 硬约束。**上一轮推荐的「Python 备选」因此作废** |

**两个易错点（已核实）**：

1. 常被引用的 **ISO/IEC 16262:2011**（ECMAScript 5.1）已于 **2018-05-09 撤销**，由 **ISO/IEC 22275:2018** 取代。22275 定义「规范套件」，套件本身不随组件年度版变化，并在 2025 年复核确认现行 —— 因此引用 ISO 编号时**必须写 22275:2018**，不可再写 16262。
2. **TypeScript 没有独立 ISO 编号**（它是 ECMAScript 的类型化超集，由 ECMA-262 之外维护）。若本仓库源码写成 `.ts`，严格意义上「实现语言」就不再是 ISO 指定语言。故采用**纯 ECMAScript 源码**；MCP SDK 是第三方依赖库而非本项目实现源码，其自身使用 TS 不影响本仓库主实现语言口径。

### 3.5 决策

| 项 | 选定值 |
|----|--------|
| **实现语言** | **ECMAScript**，依据 **ISO/IEC 22275:2018**（ECMAScript® Specification Suite，现行），语言特性遵循 **ECMA-262 现行版** |
| **源码形态** | 纯 **ESM JavaScript**（`.js`，`"type": "module"`），UTF-8 文本，人类可读可修改；**仓库不含 `.ts` 实现源码** |
| **运行时** | **Node.js 20 LTS 及以上**（Windows / macOS / Linux）；核心仅依赖 Node 内置模块（`node:fs`、`node:path`、`node:test`、`node:assert`、`Intl`） |
| **MCP 适配** | 官方 Tier 1 SDK `@modelcontextprotocol/sdk` + **stdio transport**；其许可在 M4 `THIRD_PARTY_NOTICES.md` 审计，冲突则不引入 |
| **国际化** | `Intl`（ECMA-402）仅用于日期 / 数字 / 单位格式化；**词汇翻译全部来自本地语言包**（FR-041），不联网、不调用 LLM |
| **静态类型** | **JSDoc + `tsc --allowJs --checkJs --noEmit`** 作为**可选开发期工具**，不产生运行时代码、不改变实现语言；贡献者可关闭 |
| **测试** | `node:test` + `node:assert` 零第三方依赖；AC-01～19 以可执行场景文件实现，先红后绿 |

**为何不选 C++（备选 B）**：标准状态同样合规，但没有官方 MCP SDK，需要自行实现 JSON-RPC 2.0 / stdio、UTF-8 处理与七语言格式化，并引入第三方 JSON / ICU 库；GPL-3.0 静态链接的 Corresponding Source 边界、依赖许可审计（NFR-008）、社区贡献门槛与 SDD/ATDD 的快速迭代节奏都显著变差。本项目是**文本规则引擎**，对 CPU 性能无特殊要求（NFR-003 ≤ 5 s），故工程性价比低。保留为回退选项。

**为何不选 C#**：ISO/IEC 23270:2018 已被 ISO 标记 **Withdrawn**，不满足用户「ISO 指定」的现行性要求。

### 3.6 后果

**正面**：官方 Tier 1 MCP SDK；原生 UTF-8 / JSON / 正则 / 文件系统；`Intl` 覆盖七语言格式化与拉丁语场景；`node:test` 让 ATDD 零依赖落地；同一份源码三平台运行；Markdown 可 diff；Corresponding Source 天然满足；贡献者门槛低。

**负面与缓解**：

| 代价 | 缓解 |
|------|------|
| 用户需预装 Node 20+ 运行时（v1 不发包管理器） | README 明确安装步骤；Release 附源码归档 + 校验和 + 运行说明；不引入发布流水线（FR-052） |
| 纯 JS 无编译期类型 | JSDoc + `tsc --checkJs --noEmit` + 严格 lint；schema 校验在边界处显式执行 |
| GC 语言性能 |  workload 为文本生成，NFR-003 的 5 s / 30 s 预算充裕 |
| Node 版本碎片 | CI 矩阵覆盖 20 / 22 / 24 LTS；最低版本写入 `engines` 与 CONTRIBUTING |
| 依赖 SDK 许可待审计 | M4 前完成 `THIRD_PARTY_NOTICES.md`；若冲突则退化为自实现最小 stdio 协议层（属实现细节，`plan.md` 记录） |

### 3.7 回退条件

出现下列任一情形时，按 `SPEC.md` **E-17 / A-09** 切换：① 用户明确要求改用 C++ 或其他现行 ISO 标准语言；② ISO/IEC 22275:2018 被撤销且无替代；③ Node 运行时无法覆盖 NFR-004 的目标平台。

回退时**只重做 `constitution.md`（如涉及原则）与 `plan.md`**，**不修改任何 FR / AC / SC 的业务语义**；全部验收契约保持有效。

### 3.8 参考来源（2026-11-06 联网核实）

- ISO `ISO/IEC 22275:2018` — <https://www.iso.org/standard/73002.html>（Published / Confirmed 2025）
- ISO `ISO/IEC 16262:2011` — <https://www.iso.org/standard/55755.html>（Withdrawn，2018-05-09）
- ISO `ISO/IEC 23270:2018` — <https://www.iso.org/standard/75178.html>（Withdrawn）
- ISO `ISO/IEC 14882:2024` / :2017 — <https://www.iso.org/standard/68564.html>（:2017 Withdrawn，新版 :2024）
- ECMA-262（ECMAScript 现行语言规范）— <https://www.ecma-international.org/wp-content/uploads/ECMA-262.pdf>
- MCP 官方 SDK 分级（TypeScript / Python / C# / Go 为 Tier 1）— <https://modelcontextprotocol.io/docs/sdk>
- GPL-3.0 全文（§1 Source Code 定义、§6 Corresponding Source）— <https://www.gnu.org/licenses/gpl-3.0.txt> / 本仓库 `LICENSE`

---

## 4. 由决策引出的新增约束（摘要）

1. **i18n 是架构约束，不是翻译功能**：规则引擎只处理 Canonical ID；语言包承载全部人可读字符串；翻译不得依赖在线服务或 LLM。
2. **切换语言不改变任何数值**：营养计算、去重指纹、台账、时间线护栏与计划语义必须与语言无关（FR-044）。
3. **区域策略可追溯**：默认按声明的国籍 → 居住地解析，用户覆盖优先，未匹配显式回退；禁止通过 IP / 定位 / 静默推断（FR-045/046）。地区码按 ISO 3166-1，中国香港 / 中国澳门 / 中国台湾为中国的地区级选项。
4. **历法可插拔**：精确节气流程只在解析为 `solar-terms` 时适用；通用季节历同等遵守「年计划刷新、下层只读、失败 FALLBACK」。
5. **示例数据零真实个人信息**：两份合成档案，标注虚构性；CI 静态扫描防止 `diet-plan/` 数据误入库。
6. **许可边界**：代码 GPL-3.0；第三方数据 Unlicense / CC0 / 用户自建；不得复制受版权保护的指南原文或图表。
7. **标准化实现语言（D-11）**：主实现为现行 ISO/IEC 标准化语言的人类可修改源码；机器语言 / ISA 绑定代码不得作为主实现；每个 Release 附 Corresponding Source（NFR-015 / P-16 / AC-19 / SC-015）。
8. **规格与选型分离**：`SPEC.md` 只固化语言无关的强制约束；具体语言、运行时、目录、接口一律写在 `plan.md` 与本 ADR（P-04）。

---

## 5. 当前阶段与下一步

| 阶段 | 状态 |
|------|------|
| M0′ 立项 / M0 Specify + Clarify | ✅ 完成，`[NEEDS CLARIFICATION]` = 0 |
| **M1 Constitution + Plan** | ✅ **已产出 `constitution.md` 与 `plan.md`，停在 M1 审查点** |
| M2 Tasks | ⏸ 待 M1 审查通过后产出 |
| M3～M5 实现 / 社区规范 / Converge | ⏸ 未开始；不写实现代码 |

> **待用户审查**：① ADR-002 的语言选择是否符合「ISO 指定」的原意（若想要 C++ 等，一句话即可切换）；② `constitution.md` 的 P-01～P-16；③ `plan.md` 的架构与接口契约。审查通过后进入 M2 `tasks.md`。

---

> [AIGC] 依据用户 2026-11-06 决策与当日联网核实结果生成 · 审计追踪 ID：`RR-DECISIONS-20261106-0002` · 版本 `v0.2.0`（新增 ADR-002，CL-02 关闭）
