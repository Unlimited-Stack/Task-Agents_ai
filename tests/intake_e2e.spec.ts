import { describe, expect, it } from "vitest";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chatOnce } from "../src/llm/chat";
import { saveTaskMD, getTaskFilePath, readTaskDocument } from "../src/task_agent/util/storage";
import type { InteractionType, TaskDocument } from "../src/task_agent/util/schema";

/**
 * Same extraction prompt as intake.ts
 */
const EXTRACT_SYSTEM_PROMPT = `你是一个社交匹配需求分析助手。用户想要找人一起做某件事，你需要从对话中提取结构化信息。

请根据对话历史，提取以下字段并以**纯JSON**格式输出（不要输出任何其他内容）：

{
  "interaction_type": "online" | "offline" | "any",
  "rawDescription": "用户核心需求的精炼描述，≤50字",
  "targetActivity": "具体活动内容，≤50字",
  "targetVibe": "期望的氛围/对方特质，≤50字",
  "detailedPlan": "完整的需求详情，markdown格式，包含：活动内容、时间偏好、地点偏好、人数、对参与者的期望等所有能从对话中提取的信息",
  "complete": true/false,
  "followUpQuestion": "如果complete=false，给出一个自然的追问；如果complete=true则为null"
}

判断complete的标准：
- interaction_type 能判断出来（线上/线下/都行）→ 必须
- 具体想做什么活动能明确 → 必须
- 以上两项明确即为complete=true

注意：
- rawDescription、targetActivity、targetVibe 每项严格≤50字
- detailedPlan 尽量详细，把用户提到的所有细节都组织进去
- 只输出JSON，不要任何解释文字`;

interface ExtractedFields {
  interaction_type: string;
  rawDescription: string;
  targetActivity: string;
  targetVibe: string;
  detailedPlan: string;
  complete: boolean;
  followUpQuestion: string | null;
}

describe("intake end-to-end: extract → build TaskDocument → save task.md", () => {

  it("generates a complete task.md from user conversation", async () => {
    // --- Step 1: Simulate a multi-round conversation ---
    const conversation = `用户: 这周六想找人去朝阳公园野餐，最好能带桌游，线下的
助手: 大概几个人的规模？对同伴有什么期望吗？
用户: 两三个人就行，希望对方比较开朗健谈，年龄相近的`;

    console.log("\n=== 模拟对话 ===");
    console.log(conversation);

    // --- Step 2: LLM extraction ---
    const res = await chatOnce(conversation, {
      system: EXTRACT_SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 1000
    });

    let text = res.content.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const extracted: ExtractedFields = JSON.parse(text);

    console.log("\n=== LLM 提取结果 ===");
    console.log(JSON.stringify(extracted, null, 2));

    expect(extracted.complete).toBe(true);

    // --- Step 3: Build TaskDocument ---
    const nowIso = new Date().toISOString();
    const taskId = `T-E2E-${randomUUID().slice(0, 8)}`;

    const task: TaskDocument = {
      frontmatter: {
        task_id: taskId,
        status: "Drafting",
        interaction_type: normalizeInteractionType(extracted.interaction_type),
        current_partner_id: null,
        entered_status_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
        version: 1,
        pending_sync: false,
        hidden: false
      },
      body: {
        rawDescription: truncate(extracted.rawDescription, 50),
        targetActivity: truncate(extracted.targetActivity, 50),
        targetVibe: truncate(extracted.targetVibe, 50),
        detailedPlan: extracted.detailedPlan
      }
    };

    // --- Step 4: Save task.md ---
    await saveTaskMD(task);
    const taskPath = await getTaskFilePath(taskId);
    const fileContent = await readFile(taskPath, "utf8");

    console.log("\n=== 生成的 task.md 路径 ===");
    console.log(taskPath);
    console.log("\n=== task.md 文件内容 ===");
    console.log(fileContent);

    // --- Step 5: Verify round-trip ---
    const reloaded = await readTaskDocument(taskId);

    expect(reloaded.frontmatter.task_id).toBe(taskId);
    expect(reloaded.frontmatter.status).toBe("Drafting");
    expect(reloaded.frontmatter.interaction_type).toBe(task.frontmatter.interaction_type);
    expect(reloaded.body.rawDescription).toBe(task.body.rawDescription);
    expect(reloaded.body.targetActivity).toBe(task.body.targetActivity);
    expect(reloaded.body.targetVibe).toBe(task.body.targetVibe);
    expect(reloaded.body.detailedPlan.length).toBeGreaterThan(0);

    // Verify file structure
    expect(fileContent).toContain("---");
    expect(fileContent).toContain("task_id:");
    expect(fileContent).toContain("### 原始描述");
    expect(fileContent).toContain("### 靶向映射");
    expect(fileContent).toContain("<Target_Activity>");
    expect(fileContent).toContain("<Target_Vibe>");
    expect(fileContent).toContain("### 需求详情");
  }, 30_000);
});

function normalizeInteractionType(value: string): InteractionType {
  if (value === "online" || value === "offline" || value === "any") return value;
  return "any";
}

function truncate(text: string, maxLen: number): string {
  if (!text) return "";
  return text.length <= maxLen ? text : text.slice(0, maxLen);
}
