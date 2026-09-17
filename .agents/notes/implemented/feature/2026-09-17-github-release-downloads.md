# Agent Note: GitHub Release 加速下载

Status: implemented

## Problem

管理 GitHub Star 时只能修改备注，无法快速查看和下载仓库发布文件。直接由 Vercel 中转二进制文件会消耗函数带宽和执行时间，而把 GitHub Token 交给第三方代理又会扩大凭据暴露面。

## Decision

系统提供只读 Release 元数据接口。访客只能查询数据库中当前公开展示的 Star，管理员可以查询全部 Star；接口不能作为任意仓库的查询代理。接口使用服务端 GitHub Token 查询 GitHub API 的发布版本和资产，并为浏览器返回经过可配置代理前缀转换的下载地址。查询结果缓存五分钟，浏览器直接从代理下载文件，服务端不转发二进制内容，也不向代理发送 Token。

每个 Release 同时提供 GitHub 发布资产与该标签对应的 ZIP、TAR.GZ 源码包。仓库没有 Release 时，仅提供默认分支的 ZIP、TAR.GZ 源码包。代理前缀由 `GITHUB_DOWNLOAD_PROXY` 配置，默认使用 `https://gh-proxy.com/`。

## Alternatives considered

- 由 Vercel API 下载并流式转发文件：可以完全控制响应，但大文件会占用函数流量、连接时间和费用，因此不采用。
- 直接打开 GitHub 原始下载地址：信任边界最小，但不能满足国内加速下载要求，因此保留为可通过环境变量替换代理的运维退路，而不是默认行为。
- 把 GitHub Token 附加给代理请求：可支持私有仓库，但会把长期凭据暴露给第三方，风险不可接受，因此只处理无需向代理传递凭据的公开下载地址。
- 要求访客登录后才能下载：访问边界最简单，但公开 Star 本身已面向访客展示，额外登录会阻碍正常下载，因此改为公开仓库白名单，而不是全面鉴权。

## Verification

- ESLint、TypeScript 检查和 Next.js 生产构建通过。
- `cli/cli` 实测返回 30 个 Release，首个版本同时包含发布资产与源码包。
- `octocat/Hello-World` 实测无 Release 时返回默认分支的 ZIP、TAR.GZ 源码包。
- 代理后的真实 Release 文件请求返回 `200` 和附件下载响应头。
- 现有 GitHub Token 实测可读取公开 Release，并获得每小时 5000 次的认证限额。
- 匿名请求公开 Star 的 Release 接口返回 `200`，查询未公开展示的任意仓库返回 `404`。

## Consequences

- 用户无论是否登录都可下载公开 Star；管理员仍可下载非公开显示项。下载弹窗可选择 Release 版本、发布资产或源码包，没有 Release 时仍有明确回退路径。
- 公开接口必须先匹配本站公开 Star 白名单；任意仓库查询返回 `404`，避免把站点变成通用 GitHub API 转发器。
- 下载大文件不消耗 Vercel 函数流量，GitHub Token 不进入浏览器或第三方代理。
- 公共代理可能临时不可用或改变服务规则，因此运维需要用 `GITHUB_DOWNLOAD_PROXY` 替换代理；设置为 `direct` 可直接使用 GitHub。
- 只支持公开仓库下载。私有仓库需要不同的凭据与受信下载通道，不能复用当前第三方代理方案。
- Release 资产名称不一定包含平台信息，界面只展示 GitHub 提供的名称、类型和大小，不猜测用户应选择哪个文件。
