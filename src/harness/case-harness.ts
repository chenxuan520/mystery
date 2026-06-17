import { writeFileSync } from "node:fs";

import { archiveApprovedCase, DEFAULT_ARCHIVE_DIR, listArchivedCases } from "../archive/story-archive.js";
import { generateCasePackageWithDiagnostics } from "../case/generator.js";
import type { TemplateType } from "../case/schema.js";
import { loadRuntimeConfigForRole } from "../config/runtime-config.js";
import { OpenAiGateway } from "../llm/openai-gateway.js";

type HarnessOptions = {
  count: number;
  template?: TemplateType;
  output?: string;
  archiveDir: string;
  generatorPresetId?: string;
  reviewerPresetId?: string;
};

function parseOptions(argv: string[]): HarnessOptions {
  const options: HarnessOptions = { count: 3, archiveDir: DEFAULT_ARCHIVE_DIR };

  for (const arg of argv) {
    if (arg.startsWith("--count=")) {
      options.count = Math.max(1, Number(arg.slice("--count=".length)) || 3);
    } else if (arg.startsWith("--template=")) {
      options.template = arg.slice("--template=".length) as TemplateType;
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else if (arg.startsWith("--archive-dir=")) {
      options.archiveDir = arg.slice("--archive-dir=".length);
    } else if (arg.startsWith("--generator-preset=")) {
      options.generatorPresetId = arg.slice("--generator-preset=".length);
    } else if (arg.startsWith("--reviewer-preset=")) {
      options.reviewerPresetId = arg.slice("--reviewer-preset=".length);
    }
  }

  return options;
}

function buildSummary(options: HarnessOptions, results: Array<Record<string, unknown>>) {
  const successful = results.filter((item) => item.ok === true);

  return {
    options,
    total: results.length,
    passed: successful.length,
    failed: results.length - successful.length,
    averageOverallScore:
      successful.length > 0
        ? successful.reduce((sum, item) => sum + Number((item.review as { overallScore?: number } | undefined)?.overallScore ?? 0), 0) /
          successful.length
        : 0,
    averageAttempts:
      successful.length > 0 ? successful.reduce((sum, item) => sum + Number(item.attemptCount ?? 0), 0) / successful.length : 0,
    results,
  };
}

function flushSummary(options: HarnessOptions, results: Array<Record<string, unknown>>) {
  const summary = buildSummary(options, results);
  const output = JSON.stringify(summary, null, 2);

  if (options.output) {
    writeFileSync(options.output, output, "utf-8");
  }

  return summary;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const generatorConfig = loadRuntimeConfigForRole("generator", {
    ...process.env,
    CASE_GENERATOR_PRESET_ID: options.generatorPresetId ?? process.env.CASE_GENERATOR_PRESET_ID,
  });
  const reviewerConfig = loadRuntimeConfigForRole("reviewer", {
    ...process.env,
    CASE_REVIEWER_PRESET_ID: options.reviewerPresetId ?? process.env.CASE_REVIEWER_PRESET_ID,
  });
  const generationGateway = new OpenAiGateway(generatorConfig);
  const reviewGateway = new OpenAiGateway(reviewerConfig);
  const results: Array<Record<string, unknown>> = [];
  const knownTitles = new Set(listArchivedCases(options.archiveDir).map((item) => item.title));

  console.error(
    `[Harness] 生成模型：${generationGateway.describe().model}${generationGateway.describe().presetId ? ` (${generationGateway.describe().presetId})` : ""}`,
  );
  console.error(
    `[Harness] 评审模型：${reviewGateway.describe().model}${reviewGateway.describe().presetId ? ` (${reviewGateway.describe().presetId})` : ""}`,
  );

  for (let index = 0; index < options.count; index += 1) {
    console.error(`[Harness] 开始第 ${index + 1}/${options.count} 局...`);
    try {
      const startedAt = Date.now();
      const result = await generateCasePackageWithDiagnostics(generationGateway, options.template, reviewGateway, {
        existingTitles: [...knownTitles],
      });
      const durationMs = Date.now() - startedAt;
      const archivePath = archiveApprovedCase(
        {
          archiveId: `archive_${crypto.randomUUID()}`,
          archivedAt: new Date().toISOString(),
          source: {
            model: generatorConfig.openaiModel,
            reviewModel: reviewerConfig.openaiModel,
            presetId: generatorConfig.presetId,
            reviewPresetId: reviewerConfig.presetId,
            structuredOutputMode: generationGateway.describe().structuredOutputMode,
          },
          diagnostics: result.diagnostics,
          review: result.diagnostics.review,
          mysteryCase: result.mysteryCase,
        },
        options.archiveDir,
      );

      results.push({
        index: index + 1,
        ok: true,
        durationMs,
        title: result.mysteryCase.title,
        template: result.mysteryCase.template,
        suspects: result.mysteryCase.suspects.length,
        nodes: result.mysteryCase.investigationNodes.length,
        redHerrings: result.mysteryCase.solution.redHerrings.length,
        contradictions: result.mysteryCase.solution.keyContradictions.length,
        hiddenRelationships: result.mysteryCase.solution.hiddenRelationships.length,
        attemptCount: result.diagnostics.attemptCount,
        review: result.diagnostics.review,
        feedbackHistory: result.diagnostics.deterministicFeedback,
        archivePath,
      });
      knownTitles.add(result.mysteryCase.title);
      console.error(`[Harness] 第 ${index + 1} 局通过，已归档：${archivePath}`);
    } catch (error) {
      results.push({
        index: index + 1,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`[Harness] 第 ${index + 1} 局失败：${error instanceof Error ? error.message : String(error)}`);
    }

    flushSummary(options, results);
  }

  const summary = flushSummary(options, results);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Harness 执行失败：${message}`);
  process.exitCode = 1;
});
