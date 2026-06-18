# 悬疑推理游戏原型

一个本地可运行的悬疑推理游戏原型，当前以 Web 为主，CLI 作为补充入口。

它会：

- 生成一桩结构化案件
- 让你调查固定线索节点
- 让你和多个嫌疑人对话
- 让嫌疑人回答以流式方式逐步出现
- 支持最终指认真凶并查看真相还原
- 对合格案件做归档，方便后续反复试玩

## 当前形态

- 浏览器可玩的本地 Web 游戏
- 独立的 `/admin` 管理后台
- 仍保留 CLI 入口
- SQLite 本地存档（案件与会话状态）
- OpenAI-compatible 接口
- 案件生成 + 案件评审双模型链路
- 合格案件自动归档到 `data/approved-cases/`
- 逐条聊天原文默认不再写入 SQLite
- 场景图 / 角色头像 SVG 为运行时生成，不默认写入 SQLite / 归档 JSON

## 安装

```bash
npm install
```

## 配置

### 方式 1：直接用 `.env`

复制一份配置：

```bash
cp .env.example .env
```

至少配置：

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

### 方式 2：显式使用本地 AI presets（可选）

项目支持通过 YAML presets 显式指定生成模型和评审模型。

注意：**项目默认不会依赖任何仓库外的配置文件**。

如果你确实想用 presets，请自己准备一个本地文件，例如：

```text
config/ai-presets.local.yaml
```

仓库里提供了结构示例：

`config/ai-presets.example.yaml`

然后显式设置：

```bash
AI_PRESET_PATH=config/ai-presets.local.yaml
CASE_GENERATOR_PRESET_ID=deepseek-v4-pro
CASE_REVIEWER_PRESET_ID=deepseek-v4-pro
```

可通过环境变量覆盖：

- `AI_PRESET_PATH`
- `AI_PRESET_ID`
- `CASE_GENERATOR_PRESET_ID`
- `CASE_REVIEWER_PRESET_ID`

如果你准备使用管理后台做模型切换，建议在 `AI_PRESET_PATH` 里放多组 presets，后台会把这些 preset 作为可切换选项展示出来。

### 管理后台账号（必配，启用 admin 时）

管理后台的登录账号密码走本项目本地环境变量：

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_me
```

不配置这两个字段时，`/admin` 仍可打开，但会提示后台未启用。

### Web 语音输入（可选）

Web 版对话框支持“语音转文字”。

- **没配火山 ASR 时，语音输入按钮不会显示**
- 配好后，识别结果会在录音过程中**持续流式写进聊天输入框**，但**不会自动发送**
- 凭证仍然只放在本项目本地配置里，不会下发到浏览器

在 `.env` 里补上：

```bash
VOICE_INPUT_CONFIG_PATH=/Users/yourname/.config/opencode/voice2text.local.json
VOICE_INPUT_APP_ID=your_volcengine_app_id
VOICE_INPUT_ACCESS_TOKEN=your_volcengine_access_token
VOICE_INPUT_RESOURCE_ID=volc.seedasr.sauc.duration
VOICE_INPUT_ENDPOINT=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
VOICE_INPUT_LANGUAGE=zh-CN
VOICE_INPUT_CHUNK_MS=200
VOICE_INPUT_END_WINDOW_SIZE=800
VOICE_INPUT_MAX_DURATION_SECONDS=180
```

如果你手头已经有 opencode 语音插件那套火山配置，推荐直接显式设置 `VOICE_INPUT_CONFIG_PATH=/Users/你的用户名/.config/opencode/voice2text.local.json` 复用现成本地文件；也兼容旧字段名 `OPENCODE_VOICE2TEXT_*`。项目不会在没有显式配置的情况下自动去找这份全局文件。

## 运行

### 推荐：Web 版

```bash
npm run web
```

默认地址：

```text
http://127.0.0.1:3001
```

如需改端口：

```bash
WEB_PORT=3010 npm run web
```

Web 版支持：

- 点击式调查
- 点击式嫌疑人 / NPC 切换
- 提示官问答与渐进式提示
- 结案后可直接在结果页继续向提示官追问真相细节，且这段复盘问答会和左侧提示官普通聊天分开记忆
- 浏览器聊天输入
- 当前会话的聊天视图会缓存到浏览器本地，刷新后可恢复
- 顶部工具条支持清空本地聊天缓存
- 关键操作使用站内确认弹窗，而不是浏览器原生 confirm
- 对话框语音转文字（已配置时显示，识别结果流式回填）
- NPC 流式回复
- 案发场景、人物头像的 SVG 展示
- 双击 SVG 可放大查看
- 玩家界面不再直接生成案件，新增案件交给管理后台处理

### CLI 版

开发模式：

```bash
npm run dev
```

构建后运行：

```bash
npm run build
node dist/src/index.js
```

## 怎么玩

### Web 版

推荐直接用浏览器玩。

启动后：

- 点击归档案件直接重玩历史好案，或继续最近一局
- “继续最近一局”只认当前浏览器 local cache 里那一局；如果这台浏览器本地没有缓存，就不会替你去服务端猜一局
- 如果归档列表里出现的就是当前这局对应的那份归档，它会标成“当前这局”，点它会直接继续当前这局，而不会额外新开一局
- 游戏页顶部可直接返回开始页或导出当前案件 JSON
- 左侧点调查节点看线索
- 左侧点嫌疑人、相关人物或提示官进入对话
- 在聊天框里追问嫌疑人；如果已配置语音输入，也可直接点“语音输入”边说边把文字流式回填进输入框，再自己确认发送
- 如果你对背景设定、公开信息或已发现线索的理解不确定，可以直接问提示官；只有你明确说自己卡住了、或者直接要提示时，他才会渐进式推你一小步
- 结案或直接看答案后，如果你对真相里的某个细节还没看懂，可以直接在结果页继续问提示官，他会按已揭晓真相直接解释原因链条；这段复盘问答会和左侧提示官的普通聊天分开记忆
- 刷新页面后，当前这局与当前聊天对象会优先从浏览器本地缓存恢复；如果当时停在结果页里的提示官复盘追问，也会按独立会话一起恢复；如果你不想保留，顶部可点“清空本地缓存”
- 当前逐条聊天原文默认只保留在浏览器本地缓存里，请求模型时会由前端把当前角色的历史对话一并带上；服务端 SQLite 不再保存这些逐条聊天原文
- 点击“指认某人”完成结案

### Admin 后台

管理后台地址：

```text
http://127.0.0.1:3001/admin
```

当前支持：

- 登录鉴权（账号密码来自本项目本地环境变量）
- 只管理**归档案件**
- 删除归档案件
- 按模板生成新案件并归档
- 切换玩家 / 生成 / 评审模型（来自 `AI_PRESET_PATH` 中的 presets）
- 生成失败时会在后台顶部显示明显的失败提示，方便直接重试或换模型
- 失败生成记录会持久化到 SQLite，后台会显示最近一次已落库失败记录

注意：玩家界面不再提供“生成新案件”入口。

### CLI 版

启动后会看到开始菜单：

- 生成新案件
- 从归档案件开始
- 退出

如果你想直接试玩已经通过质量门禁的案件，选：

```text
从归档案件开始
```

进入案件后主菜单包括：

- `1` 查看调查节点
- `2` 询问角色（嫌疑人 / 相关人物 / 提示官）
- `3` 查看角色档案
- `4` 查看已知线索
- `5` 指认真凶
- `6` 重新查看案件摘要
- `7` 保存并退出

说明：CLI 的对话上下文现在只保留在当前进程内，用于维持这一局里的连续追问；退出 CLI 后，逐条聊天原文不会继续写入 SQLite，也不会像 Web 那样有浏览器本地恢复。

推荐顺序：

1. 先看嫌疑人档案
2. 调查 2~3 个线索节点
3. 回到已知线索页整理疑点
4. 再去盘问嫌疑人
5. 继续补调查后再指认

## 归档案件

所有通过门禁和模型评审的案件都会保存到：

```text
data/approved-cases/
```

这些案件会保存：

- 案件 JSON
- 评审分数
- 生成诊断信息
- 模型来源信息

你可以随时从 CLI 菜单重新载入它们。

## 案件质量链路

当前不是“生成一次就直接开玩”，而是：

1. 生成结构化案件
2. 跑确定性复杂度门禁
3. 跑大模型案件评审
4. 合格才归档

所以高质量案件通常会比普通聊天生成更慢一些。

## 当前支持的案件模板

- `locked-room`：封闭场景谋杀
- `alibi`：不在场证明案
- `poison`：投毒案
- `staged-suicide`：伪自杀案
- `inheritance`：遗产争夺案
- `body-relocation`：移尸案
- `blackmail`：勒索灭口案
- `cold-case`：旧案牵连案
- `identity-fraud`：身份伪装案

## Harness

批量验证案件质量：

```bash
npm run harness:cases -- --count=1
```

常用参数：

- `--count=3`：生成几局
- `--template=poison`：指定模板（也可用 `locked-room` / `alibi` / `staged-suicide` / `inheritance` / `body-relocation` / `blackmail` / `cold-case` / `identity-fraud`）
- `--output=/tmp/report.json`：输出报告
- `--archive-dir=data/approved-cases`：指定归档目录
- `--generator-preset=deepseek-v4-pro`：覆盖生成模型 preset
- `--reviewer-preset=deepseek-v4-pro`：覆盖评审模型 preset

Harness 会：

- 打印当前生成模型和评审模型
- 实时显示每局进度
- 为合格案件归档
- 输出 JSON 报告

## 常用命令

```bash
npm run build
npm test
npm run web
npm run dev
npm run harness:cases -- --count=1
```

## 目录说明

- `src/cli/`：CLI 主循环
- `src/case/`：案件 schema、模板、生成、质量门禁、评审
- `src/chat/`：角色对话、提示官与对话记忆
- `src/judgement/`：结案判定与复盘
- `src/session/`：SQLite 存档与会话状态
- `src/voice/`：火山语音转文字接入
- `src/archive/`：合格案件归档
- `src/harness/`：批量生成与评估
- `src/web/`：浏览器版服务端与静态页面
- `tests/`：自动化测试
- `data/approved-cases/`：归档后的合格案件

## 当前已知情况

- 高复杂度案件的生成耗时仍然偏高
- 模型输出偶尔仍会波动，但现在已有门禁和评审兜底
- 归档案件已经支持直接重玩
- preset 支持是**显式 opt-in**，项目默认不依赖任何其他仓库配置
