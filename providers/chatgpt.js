function findAccessToken(value, depth = 0) {
  if (!value || depth > 6) return null;
  if (typeof value === 'string') return value.startsWith('eyJ') && value.split('.').length >= 2 ? value : null;
  if (Array.isArray(value)) {
    for (const v of value) { const found = findAccessToken(v, depth + 1); if (found) return found; }
  } else if (typeof value === 'object') {
    for (const key of ['accessToken', 'access_token', 'token']) {
      if (typeof value[key] === 'string' && value[key]) return value[key];
    }
    for (const v of Object.values(value)) { const found = findAccessToken(v, depth + 1); if (found) return found; }
  }
  return null;
}

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return {};
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(normalized));
  } catch { return {}; }
}

function findAccountId(value, depth = 0) {
  if (!value || depth > 7) return null;
  if (typeof value !== 'object') return null;
  for (const key of ['chatgpt_account_id', 'chatgptAccountId', 'account_id', 'accountId']) {
    if (typeof value[key] === 'string' && value[key]) return value[key];
  }
  for (const v of Object.values(value)) {
    const found = findAccountId(v, depth + 1);
    if (found) return found;
  }
  return null;
}

async function directChatGptUsage() {
  const session = await jsonFetch('https://chatgpt.com/api/auth/session', { credentials: 'include', headers: { 'Accept': 'application/json' } });
  const token = findAccessToken(session);
  if (!token) throw new Error('ChatGPT 会话未返回访问令牌');
  const jwt = decodeJwtPayload(token);
  const accountId = findAccountId(session) || findAccountId(jwt);
  const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;
  return jsonFetch('https://chatgpt.com/backend-api/wham/usage', { credentials: 'include', headers });
}

function chatGptUsageHtml(data) {
  const rate = data?.rate_limit ?? data?.rateLimit ?? {};
  const rawWindows = [rate.primary_window ?? rate.primaryWindow, rate.secondary_window ?? rate.secondaryWindow].filter(Boolean);
  const windowSeconds = (w) => firstNumber(w.limit_window_seconds, w.limitWindowSeconds, w.window_seconds);
  const labelForWindow = (w) => {
    const secs = windowSeconds(w);
    if (secs == null) return '本周期额度';
    if (secs >= 6 * 86400) return '每周额度';
    if (secs >= 86400) return `${Math.round(secs / 86400)} 天额度`;
    if (secs >= 3600) return `${Math.round(secs / 3600)} 小时额度`;
    return `${Math.round(secs / 60)} 分钟额度`;
  };
  // 两个窗口都要展示（Primary 通常是 5 小时，Secondary 是每周），短周期排在前面
  const windows = rawWindows
    .map((w, i) => ({ w, i, secs: windowSeconds(w) ?? 0 }))
    .sort((a, b) => (a.secs - b.secs) || (a.i - b.i));
  const rows = windows.length
    ? windows.map(({ w }) => [labelForWindow(w), w])
    : [['每周额度', null]];
  let html = rows.map(([label, w]) => {
    if (!w) return '';
    const pct = toPercent(firstNumber(w.used_percent, w.usedPercent, w.utilization, w.percent));
    const reset = resetMeta(w.reset_at ?? w.resetAt ?? w.resets_at);
    return metricHtml(label, pct, reset);
  }).join('');

  const additional = data?.additional_rate_limits ?? data?.additionalRateLimits;
  if (Array.isArray(additional)) {
    for (const item of additional.slice(0, 3)) {
      const w = item?.rate_limit ?? item?.rateLimit ?? item;
      const pct = toPercent(firstNumber(w.used_percent, w.usedPercent, w.utilization, w.percent));
      if (pct == null) continue;
      const label = item.limit_name ?? item.limitName ?? item.metered_feature ?? '额外';
      html += metricHtml(label, pct, resetMeta(w.reset_at ?? w.resetAt));
    }
  }
  return html;
}

AIUsageProviders.register({
  id: 'chatgpt',
  label: 'ChatGPT / Codex',
  plan: 'Plus',
  needs: 'session',
  openUrl: 'https://chatgpt.com/#usage',
  // 取数：不碰 DOM，因此也能在 service worker 里跑（后台定时刷新用）
  async fetchData() {
    let data;
    try {
      data = await directChatGptUsage();
    } catch {
      data = await relayMessage('https://chatgpt.com/*', { type: 'AI_USAGE_CHATGPT' });
    }
    if (!chatGptUsageHtml(data)) {
      const error = new Error('ChatGPT/Codex 用量返回格式异常');
      error.hint = '请先登录 chatgpt.com。如仍失败，保持一个 ChatGPT 标签页打开作为中转。';
      throw error;
    }
    return data;
  },
  // 渲染：只在页面上下文调用
  renderHtml(data) {
    if (typeof document !== 'undefined' && data?.plan_type) {
      const badge = document.getElementById('card-chatgpt-plan');
      if (badge) badge.textContent = String(data.plan_type).replaceAll('_', ' ');
    }
    return chatGptUsageHtml(data);
  },
  settingsHtml() {
    return `<p>正常登录 <strong>claude.ai</strong> 与 <strong>chatgpt.com</strong>。扩展不会复制或保存这些会话 Cookie。</p>`;
  },
  async readSettings() {}
});
