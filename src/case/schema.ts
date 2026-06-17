import { z } from "zod";

import { applyCaseVisuals } from "./visuals.js";

export const templateTypeSchema = z.enum([
  "locked-room",
  "alibi",
  "poison",
  "staged-suicide",
  "inheritance",
  "body-relocation",
  "blackmail",
  "cold-case",
  "identity-fraud",
]);

const categorySchema = z.enum(["scene", "forensic", "relationship", "object", "timeline"]);

function normalizeStringList(value: string | string[]) {
  return Array.isArray(value) ? value : [value];
}

function normalizeLooseStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  return [];
}

function normalizeComparableText(value: string) {
  return value
    .replace(/最值得被视觉化的是[:：]?/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .toLowerCase();
}

function isVisualHintTooCloseToDiscovery(visualHint: string | undefined, discovery: string) {
  if (!visualHint?.trim()) {
    return true;
  }

  const normalizedHint = normalizeComparableText(visualHint);
  const normalizedDiscovery = normalizeComparableText(discovery);
  return (
    normalizedHint === normalizedDiscovery ||
    normalizedHint.includes(normalizedDiscovery) ||
    normalizedDiscovery.includes(normalizedHint)
  );
}

function buildVisualHintFallback(node: {
  summary: string;
  clueIllustration?: {
    items: Array<{
      label: string;
    }>;
  };
}) {
  const labels = Array.from(new Set((node.clueIllustration?.items ?? []).map((item) => item.label.trim()).filter(Boolean)));
  if (labels.length >= 2) {
    return `第一眼会先注意到 ${labels.slice(0, 3).join("、")}。`;
  }

  return node.summary;
}

function buildClueIllustrationFallback(node: {
  title: string;
  category: string;
  summary: string;
  discovery: string;
  contradictionIds: string[];
}, visualHint: string) {
  const secondaryLabel = node.contradictionIds[0] ?? "关键痕迹";

  return {
    focusLabel: node.title,
    focusKind: node.category,
    composition: visualHint,
    items: [
      {
        label: node.title,
        kind: node.category,
        emphasis: node.summary,
        position: { x: 36, y: 48 },
      },
      {
        label: secondaryLabel,
        kind: "evidence",
        emphasis: node.discovery,
        position: { x: 68, y: 60 },
      },
    ],
  };
}

function hasPointShape(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { x?: unknown }).x === "number" &&
      typeof (value as { y?: unknown }).y === "number",
  );
}

function sanitizeSceneIllustrationInput(input: unknown) {
  if (!input || typeof input !== "object") {
    return input;
  }

  const value = input as Record<string, unknown>;
  if (
    typeof value.locationLabel !== "string" ||
    typeof value.atmosphere !== "string" ||
    typeof value.focusCaption !== "string" ||
    !Array.isArray(value.figures) ||
    !Array.isArray(value.props)
  ) {
    return undefined;
  }

  const figuresValid = value.figures.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { label?: unknown }).label === "string" &&
      typeof (item as { role?: unknown }).role === "string" &&
      hasPointShape((item as { position?: unknown }).position) &&
      typeof (item as { pose?: unknown }).pose === "string" &&
      typeof (item as { expression?: unknown }).expression === "string",
  );

  const propsValid = value.props.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { label?: unknown }).label === "string" &&
      typeof (item as { kind?: unknown }).kind === "string" &&
      hasPointShape((item as { position?: unknown }).position) &&
      typeof (item as { size?: unknown }).size === "string" &&
      typeof (item as { detail?: unknown }).detail === "string",
  );

  return figuresValid && propsValid ? input : undefined;
}

function sanitizeClueIllustrationInput(input: unknown) {
  if (!input || typeof input !== "object") {
    return input;
  }

  const value = input as Record<string, unknown>;
  if (
    typeof value.focusLabel !== "string" ||
    typeof value.focusKind !== "string" ||
    typeof value.composition !== "string" ||
    !Array.isArray(value.items)
  ) {
    return undefined;
  }

  const itemsValid = value.items.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { label?: unknown }).label === "string" &&
      typeof (item as { kind?: unknown }).kind === "string" &&
      typeof (item as { emphasis?: unknown }).emphasis === "string" &&
      hasPointShape((item as { position?: unknown }).position),
  );

  return itemsValid ? input : undefined;
}

function normalizeSceneFigureRole(value: string) {
  if (value === "victim" || value === "suspect" || value === "npc") {
    return value;
  }

  if (value.includes("死者") || value.includes("受害者")) {
    return "victim";
  }

  if (value.includes("npc") || value.includes("相关人物") || value.includes("目击") || value.includes("证人") || value.includes("发现人")) {
    return "npc";
  }

  return "suspect";
}

function normalizeCategory(value: string): z.infer<typeof categorySchema> {
  if (categorySchema.safeParse(value).success) {
    return value as z.infer<typeof categorySchema>;
  }

  if (value.includes("监控") || value.includes("门禁") || value.includes("时间") || value.includes("配电") || value.includes("记录")) {
    return "timeline";
  }

  if (value.includes("现场") || value.includes("房间") || value.includes("地点")) {
    return "scene";
  }

  if (value.includes("法医") || value.includes("尸检") || value.includes("检验") || value.includes("药") || value.includes("毒")) {
    return "forensic";
  }

  if (value.includes("关系") || value.includes("口供") || value.includes("争执") || value.includes("证词") || value.includes("访谈")) {
    return "relationship";
  }

  return "object";
}

function normalizeTimelineItem(item: string | { time: string; event: string }, index: number) {
  if (typeof item !== "string") {
    return item;
  }

  const trimmed = item.trim();
  const colonMatch = trimmed.match(/^([^：:]{1,16})[：:](.+)$/u);
  if (colonMatch) {
    return {
      time: colonMatch[1]!.trim(),
      event: colonMatch[2]!.trim(),
    };
  }

  return {
    time: `阶段${index + 1}`,
    event: trimmed,
  };
}

function clampArray<T>(items: T[], max: number): T[] {
  return items.length > max ? items.slice(0, max) : items;
}

function normalizeReference(input: string): string {
  return input.replace(/[^\p{Letter}\p{Number}]+/gu, "").toLowerCase();
}

function resolveContradictionReference(reference: string, titles: string[]): string | undefined {
  if (titles.includes(reference)) {
    return reference;
  }

  const normalizedReference = normalizeReference(reference);
  const normalizedEntries = titles.map((title) => ({ title, normalized: normalizeReference(title) }));

  const exactNormalized = normalizedEntries.find((entry) => entry.normalized === normalizedReference);
  if (exactNormalized) {
    return exactNormalized.title;
  }

  const fuzzy = normalizedEntries.find(
    (entry) => entry.normalized.includes(normalizedReference) || normalizedReference.includes(entry.normalized),
  );

  return fuzzy?.title;
}

const contradictionSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  implication: z.string().min(1),
});

const hiddenRelationshipSchema = z.object({
  surface: z.string().min(1),
  hiddenTruth: z.string().min(1),
});

const storyContextSchema = z.object({
  setting: z.string().min(1),
  currentSituation: z.string().min(1),
  whyNow: z.string().min(1),
  knownTensions: z.array(z.string().min(1)).min(3).max(5),
});

const pointSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});

const sceneFigureSchema = z.object({
  characterId: z.string().min(1).optional(),
  label: z.string().min(1),
  role: z.string().min(1).transform(normalizeSceneFigureRole).pipe(z.enum(["victim", "suspect", "npc"])),
  position: pointSchema,
  pose: z.string().min(1),
  expression: z.string().min(1),
});

const scenePropSchema = z.object({
  label: z.string().min(1),
  kind: z.string().min(1),
  position: pointSchema,
  size: z.enum(["small", "medium", "large"]),
  detail: z.string().min(1),
});

const sceneIllustrationSchema = z.preprocess(
  sanitizeSceneIllustrationInput,
  z
    .object({
      locationLabel: z.string().min(1),
      atmosphere: z.string().min(1),
      focusCaption: z.string().min(1),
      figures: z.array(sceneFigureSchema).min(1).max(6),
      props: z.array(scenePropSchema).min(4).max(10),
    })
    .optional(),
);

const svgStringSchema = z.string().min(1);

const characterVisualSchema = z.object({
  avatarSvg: svgStringSchema.optional(),
});

const clueVisualSchema = z.object({
  visualHint: z.string().min(1).optional(),
  visualSvg: svgStringSchema.optional(),
});

const clueIllustrationItemSchema = z.object({
  label: z.string().min(1),
  kind: z.string().min(1),
  emphasis: z.string().min(1),
  position: pointSchema,
});

const clueIllustrationSchema = z.preprocess(
  sanitizeClueIllustrationInput,
  z
    .object({
      focusLabel: z.string().min(1),
      focusKind: z.string().min(1),
      composition: z.string().min(1),
      items: z.array(clueIllustrationItemSchema).min(1).max(4),
    })
    .optional(),
);

export const suspectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  publicPersona: z.string().min(1),
  relationshipToVictim: z.string().min(1),
  possibleMotive: z.string().min(1),
  alibi: z.string().min(1),
  demeanor: z.string().min(1),
  speakingStyle: z.string().min(1),
  pressurePoint: z.string().min(1),
  appearanceSummary: z.string().min(1).optional(),
  knows: z.union([z.array(z.string().min(1)).min(1), z.string().min(1)]).transform(normalizeStringList),
  hides: z.union([z.array(z.string().min(1)).min(1), z.string().min(1)]).transform(normalizeStringList),
}).merge(characterVisualSchema);

export const npcSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    publicPersona: z.string().min(1),
    relationshipToVictim: z.string().min(1),
    whyRelevant: z.string().min(1),
    demeanor: z.string().min(1),
    speakingStyle: z.string().min(1),
    appearanceSummary: z.string().min(1).optional(),
    knows: z.preprocess(normalizeLooseStringList, z.array(z.string().min(1)).default([])),
    hides: z.preprocess(normalizeLooseStringList, z.array(z.string().min(1)).default([])),
  })
  .merge(characterVisualSchema);

export const investigationNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1).transform(normalizeCategory).pipe(categorySchema),
  summary: z.string().min(1),
  discovery: z.string().min(1),
  contradictionIds: z.array(z.string().min(1)).default([]),
  clueIllustration: clueIllustrationSchema.optional(),
}).merge(clueVisualSchema);

const victimSchema = z
  .object({
    name: z.string().min(1),
    profile: z.string().min(1).optional(),
    age: z.number().int().positive().optional(),
    identity: z.string().min(1).optional(),
    background: z.string().min(1).optional(),
  })
  .transform((victim) => ({
    name: victim.name,
    profile: victim.profile ?? ([victim.identity, victim.background, victim.age ? `${victim.age}岁` : null].filter(Boolean).join("，") || "身份待调查"),
  }));

const solutionSchema = z
  .object({
    culpritId: z.string().min(1),
    motive: z.string().min(1),
    method: z.string().min(1),
    truthReveal: z.string().min(1),
    culpritPlan: z.array(z.string().min(1)).min(3).transform((items) => clampArray(items, 6)),
    redHerrings: z.array(z.string().min(1)).min(2).transform((items) => clampArray(items, 6)),
    keyContradictions: z.array(contradictionSchema).min(2).transform((items) => clampArray(items, 6)),
    hiddenRelationships: z.array(hiddenRelationshipSchema).min(1).transform((items) => clampArray(items, 5)),
    timeline: z
      .array(
        z.union([
          z.object({
            time: z.string().min(1),
            event: z.string().min(1),
          }),
          z.string().min(1),
        ]),
      )
      .min(3),
  })
  .transform((solution) => ({
    ...solution,
    timeline: solution.timeline.map((item, index) => normalizeTimelineItem(item, index)),
  }));

export const casePackageSchema = z
  .object({
    id: z.string().min(1),
    template: templateTypeSchema,
    title: z.string().min(1),
    openingNarration: z.string().min(1),
    publicSummary: z.string().min(1),
    playerGoal: z.string().min(1),
    storyContext: storyContextSchema.optional(),
    sceneVisualSummary: z.string().min(1).optional(),
    sceneSvg: svgStringSchema.optional(),
    sceneIllustration: sceneIllustrationSchema.optional(),
    victim: victimSchema,
    suspects: z.array(suspectSchema).min(3).max(4),
    npcs: z.array(npcSchema).max(3).default([]),
    investigationNodes: z.array(investigationNodeSchema).min(5).max(8),
    solution: solutionSchema,
  })
  .superRefine((value, ctx) => {
    const suspectIds = new Set<string>();
    for (const suspect of value.suspects) {
      if (suspectIds.has(suspect.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `重复嫌疑人 id: ${suspect.id}` });
      }
      suspectIds.add(suspect.id);
    }

    const nodeIds = new Set<string>();
    for (const node of value.investigationNodes) {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `重复调查节点 id: ${node.id}` });
      }
      nodeIds.add(node.id);
    }

    if (!suspectIds.has(value.solution.culpritId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `solution.culpritId 未命中任何嫌疑人: ${value.solution.culpritId}`,
      });
    }

    // 注意：调查节点中的 contradictionIds 现在视为“相关疑点短语”，
    // 不再要求和 keyContradictions.title 逐字一致。
  })
  .transform((value) => {
    const contradictionTitles = value.solution.keyContradictions.map((item) => item.title);

    return {
      ...value,
      storyContext: value.storyContext ?? {
        setting: `${value.title}发生在${value.victim.name}周边关系紧绷、环境封闭或半封闭的场域中。`,
        currentSituation: value.publicSummary,
        whyNow: `${value.victim.name}最近掌握或触碰了会动摇现有关系平衡的秘密，所以冲突在这一刻爆发。`,
        knownTensions: [
          `${value.victim.name}最近与多名关系人发生利益或信任冲突。`,
          `几名嫌疑人的口供能互相补局部事实，但关键时间线仍然错位。`,
          `现场留下的线索指向熟人作案，而非真正的外部闯入。`,
        ],
      },
      sceneVisualSummary:
        value.sceneVisualSummary ?? `${value.title}的案发核心空间带有明显紧张感：${value.investigationNodes[0]?.summary ?? value.publicSummary}`,
      sceneIllustration:
        value.sceneIllustration ?? {
          locationLabel: value.title,
          atmosphere: value.sceneVisualSummary ?? value.publicSummary,
          focusCaption: value.openingNarration,
          figures: [
            {
              label: value.victim.name,
              role: "victim",
              position: { x: 52, y: 58 },
              pose: "倒在现场中央或关键物件旁",
              expression: "失去反应",
            },
            ...value.suspects.slice(0, 2).map((suspect, index) => ({
              characterId: suspect.id,
              label: suspect.name,
              role: "suspect" as const,
              position: { x: 26 + index * 46, y: 22 + index * 10 },
              pose: "站在案发空间边缘，保持距离观察现场",
              expression: suspect.demeanor,
            })),
          ],
          props: [
            {
              label: "核心现场",
              kind: "room",
              position: { x: 50, y: 50 },
              size: "large",
              detail: value.sceneVisualSummary ?? value.publicSummary,
            },
            ...value.investigationNodes.slice(0, 4).map((node, index) => ({
              label: node.title,
              kind: node.category,
              position: { x: 18 + (index % 2) * 56, y: 28 + Math.floor(index / 2) * 34 },
              size: index === 0 ? "large" as const : "medium" as const,
              detail: node.discovery,
            })),
          ],
        },
      suspects: value.suspects.map((suspect) => ({
        ...suspect,
        appearanceSummary:
          suspect.appearanceSummary ?? `${suspect.publicPersona}，整体给人的感觉是${suspect.demeanor}，说话时带着${suspect.speakingStyle}。`,
      })),
      npcs: (value.npcs ?? []).map((npc, index) => ({
        ...npc,
        appearanceSummary: npc.appearanceSummary ?? `${npc.publicPersona}，看上去${npc.demeanor}，是这起案件里第 ${index + 1} 个值得追问的旁支角色。`,
      })),
      investigationNodes: value.investigationNodes.map((node) => {
        const visualHint = isVisualHintTooCloseToDiscovery(node.visualHint, node.discovery)
          ? buildVisualHintFallback(node)
          : (node.visualHint ?? buildVisualHintFallback(node));

        return {
          ...node,
          visualHint,
          clueIllustration: node.clueIllustration ?? buildClueIllustrationFallback(node, visualHint),
          contradictionIds: node.contradictionIds.map((reference) => resolveContradictionReference(reference, contradictionTitles) ?? reference),
        };
      }),
    };
  })
  .transform((value) => applyCaseVisuals(value));

export type TemplateType = z.infer<typeof templateTypeSchema>;
export type MysteryCase = z.infer<typeof casePackageSchema>;
export type Suspect = z.infer<typeof suspectSchema>;
export type Npc = z.infer<typeof npcSchema>;
export type InvestigationNode = z.infer<typeof investigationNodeSchema>;
export type StoryContext = z.infer<typeof storyContextSchema>;
export type SceneIllustration = z.infer<typeof sceneIllustrationSchema>;
export type ClueIllustration = z.infer<typeof clueIllustrationSchema>;

export function normalizeMysteryCase(input: unknown): MysteryCase {
  return casePackageSchema.parse(input);
}
