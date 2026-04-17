/**
 * MMSS 2113 Network Survey — Apps Script backend
 *
 * Sheets used (created by setup()):
 *   roster       — student_id | name | email | token
 *   networks     — id | title | prompt
 *   submissions  — token | network | timestamp | allocations_json
 *   config       — key | value   (published, release_mode)
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
    s.appendRow(['student_id', 'name', 'email', 'token']);
    s.appendRow(['s01', 'Alice Johnson', 'alice@example.edu', generateTokenString()]);
    s.appendRow(['s02', 'Bob Smith',     'bob@example.edu',   generateTokenString()]);
    s.appendRow(['s03', 'Carol Zhang',   'carol@example.edu', generateTokenString()]);
    s.setFrozenRows(1);
  }
  if (!ss.getSheetByName(NETWORKS_SHEET)) {
    const s = ss.insertSheet(NETWORKS_SHEET);
    s.appendRow(['id', 'title', 'prompt']);
    s.appendRow(['advice', 'Advice',
      'Divide 100 points among your classmates to indicate who you would go to for advice on coursework. Give more points to those you would turn to more.']);
    s.appendRow(['friendship', 'Friendship',
      'Divide 100 points among your classmates based on how close a friend each person is to you.']);
    s.appendRow(['status', 'Status',
      'Divide 100 points among your classmates based on how much status each person has in the class.']);
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

  // Convenience: ensure any roster row without a token gets one.
  generateMissingTokens();
}

function generateMissingTokens() {
  const sheet = getSheet(ROSTER_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && !data[i][3]) {
      sheet.getRange(i + 1, 4).setValue(generateTokenString());
    }
  }
}

function generateTokenString() {
  // 12-char URL-safe token
  const bytes = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return bytes;
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

function publishCSVs() {
  const roster = readRoster();
  const networks = readNetworks();
  const submissions = readAllSubmissions();
  const tokenToId = Object.fromEntries(roster.map(r => [r.token, r.student_id]));
  const idToName = Object.fromEntries(roster.map(r => [r.student_id, r.name]));

  const allRows = [['network', 'source_id', 'source_name', 'target_id', 'target_name', 'weight']];
  for (const n of networks) {
    const rows = [['network', 'source_id', 'source_name', 'target_id', 'target_name', 'weight']];
    const mySubs = submissions.filter(s => s.network === n.id);
    for (const s of mySubs) {
      const srcId = tokenToId[s.token];
      if (!srcId) continue;
      let alloc;
      try { alloc = JSON.parse(s.allocations_json || '{}'); } catch (_) { continue; }
      for (const target of Object.keys(alloc)) {
        const w = alloc[target];
        const row = [n.id, srcId, idToName[srcId] || '', target, idToName[target] || '', w];
        rows.push(row);
        allRows.push(row);
      }
    }
    const csv = rowsToCsv(rows);
    githubPut('docs/data/' + n.id + '.csv', csv, 'Publish ' + n.id + ' network');
  }
  githubPut('docs/data/all_networks.csv', rowsToCsv(allRows), 'Publish all networks');
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
  const data = getSheet(ROSTER_SHEET).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    out.push({
      student_id: String(data[i][0]),
      name: String(data[i][1]),
      email: String(data[i][2]),
      token: String(data[i][3])
    });
  }
  return out;
}

function readNetworks() {
  const data = getSheet(NETWORKS_SHEET).getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    out.push({
      id: String(data[i][0]),
      title: String(data[i][1]),
      prompt: String(data[i][2])
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
