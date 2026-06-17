import { describe, expect, it } from "vitest";

import { judgeAccusation, revealSolution } from "../src/judgement/judge.js";
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
