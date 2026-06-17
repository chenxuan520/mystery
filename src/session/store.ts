import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

import { normalizeMysteryCase, type MysteryCase } from "../case/schema.js";

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

export type StoredMessage = {
  id: number;
  sessionId: string;
  suspectId: string;
  role: "user" | "assistant";
  content: string;
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

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        suspect_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  saveCase(mysteryCase: MysteryCase) {
    const normalizedCase = normalizeMysteryCase(mysteryCase);
    const createdAt = nowIso();
    const statement = this.db.prepare(
      `INSERT OR REPLACE INTO cases (id, template, title, payload, created_at)
       VALUES (@id, @template, @title, @payload, @created_at)`,
    );

    statement.run({
      id: normalizedCase.id,
      template: normalizedCase.template,
      title: normalizedCase.title,
      payload: JSON.stringify(normalizedCase),
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

  appendMessage(sessionId: string, suspectId: string, role: "user" | "assistant", content: string) {
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO messages (session_id, suspect_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, suspectId, role, content, createdAt);

    this.db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(createdAt, sessionId);
  }

  listMessages(sessionId: string, suspectId: string): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, suspect_id, role, content, created_at
         FROM messages
         WHERE session_id = ? AND suspect_id = ?
         ORDER BY id ASC`,
      )
      .all(sessionId, suspectId) as Array<{
      id: number;
      session_id: string;
      suspect_id: string;
      role: "user" | "assistant";
      content: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      suspectId: row.suspect_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));
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
