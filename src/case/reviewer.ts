import { z } from "zod";

import type { StructuredJsonGateway } from "../llm/openai-gateway.js";
import type { MysteryCase } from "./schema.js";

const numericScoreSchema = z.number().int().min(0).max(10);

const caseReviewSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object") {
    return input;
  }

  const raw = input as Record<string, unknown>;
  const dimensionScores =
    raw.dimensionScores && typeof raw.dimensionScores === "object"
      ? raw.dimensionScores
      : {
          coherence: raw.coherence,
          complexity: raw.complexity,
          fairness: raw.fairness,
          suspectEntanglement: raw.suspectEntanglement,
          investigationValue: raw.investigationValue,
          dialogueTension: raw.dialogueTension,
        };

  return {
    ...raw,
    dimensionScores,
    revisionAdvice: raw.revisionAdvice ?? raw.weaknesses,
    criticalIssues: raw.criticalIssues ?? [],
  };
},
z.object({
  overallScore: z.number().int().min(0).max(100),
  dimensionScores: z.object({
    coherence: numericScoreSchema,
    complexity: numericScoreSchema,
    fairness: numericScoreSchema,
    suspectEntanglement: numericScoreSchema,
    investigationValue: numericScoreSchema,
    dialogueTension: numericScoreSchema,
  }),
  strengths: z.array(z.string().min(1)).min(2).max(5),
  weaknesses: z.array(z.string().min(1)).min(1).max(5),
  revisionAdvice: z.array(z.string().min(1)).min(1).max(5),
  criticalIssues: z.array(z.string().min(1)).max(4).default([]),
}));

export type CaseReview = z.infer<typeof caseReviewSchema>;

export type CaseReviewThreshold = {
  overallScore: number;
  complexity: number;
  fairness: number;
  investigationValue: number;
  dialogueTension: number;
};

export const STRICT_CASE_REVIEW_THRESHOLD: CaseReviewThreshold = {
  overallScore: 80,
  complexity: 7,
  fairness: 7,
  investigationValue: 7,
  dialogueTension: 7,
};

export const PLAYABLE_CASE_REVIEW_THRESHOLD: CaseReviewThreshold = {
  overallScore: 72,
  complexity: 6,
  fairness: 6,
  investigationValue: 6,
  dialogueTension: 6,
};

function buildReviewSystemPrompt() {
  return [
    "你是一个非常严格的中文悬疑推理游戏编辑。",
    "你的任务不是改写案件，而是评审案件是否足够复杂、可推理、可对话、可游玩。",
    "请只输出 JSON。",
    "评分时宁严勿松，不要因为文笔流畅就给高分。",
    "重点检查：时间线是否咬合、误导是否有效、非真凶是否也有强秘密、调查节点是否真的推动推理、嫌疑人和 NPC 是否都能通过对话给玩家带来信息价值、背景是否足够让玩家快速进入局面。",
  ].join("\n");
}

function buildReviewPrompt(mysteryCase: MysteryCase) {
  const reviewPayload = {
    title: mysteryCase.title,
    template: mysteryCase.template,
    publicSummary: mysteryCase.publicSummary,
    playerGoal: mysteryCase.playerGoal,
    storyContext: mysteryCase.storyContext,
    sceneVisualSummary: mysteryCase.sceneVisualSummary,
    victim: mysteryCase.victim,
    suspects: mysteryCase.suspects.map((suspect) => ({
      name: suspect.name,
      relationshipToVictim: suspect.relationshipToVictim,
      possibleMotive: suspect.possibleMotive,
      alibi: suspect.alibi,
      pressurePoint: suspect.pressurePoint,
      knows: suspect.knows,
      hides: suspect.hides,
    })),
    npcs: (mysteryCase.npcs ?? []).map((npc) => ({
      name: npc.name,
      relationshipToVictim: npc.relationshipToVictim,
      whyRelevant: npc.whyRelevant,
      knows: npc.knows,
      hides: npc.hides,
    })),
    investigationNodes: mysteryCase.investigationNodes.map((node) => ({
      title: node.title,
      category: node.category,
      discovery: node.discovery,
      visualHint: node.visualHint,
      contradictionIds: node.contradictionIds,
    })),
    solution: {
      culpritId: mysteryCase.solution.culpritId,
      motive: mysteryCase.solution.motive,
      method: mysteryCase.solution.method,
      culpritPlan: mysteryCase.solution.culpritPlan,
      redHerrings: mysteryCase.solution.redHerrings,
      keyContradictions: mysteryCase.solution.keyContradictions,
      hiddenRelationships: mysteryCase.solution.hiddenRelationships,
      timeline: mysteryCase.solution.timeline,
    },
  };

  return [
    "请评审下面这份案件包，并给出结构化评分。",
    "严格按这个 JSON 结构输出，不要省略字段：",
    JSON.stringify({
      overallScore: 82,
      dimensionScores: {
        coherence: 8,
        complexity: 8,
        fairness: 8,
        suspectEntanglement: 8,
        investigationValue: 8,
        dialogueTension: 8,
      },
      strengths: ["优点1", "优点2"],
      weaknesses: ["缺点1"],
      revisionAdvice: ["建议1"],
      criticalIssues: [],
    }),
    "评分说明：",
    "- coherence：前后逻辑、自洽程度",
    "- complexity：多层误导、遮掩、反转与非线性程度",
    "- fairness：线索是否公平、不是纯靠作者揭底",
    "- suspectEntanglement：嫌疑人之间是否有互相牵制、包庇或利益关系",
    "- investigationValue：调查节点是否真的推动玩家排除与锁定",
    "- dialogueTension：嫌疑人是否有足够秘密和压力点支撑逼问",
    "通过标准建议：overallScore >= 80，且 complexity/fairness/dialogueTension 至少 7。",
    "criticalIssues 只写真正会破坏可玩性的硬伤。",
    "案件 JSON 如下：",
    JSON.stringify(reviewPayload),
  ].join("\n");
}

export function isCaseReviewAccepted(review: CaseReview, threshold: CaseReviewThreshold = STRICT_CASE_REVIEW_THRESHOLD): boolean {
  return (
    review.overallScore >= threshold.overallScore &&
    review.dimensionScores.complexity >= threshold.complexity &&
    review.dimensionScores.fairness >= threshold.fairness &&
    review.dimensionScores.dialogueTension >= threshold.dialogueTension &&
    review.dimensionScores.investigationValue >= threshold.investigationValue &&
    review.criticalIssues.length === 0
  );
}

export function formatCaseReviewFeedback(review: CaseReview): string {
  const lines = [
    `整体分：${review.overallScore}`,
    `复杂度：${review.dimensionScores.complexity}/10`,
    `公平性：${review.dimensionScores.fairness}/10`,
    `调查价值：${review.dimensionScores.investigationValue}/10`,
    `对话张力：${review.dimensionScores.dialogueTension}/10`,
  ];

  if (review.criticalIssues.length > 0) {
    lines.push(`硬伤：${review.criticalIssues.join("；")}`);
  }

  lines.push(`主要弱点：${review.weaknesses.join("；")}`);
  lines.push(`修改建议：${review.revisionAdvice.join("；")}`);
  return lines.join("\n");
}

export async function reviewCaseQuality(gateway: StructuredJsonGateway, mysteryCase: MysteryCase): Promise<CaseReview> {
  return gateway.completeJson(buildReviewSystemPrompt(), buildReviewPrompt(mysteryCase), caseReviewSchema, 1400);
}
