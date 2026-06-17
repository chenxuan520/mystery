import { describe, expect, it } from "vitest";

import { templateTypeSchema } from "../src/case/schema.js";
import { CASE_TEMPLATES, pickTemplate } from "../src/case/templates.js";

describe("case templates", () => {
  it("支持新增模板类型", () => {
    expect(templateTypeSchema.parse("staged-suicide")).toBe("staged-suicide");
    expect(templateTypeSchema.parse("inheritance")).toBe("inheritance");
    expect(templateTypeSchema.parse("body-relocation")).toBe("body-relocation");
    expect(templateTypeSchema.parse("blackmail")).toBe("blackmail");
    expect(templateTypeSchema.parse("cold-case")).toBe("cold-case");
    expect(templateTypeSchema.parse("identity-fraud")).toBe("identity-fraud");
  });

  it("可以按类型取回对应模板", () => {
    expect(pickTemplate("staged-suicide").label).toBe("伪自杀案");
    expect(pickTemplate("inheritance").label).toBe("遗产争夺案");
    expect(pickTemplate("body-relocation").label).toBe("移尸案");
    expect(pickTemplate("blackmail").label).toBe("勒索灭口案");
    expect(pickTemplate("cold-case").label).toBe("旧案牵连案");
    expect(pickTemplate("identity-fraud").label).toBe("身份伪装案");
  });

  it("模板池里包含 9 种不重复模板", () => {
    expect(new Set(CASE_TEMPLATES.map((template) => template.type)).size).toBe(9);
  });
});
