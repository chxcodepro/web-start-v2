# Agent Note: AI 整理书签与 GitHub Star

Status: implemented

## Problem

新的 GitHub Star 每天同步后都进入「未分组」，书签分组也全靠手动维护。条目一多，逐个拖动或批量移动都很费时间，用户希望由 AI 帮忙分组，并默认使用 DeepSeek 渠道。

## Decision

管理工具条新增「AI 整理」。流程：选择范围（勾选的条目、未分组的 Star 或全部）和分组方式 →（允许新建分组时）规划并确认新分组 → 分批分析 → 按目标分组审阅 → 应用 → 整理结果（可撤销）→ 关闭后右下角提示里仍可撤销。

- **AI 只给建议**：`POST /api/manage/ai-classify` 和 `POST /api/manage/ai-plan` 只读且仅管理员可用。服务端绕过数据缓存读取最新分组，保证刚建的分组能参与下一轮归类。提示词附带每组最多 4 个不在本批里的示例，让模型模仿用户自己的分法。条目用短编号、分组用 `g1`、`g2` 编号；输出走 JSON Output，再用 zod 逐条校验，只接受真实存在的编号和分组，模型直接写分组名也能识别。
- **分组方式**（记在 localStorage，书签和 Star 分开记）：
  - 只用现有分组（默认）：AI 只能从用户已有的分组里选。提示词明确禁止新建，结构化输出里也没有新分组字段；模型仍写了列表里没有的分组名（或旧格式的 `newGroup`）时一律忽略，条目保持不动。空分组也会列给 AI（按名称理解）。一个分组都没有时不能选这种方式，接口也返回 409，不请求 AI。
  - 允许新建分组：先调用 `ai-plan`，AI 一次看完这次的全部条目（每项压成一行，最多 500 项），提议最多 5 个新分组（名称、说明、大概数量），和现有分组重名的去掉。用户可以改名、删除、自己添加（最多 8 个），确认后归类时把「现有分组 + 已确认的新分组」当作固定列表，新分组编号 `n1`、`n2`，结果里用 `new:分组名` 表示。这样模型不会在各批次里临时起名，也就不需要合并近似的分组名。
  - 分组名的规范化和比较放在 `group-name.ts`，浏览器和服务端共用（浏览器不打包 zod 和提示词）。
- **审阅**：每一项显示简介（Star 用备注，也就是中文简介，没有时用 GitHub 简介；书签用描述或网址）和 AI 的理由；从已有分组挪出来的标出原分组。未分组的条目把握不太小就默认勾选；已经分好组的只有把握大才默认勾选，免得打乱手动整理的结果。
- **写入复用现有接口**：新分组只在实际有条目放进去时用 `POST /api/manage/collection` 创建；移动用 `/api/manage/reorder` 的 `move`，每个目标分组发一次请求，并保存该分组的最终排序。
- **整理结果和撤销**：应用后对话框不关闭，改为按分组列出放进去的项目（带简介，新建的分组有标记），没移动的单独列在最后，方便用户确认和记住每个项目的去向。结果页和关闭后的右下角提示都能撤销：按来源分组反向移动、恢复移动前的顺序，再删除这次新建、已经变空的分组；用户原有的分组不动。
- **AI 渠道**：支持三种接口格式，按渠道预设构造请求，默认是 DeepSeek。代码按格式拆分：`ai.ts` 负责配置识别和分发，`ai-shared.ts` 放公共错误与 JSON 解析，`ai-openai.ts`、`ai-anthropic.ts`、`ai-gemini.ts` 各管一种格式。
  - Anthropic：`AI_PROVIDER=anthropic`（或 `claude`），地址是 `api.anthropic.com` 或路径含 `/anthropic`（如 DeepSeek 的 Anthropic 格式地址）时自动识别。使用官方 `@anthropic-ai/sdk`，默认模型 `claude-opus-5-5`：思考模式关不掉，用 `output_config.effort: low` 控制思考量，结构化输出用 `output_config.format`；Fable、Opus 5/5.5、Sonnet 5.5 这些模型同时开启服务端兜底（`fallbacks: "default"`，beta `server-side-fallback-2026-07-01`），拒答时由服务端自动换模型重试。SDK 自动重试关掉，统一由这里和前端控制；错误按 SDK 的错误类逐级判断。中转不支持兜底、effort 或结构化输出时，按 400 错误内容逐项关掉再试。
  - Gemini：`AI_PROVIDER=gemini`（或 `google`），地址是 `generativelanguage.googleapis.com` 时自动识别（`/v1beta/openai` 兼容地址按通用兼容接口处理）。调用原生 `models/{model}:generateContent`，用 `x-goog-api-key` 请求头传密钥，默认模型 `gemini-3.5-flash-lite`。请求带 `responseMimeType: application/json`、`responseJsonSchema` 和 `thinkingConfig.thinkingLevel: LOW`；旧模型不认识的生成参数按 400 错误内容去掉。返回内容跳过思考部分，`MAX_TOKENS` 视为输出被截断，安全拦截视为拒答；密钥无效时 Gemini 返回 400，也映射成密钥错误提示。
  - DeepSeek：模型 `deepseek-flash`（旧模型名 `deepseek-chat` 已于 2026-07-24 停用），请求参数为 `thinking: {type: "disabled"}`、`temperature: 0.2`、`max_tokens`、`response_format: json_object`。设置 `AI_REASONING_EFFORT` 后改为开启思考。
  - OpenAI：`AI_PROVIDER=openai`，或地址是 `api.openai.com` 时自动识别。默认模型 `gpt-6-luna`（官方推荐的大批量低成本模型）；GPT-5 之后的推理模型不接受 `max_tokens` 和自定义 `temperature`，所以改用 `max_completion_tokens`、`reasoning_effort: low`，以及严格模式的 JSON Schema 结构化输出。
  - 其他兼容接口（中转、通义千问、Kimi、智谱、OpenRouter 等）：`AI_PROVIDER` 填其他任意名称，必须指定 `AI_MODEL`，只发送支持最广的 `max_tokens`、`temperature` 和 JSON Output。
  - `AI_BASE_URL` 可以填到 `/v1`，也可以直接填完整的 `/chat/completions` 地址；OpenAI 官方地址省略 `/v1` 时会自动补上。
  - 参数自动适配：端点返回 400、并指出某个可选参数不支持时，自动改写或去掉该参数后重试。`max_tokens` 和 `max_completion_tokens` 互换，结构化输出退回 JSON Output，`thinking`、`temperature`、`reasoning_effort` 直接去掉。同一参数同一取值只调整一次，不会来回重试。
  - 返回空白内容时按 DeepSeek 文档建议重试一次；去掉 `<think>` 推理内容和代码块后再解析 JSON。
  - 上游状态码映射成中文提示，其中 429、503、504 标记为可重试；超时和输出被截断带上 `code`，供前端拆批。
- **批次**：前端每批 30 项、最多 3 批并发，限流和服务繁忙时自动再试一次；超时或输出被截断时把这一批拆成两半放回队列，最小拆到 4 项。没拿到建议的条目单独列出，可以只重新分析这些。路由 `maxDuration` 为 60 秒，单次 AI 请求的总时限为 50 秒。审阅区显示实际使用的渠道和模型。
- **topics**：Star 同步时保存 GitHub topics（迁移 `003_star_topics.sql`），作为给仓库分类的主要信号。数据库还没执行迁移时，同步会去掉 topics 后继续，避免每日同步中断。Star 数据缓存键升到 `github-stars-v3`。

## Alternatives considered

- 让 AI 直接改分组，包括夜间同步时自动归类：少一步操作，但分错了不容易发现。因此先只给建议，等实际准确度验证后，再考虑加「高置信度自动归类」开关。
- 归类时由 AI 随手提议新分组（第一版的做法）：一次就能整理完，但各批次的模型会按自己的理解起名，分组名和用户的体系不一致，还要合并近似的名称。用户反馈后先改成只用现有分组，再加上「允许新建分组」：先统一规划、由用户确认，归类时仍然是固定列表。
- 用 JSON Schema 的 `enum` 把 `group` 限定为现有分组编号：只对支持结构化输出的渠道有效，默认的 DeepSeek 用不上；服务端校验已经保证不会出现新分组，因此暂不增加。
- embedding 加聚类：几百条数据没有必要；直接把现有分组和示例交给模型更简单，也更贴合用户自己的分法。
- 新增事务性的「批量应用」接口：需要数据库函数。复用现有 `move` 接口已能保证每个目标分组内的一致，并且可以撤销，因此暂不增加。
- 一次请求整理全部条目：输出很长，容易超过 Vercel 函数时长，而且一处失败就全部失败，因此改为小批次并发。
- 引入 OpenAI SDK：只调用一个接口，`fetch` 足够，也避免新增依赖。
- OpenAI 改用 Responses API：官方推荐推理模型用 Responses，但大多数第三方端点只兼容 Chat Completions。归类任务用 Chat Completions 已经足够，一套请求格式能覆盖所有渠道。
- 按渠道维护参数白名单：各家模型更新太快，白名单很快就会过时。改为按 400 错误里指出的参数自动适配，未知端点也能用。
- Gemini 和 Claude 都走各自的 OpenAI 兼容地址：代码最少，但这类兼容地址的功能不完整，而且很多中转只提供原生格式，因此改为直接支持原生格式。Gemini 的 OpenAI 兼容地址仍可按通用兼容接口使用。
- Gemini 使用官方 `@google/genai` SDK：只调用一个 REST 接口，`fetch` 足够；Anthropic 按 Claude API 的规范使用官方 SDK。

## Verification

- `npm test`：本功能相关的单元测试覆盖提示词构造（只列现有分组，含空分组；确认的新分组加入固定列表）、结果映射与忽略编造的分组名、新分组规划的去重和数量限制、五种渠道的配置识别和请求参数、OpenAI 格式的参数自动适配与防止来回重试、Anthropic 中转逐项关闭功能、Gemini 去掉旧模型不认识的参数、拒答和截断等错误映射、新分组插入位置、移动与撤销排序，全部 53 项通过。测试通过 `tests/register-alias.mjs` 注册 Node 解析钩子，直接加载使用 `@/` 别名的 TypeScript 源码。
- `npm run test:ai`：用模拟的 Supabase、AI 接口和登录会话，在 Chrome 里跑完整流程；`SMOKE_PROVIDER` 分别设为 deepseek、openai、anthropic、gemini（模拟接口按三种格式收发并检查请求参数）。「只用现有分组」那一版四种渠道都跑通过；加入分组方式、新分组规划和整理结果页之后，本机回环连接被系统拦截（node、PowerShell、curl 连 127.0.0.1 都返回 WSAEACCES），这一轮没能运行，脚本已按新流程更新。覆盖以下场景：
  - 上游 503 后自动重试；
  - 输出被截断的 30 项批次自动拆成两半；
  - 审阅区显示实际使用的渠道和模型；
  - 分组编号和分组名都能映射，写法略有不同的分组名也能对上；
  - 用户事先建好的空分组会被用上；
  - 只重新分析失败的条目；模型编造的分组名被忽略，条目保持不动；
  - 审阅和整理结果里每一项都带上简介，结果页按分组列出放进去的项目；
  - 只用现有分组时，应用后没有新建分组，页面与数据库一致；
  - 撤销后恢复原分组和原顺序，已有分组不受影响；
  - 允许新建分组时先规划（一次看完全部条目，和现有分组重名的提议被去掉）、可以自己添加，确认后归类；只创建有条目的新分组，从结果页撤销会删除新建的分组；
  - 手机宽度下没有横向溢出；
  - 密钥错误时不重试，直接提示需要检查的配置；
  - 书签按勾选范围整理；
  - 一个分组都没有时接口直接拒绝，不请求 AI。
- `npm run test:loading` 回归通过；ESLint、TypeScript 检查和生产构建通过；客户端产物中没有 zod、提示词和 AI 密钥相关代码。
- 没有使用任何渠道的真实密钥验证，需要配置 `AI_BASE_URL` 和 `AI_API_KEY` 后在线上实测一次。

## Consequences

- 需要配置 `AI_BASE_URL` 和 `AI_API_KEY`；未配置时，「AI 整理」会在开始分析后提示未配置。
- 已有数据库需要执行 `003_star_topics.sql`，再同步一次 Star 才会有 topics。
- 只用现有分组时，没有合适分组的条目会留在原处（Star 留在「未分组」），可以自己建好分组，或者换成「允许新建分组」再整理一次。
- 应用过程不是数据库事务：中途失败时，已完成的部分会保留，提示条里仍可撤销。
- 条目的名称、链接、描述、标签、备注，以及 Star 的语言和 topics 会发送给配置的 AI 渠道，非公开条目也包括在内。
- 撤销只在整理结果页，以及关掉之后的提示显示期间（约 9 秒）可用。
- 参数自动适配依赖端点在 400 错误里写明参数名；只返回笼统错误的端点不会自动适配，需要手动设置 `AI_PROVIDER`。
- 各渠道的默认模型写在 `src/lib/ai.ts` 的渠道预设里，模型更新换代后需要同步修改，或者用 `AI_MODEL` 覆盖。Anthropic 默认的 `claude-opus-5-5` 单价明显高于其他渠道的默认模型，在意费用时可以改用 `claude-haiku-5-5`。
- 新增依赖 `@anthropic-ai/sdk`（只在服务端使用）。SDK 1.x 用 `Authorization: Bearer` 传密钥；只认 `x-api-key` 的 Anthropic 格式中转会认证失败。
