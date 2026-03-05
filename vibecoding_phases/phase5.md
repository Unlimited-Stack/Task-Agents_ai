# Phase 5 - 记忆压缩、治理运维、测试验收与发布

## 阶段定位
本阶段做“可长期运行”的收口：context/memory、数据保留、索引重建、可观测性、测试与 CI 准入，确保系统可维护可审计。

## 对应原文条款
- 第 5 章：`context.ts` / `memory.ts` 能力边界
- 第 11 章：补偿与重建（`rebuild_index`）
- 第 12 章：数据保留与审计
- 第 13 章：超时恢复要求
- 第 14 章：测试与验收标准
- 第 15 章：可观测性
- 第 16 章：版本信息

## 必须原样继承的关键约束

### 1) Context / Memory Flush
- 按 Token 预算裁剪对话。
- Token 接近危险值时触发 memory flush。
- 原始对话保存到 `raw_chats/`。
- 总结内容保存到 `raw_chats_summary/`。
- 记忆模块负责归档到 `.data/` 对应目录。

### 2) 数据保留与审计
- `raw_chats` 默认保留 `90` 天。
- `agent_chat.jsonl` 默认保留 `180` 天。
- 到期归档或清理前必须留审计记录。

### 3) 重建与恢复
- 提供 `rebuild_index` 后台任务，可从 `.data/` 全量重建索引。
- 重建任务必须幂等，可重复执行。
- `Timeout|Failed -> Searching` 恢复必须显式重试，且 `version+1`，并记录触发人/触发器。

### 4) 测试与 CI 准入
单元测试（必须）：
- `schema.ts` 入站/出站报文校验。
- `state_machine` 允许/禁止迁移全覆盖。
- `idempotency` 重复消息不重复推进。

集成测试（必须）：
- 主动流 `Drafting -> Waiting_Human` 全链路。
- 被动流 listener 入站到响应全链路。
- `pending_sync=true` 场景的修复队列恢复能力。

故障注入测试（必须）：
- LLM 超时、SQLite 写失败、RAG 不可用、网络抖动。
- 验证进入 `Failed/Timeout` 的路径可追踪、可恢复。

CI 门槛：
- 行覆盖 `>= 80%`。
- 状态机/协议核心模块覆盖 `>= 90%`。
- 协议边界类型无 `any` 泄漏。

### 5) 可观测性字段（每条关键日志必带）
- `trace_id`
- `task_id`
- `message_id`
- `from_status`
- `to_status`
- `latency_ms`
- `error_code`（可空）

建议使用结构化 JSON 日志，便于检索和审计。

## 实施输出物
1. `context.ts` Token 管理与触发阈值逻辑。
2. `memory.ts` 压缩总结与归档管道。
3. 保留策略清理任务与审计日志。
4. `rebuild_index` 作业与幂等重放能力。
5. 完整测试套件 + CI 规则 + 质量门禁。

## 阶段验收标准
- 系统可连续运行并具备日志追踪、索引修复、故障恢复能力。
- 测试与覆盖率达到门槛。
- 发布版本与文档版本同步更新（当前目标版本：`v1.1`，日期：`2026-03-03`）。
