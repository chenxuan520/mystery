import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { CaseGenerationDiagnostics } from "../case/generator.js";
import type { CaseReview } from "../case/reviewer.js";
import { normalizeMysteryCase, type MysteryCase } from "../case/schema.js";
import { stripCaseVisualAssets } from "../case/visuals.js";

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
  filePath: string;
};

export const DEFAULT_ARCHIVE_DIR = "data/approved-cases";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function ensureArchiveDir(archiveDir: string) {
  mkdirSync(archiveDir, { recursive: true });
}

function createArchivePath(record: ArchivedCaseRecord, archiveDir: string): string {
  const datePart = record.archivedAt.replace(/[:.]/g, "-");
  const slug = slugify(record.mysteryCase.title) || record.mysteryCase.id;
  return join(archiveDir, `${datePart}--${slug}--${record.archiveId}.json`);
}

export function archiveApprovedCase(record: ArchivedCaseRecord, archiveDir = DEFAULT_ARCHIVE_DIR): string {
  ensureArchiveDir(archiveDir);
  const normalizedCase = normalizeMysteryCase(record.mysteryCase);
  const normalizedRecord: ArchivedCaseRecord = {
    ...record,
    mysteryCase: stripCaseVisualAssets(normalizedCase),
  };
  const filePath = createArchivePath(record, archiveDir);
  writeFileSync(filePath, JSON.stringify(normalizedRecord, null, 2), "utf-8");
  return filePath;
}

export function listArchivedCases(archiveDir = DEFAULT_ARCHIVE_DIR): ArchivedCaseSummary[] {
  if (!existsSync(archiveDir)) {
    return [];
  }

  return readdirSync(archiveDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      const filePath = join(archiveDir, fileName);
      const record = JSON.parse(readFileSync(filePath, "utf-8")) as ArchivedCaseRecord;
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
        filePath,
      } satisfies ArchivedCaseSummary;
    })
    .sort((left, right) => right.archivedAt.localeCompare(left.archivedAt));
}

export function loadArchivedCase(filePath: string): ArchivedCaseRecord {
  const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ArchivedCaseRecord;
  return {
    ...parsed,
    mysteryCase: normalizeMysteryCase(parsed.mysteryCase),
  };
}

export function deleteArchivedCase(archiveId: string, archiveDir = DEFAULT_ARCHIVE_DIR): boolean {
  const target = listArchivedCases(archiveDir).find((item) => item.archiveId === archiveId);
  if (!target) {
    return false;
  }

  unlinkSync(target.filePath);
  return true;
}

function isArchiveRecordLike(input: unknown): input is Partial<ArchivedCaseRecord> & { mysteryCase: unknown } {
  return Boolean(input && typeof input === "object" && "mysteryCase" in input);
}

export function importArchivePayload(input: unknown, archiveDir = DEFAULT_ARCHIVE_DIR): string {
  const baseRecord = isArchiveRecordLike(input) ? input : null;
  const normalizedCase = normalizeMysteryCase(baseRecord?.mysteryCase ?? input);
  const mysteryCase = {
    ...normalizedCase,
    id: `case_${randomUUID()}`,
  } satisfies MysteryCase;

  return archiveApprovedCase(
    {
      archiveId: `archive_${randomUUID()}`,
      archivedAt: new Date().toISOString(),
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
    },
    archiveDir,
  );
}
