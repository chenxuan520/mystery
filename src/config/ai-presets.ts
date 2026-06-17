import { existsSync, readFileSync } from "node:fs";

import YAML from "yaml";
import { z } from "zod";

const aiPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.string().min(1),
  token: z.string().min(1),
  model: z.string().min(1),
  structured_output: z.enum(["json_object", "tool_call"]).optional(),
  max_tokens: z.number().int().positive().optional(),
  extra_body: z.record(z.string(), z.unknown()).optional(),
  extra_headers: z.record(z.string(), z.string()).optional(),
});

const aiPresetFileSchema = z.object({
  presets: z.array(aiPresetSchema).default([]),
});

export type AiPreset = z.infer<typeof aiPresetSchema>;

export function resolvePresetPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.AI_PRESET_PATH;
  if (!configured) {
    return null;
  }

  return existsSync(configured) ? configured : null;
}

export function loadAiPresets(filePath: string): AiPreset[] {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = aiPresetFileSchema.parse(YAML.parse(raw));
  return parsed.presets;
}

export function loadAiPresetById(presetId: string, filePath: string): AiPreset {
  const preset = loadAiPresets(filePath).find((item) => item.id === presetId);
  if (!preset) {
    throw new Error(`未找到 AI preset: ${presetId}`);
  }

  return preset;
}
