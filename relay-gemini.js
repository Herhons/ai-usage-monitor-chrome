(() => {
  if (globalThis.__aiUsageGeminiRelayInstalled) return;
  globalThis.__aiUsageGeminiRelayInstalled = true;

  // gemini.google.com/usage 会把「当前用量 / 每周限额」渲染成 DOM。
  // 官方没有公开的用量 JSON 接口（batchexecute 返回空数组），
  // 所以这里从渲染结果里读数。
  function parseUsage() {
    const text = (document.body && document.body.innerText) || '';
    const start = text.indexOf('当前用量');
    if (start < 0) return null;
    const rest = text.slice(start);
    const splitAt = rest.indexOf('每周限额');
    const curBlock = splitAt >= 0 ? rest.slice(0, splitAt) : rest;
    const weekBlock = splitAt >= 0 ? rest.slice(splitAt) : '';
    const grab = (block) => {
      const pct = block.match(/已使用\s*([\d.]+)\s*%/);
      const reset = block.match(/重置时间[：:]\s*([^\n]+)/);
      return {
        pct: pct ? Number(pct[1]) : null,
        reset: reset ? reset[1].trim() : ''
      };
    };
    const current = grab(curBlock);
    const weekly = grab(weekBlock);
    if (current.pct == null && weekly.pct == null) return null;
    return { current, weekly, fetchedAt: Date.now() };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;
    if (message.type === 'AI_USAGE_READ') {
      sendResponse({ ok: true, data: parseUsage() });
      return true;
    }
    if (message.type !== 'AI_USAGE_GEMINI') return;
    if (sender?.id !== chrome.runtime.id) return;
    sendResponse({ ok: false, error: 'gemini 无公开用量接口' });
    return true;
  });
})();
