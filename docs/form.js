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
      app.innerHTML = `<h1>Error</h1><p class="result err">${esc(e.message)}</p>`;
    }
  }

  function render(data) {
    if (data.published) {
      app.innerHTML = `
        <h1>Hi ${esc(data.name)}</h1>
        <div class="closed">
          <p>The survey is now closed. Thank you for participating.</p>
        </div>`;
      return;
    }

    const datalist = `<datalist id="classmates-dl">${
      data.classmates.map(c => `<option value="${esc(c.name)}"></option>`).join('')
    }</datalist>`;

    const sections = data.networks.map(n => {
      const prior = data.submissions[n.id];
      return n.type === 'nomination'
        ? nominationSection(n, data.classmates, prior)
        : allocationSection(n, data.classmates, prior);
    }).join('');

    app.innerHTML = `
      <header class="survey">
        <h1>Network Survey</h1>
        <p class="subtitle">Hi ${esc(data.name)} — please complete each section below. Your answers save per section.</p>
      </header>
      ${sections}
      ${datalist}`;

    for (const n of data.networks) {
      if (n.type === 'nomination') wireNomination(n.id, data.classmates);
      else wireAllocation(n.id);
    }
  }

  /* ---------------- Allocation (sum-to-100) ---------------- */

  function allocationSection(network, classmates, existing) {
    const rows = classmates.map(c => {
      const val = (existing && existing[c.student_id] != null) ? existing[c.student_id] : 0;
      return `
        <div class="row">
          <label for="${network.id}-${c.student_id}">${esc(c.name)}</label>
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
      <section class="network" id="section-${network.id}" data-type="allocation">
        <h2>${esc(network.title)}${completed ? ' <span class="badge">saved</span>' : ''}</h2>
        <p class="prompt">${esc(network.prompt)}</p>
        <div class="summary">
          <div class="sum-bar"><div class="sum-fill" id="bar-${network.id}"></div></div>
          <div class="sum-text" id="text-${network.id}">Allocated 0 / 100 — remaining <strong>100</strong></div>
        </div>
        <div class="allocations">${rows}</div>
        <div class="actions">
          <button type="button" data-network="${network.id}" class="submit-btn" disabled>Save ${esc(network.title)}</button>
          <span class="result" id="result-${network.id}"></span>
        </div>
      </section>`;
  }

  function wireAllocation(networkId) {
    const inputs = document.querySelectorAll(`input[data-network="${networkId}"]`);
    const barEl = document.getElementById('bar-' + networkId);
    const textEl = document.getElementById('text-' + networkId);
    const btn = document.querySelector(`#section-${networkId} .submit-btn`);
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
      await submitSection(networkId, allocations, btn, resEl);
      recompute();
    });
  }

  /* ---------------- Nomination (pick up to N) ---------------- */

  function nominationSection(network, classmates, existing) {
    const max = network.max_nominations || 5;
    const existingIds = existing ? Object.keys(existing) : [];
    const slots = [];
    for (let i = 0; i < max; i++) {
      const preId = existingIds[i] || '';
      const classmate = preId ? classmates.find(c => c.student_id === preId) : null;
      const preName = classmate ? classmate.name : '';
      slots.push(`
        <div class="nom-slot">
          <span class="nom-num">${i + 1}.</span>
          <input type="text" list="classmates-dl" class="nom-input"
            data-network="${network.id}"
            data-student-id="${esc(preId)}"
            value="${esc(preName)}"
            placeholder="Start typing a classmate's name…"
            autocomplete="off">
          <button type="button" class="nom-clear" aria-label="Clear">×</button>
        </div>`);
    }
    const completed = existing != null; // even an empty save counts
    return `
      <section class="network" id="section-${network.id}" data-type="nomination">
        <h2>${esc(network.title)}${completed ? ' <span class="badge">saved</span>' : ''}</h2>
        <p class="prompt">${esc(network.prompt)}</p>
        <div class="noms">${slots.join('')}</div>
        <div class="actions">
          <span class="nom-count" id="count-${network.id}">0 of ${max} selected</span>
          <button type="button" data-network="${network.id}" class="submit-btn">Save ${esc(network.title)}</button>
          <span class="result" id="result-${network.id}"></span>
        </div>
      </section>`;
  }

  function wireNomination(networkId, classmates) {
    const nameToId = Object.fromEntries(classmates.map(c => [c.name, c.student_id]));
    const section = document.getElementById('section-' + networkId);
    const inputs = section.querySelectorAll('.nom-input');
    const countEl = document.getElementById('count-' + networkId);
    const btn = section.querySelector('.submit-btn');
    const resEl = document.getElementById('result-' + networkId);

    function recompute() {
      const picked = new Set();
      let valid = 0, invalid = 0;
      inputs.forEach(i => {
        const v = i.value.trim();
        i.classList.remove('good', 'bad');
        if (v === '') {
          i.dataset.studentId = '';
          return;
        }
        const sid = nameToId[v];
        if (!sid || picked.has(sid)) {
          i.classList.add('bad');
          i.dataset.studentId = '';
          invalid++;
        } else {
          i.classList.add('good');
          i.dataset.studentId = sid;
          picked.add(sid);
          valid++;
        }
      });
      const max = inputs.length;
      countEl.textContent = `${valid} of ${max} selected${invalid ? ` — ${invalid} invalid/duplicate` : ''}`;
      countEl.className = 'nom-count' + (invalid ? ' err' : valid > 0 ? ' ok' : '');
      btn.disabled = invalid > 0;
    }

    inputs.forEach(i => {
      i.addEventListener('input', recompute);
      i.addEventListener('change', recompute);
      i.addEventListener('blur', recompute);
    });
    section.querySelectorAll('.nom-clear').forEach((b, idx) => {
      b.addEventListener('click', () => {
        inputs[idx].value = '';
        recompute();
        inputs[idx].focus();
      });
    });
    recompute();

    btn.addEventListener('click', async () => {
      const allocations = {};
      inputs.forEach(i => {
        const sid = i.dataset.studentId;
        if (sid) allocations[sid] = 1;
      });
      await submitSection(networkId, allocations, btn, resEl);
      recompute();
    });
  }

  /* ---------------- Shared submit ---------------- */

  async function submitSection(networkId, allocations, btn, resEl) {
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
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
