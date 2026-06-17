import { describe, expect, it } from "vitest";

import { assessCaseQuality } from "../src/case/quality.js";
import { sampleCase } from "./fixtures/sample-case.js";

describe("assessCaseQuality", () => {
  it("样例复杂案件可以通过质量门禁", () => {
    expect(assessCaseQuality(sampleCase)).toEqual([]);
  });

  it("能识别过于简单的案件", () => {
    const weakCase = {
      ...sampleCase,
      suspects: sampleCase.suspects.map((suspect, index) => ({
        ...suspect,
        hides: index === 0 ? suspect.hides : suspect.hides.slice(0, 1),
      })),
      investigationNodes: sampleCase.investigationNodes.map((node) => ({
        ...node,
        category: "object" as const,
        contradictionIds: [],
      })),
      solution: {
        ...sampleCase.solution,
        redHerrings: sampleCase.solution.redHerrings.slice(0, 1),
        hiddenRelationships: sampleCase.solution.hiddenRelationships.slice(0, 1),
        keyContradictions: sampleCase.solution.keyContradictions.slice(0, 2),
      },
    };

    const issues = assessCaseQuality(weakCase);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "category-coverage",
        "missing-timeline-node",
        "missing-relationship-node",
        "missing-scene-or-forensic",
        "contradiction-count",
        "hidden-relationship-count",
        "red-herring-count",
        "non-culprit-secret-count",
        "empty-contradiction-link",
        "contradiction-hint-coverage",
      ]),
    );
  });

  it("可玩模式下可以跳过线索构图深度门禁", () => {
    const playableCase = {
      ...sampleCase,
      investigationNodes: sampleCase.investigationNodes.map((node) => ({
        ...node,
        clueIllustration: undefined,
      })),
    } as unknown as typeof sampleCase;

    const issues = assessCaseQuality(playableCase, { requireClueIllustration: false });
    expect(issues.map((issue) => issue.code)).not.toContain("clue-illustration-depth");
  });
});
