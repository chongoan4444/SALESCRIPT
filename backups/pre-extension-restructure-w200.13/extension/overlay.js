/* Overlay tiến độ BOTFAKE trên mọi tab (kể cả không phải Pancake) */
(function () {
  if (window !== window.top) return;
  if (window.__BOTFAKE_OVERLAY__) return;
  window.__BOTFAKE_OVERLAY__ = true;

  const ID = 'botfake-ext-overlay';
  const BOX =
    'position:fixed;right:10px;top:50%;transform:translateY(-50%);bottom:auto;left:auto;' +
    'z-index:2147483646;width:188px;font:11px/1.35 system-ui,Segoe UI,sans-serif;' +
    'background:rgba(15,23,42,.62);color:#e2e8f0;border-radius:10px;' +
    'border:1px solid rgba(148,163,184,.35);box-shadow:none;padding:8px 10px;' +
    'backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);pointer-events:none;';

  function ensure() {
    let el = document.getElementById(ID);
    if (!el) {
      el = document.createElement('div');
      el.id = ID;
      (document.body || document.documentElement).appendChild(el);
    }
    el.style.cssText = BOX + 'display:' + (el.style.display || 'none');
    return el;
  }

  function render(jobs, running) {
    const el = ensure();
    if (!jobs || !jobs.length) {
      el.style.cssText = BOX + 'display:none';
      el.innerHTML = '';
      return;
    }
    const n = running || jobs.length;
    const rows = jobs.map((j) => {
      const pct = Math.max(0, Math.min(100, Number(j.pct) || 0));
      const phase = j.phase === 'scan' ? 'Tải DS' : 'Gửi';
      const frac = (j.ok != null && j.total) ? (j.ok + '/' + j.total) : (j.done != null && j.total ? (j.done + '/' + j.total) : '');
      const barColor = j.phase === 'scan' ? '#38bdf8' : '#22c55e';
      return (
        '<div style="margin-top:6px">' +
          '<div style="display:flex;justify-content:space-between;font-weight:700;color:#f8fafc;gap:6px">' +
            '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (j.label || 'Pancake') + '</span>' +
            '<span style="color:#4ade80;flex-shrink:0">' + pct + '%</span>' +
          '</div>' +
          '<div style="font-size:10px;color:#94a3b8;margin:1px 0 3px">' + phase + (frac ? ' · ' + frac : '') + '</div>' +
          '<div style="height:5px;border-radius:99px;background:rgba(30,41,59,.45);overflow:hidden">' +
            '<div style="height:100%;width:' + pct + '%;background:' + barColor + '"></div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    el.innerHTML =
      '<div style="font-weight:800;font-size:11px;color:#93c5fd">BOTFAKE · ' + n + ' tab</div>' +
      rows;
    el.style.cssText = BOX + 'display:block';
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'BOTFAKE_OVERLAY') render(msg.jobs || [], msg.running);
  });

  // Tự xin trạng thái hiện tại: tab mở giữa chừng lúc đang gửi, hoặc SW vừa ngủ dậy
  // làm lỡ các broadcast trước đó — không phải chờ đợt broadcast kế tiếp mới hiện
  function pull() {
    try { chrome.runtime.sendMessage({ type: 'BOTFAKE_GET_JOBS' }, () => void chrome.runtime.lastError); } catch (e) { /* ignore */ }
  }
  pull();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
})();
