async function getClaudeOrgFromCookie() {
  const candidates = ['lastActiveOrg', 'lastActiveOrganization'];
  for (const name of candidates) {
    const cookie = await chrome.cookies.get({ url: 'https://claude.ai', name });
    if (cookie?.value) return decodeURIComponent(cookie.value).replace(/^"|"$/g, '');
  }
  return null;
}

function collectOrgIds(value, out = new Set()) {
  if (!value || out.size > 25) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectOrgIds(item, out);
  } else if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      if ((key === 'uuid' || key === 'id' || key === 'organization_uuid') && typeof val === 'string' && val.length > 8) out.add(val);
      collectOrgIds(val, out);
    }
  }
  return out;
}

let cachedClaudeOrgId = null;

async function directClaudeUsage() {
  let orgId = cachedClaudeOrgId;
  if (!orgId) {
    orgId = await getClaudeOrgFromCookie();
    if (!orgId) {
      const orgs = await jsonFetch('https://claude.ai/api/organizations', { credentials: 'include' });
      orgId = [...collectOrgIds(orgs)][0];
    }
    if (orgId) cachedClaudeOrgId = orgId;
  }
  if (!orgId) throw new Error('无法确定 Claude 组织');
  return jsonFetch(`https://claude.ai/api/organizations/${encodeURIComponent(orgId)}/usage`, {
    credentials: 'include',
    headers: { 'anthropic-client-platform': 'web_claude_ai', 'Accept': 'application/json' }
  });
}

function claudeUsageHtml(data) {
  const rows = [
    ['当前会话', data?.five_hour ?? data?.fiveHour],
    ['每周额度', data?.seven_day ?? data?.sevenDay],
    ['每周 Sonnet', data?.seven_day_sonnet ?? data?.sevenDaySonnet],
    ['每周 Opus', data?.seven_day_opus ?? data?.sevenDayOpus]
  ];
  let html = rows.map(([label, w]) => {
    if (!w) return '';
    const pct = toPercent(firstNumber(w.utilization, w.utilization_pct, w.used_percent, w.percent));
    const reset = resetMeta(w.resets_at ?? w.reset_at ?? w.resetAt);
    return metricHtml(label, pct, reset);
  }).join('');

  const extra = data?.extra_usage ?? data?.extraUsage;
  if (extra) {
    const spent = firstNumber(extra.current_spending, extra.currentSpending, extra.spent, extra.used);
    const limit = firstNumber(extra.monthly_limit, extra.monthlyLimit, extra.budget_limit, extra.limit);
    if (spent != null && limit) {
      const divisor = limit > 500 ? 100 : 1; // some Claude payloads use cents
      const usedUsd = spent / divisor;
      const limitUsd = limit / divisor;
      html += metricHtml('额外用量', (usedUsd / limitUsd) * 100, '', `${money(usedUsd)} / ${money(limitUsd)}`);
    }
  }
  return html;
}

AIUsageProviders.register({
  id: 'claude',
  label: 'Claude',
  plan: '团队 / 订阅',
  needs: 'session',
  openUrl: 'https://claude.ai/settings/usage',
  async refresh(silent = false) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    if (!silent) body.innerHTML = '<div class="loading">加载中…</div>';
    try {
      let data;
      try {
        data = await directClaudeUsage();
      } catch {
        data = await relayMessage('https://claude.ai/*', { type: 'AI_USAGE_CLAUDE' });
      }
      const html = claudeUsageHtml(data);
      if (!html) throw new Error('Claude 用量返回格式异常');
      body.innerHTML = html;
      return true;
    } catch (error) {
      if (!silent) body.innerHTML = errorHtml(`加载 Claude 失败：${error.message}`, '请先登录 claude.ai。如仍失败，保持一个 Claude 标签页打开作为中转。');
      return false;
    }
  },
  settingsHtml() {
    return `<p>正常登录 <strong>claude.ai</strong> 与 <strong>chatgpt.com</strong>。扩展不会复制或保存这些会话 Cookie。</p>`;
  },
  async readSettings() {}
});
