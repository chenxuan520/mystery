import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { loadAiPresetById, resolvePresetPath } from "../src/config/ai-presets.js";
import { loadRuntimeConfigForRole } from "../src/config/runtime-config.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("ai presets", () => {
  it("可以从 YAML 中读取指定 preset", () => {
    const dir = mkdtempSync(join(tmpdir(), "mystery-presets-"));
    tempDirs.push(dir);
    const filePath = join(dir, "presets.yaml");

    writeFileSync(
      filePath,
      [
        "presets:",
        "  - id: review-json",
        "    name: Review JSON",
        "    endpoint: https://example.com/v1",
        "    token: secret-token",
        "    model: glm-review",
        "    structured_output: json_object",
        "    max_tokens: 600",
      ].join("\n"),
      "utf-8",
    );

    const preset = loadAiPresetById("review-json", filePath);
    expect(preset.model).toBe("glm-review");
    expect(resolvePresetPath({ AI_PRESET_PATH: filePath })).toBe(filePath);
  });

  it("可以把 reviewer role 绑定到 preset 配置", () => {
    const dir = mkdtempSync(join(tmpdir(), "mystery-presets-"));
    tempDirs.push(dir);
    const filePath = join(dir, "presets.yaml");

    writeFileSync(
      filePath,
      [
        "presets:",
        "  - id: review-json",
        "    name: Review JSON",
        "    endpoint: https://example.com/v1",
        "    token: secret-token",
        "    model: glm-review",
        "    structured_output: json_object",
        "    max_tokens: 600",
        "    extra_headers:",
        "      X-Test: reviewer",
      ].join("\n"),
      "utf-8",
    );

    const config = loadRuntimeConfigForRole("reviewer", {
      AI_PRESET_PATH: filePath,
      CASE_REVIEWER_PRESET_ID: "review-json",
      DATABASE_PATH: "tmp/test.sqlite",
    });

    expect(config.source).toBe("preset");
    expect(config.openaiModel).toBe("glm-review");
    expect(config.defaultMaxTokens).toBe(600);
    expect(config.openaiHeaders).toEqual({ "X-Test": "reviewer" });
  });

  it("未显式提供 AI_PRESET_PATH 时不会隐式读取 preset", () => {
    const dir = mkdtempSync(join(tmpdir(), "mystery-presets-"));
    tempDirs.push(dir);
    const filePath = join(dir, "presets.yaml");

    writeFileSync(
      filePath,
      [
        "presets:",
        "  - id: deepseek-v4-pro",
        "    name: Deepseek-V4-Pro",
        "    endpoint: https://example.com/v1",
        "    token: secret-token",
        "    model: deepseek-v4-pro",
        "    structured_output: tool_call",
      ].join("\n"),
      "utf-8",
    );

    expect(resolvePresetPath({})).toBeNull();
    expect(resolvePresetPath({ AI_PRESET_PATH: filePath })).toBe(filePath);
  });
});
