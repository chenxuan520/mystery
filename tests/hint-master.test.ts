import { describe, expect, it } from "vitest";

import { buildHintMasterCharacter, buildHintMasterMessages, isDirectRevealRequest, isHintRequest } from "../src/chat/hint-master.js";
import { sampleCase } from "./fixtures/sample-case.js";

describe("hint master", () => {
  it("能识别求提示和直接要答案", () => {
    expect(isHintRequest("我卡住了，给我一点提示")).toBe(true);
    expect(isHintRequest("这个背景是什么意思")).toBe(false);
    expect(isDirectRevealRequest("直接告诉我真凶是谁")).toBe(true);
  });

  it("会把渐进式提示约束写进系统 prompt", () => {
    const messages = buildHintMasterMessages(
      sampleCase,
      [sampleCase.investigationNodes[0]!],
      [
        { role: "user", content: "给我一点提示" },
      ],
      "我还是想不出来，再给我一点提示",
    );

    const systemPrompt = String(messages[0]?.content ?? "");
    expect(systemPrompt).toContain("历史上玩家明确求提示的次数：1");
    expect(systemPrompt).toContain("本轮用户是否明确求提示：是");
    expect(systemPrompt).toContain("提示必须渐进式");
  });

  it("提供固定的提示官角色信息", () => {
    expect(buildHintMasterCharacter()).toMatchObject({
      id: "hint_master",
      name: "提示官",
    });
  });
});
