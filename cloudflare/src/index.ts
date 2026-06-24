import { CASE_TEMPLATES } from "../../src/case/templates.js";
import { generateCasePackageWithDiagnostics, PLAYABLE_CASE_GENERATION_OPTIONS } from "../../src/case/generator.js";
import type { InvestigationNode, MysteryCase, Npc, Suspect, TemplateType } from "../../src/case/schema.js";
import { sanitizeDialogueHistory } from "../../src/chat/dialogue-memory.js";
import { buildHintMasterCharacter, buildHintMasterMessages, HINT_MASTER_ID } from "../../src/chat/hint-master.js";
import { buildSuspectMessages } from "../../src/chat/suspect-chat.js";
import { buildFallbackConsequence, evaluateAccusation, judgeAccusation, revealSolution } from "../../src/judgement/judge.js";

import { DEFAULT_GENERATOR_MODEL_ID, DEFAULT_PLAY_MODEL_ID, DEFAULT_REVIEW_MODEL_ID, findModelOptionById, findModelOptionByModel, listAdminModelOptions, resolveModelOption } from "./model-catalog.js";
import { deleteKeysByPrefix, KvAppStore, listAllKeys, type KvNamespaceLike, type StoredGenerationFailure, type StoredSession } from "./kv-store.js";
import { WorkersAiGateway, type AiBinding, type ChatMessage } from "./workers-ai-gateway.js";
import { base64ToBytes, base64UrlDecodeBytes, base64UrlDecodeText, base64UrlEncodeBytes, base64UrlEncodeText, buildDownloadFileName, bytesToBase64, concatenateBytes, constantTimeEqual, encodeUtf8, jsonDownloadResponse, jsonResponse, nowIso } from "./utils.js";
import { loadVoiceInputConfig, serializeVoiceInputConfig, transcribeWithWorkersAi, type VoiceInputConfig } from "./voice.js";

type AssetFetcher = {
  fetch(request: Request): Promise<Response>;
};

type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};

type Env = {
  AI: AiBinding;
  APP_KV: KvNamespaceLike;
  ASSETS: AssetFetcher;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  PLAY_MODEL?: string;
  GENERATOR_MODEL?: string;
  REVIEW_MODEL?: string;
  AI_TIMEOUT_MS?: string;
  VOICE_INPUT_ENABLED?: string;
  VOICE_INPUT_MODEL?: string;
  VOICE_INPUT_LANGUAGE?: string;
  VOICE_INPUT_CHUNK_MS?: string;
  VOICE_INPUT_MAX_DURATION_SECONDS?: string;
};

type GenerationJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: {
    phase: string;
    message: string;
    attempt: number;
    totalAttempts: number;
  };
  session?: SerializedSession;
  review?: unknown;
  archiveId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type AdminModelSelection = {
  playPresetId?: string;
  generatorPresetId?: string;
  reviewerPresetId?: string;
};

type AdminAuthConfig = {
  enabled: boolean;
  username: string;
  password: string;
};

type SerializedSession = {
  sessionId: string;
  caseId: string;
  status: StoredSession["status"];
  title: string;
  openingNarration: string;
  publicSummary: string;
  playerGoal: string;
  storyContext: MysteryCase["storyContext"];
  sceneVisualSummary?: string;
  sceneSvg?: string;
  victim: MysteryCase["victim"];
  suspects: Array<{
    id: string;
    name: string;
    publicPersona: string;
    relationshipToVictim: string;
    possibleMotive: string;
    alibi: string;
    appearanceSummary?: string;
    avatarSvg?: string;
  }>;
  npcs: Array<{
    id: string;
    name: string;
    publicPersona: string;
    relationshipToVictim: string;
    whyRelevant: string;
    appearanceSummary?: string;
    avatarSvg?: string;
  }>;
  hintMaster: ReturnType<typeof buildHintMasterCharacter>;
  investigationNodes: Array<{
    id: string;
    title: string;
    category: InvestigationNode["category"];
    visited: boolean;
    visualHint?: string;
  }>;
  notebook: Array<{
    id: string;
    title: string;
    summary: string;
    discovery: string;
    contradictionIds: string[];
  }>;
};

const ADMIN_COOKIE_NAME = "mystery_admin_session";
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_TOKEN_VERSION = "v1";
const JOB_PREFIX = "job:";
const JOB_TTL_SECONDS = 60 * 60 * 24;
const GENERATION_JOB_STALE_MS = 1000 * 90;
const VOICE_SESSION_PREFIX = "voice-session:";
const VOICE_SESSION_TTL_SECONDS = 60 * 15;
const SWEETALERT_JS_CDN = "https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js";
const SWEETALERT_CSS_CDN = "https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css";
const NO_STORE_HEADERS = { "cache-control": "no-store" };
const CLOUDFLARE_CASE_GENERATION_OPTIONS: typeof PLAYABLE_CASE_GENERATION_OPTIONS = {
  ...PLAYABLE_CASE_GENERATION_OPTIONS,
  maxAttempts: 2,
};

function trimText(value: string | undefined) {
  return value?.trim() ?? "";
}

function parseCookies(request: Request): Record<string, string> {
  const raw = request.headers.get("cookie") ?? "";
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

function loadAdminAuthConfig(env: Env): AdminAuthConfig {
  const username = trimText(env.ADMIN_USERNAME);
  const password = trimText(env.ADMIN_PASSWORD);
  return {
    enabled: Boolean(username && password),
    username,
    password,
  };
}

function resolveTimeoutMs(env: Env) {
  const parsed = Number(env.AI_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120000;
}

function resolveDefaultModelId(model: string | undefined, fallbackId: string) {
  return findModelOptionByModel(model)?.id ?? fallbackId;
}

function normalizeAdminSelectionValue(value: unknown): string | undefined {
  return typeof value === "string" && findModelOptionById(value) ? value : undefined;
}

async function getAdminModelSelection(store: KvAppStore, env: Env): Promise<AdminModelSelection> {
  const stored = await store.getSetting<AdminModelSelection>("admin.modelSelection");
  const defaults = {
    playPresetId: resolveDefaultModelId(env.PLAY_MODEL, DEFAULT_PLAY_MODEL_ID),
    generatorPresetId: resolveDefaultModelId(env.GENERATOR_MODEL, DEFAULT_GENERATOR_MODEL_ID),
    reviewerPresetId: resolveDefaultModelId(env.REVIEW_MODEL, DEFAULT_REVIEW_MODEL_ID),
  } satisfies Required<AdminModelSelection>;

  return {
    playPresetId: normalizeAdminSelectionValue(stored?.playPresetId) ?? defaults.playPresetId,
    generatorPresetId: normalizeAdminSelectionValue(stored?.generatorPresetId) ?? defaults.generatorPresetId,
    reviewerPresetId: normalizeAdminSelectionValue(stored?.reviewerPresetId) ?? defaults.reviewerPresetId,
  };
}

async function createGateways(env: Env, store: KvAppStore) {
  const selection = await getAdminModelSelection(store, env);
  const timeoutMs = resolveTimeoutMs(env);
  const playOption = resolveModelOption(selection.playPresetId, DEFAULT_PLAY_MODEL_ID);
  const generatorOption = resolveModelOption(selection.generatorPresetId, DEFAULT_GENERATOR_MODEL_ID);
  const reviewerOption = resolveModelOption(selection.reviewerPresetId, DEFAULT_REVIEW_MODEL_ID);

  return {
    selection,
    playGateway: new WorkersAiGateway(env.AI, playOption.model, playOption.id, timeoutMs),
    generationGateway: new WorkersAiGateway(env.AI, generatorOption.model, generatorOption.id, timeoutMs),
    reviewGateway: new WorkersAiGateway(env.AI, reviewerOption.model, reviewerOption.id, timeoutMs),
  };
}

function visitedNodes(mysteryCase: MysteryCase, session: StoredSession) {
  return mysteryCase.investigationNodes.filter((node) => session.state.visitedNodeIds.includes(node.id));
}

function allCharacters(mysteryCase: MysteryCase): Array<Suspect | Npc> {
  return [...mysteryCase.suspects, ...(mysteryCase.npcs ?? [])];
}

async function getSessionContext(store: KvAppStore, sessionId: string) {
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error("会话不存在。");
  }

  const mysteryCase = await store.getCase(session.caseId);
  if (!mysteryCase) {
    throw new Error("案件不存在。");
  }

  return { session, mysteryCase };
}

function serializeSession(mysteryCase: MysteryCase, session: StoredSession): SerializedSession {
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

async function serializeBootstrap(store: KvAppStore, env: Env) {
  const [activeGenerationJob, latestGenerationJob, latestGenerationFailure, archives, gateways] = await Promise.all([
    getLatestActiveGenerationJob(env.APP_KV),
    getLatestGenerationJob(env.APP_KV),
    store.getLatestGenerationFailure(),
    store.listArchivedCases(),
    createGateways(env, store),
  ]);

  return {
    activeGenerationJob: activeGenerationJob ? serializeGenerationJobPreview(activeGenerationJob) : null,
    latestGenerationJob: latestGenerationJob ? serializeGenerationJobPreview(latestGenerationJob) : null,
    latestGenerationFailure: latestGenerationFailure ? serializeStoredGenerationFailure(latestGenerationFailure) : null,
    archives: archives.map((item) => ({
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
      play: gateways.playGateway.describe(),
      generator: gateways.generationGateway.describe(),
      reviewer: gateways.reviewGateway.describe(),
    },
    voiceInput: serializeVoiceInputConfig(loadVoiceInputConfig(env)),
    adminEnabled: loadAdminAuthConfig(env).enabled,
  };
}

async function serializeAdminBootstrap(store: KvAppStore, env: Env) {
  const auth = loadAdminAuthConfig(env);
  const [activeGenerationJob, latestGenerationJob, latestGenerationFailure, archives, gateways] = await Promise.all([
    getLatestActiveGenerationJob(env.APP_KV),
    getLatestGenerationJob(env.APP_KV),
    store.getLatestGenerationFailure(),
    store.listArchivedCases(),
    createGateways(env, store),
  ]);

  return {
    user: auth.enabled ? auth.username : null,
    authenticated: true,
    archives: archives.map((item) => ({
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
      options: listAdminModelOptions(),
      selection: gateways.selection,
      current: {
        play: gateways.playGateway.describe(),
        generator: gateways.generationGateway.describe(),
        reviewer: gateways.reviewGateway.describe(),
      },
    },
    activeGenerationJob: activeGenerationJob ? serializeGenerationJobPreview(activeGenerationJob) : null,
    latestGenerationJob: latestGenerationJob ? serializeGenerationJobPreview(latestGenerationJob) : null,
    latestGenerationFailure: latestGenerationFailure ? serializeStoredGenerationFailure(latestGenerationFailure) : null,
  };
}

async function signAdminToken(secret: string, payloadEncoded: string) {
  const key = await crypto.subtle.importKey("raw", encodeUtf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encodeUtf8(payloadEncoded));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function adminTokenSecret(env: Env, auth: AdminAuthConfig) {
  return trimText(env.ADMIN_SESSION_SECRET) || `${ADMIN_TOKEN_VERSION}:${auth.username}:${auth.password}:mystery-cloudflare`;
}

async function createAdminToken(env: Env, auth: AdminAuthConfig) {
  const payloadEncoded = base64UrlEncodeText(
    JSON.stringify({
      u: auth.username,
      exp: Date.now() + ADMIN_SESSION_TTL_MS,
    }),
  );

  return `${payloadEncoded}.${await signAdminToken(adminTokenSecret(env, auth), payloadEncoded)}`;
}

async function verifyAdminToken(token: string, env: Env, auth: AdminAuthConfig) {
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return false;
  }

  const payloadEncoded = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expectedSignature = await signAdminToken(adminTokenSecret(env, auth), payloadEncoded);

  if (!constantTimeEqual(base64UrlDecodeBytes(signature), base64UrlDecodeBytes(expectedSignature))) {
    return false;
  }

  try {
    const payload = JSON.parse(base64UrlDecodeText(payloadEncoded)) as { u?: string; exp?: number };
    return payload.u === auth.username && typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function getAdminSessionToken(request: Request) {
  return parseCookies(request)[ADMIN_COOKIE_NAME];
}

async function assertAdminAccess(request: Request, env: Env) {
  const auth = loadAdminAuthConfig(env);
  if (!auth.enabled) {
    return jsonResponse({ error: "当前未配置 admin 账号密码。" }, 503);
  }

  const token = getAdminSessionToken(request);
  if (!token || !(await verifyAdminToken(token, env, auth))) {
    return jsonResponse({ error: "请先登录 admin。" }, 401);
  }

  return null;
}

async function readJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  const raw = await request.text();
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

async function readBinaryBody(request: Request, maxBytes: number) {
  const buffer = new Uint8Array(await request.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error("语音输入音频过长，请缩短后重试。");
  }
  return buffer;
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

function truncateFailurePartialOutput(text: string | undefined, maxChars = 8000) {
  if (!text) {
    return undefined;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}…`;
}

async function buildStoredGenerationFailure(
  kv: KvNamespaceLike,
  jobId: string,
  templateType: TemplateType | undefined,
  error: unknown,
  generatorMeta: ReturnType<WorkersAiGateway["describe"]>,
  reviewMeta: ReturnType<WorkersAiGateway["describe"]>,
): Promise<StoredGenerationFailure> {
  const currentJob = await getGenerationJob(kv, jobId);
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
    createdAt: nowIso(),
  };
}

function toWorkersAiMessages(messages: Array<{ role?: unknown; content?: unknown }>): ChatMessage[] {
  return messages
    .filter(
      (message) =>
        (message.role === "system" || message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
    .map((message) => ({
      role: message.role as ChatMessage["role"],
      content: message.content as string,
    }));
}

function jobKey(jobId: string) {
  return `${JOB_PREFIX}${jobId}`;
}

async function putGenerationJob(kv: KvNamespaceLike, job: GenerationJob) {
  await kv.put(jobKey(job.id), JSON.stringify(job), {
    expirationTtl: JOB_TTL_SECONDS,
    metadata: {
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  });
}

async function getGenerationJob(kv: KvNamespaceLike, jobId: string) {
  const value = await kv.get(jobKey(jobId), "json");
  return (value as GenerationJob | null) ?? null;
}

async function listGenerationJobs(kv: KvNamespaceLike) {
  const keys = await listAllKeys<{ createdAt?: string; updatedAt?: string }>(kv, JOB_PREFIX);
  const jobs = await Promise.all(keys.map((key) => kv.get(key.name, "json")));
  return jobs
    .filter((job): job is GenerationJob => Boolean(job))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function isStaleGenerationJob(job: GenerationJob) {
  if (!(job.status === "queued" || job.status === "running")) {
    return false;
  }

  const updatedAt = Date.parse(job.updatedAt);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > GENERATION_JOB_STALE_MS;
}

async function getLatestActiveGenerationJob(kv: KvNamespaceLike) {
  const jobs = await listGenerationJobs(kv);
  return jobs.find((job) => (job.status === "queued" || job.status === "running") && !isStaleGenerationJob(job)) ?? null;
}

async function getLatestGenerationJob(kv: KvNamespaceLike) {
  const jobs = await listGenerationJobs(kv);
  return jobs[0] ?? null;
}

async function updateGenerationJob(kv: KvNamespaceLike, jobId: string, patch: Partial<GenerationJob>) {
  const current = await getGenerationJob(kv, jobId);
  if (!current) {
    return null;
  }

  const next: GenerationJob = {
    ...current,
    ...patch,
    progress: patch.progress ?? current.progress,
    updatedAt: nowIso(),
  };
  await putGenerationJob(kv, next);
  return next;
}

function voiceSessionMetaKey(sessionId: string) {
  return `${VOICE_SESSION_PREFIX}${sessionId}:meta`;
}

function voiceSessionChunkPrefix(sessionId: string) {
  return `${VOICE_SESSION_PREFIX}${sessionId}:chunk:`;
}

function voiceSessionPrefix(sessionId: string) {
  return `${VOICE_SESSION_PREFIX}${sessionId}:`;
}

async function createVoiceSession(kv: KvNamespaceLike) {
  const sessionId = `voice_${crypto.randomUUID()}`;
  await kv.put(voiceSessionMetaKey(sessionId), JSON.stringify({ id: sessionId, createdAt: nowIso() }), {
    expirationTtl: VOICE_SESSION_TTL_SECONDS,
  });
  return sessionId;
}

async function appendVoiceChunk(kv: KvNamespaceLike, sessionId: string, chunk: Uint8Array) {
  const meta = await kv.get(voiceSessionMetaKey(sessionId));
  if (!meta) {
    return false;
  }

  const chunkKey = `${voiceSessionChunkPrefix(sessionId)}${String(Date.now()).padStart(13, "0")}:${crypto.randomUUID()}`;
  await kv.put(chunkKey, bytesToBase64(chunk), {
    expirationTtl: VOICE_SESSION_TTL_SECONDS,
  });
  return true;
}

async function readVoiceSessionPcm(kv: KvNamespaceLike, sessionId: string) {
  const meta = await kv.get(voiceSessionMetaKey(sessionId));
  if (!meta) {
    return null;
  }

  const chunkKeys = await listAllKeys(kv, voiceSessionChunkPrefix(sessionId));
  const chunks = await Promise.all(
    chunkKeys
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (key) => {
        const value = await kv.get(key.name);
        return typeof value === "string" ? base64ToBytes(value) : new Uint8Array(0);
      }),
  );

  return concatenateBytes(chunks);
}

async function clearVoiceSession(kv: KvNamespaceLike, sessionId: string) {
  await deleteKeysByPrefix(kv, voiceSessionPrefix(sessionId));
}

async function collectExistingCaseTitles(store: KvAppStore) {
  const [caseTitles, archivedCases] = await Promise.all([store.listCaseTitles(), store.listArchivedCases()]);
  return Array.from(new Set([...caseTitles, ...archivedCases.map((item) => item.title)]));
}

async function createNewSession(store: KvAppStore, env: Env, templateType?: TemplateType, jobId?: string) {
  const { generationGateway, reviewGateway } = await createGateways(env, store);
  const startedAt = Date.now();
  let latestProgress = {
    phase: "starting",
    message: "正在启动生成任务...",
    attempt: 0,
    totalAttempts: CLOUDFLARE_CASE_GENERATION_OPTIONS.maxAttempts ?? 1,
  };
  let phaseStartedAt = Date.now();
  const heartbeat =
    jobId === undefined
      ? undefined
      : setInterval(() => {
          const waitedSeconds = Math.max(1, Math.floor((Date.now() - phaseStartedAt) / 1000));
          void updateGenerationJob(env.APP_KV, jobId, {
            status: "running",
            progress: {
              ...latestProgress,
              message: `${latestProgress.message} 已等待 ${waitedSeconds} 秒。`,
            },
          });
        }, 5000);

  try {
    const result = await generateCasePackageWithDiagnostics(generationGateway, templateType, reviewGateway, {
      ...CLOUDFLARE_CASE_GENERATION_OPTIONS,
      existingTitles: await collectExistingCaseTitles(store),
      onProgress: async (event) => {
        if (!jobId) {
          return;
        }

        latestProgress = event;
        phaseStartedAt = Date.now();
        await updateGenerationJob(env.APP_KV, jobId, {
          status: "running",
          progress: event,
        });
      },
    });

    const mysteryCase = result.mysteryCase;
    await store.saveCase(mysteryCase);
    const archive = await store.putArchive({
      archiveId: `archive_${crypto.randomUUID()}`,
      archivedAt: nowIso(),
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
    });
    const session = await store.createSession(mysteryCase.id);

    console.log(`[CF Web] 可玩案件生成完成：${mysteryCase.title}，尝试次数=${result.diagnostics.attemptCount}，耗时=${Date.now() - startedAt}ms`);

    return {
      session: serializeSession(mysteryCase, session),
      archiveId: archive.archiveId,
      review: result.diagnostics.review,
    };
  } finally {
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
    }
  }
}

async function runGenerationJob(store: KvAppStore, env: Env, jobId: string, templateType?: TemplateType) {
  const { generationGateway, reviewGateway } = await createGateways(env, store);

  try {
    await updateGenerationJob(env.APP_KV, jobId, {
      status: "running",
      progress: {
        phase: "starting",
        message: "正在启动生成任务...",
        attempt: 0,
        totalAttempts: CLOUDFLARE_CASE_GENERATION_OPTIONS.maxAttempts ?? 1,
      },
    });

    const result = await createNewSession(store, env, templateType, jobId);
    await updateGenerationJob(env.APP_KV, jobId, {
      status: "completed",
      session: result.session,
      review: result.review,
      archiveId: result.archiveId,
        progress: {
          phase: "completed",
          message: `案件《${result.session.title}》已生成完成。`,
          attempt: CLOUDFLARE_CASE_GENERATION_OPTIONS.maxAttempts ?? 1,
          totalAttempts: CLOUDFLARE_CASE_GENERATION_OPTIONS.maxAttempts ?? 1,
        },
      });
  } catch (error) {
    const failure = await buildStoredGenerationFailure(
      env.APP_KV,
      jobId,
      templateType,
      error,
      generationGateway.describe(),
      reviewGateway.describe(),
    );
    await store.recordGenerationFailure(failure);
    await updateGenerationJob(env.APP_KV, jobId, {
      status: "failed",
      error: failure.error,
        progress: {
          phase: "failed",
          message: failure.error,
          attempt: CLOUDFLARE_CASE_GENERATION_OPTIONS.maxAttempts ?? 1,
          totalAttempts: CLOUDFLARE_CASE_GENERATION_OPTIONS.maxAttempts ?? 1,
        },
      });
  }
}

async function startGenerationJob(store: KvAppStore, env: Env, _ctx: ExecutionContextLike, templateType?: TemplateType) {
  const existing = await getLatestActiveGenerationJob(env.APP_KV);
  if (existing) {
    return { jobId: existing.id, reused: true };
  }

  const jobId = `job_${crypto.randomUUID()}`;
  const now = nowIso();
  await putGenerationJob(env.APP_KV, {
    id: jobId,
    status: "queued",
    progress: {
      phase: "queued",
      message: "已收到请求，正在排队准备生成案件...",
      attempt: 0,
      totalAttempts: CLOUDFLARE_CASE_GENERATION_OPTIONS.maxAttempts ?? 1,
    },
    createdAt: now,
    updatedAt: now,
  });

  await runGenerationJob(store, env, jobId, templateType);
  return { jobId, reused: false };
}

async function handleInvestigation(store: KvAppStore, sessionId: string, nodeId: string) {
  const { session, mysteryCase } = await getSessionContext(store, sessionId);
  const node = mysteryCase.investigationNodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new Error("调查节点不存在。");
  }

  const nextSession = session.state.visitedNodeIds.includes(nodeId)
    ? session
    : await store.updateSessionState(session.id, (state) => ({
        ...state,
        visitedNodeIds: [...state.visitedNodeIds, nodeId],
      }));

  return {
    node,
    session: serializeSession(mysteryCase, nextSession),
  };
}

function streamTextResponse(streamFactory: () => AsyncGenerator<string>) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of streamFactory()) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (error) {
          controller.enqueue(encoder.encode(`\n\n[系统] 回复中断：${error instanceof Error ? error.message : String(error)}`));
        } finally {
          controller.close();
        }
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        ...NO_STORE_HEADERS,
      },
    },
  );
}

async function handleChatStream(store: KvAppStore, env: Env, request: Request, sessionId: string, characterId: string) {
  const { userInput, history: rawHistory, confrontNodeId } = await readJsonBody<{
    userInput?: string;
    history?: unknown;
    confrontNodeId?: string;
  }>(request);
  if (!userInput?.trim()) {
    return jsonResponse({ error: "聊天内容不能为空。" }, 400);
  }

  const { session, mysteryCase } = await getSessionContext(store, sessionId);
  const playGateway = (await createGateways(env, store)).playGateway;
  const history = sanitizeDialogueHistory(rawHistory);
  await store.touchSession(session.id);

  if (characterId === HINT_MASTER_ID) {
    const messages = toWorkersAiMessages(
      buildHintMasterMessages(mysteryCase, visitedNodes(mysteryCase, session), history, userInput.trim(), session.status === "solved"),
    );
    return streamTextResponse(async function* () {
      try {
        yield* playGateway.streamChat(messages, 0.4);
      } catch (error) {
        if (error instanceof Error && error.message.includes("模型没有返回流式聊天内容")) {
          yield await playGateway.chat(messages, 0.4);
          return;
        }

        throw error;
      }
    });
  }

  const character = allCharacters(mysteryCase).find((item) => item.id === characterId);
  if (!character) {
    return jsonResponse({ error: "角色不存在。" }, 404);
  }

  const confrontNode = typeof confrontNodeId === "string" ? mysteryCase.investigationNodes.find((node) => node.id === confrontNodeId) : undefined;
  const messages = toWorkersAiMessages(
    buildSuspectMessages(mysteryCase, character, visitedNodes(mysteryCase, session), history, userInput.trim(), confrontNode),
  );
  return streamTextResponse(async function* () {
    try {
      yield* playGateway.streamChat(messages, 0.8);
    } catch (error) {
      if (error instanceof Error && error.message.includes("模型没有返回流式聊天内容")) {
        yield await playGateway.chat(messages, 0.8);
        return;
      }

      throw error;
    }
  });
}

async function handleVoiceInputTranscription(env: Env, request: Request, config: VoiceInputConfig) {
  const maxBytes = Math.ceil(config.sampleRate * config.channels * (config.bits / 8) * config.maxDurationSeconds * 1.2);
  const audioBuffer = await readBinaryBody(request, maxBytes);
  const transcript = await transcribeWithWorkersAi(env.AI, audioBuffer, config);

  return jsonResponse({
    text: transcript.text,
    logId: null,
  });
}

async function handleStartVoiceInputSession(env: Env) {
  const config = loadVoiceInputConfig(env);
  if (!config.enabled) {
    return jsonResponse({ error: "当前未配置语音输入。" }, 404);
  }

  const sessionId = await createVoiceSession(env.APP_KV);
  return jsonResponse({ sessionId });
}

async function handleVoiceInputChunk(env: Env, request: Request, sessionId: string, config: VoiceInputConfig) {
  const maxChunkBytes = Math.max(
    32 * 1024,
    Math.ceil(config.sampleRate * config.channels * (config.bits / 8) * (config.chunkMs / 1000) * 4),
  );
  const audioBuffer = await readBinaryBody(request, maxChunkBytes);
  if (audioBuffer.length === 0) {
    return jsonResponse({ error: "音频内容不能为空。" }, 400);
  }

  const stored = await appendVoiceChunk(env.APP_KV, sessionId, audioBuffer);
  if (!stored) {
    return jsonResponse({ error: "语音输入会话不存在。" }, 404);
  }

  return jsonResponse({ text: "" });
}

async function handleStopVoiceInputSession(env: Env, sessionId: string, config: VoiceInputConfig) {
  const pcmBytes = await readVoiceSessionPcm(env.APP_KV, sessionId);
  if (pcmBytes === null) {
    return jsonResponse({ error: "语音输入会话不存在。" }, 404);
  }

  try {
    const transcript = await transcribeWithWorkersAi(env.AI, pcmBytes, config);
    return jsonResponse({
      text: transcript.text,
      fullText: transcript.text,
      logId: null,
    });
  } finally {
    await clearVoiceSession(env.APP_KV, sessionId);
  }
}

async function handleAbortVoiceInputSession(env: Env, sessionId: string) {
  await clearVoiceSession(env.APP_KV, sessionId);
  return jsonResponse({ ok: true });
}

async function routeApi(request: Request, env: Env, ctx: ExecutionContextLike, pathname: string) {
  const store = new KvAppStore(env.APP_KV);
  const voiceConfig = loadVoiceInputConfig(env);

  if (request.method === "POST" && pathname === "/api/admin/login") {
    const auth = loadAdminAuthConfig(env);
    if (!auth.enabled) {
      return jsonResponse({ error: "当前未配置 admin 账号密码。" }, 503);
    }

    const { username, password } = await readJsonBody<{ username?: string; password?: string }>(request);
    if (username !== auth.username || password !== auth.password) {
      return jsonResponse({ error: "账号或密码不正确。" }, 401);
    }

    const token = await createAdminToken(env, auth);
    return jsonResponse(
      { ok: true },
      200,
      {
        "set-cookie": `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
      },
    );
  }

  if (request.method === "POST" && pathname === "/api/admin/logout") {
    return jsonResponse(
      { ok: true },
      200,
      {
        "set-cookie": `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      },
    );
  }

  if (request.method === "GET" && pathname === "/api/admin/bootstrap") {
    const denied = await assertAdminAccess(request, env);
    if (denied) {
      return denied;
    }
    return jsonResponse(await serializeAdminBootstrap(store, env));
  }

  if (request.method === "POST" && pathname === "/api/admin/archives/import") {
    const denied = await assertAdminAccess(request, env);
    if (denied) {
      return denied;
    }

    const { payload } = await readJsonBody<{ payload?: unknown }>(request);
    if (!payload) {
      return jsonResponse({ error: "缺少导入内容。" }, 400);
    }

    const archive = await store.importArchivePayload(payload);
    return jsonResponse({ ok: true, archive });
  }

  const adminArchiveExportMatch = pathname.match(/^\/api\/admin\/archives\/([^/]+)\/export$/u);
  if (request.method === "GET" && adminArchiveExportMatch) {
    const denied = await assertAdminAccess(request, env);
    if (denied) {
      return denied;
    }

    const archive = await store.getArchivedCase(adminArchiveExportMatch[1]!);
    if (!archive) {
      return jsonResponse({ error: "归档案件不存在。" }, 404);
    }

    return jsonDownloadResponse(buildDownloadFileName(`${archive.mysteryCase.title}--archive`), archive);
  }

  const adminArchiveDetailMatch = pathname.match(/^\/api\/admin\/archives\/([^/]+)$/u);
  if (request.method === "GET" && adminArchiveDetailMatch) {
    const denied = await assertAdminAccess(request, env);
    if (denied) {
      return denied;
    }

    const archive = await store.getArchivedCase(adminArchiveDetailMatch[1]!);
    if (!archive) {
      return jsonResponse({ error: "归档案件不存在。" }, 404);
    }

    return jsonResponse({
      archive: {
        archiveId: archive.archiveId,
        archivedAt: archive.archivedAt,
        source: archive.source,
        review: archive.review,
        diagnostics: archive.diagnostics,
        mysteryCase: archive.mysteryCase,
      },
    });
  }

  if (request.method === "POST" && pathname === "/api/admin/model-selection") {
    const denied = await assertAdminAccess(request, env);
    if (denied) {
      return denied;
    }

    const body = await readJsonBody<{ playPresetId?: unknown; generatorPresetId?: unknown; reviewerPresetId?: unknown }>(request);
    const selection = {
      playPresetId: normalizeAdminSelectionValue(body.playPresetId),
      generatorPresetId: normalizeAdminSelectionValue(body.generatorPresetId),
      reviewerPresetId: normalizeAdminSelectionValue(body.reviewerPresetId),
    } satisfies AdminModelSelection;
    await store.setSetting("admin.modelSelection", selection);
    return jsonResponse({ ok: true, selection: await getAdminModelSelection(store, env) });
  }

  if (request.method === "POST" && pathname === "/api/admin/cases/generate") {
    const denied = await assertAdminAccess(request, env);
    if (denied) {
      return denied;
    }

    const { templateType } = await readJsonBody<{ templateType?: TemplateType }>(request);
    if (!CASE_TEMPLATES.some((template) => template.type === templateType)) {
      return jsonResponse({ error: "案件模板不存在。" }, 400);
    }

    const result = await startGenerationJob(store, env, ctx, templateType);
    return jsonResponse(result, 202);
  }

  const adminJobMatch = pathname.match(/^\/api\/admin\/generation-jobs\/([^/]+)$/u);
  if (request.method === "GET" && adminJobMatch) {
    const denied = await assertAdminAccess(request, env);
    if (denied) {
      return denied;
    }

    const job = await getGenerationJob(env.APP_KV, adminJobMatch[1]!);
    if (!job) {
      return jsonResponse({ error: "生成任务不存在。" }, 404);
    }

    return jsonResponse(job);
  }

  const adminArchiveDeleteMatch = pathname.match(/^\/api\/admin\/archives\/([^/]+)$/u);
  if (request.method === "DELETE" && adminArchiveDeleteMatch) {
    const denied = await assertAdminAccess(request, env);
    if (denied) {
      return denied;
    }

    const deleted = await store.deleteArchivedCase(adminArchiveDeleteMatch[1]!);
    if (!deleted) {
      return jsonResponse({ error: "归档案件不存在。" }, 404);
    }

    return jsonResponse({ ok: true });
  }

  if (request.method === "GET" && pathname === "/api/bootstrap") {
    return jsonResponse(await serializeBootstrap(store, env));
  }

  if (request.method === "POST" && pathname === "/api/voice-input/transcribe") {
    if (!voiceConfig.enabled) {
      return jsonResponse({ error: "当前未配置语音输入。" }, 404);
    }
    return handleVoiceInputTranscription(env, request, voiceConfig);
  }

  if (request.method === "POST" && pathname === "/api/voice-input/session/start") {
    return handleStartVoiceInputSession(env);
  }

  const voiceChunkMatch = pathname.match(/^\/api\/voice-input\/session\/([^/]+)\/chunk$/u);
  if (request.method === "POST" && voiceChunkMatch) {
    if (!voiceConfig.enabled) {
      return jsonResponse({ error: "当前未配置语音输入。" }, 404);
    }
    return handleVoiceInputChunk(env, request, voiceChunkMatch[1]!, voiceConfig);
  }

  const voiceStopMatch = pathname.match(/^\/api\/voice-input\/session\/([^/]+)\/stop$/u);
  if (request.method === "POST" && voiceStopMatch) {
    if (!voiceConfig.enabled) {
      return jsonResponse({ error: "当前未配置语音输入。" }, 404);
    }
    return handleStopVoiceInputSession(env, voiceStopMatch[1]!, voiceConfig);
  }

  const voiceAbortMatch = pathname.match(/^\/api\/voice-input\/session\/([^/]+)$/u);
  if (request.method === "DELETE" && voiceAbortMatch) {
    return handleAbortVoiceInputSession(env, voiceAbortMatch[1]!);
  }

  if (request.method === "POST" && pathname === "/api/session/new") {
    return jsonResponse({ error: "玩家界面不再直接生成案件，请到 /admin 管理后台操作。" }, 403);
  }

  const jobMatch = pathname.match(/^\/api\/generation-jobs\/([^/]+)$/u);
  if (request.method === "GET" && jobMatch) {
    const job = await getGenerationJob(env.APP_KV, jobMatch[1]!);
    if (!job) {
      return jsonResponse({ error: "生成任务不存在。" }, 404);
    }

    return jsonResponse(job);
  }

  if (request.method === "POST" && pathname === "/api/session/from-archive") {
    const { archiveId } = await readJsonBody<{ archiveId?: string }>(request);
    const archive = archiveId ? await store.getArchivedCase(archiveId) : null;
    if (!archive) {
      return jsonResponse({ error: "归档案件不存在。" }, 404);
    }

    await store.saveCase(archive.mysteryCase);
    const session = await store.createSession(archive.mysteryCase.id);
    return jsonResponse({ session: serializeSession(archive.mysteryCase, session) });
  }

  const investigateMatch = pathname.match(/^\/api\/session\/([^/]+)\/investigate$/u);
  if (request.method === "POST" && investigateMatch) {
    const { nodeId } = await readJsonBody<{ nodeId?: string }>(request);
    if (!nodeId) {
      return jsonResponse({ error: "缺少 nodeId。" }, 400);
    }

    return jsonResponse(await handleInvestigation(store, investigateMatch[1]!, nodeId));
  }

  const sessionMatch = pathname.match(/^\/api\/session\/([^/]+)$/u);
  if (request.method === "GET" && sessionMatch) {
    const { session, mysteryCase } = await getSessionContext(store, sessionMatch[1]!);
    return jsonResponse({ session: serializeSession(mysteryCase, session) });
  }

  const messageMatch = pathname.match(/^\/api\/session\/([^/]+)\/messages\/([^/]+)$/u);
  if (request.method === "GET" && messageMatch) {
    return jsonResponse({ messages: [] });
  }

  const chatMatch = pathname.match(/^\/api\/session\/([^/]+)\/chat\/([^/]+)$/u);
  if (request.method === "POST" && chatMatch) {
    return handleChatStream(store, env, request, chatMatch[1]!, chatMatch[2]!);
  }

  const accuseMatch = pathname.match(/^\/api\/session\/([^/]+)\/accuse$/u);
  if (request.method === "POST" && accuseMatch) {
    const { suspectId, reasoning: rawReasoning, citedNodeIds: rawCitedNodeIds } = await readJsonBody<{
      suspectId?: string;
      reasoning?: unknown;
      citedNodeIds?: unknown;
    }>(request);
    if (!suspectId) {
      return jsonResponse({ error: "缺少 suspectId。" }, 400);
    }

    const { session, mysteryCase } = await getSessionContext(store, accuseMatch[1]!);
    if (!mysteryCase.suspects.some((suspect) => suspect.id === suspectId)) {
      return jsonResponse({ error: "嫌疑人不存在。" }, 404);
    }

    const reasoning = typeof rawReasoning === "string" ? rawReasoning : "";
    const citedNodeIds = Array.isArray(rawCitedNodeIds) ? rawCitedNodeIds.filter((id): id is string => typeof id === "string") : [];
    const citedNodes = mysteryCase.investigationNodes.filter((node) => citedNodeIds.includes(node.id));

    const stateSession = await store.updateSessionState(session.id, (state) => ({
      ...state,
      accusedSuspectId: suspectId,
    }));
    const solvedSession = await store.updateSessionStatus(session.id, "solved");
    void stateSession;

    const judgement = judgeAccusation(mysteryCase, suspectId);
    try {
      const evaluation = await evaluateAccusation((await createGateways(env, store)).playGateway, mysteryCase, suspectId, reasoning, citedNodes);
      judgement.deduction = evaluation.deduction;
      judgement.consequence = evaluation.consequence;
    } catch (error) {
      console.error("[CF Web] 结案推理评估失败，使用兜底结局：", error);
      judgement.consequence = buildFallbackConsequence(mysteryCase, suspectId);
    }

    return jsonResponse({
      judgement,
      session: serializeSession(mysteryCase, solvedSession),
    });
  }

  const revealMatch = pathname.match(/^\/api\/session\/([^/]+)\/reveal$/u);
  if (request.method === "POST" && revealMatch) {
    const { session, mysteryCase } = await getSessionContext(store, revealMatch[1]!);
    await store.updateSessionState(session.id, (state) => ({
      ...state,
      accusedSuspectId: mysteryCase.solution.culpritId,
    }));
    const solvedSession = await store.updateSessionStatus(session.id, "solved");
    return jsonResponse({
      judgement: revealSolution(mysteryCase),
      session: serializeSession(mysteryCase, solvedSession),
    });
  }

  const exportMatch = pathname.match(/^\/api\/session\/([^/]+)\/export$/u);
  if (request.method === "GET" && exportMatch) {
    const { mysteryCase } = await getSessionContext(store, exportMatch[1]!);
    return jsonDownloadResponse(buildDownloadFileName(mysteryCase.title), mysteryCase);
  }

  return jsonResponse({ error: "接口不存在。" }, 404);
}

type WorkerHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response>;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike) {
    try {
      const url = new URL(request.url);
      const { pathname } = url;

      if (pathname === "/vendor/sweetalert2.js") {
        return Response.redirect(SWEETALERT_JS_CDN, 302);
      }

      if (pathname === "/vendor/sweetalert2.css") {
        return Response.redirect(SWEETALERT_CSS_CDN, 302);
      }

      if (pathname === "/api/" || pathname.startsWith("/api/")) {
        return await routeApi(request, env, ctx, pathname);
      }

      if (pathname === "/") {
        return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
      }

      if (pathname === "/admin" || pathname === "/admin/") {
        return env.ASSETS.fetch(new Request(new URL("/admin.html", request.url), request));
      }

      if (pathname === "/favicon.ico") {
        return env.ASSETS.fetch(new Request(new URL("/favicon.svg", request.url), request));
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
} satisfies WorkerHandler;
