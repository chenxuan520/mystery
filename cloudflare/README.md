# Cloudflare 版部署说明

这个目录提供一套独立的 Cloudflare Workers 适配层：

- Web 玩家界面
- `/admin` 管理后台
- Workers AI 文本生成 / 流式聊天
- Workers AI 语音识别
- KV 持久化案件、会话、归档、设置和生成任务

## 当前实现边界

- 继续复用根目录现有的前端页面与玩法逻辑。
- CLI 仍保留在本地，不搬到 Cloudflare。
- 存储使用 **KV**，不使用 D1。
- 模型统一改走 **Workers AI**。
- 当前更稳的使用方式是：**本地生成归档 JSON，再到 Cloudflare `/admin` 导入**。

## 先准备什么

1. 创建一个 KV namespace
2. 把 `cloudflare/wrangler.jsonc` 里的 `APP_KV` namespace id 改成你的真实 id
3. 按需设置 admin 账号密码 secret

推荐 secret：

```bash
cd cloudflare
wrangler secret put ADMIN_USERNAME
wrangler secret put ADMIN_PASSWORD
wrangler secret put ADMIN_SESSION_SECRET
```

## 默认模型

默认配置：

- 游玩 / 生成 / 评审：`@cf/mistralai/mistral-small-3.1-24b-instruct`
- 语音输入：`@cf/openai/whisper-large-v3-turbo`

也可以在 `wrangler.jsonc` 里改：

- `PLAY_MODEL`
- `GENERATOR_MODEL`
- `REVIEW_MODEL`
- `VOICE_INPUT_MODEL`

## 本地开发

```bash
cd cloudflare
npm install
npm run dev
```

## 类型检查

```bash
cd cloudflare
npm run check
```

## 部署

```bash
cd cloudflare
npm run deploy
```

## 批量导入本地归档

如果你想把仓库根目录 `data/approved-cases/` 里的本地已归档案件批量导到 Cloudflare 网页端：

```bash
cd cloudflare
npm run import:approved
```

默认行为：

- 目标站点默认是 `https://mystery.011203.xyz`
- 默认读取根目录 `.env` 里的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- 按**案件标题**去重；远端已经有同名案件时会直接跳过

可通过环境变量覆盖：

- `BASE_URL`
- `APPROVED_CASES_DIR`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ROOT_ENV_PATH`

## 目前已知取舍

- KV 是最终一致存储，不是强一致数据库。
- 语音输入已经切到 Workers AI，但当前后端实现以**停止录音后的整段转写**为主，不再依赖火山语音的实时流式识别链路。
- 生成任务使用 Worker + KV 的轻量 job 方案，适合当前原型，但不等于完整持久任务系统。
- Cloudflare 端的“直接生成新案件”目前仍受远端模型结构化输出稳定性影响；如果你要稳定试玩，推荐继续沿用“本地生成 -> `/admin` 导入 -> 云端重玩 / 聊天 / 指认 / 语音输入”这条链路。
