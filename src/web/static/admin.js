const app = document.querySelector("#app");

const state = {
  mode: "loading",
  bootstrap: null,
  modelSelection: {
    playPresetId: "",
    generatorPresetId: "",
    reviewerPresetId: "",
  },
  credentials: {
    username: "",
    password: "",
  },
  generationJob: null,
  error: null,
  loadingText: "正在加载管理后台...",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
    const error = new Error(data.error || `请求失败：${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function confirmAction({ title, text, confirmText, cancelText, icon = "question" }) {
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

function setLoading(text) {
  state.loadingText = text;
  state.mode = "loading";
  render();
}

function mapSelectionValue(value) {
  return value || "";
}

function syncModelSelectionFromBootstrap() {
  const selection = state.bootstrap?.models?.selection ?? {};
  state.modelSelection = {
    playPresetId: mapSelectionValue(selection.playPresetId),
    generatorPresetId: mapSelectionValue(selection.generatorPresetId),
    reviewerPresetId: mapSelectionValue(selection.reviewerPresetId),
  };
}

async function loadAdminBootstrap() {
  setLoading("正在加载管理后台...");
  try {
    const data = await fetchJson("/api/admin/bootstrap");
    state.bootstrap = data;
    syncModelSelectionFromBootstrap();
    state.generationJob = data.activeGenerationJob ?? null;
    state.error = null;
    state.mode = "dashboard";
    render();
    if (state.generationJob?.id) {
      void pollGenerationJob(state.generationJob.id);
    }
  } catch (error) {
    if (error.status === 401) {
      state.mode = "login";
      state.error = null;
      render();
      return;
    }

    if (error.status === 503) {
      state.mode = "disabled";
      state.error = error.message;
      render();
      return;
    }

    state.mode = "error";
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function login() {
  setLoading("正在登录管理后台...");
  try {
    await fetchJson("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(state.credentials),
    });
    await loadAdminBootstrap();
  } catch (error) {
    state.mode = "login";
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function logout() {
  await fetchJson("/api/admin/logout", { method: "POST", body: "{}" }).catch(() => undefined);
  state.bootstrap = null;
  state.generationJob = null;
  state.mode = "login";
  state.error = null;
  render();
}

async function saveModelSelection() {
  setLoading("正在保存模型配置...");
  try {
    await fetchJson("/api/admin/model-selection", {
      method: "POST",
      body: JSON.stringify(state.modelSelection),
    });
    await loadAdminBootstrap();
    await window.Swal?.fire?.({
      icon: "success",
      title: "模型配置已更新",
      text: "之后的游玩、生成和评审会按你当前的 preset 选择生效。",
      background: "#111827",
      color: "#f8fafc",
      confirmButtonColor: "#2563eb",
    });
  } catch (error) {
    state.mode = "dashboard";
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function pollGenerationJob(jobId) {
  while (state.generationJob?.id === jobId) {
    try {
      const job = await fetchJson(`/api/admin/generation-jobs/${jobId}`);
      state.generationJob = job;
      if (job.status === "failed") {
        state.error = job.error || job.progress?.message || "案件生成失败。";
      }
      render();
      if (job.status === "failed") {
        await window.Swal?.fire?.({
          icon: "error",
          title: "案件生成失败",
          text: state.error,
          background: "#111827",
          color: "#f8fafc",
          confirmButtonColor: "#2563eb",
        });
        await loadAdminBootstrap();
        return;
      }

      if (job.status === "completed") {
        await loadAdminBootstrap();
        return;
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      render();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

async function generateCase() {
  const templateType = document.querySelector("#admin-template-select")?.value;
  if (!templateType) {
    return;
  }

  setLoading("正在提交生成任务...");
  try {
    const data = await fetchJson("/api/admin/cases/generate", {
      method: "POST",
      body: JSON.stringify({ templateType }),
    });
    state.mode = "dashboard";
    state.error = null;
    state.generationJob = {
      id: data.jobId,
      status: "queued",
      progress: {
        phase: "queued",
        message: "已提交生成任务...",
      },
    };
    render();
    void pollGenerationJob(data.jobId);
  } catch (error) {
    state.mode = "dashboard";
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function deleteArchive(archiveId, title) {
  const confirmed = await confirmAction({
    title: `删除归档《${title}》？`,
    text: "删除后该归档案件会从可玩列表中移除。",
    confirmText: "删除",
    cancelText: "保留",
    icon: "warning",
  });
  if (!confirmed) {
    return;
  }

  setLoading("正在删除归档案件...");
  try {
    await fetchJson(`/api/admin/archives/${archiveId}`, { method: "DELETE", body: "{}" });
    await loadAdminBootstrap();
  } catch (error) {
    state.mode = "dashboard";
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function exportArchive(archiveId) {
  const link = document.createElement("a");
  link.href = `/api/admin/archives/${archiveId}/export`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function importArchiveFromFile(file) {
  if (!file) {
    return;
  }

  setLoading("正在导入剧情 JSON...");
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    await fetchJson("/api/admin/archives/import", {
      method: "POST",
      body: JSON.stringify({ payload }),
    });
    await loadAdminBootstrap();
    await window.Swal?.fire?.({
      icon: "success",
      title: "剧情已导入",
      text: "导入成功，案件已进入归档列表。",
      background: "#111827",
      color: "#f8fafc",
      confirmButtonColor: "#2563eb",
    });
  } catch (error) {
    state.mode = "dashboard";
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function openArchiveDetail(archiveId) {
  try {
    const data = await fetchJson(`/api/admin/archives/${archiveId}`);
    await window.Swal?.fire?.({
      title: data.archive?.mysteryCase?.title || "案件整体信息",
      html: renderArchiveDetailHtml(data.archive),
      width: 960,
      confirmButtonText: "关闭",
      background: "#111827",
      color: "#f8fafc",
      confirmButtonColor: "#2563eb",
      customClass: {
        popup: "mystery-swal-popup admin-detail-swal",
        title: "mystery-swal-title",
        htmlContainer: "mystery-swal-text admin-detail-swal-text",
      },
    });
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

function renderModelSelect(id, label, currentValue) {
  const options = state.bootstrap?.models?.options ?? [];
  return `
    <label class="admin-field">
      <span>${escapeHtml(label)}</span>
      <select id="${id}">
        <option value="">跟随默认配置</option>
        ${options
          .map(
            (option) => `<option value="${escapeHtml(option.id)}" ${currentValue === option.id ? "selected" : ""}>${escapeHtml(option.name)} / ${escapeHtml(option.model)}</option>`,
          )
          .join("")}
      </select>
    </label>
  `;
}

function formatArchiveDate(value) {
  if (!value) {
    return "未知时间";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortArchiveId(value) {
  const text = String(value || "");
  return text.length > 16 ? `${text.slice(0, 16)}…` : text;
}

function renderArchiveDetailHtml(detail) {
  return `
    <div class="admin-detail-modal">
      <div class="admin-detail-modal-grid">
        <div class="note admin-detail-modal-block"><strong>标题</strong>${escapeHtml(detail.mysteryCase.title)}</div>
        <div class="note admin-detail-modal-block"><strong>模板</strong>${escapeHtml(detail.mysteryCase.template)}</div>
        <div class="note admin-detail-modal-block"><strong>归档时间</strong>${escapeHtml(formatArchiveDate(detail.archivedAt))}</div>
        <div class="note admin-detail-modal-block"><strong>归档 ID</strong>${escapeHtml(detail.archiveId)}</div>
      </div>
      <div class="admin-detail-modal-grid">
        <div class="note admin-detail-modal-block"><strong>案件摘要</strong>${escapeHtml(detail.mysteryCase.publicSummary)}</div>
        <div class="note admin-detail-modal-block"><strong>玩家目标</strong>${escapeHtml(detail.mysteryCase.playerGoal)}</div>
        <div class="note admin-detail-modal-block"><strong>背景设定</strong>${escapeHtml(detail.mysteryCase.storyContext.setting)}</div>
        <div class="note admin-detail-modal-block"><strong>当前局势</strong>${escapeHtml(detail.mysteryCase.storyContext.currentSituation)}</div>
        <div class="note admin-detail-modal-block"><strong>为什么是现在</strong>${escapeHtml(detail.mysteryCase.storyContext.whyNow)}</div>
        <div class="note admin-detail-modal-block"><strong>死者</strong>${escapeHtml(detail.mysteryCase.victim.name)}（${escapeHtml(detail.mysteryCase.victim.profile)}）</div>
      </div>
      <div class="admin-detail-modal-grid">
        <div class="note admin-detail-modal-block"><strong>嫌疑人</strong><div class="admin-detail-modal-list">${detail.mysteryCase.suspects.map((suspect) => `<div>- ${escapeHtml(suspect.name)}：${escapeHtml(suspect.publicPersona)}</div>`).join("")}</div></div>
        <div class="note admin-detail-modal-block"><strong>相关人物</strong><div class="admin-detail-modal-list">${(detail.mysteryCase.npcs ?? []).length ? detail.mysteryCase.npcs.map((npc) => `<div>- ${escapeHtml(npc.name)}：${escapeHtml(npc.publicPersona)}</div>`).join("") : "暂无"}</div></div>
      </div>
      <div class="note admin-detail-modal-block"><strong>调查节点概况</strong><div class="admin-detail-modal-list">${detail.mysteryCase.investigationNodes.map((node) => `<div>- ${escapeHtml(node.title)}（${escapeHtml(node.category)}）：${escapeHtml(node.summary)}</div>`).join("")}</div></div>
      <div class="admin-detail-modal-grid">
        <div class="note admin-detail-modal-block"><strong>真相摘要</strong>${escapeHtml(detail.mysteryCase.solution.truthReveal)}</div>
        <div class="note admin-detail-modal-block"><strong>作案方法</strong>${escapeHtml(detail.mysteryCase.solution.method)}</div>
        <div class="note admin-detail-modal-block"><strong>真凶</strong>${escapeHtml(detail.mysteryCase.solution.culpritId)}</div>
        <div class="note admin-detail-modal-block"><strong>总体评分</strong>${escapeHtml(detail.review?.overallScore ?? "-")}</div>
      </div>
      <div class="admin-detail-modal-grid">
        <div class="note admin-detail-modal-block"><strong>生成模型</strong>${escapeHtml(detail.source?.model ?? detail.source?.presetId ?? "未知")}</div>
        <div class="note admin-detail-modal-block"><strong>评审模型</strong>${escapeHtml(detail.source?.reviewModel ?? detail.source?.reviewPresetId ?? "未知")}</div>
      </div>
    </div>
  `;
}

function renderLogin() {
  app.innerHTML = `
    <div class="app stack admin-shell">
      <div class="card admin-login-card stack">
        <div class="eyebrow">Admin</div>
        <h1 class="title">案件管理后台</h1>
        <div class="muted">登录后可管理归档案件、按模板生成新案件，并切换游玩 / 生成 / 评审模型。</div>
        ${state.error ? `<div class="note"><strong>登录失败</strong>${escapeHtml(state.error)}</div>` : ""}
        <label class="admin-field"><span>账号</span><input id="admin-username" value="${escapeHtml(state.credentials.username)}" /></label>
        <label class="admin-field"><span>密码</span><input id="admin-password" type="password" value="${escapeHtml(state.credentials.password)}" /></label>
        <div class="inline">
          <button id="admin-login">登录</button>
          <a class="ghost-link" href="/">返回玩家界面</a>
        </div>
      </div>
    </div>
  `;

  document.querySelector("#admin-username")?.addEventListener("input", (event) => {
    state.credentials.username = event.target.value;
  });
  document.querySelector("#admin-password")?.addEventListener("input", (event) => {
    state.credentials.password = event.target.value;
  });
  document.querySelector("#admin-login")?.addEventListener("click", login);
}

function renderDisabled() {
  app.innerHTML = `
    <div class="app stack admin-shell">
      <div class="card stack">
        <div class="eyebrow">Admin</div>
        <h1 class="title">管理后台未启用</h1>
        <div class="note"><strong>原因</strong>${escapeHtml(state.error || "当前未配置 ADMIN_USERNAME / ADMIN_PASSWORD。")}</div>
        <div class="muted">请先在本项目本地配置里补上 admin 账号密码。</div>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const options = state.bootstrap?.models?.options ?? [];
  const current = state.bootstrap?.models?.current ?? {};
  const templates = state.bootstrap?.templates ?? [];
  const archives = state.bootstrap?.archives ?? [];
  const activeJob = state.generationJob?.status === "queued" || state.generationJob?.status === "running" ? state.generationJob : null;
  const latestGenerationJob = state.bootstrap?.latestGenerationJob ?? null;
  const latestFailedJob =
    state.generationJob?.status === "failed"
      ? state.generationJob
      : latestGenerationJob?.status === "failed"
        ? latestGenerationJob
        : null;
  const storedFailure = state.bootstrap?.latestGenerationFailure ?? null;

  app.innerHTML = `
    <div class="app stack admin-shell">
      <div class="card admin-toolbar">
        <div>
          <div class="eyebrow">Admin</div>
          <div class="game-toolbar-title">案件管理后台</div>
          <div class="muted">玩家界面不再支持直接生成案件；所有新增和删除都从这里做。</div>
        </div>
        <div class="inline">
          <a class="ghost-link" href="/">玩家界面</a>
          <button class="ghost" id="admin-logout">退出登录</button>
        </div>
      </div>

      ${latestFailedJob ? `<div class="note note-error"><strong>上一轮生成失败</strong>${escapeHtml(latestFailedJob.error || latestFailedJob.progress?.message || "案件生成失败。")}</div>` : ""}
      ${storedFailure ? `<div class="note note-error"><strong>最近一次失败记录（已落库）</strong>${escapeHtml(storedFailure.error || storedFailure.progress?.message || "案件生成失败。")}<br />${escapeHtml(storedFailure.templateType || "未知模板")} / ${escapeHtml(storedFailure.generatorPresetId || storedFailure.generatorModel || "未知模型")}</div>` : ""}
      ${state.error ? `<div class="note note-error"><strong>最近错误</strong>${escapeHtml(state.error)}</div>` : ""}
      ${activeJob ? `<div class="note"><strong>当前生成任务</strong>${escapeHtml(activeJob.progress?.message ?? "正在处理中...")}</div>` : ""}

      <div class="home-section-grid">
        <div class="card stack">
          <div class="start-panel-header">
            <div>
              <h2 class="section-title">模型切换</h2>
              <div class="muted">从本地 presets 中选择游玩、生成和评审模型。未选择时继续走默认配置。</div>
            </div>
            <span class="pill">${options.length} 个可选 preset</span>
          </div>
          <div class="detail-grid detail-grid-large">
            ${renderModelSelect("play-preset", "玩家对话模型", state.modelSelection.playPresetId)}
            ${renderModelSelect("generator-preset", "案件生成模型", state.modelSelection.generatorPresetId)}
            ${renderModelSelect("reviewer-preset", "案件评审模型", state.modelSelection.reviewerPresetId)}
          </div>
          <div class="detail-grid detail-grid-large">
            <div class="note"><strong>当前游玩</strong>${escapeHtml(current.play?.model ?? "默认")}</div>
            <div class="note"><strong>当前生成</strong>${escapeHtml(current.generator?.model ?? "默认")}</div>
            <div class="note"><strong>当前评审</strong>${escapeHtml(current.reviewer?.model ?? "默认")}</div>
          </div>
          <div class="inline">
            <button id="save-model-selection">保存模型切换</button>
          </div>
        </div>

        <div class="card stack">
          <div class="start-panel-header">
            <div>
              <h2 class="section-title">新增案件</h2>
              <div class="muted">按模板创建新案件，成功后会直接进入归档可玩列表。</div>
            </div>
          </div>
          <label class="admin-field">
            <span>案件模板</span>
            <select id="admin-template-select">
              ${templates.map((template) => `<option value="${escapeHtml(template.type)}">${escapeHtml(template.label)} / ${escapeHtml(template.brief)}</option>`).join("")}
            </select>
          </label>
          <div class="inline">
            <button id="admin-generate-case" ${activeJob ? "disabled" : ""}>生成并归档</button>
          </div>
          <div class="note"><strong>管理范围</strong>当前 admin 只管理归档案件：可以按模板新增，也可以删除归档；玩家端只负责游玩已有案件。</div>
        </div>

        <div class="card stack">
          <div class="start-panel-header">
            <div>
              <h2 class="section-title">导入剧情</h2>
              <div class="muted">支持导入两种 JSON：完整归档记录，或纯案件 JSON（MysteryCase）。</div>
            </div>
          </div>
          <label class="admin-field">
            <span>选择剧情 JSON 文件</span>
            <input id="admin-import-file" type="file" accept=".json,application/json" />
          </label>
          <div class="note"><strong>导入说明</strong>导入后会自动进入归档案件列表；如果文件里带了 review/source，会尽量保留这些元信息。</div>
        </div>
      </div>

      <div class="card stack">
        <div class="start-panel-header">
          <div>
            <h2 class="section-title">归档案件管理</h2>
            <div class="muted">只管理已归档可玩的案件。删除后会立即从玩家界面列表消失。</div>
          </div>
          <span class="pill">${archives.length} 个归档</span>
        </div>
        <div class="list admin-archive-list">
          ${
            archives.length
              ? archives
                  .map(
                    (archive) => `
                      <div class="admin-archive-row">
                        <div class="admin-archive-main">
                          <button class="admin-archive-open" data-archive-open="${escapeHtml(archive.archiveId)}">
                            <span class="admin-archive-title">${escapeHtml(archive.title)}</span>
                            <span class="admin-archive-submeta">点击查看整体信息</span>
                          </button>
                          <div class="admin-archive-meta-row">
                            <span class="pill">${escapeHtml(archive.template)}</span>
                            <span class="pill">${archive.suspects} 嫌疑人</span>
                            <span class="pill">评分 ${archive.overallScore ?? "-"}</span>
                            <span class="pill">归档 ${escapeHtml(formatArchiveDate(archive.archivedAt))}</span>
                          </div>
                          <div class="admin-archive-submeta">归档 ID：${escapeHtml(shortArchiveId(archive.archiveId))}</div>
                          <div class="admin-archive-submeta">生成模型：${escapeHtml(archive.sourceModel ?? archive.presetId ?? "未知")} / 评审模型：${escapeHtml(archive.reviewModel ?? archive.reviewPresetId ?? "未知")}</div>
                        </div>
                        <div class="admin-archive-actions">
                          <button class="ghost admin-export-archive" data-archive-export="${escapeHtml(archive.archiveId)}">导出 JSON</button>
                          <button class="ghost admin-delete-archive danger-ghost" data-archive-id="${escapeHtml(archive.archiveId)}" data-archive-title="${escapeHtml(archive.title)}">删除归档</button>
                        </div>
                      </div>`,
                  )
                  .join("")
              : '<div class="note">当前还没有归档案件。</div>'
          }
        </div>
      </div>

    </div>
  `;

  document.querySelector("#admin-logout")?.addEventListener("click", logout);
  document.querySelector("#save-model-selection")?.addEventListener("click", async () => {
    state.modelSelection.playPresetId = document.querySelector("#play-preset")?.value || "";
    state.modelSelection.generatorPresetId = document.querySelector("#generator-preset")?.value || "";
    state.modelSelection.reviewerPresetId = document.querySelector("#reviewer-preset")?.value || "";
    await saveModelSelection();
  });
  document.querySelector("#admin-generate-case")?.addEventListener("click", generateCase);
  document.querySelector("#admin-import-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    await importArchiveFromFile(file);
    event.target.value = "";
  });
  document.querySelectorAll("[data-archive-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      await openArchiveDetail(button.dataset.archiveOpen);
    });
  });
  document.querySelectorAll(".admin-export-archive").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void exportArchive(button.dataset.archiveExport);
    });
  });
  document.querySelectorAll(".admin-delete-archive").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteArchive(button.dataset.archiveId, button.dataset.archiveTitle);
    });
  });
}

function render() {
  if (state.mode === "loading") {
    app.innerHTML = `<div class="app"><div class="loading">${escapeHtml(state.loadingText)}</div></div>`;
    return;
  }

  if (state.mode === "login") {
    renderLogin();
    return;
  }

  if (state.mode === "disabled") {
    renderDisabled();
    return;
  }

  if (state.mode === "dashboard") {
    renderDashboard();
    return;
  }

  app.innerHTML = `<div class="app"><div class="card">管理后台启动失败：${escapeHtml(state.error ?? "未知错误")}</div></div>`;
}

loadAdminBootstrap();
