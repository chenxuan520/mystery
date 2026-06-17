import { describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "../src/config/runtime-config.js";

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
});
