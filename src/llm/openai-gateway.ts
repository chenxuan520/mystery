import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { z } from "zod";

import type { RuntimeConfig } from "../config/runtime-config.js";

export type StructuredJsonGateway = {
  completeJson<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    maxTokens?: number,
  ): Promise<T>;
};

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();

  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    const withoutFence = trimmed.replace(/^```(?:json)?/u, "").replace(/```$/u, "").trim();
    return JSON.parse(withoutFence);
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("模型没有返回可解析的 JSON。");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function truncateRetryPreview(text: string, maxChars = 1200): string {
  const normalized = text.trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars)}…`;
}

function attachPartialOutput(error: unknown, partialOutput: string) {
  if (!partialOutput) {
    return error;
  }

  if (error instanceof Error) {
    return Object.assign(error, { partialOutput });
  }

  return Object.assign(new Error(String(error)), { partialOutput });
}

type RetriableApiError = { status?: number; headers?: unknown; error?: { type?: string } };

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = `${error.name} ${error.message}`.toLowerCase();
  return message.includes("timeout") || message.includes("timed out");
}

function isRetriableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (isTimeoutError(error)) {
    return false;
  }

  const message = `${error.name} ${error.message}`.toLowerCase();
  return (
    message.includes("connection") ||
    message.includes("socket hang up") ||
    message.includes("econnreset") ||
    message.includes("econnaborted")
  );
}

function isRetriableApiError(error: unknown): error is RetriableApiError {
  if (isRetriableConnectionError(error)) {
    return true;
  }

  if (!error || typeof error !== "object" || !("status" in error)) {
    return false;
  }

  const status = (error as RetriableApiError).status;
  if (status === 429) {
    return true;
  }

  if (typeof status === "number" && status >= 500) {
    return true;
  }

  return false;
}

function readRetryAfterMs(error: { headers?: unknown }, fallbackMs: number): number {
  const headers = error.headers;
  if (!headers || typeof headers !== "object") {
    return fallbackMs;
  }

  const retryAfterMs = (headers as Record<string, string | undefined>)["retry-after-ms"];
  if (retryAfterMs) {
    const numeric = Number(retryAfterMs);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  const retryAfter = (headers as Record<string, string | undefined>)["retry-after"];
  if (retryAfter) {
    const numeric = Number(retryAfter);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric * 1000;
    }
  }

  return fallbackMs;
}

export class OpenAiGateway {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly structuredOutputMode: "json_object" | "tool_call";
  private readonly defaultMaxTokens?: number;
  private readonly extraBody?: Record<string, unknown>;
  private readonly source: RuntimeConfig["source"];
  private readonly presetId?: string;
  private readonly timeoutMs: number;

  constructor(config: RuntimeConfig) {
    const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? 120000);
    const inferredExtraBody =
      (config.structuredOutputMode ?? "json_object") === "tool_call" &&
      !config.extraBody?.thinking &&
      config.openaiModel.toLowerCase().includes("deepseek")
        ? { thinking: { type: "disabled" as const } }
        : undefined;

    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
      defaultHeaders: config.openaiHeaders,
      timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
    });
    this.model = config.openaiModel;
    this.structuredOutputMode = config.structuredOutputMode ?? "json_object";
    this.defaultMaxTokens = config.defaultMaxTokens;
    this.extraBody = {
      ...inferredExtraBody,
      ...config.extraBody,
    };
    this.source = config.source;
    this.presetId = config.presetId;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000;
  }

  describe() {
    return {
      model: this.model,
      structuredOutputMode: this.structuredOutputMode,
      source: this.source,
      presetId: this.presetId,
      timeoutMs: this.timeoutMs,
    };
  }

  private buildRequestBody(base: ChatCompletionCreateParamsNonStreaming): ChatCompletionCreateParamsNonStreaming {
    const mergedMaxTokens = base.max_tokens ?? this.defaultMaxTokens;

    return {
      ...this.extraBody,
      ...base,
      max_tokens: mergedMaxTokens,
    } as ChatCompletionCreateParamsNonStreaming;
  }

  private buildStreamingRequestBody(base: ChatCompletionCreateParamsStreaming): ChatCompletionCreateParamsStreaming {
    const mergedMaxTokens = base.max_tokens ?? this.defaultMaxTokens;

    return {
      ...this.extraBody,
      ...base,
      max_tokens: mergedMaxTokens,
    } as ChatCompletionCreateParamsStreaming;
  }

  private extractStructuredPayload(message: {
    content?: string | null;
    tool_calls?: Array<{ function?: { arguments?: string } }>;
  }): unknown {
    const toolArguments = message.tool_calls?.[0]?.function?.arguments;
    if (toolArguments) {
      return JSON.parse(toolArguments);
    }

    if (message.content) {
      return extractJsonPayload(message.content);
    }

    throw new Error("模型没有返回结构化内容。");
  }

  private extractStructuredRawText(message: {
    content?: string | null;
    tool_calls?: Array<{ function?: { arguments?: string } }>;
  }): string {
    const toolArguments = message.tool_calls?.[0]?.function?.arguments;
    if (typeof toolArguments === "string" && toolArguments.trim()) {
      return toolArguments;
    }

    if (typeof message.content === "string" && message.content.trim()) {
      return message.content;
    }

    return "";
  }

  private parseStructuredSchema<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, payload: unknown): T {
    try {
      return schema.parse(payload);
    } catch (error) {
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const record = payload as Record<string, unknown>;
        const candidates: unknown[] = [];
        const commonWrapperKeys = ["data", "result", "payload", "case", "mysteryCase", "output", "response"];

        for (const key of commonWrapperKeys) {
          if (record[key] && typeof record[key] === "object") {
            candidates.push(record[key]);
          }
        }

        const values = Object.values(record);
        if (values.length === 1 && values[0] && typeof values[0] === "object") {
          candidates.push(values[0]);
        }

        for (const candidate of candidates) {
          const parsed = schema.safeParse(candidate);
          if (parsed.success) {
            return parsed.data;
          }
        }

        const topLevelKeys = Object.keys(record);
        throw new Error(
          `模型 JSON 校验失败：${error instanceof Error ? error.message : String(error)}；原始顶层键：${topLevelKeys.join(", ") || "无"}`,
        );
      }

      throw error;
    }
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!isRetriableApiError(error) || attempt === maxAttempts) {
          throw error;
        }

        const fallbackDelay = 1000 * 2 ** (attempt - 1);
        const delayMs = readRetryAfterMs(error, fallbackDelay);
        await sleep(delayMs);
      }
    }

    throw new Error("重试逻辑异常结束。");
  }

  private async runWithAbortTimeout<T>(operation: (requestOptions: { signal: AbortSignal; timeout: number }) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error(`模型请求超时（>${Math.round(this.timeoutMs / 1000)} 秒）`));
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([operation({ signal: controller.signal, timeout: this.timeoutMs }), timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async completeJson<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    maxTokens = 3800,
  ): Promise<T> {
    let lastError: unknown;
    let lastPartialOutput = "";

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const structuredMode =
        attempt === 1 ? this.structuredOutputMode : this.structuredOutputMode === "tool_call" ? "json_object" : this.structuredOutputMode;
      const retryReason = lastError instanceof Error ? lastError.message : String(lastError ?? "");
      const retryPreview = truncateRetryPreview(lastPartialOutput);
      const retryNote =
        attempt === 1
          ? ""
          : `\n\n上一次输出未通过校验，原因：${retryReason}。这次请严格输出完整 JSON，并检查引号、逗号、数组闭合和必填字段，不要输出空对象。如果上次是因为长度不够被截断，请重新从头输出完整 JSON，并主动压缩不必要的说明文字，确保整份对象一次输出完。${retryPreview ? `\n\n上次输出前缀（仅供你保持结构，不要续写半截 JSON，必须从头重写完整 JSON）：\n${retryPreview}` : ""}`;
      const attemptMaxTokens = attempt === 1 ? maxTokens : Math.min(maxTokens + 1800 * (attempt - 1), maxTokens * 2);

      const response = await this.withRetry(() =>
        this.runWithAbortTimeout((requestOptions) =>
          this.client.chat.completions.create(
            this.buildRequestBody({
              model: this.model,
              temperature: attempt === 1 ? 0.45 : 0.25,
              max_tokens: attemptMaxTokens,
              ...(structuredMode === "json_object"
                ? { response_format: { type: "json_object" as const } }
                : {
                    tools: [
                      {
                        type: "function" as const,
                        function: {
                          name: "submit_json",
                          description: "提交符合要求的 JSON 结果",
                          parameters: {
                            type: "object",
                            additionalProperties: true,
                          },
                        },
                      },
                    ],
                    tool_choice: {
                      type: "function" as const,
                      function: {
                        name: "submit_json",
                      },
                    },
                  }),
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `${userPrompt}${retryNote}` },
              ],
            }),
            requestOptions,
          ),
        ),
      );

      const finishReason = response.choices[0]?.finish_reason;
      const message = response.choices[0]?.message;
      if (!message) {
        lastError = new Error("模型没有返回内容。");
        lastPartialOutput = "";
        continue;
      }

      lastPartialOutput = this.extractStructuredRawText(message);

      if (finishReason === "length") {
        lastError = attachPartialOutput(new Error("模型输出被截断。"), lastPartialOutput);
        continue;
      }

      try {
        return this.parseStructuredSchema(schema, this.extractStructuredPayload(message));
      } catch (error) {
        lastError = attachPartialOutput(error, lastPartialOutput);
      }
    }

    throw attachPartialOutput(
      lastError instanceof Error ? lastError : new Error(`模型 JSON 生成失败：${String(lastError)}`),
      lastPartialOutput,
    );
  }

  async chat(messages: ChatCompletionMessageParam[], temperature = 0.7, maxTokens = 300): Promise<string> {
    const response = await this.withRetry(() =>
      this.runWithAbortTimeout((requestOptions) =>
        this.client.chat.completions.create(
          this.buildRequestBody({
            model: this.model,
            temperature,
            max_tokens: maxTokens,
            messages,
          }),
          requestOptions,
        ),
      ),
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("模型没有返回聊天内容。");
    }

    return content;
  }

  async *streamChat(messages: ChatCompletionMessageParam[], temperature = 0.7, maxTokens = 300): AsyncGenerator<string> {
    const stream = await this.withRetry(() =>
      this.runWithAbortTimeout((requestOptions) =>
        this.client.chat.completions.create(
          this.buildStreamingRequestBody({
            model: this.model,
            temperature,
            max_tokens: maxTokens,
            messages,
            stream: true,
          }),
          requestOptions,
        ),
      ),
    );

    let hasContent = false;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (!delta) {
        continue;
      }

      hasContent = true;
      yield delta;
    }

    if (!hasContent) {
      throw new Error("模型没有返回流式聊天内容。");
    }
  }
}
