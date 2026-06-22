import { z } from "zod";

import type { InvestigationNode, MysteryCase } from "../case/schema.js";
import type { StructuredJsonGateway } from "../llm/openai-gateway.js";

export type DeductionEvaluation = {
  score: number;
  verdict: string;
  hitPoints: string[];
  missedPoints: string[];
  feedback: string;
};

export type JudgementResult = {
  correct: boolean;
  culpritName: string;
  accusedName: string;
  summary: string;
  truthReveal: string;
  culpritPlan: string[];
  redHerrings: string[];
  keyContradictions: Array<{ title: string; summary: string; implication: string }>;
  hiddenRelationships: Array<{ surface: string; hiddenTruth: string }>;
  deduction?: DeductionEvaluation;
  consequence?: string;
};

function buildJudgementResult(mysteryCase: MysteryCase, accusedName: string, correct: boolean, summary: string): JudgementResult {
  const culprit = mysteryCase.suspects.find((suspect) => suspect.id === mysteryCase.solution.culpritId);

  if (!culprit) {
    throw new Error("真凶信息不存在。");
  }

  return {
    correct,
    culpritName: culprit.name,
    accusedName,
    summary,
    truthReveal: mysteryCase.solution.truthReveal,
    culpritPlan: mysteryCase.solution.culpritPlan,
    redHerrings: mysteryCase.solution.redHerrings,
    keyContradictions: mysteryCase.solution.keyContradictions,
    hiddenRelationships: mysteryCase.solution.hiddenRelationships,
  };
}

export function judgeAccusation(mysteryCase: MysteryCase, accusedSuspectId: string): JudgementResult {
  const culprit = mysteryCase.suspects.find((suspect) => suspect.id === mysteryCase.solution.culpritId);
  const accused = mysteryCase.suspects.find((suspect) => suspect.id === accusedSuspectId);

  if (!culprit || !accused) {
    throw new Error("指认结果无法匹配到嫌疑人。",);
  }

  const correct = culprit.id === accused.id;

  return buildJudgementResult(
    mysteryCase,
    accused.name,
    correct,
    correct ? `你指认正确，真凶就是 ${culprit.name}。` : `你指认的是 ${accused.name}，但真凶其实是 ${culprit.name}。`,
  );
}

export function revealSolution(mysteryCase: MysteryCase): JudgementResult {
  const culprit = mysteryCase.suspects.find((suspect) => suspect.id === mysteryCase.solution.culpritId);

  if (!culprit) {
    throw new Error("真凶信息不存在。");
  }

  return buildJudgementResult(mysteryCase, culprit.name, true, `已直接查看答案，真凶是 ${culprit.name}。`);
}

const accusationEvaluationSchema = z.object({
  score: z.coerce.number(),
  verdict: z.string().min(1),
  hitPoints: z.array(z.string()).default([]),
  missedPoints: z.array(z.string()).default([]),
  feedback: z.string().min(1),
  consequence: z.string().min(1),
});

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildEvaluationSystemPrompt(): string {
  return [
    "你是一个中文悬疑推理游戏的结案裁判兼旁白。",
    "你会拿到案件的完整真相、玩家指认了谁、玩家的推理理由，以及玩家引用的线索。",
    "你的任务有两个：",
    "1. 给玩家的推理打分并点评（对照真相里的关键矛盾、作案手法、隐藏关系来判断玩家是否真的推到了点子上）。",
    "2. 生成一段简短的结局旁白（结案后果）。",
    "严格输出 JSON，不要输出 JSON 之外的任何文字。",
  ].join("\n");
}

function buildEvaluationUserPrompt(
  mysteryCase: MysteryCase,
  accusedName: string,
  correct: boolean,
  reasoning: string,
  citedNodes: InvestigationNode[],
): string {
  const culprit = mysteryCase.suspects.find((suspect) => suspect.id === mysteryCase.solution.culpritId);

  return [
    `案件标题：${mysteryCase.title}`,
    `真凶：${culprit?.name ?? mysteryCase.solution.culpritId}`,
    `真实动机：${mysteryCase.solution.motive}`,
    `作案手法：${mysteryCase.solution.method}`,
    `作案计划：${mysteryCase.solution.culpritPlan.join("；")}`,
    `关键矛盾：${mysteryCase.solution.keyContradictions.map((item) => `${item.title}（${item.implication}）`).join("；")}`,
    `隐藏关系：${mysteryCase.solution.hiddenRelationships.map((item) => `${item.surface} → ${item.hiddenTruth}`).join("；")}`,
    `误导点（红鲱鱼）：${mysteryCase.solution.redHerrings.join("；")}`,
    "",
    `玩家指认的人：${accusedName}`,
    `玩家指认是否正确：${correct ? "正确" : "错误"}`,
    `玩家写下的推理：${reasoning.trim() || "（玩家没有写推理）"}`,
    `玩家引用的线索：${citedNodes.length ? citedNodes.map((node) => `${node.title}：${node.discovery}`).join("；") : "（玩家没有引用任何线索）"}`,
    "",
    "请按下面要求输出 JSON：",
    "- score：0 到 100 的整数，衡量玩家推理的质量。指认错误时分数要明显偏低（因为核心结论错了），但可以为命中的局部推理保留少量分；指认正确且能讲清关键矛盾/手法/隐藏关系才接近满分；指认正确但理由空洞只能给中等分。",
    "- verdict：一句话总评，例如“证据扎实，推理到位”或“蒙对了人，但没说清为什么”。",
    "- hitPoints：玩家确实推到的关键点（数组，可为空），尽量对应关键矛盾/手法/隐藏关系。",
    "- missedPoints：玩家漏掉或弄错的关键点（数组，可为空）。",
    "- feedback：1 到 3 句具体点评，告诉玩家哪里推对了、哪里还差。",
    `- consequence：一段 2 到 4 句的结局旁白，用第三人称叙事。${correct ? "玩家指认正确，写真凶落网、案件了结的收尾，可带一点余味。" : "玩家指认错误，写出错误指认带来的后果，例如真凶趁机脱身、被冤者蒙受不白之冤、案件陷入僵局等，要有戏剧张力。"}不要在 consequence 里直接说出“你的得分是多少”。`,
    "- 全部用中文。",
  ].join("\n");
}

export async function evaluateAccusation(
  gateway: StructuredJsonGateway,
  mysteryCase: MysteryCase,
  accusedSuspectId: string,
  reasoning: string,
  citedNodes: InvestigationNode[],
): Promise<{ deduction: DeductionEvaluation; consequence: string }> {
  const accused = mysteryCase.suspects.find((suspect) => suspect.id === accusedSuspectId);
  if (!accused) {
    throw new Error("指认结果无法匹配到嫌疑人。");
  }

  const correct = mysteryCase.solution.culpritId === accused.id;
  const parsed = await gateway.completeJson(
    buildEvaluationSystemPrompt(),
    buildEvaluationUserPrompt(mysteryCase, accused.name, correct, reasoning, citedNodes),
    accusationEvaluationSchema,
    1500,
  );

  return {
    deduction: {
      score: clampScore(parsed.score),
      verdict: parsed.verdict.trim(),
      hitPoints: parsed.hitPoints.map((item) => item.trim()).filter(Boolean),
      missedPoints: parsed.missedPoints.map((item) => item.trim()).filter(Boolean),
      feedback: parsed.feedback.trim(),
    },
    consequence: parsed.consequence.trim(),
  };
}

export function buildFallbackConsequence(mysteryCase: MysteryCase, accusedSuspectId: string): string {
  const culprit = mysteryCase.suspects.find((suspect) => suspect.id === mysteryCase.solution.culpritId);
  const accused = mysteryCase.suspects.find((suspect) => suspect.id === accusedSuspectId);
  const culpritName = culprit?.name ?? "真凶";

  if (accused && accused.id === mysteryCase.solution.culpritId) {
    return `${culpritName}被当场指认，再难抵赖，案件就此了结。`;
  }

  return `指认落在了${accused?.name ?? "错误的人"}身上，真正的${culpritName}趁机抽身离场，这桩案子又一次陷入迷雾。`;
}
