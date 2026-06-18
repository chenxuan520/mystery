import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

import { normalizeMysteryCase, type MysteryCase } from "../case/schema.js";
import { stripCaseVisualAssets } from "../case/visuals.js";

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

type SessionRow = {
  id: string;
  case_id: string;
  status: SessionStatus;
  state_json: string;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function createSessionId(): string {
  return `session_${crypto.randomUUID()}`;
}

export class SessionStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        template TEXT NOT NULL,
        title TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        status TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS generation_failures (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);

    this.db.exec(`DROP TABLE IF EXISTS messages;`);
  }

  saveCase(mysteryCase: MysteryCase) {
    const normalizedCase = normalizeMysteryCase(mysteryCase);
    const storageCase = stripCaseVisualAssets(normalizedCase);
    const createdAt = nowIso();
    const statement = this.db.prepare(
      `INSERT OR REPLACE INTO cases (id, template, title, payload, created_at)
       VALUES (@id, @template, @title, @payload, @created_at)`,
    );

    statement.run({
      id: storageCase.id,
      template: storageCase.template,
      title: storageCase.title,
      payload: JSON.stringify(storageCase),
      created_at: createdAt,
    });
  }

  getCase(caseId: string): MysteryCase | null {
    const row = this.db.prepare(`SELECT payload FROM cases WHERE id = ?`).get(caseId) as { payload: string } | undefined;
    return row ? normalizeMysteryCase(JSON.parse(row.payload)) : null;
  }

  listCaseTitles(): string[] {
    const rows = this.db.prepare(`SELECT title FROM cases ORDER BY created_at DESC`).all() as Array<{ title: string }>;
    return rows.map((row) => row.title).filter(Boolean);
  }

  createSession(caseId: string): StoredSession {
    const timestamp = nowIso();
    const session: StoredSession = {
      id: createSessionId(),
      caseId,
      status: "active",
      state: { visitedNodeIds: [] },
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db
      .prepare(
        `INSERT INTO sessions (id, case_id, status, state_json, created_at, updated_at)
         VALUES (@id, @case_id, @status, @state_json, @created_at, @updated_at)`,
      )
      .run({
        id: session.id,
        case_id: session.caseId,
        status: session.status,
        state_json: JSON.stringify(session.state),
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      });

    return session;
  }

  getSession(sessionId: string): StoredSession | null {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as SessionRow | undefined;
    return row ? this.mapSession(row) : null;
  }

  getLatestActiveSession(): StoredSession | null {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1`)
      .get() as SessionRow | undefined;

    return row ? this.mapSession(row) : null;
  }

  updateSessionState(sessionId: string, updater: (state: SessionState) => SessionState) {
    const current = this.getSession(sessionId);
    if (!current) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    const nextState = updater(current.state);
    const updatedAt = nowIso();

    this.db
      .prepare(`UPDATE sessions SET state_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(nextState), updatedAt, sessionId);
  }

  updateSessionStatus(sessionId: string, status: SessionStatus) {
    this.db.prepare(`UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), sessionId);
  }

  touchSession(sessionId: string) {
    this.db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(nowIso(), sessionId);
  }

  getSetting<T>(key: string): T | null {
    const row = this.db.prepare(`SELECT value_json FROM settings WHERE key = ?`).get(key) as { value_json: string } | undefined;
    if (!row) {
      return null;
    }

    return JSON.parse(row.value_json) as T;
  }

  setSetting(key: string, value: unknown) {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), nowIso());
  }

  recordGenerationFailure(failure: StoredGenerationFailure) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO generation_failures (id, created_at, payload_json)
         VALUES (@id, @created_at, @payload_json)`,
      )
      .run({
        id: failure.id,
        created_at: failure.createdAt,
        payload_json: JSON.stringify(failure),
      });
  }

  getLatestGenerationFailure(): StoredGenerationFailure | null {
    const row = this.db
      .prepare(`SELECT payload_json FROM generation_failures ORDER BY created_at DESC LIMIT 1`)
      .get() as { payload_json: string } | undefined;

    return row ? (JSON.parse(row.payload_json) as StoredGenerationFailure) : null;
  }

  listGenerationFailures(limit = 20): StoredGenerationFailure[] {
    const rows = this.db
      .prepare(`SELECT payload_json FROM generation_failures ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Array<{ payload_json: string }>;

    return rows.map((row) => JSON.parse(row.payload_json) as StoredGenerationFailure);
  }

  close() {
    this.db.close();
  }

  private mapSession(row: SessionRow): StoredSession {
    return {
      id: row.id,
      caseId: row.case_id,
      status: row.status,
      state: JSON.parse(row.state_json) as SessionState,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
