// Google Gemini 用量适配器。
//
// Gemini 没有可用的公开 JSON 用量接口：gemini.google.com/usage 走的 batchexecute
// 在实测中返回 `[]` / `[[null,null,null,null,true]]`，没有数字。但该页面会把
// 「当前用量 / 每周限额」渲染成 DOM，所以改为由后台打开用量页读取渲染结果，
// 结果缓存在 chrome.storage.local.usageCache 里。

const GEMINI_STALE_MS = 15 * 60 * 1000;

function geminiAgeText(fetchedAt) {
  if (!fetchedAt) return '';
  const minutes = Math.round((Date.now() - fetchedAt) / 60000);
  if (minutes <= 0) return '刚刚读取';
  if (minutes < 60) return `${minutes} 分钟前读取`;
  const hours = Math.round(minutes / 60);
  return `${hours} 小时前读取`;
}

function geminiUsageHtml(data) {
  const rows = [];
  const cur = data.current || {};
  const week = data.weekly || {};
  if (cur.pct != null) {
    rows.push(metricHtml('当前用量', cur.pct, cur.reset ? `重置时间 ${cur.reset}` : ''));
  }
  if (week.pct != null) {
    rows.push(metricHtml('每周限额', week.pct, week.reset ? `重置时间 ${week.reset}` : ''));
  }
  if (!rows.length) return '';
  const age = geminiAgeText(data.fetchedAt);
  if (age) rows.push(`<div class="metric-meta">${escapeHtml(age)}</div>`);
  return rows.join('');
}

AIUsageProviders.register({
  id: 'gemini',
  label: 'Google Gemini',
  needs: 'session',
  openUrl: 'https://gemini.google.com/usage',
  // 取数：service worker 里只读缓存；页面里缓存过期时才去后台抓一次
  async fetchData() {
    const { usageCache = {} } = await chrome.storage.local.get('usageCache');
    const cached = usageCache[this.id] || null;
    if (typeof document === 'undefined') return cached;
    if (cached && Date.now() - (cached.fetchedAt || 0) < GEMINI_STALE_MS) return cached;
    // 抓取会开一个标签页，失败后 5 分钟内不重试，避免每分钟闪一次
    const attemptKey = `${this.id}ScrapeAttempt`;
    const attempt = await chrome.storage.local.get(attemptKey);
    if (Date.now() - (attempt[attemptKey] || 0) < 5 * 60 * 1000) return cached;
    await chrome.storage.local.set({ [attemptKey]: Date.now() });
    const res = await chrome.runtime.sendMessage({ type: 'AI_USAGE_SCRAPE', target: this.id }).catch(() => null);
    return (res && res.ok && res.data) || cached;
  },
  renderHtml(data) {
    return geminiUsageHtml(data);
  },
  settingsHtml() {
    return `<p>正常登录 <strong>gemini.google.com</strong> 即可。扩展会打开「用量限额」页面读取当前用量与每周限额，不会复制或保存这些会话 Cookie。</p>`;
  },
  async readSettings() {}
});
