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
const dedicatedBySenderTab = Object.create(null);
const dedicatedByUiTab = Object.create(null);
const DEDICATED_SENDER_BOOT_TIMEOUT_MS = 120000;

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
  // job quá 3 phút không cập nhật = lượt đã chết (tab treo/script lỗi) → không hiện overlay ma
  const now = Date.now();
  return Object.keys(jobs)
    .map((k) => jobs[Number(k)])
    .filter((j) => j && now - (j.at || 0) < 180000);
}

let jobsHydrated = false;
async function hydrateJobs() {
  if (jobsHydrated) return;
  jobsHydrated = true;
  try {
    const s = await chrome.storage.session.get('bfJobs');
    const saved = s && s.bfJobs;
    if (saved) Object.keys(saved).forEach((k) => { if (!jobs[k]) jobs[k] = saved[k]; });
  } catch (e) { /* ignore */ }
}
function persistJobs() {
  try { chrome.storage.session.set({ bfJobs: jobs }); } catch (e) { /* ignore */ }
}

async function upsert(tabId, data) {
  await hydrateJobs();
  const n = await pancakeNumber(tabId);
  const prev = jobs[tabId] || {};
  const pageName = String((data && data.pageName) || prev.pageName || '').trim();
  const label = pageName || (n ? ('Pancake #' + n) : ('Tab ' + tabId));
  jobs[tabId] = Object.assign({}, prev, data, { tabId, n, pageName, label, at: Date.now() });
  if (data.phase === 'idle' && !data.sending && !data.scanning) delete jobs[tabId];
  persistJobs(); // SW ngủ dậy vẫn còn job để phát lại (biến trong RAM mất khi SW tắt)
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
  const dedicated = dedicatedBySenderTab[tabId];
  if (dedicated && dedicated.uiTabId && msg && (msg.type === 'BOTFAKE_WAVE_PROGRESS' || msg.type === 'BOTFAKE_WAVE_DONE')) {
    try { chrome.tabs.sendMessage(dedicated.uiTabId, Object.assign({}, msg, { dedicated: true }), () => void chrome.runtime.lastError); } catch (e) { /* ignore */ }
  }
}

function finishDedicatedSender(item, result, error, closeSender) {
  if (!item || item.done) return;
  item.done = true;
  if (item.bootTimer) clearTimeout(item.bootTimer);
  const message = Object.assign({ type: 'BOTFAKE_DEDICATED_DONE', jobId: item.jobId }, result || {});
  if (error) { message.ok = false; message.error = String(error); }
  tell(item.uiTabId, message);
  if (item.senderTabId && dedicatedBySenderTab[item.senderTabId] === item) delete dedicatedBySenderTab[item.senderTabId];
  if (dedicatedByUiTab[item.uiTabId] === item) delete dedicatedByUiTab[item.uiTabId];
  if (closeSender && item.senderTabId) {
    try { chrome.tabs.remove(item.senderTabId, () => void chrome.runtime.lastError); } catch (e) { /* ignore */ }
  }
}

function failDedicatedSender(senderTabId, error) {
  finishDedicatedSender(dedicatedBySenderTab[senderTabId], null, error || 'Sender tab không sẵn sàng', true);
}

function stopWaveForTab(tabId) {
  const ctl = waveCtl[tabId];
  if (!ctl) return;
  ctl.stop = true;
  ['socket', 'ext'].forEach((name) => {
    while (ctl.waiters[name].length) ctl.waiters[name].shift()(null);
  });
  while (ctl.mainWaiters.length) ctl.mainWaiters.shift()();
  ctl.timers.forEach((timer) => { try { clearTimeout(timer); } catch (e) { /* ignore */ } });
  ctl.timers.clear();
  ctl.socketCool = 0;
}

function resolvePhoto(item, photo) {
  if (!photo) return null;
  const pid = item.pageId || String(item.id || '').split('_')[0];
  if (photo.qr && photo.byPage && photo.byPage[pid]) return photo.byPage[pid];
  if (photo.qr) return null;
  return photo;
}

const DNR_COOKIE_RULE = 91723;

async function setSwCookieRule(cookieHeader, apiBase) {
  if (!cookieHeader || !chrome.declarativeNetRequest) return;
  let domain = 'pancake.vn';
  try { domain = new URL(apiBase).hostname; } catch (e0) { /* keep */ }
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_COOKIE_RULE],
      addRules: [{
        id: DNR_COOKIE_RULE,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'cookie', operation: 'set', value: cookieHeader }],
        },
        condition: {
          requestDomains: [domain],
          resourceTypes: ['xmlhttprequest', 'other'],
        },
      }],
    });
  } catch (e1) { /* DNR không gắn Cookie được thì fetch tự thử header */ }
}

async function clearSwCookieRule() {
  try {
    if (chrome.declarativeNetRequest) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [DNR_COOKIE_RULE], addRules: [] });
    }
  } catch (e0) { /* ignore */ }
}

async function postInbox(apiBase, token, item, text, photo, cookieHeader) {
  const pageId = item.pageId || String(item.id || '').split('_')[0];
  // Giữ access_token=cookie_session như HAR — không thế JWT (jwt query → #551).
  const url = String(apiBase).replace(/\/$/, '') + '/v1/pages/' + pageId
    + '/conversations/' + encodeURIComponent(item.id)
    + '/messages?access_token=' + encodeURIComponent(token || 'cookie_session');
  const items = (photo && Array.isArray(photo.items) && photo.items.length) ? photo.items : (photo ? [photo] : []);
  const fbIds = (photo && Array.isArray(photo.fbIds) && photo.fbIds.length)
    ? photo.fbIds
    : items.map((x) => x.fbId || (photo && photo.fbId) || '');

  const doFetch = async (body, isJson) => {
    const headers = { Accept: 'application/json' };
    if (isJson) headers['Content-Type'] = 'application/json';
    const opts = {
      method: 'POST',
      credentials: 'include',
      headers,
      body: isJson ? JSON.stringify(body) : body,
    };
    let res;
    try {
      if (cookieHeader) opts.headers = Object.assign({}, headers, { Cookie: cookieHeader });
      res = await fetch(url, opts);
    } catch (hdrErr) {
      opts.headers = headers;
      res = await fetch(url, opts);
    }
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

  const auth = await pancakeCookieJar(String(apiBase).replace(/\/$/, '') + '/');
  await setSwCookieRule(auth.cookieHeader, apiBase);
  await bump();
  tell(tabId, { type: 'BOTFAKE_BG_LOG', line: '🚀 Gửi NỀN ' + total + ' chat (API + cookie jar, giữ cookie_session, ' + CONCURRENCY + ' luồng).' });

  const worker = async () => {
    while (true) {
      if (bgCtl[tabId] && bgCtl[tabId].stop) return;
      const i = next++;
      if (i >= total) return;
      const item = targets[i];
      const text = item.text != null ? item.text : (job.text || '');
      const photo = resolvePhoto(item, job.photo);
      try {
        const { res, data } = await postInbox(apiBase, token, item, text, photo, auth.cookieHeader);
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

  try {
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
  } finally {
    bgCtl[tabId].running = false;
    await clearSwCookieRule();
    await upsert(tabId, { phase: 'idle', sending: false, scanning: false });
  }
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

async function pancakeCookieJar(url) {
  const out = { cookieHeader: '', jwt: '' };
  try {
    const u = new URL(url);
    const byName = {};
    const add = (list) => { (list || []).forEach((c) => { if (c && c.name) byName[c.name] = c.value; }); };
    add(await chrome.cookies.getAll({ url: u.origin + '/' }));
    add(await chrome.cookies.getAll({ domain: u.hostname }));
    const parts = u.hostname.split('.');
    if (parts.length >= 2) add(await chrome.cookies.getAll({ domain: parts.slice(-2).join('.') }));
    out.cookieHeader = Object.keys(byName).map((n) => n + '=' + byName[n]).join('; ');
    const jwtC = byName.jwt ? { name: 'jwt', value: byName.jwt } : null;
    if (jwtC && jwtC.value) {
      let v = jwtC.value;
      try { v = decodeURIComponent(v); } catch (e) { /* raw */ }
      v = String(v).replace(/^"|"$/g, '');
      if (v.indexOf('eyJ') === 0 && v.split('.').length === 3) out.jwt = v;
    }
  } catch (e) { /* no cookies perm */ }
  return out;
}

function urlWithJwt(url, jwt) {
  if (!jwt) return url;
  const enc = encodeURIComponent(jwt);
  if (/access_token=cookie_session/.test(url)) {
    return url.replace(/access_token=cookie_session/, 'access_token=' + enc);
  }
  if (!/[?&]access_token=/.test(url)) {
    return url + (url.indexOf('?') > -1 ? '&' : '?') + 'access_token=' + enc;
  }
  return url;
}

async function swFetchJson(msg) {
  let url = msg.url;
  const auth = await pancakeCookieJar(url);
  // SW không gửi cookie phiên như tab pancake.vn → cookie_session = Invalid access_token.
  // Gắn Cookie + thay access_token bằng jwt HttpOnly (chrome.cookies đọc được).
  if (auth.jwt) url = urlWithJwt(url, auth.jwt);
  const max = msg.tries || 3;
  const isPost = String(msg.method || 'GET').toUpperCase() === 'POST';
  const timeoutMs = msg.timeoutMs || 15000;
  let lastErr = '';
  for (let t = 1; t <= max; t++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const headers = { Accept: 'application/json' };
      const opts = {
        method: isPost ? 'POST' : 'GET',
        body: (isPost && msg.bodyObj) ? formFromObj(msg.bodyObj) : undefined,
        credentials: 'include',
        cache: 'no-store',
        signal: ctl.signal,
        headers,
      };
      let r;
      try {
        if (auth.cookieHeader) opts.headers = Object.assign({}, headers, { Cookie: auth.cookieHeader });
        r = await fetch(url, opts);
      } catch (hdrErr) {
        opts.headers = headers;
        r = await fetch(url, opts);
      }
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

/** Wave coordinator: orchestration runs in MV3 service worker; sendOne/Socket still execute
 * in the authenticated Pancake MAIN world through bridge.js. It never performs channel fallback. */
const waveCtl = Object.create(null);
const WAVE_MAIN_WORKERS = 96;
const WAVE_SOCKET_WORKERS = 44;
const WAVE_EXT_WORKERS = 32;
const WAVE_PAGE_TASK_TIMEOUT_MS = 185000;

function sendWaveTaskToPage(tabId, jobId, task) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ disposition: 'fatal', error: 'Task Pancake quá hạn — không tự gửi lại để tránh trùng.' });
    }, WAVE_PAGE_TASK_TIMEOUT_MS);
    try {
      chrome.tabs.sendMessage(tabId, {
        type: 'BOTFAKE_WAVE_TASK', jobId, requestId: task.requestId, task,
      }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        resolve(err ? { disposition: 'fatal', error: err.message || 'Không liên lạc được tab Pancake.' }
          : (response || { disposition: 'fatal', error: 'Tab Pancake không trả kết quả task.' }));
      });
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ disposition: 'fatal', error: String(e && e.message || e) });
    }
  });
}

async function runWaveCoordinator(tabId, job) {
  const targets = Array.isArray(job.targets) ? job.targets : [];
  const jobId = String(job.jobId || '');
  const total = targets.length;
  if (!jobId || !total) throw new Error('Wave job thiếu jobId/danh sách người nhận');
  if (waveCtl[tabId] && waveCtl[tabId].running) throw new Error('Đang có Wave coordinator chạy ở tab này');

  const ctl = {
    jobId, running: true, stop: false, error: '', next: 0, done: 0, requestSeq: 0,
    mainActive: 0, socketActive: 0, extActive: 0, socketCool: 0, pendingDispatch: 0,
    mainPeak: 0, socketPeak: 0, extPeak: 0, socketQueuePeak: 0, extQueuePeak: 0,
    mainQueue: [], socketQueue: [], extQueue: [], apiBacklog: 0,
    waveSize: Math.max(1, Math.min(100000, parseInt(job.waveSize, 10) || 200)),
    waveStart: 0, waveEnd: Math.min(total, Math.max(1, Math.min(100000, parseInt(job.waveSize, 10) || 200))),
    waveDone: 0, waveStartedAt: Date.now(),
    waiters: { socket: [], ext: [] }, mainWaiters: [], timers: new Set(), finished: false,
  };
  waveCtl[tabId] = ctl;
  const wakeMainWaiters = () => {
    while (ctl.mainWaiters.length && (ctl.stop || ctl.next < ctl.waveEnd || ctl.waveEnd >= total)) {
      ctl.mainWaiters.shift()();
    }
  };
  const evaluateWaveGate = () => {
    if (ctl.stop || ctl.waveEnd >= total) { wakeMainWaiters(); return; }
    const waveLength = ctl.waveEnd - ctl.waveStart;
    const fastTarget = Math.max(1, Math.ceil(waveLength * 0.78));
    const softTarget = Math.max(1, Math.ceil(waveLength * 0.62));
    const retryBacklog = ctl.socketQueue.length + ctl.socketCool + ctl.socketActive;
    const extBacklog = ctl.extQueue.length + ctl.extActive;
    if (ctl.mainActive > WAVE_MAIN_WORKERS * 0.65 || retryBacklog > 80
        || extBacklog > 96 || ctl.apiBacklog > 96) return;
    const full = ctl.waveDone >= waveLength;
    const fast = ctl.waveDone >= fastTarget && ctl.mainActive <= WAVE_MAIN_WORKERS * 0.44;
    const soft = Date.now() - ctl.waveStartedAt >= 1600 && ctl.waveDone >= softTarget
      && ctl.mainActive <= WAVE_MAIN_WORKERS * 0.55;
    if (!full && !fast && !soft) return;
    ctl.waveStart = ctl.waveEnd;
    ctl.waveEnd = Math.min(total, ctl.waveStart + ctl.waveSize);
    ctl.waveDone = 0;
    ctl.waveStartedAt = Date.now();
    wakeMainWaiters();
  };
  const finishCondition = () => ctl.next >= total && ctl.mainActive === 0
    && ctl.socketActive === 0 && ctl.extActive === 0 && ctl.pendingDispatch === 0
    && ctl.socketQueue.length === 0 && ctl.extQueue.length === 0 && ctl.socketCool === 0;
  const notify = () => {
    evaluateWaveGate();
    wakeMainWaiters();
    if (ctl.stop || finishCondition()) {
      if (!ctl.stop) ctl.finished = true;
      ['socket', 'ext'].forEach((name) => {
        while (ctl.waiters[name].length) ctl.waiters[name].shift()(null);
      });
    }
  };
  const push = (name, task) => {
    const waiter = ctl.waiters[name].shift();
    if (waiter) { ctl.pendingDispatch++; waiter(task); }
    else ctl[name + 'Queue'].push(task);
    ctl[name + 'QueuePeak'] = Math.max(ctl[name + 'QueuePeak'], ctl[name + 'Queue'].length);
  };
  const pop = (name) => {
    const queue = ctl[name + 'Queue'];
    if (queue.length) return Promise.resolve(queue.shift());
    if (ctl.stop || ctl.finished) return Promise.resolve(null);
    return new Promise((resolve) => ctl.waiters[name].push(resolve));
  };
  const requeue = (response, task) => {
    if (response.disposition === 'deferredSocket') {
      const delay = Math.max(0, Math.min(1500, Number(response.cooldownMs) || 0));
      if (delay) {
        ctl.socketCool++;
        const timer = setTimeout(() => {
          ctl.timers.delete(timer);
          ctl.socketCool = Math.max(0, ctl.socketCool - 1);
          push('socket', Object.assign({}, task, { pass: 'socketRetry' }));
          notify();
        }, delay);
        ctl.timers.add(timer);
      } else push('socket', Object.assign({}, task, { pass: 'socketRetry' }));
      return true;
    }
    if (response.disposition === 'deferredExt') {
      push('ext', Object.assign({}, task, { pass: 'extBacklog' }));
      return true;
    }
    return false;
  };
  const report = () => tell(tabId, {
    type: 'BOTFAKE_WAVE_PROGRESS', jobId, total, done: ctl.done,
    mainActive: ctl.mainActive, mainPeak: ctl.mainPeak,
    socketActive: ctl.socketActive, socketPeak: ctl.socketPeak,
    extActive: ctl.extActive, extPeak: ctl.extPeak,
    socketQueue: ctl.socketQueue.length, socketQueuePeak: ctl.socketQueuePeak,
    socketCool: ctl.socketCool, extQueue: ctl.extQueue.length, extQueuePeak: ctl.extQueuePeak,
  });
  let reportTimer = setInterval(report, 1000);
  const gateTimer = setInterval(evaluateWaveGate, 60);

  const runPageTask = async (task) => {
    task.requestId = jobId + ':' + (++ctl.requestSeq);
    const response = await sendWaveTaskToPage(tabId, jobId, task);
    if (response && Number.isFinite(Number(response.apiBacklog))) ctl.apiBacklog = Math.max(0, Number(response.apiBacklog));
    if (!response || response.disposition === 'fatal') {
      ctl.error = (response && response.error) || 'Lỗi bridge khi gọi executor Pancake';
      ctl.stop = true;
      notify();
      return;
    }
    if (response.disposition === 'stop') {
      ctl.stop = true;
      notify();
      return;
    }
    if (requeue(response, task)) return;
    if (response.disposition !== 'done') {
      ctl.error = 'Executor Pancake trả disposition không hợp lệ';
      ctl.stop = true;
      notify();
      return;
    }
    ctl.done++;
  };
  const runMainWorker = async () => {
    while (!ctl.stop) {
      if (ctl.next >= ctl.waveEnd && ctl.waveEnd < total) {
        await new Promise((resolve) => ctl.mainWaiters.push(resolve));
        continue;
      }
      const index = ctl.next++;
      if (index >= total) { ctl.next = total; break; }
      const target = targets[index];
      const taskTarget = (target && typeof target === 'object') ? target : { id: target };
      ctl.mainActive++;
      ctl.mainPeak = Math.max(ctl.mainPeak, ctl.mainActive);
      try {
        await runPageTask(Object.assign({}, taskTarget, {
          id: String(taskTarget.id), pass: 'main', targetIndex: index,
        }));
      } finally {
        ctl.mainActive = Math.max(0, ctl.mainActive - 1);
        ctl.waveDone++;
        notify();
      }
    }
  };
  const runRetryWorker = async (name) => {
    while (!ctl.stop) {
      const task = await pop(name);
      if (!task) break;
      ctl.pendingDispatch = Math.max(0, ctl.pendingDispatch - 1);
      if (name === 'socket') {
        ctl.socketActive++;
        ctl.socketPeak = Math.max(ctl.socketPeak, ctl.socketActive);
      } else {
        ctl.extActive++;
        ctl.extPeak = Math.max(ctl.extPeak, ctl.extActive);
      }
      try { await runPageTask(task); }
      finally {
        if (name === 'socket') ctl.socketActive = Math.max(0, ctl.socketActive - 1);
        else ctl.extActive = Math.max(0, ctl.extActive - 1);
        notify();
      }
    }
  };

  try {
    const mainWorkers = Array.from({ length: Math.min(WAVE_MAIN_WORKERS, total) }, () => runMainWorker());
    const socketWorkers = Array.from({ length: Math.min(WAVE_SOCKET_WORKERS, total) }, () => runRetryWorker('socket'));
    const extWorkers = Array.from({ length: Math.min(WAVE_EXT_WORKERS, total) }, () => runRetryWorker('ext'));
    await Promise.all([...mainWorkers, ...socketWorkers, ...extWorkers]);
    report();
    return {
      ok: !ctl.error,
      error: ctl.error,
      stopped: ctl.stop,
      total,
      done: ctl.done,
      mainPeak: ctl.mainPeak,
      socketPeak: ctl.socketPeak,
      extPeak: ctl.extPeak,
      socketQueuePeak: ctl.socketQueuePeak,
      extQueuePeak: ctl.extQueuePeak,
    };
  } finally {
    if (reportTimer) { clearInterval(reportTimer); reportTimer = null; }
    if (gateTimer) clearInterval(gateTimer);
    ctl.timers.forEach((timer) => { try { clearTimeout(timer); } catch (e) { /* ignore */ } });
    ctl.timers.clear();
    ctl.running = false;
    if (waveCtl[tabId] === ctl) delete waveCtl[tabId];
    tell(tabId, {
      type: 'BOTFAKE_WAVE_DONE', jobId, ok: !ctl.error, error: ctl.error,
      stopped: ctl.stop, total, done: ctl.done,
      mainPeak: ctl.mainPeak, socketPeak: ctl.socketPeak, extPeak: ctl.extPeak,
      socketQueuePeak: ctl.socketQueuePeak, extQueuePeak: ctl.extQueuePeak,
    });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  if (!msg || !msg.type) return;

  if (msg.type === 'BOTFAKE_BG_FETCH') {
    swFetchJson(msg).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === 'BOTFAKE_GET_JOBS') {
    // overlay ở tab khác tự xin trạng thái (mới mở / vừa quay lại tab) → phát lại cho mọi tab
    hydrateJobs().then(() => broadcast());
    sendResponse && sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'BOTFAKE_JOB') {
    if (!tabId) { sendResponse && sendResponse({ ok: false }); return; }
    upsert(tabId, msg).then(() => {
      const dedicated = dedicatedBySenderTab[tabId];
      if (dedicated) tell(dedicated.uiTabId, {
        type: 'BOTFAKE_DEDICATED_PROGRESS', jobId: dedicated.jobId,
        pct: msg.pct, ok: msg.ok, total: msg.total, done: msg.done,
        phase: msg.phase, sending: msg.sending,
      });
      sendResponse && sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'BOTFAKE_DEDICATED_START') {
    if (!tabId || !msg.job || !msg.job.jobId || !msg.job.url) {
      sendResponse({ ok: false, error: 'Thiếu tab/job/url cho sender tab riêng' });
      return;
    }
    if (dedicatedByUiTab[tabId]) {
      sendResponse({ ok: false, error: 'Tab này đã có sender job riêng đang chạy' });
      return;
    }
    const item = {
      uiTabId: tabId,
      senderTabId: null,
      jobId: String(msg.job.jobId),
      job: msg.job,
      ready: false,
      stopRequested: false,
      uiClosed: false,
      bootTimer: null,
      done: false,
    };
    dedicatedByUiTab[tabId] = item;
    // Acknowledge synchronously before opening a tab. Holding the runtime message port
    // across tabs.create can be closed by Chrome during navigation/service-worker suspension.
    sendResponse({ ok: true, jobId: item.jobId, pending: true });
    try {
      chrome.tabs.create({ url: String(msg.job.url), active: false }, (created) => {
        const err = chrome.runtime.lastError;
        if (err || !created || !created.id) {
          finishDedicatedSender(item, null, (err && err.message) || 'Không tạo được sender tab', false);
          return;
        }
        const senderTabId = created.id;
        item.senderTabId = senderTabId;
        dedicatedBySenderTab[senderTabId] = item;
        item.bootTimer = setTimeout(() => failDedicatedSender(senderTabId, 'Sender tab khởi động quá hạn'), DEDICATED_SENDER_BOOT_TIMEOUT_MS);
        if (item.stopRequested || item.uiClosed) tell(senderTabId, { type: 'BOTFAKE_WAVE_STOP' });
      });
    } catch (e) {
      finishDedicatedSender(item, null, String(e && e.message || e), false);
    }
    return;
  }

  if (msg.type === 'BOTFAKE_WAVE_SENDER_READY') {
    const item = tabId && dedicatedBySenderTab[tabId];
    if (!item || item.ready) { sendResponse({ ok: !!item }); return; }
    item.ready = true;
    if (item.bootTimer) { clearTimeout(item.bootTimer); item.bootTimer = null; }
    try {
      chrome.tabs.sendMessage(tabId, { type: 'BOTFAKE_WAVE_EXTERNAL_JOB', job: item.job }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) failDedicatedSender(tabId, err.message || 'Không gửi được job tới sender tab');
      });
    } catch (e) { failDedicatedSender(tabId, String(e && e.message || e)); }
    sendResponse({ ok: true, jobId: item.jobId });
    return;
  }

  if (msg.type === 'BOTFAKE_DEDICATED_SEND_DONE') {
    const item = tabId && dedicatedBySenderTab[tabId];
    if (!item || item.jobId !== msg.jobId) { sendResponse({ ok: false, error: 'Dedicated job không còn hoạt động' }); return; }
    sendResponse({ ok: true });
    finishDedicatedSender(item, msg.result || {}, null, true);
    return;
  }

  if (msg.type === 'BOTFAKE_WAVE_START') {
    if (!tabId) { sendResponse({ ok: false, error: 'no tab' }); return; }
    if (waveCtl[tabId] && waveCtl[tabId].running) {
      sendResponse({ ok: false, error: 'Đang có Wave coordinator chạy ở tab này' });
      return;
    }
    runWaveCoordinator(tabId, msg.job || {}).catch((e) => {
      tell(tabId, { type: 'BOTFAKE_WAVE_DONE', jobId: msg.job && msg.job.jobId, ok: false, error: String(e && e.message || e) });
    });
    sendResponse({ ok: true, jobId: msg.job && msg.job.jobId });
    return;
  }

  if (msg.type === 'BOTFAKE_WAVE_STOP') {
    if (tabId) {
      const item = dedicatedByUiTab[tabId];
      if (item) {
        item.stopRequested = true;
        if (item.senderTabId) {
          stopWaveForTab(item.senderTabId);
          tell(item.senderTabId, { type: 'BOTFAKE_WAVE_STOP' });
        }
      } else stopWaveForTab(tabId);
    }
    sendResponse({ ok: true });
    return;
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
  stopWaveForTab(tabId);
  const ownedSender = dedicatedByUiTab[tabId];
  if (ownedSender) {
    ownedSender.uiClosed = true;
    ownedSender.stopRequested = true;
    if (ownedSender.senderTabId) {
      stopWaveForTab(ownedSender.senderTabId);
      tell(ownedSender.senderTabId, { type: 'BOTFAKE_WAVE_STOP' });
    }
  }
  const dedicated = dedicatedBySenderTab[tabId];
  if (dedicated) finishDedicatedSender(dedicated, null, 'Sender tab đã đóng khi job chưa hoàn tất', false);
  if (jobs[tabId]) { delete jobs[tabId]; persistJobs(); broadcast(); }
});

chrome.tabs.onMoved.addListener(() => broadcast());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete' || info.url) broadcast();
});

chrome.runtime.onInstalled.addListener(async () => {
  // Tiêm overlay/bridge vào các tab ĐANG MỞ SẴN: content script chỉ tự chạy khi tab tải lại,
  // nên sau mỗi lần reload extension mà không tiêm tay, chuyển qua tab cũ sẽ không thấy overlay
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t.id || !/^https?:/.test(t.url || '')) continue;
      try { await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['overlay.js'] }); } catch (e) { /* ignore */ }
      if (/pancake\.(vn|ph|id|in|biz)|pages\.fm|socialos\.vip/.test(t.url || '')) {
        try { await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['bridge.js'] }); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
});
