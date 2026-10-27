/* Overlay tiến độ BOTFAKE trên mọi tab (kể cả không phải Pancake) */
(function () {
  if (window !== window.top) return;
  if (window.__BOTFAKE_OVERLAY__) return;
  window.__BOTFAKE_OVERLAY__ = true;

  const ID = 'botfake-ext-overlay';

  function ensure() {
    let el = document.getElementById(ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = ID;
    el.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483646',
      'width:280px', 'font:13px/1.4 system-ui,Segoe UI,sans-serif',
      'background:rgba(15,23,42,.42)', 'color:#e2e8f0', 'border-radius:12px',
      'border:1px solid rgba(148,163,184,.35)',
      'box-shadow:none', 'padding:12px 14px',
      'backdrop-filter:blur(2px)', '-webkit-backdrop-filter:blur(2px)',
      'display:none', 'pointer-events:none',
    ].join(';');
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function render(jobs, running) {
    const el = ensure();
    if (!jobs || !jobs.length) {
      el.style.display = 'none';
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
        '<div style="margin-top:8px">' +
          '<div style="display:flex;justify-content:space-between;font-weight:700;color:#f8fafc">' +
            '<span>' + (j.label || 'Pancake') + '</span>' +
            '<span style="color:#4ade80">' + pct + '%</span>' +
          '</div>' +
          '<div style="font-size:11px;color:#94a3b8;margin:2px 0 4px">' + phase + (frac ? ' · ' + frac : '') + '</div>' +
          '<div style="height:6px;border-radius:99px;background:rgba(30,41,59,.45);overflow:hidden">' +
            '<div style="height:100%;width:' + pct + '%;background:' + barColor + '"></div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    el.innerHTML =
      '<div style="font-weight:800;font-size:11px;color:#93c5fd">BOTFAKE · ' + n + ' tab</div>' +
      rows;
    el.style.display = 'block';
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'BOTFAKE_OVERLAY') render(msg.jobs || [], msg.running);
  });
})();
