import { randomUUID } from "node:crypto";

import { assessCaseQuality } from "./quality.js";
import {
  formatCaseReviewFeedback,
  isCaseReviewAccepted,
  PLAYABLE_CASE_REVIEW_THRESHOLD,
  reviewCaseQuality,
  STRICT_CASE_REVIEW_THRESHOLD,
  type CaseReview,
  type CaseReviewThreshold,
} from "./reviewer.js";
import { casePackageSchema, type MysteryCase, type TemplateType } from "./schema.js";
import { pickTemplate, type CaseTemplate } from "./templates.js";
import type { StructuredJsonGateway } from "../llm/openai-gateway.js";

function stripGeneratedVisuals(mysteryCase: MysteryCase) {
  return {
    ...mysteryCase,
    sceneSvg: undefined,
    suspects: mysteryCase.suspects.map((suspect) => ({
      ...suspect,
      avatarSvg: undefined,
    })),
    npcs: (mysteryCase.npcs ?? []).map((npc) => ({
      ...npc,
      avatarSvg: undefined,
    })),
    investigationNodes: mysteryCase.investigationNodes.map((node) => ({
      ...node,
      visualSvg: undefined,
    })),
  };
}

function buildSystemPrompt() {
  return [
    "你是一个中文悬疑推理游戏编剧。",
    "你的任务是输出一个严格可解析的 JSON 案件包，用于 CLI 推理游戏。",
    "不要输出 JSON 之外的任何文字。",
    "案件必须逻辑自洽，默认优先写 4 名嫌疑人，只有在故事明显更适合时才降为 3 名。",
    "调查节点全部开局可见，内容需要能支撑玩家推理。",
    "嫌疑人对话必须有发挥空间，因此每个嫌疑人都要明确 knows/hides/speakingStyle。",
    "案件需要具备明显的多层误导、人物遮掩和关键矛盾，不能是一眼看穿的直线型谜题。",
    "整体文风要简洁可玩，不要把每个字段写成大段小说。",
  ].join("\n");
}

function normalizeCaseTitle(title: string) {
  return title.replace(/[^\p{Letter}\p{Number}]+/gu, "").toLowerCase();
}

function formatExistingTitles(existingTitles: string[]) {
  if (!existingTitles.length) {
    return [];
  }

  return [
    "以下案件标题已经存在，这次不要重复，也不要只改一个标点或一个字：",
    existingTitles.slice(0, 20).map((title, index) => `${index + 1}. ${title}`).join("\n"),
  ];
}

type PromptMode = "playable" | "full";

function buildUserPrompt(
  template: CaseTemplate,
  qualityFeedback?: string,
  promptMode: PromptMode = "full",
  existingTitles: string[] = [],
) {
  const extraFeedback = qualityFeedback ? [`上一版案件存在这些问题，请务必修正：`, qualityFeedback] : [];
  const strictMode = promptMode === "full";

  return [
    `请生成一个“${template.label}”模板的悬疑案件。`,
    `模板说明：${template.brief}`,
    `嫌疑人数建议：${template.suspectCountGuidance}`,
    "该模板的复杂度要求：",
    ...template.complexityRules.map((rule, index) => `${index + 1}. ${rule}`),
    ...formatExistingTitles(existingTitles),
    "输出字段必须包括：",
    "id, template, title, openingNarration, publicSummary, playerGoal, victim, suspects, npcs, investigationNodes, solution",
    "其中：",
    "- victim 必须包含 name/profile",
    "- storyContext / sceneVisualSummary / sceneIllustration / appearanceSummary / visualHint / clueIllustration 都不是硬性字段；除非你非常确定能一次写完整，否则宁可省略，由系统回填默认值。",
    "- suspects 中每个人都必须包含 id/name/publicPersona/relationshipToVictim/possibleMotive/alibi/demeanor/speakingStyle/pressurePoint/knows/hides",
    strictMode
      ? "- npcs 至少 1 名，优先 2 名；每个人都必须包含 id/name/publicPersona/relationshipToVictim/whyRelevant/demeanor/speakingStyle/knows/hides"
      : "- npcs 至少 1 名；每个人都必须包含 id/name/publicPersona/relationshipToVictim/whyRelevant/demeanor/speakingStyle/knows/hides",
    "- investigationNodes 中每个节点都必须包含 id/title/category/summary/discovery/contradictionIds，category 只能使用 scene/forensic/relationship/object/timeline 之一",
    "- solution 中必须包含 culpritId/motive/method/truthReveal/culpritPlan/redHerrings/keyContradictions/hiddenRelationships/timeline",
    "- timeline 至少 4 条",
    "- investigationNodes 至少 5 条，优先 6 条",
    "- suspects 的 id 必须能被 solution.culpritId 命中",
    "- culpritPlan 写成 3 到 5 条短步骤，说明真凶如何布置、作案和收尾",
    "- redHerrings 至少 2 条，必须是真正会把玩家带偏的误导，不是废话",
    "- keyContradictions 至少 3 条，每条都要包含 title/summary/implication",
    "- hiddenRelationships 至少 2 条，每条都要包含 surface/hiddenTruth",
    "- 每个 investigationNode 的 contradictionIds 表示该节点推进的相关疑点短语，至少包含 1 项，不要求与 keyContradictions.title 逐字一致，但语义必须对应",
    "- 至少 2 名非真凶嫌疑人也要藏有严重但与谋杀不完全相同的秘密",
    "- NPC 不是凶手候选，但必须能通过聊天补充现场、关系、时间线或人物背景中的至少一种信息",
    "- 至少 1 组人物存在互相包庇、利益绑定或旧案牵连",
    "- 调查节点类别至少覆盖 timeline、relationship，以及 scene 或 forensic 中的一类",
    "- 如果你提供 sceneIllustration，figures 至少 3 个、props 至少 5 个，但标签尽量短，不要写成长段说明",
    "- 如果你提供 visualHint / clueIllustration，只写第一眼能看到的物件、痕迹、位置和构图，保持短句；clueIllustration.items 控制在 2 项即可",
    "- 全部内容用中文",
    "- 不要让真相一眼看穿，但也不要故意玩超自然或无解诡计",
    "- openingNarration 控制在 3 句内",
    "- publicSummary / playerGoal / possibleMotive / alibi / demeanor / speakingStyle / discovery / whyRelevant 尽量 1 到 2 句",
    "- storyContext 的 setting/currentSituation/whyNow 要让玩家知道这是个什么局，以及为什么现在爆发",
    "- pressurePoint 要具体，能体现玩家追问什么会让该嫌疑人动摇，但这个字段是内部用的，不要写成直接剧透凶手",
    "- appearanceSummary 如果要写，控制在 1 句内，突出年龄感、气质、穿着或显眼特征",
    "- visualHint 只写玩家第一眼会看到的画面元素或痕迹，不要直接复述 discovery 里的推理结论；如果写了，优先写物件、位置、状态、痕迹、构图",
    "- knows 和 hides 各写 2 条左右，优先短句",
    strictMode ? "- investigationNodes 优先 5 个，最多 6 个" : "- investigationNodes 控制在 5 到 6 个",
    strictMode ? "- timeline 优先 4 条，最多 5 条" : "- timeline 控制在 4 到 5 条",
    "- truthReveal 控制在 4 句内",
    "- culpritPlan / redHerrings 每一条都尽量压成 1 句",
    "- keyContradictions 的 summary / implication 各控制在 1 句",
    "- hiddenRelationships 的 hiddenTruth 控制在 1 句",
    ...extraFeedback,
    `案件 id 固定写成 ${randomUUID()}`,
    `template 固定写成 ${template.type}`,
  ].join("\n");
}

function buildRevisionPrompt(
  template: CaseTemplate,
  currentCase: MysteryCase,
  feedback: string,
  promptMode: PromptMode = "full",
  existingTitles: string[] = [],
) {
  const strippedCase = stripGeneratedVisuals(currentCase);
  const editableCase =
    promptMode === "playable"
      ? {
          id: strippedCase.id,
          template: strippedCase.template,
          title: strippedCase.title,
          openingNarration: strippedCase.openingNarration,
          publicSummary: strippedCase.publicSummary,
          playerGoal: strippedCase.playerGoal,
          victim: strippedCase.victim,
          suspects: strippedCase.suspects.map((suspect) => ({
            id: suspect.id,
            name: suspect.name,
            publicPersona: suspect.publicPersona,
            relationshipToVictim: suspect.relationshipToVictim,
            possibleMotive: suspect.possibleMotive,
            alibi: suspect.alibi,
            demeanor: suspect.demeanor,
            speakingStyle: suspect.speakingStyle,
            pressurePoint: suspect.pressurePoint,
            knows: suspect.knows,
            hides: suspect.hides,
          })),
          npcs: (strippedCase.npcs ?? []).map((npc) => ({
            id: npc.id,
            name: npc.name,
            publicPersona: npc.publicPersona,
            relationshipToVictim: npc.relationshipToVictim,
            whyRelevant: npc.whyRelevant,
            demeanor: npc.demeanor,
            speakingStyle: npc.speakingStyle,
            knows: npc.knows,
            hides: npc.hides,
          })),
          investigationNodes: strippedCase.investigationNodes.map((node) => ({
            id: node.id,
            title: node.title,
            category: node.category,
            summary: node.summary,
            discovery: node.discovery,
            contradictionIds: node.contradictionIds,
          })),
          solution: strippedCase.solution,
        }
      : strippedCase;

  return [
    `请修订下面这份“${template.label}”案件。`,
    "要求：保留当前案件里已经成立、已经有价值的部分，不要无谓推翻重写；优先按反馈修补逻辑、复杂度、可玩性和结构问题。",
    "输出必须仍然是完整 JSON 案件包，不要输出解释文字。",
    `重点：修订时不要改变 id 和 template；不要删除已经合理存在的角色，除非反馈明确要求；可以补强背景、NPC、误导、矛盾、时间线和 scene${promptMode === "full" ? "/clue illustration" : " illustration"}。优先修正主干推理问题，不要为了补大段视觉子字段把输出拖得过长。`,
    ...formatExistingTitles(existingTitles),
    "当前案件 JSON：",
    JSON.stringify(editableCase),
    "需要修订的问题：",
    feedback,
  ].join("\n");
}

export type CaseGenerationDiagnostics = {
  attemptCount: number;
  deterministicFeedback: string[];
  review?: CaseReview;
};

export type GeneratedCaseResult = {
  mysteryCase: MysteryCase;
  diagnostics: CaseGenerationDiagnostics;
};

export type GenerationProgressEvent = {
  phase: string;
  message: string;
  attempt: number;
  totalAttempts: number;
};

export type CaseGenerationOptions = {
  maxAttempts?: number;
  reviewThreshold?: CaseReviewThreshold;
  acceptLastAttemptIfDeterministicPasses?: boolean;
  promptMode?: PromptMode;
  requireClueIllustrationGate?: boolean;
  existingTitles?: string[];
  onProgress?: (event: GenerationProgressEvent) => void | Promise<void>;
};

async function reportProgress(options: CaseGenerationOptions, event: GenerationProgressEvent) {
  await options.onProgress?.(event);
}

export async function generateCasePackageWithDiagnostics(
  gateway: StructuredJsonGateway,
  templateType?: TemplateType,
  reviewGateway: StructuredJsonGateway = gateway,
  options: CaseGenerationOptions = {},
): Promise<GeneratedCaseResult> {
  const template = pickTemplate(templateType);
  let qualityFeedback = "";
  let lastError: Error | null = null;
  let lastReview: CaseReview | undefined;
  const feedbackHistory: string[] = [];
  const maxAttempts = options.maxAttempts ?? 5;
  const reviewThreshold = options.reviewThreshold ?? STRICT_CASE_REVIEW_THRESHOLD;
  const promptMode = options.promptMode ?? "full";
  const requireClueIllustrationGate = options.requireClueIllustrationGate ?? promptMode === "full";
  const generationMaxTokens = promptMode === "full" ? 6500 : 3200;
  const existingTitles = Array.from(new Set((options.existingTitles ?? []).map((title) => title.trim()).filter(Boolean)));
  const existingTitleMap = new Map(existingTitles.map((title) => [normalizeCaseTitle(title), title]));
  let currentCase: MysteryCase | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await reportProgress(options, {
      phase: currentCase === null ? "draft" : "revision",
      message: currentCase === null ? `正在生成案件初稿（第 ${attempt}/${maxAttempts} 轮）...` : `正在根据反馈修订案件（第 ${attempt}/${maxAttempts} 轮）...`,
      attempt,
      totalAttempts: maxAttempts,
    });

    const candidate: MysteryCase =
      currentCase === null
        ? await gateway.completeJson(
            buildSystemPrompt(),
            buildUserPrompt(template, qualityFeedback, promptMode, existingTitles),
            casePackageSchema,
            generationMaxTokens,
          )
        : await gateway.completeJson(
            buildSystemPrompt(),
            buildRevisionPrompt(template, currentCase, qualityFeedback, promptMode, existingTitles),
            casePackageSchema,
            generationMaxTokens,
          );

    currentCase = candidate;

    const duplicateTitle = existingTitleMap.get(normalizeCaseTitle(candidate.title));
    if (duplicateTitle) {
      qualityFeedback = `案件标题“${candidate.title}”与已有案件《${duplicateTitle}》重复，请改成一个全新的标题。`;
      feedbackHistory.push(qualityFeedback);
      lastError = new Error(`案件标题重复：${qualityFeedback}`);

      await reportProgress(options, {
        phase: "quality-failed",
        message: `案件标题重复，正在准备修订：${candidate.title}`,
        attempt,
        totalAttempts: maxAttempts,
      });
      continue;
    }

    await reportProgress(options, {
      phase: "quality-check",
      message: `正在检查案件结构和复杂度（第 ${attempt}/${maxAttempts} 轮）...`,
      attempt,
      totalAttempts: maxAttempts,
    });

    const issues = assessCaseQuality(candidate, {
      requireClueIllustration: requireClueIllustrationGate,
    });

    if (issues.length > 0) {
      qualityFeedback = issues.map((issue, index) => `${index + 1}. ${issue.message}`).join("\n");
      feedbackHistory.push(qualityFeedback);
      lastError = new Error(`案件复杂度校验未通过：${qualityFeedback}`);

      await reportProgress(options, {
        phase: "quality-failed",
        message: `案件门禁未通过，正在准备修订：${issues[0]?.message ?? "存在若干问题"}`,
        attempt,
        totalAttempts: maxAttempts,
      });
      continue;
    }

    await reportProgress(options, {
      phase: "review",
      message: `正在让评审模型给案件打分（第 ${attempt}/${maxAttempts} 轮）...`,
      attempt,
      totalAttempts: maxAttempts,
    });

    const review = await reviewCaseQuality(reviewGateway, candidate);
    lastReview = review;

    if (isCaseReviewAccepted(review, reviewThreshold)) {
      await reportProgress(options, {
        phase: "accepted",
        message: `案件通过评审，整体分 ${review.overallScore}，正在收尾...`,
        attempt,
        totalAttempts: maxAttempts,
      });

      return {
        mysteryCase: candidate,
        diagnostics: {
          attemptCount: attempt,
          deterministicFeedback: feedbackHistory,
          review,
        },
      };
    }

    if (attempt === maxAttempts && options.acceptLastAttemptIfDeterministicPasses) {
      await reportProgress(options, {
        phase: "accepted-last-attempt",
        message: `案件达到可玩标准，虽然评审分只有 ${review.overallScore}，但已允许直接进入试玩。`,
        attempt,
        totalAttempts: maxAttempts,
      });

      return {
        mysteryCase: candidate,
        diagnostics: {
          attemptCount: attempt,
          deterministicFeedback: feedbackHistory,
          review,
        },
      };
    }

    qualityFeedback = formatCaseReviewFeedback(review);
    feedbackHistory.push(qualityFeedback);
    lastError = new Error(`案件模型评审未通过：${qualityFeedback}`);

    await reportProgress(options, {
      phase: "review-failed",
      message: `评审分 ${review.overallScore}，准备按建议继续修订...`,
      attempt,
      totalAttempts: maxAttempts,
    });
  }

  if (lastReview) {
    throw new Error(`案件生成失败，最终评审未通过：${formatCaseReviewFeedback(lastReview)}`);
  }

  throw lastError ?? new Error("案件生成失败。");
}

export async function generateCasePackage(
  gateway: StructuredJsonGateway,
  templateType?: TemplateType,
  reviewGateway: StructuredJsonGateway = gateway,
  options: CaseGenerationOptions = {},
): Promise<MysteryCase> {
  const result = await generateCasePackageWithDiagnostics(gateway, templateType, reviewGateway, options);
  return result.mysteryCase;
}

export const PLAYABLE_CASE_GENERATION_OPTIONS: CaseGenerationOptions = {
  maxAttempts: 3,
  reviewThreshold: PLAYABLE_CASE_REVIEW_THRESHOLD,
  acceptLastAttemptIfDeterministicPasses: true,
  promptMode: "playable",
};

export const STRICT_CASE_GENERATION_OPTIONS: CaseGenerationOptions = {
  maxAttempts: 5,
  reviewThreshold: STRICT_CASE_REVIEW_THRESHOLD,
  acceptLastAttemptIfDeterministicPasses: false,
  promptMode: "playable",
  requireClueIllustrationGate: true,
};
