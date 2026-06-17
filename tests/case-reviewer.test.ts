import { describe, expect, it } from "vitest";

import { formatCaseReviewFeedback, isCaseReviewAccepted, type CaseReview } from "../src/case/reviewer.js";

const strongReview: CaseReview = {
  overallScore: 84,
  dimensionScores: {
    coherence: 8,
    complexity: 8,
    fairness: 8,
    suspectEntanglement: 8,
    investigationValue: 8,
    dialogueTension: 8,
  },
  strengths: ["人物关系互相牵制", "调查节点能承接关键矛盾"],
  weaknesses: ["个别误导还可以更隐蔽"],
  revisionAdvice: ["让其中一名非真凶的秘密再晚一点暴露"],
  criticalIssues: [],
};

describe("case reviewer helpers", () => {
  it("能判断评审是否达标", () => {
    expect(isCaseReviewAccepted(strongReview)).toBe(true);
    expect(
      isCaseReviewAccepted({
        ...strongReview,
        dimensionScores: {
          ...strongReview.dimensionScores,
          fairness: 6,
        },
      }),
    ).toBe(false);
  });

  it("能格式化评审反馈", () => {
    const feedback = formatCaseReviewFeedback(strongReview);
    expect(feedback).toContain("整体分：84");
    expect(feedback).toContain("主要弱点");
  });
});
