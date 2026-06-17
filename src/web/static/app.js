const app = document.querySelector("#app");

const state = {
  bootstrap: null,
  activeGenerationJob: null,
  generationError: null,
  session: null,
  selectedCharacterId: null,
  selectedNode: null,
  messagesByCharacter: {},
  judgement: null,
  lightbox: null,
  loadingText: "正在加载...",
  busy: false,
};

let generationAttachmentId = 0;
let chatLogViewState = { top: 0, stickToBottom: true };

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
  state.selectedNode = null;
  state.selectedCharacterId = null;
  state.judgement = null;
  render();
}

async function returnToStart() {
  detachGenerationAttachment();
  state.session = null;
  state.selectedNode = null;
  state.selectedCharacterId = null;
  state.judgement = null;
  state.messagesByCharacter = {};
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

function setBusy(loadingText) {
  state.busy = true;
  state.loadingText = loadingText;
  render();
}

function clearBusy() {
  state.busy = false;
  render();
}

function allCharacters() {
  return [...(state.session?.suspects ?? []), ...(state.session?.npcs ?? [])];
}

function findCharacter(characterId) {
  return allCharacters().find((character) => character.id === characterId) ?? null;
}

function currentMessages() {
  if (!state.selectedCharacterId) {
    return [];
  }

  return state.messagesByCharacter[state.selectedCharacterId] ?? [];
}

async function loadBootstrap() {
  state.bootstrap = await fetchJson("/api/bootstrap");
  state.activeGenerationJob = state.bootstrap.activeGenerationJob ?? null;
  state.generationError =
    state.bootstrap.latestGenerationJob?.status === "failed"
      ? state.bootstrap.latestGenerationJob.error || state.bootstrap.latestGenerationJob.progress?.message || "案件生成失败"
      : null;
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
    state.bootstrap = await fetchJson("/api/bootstrap");
    state.activeGenerationJob = state.bootstrap.activeGenerationJob ?? null;
    state.selectedNode = null;
    state.selectedCharacterId = null;
    state.messagesByCharacter = {};
    state.judgement = null;
    state.generationError = null;
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
    state.bootstrap = await fetchJson("/api/bootstrap");
    state.activeGenerationJob = state.bootstrap.activeGenerationJob ?? null;
    state.selectedNode = null;
    state.selectedCharacterId = null;
    state.messagesByCharacter = {};
    state.judgement = null;
    state.generationError = null;
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
  detachGenerationAttachment();
  setBusy("正在恢复最近一局...");
  try {
    const data = await fetchJson("/api/session/resume-latest", { method: "POST", body: "{}" });
    state.session = data.session;
    state.selectedNode = null;
    state.selectedCharacterId = null;
    state.messagesByCharacter = {};
    state.judgement = null;
  } finally {
    clearBusy();
  }
}

async function loadArchive(archiveId) {
  detachGenerationAttachment();
  setBusy("正在载入归档案件...");
  try {
    const data = await fetchJson("/api/session/from-archive", {
      method: "POST",
      body: JSON.stringify({ archiveId }),
    });
    state.session = data.session;
    state.selectedNode = null;
    state.selectedCharacterId = null;
    state.messagesByCharacter = {};
    state.judgement = null;
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
  const data = await fetchJson(`/api/session/${state.session.sessionId}/investigate`, {
    method: "POST",
    body: JSON.stringify({ nodeId }),
  });
  state.session = data.session;
  state.selectedNode = data.node;
  state.selectedCharacterId = null;
  state.judgement = null;
  render();
}

async function openCharacterChat(characterId) {
  state.selectedCharacterId = characterId;
  state.selectedNode = null;
  state.judgement = null;

  if (!state.messagesByCharacter[characterId]) {
    const data = await fetchJson(`/api/session/${state.session.sessionId}/messages/${characterId}`);
    state.messagesByCharacter[characterId] = data.messages;
  }

  render();
}

async function sendChat() {
  const input = document.querySelector("#chat-input");
  const characterId = state.selectedCharacterId;
  const text = input?.value?.trim();

  if (!input || !characterId || !text) {
    return;
  }

  input.value = "";
  const messages = state.messagesByCharacter[characterId] ?? [];
  const userMessage = { role: "user", content: text };
  const assistantMessage = { role: "assistant", content: "" };
  state.messagesByCharacter[characterId] = [...messages, userMessage, assistantMessage];
  state.busy = true;
  render();

  try {
    const response = await fetch(`/api/session/${state.session.sessionId}/chat/${characterId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userInput: text }),
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
      render();
    }
  } catch (error) {
    assistantMessage.role = "system";
    const rawMessage = error instanceof Error ? error.message : String(error);
    assistantMessage.content = rawMessage.includes("Failed to fetch")
      ? "聊天连接断开了。请重试；如果刚刷新页面或服务刚重启，强刷后再试。"
      : rawMessage;
    console.error("[Web Chat Error]", error);
  } finally {
    state.busy = false;
    render();
  }
}

async function accuseSelected() {
  if (!state.selectedCharacterId) {
    return;
  }

  const suspect = state.session?.suspects.find((item) => item.id === state.selectedCharacterId);
  if (!suspect) {
    return;
  }

  if (!window.confirm(`确认指认 ${suspect.name} 吗？`)) {
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
  } finally {
    clearBusy();
  }
}

async function revealAnswer() {
  if (!state.session) {
    return;
  }

  if (!window.confirm("确认直接看答案吗？这会直接展示真相。")) {
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
  } finally {
    clearBusy();
  }
}

function renderStart() {
  const latest = state.bootstrap?.latestSession;
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

  app.innerHTML = `
    <div class="app stack app-shell">
      <div class="hero card">
        <div class="hero-copy">
          <span class="eyebrow">Mystery Web</span>
          <h1 class="title">中文悬疑推理游戏</h1>
          <div class="muted hero-text">在浏览器里直接调查现场、盘问嫌疑人和相关人物，并实时查看流式回复。</div>
          <div class="inline muted">
            <span class="pill">游玩模型：${escapeHtml(playModel)}</span>
            <span class="pill">生成模型：${escapeHtml(generatorModel)}</span>
            <span class="pill">评审模型：${escapeHtml(reviewerModel)}</span>
          </div>
        </div>
        <div class="hero-preview card inset-card">
          <div class="hero-stat"><span>归档案件</span><strong>${archives.length}</strong></div>
          <div class="hero-stat"><span>可恢复局面</span><strong>${latest ? "1" : "0"}</strong></div>
          <div class="hero-note">推荐先从一局高分归档案开始，感受完整的背景、视觉线索和流式对话。</div>
        </div>
      </div>

      <div class="start-grid">
        <div class="card stack">
          <h2 class="section-title">开始游戏</h2>
          ${latest ? `<div class="note"><strong>最近一局</strong>${escapeHtml(latest.title)}<br />${escapeHtml(latest.summary)}</div>` : "<div class=\"note\">当前没有可恢复的最近一局。</div>"}
          ${
            activeGenerationJob
              ? `<div class="note"><strong>当前正在生成新案件</strong>${escapeHtml(activeGenerationJob.progress?.message ?? "正在处理中...")}<br />离开或刷新后再回来，也会继续显示这里的进度；点击下面“生成新案件”会直接接回这次进度，不会重复再开一局。</div>`
              : ""
          }
          ${generationError ? `<div class="note"><strong>上一轮生成失败</strong>${escapeHtml(generationError)}</div>` : ""}
          <div class="inline">
            ${latest ? `<button id="resume-latest">继续最近一局</button>` : ""}
            <button id="start-new">生成新案件</button>
            ${latest ? `<button class="ghost" id="resume-and-reveal">继续后直接看答案</button>` : ""}
          </div>
        </div>

        <div class="card stack">
          <h2 class="section-title">归档案件</h2>
          <div class="list">
            ${
              archives.length
                ? archives
                    .map(
                      (archive) => `
                    <button class="secondary archive-button archive-item" data-archive-id="${escapeHtml(archive.archiveId)}">
                      <span>${escapeHtml(archive.title)}</span>
                      <span class="archive-meta">${escapeHtml(archive.template)} / ${archive.suspects} 嫌疑人 / 评分 ${archive.overallScore ?? "-"}</span>
                    </button>`,
                    )
                    .join("")
                : '<div class="note">还没有归档案件。</div>'
            }
          </div>
        </div>
      </div>

      ${state.busy ? `<div class="loading">${escapeHtml(state.loadingText)}</div>` : ""}
      ${renderLightbox()}
    </div>
  `;

  document.querySelector("#start-new")?.addEventListener("click", startNewSession);
  document.querySelector("#resume-latest")?.addEventListener("click", resumeLatest);
  document.querySelector("#resume-and-reveal")?.addEventListener("click", async () => {
    await resumeLatest();
    await revealAnswer();
  });
  document.querySelectorAll(".archive-button").forEach((button) => {
    button.addEventListener("click", () => loadArchive(button.dataset.archiveId));
  });
}

function renderSidebar() {
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
        <button class="ghost" id="back-start">返回开始</button>
      </div>
    </div>
  `;
}

function renderMainPanel() {
  if (state.judgement) {
    return `
      <div class="card judgement result-panel">
        <h2 class="section-title">结案结果</h2>
        <div class="note"><strong>${escapeHtml(state.judgement.summary)}</strong>${escapeHtml(state.judgement.truthReveal)}</div>
        <div class="note"><strong>真凶作案链路</strong>${state.judgement.culpritPlan.map((item) => `<div>- ${escapeHtml(item)}</div>`).join("")}</div>
        <div class="note"><strong>关键矛盾</strong>${state.judgement.keyContradictions.map((item) => `<div>- ${escapeHtml(item.title)}：${escapeHtml(item.implication)}</div>`).join("")}</div>
        <div class="note"><strong>误导点</strong>${state.judgement.redHerrings.map((item) => `<div>- ${escapeHtml(item)}</div>`).join("")}</div>
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
    const character = findCharacter(state.selectedCharacterId);
    if (!character) {
      return "";
    }

    const isSuspect = state.session.suspects.some((item) => item.id === character.id);

    return `
      <div class="card stack detail-panel">
        <div class="detail-header">
          <div>
            <span class="eyebrow">${isSuspect ? "嫌疑人档案" : "相关人物档案"}</span>
            <h2 class="section-title detail-title">${escapeHtml(character.name)}</h2>
            <div class="muted">${escapeHtml(character.publicPersona)}</div>
          </div>
          <div class="inline">
            ${roleBadge(isSuspect ? "嫌疑人" : "相关人物", isSuspect ? "danger" : "neutral")}
            <button class="ghost" id="detail-back-overview">回到案件背景</button>
            <button class="ghost" id="detail-reveal-answer">直接看答案</button>
            ${isSuspect ? `<button id="accuse-button">指认 ${escapeHtml(character.name)}</button>` : ""}
          </div>
        </div>
        <div class="character-layout">
          ${character.avatarSvg ? `<div class="character-hero">${zoomableImage(character.avatarSvg, `${character.name} 头像`, "character-portrait")}</div>` : ""}
          <div class="detail-grid">
            <div class="note"><strong>与死者关系</strong>${escapeHtml(character.relationshipToVictim)}</div>
            ${isSuspect ? `<div class="note"><strong>表面动机</strong>${escapeHtml(character.possibleMotive)}</div>` : `<div class="note"><strong>为什么值得问</strong>${escapeHtml(character.whyRelevant)}</div>`}
            ${isSuspect ? `<div class="note"><strong>对外口供</strong>${escapeHtml(character.alibi)}</div>` : ""}
            ${character.appearanceSummary ? `<div class="note"><strong>人物印象</strong>${escapeHtml(character.appearanceSummary)}</div>` : ""}
          </div>
        </div>
        <div class="chat-log" id="chat-log">
          ${currentMessages()
            .map(
              (message) => `
                <div class="message ${escapeHtml(message.role)}">${escapeHtml(
                  message.role === "user"
                    ? `你：${message.content}`
                    : message.role === "assistant"
                      ? `${character.name}：${message.content}`
                      : `[系统] ${message.content}`,
                )}</div>`,
            )
            .join("")}
        </div>
        <div class="chat-form">
          <input id="chat-input" placeholder="输入你想追问的问题..." ${state.busy ? "disabled" : ""} />
          <button id="send-chat" ${state.busy ? "disabled" : ""}>发送</button>
        </div>
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

  document.querySelector("#back-overview")?.addEventListener("click", clearSelection);
  document.querySelector("#detail-back-overview")?.addEventListener("click", clearSelection);
  document.querySelector("#overview-reveal-answer")?.addEventListener("click", revealAnswer);
  document.querySelector("#detail-reveal-answer")?.addEventListener("click", revealAnswer);

  document.querySelectorAll("[data-node-id]").forEach((button) => {
    button.addEventListener("click", () => inspectNode(button.dataset.nodeId));
  });

  document.querySelectorAll("[data-character-id]").forEach((button) => {
    button.addEventListener("click", () => openCharacterChat(button.dataset.characterId));
  });

  document.querySelector("#send-chat")?.addEventListener("click", sendChat);
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
