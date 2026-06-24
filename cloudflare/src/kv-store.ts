import type { CaseGenerationDiagnostics } from "../../src/case/generator.js";
import type { CaseReview } from "../../src/case/reviewer.js";
import { normalizeMysteryCase, type MysteryCase } from "../../src/case/schema.js";
import { stripCaseVisualAssets } from "../../src/case/visuals.js";

import { nowIso } from "./utils.js";

export type SessionStatus = "active" | "solved" | "abandoned";

export type SessionState = {
  visitedNodeIds: string[];
  accusedSuspectId?: string;
};

export type StoredSession = {
  id: string;
  caseId: string;
  status: SessionStatus;
  state: SessionState;
  createdAt: string;
  updatedAt: string;
};

export type StoredGenerationFailure = {
  id: string;
  jobId: string;
  templateType?: string;
  phase?: string;
  progressMessage?: string;
  attempt?: number;
  totalAttempts?: number;
  error: string;
  rawError?: string;
  partialOutput?: string;
  generatorModel: string;
  reviewModel?: string;
  generatorPresetId?: string;
  reviewPresetId?: string;
  createdAt: string;
};

export type ArchivedCaseRecord = {
  archiveId: string;
  archivedAt: string;
  source: {
    model: string;
    reviewModel?: string;
    presetId?: string;
    reviewPresetId?: string;
    structuredOutputMode?: string;
  };
  diagnostics?: CaseGenerationDiagnostics;
  review?: CaseReview;
  mysteryCase: MysteryCase;
};

export type ArchivedCaseSummary = {
  archiveId: string;
  archivedAt: string;
  caseId: string;
  title: string;
  template: MysteryCase["template"];
  suspects: number;
  overallScore?: number;
  sourceModel?: string;
  reviewModel?: string;
  presetId?: string;
  reviewPresetId?: string;
  fingerprint?: string;
};

export type ListedKey<T> = {
  name: string;
  expiration?: number;
  metadata?: T;
};

export type KvNamespaceLike = {
  get(key: string, type?: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { metadata?: unknown; expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list<T>(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: Array<ListedKey<T>>;
    list_complete: boolean;
    cursor?: string;
  }>;
};

const CASE_PREFIX = "case:";
const SESSION_PREFIX = "session:";
const SETTING_PREFIX = "setting:";
const ARCHIVE_PREFIX = "archive:";
const GENERATION_FAILURE_PREFIX = "generation-failure:";
const GENERATION_FAILURE_LATEST_KEY = `${GENERATION_FAILURE_PREFIX}latest`;

type CaseMetadata = {
  title: string;
  createdAt: string;
  template: MysteryCase["template"];
};

type SessionMetadata = {
  caseId: string;
  status: SessionStatus;
  updatedAt: string;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fingerprintMysteryCase(mysteryCase: MysteryCase) {
  const normalizedCase = normalizeMysteryCase(mysteryCase);
  const storageCase = stripCaseVisualAssets(normalizedCase);
  const comparableCase = {
    ...storageCase,
    id: "case_fingerprint",
  } satisfies MysteryCase;
  const payload = new TextEncoder().encode(JSON.stringify(comparableCase));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return bytesToHex(new Uint8Array(digest));
}

function caseKey(caseId: string) {
  return `${CASE_PREFIX}${caseId}`;
}

function sessionKey(sessionId: string) {
  return `${SESSION_PREFIX}${sessionId}`;
}

function settingKey(key: string) {
  return `${SETTING_PREFIX}${key}`;
}

function archiveKey(archiveId: string) {
  return `${ARCHIVE_PREFIX}${archiveId}`;
}

function generationFailureKey(failure: StoredGenerationFailure) {
  return `${GENERATION_FAILURE_PREFIX}${failure.createdAt}:${failure.id}`;
}

function createSessionId() {
  return `session_${crypto.randomUUID()}`;
}

async function getJson<T>(kv: KvNamespaceLike, key: string): Promise<T | null> {
  const value = await kv.get(key, "json");
  return (value as T | null) ?? null;
}

export async function listAllKeys<T>(kv: KvNamespaceLike, prefix: string): Promise<Array<ListedKey<T>>> {
  const keys: Array<ListedKey<T>> = [];
  let cursor: string | undefined;

  while (true) {
    const page = await kv.list<T>({ prefix, cursor, limit: 1000 });
    keys.push(...(page.keys as Array<ListedKey<T>>));
    if (page.list_complete) {
      return keys;
    }
    cursor = page.cursor;
  }
}

export async function deleteKeysByPrefix(kv: KvNamespaceLike, prefix: string) {
  const keys = await listAllKeys(kv, prefix);
  await Promise.all(keys.map((key) => kv.delete(key.name)));
}

function summarizeArchive(record: ArchivedCaseRecord, fingerprint?: string): ArchivedCaseSummary {
  return {
    archiveId: record.archiveId,
    archivedAt: record.archivedAt,
    caseId: record.mysteryCase.id,
    title: record.mysteryCase.title,
    template: record.mysteryCase.template,
    suspects: record.mysteryCase.suspects.length,
    overallScore: record.review?.overallScore,
    sourceModel: record.source.model,
    reviewModel: record.source.reviewModel,
    presetId: record.source.presetId,
    reviewPresetId: record.source.reviewPresetId,
    fingerprint,
  };
}

function isArchiveRecordLike(input: unknown): input is Partial<ArchivedCaseRecord> & { mysteryCase: unknown } {
  return Boolean(input && typeof input === "object" && "mysteryCase" in input);
}

export class KvAppStore {
  constructor(private readonly kv: KvNamespaceLike) {}

  async saveCase(mysteryCase: MysteryCase) {
    const normalizedCase = normalizeMysteryCase(mysteryCase);
    const storageCase = stripCaseVisualAssets(normalizedCase);
    const createdAt = nowIso();

    await this.kv.put(caseKey(storageCase.id), JSON.stringify(storageCase), {
      metadata: {
        title: storageCase.title,
        createdAt,
        template: storageCase.template,
      } satisfies CaseMetadata,
    });
  }

  async getCase(caseId: string) {
    const row = await getJson<MysteryCase>(this.kv, caseKey(caseId));
    return row ? normalizeMysteryCase(row) : null;
  }

  async listCaseTitles() {
    const rows = await listAllKeys<CaseMetadata>(this.kv, CASE_PREFIX);
    return rows.map((row) => row.metadata?.title).filter((value): value is string => Boolean(value));
  }

  async createSession(caseId: string) {
    const timestamp = nowIso();
    const session: StoredSession = {
      id: createSessionId(),
      caseId,
      status: "active",
      state: { visitedNodeIds: [] },
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.putSession(session);
    return session;
  }

  async getSession(sessionId: string) {
    return getJson<StoredSession>(this.kv, sessionKey(sessionId));
  }

  async updateSessionState(sessionId: string, updater: (state: SessionState) => SessionState) {
    const current = await this.getSession(sessionId);
    if (!current) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    const next: StoredSession = {
      ...current,
      state: updater(current.state),
      updatedAt: nowIso(),
    };

    await this.putSession(next);
    return next;
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus) {
    const current = await this.getSession(sessionId);
    if (!current) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    const next: StoredSession = {
      ...current,
      status,
      updatedAt: nowIso(),
    };

    await this.putSession(next);
    return next;
  }

  async touchSession(sessionId: string) {
    const current = await this.getSession(sessionId);
    if (!current) {
      return null;
    }

    const next: StoredSession = {
      ...current,
      updatedAt: nowIso(),
    };

    await this.putSession(next);
    return next;
  }

  async getSetting<T>(key: string): Promise<T | null> {
    return getJson<T>(this.kv, settingKey(key));
  }

  async setSetting(key: string, value: unknown) {
    await this.kv.put(settingKey(key), JSON.stringify(value), {
      metadata: {
        updatedAt: nowIso(),
      },
    });
  }

  async recordGenerationFailure(failure: StoredGenerationFailure) {
    const payload = JSON.stringify(failure);
    await this.kv.put(generationFailureKey(failure), payload, {
      metadata: {
        createdAt: failure.createdAt,
      },
    });
    await this.kv.put(GENERATION_FAILURE_LATEST_KEY, payload, {
      metadata: {
        createdAt: failure.createdAt,
      },
    });
  }

  async getLatestGenerationFailure() {
    return getJson<StoredGenerationFailure>(this.kv, GENERATION_FAILURE_LATEST_KEY);
  }

  async putArchive(record: ArchivedCaseRecord) {
    const normalizedCase = normalizeMysteryCase(record.mysteryCase);
    const normalizedRecord: ArchivedCaseRecord = {
      ...record,
      mysteryCase: stripCaseVisualAssets(normalizedCase),
    };
    const fingerprint = await fingerprintMysteryCase(normalizedCase);
    const summary = summarizeArchive({
      ...normalizedRecord,
      mysteryCase: normalizedCase,
    }, fingerprint);

    await this.kv.put(archiveKey(record.archiveId), JSON.stringify(normalizedRecord), {
      metadata: summary,
    });

    return summary;
  }

  async getArchivedCase(archiveId: string) {
    const parsed = await getJson<ArchivedCaseRecord>(this.kv, archiveKey(archiveId));
    if (!parsed) {
      return null;
    }

    return {
      ...parsed,
      mysteryCase: normalizeMysteryCase(parsed.mysteryCase),
    } satisfies ArchivedCaseRecord;
  }

  async listArchivedCases() {
    const keys = await listAllKeys<ArchivedCaseSummary>(this.kv, ARCHIVE_PREFIX);
    return keys
      .map((key) => key.metadata)
      .filter((value): value is ArchivedCaseSummary => Boolean(value))
      .sort((left, right) => right.archivedAt.localeCompare(left.archivedAt));
  }

  async deleteArchivedCase(archiveId: string) {
    const existing = await this.getArchivedCase(archiveId);
    if (!existing) {
      return false;
    }

    await this.kv.delete(archiveKey(archiveId));
    return true;
  }

  async importArchivePayload(input: unknown) {
    const baseRecord = isArchiveRecordLike(input) ? input : null;
    const normalizedCase = normalizeMysteryCase(baseRecord?.mysteryCase ?? input);
    const targetFingerprint = await fingerprintMysteryCase(normalizedCase);
    const existingSummaries = await this.listArchivedCases();

    const titleDuplicate = existingSummaries.find((summary) => summary.title === normalizedCase.title);
    if (titleDuplicate) {
      return titleDuplicate;
    }

    const metadataDuplicate = existingSummaries.find((summary) => summary.fingerprint === targetFingerprint);
    if (metadataDuplicate) {
      return metadataDuplicate;
    }

    const titleMatches = existingSummaries.filter((summary) => summary.title === normalizedCase.title && summary.template === normalizedCase.template);
    for (const summary of titleMatches) {
      const existingRecord = await this.getArchivedCase(summary.archiveId);
      if (!existingRecord) {
        continue;
      }

      const existingFingerprint = await fingerprintMysteryCase(existingRecord.mysteryCase);
      if (existingFingerprint === targetFingerprint) {
        return {
          ...summary,
          fingerprint: existingFingerprint,
        } satisfies ArchivedCaseSummary;
      }
    }

    const mysteryCase = {
      ...normalizedCase,
      id: `case_${crypto.randomUUID()}`,
    } satisfies MysteryCase;

    return this.putArchive({
      archiveId: `archive_${crypto.randomUUID()}`,
      archivedAt: nowIso(),
      source: baseRecord?.source?.model
        ? {
            model: baseRecord.source.model,
            reviewModel: baseRecord.source.reviewModel,
            presetId: baseRecord.source.presetId,
            reviewPresetId: baseRecord.source.reviewPresetId,
            structuredOutputMode: baseRecord.source.structuredOutputMode,
          }
        : {
            model: "imported-json",
          },
      diagnostics: baseRecord?.diagnostics,
      review: baseRecord?.review,
      mysteryCase,
    });
  }

  private async putSession(session: StoredSession) {
    await this.kv.put(sessionKey(session.id), JSON.stringify(session), {
      metadata: {
        caseId: session.caseId,
        status: session.status,
        updatedAt: session.updatedAt,
      } satisfies SessionMetadata,
    });
  }
}
