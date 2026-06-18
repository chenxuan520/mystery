import { confirm as promptConfirm, input as promptInput, select as promptSelect } from "@inquirer/prompts";
import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { archiveApprovedCase, DEFAULT_ARCHIVE_DIR, listArchivedCases, loadArchivedCase } from "../archive/story-archive.js";
import type { MysteryCase, InvestigationNode, Npc, Suspect } from "../case/schema.js";
import { generateCasePackageWithDiagnostics } from "../case/generator.js";
import { DialogueMemory } from "../chat/dialogue-memory.js";
import { buildHintMasterCharacter, generateHintMasterReply, HINT_MASTER_ID } from "../chat/hint-master.js";
import { generateSuspectReply, type DialogueCharacter } from "../chat/suspect-chat.js";
import { loadRuntimeConfig, loadRuntimeConfigForRole } from "../config/runtime-config.js";
import { judgeAccusation } from "../judgement/judge.js";
import { OpenAiGateway } from "../llm/openai-gateway.js";
import { SessionStore, type StoredSession } from "../session/store.js";

class InputClosedError extends Error {
  constructor() {
    super("输入流已关闭");
  }
}

function supportsInteractiveMenus(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

function isPromptExitError(error: unknown): boolean {
  return error instanceof Error && (error.name === "ExitPromptError" || error.name === "AbortPromptError" || error.message.includes("force closed"));
}

function requireInterface(rl: Interface | null): Interface {
  if (!rl) {
    throw new Error("当前交互环境不可用。");
  }

  return rl;
}

async function askText(rl: Interface | null, prompt: string): Promise<string> {
  if (supportsInteractiveMenus()) {
    try {
      return (await promptInput({ message: prompt.replace(/[：:]\s*$/u, "") })).trim();
    } catch (error) {
      if (isPromptExitError(error)) {
        throw new InputClosedError();
      }

      throw error;
    }
  }

  try {
    return (await requireInterface(rl).question(prompt)).trim();
  } catch (error) {
    if (error instanceof Error && error.message.includes("readline was closed")) {
      throw new InputClosedError();
    }

    throw error;
  }
}

async function askYesNo(rl: Interface | null, prompt: string, defaultYes = true): Promise<boolean> {
  if (supportsInteractiveMenus()) {
    try {
      return await promptConfirm({ message: prompt, default: defaultYes });
    } catch (error) {
      if (isPromptExitError(error)) {
        throw new InputClosedError();
      }

      throw error;
    }
  }

  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await askText(rl, `${prompt} ${suffix} `)).toLowerCase();
  if (!answer) {
    return defaultYes;
  }

  return answer === "y" || answer === "yes" || answer === "是";
}

async function chooseIndex(rl: Interface | null, title: string, items: string[], allowBack = true): Promise<number | null> {
  if (supportsInteractiveMenus()) {
    try {
      const choice = await promptSelect<number>({
        message: title,
        pageSize: Math.min(Math.max(items.length + (allowBack ? 1 : 0), 5), 12),
        choices: [
          ...items.map((item, index) => ({
            name: item,
            value: index,
          })),
          ...(allowBack
            ? [
                {
                  name: "返回",
                  value: -1,
                },
              ]
            : []),
        ],
      });

      return choice === -1 ? null : choice;
    } catch (error) {
      if (isPromptExitError(error)) {
        throw new InputClosedError();
      }

      throw error;
    }
  }

  console.log(`\n${title}`);
  items.forEach((item, index) => {
    console.log(`  ${index + 1}. ${item}`);
  });

  if (allowBack) {
    console.log("  0. 返回");
  }

  while (true) {
    const answer = await askText(rl, "> ");
    const choice = Number(answer);

    if (allowBack && choice === 0) {
      return null;
    }

    if (Number.isInteger(choice) && choice >= 1 && choice <= items.length) {
      return choice - 1;
    }

    console.log("请输入有效序号。");
  }
}

function visitedNodes(mysteryCase: MysteryCase, session: StoredSession): InvestigationNode[] {
  return mysteryCase.investigationNodes.filter((node) => session.state.visitedNodeIds.includes(node.id));
}

function printCaseHeader(mysteryCase: MysteryCase, session: StoredSession) {
  console.log(`\n=== ${mysteryCase.title} ===`);
  console.log(mysteryCase.openingNarration);
  console.log(`\n案件摘要：${mysteryCase.publicSummary}`);
  console.log(`目标：${mysteryCase.playerGoal}`);
  console.log(`死者：${mysteryCase.victim.name}（${mysteryCase.victim.profile}）`);
  console.log(`嫌疑人：${mysteryCase.suspects.map((suspect) => suspect.name).join("、")}`);
  console.log(`已调查节点：${session.state.visitedNodeIds.length}/${mysteryCase.investigationNodes.length}`);
}

function formatArchiveLabel(summary: ReturnType<typeof listArchivedCases>[number]) {
  const score = typeof summary.overallScore === "number" ? ` / 评分 ${summary.overallScore}` : "";
  return `${summary.title}（${summary.template} / ${summary.suspects} 嫌疑人${score}）`;
}

function printSuspectProfiles(mysteryCase: MysteryCase) {
  console.log("\n角色档案：");
  for (const suspect of mysteryCase.suspects) {
    console.log(`\n- ${suspect.name}`);
    console.log(`  身份：${suspect.publicPersona}`);
    console.log(`  与死者关系：${suspect.relationshipToVictim}`);
    console.log(`  表面动机：${suspect.possibleMotive}`);
    console.log(`  对外口供：${suspect.alibi}`);
  }

  for (const npc of mysteryCase.npcs ?? []) {
    console.log(`\n- ${npc.name}`);
    console.log(`  身份：${npc.publicPersona}`);
    console.log(`  与死者关系：${npc.relationshipToVictim}`);
    console.log(`  为什么值得问：${npc.whyRelevant}`);
  }

  const hintMaster = buildHintMasterCharacter();
  console.log(`\n- ${hintMaster.name}`);
  console.log(`  身份：${hintMaster.publicPersona}`);
  console.log(`  角色定位：${hintMaster.relationshipToVictim}`);
  console.log(`  可提供帮助：${hintMaster.whyRelevant}`);
}

type CliDialogueEntry = {
  id: string;
  name: string;
  label: string;
  character?: DialogueCharacter;
  type: "character" | "hint-master";
};

function buildCliDialogueEntries(mysteryCase: MysteryCase): CliDialogueEntry[] {
  return [
    ...mysteryCase.suspects.map((suspect) => ({
      id: suspect.id,
      name: suspect.name,
      label: `${suspect.name}：${suspect.publicPersona}`,
      character: suspect as Suspect,
      type: "character" as const,
    })),
    ...(mysteryCase.npcs ?? []).map((npc) => ({
      id: npc.id,
      name: npc.name,
      label: `${npc.name}：${npc.publicPersona}`,
      character: npc as Npc,
      type: "character" as const,
    })),
    {
      id: HINT_MASTER_ID,
      name: buildHintMasterCharacter().name,
      label: `${buildHintMasterCharacter().name}：${buildHintMasterCharacter().publicPersona}`,
      type: "hint-master",
    },
  ];
}

function printInvestigationNotebook(mysteryCase: MysteryCase, session: StoredSession) {
  const known = visitedNodes(mysteryCase, session);
  if (!known.length) {
    console.log("\n你还没有记录任何已发现线索。");
    return;
  }

  console.log("\n已知线索记录：");
  for (const node of known) {
    console.log(`\n- ${node.title}`);
    console.log(`  摘要：${node.summary}`);
    console.log(`  发现：${node.discovery}`);
    if (node.contradictionIds.length) {
      console.log(`  相关疑点：${node.contradictionIds.join("、")}`);
    }
  }
}

async function startNewSession(
  store: SessionStore,
  generationGateway: OpenAiGateway,
  reviewGateway: OpenAiGateway,
  archiveDir: string,
): Promise<{ mysteryCase: MysteryCase; session: StoredSession }> {
  console.log("\n正在生成新案件，请稍候...\n");
  const result = await generateCasePackageWithDiagnostics(generationGateway, undefined, reviewGateway, {
    existingTitles: Array.from(new Set([...store.listCaseTitles(), ...listArchivedCases(archiveDir).map((item) => item.title)])),
  });
  const mysteryCase = result.mysteryCase;

  store.saveCase(mysteryCase);
  archiveApprovedCase(
    {
      archiveId: `archive_${crypto.randomUUID()}`,
      archivedAt: new Date().toISOString(),
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
    },
    archiveDir,
  );
  const session = store.createSession(mysteryCase.id);
  return { mysteryCase, session };
}

async function restoreOrCreateSession(
  rl: Interface | null,
  store: SessionStore,
  generationGateway: OpenAiGateway,
  reviewGateway: OpenAiGateway,
  archiveDir: string,
): Promise<{ mysteryCase: MysteryCase; session: StoredSession }> {
  const archivedCases = listArchivedCases(archiveDir);
  const latest = store.getLatestActiveSession();

  const options: Array<{ label: string; action: "resume" | "new" | "archive" | "exit" }> = [];
  if (latest) {
    const existingCase = store.getCase(latest.caseId);
    if (existingCase) {
      options.push({
        label: `继续最近一局《${existingCase.title}》`,
        action: "resume",
      });
    }
  }

  options.push({ label: "生成新案件", action: "new" });

  if (archivedCases.length > 0) {
    options.push({ label: `从归档案件开始（${archivedCases.length} 个）`, action: "archive" });
  }

  options.push({ label: "退出", action: "exit" });

  const choice = await chooseIndex(
    rl,
    "选择开始方式：",
    options.map((option) => option.label),
    false,
  );

  const selected = options[choice ?? options.length - 1];

  if (selected?.action === "resume" && latest) {
    const existingCase = store.getCase(latest.caseId);
    if (existingCase) {
      return { mysteryCase: existingCase, session: latest };
    }
  }

  if (selected?.action === "archive") {
    const archiveIndex = await chooseIndex(
      rl,
      "选择归档案件：",
      archivedCases.map(formatArchiveLabel),
    );

    if (archiveIndex !== null) {
      const archive = loadArchivedCase(archivedCases[archiveIndex]!.filePath);
      store.saveCase(archive.mysteryCase);
      const session = store.createSession(archive.mysteryCase.id);
      console.log(`\n已载入归档案件《${archive.mysteryCase.title}》。`);
      return { mysteryCase: archive.mysteryCase, session };
    }

    return restoreOrCreateSession(rl, store, generationGateway, reviewGateway, archiveDir);
  }

  if (selected?.action === "exit") {
    throw new InputClosedError();
  }

  return startNewSession(store, generationGateway, reviewGateway, archiveDir);
}

async function handleInvestigation(rl: Interface | null, store: SessionStore, mysteryCase: MysteryCase, session: StoredSession) {
  const index = await chooseIndex(
    rl,
    "选择要调查的节点：",
    mysteryCase.investigationNodes.map((node) => {
      const marker = session.state.visitedNodeIds.includes(node.id) ? "[已看] " : "";
      return `${marker}${node.title}（${node.category}）`;
    }),
  );

  if (index === null) {
    return;
  }

  const node = mysteryCase.investigationNodes[index];
  console.log(`\n【${node.title}】`);
  console.log(node.summary);
  console.log(`线索：${node.discovery}`);

  if (!session.state.visitedNodeIds.includes(node.id)) {
    store.updateSessionState(session.id, (state) => ({
      ...state,
      visitedNodeIds: [...state.visitedNodeIds, node.id],
    }));
  }
}

async function handleChat(
  rl: Interface | null,
  store: SessionStore,
  gateway: OpenAiGateway,
  mysteryCase: MysteryCase,
  session: StoredSession,
  dialogueMemory: DialogueMemory,
) {
  const dialogueEntries = buildCliDialogueEntries(mysteryCase);
  const index = await chooseIndex(
    rl,
    "选择要对话的角色：",
    dialogueEntries.map((entry) => entry.label),
  );

  if (index === null) {
    return;
  }

  const entry = dialogueEntries[index]!;
  console.log(`\n开始和 ${entry.name} 对话。直接回车可结束当前对话。`);

  while (true) {
    const userInput = await askText(rl, "你：");
    if (!userInput) {
      break;
    }

    const history = dialogueMemory.getHistory(entry.id);
    dialogueMemory.append(entry.id, { role: "user", content: userInput });
    store.touchSession(session.id);

    const reply =
      entry.type === "hint-master"
        ? await generateHintMasterReply(gateway, mysteryCase, visitedNodes(mysteryCase, session), history, userInput, session.status === "solved")
        : await generateSuspectReply(
            gateway,
            mysteryCase,
            entry.character as DialogueCharacter,
            visitedNodes(mysteryCase, session),
            history,
            userInput,
          );

    dialogueMemory.append(entry.id, { role: "assistant", content: reply });
    console.log(`${entry.name}：${reply}`);
  }
}

function printJudgement(mysteryCase: MysteryCase, accusedId: string) {
  const result = judgeAccusation(mysteryCase, accusedId);
  console.log(`\n${result.summary}`);
  console.log(`\n真相还原：${result.truthReveal}`);
  console.log("\n真凶作案链路：");
  for (const step of result.culpritPlan) {
    console.log(`- ${step}`);
  }
  console.log("\n关键时间线：");
  for (const item of mysteryCase.solution.timeline) {
    console.log(`- ${item.time}：${item.event}`);
  }
  console.log("\n关键矛盾：");
  for (const item of result.keyContradictions) {
    console.log(`- ${item.title}：${item.summary} -> ${item.implication}`);
  }
  console.log("\n误导点：");
  for (const item of result.redHerrings) {
    console.log(`- ${item}`);
  }
  console.log("\n隐藏关系：");
  for (const item of result.hiddenRelationships) {
    console.log(`- 表面：${item.surface}`);
    console.log(`  真相：${item.hiddenTruth}`);
  }
}

async function handleAccusation(rl: Interface | null, store: SessionStore, mysteryCase: MysteryCase, session: StoredSession): Promise<boolean> {
  const index = await chooseIndex(
    rl,
    "你要指认谁是凶手？",
    mysteryCase.suspects.map((suspect) => suspect.name),
  );

  if (index === null) {
    return false;
  }

  const suspect = mysteryCase.suspects[index] as Suspect;
  const confirmed = await askYesNo(rl, `确认指认 ${suspect.name} 吗？`, false);

  if (!confirmed) {
    return false;
  }

  store.updateSessionState(session.id, (state) => ({
    ...state,
    accusedSuspectId: suspect.id,
  }));
  store.updateSessionStatus(session.id, "solved");
  printJudgement(mysteryCase, suspect.id);
  return true;
}

async function gameLoop(
  rl: Interface | null,
  store: SessionStore,
  gateway: OpenAiGateway,
  mysteryCase: MysteryCase,
  session: StoredSession,
  dialogueMemory: DialogueMemory,
) {
  let currentSession = session;

  while (true) {
    currentSession = store.getSession(currentSession.id) ?? currentSession;
    printCaseHeader(mysteryCase, currentSession);

    const choice = await chooseIndex(
      rl,
      "选择操作：",
      ["查看调查节点", "询问角色", "查看角色档案", "查看已知线索", "指认真凶", "重新查看案件摘要", "保存并退出"],
      false,
    );

    switch (choice) {
      case 0:
        await handleInvestigation(rl, store, mysteryCase, currentSession);
        break;
      case 1:
        await handleChat(rl, store, gateway, mysteryCase, currentSession, dialogueMemory);
        break;
      case 2:
        printSuspectProfiles(mysteryCase);
        break;
      case 3:
        printInvestigationNotebook(mysteryCase, currentSession);
        break;
      case 4: {
        const finished = await handleAccusation(rl, store, mysteryCase, currentSession);
        if (finished) {
          return;
        }
        break;
      }
      case 5:
        console.log(`\n${mysteryCase.publicSummary}`);
        break;
      case 6:
        console.log("\n已保存当前进度，下次可以恢复最近一局。\n");
        return;
      default:
        break;
    }
  }
}

export async function runCli() {
  const playConfig = loadRuntimeConfig();
  const generationConfig = loadRuntimeConfigForRole("generator");
  const reviewConfig = loadRuntimeConfigForRole("reviewer");
  const gateway = new OpenAiGateway(playConfig);
  const generationGateway = new OpenAiGateway(generationConfig);
  const reviewGateway = new OpenAiGateway(reviewConfig);
  const archiveDir = process.env.ARCHIVE_DIR ?? DEFAULT_ARCHIVE_DIR;
  const store = new SessionStore(playConfig.databasePath);
  const dialogueMemory = new DialogueMemory();
  const rl = supportsInteractiveMenus() ? null : createInterface({ input, output });

  try {
    console.log(`已加载游玩模型（来源：${playConfig.source}，模型：${playConfig.openaiModel}）`);
    console.log(`案件生成模型：${generationConfig.openaiModel} / 案件评审模型：${reviewConfig.openaiModel}`);
    const { mysteryCase, session } = await restoreOrCreateSession(rl, store, generationGateway, reviewGateway, archiveDir);
    dialogueMemory.clear();
    await gameLoop(rl, store, gateway, mysteryCase, session, dialogueMemory);
  } catch (error) {
    if (error instanceof InputClosedError) {
      console.log("\n输入已结束，游戏退出。\n");
      return;
    }

    throw error;
  } finally {
    rl?.close();
    store.close();
  }
}
