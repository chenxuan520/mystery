import type { MysteryCase } from "../case/schema.js";

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
