import { describe, expect, it } from "vitest";

import { casePackageSchema } from "../src/case/schema.js";
import { sampleCase } from "./fixtures/sample-case.js";

describe("casePackageSchema", () => {
  it("可以通过样例案件校验", () => {
    const parsed = casePackageSchema.parse(sampleCase);
    expect(parsed.solution.culpritId).toBe("suspect_doctor");
    expect(parsed.suspects).toHaveLength(4);
    expect(parsed.npcs).toHaveLength(1);
    expect(parsed.investigationNodes).toHaveLength(5);
    expect(parsed.solution.redHerrings).toHaveLength(2);
    expect(parsed.solution.keyContradictions).toHaveLength(3);
    expect(parsed.sceneSvg?.includes("<svg")).toBe(true);
    expect(parsed.suspects[0]?.avatarSvg?.includes("<svg")).toBe(true);
  });

  it("会把与 discovery 重复的 visualHint 收紧回更直观的画面描述", () => {
    const duplicatedVisualHintCase = {
      ...sampleCase,
      investigationNodes: sampleCase.investigationNodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              visualHint: `${node.title}里最值得被视觉化的是：${node.discovery}`,
            }
          : node,
      ),
    };

    const parsed = casePackageSchema.parse(duplicatedVisualHintCase);
    expect(parsed.investigationNodes[0]?.visualHint).toBe("第一眼会先注意到 半开窗、雪粒、拖痕。");
  });

  it("缺少独立 visualHint 时，不会再直接退回成摘要原文", () => {
    const parsed = casePackageSchema.parse({
      ...sampleCase,
      investigationNodes: sampleCase.investigationNodes.map((node, index) =>
        index === 1
          ? {
              ...node,
              visualHint: node.summary,
              clueIllustration: undefined,
            }
          : node,
      ),
    });

    expect(parsed.investigationNodes[1]?.visualHint).not.toBe(parsed.investigationNodes[1]?.summary);
    expect(parsed.investigationNodes[1]?.visualHint).toBe("第一眼会先注意到 威士忌酒杯、送药时间对不上。");
  });

  it("会兼容中文 sceneIllustration 角色值与空的 NPC hides", () => {
    const tolerantCase = {
      ...sampleCase,
      sceneIllustration: {
        ...sampleCase.sceneIllustration,
        figures: sampleCase.sceneIllustration.figures.map((figure, index) => ({
          ...figure,
          role: index === 0 ? "死者" : index === 1 ? "目击者" : figure.role,
        })),
      },
      npcs: sampleCase.npcs.map((npc, index) =>
        index === 0
          ? {
              ...npc,
              hides: [],
            }
          : npc,
      ),
    };

    const parsed = casePackageSchema.parse(tolerantCase);
    expect(parsed.sceneIllustration?.figures[0]?.role).toBe("victim");
    expect(parsed.sceneIllustration?.figures[1]?.role).toBe("npc");
    expect(parsed.npcs[0]?.hides).toEqual([]);
  });

  it("会为缺失的 clueIllustration 回填至少两项简化构图", () => {
    const parsed = casePackageSchema.parse({
      ...sampleCase,
      investigationNodes: sampleCase.investigationNodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              clueIllustration: undefined,
            }
          : node,
      ),
    });

    expect(parsed.investigationNodes[0]?.clueIllustration?.items).toHaveLength(2);
    expect(parsed.investigationNodes[0]?.clueIllustration?.items[1]?.label).toBe(sampleCase.investigationNodes[0]?.contradictionIds[0]);
  });

  it("会丢弃结构不完整的 sceneIllustration 并回填默认场景构图", () => {
    const parsed = casePackageSchema.parse({
      ...sampleCase,
      sceneIllustration: {
        locationLabel: "坏场景",
        atmosphere: "坏气氛",
        focusCaption: "坏焦点",
        figures: [{ label: "死者" }],
        props: [{ label: "窗户", position: "右侧" }],
      },
    });

    expect(parsed.sceneIllustration?.figures.length).toBeGreaterThanOrEqual(3);
    expect(parsed.sceneIllustration?.props.length).toBeGreaterThanOrEqual(5);
    expect(parsed.sceneIllustration?.figures[0]?.role).toBe("victim");
  });

  it("场景 SVG 至少会把全部嫌疑人都补进画面", () => {
    const parsed = casePackageSchema.parse(sampleCase);

    for (const suspect of sampleCase.suspects) {
      expect(parsed.sceneSvg).toContain(suspect.name);
    }
  });

  it("嫌疑人头像 SVG 会尽量使用不同主色，避免全员撞色", () => {
    const parsed = casePackageSchema.parse(sampleCase);
    const strokeColors = parsed.suspects
      .map((suspect) => suspect.avatarSvg?.match(/stroke="(#[^"]+)"/)?.[1] ?? null)
      .filter(Boolean);

    expect(new Set(strokeColors).size).toBe(parsed.suspects.length);
  });

  it("缺省 sceneIllustration 且角色较多时，二次解析仍能通过", () => {
    const crowdedCase = {
      ...sampleCase,
      sceneIllustration: undefined,
      npcs: [
        ...sampleCase.npcs,
        {
          ...sampleCase.npcs[0],
          id: "npc_extra_1",
          name: "老刘",
        },
        {
          ...sampleCase.npcs[0],
          id: "npc_extra_2",
          name: "阿成",
        },
      ],
    };

    const firstPass = casePackageSchema.parse(crowdedCase);
    const secondPass = casePackageSchema.parse(firstPass);

    expect(firstPass.sceneIllustration?.figures.length).toBeLessThanOrEqual(8);
    expect(secondPass.sceneIllustration?.figures.length).toBeLessThanOrEqual(8);
  });
});
