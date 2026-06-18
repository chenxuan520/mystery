import dotenv from "dotenv";
import { z } from "zod";

import { loadAiPresetById, resolvePresetPath } from "./ai-presets.js";

dotenv.config();

const opencodeConfigSchema = z.object({
  model: z.string().min(1).optional(),
  provider: z
    .record(
      z.object({
        options: z
          .object({
            baseURL: z.string().min(1).optional(),
            apiKey: z.string().min(1).optional(),
            headers: z.record(z.string(), z.string()).optional(),
          })
          .partial()
          .optional(),
      }),
    )
    .optional(),
});

export type RuntimeConfig = {
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  databasePath: string;
  openaiHeaders?: Record<string, string>;
  structuredOutputMode?: "json_object" | "tool_call";
  defaultMaxTokens?: number;
  extraBody?: Record<string, unknown>;
  presetId?: string;
  source: "env" | "opencode" | "preset";
};

export type RuntimeRole = "default" | "generator" | "reviewer";

function normalizeBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = "/v1";
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return baseUrl.replace(/\/$/, "");
  }
}

function splitModelRef(modelRef: string): { providerName?: string; modelName: string } {
  const slashIndex = modelRef.indexOf("/");
  if (slashIndex === -1) {
    return { modelName: modelRef };
  }

  return {
    providerName: modelRef.slice(0, slashIndex),
    modelName: modelRef.slice(slashIndex + 1),
  };
}

function loadFromPreset(env: NodeJS.ProcessEnv, role: RuntimeRole): RuntimeConfig | null {
  const specificKey = role === "generator" ? env.CASE_GENERATOR_PRESET_ID : role === "reviewer" ? env.CASE_REVIEWER_PRESET_ID : undefined;
  const presetPath = resolvePresetPath(env);
  const presetId = specificKey ?? env.AI_PRESET_ID;

  if (!presetId || !presetPath) {
    return null;
  }

  const preset = loadAiPresetById(presetId, presetPath);

  return {
    openaiBaseUrl: normalizeBaseUrl(preset.endpoint),
    openaiApiKey: preset.token,
    openaiModel: preset.model,
    databasePath: env.DATABASE_PATH ?? "data/mystery.sqlite",
    openaiHeaders: preset.extra_headers,
    structuredOutputMode: preset.structured_output,
    defaultMaxTokens: preset.max_tokens,
    extraBody: preset.extra_body,
    presetId: preset.id,
    source: "preset",
  };
}

export function loadRuntimeConfigFromPresetId(presetId: string, env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const presetPath = resolvePresetPath(env);
  if (!presetPath) {
    throw new Error("未找到 AI_PRESET_PATH，对应 preset 无法加载。");
  }

  const preset = loadAiPresetById(presetId, presetPath);
  return {
    openaiBaseUrl: normalizeBaseUrl(preset.endpoint),
    openaiApiKey: preset.token,
    openaiModel: preset.model,
    databasePath: env.DATABASE_PATH ?? "data/mystery.sqlite",
    openaiHeaders: preset.extra_headers,
    structuredOutputMode: preset.structured_output,
    defaultMaxTokens: preset.max_tokens,
    extraBody: preset.extra_body,
    presetId: preset.id,
    source: "preset",
  };
}

function loadFromOpencodeConfig(env: NodeJS.ProcessEnv) {
  if (!env.OPENCODE_CONFIG_CONTENT) {
    return null;
  }

  const parsed = opencodeConfigSchema.parse(JSON.parse(env.OPENCODE_CONFIG_CONTENT));
  const modelRef = env.OPENAI_MODEL ?? parsed.model;

  if (!modelRef || !parsed.provider) {
    return null;
  }

  const { providerName, modelName } = splitModelRef(modelRef);
  const fallbackProviderName = Object.keys(parsed.provider).find((name) => name.includes("openai"));
  const selectedProviderName = providerName ?? fallbackProviderName;

  if (!selectedProviderName) {
    return null;
  }

  const provider = parsed.provider[selectedProviderName];
  const baseURL = env.OPENAI_BASE_URL ?? provider?.options?.baseURL;
  const apiKey = env.OPENAI_API_KEY ?? provider?.options?.apiKey;

  if (!baseURL || !apiKey || !modelName) {
    return null;
  }

  return {
    openaiBaseUrl: normalizeBaseUrl(baseURL),
    openaiApiKey: apiKey,
    openaiModel: modelName,
    databasePath: env.DATABASE_PATH ?? "data/mystery.sqlite",
    openaiHeaders: provider?.options?.headers,
    source: "opencode" as const,
  };
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return loadRuntimeConfigForRole("default", env);
}

export function loadRuntimeConfigForRole(role: RuntimeRole, env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const specificPresetId = role === "generator" ? env.CASE_GENERATOR_PRESET_ID : role === "reviewer" ? env.CASE_REVIEWER_PRESET_ID : undefined;
  if (specificPresetId) {
    const fromSpecificPreset = loadFromPreset(env, role);
    if (fromSpecificPreset) {
      return fromSpecificPreset;
    }
  }

  const envBaseUrl = env.OPENAI_BASE_URL;
  const envApiKey = env.OPENAI_API_KEY;
  const envModel = env.OPENAI_MODEL;

  if (envBaseUrl && envApiKey && envModel) {
    return {
      openaiBaseUrl: normalizeBaseUrl(envBaseUrl),
      openaiApiKey: envApiKey,
      openaiModel: envModel,
      databasePath: env.DATABASE_PATH ?? "data/mystery.sqlite",
      structuredOutputMode: env.OPENAI_STRUCTURED_OUTPUT === "tool_call" ? "tool_call" : undefined,
      source: "env",
    };
  }

  const fromOpencode = loadFromOpencodeConfig(env);
  if (fromOpencode) {
    return fromOpencode;
  }

  const fromPreset = loadFromPreset(env, role);
  if (fromPreset) {
    return fromPreset;
  }

  throw new Error(
    "未找到可用模型配置。请提供 OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL，或配置 AI_PRESET_ID / CASE_GENERATOR_PRESET_ID / CASE_REVIEWER_PRESET_ID，或在 opencode 环境中运行。",
  );
}
