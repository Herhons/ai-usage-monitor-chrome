// GitHub Copilot usage adapter.
//
// Endpoint research (2026-08-13, no auth and with invalid Bearer token):
//   GET https://api.githubcopilot.com/meta  -> HTTP 404 "page not found"
//   GET https://api.githubcopilot.com/usage | /chat/usage | /meta/usage | /v1/meta | /api/meta -> HTTP 404
// The historical /meta shape (community docs, 2023-2024) was
//   { rate_limit: { usage: <int requests used>, allowed: <int requests allowed>, reset_date: "<ISO date>" }, ... }
// but the endpoint now 404s for everyone (not 401/403), i.e. the path is
// retired, not auth-gated. Organization-level usage lives on the GitHub
// REST API (GET /orgs/{org}/copilot/usage) but requires a PAT against
// api.github.com, which is out of scope for this session-based adapter.
// The parser below still handles the historical shape defensively (alias
// chains, toPercent normalization) so the adapter lights up if the endpoint
// returns again; today it degrades to the "not available" error state.

function directCopilotUsage() {
  return jsonFetch('https://api.githubcopilot.com/meta', {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });
}

function copilotUsageHtml(data) {
  const usage = data?.rate_limit ?? data?.rateLimit ?? data?.usage ?? data;
  const used = firstNumber(usage?.usage, usage?.used);
  const allowed = firstNumber(usage?.allowed, usage?.limit);
  const ratio = used != null && allowed ? (used / allowed) * 100 : null;
  const rawPct = firstNumber(usage?.usage_percent, usage?.used_percent, usage?.utilization, usage?.percent, usage?.usagePercent, usage?.usedPercent);
  if (rawPct == null && ratio == null) return '';
  const pct = toPercent(rawPct != null ? rawPct : ratio);
  const reset = resetMeta(usage?.reset_date ?? usage?.reset_at ?? usage?.resetAt ?? usage?.resets_at ?? usage?.resetsAt);
  const detail = used != null && allowed != null ? `${Math.round(used)} / ${Math.round(allowed)}` : '';
  return metricHtml('Copilot 用量', pct, reset, detail);
}

AIUsageProviders.register({
  id: 'copilot',
  label: 'GitHub Copilot',
  needs: 'session',
  openUrl: 'https://copilot.github.com',
  async refresh(silent = false) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    if (!silent) body.innerHTML = '<div class="loading">加载中…</div>';
    try {
      let data;
      try {
        data = await directCopilotUsage();
      } catch {
        data = await relayMessage('https://copilot.github.com/*', { type: 'AI_USAGE_COPILOT' });
      }
      const html = copilotUsageHtml(data);
      if (!html) throw new Error('GitHub Copilot 用量返回格式异常');
      body.innerHTML = html;
      return true;
    } catch {
      if (!silent) body.innerHTML = notAvailableHtml('GitHub Copilot 用量暂不可用');
      return false;
    }
  },
  settingsHtml() {
    return `<p>正常登录 <strong>github.com</strong> 并已开通 Copilot。扩展不会复制或保存这些会话 Cookie。</p>`;
  },
  async readSettings() {}
});
