import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type { InvestigationNode, MysteryCase, Npc, Suspect } from "../case/schema.js";
import type { StoredMessage } from "../session/store.js";
import type { OpenAiGateway } from "../llm/openai-gateway.js";

export type DialogueCharacter = Suspect | Npc;

function isSuspect(character: DialogueCharacter): character is Suspect {
  return "possibleMotive" in character;
}

function buildSystemPrompt(mysteryCase: MysteryCase, character: DialogueCharacter, knownNodes: InvestigationNode[]) {
  const suspect = isSuspect(character) ? character : null;
  const npc: Npc | null = suspect ? null : (character as Npc);
  const isCulprit = suspect ? mysteryCase.solution.culpritId === suspect.id : false;

  return [
    `你现在扮演案件角色：${character.name}`,
    `案件标题：${mysteryCase.title}`,
    `死者：${mysteryCase.victim.name}（${mysteryCase.victim.profile}）`,
    `你对外的人设：${character.publicPersona}`,
    `你与死者的关系：${character.relationshipToVictim}`,
    ...(suspect
      ? [
          `你可能的动机：${suspect.possibleMotive}`,
          `你的不在场说法：${suspect.alibi}`,
          `最容易让你露出破绽的追问点：${suspect.pressurePoint}`,
          `你是否真凶：${isCulprit ? "是，但绝不能直接自曝完整真相，除非被逼到很难圆谎时才允许有限松口。" : "不是。"}`,
        ]
      : [`你之所以和案件相关：${npc?.whyRelevant ?? "你掌握一些旁支但关键的信息。"}`, "你不是凶手候选，但你掌握的观察、偏见、回忆和顾虑会影响玩家理解案件。"]),
    `你的说话状态：${character.demeanor}`,
    `你的说话风格：${character.speakingStyle}`,
    `你明确知道的事实：${character.knows.join("；")}`,
    `你会隐瞒的事实：${character.hides.join("；")}`,
    `玩家当前已经掌握的调查结果：${knownNodes.length ? knownNodes.map((node) => `${node.title}：${node.discovery}`).join("；") : "暂无"}`,
    "规则：",
    "1. 始终用中文，保持角色状态，不要说自己是模型或系统。",
    "2. 可以回避、误导、辩解，但不能改写既有事实。",
    "3. 不要凭空新增关键证据、隐藏角色或超自然设定。",
    "4. 当玩家的问题触及你最不想被追问的点、已发现线索或你在 hides 中的秘密时，语气要明显更紧、更防御，必要时做有限松口，但不要突然全盘讲完。",
    "5. 回复保持 1 到 4 句，偏口语。",
  ].join("\n");
}

export function buildSuspectMessages(
  mysteryCase: MysteryCase,
  character: DialogueCharacter,
  knownNodes: InvestigationNode[],
  history: StoredMessage[],
  userInput: string,
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildSystemPrompt(mysteryCase, character, knownNodes),
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

export async function generateSuspectReply(
  gateway: OpenAiGateway,
  mysteryCase: MysteryCase,
  character: DialogueCharacter,
  knownNodes: InvestigationNode[],
  history: StoredMessage[],
  userInput: string,
) {
  return gateway.chat(buildSuspectMessages(mysteryCase, character, knownNodes, history, userInput), 0.8);
}

export function streamSuspectReply(
  gateway: OpenAiGateway,
  mysteryCase: MysteryCase,
  character: DialogueCharacter,
  knownNodes: InvestigationNode[],
  history: StoredMessage[],
  userInput: string,
) {
  return gateway.streamChat(buildSuspectMessages(mysteryCase, character, knownNodes, history, userInput), 0.8);
}
