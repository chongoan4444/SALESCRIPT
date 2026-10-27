const msg = document.getElementById('msg');
const hint = document.getElementById('hint');
const btn = document.getElementById('go');

function isPancake(url) {
  try {
    const h = new URL(url || '').hostname;
    return /(^|\.)pancake\.(vn|ph|id|in|biz)$/.test(h) || h === 'pages.fm' || h.endsWith('.pages.fm') || h === 'socialos.vip';
  } catch (e) { return false; }
}

function showPanel(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'BOTFAKE_SHOW_PANEL' }, () => {
    if (!chrome.runtime.lastError) {
      window.close();
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['pancake-send-lite.user.js'],
    }, () => {
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { type: 'BOTFAKE_SHOW_PANEL' }, () => window.close());
      }, 400);
    });
  });
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs && tabs[0];
  if (!tab) return;
  if (isPancake(tab.url)) {
    msg.innerHTML = 'Bạn đang ở <b>pancake.vn</b>. Panel BOTFAKE nằm góc phải trang — không phải cửa sổ này.';
    hint.textContent = 'Bấm nút để hiện lại panel nếu bị ẩn.';
    btn.textContent = 'Hiện panel trên trang này';
    btn.onclick = () => showPanel(tab.id);
  } else {
    msg.textContent = 'Tab này không phải hội thoại Pancake. Panel vẫn có thể hiện; gửi/tải list cần tab pancake.vn đang mở.';
    hint.textContent = 'Pancake #1 / #2 hiện khi đang gửi.';
    btn.textContent = 'Hiện panel trên tab này';
    btn.onclick = () => showPanel(tab.id);
  }
});
