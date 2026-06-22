import { describe, expect, it } from "vitest";

import { buildSuspectMessages } from "../src/chat/suspect-chat.js";
import { sampleCase } from "./fixtures/sample-case.js";

const culprit = sampleCase.suspects.find((suspect) => suspect.id === sampleCase.solution.culpritId)!;
const innocent = sampleCase.suspects.find((suspect) => suspect.id === "suspect_nephew")!;
const npc = sampleCase.npcs![0]!;

describe("buildSuspectMessages 角色上下文", () => {
  it("把完整案件世界观和其他角色写进 system prompt", () => {
    const messages = buildSuspectMessages(sampleCase, innocent, [], [], "你昨晚在哪");
    const systemPrompt = String(messages[0]?.content ?? "");

    expect(systemPrompt).toContain(sampleCase.publicSummary);
    expect(systemPrompt).toContain("案件全部人物");
    expect(systemPrompt).toContain("沈岚");
    expect(systemPrompt).toContain("案件现场与可调查地点");
    expect(systemPrompt).toContain("你这场对话的目标与行为方式");
  });

  it("真凶能看到内部真相，非真凶看不到", () => {
    const culpritPrompt = String(buildSuspectMessages(sampleCase, culprit, [], [], "你做了什么")[0]?.content ?? "");
    const innocentPrompt = String(buildSuspectMessages(sampleCase, innocent, [], [], "你做了什么")[0]?.content ?? "");

    expect(culpritPrompt).toContain("真凶内部视角");
    expect(culpritPrompt).toContain(sampleCase.solution.method);
    expect(innocentPrompt).not.toContain("真凶内部视角");
  });

  it("NPC 走相关人物视角，不带真凶区块", () => {
    const npcPrompt = String(buildSuspectMessages(sampleCase, npc, [], [], "你看到了什么")[0]?.content ?? "");
    expect(npcPrompt).toContain("你不是凶手候选");
    expect(npcPrompt).not.toContain("真凶内部视角");
  });
});

describe("buildSuspectMessages 线索对质", () => {
  const node = sampleCase.investigationNodes[0]!;

  it("传入对质线索时注入对质指令", () => {
    const messages = buildSuspectMessages(sampleCase, culprit, [node], [], "（出示线索：书房现场）你怎么解释？", node);
    const systemContents = messages.filter((message) => message.role === "system").map((message) => String(message.content));

    expect(systemContents.some((content) => content.includes("玩家正拿出一条已经查实的线索与你正面对质"))).toBe(true);
    expect(systemContents.some((content) => content.includes(node.discovery))).toBe(true);

    const lastMessage = messages[messages.length - 1];
    expect(lastMessage?.role).toBe("user");
  });

  it("不传对质线索时不注入对质指令", () => {
    const messages = buildSuspectMessages(sampleCase, culprit, [node], [], "你好");
    const systemContents = messages.filter((message) => message.role === "system").map((message) => String(message.content));
    expect(systemContents.some((content) => content.includes("正面对质"))).toBe(false);
  });
});
