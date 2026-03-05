import { collectInitialTaskFromUser } from "./intake";
import { processDraftingTasks, processSearchingTasks } from "./dispatcher";
import { appendRawChat, appendRawChatSummary, saveTaskMD } from "./util/storage";

/**
 * Active flow state-machine engine.
 * Contract: never perform file/database I/O directly in this module.
 */
export async function startTaskLoop(): Promise<void> {
  await createDraftTaskFromUserQueryIfAvailable();
  await processDraftingTasks();
  await processSearchingTasks();
}

async function createDraftTaskFromUserQueryIfAvailable(): Promise<void> {
  const intake = await collectInitialTaskFromUser();
  if (!intake) {
    return;
  }

  const timestamp = new Date().toISOString();
  await saveTaskMD(intake.task);

  const transcriptText = intake.transcript.join("\n\n");
  await appendRawChat(intake.task.frontmatter.task_id, transcriptText, timestamp);
  await appendRawChatSummary(
    `# Intake Summary\n\ntask_id: ${intake.task.frontmatter.task_id}\n\n${intake.task.body.rawDescription}`,
    timestamp
  );
}
