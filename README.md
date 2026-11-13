# AI 用量配额监控（Chrome 扩展）

一个轻量的 Manifest V3 Chrome 扩展，用来查看各家 AI 订阅的额度与用量：

- **OpenCode** —— 5 小时 / 每周 / 每月用量百分比（显示 Go 套餐标识；需要 API Key）
- **Claude** —— 当前会话与每周限额（接口返回时还会显示按模型拆分、额外用量等行）
- **ChatGPT / Codex** —— 每周用量限额
- **GitHub Copilot** —— 复用登录态；目前降级显示（接口已下线，卡片显示「暂不可用」）
- **Google Gemini** —— 复用登录态；通过隐藏标签页读取用量页面
- **Cursor** —— 月度请求池的用量百分比
- **Perplexity** —— 各功能的剩余次数（Pro Search、Deep Research、Labs、智能体研究、免费查询）
- **Mistral Le Chat** —— 各能力的剩余次数（消息、快速推理、深度研究等）
- **xAI Grok** —— 每周 Premium 限额百分比、重置时间，以及 Grok Bot / 聊天等明细

除 OpenCode 外，所有服务商都复用你在其网站上已有的登录态，扩展内部不需要再次登录。

## 安装

1. 解压文件夹。
2. 打开 `chrome://extensions`。
3. 打开右上角的**开发者模式**。
4. 点击**加载已解压的扩展程序**。
5. 选择 `ai-usage-monitor-chrome` 文件夹。
6. 把「AI 用量监控」固定到 Chrome 工具栏。
7. 右键扩展 → **选项**，启用你订阅的服务商；使用 OpenCode 时填入 Go 套餐 API Key。
8. 对每个已启用的会话型服务商，确认在同一个 Chrome 配置文件里已登录对应网站：`claude.ai`、`chatgpt.com`、`github.com`（Copilot）、`gemini.google.com`、`cursor.com`、`www.perplexity.ai`、`chat.mistral.ai`、`grok.com`。

全新安装时所有服务商默认关闭，面板显示空状态——到设置里启用你需要的即可。

## 查看方式

工具栏按钮以标准 Chrome 弹出面板打开监控，点击别处即收起。想让它一直开着，用面板顶部的两个按钮：

- **独立窗口** —— 常驻的弹出窗口，直到你主动关闭（Cmd+W 或 ✕）。
- **标签页** —— 以普通标签页打开，适合放在工作页面旁边。

两种视图互斥：切到标签页会关掉窗口，切回窗口会关掉标签页。如果监控标签页已经被导航到别的网站，则不会动它。

## 发布到 Chrome 网上应用店

1. 先在 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) 创建商品（上传任意 zip，之后每次发布替换即可）。
2. 创建 Google Cloud OAuth 客户端并获取 refresh token —— 参考 [fregante/chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys)。
3. 在 GitHub Actions 添加 secrets：`CWS_EXTENSION_ID`、`CWS_CLIENT_ID`、`CWS_CLIENT_SECRET`、`CWS_REFRESH_TOKEN`、`CWS_PUBLISHER_ID`。
4. 打版本发版 —— 会更新 `manifest.json`、打 tag 并推送，`publish.yml` 工作流负责打包、上传、提交到商店：

```sh
bash release.sh v1.0.1
```

提交后仍需经过 Chrome 官方审核；工作流只自动化「上传 + 提交」这一步。

## 工作原理

大多数服务商先在扩展上下文里直接取数，失败时再借一个已打开的服务商标签页转发请求（`relay-*.js`）。每张卡片会写明它需要什么、显示什么。

**Gemini 与 Grok 是例外**：两者都没有可用的公开 JSON 用量接口。`background.js` 会打开一个隐藏的用量标签页（`USAGE_PAGES`），轮询 `AI_USAGE_READ`，直到内容脚本返回解析结果，再把结果写进 `chrome.storage.local.usageCache`。

### OpenCode

需要在设置里填入 OpenCode Go 套餐的 API Key（保存在 `chrome.storage.local`，只会发给 `opencode.ai`）。

调用：

`GET https://opencode.ai/zen/go/v1/usage`

以该 Key 作为 Bearer token，展示 5 小时、每周、每月用量百分比。

### Claude

需要在 `claude.ai` 已登录。调用 Claude 网页版使用的同一个内部用量接口：

`GET https://claude.ai/api/organizations/{orgId}/usage`

（需要 `anthropic-client-platform: web_claude_ai` 请求头）。先直接取数，失败再经已打开的 Claude 标签页转发。

### ChatGPT / Codex

需要在 `chatgpt.com` 已登录。先从

`GET https://chatgpt.com/api/auth/session`

读取 bearer token，再调用

`GET https://chatgpt.com/backend-api/wham/usage`

（存在时附带 `ChatGPT-Account-Id` 请求头）。先直接取数，失败再经已打开的 ChatGPT 标签页转发。

### GitHub Copilot

需要在 `github.com` 已登录并开通 Copilot。用量接口

`GET https://api.githubcopilot.com/meta`

已经下线——对所有人都返回 HTTP 404，并非鉴权问题——所以卡片目前显示「暂不可用」。解析器仍以防御式写法保留历史响应结构，一旦接口恢复即可自动亮起。

### Google Gemini

需要在 `gemini.google.com` 已登录。目前没有稳定、公开可用的用量接口，因此改为在隐藏标签页读取 `https://gemini.google.com/usage` 渲染出来的结果。页面改版可能让卡片暂时保留上一次的缓存值。

### Cursor

需要在 `cursor.com` 已登录。调用：

`GET https://cursor.com/api/usage`

（会话鉴权）。先直接取数，失败再经已打开的 Cursor 标签页转发。

### Perplexity

需要在 `www.perplexity.ai` 已登录。调用：

`GET https://www.perplexity.ai/rest/rate-limit/all`

再配合 `/rest/user/settings` 读取套餐档位。该接口返回的是剩余次数，所以卡片显示「剩余 N 次」而不是百分比（Pro Search、Deep Research、Labs、智能体研究、免费查询）。先直接取数，失败再经已打开的 Perplexity 标签页转发。

### Mistral Le Chat

需要在 `chat.mistral.ai` 已登录。调用应用的 tRPC 过程：

`GET https://chat.mistral.ai/api/trpc/user.limits`

展示各能力的剩余次数（消息、快速推理、深度研究等）。先直接取数，失败再经已打开的 Mistral 标签页转发。

### xAI Grok

需要在 `grok.com` 已登录。Grok 没有可用的公开 JSON 用量接口：旧的 `GET /rest/usage/free-usage-gates` 只报告免费层门控（对 SuperGrok 订阅者没有意义），真实额度来自没有公开 schema 的 gRPC-web protobuf。因此扩展会在隐藏标签页里打开**设置 → 使用量**面板，读取渲染结果：

- 依次尝试 `https://grok.com/?referrer=x&_s=usage`，以及旧地址 `?usage=&_s=usage`、`?usage=`。
- 优先从 `aria-label` 读取百分比，取不到再读页面文本——当前面板把 `100% 已使用` 渲染成普通文本，不再是 `<number-flow-react>` 组件。
- 结果缓存在 `chrome.storage.local.usageCache`。抓取失败时卡片保留上一次的值，但会明确显示「数据已过期」，不会伪装成刚读到的新数据。

隐藏标签页只会在面板没有渲染出来时补点一次「使用量」菜单，不会激活或点击你正在看的标签页。诊断信息只从隐藏标签页写入，且只含结构性数据（百分比候选、面板是否渲染），不含页面文本、标题或会话 URL。解析器见 `relay-grok.js`，失败现场见 `chrome.storage.local` 里的 `__grokDiag` / `__grokScrapeDiag`。

## 隐私与安全

- 无统计、无埋点。
- 扩展没有自有服务器。
- OpenCode API Key 为方便起见保存在 `chrome.storage.local`，只会发送给 `opencode.ai`。
- 其它服务商的会话 Cookie 不会被复制进扩展存储。
- 主机权限只覆盖扩展需要访问的站点：`opencode.ai`、`claude.ai`、`chatgpt.com`、`copilot.github.com`、`api.githubcopilot.com`、`gemini.google.com`、`cursor.com`、`www.perplexity.ai`、`chat.mistral.ai`、`grok.com`。扩展刻意不申请 `<all_urls>`。
- 这些用量接口都是各家内部接口，随时可能变动。若某个服务商改了接口或响应结构，请同步更新 `providers/*.js` 里对应的适配器或它的 relay 脚本。

## 故障排查

### 卡片提示「请打开服务商网站」

在标签页里打开对应网站并确认已登录，然后点刷新。如果标签页本来就开着，请重新加载一次，让 relay 脚本重新注入：

- Claude —— `https://claude.ai`
- ChatGPT / Codex —— `https://chatgpt.com`
- GitHub Copilot —— `https://copilot.github.com`（需在 `github.com` 登录并开通 Copilot）
- Google Gemini —— `https://gemini.google.com`
- Cursor —— `https://cursor.com`
- Perplexity —— `https://www.perplexity.ai`
- Mistral Le Chat —— `https://chat.mistral.ai`
- xAI Grok —— `https://grok.com`

### 卡片显示「用量暂不可用」

这是降级状态：适配器没能用上有效的用量接口，卡片显示一行简短提示而不是额度条。目前预期会出现的有：

- **GitHub Copilot** —— 用量接口已下线（见上文）。
- **Google Gemini** —— 通过隐藏标签页读取用量页（见上文）；页面改版可能让卡片暂时保留上一次的缓存值。
- **xAI Grok** —— 通过隐藏标签页读取「使用量」面板。如果 grok.com 再次改版，卡片会保留上一次的值并显示「数据已过期」。失败现场可在 `chrome.storage.local` 的 `__grokDiag` / `__grokScrapeDiag` 里查看。

其它服务商在接口不可达或响应结构变化时也会进入这个状态——这是如实降级，不是 bug。

### OpenCode 返回 401 / 403

打开设置，把 API Key 换成你的 OpenCode 配置里正在使用的有效 Go 套餐 Key。

### Chrome 提示站点访问权限警告

这是预期行为：读取额度必须向这些服务商站点发请求 / 带 Cookie。扩展刻意不申请 `<all_urls>`。
