import { appendObservabilityLog, appendRawChat, appendRawChatSummary } from "./util/storage";

/**
 * Memory 模块：对话归档与摘要（Memory extraction / summarization）。
 *
 * 目标：
 * - 当对话长度接近 token 上限时，把“原始对话”归档到磁盘，并生成一段更短的摘要文本
 * - 给上游（通常是 prompt 构建/LLM 调用层）一个“可替代原对话”的 summary turn，以降低 token 占用
 *
 * I/O 边界：
 * - 本模块本身不直接操作文件系统；所有落盘由 `src/task_agent/util/storage.ts` 执行：
 *   - `appendRawChat()`：写 `raw_chats/*-chat.md`
 *   - `appendRawChatSummary()`：写全局 `.data/raw_chats_summary/*-summary.md`
 *   - `appendObservabilityLog()`：写 `.data/logs/*-sys.md`
 *
 * 被使用位置：
 * - `src/task_agent/context.ts`：`buildPromptContext()` 在达到阈值时会调用 `flushMemoryIfNeeded()`
 */

/** memory flush 成功后的返回结果（给上层做替换与追踪用）。 */
export interface MemoryFlushResult {
  /** raw chat 快照落盘路径（用于复盘/审计）。 */
  rawLogPath: string;
  /** summary 落盘路径（用于检索/日报/审计）。 */
  summaryPath: string;
  /** 给上游替换对话用的摘要文本（通常作为单条 turn）。 */
  summaryText: string;
}

/** 触发 memory flush 的输入参数（由上游估算 tokens 并传入）。 */
export interface MemoryFlushInput {
  /** 任务 ID，用于落盘归档路径与日志关联。 */
  taskId: string;
  /** 原始对话 turns（将被原样归档）。 */
  conversationTurns: string[];
  /** 估算 tokens（由上游估算，非精确 tokenizer）。 */
  estimatedTokens: number;
  /** 触发阈值 tokens（估算值达到/超过该值则尝试 flush）。 */
  triggerTokens: number;
  /** 本次 flush 的时间戳（ISO 字符串）。 */
  timestamp: string;
}

/**
 * 在需要时执行 memory flush：归档 raw chat、写入 summary，并发出 observability 日志。
 *
 * 返回：
 * - 不需要 flush：返回 `null`
 * - flush 成功：返回 `{ rawLogPath, summaryPath, summaryText }`
 *
 * 触发条件：
 * - `estimatedTokens >= triggerTokens`
 *
 * 注意：
 * - “摘要算法”当前是轻量占位：取首尾 turn 拼接并截断到 600 字符。
 *   后续可替换为更强的摘要器（例如调用 LLM 或更精细的启发式）。
 */
export async function flushMemoryIfNeeded(input: MemoryFlushInput): Promise<MemoryFlushResult | null> {
  // 阈值未到：直接返回，不做任何 I/O（保持主路径轻量）。
  if (input.estimatedTokens < input.triggerTokens) {
    return null;
  }

  // 1) 构造 raw chat 快照（用于完整复盘）；按 turn 编号分段。
  const rawContent = [
    `# Raw Chat Snapshot`,
    `task_id: ${input.taskId}`,
    `timestamp: ${input.timestamp}`,
    "",
    ...input.conversationTurns.map((turn, index) => `## Turn ${index + 1}\n${turn}`)
  ].join("\n");

  // 2) 生成摘要文本，并构造 summary 文档（供后续日报/检索/替换对话）。
  const summaryText = summarizeTurns(input.conversationTurns);
  const summaryContent = [
    `# Chat Summary`,
    `task_id: ${input.taskId}`,
    `timestamp: ${input.timestamp}`,
    "",
    summaryText
  ].join("\n");

  // 3) 落盘：raw chat（按 task 分目录）+ summary（全局按天覆盖写）。
  const rawLogPath = await appendRawChat(input.taskId, rawContent, input.timestamp);
  const summaryPath = await appendRawChatSummary(summaryContent, input.timestamp);

  // 4) 写入可观测性日志：用于统计 flush 频率、阈值、是否需要调参等。
  await appendObservabilityLog({
    trace_id: "memory",
    task_id: input.taskId,
    message_id: "memory_flush",
    from_status: "N/A",
    to_status: "N/A",
    latency_ms: 0,
    error_code: null,
    event: "memory_flush",
    timestamp: input.timestamp,
    details: {
      estimated_tokens: input.estimatedTokens,
      trigger_tokens: input.triggerTokens
    }
  });

  return { rawLogPath, summaryPath, summaryText };
}

/**
 * 轻量摘要器（占位实现）。
 *
 * 当前策略：
 * - turns 为空：返回固定文本
 * - turns 非空：取首 turn 与尾 turn 拼接，整体最长截断 600 字符
 *
 * 设计目的：
 * - 在不引入外部依赖/LLM 调用的情况下，先把 token 占用显著压缩，保证系统可跑通。
 */
function summarizeTurns(turns: string[]): string {
  if (turns.length === 0) {
    return "No conversation turns.";
  }

  const first = turns[0];
  const last = turns[turns.length - 1];
  const combined = `${first}\n${last}`.trim();
  const trimmed = combined.length > 600 ? `${combined.slice(0, 600)}...` : combined;
  return `Summary (${turns.length} turns):\n${trimmed}`;
}
