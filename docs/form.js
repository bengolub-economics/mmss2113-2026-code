(() => {
  const qs = new URLSearchParams(location.search);
  const token = qs.get('token');
  const app = document.getElementById('app');

  if (!window.APP_CONFIG || !APP_CONFIG.scriptUrl || APP_CONFIG.scriptUrl.includes('PASTE_')) {
    app.innerHTML = '<h1>Not configured</h1><p>The site administrator needs to set <code>scriptUrl</code> in <code>docs/config.js</code>.</p>';
    return;
  }

  if (!token) {
    app.innerHTML = '<h1>Network Survey</h1><p>This link is incomplete. Please use the personal link from your email.</p>';
    return;
  }

  load();

  async function load() {
    try {
      const r = await fetch(
        APP_CONFIG.scriptUrl + '?action=config&token=' + encodeURIComponent(token),
        { method: 'GET', redirect: 'follow' }
      );
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      render(data);
    } catch (e) {
      app.innerHTML = `<h1>Error</h1><p class="result err">${escapeHtml(e.message)}</p>`;
    }
  }

  function render(data) {
    if (data.published) {
      app.innerHTML = `
        <h1>Hi ${escapeHtml(data.name)}</h1>
        <div class="closed">
          <p>The survey is now closed. Thank you for participating.</p>
        </div>`;
      return;
    }
    const sections = data.networks.map(
      n => networkSection(n, data.classmates, data.submissions[n.id])
    ).join('');
    app.innerHTML = `
      <header class="survey">
        <h1>Network Survey</h1>
        <p class="subtitle">Hi ${escapeHtml(data.name)} — please complete each network below. Allocations must be whole numbers summing to 100.</p>
      </header>
      ${sections}`;
    for (const n of data.networks) wireSection(n.id);
  }

  function networkSection(network, classmates, existing) {
    const rows = classmates.map(c => {
      const val = (existing && existing[c.student_id] != null) ? existing[c.student_id] : 0;
      return `
        <div class="row">
          <label for="${network.id}-${c.student_id}">${escapeHtml(c.name)}</label>
          <input type="number" step="1" min="0" max="100" inputmode="numeric"
            id="${network.id}-${c.student_id}"
            data-network="${network.id}"
            data-target="${c.student_id}"
            data-nonzero="${val > 0 ? 1 : 0}"
            value="${val}">
        </div>`;
    }).join('');
    const completed = existing && Object.keys(existing).length > 0;
    return `
      <section class="network" id="section-${network.id}">
        <h2>${escapeHtml(network.title)}${completed ? ' <span class="badge">saved</span>' : ''}</h2>
        <p class="prompt">${escapeHtml(network.prompt)}</p>
        <div class="summary">
          <div class="sum-bar"><div class="sum-fill" id="bar-${network.id}"></div></div>
          <div class="sum-text" id="text-${network.id}">Allocated 0 / 100 — remaining <strong>100</strong></div>
        </div>
        <div class="allocations">${rows}</div>
        <div class="actions">
          <button type="button" data-network="${network.id}" class="submit-btn" disabled>Save ${escapeHtml(network.title)}</button>
          <span class="result" id="result-${network.id}"></span>
        </div>
      </section>`;
  }

  function wireSection(networkId) {
    const inputs = document.querySelectorAll(`input[data-network="${networkId}"]`);
    const barEl = document.getElementById('bar-' + networkId);
    const textEl = document.getElementById('text-' + networkId);
    const btn = document.querySelector(`.submit-btn[data-network="${networkId}"]`);
    const resEl = document.getElementById('result-' + networkId);

    function recompute() {
      let sum = 0;
      inputs.forEach(i => {
        const v = Math.max(0, Math.floor(Number(i.value) || 0));
        i.dataset.nonzero = v > 0 ? 1 : 0;
        sum += v;
      });
      const pct = Math.min(100, Math.max(0, sum));
      barEl.style.width = pct + '%';
      barEl.className = 'sum-fill' + (sum === 100 ? ' ok' : sum > 100 ? ' over' : '');
      textEl.className = 'sum-text' + (sum === 100 ? ' ok' : sum > 100 ? ' over' : '');
      const remaining = 100 - sum;
      textEl.innerHTML = `Allocated ${sum} / 100 — ${
        sum === 100 ? '<strong>ready to save</strong>'
        : sum > 100 ? `<strong>over by ${sum - 100}</strong>`
        : `remaining <strong>${remaining}</strong>`
      }`;
      btn.disabled = sum !== 100;
    }

    inputs.forEach(i => i.addEventListener('input', recompute));
    recompute();

    btn.addEventListener('click', async () => {
      const allocations = {};
      inputs.forEach(i => {
        const v = Math.max(0, Math.floor(Number(i.value) || 0));
        if (v > 0) allocations[i.dataset.target] = v;
      });
      btn.disabled = true;
      resEl.textContent = 'Saving…';
      resEl.className = 'result';
      try {
        const r = await fetch(APP_CONFIG.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'submit', token, network: networkId, allocations }),
          redirect: 'follow'
        });
        const data = await r.json();
        if (data.error) throw new Error(data.error);
        resEl.textContent = `Saved (${data.done}/${data.total} total).`;
        resEl.className = 'result ok';
        const section = document.getElementById('section-' + networkId);
        if (section && !section.querySelector('.badge')) {
          section.querySelector('h2').insertAdjacentHTML('beforeend', ' <span class="badge">saved</span>');
        }
      } catch (e) {
        resEl.textContent = e.message;
        resEl.className = 'result err';
      } finally {
        recompute();
      }
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
