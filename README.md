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
- 无确认直接取消 Star，失败自动回滚，成功后可撤销
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

1. 在 Supabase SQL Editor 按编号执行 [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql) 和后续迁移；已有数据库还需要执行 [`supabase/migrations/002_star_display_name.sql`](supabase/migrations/002_star_display_name.sql)。
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

## 4. 部署到 Vercel

1. 将项目推送到 GitHub，再导入 Vercel。
2. 在 Vercel 配置 `.env.example` 中的全部环境变量。
3. 生成一个随机长字符串写入 `CRON_SECRET`。
4. 部署后更新 GitHub OAuth App 的 Homepage 与 callback URL。

[`vercel.json`](vercel.json) 已将 Functions 固定到 `sin1`，并每天北京时间 03:17（UTC 19:17）同步 GitHub Star。Vercel 会用 `CRON_SECRET` 保护 Cron 请求。

## 验证命令

```bash
npm run lint
npm run typecheck
npm run build
```

## 说明

搜索补全通过站内适配路由请求 Google / Bing 的兼容接口。这些接口不是稳定商业契约，因此实现了超时、取消请求和静默降级；接口不可用时，本地网址匹配及“使用当前提供商搜索”仍然可用。搜索词不会写入数据库。
