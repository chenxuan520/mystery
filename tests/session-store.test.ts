import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  it("可以保存案件、恢复最近一局并保存消息", () => {
    const dir = mkdtempSync(join(tmpdir(), "mystery-cli-"));
    tempDirs.push(dir);

    const store = new SessionStore(join(dir, "game.sqlite"));
    store.saveCase(sampleCase);

    const session = store.createSession(sampleCase.id);
    store.updateSessionState(session.id, (state) => ({
      ...state,
      visitedNodeIds: [sampleCase.investigationNodes[0]?.id ?? ""],
    }));
    store.appendMessage(session.id, sampleCase.suspects[0]!.id, "user", "你昨晚在哪？");
    store.appendMessage(session.id, sampleCase.suspects[0]!.id, "assistant", "我一直在厨房。");

    const latest = store.getLatestActiveSession();
    const messages = store.listMessages(session.id, sampleCase.suspects[0]!.id);
    const titles = store.listCaseTitles();

    expect(store.getCase(sampleCase.id)?.title).toBe(sampleCase.title);
    expect(titles).toContain(sampleCase.title);
    expect(latest?.state.visitedNodeIds).toEqual([sampleCase.investigationNodes[0]!.id]);
    expect(messages).toHaveLength(2);

    store.close();
  });
});
