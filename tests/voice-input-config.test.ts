import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { loadVoiceInputConfig } from "../src/config/voice-input-config.js";

describe("loadVoiceInputConfig", () => {
  it("未配置火山语音输入时返回 null", () => {
    expect(loadVoiceInputConfig({})).toBeNull();
  });

  it("读取本项目 VOICE_INPUT_* 环境变量", () => {
    expect(
      loadVoiceInputConfig({
        VOICE_INPUT_APP_ID: "app-id",
        VOICE_INPUT_ACCESS_TOKEN: "access-token",
        VOICE_INPUT_RESOURCE_ID: "resource-id",
        VOICE_INPUT_ENDPOINT: "wss://voice.example.com/asr",
        VOICE_INPUT_LANGUAGE: "zh-CN",
        VOICE_INPUT_CHUNK_MS: "240",
        VOICE_INPUT_END_WINDOW_SIZE: "1200",
        VOICE_INPUT_MAX_DURATION_SECONDS: "90",
        VOICE_INPUT_SAMPLE_RATE: "16000",
        VOICE_INPUT_BITS: "16",
        VOICE_INPUT_CHANNELS: "1",
      }),
    ).toEqual({
      provider: "volcengine",
      language: "zh-CN",
      chunkMs: 240,
      endWindowSize: 1200,
      maxDurationSeconds: 90,
      rate: 16000,
      bits: 16,
      channels: 1,
      providerConfig: {
        endpoint: "wss://voice.example.com/asr",
        appId: "app-id",
        accessToken: "access-token",
        resourceId: "resource-id",
      },
    });
  });

  it("兼容 opencode 语音插件的旧环境变量命名", () => {
    expect(
      loadVoiceInputConfig({
        OPENCODE_VOICE2TEXT_APP_ID: "legacy-app-id",
        OPENCODE_VOICE2TEXT_ACCESS_TOKEN: "legacy-access-token",
      }),
    ).toMatchObject({
      provider: "volcengine",
      providerConfig: {
        appId: "legacy-app-id",
        accessToken: "legacy-access-token",
        resourceId: "volc.seedasr.sauc.duration",
        endpoint: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
      },
    });
  });

  it("支持显式读取本地语音配置文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "mystery-voice-config-"));
    const filePath = join(dir, "voice.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        provider: "volcengine",
        providerConfig: {
          appId: "file-app-id",
          accessToken: "file-access-token",
          resourceId: "file-resource-id",
          endpoint: "wss://voice.example.com/from-file",
        },
        language: "zh-CN",
        chunkMs: 320,
      }),
    );

    try {
      expect(
        loadVoiceInputConfig({
          VOICE_INPUT_CONFIG_PATH: filePath,
        }),
      ).toMatchObject({
        provider: "volcengine",
        language: "zh-CN",
        chunkMs: 320,
        providerConfig: {
          appId: "file-app-id",
          accessToken: "file-access-token",
          resourceId: "file-resource-id",
          endpoint: "wss://voice.example.com/from-file",
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
