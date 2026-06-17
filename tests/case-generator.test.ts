import { describe, expect, it } from "vitest";

import { generateCasePackageWithDiagnostics } from "../src/case/generator.js";
import type { StructuredJsonGateway } from "../src/llm/openai-gateway.js";
import { sampleCase } from "./fixtures/sample-case.js";

describe("generateCasePackageWithDiagnostics", () => {
  it("会在确定性质量门禁失败后继续生成并保留反馈历史", async () => {
    const weakCase = {
      ...sampleCase,
      suspects: sampleCase.suspects.slice(0, 3),
    };

    let generationCallCount = 0;
    let reviewCallCount = 0;

    const gateway: StructuredJsonGateway = {
      async completeJson<T>(systemPrompt: string): Promise<T> {
        if (systemPrompt.includes("非常严格的中文悬疑推理游戏编辑")) {
          reviewCallCount += 1;
          return {
            overallScore: 86,
            dimensionScores: {
              coherence: 8,
              complexity: 8,
              fairness: 8,
              suspectEntanglement: 8,
              investigationValue: 8,
              dialogueTension: 8,
            },
            strengths: ["多层误导成立", "嫌疑人秘密足够"],
            weaknesses: ["还可以继续压缩一两个冗余句子"],
            revisionAdvice: ["保持当前复杂度即可"],
            criticalIssues: [],
          } as T;
        }

        generationCallCount += 1;
        return (generationCallCount === 1 ? weakCase : sampleCase) as T;
      },
    };

    const result = await generateCasePackageWithDiagnostics(gateway);

    expect(result.mysteryCase.title).toBe(sampleCase.title);
    expect(result.diagnostics.attemptCount).toBe(2);
    expect(result.diagnostics.deterministicFeedback).toHaveLength(1);
    expect(reviewCallCount).toBe(1);
  });

  it("会在标题与已有案件重复时继续修订", async () => {
    let generationCallCount = 0;

    const duplicateTitleCase = {
      ...sampleCase,
      title: "旧案名",
    };
    const revisedTitleCase = {
      ...sampleCase,
      title: "新案名",
    };

    const gateway: StructuredJsonGateway = {
      async completeJson<T>(systemPrompt: string): Promise<T> {
        if (systemPrompt.includes("非常严格的中文悬疑推理游戏编辑")) {
          return {
            overallScore: 84,
            dimensionScores: {
              coherence: 8,
              complexity: 8,
              fairness: 7,
              suspectEntanglement: 8,
              investigationValue: 8,
              dialogueTension: 8,
            },
            strengths: ["结构完整"],
            weaknesses: ["无"],
            revisionAdvice: ["无"],
            criticalIssues: [],
          } as T;
        }

        generationCallCount += 1;
        return (generationCallCount === 1 ? duplicateTitleCase : revisedTitleCase) as T;
      },
    };

    const result = await generateCasePackageWithDiagnostics(gateway, undefined, gateway, {
      existingTitles: ["旧案名"],
    });

    expect(result.mysteryCase.title).toBe("新案名");
    expect(result.diagnostics.attemptCount).toBe(2);
    expect(result.diagnostics.deterministicFeedback[0]).toContain("案件标题");
  });
});
