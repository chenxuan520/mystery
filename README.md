# Mystery CLI

一个本地可运行的中文悬疑推理 CLI 游戏原型。

它会：

- 生成一桩结构化案件
- 让你调查固定线索节点
- 让你和多个嫌疑人对话
- 让嫌疑人回答以流式方式逐步出现
- 支持最终指认真凶并查看真相还原
- 对合格案件做归档，方便后续反复试玩

## 当前形态

- 浏览器可玩的本地 Web 游戏
- 仍保留 CLI 入口
- SQLite 本地存档
- OpenAI-compatible 接口
- 案件生成 + 案件评审双模型链路
- 合格案件自动归档到 `data/approved-cases/`

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
- 浏览器聊天输入
- NPC 流式回复
- 案发场景、人物头像的 SVG 展示
- 双击 SVG 可放大查看
- 生成新案件时，刷新或回到首页后会自动恢复进度提示

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

- 点击“生成新案件”开始新局
- 如果生成过程中离开或刷新，回到首页会继续显示当前进度
- 或点击归档案件直接重玩历史好案
- 游戏页顶部可直接返回开始页或导出当前案件 JSON
- 左侧点调查节点看线索
- 左侧点嫌疑人进入对话
- 在聊天框里追问嫌疑人
- 点击“指认某人”完成结案

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
- `2` 询问嫌疑人
- `3` 查看嫌疑人档案
- `4` 查看已知线索
- `5` 指认真凶
- `6` 重新查看案件摘要
- `7` 保存并退出

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
- `src/chat/`：嫌疑人对话
- `src/judgement/`：结案判定与复盘
- `src/session/`：SQLite 存档与聊天记录
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
