import type { MysteryCase } from "./schema.js";

export type CaseQualityIssue = {
  code: string;
  message: string;
};

export type CaseQualityOptions = {
  requireClueIllustration?: boolean;
};

export function assessCaseQuality(mysteryCase: MysteryCase, options: CaseQualityOptions = {}): CaseQualityIssue[] {
  const issues: CaseQualityIssue[] = [];
  const requireClueIllustration = options.requireClueIllustration ?? true;
  const culpritId = mysteryCase.solution.culpritId;
  const categories = new Set(mysteryCase.investigationNodes.map((node) => node.category));
  const nonCulprits = mysteryCase.suspects.filter((suspect) => suspect.id !== culpritId);
  const distinctHintCount = new Set(mysteryCase.investigationNodes.flatMap((node) => node.contradictionIds)).size;
  const npcCount = mysteryCase.npcs?.length ?? 0;

  if (mysteryCase.suspects.length < 4) {
    issues.push({
      code: "suspect-count",
      message: "当前案件嫌疑人少于 4 人，复杂度不够。",
    });
  }

  if (categories.size < 4) {
    issues.push({
      code: "category-coverage",
      message: "调查节点类别至少应覆盖 4 种，避免线索类型过于单一。",
    });
  }

  if (!categories.has("timeline")) {
    issues.push({
      code: "missing-timeline-node",
      message: "至少需要 1 个时间线类调查节点。",
    });
  }

  if (!categories.has("relationship")) {
    issues.push({
      code: "missing-relationship-node",
      message: "至少需要 1 个人际/口供类调查节点。",
    });
  }

  if (!categories.has("scene") && !categories.has("forensic")) {
    issues.push({
      code: "missing-scene-or-forensic",
      message: "至少需要 1 个现场或检验类调查节点。",
    });
  }

  if (mysteryCase.solution.keyContradictions.length < 3) {
    issues.push({
      code: "contradiction-count",
      message: "关键矛盾少于 3 条，推理层次不够。",
    });
  }

  if (mysteryCase.solution.hiddenRelationships.length < 2) {
    issues.push({
      code: "hidden-relationship-count",
      message: "隐藏关系少于 2 组，人物纠葛偏弱。",
    });
  }

  if (mysteryCase.solution.redHerrings.length < 2) {
    issues.push({
      code: "red-herring-count",
      message: "误导点少于 2 条，案件容易过于直线。",
    });
  }

  if (nonCulprits.filter((suspect) => suspect.hides.length >= 2).length < 2) {
    issues.push({
      code: "non-culprit-secret-count",
      message: "至少应有 2 名非真凶嫌疑人各自隐藏 2 条秘密，以制造更强误导。",
    });
  }

  if (mysteryCase.investigationNodes.some((node) => node.contradictionIds.length === 0)) {
    issues.push({
      code: "empty-contradiction-link",
      message: "每个调查节点都应推动至少一个关键疑点。",
    });
  }

  if (distinctHintCount < 3) {
    issues.push({
      code: "contradiction-hint-coverage",
      message: "调查节点推动的相关疑点过少，推理推进感不够。",
    });
  }

  if (npcCount < 1) {
    issues.push({
      code: "npc-count",
      message: "至少需要 1 名非嫌疑 NPC，通过对话补充背景或线索。",
    });
  }

  if (!mysteryCase.storyContext || mysteryCase.storyContext.knownTensions.length < 3) {
    issues.push({
      code: "story-context-depth",
      message: "案件背景信息不足，玩家很难快速理解局面。",
    });
  }

  if (!mysteryCase.sceneVisualSummary?.trim()) {
    issues.push({
      code: "scene-visual-summary",
      message: "缺少案发场景视觉描述，后续难以生成场景图。",
    });
  }

  if (!mysteryCase.sceneIllustration || mysteryCase.sceneIllustration.figures.length < 3 || mysteryCase.sceneIllustration.props.length < 5) {
    issues.push({
      code: "scene-illustration-depth",
      message: "现场构图信息不够具体，难以生成有位置关系的案发场景图。",
    });
  }

  if (mysteryCase.investigationNodes.some((node) => !node.visualHint?.trim())) {
    issues.push({
      code: "clue-visual-hint",
      message: "至少有一个调查节点缺少可用于生成线索 SVG 的视觉提示。",
    });
  }

  if (
    requireClueIllustration &&
    mysteryCase.investigationNodes.some((node) => !node.clueIllustration || node.clueIllustration.items.length < 2)
  ) {
    issues.push({
      code: "clue-illustration-depth",
      message: "至少有一个调查节点缺少足够具体的线索构图信息。",
    });
  }

  return issues;
}
