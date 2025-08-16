async function sendPanel(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, resolve);
  });
}

async function refresh() {
  const s = await sendPanel('PANEL_QUERY');
  const scopeEl = document.getElementById('scopeStatus');
  const countsEl = document.getElementById('counts');
  const ttsToggle = document.getElementById('ttsToggle');

  if (s?.error) {
    scopeEl.textContent = `Error: ${s.error}`;
    return;
  }
  scopeEl.textContent = `Scope: ${s.scoped ? 'Active' : 'None'}`;
  countsEl.textContent = `Responses: ${s.counts.responses} • Headings (in scope): ${s.counts.headings} • Topics (in scope): ${s.counts.topics}`;
  if (typeof s.tts === 'boolean') ttsToggle.checked = s.tts;
}

function hook(id, cmd) {
  document.getElementById(id).addEventListener('click', async () => {
    await sendPanel('PANEL_CMD', { cmd });
    refresh();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  hook('scopeLatest', 'scopeLatest');
  hook('clearScope',  'clearScope');
  hook('read',        'read');
  hook('nextHeading', 'nextHeading');
  hook('prevHeading', 'prevHeading');
  hook('nextResp',    'nextResp');
  hook('prevResp',    'prevResp');

  document.getElementById('ttsToggle').addEventListener('change', async () => {
    await sendPanel('PANEL_CMD', { cmd: 'toggleTTS' });
    refresh();
  });

  refresh();
});
