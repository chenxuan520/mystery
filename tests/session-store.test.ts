import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

import { afterEach, describe, expect, it } from "vitest";

import { SessionStore } from "../src/session/store.js";
import { sampleCase } from "./fixtures/sample-case.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("SessionStore", () => {
  it("可以保存案件、恢复最近一局、持久化失败生成记录，并且持久化时不写入运行时 SVG 资源", () => {
    const dir = mkdtempSync(join(tmpdir(), "mystery-cli-"));
    tempDirs.push(dir);

    const databasePath = join(dir, "game.sqlite");

    const store = new SessionStore(databasePath);
    store.saveCase(sampleCase);

    const session = store.createSession(sampleCase.id);
    const anotherSession = store.createSession(sampleCase.id);
    store.updateSessionState(session.id, (state) => ({
      ...state,
      visitedNodeIds: [sampleCase.investigationNodes[0]?.id ?? ""],
    }));
    store.updateSessionStatus(session.id, "solved");

    const latest = store.getLatestActiveSession();
    store.recordGenerationFailure({
      id: "failure_demo_1",
      jobId: "job_demo_1",
      templateType: "locked-room",
      phase: "failed",
      progressMessage: "模型输出被截断。",
      attempt: 2,
      totalAttempts: 3,
      error: "模型输出被截断。",
      rawError: "模型输出被截断。",
      partialOutput: '{"partial":true',
      generatorModel: "deepseek-v4-pro",
      reviewModel: "gpt-5.2",
      generatorPresetId: "deepseek-v4-pro",
      reviewPresetId: "gpt-5-2-json",
      createdAt: "2026-06-18T12:00:00.000Z",
    });
    const latestFailure = store.getLatestGenerationFailure();
    const titles = store.listCaseTitles();
    const rawDb = new Database(databasePath);
    const rawPayload = rawDb.prepare(`SELECT payload FROM cases WHERE id = ?`).get(sampleCase.id) as { payload: string };
    const storedCase = JSON.parse(rawPayload.payload) as { sceneSvg?: string; suspects: Array<{ avatarSvg?: string }> };
    const loadedCase = store.getCase(sampleCase.id);

    expect(loadedCase?.title).toBe(sampleCase.title);
    expect(loadedCase?.sceneSvg?.includes("<svg")).toBe(true);
    expect(titles).toContain(sampleCase.title);
    expect(latest?.id).toBe(anotherSession.id);
    expect(latestFailure?.jobId).toBe("job_demo_1");
    expect(latestFailure?.partialOutput).toBe('{"partial":true');
    expect(storedCase.sceneSvg).toBeUndefined();
    expect(storedCase.suspects.every((suspect) => suspect.avatarSvg === undefined)).toBe(true);

    rawDb.close();
    store.close();
  });
});
