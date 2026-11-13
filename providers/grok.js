// xAI Grok 用量适配器。
//
// 老接口 /rest/usage/free-usage-gates 返回的是「免费层门控」，用
// allowance: 5000000000 这类哨兵值表示不设上限，对 SuperGrok 订阅者没有意义。
// 新版真实额度来自 gRPC-web protobuf：
//   POST /grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig
//   GET  /prod_mc_billing.ConsumerUiSvc/GetRemainingResets
// 二进制没有 schema 无法反解，因此改为由后台打开 grok.com 的「使用量」面板
// 读取渲染结果，结果缓存在 chrome.storage.local.usageCache 里。
//
// 2026-11-13：面板入口改版（设置分区 ?referrer=x&_s=usage），旧地址抓不到数时
// 会静默回落旧缓存。这里给过期数据加显式提示，并缩短过期后的重试冷却。

const GROK_STALE_MS = 15 * 60 * 1000;
const GROK_EXPIRED_MS = 2 * 60 * 60 * 1000;

function grokAgeText(fetchedAt) {
  if (!fetchedAt) return '';
  const minutes = Math.round((Date.now() - fetchedAt) / 60000);
  if (minutes <= 0) return '刚刚读取';
  if (minutes < 60) return `${minutes} 分钟前读取`;
  const hours = Math.round(minutes / 60);
  return `${hours} 小时前读取`;
}

function grokUsageHtml(data) {
  const week = data.weekly || {};
  if (week.pct == null) return '';
  const label = week.label || '每周限额';
  const rows = [metricHtml(label, week.pct, week.reset ? `重置 ${week.reset}` : '')];
  if (week.detail) rows.push(`<div class="metric-meta">${escapeHtml(week.detail)}</div>`);
  const age = grokAgeText(data.fetchedAt);
  if (age) rows.push(`<div class="metric-meta">${escapeHtml(age)}</div>`);
  if (data.fetchedAt && Date.now() - data.fetchedAt > GROK_EXPIRED_MS) {
    rows.push('<div class="metric-meta">数据已过期：最近一次自动抓取未成功</div>');
  }
  return rows.join('');
}

AIUsageProviders.register({
  id: 'grok',
  label: 'xAI Grok',
  needs: 'session',
  openUrl: 'https://grok.com/?referrer=x&_s=usage',
  // 取数：缓存够新就直接用；过期时请后台开一个不可见标签页去读。
  // 解析支持 aria-label 与页面文本两条路，不依赖面板可见性。
  async fetchData() {
    const { usageCache = {} } = await chrome.storage.local.get('usageCache');
    const cached = usageCache[this.id] || null;
    if (typeof document === 'undefined') return cached;
    if (cached && Date.now() - (cached.fetchedAt || 0) < GROK_STALE_MS) return cached;
    // 抓取会开标签页：缓存新鲜时 5 分钟内不重试；缓存已过期（连续抓取失败）
    // 时缩短到 1 分钟，否则旧数据会把故障一直盖住。
    const attemptKey = `${this.id}ScrapeAttempt`;
    const attempt = await chrome.storage.local.get(attemptKey);
    const expired = cached && Date.now() - (cached.fetchedAt || 0) > GROK_EXPIRED_MS;
    const cooldown = expired ? 60 * 1000 : 5 * 60 * 1000;
    if (Date.now() - (attempt[attemptKey] || 0) < cooldown) return cached;
    await chrome.storage.local.set({ [attemptKey]: Date.now() });
    const res = await chrome.runtime.sendMessage({ type: 'AI_USAGE_SCRAPE', target: this.id }).catch(() => null);
    return (res && res.ok && res.data) || cached;
  },
  renderHtml(data) {
    return grokUsageHtml(data);
  },
  settingsHtml() {
    return `<p>正常登录 <strong>grok.com</strong> 即可。扩展会打开「设置 → 使用量」面板读取每周额度，不会复制或保存这些会话 Cookie。</p>`;
  },
  async readSettings() {}
});
