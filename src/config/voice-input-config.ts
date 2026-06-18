import { readFileSync } from "node:fs";

import dotenv from "dotenv";

dotenv.config();

const DEFAULT_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
const DEFAULT_RESOURCE_ID = "volc.seedasr.sauc.duration";
const DEFAULT_LANGUAGE = "zh-CN";
const DEFAULT_CHUNK_MS = 200;
const DEFAULT_END_WINDOW_SIZE = 800;
const DEFAULT_MAX_DURATION_SECONDS = 180;
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_BITS = 16;
const DEFAULT_CHANNELS = 1;

export type VoiceInputConfig = {
  provider: "volcengine";
  language: string;
  chunkMs: number;
  endWindowSize: number;
  maxDurationSeconds: number;
  rate: number;
  bits: number;
  channels: number;
  providerConfig: {
    endpoint: string;
    appId: string;
    accessToken: string;
    resourceId: string;
  };
};

function str(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pick(env: NodeJS.ProcessEnv, primaryKey: string, fallbackKey?: string) {
  return env[primaryKey] ?? (fallbackKey ? env[fallbackKey] : undefined);
}

function loadVoiceInputLocalConfig(configPath: string) {
  if (!configPath) {
    return {} as Record<string, unknown>;
  }

  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function getNestedProviderConfig(config: Record<string, unknown>) {
  const providerConfig = config.providerConfig;
  return typeof providerConfig === "object" && providerConfig !== null && !Array.isArray(providerConfig)
    ? (providerConfig as Record<string, unknown>)
    : {};
}

export function loadVoiceInputConfig(env: NodeJS.ProcessEnv = process.env): VoiceInputConfig | null {
  const configPath = str(pick(env, "VOICE_INPUT_CONFIG_PATH", "OPENCODE_VOICE2TEXT_LOCAL_CONFIG"));
  const localConfig = loadVoiceInputLocalConfig(configPath);
  const localProviderConfig = getNestedProviderConfig(localConfig);
  const provider = str(pick(env, "VOICE_INPUT_PROVIDER", "OPENCODE_VOICE2TEXT_PROVIDER") ?? localConfig.provider, "volcengine");
  if (provider !== "volcengine") {
    return null;
  }

  const appId = str(pick(env, "VOICE_INPUT_APP_ID", "OPENCODE_VOICE2TEXT_APP_ID") ?? localProviderConfig.appId);
  const accessToken = str(
    pick(env, "VOICE_INPUT_ACCESS_TOKEN", "OPENCODE_VOICE2TEXT_ACCESS_TOKEN") ?? localProviderConfig.accessToken,
  );
  const resourceId = str(
    pick(env, "VOICE_INPUT_RESOURCE_ID", "OPENCODE_VOICE2TEXT_RESOURCE_ID") ?? localProviderConfig.resourceId,
    DEFAULT_RESOURCE_ID,
  );

  if (!appId || !accessToken || !resourceId) {
    return null;
  }

  return {
    provider: "volcengine",
    language: str(pick(env, "VOICE_INPUT_LANGUAGE", "OPENCODE_VOICE2TEXT_LANGUAGE") ?? localConfig.language, DEFAULT_LANGUAGE),
    chunkMs: num(pick(env, "VOICE_INPUT_CHUNK_MS", "OPENCODE_VOICE2TEXT_CHUNK_MS") ?? localConfig.chunkMs, DEFAULT_CHUNK_MS),
    endWindowSize: num(
      pick(env, "VOICE_INPUT_END_WINDOW_SIZE", "OPENCODE_VOICE2TEXT_END_WINDOW_SIZE") ?? localConfig.endWindowSize,
      DEFAULT_END_WINDOW_SIZE,
    ),
    maxDurationSeconds: num(
      pick(env, "VOICE_INPUT_MAX_DURATION_SECONDS", "OPENCODE_VOICE2TEXT_MAX_DURATION_SECONDS") ?? localConfig.maxDurationSeconds,
      DEFAULT_MAX_DURATION_SECONDS,
    ),
    rate: num(pick(env, "VOICE_INPUT_SAMPLE_RATE", "OPENCODE_VOICE2TEXT_SAMPLE_RATE") ?? localConfig.rate, DEFAULT_SAMPLE_RATE),
    bits: num(pick(env, "VOICE_INPUT_BITS", "OPENCODE_VOICE2TEXT_BITS") ?? localConfig.bits, DEFAULT_BITS),
    channels: num(pick(env, "VOICE_INPUT_CHANNELS", "OPENCODE_VOICE2TEXT_CHANNELS") ?? localConfig.channels, DEFAULT_CHANNELS),
    providerConfig: {
      endpoint: str(pick(env, "VOICE_INPUT_ENDPOINT", "OPENCODE_VOICE2TEXT_ENDPOINT") ?? localProviderConfig.endpoint, DEFAULT_ENDPOINT),
      appId,
      accessToken,
      resourceId,
    },
  };
}

export function serializeVoiceInputConfig(config: VoiceInputConfig | null) {
  if (!config) {
    return {
      enabled: false,
    };
  }

  return {
    enabled: true,
    provider: config.provider,
    language: config.language,
    chunkMs: config.chunkMs,
    maxDurationSeconds: config.maxDurationSeconds,
    sampleRate: config.rate,
    bits: config.bits,
    channels: config.channels,
  };
}
