import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";

import { archiveApprovedCase, DEFAULT_ARCHIVE_DIR, listArchivedCases, loadArchivedCase } from "../archive/story-archive.js";
import { generateCasePackageWithDiagnostics, PLAYABLE_CASE_GENERATION_OPTIONS } from "../case/generator.js";
import type { InvestigationNode, MysteryCase, Npc, Suspect } from "../case/schema.js";
import { streamSuspectReply } from "../chat/suspect-chat.js";
import { loadRuntimeConfig, loadRuntimeConfigForRole } from "../config/runtime-config.js";
import { judgeAccusation, revealSolution } from "../judgement/judge.js";
import { OpenAiGateway } from "../llm/openai-gateway.js";
import { SessionStore, type StoredSession } from "../session/store.js";

const playConfig = loadRuntimeConfig();
const generationConfig = loadRuntimeConfigForRole("generator");
const reviewConfig = loadRuntimeConfigForRole("reviewer");

const playGateway = new OpenAiGateway(playConfig);
const generationGateway = new OpenAiGateway(generationConfig);
const reviewGateway = new OpenAiGateway(reviewConfig);
const archiveDir = process.env.ARCHIVE_DIR ?? DEFAULT_ARCHIVE_DIR;
const store = new SessionStore(playConfig.databasePath);
const generationJobs = new Map<string, GenerationJob>();

const HOST = process.env.WEB_HOST ?? "127.0.0.1";
const PORT = Number(process.env.WEB_PORT ?? 3001);

type GenerationJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: {
    phase: string;
    message: string;
    attempt: number;
    totalAttempts: number;
  };
  session?: ReturnType<typeof serializeSession>;
  review?: unknown;
  archivePath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type GenerationProgressState = {
  phase: string;
  message: string;
  attempt: number;
  totalAttempts: number;
};

const GENERATION_HEARTBEAT_MS = 5000;

function getLatestActiveGenerationJob() {
  return [...generationJobs.values()]
    .filter((job) => job.status === "queued" || job.status === "running")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function getLatestGenerationJob() {
  return [...generationJobs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function serializeGenerationJobPreview(job: GenerationJob) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function collectExistingCaseTitles() {
  return Array.from(new Set([...store.listCaseTitles(), ...listArchivedCases(archiveDir).map((item) => item.title)]));
}

function buildDownloadFileName(title: string) {
  const safeTitle = title.replace(/[<>:"/\\|?*]+/g, "-").trim() || "mystery-case";
  return `${safeTitle}.json`;
}

function readStaticFile(relativePath: string) {
  return readFileSync(new URL(`./static/${relativePath}`, import.meta.url), "utf-8");
}

const INDEX_HTML = readStaticFile("index.html");
const APP_JS = readStaticFile("app.js");
const STYLES_CSS = readStaticFile("styles.css");
const FAVICON_SVG = readStaticFile("favicon.svg");

function visitedNodes(mysteryCase: MysteryCase, session: StoredSession): InvestigationNode[] {
  return mysteryCase.investigationNodes.filter((node) => session.state.visitedNodeIds.includes(node.id));
}

function allCharacters(mysteryCase: MysteryCase): Array<Suspect | Npc> {
  return [...mysteryCase.suspects, ...(mysteryCase.npcs ?? [])];
}

function getSessionContext(sessionId: string) {
  const session = store.getSession(sessionId);
  if (!session) {
    throw new Error("会话不存在。",);
  }

  const mysteryCase = store.getCase(session.caseId);
  if (!mysteryCase) {
    throw new Error("案件不存在。",);
  }

  return { session, mysteryCase };
}

function serializeSession(mysteryCase: MysteryCase, session: StoredSession) {
  return {
    sessionId: session.id,
    status: session.status,
    title: mysteryCase.title,
    openingNarration: mysteryCase.openingNarration,
    publicSummary: mysteryCase.publicSummary,
    playerGoal: mysteryCase.playerGoal,
    storyContext: mysteryCase.storyContext,
    sceneVisualSummary: mysteryCase.sceneVisualSummary,
    sceneSvg: mysteryCase.sceneSvg,
    victim: mysteryCase.victim,
    suspects: mysteryCase.suspects.map((suspect) => ({
      id: suspect.id,
      name: suspect.name,
      publicPersona: suspect.publicPersona,
      relationshipToVictim: suspect.relationshipToVictim,
      possibleMotive: suspect.possibleMotive,
      alibi: suspect.alibi,
      appearanceSummary: suspect.appearanceSummary,
      avatarSvg: suspect.avatarSvg,
    })),
    npcs: (mysteryCase.npcs ?? []).map((npc) => ({
      id: npc.id,
      name: npc.name,
      publicPersona: npc.publicPersona,
      relationshipToVictim: npc.relationshipToVictim,
      whyRelevant: npc.whyRelevant,
      appearanceSummary: npc.appearanceSummary,
      avatarSvg: npc.avatarSvg,
    })),
    investigationNodes: mysteryCase.investigationNodes.map((node) => ({
      id: node.id,
      title: node.title,
      category: node.category,
      visited: session.state.visitedNodeIds.includes(node.id),
      visualHint: node.visualHint,
    })),
    notebook: visitedNodes(mysteryCase, session).map((node) => ({
      id: node.id,
      title: node.title,
      summary: node.summary,
      discovery: node.discovery,
      contradictionIds: node.contradictionIds,
    })),
  };
}

function serializeBootstrap() {
  const latestSession = store.getLatestActiveSession();
  const latestCase = latestSession ? store.getCase(latestSession.caseId) : null;
  const activeGenerationJob = getLatestActiveGenerationJob();
  const latestGenerationJob = getLatestGenerationJob();

  return {
    latestSession:
      latestSession && latestCase
        ? {
            sessionId: latestSession.id,
            title: latestCase.title,
            summary: latestCase.publicSummary,
          }
        : null,
    activeGenerationJob: activeGenerationJob ? serializeGenerationJobPreview(activeGenerationJob) : null,
    latestGenerationJob: latestGenerationJob ? serializeGenerationJobPreview(latestGenerationJob) : null,
    archives: listArchivedCases(archiveDir).map((item) => ({
      archiveId: item.archiveId,
      title: item.title,
      template: item.template,
      suspects: item.suspects,
      overallScore: item.overallScore,
    })),
    models: {
      play: playGateway.describe(),
      generator: generationGateway.describe(),
      reviewer: reviewGateway.describe(),
    },
  };
}

async function readJsonBody(request: IncomingMessage) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
  }

  if (!raw) {
    return {} as Record<string, unknown>;
  }

  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response: ServerResponse, statusCode: number, payload: string, contentType: string) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

function sendJsonDownload(response: ServerResponse, fileName: string, payload: unknown) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  });
  response.end(JSON.stringify(payload, null, 2));
}

function updateGenerationJob(jobId: string, patch: Partial<GenerationJob>) {
  const current = generationJobs.get(jobId);
  if (!current) {
    return;
  }

  generationJobs.set(jobId, {
    ...current,
    ...patch,
    progress: patch.progress ?? current.progress,
    updatedAt: new Date().toISOString(),
  });
}

function formatUserVisibleGenerationError(error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (errorMessage.includes("模型请求超时")) {
    return `${errorMessage}，当前这次初稿生成已经卡住，可直接重新发起一局。`;
  }

  if (
    errorMessage.includes("Unterminated string") ||
    errorMessage.includes("模型 JSON 校验失败") ||
    errorMessage.includes("invalid_type") ||
    errorMessage.includes("模型没有返回结构化内容")
  ) {
    return "模型这轮返回了不完整的结构化结果，当前这次生成失败，可直接重新发起一局。";
  }

  return errorMessage;
}

async function createNewSession(jobId?: string) {
  console.log("[Web] 开始生成可玩案件...");
  const startedAt = Date.now();
  let latestProgress: GenerationProgressState = {
    phase: "starting",
    message: "正在启动生成任务...",
    attempt: 0,
    totalAttempts: PLAYABLE_CASE_GENERATION_OPTIONS.maxAttempts ?? 2,
  };
  let phaseStartedAt = Date.now();

  const heartbeat =
    jobId === undefined
      ? undefined
      : setInterval(() => {
          const waitedSeconds = Math.max(1, Math.floor((Date.now() - phaseStartedAt) / 1000));
          updateGenerationJob(jobId, {
            status: "running",
            progress: {
              ...latestProgress,
              message: `${latestProgress.message} 已等待 ${waitedSeconds} 秒。`,
            },
          });
        }, GENERATION_HEARTBEAT_MS);

  try {
    const result = await generateCasePackageWithDiagnostics(
      generationGateway,
      undefined,
      reviewGateway,
      {
        ...PLAYABLE_CASE_GENERATION_OPTIONS,
        existingTitles: collectExistingCaseTitles(),
        onProgress: async (event) => {
          if (!jobId) {
            return;
          }

          latestProgress = event;
          phaseStartedAt = Date.now();
          console.log(`[Web] 生成进度：${event.message}`);

          updateGenerationJob(jobId, {
            status: "running",
            progress: event,
          });
        },
      },
    );
    const mysteryCase = result.mysteryCase;
    console.log(`[Web] 可玩案件生成完成：${mysteryCase.title}，尝试次数=${result.diagnostics.attemptCount}，耗时=${Date.now() - startedAt}ms`);

    store.saveCase(mysteryCase);

    const archivePath = archiveApprovedCase(
      {
        archiveId: `archive_${crypto.randomUUID()}`,
        archivedAt: new Date().toISOString(),
        source: {
          model: generationGateway.describe().model,
          reviewModel: reviewGateway.describe().model,
          presetId: generationGateway.describe().presetId,
          reviewPresetId: reviewGateway.describe().presetId,
          structuredOutputMode: generationGateway.describe().structuredOutputMode,
        },
        diagnostics: result.diagnostics,
        review: result.diagnostics.review,
        mysteryCase,
      },
      archiveDir,
    );

    const session = store.createSession(mysteryCase.id);
    return {
      session: serializeSession(mysteryCase, session),
      archivePath,
      review: result.diagnostics.review,
    };
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}

function startGenerationJob() {
  const jobId = `job_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  generationJobs.set(jobId, {
    id: jobId,
    status: "queued",
    progress: {
      phase: "queued",
      message: "已收到请求，正在排队准备生成案件...",
      attempt: 0,
      totalAttempts: PLAYABLE_CASE_GENERATION_OPTIONS.maxAttempts ?? 2,
    },
    createdAt: now,
    updatedAt: now,
  });

  void (async () => {
    try {
      updateGenerationJob(jobId, {
        status: "running",
        progress: {
          phase: "starting",
          message: "正在启动生成任务...",
          attempt: 0,
          totalAttempts: PLAYABLE_CASE_GENERATION_OPTIONS.maxAttempts ?? 2,
        },
      });

      const result = await createNewSession(jobId);
      updateGenerationJob(jobId, {
        status: "completed",
        session: result.session,
        review: result.review,
        archivePath: result.archivePath,
        progress: {
          phase: "completed",
          message: `案件《${result.session.title}》已生成完成。`,
          attempt: PLAYABLE_CASE_GENERATION_OPTIONS.maxAttempts ?? 2,
          totalAttempts: PLAYABLE_CASE_GENERATION_OPTIONS.maxAttempts ?? 2,
        },
      });
    } catch (error) {
      const userVisibleMessage = formatUserVisibleGenerationError(error);
      console.error("[Web] 生成案件失败：", error);
      updateGenerationJob(jobId, {
        status: "failed",
        error: userVisibleMessage,
        progress: {
          phase: "failed",
          message: userVisibleMessage,
          attempt: PLAYABLE_CASE_GENERATION_OPTIONS.maxAttempts ?? 2,
          totalAttempts: PLAYABLE_CASE_GENERATION_OPTIONS.maxAttempts ?? 2,
        },
      });
    }
  })();

  return jobId;
}

async function handleInvestigation(sessionId: string, nodeId: string) {
  const { session, mysteryCase } = getSessionContext(sessionId);
  const node = mysteryCase.investigationNodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new Error("调查节点不存在。",);
  }

  if (!session.state.visitedNodeIds.includes(nodeId)) {
    store.updateSessionState(session.id, (state) => ({
      ...state,
      visitedNodeIds: [...state.visitedNodeIds, nodeId],
    }));
  }

  return {
    node,
    session: serializeSession(mysteryCase, store.getSession(session.id) ?? session),
  };
}

async function handleChatStream(request: IncomingMessage, response: ServerResponse, sessionId: string, suspectId: string) {
  const { userInput } = (await readJsonBody(request)) as { userInput?: string };
  if (!userInput?.trim()) {
    sendJson(response, 400, { error: "聊天内容不能为空。" });
    return;
  }

  const { session, mysteryCase } = getSessionContext(sessionId);
    const character = allCharacters(mysteryCase).find((item) => item.id === suspectId) as Suspect | Npc | undefined;
    if (!character) {
      sendJson(response, 404, { error: "角色不存在。" });
      return;
    }

  const history = store.listMessages(session.id, character.id);
  store.appendMessage(session.id, character.id, "user", userInput.trim());

  response.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });

  let assistantReply = "";

  try {
    for await (const chunk of streamSuspectReply(
      playGateway,
      mysteryCase,
      character,
      visitedNodes(mysteryCase, session),
      history,
      userInput.trim(),
    )) {
      assistantReply += chunk;
      response.write(chunk);
    }

    if (assistantReply.trim()) {
      store.appendMessage(session.id, character.id, "assistant", assistantReply);
    }

    response.end();
  } catch (error) {
    if (assistantReply.trim()) {
      store.appendMessage(session.id, character.id, "assistant", assistantReply);
    }

    response.write(`\n\n[系统] 回复中断：${error instanceof Error ? error.message : String(error)}`);
    response.end();
  }
}

async function routeApi(request: IncomingMessage, response: ServerResponse, pathname: string) {
  if (request.method === "GET" && pathname === "/api/bootstrap") {
    sendJson(response, 200, serializeBootstrap());
    return;
  }

  if (request.method === "POST" && pathname === "/api/session/new") {
    const activeGenerationJob = getLatestActiveGenerationJob();
    sendJson(response, 202, {
      jobId: activeGenerationJob?.id ?? startGenerationJob(),
      reused: Boolean(activeGenerationJob),
    });
    return;
  }

  const jobMatch = pathname.match(/^\/api\/generation-jobs\/([^/]+)$/u);
  if (request.method === "GET" && jobMatch) {
    const job = generationJobs.get(jobMatch[1]!);
    if (!job) {
      sendJson(response, 404, { error: "生成任务不存在。" });
      return;
    }

    sendJson(response, 200, job);
    return;
  }

  if (request.method === "POST" && pathname === "/api/session/resume-latest") {
    const latest = store.getLatestActiveSession();
    if (!latest) {
      sendJson(response, 404, { error: "没有可恢复的最近一局。" });
      return;
    }

    const mysteryCase = store.getCase(latest.caseId);
    if (!mysteryCase) {
      sendJson(response, 404, { error: "最近一局案件不存在。" });
      return;
    }

    sendJson(response, 200, { session: serializeSession(mysteryCase, latest) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/session/from-archive") {
    const { archiveId } = (await readJsonBody(request)) as { archiveId?: string };
    const archiveSummary = listArchivedCases(archiveDir).find((item) => item.archiveId === archiveId);
    if (!archiveSummary) {
      sendJson(response, 404, { error: "归档案件不存在。" });
      return;
    }

    const archive = loadArchivedCase(archiveSummary.filePath);
    store.saveCase(archive.mysteryCase);
    const session = store.createSession(archive.mysteryCase.id);
    sendJson(response, 200, { session: serializeSession(archive.mysteryCase, session) });
    return;
  }

  const investigateMatch = pathname.match(/^\/api\/session\/([^/]+)\/investigate$/u);
  if (request.method === "POST" && investigateMatch) {
    const { nodeId } = (await readJsonBody(request)) as { nodeId?: string };
    if (!nodeId) {
      sendJson(response, 400, { error: "缺少 nodeId。" });
      return;
    }

    sendJson(response, 200, await handleInvestigation(investigateMatch[1]!, nodeId));
    return;
  }

  const sessionMatch = pathname.match(/^\/api\/session\/([^/]+)$/u);
  if (request.method === "GET" && sessionMatch) {
    const { session, mysteryCase } = getSessionContext(sessionMatch[1]!);
    sendJson(response, 200, { session: serializeSession(mysteryCase, session) });
    return;
  }

  const messageMatch = pathname.match(/^\/api\/session\/([^/]+)\/messages\/([^/]+)$/u);
  if (request.method === "GET" && messageMatch) {
    const sessionId = messageMatch[1]!;
    const suspectId = messageMatch[2]!;
    sendJson(response, 200, { messages: store.listMessages(sessionId, suspectId) });
    return;
  }

  const chatMatch = pathname.match(/^\/api\/session\/([^/]+)\/chat\/([^/]+)$/u);
  if (request.method === "POST" && chatMatch) {
    await handleChatStream(request, response, chatMatch[1]!, chatMatch[2]!);
    return;
  }

  const accuseMatch = pathname.match(/^\/api\/session\/([^/]+)\/accuse$/u);
  if (request.method === "POST" && accuseMatch) {
    const { suspectId } = (await readJsonBody(request)) as { suspectId?: string };
    if (!suspectId) {
      sendJson(response, 400, { error: "缺少 suspectId。" });
      return;
    }

    const { session, mysteryCase } = getSessionContext(accuseMatch[1]!);
    store.updateSessionState(session.id, (state) => ({
      ...state,
      accusedSuspectId: suspectId,
    }));
    store.updateSessionStatus(session.id, "solved");
    sendJson(response, 200, {
      judgement: judgeAccusation(mysteryCase, suspectId),
      session: serializeSession(mysteryCase, store.getSession(session.id) ?? session),
    });
    return;
  }

  const revealMatch = pathname.match(/^\/api\/session\/([^/]+)\/reveal$/u);
  if (request.method === "POST" && revealMatch) {
    const { session, mysteryCase } = getSessionContext(revealMatch[1]!);
    store.updateSessionState(session.id, (state) => ({
      ...state,
      accusedSuspectId: mysteryCase.solution.culpritId,
    }));
    store.updateSessionStatus(session.id, "solved");
    sendJson(response, 200, {
      judgement: revealSolution(mysteryCase),
      session: serializeSession(mysteryCase, store.getSession(session.id) ?? session),
    });
    return;
  }

  const exportMatch = pathname.match(/^\/api\/session\/([^/]+)\/export$/u);
  if (request.method === "GET" && exportMatch) {
    const { mysteryCase } = getSessionContext(exportMatch[1]!);
    sendJsonDownload(response, buildDownloadFileName(mysteryCase.title), mysteryCase);
    return;
  }

  sendJson(response, 404, { error: "接口不存在。" });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const { pathname } = url;

    if (pathname === "/") {
      sendText(response, 200, INDEX_HTML, "text/html; charset=utf-8");
      return;
    }

    if (pathname === "/app.js") {
      sendText(response, 200, APP_JS, "application/javascript; charset=utf-8");
      return;
    }

    if (pathname === "/styles.css") {
      sendText(response, 200, STYLES_CSS, "text/css; charset=utf-8");
      return;
    }

    if (pathname === "/favicon.svg" || pathname === "/favicon.ico") {
      sendText(response, 200, FAVICON_SVG, "image/svg+xml; charset=utf-8");
      return;
    }

    if (pathname.startsWith("/api/")) {
      await routeApi(request, response, pathname);
      return;
    }

    sendText(response, 404, "Not Found", "text/plain; charset=utf-8");
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Web 游戏已启动：http://${HOST}:${PORT}`);
});

server.on("error", (error) => {
  if (typeof error === "object" && error && "code" in error && error.code === "EADDRINUSE") {
    console.error(`Web 端口 ${PORT} 已被占用。可改用 WEB_PORT=其他端口 npm run web`);
    process.exitCode = 1;
    return;
  }

  console.error(error);
  process.exitCode = 1;
});
