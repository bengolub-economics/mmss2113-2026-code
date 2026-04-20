/**
 * MMSS 2113 Network Survey — Apps Script backend
 *
 * Sheets used (created by setup()):
 *   roster       — student_id | label | full_name | email | token
 *                  (label is the short display name shown to students; full_name
 *                   is the formal name kept for records. Only label is shown
 *                   in form UI and in the published CSV.)
 *   networks     — id | title | prompt | type | max_nominations
 *                  (type is 'allocation' [sum-to-100, default] or
 *                   'nomination' [pick up to max_nominations classmates];
 *                   for allocation rows leave max_nominations blank.)
 *   submissions  — token | network | timestamp | allocations_json
 *   config       — key | value   (published, release_mode)
 *   anon         — student_id | anon_id   (hidden; the only decoder ring
 *                  linking real students to the anonymous integer IDs
 *                  used in the published CSVs)
 *
 * Script Properties (set by hand):
 *   ADMIN_TOKEN       — any secret string (used to access admin dashboard)
 *   ADMIN_EMAIL       — where to email when the survey completes
 *   FORM_URL          — the GitHub Pages URL of form.html, e.g.
 *                        https://bengolub-economics.github.io/<repo>/form.html
 *   GITHUB_OWNER      — e.g. bengolub-economics
 *   GITHUB_REPO       — e.g. mmss2113-2026-code
 *   GITHUB_BRANCH     — usually "main"
 *   GITHUB_TOKEN      — fine-grained PAT with Contents: read/write on the repo
 */

const ROSTER_SHEET = 'roster';
const NETWORKS_SHEET = 'networks';
const SUBMISSIONS_SHEET = 'submissions';
const CONFIG_SHEET = 'config';
const ANON_SHEET = 'anon'; // student_id -> random integer; never published

/* ============================================================
 * HTTP entry points
 * ============================================================ */

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'config') return json(getStudentConfig(e.parameter.token));
    if (action === 'admin') return json(getAdminStatus(e.parameter.admin_token));
    return json({ error: 'Unknown action' });
  } catch (err) {
    return json({ error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;
    if (action === 'submit')  return json(handleSubmit(body));
    if (action === 'publish') return json(handlePublish(body));
    return json({ error: 'Unknown action' });
  } catch (err) {
    return json({ error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
 * Setup — run once from the editor
 * ============================================================ */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss.getSheetByName(ROSTER_SHEET)) {
    const s = ss.insertSheet(ROSTER_SHEET);
    s.appendRow(['student_id', 'label', 'full_name', 'email', 'token']);
    s.appendRow(['s01', 'Alice J.', 'Johnson, Alice', 'alice@example.edu', generateTokenString()]);
    s.appendRow(['s02', 'Bob S.',   'Smith, Bob',     'bob@example.edu',   generateTokenString()]);
    s.appendRow(['s03', 'Carol Z.', 'Zhang, Carol',   'carol@example.edu', generateTokenString()]);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(NETWORKS_SHEET)) {
    const s = ss.insertSheet(NETWORKS_SHEET);
    s.appendRow(['id', 'title', 'prompt', 'type', 'max_nominations']);
    s.appendRow(['advice', 'Advice',
      'Divide 100 points among your classmates to indicate who you would go to for advice on coursework. Give more points to those you would turn to more.',
      'allocation', '']);
    s.appendRow(['friendship', 'Friendship',
      'Divide 100 points among your classmates based on how close a friend each person is to you.',
      'allocation', '']);
    s.appendRow(['status', 'Status',
      'Divide 100 points among your classmates based on how much status each person has in the class.',
      'allocation', '']);
    s.appendRow(['info_hubs', 'Information hubs',
      'List up to 5 people in the class that are information hubs when it comes to professional/career information (whether you know that person well or not).',
      'nomination', 5]);
    s.appendRow(['party_broadcasters', 'Party broadcasters',
      'List up to 5 people in the class that would be great candidates to get the word out about a party (whether you know that person well or not).',
      'nomination', 5]);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SUBMISSIONS_SHEET)) {
    const s = ss.insertSheet(SUBMISSIONS_SHEET);
    s.appendRow(['token', 'network', 'timestamp', 'allocations_json']);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(CONFIG_SHEET)) {
    const s = ss.insertSheet(CONFIG_SHEET);
    s.appendRow(['key', 'value']);
    s.appendRow(['published', 'false']);
    s.appendRow(['release_mode', 'auto']); // 'auto' or 'manual'
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(ANON_SHEET)) {
    const s = ss.insertSheet(ANON_SHEET);
    s.appendRow(['student_id', 'anon_id']);
    s.setFrozenRows(1);
    s.hideSheet(); // kept private; this is the decoder ring
  }

  // Convenience: ensure any roster row without a token gets one.
  generateMissingTokens();
}

function generateMissingTokens() {
  // Roster columns: A student_id | B label | C full_name | D email | E token
  const sheet = getSheet(ROSTER_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && !data[i][4]) {
      sheet.getRange(i + 1, 5).setValue(generateTokenString());
    }
  }
}

function generateTokenString() {
  // 12-char URL-safe token
  const bytes = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return bytes;
}

/**
 * For already-deployed Sheets that were created before nomination questions
 * existed. Idempotent: extends the `networks` tab with `type` and
 * `max_nominations` columns, backfills existing rows to type='allocation',
 * and appends the two hardcoded nomination questions if not already present.
 * Run once from the editor after updating Code.gs.
 */
function addNominationQuestions() {
  const sheet = getSheet(NETWORKS_SHEET);
  const data = sheet.getDataRange().getValues();

  // 1. Ensure header cells for columns D (type) and E (max_nominations).
  if (!data[0] || data[0][3] !== 'type') sheet.getRange(1, 4).setValue('type');
  if (!data[0] || data[0][4] !== 'max_nominations') sheet.getRange(1, 5).setValue('max_nominations');

  // 2. Backfill existing rows with blank type -> 'allocation'.
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && !data[i][3]) {
      sheet.getRange(i + 1, 4).setValue('allocation');
    }
  }

  // 3. Append the two nomination rows if missing.
  const existingIds = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) existingIds.add(String(data[i][0]));
  }
  const rows = [
    ['info_hubs', 'Information hubs',
      'List up to 5 people in the class that are information hubs when it comes to professional/career information (whether you know that person well or not).',
      'nomination', 5],
    ['party_broadcasters', 'Party broadcasters',
      'List up to 5 people in the class that would be great candidates to get the word out about a party (whether you know that person well or not).',
      'nomination', 5]
  ];
  let added = 0;
  for (const r of rows) {
    if (!existingIds.has(r[0])) {
      sheet.appendRow(r);
      added++;
    }
  }
  return 'Added ' + added + ' nomination question(s); networks tab now has type/max_nominations columns.';
}

/* ============================================================
 * Student config + submission
 * ============================================================ */

function getStudentConfig(token) {
  if (!token) throw new Error('Missing token');
  const roster = readRoster();
  const me = roster.find(r => r.token === token);
  if (!me) throw new Error('Invalid token');
  const classmates = roster
    .filter(r => r.token !== token)
    .map(r => ({ student_id: r.student_id, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    name: me.name,
    student_id: me.student_id,
    classmates: classmates,
    networks: readNetworks(),
    submissions: readMySubmissions(token),
    published: getConfig('published') === 'true'
  };
}

function handleSubmit(body) {
  const token = body.token;
  const network = body.network;
  const allocations = body.allocations || {};

  if (!token) throw new Error('Missing token');
  if (!network) throw new Error('Missing network');
  if (getConfig('published') === 'true') throw new Error('Survey is closed');

  const roster = readRoster();
  const me = roster.find(r => r.token === token);
  if (!me) throw new Error('Invalid token');

  const networks = readNetworks();
  const net = networks.find(n => n.id === network);
  if (!net) throw new Error('Invalid network');

  const classmateIds = new Set(roster.filter(r => r.token !== token).map(r => r.student_id));
  if (net.type === 'nomination') {
    validateNomination(allocations, classmateIds, net.max_nominations);
  } else {
    validateAllocation(allocations, classmateIds);
  }

  upsertSubmission(token, network, allocations);

  const status = getCompletionStatus();
  if (status.complete && getConfig('release_mode') === 'auto' && getConfig('published') !== 'true') {
    try {
      publishCSVs();
      setConfig('published', 'true');
      notifyComplete();
    } catch (err) {
      // Don't block the student's submission if publish fails; surface it in logs.
      console.error('Auto-publish failed: ' + err);
    }
  }

  return Object.assign({ ok: true }, status);
}

function validateAllocation(allocations, classmateIds) {
  let sum = 0;
  for (const target of Object.keys(allocations)) {
    const w = allocations[target];
    if (!classmateIds.has(target)) throw new Error('Invalid target: ' + target);
    if (typeof w !== 'number' || !Number.isFinite(w) || Math.floor(w) !== w || w < 0 || w > 100) {
      throw new Error('Weights must be integers between 0 and 100');
    }
    sum += w;
  }
  if (sum !== 100) throw new Error('Allocations must sum to 100 (got ' + sum + ')');
}

function validateNomination(allocations, classmateIds, maxNoms) {
  const keys = Object.keys(allocations);
  if (maxNoms > 0 && keys.length > maxNoms) {
    throw new Error('Too many nominations (max ' + maxNoms + ', got ' + keys.length + ')');
  }
  for (const target of keys) {
    if (!classmateIds.has(target)) throw new Error('Invalid nominee: ' + target);
    if (allocations[target] !== 1) {
      throw new Error('Nomination weights must be exactly 1');
    }
  }
}

function upsertSubmission(token, network, allocations) {
  const sheet = getSheet(SUBMISSIONS_SHEET);
  const data = sheet.getDataRange().getValues();
  const ts = new Date().toISOString();
  const payload = JSON.stringify(allocations);
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token && data[i][1] === network) {
      sheet.getRange(i + 1, 3).setValue(ts);
      sheet.getRange(i + 1, 4).setValue(payload);
      return;
    }
  }
  sheet.appendRow([token, network, ts, payload]);
}

function readMySubmissions(token) {
  const data = getSheet(SUBMISSIONS_SHEET).getDataRange().getValues();
  const out = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      try { out[data[i][1]] = JSON.parse(data[i][3] || '{}'); } catch (_) {}
    }
  }
  return out;
}

/* ============================================================
 * Admin
 * ============================================================ */

function getAdminStatus(adminToken) {
  requireAdmin(adminToken);
  const roster = readRoster();
  const networks = readNetworks();
  const submissions = readAllSubmissions();
  const rosterByToken = Object.fromEntries(roster.map(r => [r.token, r]));
  const byNetwork = {};
  for (const n of networks) {
    const doneTokens = new Set(
      submissions.filter(s => s.network === n.id && rosterByToken[s.token]).map(s => s.token)
    );
    byNetwork[n.id] = {
      title: n.title,
      done:    roster.filter(r =>  doneTokens.has(r.token)).map(r => r.name),
      missing: roster.filter(r => !doneTokens.has(r.token)).map(r => r.name)
    };
  }
  const status = getCompletionStatus();
  return Object.assign({
    published: getConfig('published') === 'true',
    release_mode: getConfig('release_mode') || 'auto',
    total_students: roster.length,
    networks: networks.map(n => n.id),
    byNetwork: byNetwork
  }, status);
}

function handlePublish(body) {
  requireAdmin(body && body.admin_token);
  publishCSVs();
  setConfig('published', 'true');
  notifyComplete();
  return { ok: true };
}

function requireAdmin(adminToken) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  if (!expected) throw new Error('ADMIN_TOKEN not configured');
  if (adminToken !== expected) throw new Error('Unauthorized');
}

function getCompletionStatus() {
  const roster = readRoster();
  const networks = readNetworks();
  const submissions = readAllSubmissions();
  const rosterTokens = new Set(roster.map(r => r.token));
  const total = roster.length * networks.length;
  let done = 0;
  for (const n of networks) {
    const doneTokens = new Set(
      submissions.filter(s => s.network === n.id && rosterTokens.has(s.token)).map(s => s.token)
    );
    done += doneTokens.size;
  }
  return { total: total, done: done, complete: total > 0 && done === total };
}

/* ============================================================
 * CSV generation + GitHub publish
 * ============================================================ */

/**
 * Build a stable, random student_id → anonymous integer mapping in the
 * `anon` tab. Integers are drawn from {1, …, N} where N = roster size,
 * assigned via a Fisher-Yates shuffle. Existing mappings are preserved
 * (so republishing never changes node labels). If the roster grows after
 * the first publish, new students get the smallest unused id.
 *
 * The `anon` tab stays inside the private Sheet and is hidden by default.
 * It's the only place that links real identities to published node IDs.
 */
function ensureAnonIds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ANON_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ANON_SHEET);
    sheet.appendRow(['student_id', 'anon_id']);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }

  const roster = readRoster();
  const data = sheet.getDataRange().getValues();
  const mapping = {};
  const used = new Set();
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const sid = String(data[i][0]);
    const aid = Number(data[i][1]);
    if (Number.isInteger(aid)) {
      mapping[sid] = aid;
      used.add(aid);
    }
  }

  const unassigned = roster.filter(r => !(r.student_id in mapping));
  if (unassigned.length === 0) return mapping;

  const N = roster.length;
  const pool = [];
  for (let i = 1; i <= N; i++) if (!used.has(i)) pool.push(i);
  // If roster shrunk then grew, pool may be short; extend past N.
  let fill = N + 1;
  while (pool.length < unassigned.length) {
    if (!used.has(fill)) pool.push(fill);
    fill++;
  }
  // Fisher-Yates shuffle.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  // Also shuffle the unassigned students so assignment order itself
  // doesn't leak information (e.g. sheet row order = last name order).
  const shuffled = unassigned.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
  }
  for (const r of shuffled) {
    const aid = pool.shift();
    sheet.appendRow([r.student_id, aid]);
    mapping[r.student_id] = aid;
  }
  return mapping;
}

function publishCSVs() {
  const roster = readRoster();
  const networks = readNetworks();
  const submissions = readAllSubmissions();
  const tokenToId = Object.fromEntries(roster.map(r => [r.token, r.student_id]));
  const anon = ensureAnonIds();

  const header = ['network', 'source', 'target', 'weight'];
  const allRows = [];
  for (const n of networks) {
    const rows = [];
    const mySubs = submissions.filter(s => s.network === n.id);
    for (const s of mySubs) {
      const srcId = tokenToId[s.token];
      if (!srcId) continue;
      const src = anon[srcId];
      if (src == null) continue;
      let alloc;
      try { alloc = JSON.parse(s.allocations_json || '{}'); } catch (_) { continue; }
      for (const target of Object.keys(alloc)) {
        const w = alloc[target];
        const tgt = anon[target];
        if (tgt == null) continue;
        const row = [n.id, src, tgt, w];
        rows.push(row);
        allRows.push(row);
      }
    }
    sortAnonRows(rows);
    githubPut('docs/data/' + n.id + '.csv',
              rowsToCsv([header].concat(rows)),
              'Publish ' + n.id + ' network');
  }
  sortAnonRows(allRows);
  githubPut('docs/data/all_networks.csv',
            rowsToCsv([header].concat(allRows)),
            'Publish all networks');
}

function sortAnonRows(rows) {
  // Deterministic order — prevents leaking submission-time ordering.
  rows.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1; // network id
    if (a[1] !== b[1]) return a[1] - b[1];          // source
    return a[2] - b[2];                              // target
  });
}

function rowsToCsv(rows) {
  return rows.map(r => r.map(csvField).join(',')).join('\n') + '\n';
}
function csvField(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function githubPut(path, content, message) {
  const props = PropertiesService.getScriptProperties();
  const token  = props.getProperty('GITHUB_TOKEN');
  const owner  = props.getProperty('GITHUB_OWNER');
  const repo   = props.getProperty('GITHUB_REPO');
  const branch = props.getProperty('GITHUB_BRANCH') || 'main';
  if (!token || !owner || !repo) throw new Error('GitHub credentials not configured');

  const apiUrl = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path;
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  // Look up existing SHA so we can update rather than 409.
  let sha = null;
  const getResp = UrlFetchApp.fetch(apiUrl + '?ref=' + encodeURIComponent(branch), {
    method: 'get', headers: headers, muteHttpExceptions: true
  });
  if (getResp.getResponseCode() === 200) {
    try { sha = JSON.parse(getResp.getContentText()).sha; } catch (_) {}
  }

  const body = {
    message: message,
    content: Utilities.base64Encode(content),
    branch: branch
  };
  if (sha) body.sha = sha;

  const putResp = UrlFetchApp.fetch(apiUrl, {
    method: 'put',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  if (putResp.getResponseCode() >= 300) {
    throw new Error('GitHub push failed (' + putResp.getResponseCode() + '): ' + putResp.getContentText());
  }
}

/* ============================================================
 * Email helpers
 * ============================================================ */

/**
 * Email every student their unique form link.
 * Run manually from the editor after you've filled in the roster
 * and set FORM_URL in Script Properties.
 */
function sendLinks() {
  const props = PropertiesService.getScriptProperties();
  const formUrl = props.getProperty('FORM_URL');
  if (!formUrl) throw new Error('Set FORM_URL in Script Properties');

  const roster = readRoster();
  let sent = 0;
  for (const r of roster) {
    if (!r.email || !r.token) continue;
    const link = formUrl + (formUrl.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(r.token);
    const subject = 'MMSS 2113 — your personal network-survey link';
    const body = [
      'Hi ' + r.name + ',',
      '',
      'Please complete the network survey using your personal link:',
      link,
      '',
      'The link is unique to you. Please do not share it or submit for anyone else.',
      '',
      'Thanks!'
    ].join('\n');
    MailApp.sendEmail({ to: r.email, subject: subject, body: body });
    sent++;
  }
  return sent;
}

function notifyComplete() {
  const props = PropertiesService.getScriptProperties();
  const adminEmail = props.getProperty('ADMIN_EMAIL');
  if (!adminEmail) return;
  const owner = (props.getProperty('GITHUB_OWNER') || '').toLowerCase();
  const repo = props.getProperty('GITHUB_REPO') || '';
  const pagesBase = 'https://' + owner + '.github.io/' + repo + '/';
  MailApp.sendEmail({
    to: adminEmail,
    subject: 'Network survey complete — CSVs published',
    body: 'All students have submitted. CSVs are published to:\n' +
          pagesBase + 'data/all_networks.csv\n' +
          'Full data folder: ' + pagesBase + 'data/'
  });
}

/* ============================================================
 * Sheet helpers
 * ============================================================ */

function getSheet(name) {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!s) throw new Error('Sheet not found: ' + name + ' (run setup() first)');
  return s;
}

function readRoster() {
  // Roster columns: A student_id | B label | C full_name | D email | E token
  // We expose `name` (= label) for UI and CSV, and keep `full_name` available
  // in case downstream code wants the formal version.
  const data = getSheet(ROSTER_SHEET).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    out.push({
      student_id: String(data[i][0]),
      name:       String(data[i][1]),
      full_name:  String(data[i][2]),
      email:      String(data[i][3]),
      token:      String(data[i][4])
    });
  }
  return out;
}

function readNetworks() {
  // Columns: A id | B title | C prompt | D type | E max_nominations
  const data = getSheet(NETWORKS_SHEET).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const rawType = String(data[i][3] || '').trim().toLowerCase();
    const type = rawType === 'nomination' ? 'nomination' : 'allocation';
    const maxNoms = Number(data[i][4]) || (type === 'nomination' ? 5 : 0);
    out.push({
      id: String(data[i][0]),
      title: String(data[i][1]),
      prompt: String(data[i][2]),
      type: type,
      max_nominations: maxNoms
    });
  }
  return out;
}

function readAllSubmissions() {
  const data = getSheet(SUBMISSIONS_SHEET).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    out.push({
      token: String(data[i][0]),
      network: String(data[i][1]),
      timestamp: String(data[i][2]),
      allocations_json: String(data[i][3])
    });
  }
  return out;
}

function getConfig(key) {
  const data = getSheet(CONFIG_SHEET).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return String(data[i][1]);
  }
  return null;
}

function setConfig(key, value) {
  const sheet = getSheet(CONFIG_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}
