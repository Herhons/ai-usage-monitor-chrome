# AGENTS.md

个人使用的 Chrome 扩展（Manifest V3），展示九家 AI 服务商的额度用量：OpenCode（API Key 方式），以及 Claude、ChatGPT/Codex、GitHub Copilot、Google Gemini、Cursor、Perplexity、Mistral Le Chat、xAI Grok（均为复用登录态）。纯原生 JavaScript——没有构建系统、没有 package.json、没有测试、没有 lint。Git 仓库托管在 GitHub（默认分支 `main`）。安装与接口说明见 README.md。

## 在本仓库里工作

- 没有构建 / 测试 / lint 步骤。Chrome 直接加载目录（`chrome://extensions` → 加载已解压的扩展程序）。改完代码后要点扩展卡片上的**重新加载**；内容脚本（`relay-*.js`）还额外需要刷新对应的服务商标签页。
- 发版：`bash release.sh vX.Y.Z` 会按 tag 更新 `manifest.json` 版本号，随后 `.github/workflows/publish.yml` 打包扩展，并通过 `chrome-webstore-upload-cli` 上传 / 发布到 Chrome 网上应用店（GitHub secrets 为 `CWS_*`）。商店商品信息在应用店后台维护，不在仓库里。
- `manifest.json` 是唯一的接线处：`background.js`（service worker；处理弹出视图的消息，跟踪并复用已打开的面板窗口 / 标签页）、`options.html` + `options.js`（设置）、`popup.html` + `popup.js`（监控界面，通过 `action.default_popup` 作为工具栏原生面板，也会在独立窗口 / 标签页中加载）、`providers.js` + `providers/*.js`（popup 与 options 都会加载），以及每个会话型服务商一个 `relay-*.js` 内容脚本（`relay-claude.js`、`relay-chatgpt.js`、`relay-copilot.js`、`relay-gemini.js`、`relay-cursor.js`、`relay-perplexity.js`、`relay-mistral.js`、`relay-grok.js`）。OpenCode 基于 API Key，没有 relay。图标保持在 `icons/icon{16,32,48,128}.png`。
- 权限刻意收得很窄：`storage`、`cookies`，加上九家服务商的 `host_permissions`——`opencode.ai`、`claude.ai`、`chatgpt.com`、`copilot.github.com` 与 `api.githubcopilot.com`、`gemini.google.com`、`cursor.com`、`www.perplexity.ai`、`chat.mistral.ai`、`grok.com`（见 `manifest.json`）。新增服务商时，要把站点加进 `host_permissions`；会话型服务商还要新增 `relay-*.js` 内容脚本。**绝不要**加 `<all_urls>`。

## Git 工作流

0. **GitHub 只走 MCP —— 不用 `gh`。** 所有 GitHub API 操作（创建 issue / PR、列分支、搜代码、review、评论）都必须通过 `github-my-johnlee` MCP 服务（`github-my-johnlee_*` 工具），**不要**用 `gh` CLI 做这些事。本地 git 命令（`git fetch`、`pull --rebase`、`merge --no-ff`、`push`、worktree / 分支管理）仍走命令行；MCP 服务无法执行本地 git。
1. **Conventional Commits。** 每个提交标题为 `<type>(<scope>): <summary>`——类型：`feat`、`fix`、`docs`、`refactor`、`perf`、`style`、`test`、`build`、`ci`、`revert`。使用祈使语气、小写、不超过 72 字符、结尾不加句号。正文（标题后空一行）说明*为什么*，每行约 72 字符；多项改动用列表。允许整理历史：用 `rebase -i` 梳理分支提交、合并前 squash。只有**特性分支**允许 `--force-with-lease` 强推——`main` 绝不允许。
2. **始终从最新 main 建 worktree 分支。** 开工前：`git fetch origin`，然后在本地 `main` 上 `git pull --rebase`（在根 checkout 里做——`main` 不能被 worktree 检出）确保是最新，再从 `main` 建分支与 worktree。只在 `.worktrees/<branch>` 内工作——根 checkout 是共享的，可能有其它 agent 正在跑 worktree。分支命名：`feature/<slug>`、`hotfix/<slug>`、`chore/<slug>`、`docs/<slug>`（`provider-flexibility` 这类旧分支早于该命名规则）。开发期间，若有其它 agent 在工作，不要执行会改动 `main` 或其它 worktree 分支的 git 命令——下面的合并步骤是例外。
3. **本地 PR 流程。** 工作完成并验证后，用 `git merge --no-ff <branch>` 把分支合进 `main`（保留分支历史，合并提交即 PR 记录），push `main` 到 origin，然后 `git worktree remove` 移除 worktree、`git branch -d` 删掉分支。
4. **合并前自动审查。** 合并前派一个全新的 reviewer 子代理（general-purpose，`requesting-code-review` 风格提示词），审查分支相对 `main` 的完整 diff。在分支上修掉它的问题、复审，直到干净为止。
5. **交互式合并闸门。** 审查通过后，用交互提示 / `question` 工具询问用户是否把分支合进 `main`。没有用户明确确认，绝不合并。

## 架构：服务商注册表 → 直接取数 → relay 兜底

`providers.js` 定义 `AIUsageProviders` 注册表与公共辅助函数；每个 `providers/*.js` 注册一个适配器（`id`、`label`、`plan`（可选，没有套餐字段就省略）、`needs`——`'key'` 或 `'session'`——`openUrl`、`refresh`、`settingsHtml`、`readSettings`）。`popup.html` 与 `options.html` 先加载 `providers.js`，再加载所有 `providers/*.js`。面板只渲染和刷新已启用的服务商（`loadProviderPrefs` → `AIUsageProviders.enabledIds`）；全新安装默认全部关闭，需在设置里启用。

刷新时，适配器先在扩展上下文里直接取用量（`direct*Usage()`），失败后回落到 `relayMessage`（providers.js），由它向已打开的服务商标签页发消息：

- `{ type: 'AI_USAGE_CLAUDE' }` → relay-claude.js
- `{ type: 'AI_USAGE_CHATGPT' }` → relay-chatgpt.js
- `{ type: 'AI_USAGE_COPILOT' }` → relay-copilot.js
- `{ type: 'AI_USAGE_READ' }` → relay-gemini.js / relay-grok.js（用量页抓取，见下文）
- `{ type: 'AI_USAGE_CURSOR' }` → relay-cursor.js
- `{ type: 'AI_USAGE_PERPLEXITY' }` → relay-perplexity.js
- `{ type: 'AI_USAGE_MISTRAL' }` → relay-mistral.js

relay 脚本与适配器必须保持同步：消息类型、请求流程、响应结构 `{ ok: true, data }` / `{ ok: false, error }`。每个 relay 都用 `globalThis.__aiUsage*RelayInstalled` 防止重复安装（SPA 会重新注入内容脚本）。Copilot 目前降级显示（接口已下线）。

Gemini 与 Grok 不走上面的「直接取数 → relay 兜底」：两者都没有可用的公开 JSON 用量接口。`background.js` 会打开一个隐藏的用量标签页（`USAGE_PAGES`），轮询 `AI_USAGE_READ`，直到内容脚本返回解析结果，结果写入 `chrome.storage.local.usageCache`。`AI_USAGE_GROK` 现在只回复「已不再支持」。Grok 的解析器同时兼容旧的 `<number-flow-react aria-label>` 结构与纯文本百分比，读取失败时写入 `__grokDiag` / `__grokScrapeDiag` 现场快照（只含结构信息，不含页面文本）。

## 需要保持的约定

- 公共辅助函数放在 `providers.js`，并在适配器之前加载：`jsonFetch`、`relayMessage`、`metricHtml`、`escapeHtml`、`errorHtml`、`loadProviderPrefs`、`toPercent`、`clampPercent`、`firstNumber`、重置 / 金额格式化函数，以及 `AIUsageProviders` 注册表。任何适配器都可以用它们；扩展也只在这里扩展。
- 解析辅助函数（`collectOrgIds`、`findAccessToken`、`findAccountId`、JWT 解码）是**故意**在每个服务商的适配器文件*和*它的 relay 脚本里各写一份——内容脚本与扩展上下文隔离，又没有打包器。不要把这些解析器「DRY」进 `providers.js` 或公共模块；那里只放上面列出的通用辅助函数。
- 用量接口都是内部接口且不稳定。所有适配器都用别名链做防御式解析（例如 `w.usageDollars ?? w.usage_dollars ?? w.used ?? w.usage`）；扩展解析器时保持这个写法。`toPercent`（providers.js）负责把 Claude 忽而 0..1、忽而 0..100 的量纲归一化。
- Claude 用量需要 `anthropic-client-platform: web_claude_ai` 请求头。ChatGPT 需要 `/api/auth/session` 返回的 Bearer token，存在时还要带 `ChatGPT-Account-Id`。
- 唯一存储的密钥是 `chrome.storage.local` 里的 `opencodeApiKey`（options.js）。绝不存储会话型服务商的 Cookie 或 token。
