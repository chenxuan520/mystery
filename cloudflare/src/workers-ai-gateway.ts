import { z } from "zod";

import { sleep } from "./utils.js";

export type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("模型没有返回可解析的 JSON。");
  }

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

function truncateRetryPreview(text: string, maxChars = 1200) {
  const normalized = text.trim();
  if (!normalized) {
    return "";
  }

  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars)}…`;
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

function unwrapAiResponse(response: unknown): unknown {
  if (!response || typeof response !== "object") {
    return response;
  }

  const record = response as Record<string, unknown>;
  if (record.response !== undefined) {
    return record.response;
  }

  if (record.result !== undefined) {
    return record.result;
  }

  return response;
}

function extractOpenAiChoice(response: unknown): Record<string, unknown> | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0 || !choices[0] || typeof choices[0] !== "object") {
    return null;
  }

  return choices[0] as Record<string, unknown>;
}

function extractOpenAiMessagePayload(response: unknown): unknown {
  const choice = extractOpenAiChoice(response);
  if (!choice) {
    return undefined;
  }

  const message = choice.message;
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const record = message as Record<string, unknown>;
  const toolCalls = record.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls[0] && typeof toolCalls[0] === "object") {
    const functionArgs = (toolCalls[0] as { function?: { arguments?: unknown } }).function?.arguments;
    if (typeof functionArgs === "string" && functionArgs.trim()) {
      return functionArgs;
    }
  }

  if (typeof record.content === "string") {
    return record.content;
  }

  return undefined;
}

function responsePreview(response: unknown) {
  const openAiPayload = extractOpenAiMessagePayload(response);
  if (typeof openAiPayload === "string") {
    return openAiPayload;
  }

  if (typeof response === "string") {
    return response;
  }

  try {
    return JSON.stringify(response);
  } catch {
    return String(response);
  }
}

function parseStructuredSchema<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, payload: unknown): T {
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

function parseStructuredPayload(response: unknown): unknown {
  const payload = unwrapAiResponse(response);
  const openAiPayload = extractOpenAiMessagePayload(payload);
  if (typeof openAiPayload === "string") {
    return extractJsonPayload(openAiPayload);
  }

  if (typeof payload === "string") {
    return extractJsonPayload(payload);
  }

  if (payload && typeof payload === "object") {
    return payload;
  }

  throw new Error("模型没有返回结构化内容。");
}

function extractChatText(response: unknown): string {
  const payload = unwrapAiResponse(response);
  const openAiPayload = extractOpenAiMessagePayload(payload);
  if (typeof openAiPayload === "string") {
    return openAiPayload;
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.response === "string") {
      return record.response;
    }
  }

  throw new Error("模型没有返回聊天内容。");
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return Boolean(value && typeof value === "object" && "getReader" in value);
}

const DONE = Symbol("done");

function parseSseBlock(block: string): string | typeof DONE | null {
  const data = block
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();

  if (!data) {
    return null;
  }

  if (data === "[DONE]") {
    return DONE;
  }

  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const choice = extractOpenAiChoice(parsed);
    if (choice?.delta && typeof choice.delta === "object") {
      const content = (choice.delta as { content?: unknown }).content;
      if (typeof content === "string") {
        return content;
      }
    }
    if (choice?.message && typeof choice.message === "object") {
      const content = (choice.message as { content?: unknown }).content;
      if (typeof content === "string") {
        return content;
      }
    }
    if (typeof parsed.response === "string") {
      return parsed.response;
    }
    if (typeof parsed.delta === "string") {
      return parsed.delta;
    }
  } catch {
    return data;
  }

  return null;
}

export class WorkersAiGateway {
  constructor(
    private readonly ai: AiBinding,
    private readonly model: string,
    private readonly optionId?: string,
    private readonly timeoutMs = 120000,
  ) {}

  describe() {
    return {
      model: this.model,
      structuredOutputMode: "json_object" as const,
      source: "workers-ai" as const,
      presetId: this.optionId,
      timeoutMs: this.timeoutMs,
    };
  }

  private isGlmModel() {
    return this.model.includes("/glm-");
  }

  private async run(input: Record<string, unknown>) {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`模型请求超时（>${Math.round(this.timeoutMs / 1000)} 秒）`)), this.timeoutMs);
    });

    return Promise.race([this.ai.run(this.model, input), timeoutPromise]);
  }

  private async withRetry(operation: () => Promise<unknown>) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === 3) {
          throw error;
        }

        await sleep(400 * attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
      const retryReason = lastError instanceof Error ? lastError.message : String(lastError ?? "");
      const retryPreview = truncateRetryPreview(lastPartialOutput);
      const retryNote =
        attempt === 1
          ? ""
          : `\n\n上一次输出未通过校验，原因：${retryReason}。这次请严格输出完整 JSON，并检查引号、逗号、数组闭合和必填字段，不要输出空对象。如果上次是因为长度不够被截断，请重新从头输出完整 JSON。${retryPreview ? `\n\n上次输出前缀（仅供你保持结构，不要续写半截 JSON，必须从头重写完整 JSON）：\n${retryPreview}` : ""}`;
      const baseMaxTokens = this.isGlmModel() ? Math.max(maxTokens, 5200) : maxTokens;
      const attemptMaxTokens = attempt === 1 ? baseMaxTokens : Math.min(baseMaxTokens + 1800 * (attempt - 1), baseMaxTokens * 2);

      try {
        const response = await this.withRetry(() =>
          this.run({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `${userPrompt}${retryNote}` },
            ],
            max_tokens: attemptMaxTokens,
            ...(this.isGlmModel() ? { max_completion_tokens: attemptMaxTokens } : {}),
            ...(this.isGlmModel() ? { reasoning_effort: "low", modalities: ["text"] } : {}),
            temperature: this.isGlmModel() ? 0.1 : attempt === 1 ? 0.45 : 0.25,
            response_format: { type: "json_object" },
          }),
        );
        const payload = parseStructuredPayload(response);
        lastPartialOutput = responsePreview(payload);
        return parseStructuredSchema(schema, payload);
      } catch (error) {
        lastError = attachPartialOutput(error, lastPartialOutput);
      }
    }

    throw attachPartialOutput(
      lastError instanceof Error ? lastError : new Error(`模型 JSON 生成失败：${String(lastError)}`),
      lastPartialOutput,
    );
  }

  async chat(messages: ChatMessage[], temperature = 0.7, maxTokens = 300) {
    const response = await this.withRetry(() =>
      this.run({
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(this.isGlmModel() ? { max_completion_tokens: maxTokens } : {}),
        ...(this.isGlmModel() ? { reasoning_effort: "low", modalities: ["text"] } : {}),
      }),
    );

    return extractChatText(response);
  }

  async *streamChat(messages: ChatMessage[], temperature = 0.7, maxTokens = 300): AsyncGenerator<string> {
    const response = await this.withRetry(() =>
      this.run({
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(this.isGlmModel() ? { max_completion_tokens: maxTokens } : {}),
        ...(this.isGlmModel() ? { reasoning_effort: "low", modalities: ["text"] } : {}),
        stream: true,
      }),
    );

    if (!isReadableStream(response)) {
      throw new Error("模型没有返回流式聊天内容。");
    }

    const reader = response.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hasContent = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const separatorIndex = buffer.search(/\r?\n\r?\n/u);
        if (separatorIndex === -1) {
          break;
        }

        const separatorLength = buffer[separatorIndex] === "\r" ? 4 : 2;
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + separatorLength);
        const parsed = parseSseBlock(block);
        if (parsed === DONE) {
          if (!hasContent) {
            throw new Error("模型没有返回流式聊天内容。");
          }
          return;
        }

        if (!parsed) {
          continue;
        }

        hasContent = true;
        yield parsed;
      }
    }

    const tail = decoder.decode();
    if (tail) {
      buffer += tail;
    }

    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer.trim());
      if (parsed && parsed !== DONE) {
        hasContent = true;
        yield parsed;
      }
    }

    if (!hasContent) {
      throw new Error("模型没有返回流式聊天内容。");
    }
  }
}
