import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cloudflareDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(cloudflareDir, "..");

const baseUrl = process.env.BASE_URL || "https://mystery.011203.xyz";
const approvedCasesDir = process.env.APPROVED_CASES_DIR || path.join(repoRoot, "data", "approved-cases");
const rootEnvPath = process.env.ROOT_ENV_PATH || path.join(repoRoot, ".env");

function parseSimpleEnv(content) {
  const values = {};
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    values[key] = value;
  }
  return values;
}

async function loadAdminCredentials() {
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    return {
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
    };
  }

  const envContent = await fs.readFile(rootEnvPath, "utf8");
  const parsed = parseSimpleEnv(envContent);
  if (!parsed.ADMIN_USERNAME || !parsed.ADMIN_PASSWORD) {
    throw new Error(`未能从 ${rootEnvPath} 读取 ADMIN_USERNAME / ADMIN_PASSWORD。`);
  }

  return {
    username: parsed.ADMIN_USERNAME,
    password: parsed.ADMIN_PASSWORD,
  };
}

async function fetchJson(targetPath, init = {}, cookie = "") {
  const response = await fetch(new URL(targetPath, baseUrl), {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${targetPath} 请求失败：${response.status} ${data.error || text}`);
  }

  return {
    response,
    data,
  };
}

function readArchiveTitle(payload) {
  return payload?.mysteryCase?.title || payload?.title || "";
}

function readArchiveTime(payload, fallback) {
  return payload?.archivedAt || payload?.mysteryCase?.archivedAt || fallback;
}

async function collectLocalArchives() {
  const entries = await fs.readdir(approvedCasesDir, { withFileTypes: true });
  const recordsByTitle = new Map();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(approvedCasesDir, entry.name);
    const raw = await fs.readFile(filePath, "utf8");
    const payload = JSON.parse(raw);
    const title = readArchiveTitle(payload).trim();
    if (!title) {
      continue;
    }

    const archivedAt = readArchiveTime(payload, entry.name);
    const existing = recordsByTitle.get(title);
    if (!existing || archivedAt > existing.archivedAt) {
      recordsByTitle.set(title, {
        title,
        archivedAt,
        filePath,
        payload,
      });
    }
  }

  return [...recordsByTitle.values()].sort((left, right) => left.archivedAt.localeCompare(right.archivedAt));
}

const credentials = await loadAdminCredentials();
const login = await fetchJson("/api/admin/login", {
  method: "POST",
  body: JSON.stringify(credentials),
});
const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0] || "";

if (!cookie) {
  throw new Error("admin 登录成功但没有拿到 cookie。");
}

const beforeBootstrap = await fetchJson("/api/admin/bootstrap", {}, cookie);
const existingTitles = new Set((beforeBootstrap.data.archives || []).map((archive) => archive.title));
const localArchives = await collectLocalArchives();

const imported = [];
const skipped = [];

for (const record of localArchives) {
  if (existingTitles.has(record.title)) {
    skipped.push({ title: record.title, reason: "remote-title-exists" });
    continue;
  }

  const importedResult = await fetchJson(
    "/api/admin/archives/import",
    {
      method: "POST",
      body: JSON.stringify({ payload: record.payload }),
    },
    cookie,
  );
  imported.push({
    title: record.title,
    archiveId: importedResult.data.archive?.archiveId || null,
  });
  existingTitles.add(record.title);
}

const afterBootstrap = await fetchJson("/api/admin/bootstrap", {}, cookie);

console.log(
  JSON.stringify(
    {
      baseUrl,
      approvedCasesDir,
      localCount: localArchives.length,
      beforeRemoteCount: (beforeBootstrap.data.archives || []).length,
      afterRemoteCount: (afterBootstrap.data.archives || []).length,
      imported,
      skipped,
      remoteTitles: (afterBootstrap.data.archives || []).map((archive) => archive.title),
    },
    null,
    2,
  ),
);
