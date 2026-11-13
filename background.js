const POPUP_URL = chrome.runtime.getURL('popup.html');
const WINDOW_URL = `${POPUP_URL}?container=window`;
const TAB_URL = `${POPUP_URL}?container=tab`;
const WINDOW_KEY = 'popupWindowId';
const TAB_KEY = 'popupTabId';

// Pings the tracked tab; only our popup.html page answers, so this tells us
// whether the tab is still ours or the user navigated it somewhere else.
// A rejection can also mean the tab is still loading (no listener yet), so
// retry while the tab exists instead of declaring it foreign immediately.
async function isPopupTab(tabId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'AI_USAGE_PING' });
      return response?.ok === true;
    } catch {
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        return false; // tab no longer exists
      }
      if (tab.status !== 'loading') return false; // loaded but has no listener — not ours
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

async function focusOrCreateWindow() {
  const { [WINDOW_KEY]: storedId } = await chrome.storage.session.get(WINDOW_KEY);
  if (storedId != null) {
    try {
      const win = await chrome.windows.get(storedId);
      if (win && win.type === 'popup') {
        await chrome.windows.update(storedId, { focused: true });
        return;
      }
    } catch { /* window no longer exists */ }
    await chrome.storage.session.remove(WINDOW_KEY);
  }
  const win = await chrome.windows.create({
    url: WINDOW_URL,
    type: 'popup',
    width: 400,
    height: 720
  });
  await chrome.storage.session.set({ [WINDOW_KEY]: win.id });
}

async function focusOrCreateTab() {
  const { [TAB_KEY]: storedId } = await chrome.storage.session.get(TAB_KEY);
  if (storedId != null) {
    if (await isPopupTab(storedId)) {
      try {
        const tab = await chrome.tabs.get(storedId);
        await chrome.tabs.update(storedId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return;
      } catch { /* tab or window no longer exists */ }
    }
    await chrome.storage.session.remove(TAB_KEY);
  }
  const tab = await chrome.tabs.create({ url: TAB_URL });
  await chrome.storage.session.set({ [TAB_KEY]: tab.id });
}

async function closeTrackedTab() {
  const { [TAB_KEY]: tabId } = await chrome.storage.session.get(TAB_KEY);
  if (tabId == null) return;
  await chrome.storage.session.remove(TAB_KEY);
  if (!(await isPopupTab(tabId))) return; // user navigated it elsewhere — leave it
  try {
    await chrome.tabs.remove(tabId);
  } catch { /* tab no longer exists */ }
}

async function openWindow() {
  const { [TAB_KEY]: tabId } = await chrome.storage.session.get(TAB_KEY);
  if (tabId != null) await closeTrackedTab();
  return focusOrCreateWindow();
}

async function openTab() {
  const { [WINDOW_KEY]: winId } = await chrome.storage.session.get(WINDOW_KEY);
  await chrome.storage.session.remove(WINDOW_KEY);
  if (winId != null) {
    try { await chrome.windows.remove(winId); } catch { /* window no longer exists */ }
  }
  return focusOrCreateTab();
}

// View opens go through this single chain so rapid switches cannot
// interleave — e.g. a tab switch removing a window a window switch is
// about to focus.
let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch(() => { /* next task still runs */ });
  return run;
}

// ===== 用量页读取（仅按需）=====
// Gemini / Grok 没有可用的公开 JSON 用量接口（batchexecute 空返回 / gRPC-web protobuf），
// 只能打开用量页读渲染结果。开页会在标签栏里闪现，所以：
//   - 后台定时刷新（headlessRefresh）完全不调用这里，浏览器启动时零弹窗
//   - 只在「打开面板且缓存过期」时，由 provider 发 AI_USAGE_SCRAPE 触发一次
const USAGE_PAGES = {
  gemini: { urls: ['https://gemini.google.com/usage'], active: false, settleMs: 1500, timeoutMs: 30000 },
  // 2026-11-13：Grok 把用量挪进设置分区（?referrer=x&_s=usage），
  // 旧地址 ?usage=&_s=usage 已不稳定。依次试三个入口，命中即返回；
  // 全部用不可见标签页，抓完立刻关掉，不抢焦点。
  grok: {
    urls: [
      'https://grok.com/?referrer=x&_s=usage',
      'https://grok.com/?usage=&_s=usage',
      'https://grok.com/?usage='
    ],
    active: false, settleMs: 2500, perUrlMs: 20000, timeoutMs: 60000
  }
};

async function scrapeUsage(target) {
  const cfg = USAGE_PAGES[target];
  if (!cfg) throw new Error(`unknown target: ${target}`);
  const urls = cfg.urls || (cfg.url ? [cfg.url] : []);
  const deadline = Date.now() + cfg.timeoutMs;
  const perUrlMs = cfg.perUrlMs || Math.ceil(cfg.timeoutMs / Math.max(urls.length, 1));
  const attempts = [];
  for (const url of urls) {
    if (Date.now() >= deadline) break;
    const until = Math.min(deadline, Date.now() + perUrlMs);
    let tab;
    let polls = 0;
    let lastRes = null;
    let urlError = '';
    try {
      tab = await chrome.tabs.create({ url, active: cfg.active !== false });
      await new Promise((resolve) => setTimeout(resolve, cfg.settleMs));
      while (Date.now() < until) {
        try {
          polls += 1;
          let readTimer;
          const res = await Promise.race([
            chrome.tabs.sendMessage(tab.id, { type: 'AI_USAGE_READ' }),
            new Promise((_, reject) => {
              readTimer = setTimeout(() => reject(new Error('read timeout')), 3000);
            })
          ]).finally(() => clearTimeout(readTimer));
          lastRes = res ? { ok: !!res.ok, hasData: !!(res.data) } : null;
          if (res && res.ok && res.data) {
            const { usageCache = {} } = await chrome.storage.local.get('usageCache');
            usageCache[target] = res.data;
            await chrome.storage.local.set({ usageCache });
            if (target === 'grok') {
              try {
                await chrome.storage.local.set({
                  __grokScrapeDiag: { at: Date.now(), ok: true, url,
                    pct: res.data?.weekly?.pct, reset: res.data?.weekly?.reset }
                });
              } catch { /* 诊断写失败不影响主流程 */ }
            }
            return res.data;
          }
        } catch (error) { urlError = String(error); /* 页面尚未注入或尚未渲染出面板 */ }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } finally {
      attempts.push({ url, polls, lastRes, urlError });
      if (tab && tab.id != null) {
        try { await chrome.tabs.remove(tab.id); } catch { /* 已关闭 */ }
      }
    }
  }
  if (target === 'grok') {
    try {
      await chrome.storage.local.set({
        __grokScrapeDiag: { at: Date.now(), ok: false, urls, attempts, timeoutMs: cfg.timeoutMs }
      });
    } catch { /* 诊断写失败不影响主流程 */ }
  }
  return null;
}

// 抓取串行化：gemini / grok 对 usageCache 做 read-modify-write，并发时
// 后写入的一方会抹掉另一方刚抓到的数据。
let scrapeQueue = Promise.resolve();
function enqueueScrape(target) {
  const run = scrapeQueue.then(() => scrapeUsage(target));
  scrapeQueue = run.catch(() => { /* 下一个照常执行 */ });
  return run;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'AI_USAGE_SCRAPE') {
    enqueueScrape(message.target)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'AI_USAGE_OPEN_WINDOW' || message?.type === 'AI_USAGE_OPEN_TAB') {
    const task = message.type === 'AI_USAGE_OPEN_WINDOW' ? openWindow : openTab;
    enqueue(task)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'AI_USAGE_PING') {
    sendResponse({ ok: true });
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { [WINDOW_KEY]: storedId } = await chrome.storage.session.get(WINDOW_KEY);
  if (storedId === windowId) await chrome.storage.session.remove(WINDOW_KEY);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { [TAB_KEY]: storedId } = await chrome.storage.session.get(TAB_KEY);
  if (storedId === tabId) await chrome.storage.session.remove(TAB_KEY);
});

// ===== 临时抓取代码已移除 =====
chrome.storage.local.remove(['__netLog', '__probe', '__snap', '__grokBootDiag']);

// ===== 后台定时刷新 =====
// service worker 没有 DOM，所以只调用各服务商的 fetchData()（纯取数），
// 结果写进 storage，弹窗打开时直接用。Grok 无法后台刷新（面板必须人工打开过）。
const USAGE_DATA_KEY = 'usageData';
const ALARM_NAME = 'ai-usage-refresh';
const REFRESH_MINUTES = 15;

try {
  importScripts('providers.js', 'providers/chatgpt.js', 'providers/gemini.js', 'providers/grok.js');
} catch (error) {
  console.warn('provider 脚本加载失败', error);
}

async function headlessRefresh() {
  try {
    const prefs = await loadProviderPrefs();
    const providers = AIUsageProviders.enabledIds(prefs.enabled);
    const collected = {};
    for (const provider of providers) {
      if (typeof provider.fetchData !== 'function') continue;
      // 方案 A：Gemini / Grok 只能靠打开网页读渲染结果，后台开页会在标签栏闪一下。
      // 所以后台定时刷新完全不碰它们，改由「打开面板时按需抓取」。
      if (provider.id === 'gemini' || provider.id === 'grok') continue;
      try {
        const data = await provider.fetchData();
        if (data) collected[provider.id] = { data, fetchedAt: Date.now() };
      } catch { /* 单个失败不影响其它 */ }
    }
    if (Object.keys(collected).length) {
      const stored = await chrome.storage.local.get(USAGE_DATA_KEY);
      const cache = stored[USAGE_DATA_KEY] || {};
      Object.assign(cache, collected);
      await chrome.storage.local.set({ [USAGE_DATA_KEY]: cache });
    }
  } catch { /* 静默失败，不影响下次 */ }
}

function ensureAlarm() {
  // SW 每次被事件唤醒都会重跑顶层；无脑 create 会把 delayInMinutes:1
  // 反复重置，15 分钟的定时刷新会被饿死。先查再建。
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm) chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_MINUTES, delayInMinutes: 1 });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  headlessRefresh();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  headlessRefresh();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) headlessRefresh();
});

ensureAlarm();

