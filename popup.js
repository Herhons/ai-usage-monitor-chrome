const $ = (id) => document.getElementById(id);

// Where this page lives: 'popup' (native action popup), 'window' (popup
// window), or 'tab'. The background appends ?container= when it opens the
// page as a window or tab; the native popup has no parameter.
const CONTAINER = new URLSearchParams(location.search).get('container') ?? 'popup';
document.body.classList.add(`container-${CONTAINER}`);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'AI_USAGE_PING') sendResponse({ ok: true });
});

// Pop out to a window or tab, then dismiss this page. The native popup
// must close itself (the background doesn't track it); when switching
// containers the background closes the window/tab it swaps out, so the
// page's window.close() is only the redundant path. Clicking the button
// for the container we're already in does nothing.
document.querySelector('.view-switcher').addEventListener('click', async (event) => {
  const btn = event.target.closest('.view-btn');
  if (!btn || !btn.dataset.openContainer) return;
  if (btn.dataset.openContainer === CONTAINER) return;
  const type = btn.dataset.openContainer === 'window' ? 'AI_USAGE_OPEN_WINDOW' : 'AI_USAGE_OPEN_TAB';
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type });
  } catch { /* view may already be switching */ }
  if (!response?.ok) return;
  window.close();
});

$('closeView').addEventListener('click', () => window.close());

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  chrome.windows.getCurrent().then((win) => {
    if (win?.type === 'popup') window.close();
  });
});

function providerCardHtml(p) {
  return `
    <section class="provider" id="card-${p.id}">
      <div class="provider-head">
        <div class="provider-title">
          <h2>${escapeHtml(p.label)}</h2>
          ${p.plan ? `<span id="card-${p.id}-plan" class="plan-badge">${escapeHtml(p.plan)}</span>` : ''}
        </div>
        ${p.openUrl ? `<button class="small-btn" data-open="${escapeHtml(p.openUrl)}">打开</button>` : ''}
      </div>
      <div id="card-${p.id}-body" class="body"><div class="loading">加载中…</div></div>
    </section>`;
}

let refreshing = false;
const USAGE_DATA_KEY = 'usageData';

function providerBody(p) {
  return document.getElementById(`card-${p.id}-body`);
}

// 把数据画进卡片。data 为 null 时给出占位/提示。
function stampHtml(meta) {
  if (!meta || !meta.fetchedAt) return '';
  const t = new Date(meta.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `<div class="hint">更新于 ${t}</div>`;
}

function paintProvider(p, data, error, meta) {
  const body = providerBody(p);
  if (!body) return false;
  if (error) {
    body.innerHTML = errorHtml(`加载失败：${error.message}`, error.hint || '');
    return false;
  }
  if (!data) {
    body.innerHTML = p.id === 'grok'
      ? '<div class="hint">尚未读取。打开 Grok → 左下角头像 → 设置 → 使用量，数值会自动记录。</div>'
      : notAvailableHtml('暂不可用');
    return false;
  }
  const html = typeof p.renderHtml === 'function' ? p.renderHtml(data) : '';
  if (!html) {
    body.innerHTML = notAvailableHtml('暂不可用');
    return false;
  }
  body.innerHTML = html + stampHtml(meta);
  return true;
}

// 首屏：先用上一次存下来的数据秒开，不等网络
async function paintFromCache(providers) {
  const stored = await chrome.storage.local.get(USAGE_DATA_KEY);
  const cache = stored[USAGE_DATA_KEY] || {};
  for (const p of providers) {
    const entry = cache[p.id];
    if (entry && entry.data) paintProvider(p, entry.data, null, { fetchedAt: entry.fetchedAt });
  }
}

async function refreshOne(p, silent, collected) {
  const body = providerBody(p);
  if (!body) return false;
  try {
    if (typeof p.fetchData === 'function') {
      if (!silent) body.innerHTML = '<div class="loading">加载中…</div>';
      const data = await p.fetchData();
      if (data) collected[p.id] = { data, fetchedAt: data.fetchedAt || Date.now() };
      return paintProvider(p, data, null, data ? { fetchedAt: data.fetchedAt || Date.now() } : null);
    }
    // 尚未迁移到 fetchData/renderHtml 的服务商，沿用旧的 refresh
    if (typeof p.refresh === 'function') return await p.refresh(silent);
    return false;
  } catch (error) {
    const stored = await chrome.storage.local.get(USAGE_DATA_KEY);
    const entry = (stored[USAGE_DATA_KEY] || {})[p.id];
    if (entry && entry.data) {
      paintProvider(p, entry.data, null, { fetchedAt: entry.fetchedAt, failed: true });
      return false;
    }
    return paintProvider(p, null, error);
  }
}

async function refreshAll(silent = false) {
  if (refreshing) return;
  refreshing = true;
  try {
    const prefs = await loadProviderPrefs();
    const providers = AIUsageProviders.enabledIds(prefs.enabled);
    const button = $('refreshAll');
    if (!silent && providers.length) {
      button.classList.add('spinning');
      button.disabled = true;
    }
    const collected = {};
    const results = await Promise.all(providers.map((p) => refreshOne(p, silent, collected)));
    if (Object.keys(collected).length) {
      const stored = await chrome.storage.local.get(USAGE_DATA_KEY);
      const cache = stored[USAGE_DATA_KEY] || {};
      Object.assign(cache, collected);
      await chrome.storage.local.set({ [USAGE_DATA_KEY]: cache });
    }
    if (results.includes(true)) {
      $('updatedAt').textContent = `更新于 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (!silent) {
      button.classList.remove('spinning');
      button.disabled = false;
    }
  } finally {
    refreshing = false;
  }
}

async function render() {
  const prefs = await loadProviderPrefs();
  const providers = AIUsageProviders.enabledIds(prefs.enabled);
  $('providers').innerHTML = providers.map(providerCardHtml).join('');
  $('emptyState').hidden = providers.length > 0;
  document.body.classList.toggle('empty-popup', providers.length === 0);
  if (providers.length) {
    await paintFromCache(providers);   // 先用上次的数据秒开
    await refreshAll(true);            // 再取最新
  }
}

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('refreshAll').addEventListener('click', () => refreshAll(true));
$('emptySettings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
// Cards render dynamically after load — delegate the Open buttons
document.querySelector('.shell').addEventListener('click', (event) => {
  const open = event.target.closest('[data-open]');
  if (open) chrome.tabs.create({ url: open.dataset.open });
});

render();
setInterval(() => { if (!document.hidden) refreshAll(true); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(true); });

async function fitWindowToContent() {
  const win = await chrome.windows.getCurrent();
  if (CONTAINER !== 'window' || !win || win.state !== 'normal' || win.type !== 'popup') return;
  const shell = document.querySelector('.shell');
  const docHeight = Math.ceil(shell?.getBoundingClientRect().height || document.documentElement.scrollHeight);
  const frame = Math.max(0, (window.outerHeight || 0) - (window.innerHeight || 0));
  const target = {
    width: 400,
    height: Math.min(docHeight + frame, Math.floor(screen.availHeight))
  };
  if (win.width === target.width && win.height === target.height) return;
  try {
    await chrome.windows.update(win.id, target);
  } catch { /* bounds may be mid-drag; re-check on the next tick */ }
}

// Auto-fit only matters in the popup window, the one container the
// extension can resize. In the native popup (and tab) observing the body
// would only echo content growth back into a ResizeObserver that can't
// act on it, producing a "loop completed with undelivered notifications"
// warning. The native popup is sized to a fixed height in CSS instead.
if (CONTAINER === 'window') {
  new ResizeObserver(() => fitWindowToContent()).observe(document.body);
  setInterval(() => fitWindowToContent(), 500);
}
