import { bytesToBase64 } from "./utils.js";

export type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

export type VoiceInputConfig = {
  enabled: boolean;
  provider: "workers-ai";
  language: string;
  chunkMs: number;
  maxDurationSeconds: number;
  sampleRate: number;
  bits: number;
  channels: number;
  model: string;
};

const DEFAULT_VOICE_MODEL = "@cf/openai/whisper-large-v3-turbo";

function num(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadVoiceInputConfig(env: {
  VOICE_INPUT_ENABLED?: string;
  VOICE_INPUT_LANGUAGE?: string;
  VOICE_INPUT_CHUNK_MS?: string;
  VOICE_INPUT_MAX_DURATION_SECONDS?: string;
  VOICE_INPUT_MODEL?: string;
}) {
  const enabled = env.VOICE_INPUT_ENABLED !== "false";
  return {
    enabled,
    provider: "workers-ai" as const,
    language: env.VOICE_INPUT_LANGUAGE?.trim() || "zh",
    chunkMs: num(env.VOICE_INPUT_CHUNK_MS, 1000),
    maxDurationSeconds: num(env.VOICE_INPUT_MAX_DURATION_SECONDS, 180),
    sampleRate: 16000,
    bits: 16,
    channels: 1,
    model: env.VOICE_INPUT_MODEL?.trim() || DEFAULT_VOICE_MODEL,
  } satisfies VoiceInputConfig;
}

export function serializeVoiceInputConfig(config: VoiceInputConfig) {
  return {
    enabled: config.enabled,
    provider: config.provider,
    language: config.language,
    chunkMs: config.chunkMs,
    maxDurationSeconds: config.maxDurationSeconds,
    sampleRate: config.sampleRate,
    bits: config.bits,
    channels: config.channels,
  };
}

export function wrapPcm16AsWav(pcmBytes: Uint8Array, config: Pick<VoiceInputConfig, "sampleRate" | "bits" | "channels">) {
  const bytesPerSample = config.bits / 8;
  const blockAlign = config.channels * bytesPerSample;
  const byteRate = config.sampleRate * blockAlign;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, config.channels, true);
  view.setUint32(24, config.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, config.bits, true);
  writeAscii(36, "data");
  view.setUint32(40, pcmBytes.length, true);

  const wavBytes = new Uint8Array(44 + pcmBytes.length);
  wavBytes.set(new Uint8Array(header), 0);
  wavBytes.set(pcmBytes, 44);
  return wavBytes;
}

function extractTranscriptionText(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "";
  }

  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }

  if (record.transcription_info && typeof record.transcription_info === "object") {
    const text = (record.transcription_info as { text?: unknown }).text;
    if (typeof text === "string") {
      return text;
    }
  }

  if (record.response && typeof record.response === "object") {
    const text = (record.response as { text?: unknown }).text;
    if (typeof text === "string") {
      return text;
    }
  }

  return "";
}

export async function transcribeWithWorkersAi(ai: AiBinding, pcmBytes: Uint8Array, config: VoiceInputConfig) {
  if (pcmBytes.length === 0) {
    throw new Error("音频内容不能为空。");
  }

  const wavBytes = wrapPcm16AsWav(pcmBytes, config);
  const response = await ai.run(config.model, {
    audio: bytesToBase64(wavBytes),
    language: config.language,
    task: "transcribe",
    vad_filter: true,
  });
  const text = extractTranscriptionText(response).trim();

  if (!text) {
    throw new Error("没有识别到有效语音，请重试。");
  }

  return {
    text,
    raw: response,
  };
}
