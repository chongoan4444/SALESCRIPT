/* BOTFAKE — gom tiến độ các tab Pancake, phát cho overlay mọi tab */

const PANCAKE_URL = [
  'https://pages.fm/*',
  'https://pancake.vn/*',
  'https://pancake.ph/*',
  'https://pancake.id/*',
  'https://pancake.in/*',
  'https://pancake.biz/*',
  'https://socialos.vip/*',
];

/** @type {Record<number, object>} */
const jobs = {};

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
  jobs[tabId] = Object.assign({}, prev, data, {
    tabId,
    n,
    label,
    at: Date.now(),
  });
  if (data.phase === 'idle' && !data.sending && !data.scanning) {
    delete jobs[tabId];
  }
  await broadcast();
}

async function broadcast() {
  const list = listJobs();
  const msg = { type: 'BOTFAKE_OVERLAY', jobs: list, running: list.length };
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) { return; }
  for (const t of tabs) {
    if (!t.id) continue;
    try {
      chrome.tabs.sendMessage(t.id, msg, () => void chrome.runtime.lastError);
    } catch (e) { /* tab chưa có overlay */ }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'BOTFAKE_JOB') return;
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) {
    sendResponse && sendResponse({ ok: false });
    return;
  }
  upsert(tabId, msg).then(() => sendResponse && sendResponse({ ok: true }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (jobs[tabId]) {
    delete jobs[tabId];
    broadcast();
  }
});

chrome.tabs.onMoved.addListener(() => broadcast());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete' || info.url) broadcast();
});
