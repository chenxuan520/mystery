const app = document.querySelector("#app");

const state = {
  bootstrap: null,
  activeGenerationJob: null,
  generationError: null,
  session: null,
  selectedCharacterId: null,
  hintMasterChatMode: null,
  selectedNode: null,
  messagesByCharacter: {},
  draftsByCharacter: {},
  chatPending: false,
  judgement: null,
  lightbox: null,
  loadingText: "正在加载...",
  busy: false,
  voicePhase: "idle",
  voiceError: null,
};

let generationAttachmentId = 0;
let voiceInputRequestId = 0;
let chatLogViewState = { top: 0, stickToBottom: true };
let voiceRecorder = null;
let chatCachePersistTimer = null;
let skipNextCachedSessionRestore = false;
let suppressedChatCacheSessionId = null;

const CHAT_LOCAL_CACHE_KEY = "mystery-web-chat-cache-v1";
const HINT_MASTER_JUDGEMENT_CHAT_SUFFIX = "__judgement";
const DEBUG_LOG_LIMIT = 200;

function summarizeCachedState(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    activeSessionId: snapshot.activeSessionId ?? null,
    selectedCharacterId: snapshot.selectedCharacterId ?? null,
    hintMasterChatMode: snapshot.hintMasterChatMode ?? null,
    selectedNodeId: snapshot.selectedNodeId ?? null,
    sessionPreviewId: snapshot.sessionPreview?.sessionId ?? null,
    sessionPreviewStatus: snapshot.sessionPreview?.status ?? null,
    hasJudgement: Boolean(snapshot.judgement),
    messageCounts: Object.fromEntries(
      Object.entries(snapshot.messagesByCharacter ?? {}).map(([key, messages]) => [key, Array.isArray(messages) ? messages.length : 0]),
    ),
    draftKeys: Object.keys(snapshot.draftsByCharacter ?? {}),
  };
}

function debugChatCache(event, extra = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const entry = {
    time: new Date().toISOString(),
    event,
    ...extra,
  };

  const logs = Array.isArray(window.__mysteryDebugLogs) ? window.__mysteryDebugLogs : [];
  logs.push(entry);
  if (logs.length > DEBUG_LOG_LIMIT) {
    logs.splice(0, logs.length - DEBUG_LOG_LIMIT);
  }
  window.__mysteryDebugLogs = logs;
  if (window.__mysteryDebugToConsole === true) {
    console.log(`[Mystery Cache Debug] ${JSON.stringify(entry)}`);
  }
}

if (typeof window !== "undefined") {
  window.__mysteryDebugToConsole = window.__mysteryDebugToConsole === true;
  window.__mysteryDebugLogs = Array.isArray(window.__mysteryDebugLogs) ? window.__mysteryDebugLogs : [];
  window.__mysteryDumpDebugLogs = () => JSON.stringify(window.__mysteryDebugLogs ?? [], null, 2);
  window.__mysteryDumpChatCache = () => {
    try {
      const raw = localStorage.getItem(CHAT_LOCAL_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return {
        parseFailed: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
  window.__mysteryDumpChatCacheText = () => JSON.stringify(window.__mysteryDumpChatCache(), null, 2);
}

function localCacheAvailable() {
  return typeof localStorage !== "undefined";
}

function sanitizeCachedMessagesByCharacter(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => Array.isArray(value))
      .map(([characterId, messages]) => [
        characterId,
        messages
          .filter(
            (message) =>
              message &&
              typeof message === "object" &&
              typeof message.role === "string" &&
              typeof message.content === "string",
          )
          .map((message) => ({ role: message.role, content: message.content })),
      ]),
  );
}

function sanitizeCachedDraftsByCharacter(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => typeof value === "string")
      .map(([characterId, draft]) => [characterId, draft]),
  );
}

function sanitizeCachedSessionPreview(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  if (typeof input.sessionId !== "string" || typeof input.title !== "string" || typeof input.summary !== "string") {
    return null;
  }

  return {
    sessionId: input.sessionId,
    caseId: typeof input.caseId === "string" ? input.caseId : null,
    title: input.title,
    summary: input.summary,
    status: input.status === "solved" || input.status === "active" || input.status === "abandoned" ? input.status : null,
  };
}

function sanitizeCachedJudgement(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const keyContradictions = Array.isArray(input.keyContradictions)
    ? input.keyContradictions
        .filter(
          (item) =>
            item &&
            typeof item === "object" &&
            typeof item.title === "string" &&
            typeof item.summary === "string" &&
            typeof item.implication === "string",
        )
        .map((item) => ({
          title: item.title,
          summary: item.summary,
          implication: item.implication,
        }))
    : [];

  const hiddenRelationships = Array.isArray(input.hiddenRelationships)
    ? input.hiddenRelationships
        .filter(
          (item) =>
            item &&
            typeof item === "object" &&
            typeof item.surface === "string" &&
            typeof item.hiddenTruth === "string",
        )
        .map((item) => ({
          surface: item.surface,
          hiddenTruth: item.hiddenTruth,
        }))
    : [];

  if (
    typeof input.culpritName !== "string" ||
    typeof input.accusedName !== "string" ||
    typeof input.summary !== "string" ||
    typeof input.truthReveal !== "string" ||
    !Array.isArray(input.culpritPlan) ||
    !Array.isArray(input.redHerrings)
  ) {
    return null;
  }

  return {
    correct: Boolean(input.correct),
    culpritName: input.culpritName,
    accusedName: input.accusedName,
    summary: input.summary,
    truthReveal: input.truthReveal,
    culpritPlan: input.culpritPlan.filter((item) => typeof item === "string"),
    redHerrings: input.redHerrings.filter((item) => typeof item === "string"),
    keyContradictions,
    hiddenRelationships,
  };
}

function readChatLocalCache() {
  if (!localCacheAvailable()) {
    return null;
  }

  try {
    const raw = localStorage.getItem(CHAT_LOCAL_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const snapshot = {
      activeSessionId: typeof parsed?.activeSessionId === "string" ? parsed.activeSessionId : null,
      selectedCharacterId: typeof parsed?.selectedCharacterId === "string" ? parsed.selectedCharacterId : null,
      hintMasterChatMode: parsed?.hintMasterChatMode === "judgement" || parsed?.hintMasterChatMode === "sidebar" ? parsed.hintMasterChatMode : null,
      selectedNodeId: typeof parsed?.selectedNodeId === "string" ? parsed.selectedNodeId : null,
      sessionPreview: sanitizeCachedSessionPreview(parsed?.sessionPreview),
      messagesByCharacter: sanitizeCachedMessagesByCharacter(parsed?.messagesByCharacter),
      draftsByCharacter: sanitizeCachedDraftsByCharacter(parsed?.draftsByCharacter),
      judgement: sanitizeCachedJudgement(parsed?.judgement),
    };
    debugChatCache("read-cache", { snapshot: summarizeCachedState(snapshot) });
    return snapshot;
  } catch {
    debugChatCache("read-cache-failed");
    return null;
  }
}

function clearChatLocalCacheStorage() {
  if (!localCacheAvailable()) {
    return;
  }

  try {
    localStorage.removeItem(CHAT_LOCAL_CACHE_KEY);
  } catch {
    // Ignore local cache failures.
  }
}

function buildChatLocalCacheSnapshot() {
  if (suppressedChatCacheSessionId && state.session?.sessionId === suppressedChatCacheSessionId) {
    return {
      activeSessionId: null,
      selectedCharacterId: null,
      hintMasterChatMode: null,
      selectedNodeId: null,
      sessionPreview: null,
      messagesByCharacter: {},
      draftsByCharacter: {},
      judgement: null,
    };
  }

  return {
    activeSessionId: state.session?.sessionId ?? null,
    selectedCharacterId: state.selectedCharacterId ?? null,
    hintMasterChatMode: state.hintMasterChatMode ?? null,
    selectedNodeId: state.selectedNode?.id ?? null,
    sessionPreview: state.session
        ? {
            sessionId: state.session.sessionId,
            caseId: state.session.caseId ?? null,
            title: state.session.title,
            summary: state.session.publicSummary,
            status: state.session.status,
          }
      : null,
    messagesByCharacter: Object.fromEntries(
      Object.entries(state.messagesByCharacter).map(([characterId, messages]) => [
        characterId,
        (messages ?? []).map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ]),
    ),
    draftsByCharacter: { ...state.draftsByCharacter },
    judgement: state.judgement
      ? {
          correct: state.judgement.correct,
          culpritName: state.judgement.culpritName,
          accusedName: state.judgement.accusedName,
          summary: state.judgement.summary,
          truthReveal: state.judgement.truthReveal,
          culpritPlan: [...state.judgement.culpritPlan],
          redHerrings: [...state.judgement.redHerrings],
          keyContradictions: state.judgement.keyContradictions.map((item) => ({
            title: item.title,
            summary: item.summary,
            implication: item.implication,
          })),
          hiddenRelationships: (state.judgement.hiddenRelationships ?? []).map((item) => ({
            surface: item.surface,
            hiddenTruth: item.hiddenTruth,
          })),
        }
      : null,
  };
}

function rebuildSelectedNodeFromSession(session, selectedNodeId) {
  if (!session || !selectedNodeId) {
    return null;
  }

  const nodeMeta = session.investigationNodes.find((node) => node.id === selectedNodeId);
  const nodeDetail = session.notebook?.find((node) => node.id === selectedNodeId);
  if (!nodeMeta) {
    return null;
  }

  return {
    id: nodeMeta.id,
    title: nodeMeta.title,
    category: nodeMeta.category,
    visualHint: nodeMeta.visualHint,
    summary: nodeDetail?.summary ?? "该节点已缓存，但详细摘要需要重新进入案件后再查看。",
    discovery: nodeDetail?.discovery ?? "该节点已缓存，但详细发现需要重新进入案件后再查看。",
    contradictionIds: Array.isArray(nodeDetail?.contradictionIds) ? nodeDetail.contradictionIds : [],
  };
}

function applyCachedChatStateForSession(session) {
  const cache = readChatLocalCache();
  if (!session || !cache?.activeSessionId || cache.activeSessionId !== session.sessionId) {
    state.messagesByCharacter = {};
    state.draftsByCharacter = {};
    state.hintMasterChatMode = null;
    state.judgement = null;
    debugChatCache("apply-cache-miss", {
      sessionId: session?.sessionId ?? null,
      cacheSessionId: cache?.activeSessionId ?? null,
    });
    return false;
  }

  state.messagesByCharacter = cache.messagesByCharacter;
  state.draftsByCharacter = cache.draftsByCharacter;

  const characterIds = new Set([
    session.hintMaster?.id,
    ...(session.suspects ?? []).map((character) => character.id),
    ...(session.npcs ?? []).map((character) => character.id),
  ].filter(Boolean));

  state.selectedCharacterId = cache.selectedCharacterId && characterIds.has(cache.selectedCharacterId) ? cache.selectedCharacterId : null;
  state.judgement = session.status === "solved" ? cache.judgement : null;

  if (state.selectedCharacterId === session.hintMaster?.id) {
    state.hintMasterChatMode = cache.hintMasterChatMode === "judgement" && state.judgement ? "judgement" : "sidebar";
  } else {
    state.hintMasterChatMode = null;
  }

  state.selectedNode = rebuildSelectedNodeFromSession(session, cache.selectedNodeId);

  const selectedChatKey = currentChatKey();
  if (selectedChatKey && !state.messagesByCharacter[selectedChatKey]) {
    state.messagesByCharacter[selectedChatKey] = [];
  }

  debugChatCache("apply-cache-hit", {
    sessionId: session.sessionId,
    snapshot: summarizeCachedState(buildChatLocalCacheSnapshot()),
  });

  return true;
}

function persistChatLocalCacheNow() {
  if (!localCacheAvailable()) {
    return;
  }

  try {
    const snapshot = buildChatLocalCacheSnapshot();
    if (!snapshot.activeSessionId && !Object.keys(snapshot.messagesByCharacter).length && !Object.keys(snapshot.draftsByCharacter).length) {
      localStorage.removeItem(CHAT_LOCAL_CACHE_KEY);
      debugChatCache("persist-cache-cleared", { snapshot: summarizeCachedState(snapshot) });
      return;
    }

    localStorage.setItem(CHAT_LOCAL_CACHE_KEY, JSON.stringify(snapshot));
    debugChatCache("persist-cache", { snapshot: summarizeCachedState(snapshot) });
  } catch {
    // Ignore local cache failures.
    debugChatCache("persist-cache-failed");
  }
}

function flushChatLocalCacheNow() {
  debugChatCache("flush-cache-start", { hasPendingTimer: Boolean(chatCachePersistTimer) });
  if (chatCachePersistTimer) {
    clearTimeout(chatCachePersistTimer);
    chatCachePersistTimer = null;
  }

  persistChatLocalCacheNow();
  debugChatCache("flush-cache-end", { snapshot: summarizeCachedState(readChatLocalCache()) });
}

function schedulePersistChatLocalCache() {
  if (chatCachePersistTimer) {
    clearTimeout(chatCachePersistTimer);
  }

  debugChatCache("schedule-persist", { snapshot: summarizeCachedState(buildChatLocalCacheSnapshot()) });

  chatCachePersistTimer = setTimeout(() => {
    chatCachePersistTimer = null;
    persistChatLocalCacheNow();
  }, 80);
}

function cachedLatestSessionPreview() {
  return readChatLocalCache()?.sessionPreview ?? null;
}

function resetSuppressedChatCacheIfSessionChanged(nextSessionId) {
  if (suppressedChatCacheSessionId && nextSessionId && nextSessionId !== suppressedChatCacheSessionId) {
    suppressedChatCacheSessionId = null;
  }
}

function isArchiveSameAsCachedLatest(archive, latest) {
  if (!archive || !latest) {
    return false;
  }

  return typeof archive.caseId === "string" && typeof latest.caseId === "string" && archive.caseId === latest.caseId;
}

async function restoreCachedSessionView() {
  if (state.session) {
    return false;
  }

  if (skipNextCachedSessionRestore) {
    skipNextCachedSessionRestore = false;
    debugChatCache("restore-cached-session-skipped-once");
    return false;
  }

  const cache = readChatLocalCache();
  if (!cache?.activeSessionId) {
    debugChatCache("restore-cached-session-no-cache");
    return false;
  }

  try {
    const data = await fetchJson(`/api/session/${cache.activeSessionId}`);
    state.session = data.session;
    resetSuppressedChatCacheIfSessionChanged(state.session?.sessionId);
    applyCachedChatStateForSession(state.session);
    debugChatCache("restore-cached-session-success", {
      sessionId: state.session.sessionId,
      snapshot: summarizeCachedState(buildChatLocalCacheSnapshot()),
    });

    return true;
  } catch {
    clearChatLocalCacheStorage();
    debugChatCache("restore-cached-session-failed", { cacheSessionId: cache.activeSessionId });
    return false;
  }
}

async function clearChatLocalCacheAction() {
  const confirmed = await confirmAction({
    title: "清空本地聊天缓存？",
    text: "这只会清掉浏览器里的恢复状态，不会删除案件、会话状态或归档数据。",
    confirmText: "清空",
    cancelText: "保留",
    icon: "warning",
  });
  if (!confirmed) {
    return;
  }

  await abortVoiceInput();
  suppressedChatCacheSessionId = state.session?.sessionId ?? null;
  clearChatLocalCacheStorage();
  state.messagesByCharacter = {};
  state.draftsByCharacter = {};
  state.selectedCharacterId = null;
  state.hintMasterChatMode = null;
  state.selectedNode = null;
  state.judgement = null;
  state.chatPending = false;
  render();
}

class GenerationAttachmentDetachedError extends Error {
  constructor() {
    super("generation-attachment-detached");
    this.name = "GenerationAttachmentDetachedError";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function svgToDataUrl(svg) {
  if (!svg) {
    return "";
  }

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function roleBadge(label, variant = "default") {
  return `<span class="role-badge role-${variant}">${escapeHtml(label)}</span>`;
}

function zoomableImage(svg, alt, className) {
  if (!svg) {
    return "";
  }

  const src = svgToDataUrl(svg);
  return `<img class="${className} zoomable-image" src="${src}" alt="${escapeHtml(alt)}" data-zoom-src="${src}" data-zoom-alt="${escapeHtml(alt)}" />`;
}

function renderCharacterButton(character, roleLabel, variant) {
  return `
    <button class="secondary character-button ${state.selectedCharacterId === character.id ? "active" : ""}" data-character-id="${escapeHtml(character.id)}">
      ${zoomableImage(character.avatarSvg, `${character.name} 头像`, "character-thumb")}
      <span class="character-button-body">
        <span class="character-button-name">${escapeHtml(character.name)}</span>
        <span class="character-button-meta">${escapeHtml(character.publicPersona)}</span>
      </span>
      ${roleBadge(roleLabel, variant)}
    </button>
  `;
}

function clearSelection() {
  void abortVoiceInput();
  state.selectedNode = null;
  state.selectedCharacterId = null;
  state.hintMasterChatMode = null;
  schedulePersistChatLocalCache();
  render();
}

async function returnToStart() {
  await abortVoiceInput();
  detachGenerationAttachment();
  debugChatCache("return-to-start-before-flush", { snapshot: summarizeCachedState(buildChatLocalCacheSnapshot()) });
  flushChatLocalCacheNow();
  skipNextCachedSessionRestore = true;
  state.session = null;
  state.selectedNode = null;
  state.selectedCharacterId = null;
  state.hintMasterChatMode = null;
  state.judgement = null;
  state.messagesByCharacter = {};
  state.draftsByCharacter = {};
  debugChatCache("return-to-start-after-clear");
  await loadBootstrap();
}

function captureViewState() {
  const chatLog = document.querySelector("#chat-log");
  if (!chatLog) {
    return;
  }

  const distanceFromBottom = chatLog.scrollHeight - (chatLog.scrollTop + chatLog.clientHeight);
  chatLogViewState = {
    top: chatLog.scrollTop,
    stickToBottom: distanceFromBottom <= 24,
  };
}

function restoreViewState() {
  const chatLog = document.querySelector("#chat-log");
  if (!chatLog) {
    return;
  }

  if (chatLogViewState.stickToBottom) {
    chatLog.scrollTop = chatLog.scrollHeight;
    return;
  }

  const maxScrollTop = Math.max(0, chatLog.scrollHeight - chatLog.clientHeight);
  chatLog.scrollTop = Math.min(chatLogViewState.top, maxScrollTop);
}

function renderLightbox() {
  if (!state.lightbox) {
    return "";
  }

  return `
    <div class="lightbox" id="lightbox">
      <button class="lightbox-close" id="lightbox-close">关闭</button>
      <img class="lightbox-image" src="${state.lightbox.src}" alt="${escapeHtml(state.lightbox.alt)}" />
      <div class="lightbox-caption">${escapeHtml(state.lightbox.alt)}</div>
    </div>
  `;
}

function bindLightboxEvents() {
  document.querySelectorAll(".zoomable-image").forEach((image) => {
    image.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      state.lightbox = {
        src: image.dataset.zoomSrc,
        alt: image.dataset.zoomAlt || "图片预览",
      };
      render();
    });
  });

  document.querySelector("#lightbox")?.addEventListener("click", (event) => {
    if (event.target.id === "lightbox" || event.target.id === "lightbox-close") {
      state.lightbox = null;
      render();
    }
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error || `请求失败：${response.status}`);
  }

  return data;
}

async function confirmAction({ title, text, confirmText = "确定", cancelText = "取消", icon = "question" }) {
  if (window.Swal?.fire) {
    const result = await window.Swal.fire({
      title,
      text,
      icon,
      showCancelButton: true,
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      reverseButtons: true,
      background: "#111827",
      color: "#f8fafc",
      confirmButtonColor: "#2563eb",
      cancelButtonColor: "#374151",
      customClass: {
        popup: "mystery-swal-popup",
        title: "mystery-swal-title",
        htmlContainer: "mystery-swal-text",
      },
    });
    return result.isConfirmed;
  }

  return window.confirm(text ? `${title}\n\n${text}` : title);
}

function setBusy(loadingText) {
  state.busy = true;
  state.loadingText = loadingText;
  render();
}

function clearBusy() {
  state.busy = false;
  render();
}

function hintMasterCharacter() {
  return state.session?.hintMaster ?? null;
}

function currentChatKey() {
  if (!state.selectedCharacterId) {
    return null;
  }

  const hintMasterId = hintMasterCharacter()?.id;
  if (hintMasterId && state.selectedCharacterId === hintMasterId && state.hintMasterChatMode === "judgement") {
    return `${hintMasterId}${HINT_MASTER_JUDGEMENT_CHAT_SUFFIX}`;
  }

  return state.selectedCharacterId;
}

function allCharacters() {
  return [hintMasterCharacter(), ...(state.session?.suspects ?? []), ...(state.session?.npcs ?? [])].filter(Boolean);
}

function findCharacter(characterId) {
  return allCharacters().find((character) => character.id === characterId) ?? null;
}

function currentMessages() {
  const chatKey = currentChatKey();
  if (!chatKey) {
    return [];
  }

  return state.messagesByCharacter[chatKey] ?? [];
}

function currentCharacterPanelState() {
  if (!state.session || !state.selectedCharacterId) {
    return null;
  }

  const character = findCharacter(state.selectedCharacterId);
  if (!character) {
    return null;
  }

  return {
    character,
    isHintMaster: hintMasterCharacter()?.id === character.id,
    isSuspect: state.session.suspects.some((item) => item.id === character.id),
    showVoiceButton: voiceInputEnabled(),
    voiceButtonDisabled: state.busy || state.chatPending || state.voicePhase === "starting" || state.voicePhase === "transcribing",
    sendDisabled: state.busy || state.chatPending || state.voicePhase !== "idle",
  };
}

function renderChatMessageText(message, characterName) {
  if (message.role === "user") {
    return `你：${message.content}`;
  }

  if (message.role === "assistant") {
    return `${characterName}：${message.content}`;
  }

  return `[系统] ${message.content}`;
}

function renderCurrentChatMessagesHtml(character) {
  return currentMessages()
    .map(
      (message) => `
        <div class="message ${escapeHtml(message.role)}">${escapeHtml(renderChatMessageText(message, character.name))}</div>`,
    )
    .join("");
}

function normalizeInterruptedAssistantMessage(chatKey, assistantMessage) {
  const marker = "\n\n[系统] 回复中断：";
  if (!assistantMessage?.content?.includes(marker)) {
    return;
  }

  const messages = [...(state.messagesByCharacter[chatKey] ?? [])];
  const assistantIndex = messages.indexOf(assistantMessage);
  if (assistantIndex === -1) {
    return;
  }

  const markerIndex = assistantMessage.content.indexOf(marker);
  const assistantText = assistantMessage.content.slice(0, markerIndex).trimEnd();
  const systemText = assistantMessage.content.slice(markerIndex + marker.length).trim();

  if (assistantText) {
    assistantMessage.content = assistantText;
  } else {
    messages.splice(assistantIndex, 1);
  }

  if (systemText) {
    const insertIndex = assistantText ? assistantIndex + 1 : assistantIndex;
    messages.splice(insertIndex, 0, {
      role: "system",
      content: `回复中断：${systemText}`,
    });
  }

  state.messagesByCharacter[chatKey] = messages;
}

function renderVoiceErrorHtml() {
  return state.voiceError ? `<div class="note"><strong>语音输入失败</strong>${escapeHtml(state.voiceError)}</div>` : "";
}

function currentVoiceButtonText() {
  if (state.voicePhase === "recording") {
    return "停止录音";
  }

  if (state.voicePhase === "starting") {
    return "连接中...";
  }

  if (state.voicePhase === "transcribing") {
    return "收尾中...";
  }

  return "语音输入";
}

function syncCharacterChatView() {
  const panelState = currentCharacterPanelState();
  const chatLog = document.querySelector("#chat-log");
  if (!panelState || !chatLog) {
    return false;
  }

  captureViewState();
  chatLog.innerHTML = renderCurrentChatMessagesHtml(panelState.character);

  const input = document.querySelector("#chat-input");
  if (input) {
    if (input.value !== currentChatDraft()) {
      input.value = currentChatDraft();
    }
    input.disabled = state.busy;
  }

  const sendButton = document.querySelector("#send-chat");
  if (sendButton) {
    sendButton.disabled = panelState.sendDisabled;
  }

  const voiceButton = document.querySelector("#toggle-voice");
  if (voiceButton) {
    voiceButton.disabled = panelState.voiceButtonDisabled;
    voiceButton.textContent = currentVoiceButtonText();
    voiceButton.classList.toggle("recording", state.voicePhase === "recording");
  }

  const voiceStatus = document.querySelector("#voice-status");
  if (voiceStatus) {
    voiceStatus.textContent = voiceStatusText();
  }

  const voiceError = document.querySelector("#voice-error-slot");
  if (voiceError) {
    voiceError.innerHTML = renderVoiceErrorHtml();
  }

  restoreViewState();
  return true;
}

function refreshActiveView() {
  if (!syncCharacterChatView()) {
    render();
  }
}

function currentChatDraft() {
  const chatKey = currentChatKey();
  if (!chatKey) {
    return "";
  }

  return state.draftsByCharacter[chatKey] ?? "";
}

function setCurrentChatDraft(value) {
  const chatKey = currentChatKey();
  if (!chatKey) {
    return;
  }

  state.draftsByCharacter[chatKey] = value;
  schedulePersistChatLocalCache();
}

function voiceInputEnabled() {
  return Boolean(state.bootstrap?.voiceInput?.enabled);
}

function appendRecognizedText(existingText, recognizedText) {
  const next = String(recognizedText ?? "").trim();
  if (!next) {
    return existingText;
  }

  const previous = String(existingText ?? "");
  const needsSpace = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(next);
  return `${previous}${needsSpace ? " " : ""}${next}`;
}

function focusChatInput() {
  window.requestAnimationFrame(() => {
    document.querySelector("#chat-input")?.focus();
  });
}

function browserSupportsVoiceInput() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  return Boolean(navigator.mediaDevices?.getUserMedia && AudioContextCtor);
}

function formatVoiceInputError(error) {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "语音输入失败。");

  if (rawMessage === "NotAllowedError" || rawMessage.includes("Permission denied") || rawMessage.includes("permission denied")) {
    return "浏览器没有获得麦克风权限，请先允许访问麦克风。";
  }

  if (rawMessage === "NotFoundError" || rawMessage.includes("Requested device not found")) {
    return "没有检测到可用麦克风。";
  }

  if (rawMessage === "NotReadableError") {
    return "麦克风当前不可用，可能正被别的应用占用。";
  }

  return rawMessage;
}

function stopMediaStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function mergeFloat32Chunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function concatFloat32Buffers(left, right) {
  if (!left?.length) {
    return right;
  }

  if (!right?.length) {
    return left;
  }

  return mergeFloat32Chunks([left, right]);
}

function downsampleBuffer(sourceBuffer, sourceRate, targetRate) {
  if (sourceRate === targetRate) {
    return sourceBuffer;
  }

  if (sourceRate < targetRate) {
    throw new Error("浏览器录音采样率异常，请重试。");
  }

  const sampleRateRatio = sourceRate / targetRate;
  const resultLength = Math.max(1, Math.round(sourceBuffer.length / sampleRateRatio));
  const result = new Float32Array(resultLength);
  let sourceOffset = 0;

  for (let index = 0; index < result.length; index += 1) {
    const nextSourceOffset = Math.min(sourceBuffer.length, Math.round((index + 1) * sampleRateRatio));
    let total = 0;
    let count = 0;

    for (let offset = sourceOffset; offset < nextSourceOffset; offset += 1) {
      total += sourceBuffer[offset] ?? 0;
      count += 1;
    }

    result[index] = count > 0 ? total / count : sourceBuffer[sourceOffset] ?? 0;
    sourceOffset = nextSourceOffset;
  }

  return result;
}

function encodePcm16(floatBuffer) {
  const pcmBuffer = new ArrayBuffer(floatBuffer.length * 2);
  const view = new DataView(pcmBuffer);

  for (let index = 0; index < floatBuffer.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, floatBuffer[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return pcmBuffer;
}

function voiceStatusText() {
  if (state.voicePhase === "starting") {
    return "正在连接语音识别服务...";
  }

  if (state.voicePhase === "recording") {
    return "录音中，识别结果会持续写进输入框；再点一次“停止录音”结束。";
  }

  if (state.voicePhase === "transcribing") {
    return "正在收尾并补上最后一段识别结果...";
  }

  return "可把说话内容先转成文字，再手动确认发送。";
}

async function closeVoiceRecorderResources(recorder) {
  try {
    recorder.processor.onaudioprocess = null;
    recorder.source.disconnect();
    recorder.processor.disconnect();
    recorder.silentGain.disconnect();
  } catch {
    // Ignore cleanup failures.
  }

  stopMediaStream(recorder.stream);
  await recorder.audioContext.close().catch(() => undefined);
}

async function abortVoiceBackendSession(sessionId) {
  if (!sessionId) {
    return;
  }

  await fetchJson(`/api/voice-input/session/${sessionId}`, {
    method: "DELETE",
    body: "{}",
  }).catch(() => undefined);
}

async function failVoiceInput(recorder, error) {
  if (!recorder || recorder.requestId !== voiceInputRequestId) {
    return;
  }

  const message = formatVoiceInputError(error);
  voiceInputRequestId += 1;
  voiceRecorder = null;
  state.voicePhase = "idle";
  state.voiceError = message;
  await abortVoiceBackendSession(recorder.sessionId);
  await closeVoiceRecorderResources(recorder);
  schedulePersistChatLocalCache();
  refreshActiveView();
}

function queueVoiceChunkUpload(recorder, pcmBuffer) {
  if (!pcmBuffer?.byteLength) {
    return;
  }

  recorder.uploadChain = recorder.uploadChain
    .then(async () => {
      if (recorder.requestId !== voiceInputRequestId) {
        return;
      }

      const data = await fetchJson(`/api/voice-input/session/${recorder.sessionId}/chunk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: pcmBuffer,
      });

      if (recorder.requestId !== voiceInputRequestId || !data.text) {
        return;
      }

      state.draftsByCharacter[recorder.chatKey] = appendRecognizedText(
        state.draftsByCharacter[recorder.chatKey] ?? "",
        data.text,
      );
      schedulePersistChatLocalCache();
      refreshActiveView();
    })
    .catch(async (error) => {
      await failVoiceInput(recorder, error);
    });
}

function flushVoicePendingSamples(recorder, flushAll = false) {
  while (recorder.pendingSource.length >= recorder.sourceChunkSamples) {
    const sourceChunk = recorder.pendingSource.slice(0, recorder.sourceChunkSamples);
    recorder.pendingSource = recorder.pendingSource.slice(recorder.sourceChunkSamples);
    const downsampled = downsampleBuffer(sourceChunk, recorder.sampleRate, recorder.targetSampleRate);
    queueVoiceChunkUpload(recorder, encodePcm16(downsampled));
  }

  if (flushAll && recorder.pendingSource.length > 0) {
    const downsampled = downsampleBuffer(recorder.pendingSource, recorder.sampleRate, recorder.targetSampleRate);
    recorder.pendingSource = new Float32Array(0);
    queueVoiceChunkUpload(recorder, encodePcm16(downsampled));
  }
}

async function abortVoiceInput() {
  voiceInputRequestId += 1;

  const recorder = voiceRecorder;
  voiceRecorder = null;
  state.voicePhase = "idle";
  state.voiceError = null;

  if (recorder) {
    await abortVoiceBackendSession(recorder.sessionId);
    await closeVoiceRecorderResources(recorder);
  }
}

async function startVoiceInput() {
  if (!voiceInputEnabled() || state.busy || state.voicePhase !== "idle") {
    return;
  }

  if (!browserSupportsVoiceInput()) {
    state.voiceError = "当前浏览器不支持语音输入。";
    refreshActiveView();
    return;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const requestId = ++voiceInputRequestId;
  let voiceSessionId = null;
  state.voicePhase = "starting";
  state.voiceError = null;
  refreshActiveView();

  try {
    const sessionData = await fetchJson("/api/voice-input/session/start", {
      method: "POST",
      body: "{}",
    });
    voiceSessionId = sessionData.sessionId;
    if (requestId !== voiceInputRequestId) {
      await abortVoiceBackendSession(sessionData.sessionId);
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new AudioContextCtor();
    await audioContext.resume();
    if (requestId !== voiceInputRequestId) {
      stopMediaStream(stream);
      await audioContext.close().catch(() => undefined);
      await abortVoiceBackendSession(voiceSessionId);
      return;
    }
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    const chunkMs = state.bootstrap?.voiceInput?.chunkMs ?? 200;

    processor.onaudioprocess = (event) => {
      if (!voiceRecorder || voiceRecorder.requestId !== requestId) {
        return;
      }

      const inputChannel = event.inputBuffer.getChannelData(0);
      voiceRecorder.pendingSource = concatFloat32Buffers(voiceRecorder.pendingSource, new Float32Array(inputChannel));
      flushVoicePendingSamples(voiceRecorder);
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);

    voiceRecorder = {
      requestId,
      characterId: state.selectedCharacterId,
      sessionId: sessionData.sessionId,
      stream,
      audioContext,
      source,
      processor,
      silentGain,
      sampleRate: audioContext.sampleRate,
      targetSampleRate: state.bootstrap?.voiceInput?.sampleRate ?? 16000,
      sourceChunkSamples: Math.max(1, Math.floor((audioContext.sampleRate * chunkMs) / 1000)),
      pendingSource: new Float32Array(0),
      chatKey: currentChatKey(),
      uploadChain: Promise.resolve(),
    };
    state.voicePhase = "recording";
    state.voiceError = null;
    render();
  } catch (error) {
    if (requestId === voiceInputRequestId) {
      await abortVoiceBackendSession(voiceSessionId);
      state.voicePhase = "idle";
      state.voiceError = formatVoiceInputError(error);
      refreshActiveView();
    }
  }
}

async function stopVoiceInput() {
  const recorder = voiceRecorder;
  voiceRecorder = null;

  if (!recorder) {
    state.voicePhase = "idle";
    refreshActiveView();
    return;
  }

  state.voicePhase = "transcribing";
  state.voiceError = null;
  refreshActiveView();

  try {
    await closeVoiceRecorderResources(recorder);
    flushVoicePendingSamples(recorder, true);
    await recorder.uploadChain;

    if (recorder.requestId !== voiceInputRequestId) {
      return;
    }

    const data = await fetchJson(`/api/voice-input/session/${recorder.sessionId}/stop`, {
      method: "POST",
      body: "{}",
    });

    if (recorder.requestId !== voiceInputRequestId) {
      return;
    }

    if (recorder.chatKey && data.text) {
      state.draftsByCharacter[recorder.chatKey] = appendRecognizedText(
        state.draftsByCharacter[recorder.chatKey] ?? "",
        data.text,
      );
    }
    state.voicePhase = "idle";
    state.voiceError = null;
    schedulePersistChatLocalCache();
    refreshActiveView();
    focusChatInput();
  } catch (error) {
    if (recorder.requestId !== voiceInputRequestId) {
      return;
    }

    await abortVoiceBackendSession(recorder.sessionId);
    state.voicePhase = "idle";
    state.voiceError = formatVoiceInputError(error);
    schedulePersistChatLocalCache();
    refreshActiveView();
  }
}

async function toggleVoiceInput() {
  if (state.voicePhase === "recording") {
    await stopVoiceInput();
    return;
  }

  if (state.voicePhase === "transcribing") {
    return;
  }

  await startVoiceInput();
}

async function loadBootstrap() {
  state.bootstrap = await fetchJson("/api/bootstrap");
  state.activeGenerationJob = state.bootstrap.activeGenerationJob ?? null;
  state.generationError =
    state.bootstrap.latestGenerationJob?.status === "failed"
      ? state.bootstrap.latestGenerationJob.error || state.bootstrap.latestGenerationJob.progress?.message || "案件生成失败"
      : null;
  await restoreCachedSessionView();
  render();
}

function detachGenerationAttachment() {
  generationAttachmentId += 1;
}

async function waitForGenerationJob(jobId, attachmentId) {
  while (true) {
    if (attachmentId !== generationAttachmentId) {
      throw new GenerationAttachmentDetachedError();
    }

    const job = await fetchJson(`/api/generation-jobs/${jobId}`);
    if (attachmentId !== generationAttachmentId) {
      throw new GenerationAttachmentDetachedError();
    }

    state.activeGenerationJob = job.status === "completed" || job.status === "failed" ? null : job;
    if (state.bootstrap) {
      state.bootstrap.activeGenerationJob = state.activeGenerationJob;
    }

    if (job.progress?.message) {
      state.loadingText = job.progress.message;
    }
    if (!state.session) {
      render();
    }

    if (job.status === "completed") {
      return job;
    }

    if (job.status === "failed") {
      throw new Error(job.error || job.progress?.message || "生成案件失败");
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

async function resumeGenerationJob(jobId, loadingText = "正在恢复生成进度...") {
  const attachmentId = ++generationAttachmentId;
  state.generationError = null;
  setBusy(loadingText);
  try {
    clearBusy();
    const result = await waitForGenerationJob(jobId, attachmentId);
    if (attachmentId !== generationAttachmentId) {
      return;
    }

    state.session = result.session;
    resetSuppressedChatCacheIfSessionChanged(state.session?.sessionId);
    state.bootstrap = await fetchJson("/api/bootstrap");
    state.activeGenerationJob = state.bootstrap.activeGenerationJob ?? null;
    state.selectedNode = null;
    state.selectedCharacterId = null;
    state.hintMasterChatMode = null;
    state.messagesByCharacter = {};
    state.draftsByCharacter = {};
    state.judgement = null;
    state.generationError = null;
    schedulePersistChatLocalCache();
    render();
  } catch (error) {
    if (!(error instanceof GenerationAttachmentDetachedError)) {
      state.generationError = error instanceof Error ? error.message : String(error);
      if (state.bootstrap?.latestGenerationJob) {
        state.bootstrap.latestGenerationJob = {
          ...state.bootstrap.latestGenerationJob,
          status: "failed",
          error: state.generationError,
        };
      }
      render();
    }
  } finally {
    if (attachmentId === generationAttachmentId && state.busy) {
      clearBusy();
    }
  }
}

async function startNewSession() {
  const attachmentId = ++generationAttachmentId;
  state.generationError = null;
  setBusy(state.activeGenerationJob?.progress?.message ?? "正在提交生成请求...");
  try {
    const job = await fetchJson("/api/session/new", { method: "POST", body: "{}" });
    if (attachmentId === generationAttachmentId) {
      clearBusy();
    }
    const result = await waitForGenerationJob(job.jobId, attachmentId);
    if (attachmentId !== generationAttachmentId) {
      return;
    }

    state.session = result.session;
    resetSuppressedChatCacheIfSessionChanged(state.session?.sessionId);
    state.bootstrap = await fetchJson("/api/bootstrap");
    state.activeGenerationJob = state.bootstrap.activeGenerationJob ?? null;
    state.selectedNode = null;
    state.selectedCharacterId = null;
    state.hintMasterChatMode = null;
    state.messagesByCharacter = {};
    state.draftsByCharacter = {};
    state.judgement = null;
    state.generationError = null;
    schedulePersistChatLocalCache();
    render();
  } catch (error) {
    if (!(error instanceof GenerationAttachmentDetachedError)) {
      state.generationError = error instanceof Error ? error.message : String(error);
      if (state.bootstrap?.latestGenerationJob) {
        state.bootstrap.latestGenerationJob = {
          ...state.bootstrap.latestGenerationJob,
          status: "failed",
          error: state.generationError,
        };
      }
      render();
    }
  } finally {
    if (attachmentId === generationAttachmentId && state.busy) {
      clearBusy();
    }
  }
}

async function resumeLatest() {
  await abortVoiceInput();
  detachGenerationAttachment();
  setBusy("正在恢复最近一局...");
  try {
    const cache = readChatLocalCache();
    debugChatCache("resume-latest-start", { snapshot: summarizeCachedState(cache) });
    if (!cache?.activeSessionId) {
      throw new Error("当前浏览器没有可恢复的最近一局。请先从归档案件进入，或重新开始一局。",);
    }

    let data;
    try {
      data = await fetchJson(`/api/session/${cache.activeSessionId}`);
      debugChatCache("resume-latest-fetched-session", { sessionId: cache.activeSessionId });
    } catch {
      clearChatLocalCacheStorage();
      debugChatCache("resume-latest-failed-fetch", { sessionId: cache.activeSessionId });
      throw new Error("当前浏览器里记录的最近一局已失效，请重新进入案件。",);
    }

    state.session = data.session;
    resetSuppressedChatCacheIfSessionChanged(state.session?.sessionId);
    const restoredFromCache = applyCachedChatStateForSession(state.session);
    if (!restoredFromCache) {
      state.selectedNode = null;
      state.selectedCharacterId = null;
      state.hintMasterChatMode = null;
      state.judgement = null;
    }
    schedulePersistChatLocalCache();
    debugChatCache("resume-latest-end", {
      restoredFromCache,
      snapshot: summarizeCachedState(buildChatLocalCacheSnapshot()),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugChatCache("resume-latest-error", { message });
    if (window.Swal?.fire) {
      await window.Swal.fire({
        title: "无法恢复最近一局",
        text: message,
        icon: "error",
        background: "#111827",
        color: "#f8fafc",
        confirmButtonColor: "#2563eb",
        customClass: {
          popup: "mystery-swal-popup",
          title: "mystery-swal-title",
          htmlContainer: "mystery-swal-text",
        },
      });
    } else {
      window.alert?.(`无法恢复最近一局\n\n${message}`);
    }
  } finally {
    clearBusy();
  }
}

async function loadArchive(archiveId) {
  await abortVoiceInput();
  detachGenerationAttachment();
  setBusy("正在载入归档案件...");
  try {
    const data = await fetchJson("/api/session/from-archive", {
      method: "POST",
      body: JSON.stringify({ archiveId }),
    });
    state.session = data.session;
    resetSuppressedChatCacheIfSessionChanged(state.session?.sessionId);
    state.selectedNode = null;
    state.selectedCharacterId = null;
    state.hintMasterChatMode = null;
    state.messagesByCharacter = {};
    state.draftsByCharacter = {};
    state.judgement = null;
    schedulePersistChatLocalCache();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (window.Swal?.fire) {
      await window.Swal.fire({
        title: "载入归档失败",
        text: message,
        icon: "error",
        background: "#111827",
        color: "#f8fafc",
        confirmButtonColor: "#2563eb",
        customClass: {
          popup: "mystery-swal-popup",
          title: "mystery-swal-title",
          htmlContainer: "mystery-swal-text",
        },
      });
    } else {
      window.alert?.(`载入归档失败\n\n${message}`);
    }
  } finally {
    clearBusy();
  }
}

function exportCurrentCase() {
  if (!state.session) {
    return;
  }

  const link = document.createElement("a");
  link.href = `/api/session/${state.session.sessionId}/export`;
  link.download = `${state.session.title}.json`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function inspectNode(nodeId) {
  await abortVoiceInput();
  const data = await fetchJson(`/api/session/${state.session.sessionId}/investigate`, {
    method: "POST",
    body: JSON.stringify({ nodeId }),
  });
  state.session = data.session;
  state.selectedNode = data.node;
  state.selectedCharacterId = null;
  state.hintMasterChatMode = null;
  schedulePersistChatLocalCache();
  render();
}

async function openCharacterChat(characterId) {
  if (state.selectedCharacterId !== characterId || state.voicePhase !== "idle") {
    await abortVoiceInput();
  }

  state.voiceError = null;
  state.selectedCharacterId = characterId;
  state.hintMasterChatMode = characterId === hintMasterCharacter()?.id ? "sidebar" : null;
  state.selectedNode = null;

  const chatKey = currentChatKey();
  if (chatKey && !state.messagesByCharacter[chatKey]) {
    state.messagesByCharacter[chatKey] = [];
  }

  schedulePersistChatLocalCache();
  render();
}

async function openHintMasterChat() {
  const hintMaster = hintMasterCharacter();
  if (!hintMaster) {
    return;
  }

  if (state.judgement) {
    if (state.selectedCharacterId === hintMaster.id && state.hintMasterChatMode === "judgement") {
      focusChatInput();
      return;
    }

    if (state.voicePhase !== "idle") {
      await abortVoiceInput();
    }

    state.voiceError = null;
    state.selectedCharacterId = hintMaster.id;
    state.hintMasterChatMode = "judgement";
    state.selectedNode = null;

    const chatKey = currentChatKey();
    if (chatKey && !state.messagesByCharacter[chatKey]) {
      state.messagesByCharacter[chatKey] = [];
    }

    schedulePersistChatLocalCache();
    render();
    focusChatInput();
    return;
  }

  await openCharacterChat(hintMaster.id);
  focusChatInput();
}

function renderJudgementHintMasterFollowup() {
  const hintMaster = hintMasterCharacter();
  if (!hintMaster || state.selectedCharacterId !== hintMaster.id || state.hintMasterChatMode !== "judgement") {
    return "";
  }

  const panelState = currentCharacterPanelState();
  if (!panelState?.isHintMaster) {
    return "";
  }

  const { character, showVoiceButton, voiceButtonDisabled, sendDisabled } = panelState;

  return `
    <div class="result-followup-panel stack hint-master-panel">
      <div class="detail-header">
        <div>
          <span class="eyebrow">提示官</span>
          <h3 class="section-title">继续追问真相细节</h3>
          <div class="muted">不切换页面，直接在结果区继续追问动机、时间线和线索因果；这段复盘问答会和左侧提示官的普通聊天分开记忆。</div>
        </div>
        ${roleBadge("真相问答", "default")}
      </div>
      <div class="note"><strong>真相问答</strong>现在已经进入复盘阶段，你可以继续追问真凶动机、作案方法、时间线，或某条线索为什么成立。</div>
      <div class="chat-log" id="chat-log">
        ${renderCurrentChatMessagesHtml(character)}
      </div>
      <div class="chat-form">
        <input id="chat-input" value="${escapeHtml(currentChatDraft())}" placeholder="问真相细节、动机因果、时间线或某条线索为什么成立..." ${state.busy ? "disabled" : ""} />
        ${showVoiceButton ? `<button class="ghost voice-button ${state.voicePhase === "recording" ? "recording" : ""}" id="toggle-voice" ${voiceButtonDisabled ? "disabled" : ""}>${currentVoiceButtonText()}</button>` : ""}
        <button id="send-chat" ${sendDisabled ? "disabled" : ""}>发送</button>
      </div>
      ${showVoiceButton ? `<div class="muted voice-status" id="voice-status">${escapeHtml(voiceStatusText())}</div>` : ""}
      <div id="voice-error-slot">${renderVoiceErrorHtml()}</div>
    </div>
  `;
}

async function sendChat() {
  const characterId = state.selectedCharacterId;
  const chatKey = currentChatKey();
  const text = currentChatDraft().trim();

  if (!characterId || !chatKey || !text || state.voicePhase !== "idle" || state.chatPending) {
    return;
  }

  setCurrentChatDraft("");
  const messages = state.messagesByCharacter[chatKey] ?? [];
  const userMessage = { role: "user", content: text };
  const assistantMessage = { role: "assistant", content: "" };
  state.messagesByCharacter[chatKey] = [...messages, userMessage, assistantMessage];
  state.chatPending = true;
  schedulePersistChatLocalCache();
  refreshActiveView();

  try {
    const history = messages.map((message) => ({ role: message.role, content: message.content }));
    const response = await fetch(`/api/session/${state.session.sessionId}/chat/${characterId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userInput: text, history }),
    });

    if (!response.ok || !response.body) {
      throw new Error("聊天请求失败。");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      assistantMessage.content += decoder.decode(value, { stream: true });
      schedulePersistChatLocalCache();
      syncCharacterChatView();
    }

    assistantMessage.content += decoder.decode();
    normalizeInterruptedAssistantMessage(chatKey, assistantMessage);
    schedulePersistChatLocalCache();
    syncCharacterChatView();
  } catch (error) {
    assistantMessage.role = "system";
    const rawMessage = error instanceof Error ? error.message : String(error);
    assistantMessage.content = rawMessage.includes("Failed to fetch")
      ? "聊天连接断开了。请重试；如果刚刷新页面或服务刚重启，强刷后再试。"
      : rawMessage;
    console.error("[Web Chat Error]", error);
    schedulePersistChatLocalCache();
    syncCharacterChatView();
  } finally {
    state.chatPending = false;
    schedulePersistChatLocalCache();
    syncCharacterChatView();
  }
}

async function accuseSelected() {
  await abortVoiceInput();

  if (!state.selectedCharacterId) {
    return;
  }

  const suspect = state.session?.suspects.find((item) => item.id === state.selectedCharacterId);
  if (!suspect) {
    return;
  }

  const confirmed = await confirmAction({
    title: `确认指认 ${suspect.name} 吗？`,
    text: "确认后会直接进入结案判定。",
    confirmText: "确认指认",
    cancelText: "再想想",
    icon: "warning",
  });
  if (!confirmed) {
    return;
  }

  setBusy("正在判定...");
  try {
    const data = await fetchJson(`/api/session/${state.session.sessionId}/accuse`, {
      method: "POST",
      body: JSON.stringify({ suspectId: state.selectedCharacterId }),
    });
    state.session = data.session;
    state.judgement = data.judgement;
    schedulePersistChatLocalCache();
  } finally {
    clearBusy();
  }
}

async function revealAnswer() {
  await abortVoiceInput();

  if (!state.session) {
    return;
  }

  const confirmed = await confirmAction({
    title: "确认直接看答案吗？",
    text: "这会直接展示真相，不再保留盲推状态。",
    confirmText: "直接揭晓",
    cancelText: "继续自己推",
    icon: "info",
  });
  if (!confirmed) {
    return;
  }

  setBusy("正在揭晓答案...");
  try {
    const data = await fetchJson(`/api/session/${state.session.sessionId}/reveal`, {
      method: "POST",
      body: "{}",
    });
    state.session = data.session;
    state.judgement = data.judgement;
    state.selectedNode = null;
    state.selectedCharacterId = null;
    state.hintMasterChatMode = null;
    schedulePersistChatLocalCache();
  } finally {
    clearBusy();
  }
}

function renderStart() {
  const latest = cachedLatestSessionPreview();
  const activeGenerationJob = state.activeGenerationJob ?? state.bootstrap?.activeGenerationJob;
  const latestGenerationJob = state.bootstrap?.latestGenerationJob;
  const generationError =
    state.generationError ||
    (latestGenerationJob?.status === "failed"
      ? latestGenerationJob.error || latestGenerationJob.progress?.message || "案件生成失败"
      : null);
  const archives = state.bootstrap?.archives ?? [];
  const generatorModel = state.bootstrap?.models?.generator?.model ?? "未知";
  const reviewerModel = state.bootstrap?.models?.reviewer?.model ?? "未知";
  const playModel = state.bootstrap?.models?.play?.model ?? "未知";
  const adminEnabled = Boolean(state.bootstrap?.adminEnabled);
  const bestArchive = [...archives].sort((left, right) => (right.overallScore ?? 0) - (left.overallScore ?? 0))[0] ?? null;
  const latestArchive = archives[0] ?? null;
  const capabilityCards = [
    {
      title: "结构化案件生成",
      description: "不是随手写段子，而是先产出带调查节点、角色口供和真相链路的结构化案件。",
    },
    {
      title: "流式角色对话",
      description: "嫌疑人、相关人物和提示官都可以实时回复，追问时能感受到明显的防守与松口。",
    },
    {
      title: "提示官渐进提示",
      description: "背景不懂可以直接问；真正卡住时也只会一步步推你，不会直接替你破案。",
    },
    {
      title: "归档与重玩",
      description: "通过门禁和评审的案件会自动归档，随时可以从好案重新开局。",
    },
  ];
  const flowSteps = [
    ["01", "生成或重开案件", "可以直接开新局，也可以从高分归档案开始。"],
    ["02", "调查现场", "先抓时间线、关系链和最显眼的矛盾点。"],
    ["03", "盘问角色", "嫌疑人会防守，相关人物会补足旁支信息。"],
    ["04", "需要时问提示官", "背景解释、线索理解、渐进式提示都由他负责。"],
    ["05", "指认或直接看答案", "你可以自己破案，也可以随时切到答案揭晓。"],
  ];

  app.innerHTML = `
    <div class="app stack app-shell home-shell">
      <div class="hero hero-home card">
        <div class="hero-copy stack">
          <span class="eyebrow">Mystery Local</span>
          <h1 class="title">悬疑推理游戏</h1>
          <div class="muted hero-text">在浏览器里直接调查现场、盘问角色、向提示官求助，并把整局推到指认与复盘；案件新增与模型切换交给管理后台处理。</div>
          <div class="hero-badge-grid">
            <span class="pill">游玩模型：${escapeHtml(playModel)}</span>
            <span class="pill">生成模型：${escapeHtml(generatorModel)}</span>
            <span class="pill">评审模型：${escapeHtml(reviewerModel)}</span>
            <span class="pill">${state.bootstrap?.voiceInput?.enabled ? "语音输入已启用" : "支持可选语音输入"}</span>
            <span class="pill">提示官渐进提示</span>
          </div>
          ${adminEnabled ? `<div class="inline"><a class="ghost-link" href="/admin">进入管理后台</a></div>` : ""}
        </div>
        <div class="hero-preview card inset-card home-hero-preview stack">
          <div class="home-hero-brand">
            <div class="home-hero-logo-wrap">
              <img class="home-hero-logo" src="/favicon.svg" alt="悬疑推理游戏图标" />
            </div>
            <div class="stack">
              <div class="home-hero-brand-title">本地可玩的案件工坊</div>
              <div class="muted">生成、归档、重开、流式对话、语音输入和提示官都在同一条游玩链路里。</div>
            </div>
          </div>
          <div class="home-kpi-grid">
            <div class="home-kpi">
              <span>归档案件</span>
              <strong>${archives.length}</strong>
            </div>
            <div class="home-kpi">
              <span>可恢复局面</span>
              <strong>${latest ? "1" : "0"}</strong>
            </div>
            <div class="home-kpi">
              <span>当前最佳评分</span>
              <strong>${bestArchive?.overallScore ?? "-"}</strong>
            </div>
          </div>
          <div class="home-highlight">
            <div class="home-highlight-label">推荐体验</div>
            <div class="home-highlight-title">${escapeHtml(bestArchive?.title ?? latestArchive?.title ?? "先生成一局新案件")}</div>
            <div class="muted">${bestArchive ? `当前高分归档：${escapeHtml(bestArchive.template)} / ${bestArchive.suspects} 名嫌疑人。` : latestArchive ? `最近归档：${escapeHtml(latestArchive.template)} / ${latestArchive.suspects} 名嫌疑人。` : "你可以直接开新局，也可以等第一批高分案件继续积累。"}</div>
          </div>
        </div>
      </div>

      <div class="start-grid">
        <div class="card stack primary-start-card">
          <div class="start-panel-header">
            <div>
              <h2 class="section-title">开始游戏</h2>
              <div class="muted">从这里进入新局、接回最近一局，或者直接跳到答案揭晓。</div>
            </div>
            <span class="pill">本地 Web 试玩</span>
          </div>
          ${latest ? `<div class="note"><strong>最近一局</strong>${escapeHtml(latest.title)}<br />${escapeHtml(latest.summary)}</div>` : "<div class=\"note\">当前没有可恢复的最近一局。</div>"}
          ${activeGenerationJob ? `<div class="note"><strong>后台正在准备新案件</strong>${escapeHtml(activeGenerationJob.progress?.message ?? "正在处理中...")}<br />玩家界面不直接生成案件；如需新增，请到管理后台操作。</div>` : ""}
          ${generationError ? `<div class="note"><strong>上一轮生成失败</strong>${escapeHtml(generationError)}</div>` : ""}
          <div class="inline">
            ${latest ? `<button id="resume-latest">继续最近一局</button>` : ""}
            ${latest ? `<button class="ghost" id="resume-and-reveal">继续后直接看答案</button>` : ""}
          </div>
          <div class="home-subtle-list">
            <div>· 生成链路会先过门禁和评审，不是随便写一段剧情就开始玩。</div>
            <div>· 角色回复是流式的，提示官和语音输入也能直接接到这条链路里。</div>
            <div>· 通过门禁的案件会继续沉淀成可重玩的归档样本。</div>
          </div>
        </div>

        <div class="card stack archive-showcase-card">
          <div class="start-panel-header">
            <div>
              <h2 class="section-title">归档案件</h2>
              <div class="muted">如果你不想等生成，直接从已经通过门禁的案件开始。</div>
            </div>
            <span class="pill">可直接开玩</span>
          </div>
          ${latestArchive ? `<div class="note archive-spotlight"><strong>最近归档</strong>${escapeHtml(latestArchive.title)}<br />${escapeHtml(latestArchive.template)} / ${latestArchive.suspects} 嫌疑人 / 评分 ${latestArchive.overallScore ?? "-"}</div>` : ""}
          <div class="list">
            ${
              archives.length
                ? archives
                    .map(
                      (archive) => {
                        const resumeCached = isArchiveSameAsCachedLatest(archive, latest);
                        return `
                    <button class="secondary archive-button archive-item" data-archive-id="${escapeHtml(archive.archiveId)}" data-archive-title="${escapeHtml(archive.title)}" data-resume-latest="${resumeCached ? "true" : "false"}">
                      <span>${escapeHtml(archive.title)}${resumeCached ? "（当前这局）" : ""}</span>
                      <span class="archive-meta">${escapeHtml(archive.template)} / ${archive.suspects} 嫌疑人 / 评分 ${archive.overallScore ?? "-"}${resumeCached ? " / 点这里继续当前浏览器这局" : ""}</span>
                    </button>`;
                      },
                    )
                    .join("")
                : '<div class="note">还没有归档案件。</div>'
            }
          </div>
        </div>
      </div>

      <div class="home-section-grid">
        <div class="card stack">
          <div class="start-panel-header">
            <div>
              <h2 class="section-title">怎么玩</h2>
              <div class="muted">从第一眼线索、角色口供到最终指认，首页就把整条路径讲清楚。</div>
            </div>
          </div>
          <div class="flow-grid">
            ${flowSteps
              .map(
                ([index, title, description]) => `
                  <div class="flow-card">
                    <div class="flow-index">${index}</div>
                    <div class="flow-title">${title}</div>
                    <div class="muted flow-description">${description}</div>
                  </div>`,
              )
              .join("")}
          </div>
        </div>

        <div class="card stack">
          <div class="start-panel-header">
            <div>
              <h2 class="section-title">当前能力</h2>
              <div class="muted">别只是把它当 demo，它已经有一套比较完整的可玩闭环。</div>
            </div>
          </div>
          <div class="feature-grid">
            ${capabilityCards
              .map(
                (item) => `
                  <div class="feature-card">
                    <div class="feature-card-title">${escapeHtml(item.title)}</div>
                    <div class="muted feature-card-description">${escapeHtml(item.description)}</div>
                  </div>`,
              )
              .join("")}
          </div>
        </div>
      </div>

      ${state.busy ? `<div class="loading">${escapeHtml(state.loadingText)}</div>` : ""}
      ${renderLightbox()}
    </div>
  `;

  document.querySelector("#resume-latest")?.addEventListener("click", () => {
    debugChatCache("click-resume-latest-button");
    void resumeLatest();
  });
  document.querySelector("#resume-and-reveal")?.addEventListener("click", async () => {
    await resumeLatest();
    await revealAnswer();
  });
  document.querySelectorAll(".archive-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.resumeLatest === "true") {
        debugChatCache("click-resume-latest-archive", {
          archiveId: button.dataset.archiveId ?? null,
          archiveTitle: button.dataset.archiveTitle ?? null,
        });
        void resumeLatest();
        return;
      }

      debugChatCache("click-archive-start", {
        archiveId: button.dataset.archiveId ?? null,
        archiveTitle: button.dataset.archiveTitle ?? null,
      });
      void loadArchive(button.dataset.archiveId);
    });
  });
}

function renderSidebar() {
  const hintMaster = hintMasterCharacter();

  return `
    <div class="stack">
      <div class="card stack">
        <div class="inline" style="justify-content: space-between; align-items: center;">
          <div>
            <h2 class="section-title">案件概览</h2>
            <div class="muted">随时回到背景与局势页。</div>
          </div>
          <button class="ghost" id="back-overview">案件背景</button>
        </div>
      </div>

      <div class="card stack">
        <h2 class="section-title">调查节点</h2>
        <div class="list">
          ${state.session.investigationNodes
            .map(
              (node) => `
                <button class="secondary clue-button ${state.selectedNode?.id === node.id ? "active" : ""}" data-node-id="${escapeHtml(node.id)}">
                  <span class="character-button-body">
                    <span class="character-button-name">${node.visited ? "[已看] " : ""}${escapeHtml(node.title)}</span>
                    <span class="character-button-meta">${escapeHtml(node.category)}</span>
                  </span>
                </button>`,
            )
            .join("")}
        </div>
      </div>

      <div class="card stack">
        <h2 class="section-title">嫌疑人</h2>
        <div class="list">
          ${state.session.suspects
            .map((suspect) => renderCharacterButton(suspect, "嫌疑人", "danger"))
            .join("")}
        </div>
      </div>

      <div class="card stack">
        <h2 class="section-title">相关人物</h2>
        <div class="list">
          ${
            state.session.npcs.length
              ? state.session.npcs.map((npc) => renderCharacterButton(npc, "相关人物", "neutral")).join("")
              : '<div class="note">当前没有额外 NPC。</div>'
          }
        </div>
      </div>

      ${
        hintMaster
          ? `<div class="card stack">
        <h2 class="section-title">提示官</h2>
        <div class="list">
          ${renderCharacterButton(hintMaster, "提示官", "default")}
        </div>
      </div>`
          : ""
      }

    </div>
  `;
}

function renderGameToolbar() {
  return `
    <div class="card game-toolbar">
      <div>
        <div class="eyebrow">当前案件</div>
        <div class="game-toolbar-title">${escapeHtml(state.session.title)}</div>
      </div>
      <div class="inline">
        <button class="ghost" id="export-case">导出案件</button>
        <button class="ghost" id="clear-chat-cache">清空本地缓存</button>
        <button class="ghost" id="back-start">返回开始</button>
      </div>
    </div>
  `;
}

function renderMainPanel() {
  const hintMasterFollowupOpen = Boolean(
    state.judgement && hintMasterCharacter() && state.selectedCharacterId === hintMasterCharacter()?.id && state.hintMasterChatMode === "judgement",
  );

  if (state.judgement && !state.selectedNode && (!state.selectedCharacterId || hintMasterFollowupOpen)) {

    return `
      <div class="card judgement result-panel">
        <h2 class="section-title">结案结果</h2>
        <div class="note"><strong>${escapeHtml(state.judgement.summary)}</strong>${escapeHtml(state.judgement.truthReveal)}</div>
        <div class="note"><strong>真凶作案链路</strong>${state.judgement.culpritPlan.map((item) => `<div>- ${escapeHtml(item)}</div>`).join("")}</div>
        <div class="note"><strong>关键矛盾</strong>${state.judgement.keyContradictions.map((item) => `<div>- ${escapeHtml(item.title)}：${escapeHtml(item.implication)}</div>`).join("")}</div>
        <div class="note"><strong>误导点</strong>${state.judgement.redHerrings.map((item) => `<div>- ${escapeHtml(item)}</div>`).join("")}</div>
        <div class="inline">
          <button class="ghost" id="judgement-ask-hint-master">${hintMasterFollowupOpen ? "继续追问提示官" : "追问提示官细节"}</button>
        </div>
        ${renderJudgementHintMasterFollowup()}
      </div>
    `;
  }

  if (state.selectedNode) {
    return `
      <div class="card stack detail-panel">
        <div class="detail-header">
          <div>
            <span class="eyebrow">调查节点</span>
            <h2 class="section-title detail-title">${escapeHtml(state.selectedNode.title)}</h2>
          </div>
          <div class="inline">
            ${roleBadge(state.selectedNode.category, "neutral")}
            <button class="ghost" id="detail-back-overview">回到案件背景</button>
            <button class="ghost" id="detail-reveal-answer">直接看答案</button>
          </div>
        </div>
        <div class="detail-grid">
          <div class="note"><strong>摘要</strong>${escapeHtml(state.selectedNode.summary)}</div>
          <div class="note"><strong>发现</strong>${escapeHtml(state.selectedNode.discovery)}</div>
          ${state.selectedNode.visualHint ? `<div class="note"><strong>第一眼看到</strong>${escapeHtml(state.selectedNode.visualHint)}</div>` : ""}
          <div class="note"><strong>相关疑点</strong>${escapeHtml(state.selectedNode.contradictionIds.join("、") || "暂无")}</div>
        </div>
      </div>
    `;
  }

  if (state.selectedCharacterId) {
    const panelState = currentCharacterPanelState();
    if (!panelState) {
      return "";
    }

    const { character, isHintMaster, isSuspect, showVoiceButton, voiceButtonDisabled, sendDisabled } = panelState;
    const truthQaMode = isHintMaster && state.session.status === "solved";
    const eyebrowLabel = isHintMaster ? "提示官" : isSuspect ? "嫌疑人档案" : "相关人物档案";
    const roleLabel = isHintMaster ? "提示官" : isSuspect ? "嫌疑人" : "相关人物";
    const roleVariant = isHintMaster ? "default" : isSuspect ? "danger" : "neutral";
    const placeholderText = isHintMaster
      ? truthQaMode
        ? "问真相细节、动机因果、时间线或某条线索为什么成立..."
        : "问背景、规则，或直接说‘给我一点提示’..."
      : showVoiceButton
        ? "输入问题，或先用语音转文字..."
        : "输入你想追问的问题...";

    return `
      <div class="card stack detail-panel${isHintMaster ? " hint-master-panel" : ""}">
        <div class="detail-header">
          <div>
            <span class="eyebrow">${eyebrowLabel}</span>
            <h2 class="section-title detail-title">${escapeHtml(character.name)}</h2>
            <div class="muted">${escapeHtml(character.publicPersona)}</div>
          </div>
          <div class="inline">
            ${roleBadge(roleLabel, roleVariant)}
            <button class="ghost" id="detail-back-overview">回到案件背景</button>
            <button class="ghost" id="detail-reveal-answer">直接看答案</button>
            ${isSuspect ? `<button id="accuse-button">指认 ${escapeHtml(character.name)}</button>` : ""}
          </div>
        </div>
        <div class="character-layout">
          ${character.avatarSvg ? `<div class="character-hero">${zoomableImage(character.avatarSvg, `${character.name} 头像`, "character-portrait")}</div>` : ""}
          <div class="detail-grid">
            <div class="note"><strong>${isHintMaster ? "角色定位" : "与死者关系"}</strong>${escapeHtml(character.relationshipToVictim)}</div>
            ${isSuspect ? `<div class="note"><strong>表面动机</strong>${escapeHtml(character.possibleMotive)}</div>` : `<div class="note"><strong>${isHintMaster ? "你可以怎么问" : "为什么值得问"}</strong>${escapeHtml(character.whyRelevant)}</div>`}
            ${isSuspect ? `<div class="note"><strong>对外口供</strong>${escapeHtml(character.alibi)}</div>` : ""}
            ${character.appearanceSummary ? `<div class="note"><strong>${isHintMaster ? "风格说明" : "人物印象"}</strong>${escapeHtml(character.appearanceSummary)}</div>` : ""}
          </div>
        </div>
        ${
          isHintMaster
            ? `<div class="note"><strong>${truthQaMode ? "真相问答" : "提示规则"}</strong>${truthQaMode ? "现在已经进入复盘阶段，你可以直接追问真凶动机、作案方法、时间线、为什么某条线索成立，提示官会按已揭晓真相完整解释。" : "不确定背景、玩法或已发现线索怎么理解，都可以直接问；只有你明确说自己卡住了、或者直接要提示时，他才会渐进式推你一小步，不会直接剧透。"}</div>`
            : ""
        }
        <div class="chat-log" id="chat-log">
          ${renderCurrentChatMessagesHtml(character)}
        </div>
        <div class="chat-form">
          <input id="chat-input" value="${escapeHtml(currentChatDraft())}" placeholder="${placeholderText}" ${state.busy ? "disabled" : ""} />
          ${showVoiceButton ? `<button class="ghost voice-button ${state.voicePhase === "recording" ? "recording" : ""}" id="toggle-voice" ${voiceButtonDisabled ? "disabled" : ""}>${currentVoiceButtonText()}</button>` : ""}
          <button id="send-chat" ${sendDisabled ? "disabled" : ""}>发送</button>
        </div>
        ${showVoiceButton ? `<div class="muted voice-status" id="voice-status">${escapeHtml(voiceStatusText())}</div>` : ""}
        <div id="voice-error-slot">${renderVoiceErrorHtml()}</div>
      </div>
    `;
  }

  return `
    <div class="stack overview-panel">
      <div class="card case-hero">
        <div class="case-hero-copy stack">
          <span class="eyebrow">案件背景</span>
          <h2 class="title case-title">${escapeHtml(state.session.title)}</h2>
          <div class="lead">${escapeHtml(state.session.openingNarration)}</div>
          <div class="inline case-summary-chips">
            ${roleBadge(`${state.session.suspects.length} 名嫌疑人`, "danger")}
            ${roleBadge(`${state.session.npcs.length} 名相关人物`, "neutral")}
            ${roleBadge(`${state.session.investigationNodes.length} 个调查节点`, "default")}
          </div>
        </div>
        ${state.session.sceneSvg ? `<div class="case-hero-visual">${zoomableImage(state.session.sceneSvg, `${state.session.title} 案发场景图`, "scene-svg")}</div>` : ""}
      </div>

      <div class="detail-grid detail-grid-large">
        <div class="card stack">
          <h2 class="section-title">这到底是什么局</h2>
          <div class="note"><strong>背景设定</strong>${escapeHtml(state.session.storyContext.setting)}</div>
          <div class="note"><strong>当前局势</strong>${escapeHtml(state.session.storyContext.currentSituation)}</div>
          <div class="note"><strong>为什么是现在</strong>${escapeHtml(state.session.storyContext.whyNow)}</div>
        </div>
        <div class="card stack">
          <h2 class="section-title">你已知的紧张关系</h2>
          <div class="note">${state.session.storyContext.knownTensions.map((item) => `<div>- ${escapeHtml(item)}</div>`).join("")}</div>
          <div class="note"><strong>案件摘要</strong>${escapeHtml(state.session.publicSummary)}</div>
          <div class="note"><strong>目标</strong>${escapeHtml(state.session.playerGoal)}</div>
          <div class="note"><strong>死者</strong>${escapeHtml(state.session.victim.name)}（${escapeHtml(state.session.victim.profile)}）</div>
        </div>
      </div>

      <div class="card stack">
        <h2 class="section-title">建议玩法</h2>
        <div class="muted">先看左边的人物与调查节点，优先抓住谁在撒谎、谁在遮掩、谁只是利用混乱藏自己的秘密。</div>
        <div class="inline">
          <button class="ghost" id="overview-reveal-answer">直接看答案</button>
        </div>
      </div>
    </div>
  `;
}

function renderGame() {
  app.innerHTML = `
    <div class="app stack">
      ${state.busy ? `<div class="loading">${escapeHtml(state.loadingText || "处理中...")}</div>` : ""}
      ${renderLightbox()}
      ${renderGameToolbar()}
      <div class="game-grid">
        ${renderSidebar()}
        ${renderMainPanel()}
      </div>
    </div>
  `;

  document.querySelector("#back-start")?.addEventListener("click", returnToStart);
  document.querySelector("#export-case")?.addEventListener("click", exportCurrentCase);
  document.querySelector("#clear-chat-cache")?.addEventListener("click", () => {
    void clearChatLocalCacheAction();
  });

  document.querySelector("#back-overview")?.addEventListener("click", clearSelection);
  document.querySelector("#detail-back-overview")?.addEventListener("click", clearSelection);
  document.querySelector("#overview-reveal-answer")?.addEventListener("click", revealAnswer);
  document.querySelector("#detail-reveal-answer")?.addEventListener("click", revealAnswer);
  document.querySelector("#judgement-ask-hint-master")?.addEventListener("click", () => {
    void openHintMasterChat();
  });

  document.querySelectorAll("[data-node-id]").forEach((button) => {
    button.addEventListener("click", () => inspectNode(button.dataset.nodeId));
  });

  document.querySelectorAll("[data-character-id]").forEach((button) => {
    button.addEventListener("click", () => openCharacterChat(button.dataset.characterId));
  });

  document.querySelector("#chat-input")?.addEventListener("input", (event) => {
    setCurrentChatDraft(event.target.value);
  });
  document.querySelector("#send-chat")?.addEventListener("click", sendChat);
  document.querySelector("#toggle-voice")?.addEventListener("click", () => {
    void toggleVoiceInput();
  });
  document.querySelector("#chat-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendChat();
    }
  });
  document.querySelector("#accuse-button")?.addEventListener("click", accuseSelected);
  bindLightboxEvents();
}

function render() {
  captureViewState();

  if (!state.bootstrap && !state.session) {
    app.innerHTML = `<div class="app"><div class="loading">${escapeHtml(state.loadingText)}</div></div>`;
    return;
  }

  if (!state.session) {
    renderStart();
    return;
  }

  renderGame();
  restoreViewState();
}

loadBootstrap().catch((error) => {
  app.innerHTML = `<div class="app"><div class="card">启动失败：${escapeHtml(error instanceof Error ? error.message : String(error))}</div></div>`;
});

window.addEventListener?.("beforeunload", () => {
  flushChatLocalCacheNow();
});
