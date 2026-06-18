# 悬疑推理游戏框架 规划记录

**目标：** 交付一个可接入 OpenAI-compatible 模型、能生成结构化案件并在 CLI 中完成调查 / 嫌疑人对话 / 指认真凶的首版悬疑推理游戏框架。
**需求来源：** 对话需求（brainstorm 收敛后转正式 plan）

## 计划

### 目标

- 做一个本地可运行的悬疑推理游戏框架，而不是先做网页产品或内容后台。
- 首版先完成“案件生成框架 + 单案试玩闭环”，验证这套玩法是否成立。
- 玩家需要能真正使用大模型能力与多个嫌疑人对话，而不是只看静态文本。
- 首个验收物不是“引擎演示”，而是一桩可试玩、可结案、可复盘的单案。

### 产品形态

- 产品形态：本地 CLI 文本游戏。
- 模型接入：统一 OpenAI-compatible 接口，至少支持 `baseURL / apiKey / model`。
- 游戏主流程：
  1. 配置模型接口
  2. 生成结构化案件包
  3. 进入单案试玩
  4. 玩家查看案件简介
  5. 玩家从菜单中调查固定节点
  6. 玩家与多个嫌疑人自由聊天
  7. 玩家提交凶手指认结案
  8. 系统给出判定与真相还原
- 存储形态：SQLite 作为本地持久化容器，案件包整体以 JSON 快照保存，并补充会话状态 / 聊天记录 / 元数据；默认自动保存历史，并可恢复最近一局。

### 范围与不做

首版范围：

- Node.js + TypeScript 新项目
- 本地 CLI 交互
- 单模型跑完整流程（案件生成、嫌疑人对话、结案判定）
- 结构化案件包生成
- 菜单式主动调查
- 受控式嫌疑人对话
- 无回合限制
- 结案时只要求指认真凶
- SQLite + JSON 快照存储
- 少量模板案型
- 基础自动化测试 + 手工试玩验证

首版明确不做：

- 网页 UI / App
- 发布 / 部署 / 分发流程
- 多模型路由或多供应商策略预设
- 完全自由调查输入
- 线索逐步解锁机制
- 回合限制、评分系统、排行榜
- 多案件管理后台
- 会改写真相的高自由 NPC

### 关键决定

- **整体路线先 B 后 A**：先做案件生成框架，再用它生成一个可玩的单案作为首个验收样本。
- **首版是 CLI，不先上网页**：空仓库阶段优先验证玩法闭环，避免前端成本淹没核心玩法。
- **采用结构化核心方案**：先生成稳定的案件事实层，再在此基础上提供调查与聊天能力，避免剧情、口供、线索互相打架。
- **模板集合首版固定为经典三件套**：封闭场景谋杀、不在场证明案、投毒案，先固定集合，不做模板可配置。
- **嫌疑人对话是核心功能，但必须受控**：嫌疑人可以隐瞒、误导，但不能改写真相，也不能凭空新增核心事实。
- **嫌疑人数由故事复杂度决定**：不做成玩家配置，生成器在内部受控范围内按案件内容决定人数。
- **调查保留，但先收敛成菜单式**：把大模型能力主要用在角色对话，不把首版调查交互做成开放世界解释器。
- **线索节点首版全部可见**：先验证案件质量和推理闭环，不引入解锁状态机。
- **首版结案只要求指认嫌疑人**：先把完整游玩闭环跑通，证据提交与推理阐述后续再考虑增强。
- **存储采用 SQLite + JSON 快照**：为后续多局历史、恢复进度、聊天记录打基础，同时避免首版过早拆复杂表结构。
- **配置和存档先按默认值收口**：模型配置通过 `.env` 读取；SQLite 自动保存案件与会话历史；默认支持恢复最近一局；结案提交后直接展示完整真相还原。
- **案型先限制为少量模板**：比完全自由生成更稳，也比只做单一模板更接近真正框架。
- **技术栈采用 Node.js + TypeScript**：更适合空仓库 CLI、JSON Schema、SQLite 和后续潜在前端延展。

### 关键假设

- API key 不写入仓库；首版优先通过 `.env` 读取模型配置。
- 运行环境按本地 Node.js LTS 使用，具体版本默认按当前稳定 LTS 处理。
- OpenAI-compatible 供应商能够接受自定义 `baseURL` 并稳定返回文本 / 结构化输出。
- 首版允许通过 prompt + schema 校验的方式约束模型产出，而不要求一开始就做复杂纠错链路。
- 嫌疑人数虽由故事决定，但实现时仍需要给生成器一个受控上下界，避免对话量和线索量失控。
- 首版主要面向中文体验，CLI 交互默认使用中文文案。

### 未决问题

- 生成器内部用于决定嫌疑人数的规则还需实现时固化，例如按模板 / 关系复杂度 / 线索数量决定。
- 默认恢复最近一局的 CLI 入口表现还需在实现时确定，是启动即提示恢复，还是通过主菜单选择恢复。

### 下一步

- 将经典三件套分别落成模板约束，并补足生成器内部的人数分配规则。
- 细化案件包 schema、会话存储字段与“最近一局恢复”交互。
- 基于本计划进入实现时，优先按“项目骨架 → schema 与存储 → 案件生成 → CLI 调查 / 对话 → 指认判定 → 测试与试玩案例”推进。

### 更新日志

- 2026-06-17 01:34：基于本轮 brainstorming 结论创建正式计划，确认首版形态为 Node.js + TypeScript 的本地 CLI 悬疑推理游戏框架；采用统一 OpenAI-compatible 接口、单模型、结构化案件包、SQLite + JSON 快照、受控嫌疑人对话、菜单式调查、无回合限制、结案需提交凶手与证据，并将案型收敛为少量模板。
- 2026-06-17 01:40：继续收紧计划边界，确认模板集合固定为经典三件套（封闭场景谋杀 / 不在场证明案 / 投毒案）；嫌疑人数改为由故事复杂度决定、不做玩家配置；首版结案流程降为只需指认嫌疑人；并接受默认技术边界：模型配置走 `.env`、SQLite 自动保存历史、默认可恢复最近一局、结案后直接展示真相还原。

### 技术上下文

- 仓库现状：空仓库，当前仅有 `.opencode/` 工具配置，无现成业务代码。
- 项目类型：新项目。
- 目标平台：本地 CLI。
- 语言 / 运行时：Node.js + TypeScript。
- 模型接入：统一 OpenAI-compatible 层。
- 持久化：SQLite + JSON 快照。
- 测试要求：首版需要基础自动化测试，但暂不做部署 / 发布。

### 技术选型

- **LLM SDK**：优先使用官方 OpenAI Node SDK，通过自定义 `baseURL` 兼容 OpenAI-compatible 服务。
- **结构校验**：建议使用 schema 校验库约束案件包与模型输出，优先考虑 Zod 一类轻量方案。
- **SQLite 驱动**：优先考虑适合本地 CLI 的轻量实现，首选同步使用体验更直接的方案。
- **CLI 交互**：优先选择轻量命令行提示库，不预设复杂 TUI。
- **配置加载**：优先走 `.env`，避免首版额外设计复杂本地配置格式。
- **测试框架**：优先采用适合 TypeScript 项目的轻量测试工具，覆盖 schema、存储、核心流程与基础冒烟用例。

### 结构与落点

- `src/config/`：模型配置加载、环境变量读取、配置校验。
- `src/llm/`：OpenAI-compatible client、调用封装、结构化输出适配。
- `src/case/`：案件 schema、模板定义、案件生成器、生成结果校验。
- `src/session/`：SQLite 持久化、案件快照存储、会话状态、聊天记录。
- `src/chat/`：嫌疑人角色卡、对话上下文拼装、受控对话守卫。
- `src/investigation/`：调查节点定义、菜单展示、调查结果读取。
- `src/judgement/`：嫌疑人指认、判定结果、真相还原。
- `src/cli/`：入口命令、主循环、交互编排。
- `tests/`：schema、存储、生成流程、结案流程、CLI 冒烟测试。

### 任务拆解

#### 任务 1：初始化 CLI 项目骨架

- 目标：建立可运行的 Node.js + TypeScript CLI 基础工程。
- 涉及：仓库根目录、`package.json`、TypeScript 配置、`src/cli/`、测试基础设施。
- 动作：初始化运行脚本、开发脚本、测试脚本与最小 CLI 入口，明确模型配置加载方式。
- 验证：能够本地启动 CLI 占位入口，并能跑通基础测试命令。
- 完成标志：仓库具备稳定的开发 / 测试入口，后续模块可按目录继续落地。

- 步骤 1：建立项目基础依赖与 TypeScript 配置。
- 步骤 2：建立 CLI 入口与配置读取占位逻辑。
- 步骤 3：建立测试运行骨架。

#### 任务 2：定义案件包与存储模型

- 目标：把“结构化核心”落成明确 schema 与 SQLite 存储边界。
- 涉及：`src/case/`、`src/session/`。
- 动作：定义案件包 JSON 结构、会话状态字段、聊天记录存储方式、最近一局恢复约定和 SQLite 表最小集合。
- 验证：能对样例案件包完成结构校验，并能写入 / 读出 SQLite。
- 完成标志：案件快照、会话状态、聊天记录都有稳定数据结构，不再靠口头约定。

- 步骤 1：定义案件包 schema。
- 步骤 2：定义 SQLite 表与 JSON 快照存储方式。
- 步骤 3：补充最近一局恢复约定，以及 schema 与持久化测试。

#### 任务 3：实现案件生成链路

- 目标：从模型生成一份可用于试玩的完整案件包。
- 涉及：`src/llm/`、`src/case/`。
- 动作：实现模板驱动的案件生成、生成结果校验、失败重试或失败提示。
- 验证：至少能稳定生成一份包含真相、嫌疑人、线索、调查节点和揭晓文本的合格案件包。
- 完成标志：生成结果可以直接被后续 CLI 游戏循环消费。

- 步骤 1：设计模板输入与生成 prompt 结构。
- 步骤 2：实现模型调用与结构化解析。
- 步骤 3：对生成结果做一致性校验。

#### 任务 4：实现调查与嫌疑人对话循环

- 目标：让玩家在 CLI 中调查并与多个嫌疑人聊天，同时保证案情不被聊崩。
- 涉及：`src/chat/`、`src/investigation/`、`src/cli/`、`src/session/`。
- 动作：实现菜单调查、嫌疑人选择、聊天记录写入、角色卡驱动的受控对话。
- 验证：玩家可在单局内查看多个调查节点，并与至少两个嫌疑人连续对话且不出现明显核心事实冲突。
- 完成标志：CLI 已具备完整的中段游玩能力。

- 步骤 1：实现调查菜单与调查结果展示。
- 步骤 2：实现嫌疑人聊天入口与会话记录。
- 步骤 3：实现对话守卫，限制模型越权泄露或改写真相。

#### 任务 5：实现结案判定与试玩验收

- 目标：闭合“指认真凶 + 判定结果 + 还原真相”的最终体验。
- 涉及：`src/judgement/`、`src/cli/`、`tests/`。
- 动作：实现嫌疑人指认、判定结果输出，并生成首个可试玩案例做完整验证。
- 验证：能完整试玩一局，完成调查、聊天、指认、判定与真相揭晓；自动化测试覆盖核心路径。
- 完成标志：框架已能稳定产出并支撑至少一桩可试玩单案。

- 步骤 1：实现嫌疑人指认输入结构与判定逻辑。
- 步骤 2：生成首个试玩案例并走通全流程。
- 步骤 3：补齐核心自动化测试与手工试玩记录。

### 验证方式

- 自动化验证：
  - 案件包 schema 校验测试
  - SQLite 写入 / 读取测试
  - 最近一局恢复测试
  - 案件生成结果完整性测试
  - 结案判定测试
  - CLI 最小冒烟测试
- 手工验证：
  - 通过 `.env` 配置一个 OpenAI-compatible 模型
  - 成功生成一桩案件
  - 在 CLI 中完成至少一次调查
  - 与多个嫌疑人完成多轮对话
  - 提交凶手指认并获得判定与真相还原
- 通过标准：首版不以部署为目标，以“本地可运行、可生成、可试玩、可结案、核心流程可复现”为准。

### 风险

- 模型结构化输出不稳定，可能导致案件包字段缺失或互相矛盾。
- 嫌疑人聊天若上下文拼装不当，容易泄露真相或出现前后口供冲突。
- 少量模板如果边界太松，仍可能把首版做成“伪自由生成”，增加调试成本。
- 单模型跑全流程实现简单，但可能在成本、延迟和输出稳定性上存在取舍。

### 成功标准

- 可以通过统一 OpenAI-compatible 配置成功接入至少一个模型服务。
- 可以稳定生成符合 schema 的结构化案件包，并保存到 SQLite。
- 玩家可以在 CLI 中完成调查、与嫌疑人对话、指认真凶，并看到真相还原。
- 首个试玩案例能体现“大模型 + 推理游戏”的差异化体验，而不是普通聊天脚本。

## 实现

### 更新日志

- 2026-06-17 11:34：完成首版 Node.js + TypeScript CLI 骨架与可玩闭环实现。新增 `package.json`、`tsconfig.json`、`.gitignore`、`.env.example` 建立项目基础；新增 `src/config/runtime-config.ts` 支持优先读取 `.env / process.env`，并在未显式配置时回退到 `OPENCODE_CONFIG_CONTENT` 中的 OpenAI-compatible `baseURL / apiKey / headers / model`；新增 `src/llm/openai-gateway.ts` 封装模型调用、JSON 生成、429 自动重试与截断/校验失败重试；新增 `src/case/schema.ts`、`src/case/templates.ts`、`src/case/generator.ts` 落地经典三件套模板、结构化案件 schema 与案件生成；新增 `src/session/store.ts` 实现 SQLite + JSON 快照、聊天记录与最近一局恢复；新增 `src/chat/suspect-chat.ts` 实现受控嫌疑人对话；新增 `src/judgement/judge.ts` 实现指认判定；新增 `src/cli/run.ts` 和 `src/index.ts` 串起调查 / 对话 / 指认 CLI 主循环，并补了输入流关闭时的优雅退出；新增 `tests/config.test.ts`、`tests/schema.test.ts`、`tests/session-store.test.ts`、`tests/judge.test.ts`、`tests/openai-gateway.test.ts` 与 `tests/fixtures/sample-case.ts` 覆盖配置、schema、存储、判定与 429 重试。自测执行：`npm run build`、`npm test`、`printf '5\n' | env DATABASE_PATH=... node dist/src/index.js`、以及通过 `pexpect` 跑了一轮真实 CLI 试玩（生成案件 -> 调查首个节点 -> 与首个嫌疑人对话 -> 指认并查看真相还原）。结果：编译通过，8 条测试通过，真实模型链路可生成有效案件，对话与结案闭环可跑通。当前剩余风险：案件质量仍依赖模型输出与 prompt 约束，虽然已补 schema 容错和重试，但复杂案例的一致性仍需要后续继续打磨；目前仅对 429 做了自动重试，其他上游错误仍按失败返回。
- 2026-06-17 11:36：补齐 429 重试的 `retry-after-ms` / `retry-after` 解析细节，避免把毫秒级退避误判成秒级等待；随后重新执行 `npm run build` 与 `npm test`，结果仍然全部通过（5 个测试文件、8 条测试）。
- 2026-06-17 13:06：继续按“玩法更复杂、剧本不要太简单”的方向打磨案件生成与 CLI 承接。修改 `src/case/templates.ts` 为三类模板补充复杂度规则；修改 `src/case/schema.ts` 扩展更复杂案件结构，新增 `pressurePoint`、`contradictionIds`、`culpritPlan`、`redHerrings`、`keyContradictions`、`hiddenRelationships`，并加强类别归一化；修改 `src/case/generator.ts` 强化生成约束，要求优先 4 名嫌疑人、至少 5 个调查节点、包含误导点/关键矛盾/隐藏关系，并为复杂案件放宽生成 token 上限；修改 `src/chat/suspect-chat.ts` 让嫌疑人在被追问压力点时更容易表现出防御和有限松口；修改 `src/judgement/judge.ts` 与 `src/cli/run.ts`，在 CLI 中补充嫌疑人档案、已知线索记录、相关疑点展示，以及结案后的作案链路 / 关键矛盾 / 误导点 / 隐藏关系复盘；同步更新 `tests/fixtures/sample-case.ts`、`tests/schema.test.ts`、`tests/judge.test.ts`。本轮验证：重新执行 `npm run build`、`npm test`；使用真实模型生成复杂案件并检查产出字段（示例包含 4 名嫌疑人、6 个调查节点、3 条误导、3 条关键矛盾、2 组隐藏关系）；再通过 `pexpect` 跑了一轮新的复杂案件试玩（查看调查节点 -> 查看已知线索 -> 与嫌疑人对话 -> 保存退出），确认剧本层次明显提升，线索记录里能看到“相关疑点”，嫌疑人口供也更像在防守自己的秘密。当前剩余风险：复杂案件生成成本和耗时上升，偶发情况下仍可能受模型波动影响，需要后续继续观察不同模板下的稳定性。
- 2026-06-17 14:28：继续围绕“质量不稳定”和“可随时重玩”打磨生成链路。新增 `src/case/quality.ts` 作为确定性复杂度门禁，并新增 `src/case/reviewer.ts` 让第二个大模型对案件做结构化评分（复杂度/公平性/调查价值/对话张力等），生成器 `src/case/generator.ts` 改为“确定性门禁 + 大模型评审 + 失败反馈回灌”的双层回路；新增 `src/config/ai-presets.ts` 与 `src/config/runtime-config.ts` 的 role-based preset 支持，使案件生成 / 评审默认切到更快的 `deepseek-v4-pro`，并允许从 `/Users/bytedance/self/holdem/config/ai-presets.yaml` 读取外部模型预设；修正 `src/llm/openai-gateway.ts` 的 preset `max_tokens` 逻辑，避免把高 token 请求误压成 512；新增 `src/archive/story-archive.ts` 实现合格案件归档，`src/cli/run.ts` 增加“从归档案件开始”入口，`src/harness/case-harness.ts` 支持批量生成、实时写报告、记录归档路径与模型信息；同步补充 `tests/case-quality.test.ts`、`tests/case-reviewer.test.ts`、`tests/case-generator.test.ts`、`tests/archive.test.ts`、`tests/ai-presets.test.ts`。本轮 fresh evidence：`npm run build`、`npm test`（现为 10 个测试文件、16 条测试全部通过）；真实 harness 用 fast preset 跑通 1 局，生成模型与评审模型均为 `deepseek-v4-pro`，成功产出并归档《迟到的茶香》，评分 83，耗时约 193 秒，报告落盘到 `/var/folders/5j/qh0z08fj3r9f86g_2tb6x9hm0000gn/T/opencode/mystery-harness-report-fast.json`；随后又用 `pexpect` 验证归档案件可在 CLI 中重新载入并进入可玩流程。当前已确认：合格故事会被记录到 `data/approved-cases/`，并可随时从归档菜单重新开始游玩。剩余风险：单局高复杂度案件即使用 fast 模型仍有约 3 分钟级耗时，后续还需继续压缩生成成本和优化多局 harness 吞吐。
- 2026-06-17 14:37：修正配置边界错误，移除仓库对外部项目 preset 文件的隐式依赖。更新 `src/config/ai-presets.ts` 与 `src/config/runtime-config.ts`，改为只有在用户显式提供 `AI_PRESET_PATH` 和对应 preset id 时才读取 preset；不再默认尝试使用仓库外路径，也不再自动抢占本项目 `.env` / 显式环境变量 / opencode 配置的优先级。同步更新 `README.md`、`AGENTS.md`、`.env.example`，删除对外部绝对路径的默认引用，并新增 `config/ai-presets.example.yaml` 作为本仓库内的结构示例；补充 `tests/ai-presets.test.ts` 覆盖“未显式提供路径时不隐式读取 preset”场景。fresh evidence：重新执行 `npm run build`、`npm test`（现为 10 个测试文件、17 条测试全部通过），并执行 `printf '4\n' | node dist/src/index.js` 验证当前环境下 CLI 可正常启动和退出。当前仓库已恢复为：默认不依赖其他项目配置，preset 支持仅为显式 opt-in 能力。
- 2026-06-17 14:56：新增浏览器版可玩界面并接入 NPC 流式回复。修改 `package.json` 增加 `npm run web` 与 `@inquirer/prompts` 依赖；扩展 `src/llm/openai-gateway.ts` 增加 `streamChat`；修改 `src/chat/suspect-chat.ts` 抽出 `buildSuspectMessages` 并新增 `streamSuspectReply`；新增 `src/web/server.ts` 实现本地 Web 服务、案件生成、归档加载、调查、聊天流式接口与指认判定接口；新增 `src/web/static/index.html`、`src/web/static/app.js`、`src/web/static/styles.css`，提供浏览器侧可点击的调查/嫌疑人/归档界面和流式聊天显示；同步更新 `README.md` 与 `AGENTS.md`，补充 Web 入口、浏览器玩法和 `src/web/` 模块说明。fresh evidence：执行 `npm install`、`npm run build`、`npm test`（维持 10 个测试文件、17 条测试全部通过）；再通过后台启动 `npm run web` 做 smoke check，验证首页和 `/api/bootstrap` 接口可用；随后又实际调用 Web 版“从归档案件开始”与聊天接口，成功载入归档案件《迟到的茶香》，并收到嫌疑人文本回复，证明 Web 版主链路已跑通。当前剩余风险：浏览器版已经比 CLI 好用很多，但案件生成本身仍然耗时较长，后续还应继续优化生成等待体验和前端状态反馈。
- 2026-06-17 15:05：按用户要求把 Web 默认端口从 3000 调整为 3001，并在 `src/web/server.ts` 增加端口占用时报错提示；同步更新 `README.md` 与 `.env.example` 的端口说明。随后执行 `npm run build`、`npm test`（保持 10 个测试文件、17 条测试通过），并以 `WEB_PORT=30001` 后台启动 Web 服务做 fresh smoke：成功访问首页和 `/api/bootstrap`，确认页面可用、模型信息可见、已有归档案件可枚举。当前还额外保留了用户要求的 30001 端口运行实例，便于直接在浏览器打开查看。
- 2026-06-17 15:46：继续提升代入感与前端可读性。扩展 `src/case/schema.ts` 与 `src/case/generator.ts`，新增 `storyContext`、`sceneVisualSummary`、`sceneSvg`、`npcs`、人物 `appearanceSummary/avatarSvg`、线索 `visualHint/visualSvg` 等字段；新增 `src/case/visuals.ts`，根据案件内容自动生成案发场景、人物头像、线索卡片的 SVG，并在 schema 归一化阶段直接写入案件 payload，因此会随案件一起存进 SQLite 和归档；修改 `src/case/quality.ts` 与 `src/case/reviewer.ts`，把背景完整度、NPC 对话价值、视觉提示等纳入质量门禁和模型评审；修改 `src/chat/suspect-chat.ts` 把“嫌疑人对话”扩成“案件角色对话”，使 NPC 也可通过聊天提供线索；修改 `src/session/store.ts` 与 `src/archive/story-archive.ts`，读取旧案件时也会自动补全新结构与 SVG；修改 `src/web/server.ts`，不再向前端暴露 `pressurePoint`，并把背景、场景图、人物头像、线索图、NPC 一并序列化；大幅调整 `src/web/static/app.js` 与 `src/web/static/styles.css`，重构首页和游戏页布局，增加英雄区、背景说明、人物卡、线索缩略图与更完整的视觉层次。fresh evidence：执行 `npm run build`、`npm test`（保持 10 个测试文件、17 条测试全部通过）；重新启动 30001 端口 Web 服务并 smoke check 首页与 `/api/bootstrap` 成功。当前状态：前端已不再默认泄露“可攻破点”，背景信息更完整，嫌疑人之外的 NPC 也被纳入可对话角色，且每个案件现在都会自动带上可落库的 SVG 资源。剩余风险：当前 SVG 仍以程序化生成优先，尚未进一步引入额外模型专门生成高保真视觉图；若后续继续追求更强美术感，可在现有结构上再加模型驱动的 SVG 精修链路。
- 2026-06-17 15:56：继续把“现场图不要乱生成、要看得出谁在什么位置”落到结构化视觉层。扩展 `src/case/schema.ts` 新增 `sceneIllustration` 与 `clueIllustration`，要求案件可描述案发现场中的人物位置、物件位置、线索构图；修改 `src/case/generator.ts` 补充 scene/clue illustration 的生成约束；修改 `src/case/quality.ts` 把“现场构图深度”“线索构图深度”纳入门禁；重写 `src/case/visuals.ts` 的场景图和线索图逻辑，从抽象卡片改为基于结构化位置数据的现场布局图 / 线索构图图；补充 `tests/fixtures/sample-case.ts` 的 scene/clue illustration 样例，并保证旧案件通过归一化自动补齐新字段；同时继续调整 `src/web/static/app.js` 与 `src/web/static/styles.css`，让角色按钮带头像缩略图、线索按钮带线索缩略图、主面板带更明确的案件背景区。fresh evidence：重新执行 `npm run build`、`npm test`（仍为 10 个测试文件、17 条测试全部通过），并再次重启 30001 端口 Web 服务做 smoke check 成功。当前状态：场景和线索 SVG 已从“抽象装饰图”升级为“围绕具体人物 / 物件 / 痕迹位置关系”的结构化图层；仍可继续做的方向是让模型直接参与更高保真的 SVG 精修，而不仅是先给布局数据再程序化渲染。
- 2026-06-17 16:07：继续按用户反馈压缩 SVG 内文字并补充放大交互。修改 `src/case/visuals.ts`，移除场景图与线索图中的大段说明文字，只保留少量位置标签，避免文本溢出与遮挡；同时保留“谁在什么位置、关键物件在哪”的结构化表达。修改 `src/web/static/app.js` 与 `src/web/static/styles.css`，为场景图 / 线索图 / 头像图加入双击放大的 lightbox 交互与更明确的缩略图按钮表现。补充 `README.md` 的 Web 说明，明确浏览器版支持 NPC、SVG 展示和双击放大。fresh evidence：重新执行 `npm run build`、`npm test`（仍为 10 个测试文件、17 条测试全部通过），并重启 30001 端口 Web 服务；随后实际调用 `/api/session/from-archive` 验证旧归档案件也能被归一化为带 scene/clue SVG 与头像资源的结构。当前状态：SVG 不再塞入大段文字，双击即可放大查看；旧归档案件在新 UI 下也不会因为缺少新字段而直接崩。剩余风险：当前已归档的旧案件因为生成时尚未加入 NPC，要重新生成的新案件才会带完整 NPC 结构；如果接下来继续追求“更像插画”，需要进一步提升视觉模板或引入专门的 SVG 精修生成链路。
- 2026-06-17 16:29：补上用户明确要求的“直接看答案”入口。修改 `src/judgement/judge.ts` 新增 `revealSolution`，修改 `src/web/server.ts` 新增 `/api/session/:id/reveal` 接口，允许不经过指认直接查看完整答案；修改 `src/web/static/app.js`，在案件背景页、调查节点页和人物页都加入“直接看答案”按钮，并支持从开始页恢复最近一局后直接揭晓答案。fresh evidence：执行 `npm run build`、`npm test`（现为 10 个测试文件、18 条测试通过），随后在 30001 端口启动最新 Web 服务并实际调用 `/api/session/:id/reveal`，成功返回“已直接查看答案，真凶是 马骏。”。当前状态：Web 端已经有明确的答案捷径，不需要再绕过指认流程。
- 2026-06-17 16:43：按用户反馈移除首页主标题里的口号式文案，把 Web 首页主标题改为更直接的“中文悬疑推理游戏”，并把说明文案改成更克制的功能描述。fresh evidence：执行 `npm run build`、`npm test`（仍为 10 个测试文件、18 条测试通过），随后重启 30001 端口 Web 服务并确认新的 `app.js` 已对外提供更新后的标题字符串。当前状态：页面已经去掉之前那句不合适的自嗨标题；如浏览器仍显示旧文案，需要强刷缓存。
- 2026-06-17 17:35：继续优化“生成新案件”时的等待体验。修改 `src/case/generator.ts`，在原有失败重试基础上加入进度回调，并将失败后的处理改成“优先修订当前案件而不是直接整局重生”；同时把 Web 可玩模式的 prompt 收敛为 `playable` 模式，减少不必要的线索视觉细节输出。修改 `src/web/server.ts`，把 `/api/session/new` 改成后台任务模式，新增 `/api/generation-jobs/:id` 用于轮询生成进度；修改 `src/web/static/app.js`，前端点击“生成新案件”后会立即拿到 jobId，并持续展示当前处于“初稿生成 / 结构检查 / 模型评审 / 修订中 / 收尾中”的进度文本，而不是整页无响应。fresh evidence：重新执行 `npm run build`、`npm test`（仍为 10 个测试文件、18 条测试通过）；在 30001 Web 服务上实际调用 `/api/session/new`，0.02 秒内返回 `jobId`，2 秒后轮询 `/api/generation-jobs/:id` 已能拿到“正在生成案件初稿（第 1/2 轮）...”的实时进度消息。当前状态：生成新案件时已经能看到明确的阶段进度，不再是完全无反馈；剩余问题是单局生成总体耗时仍偏长，下一步还需继续拆阶段和压缩首轮生成体量。
- 2026-06-17 17:51：修正“离开首页后回来看不到生成提示”的 Web 进度恢复缺口。修改 `src/web/server.ts`，让 `/api/bootstrap` 返回当前仍在运行的 generation job 摘要，并让 `/api/session/new` 在已有后台生成任务时直接复用现有 `jobId`，避免用户因为提示丢失而重复起多个慢任务；修改 `src/web/static/app.js`，启动页现在会展示“当前正在生成新案件”提示，返回首页或刷新后会自动重新接入该 `jobId` 的轮询，并在任务完成后继续进入新局；同步更新 `README.md`，补充 Web 版会在刷新 / 返回首页后自动恢复生成进度的说明，并把 Web 视觉说明改回当前真实状态（场景 + 人物 SVG）。fresh evidence：执行 `npm run build`、`npm test`（仍为 10 个测试文件、18 条测试全部通过）；在 `WEB_PORT=30002` 的临时 Web 服务上实际调用 `/api/session/new` 后立即请求 `/api/bootstrap`，确认返回的 `activeGenerationJob.id` 与新 job 一致，且进度文案为“正在生成案件初稿（第 1/2 轮）...”；另用 Node 模拟浏览器执行 `src/web/static/app.js`，验证页面启动拿到 `activeGenerationJob` 后会自动继续轮询 `/api/generation-jobs/job_test`，并在完成后恢复到新 session；最后已重启 `WEB_PORT=30001` 的常用预览实例，保证当前浏览器预览可直接看到新行为。当前剩余风险：generation job 仍驻留在 Web 进程内存里，如果用户把 `npm run web` 停掉或重启，正在生成中的任务还是会中断，这一层还不是持久任务队列。
- 2026-06-17 17:58：排查并修正 Web 端“周国良：Failed to fetch”与“生成新案件按钮像没了”的两个前端问题。根因确认分两层：一是 `src/web/static/app.js` 把任意聊天异常都按角色消息渲染，导致浏览器网络层异常会显示成“周国良：Failed to fetch”；二是我上一轮把首页主按钮文案改成了“继续查看生成进度”，虽然逻辑还在，但会让人误以为“生成新案件”按钮被删了。本轮修改 `src/web/static/app.js`：把 system 消息单独渲染成 `[系统] ...`，并把常见的浏览器 `Failed to fetch` 映射成中文说明“聊天连接断开了。请重试；如果刚刷新页面或服务刚重启，强刷后再试。”；同时把首页主按钮文案恢复为固定的“生成新案件”，仅在说明文字里强调会接回已有进度，不会重复起新任务。fresh evidence：执行 `npm run build`、`npm test`（仍为 10 个测试文件、18 条测试全部通过）；重启 `WEB_PORT=30001` 的预览实例后，实际读取 `/app.js`，确认已经对外提供“生成新案件”按钮文案、`[系统]` 前缀与新的中文错误提示；再用 `curl` 对 `/api/session/session_811cee84-1486-4f7d-984a-0dc32b9e1111/chat/S01` 做流式 smoke，当前可正常拿到周国良回复，说明案件数据和聊天接口本身没有坏。当前剩余风险：如果用户正好在我重启 30001 预览服务时发起聊天，请求仍会在浏览器侧表现为网络中断，但现在至少会显示成系统提示，而不是像角色自己说出英文报错。
- 2026-06-17 18:34：修正我上一轮引入的 Web 严重回归：后台生成任务会在用户返回开始页或切回旧局时继续偷偷接管前端，最终把当前正在玩的会话覆盖掉。根因有两处，且都在 `src/web/static/app.js`：一是 `loadBootstrap()` 只要看到 `activeGenerationJob` 就自动重新 attach 轮询；二是 `startNewSession()` / `resumeGenerationJob()` 完成后不区分“用户是否已经切去别的局”，会直接把 `state.session` 改成新生成的案件。本轮修正为：移除 `loadBootstrap()` 的自动 attach；新增 generation attachment 失效机制，在 `resumeLatest()`、`loadArchive()`、返回开始页时主动让旧 attach 失效，确保旧的 `/api/generation-jobs/:id` 轮询即使晚点完成，也不会再覆盖当前游玩会话。fresh evidence：执行 `npm run build`、`npm test`（仍为 10 个测试文件、18 条测试全部通过）；另外用 Node 模拟浏览器执行 `src/web/static/app.js`，验证初始加载 `/api/bootstrap` 时不会再自动请求 `/api/generation-jobs/job_test`，并验证“先点生成新案件、再切回最近一局”后，即使后台 job 完成，最终保留的仍是旧 session 而不会被新案覆盖；最后重启 `WEB_PORT=30001` 预览实例。当前状态：首页仍会显示“有一局正在生成”的提示，但只有用户自己再次点“生成新案件”时才会重新接回该进度，不会再偷偷把当前会话冲掉。未处理项：`visualHint` / `discovery` 重复问题已记录，但因为先插修这个回归，尚未继续动那条线。
- 2026-06-17 18:41：继续修正 generation job 轮询对当前游玩会话的干扰。用户补充的真实症状不是“生成完成后覆盖会话”，而是“后台轮询过程中就会不断重渲染页面，导致聊天区滚动被重置、输入体验被打断、并且因为 `state.busy` 持续为 true 让当前操作几乎不可用”。本轮继续修改 `src/web/static/app.js`：把 generation job 的轮询从“整段阻塞 busy 状态”改成“只在提交 `/api/session/new` 的瞬间短暂 busy，拿到 jobId 后立即释放”，避免后台轮询期间禁用当前界面；同时在 `waitForGenerationJob()` 中增加保护，只有当前没有活动 session（即还停留在开始页）时才会按进度消息触发整页 `render()`，防止用户已经回到旧局聊天时，后台轮询还继续重渲染游戏页。已有的 attachment 失效机制继续保留，因此用户切回最近一局 / 归档案件后，后台 job 即使尚未完成，也不会再卡住当前操作。fresh evidence：再次执行 `npm run build`、`npm test`（仍为 10 个测试文件、18 条测试全部通过）；另用 Node 模拟浏览器执行 `src/web/static/app.js`，验证“点击生成新案件后进入轮询中”时 `state.busy === false`，且此时再执行 `resumeLatest()` 仍能保留旧 session，不会被后台轮询打断；随后已再次重启 `WEB_PORT=30001` 预览实例。当前状态：后台生成任务仍会在开始页显示进度，但不应再在轮询过程中把当前聊天/操作锁死。未处理项：`visualHint` / `discovery` 重复问题仍待继续处理。
- 2026-06-17 19:07：按“修完后自己继续查”又做了一轮自查，确实额外揪出并修了两个问题。第一，`src/web/static/app.js` 里 `waitForGenerationJob()` 之前为了复用同一个 promise，把“切回旧局后再次重新接回同一个 job”的场景处理错了：旧 attach 失效后，如果用户马上再次点“生成新案件”，新的 attach 会错误复用旧 promise，导致这次重连直接失效。我已去掉这层错误的全局 promise 复用，改成每次显式 attach 都独立轮询，但仍通过 attachment id 隔离旧任务；并重新用 Node 模拟浏览器验证“先点生成新案件 -> 切回旧局 -> 再次点生成新案件”后，最终会进入新 session，不再被旧 attach 卡死。第二，继续处理用户 earlier 提到的 `visualHint` / `discovery` 重复：修改 `src/case/schema.ts`，当 `visualHint` 缺失或只是重复 `discovery` 时，会优先用 `clueIllustration.items` 生成更直观的“第一眼会先注意到 ...”描述，否则退回 `summary`；同时修改 `src/case/generator.ts`，明确要求 `visualHint` 只写第一眼可见的物件/痕迹，不要直接复述 discovery 结论；修改 `src/web/static/app.js`，把调查节点详情中的字段标题从“视觉印象”改成更直白的“第一眼看到”；并补了 `tests/schema.test.ts` 覆盖重复 visualHint 的收紧逻辑。fresh evidence：执行 `npm run build`、`npm test`（现为 10 个测试文件、19 条测试全部通过）；再次跑两组 Node 模拟前端脚本，一组验证 generation job 重连 race 已修复，另一组验证后台轮询期间 `busy === false` 且切回旧局不会再被打断；最后重新启动 `WEB_PORT=30001` 预览实例，并确认对外提供的 `/app.js` 已包含“第一眼看到”文案和最新开始页按钮逻辑。当前剩余风险：generation job 仍然是进程内内存任务，Web 进程被停掉时仍会中断；更系统的持久队列方案还没做。
- 2026-06-17 20:02：继续把“生成新案件总卡在初稿阶段”往下查，并补上进度/失败可见性。先做了几轮真实本地验证：在多个临时 Web 实例上直接轮询 `/api/generation-jobs/:id`，确认旧问题并不只是前端显示，而是生成模型经常在 draft 阶段耗时很久，或者最终失败在“模型返回坏 JSON / 空对象 / 截断 JSON”这类结构化输出问题上；同时也确认 playable 模式之前还被 `clueIllustration` 深度门禁拖慢，导致即使初稿出来也会很快被打回修订。为此本轮修改：1）`src/web/server.ts` 增加 generation heartbeat，把 job 文案从静态“正在生成案件初稿”改成带已等待秒数，并把最新 generation job（含失败态）暴露给 `/api/bootstrap`，前端在开始页可继续看到最近失败原因；2）`src/llm/openai-gateway.ts` 增加更明确的请求超时配置展示、对坏 JSON wrapper 的兼容解析、以及在结构化重试时从 `tool_call` 回退到 `json_object`，降低空对象 / 坏 tool arguments 的概率；3）`src/case/quality.ts` 与 `src/case/generator.ts` 调整 playable 模式，不再因为线索构图深度门禁直接卡死 Web 试玩生成；4）`src/web/static/app.js` 在生成失败后不再只是静默结束，而会把失败原因保留到开始页，方便用户知道当前到底失败在哪一步。fresh evidence：多次执行 `npm run build`、`npm test`（现为 10 个测试文件、20 条测试全部通过）；用小型结构化请求验证当前网关可在 3 秒内成功返回 JSON；再用 `OPENAI_TIMEOUT_MS=1s/5s` 的直接脚本验证超时包装能如期抛出“模型请求超时”；真实轮询临时 Web 生成任务时，已观察到最新链路不再只停留在同一句文案，至少会显示“已等待 X 秒”，并在另一轮真实运行中成功从 `draft` 进入 `quality-check -> quality-failed -> revision`，证明生成链路确实能越过首轮初稿阶段；当前主预览 `WEB_PORT=30001` 已重启到最新版本，`/api/bootstrap` 当前显示没有遗留 active job。当前剩余风险：虽然“卡在同一句文案完全没信息”已缓解，但真实大模型生成仍然很慢，且 revision 轮仍可能继续耗时较久；如果还要继续降等待，需要下一步继续缩 playable prompt 与字段体量，而不是只靠前端轮询展示。
- 2026-06-17 20:04：继续压缩 playable 生成体量并补了用户可见失败态。修改 `src/case/generator.ts`，让 playable 模式不再强制模型一次性吐出 `storyContext / sceneVisualSummary / sceneIllustration / appearanceSummary / visualHint` 这批可由本地 schema 回填的富字段，要求优先保证案件主干字段正确，能补再补，以缩短首轮 draft 输出；同时保留 full 模式用于严格 harness。修改 `src/web/server.ts`，把 latest generation job（含失败 error）继续暴露给 bootstrap，并将常见结构化失败统一整理成更短的用户可读报错，而不是把整段 Zod / JSON 细节直接甩给用户。修改 `src/web/static/app.js`，开始页现在会显示“上一轮生成失败”说明，避免生成失败后页面只剩一个静默的空开始页。fresh evidence：重新执行 `npm run build`、`npm test`（仍为 10 个测试文件、20 条测试全部通过）；重新启动主预览 `WEB_PORT=30001` 并确认 `/api/bootstrap` 返回 `timeoutMs: 120000` 且当前无遗留 generation job；在临时实例上再次真实轮询生成任务，看到文案已能从 draft 心跳推进到 revision 心跳，不再是永远同一句“初稿中”。当前剩余风险：这一轮还没有拿到“最新 playable prompt 下完整成功生成一局”的 fresh 完整闭环证据，所以“修复根因并验证 Web 生成链路能完成至少一局”仍在继续推进中；但现在至少用户能看到明确等待秒数、失败原因，以及是否已经从首轮初稿进入下一阶段。
- 2026-06-17 20:09：继续用最新 playable prompt 做真实闭环验证，已拿到一局完整成功生成证据。再次执行 `npm run build`、`npm test`（仍为 10 个测试文件、20 条测试全部通过）后，在临时实例 `WEB_PORT=30008` 上实际调用 `/api/session/new` 并持续轮询 `/api/generation-jobs/:id`。fresh evidence：该 job 先在 `draft` 阶段持续更新“已等待 X 秒”，最终在约 259 秒时从 `running/draft` 进入 `completed`，返回 `案件《霜降别墅密室疑案》已生成完成。`，说明最新链路已经能在真实 Web 环境下完成一局 playable 案件生成，而不再是每次都卡死在首轮初稿。当前主预览 `WEB_PORT=30001` 也已重启到最新代码，可直接继续使用。当前剩余风险：耗时依然偏长（约 4 分多钟），只是现在能明确看到进度并最终落到成功/失败，而不是永久假死；后续若还要继续降耗时，需要继续压 playable prompt 和首轮字段体量。
- 2026-06-17 21:47：按用户最新要求继续扩模板、避免标题重名，并顺手修 Web 操作区。修改 `src/case/schema.ts` 与 `src/case/templates.ts`，把模板类型从 6 种扩到 9 种，新增 `blackmail`（勒索灭口案）、`cold-case`（旧案牵连案）、`identity-fraud`（身份伪装案），同时补了 scene figure role 的中文值归一化，以及 NPC `knows/hides` 允许空数组，降低新模板实际生成时的 schema 脆弱性；修改 `src/case/generator.ts`，加入 `existingTitles` 选项与标题重复门禁，把已有案件名显式喂给模型，并在候选标题重复时强制继续修订；修改 `src/session/store.ts` 增加 `listCaseTitles()`，并在 `src/web/server.ts`、`src/cli/run.ts`、`src/harness/case-harness.ts` 中接入已有标题收集逻辑，避免继续生成与当前库/归档同名的案件；同时在 Web 端新增 `/api/session/:id/export` 导出接口，把 `src/web/static/app.js` / `styles.css` 调整为顶部工具条放“导出案件 / 返回开始”，不再把返回开始按钮塞在案件背景下方的调查区。文档同步：更新 `README.md` 的模板列表、Harness 参数说明和 Web 顶部操作说明。测试补充：新增/更新 `tests/templates.test.ts`、`tests/case-generator.test.ts`、`tests/schema.test.ts`、`tests/session-store.test.ts`。fresh evidence：`npm run build`、`npm test`（现为 11 个测试文件、25 条测试全部通过）；重启 `WEB_PORT=30001` 预览实例后，实际验证 `/api/session/:id/export` 返回 200 且带正确 attachment header，前端脚本里也已包含“导出案件 / 返回开始”新按钮文案。额外验证：按仓库要求执行了两次新模板 harness——`--template=blackmail` 在默认 120s 超时时间下失败于 `模型请求超时（>120 秒）`，`OPENAI_TIMEOUT_MS=300000 --template=staged-suicide` 仍失败于 `模型输出被截断。`；说明新模板入口和 schema 已接通，但严格 full 模式下的大模型输出稳定性仍然偏弱，后续如要让新模板在 harness 下更稳，还需要继续压 full prompt 或进一步拆阶段生成。
- 2026-06-17 22:19：按用户要求移除 Web 侧栏里重复价值不高的“已知线索”模块，并补上项目 favicon。修改 `src/web/static/app.js`，删除已知线索卡片和对应的 `renderNotebookCard()` 渲染逻辑，避免侧栏继续重复展示已经能在调查节点详情里看到的发现信息；新增 `src/web/static/favicon.svg`，采用深色悬疑风格的放大镜 + 红色线索点 SVG 作为站点图标；修改 `src/web/static/index.html` 加入 favicon link，并在 `src/web/server.ts` 中增加 `/favicon.svg` 与 `/favicon.ico` 的静态返回，保证浏览器能稳定拿到图标。fresh evidence：再次执行 `npm run build`、`npm test`（保持 11 个测试文件、25 条测试全部通过）；重启 `WEB_PORT=30001` 预览实例后，实际请求 `/favicon.svg` 返回 200 且内容为 SVG，`/app.js` 中已不再包含“已知线索”模块字符串。当前状态：Web 页面已去掉这块重复侧栏，并带上新的 favicon；如浏览器仍显示旧图标或旧侧栏，需要强刷缓存。
- 2026-06-17 23:34：继续按“新模板 strict/full 下要更稳”推进，重点压缩 strict harness 的实际输出体量并增强 schema 容错。修改 `src/case/schema.ts`：增加对不完整 `sceneIllustration` / `clueIllustration` 的预处理容错，遇到模型给出半截结构时直接丢弃并走默认回填，而不是整局 parse 失败；同时把默认 `clueIllustration` 回填从 1 项提升到 2 项，保证 strict 门禁仍可生效。修改 `src/case/generator.ts`：把 strict 生成策略从“full prompt + strict gate”改成“lean playable prompt + strict review threshold + strict clueIllustration gate”，也就是仍保留严格评审与门禁，但不再在 prompt 里硬逼模型输出整套富视觉字段；并进一步明确这些视觉子字段不是硬性输出项，可由系统回填，以避免新模板在 strict 模式下继续因为输出体量过大而频繁截断。测试补充：更新 `tests/schema.test.ts`，覆盖不完整 `sceneIllustration` 的自动回填；重新执行 `npm run build`、`npm test`（现为 11 个测试文件、27 条测试全部通过）。关键 fresh evidence：使用 `OPENAI_TIMEOUT_MS=300000` 真实执行两次新模板 harness，`--template=staged-suicide` 最终通过并归档 `data/approved-cases/2026-06-17T15-12-40-541Z--午夜潮声--archive_a2f5fc10-6064-413f-b96f-dde6b0d6703c.json`（overallScore 86，attemptCount 3）；随后 `--template=blackmail` 也通过并归档 `data/approved-cases/2026-06-17T15-34-11-129Z--灰烬中的录音带--archive_d189eb15-8d83-4260-a500-72befeaa98e2.json`（overallScore 82，attemptCount 1）。最后已重启 `WEB_PORT=30001` 主预览实例，`/api/bootstrap` 当前能看到这两类新模板归档已进入可重玩列表。当前剩余风险：strict harness 对新模板已经从“经常截断/超时”改善到至少黑函与伪自杀这两类可通过，但整体耗时仍然偏长，后续若要继续提升吞吐，还得进一步拆 generation / review 或继续压 prompt。
- 2026-06-18 01:21：为 Web 对话页补上**可直接使用的流式语音转文字输入**。新增 `src/config/voice-input-config.ts`，用本项目本地环境变量加载火山语音配置，主字段采用 `VOICE_INPUT_*`，同时兼容 `OPENCODE_VOICE2TEXT_*` 旧命名，并新增显式 `VOICE_INPUT_CONFIG_PATH` / `OPENCODE_VOICE2TEXT_LOCAL_CONFIG` 支持，让本项目可安全复用 opencode 语音插件本地配置文件；新增 `src/voice/volcengine-asr.ts`，参考现有 opencode 语音插件的 Volcengine / 豆包语音 websocket 协议，补出可复用的流式识别 session 与一次性转写封装；修改 `src/web/server.ts`，在 `/api/bootstrap` 中暴露 `voiceInput` 可用状态和 chunk 配置，并新增 `/api/voice-input/session/start`、`/api/voice-input/session/:id/chunk`、`/api/voice-input/session/:id/stop`、`DELETE /api/voice-input/session/:id` 这套流式语音会话接口；修改 `src/web/static/app.js`，把先前“停录后整段上传”的实现改成真正边录边分块上传、边把稳定识别结果流式回填到聊天输入框，仍保持“只回填、不自动发送”，同时补了录音启动中、切换页面 / 切换角色 / 返回首页时的中断清理与草稿保留；修改 `src/web/static/styles.css` 补充语音按钮状态样式；更新 `.env.example`、`README.md` 说明配置与用法；更新 `tests/voice-input-config.test.ts` 覆盖显式配置文件路径场景。fresh evidence：执行 `npm run build`、`npm test`（现为 12 个测试文件、31 条测试全部通过），并执行 `node --check src/web/static/app.js` 做前端脚本语法检查；用临时实例在 `VOICE_INPUT_CONFIG_PATH=$HOME/.config/opencode/voice2text.local.json` 下做真实火山 ASR 流式验证：通过 `say` + `sox` 生成中文语音，依次调用 `/api/voice-input/session/start -> chunk -> stop`，在 `stop` 前已收到流式片段 `你好，周国良。`，最终完整识别结果为 `你好，周国良。请问案发的时候你在什么地方？为什么没有及时报警？`，证明“前端分块上传 / 后端流式识别 / 输入框持续回填”这一套链路已可工作；随后重启主预览 `WEB_PORT=30001` 并注入 `VOICE_INPUT_CONFIG_PATH=$HOME/.config/opencode/voice2text.local.json`，确认当前 `/api/bootstrap` 返回 `voiceInput.enabled=true`，且 `/app.js` 已对外提供“语音输入”按钮和流式会话接口路径。当前剩余风险：虽然已用真实 ASR 跑通分块流式识别，但这次验证仍是脚本级模拟录音分块，不是手动点击浏览器麦克风按钮的真人实录；浏览器权限弹窗、具体麦克风设备质量与用户自然停顿长度仍会影响体感，但代码链路和真实识别回流已确认打通。
- 2026-06-18 01:44：修正 Web 聊天发送时的整页重绘抖动，并顺手把首页标题从“中文悬疑推理游戏”收敛为“悬疑推理游戏”。本轮主要修改 `src/web/static/app.js`：新增 `state.chatPending`，把聊天发送从复用全局 `busy` 改成独立的局部发送状态；新增 `currentCharacterPanelState()`、`syncCharacterChatView()`、`refreshActiveView()` 等局部同步逻辑，使点击“发送”和流式回复 chunk 到来时只刷新聊天区、输入框、发送按钮和语音按钮状态，不再每次都整页 `render()`，从而避免顶部 loading 条插入/移除导致的布局抖动；同时把语音输入流程里与当前角色详情直接相关的状态刷新也改成优先局部更新，减少录音/回填过程中的整页重绘。fresh evidence：重新执行 `npm run build`、`npm test`（保持 12 个测试文件、31 条测试全部通过）与 `node --check src/web/static/app.js`；再用 Node VM 对 `sendChat()` 做前端级模拟，验证发送一次消息后 `renderCount = 0`、`syncCount = 5`、`chatPending=false`、`busy=false`，且流式回复成功拼成 `第一段第二段`，证明发送过程中不再触发整页 render，而是走局部同步；最后重启 `WEB_PORT=30001` 预览实例并确认 `/api/bootstrap` 正常、`/app.js` 已对外提供新的标题字符串与最新聊天实现。当前剩余风险：本轮还没有做真人手动浏览器点击的视觉验收，因此如果你机器上仍感觉有轻微抖动，下一步要继续把聊天区的 innerHTML 局部刷新再收紧成“只更新最后一条消息节点”，但目前至少已经去掉了发送时最明显的整页重绘和全局 loading 抖动。
- 2026-06-18 01:54：新增 Web 版“提示官”角色，用于玩法澄清、背景解释和渐进式提示。新增 `src/chat/hint-master.ts`，把提示官定义成一个场外主持型角色：平时只回答公开背景、玩法规则和已发现线索的理解，只有在玩家明确表示“卡住了 / 给点提示”时才按轮次渐进式推进，而且不会直接说出真凶或完整解法；修改 `src/web/server.ts`，为每个 session 序列化 `hintMaster`，并让 `/api/session/:id/chat/hint_master` 走独立的提示官流式回复链路，同时把它复用到现有消息存储；修改 `src/web/static/app.js`，在侧栏新增“提示官”入口，并在角色详情页根据 `hintMaster` 角色显示不同的说明文案与占位提示；更新 `README.md` 补充提示官用途；新增 `tests/hint-master.test.ts` 覆盖提示请求识别、渐进式系统 prompt 约束和固定角色信息。fresh evidence：执行 `npm run build`、`npm test`（现为 13 个测试文件、34 条测试全部通过）与 `node --check src/web/static/app.js`；再用临时实例 `WEB_PORT=30015` 做 Web smoke，实际调用 `/api/session/resume-latest` 确认返回 `hintMaster`，并调用 `/api/session/:id/chat/hint_master` 获得一条非空的渐进式提示回复；最后重启主预览 `WEB_PORT=30001` 并确认 `/api/session/resume-latest` 返回 `hintMaster.name = 提示官`，`/app.js` 也已包含提示官 UI。当前剩余风险：本轮还没有额外做“连续多轮向提示官索要更强提示”的真人交互验收，因此渐进层级目前主要依赖 prompt 约束；如果后续想把提示力度进一步做稳，可以再把“提示等级”显式写进 session state，而不是只靠历史消息推断。
- 2026-06-18 02:05：修正提示官详情页排版过窄的问题，并按用户要求把提示官入口移到侧栏最底部。修改 `src/web/static/app.js`，把提示官卡片从侧栏上部移到“相关人物”之后；同时为提示官详情页补上 `hint-master-panel` 专用 class，避免继续沿用带空头像列的人物双栏布局。修改 `src/web/static/styles.css`，为 `.hint-master-panel` 增加专用布局：取消空的左侧人物列，并把详情信息改成自适应宽列，避免说明文字被挤成一列一列的窄条。fresh evidence：重新执行 `npm run build`、`npm test`（保持 13 个测试文件、34 条测试全部通过）与 `node --check src/web/static/app.js`；再用 Node VM 验证 `renderSidebar()` 中提示官区块确实出现在“相关人物”之后，且 `renderMainPanel()` 已包含 `hint-master-panel` class；最后重启 `WEB_PORT=30001` 预览实例，并确认对外提供的 `/app.js`、`/styles.css` 已包含新的提示官位置和布局样式。当前状态：提示官入口已经在侧栏最下方，详情页不再出现空列挤压文本的极窄排版；如浏览器还显示旧样式，需要强刷缓存。
- 2026-06-18 02:13：继续按用户反馈把首页从“太像 demo”往产品首页方向收了一轮。修改 `src/web/static/app.js` 的 `renderStart()`：在 hero 区直接加入项目 icon（复用 `/favicon.svg`）、更完整的产品主文案、模型/语音/提示官能力 badge、关键指标卡、推荐体验区；同时把开始面板补成更像产品入口的结构，增加更完整的说明、副文案和归档 spotlight；新增“怎么玩”流程区与“当前能力”卡片区，显著提高首页的信息密度和视觉层次。修改 `src/web/static/styles.css`，补上 `home-shell`、`hero-home`、`home-hero-logo-wrap`、`home-kpi-grid`、`home-section-grid`、`flow-grid`、`feature-grid` 等首页专用样式，并增加响应式布局支持。顺手修正了我之前误把 `selectedNode` 面板也挂上 `isHintMaster` 条件 class 的低级错误，避免后续点击调查节点时出现运行时问题。fresh evidence：执行 `npm run build`、`npm test`（保持 13 个测试文件、34 条测试全部通过）与 `node --check src/web/static/app.js`；再用 Node VM 直接渲染首页，确认输出中已包含 `/favicon.svg`、`本地可玩的案件工坊`、`怎么玩`、`当前能力` 等新首页模块；最后重启 `WEB_PORT=30001` 预览实例，并确认对外提供的 `/app.js`、`/styles.css` 已包含新的首页 icon、hero 文案、流程区和能力区样式。当前状态：首页不再只剩两块卡片和几行文字，信息量和产品感已经明显比之前更完整；如浏览器还显示旧首页，需要强刷缓存。
- 2026-06-18 10:30：为 Web 聊天视图补上浏览器本地缓存与清空入口，解决“刷新后聊天显示没了”的问题。修改 `src/web/static/app.js`：新增 `mystery-web-chat-cache-v1` 的 localStorage 读写、清理、延迟持久化与 `beforeunload` 落盘逻辑；缓存内容包括当前 `sessionId`、当前选中的角色/调查节点、`messagesByCharacter` 和 `draftsByCharacter`。`loadBootstrap()` 现在会尝试 `restoreCachedSessionView()`，优先把当前这局和当前聊天对象从本地缓存恢复回来；如果缓存里已经有该角色的消息，就直接恢复显示，不再额外请求 `/messages/`。同时在游戏顶部工具条新增“清空本地缓存”按钮，点击后会清掉浏览器侧恢复状态并把当前聊天视图收回到概览页，但不会删除服务端 SQLite 中已有消息。文档同步：更新 `README.md`，明确说明聊天视图会缓存到浏览器本地、刷新后可恢复，并且顶部可清空本地缓存。fresh evidence：执行 `npm run build`、`npm test`（保持 13 个测试文件、34 条测试全部通过）与 `node --check src/web/static/app.js`；再用 Node VM 模拟 localStorage 和前端启动流程，验证缓存中的 `session_cached / hint_master / 2 条消息 / 草稿问题` 可以在启动时直接恢复，且存在本地缓存时不会额外请求 `/messages/`；最后重启 `WEB_PORT=30001` 预览实例，并确认对外提供的 `/app.js` 已包含 `mystery-web-chat-cache-v1`、`restoreCachedSessionView` 和“清空本地缓存”按钮文案。当前剩余风险：这轮只做了浏览器本地恢复状态，不会去删除服务端 SQLite 里的历史消息；因此如果你点了“清空本地缓存”后又重新打开同一个角色，对话仍可能再次从服务端记录恢复出来——这符合“清空本地恢复态”而不是“删除服务器消息”的边界。
- 2026-06-18 11:36：继续把“聊天原文别落库”“真相后还能追问细节”“确认弹窗别太丑”和“场景 SVG 要把所有嫌疑人放进去”这几条一起收口。修改 `src/session/store.ts`，移除对 `messages` 表的依赖并在初始化时清理旧表，SQLite 现在只保留案件与会话状态；修改 `src/chat/dialogue-memory.ts`、`src/web/server.ts`、`src/web/static/app.js` 与 `src/cli/run.ts`，让 Web 改成前端把当前角色的历史对话随请求一起带给后端，CLI 改成进程内 `DialogueMemory` 维持连续对话，Web/CLI 都不再读写 SQLite 聊天原文；同时把“提示官”同步补进 CLI 的可对话角色集合。修改 `src/chat/hint-master.ts`、`src/web/server.ts`、`src/cli/run.ts` 与 `src/web/static/app.js`，让提示官在未结案时继续做渐进提示，在结案/直接看答案后切换成“真相问答”模式，用户可以继续追问动机、时间线和某条线索为什么成立，Web 结案结果页也新增了“追问提示官细节”入口。修改 `src/web/static/index.html`、`src/web/server.ts`、`src/web/static/app.js` 与 `src/web/static/styles.css` 接入 `sweetalert2`，把“清空本地缓存 / 指认 / 直接看答案”替换成站内弹窗，同时把网页 title 收敛成 `悬疑推理游戏` 并补上更完整的 meta description。修改 `src/case/schema.ts` 与 `src/case/visuals.ts`，默认 sceneIllustration/sceneSvg 不再只摆一两个角色，而是至少把全部嫌疑人补进场景图；同时把程序化生成的 `sceneSvg/avatarSvg` 从 SQLite 和归档 JSON 中剥离，改成运行时再生成，避免把可重复计算的 SVG 冗余存储。文档同步：更新 `README.md`，明确 Web/CLI 当前的对话存储边界、真相后提示官可继续问细节、站内确认弹窗，以及 SVG 为运行时生成不默认落库。测试同步：更新 `tests/session-store.test.ts`、`tests/archive.test.ts`、`tests/schema.test.ts`、`tests/hint-master.test.ts`。fresh evidence：执行 `npm run build`、`npm test`（现为 13 个测试文件、35 条测试全部通过）与 `node --check src/web/static/app.js`；执行 CLI smoke（空归档目录下 `printf '2\n' | env DATABASE_PATH=... ARCHIVE_DIR=... node dist/src/index.js`）确认 CLI 可正常启动退出；主预览 `WEB_PORT=30001` 重启后再次 smoke 检查 `/`、`/vendor/sweetalert2.js`、`/api/session/resume-latest`，确认 title/description/SweetAlert 资源/提示官入口生效，且返回的 `sceneSvg` 已包含全部嫌疑人名字、结案后提示官真相问答可正常返回解释。额外按仓库要求执行了 `OPENAI_TIMEOUT_MS=300000 npm run harness:cases -- --count=1` 做 fresh harness 验证，但本次真实模型结果失败于 `模型输出被截断。`；当前判断更像模型波动/输出长度问题，而不是本轮功能改动直接导致的结构错误，不过仍需在后续继续关注 strict/full 生成稳定性。
- 2026-06-18 13:16：按用户新要求继续把玩家端/管理端分流收口。新增 `src/config/admin-config.ts`，加载 admin 账号密码与可切换的多模型 preset 列表；扩展 `src/config/runtime-config.ts` 支持按 preset id 直接构造运行时模型配置。修改 `src/session/store.ts` 增加 `settings` 表，用于持久化 admin 的模型选择；修改 `src/archive/story-archive.ts` 增加删除归档能力。大幅扩展 `src/web/server.ts`：新增 `/admin` 页面与 `/admin.js` 静态资源，接入 admin 登录/登出、归档列表、按模板生成新案件、删除归档案件、模型切换、admin generation job 轮询等接口；游玩 / 生成 / 评审模型改成按当前 admin 选择动态取 preset；玩家端 `/api/session/new` 现在明确返回 403，要求去管理后台新增案件。新增 `src/web/static/admin.html`、`src/web/static/admin.js` 实现管理后台：账号密码登录、归档案件删除、按模板新增案件、三类模型切换。同步修改 `src/web/static/app.js`，把玩家首页文案收口为“玩家界面不再直接生成案件，新增案件交给管理后台处理”，并在检测到 admin 已启用时显示进入 `/admin` 的入口。文档同步：更新 `README.md` 和 `.env.example`，补充 `ADMIN_USERNAME / ADMIN_PASSWORD`、`/admin` 访问方式、多模型 preset 切换、玩家端不再直接生成案件等说明。fresh evidence：执行 `npm run build`、`npm test`（仍为 13 个测试文件、35 条测试全部通过）与 `node --check src/web/static/app.js`、`node --check src/web/static/admin.js`；另外启动临时 admin smoke 服务（`WEB_PORT=30016`），实际验证了 `/admin` 页面可访问、`/api/admin/login` 可登录、`/api/admin/bootstrap` 能返回归档与多模型选项、`/api/admin/model-selection` 能保存选择、`/api/admin/cases/generate` 能创建 generation job、`/api/admin/archives/:id` 能删除归档、以及玩家端 `/api/session/new` 已被 403 阻止；最后重启主预览 `WEB_PORT=30001` 并显式启用 admin，当前可直接通过 `http://127.0.0.1:30001/admin` 查看管理后台。当前剩余风险：这轮只做了“只管归档”的最小 admin 范围，还没有做会话级管理、案件批量操作或更完整的鉴权/登出体验；模型切换依赖 `AI_PRESET_PATH` 提供多组 preset，若 preset 文件里是示例 token，后台虽然能切，但真实调用仍会失败。
- 2026-06-18 13:30：按用户要求把 30001 预览环境也直接配到可用状态，不再让用户自己补 admin / preset。新增本地忽略文件 `config/ai-presets.local.yaml`（已通过 `.gitignore` 忽略）并写入 4 个本地可切换 preset：`deepseek-v4-pro`、`gpt-5.2`、`gpt-5.3-codex`、`gpt-5-2-json`；同时更新本地 `.env`（未入库）补上 `AI_PRESET_PATH=config/ai-presets.local.yaml`、默认 play/generator/reviewer preset 选择、`ADMIN_USERNAME / ADMIN_PASSWORD` 以及 `VOICE_INPUT_CONFIG_PATH`。fresh evidence：实际探测了 `deepseek-v4-pro`、`gpt-5.2`、`gpt-5.3-codex` 在当前 endpoint 下都能返回；随后重启 `WEB_PORT=30001` 并再次调用 `/api/admin/login` + `/api/admin/bootstrap`，确认当前预览 admin 下拉里已有 4 个模型选项，默认选择为 `play=deepseek-v4-pro / generator=deepseek-v4-pro / reviewer=gpt-5-2-json`，且 `voiceInput.enabled=true`。当前状态：现在直接打开 30001 的 `/admin` 就能看到可切换模型列表与已启用的管理后台，不需要用户再手动补本地配置；风险只在于这些本地配置没有入库，换机器时仍需重新补一次。
- 2026-06-18 15:14：按用户明确要求，优先修掉调查节点里“摘要”和“第一眼看到”重复的问题，并暂缓其余 admin/CLI 收尾项。根因定位在 `src/case/schema.ts`：`visualHint` 的 fallback 先于 `clueIllustration` 回填执行，且在拿不到足够视觉 item 时直接退回 `summary`，导致 UI 同时显示两份同文案。现已修改为：`visualHint` 与 `summary` / `discovery` 任一过近都视为无效；先生成 `clueIllustration` fallback，再基于 items / 标题 / 关键疑点生成独立的短视觉描述，不再允许直接退回 `summary`。同步更新 `tests/schema.test.ts`，新增覆盖“visualHint 缺失或等于摘要时也必须生成不同短描述”的用例。fresh evidence：执行 `npm run build`、`npm test`（现为 13 个测试文件、36 条测试全部通过），并用 `npx tsx` 直接验证一个 `visualHint=node.summary` 且缺失 `clueIllustration` 的案件节点，结果已变成 `第一眼会先注意到 威士忌酒杯、送药时间对不上。`，不再等于摘要；随后重启 `WEB_PORT=30001` 并实际调用 `/api/session/:id/investigate`，返回节点 `summary` 与 `visualHint` 已明显不同。当前状态：这个重复显示问题已经按根因修掉；后续如果还看到个别案件重复，需要继续排查是否是旧缓存或模型本身直接写了近似 visualHint。
- 2026-06-18 16:06：按用户刚刚的明确要求，修正“结案结果页点击追问提示官细节会跳去独立聊天页”的交互。修改 `src/web/static/app.js`，让 `openHintMasterChat()` 在 `state.judgement` 存在时不再清空结案结果，而是保留结果页、仅把当前聊天目标切到提示官，并在 `renderMainPanel()` 的结案结果块内直接渲染内联的提示官真相问答区（复用现有流式聊天 / 语音输入 / 本地草稿与消息缓存逻辑）；同步修改 `src/web/static/styles.css`，为结果页内联追问区补最小容器样式；更新 `README.md`，明确结案后可以直接在结果页继续追问提示官。fresh evidence：执行 `npm run build`、`npm test`（保持 13 个测试文件、36 条测试全部通过），并执行 `node --check src/web/static/app.js`；另外用 Node VM 模拟 `state.judgement` 已存在时点击“追问提示官细节”，验证 `state.judgement` 不会被清空、`state.selectedCharacterId` 会切到 `hint_master`，且 `renderMainPanel()` 会继续输出结案结果并同时包含内联 `chat-log` 的提示官追问区；最后重启 `WEB_PORT=30001` 预览实例并直接检查 `http://127.0.0.1:30001/app.js`，确认对外已包含“继续追问真相细节”和“不切换页面，直接在结果区继续追问...”的新文案。当前剩余风险：本轮只收了“结果页内继续追问”这条交互，不改动结案后的其它导航路径；如果后续还想让结果页同时支持收起/展开追问区，再单独补 UI 开关即可。
- 2026-06-18 16:15：继续按用户追问，拆开“结果页追问提示官”和“左侧提示官”两条会话的上下文。修改 `src/web/static/app.js`，新增 `hintMasterChatMode` 与独立的结果页会话 key（`hint_master__judgement`），让结果页复盘问答与左侧提示官普通聊天分别使用不同的 `messagesByCharacter` / `draftsByCharacter` 槽位；`sendChat()`、语音转文字回填、缓存恢复、结果页内联追问区都会按当前会话 key 读写，因此结果页发送时不会再把左侧提示官的历史一并带给后端。同步更新 `README.md`，明确结果页复盘问答会和左侧提示官普通聊天分开记忆。fresh evidence：执行 `npm run build`、`npm test`（保持 13 个测试文件、36 条测试全部通过）与 `node --check src/web/static/app.js`；再用 Node VM 模拟“左侧提示官已有普通提示历史、结果页另有复盘历史”的场景，确认点击结果页追问后当前显示和提交给 `/chat/hint_master` 的 `history` 只来自 `hint_master__judgement`，不会混入左侧 `hint_master` 历史；最后重启 `WEB_PORT=30001` 预览实例并检查 `http://127.0.0.1:30001/app.js`，确认对外已包含 `__judgement` 会话 key 与“分开记忆”说明文案。当前剩余风险：目前只拆开了前端会话历史槽位，后端仍复用同一个提示官接口和 truth mode 规则；这对当前需求已足够，但如果后续还想让结果页追问和左侧提示官连 system prompt 也进一步分化，再单独给后端加 `contextMode` 参数即可。
- 2026-06-18 16:23：继续修掉我刚刚自己没测出来的本地缓存回归：结果页提示官复盘追问在刷新后会丢失。根因在 `src/web/static/app.js`：local cache 只保存了 `selectedCharacterId`，但没有保存 `hintMasterChatMode` 与 `judgement`，导致刷新恢复时 `hint_master__judgement` 这条结果页会话被错误降级成左侧普通提示官会话，看起来像“聊天记录没了”。本轮修改 `src/web/static/app.js`，为 local cache 增加 `hintMasterChatMode` 和 `judgement` 的持久化 / 清洗 / 恢复逻辑，并在恢复 solved session 时只要 cache 里有结果页 judgement，就继续还原结果页和 `hint_master__judgement` 独立会话；如果 cache 里没有 judgement，则安全降级回左侧普通提示官会话。新增 `tests/web-app-cache.test.ts`，补了 3 个完整自动化 case：1）普通提示官聊天刷新后恢复；2）结果页提示官复盘追问刷新后恢复且发送时只带 `hint_master__judgement` 历史；3）缺 judgement 缓存时安全降级回普通提示官会话。同步更新 `README.md`，明确结果页里的提示官复盘追问也会跟着 local cache 一起恢复。fresh evidence：执行 `npm run build`、`npm test`（现为 14 个测试文件、39 条测试全部通过）与 `node --check src/web/static/app.js`；最后重启 `WEB_PORT=30001` 预览实例。当前剩余风险：这次优先把刷新丢聊天记录的回归补上了，左侧按钮对齐问题还没继续动，下一步应在不扩大范围的前提下单独收这个 UI 问题。
- 2026-06-18 16:31：继续按用户要求把测试 case 补完整，并顺手修掉一处我自己在补缓存时又引入、但应该靠测试提前发现的回归。新增 `tests/web-app-cache.test.ts` 的 2 个高风险场景：4）`resumeLatest()` 在 solved session + local cache 命中时必须保留结果页 judgement、提示官复盘模式和 `hint_master__judgement` 历史；5）`buildChatLocalCacheSnapshot()` 必须把 `hintMasterChatMode`、`judgement`、独立复盘线程消息与草稿完整写进 snapshot。与此同时修改 `src/web/static/app.js` 的 `resumeLatest()`，把“总是把 `state.judgement = null`”改成只有**未命中 cache 恢复**时才清空，否则保留结果页复盘状态，避免用户点“继续最近一局”后又把刚修好的结果页提示官缓存清掉。fresh evidence：再次执行 `npm run build`、`npm test`（现为 14 个测试文件、41 条测试全部通过）与 `node --check src/web/static/app.js`。当前状态：结果页提示官这条链路现在至少有 5 个自动化缓存 / 恢复 / 发送 case 兜底，不再只靠手动点点看；后续继续动这块前端状态机时，应该先补 case 再改代码，避免再把刷新恢复、结果页复盘或侧栏普通提示互相踩坏。
- 2026-06-18 16:38：继续把“返回开始后聊天记录丢失”补成明确自动化回归场景。修改 `src/web/static/app.js`，新增 `flushChatLocalCacheNow()`，在 `returnToStart()` 和 `beforeunload` 中先取消已排队的延迟持久化 timer 再立即落盘，避免“上一轮 `schedulePersistChatLocalCache()` 还没执行、用户立刻点返回开始，随后延迟 timer 用已清空 state 把 local cache 覆盖掉”的竞态。继续扩展 `tests/web-app-cache.test.ts`，新增 4 个 case：6）嫌疑人普通聊天刷新后恢复；7）纯结果页（未打开提示官复盘问答）刷新后 judgement 也能恢复；8）有挂起的延迟 persist timer 时执行 `returnToStart()`，local cache 仍必须保住原聊天内容；9）`returnToStart()` 后再 `resumeLatest()`，嫌疑人聊天消息与草稿都必须完整恢复。fresh evidence：再次执行 `npm run build`、`npm test`（现为 14 个测试文件、45 条测试全部通过）与 `node --check src/web/static/app.js`。当前状态：这批缓存相关高风险路径现在已经有 9 个前端自动化 case 覆盖，不再只靠手工回归；后续如果再改动 `returnToStart` / `resumeLatest` / local cache 状态机，必须先过这批 case 再说。
- 2026-06-18 16:51：继续修掉 30001 上“返回开始后再点继续最近一局，聊天还是会消失”的实际根因。确认问题不只是 local cache 落盘，而是 `src/web/static/app.js` 的 `resumeLatest()` 之前**完全忽略当前浏览器 local cache 里的 `activeSessionId`**，直接调用服务端 `/api/session/resume-latest`；只要服务端还有另一局更新更晚的 active session，就会接回错误的会话，浏览器本地缓存自然也对不上，看起来就像“明明存了 local cache 但还是丢了聊天”。本轮修改 `src/web/static/app.js`，让 `resumeLatest()` 优先尝试读取 local cache 里的 `activeSessionId` 并直接请求 `/api/session/:id`，只有本地缓存没有 sessionId 或该 session 已不存在时，才回退到服务端 `/api/session/resume-latest`。同时继续扩展 `tests/web-app-cache.test.ts`，新增 2 个明确回归 case：10）当浏览器 local cache 指向的 session 与服务端“最近一局”不是同一局时，`resumeLatest()` 必须优先恢复 cached session；11）当 cached session 已不存在时，再安全回退到服务端 latest session。另在 `README.md` 补充说明：“继续最近一局”会优先接回当前浏览器 local cache 里的那一局。fresh evidence：再次执行 `npm run build`、`npm test`（现为 14 个测试文件、47 条测试全部通过）。当前状态：`resumeLatest` 现在终于和 local cache 的设计口径对齐，不再无视浏览器已缓存的那一局；后续只要 local cache 还在，返回开始后应优先回到这台浏览器刚刚玩的那局，而不是某个别的较新 active session。
- 2026-06-18 16:58：继续按用户指出的口径收尾，把 Web 侧残留的“服务端最近一局”逻辑彻底删干净。修改 `src/web/static/app.js`，让 `resumeLatest()` 在没有本地 `activeSessionId` 时直接报错，不再向服务端“猜最近一局”；同时补上恢复失败时的站内错误提示。修改 `src/web/server.ts`，删除 bootstrap 中的 `latestSession` 字段以及已废弃的 `/api/session/resume-latest` 路由，避免前后端再残留任何 Web 用的“服务端最近一局”入口；修改 `src/session/store.ts`，移除前一步为此临时加上的 `getLatestSession()`；同步更新 `README.md`，明确“继续最近一局”只认当前浏览器 local cache。补充 `tests/web-app-cache.test.ts` 第 12 个 case：即使 bootstrap 里还存在 `latestSession` 字段，前端开始页也不应因此显示“继续最近一局”按钮。fresh evidence：再次执行 `npm run build`、`npm test`（保持 14 个测试文件、48 条测试全部通过），并重启 `WEB_PORT=30001` 预览实例后直接检查 `http://127.0.0.1:30001/app.js` 与 `/api/bootstrap`，确认前端脚本里已不再包含 `/api/session/resume-latest`，bootstrap 里也不再包含 `latestSession`。当前状态：Web 这条“继续最近一局”链路现在已经完全改成浏览器 local cache 口径，不再混入服务端最近会话概念。
- 2026-06-18 17:20：按用户要求继续做**真实浏览器级自测**，不只停留在 Node VM。使用系统 Chrome 的 headless + CDP 直接连 `http://127.0.0.1:30001/` 做两条完整路径验证：1）active 嫌疑人聊天页：预置 local cache 后，页面首次打开即恢复到嫌疑人聊天，随后执行“返回开始 -> 继续最近一局”，聊天消息 `陈明哲：【浏览器实测】我真的没进去。` 与草稿 `【浏览器实测】你再说一遍时间线` 前后保持一致；2）solved 结果页提示官复盘追问：预置 `hint_master__judgement` 与 judgement 后，页面首次打开即恢复到结果页内联追问区，随后执行“返回开始 -> 继续最近一局”，消息 `提示官：【浏览器实测】这是结果页复盘追问。`、草稿 `【浏览器实测】为什么凶手选这个时间？` 与“结案结果”面板都前后保持一致。相关 fresh evidence 由 bash 直接打印了两组前后对比 JSON；测试结束后已关闭临时 headless Chrome 调试实例。当前状态：最新 30001 代码在**真实浏览器新 profile**下，active 聊天和 solved 结果页追问这两条“返回开始 -> 继续最近一局”路径都已实测通过；如果用户当前打开的是更早版本就一直没刷新过的旧 tab，仍可能继续运行旧 bundle，需要至少强刷一次才能切到新逻辑。
- 2026-06-18 17:28：按用户要求继续收口调试链路，在 Web 前端补了最小可复制的 local cache 调试日志，不再让用户盲猜。修改 `src/web/static/app.js`，新增 `debugChatCache()`、`summarizeCachedState()`，并在 `readChatLocalCache()`、`persistChatLocalCacheNow()`、`flushChatLocalCacheNow()`、`schedulePersistChatLocalCache()`、`applyCachedChatStateForSession()`、`restoreCachedSessionView()`、`returnToStart()`、`resumeLatest()` 等关键节点输出 `[Mystery Cache Debug]` 日志；同时暴露 `window.__mysteryDebugLogs` 与 `window.__mysteryDumpChatCache()`，方便用户在浏览器控制台直接复制完整链路状态，而不需要自己手工拼 localStorage 内容。fresh evidence：再次执行 `npm run build`、`npm test`（保持 14 个测试文件、48 条测试全部通过）与 `node --check src/web/static/app.js`；随后重启 `WEB_PORT=30001` 预览实例，并直接检查 `http://127.0.0.1:30001/app.js`，确认已对外包含 `__mysteryDebugLogs`、`__mysteryDumpChatCache` 与 `resume-latest-start` 等调试打点。当前状态：如果用户机器上 30001 仍能复现“返回开始 -> 继续最近一局 -> 聊天记录消失”，现在已经可以直接从浏览器控制台导出完整调试链路，而不需要继续靠双方口头猜状态机。
- 2026-06-18 17:53：根据用户贴回的完整调试日志继续修掉一条真实链路 bug。日志显示：`return-to-start-before-flush -> flush-cache-end` 后 local cache 仍然保持在原 session `session_5448...`、`messageCounts.npc-1 = 2`；但随后并没有出现 `resume-latest-start`，而是直接持久化成了一个全新的 active session `session_049f...`，且标题仍是同一案《霜降别墅密室疑案》。这说明用户当时并没有真正走到“继续最近一局”恢复函数，而是从开始页右侧**点进了同名归档项**，于是 `loadArchive()` 又新开了一局同名会话，看起来像“返回开始后再进来聊天消失”。为避免这种同名案入口继续误伤，修改 `src/web/static/app.js`：开始页 archive list 中如果某条归档标题与当前浏览器 local cache 里的 `sessionPreview.title` 相同，就把该归档项标成 `（当前这局）`，并将点击行为改成直接走 `resumeLatest()` 而不是 `loadArchive()`；同时补上 `click-resume-latest-button` / `click-resume-latest-archive` / `click-archive-start` 调试日志，方便后续继续区分到底点中了哪个入口。同步更新 `README.md`，明确“若归档列表里正好出现当前这局同名案件，点该项会直接继续当前这局，不会再新开一局同名会话”。测试补充：`tests/web-app-cache.test.ts` 新增第 13 个 case，验证当归档标题与 local cache 当前案件同名时，开始页渲染结果必须带 `data-resume-latest="true"` 和“当前这局 / 点这里继续当前浏览器这局”文案。fresh evidence：再次执行 `npm run build`、`npm test`（现为 14 个测试文件、49 条测试全部通过）与 `node --check src/web/static/app.js`，并重启 `WEB_PORT=30001` 后直接检查 `http://127.0.0.1:30001/app.js`，确认已对外包含 `data-resume-latest` 与 `click-resume-latest-archive`。当前状态：就这次用户贴回的日志看，local cache 本身没丢，真正丢的是“从开始页重新进入时误点了同名归档又开出一局新 session”；这条误伤路径现在已经被直接改成“同名归档也继续当前这局”。
- 2026-06-18 19:14：按用户要求继续做全盘自查并直接修掉一批明确的低级状态流 / 配置 / 数据问题。修改 `src/web/static/app.js`：1）新增 `suppressedChatCacheSessionId`，让“清空本地缓存”后同一局不会又被 `beforeunload` 或后续 persist 重写回 localStorage；2）`clearChatLocalCacheAction()` 现在会先中断语音输入，再清空本地缓存；3）`clearSelection()` / `inspectNode()` / `openCharacterChat()` 不再把 solved 局的 `judgement` 直接抹掉，配合 `renderMainPanel()` 调整后，结案后切到人物 / 节点再回到案件背景仍能看到结果页；4）`loadArchive()` 增加错误提示，不再对已删除归档静默失败；5）继续保留调试日志与当前这局归档入口标记。修改 `src/web/server.ts`，补上 admin bootstrap 里的 `sourceModel / reviewModel / presetId / reviewPresetId`，让管理后台归档列表不再稳定显示“未知”。修改 `src/case/schema.ts`，把默认 `sceneIllustration.figures` 的 schema 上限从 6 提升到 8，避免“缺省场景构图 -> 首次 normalize 成功 -> 二次 parse 因角色过多直接炸掉”。修改 `src/archive/story-archive.ts`，导入剧情 JSON 时会重写新的 `mysteryCase.id`，避免导入同案不同版本后覆盖 SQLite 里旧案件、连带污染旧 session。修改 `src/cli/run.ts`，CLI 从归档列表返回时不再意外 fall through 到“生成新案件”。修改 `src/config/runtime-config.ts`，对 `CASE_GENERATOR_PRESET_ID / CASE_REVIEWER_PRESET_ID` 做更高优先级处理，让 generator / reviewer 显式 preset 能覆盖通用 `OPENAI_*` 环境变量。测试补充：`tests/web-app-cache.test.ts` 新增 solved 结果页切换后仍能回到结果、清空本地缓存不再生成 snapshot、同名归档入口标记等 case；`tests/schema.test.ts` 新增“缺省 sceneIllustration 且角色较多时二次解析仍能通过”；`tests/archive.test.ts` 新增“导入案件 JSON 时生成新案件 id”；`tests/config.test.ts` 新增“generator/reviewer 显式 preset 覆盖通用 OPENAI 环境变量”。fresh evidence：执行 `npm run build`、`npm test`（现为 14 个测试文件、53 条测试全部通过）、`node --check src/web/static/app.js && node --check src/web/static/admin.js`；补一轮 CLI 最小 smoke（`printf '4\n' | node dist/src/index.js`）验证开始菜单仍可正常退出；并再次重启 `WEB_PORT=30001` 后检查 `/app.js` 与 `/api/bootstrap`，确认当前预览已带上调试 helper、当前这局归档标记，且 bootstrap 不再残留 `latestSession`。当前剩余风险：语音输入 websocket stale session 自动清理、流式模型报错与 assistant 文本混流、以及更细的 admin / import/export 生命周期 smoke 还可以继续加固，但这轮已经把当前分支里一批最容易反复踩到的低级状态流问题先清掉。
- 2026-06-18 19:26：按用户要求把 Web 前端当前的调试日志从浏览器控制台默认输出中移除。修改 `src/web/static/app.js`，让 `debugChatCache()` 仅在显式设置 `window.__mysteryDebugToConsole === true` 时才向 console 打印 JSON 调试行；默认情况下仍保留内存里的调试记录与导出 helper，但不再污染用户控制台。fresh evidence：执行 `npm run build`、`npm test`（现为 14 个测试文件、54 条测试全部通过），并重启 `WEB_PORT=30001` 预览实例。当前状态：控制台默认不会再刷一大堆 `[Mystery Cache Debug] ...`，只有需要时手动开 debug 开关才会输出。
- 2026-06-18 21:50：继续按用户要求收口“生成失败无提示 / 模型输出被截断 / 低级显示问题”。修改 `src/web/static/admin.js` 与 `src/web/server.ts`：admin bootstrap 现在显式带上 `latestGenerationJob`，后台顶部会把最近一次失败渲染成明显的红色错误卡片，当前轮询中的 job 如果直接进入 `failed`，也会立刻弹出错误弹窗并把失败信息写入 `state.error`；配套在 `src/web/static/styles.css` 增加 `note-error` 样式。修改 `src/llm/openai-gateway.ts`：structured JSON 在 `finish_reason === "length"` 后，会把上一次截断前缀带进 retry note，并显著放大后续 retry 的 `max_tokens`，提示模型“必须从头重写完整 JSON，不要续写半截”；这轮同时继续保留已有的 tool_call -> json_object 回退。修改 `src/case/generator.ts`：playable 修订 prompt 改成精简版 currentCase（只保留主干字段和必要人物/节点/solution 信息），减少“评审后修订一定截断”的 prompt 体量；并把 playable `maxAttempts` 从 2 提升到 3，给修订链路多一轮机会。修改 `src/case/visuals.ts`：嫌疑人 / NPC 头像 SVG 不再纯靠 hash 撞色，优先按 index 选 palette，至少首批角色会明显分色。顺手继续修 `src/web/static/app.js`：1）`clearChatLocalCacheAction()` 清缓存后不会再被本局自动写回；2）solved 局切角色/节点后回背景仍保留结果页；3）流式聊天里如果服务端写回 `\n\n[系统] 回复中断：...`，前端会拆成单独 system message，不再像角色自己说出系统错误。修改 `src/archive/story-archive.ts`、`src/config/runtime-config.ts`、`src/cli/run.ts`、`src/case/schema.ts` 等一批基础文件，继续清掉全盘自查里发现的低级问题（导入覆盖旧案、role preset 优先级、CLI 归档返回误生新局、sceneIllustration 角色过多二次 parse 失败等）。测试补充：新增 `tests/admin-ui.test.ts`；扩展 `tests/openai-gateway.test.ts` 覆盖截断后 retry 会放大 `max_tokens` 并带上上次输出前缀；扩展 `tests/schema.test.ts` 覆盖嫌疑人头像配色分散；现有 `tests/web-app-cache.test.ts` 继续保持 15 个 case 覆盖 Web 本地恢复状态机。fresh evidence：执行 `npm run build`、`npm test`（现为 15 个测试文件、58 条测试全部通过）、`node --check src/web/static/app.js && node --check src/web/static/admin.js`，并重启 `WEB_PORT=30001` 预览实例；另直接检查 SQLite 与 30001 日志，确认最近两次 admin 生成失败时**没有新 case / session 落库**，失败发生在 `store.saveCase()` 之前，数据库里最新成功案件仍停留在《镜湖遗书》。当前剩余风险：虽然修订 prompt 已经瘦身、retry token 已放大、playable 尝试轮数也增加，但真实模型仍可能在极端长输出时再次截断；还需要继续观察一轮真实 admin/harness 生成是否明显改善。如果后续仍频繁卡在修订轮，就要进一步把修订拆成“只修主干字段”的更小 patch prompt，而不是继续整体重写。
- 2026-06-18 22:05：按用户最新要求，把**失败生成记录持久化到 SQLite**。修改 `src/session/store.ts`，新增 `generation_failures` 表，以及 `StoredGenerationFailure`、`recordGenerationFailure()`、`getLatestGenerationFailure()`、`listGenerationFailures()`；修改 `src/web/server.ts`，在 `startGenerationJob()` catch 中将失败 job（jobId、模板、阶段、轮次、用户可见错误、rawError、可截断的 partialOutput、生成/评审模型与 preset、时间）写入 SQLite，并在 player/admin bootstrap 中额外暴露 `latestGenerationFailure` 预览；修改 `src/web/static/admin.js`，后台顶部现在会显示“最近一次失败记录（已落库）”，即使当前内存 job 早已丢失，刷新后台也还能看到最近一次持久化失败。同步更新 `README.md` 说明“失败生成记录会持久化到 SQLite”。测试补充：`tests/session-store.test.ts` 现已覆盖失败记录写入与读取；`tests/admin-ui.test.ts` 新增“最近一次已落库失败记录”渲染 case。fresh evidence：再次执行 `npm run build`、`npm test`（现为 15 个测试文件、59 条测试全部通过）与 `node --check src/web/static/app.js && node --check src/web/static/admin.js`。当前状态：生成失败现在不再只留在进程内存和日志里，最少有一份 SQLite 持久化记录可追；后续如果还需要查历史明细，可以再把 `listGenerationFailures()` 暴露成 admin 列表或下载接口。
- 2026-06-18 23:11：按“自己 diff 检查完再 commit”的收口要求又做了一轮分支自查，并修了两处明确问题。第一，`src/web/static/app.js`、`src/web/server.ts`、`src/archive/story-archive.ts` 现在把 `caseId` 一并带到 session preview / archive summary，开始页“当前这局”判定从“同标题”收紧为“同 caseId”，避免导入同名不同案后把另一份归档误判成当前局而无法点开；同步更新 `README.md` 对这条行为的描述。第二，`src/llm/openai-gateway.ts` 现在会把结构化输出截断或校验失败时的 `partialOutput` 显式挂到错误对象上，保证 `generation_failures` 落库时能真正保存那段截断前缀，便于之后排查模型坏 JSON / 截断问题；同步补充 `tests/openai-gateway.test.ts` 与 `tests/web-app-cache.test.ts` 覆盖。fresh evidence：重新执行 `npm run build`、`npm test`（现为 15 个测试文件、60 条测试全部通过）；按仓库要求额外执行了 `npm run harness:cases -- --count=1`，本次在默认超时下失败于 `模型请求超时（>120 秒）`；随后尝试 `OPENAI_TIMEOUT_MS=300000 npm run harness:cases -- --count=1` 做长超时验证，但因真实模型等待过长被用户手动中断，没有拿到新的完整 harness 成功证据。当前剩余风险：本轮代码级 diff 自查后未再发现新的明确逻辑问题，但真实生成链路仍受模型耗时和截断波动影响，尤其 harness 仍可能因超时/长等待而无法快速给出 fresh pass 结果。

## 审查
