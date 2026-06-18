import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { beforeEach, describe, expect, it } from "vitest";

type SessionFixture = {
  sessionId: string;
  status: "active" | "solved";
  title: string;
  openingNarration: string;
  publicSummary: string;
  playerGoal: string;
  storyContext: {
    setting: string;
    currentSituation: string;
    whyNow: string;
    knownTensions: string[];
  };
  victim: { name: string; profile: string };
  sceneVisualSummary: string;
  sceneSvg: string;
  suspects: Array<{
    id: string;
    name: string;
    publicPersona: string;
    relationshipToVictim: string;
    possibleMotive: string;
    alibi: string;
    appearanceSummary: string;
    avatarSvg: string | null;
  }>;
  npcs: Array<{
    id: string;
    name: string;
    publicPersona: string;
    relationshipToVictim: string;
    whyRelevant: string;
    appearanceSummary: string;
    avatarSvg: string | null;
  }>;
  hintMaster: {
    id: string;
    name: string;
    publicPersona: string;
    relationshipToVictim: string;
    whyRelevant: string;
    appearanceSummary: string;
    avatarSvg: string | null;
  };
  investigationNodes: Array<{ id: string; title: string; category: string; visualHint?: string }>;
  notebook: Array<{ id: string; title: string; summary: string; discovery: string; contradictionIds: string[] }>;
};

const appSource = fs
  .readFileSync(path.join(process.cwd(), "src/web/static/app.js"), "utf8")
  .replace(
    /loadBootstrap\(\)\.catch\([\s\S]*?window\.addEventListener\?\.\("beforeunload", \(\) => \{\s*persistChatLocalCacheNow\(\);\s*\}\);\s*$/s,
    "",
  );

function createSession(status: "active" | "solved"): SessionFixture {
  return {
    sessionId: "session_test",
    status,
    title: "测试案件",
    openingNarration: "开场",
    publicSummary: "摘要",
    playerGoal: "目标",
    storyContext: {
      setting: "设定",
      currentSituation: "现状",
      whyNow: "起因",
      knownTensions: [],
    },
    victim: { name: "死者", profile: "受害者" },
    sceneVisualSummary: "现场",
    sceneSvg: "<svg></svg>",
    suspects: [],
    npcs: [],
    hintMaster: {
      id: "hint_master",
      name: "提示官",
      publicPersona: "解释者",
      relationshipToVictim: "场外主持",
      whyRelevant: "解答疑问",
      appearanceSummary: "冷静",
      avatarSvg: null,
    },
    investigationNodes: [],
    notebook: [],
  };
}

function createJudgement() {
  return {
    correct: true,
    culpritName: "真凶",
    accusedName: "真凶",
    summary: "已破案",
    truthReveal: "完整真相",
    culpritPlan: ["第一步", "第二步"],
    redHerrings: ["误导线索"],
    keyContradictions: [{ title: "时间矛盾", summary: "表面不对", implication: "说明伪造" }],
    hiddenRelationships: [{ surface: "合作", hiddenTruth: "互相掩护" }],
  };
}

function createSessionWithSuspect(status: "active" | "solved"): SessionFixture {
  return {
    ...createSession(status),
    suspects: [
      {
        id: "S1",
        name: "周国良",
        publicPersona: "嫌疑人",
        relationshipToVictim: "生意伙伴",
        possibleMotive: "金钱纠纷",
        alibi: "案发时在一楼抽烟",
        appearanceSummary: "穿深色大衣，神情紧绷。",
        avatarSvg: null,
      },
    ],
  };
}

function withSessionId(session: SessionFixture, sessionId: string): SessionFixture {
  return {
    ...session,
    sessionId,
  };
}

function createRuntime(options?: {
  session?: SessionFixture;
  sessions?: SessionFixture[];
  resumeLatestSessionId?: string;
  bootstrapLatestSessionId?: string;
  storageSeed?: Record<string, string>;
}) {
  const storage = new Map(Object.entries(options?.storageSeed ?? {}));
  const requests: Array<{ url: string; body?: string }> = [];
  const appNode = { innerHTML: "" };
  const primarySession = options?.session ?? createSession("active");
  const sessions = options?.sessions ?? [primarySession];
  const sessionById = new Map(sessions.map((session) => [session.sessionId, session]));
  const resumeLatestSession =
    (options?.resumeLatestSessionId ? sessionById.get(options.resumeLatestSessionId) : null) ?? primarySession;
  const bootstrapLatestSession =
    (options?.bootstrapLatestSessionId ? sessionById.get(options.bootstrapLatestSessionId) : null) ?? resumeLatestSession;

  const context = {
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    ReadableStream,
    navigator: { mediaDevices: {} },
    window: {
      requestAnimationFrame: (callback: () => void) => callback(),
      addEventListener() {},
      confirm: () => true,
    },
    localStorage: {
      getItem(key: string) {
        return storage.has(key) ? storage.get(key)! : null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
    },
    document: {
      body: { appendChild() {}, removeChild() {} },
      querySelector(selector: string) {
        return selector === "#app" ? appNode : null;
      },
      querySelectorAll() {
        return [];
      },
      createElement() {
        return { click() {}, remove() {}, setAttribute() {}, style: {}, rel: "", href: "", download: "" };
      },
    },
    fetch: async (url: string, requestOptions?: { body?: string }) => {
      requests.push({ url, body: requestOptions?.body });

      if (url === "/api/session/resume-latest") {
        return {
          ok: true,
          text: async () => JSON.stringify({ session: resumeLatestSession }),
        };
      }

      const sessionMatch = url.match(/^\/api\/session\/([^/]+)$/u);
      if (sessionMatch) {
        const matchedSession = sessionById.get(sessionMatch[1]!);
        if (!matchedSession) {
          return {
            ok: false,
            text: async () => JSON.stringify({ error: "会话不存在。" }),
          };
        }

        return {
          ok: true,
          text: async () => JSON.stringify({ session: matchedSession }),
        };
      }

      if (url === "/api/bootstrap") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            latestSession: {
              sessionId: bootstrapLatestSession.sessionId,
              title: bootstrapLatestSession.title,
              summary: bootstrapLatestSession.publicSummary,
            },
            activeGenerationJob: null,
            latestGenerationJob: null,
            archives: [],
            models: {
              play: { model: "test-play" },
              generator: { model: "test-generator" },
              reviewer: { model: "test-reviewer" },
            },
            voiceInput: { enabled: false },
            adminEnabled: false,
          }),
        };
      }

      const hintChatMatch = url.match(/^\/api\/session\/([^/]+)\/chat\/hint_master$/u);
      if (hintChatMatch) {
        return {
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("答复"));
              controller.close();
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    },
  };

  vm.createContext(context);
  vm.runInContext(appSource, context);
  vm.runInContext(
    `render = () => {}; syncCharacterChatView = () => true; refreshActiveView = () => {}; focusChatInput = () => {};`,
    context,
  );

  return {
    appNode,
    context,
    storage,
    requests,
    async run<T = unknown>(expression: string) {
      return (await vm.runInContext(expression, context)) as T;
    },
  };
}

describe("web chat local cache restore", () => {
  beforeEach(() => {
    // Keep tests isolated; each runtime owns its own in-memory localStorage.
  });

  it("restores normal sidebar hint master chat from local cache", async () => {
    const cachePayload = {
      activeSessionId: "session_test",
      selectedCharacterId: "hint_master",
      hintMasterChatMode: "sidebar",
      selectedNodeId: null,
      messagesByCharacter: {
        hint_master: [{ role: "assistant", content: "普通提示历史" }],
      },
      draftsByCharacter: {
        hint_master: "下一步该查哪？",
      },
      judgement: null,
    };

    const runtime = createRuntime({
      session: createSession("active"),
      storageSeed: {
        "mystery-web-chat-cache-v1": JSON.stringify(cachePayload),
      },
    });

    await runtime.run("restoreCachedSessionView()");

    expect(await runtime.run("state.selectedCharacterId")).toBe("hint_master");
    expect(await runtime.run("state.hintMasterChatMode")).toBe("sidebar");
    expect(await runtime.run("JSON.stringify(currentMessages())")).toContain("普通提示历史");
    expect(await runtime.run("currentChatDraft()")).toBe("下一步该查哪？");
    expect(await runtime.run("state.judgement")).toBeNull();
  });

  it("restores suspect chat and draft from local cache after refresh", async () => {
    const cachePayload = {
      activeSessionId: "session_test",
      selectedCharacterId: "S1",
      hintMasterChatMode: null,
      selectedNodeId: null,
      messagesByCharacter: {
        S1: [{ role: "assistant", content: "我那时候真的在一楼。" }],
      },
      draftsByCharacter: {
        S1: "你为什么改口供？",
      },
      judgement: null,
    };

    const runtime = createRuntime({
      session: createSessionWithSuspect("active"),
      storageSeed: {
        "mystery-web-chat-cache-v1": JSON.stringify(cachePayload),
      },
    });

    await runtime.run("restoreCachedSessionView()");

    expect(await runtime.run("state.selectedCharacterId")).toBe("S1");
    expect(await runtime.run("state.hintMasterChatMode")).toBeNull();
    expect(await runtime.run("JSON.stringify(currentMessages())")).toContain("我那时候真的在一楼。",
    );
    expect(await runtime.run("currentChatDraft()")).toBe("你为什么改口供？");
  });

  it("restores result-page hint master followup from local cache without mixing sidebar history", async () => {
    const cachePayload = {
      activeSessionId: "session_test",
      selectedCharacterId: "hint_master",
      hintMasterChatMode: "judgement",
      selectedNodeId: null,
      messagesByCharacter: {
        hint_master: [{ role: "assistant", content: "左侧普通提示历史" }],
        hint_master__judgement: [{ role: "assistant", content: "结果页复盘历史" }],
      },
      draftsByCharacter: {
        hint_master__judgement: "为什么他要这么做？",
      },
      judgement: createJudgement(),
    };

    const runtime = createRuntime({
      session: createSession("solved"),
      storageSeed: {
        "mystery-web-chat-cache-v1": JSON.stringify(cachePayload),
      },
    });

    await runtime.run("restoreCachedSessionView()");

    expect(await runtime.run("state.selectedCharacterId")).toBe("hint_master");
    expect(await runtime.run("state.hintMasterChatMode")).toBe("judgement");
    expect(await runtime.run("state.judgement.summary")).toBe("已破案");
    expect(await runtime.run("JSON.stringify(currentMessages())")).toContain("结果页复盘历史");
    expect(await runtime.run("JSON.stringify(currentMessages())")).not.toContain("左侧普通提示历史");
    expect(await runtime.run("currentChatDraft()")).toBe("为什么他要这么做？");
    expect(await runtime.run("renderMainPanel()" as string)).toContain("结案结果");

    await runtime.run("sendChat()");

    const chatRequest = runtime.requests.at(-1);
    expect(chatRequest?.url).toBe("/api/session/session_test/chat/hint_master");
    expect(JSON.parse(chatRequest?.body ?? "{}").history).toEqual([{ role: "assistant", content: "结果页复盘历史" }]);
  });

  it("falls back to sidebar hint master mode when cached judgement payload is missing", async () => {
    const cachePayload = {
      activeSessionId: "session_test",
      selectedCharacterId: "hint_master",
      hintMasterChatMode: "judgement",
      selectedNodeId: null,
      messagesByCharacter: {
        hint_master: [{ role: "assistant", content: "普通提示历史" }],
        hint_master__judgement: [{ role: "assistant", content: "旧复盘历史" }],
      },
      draftsByCharacter: {
        hint_master: "给我一点方向",
      },
      judgement: null,
    };

    const runtime = createRuntime({
      session: createSession("solved"),
      storageSeed: {
        "mystery-web-chat-cache-v1": JSON.stringify(cachePayload),
      },
    });

    await runtime.run("restoreCachedSessionView()");

    expect(await runtime.run("state.hintMasterChatMode")).toBe("sidebar");
    expect(await runtime.run("state.judgement")).toBeNull();
    expect(await runtime.run("JSON.stringify(currentMessages())")).toContain("普通提示历史");
    expect(await runtime.run("JSON.stringify(currentMessages())")).not.toContain("旧复盘历史");
  });

  it("restores plain solved result page even when no followup chat is open", async () => {
    const cachePayload = {
      activeSessionId: "session_test",
      selectedCharacterId: null,
      hintMasterChatMode: null,
      selectedNodeId: null,
      messagesByCharacter: {},
      draftsByCharacter: {},
      judgement: createJudgement(),
    };

    const runtime = createRuntime({
      session: createSession("solved"),
      storageSeed: {
        "mystery-web-chat-cache-v1": JSON.stringify(cachePayload),
      },
    });

    await runtime.run("restoreCachedSessionView()");

    expect(await runtime.run("state.selectedCharacterId")).toBeNull();
    expect(await runtime.run("state.judgement.summary")).toBe("已破案");
    const html = await runtime.run<string>("renderMainPanel()");
    expect(html).toContain("结案结果");
    expect(html).not.toContain("继续追问真相细节");
  });

  it("keeps solved judgement and result-page followup when resumeLatest restores from local cache", async () => {
    const cachePayload = {
      activeSessionId: "session_test",
      selectedCharacterId: "hint_master",
      hintMasterChatMode: "judgement",
      selectedNodeId: null,
      messagesByCharacter: {
        hint_master__judgement: [{ role: "assistant", content: "结果页复盘历史" }],
      },
      draftsByCharacter: {
        hint_master__judgement: "为什么是现在？",
      },
      judgement: createJudgement(),
    };

    const runtime = createRuntime({
      session: createSession("solved"),
      storageSeed: {
        "mystery-web-chat-cache-v1": JSON.stringify(cachePayload),
      },
    });

    await runtime.run("resumeLatest()");

    expect(await runtime.run("state.judgement.summary")).toBe("已破案");
    expect(await runtime.run("state.selectedCharacterId")).toBe("hint_master");
    expect(await runtime.run("state.hintMasterChatMode")).toBe("judgement");
    expect(await runtime.run("JSON.stringify(currentMessages())")).toContain("结果页复盘历史");
    expect(await runtime.run("currentChatDraft()")).toBe("为什么是现在？");
    expect(await runtime.run("renderMainPanel()" as string)).toContain("继续追问真相细节");
  });

  it("writes judgement and hint master mode into local cache snapshot", async () => {
    const runtime = createRuntime({ session: createSession("solved") });

    await runtime.run(`
      state.session = ${JSON.stringify(createSession("solved"))};
      state.selectedCharacterId = "hint_master";
      state.hintMasterChatMode = "judgement";
      state.messagesByCharacter = { hint_master__judgement: [{ role: "assistant", content: "结果页复盘历史" }] };
      state.draftsByCharacter = { hint_master__judgement: "还有哪里说得通？" };
      state.judgement = ${JSON.stringify(createJudgement())};
    `);

    const snapshot = await runtime.run<Record<string, unknown>>("buildChatLocalCacheSnapshot()");

    expect(snapshot.hintMasterChatMode).toBe("judgement");
    expect((snapshot.judgement as { summary: string }).summary).toBe("已破案");
    expect(snapshot.messagesByCharacter).toEqual({
      hint_master__judgement: [{ role: "assistant", content: "结果页复盘历史" }],
    });
    expect(snapshot.draftsByCharacter).toEqual({
      hint_master__judgement: "还有哪里说得通？",
    });
  });

  it("keeps local cache after returnToStart even if a delayed persist timer was already queued", async () => {
    const runtime = createRuntime({ session: createSessionWithSuspect("active") });

    await runtime.run(`
      state.session = ${JSON.stringify(createSessionWithSuspect("active"))};
      state.selectedCharacterId = "S1";
      state.messagesByCharacter = { S1: [{ role: "assistant", content: "我真的没进去。" }] };
      state.draftsByCharacter = { S1: "你再说一遍时间线" };
      schedulePersistChatLocalCache();
    `);

    await runtime.run("returnToStart()");
    await new Promise((resolve) => setTimeout(resolve, 140));

    const cached = runtime.storage.get("mystery-web-chat-cache-v1");
    expect(cached).toBeTruthy();
    expect(cached).toContain("我真的没进去。");
    expect(cached).toContain("你再说一遍时间线");
  });

  it("restores suspect chat after returnToStart and then resumeLatest", async () => {
    const runtime = createRuntime({ session: createSessionWithSuspect("active") });

    await runtime.run(`
      state.session = ${JSON.stringify(createSessionWithSuspect("active"))};
      state.selectedCharacterId = "S1";
      state.messagesByCharacter = { S1: [{ role: "assistant", content: "我真的没进去。" }] };
      state.draftsByCharacter = { S1: "你再说一遍时间线" };
      schedulePersistChatLocalCache();
    `);

    await runtime.run("returnToStart()");
    await new Promise((resolve) => setTimeout(resolve, 140));
    await runtime.run("resumeLatest()");

    expect(await runtime.run("state.selectedCharacterId")).toBe("S1");
    expect(await runtime.run("JSON.stringify(currentMessages())")).toContain("我真的没进去。");
    expect(await runtime.run("currentChatDraft()")).toBe("你再说一遍时间线");
  });

  it("resumeLatest prefers the browser cached session instead of another newer server session", async () => {
    const cachedSession = withSessionId(createSessionWithSuspect("active"), "session_cached");
    const newerServerSession = withSessionId(createSession("active"), "session_server_latest");
    const cachePayload = {
      activeSessionId: "session_cached",
      selectedCharacterId: "S1",
      hintMasterChatMode: null,
      selectedNodeId: null,
      messagesByCharacter: {
        S1: [{ role: "assistant", content: "这是缓存局里的嫌疑人口供。" }],
      },
      draftsByCharacter: {
        S1: "缓存局里的追问草稿",
      },
      judgement: null,
    };

    const runtime = createRuntime({
      sessions: [cachedSession, newerServerSession],
      resumeLatestSessionId: "session_server_latest",
      bootstrapLatestSessionId: "session_server_latest",
      storageSeed: {
        "mystery-web-chat-cache-v1": JSON.stringify(cachePayload),
      },
    });

    await runtime.run("resumeLatest()");

    expect(await runtime.run("state.session.sessionId")).toBe("session_cached");
    expect(await runtime.run("state.selectedCharacterId")).toBe("S1");
    expect(await runtime.run("JSON.stringify(currentMessages())")).toContain("这是缓存局里的嫌疑人口供。");
    expect(await runtime.run("currentChatDraft()")).toBe("缓存局里的追问草稿");
    expect(runtime.requests.some((item) => item.url === "/api/session/session_cached")).toBe(true);
    expect(runtime.requests.some((item) => item.url === "/api/session/resume-latest")).toBe(false);
  });

  it("resumeLatest does not fall back to server latest when cached session no longer exists", async () => {
    const fallbackSession = withSessionId(createSessionWithSuspect("active"), "session_server_latest");
    const cachePayload = {
      activeSessionId: "session_missing",
      selectedCharacterId: "S1",
      hintMasterChatMode: null,
      selectedNodeId: null,
      messagesByCharacter: {
        S1: [{ role: "assistant", content: "已经失效的本地缓存。" }],
      },
      draftsByCharacter: {
        S1: "失效草稿",
      },
      judgement: null,
    };

    const runtime = createRuntime({
      sessions: [fallbackSession],
      resumeLatestSessionId: "session_server_latest",
      bootstrapLatestSessionId: "session_server_latest",
      storageSeed: {
        "mystery-web-chat-cache-v1": JSON.stringify(cachePayload),
      },
    });

    await runtime.run("resumeLatest()");

    expect(await runtime.run("state.session")).toBeNull();
    expect(runtime.requests.some((item) => item.url === "/api/session/session_missing")).toBe(true);
    expect(runtime.requests.some((item) => item.url === "/api/session/resume-latest")).toBe(false);
    expect(runtime.storage.has("mystery-web-chat-cache-v1")).toBe(false);
  });

  it("does not show resume button when only server bootstrap has a latest session but browser cache is empty", async () => {
    const runtime = createRuntime({
      sessions: [withSessionId(createSession("active"), "session_server_latest")],
      bootstrapLatestSessionId: "session_server_latest",
    });

    await runtime.run(`
      state.bootstrap = {
        activeGenerationJob: null,
        latestGenerationJob: null,
        archives: [],
        models: { play: { model: "p" }, generator: { model: "g" }, reviewer: { model: "r" } },
        voiceInput: { enabled: false },
        adminEnabled: false,
        latestSession: { sessionId: "session_server_latest", title: "服务端最近局", summary: "不该用于 Web 继续最近一局" },
      };
      renderStart();
    `);

    expect(runtime.appNode.innerHTML.includes('id="resume-latest"')).toBe(false);
    expect(runtime.appNode.innerHTML.includes('id="resume-and-reveal"')).toBe(false);
  });

  it("marks same-title archive as resume-current-session entry when browser cache already has that case", async () => {
    const cachePayload = {
      activeSessionId: "session_cached",
      selectedCharacterId: "S1",
      hintMasterChatMode: null,
      selectedNodeId: null,
      sessionPreview: {
        sessionId: "session_cached",
        caseId: "case_same",
        title: "霜降别墅密室疑案",
        summary: "缓存中的当前案件",
        status: "active",
      },
      messagesByCharacter: {
        S1: [{ role: "assistant", content: "缓存消息" }],
      },
      draftsByCharacter: {},
      judgement: null,
    };

    const runtime = createRuntime({
      session: withSessionId(createSessionWithSuspect("active"), "session_cached"),
      storageSeed: {
        "mystery-web-chat-cache-v1": JSON.stringify(cachePayload),
      },
    });

    await runtime.run(`
      state.bootstrap = {
        activeGenerationJob: null,
        latestGenerationJob: null,
        archives: [
          { archiveId: "archive_same", caseId: "case_same", title: "霜降别墅密室疑案", template: "locked-room", suspects: 4, overallScore: 79 },
          { archiveId: "archive_variant", caseId: "case_variant", title: "霜降别墅密室疑案", template: "locked-room", suspects: 4, overallScore: 81 },
          { archiveId: "archive_other", caseId: "case_other", title: "别的案子", template: "poison", suspects: 4, overallScore: 83 },
        ],
        models: { play: { model: "p" }, generator: { model: "g" }, reviewer: { model: "r" } },
        voiceInput: { enabled: false },
        adminEnabled: false,
      };
      renderStart();
    `);

    expect(runtime.appNode.innerHTML.includes('data-archive-id="archive_same"')).toBe(true);
    expect((runtime.appNode.innerHTML.match(/data-resume-latest="true"/g) ?? []).length).toBe(1);
    expect(runtime.appNode.innerHTML.includes('霜降别墅密室疑案（当前这局）')).toBe(true);
    expect(runtime.appNode.innerHTML.includes('点这里继续当前浏览器这局')).toBe(true);
  });

  it("solved 会话里切去角色详情后，返回案件背景仍能看到结案结果", async () => {
    const runtime = createRuntime({ session: createSessionWithSuspect("solved") });

    await runtime.run(`
      state.session = ${JSON.stringify(createSessionWithSuspect("solved"))};
      state.judgement = ${JSON.stringify(createJudgement())};
      state.selectedCharacterId = "S1";
      render = () => {};
    `);

    expect(await runtime.run("renderMainPanel()" as string)).toContain("周国良");
    await runtime.run("clearSelection()");
    expect(await runtime.run("state.judgement.summary")).toBe("已破案");
    expect(await runtime.run("renderMainPanel()" as string)).toContain("结案结果");
  });

  it("clearChatLocalCacheAction 后，同一局不会再被 beforeunload 重新写回 local cache", async () => {
    const runtime = createRuntime({ session: createSessionWithSuspect("active") });

    await runtime.run(`
      state.session = ${JSON.stringify(createSessionWithSuspect("active"))};
      state.selectedCharacterId = "S1";
      state.messagesByCharacter = { S1: [{ role: "assistant", content: "缓存消息" }] };
      state.draftsByCharacter = { S1: "缓存草稿" };
      confirmAction = async () => true;
      render = () => {};
    `);

    await runtime.run("clearChatLocalCacheAction()");
    const snapshot = await runtime.run<Record<string, unknown>>("buildChatLocalCacheSnapshot()");

    expect(snapshot.activeSessionId).toBeNull();
    expect(snapshot.sessionPreview).toBeNull();
  });
});
