/* Isolated world: chrome.runtime ↔ script MAIN (Redux Pancake), gồm cầu nối executor Wave. */
(function () {
  if (window.__BOTFAKE_BRIDGE__) return;
  window.__BOTFAKE_BRIDGE__ = true;
  try { document.documentElement.setAttribute('data-botfake-ext', '1'); } catch (e) { /* ignore */ }

  const pendingWaveResponses = new Map();
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__botfake !== 1) return;

    if (d.dir === 'wave_task_result' && d.requestId) {
      const pending = pendingWaveResponses.get(String(d.requestId));
      if (!pending) return;
      pendingWaveResponses.delete(String(d.requestId));
      clearTimeout(pending.timer);
      try { pending.sendResponse(d.response || { disposition: 'fatal', error: 'MAIN không trả kết quả task' }); } catch (e) { /* tab đã đóng */ }
      return;
    }

    if (d.dir !== 'to_sw') return;
    try {
      chrome.runtime.sendMessage(d.payload, (res) => {
        window.postMessage({
          __botfake: 1,
          dir: 'from_sw',
          id: d.id,
          res: res,
          err: (chrome.runtime.lastError && chrome.runtime.lastError.message) || null,
        }, '*');
      });
    } catch (e) {
      window.postMessage({ __botfake: 1, dir: 'from_sw', id: d.id, res: null, err: String(e && e.message || e) }, '*');
    }
  });

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'BOTFAKE_WAVE_TASK' && msg.requestId) {
        const requestId = String(msg.requestId);
        const timer = setTimeout(() => {
          if (!pendingWaveResponses.has(requestId)) return;
          pendingWaveResponses.delete(requestId);
          try { sendResponse({ disposition: 'fatal', error: 'Executor MAIN quá hạn 180s — không tự gửi lại để tránh trùng.' }); } catch (e) { /* ignore */ }
        }, 180000);
        pendingWaveResponses.set(requestId, { sendResponse, timer });
        window.postMessage({
          __botfake: 1,
          dir: 'wave_task',
          requestId,
          jobId: msg.jobId,
          task: msg.task || null,
        }, '*');
        return true; // giữ message channel tới khi MAIN trả task result
      }
      window.postMessage({ __botfake: 1, dir: 'push', msg: msg }, '*');
      return false;
    });
  } catch (e) { /* ignore */ }
})();
