# Phase 4 - 被动流、L2 双向沙盒与协议幂等

## 阶段定位
本阶段实现“跨 Agent 交互闭环”，把被动监听、握手协议、幂等、L2 双向同意、错误处理和安全要求放在同一阶段，避免拆开后语义不一致。

## 对应原文条款
- 第 8 章：L2 双向沙盒谈判
- 第 9 章：被动接单流（9.2）
- 第 10 章：协议与幂等
- 第 12 章：安全与隐私
- 第 13 章：错误处理与重试（协议/LLM 主体）

## 必须原样继承的关键约束

### 1) L2 双向沙盒规则
- 双方加载：`User.md` + 本地 `task.md` + 对方 JSON 报文。
- 各自在 `scratchpad.md` 内部研判。
- 对外仅协议报文，不发送 CoT。
- 任意一方可 `REJECT` 并静默记录。
- 默认最多 `5` 轮，超限进入 `Timeout`。
- 达成条件：双方连续一轮都返回 `ACCEPT` 且字段校验通过。

### 2) 被动接单流
1. 持续监听握手请求。
2. 入站先做 Schema 校验与幂等检查。
3. 加载 `User.md` + 对应 `task.md` 进入 L2。
4. `REJECT` 静默日志；`ACCEPT` 迁移至 `Waiting_Human` 并通知主人。

### 3) 协议 Schema（v1）
请求报文字段必须覆盖：
- `protocol_version`
- `message_id`
- `sender_agent_id`
- `receiver_agent_id`
- `task_id`
- `action`
- `round`
- `payload`（含 `interaction_type/must_match_tags/deal_breakers/target_activity/target_vibe`）
- `timestamp`
- `signature`

响应报文字段必须覆盖：
- `protocol_version`
- `message_id`
- `in_reply_to`
- `task_id`
- `action`
- `error`
- `timestamp`

### 4) 错误码（最小集）
- `E_SCHEMA_INVALID`
- `E_PROTOCOL_VERSION_UNSUPPORTED`
- `E_IDEMPOTENCY_CONFLICT`
- `E_VERSION_CONFLICT`
- `E_DEP_UNAVAILABLE`
- `E_INTERNAL`

### 5) 幂等规则
- 唯一键：`(message_id, sender_agent_id, protocol_version)`。
- 幂等窗口：`7` 天。
- 命中重复键时：返回首次处理结果，不重复推进状态。

### 6) 安全与重试
- Agent 间通信必须 TLS。
- `signature` 建议 Ed25519，公钥轮换周期 `90` 天。
- LLM 调用指数退避重试：默认 `3` 次（500ms/1s/2s）。
- `safeParse` 失败：记录错误码 + 原始摘要，丢弃报文，不推进状态。

## 实施输出物
1. `listener.ts` HTTP/WebSocket 入站处理链。
2. 协议请求/响应 Zod Schema 与统一错误响应。
3. 幂等键落库与 7 天窗口处理。
4. `executeL2Sandbox()` 真正闭环（PROPOSE/COUNTER_PROPOSE/ACCEPT/REJECT）。
5. `Negotiating -> Waiting_Human`、`Waiting_Human -> Revising` 与超时分支实现。

## 阶段验收标准
- 协议报文可稳定双向往返，重复包不会重复推进状态。
- 一方 `REJECT`、双方 `ACCEPT`、轮次超限路径全部可追踪。
- CoT 不会出现在网络报文与外部报告中。
