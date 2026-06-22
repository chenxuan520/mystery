import { describe, expect, it } from "vitest";

import type { StructuredJsonGateway } from "../src/llm/openai-gateway.js";
import { buildFallbackConsequence, evaluateAccusation, judgeAccusation, revealSolution } from "../src/judgement/judge.js";
import { sampleCase } from "./fixtures/sample-case.js";

describe("judgeAccusation", () => {
  it("能判断正确指认", () => {
    const result = judgeAccusation(sampleCase, "suspect_doctor");
    expect(result.correct).toBe(true);
    expect(result.culpritName).toBe("沈岚");
    expect(result.keyContradictions).toHaveLength(3);
  });

  it("能判断错误指认", () => {
    const result = judgeAccusation(sampleCase, "suspect_nephew");
    expect(result.correct).toBe(false);
    expect(result.accusedName).toBe("周承安");
  });

  it("能直接揭晓答案", () => {
    const result = revealSolution(sampleCase);
    expect(result.correct).toBe(true);
    expect(result.summary).toContain("已直接查看答案");
    expect(result.culpritName).toBe("沈岚");
  });
});

describe("evaluateAccusation", () => {
  it("把模型评估映射成评分与结局，并对分数做钳制和清洗", async () => {
    const captured: { system?: string; user?: string } = {};
    const fakeGateway = {
      completeJson: async (system: string, user: string) => {
        captured.system = system;
        captured.user = user;
        return {
          score: 150,
          verdict: "证据扎实，推理到位",
          hitPoints: ["假密室痕迹", "   "],
          missedPoints: ["送药时间对不上"],
          feedback: "你抓到了密室是伪造的。",
          consequence: "沈岚最终落网，案件了结。",
        };
      },
    } as unknown as StructuredJsonGateway;

    const result = await evaluateAccusation(fakeGateway, sampleCase, "suspect_doctor", "我觉得是医生沈岚", [
      sampleCase.investigationNodes[0]!,
    ]);

    expect(result.deduction.score).toBe(100);
    expect(result.deduction.hitPoints).toEqual(["假密室痕迹"]);
    expect(result.deduction.verdict).toBe("证据扎实，推理到位");
    expect(result.consequence).toBe("沈岚最终落网，案件了结。");
    expect(captured.user).toContain("玩家指认是否正确：正确");
    expect(captured.user).toContain("书房现场");
  });

  it("会把玩家的错误指认与推理传给评估", async () => {
    const captured: { user?: string } = {};
    const fakeGateway = {
      completeJson: async (_system: string, user: string) => {
        captured.user = user;
        return {
          score: 20,
          verdict: "蒙错了人",
          hitPoints: [],
          missedPoints: ["真凶其实是沈岚"],
          feedback: "方向偏了。",
          consequence: "真凶趁乱脱身。",
        };
      },
    } as unknown as StructuredJsonGateway;

    const result = await evaluateAccusation(fakeGateway, sampleCase, "suspect_nephew", "我怀疑侄子", []);
    expect(result.deduction.score).toBe(20);
    expect(captured.user).toContain("玩家指认是否正确：错误");
  });
});

describe("buildFallbackConsequence", () => {
  it("正确指认给出落网收尾", () => {
    expect(buildFallbackConsequence(sampleCase, "suspect_doctor")).toContain("沈岚");
  });

  it("错误指认给出真凶脱身的后果", () => {
    const text = buildFallbackConsequence(sampleCase, "suspect_nephew");
    expect(text).toContain("周承安");
    expect(text).toContain("沈岚");
  });
});
