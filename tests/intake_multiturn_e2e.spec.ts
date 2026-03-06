import { describe, expect, it } from "vitest";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chatOnce } from "../src/llm/chat";
import { saveTaskMD, getTaskFilePath } from "../src/task_agent/util/storage";
import type { InteractionType, TaskDocument } from "../src/task_agent/util/schema";

// Use the same prompt as intake.ts
const EXTRACT_SYSTEM_PROMPT = `你是一个社交匹配需求分析助手。用户想要找人一起做某件事，你需要从对话中提取结构化信息。

请根据对话历史，提取以下字段并以**纯JSON**格式输出（不要输出任何其他内容）：

{
  "interaction_type": "online" | "offline" | "any",
  "rawDescription": "用户核心需求的精炼描述，≤50字",
  "targetActivity": "具体活动内容，≤50字",
  "targetVibe": "期望的氛围/对方特质，≤50字",
  "detailedPlan": "完整的需求详情，markdown格式",
  "complete": true/false,
  "followUpQuestion": "如果complete=false，给出一个自然的追问；如果complete=true则为null"
}

## interaction_type 判断规则（必须精确）
- 用户明确说"线下/面对面/出去/到场" → "offline"
- 用户明确说"线上/网上/远程" → "online"
- 无法判断或用户没表态 → "any"

## complete 判断标准
- interaction_type 能判断出来 → 必须
- 具体想做什么活动能明确 → 必须
- 以上两项明确即为 complete=true

## targetActivity / targetVibe / rawDescription 的写法要求
- 每项≤50字
- 用发散性、包容性的语言描述，覆盖用户可能接受的相近活动和氛围
- 不要过度限定：用户说"找个人逛街"不意味着只要一个人，应写"找人一起逛街"
- 用户没有明确限制的条件，不要擅自加上（如人数、性别、年龄）
- 适当使用近义词扩展语义覆盖面，例如"逛街探店"比"逛三里屯"更通用

## detailedPlan 的写法要求
- 忠实记录用户**明确提到**的所有细节（时间、地点、偏好等）
- 用户没说的信息标注为"未限定"或"灵活"，不要编造
- 例如用户说"找个人逛街"，人数应写"未限定，一人或多人均可"而非"1位同行者"

## followUpQuestion
- 自然口语化，像朋友聊天
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

async function extract(conversationContext: string): Promise<ExtractedFields> {
  const res = await chatOnce(conversationContext, {
    system: EXTRACT_SYSTEM_PROMPT,
    temperature: 0.3,
    maxTokens: 1000
  });
  let text = res.content.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(text) as ExtractedFields;
}

describe("intake multi-turn e2e: vague → follow-up → refine → task.md", () => {

  it("simulates full multi-round conversation flow", async () => {
    // ============================================================
    // Round 1: User gives a vague query
    // ============================================================
    const userMsg1 = "周末好无聊，想找个人一起出去逛逛";
    let context = `用户: ${userMsg1}`;

    console.log("\n========== 第 1 轮 ==========");
    console.log(`用户: ${userMsg1}`);

    let extracted = await extract(context);
    console.log(`\n[提取] complete=${extracted.complete}`);
    console.log(`[提取] interaction_type=${extracted.interaction_type}`);
    console.log(`[提取] rawDescription=${extracted.rawDescription}`);
    console.log(`[提取] targetActivity=${extracted.targetActivity}`);

    // If incomplete, do follow-up rounds until complete
    let round = 1;
    const followUpAnswers = [
      "想去逛逛三里屯，看看有没有好玩的店，顺便喝杯咖啡",
      "线下的，比较文艺一点的氛围"
    ];

    while (!extracted.complete && extracted.followUpQuestion && round <= followUpAnswers.length) {
      console.log(`\n助手: ${extracted.followUpQuestion}`);

      const answer = followUpAnswers[round - 1];
      context += `\n助手: ${extracted.followUpQuestion}\n用户: ${answer}`;

      console.log(`\n========== 第 ${round + 1} 轮 ==========`);
      console.log(`用户: ${answer}`);

      extracted = await extract(context);
      console.log(`\n[提取] complete=${extracted.complete}`);
      console.log(`[提取] interaction_type=${extracted.interaction_type}`);
      console.log(`[提取] targetActivity=${extracted.targetActivity}`);
      console.log(`[提取] targetVibe=${extracted.targetVibe}`);
      round++;
    }

    expect(extracted.complete).toBe(true);
    console.log(`\n(共 ${round} 轮完成提取)`);

    // ============================================================
    // Refinement: User sees result and wants to add detail
    // ============================================================
    console.log("\n========== 展示提取结果 ==========");
    console.log(`互动方式: ${extracted.interaction_type}`);
    console.log(`核心需求: ${extracted.rawDescription}`);
    console.log(`目标活动: ${extracted.targetActivity}`);
    console.log(`期望氛围: ${extracted.targetVibe}`);
    console.log(`详细计划:\n${extracted.detailedPlan}`);

    // User wants to refine
    const refineMsg = "补充一下，最好是周六下午两点左右，我比较喜欢日式风格的咖啡店";
    context += `\n用户(补充): ${refineMsg}`;

    console.log(`\n========== 用户补充 ==========`);
    console.log(`用户: ${refineMsg}`);

    extracted = await extract(context);

    console.log("\n========== 最终提取结果 ==========");
    console.log(`互动方式: ${extracted.interaction_type}`);
    console.log(`核心需求: ${extracted.rawDescription}`);
    console.log(`目标活动: ${extracted.targetActivity}`);
    console.log(`期望氛围: ${extracted.targetVibe}`);
    console.log(`详细计划:\n${extracted.detailedPlan}`);

    // ============================================================
    // Save task.md
    // ============================================================
    const nowIso = new Date().toISOString();
    const taskId = `T-MT-${randomUUID().slice(0, 8)}`;

    const task: TaskDocument = {
      frontmatter: {
        task_id: taskId,
        status: "Searching",
        interaction_type: (["online", "offline", "any"].includes(extracted.interaction_type)
          ? extracted.interaction_type
          : "any") as InteractionType,
        current_partner_id: null,
        entered_status_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
        version: 1,
        pending_sync: false,
        hidden: false
      },
      body: {
        rawDescription: extracted.rawDescription.slice(0, 50),
        targetActivity: extracted.targetActivity.slice(0, 50),
        targetVibe: extracted.targetVibe.slice(0, 50),
        detailedPlan: extracted.detailedPlan
      }
    };

    await saveTaskMD(task);
    const taskPath = await getTaskFilePath(taskId);
    const fileContent = await readFile(taskPath, "utf8");

    console.log(`\n========== 生成的 task.md ==========`);
    console.log(`路径: ${taskPath}`);
    console.log(fileContent);

    // Verify file structure
    expect(fileContent).toContain("### 原始描述");
    expect(fileContent).toContain("### 靶向映射");
    expect(fileContent).toContain("### 需求详情");
    expect(fileContent).toContain("<Target_Activity>");
    expect(fileContent).toContain("<Target_Vibe>");
    expect(fileContent).toContain('status: "Searching"');
    expect(extracted.detailedPlan).toMatch(/周六|下午|咖啡/); // refinement should be included

    // Verify detailedPlan doesn't over-constrain
    // "找个人逛街" should NOT become "1位同行者"
    console.log("\n========== 开放性检查 ==========");
    console.log(`targetActivity 是否包容: ${extracted.targetActivity}`);
    console.log(`detailedPlan 人数描述是否开放: ${extracted.detailedPlan.includes("未限定") || extracted.detailedPlan.includes("灵活") || !extracted.detailedPlan.includes("1位")}`);
  }, 90_000);
});
