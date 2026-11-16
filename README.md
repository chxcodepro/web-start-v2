# 浏览器开始页

一个适合作为浏览器首页的收藏页：默认展示分组网址，搜索框支持 Google / Bing 与实时补全；GitHub Star 在独立页面展示。访客可以直接浏览，只有指定的 GitHub 账号能登录管理。

## 已实现

- 网址与 GitHub Star 独立顶层页面
- 网址分组、增删改、公开状态、拖动与键盘按钮排序
- Google / Bing 搜索，支持 `g 关键词`、`b 关键词` 临时切换
- 本地网址优先、搜索提供商补全随后、网络失败时仍保留搜索动作
- URL / 域名直接打开，方向键、Enter、Escape、Shift + Enter
- GitHub OAuth 单一管理员登录
- GitHub Star 手动同步与 Vercel 每日定时同步
- GitHub Star 本地分组、自定义名称、标签、备注及公开状态
- GitHub Release 版本与文件选择、代理加速下载；访客可下载公开 Star，无 Release 时下载默认分支源码
- 无确认直接取消 Star，失败自动回滚，成功后可撤销
- AI 整理：只在现有分组里为书签和 Star 挑选合适的分组，审阅确认后才移动，应用后可撤销
- Supabase 仅由服务端访问；公开页面使用 Next.js 缓存
- 未配置外部服务时自动使用演示数据，仍可构建和预览

## 本地运行

要求 Node.js 20.9 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 `http://localhost:3000`。没有填写环境变量时会显示演示数据，管理页会提示配置数据库。

## 1. 创建 Supabase 数据库

为了改善中国大陆访问体验，建议创建 **Singapore (ap-southeast-1)** 区域项目。浏览器不会直接请求 Supabase；公开请求由部署在新加坡的 Vercel Function 读取并缓存，因此数据库的跨境延迟不会落在每个访客身上。

1. 在 Supabase SQL Editor 按编号执行 [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql) 和后续迁移；已有数据库还需要执行 [`supabase/migrations/002_star_display_name.sql`](supabase/migrations/002_star_display_name.sql) 和 [`supabase/migrations/003_star_topics.sql`](supabase/migrations/003_star_topics.sql)。
2. 在 Project Settings → API 获取 Project URL 和 `service_role` key。
3. 填写 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`。

`service_role` 只能放在本地 `.env.local` 和 Vercel Environment Variables，绝不能提交或暴露给浏览器。

## 2. 配置 GitHub 登录

在 GitHub → Settings → Developer settings → OAuth Apps 创建应用：

- Homepage URL：本地为 `http://localhost:3000`，上线后改为正式域名
- Authorization callback URL：本地为 `http://localhost:3000/api/auth/callback/github`
- 线上回调：`https://你的域名/api/auth/callback/github`

配置：

- `AUTH_SECRET`：可用 `npx auth secret` 生成
- `AUTH_GITHUB_ID`：OAuth App Client ID
- `AUTH_GITHUB_SECRET`：OAuth App Client secret
- `GITHUB_OWNER_LOGIN`：唯一允许进入后台的 GitHub 用户名（不区分大小写）

其他 GitHub 账号即使完成 OAuth，也会被拒绝登录。

完成配置后：

1. 重启本地开发服务或重新部署 Vercel，让环境变量生效。
2. 点击页面右下角的登录图标，进入 GitHub 授权页。
3. 授权成功后自动进入 `/manage`；顶部出现“已登录”即表示管理员身份验证完成。
4. 在“书签与分组”或“GitHub Star”标签中改名、分组、填写备注并排序。

## 3. 配置 GitHub Star 同步

创建 Fine-grained personal access token，Repository access 可选 Public repositories，权限至少包含：

- Starring：Read and write
- Metadata：Read-only

将 token 写入 `GITHUB_TOKEN`。同步规则：

- 新 Star 自动进入“未分组”
- 已有仓库只更新 GitHub 元数据，不覆盖本地分组、自定义名称、标签和备注
- GitHub 上已经移除的 Star 会在本地标记为归档
- 后台取消 Star 时先请求 GitHub，成功后更新数据库；数据库失败会尝试恢复 GitHub 状态

Release 下载默认使用 `https://gh-proxy.com/` 加速。可通过 `GITHUB_DOWNLOAD_PROXY` 更换代理前缀；设为 `direct` 则直接使用 GitHub 下载地址。访客只能查询当前公开展示的 Star，管理员可查询全部 Star；Release 元数据由服务端读取并缓存五分钟，GitHub Token 不会发送给浏览器或下载代理。

## 4. 配置 AI 整理（可选）

管理模式的工具条里有「AI 整理」：选择范围（勾选的条目、未分组的 Star 或全部）后，AI 参考现有分组的名称和每组示例，为每一项挑选合适的分组。建议按目标分组列出，可以取消勾选或改成别的分组，确认后才会保存；应用后右下角提示里可以撤销。

AI 只使用你已有的分组，不会新建分组；没有合适分组的条目保持不动。想单独成组的内容，先手动新建分组（空分组也会提供给 AI，按名称理解），再整理一次。一个分组都没有时无法开始分析。

支持三种接口格式，`AI_PROVIDER` 决定用哪种格式和哪组请求参数；不填时按 `AI_BASE_URL` 的官方地址自动识别，其余地址按 DeepSeek 处理：

| 渠道 | `AI_PROVIDER` | 接口格式 | 默认模型 | 请求参数 |
| --- | --- | --- | --- | --- |
| DeepSeek（默认） | `deepseek` 或不填 | OpenAI Chat Completions | `deepseek-flash` | 关闭思考模式、`max_tokens`、JSON Output |
| OpenAI | `openai`；`api.openai.com` 自动识别 | OpenAI Chat Completions | `gpt-6-luna` | `max_completion_tokens`、`reasoning_effort: low`、结构化输出（JSON Schema） |
| Anthropic（Claude） | `anthropic` 或 `claude`；`api.anthropic.com` 和 `/anthropic` 路径自动识别 | Anthropic Messages（官方 SDK） | `claude-opus-5-5` | `output_config.effort: low`、结构化输出；Claude Opus 等模型拒答时由服务端自动换模型重试 |
| Gemini | `gemini` 或 `google`；`generativelanguage.googleapis.com` 自动识别 | Gemini `generateContent` | `gemini-3.5-flash-lite` | `thinkingLevel: LOW`、`responseJsonSchema` |
| 其他兼容接口（中转、通义千问、Kimi、智谱、OpenRouter 等） | 其他任意名称，如 `compatible` | OpenAI Chat Completions | 无，必须填写 `AI_MODEL` | `max_tokens`、`temperature`、JSON Output |

- `AI_BASE_URL`：接口地址，常见写法：
  - DeepSeek 官方：`https://api.deepseek.com`；DeepSeek 的 Anthropic 格式：`https://api.deepseek.com/anthropic`（需要把 `AI_MODEL` 设为 `deepseek-flash`）
  - OpenAI 官方：`https://api.openai.com/v1`；其他 OpenAI 格式的接口填到 `/v1` 为止，也可以直接填完整的 `/chat/completions` 地址（可带查询参数）
  - Anthropic 官方：`https://api.anthropic.com`；Anthropic 格式的中转填到 `/v1` 之前，多填的 `/v1`、`/v1/messages` 会自动去掉
  - Gemini 官方：`https://generativelanguage.googleapis.com`；中转可以填到 `/v1beta`，也可以直接填完整的 `:generateContent` 地址。Gemini 的 OpenAI 兼容地址（`/v1beta/openai`）按通用兼容接口处理
- `AI_API_KEY`：接口密钥，只在服务端读取
- `AI_PROVIDER`、`AI_MODEL`：见上表
- `AI_REASONING_EFFORT`：可选，推理强度，如 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。各渠道默认 `low`（Anthropic 没有 `none`、`minimal`，按 `low` 处理；Gemini 映射到对应的 `thinkingLevel`）；DeepSeek 默认关闭思考，填写后开启

端点不支持某个可选参数时（如 `max_tokens`、`thinking`、`temperature`、结构化输出、服务端兜底、`thinkingLevel`），会根据 400 错误里提到的参数自动改写或去掉后重试；某一批超时或输出被截断时，前端会把这一批拆成两半重新分析。审阅结果下方会显示实际使用的渠道和模型。

发给 AI 的内容只有条目的名称、链接、描述、标签、备注，以及 Star 的语言和 topics；每批最多 40 项，接口只返回建议，不直接写数据库。Star 的 topics 来自同步，执行 `003_star_topics.sql` 后重新同步一次即可补齐。

## 5. 部署到 Vercel

1. 将项目推送到 GitHub，再导入 Vercel。
2. 在 Vercel 配置 `.env.example` 中的全部环境变量。
3. 生成一个随机长字符串写入 `CRON_SECRET`。
4. 部署后更新 GitHub OAuth App 的 Homepage 与 callback URL。

[`vercel.json`](vercel.json) 已将 Functions 固定到 `sin1`，并每天北京时间 03:17（UTC 19:17）同步 GitHub Star。Vercel 会用 `CRON_SECRET` 保护 Cron 请求。

当前 Vercel 项目 `start-web` 已关联 GitHub 仓库 `chxcodepro/web-start-v2`，生产分支为 `main`。推送到 `main` 会自动构建，构建成功后更新正式站点 `https://start.chxpro.com`；其他分支使用 Preview 部署，无需再手动运行生产发布命令。

自动部署依赖 Vercel 的 GitHub 集成和仓库访问权限。构建失败时先查看 Vercel Deployment 的日志，不要重复运行 CLI 发布；手动部署仅用于明确需要的应急发布。数据库和 OAuth 等凭据继续保存在 Vercel 环境变量中，不写入仓库或 GitHub Actions。

## 验证命令

```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run test:ai
```

`npm run test:ai` 会用模拟的数据库、AI 接口和登录会话启动独立的开发服务，在浏览器里跑完整的 AI 整理流程；设置 `SMOKE_PROVIDER` 为 `openai`、`anthropic` 或 `gemini` 可按对应渠道再跑一遍。需要本机安装 Chrome 和 Playwright（可用 `PLAYWRIGHT_MODULE` 指定 playwright-core 路径）。

## 说明

搜索补全通过站内适配路由请求 Google / Bing 的兼容接口。这些接口不是稳定商业契约，因此实现了超时、取消请求和静默降级；接口不可用时，本地网址匹配及“使用当前提供商搜索”仍然可用。搜索词不会写入数据库。
