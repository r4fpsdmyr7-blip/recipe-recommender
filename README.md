# recipe-recommender

> **An offline-first, multilingual, GPL-3.0 recipe & meal-plan recommender.**
> 纯本地、多语言、可嵌入的食谱与周期膳食计划推荐插件。

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

---

## 状态 · Status

| 项 | 当前 |
|----|------|
| 阶段 | **立项完成（Git）** + SDD **Specify / Clarify** 阶段 |
| 规格 | [`SPEC.md`](SPEC.md) `v0.2.0-draft` |
| 实现 | ⏸ **尚未开始**（按 SDD 流程，须先关闭 CL-02 再产出 `constitution.md` / `plan.md`） |
| 许可 | **GPL-3.0**（[`LICENSE`](LICENSE) 已随仓库分发） |
| 代码状态 | 本仓库当前仅含规格、调研与文档，**不包含可运行程序** |

详见 [`docs/decisions.md`](docs/decisions.md)（决策记录）与 [`docs/competitive-research.md`](docs/competitive-research.md)（竞品调研）。

---

## 它要做什么

把「年 / 季 / 月 / 周 / 日」五级膳食计划做成一套**纯本地、可 Git 追踪、可验证**的开源工具：

- 由身体数据推导**量化营养处方**，并以其为硬约束（总能量不低于 BMR、蛋白不低于保肌下限）
- 按**国籍 / 居住地**自动解析适用的膳食指南与历法（二十四节气精确交节 / 通用季节历），也可由用户显式指定
- 顺时取材、避免短期重复、允许按节气 / 月份的周期性重复
- 周计划含**采购计划**，日计划含补购与前夜备餐清单
- 上下层之间的**反馈与修订闭环**（A/B/C/D 四类）与「已执行计划不可回改」时间线护栏
- 结果以 **Markdown** 落盘：可 diff、可审阅、可版本化

## 三层形态

| 层 | 说明 |
|----|------|
| **Markdown-first 核心** | 纯本地规则引擎，离线可用，输出用户指定语言的结构化 Markdown |
| **CLI** | 生成 / 校验 / 台账查询 / 数据导出与删除 / 验收场景执行 |
| **MCP Server** | 供支持 MCP 的 AI 客户端调用，默认本地 stdio、不监听网络端口 |

## 输出语言

输出语言**由用户指定**，与实现语言、内部表示完全解耦。v1 内置语言包：

`zh-Hans`（简体中文）· `en` · `fr` · `de` · `es` · `ru` · **`la`（拉丁语）**

规则引擎只处理与自然语言无关的 Canonical ID；所有面向人的字符串来自外部语言包，**不依赖在线翻译或 LLM**。缺失语言包按回退链输出并显式标注，不会静默混排。

## 依赖边界

| 依赖 | 决策 |
|------|------|
| **LLM** | 核心规则引擎**不依赖**。LLM 仅作默认关闭的可选增强，不可用时自动离线降级 |
| 菜谱数据 | **Unlicense** 的 [HowToCook](https://github.com/Anduin2017/HowToCook) **或用户自建** |
| 营养数据 | **CC0** 的 [USDA FoodData Central](https://fdc.nal.usda.gov/) + **人工校验的中国食材子集** |
| 网络 | 仅年计划刷新时令数据需要联网，且请求不携带任何个人参数；其余全部离线 |
| 分发（v1） | 仅 **GitHub Releases（源码归档 + 校验和）+ Git 源码**；包管理器延后 |

> 内置第三方数据的逐项许可声明将在 M4 产出 `THIRD_PARTY_NOTICES.md`。许可存疑或冲突的数据源一律不内置。

## 隐私与法律合规

- **身体数据纯本地、不上传**：零遥测、零账号、零云同步；日志、示例、CI fixtures 与发布物均不得含真实身体数据。
- 支持**一键导出 / 一键删除**及查看本地存放位置。
- 以数据最小化、目的限定、本地处理为设计基线，遵守适用的《中华人民共和国个人信息保护法》《数据安全法》《网络安全法》、欧盟 GDPR 等法律；详见 M4 产出的 `PRIVACY.md` / `SECURITY.md`。
- **本仓库不含任何真实个人身体数据**。`../diet-plan/` 仅作方法论参照，其数据禁止入库或作为示例。
- 示例档案为**完全虚构**的全球平均量级合成数据（男女各一份），见 [`examples/profiles/`](examples/profiles/)。

## 仓库内容

```
recipe-recommender/
├── SPEC.md                        SDD · Specify 阶段规格（唯一权威）
├── LICENSE                        GPL-3.0 全文
├── .gitignore                     个人数据 / 缓存 / 构建产物排除
├── README.md                      本文件
├── docs/
│   ├── competitive-research.md    竞品调研（16 条来源）
│   └── decisions.md               立项决策记录与待确认项
└── examples/profiles/             两份完全虚构的示例档案（ATDD fixtures）
```

GitHub 社区规范全套文件（`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、`PRIVACY.md`、Issue/PR 模板、CI 等）按 SDD 流程在 **M4 / Implement** 阶段产出，清单见 [`SPEC.md` §10](SPEC.md)。

## 开发方法

采用 **SDD（Spec-Driven Development）+ ATDD（Acceptance Test Driven Development）**：

`Constitution → Specify → Plan → Tasks → Implement → Converge`

`SPEC.md` §8 的 Given/When/Then 场景是**实现前就必须存在且为红**的验收契约；任何行为变更先改规格，再改实现。

## 免责声明

本项目是**膳食规划参考工具**，不构成医疗建议、诊断或处方；所有营养数值均为估算值。请结合自身情况并咨询专业人士。所有 AI 辅助生成内容标注 `[AIGC]` 并经人工审查后方可作为基线。

---

> [AIGC] 立项文件由 AI 依据用户 2026-11-06 决策生成 · 审计追踪 ID：`RR-CHARTER-20261106-0001`
