import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { processWaitingHumanTasks } from "./dispatcher";
import { isListenerRunning, startListener, stopListener } from "./listener";
import { startTaskLoop } from "./task_loop";
import { cleanupExpiredData, getTaskFilePath, listAllTasks, readTaskDocument, transitionTaskStatus } from "./util/storage";
import type { TaskStatus } from "./util/schema";

const TERMINAL_STATUSES: readonly TaskStatus[] = ["Closed", "Failed", "Timeout", "Cancelled"] as const;

/**
 * Runtime：负责把“主动流 + 被动监听 + 人类可中断操作”编排成一个可交互的运行模式。
 *
 * 设计目标（对应你的需求）：
 * - 先跑一轮 `startTaskLoop()`：创建任务、推进 Drafting/Revising/Searching 等主动流程
 * - 若任务未完成：启动 listener 进入“挂起等待”模式，随时接收入站握手
 * - 挂起期间：用户可通过命令中断/修改需求（例如把某任务退回 Drafting 并编辑 task.md），再手动触发下一轮推进
 * - 若任务全部进入终态：可清理过期数据并退出进程（按需）
 */
export async function startTaskAgentRuntime(): Promise<void> {
  // 先跑一轮主动流：尽可能推进任务状态。
  await startTaskLoop();

  // 非交互环境：直接开启 listener 挂起（避免因 readline 卡死）。
  if (!input.isTTY) {
    await startListener();
    return;
  }

  const rl = createInterface({ input, output });
  try {
    await maybeStartListenerForPendingTasks(rl);

    while (true) {
      // 每轮先处理 Waiting_Human（会在同一个 rl 里询问 yes/no）。
      await processWaitingHumanTasks(rl);

      // 若没有任何非终态任务，则可退出（listener 也会一并关闭）。
      const hasActive = await hasNonTerminalTasks();
      if (!hasActive) {
        output.write("\n所有任务已进入终态，runtime 将退出。\n");
        await cleanupExpiredData().catch(() => undefined);
        break;
      }

      const line = (await rl.question("\nruntime> ")).trim();
      if (!line) {
        continue;
      }

      const [command, ...args] = line.split(/\s+/);
      if (command === "help") {
        printHelp();
        continue;
      }

      if (command === "list") {
        await printTaskStatusSummary();
        continue;
      }

      if (command === "run") {
        await startTaskLoop();
        await maybeStartListenerForPendingTasks(rl);
        continue;
      }

      if (command === "listener") {
        const sub = args[0];
        if (sub === "on") {
          await startListener();
          output.write("listener: on\n");
          continue;
        }
        if (sub === "off") {
          await stopListener();
          output.write("listener: off\n");
          continue;
        }
        output.write(`listener 当前状态：${isListenerRunning() ? "on" : "off"}（用法：listener on|off）\n`);
        continue;
      }

      if (command === "draft") {
        const taskId = args[0];
        if (!taskId) {
          output.write("用法：draft <taskId>\n");
          continue;
        }

        try {
          const doc = await readTaskDocument(taskId);
          await transitionTaskStatus(taskId, "Drafting", {
            expectedVersion: doc.frontmatter.version,
            traceId: "runtime",
            messageId: "owner"
          });
          const filePath = await getTaskFilePath(taskId);
          output.write(`已退回 Drafting。请编辑：${filePath}\n`);
        } catch (error) {
          output.write(`draft 失败：${normalizeErrorMessage(error)}\n`);
        }
        continue;
      }

      if (command === "path") {
        const taskId = args[0];
        if (!taskId) {
          output.write("用法：path <taskId>\n");
          continue;
        }
        try {
          const filePath = await getTaskFilePath(taskId);
          output.write(`${filePath}\n`);
        } catch (error) {
          output.write(`path 失败：${normalizeErrorMessage(error)}\n`);
        }
        continue;
      }

      if (command === "exit" || command === "quit") {
        output.write("退出 runtime。\n");
        break;
      }

      output.write(`未知命令：${command}（输入 help 查看可用命令）\n`);
    }
  } finally {
    rl.close();
    await stopListener().catch(() => undefined);
  }
}

async function maybeStartListenerForPendingTasks(rl: ReturnType<typeof createInterface>): Promise<void> {
  const pending = await hasPendingTasksNeedingListener();
  if (!pending) {
    return;
  }
  if (isListenerRunning()) {
    return;
  }

  const answer = (await rl.question("检测到未完成任务，是否开启 listener 挂起等待入站握手？输入 yes/no（默认 yes）："))
    .trim()
    .toLowerCase();
  if (answer === "" || answer === "yes" || answer === "y") {
    await startListener();
    output.write("listener: on（已进入挂起等待模式；可随时输入命令中断/修改）\n");
  }
}

async function hasPendingTasksNeedingListener(): Promise<boolean> {
  const records = await listAllTasks();
  return records.some((record) => !TERMINAL_STATUSES.includes(record.task.frontmatter.status));
}

async function hasNonTerminalTasks(): Promise<boolean> {
  return hasPendingTasksNeedingListener();
}

async function printTaskStatusSummary(): Promise<void> {
  const records = await listAllTasks();
  if (records.length === 0) {
    output.write("当前没有任务。\n");
    return;
  }

  const groups = new Map<string, string[]>();
  for (const record of records) {
    const status = record.task.frontmatter.status;
    const list = groups.get(status) ?? [];
    list.push(record.task.frontmatter.task_id);
    groups.set(status, list);
  }

  output.write("\n任务状态概览：\n");
  for (const [status, ids] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    output.write(`- ${status}: ${ids.length}\n`);
    output.write(`  ${ids.join(", ")}\n`);
  }
}

function printHelp(): void {
  output.write(
    [
      "\n可用命令：",
      "- help                 显示帮助",
      "- list                 列出任务状态与 task_id",
      "- run                  再跑一轮主动流程（startTaskLoop）",
      "- listener on|off       开关 listener（挂起等待入站握手）",
      "- draft <taskId>        将任务退回 Drafting，并打印 task.md 路径（用于手动修改需求）",
      "- path <taskId>         打印某任务的 task.md 路径",
      "- exit|quit             退出 runtime"
    ].join("\n") + "\n"
  );
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Internal error";
}

