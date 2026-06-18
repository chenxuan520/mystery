import { loadAiPresets, resolvePresetPath, type AiPreset } from "./ai-presets.js";

export type AdminAuthConfig = {
  enabled: boolean;
  username: string;
  password: string;
};

export type AdminModelOption = {
  id: string;
  name: string;
  model: string;
  endpoint: string;
};

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function loadAdminAuthConfig(env: NodeJS.ProcessEnv = process.env): AdminAuthConfig {
  const username = str(env.ADMIN_USERNAME);
  const password = str(env.ADMIN_PASSWORD);
  return {
    enabled: Boolean(username && password),
    username,
    password,
  };
}

export function loadAdminModelPresets(env: NodeJS.ProcessEnv = process.env): AiPreset[] {
  const presetPath = resolvePresetPath(env);
  if (!presetPath) {
    return [];
  }

  return loadAiPresets(presetPath);
}

export function serializeAdminModelOptions(presets: AiPreset[]): AdminModelOption[] {
  return presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    model: preset.model,
    endpoint: preset.endpoint,
  }));
}
