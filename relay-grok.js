(() => {
  if (globalThis.__aiUsageGrokRelayInstalled) return;
  globalThis.__aiUsageGrokRelayInstalled = true;

  // grok.com「使用量」面板读数。
  //
  // 2026-11-13 新版实测（设置 → 使用量）：
  //   每周 Premium 限额
  //   100% 已使用                    重置2026年11月13日 19:48
  //   Grok Bot 91% · 聊天 9%
  //   额外使用积分 / 余额: US$0.00
  // 主百分比已经不是 <number-flow-react aria-label>，而是普通文本「100% 已使用」；
  // 另外「Grok Bot」在侧边栏机器人分组里也有，明细必须从限额标题之后开始截。
  //
  // 抓取策略：百分比多路取（aria-label → 文本）、文案门槛放宽、解析不出来时
  // 只在后台隐藏标签页里补点「使用量」菜单，并把现场写进 __grokDiag。

  const DIAG_KEY = '__grokDiag';
  const PANEL_RE = /已使用|限额|使用量|Premium|Usage|额度/i;
  let lastDiagAt = 0;
  let lastMenuClick = 0;

  function pctOf(label) {
    const m = String(label == null ? '' : label).trim().match(/^([\d.]+)\s*%$/);
    return m ? Number(m[1]) : null;
  }

  function addPct(out, value) {
    const v = pctOf(value);
    if (v != null && Number.isFinite(v)) out.push(v);
  }

  // 按 DOM 序收集百分比：先看旧版数字组件，再看所有带 aria-label 的元素。
  function domPercents() {
    const out = [];
    for (const node of document.querySelectorAll('number-flow-react')) {
      addPct(out, node.getAttribute && node.getAttribute('aria-label'));
      addPct(out, node.textContent);
    }
    for (const node of document.querySelectorAll('[aria-label]')) {
      addPct(out, node.getAttribute('aria-label'));
    }
    return out;
  }

  function textPercents(text) {
    const out = [];
    const re = /(?:^|[\s(（])([\d.]+)\s*%/gm;
    let m;
    while ((m = re.exec(text)) !== null && out.length < 20) {
      const v = Number(m[1]);
      if (Number.isFinite(v)) out.push(v);
    }
    return out;
  }

  function creditsLabel() {
    for (const node of document.querySelectorAll('[aria-label]')) {
      const label = (node.getAttribute('aria-label') || '').trim();
      if (/^US\$/i.test(label)) return label;
    }
    // 新版「余额: US$0.00」是普通文本，不再带 aria-label
    const m = String(document.body ? document.body.innerText : '').match(/US\$\s*[\d,.]+/i);
    return m ? m[0] : '';
  }

  function joinPairs(tokens) {
    const out = [];
    let prev = null;
    for (const token of tokens) {
      if (/^\d+(\.\d+)?%$/.test(token)) {
        if (prev != null) {
          out.push(`${prev} ${token}`);
          prev = null;
        } else {
          out.push(token);
        }
      } else {
        if (prev != null) out.push(prev);
        prev = token;
      }
    }
    if (prev != null) out.push(prev);
    return out.join(' · ');
  }

  function parseUsage() {
    const text = document.body ? document.body.innerText : '';
    if (!text || !PANEL_RE.test(text)) return null;

    // 面板特征必须同时成立：有「每周…限额」标题 + 有重置日期。
    // 否则聊天页里一句「您已达到每周限额」加任意 % 就会被当成周额度写进缓存。
    const labelCandidates = text.match(/每周[^\n]{0,20}限额/g) || [];
    const resetMatch = text.match(/重置\s*([0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日[^\n]*)/)
      || text.match(/重置\s*([0-9]{1,2}月[0-9]{1,2}日[^\n]*)/)
      || text.match(/(?:Resets?|Next reset)\s*[:：]?\s*([^\n]{4,40})/i);
    if (!labelCandidates.length || !resetMatch) return null;

    // 主百分比优先取「100% 已使用」这种带上下文的，其次旧版 aria-label，最后才兜底。
    const usedMatch = text.match(/([\d.]+)\s*%\s*(?:已使用|used)/i)
      || text.match(/(?:已使用|used)\s*:?\s*([\d.]+)\s*%/i);
    const dom = domPercents();
    const fromText = textPercents(text);
    const pct = usedMatch ? Number(usedMatch[1]) : (dom.length ? dom[0] : (fromText.length ? fromText[0] : null));
    if (pct == null || !Number.isFinite(pct)) return null;

    // 提示语里也有「每周限额」（"您已达到每周限额"），取最后一个候选才是面板标题。
    const label = labelCandidates[labelCandidates.length - 1].trim();

    let detail = '';
    // 「Grok Bot」也出现在侧边栏机器人分组，从限额标题之后开始找才不会串台。
    const labelAt = text.lastIndexOf(label);
    const startAt = text.indexOf('Grok Bot', labelAt >= 0 ? labelAt : 0);
    if (startAt >= 0) {
      let endAt = -1;
      for (const marker of ['额外', 'Manage', '管理积分', '自动充值']) {
        const i = text.indexOf(marker, startAt);
        if (i > startAt) { endAt = i; break; }
      }
      if (endAt < 0) endAt = startAt + 90;
      const seg = text.slice(startAt, Math.min(endAt, startAt + 160));
      const parts = seg.split('\n').map((s) => s.trim()).filter(Boolean);
      detail = joinPairs(parts);
    }

    return {
      weekly: {
        pct: Math.round(pct * 10) / 10,
        reset: resetMatch ? resetMatch[1].trim() : '',
        detail,
        label,
        credits: creditsLabel()
      },
      fetchedAt: Date.now()
    };
  }

  // 新版面板可能要点击「设置 → 使用量」才渲染。只在后台隐藏标签页里补点，
  // 绝不碰用户正在看的标签页；8 秒内最多一次。
  function tryOpenUsagePanel() {
    if (document.visibilityState !== 'hidden') return false;
    if (Date.now() - lastMenuClick < 8000) return false;
    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [tabindex]'));
    const hit = nodes.find((n) => {
      const t = String(n.innerText || n.textContent || '').trim();
      if (t === '使用量' || t === 'Usage') return true;
      const aria = n.getAttribute && n.getAttribute('aria-label');
      return /使用量|Usage/i.test(aria || '');
    });
    if (!hit) return false;
    lastMenuClick = Date.now();
    try { hit.click(); return true; } catch { return false; }
  }

  // ===== 现场诊断：解析不出来时留一份只读快照 =====
  // 诊断只记录结构信息，绝不落盘页面文本 / 标题 / 会话 id。
  function probe() {
    const text = document.body ? document.body.innerText : '';
    const ariaLabels = Array.from(document.querySelectorAll('[aria-label]'))
      .map((n) => String(n.getAttribute('aria-label') || '').trim())
      .filter((s) => /^[\d.]+\s*%$/.test(s)).slice(0, 10);
    const customTags = Array.from(new Set(Array.from(document.querySelectorAll('*'))
      .map((n) => String(n.tagName || '').toLowerCase())
      .filter((t) => t.includes('-')))).slice(0, 40);
    return {
      origin: String(location.origin),
      path: String(location.pathname),
      at: Date.now(),
      panelMatch: PANEL_RE.test(text),
      hasLabel: (text.match(/每周[^\n]{0,20}限额/g) || []).length > 0,
      hasReset: /重置\s*[0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日/.test(text)
        || /重置\s*[0-9]{1,2}月[0-9]{1,2}日/.test(text)
        || /(?:Resets?|Next reset)\s*[:：]?/i.test(text),
      flowCount: document.querySelectorAll('number-flow-react').length,
      ariaLabels,
      domPcts: domPercents().slice(0, 10),
      textPcts: textPercents(text).slice(0, 10),
      customTags
    };
  }

  function saveDiag(reason, extra) {
    // 只在后台隐藏标签页里留诊断，绝不在用户可见的标签页落盘任何东西。
    if (document.visibilityState !== 'hidden') return;
    const now = Date.now();
    if (now - lastDiagAt < 4000) return;
    lastDiagAt = now;
    try {
      chrome.storage.local.set({ [DIAG_KEY]: Object.assign({ reason }, probe(), extra || {}) });
    } catch { /* storage 不可用时不影响读数 */ }
  }

  let lastSave = 0;
  // 数字滚动动画中间采样会得到错误数字，要求连续两次读数一致才采纳。
  let lastPct = null;
  function stableEnough(pct) {
    const stable = lastPct != null && Math.abs(lastPct - pct) < 0.01;
    lastPct = pct;
    return stable;
  }

  function saveCache(data) {
    if (Date.now() - lastSave < 5000) return;
    lastSave = Date.now();
    chrome.storage.local.get('usageCache', (prev) => {
      const cache = (prev && prev.usageCache) || {};
      const old = cache.grok;
      if (old && old.fetchedAt && Date.now() - old.fetchedAt < 60000) return;
      cache.grok = data;
      chrome.storage.local.set({ usageCache: cache });
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;
    if (message.type === 'AI_USAGE_READ') {
      const data = parseUsage();
      if (!data) {
        const clicked = tryOpenUsagePanel();
        saveDiag(clicked ? 'parse_null_clicked_usage' : 'parse_null', { clicked });
      }
      const ok = data && stableEnough(data.weekly.pct);
      if (ok) saveCache(data);
      else if (data) saveDiag('unstable', { pct: data.weekly.pct });
      sendResponse({ ok: true, data: ok ? data : null });
      return true;
    }
    if (message.type !== 'AI_USAGE_GROK') return;
    if (sender?.id !== chrome.runtime.id) return;
    sendResponse({ ok: false, error: 'grok 已改用页面读数' });
    return true;
  });

  // 被动缓存：只要面板出现（用户自己打开也行）就记录，绝不由这里打开标签页
  setInterval(() => {
    const data = parseUsage();
    if (!data) { saveDiag('passive_parse_null'); return; }
    if (!stableEnough(data.weekly.pct)) return;
    saveCache(data);
  }, 3000);
})();
