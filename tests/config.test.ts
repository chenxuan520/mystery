import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { loadRuntimeConfig, loadRuntimeConfigForRole } from "../src/config/runtime-config.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("loadRuntimeConfig", () => {
  it("优先读取显式环境变量", () => {
    const config = loadRuntimeConfig({
      OPENAI_BASE_URL: "https://example.com/v1",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-test",
      DATABASE_PATH: "tmp/test.sqlite",
    });

    expect(config).toEqual({
      openaiBaseUrl: "https://example.com/v1",
      openaiApiKey: "test-key",
      openaiModel: "gpt-test",
      databasePath: "tmp/test.sqlite",
      source: "env",
    });
  });

  it("未显式配置时回退到 opencode 配置", () => {
    const config = loadRuntimeConfig({
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        model: "provider-openai/test-model",
        provider: {
          "provider-openai": {
            options: {
              baseURL: "https://fallback.example.com",
              apiKey: "fallback-key",
              headers: {
                "X-Test": "1",
              },
            },
          },
        },
      }),
    });

    expect(config).toEqual({
      openaiBaseUrl: "https://fallback.example.com/v1",
      openaiApiKey: "fallback-key",
      openaiModel: "test-model",
      databasePath: "data/mystery.sqlite",
      openaiHeaders: {
        "X-Test": "1",
      },
      source: "opencode",
    });
  });

  it("generator/reviewer 显式 preset 会覆盖通用 OPENAI 环境变量", () => {
    const dir = mkdtempSync(join(tmpdir(), "mystery-runtime-config-"));
    tempDirs.push(dir);
    const presetPath = join(dir, "ai-presets.yaml");
    writeFileSync(
      presetPath,
      [
        "presets:",
        "  - id: fast-generator",
        "    name: Fast Generator",
        "    endpoint: https://preset.example.com/v1",
        "    token: preset-token",
        "    model: preset-model",
        "    structured_output: json_object",
      ].join("\n"),
      "utf8",
    );

    const config = loadRuntimeConfigForRole("generator", {
      OPENAI_BASE_URL: "https://env.example.com/v1",
      OPENAI_API_KEY: "env-token",
      OPENAI_MODEL: "env-model",
      AI_PRESET_PATH: presetPath,
      CASE_GENERATOR_PRESET_ID: "fast-generator",
    });

    expect(config).toMatchObject({
      openaiBaseUrl: "https://preset.example.com/v1",
      openaiApiKey: "preset-token",
      openaiModel: "preset-model",
      structuredOutputMode: "json_object",
      presetId: "fast-generator",
      source: "preset",
    });
  });
});
