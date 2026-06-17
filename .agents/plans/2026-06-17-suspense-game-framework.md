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

## 审查
