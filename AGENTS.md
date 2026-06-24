# Repository AGENTS

## 项目定位

- 这是一个中文悬疑推理游戏原型仓库。
- 当前同时提供 Web 和 CLI 入口，但核心目标仍然是先把“生成案件 -> 调查 -> 对话 -> 指认 -> 复盘”做成稳定闭环。

## 开工前先看

- 优先阅读 `README.md`
- 再看 `.agents/plans/2026-06-17-suspense-game-framework.md`
- 涉及案件生成、评审、归档时，顺手看：
  - `src/case/`
  - `src/archive/`
  - `src/harness/`
- 涉及浏览器玩法时，顺手看：
  - `src/web/`

## 仓库关键约束

- 不要移除案件质量门禁和模型评审回路。
- 不要破坏归档案件可重玩的能力。
- 不要破坏 Web 可试玩链路和 NPC 流式回复体验。
- 不要为了“更自由”放松到让嫌疑人能改写真相。
- 这个项目涉及浏览器页面检查、交互或调试时，**只能使用 `chrome-devtools`**。
- **严禁使用 Playwright**（包括 `playwright`、`@playwright/*`、`playwright-core` 等相关包、命令、MCP、脚本或浏览器下载行为）。
- **严禁通过 Playwright 下载 Chrome / Chromium / WebKit / Firefox / Edge 等任何浏览器二进制**；如果需要浏览器自动化，只能改用 `chrome-devtools`。

## 执行纪律

- 遇到明确工具报错时，先直接说明原因，再只做最直接的恢复动作；不要问无关问题，不要绕路试无关工具。
- 禁止用空转调用充数（例如无意义的 `question`、空 `task`、`true`、`printf ''`）。
- 涉及页面问题时，先用指定浏览器工具拿到真实现象，再改代码；没拿到证据前不要靠猜测改前端。

## 模型与速度

- 案件生成 / 案件评审优先使用更快的模型配置。
- 不要默认切回明显更慢的模型，除非你有明确理由。
- 如果要使用 presets，必须由当前项目显式通过环境变量指定，不要让仓库默认依赖别的项目配置文件。

## 归档要求

- 每个通过门禁和评审的案件都要归档。
- 归档目录默认是 `data/approved-cases/`。
- 新增质量链路、harness 或案件格式时，要优先保证旧归档仍然可读取或可平滑迁移。

## 改动案件生成时

- 优先同时检查：
  - `src/case/schema.ts`
  - `src/case/generator.ts`
  - `src/case/quality.ts`
  - `src/case/reviewer.ts`
- 不要只改 prompt，不改校验与验证。
- 如果你提升了复杂度，也要考虑耗时是否被明显拉爆。

## 改动后最低验证

### 文档或纯说明改动

- 至少回读相关文档，确认命令、路径、目录名真实存在。

### 代码改动

至少执行：

```bash
npm run build
npm test
```

### 涉及案件生成 / 评审 / 归档 / harness 的改动

额外执行：

```bash
npm run harness:cases -- --count=1
```

如果改动影响了归档入口，还要补一次：

- 从归档案件开始的 CLI 重玩验证

## Secrets

- 不要把外部 preset 文件里的 token 抄进仓库。
- 不要提交 `.env`。
- 不要把含秘钥的调试输出写进文档或归档样例。

## 文档同步

- 用户可直接试玩的行为变化，要同步 `README.md`
- 仓库级约束变化，要同步 `AGENTS.md`
- 实现进展和验证结果要同步到计划文档的 `## 实现`
