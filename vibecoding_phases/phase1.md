# Phase 1 - 工程底座与契约冻结

## 阶段定位
本阶段先落“不可变工程契约”和“项目骨架”，不给业务逻辑留模糊空间。完成后才能进入状态机与撮合开发。

## 对应原文条款
- 第 1 章：项目目标与非目标
- 第 2 章：强制工程铁律 (MUST)
- 第 3 章：统一命名规范
- 第 4 章：目录结构 (Strict Tree)
- 第 5 章：核心模块职责与接口规约
- 第 16 章中的版本/日期约束（按阶段文档执行时同步保留）

## 必须原样继承的关键约束

### 1) 目标与非目标
- 构建基于数字孪生的 Agent 双向撮合系统。
- `task.md` 是任务状态机唯一真相源。
- 通过 L0/L1/L2 三层漏斗实现高效、安全、可恢复流程。
- 所有结构化输入输出必须 Zod 强校验。
- 非目标：不追求一次性全自动成交；最终授权由人类确认。
- 非目标：不在网络中传输 CoT。
- 非目标：不把向量原始值落盘到业务目录（仅存索引 ID）。

### 2) 工程铁律
- 所有 I/O 使用 `async/await`，禁止阻塞调用（如 `fs.readFileSync`）。
- 所有跨边界数据必须过 Schema：网络报文、LLM JSON、`JSON.parse` 结果、YAML 头部。
- Schema 失败不得吞错，必须进入错误分支并可追踪日志。
- `task_loop.ts` / `listener.ts` 只能基于 `task.md.status` 推进。
- 状态迁移必须通过统一迁移函数。
- CoT 仅允许本地 `scratchpad.md`，绝不出网。
- 对外通信仅允许协议内 JSON 报文。
- 每条握手消息必须带 `message_id` 与 `protocol_version`。
- 重放同一消息不得导致重复状态推进。
- 任何状态迁移以 `task.md` 成功落盘为前提。
- 派生层（SQLite/RAG）失败不得回滚真相源，必须打标并进入补偿队列。

### 3) 命名与枚举冻结
- 文件统一 `task.md`（不再使用 `task1.md`）。
- `TaskStatus`：
  - `Drafting` / `Searching` / `Negotiating` / `Waiting_Human` / `Revising` / `Closed` / `Failed` / `Timeout` / `Cancelled`
- `InteractionType`：`online | offline | any`
- `HandshakeAction`：`PROPOSE | COUNTER_PROPOSE | ACCEPT | REJECT | CANCEL | ERROR`

### 4) 目录结构冻结
严格按原文目录创建并约束写入职责（`.data/`, `src/`, `task_agent/util` 等）。

### 5) 模块职责边界冻结
- `src/main.ts`：只做启动与装配。
- `task_loop.ts`：主动流状态机引擎，禁止直接文件/数据库操作。
- `listener.ts`：被动入站网关，先校验再派发。
- `dispatcher.ts`：L0/L1/L2 业务总线。
- `context.ts`：Token 预算与上下文裁剪。
- `memory.ts`：记忆总结与归档。
- `storage.ts`：唯一持久化防腐层，负责真相源/索引/补偿。
- `schema.ts`：唯一类型与校验中心。
- `llm/chat.ts`：模型网关（超时、重试、JSON 输出）。
- `rag/*`：向量索引读写。

## 实施输出物
1. 项目目录按 strict tree 建立。
2. `schema.ts` 中落地全部枚举与基础 schema（空实现也要有类型边界）。
3. 各核心模块建立空壳函数与接口（只定义职责，不写业务细节）。
4. 添加 lint 规则，禁止 `readFileSync` 等阻塞 I/O。
5. 添加“职责禁忌”注释与代码审查 checklist。

## 阶段验收标准
- 编译通过，目录和文件命名无偏差。
- 枚举值与原文完全一致（大小写一致）。
- 任意跨边界输入可以通过统一 schema 入口处理。
- 尚未进入业务状态迁移，但框架已具备承载能力。
