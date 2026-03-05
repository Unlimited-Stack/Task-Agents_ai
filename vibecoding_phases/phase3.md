# Phase 3 - 主动流与 L0/L1 撮合漏斗

## 阶段定位
本阶段实现“主动发单主路径”：从 `Drafting/Revising` 任务推进到 `Negotiating`，聚焦结构化过滤与语义检索，不引入完整外部握手协议细节。

## 对应原文条款
- 第 8 章：三层漏斗中的 L0/L1
- 第 9 章：主动发单流（9.1）
- 第 5 章：`dispatcher.ts`、`task_loop.ts`、`rag/*` 职责

## 必须原样继承的关键约束

### 1) L0 动态底线过滤
- 输入：`must_match_tags`、`deal_breakers`、`interaction_type`。
- 存储：SQLite 索引表。
- 目标：快速剔除明显不合规任务。

### 2) L1 语义检索
- 输入：`Target_Activity`、`Target_Vibe`。
- 输出：候选池 + 相似度分数。
- 规则：仅存向量库索引 ID，不存原始向量。
- 默认参数：`topK=30`，`minScore=0.72`，不足阈值不进入 L2。

### 3) 主动发单流步骤
1. 捕获需求并创建 `task.md`（`Drafting`）。
2. Zod 校验并写盘。
3. 写入/更新 SQLite 索引后迁移至 `Searching`。
4. 执行 L0/L1，命中候选后迁移至 `Negotiating`。
5. 执行 L2 双向谈判（本阶段仅预留接口，下一阶段实现完整协议）。
6. 双方 `ACCEPT` 后迁移至 `Waiting_Human`（在 Phase 4 闭环）。

### 4) 模块分工不变
- `task_loop.ts`：轮询 `Drafting/Revising/Searching`，禁止直连持久化。
- `dispatcher.ts`：实现 `runL0Filter()`、`runL1Retrieval()`。
- `rag/embedding.ts`、`rag/retrieval.ts`：向量索引读写。
- `storage.ts`：提供 L0 查询接口 `queryL0Candidates()`。

## 实施输出物
1. `processDraftingTasks()`：从草稿到可检索状态。
2. `processSearchingTasks()`：执行 L0/L1 并输出候选。
3. L1 排序与阈值截断实现。
4. `Searching -> Negotiating` 条件触发实现。
5. L2 入口方法签名（占位，不做外网交互）。

## 阶段验收标准
- 任务可稳定从 `Drafting` 进入 `Searching`，并依据 L0/L1 进入 `Negotiating`。
- 候选池结果可追踪（分数、阈值、截断原因）。
- 不符合阈值的候选不会进入 L2。
