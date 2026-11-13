AIUsageProviders.register({
  id: 'opencode',
  label: 'OpenCode',
  plan: 'Go',
  needs: 'key',
  openUrl: 'https://opencode.ai',
  async refresh(silent = false) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    if (!silent) body.innerHTML = '<div class="loading">加载中…</div>';
    const { opencodeApiKey = '' } = await chrome.storage.local.get('opencodeApiKey');
    if (!opencodeApiKey.trim()) {
      if (!silent) body.innerHTML = errorHtml('尚未配置 OpenCode API Key', '打开设置，填入你的 OpenCode Go API Key。');
      return false;
    }

    try {
      const data = await jsonFetch('https://opencode.ai/zen/go/v1/usage', {
        headers: {
          'Authorization': `Bearer ${opencodeApiKey.trim()}`,
          'Accept': 'application/json'
        }
      });

      const usage = data?.usage ?? data;
      const windows = [
        ['5 小时', usage?.rolling5h ?? usage?.rolling ?? usage?.five_hour ?? usage?.fiveHour],
        ['每周', usage?.weekly ?? usage?.seven_day ?? usage?.sevenDay],
        ['每月', usage?.monthly ?? usage?.thirty_day ?? usage?.month]
      ];

      const html = windows.map(([label, w]) => {
        if (!w) return '';
        const used = firstNumber(w.usageDollars, w.usage_dollars, w.used, w.usage);
        const limit = firstNumber(w.limitDollars, w.limit_dollars, w.limit, w.allowance);
        const pctRaw = firstNumber(w.usagePercent, w.usage_percent, w.utilization, w.percent);
        const pct = pctRaw != null ? clampPercent(pctRaw) : (limit && used != null ? clampPercent((used / limit) * 100) : null);
        const reset = resetMeta(w.resetsAt ?? w.resetAt ?? w.reset_at ?? w.resetInSec ?? w.reset_in_sec ?? w.resets_at);
        const detail = used != null && limit != null ? `${money(used)} / ${money(limit)}` : '';
        return metricHtml(label, pct, reset, detail || null);
      }).join('');

      if (!html) throw new Error('OpenCode 用量返回格式异常');
      body.innerHTML = html;
      return true;
    } catch (error) {
      if (!silent) body.innerHTML = errorHtml(`加载 OpenCode Go 失败：${error.message}`, '请到设置中核对 API Key。');
      return false;
    }
  },
  settingsHtml() {
    return `
      <label for="cfg-opencode-key">API Key</label>
      <div class="input-row">
        <input id="cfg-opencode-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" />
        <button type="button" id="cfg-opencode-toggle">显示</button>
      </div>
      <p class="help">保存在 Chrome 配置文件的 <code>chrome.storage.local</code> 中，只会发送到 <code>https://opencode.ai/zen/go/v1/usage</code>。</p>`;
  },
  async readSettings() {
    const key = document.getElementById('cfg-opencode-key').value.trim();
    await chrome.storage.local.set({ opencodeApiKey: key });
  }
});
