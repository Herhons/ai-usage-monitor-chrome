# Privacy Policy

Last updated: November 13, 2026

AI Usage Quota Monitor ("the extension") is a Chrome extension that displays your subscription quota usage for nine AI providers: OpenCode Go, Claude, ChatGPT/Codex, GitHub Copilot, Google Gemini, Cursor, Perplexity, Mistral Le Chat, and xAI Grok. This policy explains what data the extension handles.

## Data collection

**The extension collects no user data.** It has no analytics, no tracking, no advertising, and no servers of its own. Nothing about your browsing activity, websites visited, or usage patterns is collected, stored, or transmitted to us or any third party.

## What the extension does with your data

The extension is entirely local-first:

- **Quota information** — Your usage figures are fetched directly from each provider's website using your existing sign-in, and are displayed only on your device. Gemini and Grok are read from their usage pages in a hidden tab. They are not transmitted anywhere else.
- **OpenCode API key** — If you choose to, you enter your OpenCode Go API key in the extension's Settings page. It is stored locally in your browser's extension storage (`chrome.storage.local`) and is sent only to opencode.ai to authenticate quota requests. It is never transmitted to any other party.
- **Cookies and tokens** — The extension reads certain cookies in memory from claude.ai to determine your workspace, and uses your existing session when fetching quota data. Cookie and token values are never copied into extension storage and never transmitted outside your browser.
- **Diagnostics** — When a usage-page read fails, the extension records structural diagnostics in local extension storage (percentage candidates, whether the panel rendered, tag names). Diagnostics are written only from hidden tabs and never contain page text, page titles, chat content or session URLs. Nothing is transmitted.

## Third parties

The only third parties the extension communicates with are the nine providers whose quota data it displays. These requests are made only to fetch your own account usage and are subject to each provider's own privacy policies.

## Changes to this policy

If this policy changes, the updated version will be posted in this repository.

## Contact

Questions about this policy: admin@finchtech.my

© 2026 Finch Technology Enterprise
