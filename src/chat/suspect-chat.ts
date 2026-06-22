import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type { InvestigationNode, MysteryCase, Npc, Suspect } from "../case/schema.js";
import type { OpenAiGateway } from "../llm/openai-gateway.js";

export type DialogueCharacter = Suspect | Npc;
export type DialogueHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

function isSuspect(character: DialogueCharacter): character is Suspect {
  return "possibleMotive" in character;
}

function summarizeSuspect(s: Suspect) {
  return `嫌疑人 ${s.name}：${s.publicPersona}，与死者关系：${s.relationshipToVictim}，表面动机：${s.possibleMotive}，对外声称的不在场说法：${s.alibi}`;
}

function summarizeNpc(n: Npc) {
  return `相关人物 ${n.name}：${n.publicPersona}，与死者关系：${n.relationshipToVictim}，为什么值得关注：${n.whyRelevant}`;
}

function summarizeAllCharacters(mysteryCase: MysteryCase, selfId: string) {
  const lines: string[] = [];
  for (const s of mysteryCase.suspects) {
    lines.push(`${s.id === selfId ? "（你自己）" : ""}${summarizeSuspect(s)}`);
  }
  for (const n of mysteryCase.npcs ?? []) {
    lines.push(`${n.id === selfId ? "（你自己）" : ""}${summarizeNpc(n)}`);
  }
  return lines.join("\n");
}

function findRelevantHiddenRelationships(mysteryCase: MysteryCase, characterName: string) {
  return mysteryCase.solution.hiddenRelationships
    .filter((r) => r.surface.includes(characterName) || r.hiddenTruth.includes(characterName))
    .map((r) => `表面：${r.surface} → 真相：${r.hiddenTruth}`);
}

function findRelevantContradictions(mysteryCase: MysteryCase, characterName: string) {
  return mysteryCase.solution.keyContradictions
    .filter((c) => c.summary.includes(characterName) || c.implication.includes(characterName))
    .map((c) => `${c.title}：${c.implication}`);
}

function buildCharacterAgenda(character: DialogueCharacter, suspect: Suspect | null, isCulprit: boolean): string[] {
  const hasSecrets = character.hides.length > 0;

  if (isCulprit && suspect) {
    return [
      "【你这场对话的目标与行为方式】",
      "首要目标：不被玩家锁定为真凶，撑住你的不在场说法，绝不暴露真实动机和作案手法。",
      `次要目标：把怀疑往别处引——可以利用你制造的误导，也可以把话题引向其他嫌疑人或看似更可疑的方向。`,
      `行为方式：表面配合调查、显得坦诚，但凡涉及「${suspect.pressurePoint}」就回避、转移或反问；被追到死角时只对无关痛痒的小细节有限松口，用来换取可信度，绝不交出核心真相。`,
      "心理状态：你心里清楚自己做了什么，越被逼近真相越紧张，但要努力维持表面镇定。",
    ];
  }

  if (suspect) {
    return [
      "【你这场对话的目标与行为方式】",
      hasSecrets
        ? "首要目标：你不是凶手，但你有不想被揭穿的秘密（见你会隐瞒的事实），所以你既想洗清杀人嫌疑，又要守住自己的秘密。"
        : "首要目标：你不是凶手，你想尽快洗清自己的嫌疑。",
      "行为方式：愿意提供能证明你清白的信息，但一旦话题逼近你隐瞒的秘密，就会含糊、回避或岔开。你不会主动陷害别人，但为了自保可以模糊处理对自己不利的事实。",
      `易动摇点：被追问到「${suspect.pressurePoint}」时，你会明显紧张、防御。`,
      "心理状态：清白但心虚——怕的不是杀人罪，而是别的秘密被牵出来。",
    ];
  }

  return [
    "【你这场对话的目标与行为方式】",
    "首要目标：你不是嫌疑人，你愿意配合，把你观察到的现场、人物关系、时间线或往事讲给玩家，帮他理解案情。",
    hasSecrets
      ? "但你也有自己的顾虑（见你会隐瞒的事实）：涉及这些时你会保留、含糊，或因为人情、立场而不愿多说。"
      : "你没有要隐瞒的大秘密，但你会按自己的立场、偏见和记忆来叙述，未必每件事都记得准。",
    "行为方式：你的话是重要线索来源，但带主观色彩。你可以表达对某些人的看法和怀疑，但只能基于你真实知道的事，不能编造。",
  ];
}

function buildSystemPrompt(mysteryCase: MysteryCase, character: DialogueCharacter, knownNodes: InvestigationNode[]) {
  const suspect = isSuspect(character) ? character : null;
  const npc: Npc | null = suspect ? null : (character as Npc);
  const isCulprit = suspect ? mysteryCase.solution.culpritId === suspect.id : false;
  const relevantHiddenRelationships = findRelevantHiddenRelationships(mysteryCase, character.name);
  const relevantContradictions = findRelevantContradictions(mysteryCase, character.name);

  const caseContext = [
    `【案件世界观】`,
    `案件标题：${mysteryCase.title}`,
    `开场叙述：${mysteryCase.openingNarration}`,
    `案件背景：${mysteryCase.publicSummary}`,
    `场景设定：${mysteryCase.storyContext.setting}`,
    `当前局面：${mysteryCase.storyContext.currentSituation}`,
    `事件导火索：${mysteryCase.storyContext.whyNow}`,
    `各方已知的紧张关系：${mysteryCase.storyContext.knownTensions.join("；")}`,
    `玩家目标：${mysteryCase.playerGoal}`,
    `死者：${mysteryCase.victim.name}（${mysteryCase.victim.profile}）`,
  ];

  const characterList = [
    `【案件全部人物】`,
    summarizeAllCharacters(mysteryCase, character.id),
  ];

  const selfIdentity = [
    `【你的身份与角色信息】`,
    `你现在扮演：${character.name}`,
    `你对外的人设：${character.publicPersona}`,
    `你与死者的关系：${character.relationshipToVictim}`,
    `你的说话状态：${character.demeanor}`,
    `你的说话风格：${character.speakingStyle}`,
  ];

  const selfKnowledge: string[] = [
    `【你掌握的内部信息】`,
    `你明确知道的事实：${character.knows.join("；")}`,
    `你会隐瞒的事实（不会主动说，被逼紧才有限松口）：${character.hides.join("；")}`,
  ];

  if (suspect) {
    selfKnowledge.push(
      `你可能的动机：${suspect.possibleMotive}`,
      `你的不在场说法：${suspect.alibi}`,
      `最容易让你露出破绽的追问方向：${suspect.pressurePoint}`,
    );
  } else {
    selfKnowledge.push(
      `你之所以和案件相关：${npc?.whyRelevant ?? "你掌握一些旁支但关键的信息。"}`,
      "你不是凶手候选，但你掌握的观察、偏见、回忆和顾虑会影响玩家对案件的理解。",
    );
  }

  if (relevantHiddenRelationships.length > 0) {
    selfKnowledge.push(`涉及你的隐藏关系（你自己知道但不会主动说）：${relevantHiddenRelationships.join("；")}`);
  }
  if (relevantContradictions.length > 0) {
    selfKnowledge.push(`涉及你的关键矛盾点（玩家可能追问到）：${relevantContradictions.join("；")}`);
  }

  const culpritBlock: string[] = [];
  if (isCulprit) {
    culpritBlock.push(
      `【真凶内部视角——绝对不能直接泄露】`,
      `你是本案真凶。`,
      `真实动机：${mysteryCase.solution.motive}`,
      `作案手法：${mysteryCase.solution.method}`,
      `你的作案计划步骤：${mysteryCase.solution.culpritPlan.join("→")}`,
      `真实时间线：${mysteryCase.solution.timeline.map((t) => `${t.time}：${t.event}`).join("→")}`,
      `你制造的误导：${mysteryCase.solution.redHerrings.join("；")}`,
      "你可以围绕上述事实进行回避、圆谎、反问，但绝不能直接自曝完整真相。只有被逼到很难圆谎时才允许对一个小细节有限松口。",
    );
  } else if (suspect) {
    culpritBlock.push("你不是真凶。");
  }

  const knownNodeIds = new Set(knownNodes.map((n) => n.id));
  const caseWorld = [
    `【案件现场与可调查地点】`,
    ...mysteryCase.investigationNodes.map((node) => {
      const visited = knownNodeIds.has(node.id);
      return visited
        ? `${node.title}（${node.category}）——玩家已调查，发现：${node.discovery}`
        : `${node.title}（${node.category}）——玩家尚未调查`;
    }),
  ];

  const playerState = [
    `【当前博弈态势】`,
    `玩家已调查 ${knownNodes.length}/${mysteryCase.investigationNodes.length} 个节点。`,
    ...(knownNodes.length ? [`已调查结果：${knownNodes.map((node) => `${node.title}：${node.discovery}`).join("；")}`] : ["玩家目前还没有调查任何节点。"]),
  ];

  const agenda = buildCharacterAgenda(character, suspect, isCulprit);

  const rules = [
    "【回复规则】",
    "1. 始终用中文，保持角色身份和说话风格，不要说自己是 AI 或系统。",
    "2. 可以回避、误导、辩解，但不能改写案件中的既有事实。",
    "3. 绝对不能凭空编造案件中不存在的人物、地点、证据或超自然设定。你只能提及案件人物列表中的角色和案件世界观中的地点。",
    "4. 当玩家的问题触及你的隐瞒事实、矛盾点或破绽方向时，语气要明显更紧张、更防御，必要时做有限松口，但不要一次全盘讲完。",
    "5. 回复保持 1 到 4 句，偏口语，贴合你的说话风格。",
  ];

  const blocks = [caseContext, characterList, caseWorld, selfIdentity, selfKnowledge, culpritBlock, agenda, playerState, rules];

  return blocks
    .filter((block) => block.length > 0)
    .map((block) => block.join("\n"))
    .join("\n\n");
}

function buildConfrontationDirective(confrontNode: InvestigationNode): string {
  return [
    "【玩家正拿出一条已经查实的线索与你正面对质】",
    `线索「${confrontNode.title}」：${confrontNode.discovery}`,
    "你必须正面回应这条具体证据，不能假装不知道这条线索存在，也不能岔开话题装糊涂。",
    "如果它戳中你的隐瞒、动机或破绽：先本能地紧张、辩解、找借口，被逼到死角时才对一个细节有限松口。",
    "如果它和你关系不大：你可以顺势把矛头引向别人，或指出它其实更像在说别人。",
    "但绝不能否认这条线索本身客观存在，也不能改写案件里的既有事实。",
  ].join("\n");
}

export function buildSuspectMessages(
  mysteryCase: MysteryCase,
  character: DialogueCharacter,
  knownNodes: InvestigationNode[],
  history: DialogueHistoryMessage[],
  userInput: string,
  confrontNode?: InvestigationNode,
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

  if (confrontNode) {
    messages.push({ role: "system", content: buildConfrontationDirective(confrontNode) });
  }

  messages.push({ role: "user", content: userInput });
  return messages;
}

export async function generateSuspectReply(
  gateway: OpenAiGateway,
  mysteryCase: MysteryCase,
  character: DialogueCharacter,
  knownNodes: InvestigationNode[],
  history: DialogueHistoryMessage[],
  userInput: string,
  confrontNode?: InvestigationNode,
) {
  return gateway.chat(buildSuspectMessages(mysteryCase, character, knownNodes, history, userInput, confrontNode), 0.8);
}

export function streamSuspectReply(
  gateway: OpenAiGateway,
  mysteryCase: MysteryCase,
  character: DialogueCharacter,
  knownNodes: InvestigationNode[],
  history: DialogueHistoryMessage[],
  userInput: string,
  confrontNode?: InvestigationNode,
) {
  return gateway.streamChat(buildSuspectMessages(mysteryCase, character, knownNodes, history, userInput, confrontNode), 0.8);
}
