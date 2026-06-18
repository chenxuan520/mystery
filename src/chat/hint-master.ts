import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type { InvestigationNode, MysteryCase, Npc, Suspect } from "../case/schema.js";
import type { OpenAiGateway } from "../llm/openai-gateway.js";
import type { DialogueHistoryMessage } from "./suspect-chat.js";

export const HINT_MASTER_ID = "hint_master";

export type HintMasterCharacter = {
  id: string;
  name: string;
  publicPersona: string;
  relationshipToVictim: string;
  whyRelevant: string;
  appearanceSummary: string;
};

const HINT_REQUEST_PATTERN = /(提示|给点方向|给点思路|给我一点|我想不出来|我想不到|没思路|卡住了|卡住|下一步查什么|帮我梳理|提醒我一下|我不确定|我不知道从哪开始)/u;
const DIRECT_REVEAL_PATTERN = /(直接告诉|直接说|剧透|真凶是谁|凶手是谁|答案是什么|直接给答案|直接破案)/u;

function summarizePublicCharacter(character: Suspect | Npc) {
  const common = `${character.name}：${character.publicPersona}；与死者关系：${character.relationshipToVictim}`;
  if ("possibleMotive" in character) {
    return `${common}；表面动机：${character.possibleMotive}；对外口供：${character.alibi}`;
  }

  return `${common}；为什么值得问：${character.whyRelevant}`;
}

function summarizeKnownNodes(nodes: InvestigationNode[]) {
  return nodes.length
    ? nodes.map((node) => `${node.title}：${node.discovery}`).join("；")
    : "暂无已确认调查结果。";
}

function summarizeAllNodeTitles(mysteryCase: MysteryCase) {
  return mysteryCase.investigationNodes.map((node) => `${node.title}（${node.category}）`).join("；");
}

function summarizeUnvisitedNodes(mysteryCase: MysteryCase, knownNodes: InvestigationNode[]) {
  const knownIds = new Set(knownNodes.map((node) => node.id));
  const unseen = mysteryCase.investigationNodes.filter((node) => !knownIds.has(node.id));
  return unseen.length ? unseen.map((node) => `${node.title}（${node.category}）`).join("；") : "已全部调查过。";
}

function summarizeHiddenTruth(mysteryCase: MysteryCase) {
  return [
    `真凶：${mysteryCase.solution.culpritId}`,
    `作案方法：${mysteryCase.solution.method}`,
    `真相：${mysteryCase.solution.truthReveal}`,
    `关键矛盾：${mysteryCase.solution.keyContradictions.map((item) => `${item.title}：${item.implication}`).join("；")}`,
    `隐藏关系：${mysteryCase.solution.hiddenRelationships.map((item) => `${item.surface} -> ${item.hiddenTruth}`).join("；")}`,
    `调查节点全部发现：${mysteryCase.investigationNodes.map((node) => `${node.title}：${node.discovery}`).join("；")}`,
    `嫌疑人隐藏事实：${mysteryCase.suspects.map((suspect) => `${suspect.name}：${suspect.hides.join("、")}`).join("；")}`,
    `相关人物隐藏事实：${(mysteryCase.npcs ?? []).map((npc) => `${npc.name}：${npc.hides.join("、")}`).join("；") || "暂无"}`,
  ].join("\n");
}

export function isHintRequest(text: string) {
  return HINT_REQUEST_PATTERN.test(text);
}

export function isDirectRevealRequest(text: string) {
  return DIRECT_REVEAL_PATTERN.test(text);
}

function countPreviousHintRequests(history: DialogueHistoryMessage[]) {
  return history.filter((message) => message.role === "user" && isHintRequest(message.content)).length;
}

function buildHintMasterSystemPrompt(
  mysteryCase: MysteryCase,
  knownNodes: InvestigationNode[],
  history: DialogueHistoryMessage[],
  userInput: string,
  truthMode = false,
) {
  const previousHintCount = countPreviousHintRequests(history);
  const explicitHintRequest = isHintRequest(userInput);
  const directRevealRequest = isDirectRevealRequest(userInput);

  return [
    "你现在扮演案件的主持人 / 提示官，不属于案内角色。",
    `案件标题：${mysteryCase.title}`,
    `死者：${mysteryCase.victim.name}（${mysteryCase.victim.profile}）`,
    `公开案件摘要：${mysteryCase.publicSummary}`,
    `公开背景：${mysteryCase.storyContext.setting}；${mysteryCase.storyContext.currentSituation}；${mysteryCase.storyContext.whyNow}`,
    `玩家当前已知紧张关系：${mysteryCase.storyContext.knownTensions.join("；")}`,
    `嫌疑人公开档案：${mysteryCase.suspects.map(summarizePublicCharacter).join("；")}`,
    `相关人物公开档案：${(mysteryCase.npcs ?? []).map(summarizePublicCharacter).join("；") || "暂无"}`,
    `全部调查节点标题：${summarizeAllNodeTitles(mysteryCase)}`,
    `玩家已调查出的结果：${summarizeKnownNodes(knownNodes)}`,
    `玩家尚未调查的节点：${summarizeUnvisitedNodes(mysteryCase, knownNodes)}`,
    `你掌握的完整隐藏真相：\n${summarizeHiddenTruth(mysteryCase)}`,
    `历史上玩家明确求提示的次数：${previousHintCount}`,
    `本轮用户是否明确求提示：${explicitHintRequest ? "是" : "否"}`,
    `本轮用户是否直接索要答案：${directRevealRequest ? "是" : "否"}`,
    `当前是否已进入真相复盘阶段：${truthMode ? "是" : "否"}`,
    "规则：",
    "1. 始终用中文，语气像冷静的主持人或场外提示官。",
    ...(truthMode
      ? [
          "2. 既然已经进入真相复盘阶段，你可以直接解释真凶、动机、作案方法、关键时间线、为什么某条线索成立、为什么某个嫌疑人不是凶手。",
          "3. 回答时优先讲因果链，不要只复述摘要；如果用户问‘为什么’，就把中间推理桥梁补出来。",
          "4. 不要凭空补出案件数据里没有的新设定；若原案没写明，就明确说‘原案没有写死，只能按现有事实推到这里’。",
          "5. 回复保持 1 到 5 句，优先清楚、具体、能真正解答细节疑问。",
        ]
      : [
          "2. 如果玩家只是问背景设定、术语、公开信息、已发现线索怎么理解、或者玩法规则，就正常解释，不要附送额外剧透。",
          "3. 只有在玩家明确表示自己卡住了、想不出来、或者直接请求提示时，才给提示。",
          "4. 提示必须渐进式：第一次只给调查方向/关系角度/时间线角度；第二次可以缩小到 1 到 2 个角色或节点；第三次及以后可以指出更具体的矛盾点，但仍不要直接说出真凶、完整作案链路或全部隐藏关系。",
          "5. 如果玩家直接索要答案、真凶或完整解法，不要直接剧透；提醒他可以使用‘直接看答案’，或者让你继续给更强一点的提示。",
          "6. 即便你知道全部真相，也不要主动暴露未调查节点的完整 discovery 文本；提示时只能推进半步。",
          "7. 回复保持 1 到 4 句，优先简洁、可执行、可理解。",
        ]),
  ].join("\n");
}

export function buildHintMasterMessages(
  mysteryCase: MysteryCase,
  knownNodes: InvestigationNode[],
  history: DialogueHistoryMessage[],
  userInput: string,
  truthMode = false,
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildHintMasterSystemPrompt(mysteryCase, knownNodes, history, userInput, truthMode),
    },
  ];

  for (const message of history) {
    messages.push({
      role: message.role,
      content: message.content,
    });
  }

  messages.push({ role: "user", content: userInput });
  return messages;
}

export function streamHintMasterReply(
  gateway: OpenAiGateway,
  mysteryCase: MysteryCase,
  knownNodes: InvestigationNode[],
  history: DialogueHistoryMessage[],
  userInput: string,
  truthMode = false,
) {
  return gateway.streamChat(buildHintMasterMessages(mysteryCase, knownNodes, history, userInput, truthMode), 0.4);
}

export function generateHintMasterReply(
  gateway: OpenAiGateway,
  mysteryCase: MysteryCase,
  knownNodes: InvestigationNode[],
  history: DialogueHistoryMessage[],
  userInput: string,
  truthMode = false,
) {
  return gateway.chat(buildHintMasterMessages(mysteryCase, knownNodes, history, userInput, truthMode), 0.4);
}

export function buildHintMasterCharacter(): HintMasterCharacter {
  return {
    id: HINT_MASTER_ID,
    name: "提示官",
    publicPersona: "知道整桩案件真相，但平时只负责解释背景、梳理公开信息，并在你明确卡住时给渐进式提示。",
    relationshipToVictim: "不属于案内角色，是场外主持人与提示者。",
    whyRelevant: "你可以问他背景设定、已发现线索怎么理解、下一步该往哪查；如果你明确说自己卡住了，他会一点点推你，但不会直接剧透。",
    appearanceSummary: "像一个始终在场外观察全局的主持人，说话克制，不抢你的推理过程。",
  };
}
