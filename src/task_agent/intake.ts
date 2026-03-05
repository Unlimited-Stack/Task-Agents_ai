import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { InteractionType, TaskDocument } from "./util/schema";

export interface IntakeTaskResult {
  task: TaskDocument;
  transcript: string[];
}

/**
 * Multi-round query intake from user.
 * Produces an initial Drafting task document.
 */
export async function collectInitialTaskFromUser(): Promise<IntakeTaskResult | null> {
  if (!input.isTTY) {
    return null;
  }

  const rl = createInterface({ input, output });
  const transcript: string[] = [];

  try {
    const startAnswer = (await rl.question("请输入你的需求 query（留空则跳过本轮）：")).trim();
    if (!startAnswer) {
      return null;
    }
    transcript.push(`Q1: 用户初始query\nA1: ${startAnswer}`);

    const interactionAnswer = (await rl.question("偏好互动方式？online / offline / any（默认 any）：")).trim();
    transcript.push(`Q2: 互动方式\nA2: ${interactionAnswer || "any"}`);

    const mustTagsAnswer = (await rl.question("必须匹配标签（逗号分隔，可空）：")).trim();
    transcript.push(`Q3: 必须匹配标签\nA3: ${mustTagsAnswer || "(空)"}`);

    const dealBreakersAnswer = (await rl.question("红线标签（逗号分隔，可空）：")).trim();
    transcript.push(`Q4: 红线标签\nA4: ${dealBreakersAnswer || "(空)"}`);

    const vibeAnswer = (await rl.question("希望的氛围描述（可空，默认从query提取）：")).trim();
    transcript.push(`Q5: 氛围补充\nA5: ${vibeAnswer || "(空)"}`);

    const confirmAnswer = (await rl.question("确认生成初始TASK.md？输入 yes 确认：")).trim().toLowerCase();
    if (confirmAnswer !== "yes") {
      return null;
    }
    transcript.push(`Q6: 生成确认\nA6: yes`);

    const nowIso = new Date().toISOString();
    const taskId = `T-${randomUUID()}`;
    const interactionType = normalizeInteractionType(interactionAnswer);
    const mustMatchTags = parseCsv(mustTagsAnswer);
    const dealBreakers = parseCsv(dealBreakersAnswer);
    const targetActivity = buildTargetActivity(startAnswer);
    const targetVibe = buildTargetVibe(vibeAnswer, startAnswer);

    const task: TaskDocument = {
      frontmatter: {
        task_id: taskId,
        status: "Drafting",
        interaction_type: interactionType,
        must_match_tags: mustMatchTags,
        deal_breakers: dealBreakers,
        current_partner_id: null,
        entered_status_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
        version: 1,
        pending_sync: false
      },
      body: {
        rawDescription: startAnswer,
        targetActivity,
        targetVibe
      }
    };

    return { task, transcript };
  } finally {
    rl.close();
  }
}

function normalizeInteractionType(value: string): InteractionType {
  if (value === "online" || value === "offline" || value === "any") {
    return value;
  }
  return "any";
}

function parseCsv(value: string): string[] {
  if (!value.trim()) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function buildTargetActivity(query: string): string {
  const trimmed = query.trim();
  return trimmed.length <= 50 ? trimmed : `${trimmed.slice(0, 50)}...`;
}

function buildTargetVibe(vibe: string, query: string): string {
  const preferred = vibe.trim().length > 0 ? vibe.trim() : query.trim();
  return preferred.length <= 50 ? preferred : `${preferred.slice(0, 50)}...`;
}

