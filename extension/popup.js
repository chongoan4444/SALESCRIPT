document.getElementById('go').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://pages.fm/' });
});
