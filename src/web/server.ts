import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

import { archiveApprovedCase, DEFAULT_ARCHIVE_DIR, deleteArchivedCase, importArchivePayload, listArchivedCases, loadArchivedCase } from "../archive/story-archive.js";
import { CASE_TEMPLATES } from "../case/templates.js";
import { generateCasePackageWithDiagnostics, PLAYABLE_CASE_GENERATION_OPTIONS } from "../case/generator.js";
import type { InvestigationNode, MysteryCase, Npc, Suspect, TemplateType } from "../case/schema.js";
import { sanitizeDialogueHistory } from "../chat/dialogue-memory.js";
import { buildHintMasterCharacter, HINT_MASTER_ID, streamHintMasterReply } from "../chat/hint-master.js";
import { streamSuspectReply } from "../chat/suspect-chat.js";
import { loadAdminAuthConfig, loadAdminModelPresets, serializeAdminModelOptions } from "../config/admin-config.js";
import { loadRuntimeConfig, loadRuntimeConfigForRole, loadRuntimeConfigFromPresetId } from "../config/runtime-config.js";
import { loadVoiceInputConfig, serializeVoiceInputConfig } from "../config/voice-input-config.js";
import { buildFallbackConsequence, evaluateAccusation, judgeAccusation, revealSolution } from "../judgement/judge.js";
import { OpenAiGateway } from "../llm/openai-gateway.js";
import { SessionStore, type StoredGenerationFailure, type StoredSession } from "../session/store.js";
import {
  createVolcengineRecognitionSession,
  diffSuffix,
  transcribePcm16WithVolcengine,
  type VoiceRecognitionSession,
} from "../voice/volcengine-asr.js";

const playConfig = loadRuntimeConfig();
const adminAuthConfig = loadAdminAuthConfig();
const adminModelPresets = loadAdminModelPresets();
const voiceInputConfig = loadVoiceInputConfig();
const archiveDir = process.env.ARCHIVE_DIR ?? DEFAULT_ARCHIVE_DIR;
const store = new SessionStore(playConfig.databasePath);
const generationJobs = new Map<string, GenerationJob>();
const voiceInputSessions = new Map<string, VoiceInputSession>();

const HOST = process.env.WEB_HOST ?? "127.0.0.1";
const PORT = Number(process.env.WEB_PORT ?? 3001);
const ADMIN_COOKIE_NAME = "mystery_admin_session";
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_TOKEN_VERSION = "v1";

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

type VoiceInputSession = {
  id: string;
  recognition: VoiceRecognitionSession;
  pendingStableText: string[];
  createdAt: string;
  updatedAt: string;
};

type AdminModelSelection = {
  playPresetId?: string;
  generatorPresetId?: string;
  reviewerPresetId?: string;
};

const GENERATION_HEARTBEAT_MS = 5000;
const VOICE_INPUT_SESSION_STALE_MS = 5 * 60 * 1000;

function getAdminModelSelection(): AdminModelSelection {
  const stored =
    store.getSetting<AdminModelSelection>("admin.modelSelection") ?? {
      playPresetId: process.env.AI_PRESET_ID,
      generatorPresetId: process.env.CASE_GENERATOR_PRESET_ID,
      reviewerPresetId: process.env.CASE_REVIEWER_PRESET_ID,
    };

  return {
    playPresetId: normalizeAdminSelectionValue(stored.playPresetId),
    generatorPresetId: normalizeAdminSelectionValue(stored.generatorPresetId),
    reviewerPresetId: normalizeAdminSelectionValue(stored.reviewerPresetId),
  };
}

function resolveRuntimeConfigWithSelection(role: "default" | "generator" | "reviewer") {
  const selection = getAdminModelSelection();
  const presetId = role === "default" ? selection.playPresetId : role === "generator" ? selection.generatorPresetId : selection.reviewerPresetId;
  return presetId ? loadRuntimeConfigFromPresetId(presetId) : loadRuntimeConfigForRole(role);
}

function getPlayGateway() {
  return new OpenAiGateway(resolveRuntimeConfigWithSelection("default"));
}

function getGenerationGateway() {
  return new OpenAiGateway(resolveRuntimeConfigWithSelection("generator"));
}

function getReviewGateway() {
  return new OpenAiGateway(resolveRuntimeConfigWithSelection("reviewer"));
}

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

function serializeStoredGenerationFailure(failure: StoredGenerationFailure) {
  return {
    id: failure.jobId,
    status: "failed" as const,
    progress: {
      phase: failure.phase ?? "failed",
      message: failure.progressMessage ?? failure.error,
      attempt: failure.attempt ?? 0,
      totalAttempts: failure.totalAttempts ?? 0,
    },
    error: failure.error,
    rawError: failure.rawError,
    partialOutput: failure.partialOutput,
    templateType: failure.templateType,
    createdAt: failure.createdAt,
    updatedAt: failure.createdAt,
  };
}

function truncateFailurePartialOutput(text: string | undefined, maxChars = 8000) {
  if (!text) {
    return undefined;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxChars)}…`;
}

function buildStoredGenerationFailure(
  jobId: string,
  templateType: TemplateType | undefined,
  error: unknown,
  generatorMeta: ReturnType<OpenAiGateway["describe"]>,
  reviewMeta: ReturnType<OpenAiGateway["describe"]>,
): StoredGenerationFailure {
  const currentJob = generationJobs.get(jobId);
  const rawError = error instanceof Error ? error.message : String(error);
  const partialOutput =
    error && typeof error === "object" && typeof (error as { partialOutput?: unknown }).partialOutput === "string"
      ? truncateFailurePartialOutput((error as { partialOutput?: string }).partialOutput)
      : undefined;

  return {
    id: `generation_failure_${crypto.randomUUID()}`,
    jobId,
    templateType,
    phase: currentJob?.progress?.phase,
    progressMessage: currentJob?.progress?.message,
    attempt: currentJob?.progress?.attempt,
    totalAttempts: currentJob?.progress?.totalAttempts,
    error: formatUserVisibleGenerationError(error),
    rawError,
    partialOutput,
    generatorModel: generatorMeta.model,
    reviewModel: reviewMeta.model,
    generatorPresetId: generatorMeta.presetId,
    reviewPresetId: reviewMeta.presetId,
    createdAt: new Date().toISOString(),
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
const ADMIN_HTML = readStaticFile("admin.html");
const APP_JS = readStaticFile("app.js");
const ADMIN_JS = readStaticFile("admin.js");
const STYLES_CSS = readStaticFile("styles.css");
const FAVICON_SVG = readStaticFile("favicon.svg");
const SWEETALERT_JS = readFileSync(new URL("../../node_modules/sweetalert2/dist/sweetalert2.all.min.js", import.meta.url), "utf-8");
const SWEETALERT_CSS = readFileSync(new URL("../../node_modules/sweetalert2/dist/sweetalert2.min.css", import.meta.url), "utf-8");

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
    caseId: mysteryCase.id,
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
    hintMaster: buildHintMasterCharacter(),
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
  const activeGenerationJob = getLatestActiveGenerationJob();
  const latestGenerationJob = getLatestGenerationJob();
  const latestGenerationFailure = store.getLatestGenerationFailure();
  const playGateway = getPlayGateway();
  const generationGateway = getGenerationGateway();
  const reviewGateway = getReviewGateway();

  return {
    activeGenerationJob: activeGenerationJob ? serializeGenerationJobPreview(activeGenerationJob) : null,
    latestGenerationJob: latestGenerationJob ? serializeGenerationJobPreview(latestGenerationJob) : null,
    latestGenerationFailure: latestGenerationFailure ? serializeStoredGenerationFailure(latestGenerationFailure) : null,
    archives: listArchivedCases(archiveDir).map((item) => ({
      archiveId: item.archiveId,
      caseId: item.caseId,
      title: item.title,
      template: item.template,
      suspects: item.suspects,
      overallScore: item.overallScore,
      archivedAt: item.archivedAt,
      sourceModel: item.sourceModel,
      reviewModel: item.reviewModel,
      presetId: item.presetId,
      reviewPresetId: item.reviewPresetId,
    })),
    models: {
      play: playGateway.describe(),
      generator: generationGateway.describe(),
      reviewer: reviewGateway.describe(),
    },
    voiceInput: serializeVoiceInputConfig(voiceInputConfig),
    adminEnabled: adminAuthConfig.enabled,
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

async function readBinaryBody(request: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error("语音输入音频过长，请缩短后重试。");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function touchVoiceInputSession(sessionId: string) {
  const session = voiceInputSessions.get(sessionId);
  if (!session) {
    return;
  }

  session.updatedAt = new Date().toISOString();
}

async function cleanupStaleVoiceInputSessions() {
  const now = Date.now();
  const staleSessions = [...voiceInputSessions.values()].filter((session) => {
    const updatedAt = Date.parse(session.updatedAt);
    return Number.isFinite(updatedAt) && now - updatedAt > VOICE_INPUT_SESSION_STALE_MS;
  });

  for (const session of staleSessions) {
    voiceInputSessions.delete(session.id);
    await session.recognition.abort().catch(() => undefined);
  }
}

function drainVoiceInputStableText(sessionId: string) {
  const session = voiceInputSessions.get(sessionId);
  if (!session || session.pendingStableText.length === 0) {
    return "";
  }

  const text = session.pendingStableText.join("");
  session.pendingStableText = [];
  session.updatedAt = new Date().toISOString();
  return text;
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  const raw = request.headers.cookie ?? "";
  return Object.fromEntries(
    raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) {
          return [part, ""];
        }
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function adminTokenSecret() {
  return `${ADMIN_TOKEN_VERSION}:${adminAuthConfig.username}:${adminAuthConfig.password}:${playConfig.databasePath}`;
}

function signAdminToken(payloadEncoded: string) {
  return createHmac("sha256", adminTokenSecret()).update(payloadEncoded).digest("base64url");
}

function createAdminToken() {
  const payloadEncoded = encodeBase64Url(
    JSON.stringify({
      u: adminAuthConfig.username,
      exp: Date.now() + ADMIN_SESSION_TTL_MS,
    }),
  );
  return `${payloadEncoded}.${signAdminToken(payloadEncoded)}`;
}

function verifyAdminToken(token: string) {
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return false;
  }

  const payloadEncoded = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expectedSignature = signAdminToken(payloadEncoded);

  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return false;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(payloadEncoded)) as { u?: string; exp?: number };
    return payload.u === adminAuthConfig.username && typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function getAdminSessionToken(request: IncomingMessage) {
  const cookies = parseCookies(request);
  return cookies[ADMIN_COOKIE_NAME];
}

function isAdminAuthenticated(request: IncomingMessage) {
  const token = getAdminSessionToken(request);
  return token ? verifyAdminToken(token) : false;
}

function sendAdminSessionCookie(response: ServerResponse, token: string) {
  response.setHeader(
    "Set-Cookie",
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
  );
}

function clearAdminSessionCookie(response: ServerResponse) {
  response.setHeader("Set-Cookie", `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function assertAdminAccess(request: IncomingMessage, response: ServerResponse) {
  if (!adminAuthConfig.enabled) {
    sendJson(response, 503, { error: "当前未配置 admin 账号密码。" });
    return false;
  }

  if (!isAdminAuthenticated(request)) {
    sendJson(response, 401, { error: "请先登录 admin。" });
    return false;
  }

  return true;
}

function serializeAdminBootstrap() {
  const activeGenerationJob = getLatestActiveGenerationJob();
  const latestGenerationJob = getLatestGenerationJob();
  const latestGenerationFailure = store.getLatestGenerationFailure();

  return {
    user: adminAuthConfig.enabled ? adminAuthConfig.username : null,
    authenticated: true,
    archives: listArchivedCases(archiveDir).map((item) => ({
      archiveId: item.archiveId,
      caseId: item.caseId,
      title: item.title,
      template: item.template,
      suspects: item.suspects,
      overallScore: item.overallScore,
      archivedAt: item.archivedAt,
      sourceModel: item.sourceModel,
      reviewModel: item.reviewModel,
      presetId: item.presetId,
      reviewPresetId: item.reviewPresetId,
    })),
    templates: CASE_TEMPLATES.map((template) => ({
      type: template.type,
      label: template.label,
      brief: template.brief,
    })),
    models: {
      options: serializeAdminModelOptions(adminModelPresets),
      selection: getAdminModelSelection(),
      current: {
        play: getPlayGateway().describe(),
        generator: getGenerationGateway().describe(),
        reviewer: getReviewGateway().describe(),
      },
    },
    activeGenerationJob: activeGenerationJob ? serializeGenerationJobPreview(activeGenerationJob) : null,
    latestGenerationJob: latestGenerationJob ? serializeGenerationJobPreview(latestGenerationJob) : null,
    latestGenerationFailure: latestGenerationFailure ? serializeStoredGenerationFailure(latestGenerationFailure) : null,
  };
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

async function createNewSession(templateType?: TemplateType, jobId?: string) {
  console.log("[Web] 开始生成可玩案件...");
  const generationGateway = getGenerationGateway();
  const reviewGateway = getReviewGateway();
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
      templateType,
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

function startGenerationJob(templateType?: TemplateType) {
  const jobId = `job_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const generatorMeta = getGenerationGateway().describe();
  const reviewMeta = getReviewGateway().describe();
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

      const result = await createNewSession(templateType, jobId);
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
      store.recordGenerationFailure(buildStoredGenerationFailure(jobId, templateType, error, generatorMeta, reviewMeta));
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
  const { userInput, history: rawHistory, confrontNodeId } = (await readJsonBody(request)) as {
    userInput?: string;
    history?: unknown;
    confrontNodeId?: string;
  };
  if (!userInput?.trim()) {
    sendJson(response, 400, { error: "聊天内容不能为空。" });
    return;
  }

  const { session, mysteryCase } = getSessionContext(sessionId);
  const isHintMaster = suspectId === HINT_MASTER_ID;
  const character = isHintMaster ? null : (allCharacters(mysteryCase).find((item) => item.id === suspectId) as Suspect | Npc | undefined);
  if (!isHintMaster && !character) {
    sendJson(response, 404, { error: "角色不存在。" });
    return;
  }

  const confrontNode =
    !isHintMaster && typeof confrontNodeId === "string"
      ? mysteryCase.investigationNodes.find((node) => node.id === confrontNodeId)
      : undefined;

  const history = sanitizeDialogueHistory(rawHistory);
  store.touchSession(session.id);

  response.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });

  let assistantReply = "";
  const playGateway = getPlayGateway();

  try {
    const replyStream = isHintMaster
      ? streamHintMasterReply(playGateway, mysteryCase, visitedNodes(mysteryCase, session), history, userInput.trim(), session.status === "solved")
      : streamSuspectReply(playGateway, mysteryCase, character as Suspect | Npc, visitedNodes(mysteryCase, session), history, userInput.trim(), confrontNode);

    for await (const chunk of replyStream) {
      assistantReply += chunk;
      response.write(chunk);
    }

    response.end();
  } catch (error) {
    response.write(`\n\n[系统] 回复中断：${error instanceof Error ? error.message : String(error)}`);
    response.end();
  }
}

async function handleVoiceInputTranscription(request: IncomingMessage, response: ServerResponse) {
  if (!voiceInputConfig) {
    sendJson(response, 404, { error: "当前未配置语音输入。" });
    return;
  }

  const maxBytes = Math.ceil(
    voiceInputConfig.rate * voiceInputConfig.channels * (voiceInputConfig.bits / 8) * voiceInputConfig.maxDurationSeconds * 1.2,
  );
  const audioBuffer = await readBinaryBody(request, maxBytes);

  if (audioBuffer.length === 0) {
    sendJson(response, 400, { error: "音频内容不能为空。" });
    return;
  }

  const transcript = await transcribePcm16WithVolcengine(audioBuffer, voiceInputConfig);
  const text = (transcript.stableText || transcript.text || "").trim();

  if (!text) {
    sendJson(response, 422, { error: "没有识别到有效语音，请重试。" });
    return;
  }

  sendJson(response, 200, {
    text,
    logId: transcript.logId,
  });
}

async function handleStartVoiceInputSession(response: ServerResponse) {
  if (!voiceInputConfig) {
    sendJson(response, 404, { error: "当前未配置语音输入。" });
    return;
  }

  void cleanupStaleVoiceInputSessions();

  const sessionId = `voice_${crypto.randomUUID()}`;
  const pendingStableText: string[] = [];
  const recognition = await createVolcengineRecognitionSession(voiceInputConfig, {
    onStableText: async (text) => {
      pendingStableText.push(text);
      touchVoiceInputSession(sessionId);
    },
  });

  const now = new Date().toISOString();
  voiceInputSessions.set(sessionId, {
    id: sessionId,
    recognition,
    pendingStableText,
    createdAt: now,
    updatedAt: now,
  });

  sendJson(response, 200, {
    sessionId,
  });
}

async function handleVoiceInputChunk(request: IncomingMessage, response: ServerResponse, sessionId: string) {
  const session = voiceInputSessions.get(sessionId);
  if (!session || !voiceInputConfig) {
    sendJson(response, 404, { error: "语音输入会话不存在。" });
    return;
  }

  const maxChunkBytes = Math.max(
    32 * 1024,
    Math.ceil(voiceInputConfig.rate * voiceInputConfig.channels * (voiceInputConfig.bits / 8) * (voiceInputConfig.chunkMs / 1000) * 4),
  );
  const audioBuffer = await readBinaryBody(request, maxChunkBytes);
  if (audioBuffer.length === 0) {
    sendJson(response, 400, { error: "音频内容不能为空。" });
    return;
  }

  session.recognition.write(audioBuffer);
  touchVoiceInputSession(sessionId);
  await new Promise((resolve) => setTimeout(resolve, 20));

  sendJson(response, 200, {
    text: drainVoiceInputStableText(sessionId),
  });
}

async function handleStopVoiceInputSession(response: ServerResponse, sessionId: string) {
  const session = voiceInputSessions.get(sessionId);
  if (!session) {
    sendJson(response, 404, { error: "语音输入会话不存在。" });
    return;
  }

  try {
    const result = await session.recognition.finish();
    const stableDelta = drainVoiceInputStableText(sessionId);
    const tailText = diffSuffix(result.stableText, result.text || result.stableText);

    sendJson(response, 200, {
      text: `${stableDelta}${tailText}`,
      fullText: result.text || result.stableText,
      logId: result.logId,
    });
  } finally {
    voiceInputSessions.delete(sessionId);
  }
}

async function handleAbortVoiceInputSession(response: ServerResponse, sessionId: string) {
  const session = voiceInputSessions.get(sessionId);
  if (!session) {
    sendJson(response, 200, { ok: true });
    return;
  }

  voiceInputSessions.delete(sessionId);
  await session.recognition.abort().catch(() => undefined);
  sendJson(response, 200, { ok: true });
}

function isValidAdminPresetId(value: unknown): value is string {
  return typeof value === "string" && adminModelPresets.some((preset) => preset.id === value);
}

function normalizeAdminSelectionValue(value: unknown): string | undefined {
  return isValidAdminPresetId(value) ? value : undefined;
}

async function routeApi(request: IncomingMessage, response: ServerResponse, pathname: string) {
  if (request.method === "POST" && pathname === "/api/admin/login") {
    if (!adminAuthConfig.enabled) {
      sendJson(response, 503, { error: "当前未配置 admin 账号密码。" });
      return;
    }

    const { username, password } = (await readJsonBody(request)) as { username?: string; password?: string };
    if (username !== adminAuthConfig.username || password !== adminAuthConfig.password) {
      sendJson(response, 401, { error: "账号或密码不正确。" });
      return;
    }

    const token = createAdminToken();
    sendAdminSessionCookie(response, token);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/admin/logout") {
    clearAdminSessionCookie(response);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && pathname === "/api/admin/bootstrap") {
    if (!assertAdminAccess(request, response)) {
      return;
    }
    sendJson(response, 200, serializeAdminBootstrap());
    return;
  }

  if (request.method === "POST" && pathname === "/api/admin/archives/import") {
    if (!assertAdminAccess(request, response)) {
      return;
    }

    const { payload } = (await readJsonBody(request)) as { payload?: unknown };
    if (!payload) {
      sendJson(response, 400, { error: "缺少导入内容。" });
      return;
    }

    const archivePath = importArchivePayload(payload, archiveDir);
    const summary = listArchivedCases(archiveDir).find((item) => item.filePath === archivePath);
    sendJson(response, 200, {
      ok: true,
      archive: summary ?? null,
    });
    return;
  }

  const adminArchiveExportMatch = pathname.match(/^\/api\/admin\/archives\/([^/]+)\/export$/u);
  if (request.method === "GET" && adminArchiveExportMatch) {
    if (!assertAdminAccess(request, response)) {
      return;
    }

    const archiveSummary = listArchivedCases(archiveDir).find((item) => item.archiveId === adminArchiveExportMatch[1]!);
    if (!archiveSummary) {
      sendJson(response, 404, { error: "归档案件不存在。" });
      return;
    }

    const archive = loadArchivedCase(archiveSummary.filePath);
    sendJsonDownload(response, buildDownloadFileName(`${archive.mysteryCase.title}--archive`), archive);
    return;
  }

  const adminArchiveDetailMatch = pathname.match(/^\/api\/admin\/archives\/([^/]+)$/u);
  if (request.method === "GET" && adminArchiveDetailMatch) {
    if (!assertAdminAccess(request, response)) {
      return;
    }

    const archiveSummary = listArchivedCases(archiveDir).find((item) => item.archiveId === adminArchiveDetailMatch[1]!);
    if (!archiveSummary) {
      sendJson(response, 404, { error: "归档案件不存在。" });
      return;
    }

    const archive = loadArchivedCase(archiveSummary.filePath);
    sendJson(response, 200, {
      archive: {
        archiveId: archive.archiveId,
        archivedAt: archive.archivedAt,
        source: archive.source,
        review: archive.review,
        diagnostics: archive.diagnostics,
        mysteryCase: archive.mysteryCase,
      },
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/admin/model-selection") {
    if (!assertAdminAccess(request, response)) {
      return;
    }

    const body = (await readJsonBody(request)) as {
      playPresetId?: unknown;
      generatorPresetId?: unknown;
      reviewerPresetId?: unknown;
    };
    store.setSetting("admin.modelSelection", {
      playPresetId: normalizeAdminSelectionValue(body.playPresetId),
      generatorPresetId: normalizeAdminSelectionValue(body.generatorPresetId),
      reviewerPresetId: normalizeAdminSelectionValue(body.reviewerPresetId),
    } satisfies AdminModelSelection);
    sendJson(response, 200, { ok: true, selection: getAdminModelSelection() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/admin/cases/generate") {
    if (!assertAdminAccess(request, response)) {
      return;
    }

    const { templateType } = (await readJsonBody(request)) as { templateType?: TemplateType };
    if (!CASE_TEMPLATES.some((template) => template.type === templateType)) {
      sendJson(response, 400, { error: "案件模板不存在。" });
      return;
    }

    const activeGenerationJob = getLatestActiveGenerationJob();
    sendJson(response, 202, {
      jobId: activeGenerationJob?.id ?? startGenerationJob(templateType),
      reused: Boolean(activeGenerationJob),
    });
    return;
  }

  const adminJobMatch = pathname.match(/^\/api\/admin\/generation-jobs\/([^/]+)$/u);
  if (request.method === "GET" && adminJobMatch) {
    if (!assertAdminAccess(request, response)) {
      return;
    }

    const job = generationJobs.get(adminJobMatch[1]!);
    if (!job) {
      sendJson(response, 404, { error: "生成任务不存在。" });
      return;
    }

    sendJson(response, 200, job);
    return;
  }

  const adminArchiveMatch = pathname.match(/^\/api\/admin\/archives\/([^/]+)$/u);
  if (request.method === "DELETE" && adminArchiveMatch) {
    if (!assertAdminAccess(request, response)) {
      return;
    }

    const deleted = deleteArchivedCase(adminArchiveMatch[1]!, archiveDir);
    if (!deleted) {
      sendJson(response, 404, { error: "归档案件不存在。" });
      return;
    }

    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && pathname === "/api/bootstrap") {
    sendJson(response, 200, serializeBootstrap());
    return;
  }

  if (request.method === "POST" && pathname === "/api/voice-input/transcribe") {
    await handleVoiceInputTranscription(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/voice-input/session/start") {
    await handleStartVoiceInputSession(response);
    return;
  }

  const voiceChunkMatch = pathname.match(/^\/api\/voice-input\/session\/([^/]+)\/chunk$/u);
  if (request.method === "POST" && voiceChunkMatch) {
    await handleVoiceInputChunk(request, response, voiceChunkMatch[1]!);
    return;
  }

  const voiceStopMatch = pathname.match(/^\/api\/voice-input\/session\/([^/]+)\/stop$/u);
  if (request.method === "POST" && voiceStopMatch) {
    await handleStopVoiceInputSession(response, voiceStopMatch[1]!);
    return;
  }

  const voiceAbortMatch = pathname.match(/^\/api\/voice-input\/session\/([^/]+)$/u);
  if (request.method === "DELETE" && voiceAbortMatch) {
    await handleAbortVoiceInputSession(response, voiceAbortMatch[1]!);
    return;
  }

  if (request.method === "POST" && pathname === "/api/session/new") {
    sendJson(response, 403, { error: "玩家界面不再直接生成案件，请到 /admin 管理后台操作。" });
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
    sendJson(response, 200, { messages: [] });
    return;
  }

  const chatMatch = pathname.match(/^\/api\/session\/([^/]+)\/chat\/([^/]+)$/u);
  if (request.method === "POST" && chatMatch) {
    await handleChatStream(request, response, chatMatch[1]!, chatMatch[2]!);
    return;
  }

  const accuseMatch = pathname.match(/^\/api\/session\/([^/]+)\/accuse$/u);
  if (request.method === "POST" && accuseMatch) {
    const { suspectId, reasoning: rawReasoning, citedNodeIds: rawCitedNodeIds } = (await readJsonBody(request)) as {
      suspectId?: string;
      reasoning?: unknown;
      citedNodeIds?: unknown;
    };
    if (!suspectId) {
      sendJson(response, 400, { error: "缺少 suspectId。" });
      return;
    }

    const { session, mysteryCase } = getSessionContext(accuseMatch[1]!);
    if (!mysteryCase.suspects.some((suspect) => suspect.id === suspectId)) {
      sendJson(response, 404, { error: "嫌疑人不存在。" });
      return;
    }

    const reasoning = typeof rawReasoning === "string" ? rawReasoning : "";
    const citedNodeIds = Array.isArray(rawCitedNodeIds) ? rawCitedNodeIds.filter((id): id is string => typeof id === "string") : [];
    const citedNodes = mysteryCase.investigationNodes.filter((node) => citedNodeIds.includes(node.id));

    store.updateSessionState(session.id, (state) => ({
      ...state,
      accusedSuspectId: suspectId,
    }));
    store.updateSessionStatus(session.id, "solved");

    const judgement = judgeAccusation(mysteryCase, suspectId);

    try {
      const evaluation = await evaluateAccusation(getPlayGateway(), mysteryCase, suspectId, reasoning, citedNodes);
      judgement.deduction = evaluation.deduction;
      judgement.consequence = evaluation.consequence;
    } catch (error) {
      console.error("[Web] 结案推理评估失败，使用兜底结局：", error);
      judgement.consequence = buildFallbackConsequence(mysteryCase, suspectId);
    }

    sendJson(response, 200, {
      judgement,
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

    if (pathname === "/admin") {
      sendText(response, 200, ADMIN_HTML, "text/html; charset=utf-8");
      return;
    }

    if (pathname === "/app.js") {
      sendText(response, 200, APP_JS, "application/javascript; charset=utf-8");
      return;
    }

    if (pathname === "/admin.js") {
      sendText(response, 200, ADMIN_JS, "application/javascript; charset=utf-8");
      return;
    }

    if (pathname === "/styles.css") {
      sendText(response, 200, STYLES_CSS, "text/css; charset=utf-8");
      return;
    }

    if (pathname === "/vendor/sweetalert2.js") {
      sendText(response, 200, SWEETALERT_JS, "application/javascript; charset=utf-8");
      return;
    }

    if (pathname === "/vendor/sweetalert2.css") {
      sendText(response, 200, SWEETALERT_CSS, "text/css; charset=utf-8");
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
