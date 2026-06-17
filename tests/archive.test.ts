import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { archiveApprovedCase, listArchivedCases, loadArchivedCase } from "../src/archive/story-archive.js";
import { sampleCase } from "./fixtures/sample-case.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("story archive", () => {
  it("可以归档并重新载入合格案件", () => {
    const dir = mkdtempSync(join(tmpdir(), "mystery-archive-"));
    tempDirs.push(dir);

    const archivePath = archiveApprovedCase(
      {
        archiveId: "archive_demo_1",
        archivedAt: "2026-06-17T13:30:00.000Z",
        source: {
          model: "gpt-test",
          reviewModel: "gpt-review",
          structuredOutputMode: "json_object",
        },
        review: {
          overallScore: 85,
          dimensionScores: {
            coherence: 8,
            complexity: 8,
            fairness: 8,
            suspectEntanglement: 8,
            investigationValue: 8,
            dialogueTension: 8,
          },
          strengths: ["优点一", "优点二"],
          weaknesses: ["缺点一"],
          revisionAdvice: ["建议一"],
          criticalIssues: [],
        },
        mysteryCase: sampleCase,
      },
      dir,
    );

    const summaries = listArchivedCases(dir);
    const loaded = loadArchivedCase(archivePath);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.overallScore).toBe(85);
    expect(loaded.mysteryCase.title).toBe(sampleCase.title);
  });
});
