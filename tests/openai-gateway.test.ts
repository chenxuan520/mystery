import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { OpenAiGateway } from "../src/llm/openai-gateway.js";

function createGateway() {
  return new OpenAiGateway({
    openaiBaseUrl: "https://example.com/v1",
    openaiApiKey: "test-key",
    openaiModel: "test-model",
    databasePath: "data/test.sqlite",
    source: "env",
  });
}

describe("OpenAiGateway", () => {
  it("遇到 429 时会自动重试", async () => {
    const gateway = createGateway();
    const create = vi.fn(async () => {
      if (create.mock.calls.length < 3) {
        throw Object.assign(new Error("rate limited"), {
          status: 429,
          headers: { "retry-after-ms": "1" },
        });
      }

      return {
        choices: [{ message: { content: "重试成功" } }],
      };
    });

    Reflect.set(gateway as object, "client", {
      chat: {
        completions: {
          create,
        },
      },
    });

    const reply = await gateway.chat([{ role: "user", content: "你好" }], 0.7, 20);

    expect(reply).toBe("重试成功");
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("案件 JSON 首次截断时会再次生成", async () => {
    const gateway = createGateway();
    const create = vi.fn(async () => {
      if (create.mock.calls.length === 1) {
        return {
          choices: [{ finish_reason: "length", message: { content: "{\"broken\": true" } }],
        };
      }

      return {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({ value: "ok" }),
            },
          },
        ],
      };
    });

    Reflect.set(gateway as object, "client", {
      chat: {
        completions: {
          create,
        },
      },
    });

    const result = await gateway.completeJson("system", "user", z.object({ value: z.string() }), 100);

    expect(result).toEqual({ value: "ok" });
    expect(create).toHaveBeenCalledTimes(2);
  });
});
