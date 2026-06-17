import type { TemplateType } from "./schema.js";

export type CaseTemplate = {
  type: TemplateType;
  label: string;
  brief: string;
  suspectCountGuidance: string;
  complexityRules: string[];
};

export const CASE_TEMPLATES: CaseTemplate[] = [
  {
    type: "locked-room",
    label: "封闭场景谋杀",
    brief: "案发地处于相对封闭的别墅、旅馆或庄园，强调出入口限制、在场顺序与物理条件。",
    suspectCountGuidance: "优先 4 名嫌疑人，若故事天然更紧凑可降为 3 名。",
    complexityRules: [
      "必须有一道看似决定性的密室痕迹，但它其实是伪造或被误读的。",
      "至少两名嫌疑人的行动在案发窗口内彼此牵制，不能靠单条证词直接定案。",
      "真正破解点应同时依赖物理条件和人物关系，而不是只靠一个机关。",
    ],
  },
  {
    type: "alibi",
    label: "不在场证明案",
    brief: "重点是口供冲突、时间线错位和伪造的不在场证明。",
    suspectCountGuidance: "优先 4 名嫌疑人，保证至少 2 份口供相互牵制。",
    complexityRules: [
      "至少两份口供能互相证明局部事实，但整体时间线无法完全闭合。",
      "必须存在一条容易先怀疑到错误对象的时间线误导。",
      "真相需要玩家识别谁在替谁遮掩，而不是只抓单个说谎者。",
    ],
  },
  {
    type: "poison",
    label: "投毒案",
    brief: "围绕毒物来源、接触机会和延迟发作时间构建推理。",
    suspectCountGuidance: "可在 3 到 4 名嫌疑人之间选择，以故事复杂度为准。",
    complexityRules: [
      "毒物来源、下毒时机和死亡爆发时机必须分开，形成错位推理。",
      "至少一名非真凶嫌疑人要隐藏与毒物或药物有关的私人秘密，制造强误导。",
      "真相不能只是“谁碰过杯子”，而要包含接触机会、延迟发作和人物动机的组合。",
    ],
  },
  {
    type: "staged-suicide",
    label: "伪自杀案",
    brief: "表面看像自杀或意外身亡，但现场、死者状态和关系动机之间存在人为伪装。",
    suspectCountGuidance: "优先 4 名嫌疑人，保证至少 2 人知道死者近期精神、债务或药物相关隐情。",
    complexityRules: [
      "现场必须存在至少一条足以先把案件带向自杀或意外解释的强表象，但它最终会被推翻。",
      "至少 1 名非真凶嫌疑人要隐瞒死者近期精神状态、药物使用或遗书相关信息，制造额外误导。",
      "真相需要同时依赖伪装痕迹、人物关系和作案动机，不能只靠法医一句话直接翻案。",
    ],
  },
  {
    type: "inheritance",
    label: "遗产争夺案",
    brief: "围绕遗嘱、继承顺位、债务分配或股权去向展开，强调家族关系与利益绑定。",
    suspectCountGuidance: "优先 4 名嫌疑人，至少 2 人会因遗产分配变化直接受益或受损。",
    complexityRules: [
      "必须存在一份即将变更、被误读或被人拿来做筹码的遗嘱/继承安排。",
      "至少两名嫌疑人表面站在同一阵线，但他们想保住的利益并不相同。",
      "真相不能只是“谁最想分钱”，而要同时落到旧账、亲属关系或代持利益的隐藏牵连。",
    ],
  },
  {
    type: "body-relocation",
    label: "移尸案",
    brief: "尸体被移动、发现地点与真实作案地点不一致，强调时间线误差与现场二次布置。",
    suspectCountGuidance: "优先 4 名嫌疑人，保证至少 2 人的口供会被移尸造成的时空错位带偏。",
    complexityRules: [
      "尸体发现地点必须与实际致命行为发生地点不同，而且两处现场都要留下可误读的痕迹。",
      "至少一名嫌疑人的口供在“何时见到死者/尸体”上成立局部事实，但会把玩家先带到错误时点。",
      "破解点需要同时依赖移尸目的、搬运条件和人物关系压力，不能只是简单的拖痕比对。",
    ],
  },
  {
    type: "blackmail",
    label: "勒索灭口案",
    brief: "围绕录音、账本、照片或聊天记录等把柄展开，强调谁在勒索、谁在反制、谁在顺势借刀。",
    suspectCountGuidance: "优先 4 名嫌疑人，至少 2 人与把柄内容直接相关。",
    complexityRules: [
      "必须存在一份足以毁掉至少两个人的把柄，但不同人想拿到它的原因不一样。",
      "至少一名非真凶嫌疑人要主动销毁、转移或伪造部分把柄内容，制造强误导。",
      "真相不能只是“谁最怕曝光”，而要落到勒索链条、交易时点和现场行为的组合。",
    ],
  },
  {
    type: "cold-case",
    label: "旧案牵连案",
    brief: "当前命案与多年前的旧案、失踪、事故或未结纠纷有关，强调记忆偏差与旧账回潮。",
    suspectCountGuidance: "优先 4 名嫌疑人，至少 2 人和旧案有直接经历或被迫沉默。",
    complexityRules: [
      "旧案不能只是背景设定，必须直接影响当前命案中的动机、口供或证据解释。",
      "至少两名嫌疑人对旧案掌握不同版本的真相，且各自都在隐瞒关键一段。",
      "玩家最终需要同时还原旧案和新案之间的连接点，而不是把两件事割裂看待。",
    ],
  },
  {
    type: "identity-fraud",
    label: "身份伪装案",
    brief: "围绕假身份、冒名、双重履历或伪造关系展开，强调人物表层身份与真实来历的错位。",
    suspectCountGuidance: "优先 4 名嫌疑人，至少 1 人的身份信息存在明显伪装或缺口。",
    complexityRules: [
      "必须有一条能把玩家先带去怀疑‘外来者’或‘陌生身份’的误导线，但真相不能止步于揭穿假身份。",
      "至少一名非真凶嫌疑人也要在身份、履历或亲属关系上说谎，避免真凶过于突出。",
      "破解点需要结合身份伪装的目的、接近死者的方式和现实利益后果，而不是只看证件真假。",
    ],
  },
];

export function pickTemplate(preferredType?: TemplateType): CaseTemplate {
  if (preferredType) {
    const matched = CASE_TEMPLATES.find((template) => template.type === preferredType);
    if (!matched) {
      throw new Error(`未知模板类型: ${preferredType}`);
    }
    return matched;
  }

  const index = Math.floor(Math.random() * CASE_TEMPLATES.length);
  return CASE_TEMPLATES[index] ?? CASE_TEMPLATES[0];
}
