// Perplexity usage adapter.
//
// Endpoint research (2026-08-14, no signed-in session — probes + community):
//   Live probes on www.perplexity.ai (anonymous):
//     GET /rest/rate-limit/all  -> HTTP 200 JSON quota payload (the card's
//       data source)
//     GET /rest/user/settings   -> HTTP 200 JSON user settings (plan field)
//     GET /rest/user/usage | /rest/quota | /rest/usage | /rest/users/me |
//         /rest/account/usage | /api/usage | /api/limits | /api/plan
//         -> HTTP 404 (paths do not exist); /api/user -> HTTP 401
//     GET /api/auth/session     -> HTTP 200 (NextAuth session; the session
//       cookie is the auth — no bearer token needed)
//   /rest/rate-limit/all shape (anon probe; numbers are per-user remaining
//   counts):
//     { free_queries: { available, remaining_detail: { kind } },
//       model_specific_limits: {}, remaining_agentic_research,
//       remaining_labs, remaining_pro, remaining_research,
//       sources: { source_to_limit: { <source>: { monthly_limit, remaining } } } }
//   Community sources agree this is the quota endpoint: starbaser/ccproxy
//   docs/pplx.md ("Fetches GET /rest/rate-limit/all and returns remaining
//   Pro Search (weekly), Deep Research (monthly), Labs, agentic-research,
//   and per-source quotas"), jamie950315/pplx-proxy (polls the same path,
//   "when remaining_pro reaches 0... fall back to free tier"), yuki-20/
//   PerplexiCode ("Fast quota-only refresh — always gets fresh data from
//   /rest/rate-limit/all"), pnd280/complexity (RATE_LIMITS.INDEX).
//   Signed-in example from ccproxy: { remaining_pro: 192,
//   remaining_research: 19, remaining_labs: 25,
//   remaining_agentic_research: 2, ... }.
//   Plan field: /rest/user/settings -> subscription_tier (null when anon;
//   "pro"/"max"/... when signed in). No used/limit totals exist for the
//   counts, so the card renders remaining counts instead of a percentage
//   bar. If the shape drifts, refresh() degrades to the "not available"
//   state.

const PERPLEXITY_QUOTA_URL = 'https://www.perplexity.ai/rest/rate-limit/all';
const PERPLEXITY_SETTINGS_URL = 'https://www.perplexity.ai/rest/user/settings';

function directPerplexityUsage() {
  return Promise.allSettled([
    jsonFetch(PERPLEXITY_QUOTA_URL, { credentials: 'include', headers: { 'Accept': 'application/json' } }),
    jsonFetch(PERPLEXITY_SETTINGS_URL, { credentials: 'include', headers: { 'Accept': 'application/json' } })
  ]).then(([quota, settings]) => {
    if (quota.status !== 'fulfilled') throw quota.reason;
    return { quota: quota.value, settings: settings.status === 'fulfilled' ? settings.value : null };
  });
}

function perplexityCountRow(label, remaining, meta = '') {
  if (remaining == null) return '';
  const n = firstNumber(remaining);
  if (n == null) return '';
  return `
    <div class="metric">
      <div class="metric-row">
        <span class="metric-label">${escapeHtml(label)}</span>
        <span class="metric-value">${Math.round(n)} 次剩余</span>
      </div>
      ${meta ? `<div class="metric-meta">${escapeHtml(meta)}</div>` : ''}
    </div>`;
}

function perplexityTextRow(label, text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return '';
  return `
    <div class="metric">
      <div class="metric-row">
        <span class="metric-label">${escapeHtml(label)}</span>
        <span class="metric-value">${escapeHtml(t)}</span>
      </div>
    </div>`;
}

function perplexityUsageHtml(data) {
  const quota = data?.quota ?? data;
  const fq = quota?.free_queries ?? quota?.freeQueries;
  const free = [fq?.remaining_detail?.remaining, fq?.remaining_detail?.count, fq?.remaining_detail?.value, fq?.remaining].find((v) => v != null);
  const rows = [
    perplexityCountRow('专业搜索', quota?.remaining_pro, '每周重置'),
    perplexityCountRow('深度研究', quota?.remaining_research, '每月重置'),
    perplexityCountRow('实验室', quota?.remaining_labs),
    perplexityCountRow('智能体研究', quota?.remaining_agentic_research),
    perplexityCountRow('免费查询', free)
  ].join('');
  if (!rows) return '';
  const settings = data?.settings;
  const tier = settings?.subscription_tier ?? settings?.subscriptionTier;
  const tierRow = typeof tier === 'string' && tier.trim()
    ? perplexityTextRow('套餐', tier.charAt(0).toUpperCase() + tier.slice(1))
    : '';
  return tierRow + rows;
}

AIUsageProviders.register({
  id: 'perplexity',
  label: 'Perplexity',
  needs: 'session',
  openUrl: 'https://www.perplexity.ai/settings',
  async refresh(silent = false) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    if (!silent) body.innerHTML = '<div class="loading">加载中…</div>';
    try {
      let data;
      try {
        data = await directPerplexityUsage();
      } catch {
        data = await relayMessage('https://www.perplexity.ai/*', { type: 'AI_USAGE_PERPLEXITY' });
      }
      const html = perplexityUsageHtml(data);
      if (!html) throw new Error('Perplexity 用量返回格式异常');
      body.innerHTML = html;
      return true;
    } catch {
      if (!silent) body.innerHTML = notAvailableHtml('Perplexity 用量暂不可用');
      return false;
    }
  },
  settingsHtml() {
    return `<p>正常登录 <strong>www.perplexity.ai</strong>。扩展不会复制或保存这些会话 Cookie。</p>`;
  },
  async readSettings() {}
});
