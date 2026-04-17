(() => {
  const statusEl = document.getElementById('status');
  const tokenInput = document.getElementById('adminToken');
  const loadBtn = document.getElementById('loadBtn');
  const publishBtn = document.getElementById('publishBtn');

  if (!window.APP_CONFIG || !APP_CONFIG.scriptUrl || APP_CONFIG.scriptUrl.includes('PASTE_')) {
    statusEl.innerHTML = '<p class="result err">Not configured: set <code>scriptUrl</code> in <code>docs/config.js</code>.</p>';
    return;
  }

  loadBtn.addEventListener('click', load);
  tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  publishBtn.addEventListener('click', publish);

  async function load() {
    const token = tokenInput.value.trim();
    statusEl.textContent = 'Loading…';
    try {
      const r = await fetch(
        APP_CONFIG.scriptUrl + '?action=admin&admin_token=' + encodeURIComponent(token),
        { method: 'GET', redirect: 'follow' }
      );
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      render(data);
    } catch (e) {
      statusEl.innerHTML = `<p class="result err">Error: ${escapeHtml(e.message)}</p>`;
      publishBtn.hidden = true;
    }
  }

  async function publish() {
    const token = tokenInput.value.trim();
    if (!confirm('Force-publish CSVs even if not all students have submitted?')) return;
    publishBtn.disabled = true;
    try {
      const r = await fetch(APP_CONFIG.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'publish', admin_token: token }),
        redirect: 'follow'
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      alert('Published. Refreshing…');
      load();
    } catch (e) {
      alert('Publish failed: ' + e.message);
    } finally {
      publishBtn.disabled = false;
    }
  }

  function render(data) {
    publishBtn.hidden = data.published;
    const byNetwork = Object.entries(data.byNetwork).map(([id, v]) => `
      <section class="admin-section">
        <h2>${escapeHtml(v.title)} <small>${v.done.length} / ${data.total_students} done</small></h2>
        <details ${v.missing.length ? 'open' : ''}>
          <summary>Missing (${v.missing.length})</summary>
          <ul>${v.missing.map(n => `<li>${escapeHtml(n)}</li>`).join('') || '<li class="muted">Everyone submitted.</li>'}</ul>
        </details>
        <details>
          <summary>Submitted (${v.done.length})</summary>
          <ul>${v.done.map(n => `<li>${escapeHtml(n)}</li>`).join('') || '<li class="muted">None yet.</li>'}</ul>
        </details>
      </section>
    `).join('');
    statusEl.innerHTML = `
      <p><strong>Published:</strong> ${data.published ? 'yes — CSVs live' : 'no'} &nbsp;|&nbsp;
         <strong>Release mode:</strong> ${escapeHtml(data.release_mode)} &nbsp;|&nbsp;
         <strong>Overall:</strong> ${data.done} / ${data.total}</p>
      ${byNetwork}`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
