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
});
