import { flushMemoryIfNeeded } from "./memory";
import type { TaskDocument } from "./util/schema";

/**
 * Prompt 上下文构建与 token 预算管理模块。
 *
 * 目标：
 * - 给上游（LLM 调用/握手协议生成）提供稳定的 `systemPrompt + taskPrompt`
 * - 在接近 token 上限时触发 memory flush（把长对话归档并压缩成摘要），避免提示词爆仓
 *
 * 关联模块：
 * - `src/task_agent/memory.ts`：`flushMemoryIfNeeded()` 会把 raw chat + summary 落盘，并写 observability 日志
 * - `src/task_agent/util/storage.ts`：最终负责 `.data/` 相关文件写入（通过 memory 模块间接调用）
 *
 * 当前阶段说明：
 * - token 估算使用轻量近似（按字符长度/4），不引入 tokenizer 依赖；因此预算是“软约束”。
 */

/** 构建完成后返回给上层的上下文结构。 */
export interface PromptContext {
  /** 给模型的 system 提示（原则/输出格式约束）。 */
  systemPrompt: string;
  /** 与单个 task 绑定的用户态 prompt（任务元信息 + 对话上下文）。 */
  taskPrompt: string;
  /** 本次允许使用的 token 预算（软限制）。 */
  tokenBudget: number;
  /** 对本次对话内容的 token 估算值（用于阈值判断与调试）。 */
  estimatedTokens: number;
  /** 是否触发并完成了 memory flush（触发后对话会被摘要替换）。 */
  memoryFlushed: boolean;
  /** memory flush 后 summary 文件路径（用于排障/审计；未 flush 时为 null）。 */
  memorySummaryPath: string | null;
}

/** 构建 prompt 上下文的输入参数。 */
export interface BuildPromptContextInput {
  /** 当前任务文档（task.md 的结构化表示）。 */
  task: TaskDocument;
  /** 近期对话 turns（通常一条 turn 对应一次 user/assistant 轮次的文本拼接）。 */
  conversationTurns: string[];
  /** token 预算（软限制）。 */
  tokenBudget: number;
  /**
   * 触发 memory flush 的阈值比例（默认 0.8）。
   * 例如 tokenBudget=2000，ratio=0.8，则估算 tokens >= 1600 时会尝试 flush。
   */
  flushTriggerRatio?: number;
}

/**
 * 构建给模型调用的 prompt 上下文，并尽量在预算内保留有效对话信息。
 *
 * 行为概览：
 * 1) 估算当前对话 token（近似值）
 * 2) 若达到阈值（默认预算的 80%），则调用 `flushMemoryIfNeeded()`：
 *    - 成功：把原始对话归档到 `.data/`，并用“摘要 turn”替换对话，显著降低 token 占用
 *    - 失败/不需要：保持原对话
 * 3) 使用 `truncateTurnsByBudget()` 在预算内裁剪对话 turns（优先保留最新内容）
 * 4) 拼装 `taskPrompt`（携带 task_id/status/target* 与最终对话）
 *
 * 被使用位置：
 * - 当前代码库暂无直接引用（通常由 LLM 调用层/握手生成器在发请求前调用）
 */
export async function buildPromptContext(input: BuildPromptContextInput): Promise<PromptContext> {
  const flushTriggerRatio = input.flushTriggerRatio ?? 0.8;
  const triggerTokens = Math.floor(input.tokenBudget * flushTriggerRatio);
  const estimatedTokens = estimateTokens(input.conversationTurns.join("\n"));

  let conversationTurns = input.conversationTurns;
  let memoryFlushed = false;
  let memorySummaryPath: string | null = null;

  if (estimatedTokens >= triggerTokens) {
    const flushResult = await flushMemoryIfNeeded({
      taskId: input.task.frontmatter.task_id,
      conversationTurns: input.conversationTurns,
      estimatedTokens,
      triggerTokens,
      timestamp: new Date().toISOString()
    });

    if (flushResult) {
      memoryFlushed = true;
      memorySummaryPath = flushResult.summaryPath;
      conversationTurns = [flushResult.summaryText];
    }
  }

  const promptTurns = truncateTurnsByBudget(conversationTurns, input.tokenBudget);
  const taskPrompt = [
    `TaskId: ${input.task.frontmatter.task_id}`,
    `Status: ${input.task.frontmatter.status}`,
    `TargetActivity: ${input.task.body.targetActivity}`,
    `TargetVibe: ${input.task.body.targetVibe}`,
    "Conversation:",
    ...promptTurns
  ].join("\n");

  return {
    systemPrompt: "You are a matching agent. Output protocol JSON only.",
    taskPrompt,
    tokenBudget: input.tokenBudget,
    estimatedTokens,
    memoryFlushed,
    memorySummaryPath
  };
}

/**
 * token 粗略估算。
 *
 * 说明：
 * - 不同语言/编码下“字符数 -> token”的比例不稳定，这里用 `len/4` 作为轻量近似。
 * - 该值主要用于阈值触发与裁剪策略，而不是精确计费。
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * 在 token 预算内裁剪对话 turns（优先保留最新内容）。
 *
 * 策略：
 * - 从最后一条 turn 开始往前回溯，尽可能多地保留“最近的 turn”
 * - 若某条 turn 过大导致超预算，则跳过该条并继续向前（不会中断）
 *
 * 注意：
 * - 由于使用估算 token，可能出现“看似在预算内但实际超出”的情况（或相反）。
 */
function truncateTurnsByBudget(turns: string[], tokenBudget: number): string[] {
  const result: string[] = [];
  let used = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const turnTokens = estimateTokens(turn);
    if (used + turnTokens > tokenBudget) {
      continue;
    }
    used += turnTokens;
    result.push(turn);
  }

  return result.reverse();
}
