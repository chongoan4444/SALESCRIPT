/* Isolated world: cầu chrome.runtime ↔ script MAIN (Redux Pancake) */
(function () {
  if (window.__BOTFAKE_BRIDGE__) return;
  window.__BOTFAKE_BRIDGE__ = true;
  try { document.documentElement.setAttribute('data-botfake-ext', '1'); } catch (e) { /* ignore */ }
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__botfake !== 1 || d.dir !== 'to_sw') return;
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
    chrome.runtime.onMessage.addListener((msg) => {
      window.postMessage({ __botfake: 1, dir: 'push', msg: msg }, '*');
    });
  } catch (e) { /* ignore */ }
})();
