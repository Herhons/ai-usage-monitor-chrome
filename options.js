async function render() {
  const prefs = await loadProviderPrefs();
  const container = document.getElementById('providerSettings');
  container.innerHTML = AIUsageProviders.list.map((p) => `
    <section class="provider-setting">
      <h2>${escapeHtml(p.label)}</h2>
      <label class="toggle-row">
        <input type="checkbox" id="en-${p.id}" ${prefs.enabled.has(p.id) ? 'checked' : ''} />
        <span>启用 ${escapeHtml(p.label)}</span>
      </label>
      <div class="config">${p.settingsHtml()}</div>
    </section>
  `).join('');
  const { opencodeApiKey = '' } = await chrome.storage.local.get('opencodeApiKey');
  const keyInput = document.getElementById('cfg-opencode-key');
  if (keyInput) keyInput.value = opencodeApiKey;
}

document.getElementById('save').addEventListener('click', async () => {
  const prefs = await loadProviderPrefs();
  const map = Object.fromEntries(AIUsageProviders.list.map((p) => [
    p.id,
    document.getElementById(`en-${p.id}`).checked
  ]));
  await chrome.storage.local.set({
    enabledProviders: map
  });
  for (const p of AIUsageProviders.list) await p.readSettings();
  const status = document.getElementById('status');
  status.textContent = '已保存';
  setTimeout(() => { status.textContent = ''; }, 1500);
});

document.getElementById('providerSettings').addEventListener('click', (event) => {
  if (event.target.id !== 'cfg-opencode-toggle') return;
  const input = document.getElementById('cfg-opencode-key');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  event.target.textContent = show ? '隐藏' : '显示';
});

render();
