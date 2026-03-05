# Phase 2 - 真相源 task.md 与 FSM 内核

## 阶段定位
本阶段实现“任务真相源 + 强约束状态机 + 乐观锁并发控制 + 原子同步标记”。这部分与后续业务强耦合，必须整体完成。

## 对应原文条款
- 第 6 章：`task.md` 规约
- 第 7 章：状态机迁移表
- 第 11 章：存储一致性与补偿（原子写策略）
- 第 13 章：并发冲突与超时恢复相关规则

## 必须原样继承的关键约束

### 1) task.md 结构与字段
YAML 必须包含并可校验：
- `task_id`
- `status`
- `interaction_type`
- `must_match_tags`
- `deal_breakers`
- `current_partner_id`
- `entered_status_at`
- `created_at`
- `updated_at`
- `version`
- `pending_sync`

正文必须包含：
- `### 原始描述`
- `### 靶向映射`
- `<Target_Activity>[事件摘要，50字内]</Target_Activity>`
- `<Target_Vibe>[事件性格氛围，50字内]</Target_Vibe>`

### 2) 状态迁移唯一合法路径
仅允许：
1. `Drafting -> Searching`
2. `Searching -> Negotiating`
3. `Negotiating -> Waiting_Human`
4. `Waiting_Human -> Revising`
5. `Revising -> Searching`
6. `Waiting_Human -> Closed`
7. `Searching|Negotiating -> Timeout`
8. `Searching|Negotiating -> Failed`
9. `Drafting|Searching|Negotiating|Waiting_Human|Revising -> Cancelled`
10. `Timeout|Failed -> Searching`

禁止：
- 任何状态直接回写 `Drafting`。
- `Closed` 非显式用户操作不得逆转。

### 3) 迁移触发条件必须一致
- `Drafting -> Searching`：YAML + 正文校验通过并落盘。
- `Searching -> Negotiating`：L0/L1 出候选并发首条 `PROPOSE`。
- `Negotiating -> Waiting_Human`：双方 L2 都 `ACCEPT`。
- `Waiting_Human -> Revising`：主人对搜索结果/搜索报告不满意，发起修改。
- `Revising -> Searching`：主人完成修改后再次通过 YAML + 正文校验并落盘，且 `version+1`。
- `Waiting_Human -> Closed`：主人确认。
- `Searching|Negotiating -> Timeout`：`now - entered_status_at >= 24h` 或 `negotiation_round >= 5`。
- `Searching|Negotiating -> Failed`：不可恢复系统错误。
- `Timeout|Failed -> Searching`：显式重试且 `version+1`。

### 4) 原子一致性策略
- 第一步：写 `task.md`（`version+1`、`updated_at`、`pending_sync=true`）。
- 第二步：写 SQLite/RAG。
- 第三步：成功后把 `pending_sync=false`。
- 第二步失败：记录 `E_DEP_UNAVAILABLE` 并入 `sync_repair_queue`。

### 5) 并发控制
- 用 `version` 乐观锁控制写入。
- 冲突时必须重新读取 `task.md` 再重试迁移。

## 实施输出物
1. `task.md` 读写解析器（YAML 头 + Markdown 正文）。
2. `transitionTaskStatus()` 统一迁移函数（内置合法性校验）。
3. `version` 乐观锁写入器。
4. `pending_sync` 生命周期处理。
5. `sync_repair_queue` 基础结构与重试入口。

## 阶段验收标准
- 非法迁移全部被拒绝并记录日志。
- 合法迁移自动刷新 `entered_status_at`、`updated_at`、`version`。
- 派生层故障时系统保持可恢复状态，不丢失真相源。
