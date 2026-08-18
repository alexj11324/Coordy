[English](README.md) | **简体中文**

# Coordy

**用于发现并缓解 AI Agent 长程任务漂移的实验性框架。**

长时间运行的 Agent 在上下文压缩（compaction）后，可能忘记仍然有效的目标、约束、决定或计划；多个会话协作时，也可能在外部变化已经使旧计划失效后继续执行。Coordy 从真实 Agent 历史中重建有证据约束的漂移案例，测试系统能否在首次有害行动之前发现漂移，并将结构化状态与更简单的方案进行比较。

Coordy 目前是研究与验证工具，不是生产级 Agent Runtime、消息总线、桌面客户端或通用记忆平台。核心问题仍在验证中：持久化结构化状态，是否比原生上下文、目标重新注入、定期检查点或更好的压缩摘要更早、更准确地发现真实任务漂移？

## 研究流程

```text
完整 Agent 历史
        ↓
确认 Agent 是否确实因为遗忘状态而执行了错误行动
        ↓
在状态已经丢失、首次错误行动尚未发生的位置冻结历史
        ↓
比较 Native / Goal Reinjection / Checkpoint / Better Compaction / Coordy
        ↓
报告 DETECTED / MISSED / LATE / FALSE ALARM / UNCERTAIN
```

Ground Truth 不由关键词或单个模型判断产生。State Diff 与因果 Judge 只生成机器预标；确认案例必须具备 T0–T5 证据链、程序验证的 Git／测试／工具结果，以及人工校准。被测 Detector 不能看到后续失败、返工或用户纠正。

### 历史重建与未来在线运行

当前实验是在重建旧 Codex 历史，因为这些对话发生时 Coordy 尚未运行。因此，实验需要读取冻结的完整历史；当一个旧 Goal 无法装入单次请求时，使用无损传输分片；随后把重复线索归并成事件，并重建 T0–T5 因果时间线。分片只是离线验证的数据传输方式，不是未来产品架构。

未来真实运行时，Coordy 应随着对话增量维护结构化状态。新的目标、约束、决定、被拒绝方案、计划、依赖和验收条件会更新已有状态，而不是触发全历史重建。Compaction 改变可见上下文后，Coordy 将仍然有效的压缩前状态与当前计划进行比较，并在首次不一致行动之前报警。系统可以偶尔保存检查点用于审计和恢复，但正常运行不会反复切分、重读整段 transcript。

## 当前状态

- 已实现确定性证据收集与全部 compaction opportunity 枚举。
- 已实现结果盲化的 State Diff 和独立因果复核管线。
- 完整因果确认及五种条件的行动前 Detector 对照仍在进行。
- 当前 `SUSPECT` 数量只是调查入口，不能证明发生了漂移，也不能证明 Coordy 已经检测成功。
- Screening 最终只能输出 `STOP`、`PIVOT` 或 `PROCEED_TO_CONFIRMATION`，绝不能输出 `GO`。

0.1.0 将确定性证据基础设施（S0a）与模型辅助语义判定（S0b）分开。规则可以枚举、验证和排序证据，但不能代替状态丢失或因果判断。

## 0.1.0 能做什么

- 只读读取导出的 JSON／JSONL；
- 规范化事件并记录来源哈希与 schema provenance；
- 在 SQLite 中索引会话和事件；
- 维护带 active／superseded 生命周期的来源绑定状态项；
- 挖掘漂移信号，但不把关键词当成 Ground Truth；
- 检测与当前依赖重叠的跨会话变化；
- 默认输出可审计候选和 `INSUFFICIENT_EVIDENCE`；
- 对每个 compaction opportunity 运行结果盲化的 LLM State Diff；
- 将全部最终 primary suspect 交给更强的、可查看结果的因果 Judge；
- 在机器预标进入研究结论前，要求独立判断和人工校准。

## 快速开始

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
cp .env.example .env.local
# 编辑 .env.local，然后执行 chmod 600 .env.local
coordy init --workspace .
coordy discover --workspace .coordy/discovery
coordy screen --workspace .coordy/screening-s0 --max-sessions 100 --min-goal-seconds 7200
coordy review-s0 --workspace .coordy/screening-s0 --max-reviews 12
coordy adjudicate-s0 --workspace .coordy/screening-s0 --answers .coordy/screening-s0/data/screening/user_review_answers.json
coordy prepare-s0b --workspace .coordy/screening-s0
coordy prepare-s0b-smoke --workspace .coordy/screening-s0 --sample-size 12 --no-post-plan-controls 3
coordy grade-s0b-smoke --workspace .coordy/screening-s0 --approved-smoke-sha256 <approved-sha256> --approved-judge-configuration-sha256 <approved-config-sha256>
coordy grade-s0b-state --workspace .coordy/screening-s0 --batch-size 1 --workers 4
coordy calibrate-s0b-state --workspace .coordy/screening-s0 --answers <human-answers.json>
coordy prepare-s0b-causal --workspace .coordy/screening-s0
coordy grade-s0b-causal --workspace .coordy/screening-s0 --workers 2
coordy calibrate-s0b-causal --workspace .coordy/screening-s0 --answers <human-causal-answers.json>
coordy run --input examples/synthetic_sessions.jsonl --workspace .coordy/demo
coordy summary --workspace .coordy/demo
python -m unittest discover -s tests -v
```

输入可以是 JSONL（每行一个事件对象）、JSON 数组，或包含 `events` 数组的对象。必填字段为 `session_id`、`timestamp`、`actor` 和 `content`；其他规范字段可选。

确定性基线可以使用显式前缀：

```text
GOAL: preserve the release approval workflow
CONSTRAINT: automation must not deploy without approval
DECISION: the release owner authorizes production deployment
REJECTED: automatic production deployment
PLAN: prepare the staging release
DEPENDS: fixtures/release-policy.txt
```

这个规则提取器只是低成本基线，不是语义理解。它必须与简单记忆和模型辅助条件对照，不能单独支持 GO／PIVOT／STOP 结论。

## 验证边界

`coordy discover` 进行有界、只读的环境发现。它先检查已安装的 Codex CLI 和官方 App Server schema，再查看已知本地存储候选；只持久化路径、数量、哈希、schema key 和限制，不写 transcript 内容，也不读取配置或认证内容。未知历史 schema 会 fail closed。

`coordy screen` 只运行低成本 S0 筛查，最多扫描 100 个合格 session。每个选中的 rollout 都会完整流式读取，设置 2 GiB fail-closed 安全上限，不接受仅扫描前缀的 session。每个生成案例在证据复核前都保持 `uncertain`。

每个真实 compaction boundary 都会形成一个结构机会，与是否命中关键词无关。机会按 Goal root 加 boundary 聚类；descendant session 是同一个 Goal-root cluster 内的观察值，不是独立长任务。`rule_discovered_episodes.jsonl` 只是 `opportunity_population.jsonl` 的排序子集，绝不是总体估计或上界。

S0a 到此为止：它只能证明完整、只读、带 provenance 的证据可以被枚举，不能证明发生了长程漂移。S0b 为每个机会创建盲化 packet，只包含压缩前状态、compaction summary 和压缩后第一份计划。轻量 State Diff Judge 从证据 ID 中提取 Goal、Constraint、Decision、Rejected Option、Plan、Dependency 和 Acceptance Criteria，并判断 `missing`、`contradicted`、`stale_reactivated` 或 `preserved`。此阶段隐藏最终工具结果和用户纠正，以减少 hindsight bias。

所有机会都接受 primary Judge。所有 suspect、低置信度案例，以及按 Goal root 可复现抽取的健康案例和 no-post control，会接受独立 second Judge。机器 Judge 只产生预标，不是 Ground Truth。

每个最终 primary `SUSPECT` 都进入因果判定。因果 packet 直接携带：

- T0：压缩前仍然有效的重要状态；
- T1：compaction；
- T2：压缩后计划；
- T3：实际行动；
- T4：程序验证的工程结果；
- T5：后续纠正或恢复（如存在）。

Agent 文本中声称“测试失败”或“已经回滚”只能作为上下文，不能算工程结果。只有结构化工具结果、exit code、`patch_apply_end`，或后续绑定的 Git／测试／replay 证据，才能把后果标为 `VERIFIED`。

核心因果问题只有一个：**Agent 是否因为在 compaction 后忘记或扭曲了仍然有效的重要状态，才在后面做错？** 仅仅摘要没有提到某件事、正常计划更新、阶段切换，以及普通推理或实现错误，都不是 drift。

Detector 的正确检测窗口是状态损失已经发生之后、首次错误行动之前。检测成功只是 Question A 的第一关；后续仍需 State Probe、Action Probe 和基线比较，才能判断 Structured State 是否真正减少漂移、返工、Token、耗时或人工干预。

## 隐私与证据

Coordy 持久化经过处理的内容、短证据引用和哈希。`discover` 与 `screen` 仅在显式调用时检查有界的标准 Codex 历史目录；`run` 只读取操作者提供的导出路径。Coordy 不扫描任意系统路径。未知、并发变化或格式错误的记录会 fail closed，而不是静默猜测。

## 版本管理

Coordy 遵循语义化版本。`VERSION`、包版本、Changelog 和 Git tag 必须一致。验证输出会记录 Coordy 版本。
