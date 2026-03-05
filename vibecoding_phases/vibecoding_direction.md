# Vibe Coding Master Direction v1.1
## 数字孪生 Agent 社交匹配系统 (TypeScript Edition)

本版是可落地执行规范，目标是把“理念文档”升级为“工程契约”。
默认适用于 Node.js + TypeScript 服务端实现。

---

## 1. 项目目标与非目标

### 1.1 目标
- 构建一个基于数字孪生的 Agent 双向撮合系统。
- 以 `task.md` 作为任务状态机唯一真相源（Single Source of Truth）。
- 通过 L0/L1/L2 三层漏斗完成高效、安全、可恢复的匹配流程。
- 所有结构化输入输出通过 Zod 强校验，避免运行时脏数据扩散。

### 1.2 非目标
- 不追求一次性全自动成交；最终授权由人类确认。
- 不在网络中传输 Agent 的自然语言思维过程（CoT）。
- 不把向量原始值落盘到业务目录（仅存向量库索引 ID）。

---

## 2. 强制工程铁律 (MUST)

1. 异步优先
- 所有 I/O（网络、文件、数据库、LLM）必须使用 `async/await`。
- 禁止阻塞调用（如 `fs.readFileSync`）。

2. Zod Schema Wall
- 所有跨边界数据必须过 Schema：网络报文、LLM JSON、`JSON.parse` 结果、YAML 头部。
- 解析失败不得静默吞错，必须进入错误分支并记录可追踪日志。

3. FSM 驱动
- `task_loop.ts` / `listener.ts` 只能基于 `task.md` 的 `status` 推进。
- 状态迁移必须走统一迁移函数，禁止任意字符串写入。

4. 意图与操作隔离
- CoT 只允许写入本地 `scratchpad.md`，绝不出网。
- 对外通信仅允许协议内 JSON 报文。

5. 幂等与可恢复
- 每条握手消息必须带 `message_id` 与 `protocol_version`。
- 重放同一消息不得导致重复状态推进（幂等处理）。

6. 原子迁移
- 任何状态迁移必须以 `task.md` 成功落盘为前提。
- 派生层（SQLite/RAG）失败时不得回滚真相源，必须打标并进入补偿队列。

---

## 3. 统一命名规范

### 3.1 文件命名
- 统一使用 `task.md`（不再使用 `task1.md`）。
- 任务目录示例：`.data/task_agents/task_1/task.md`。

### 3.2 状态枚举（严格区分大小写）
```ts
export type TaskStatus =
  | "Drafting"
  | "Searching"
  | "Negotiating"
  | "Waiting_Human"
  | "Revising"
  | "Closed"
  | "Failed"
  | "Timeout"
  | "Cancelled";
```

### 3.3 交互枚举
```ts
export type InteractionType = "online" | "offline" | "any";
```

### 3.4 协议动作枚举
```ts
export type HandshakeAction =
  | "PROPOSE"
  | "COUNTER_PROPOSE"
  | "ACCEPT"
  | "REJECT"
  | "CANCEL"
  | "ERROR";
```

---

## 4. 目录结构 (Strict Tree)

如需改文件夹名，必须先询问用户。

```text
.data/
├── User.md
├── raw_chats_summary/
│   └── YYYY-MM-DD-summary.md
├── logs/
│   └── YYYY-MM-DD-sys.md
└── task_agents/
    └── task_1/
        ├── task.md
        └── data/
            ├── daily_log/                 # 日志存储
            │   └── YYYY-MM-DD-handshake.md
            ├── agent_chat/                # 存储 agent 间原始报文
            │   ├── scratchpad.md
            │   └── YYYY-MM-DD-agentchat.jsonl
            ├── agent_chat_summary/        # 对 agent 对话总结后的数据
            │   └── YYYY-MM-DD-agentchat-sum.md
            ├── raw_chats/                 # 用户与对方 agent 聊天原文
            │   └── YYYY-MM-DD-chat.md
            └── embedding_data/            # task 主题 embedding 索引
                └── task_embedding_index.json

src/
├── main.ts
├── task_agent/
│   ├── main.ts
│   ├── task_loop.ts
│   ├── listener.ts
│   ├── dispatcher.ts
│   ├── context.ts
│   ├── memory.ts
│   └── util/
│       ├── storage.ts
│       ├── data_fetching.ts
│       ├── schema.ts
│       └── skill.ts
├── skills/
│   ├── memory.md
│   └── protocol.md
├── templates/
│   ├── prompts.ts
│   └── Agent.md
├── rag/
│   ├── embedding.ts
│   └── retrieval.ts
├── provider/
│   └── custom_provider.ts
└── llm/
    └── chat.ts
```

说明：
- `main.ts`：进程入口，启动主动流和被动监听流。
- 日期格式统一 `YYYY-MM-DD`，如需防覆盖，文件名后追加时间戳 `YYYY-MM-DD_HH-mm-ss`。

---

## 5. 核心模块职责与接口规约 (Module Specifications)

为防止 AI 编程助手在生成代码时发生职责混淆和逻辑耦合，明确 `src/` 目录下核心 `.ts` 文件功能边界。

### 5.1 核心调度层 (Core Orchestration)
1. `src/main.ts`（应用入口）
- 功能：初始化环境、连接 SQLite、启动 `listener.ts` 网络服务（Express/Fastify），并唤起 `task_loop.ts` 轮询任务。
- 禁忌：禁止写具体业务逻辑。

2. `src/task_agent/task_loop.ts`（主动流状态机引擎）
- 功能：轮询本地处于 `Drafting`、`Revising` 和 `Searching` 的任务，驱动状态机向前推进。
- 核心动作：`startTaskLoop()`、`processDraftingTasks()`、`processSearchingTasks()`。
- 禁忌：禁止直接读写文件或数据库，必须调用 `storage.ts` / `memory.ts`。

3. `src/task_agent/listener.ts`（被动流网关）
- 功能：暴露 HTTP/WebSocket 接口，接收外部 Agent JSON 握手包。
- 核心动作：入站 -> `schema.ts` 校验 -> 幂等检查 -> 丢给 `dispatcher.ts` 处理 -> 返回协议响应。

### 5.2 业务逻辑层 (Business Logic)
1. `src/task_agent/dispatcher.ts`（撮合总线）
- 功能：承载 L0/L1/L2 漏斗逻辑。
- 核心动作：
  - `runL0Filter()`：调用 `storage.ts` 查 SQLite 做硬过滤。
  - `runL1Retrieval()`：调用 `rag/retrieval.ts` 获取语义候选。
  - `executeL2Sandbox()`：组装 Prompt，调用 LLM，解析 `ACCEPT/REJECT/COUNTER_PROPOSE`，驱动状态迁移。

2. `src/task_agent/context.ts`（上下文与 Token 管理）
- 功能：基于 FSM 构建 Prompt，按 Token 预算裁剪对话。
- 当 Token 超阈值时触发 `memory.ts` 压缩；原始对话写入 `raw_chats/`，总结写入 `raw_chats_summary/`。

3. `src/task_agent/memory.ts`（记忆与提炼）
- 功能：读取 `.data/` 记忆相关数据；触发 memory flush 时调用 LLM 总结并入库；归档日志。

### 5.3 基础设施与工具层 (Infrastructure & Utils)
1. `src/task_agent/util/storage.ts`（数据持久化防腐层）
- 功能：系统内唯一允许操作 `.data/` 与 SQLite 的模块。
- 必须实现：写真相源、写派生索引、补偿队列、重建索引。
- 核心动作：`saveTaskMD()`、`updateTaskStatus()`、`queryL0Candidates()`、`enqueueSyncRepair()`。

2. `src/task_agent/util/schema.ts`（类型与校验中心）
- 功能：集中存放所有 Zod Schema 与 `export type`。

3. `src/llm/chat.ts`（大模型通信网关）
- 功能：封装 OpenAI/Gemini 调用；负责超时、指数退避重试、强制 JSON 输出。

4. `src/rag/embedding.ts` / `src/rag/retrieval.ts`（向量引擎）
- 功能：封装 ChromaDB/Milvus/SQLite-VSS 的向量索引读写。

---

## 6. task.md 规约（唯一真相源）

`task.md` = YAML 头 + Markdown 正文。YAML 必须可被 Zod 校验并可同步到 SQLite 索引。

```yaml
---
task_id: "T-UUID"
status: "Drafting"
interaction_type: "online"
must_match_tags: ["标签A"]
deal_breakers: ["红线A"]
current_partner_id: null
entered_status_at: "2026-03-03T10:00:00Z"
created_at: "2026-03-03T10:00:00Z"
updated_at: "2026-03-03T10:00:00Z"
version: 1
pending_sync: false
---
```

正文模板：
```md
### 原始描述
[用户输入自然语言]

### 靶向映射
<Target_Activity>[事件摘要，50字内]</Target_Activity>
<Target_Vibe>[事件性格氛围，50字内]</Target_Vibe>
```

约束：
- 状态字段只能由状态机迁移函数修改。
- `entered_status_at` 在每次状态迁移时更新。
- `updated_at` 每次持久化写入必须更新。
- `version` 用于并发控制（乐观锁）。
- `pending_sync=true` 表示真相源已更新但派生层同步未完成。

---

## 7. 状态机迁移表（强约束）

仅允许以下迁移：

1. `Drafting -> Searching`
- 条件：任务 YAML + 正文校验通过并已落盘。

2. `Searching -> Negotiating`
- 条件：L0/L1 产出候选并发出首条 `PROPOSE`。

3. `Negotiating -> Waiting_Human`
- 条件：双方在 L2 沙盒内均达成 `ACCEPT`。

4. `Waiting_Human -> Revising`
- 条件：主人查看候选结果/搜索报告后不满意，明确发起“修改需求并重搜”。

5. `Revising -> Searching`
- 条件：主人完成修改，YAML + 正文再次校验通过并落盘，且 `version = version + 1`。

6. `Waiting_Human -> Closed`
- 条件：主人确认并完成撮合。

7. `Searching|Negotiating -> Timeout`
- 条件：
  - `now - entered_status_at >= 24h`，或
  - `negotiation_round >= 5`。

8. `Searching|Negotiating -> Failed`
- 条件：不可恢复系统错误（协议非法、索引损坏、关键依赖不可用）。

9. `Drafting|Searching|Negotiating|Waiting_Human|Revising -> Cancelled`
- 条件：用户主动取消。

10. `Timeout|Failed -> Searching`
- 条件：人工/系统重试，且 `version = version + 1`。

禁止迁移：
- 任何状态直接回写 `Drafting`。
- `Closed` 非显式用户操作不得逆转。

---

## 8. 三层漏斗机制（dispatcher.ts / listener.ts）

### 8.1 L0 动态底线过滤（结构化检索）
- 输入：`must_match_tags`、`deal_breakers`、`interaction_type`。
- 存储：SQLite 索引表。
- 目标：快速剔除明显不合规任务。

### 8.2 L1 语义检索（RAG）
- 输入：`Target_Activity`、`Target_Vibe`。
- 输出：候选池 + 相似度分数。
- 规则：仅存向量库索引 ID，不存原始向量。
- 默认参数：`topK=30`，`minScore=0.72`，不足阈值不进入 L2。

### 8.3 L2 双向沙盒谈判（Double Opt-in）
- 双方各自加载：`User.md` + 本地 `task.md` + 对方 JSON 报文。
- 各自独立在 `scratchpad.md` 形成内部研判。
- 对外仅发送协议报文，不发送 CoT。
- 任意一方可 `REJECT` 并静默记录。
- 默认最多 `5` 轮，超限进入 `Timeout`。
- 达成条件：双方连续一轮都返回 `ACCEPT` 且字段校验通过。

---

## 9. 主动流与被动流

### 9.1 主动发单流（`task_loop.ts`）
1. 捕获需求并创建 `task.md`（`Drafting`）。
2. Zod 校验并写盘。
3. 写入/更新 SQLite 索引后迁移至 `Searching`。
4. 执行 L0/L1，命中候选后迁移至 `Negotiating`。
5. 执行 L2 双向谈判。
6. 双方 `ACCEPT` 后迁移至 `Waiting_Human` 并通知主人。
7. 若主人不满意，可迁移到 `Revising` 修改需求，再次校验后回到 `Searching`。

### 9.2 被动接单流（`listener.ts`）
1. 持续监听握手请求。
2. 报文入站先做 Schema 校验与幂等检查。
3. 加载本地 `User.md` + 对应 `task.md`，进入 L2 研判。
4. `REJECT` 则静默日志；`ACCEPT` 则迁移至 `Waiting_Human` 并通知主人。

---

## 10. 协议与幂等（新增执行规范）

### 10.1 握手请求 Schema（v1）
```json
{
  "protocol_version": "1.0",
  "message_id": "msg_01H...",
  "sender_agent_id": "agent_A",
  "receiver_agent_id": "agent_B",
  "task_id": "T-UUID",
  "action": "PROPOSE",
  "round": 1,
  "payload": {
    "interaction_type": "online",
    "must_match_tags": ["标签A"],
    "deal_breakers": ["红线A"],
    "target_activity": "一起徒步",
    "target_vibe": "轻松慢节奏"
  },
  "timestamp": "2026-03-03T10:00:00Z",
  "signature": "base64..."
}
```

### 10.2 握手响应 Schema（v1）
```json
{
  "protocol_version": "1.0",
  "message_id": "msg_01H...",
  "in_reply_to": "msg_01G...",
  "task_id": "T-UUID",
  "action": "ACCEPT",
  "error": null,
  "timestamp": "2026-03-03T10:00:02Z"
}
```

### 10.3 错误码（最小集）
- `E_SCHEMA_INVALID`：报文结构不合法。
- `E_PROTOCOL_VERSION_UNSUPPORTED`：协议版本不支持。
- `E_IDEMPOTENCY_CONFLICT`：重复/冲突消息。
- `E_VERSION_CONFLICT`：任务乐观锁冲突。
- `E_DEP_UNAVAILABLE`：依赖不可用（LLM/DB/RAG）。
- `E_INTERNAL`：未知内部错误。

### 10.4 幂等键规则
- 唯一键：`(message_id, sender_agent_id, protocol_version)`。
- 幂等窗口：默认保留 `7` 天。
- 命中重复键时：返回首次处理结果，不重复推进状态。

---

## 11. 存储一致性与补偿

1. 真相源
- `task.md` 是唯一真相源。
- SQLite、RAG 索引是派生层，可重建。

2. 原子写策略
- 第一步：写 `task.md`（包含 `version+1`、`updated_at`、`pending_sync=true`）。
- 第二步：写 SQLite / RAG。
- 第三步：派生层成功后把 `pending_sync=false`。

3. 补偿策略
- 若第二步失败：记录 `E_DEP_UNAVAILABLE`，入 `sync_repair_queue`。
- `rebuild_index` 后台任务支持从 `.data/` 全量重建索引。
- 重建任务必须幂等，可重复执行。

4. 日志策略
- 握手报文写入 `agent_chat/*.jsonl`。
- 系统事件写入 `logs/*.md`，必须可追踪状态迁移。

---

## 12. 安全与隐私

1. CoT 隔离
- `scratchpad.md` 禁止网络发送，禁止用于外部可见报告。

2. 数据最小化
- 对外报文只发协议必需字段。
- 日志中的个人信息必须脱敏（手机号/邮箱/地址）。

3. 数据保留
- `raw_chats` 默认保留 `90` 天。
- `agent_chat.jsonl` 默认保留 `180` 天。
- 到期归档或清理前必须留审计记录。

4. 传输安全
- 所有 Agent 间通信必须走 TLS。
- `signature` 建议使用 Ed25519，公钥轮换周期默认 90 天。

---

## 13. 错误处理与重试

1. LLM 调用失败
- 指数退避重试（默认 3 次，500ms/1s/2s）。
- 超过重试阈值可进入 `Failed`，或保持当前状态等待人工处理。

2. 协议报文错误
- `safeParse` 失败：记录错误码 + 原始摘要，丢弃报文，不推进状态。

3. 并发冲突
- 使用 `version` 乐观锁写入；冲突时重新读取 `task.md` 后重试迁移。

4. 超时恢复
- `Timeout|Failed -> Searching` 必须显式重试，且 `version+1`，并记录触发人/触发器。

---

## 14. 测试与验收标准（新增）

### 14.1 单元测试（必须）
- `schema.ts`：所有入站/出站报文 Schema 校验。
- `state_machine`：允许迁移与禁止迁移全覆盖。
- `idempotency`：重复消息不重复推进状态。

### 14.2 集成测试（必须）
- 主动流 `Drafting -> Waiting_Human` 全链路。
- 被动流 listener 入站到响应全链路。
- `pending_sync=true` 场景下修复队列可恢复。

### 14.3 故障注入测试（必须）
- LLM 超时、SQLite 写失败、RAG 不可用、网络抖动。
- 验证系统进入 `Failed/Timeout` 的路径可追踪、可恢复。

### 14.4 CI 准入门槛
- 单测覆盖率：行覆盖 `>= 80%`。
- 状态机/协议核心模块覆盖率：`>= 90%`。
- 无 `any` 泄漏到协议边界类型。

---

## 15. 可观测性（新增）

每条关键日志必须带字段：
- `trace_id`
- `task_id`
- `message_id`
- `from_status`
- `to_status`
- `latency_ms`
- `error_code`（可空）

建议输出结构化 JSON 日志，便于检索和审计。

---

## 16. 文档版本

- 当前版本：`v1.1`
- 更新日期：`2026-03-03`
- 变更性质：补齐协议 Schema、幂等规则、原子一致性补偿、L1/L2 判定参数、超时语义、测试验收与可观测性规范。
