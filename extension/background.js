/* BOTFAKE — overlay + gửi API trong service worker (không bị bóp khi đổi tab) */

const PANCAKE_URL = [
  'https://pages.fm/*',
  'https://pancake.vn/*',
  'https://pancake.ph/*',
  'https://pancake.id/*',
  'https://pancake.in/*',
  'https://pancake.biz/*',
  'https://socialos.vip/*',
];

const CONCURRENCY = 24;
/** @type {Record<number, object>} */
const jobs = {};
/** @type {Record<number, { stop: boolean, running: boolean }>} */
const bgCtl = {};

async function pancakeNumber(tabId) {
  try {
    const tabs = await chrome.tabs.query({ url: PANCAKE_URL });
    tabs.sort((a, b) => (a.index - b.index) || (a.id - b.id));
    const i = tabs.findIndex((t) => t.id === tabId);
    return i >= 0 ? i + 1 : 0;
  } catch (e) {
    return 0;
  }
}

function listJobs() {
  return Object.keys(jobs).map((k) => jobs[Number(k)]).filter(Boolean);
}

async function upsert(tabId, data) {
  const n = await pancakeNumber(tabId);
  const label = n ? ('Pancake #' + n) : ('Tab ' + tabId);
  const prev = jobs[tabId] || {};
  jobs[tabId] = Object.assign({}, prev, data, { tabId, n, label, at: Date.now() });
  if (data.phase === 'idle' && !data.sending && !data.scanning) delete jobs[tabId];
  await broadcast();
}

async function broadcast() {
  const list = listJobs();
  const msg = { type: 'BOTFAKE_OVERLAY', jobs: list, running: list.length };
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) { return; }
  for (const t of tabs) {
    if (!t.id) continue;
    try { chrome.tabs.sendMessage(t.id, msg, () => void chrome.runtime.lastError); } catch (e) { /* ignore */ }
  }
}

function tell(tabId, msg) {
  if (!tabId) return;
  try { chrome.tabs.sendMessage(tabId, msg, () => void chrome.runtime.lastError); } catch (e) { /* ignore */ }
}

function resolvePhoto(item, photo) {
  if (!photo) return null;
  const pid = item.pageId || String(item.id || '').split('_')[0];
  if (photo.qr && photo.byPage && photo.byPage[pid]) return photo.byPage[pid];
  if (photo.qr) return null;
  return photo;
}

async function postInbox(apiBase, token, item, text, photo) {
  const pageId = item.pageId || String(item.id || '').split('_')[0];
  const url = String(apiBase).replace(/\/$/, '') + '/v1/pages/' + pageId
    + '/conversations/' + encodeURIComponent(item.id)
    + '/messages?access_token=' + encodeURIComponent(token);
  const items = (photo && Array.isArray(photo.items) && photo.items.length) ? photo.items : (photo ? [photo] : []);
  const fbIds = (photo && Array.isArray(photo.fbIds) && photo.fbIds.length)
    ? photo.fbIds
    : items.map((x) => x.fbId || (photo && photo.fbId) || '');

  const doFetch = async (body, isJson) => {
    const res = await fetch(url, isJson
      ? { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' }, body: body });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { res, data };
  };

  if (items.length > 1) {
    const jsonBody = {
      action: 'reply_inbox',
      message: text == null ? '' : text,
      content_ids: items.map((x) => x.id || ''),
      attachment_ids: fbIds,
      content_urls: items.map((x) => x.url || ''),
      dimensions: items.map((x) => ({ width: Number(x.w) || 0, height: Number(x.h) || 0 })),
      send_by_platform: 'web',
    };
    let { res, data } = await doFetch(jsonBody, true);
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 800));
      const r2 = await doFetch(jsonBody, true);
      res = r2.res; data = r2.data;
    }
    return { res, data };
  }

  const fd = new FormData();
  fd.append('action', 'reply_inbox');
  fd.append('message', text == null ? '' : text);
  const p0 = items[0] || photo;
  const fbId0 = (p0 && p0.fbId) || (photo && photo.fbId) || fbIds[0] || '';
  if (p0 && fbId0) {
    if (p0.id) fd.append('content_id', p0.id);
    fd.append('attachment_id', fbId0);
    fd.append('content_url', p0.url || '');
    if (p0.w) fd.append('width', String(p0.w));
    if (p0.h) fd.append('height', String(p0.h));
  }
  fd.append('send_by_platform', 'web');
  let { res, data } = await doFetch(fd, false);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 800));
    const r2 = await doFetch(fd, false);
    res = r2.res; data = r2.data;
  }
  return { res, data };
}

async function runBgSend(tabId, job) {
  const targets = (job && job.targets) || [];
  const total = targets.length;
  const token = job.token;
  const apiBase = job.apiBase;
  let ok = 0, fail = 0, done = 0, next = 0;
  bgCtl[tabId] = { stop: false, running: true };

  const bump = async () => {
    const pct = total ? Math.round((done / total) * 100) : 0;
    await upsert(tabId, {
      type: 'BOTFAKE_JOB', sending: true, scanning: false, phase: 'send',
      pct, ok, total, done,
    });
    tell(tabId, { type: 'BOTFAKE_BG_PROGRESS', pct, ok, fail, total, done });
  };

  if (!token || !apiBase || !total) {
    tell(tabId, { type: 'BOTFAKE_BG_DONE', ok: false, error: 'Thiếu token/API/danh sách', okN: 0, fail: total, total });
    bgCtl[tabId].running = false;
    await upsert(tabId, { phase: 'idle', sending: false, scanning: false });
    return;
  }

  await bump();
  tell(tabId, { type: 'BOTFAKE_BG_LOG', line: '🚀 Gửi NỀN ' + total + ' chat (API, ' + CONCURRENCY + ' luồng) — đổi tab không bị bóp.' });

  const worker = async () => {
    while (true) {
      if (bgCtl[tabId] && bgCtl[tabId].stop) return;
      const i = next++;
      if (i >= total) return;
      const item = targets[i];
      const text = item.text != null ? item.text : (job.text || '');
      const photo = resolvePhoto(item, job.photo);
      try {
        const { res, data } = await postInbox(apiBase, token, item, text, photo);
        const success = !!(res && res.ok && data && data.success);
        const errMsg = (data && (data.message || data.error)) || ('HTTP ' + (res && res.status));
        const certainFail = !success && res && ((res.status >= 400 && res.status < 500) || (res.ok && data && data.success === false));
        if (success) ok++;
        else if (certainFail) {
          tell(tabId, {
            type: 'BOTFAKE_BG_FALLBACK',
            item: item,
            text: text,
            error: String(errMsg || ''),
          });
          tell(tabId, { type: 'BOTFAKE_BG_LOG', line: '⚠ ' + (item.name || item.id) + ' — API từ chối (' + String(errMsg).slice(0, 90) + ') — bù Socket/Ext trên tab Pancake' });
        } else {
          fail++;
          tell(tabId, { type: 'BOTFAKE_BG_LOG', line: '❌ ' + (item.name || item.id) + ' — ' + String(errMsg).slice(0, 120) });
        }
      } catch (e) {
        fail++;
        tell(tabId, { type: 'BOTFAKE_BG_LOG', line: '❌ ' + (item.name || item.id) + ' — ' + ((e && e.message) || e) });
      }
      done++;
      if (done === total || done % 3 === 0) await bump();
    }
  };

  const n = Math.max(1, Math.min(CONCURRENCY, total));
  await Promise.all(Array.from({ length: n }, () => worker()));
  await bump();
  const stopped = !!(bgCtl[tabId] && bgCtl[tabId].stop);
  tell(tabId, {
    type: 'BOTFAKE_BG_DONE',
    ok: true,
    stopped,
    okN: ok,
    fail,
    total,
    done,
  });
  bgCtl[tabId].running = false;
  await upsert(tabId, { phase: 'idle', sending: false, scanning: false });
}

function formFromObj(obj) {
  const fd = new FormData();
  if (!obj || typeof obj !== 'object') return fd;
  Object.keys(obj).forEach((k) => {
    const val = obj[k];
    if (val !== null && typeof val === 'object' && !(val instanceof File)) {
      Object.keys(val).forEach((sub) => { fd.append(k + '[' + sub + ']', String(val[sub])); });
    } else if (val !== undefined) {
      fd.append(k, String(val));
    }
  });
  return fd;
}

async function swFetchJson(msg) {
  const url = msg.url;
  const max = msg.tries || 3;
  const isPost = String(msg.method || 'GET').toUpperCase() === 'POST';
  const timeoutMs = msg.timeoutMs || 15000;
  let lastErr = '';
  for (let t = 1; t <= max; t++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: isPost ? 'POST' : 'GET',
        body: (isPost && msg.bodyObj) ? formFromObj(msg.bodyObj) : undefined,
        credentials: 'include',
        cache: 'no-store',
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (r.status === 429 || r.status >= 500) {
        lastErr = 'HTTP ' + r.status;
        if (t < max) { await new Promise((x) => setTimeout(x, 400 * t)); continue; }
        return { ok: false, error: lastErr };
      }
      if (!r.ok) {
        const body = (await r.text().catch(() => '')).slice(0, 140);
        return { ok: false, error: 'HTTP ' + r.status + (body ? ' · ' + body : '') };
      }
      const txt = await r.text();
      if (!txt || !txt.trim()) return { ok: true, data: { conversations: [] } };
      try { return { ok: true, data: JSON.parse(txt) }; } catch (e) {
        try { return { ok: true, data: JSON.parse(atob(txt)) }; } catch (e2) {
          return { ok: false, error: 'Phản hồi không phải JSON' };
        }
      }
    } catch (e) {
      clearTimeout(timer);
      lastErr = (e && e.name === 'AbortError') ? 'timeout' : ('Lỗi mạng: ' + (e && e.message || e));
      if (t < max) { await new Promise((x) => setTimeout(x, 400 * t)); continue; }
      return { ok: false, error: lastErr };
    }
  }
  return { ok: false, error: lastErr || 'Không tải được' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  if (!msg || !msg.type) return;

  if (msg.type === 'BOTFAKE_BG_FETCH') {
    swFetchJson(msg).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === 'BOTFAKE_JOB') {
    if (!tabId) { sendResponse && sendResponse({ ok: false }); return; }
    upsert(tabId, msg).then(() => sendResponse && sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'BOTFAKE_BG_SEND') {
    if (!tabId) { sendResponse({ ok: false, error: 'no tab' }); return; }
    if (bgCtl[tabId] && bgCtl[tabId].running) {
      sendResponse({ ok: false, error: 'Đang gửi nền tab này' });
      return;
    }
    runBgSend(tabId, msg.job || {}).catch((e) => {
      tell(tabId, { type: 'BOTFAKE_BG_DONE', ok: false, error: String(e && e.message || e), okN: 0, fail: 0, total: 0 });
    });
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'BOTFAKE_BG_STOP') {
    if (tabId && bgCtl[tabId]) bgCtl[tabId].stop = true;
    sendResponse({ ok: true });
    return;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (bgCtl[tabId]) bgCtl[tabId].stop = true;
  if (jobs[tabId]) { delete jobs[tabId]; broadcast(); }
});

chrome.tabs.onMoved.addListener(() => broadcast());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete' || info.url) broadcast();
});
