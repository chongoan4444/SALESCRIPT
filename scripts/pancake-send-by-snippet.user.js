// ==UserScript==
// @name         BOTFAKE
// @namespace    salescript
// @version      1.42.0
// @description  BOTFAKE — chọn chuỗi chat (Alt+Click 2 đầu) hoặc theo snippet trong Pancake rồi gửi cùng 1 câu (kèm ảnh nếu muốn) cho tất cả.
// @author       SALESCRIPT
// @match        https://pancake.vn/*
// @match        https://pages.fm/*
// @match        https://pancake.ph/*
// @match        https://pancake.id/*
// @match        https://pancake.in/*
// @match        https://pancake.biz/*
// @match        https://socialos.vip/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * NGUỒN THAM CHIẾU TRONG REPO (xem README.md):
 * - html.txt / html2.txt / html3.txt / "html comment list":
 *     + Danh sách đoạn chat: div#conversationList → div.rc-virtual-list-holder-inner
 *       → <div id="{pageId}_{conversationId}">            (id = conversation.id theo API)
 *         → <div id="{pageId}_{conversationId}__{n}" class="media conversation-list-item">
 *            .name-text   = tên khách
 *            .time-modul  = giờ
 *            .snippet-text = snippet (dòng tin nhắn cuối, hiển thị cắt ngắn có "...")
 *     + Chat đang chọn có class "conversation-list-item selected".
 *     + Ô soạn tin: <textarea id="replyBoxComposer"> (không dùng — gửi qua API cho nhanh/ổn định).
 * - pancake.vn2.har:
 *     + access_token (JWT) được gửi trong query string của mọi request /api/v1/...
 * - _app-9331d46f21a84eb1.v6.js (logic gửi tin của website):
 *     + getHostname()            → https://pancake.vn/api  (apiBase = origin + "/api")
 *     + executeByApi/buildRequestBody/objectToFormData:
 *       POST {apiBase}/v1/pages/{page_id}/conversations/{encodeURIComponent(conversation.id)}/messages?access_token=...
 *       body (multipart/form-data): action=reply_inbox, message=<nội dung>
 *       → response JSON: { success: true, id } hoặc { success: false, message, message_code }
 *     + GET {apiBase}/v1/users/get_auth/?access_token=...  (dùng để kiểm tra token còn hạn)
 */

(function () {
  'use strict';

  /* ============================ HẰNG SỐ ============================ */

  const PANEL_ID = 'ssb-root';          // ssb = SaleScript Bulk — không đụng pk-*/adj-*/pancake-* của script khác
  const STYLE_ID = 'ssb-style';

  const MAX_NAME_LIST = 12;             // số tên hiển thị khi xác nhận

  /* ============================ TRẠNG THÁI ============================ */

  const state = {
    enabled: true,          // BẬT/TẮT tính năng (lắng nghe click, highlight)
    mode: null,             // 'snippet' (chọn theo snippet) | 'range' (chọn chuỗi 2 đầu) | null
    target: null,           // { id, name, snippet, time } — snippet người dùng đã chọn (mode snippet)
    rangeStart: null,       // đầu chuỗi (mode range — Alt+Click lần 1)
    rangeEnd: null,         // cuối chuỗi (mode range — Alt+Click lần 2)
    allRows: null,          // Map id → dòng (+ order trên→dưới) từ "Quét toàn bộ danh sách"
    matches: [],            // danh sách đoạn chat sẽ gửi [{ id, name, snippet, time, checked, mark, ... }]
    listKey: '',            // key dựng panel list — tránh build lại HTML khi không đổi
    sending: false,
    stopRequested: false,
    pickMode: false,
    log: [],
    savedLists: [],         // các list đã lưu [{id,name,items:[{id,pageId,name,snippet,snippetRaw,time,type,platform}]}]
    listSel: new Set(),     // id các list ĐANG TÍCH — gộp thành lựa chọn để gửi (gửi được nhiều list cùng lúc)
    loadedName: null,       // tên hiển thị (1 list hoặc "N list: …") — hiện ở mục 1
  };
  state.savedLists = loadSavedLists();

  let capturedToken = null; // token lấy từ request thật của trang (fetch/XHR hook)

  /* ============================ TIỆN ÍCH ============================ */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const norm = (s) => (s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Chạy song song tối đa `limit` task cùng lúc (limit = items.length ⇒ "1 phát" tất cả)
  async function runPool(items, worker, limit) {
    const results = new Array(items.length);
    let next = 0;
    const n = Math.max(1, Math.min(limit || 1, items.length));
    const lanes = [];
    for (let k = 0; k < n; k++) {
      lanes.push((async () => {
        while (next < items.length && !state.stopRequested) {
          const i = next++;
          results[i] = await worker(items[i], i);
        }
      })());
    }
    await Promise.all(lanes);
    return results;
  }
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function apiBase() {
    // getHostname() trong _app: dev.pages.fm → https://dev.pancake.vn/api; còn lại → origin + /api
    if (location.hostname === 'dev.pages.fm') return 'https://dev.pancake.vn/api';
    return location.origin.replace(/\/$/, '') + '/api';
  }

  /* ============================ ACCESS TOKEN ============================ */

  // Trang Pancake gửi access_token trong query của mọi request /api/v1/...
  // Kẹp token từ: (1) hook fetch/XHR, (2) performance resource entries,
  // (3) __NEXT_DATA__, (4) URL ảnh trong DOM, (5) localStorage.
  function hookNetwork() {
    try {
      const origFetch = window.fetch;
      window.fetch = function (input, init) {
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          grabTokenFromUrl(url);
        } catch (e) { /* ignore */ }
        return origFetch.apply(this, arguments);
      };
    } catch (e) { /* ignore */ }
    try {
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try { grabTokenFromUrl(String(url)); } catch (e) { /* ignore */ }
        return origOpen.apply(this, arguments);
      };
    } catch (e) { /* ignore */ }
  }

  function grabTokenFromUrl(url) {
    const m = /access_token=([A-Za-z0-9._-]+)/.exec(url || '');
    if (m && m[1] && m[1].split('.').length === 3) capturedToken = m[1]; // JWT dạng a.b.c
  }

  function getToken() {
    // app lấy token = cookie 'jwt' (getAccessToken trong _app) — đọc TRỰC TIẾP trước,
    // tránh dính token cũ đã nuốt từ URL lúc mới tải trang
    try {
      const m = /(?:^|;\s*)jwt=([^;]+)/.exec(document.cookie || '');
      if (m && m[1]) { capturedToken = decodeURIComponent(m[1]); return capturedToken; }
    } catch (e) { /* ignore */ }
    if (capturedToken) return capturedToken;
    try {
      const entries = performance.getEntriesByType('resource');
      for (let i = entries.length - 1; i >= 0; i--) {
        grabTokenFromUrl(entries[i].name);
        if (capturedToken) return capturedToken;
      }
    } catch (e) { /* ignore */ }
    try {
      const nd = document.getElementById('__NEXT_DATA__');
      if (nd) {
        const j = JSON.parse(nd.textContent || '{}');
        const t = j && j.props && j.props.initialState && j.props.initialState.auth
          && j.props.initialState.auth.accessToken;
        if (t) { capturedToken = t; return t; }
      }
    } catch (e) { /* ignore */ }
    try {
      const img = document.querySelector('[src*="access_token="]');
      if (img) grabTokenFromUrl(img.getAttribute('src') || img.src || '');
      if (capturedToken) return capturedToken;
    } catch (e) { /* ignore */ }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k) || '';
        const m = /eyJ[A-Za-z0-9._-]{20,}/.exec(v);
        if (m && m[0].split('.').length === 3) { capturedToken = m[0]; return capturedToken; }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /* ============================ ĐỌC DANH SÁCH ĐOẠN CHAT ============================ */

  // Mỗi dòng: <div id="{pageId}_{convId}"><div [id="{pageId}_{convId}__{n}"] class="media conversation-list-item">
  // (bản render có lúc id nằm ở div ngoài, có lúc nằm ở chính .conversation-list-item)
  function rowInfo(item) {
    try {
      let rawId = (item.id || '').replace(/__\d+$/, '');
      if (!rawId) {
        const wrap = item.closest && item.closest('div[id]');
        rawId = wrap ? String(wrap.id || '').replace(/__\d+$/, '') : '';
      }
      if (!/^\d+_|^[a-z0-9]+_/i.test(rawId)) return null;
      const nameEl = item.querySelector('.name-text');
      const snipEl = item.querySelector('.snippet-text');
      const timeEl = item.querySelector('.time-modul');
      const avtEl = item.querySelector('img[src*="/avatar/"]');
      let pageId = rawId.split('_')[0];
      if (avtEl) {
        const m = /\/pages\/([^/]+)\/avatar\//.exec(avtEl.getAttribute('src') || '');
        if (m) pageId = m[1]; // page_id đúng như API dùng
      }
      // icon trong .tag-wrap: envelope = inbox, comments = bình luận bài viết
      let type = '';
      if (item.querySelector('img[src*="comments.svg"]')) type = 'comment';
      else if (item.querySelector('img[src*="envelope"]')) type = 'inbox';
      let platform = '';
      const pm = item.querySelector('[class*="platform-"]');
      if (pm) {
        const mm = /platform-([a-z0-9_-]+)/i.exec(pm.className || '');
        if (mm) platform = mm[1];
      }
      return {
        id: rawId,
        pageId,
        name: norm(nameEl && nameEl.textContent),
        snippet: norm(snipEl && snipEl.textContent),   // snippet hiển thị (đã cắt ngắn "...")
        snippetRaw: (snipEl && snipEl.textContent || '').trim(),
        time: norm(timeEl && timeEl.textContent),
        type,
        platform,
      };
    } catch (e) {
      return null;
    }
  }

  function visibleRows() {
    const out = [];
    $$('.conversation-list-item').forEach((item) => {
      const info = rowInfo(item);
      if (info) out.push(info);
    });
    return out;
  }

  function selectedRowInfo() {
    const item = $('.conversation-list-item.selected') || $('.conversation-list-item.active');
    return item ? rowInfo(item) : null;
  }

  /* ============================ CHỌN SNIPPET + KHỚP ============================ */

  /* ============================ CHỌN SNIPPET / CHỌN CHUỖI 2 ĐẦU ============================ */

  // Nguồn dòng để khớp: ưu tiên kết quả quét toàn bộ, nếu chưa quét thì các dòng đang render
  function sourceRows() {
    if (state.allRows && state.allRows.size) return Array.from(state.allRows.values());
    return visibleRows();
  }

  function markOf(r) {
    if (state.target && r.id === state.target.id) return 'target';
    if (state.rangeStart && r.id === state.rangeStart.id) return 'start';
    if (state.rangeEnd && r.id === state.rangeEnd.id) return 'end';
    return '';
  }

  // So khớp snippet giữa dạng hiển thị trên màn hình (bị cắt "…") và dạng đầy đủ từ API
  function sameSnippet(a, b) {
    a = String(a || '').replace(/\s+/g, ' ').trim();
    b = String(b || '').replace(/\s+/g, ' ').trim();
    if (!a || !b) return false;
    if (a === b) return true;
    const cut = /(\.{3}|…)$/;
    const aCut = cut.test(a), bCut = cut.test(b);
    const a2 = a.replace(cut, ''), b2 = b.replace(cut, '');
    if (aCut && b.startsWith(a2)) return true;
    if (bCut && a.startsWith(b2)) return true;
    return a2 === b2;
  }

  function computeMatches() {
    if (state.mode === 'saved') return; // đang giữ LIST CÂU GỬI đã tích — không khớp lại theo snippet/chuỗi
    state.listSel = new Set();
    state.loadedName = null;
    renderSavedLists();
    const before = new Map(state.matches.map((m) => [m.id, m]));
    const list = [];
    const push = (r) => {
      const old = before.get(r.id);
      list.push({
        ...r,
        checked: old ? old.checked : (r.type !== 'comment'), // bình luận: mặc định bỏ tick (gửi = trả lời bình luận công khai)
        isTarget: !!markOf(r),
        mark: markOf(r),
      });
    };
    if (state.mode === 'snippet' && state.target) {
      sourceRows().forEach((r) => {
        if (sameSnippet(r.snippetRaw || r.snippet, state.target.snippetRaw || state.target.snippet)) push(r);
      });
    } else if (state.mode === 'range' && state.rangeStart && state.rangeEnd) {
      const aId = state.rangeStart.id, bId = state.rangeEnd.id;
      let rows, idxOf;
      if (state.allRows && state.allRows.has(aId) && state.allRows.has(bId)) {
        rows = Array.from(state.allRows.values());
        idxOf = (id) => state.allRows.get(id).order;
      } else {
        // virtual list render 1 dải liền nhau → 2 đầu còn thấy ⇒ các dòng ở giữa cũng thấy
        rows = visibleRows();
        const idx = new Map(rows.map((r, i) => [r.id, i]));
        idxOf = (id) => (idx.has(id) ? idx.get(id) : -1);
      }
      const ia = idxOf(aId), ib = idxOf(bId);
      if (ia < 0 || ib < 0) {
        logLine('⚠ Không tìm thấy 1 trong 2 đầu chuỗi trong danh sách — hãy Alt+Click chọn lại');
      } else {
        const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
        rows.forEach((r) => {
          const i = idxOf(r.id);
          if (i >= lo && i <= hi) push(r); // rows đang theo thứ tự trên→dưới
        });
      }
    }
    state.matches = list;
    highlightRows();
  }

  function setTarget(info, sourceLabel) {
    if (!info || !info.snippet) {
      logLine('⚠ Không đọc được snippet từ ' + (sourceLabel || 'dòng đã chọn'));
      return;
    }
    state.mode = 'snippet';
    state.rangeStart = null;
    state.rangeEnd = null;
    state.target = {
      id: info.id,
      name: info.name,
      snippet: info.snippet,
      snippetRaw: info.snippetRaw || info.snippet,
      time: info.time,
    };
    logLine('🎯 Đã chọn snippet từ ' + (info.name || '?') + ': “' + clip(info.snippet, 70) + '”');
    computeMatches();
    render();
  }

  function setRangeStart(info) {
    if (!info) return;
    state.mode = 'range';
    state.target = null;
    state.rangeEnd = null;
    state.rangeStart = {
      id: info.id,
      name: info.name,
      snippet: info.snippet,
      snippetRaw: info.snippetRaw,
      time: info.time,
    };
    state.matches = [];
    highlightRows();
    logLine('🅰 Đã đặt ĐẦU CHUỖI: ' + (info.name || info.id)
      + ' — giữ Alt và nhấp tiếp dòng CUỐI chuỗi (Esc để hủy)');
    render();
  }

  async function completeRange(endInfo) {
    const start = state.rangeStart;
    if (!start) return;
    // KHÔNG tự cuộn/quét ở đây — chỉ dùng dữ liệu đã có:
    //  - state.allRows (nếu đã bấm "⚡ Tải danh sách") → chính xác toàn danh sách
    //  - 2 đầu còn nằm trong vùng render → lấy theo thứ tự DOM
    state.mode = 'range';
    state.rangeEnd = {
      id: endInfo.id,
      name: endInfo.name,
      snippet: endInfo.snippet,
      snippetRaw: endInfo.snippetRaw,
      time: endInfo.time,
    };
    computeMatches();
    const n = state.matches.length;
    const haveAll = !!(state.allRows && state.allRows.has(start.id) && state.allRows.has(endInfo.id));
    const visIds = new Set(visibleRows().map((r) => r.id));
    const bothVisible = visIds.has(start.id) && visIds.has(endInfo.id);
    if (!haveAll && !bothVisible) {
      logLine('🔗 CHUỖI CHỌN: ' + (start.name || start.id) + ' → ' + (endInfo.name || endInfo.id)
        + ' — ⚠ 1 trong 2 đầu đã trôi khỏi màn hình. Bấm "⚡ Tải danh sách" để nạp đủ rồi chọn lại (hoặc chuỗi sẽ tự hoàn tất sau khi tải).');
    } else {
      logLine('🔗 CHUỖI CHỌN: ' + (start.name || start.id) + ' → ' + (endInfo.name || endInfo.id)
        + ' — ' + n + ' chat trong chuỗi'
        + (state.allRows ? ' (toàn danh sách)' : ' (trong vùng đang hiển thị)'));
    }
    render();
  }

  function clearSelection() {
    state.mode = null;
    state.target = null;
    state.rangeStart = null;
    state.rangeEnd = null;
    state.matches = [];
    state.listSel = new Set();
    state.loadedName = null;
    renderSavedLists();
    highlightRows();
  }

  /* ============================ LIST CÂU GỬI (localStorage) ============================ */

  const SL_KEY = 'ssb_saved_lists';

  function loadSavedLists() {
    try {
      const arr = JSON.parse(localStorage.getItem(SL_KEY) || '[]');
      if (!Array.isArray(arr)) return [];
      // câu cũ (lưu trước khi có text) → nội dung rỗng — vẫn gửi được bằng ô đang gõ
      return arr.filter((l) => l && l.id && Array.isArray(l.items))
        .map((l) => ({ ...l, text: String(l.text || '') }));
    } catch (e) { return []; }
  }

  function persistSavedLists() {
    try {
      localStorage.setItem(SL_KEY, JSON.stringify(state.savedLists));
      return true;
    } catch (e) {
      logLine('⚠ Không lưu được câu vào localStorage: ' + (e && e.message || e));
      return false;
    }
  }

  // Từ các câu ĐANG TÍCH → dựng lựa chọn hiện tại (gộp chat của mọi câu, loại trùng id)
  function rebuildFromLists() {
    const ids = state.listSel;
    if (!ids || !ids.size) {
      state.mode = null;
      state.loadedName = null;
      state.matches = [];
      highlightRows();
      render();
      return;
    }
    const seen = new Set();
    const items = [];
    const names = [];
    state.savedLists.forEach((l) => {
      if (!ids.has(l.id)) return;
      names.push(l.name);
      l.items.forEach((it) => {
        if (seen.has(it.id)) return;
        seen.add(it.id);
        // listId: chat thuộc câu nào — lúc gửi sẽ gửi ĐÚNG nội dung của câu đó
        items.push({ ...it, checked: true, isTarget: false, mark: '', listId: l.id });
      });
    });
    state.mode = 'saved';
    state.loadedName = names.length > 1
      ? names.length + ' câu: ' + names.slice(0, 2).join(', ') + (names.length > 2 ? '…' : '')
      : (names[0] || '');
    state.matches = items;
    // tích đúng 1 câu → gắn luôn NỘI DUNG câu vào ô cần gửi (chữ đã lưu khi tạo/sửa)
    if (ids.size === 1) {
      const only = state.savedLists.find((x) => x.id === Array.from(ids)[0]);
      const msgEl = shadow && shadow.getElementById('ssb-msg');
      if (only && msgEl) msgEl.value = String(only.text || '');
    }
    highlightRows();
    render();
  }

  function renderSavedLists() {
    const box = shadow && shadow.getElementById('ssb-sl-box');
    const info = shadow && shadow.getElementById('ssb-sl-info');
    if (info) {
      const nChat = state.savedLists.reduce((n, l) => n + l.items.length, 0);
      const nSel = state.listSel ? state.listSel.size : 0;
      info.textContent = state.savedLists.length + ' câu · ' + nChat + ' chat'
        + (nSel ? ' · đang chọn ' + nSel : '');
    }
    if (!box) return;
    if (!state.savedLists.length) {
      box.innerHTML = '<div class="empty">Chưa có câu nào — chọn chat + gõ câu cần gửi rồi bấm “＋ Tạo câu gửi”</div>';
      return;
    }
    box.innerHTML = state.savedLists.map((l) => {
      const sel = !!(state.listSel && state.listSel.has(l.id));
      const tt = 'Tích để chọn câu này gửi (chọn được nhiều câu cùng lúc)'
        + (l.text ? '\nNội dung: ' + clip(l.text, 90) : '\n(chưa có nội dung — bấm ✎ để thêm)');
      return `
      <div class="sl-row${sel ? ' active' : ''}" data-id="${esc(l.id)}" title="${esc(tt)}">
        <input type="checkbox" class="sl-cb" ${sel ? 'checked' : ''}>
        <span class="sl-handle" draggable="true" title="Kéo để sắp xếp">⠿</span>
        <span class="sl-name">${esc(l.name)} <span class="sl-n">(${l.items.length})</span></span>
        <button class="sl-btn" data-act="edit" title="Sửa tên + nội dung câu">✎</button>
        <button class="sl-btn" data-act="del" title="Xóa câu">✕</button>
      </div>`;
    }).join('');
  }

  // Sửa 1 câu: đổi TÊN + đổi NỘI DUNG (ô nhiều dòng — prompt() của trình duyệt không làm được)
  function openCauEditor(l) {
    if (!shadow || !l) return;
    if (shadow.getElementById('ssb-edit-ov')) return; // đã mở 1 hộp thoại
    const ov = document.createElement('div');
    ov.id = 'ssb-edit-ov';
    ov.className = 'edit-ov';
    const card = document.createElement('div');
    card.className = 'edit-card';
    const title = document.createElement('div');
    title.className = 'edit-title';
    title.textContent = '✎ Sửa câu';
    const lb1 = document.createElement('div');
    lb1.className = 'label';
    lb1.textContent = 'TÊN CÂU';
    const nameEl = document.createElement('input');
    nameEl.type = 'text';
    nameEl.value = l.name || '';
    const lb2 = document.createElement('div');
    lb2.className = 'label';
    lb2.textContent = 'NỘI DUNG CÂU SẼ GỬI';
    const textEl = document.createElement('textarea');
    textEl.value = String(l.text || '');
    const row = document.createElement('div');
    row.className = 'row';
    row.style.justifyContent = 'flex-end';
    const btnCancel = document.createElement('button');
    btnCancel.className = 'b b-gray';
    btnCancel.textContent = 'Hủy';
    const btnSave = document.createElement('button');
    btnSave.className = 'b b-green';
    btnSave.textContent = '💾 Lưu';
    row.appendChild(btnCancel);
    row.appendChild(btnSave);
    card.appendChild(title); card.appendChild(lb1); card.appendChild(nameEl);
    card.appendChild(lb2); card.appendChild(textEl); card.appendChild(row);
    ov.appendChild(card);
    shadow.appendChild(ov);
    const close = () => { ov.remove(); };
    btnCancel.addEventListener('click', close);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    const save = () => {
      const newName = (nameEl.value || '').trim() || l.name;
      const newText = textEl.value;
      const changed = newName !== l.name || newText !== (l.text || '');
      l.name = newName;
      l.text = newText;
      persistSavedLists();
      renderSavedLists();
      if (state.listSel.has(l.id)) rebuildFromLists(); // câu đang tích → ô cần gửi cập nhật theo
      close();
      if (changed) logLine('✏️ Đã sửa câu “' + l.name + '”');
    };
    btnSave.addEventListener('click', save);
    nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    nameEl.focus();
  }

  function highlightRows() {
    // Idempotent: chỉ thêm/bớt class khi khác — an toàn để gọi liên tục (observer/scroll/poll).
    const matchIds = new Set(state.matches.map((m) => m.id));
    const rootOf = (item) => item.closest('[role="row"]') || item;
    $$('.conversation-list-item').forEach((item) => {
      let want = '';
      if (state.enabled) {
        const info = rowInfo(item);
        if (info) {
          if (markOf(info)) want = 'ssb-m-target';
          else if (matchIds.has(info.id)) want = 'ssb-m-match';
        }
      }
      const paint = (el) => {
        if (!el || !el.classList) return;
        const has = el.classList.contains('ssb-m-target') ? 'ssb-m-target'
          : el.classList.contains('ssb-m-match') ? 'ssb-m-match' : '';
        if (has !== want) {
          el.classList.remove('ssb-m-target', 'ssb-m-match');
          if (want) el.classList.add(want);
        }
      };
      paint(item);
      paint(rootOf(item)); // tô cả khung dòng (role=row) — tránh bị panel màu của app che
    });
  }

  // Tô lại màu mỗi khi virtual list render lại dòng (cuộn, bấm chọn chat, app cập nhật…)
  let hlScheduled = false;
  function scheduleHighlight() {
    if (hlScheduled) return;
    hlScheduled = true;
    requestAnimationFrame(() => {
      hlScheduled = false;
      try { highlightRows(); } catch (e) { /* ignore */ }
    });
  }

  function watchList() {
    const list = $('#conversationList');
    if (!list) {
      // danh sách chưa render → thử lại
      setTimeout(() => { if (!state.destroyed) watchList(); }, 2000);
      return;
    }
    // 1) React thay DOM/class của dòng → tô lại
    try {
      const mut = new MutationObserver(() => scheduleHighlight());
      mut.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    } catch (e) { /* ignore */ }
    // 2) cuộn danh sách → tô lại
    try {
      const scroller = getScroller();
      if (scroller) scroller.addEventListener('scroll', () => scheduleHighlight(), { passive: true });
    } catch (e) { /* ignore */ }
    // 3) lưới an toàn: nếu vì lý do gì 1&2 hụt (list bị render lại toàn bộ) thì vẫn tự sửa sau ~0.4s
    setInterval(() => scheduleHighlight(), 400);
  }

  function clip(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* ============================ TẢI DANH SÁCH QUA API (siêu nhanh) ============================ */

  // Đúng request mà app tự gọi khi tải/tải thêm danh sách (buildConversationsRequest trong bundle):
  //   GET /api/v1/conversations?pages[p]=…&current_count=…&next_cursor=…&unread_first=true
  //       &mode=OR&tags="ALL"&except_tags=[]&access_token=…&cursor_mode=true&from_platform=web
  // Phản hồi: { conversations, next_cursor, pages_with_current_count, success }
  function fmtApiTime(iso) {
    if (!iso) return '';
    const d = new Date(/[zZ+]|\+\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z'); // updated_at là UTC, không kèm Z
    if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ' ' + p(d.getDate()) + '/' + p(d.getMonth() + 1);
  }

  function convApiRow(c, order) {
    const from = c.from || {};
    const cust = (c.customers && c.customers[0]) || {};
    return {
      id: String(c.id || ''),
      name: c.name || from.name || from.username || cust.name || String(c.id || ''),
      snippet: c.snippet || '',
      snippetRaw: c.snippet || '',
      time: fmtApiTime(c.updated_at),
      type: String(c.type || '').toLowerCase() === 'comment' ? 'comment' : 'inbox',
      pageId: String(c.page_id || c.id.split('_')[0] || ''), // pageId có sẵn — khỏi suy từ id
      threadId: String(c.thread_id || ''), // thread_id có sẵn trong API — khỏi tải lại conversation khi gửi
      tags: Array.isArray(c.tags) ? c.tags.slice() : [], // tag ids — lọc "chốt"/"chặn" lúc gửi
      hasPhone: !!c.has_phone, // icon điện thoại (phone-green) — sale đang chăm, không bắn hàng loạt
      threadKey: String(c.thread_key || ''), // payload Ext cần convId = thread_key (đúng executeByExtOnce)
      customerName: String((c.from && (c.from.username || c.from.name)) || c.name || ''), // payload Ext cần customerName
      updatedAt: String(c.updated_at || ''), // payload Ext cần conversationUpdatedTime
      lastAt: String(c.last_customer_interactive_at || ''), // mốc tương tác cuối của khách — đoán cửa sổ 24h
      fromPsid: String(c.from_psid || ((c.from || {}).id) || ''), // PSID của khách — có sẵn trong dữ liệu API
      order,
    };
  }

  // GET an toàn: tự thử lại khi bị rate-limit (429)/5xx/lỗi mạng; trả lỗi kèm chi tiết
  async function fetchJson(url, tries) {
    const max = tries || 3;
    let lastErr = '';
    for (let t = 1; t <= max; t++) {
      let abortTimer = null;
      try {
        // fetch trần KHÔNG tự hết hạn — kết nối treo là await treo theo → chặn toàn bộ lượt gửi
        const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
        if (ctl) abortTimer = setTimeout(() => ctl.abort(), 15000);
        const r = await fetch(url, {
          credentials: 'include', cache: 'no-store',
          signal: ctl ? ctl.signal : undefined,
        });
        if (abortTimer) { clearTimeout(abortTimer); abortTimer = null; }
        if (r.status === 429 || r.status >= 500) {
          lastErr = 'HTTP ' + r.status;
          if (t < max) { await sleep(800 * t); continue; }
          return { ok: false, error: lastErr };
        }
        if (!r.ok) {
          const body = (await r.text() || '').slice(0, 140);
          return { ok: false, error: 'HTTP ' + r.status + (body ? ' · ' + body : '') };
        }
        const txt = await r.text();
        if (!txt || !txt.trim()) return { ok: true, data: { conversations: [] } }; // body rỗng = hết dữ liệu
        try { return { ok: true, data: JSON.parse(txt) }; } catch (e) {
          try { return { ok: true, data: JSON.parse(atob(txt)) }; } catch (e2) {
            return { ok: false, error: 'Phản hồi không phải JSON' };
          }
        }
      } catch (e) {
        if (abortTimer) clearTimeout(abortTimer);
        lastErr = (e && e.name === 'AbortError') ? 'quá 15s chưa phản hồi' : 'Lỗi mạng: ' + (e && e.message || e);
        if (t < max) { await sleep(800 * t); continue; }
        return { ok: false, error: lastErr };
      }
    }
    return { ok: false, error: lastErr || 'Không tải được' };
  }

  // Đọc tham số danh sách GIỐNG app (eU → buildConversationsRequest trong bundle):
  //   pageIdOrPageIds = pages.multiplePageMode ? pages.multiplePageIds : pages.currentPageId
  //   pageSettings    = pages.multiplePageMode ? auth.settings : pages.currentSettings
  //   unreadFirst     = pageSettings.unread_first (tắt nếu sort UNREPLIED_*)
  //   filterMode      = pageSettings.filter_multi_tag ("OR"/"NONE"/string)
  //   tags/except     = conversations.filteredTag ?? "ALL"; type = conversations.filteredType
  const LIST_SPECIAL_TYPES = ['NOT_PRIVATE_REPLY', 'LIVESTREAM_MARKED_ORDER', 'IS_LIVESTREAM_POST_ON',
    'IS_LIVESTREAM_POST_OFF', 'PERSONAL_MESSAGE', 'GROUP_MESSAGE', 'BIZAI_GENERATING',
    'BIZAI_NOT_GENERATING', 'BIZAI_TRANSFERRED', 'STRANGER_MESSAGE'];

  function buildListRequest(pageCount, cursor, currentCount, token, opts) {
    const st = window.__pancakeReduxStore__.getState();
    const pgs = st.pages || {};
    const auth = st.auth || {};
    const cs = st.conversations || {};
    const multi = !!pgs.multiplePageMode;
    const ids = multi
      ? (Array.isArray(pgs.multiplePageIds) ? pgs.multiplePageIds : [])
      : (pgs.currentPageId ? [pgs.currentPageId] : []);
    const settings = (multi ? auth.settings : pgs.currentSettings) || {};
    const ftype = Array.isArray(cs.filteredType) ? cs.filteredType : (cs.filteredType ? [cs.filteredType] : []);
    let unreadFirst = (settings.unread_first === undefined || settings.unread_first === null)
      ? true : !!settings.unread_first;
    if (ftype.indexOf('UNREPLIED_ASC') > -1 || ftype.indexOf('UNREPLIED_SEEN') > -1) unreadFirst = false;
    let mode;
    if (multi) mode = pgs.multiPageFilterMode || settings.filter_multi_tag || 'OR';
    else mode = settings.filter_multi_tag === true ? 'OR'
      : (settings.filter_multi_tag === false || settings.filter_multi_tag === undefined ? 'NONE' : settings.filter_multi_tag);
    // tags / except_tags — filteredTag có thể là "ALL" hoặc mảng (có thể lẫn "EXCEPT_TAG_123")
    let tagsVal = (cs.filteredTag === undefined || cs.filteredTag === null) ? 'ALL' : cs.filteredTag;
    let exceptIds = [];
    if (Array.isArray(tagsVal)) {
      const keep = [];
      tagsVal.forEach((t) => {
        const m = /^EXCEPT_TAG_(\d+)$/.exec(String(t));
        if (m) exceptIds.push(parseInt(m[1], 10));
        else keep.push(t);
      });
      tagsVal = keep;
    }
    // FORCE lọc theo tag (dùng khi kiểm tra tag "chốt"/"chặn" lúc gửi):
    // server nhận tags=[id…] và tự trả đúng các chat dính 1 trong các tag đó (mode=OR)
    if (opts && Array.isArray(opts.forceTags) && opts.forceTags.length) {
      // id tag GIỮ DẠNG SỐ y như app (tags=[387] chứ KHÔNG ["387"]) — id chuỗi bị server bỏ qua
      tagsVal = opts.forceTags.map((x) => (/^\d+$/.test(String(x)) ? Number(x) : String(x)));
      exceptIds = [];
      mode = 'OR';
    }
    // types = filteredType bỏ các cờ đặc biệt; cờ → query riêng như app
    const types = ftype.filter((e) => LIST_SPECIAL_TYPES.indexOf(e) === -1);
    const q = new URLSearchParams();
    if (types.length) {
      q.append('type', types.toString());
    } else if (ftype.indexOf('NOT_PRIVATE_REPLY') > -1 && ftype.indexOf('COMMENT') > -1) {
      q.append('is_private_replied', 'false');
    }
    if (ftype.indexOf('COMMENT') > -1 && ftype.indexOf('LIVESTREAM_MARKED_ORDER') > -1) q.append('filter_has_livestream_order', 'true');
    if (ftype.indexOf('IS_LIVESTREAM_POST_ON') > -1) q.append('is_livestream_post', 'true');
    else if (ftype.indexOf('IS_LIVESTREAM_POST_OFF') > -1) q.append('is_livestream_post', 'false');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('GROUP_MESSAGE') > -1) q.append('inbox_type', '1');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('PERSONAL_MESSAGE') > -1) q.append('inbox_type', '');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('STRANGER_MESSAGE') > -1) q.append('stranger_status', '1');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('BIZAI_GENERATING') > -1) q.append('bizai_status', '1');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('BIZAI_NOT_GENERATING') > -1) q.append('bizai_status', '');
    if (ftype.indexOf('INBOX') > -1 && ftype.indexOf('BIZAI_TRANSFERRED') > -1) q.append('bizai_status', '2');
    if (cs.filteredTask === 'open' || (cs.filteredTask && cs.filteredTask !== 'close')) q.append('task_opened', 'open');
    if (cs.filteredAssignee) q.append('assignee_id', JSON.stringify(cs.filteredAssignee));
    ids.forEach((p) => q.append('pages[' + p + ']', String((pageCount && pageCount[p]) || 0)));
    if (currentCount) {
      q.append('current_count', String(currentCount));
      if (cursor) q.append('next_cursor', cursor);
    }
    q.append('unread_first', unreadFirst ? 'true' : 'false');
    q.append('mode', String(mode));
    q.append('tags', JSON.stringify(tagsVal));
    q.append('except_tags', JSON.stringify(exceptIds));
    q.append('access_token', token);
    q.append('cursor_mode', 'true');
    q.append('from_platform', 'web');
    return { ids, url: location.origin + '/api/v1/conversations?' + q.toString() };
  }

  async function loadListViaApi(onProgress, opts) {
    const token = getToken();
    if (!token) return { ok: false, error: 'Không lấy được access token' };

    const rows = [];
    const seen = new Set();
    let cursor = null;
    let pageCount = {};
    let guard = 0;
    let ids = [];

    while (guard++ < 300) {
      let url;
      try {
        const req = buildListRequest(pageCount, cursor, rows.length || 0, token, opts);
        ids = req.ids;
        url = req.url;
      } catch (e) {
        return { ok: false, error: 'Không đọc được bộ lọc của app: ' + (e && e.message || e) };
      }
      if (!ids.length) return { ok: false, error: 'Không xác định được page đang xem' };

      const res = await fetchJson(url, 3);
      if (!res.ok) return { ok: false, error: 'API danh sách lỗi trang ' + guard + ': ' + res.error };
      const j = res.data || {};
      if (j.success === false) {
        return { ok: false, error: 'API danh sách lỗi trang ' + guard + ': ' + (j.message || j.error || 'success=false') };
      }
      const before = rows.length;
      const convs = j.conversations || [];
      convs.forEach((c) => {
        const id = String(c.id || '');
        if (!id || seen.has(id)) return;
        seen.add(id);
        rows.push(convApiRow(c, rows.length));
      });
      // server trả lại trang CŨ (cursor không tiến, mọi dòng đều trùng) → DỪNG ngay:
      // trước đây cứ lặp tiếp tới 300 trang = "tải lại 1 lượt" treo 1–2 phút, chặn cả lượt gửi
      if (rows.length === before && guard > 1) break;
      if (opts && opts.maxPages && guard >= opts.maxPages) break;
      // GỘP DỒN số đếm theo page (server cần số luỹ kế — ghi đè sẽ hỏng từ trang sau)
      if (j.pages_with_current_count && typeof j.pages_with_current_count === 'object') {
        pageCount = Object.assign({}, pageCount, j.pages_with_current_count);
      }
      cursor = j.next_cursor || null;
      if (onProgress) onProgress(rows.length);
      if (!cursor || !convs.length) break;
      await sleep(120); // nghỉ nhẹ giữa các trang — tránh bị rate-limit
    }
    return { ok: true, rows };
  }

  /* ============================ LỌC TAG "CHỐT"/"CHẶN" LÚC GỬI ============================
     Trong lúc chờ gửi, sale có thể đã gắn tag "…chốt" (đã chốt đơn — KHÔNG được gửi tiếp)
     hoặc tag "chặn". Lúc bấm Gửi: tải lại tag MỘT LƯỢT (API lọc sẵn theo tag) rồi bỏ qua. */

  // so khớp TÊN TAG: "chốt"/"chặn" nguyên từ (có dấu) hoặc từ độc lập sau khi bỏ dấu
  // ("Huyền chốt", "Chặn", "chot don"…). KHÔNG dùng chuỗi con — "Bình Chánh"/"Chánh" (chanh)
  // từng bị hiểu nhầm là "chặn" (chan) → loại oan cả loạt chat sạch.
  function tagBanName(name) {
    // chuẩn hóa NFC trước — tên tag trên DOM có thể ở dạng tổ hợp (NFD) khiến khớp chuỗi trượt
    let raw = String(name || '').toLowerCase();
    try { raw = raw.normalize('NFC'); } catch (e) { /* ignore */ }
    if (raw.indexOf('chốt') > -1 || raw.indexOf('chặn') > -1) return true;
    const norm = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    return /\bchot\b/.test(norm) || /\bchan\b/.test(norm);
  }

  // Icon điện thoại (phone-green.svg) trong danh sách = chat CÓ SỐ ĐIỆN THOẠI (has_phone) —
  // sale đang chăm khách này → không bắn tin hàng loạt vào. Soi 3 nguồn: icon trên màn hình
  // (mắt thấy gì dùng nấy), redux app (live), dữ liệu dòng chat đã lưu.
  function convHasPhone(m) {
    try {
      const el = document.getElementById(String(m.id));
      if (el && el.querySelector('img[src*="phone"]')) return true;
    } catch (e) { /* ignore */ }
    try {
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const lists = st && st.conversations
        && [st.conversations.data, st.conversations.filteredConversationsCloneList];
      for (let i = 0; lists && i < lists.length; i++) {
        const arr = lists[i];
        if (!Array.isArray(arr)) continue;
        const hit = arr.find((c) => c && String(c.id) === String(m.id));
        if (hit && hit.has_phone !== undefined && hit.has_phone !== null) return !!hit.has_phone;
      }
    } catch (e) { /* ignore */ }
    return m.hasPhone === true;
  }

  // Tên tag cấm hiển thị NGAY TRÊN DÒNG CHAT (DOM) — "mắt thấy gì dùng nấy": user thấy tag
  // "CHẶN" trên dòng mà vẫn bị gửi → đây là bằng chứng trực tiếp, KHÔNG phụ pageSettingTags
  // hay bất kỳ API nào. Trả về tên tag cấm đầu tiên trên dòng (để log), không thấy → null.
  function rowBanTagFromDom(m) {
    try {
      const el = document.getElementById(String(m.id));
      if (!el) return null;
      const spans = el.querySelectorAll('.conversation_tags_item, .list-tags-conv .ant-tag, .ant-tag');
      for (let i = 0; i < spans.length; i++) {
        const nm = String((spans[i] && spans[i].textContent) || '').trim();
        if (nm && tagBanName(nm)) return nm;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // Tag của chat từ dữ liệu app: `filledTags` (app TỰ map id → object tag có text) hoặc
  // `tags` id + bảng banNameById. Trả về tên tag cấm đầu tiên, sạch → null.
  function convBanTagFromData(m, banNameById) {
    const checkIds = (ids) => {
      for (let k = 0; ids && k < ids.length; k++) {
        const nm = banNameById && banNameById[String(ids[k])];
        if (nm) return nm;
      }
      return null;
    };
    try {
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const lists = st && st.conversations
        && [st.conversations.data, st.conversations.filteredConversationsCloneList];
      for (let i = 0; lists && i < lists.length; i++) {
        const arr = lists[i];
        if (!Array.isArray(arr)) continue;
        const hit = arr.find((c) => c && String(c.id) === String(m.id));
        if (!hit) continue;
        const ft = Array.isArray(hit.filledTags) ? hit.filledTags : [];
        for (let k = 0; k < ft.length; k++) {
          const nm = String((ft[k] && (ft[k].text || ft[k].name || ft[k].title)) || '');
          if (nm && tagBanName(nm)) return nm;
        }
        const idHit = checkIds(hit.tags) || checkIds(m.tags);
        if (idHit) return idHit;
      }
    } catch (e) { /* ignore */ }
    return checkIds(m && m.tags);
  }

  // Trả { kept, skippedTag, skippedPhone }: CHỈ bỏ qua khi xác nhận dính tag cấm/icon điện thoại;
  // chat không kiểm tra được → GIỮ NGUYÊN (thiếu dữ liệu không được làm mất tin).
  async function filterBannedTagTargets(targets) {
    const kept = [], skippedTag = [], skippedPhone = [];
    try {
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const defsByPage = (st && st.conversations && st.conversations.pageSettingTags) || {};
      const banIds = new Set();
      const banNameById = {};
      const banNames = [];
      const seenPage = {};
      targets.forEach((m) => {
        const pid = m.pageId || String(m.id || '').split('_')[0];
        if (seenPage[pid]) return;
        seenPage[pid] = 1;
        // bảng tag trang: { [pageId]: defs } (shape app) hoặc mảng phẳng — thiếu cũng không sao,
        // tag cấm vẫn bắt được từ filledTags/dòng chat (DOM) ở bước lọc từng chat bên dưới
        let defs = defsByPage[pid];
        if (!Array.isArray(defs) && Array.isArray(defsByPage)) defs = defsByPage;
        (defs || []).forEach((t) => {
          const nm = String((t && (t.text || t.name || t.title)) || '');
          if (tagBanName(nm)) {
            banIds.add(t.id);
            banNameById[String(t.id)] = nm;
            if (banNames.indexOf(nm) < 0) banNames.push(nm);
          }
        });
      });
      if (!banIds.size) {
        logLine('⚠ Không có bảng tag của trang — soi tag theo DÒNG CHAT + dữ liệu app (filledTags).');
      }
      // id tag giữ NGUYÊN dạng số như app (tags:[387,388] — chuỗi sẽ bị server bỏ qua!)
      const banIdNum = {};
      banIds.forEach((id) => { banIdNum[String(id)] = (typeof id === 'number' || /^\d+$/.test(String(id))) ? Number(id) : id; });
      const tagOf = {}; // convId → TÊN tag cấm mà nó mang (để log cho user soi)
      if (banIds.size) {
        // ĐÂY LÀ KHO TAG CẤM CỦA TRANG (tag "…chốt"/"chặn" mà shop đã tạo sẵn) — KHÔNG phải
        // tag đang gắn trên chat nào. Chỉ chat NÀO THẬT SỰ đang gắn 1 trong các tag này mới bị bỏ qua.
        const preview = banNames.slice(0, 3).map((x) => '"' + x + '"').join(', ')
          + (banNames.length > 3 ? '… +' + (banNames.length - 3) + ' tag' : '');
        logLine('🔎 Lọc tag lúc gửi: trang có ' + banNames.length + ' tag cấm (' + preview
          + ') — CHỈ bỏ qua chat nào THẬT SỰ đang gắn 1 trong các tag này; chat không có tag không bị ảnh hưởng.');
        // bước tải lại qua API chỉ là lớp phụ — TUYỆT ĐỐI không được chặn gửi: ngân sách 8s + tối đa 3 trang.
        // hết ngân sách thì vẫn lọc đủ bằng DÒNG CHAT + filledTags (2 lớp chính)
        const res = await Promise.race([
          loadListViaApi(null, { forceTags: Object.keys(banIdNum).map((k) => banIdNum[k]), maxPages: 3 }),
          sleep(8000).then(() => ({ ok: false, error: 'quá 8s chờ API — dùng 2 lớp còn lại' })),
        ]);
        if (!res.ok) {
          logLine('⚠ Không tải lại được tag qua API (' + res.error + ') — vẫn soi tag theo DÒNG CHAT + dữ liệu app.');
        } else {
          // CHỈ tin khi CHÍNH chat đó mang tag cấm trong dữ liệu trả về — nếu server bỏ qua
          // tham số tags mà trả cả danh sách thì vẫn không bỏ sót/không loại oan ai
          (res.rows || []).forEach((r) => {
            const hit = (r.tags || []).map(String).find((t) => banNameById[t]);
            if (hit) tagOf[r.id] = banNameById[hit];
          });
        }
      }
      // BẰNG CHỨNG ĐỦ 3 LỚP cho từng chat — lớp nào bắt được trước thì dùng, log kèm tên tag:
      //   1) tag hiển thị TRÊN DÒNG CHAT (DOM) — mắt thấy gì dùng nấy
      //   2) dữ liệu app: filledTags (app tự map tên) / tags id + bảng tag trang
      //   3) kết quả tải lại tag theo API (tagOf) — kiểm tra cả khi server lơ tham số lọc
      targets.forEach((m) => {
        const why = rowBanTagFromDom(m) || convBanTagFromData(m, banNameById) || tagOf[m.id] || null;
        if (why) skippedTag.push({ m: m, why: why });
        else if (convHasPhone(m)) skippedPhone.push(m);
        else kept.push(m);
      });
    } catch (e) {
      logLine('⚠ Lọc lúc gửi lỗi (' + (e && e.message || e) + ') — giữ nguyên danh sách.');
      return { kept: targets, skippedTag, skippedPhone };
    }
    return { kept, skippedTag, skippedPhone };
  }

  /* ============================ QUÉT TOÀN BỘ DANH SÁCH ============================ */

  function getScroller() {
    return $('#conversationList .rc-virtual-list-holder')
      || $('#conversationList .rc-virtual-list-holder')
      || $('.conversation-list .rc-virtual-list-holder')
      || $('#conversationList')
      || $('.conversation-list');
  }

  // Danh sách là virtual list (rc-virtual-list): chỉ render các dòng đang thấy.
  // Quét = cuộn dần, đọc từng dòng xuất hiện, cho tới khi không thấy id mới.
  // Tải/quét toàn bộ danh sách — CHỈ chạy khi người dùng bấm nút (không tự cuộn bao giờ).
  // Tối ưu tốc độ: bước cuộn lớn, chờ ngắn theo poll, chỉ chờ lâu ở đáy (app đang tải thêm).
  async function scanFullList() {
    const scroller = getScroller();
    if (!scroller) {
      logLine('⚠ Không tìm thấy khung danh sách đoạn chat (#conversationList)');
      return;
    }
    const btn = shadow && shadow.getElementById('ssb-scan');
    const setBtn = (t) => { if (btn) btn.textContent = t; };

    // 1) TẢI QUA API — siêu nhanh, không cuộn (đúng request app dùng để tải danh sách)
    logLine('⚡ Đang tải danh sách qua API…');
    setBtn('⏳ API…');
    const api = await loadListViaApi((n) => setBtn('⏳ ' + n + ' chat…'));
    if (api && api.ok && api.rows.length) {
      // kiểm tra khớp với các dòng đang thấy trên màn hình:
      //  - thiếu dòng nào → API khác màn hình → quét giao diện
      //  - các dòng liền nhau trên màn hình mà lệch thứ tự xa trong API → có bộ lọc → quét giao diện
      const vis = visibleRows();
      const byId = new Map(api.rows.map((r) => [r.id, r]));
      let missing = 0, scattered = 0;
      const missSample = [];
      for (let i = 0; i < vis.length; i++) {
        if (!byId.has(vis[i].id)) {
          missing++;
          if (missSample.length < 3) missSample.push(vis[i].id);
        }
        if (i > 0) {
          const a = byId.get(vis[i - 1].id), b = byId.get(vis[i].id);
          if (a && b && Math.abs(a.order - b.order) > 3) scattered++;
        }
      }
      const scatterLimit = Math.max(2, Math.ceil(vis.length * 0.2));
      logLine('ℹ API: ' + api.rows.length + ' chat · màn hình: ' + vis.length + ' dòng · thiếu: '
        + missing + ' · lệch thứ tự: ' + scattered
        + (missing ? ' · id thiếu: ' + missSample.join(', ') : ''));
      if (!vis.length || (missing === 0 && scattered <= scatterLimit)) {
        const found = new Map(api.rows.map((r) => [r.id, { ...r }]));
        // cập nhật tên/giờ/loại theo app cho các dòng đang thấy trên màn hình
        vis.forEach((r) => {
          if (found.has(r.id)) found.set(r.id, { ...found.get(r.id), ...r });
        });
        let ord = 0;
        found.forEach((v) => { v.order = ord++; });
        state.allRows = found;
        setBtn('⚡ Tải danh sách (' + found.size + ' chat)');
        logLine('⚡ Tải qua API: ' + found.size + ' chat — không cần cuộn');
        computeMatches();
        render();
        return;
      }
      logLine('⚠ Danh sách API không khớp màn hình (có thể đang bật bộ lọc) — chuyển sang quét giao diện…');
    } else {
      logLine('⚠ ' + ((api && api.error) || 'Tải API thất bại') + ' — chuyển sang quét giao diện…');
    }

    // 2) QUÉT GIAO DIỆN (dự phòng) — luôn khớp đúng những gì đang thấy trên màn hình
    const savedTop = scroller.scrollTop;
    const found = new Map();
    let guard = 0;
    logLine('⚡ Đang quét danh sách trên giao diện…');

    const collect = () => {
      let added = 0;
      visibleRows().forEach((r) => {
        if (!found.has(r.id)) {
          found.set(r.id, { ...r }); // thứ tự Map = thứ tự trên→dưới
          added++;
        }
      });
      return added;
    };

    scroller.scrollTop = 0;
    await sleep(150);
    collect();
    setBtn('⏳ ' + found.size + ' chat…');

    const step = Math.max(220, Math.round(scroller.clientHeight * 0.9));
    let noNewStreak = 0;
    while (guard++ < 5000) { // đủ cho cả nghìn chat (mỗi bước ~1 màn hình ≈ 8-12 dòng)
      const prevTop = scroller.scrollTop;
      scroller.scrollTop = prevTop + step;
      let atBottom = false;
      if (scroller.scrollTop === prevTop) {
        // 1 số bản render cuộn bằng wheel event thay vì scrollTop
        try {
          scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: step, bubbles: true, cancelable: true }));
        } catch (e) { /* ignore */ }
        await sleep(120);
        atBottom = scroller.scrollTop === prevTop; // kéo không nổi = đáy danh sách
      }
      await sleep(90); // chờ render + app kích hoạt tải thêm (infinite scroll)
      const added = collect();

      if (atBottom) {
        // đáy: chờ app tải nốt trang cuối (poll nhanh, tối đa ~450ms)
        const t0 = Date.now();
        while (Date.now() - t0 < 450) {
          await sleep(110);
          if (collect() > 0) { setBtn('⏳ ' + found.size + ' chat…'); }
        }
        break;
      }
      if (added === 0) {
        noNewStreak++;
        if (noNewStreak >= 2) {
          // 2 bước không thấy dòng mới giữa chừng → app có thể đang tải dở, chờ nốt rồi đi tiếp
          await sleep(260);
          collect();
          noNewStreak = 0;
        }
      } else {
        noNewStreak = 0;
      }
      if (guard % 8 === 0) setBtn('⏳ ' + found.size + ' chat…');
    }

    scroller.scrollTop = savedTop;
    await sleep(120);

    // cập nhật dữ liệu mới nhất cho các dòng còn đang render
    visibleRows().forEach((r) => {
      if (found.has(r.id)) found.set(r.id, { ...found.get(r.id), ...r });
    });
    // gán thứ tự trên→dưới để dùng cho chọn chuỗi
    let ord = 0;
    found.forEach((v) => { v.order = ord++; });
    state.allRows = found;
    setBtn('⚡ Tải danh sách (' + found.size + ' chat)');
    logLine('⚡ Tải xong: ' + found.size + ' chat trong danh sách');
    computeMatches();
    render();
  }

  /* ============================ GỬI TIN (API → EXTENSION → GIAO DIỆN) ============================ */

  // Đọc conversation từ redux store của trang (KHÔNG gọi mạng) — có đủ last_customer_interactive_at, customers…
  function peekConv(conv) {
    try {
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const list = st && st.conversations && st.conversations.data;
      if (Array.isArray(list)) {
        const found = list.find((c) => c && c.id === conv.id);
        if (found) return found;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // Cờ is_record_ctx_7_days — đúng điều kiện hàm dr() trong _app (gửi ngoài cửa sổ 24h
  // cho khách từ quảng cáo trong 7 ngày, page phải bật platform_extra_info.ctx_7_days_enabled):
  //  1) khách ≥1 ngày không tương tác (hoặc không rõ thời điểm)
  //  2) page bật ctx_7_days_enabled
  //  3) khách có ad_clicks (click quảng cáo) mới nhất ≤7 ngày
  // KHÔNG ngoại lệ: thiếu dữ liệu ad_clicks → không bật cờ (không bịa thêm — app cũng vậy).
  // Chat ngoài 24h không thuộc cửa sổ quảng cáo sẽ được bù qua Socket (đường gửi tay).
  function isRecordCtx7Days(full) {
    try {
      if (!full) return false;
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      if (!st) return false;
      const idle = full.last_customer_interactive_at || full.lastAt || '';
      if (idle) {
        const t = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(idle) ? idle : idle + 'Z');
        if (!isNaN(t) && (Date.now() - t) < 86400000) return false; // mới tương tác <1 ngày
      }
      const pages = st.pages || {};
      const map = pages.activatedMap || {};
      const arr = pages.activated || [];
      const pid = full.page_id || full.pageId || String(full.id || '').split('_')[0];
      const p = map[pid] || arr.find((x) => x && x.id === pid);
      if (!p || !p.platform_extra_info || !p.platform_extra_info.ctx_7_days_enabled) return false;
      let clicks = null;
      const mc = st.messages && st.messages.customers;
      const custId = (full.customers && full.customers[0] && full.customers[0].id) || (full.from && full.from.id);
      const custFb = full.from && full.from.id;
      if (Array.isArray(mc)) {
        const c = mc.find((x) => x && (x.id === custId || x.id === custFb || x.fb_id === custFb));
        if (c && Array.isArray(c.ad_clicks)) clicks = c.ad_clicks;
      }
      if (!clicks && full.customers && full.customers[0] && Array.isArray(full.customers[0].ad_clicks)) {
        clicks = full.customers[0].ad_clicks;
      }
      if (!clicks || !clicks.length) {
        // THIẾU ad_clicks → KHÔNG bật cờ — đúng dr() của app và đúng luật "không bịa thêm":
        // app chỉ thêm is_record_ctx_7_days khi ĐÁNH GIÁ ĐƯỢC cửa sổ 7 ngày quảng cáo.
        // Chat ngoài 24h không có cờ → API có thể #551 → bù Socket (đường gửi tay) tự lo.
        // (Bản v1.39.0 từng "bật cờ phỏng đoán" — gán cờ bừa khi không có dữ liệu → bị loại.)
        return false;
      }
      let latest = 0;
      clicks.forEach((x) => {
        if (!x || !x.inserted_at) return;
        if (!['ads', null, undefined].includes(x.type)) return;
        const t = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(x.inserted_at) ? x.inserted_at : x.inserted_at + 'Z');
        if (!isNaN(t) && t > latest) latest = t;
      });
      return !!latest && (Date.now() - latest) <= 7 * 86400000;
    } catch (e) { return false; }
  }

  /* ============================ CHAT BÌNH LUẬN (type COMMENT) ============================
     Chat bình luận KHÔNG gửi được reply_inbox (Facebook trả "(#551) Người này hiện không có mặt").
     Đúng đường app dùng khi nhân viên bấm gửi trong chat bình luận (CommentSender trong _app):
       - executeByApi:  POST …/conversations/{id}/messages  (JSON)
                        { action:"reply_comment", message_id, parent_id, post_id, message, content_url? }
                        hoặc action:"reply_post" khi chat = chính bài viết của khách
       - executeByExtOnce: type "SEND_COMMENT" {pageId, fbPageId, postId, commentId, message, photoUrl?}
     "message_id/parent_id" = bình luận của khách mới nhất — đúng bộ lọc sendToInbox trong _app. */

  // Tên page + linked_fb_page (SEND_COMMENT cần currentPageName/linkedFbPage — lấy từ redux store trang)
  function pageMeta(pageId) {
    try {
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const pages = st && st.pages;
      const map = (pages && pages.activatedMap) || {};
      const arr = (pages && pages.activated) || [];
      const p = map[pageId] || arr.find((x) => x && x.id === pageId) || {};
      return {
        name: p.name || '',
        fbPageId: (p.platform_extra_info && p.platform_extra_info.linked_fb_page) || null,
      };
    } catch (e) { return { name: '', fbPageId: null }; }
  }

  // Lấy bình luận của khách để trả lời — đúng request + bộ lọc của app (sendToInbox):
  // GET …/conversations/{id}/messages?customer_id=…&user_view=true&is_new_api=true&separate_pos=true
  // lọc: tin của khách (from ≠ page), chưa xóa, không SYSTEM_MESSAGE → lấy mới nhất
  async function fetchCommentTarget(full, pageId, convId, ctx) {
    ctx = ctx || {};
    if (ctx.targetLoaded) return ctx.target || null;
    const token = getToken();
    if (!token) return null;
    const customerId = (full.from && full.from.id) || '';
    const url = apiBase() + '/v1/pages/' + pageId
      + '/conversations/' + encodeURIComponent(convId)
      + '/messages?customer_id=' + encodeURIComponent(customerId)
      + '&access_token=' + encodeURIComponent(token)
      + '&user_view=true&is_new_api=true&separate_pos=true';
    const res = await fetchJson(url, 2);
    if (!res.ok || !res.data) return null;
    const j = res.data;
    if (j.success === false) return null;
    const msgs = j.messages || (j.data && j.data.messages) || [];
    const target = msgs.slice().reverse().find((m) => m && m.from && m.from.id !== pageId
      && !m.is_removed && m.type !== 'SYSTEM_MESSAGE') || null;
    ctx.target = target;
    ctx.targetLoaded = true;
    return target;
  }

  // Body đúng CommentSender.executeByApi (user_selected_reply_to: app bỏ qua khi không chọn sẵn)
  function buildCommentBody(action, target, post, text, photo) {
    const body = { action };
    if (action === 'reply_comment') {
      body.message_id = target.id;
      body.parent_id = target.parent_id;
    }
    if (post && post.id) body.post_id = post.id;
    body.message = text == null ? '' : text;
    if (photo && photo.url) body.content_url = photo.url;
    return body;
  }

  async function sendCommentViaApi(conv, text, photo, ctx) {
    ctx = ctx || {};
    const token = getToken();
    if (!token) {
      return { ok: false, error: 'Không tìm thấy access_token — hãy tải lại trang Pancake rồi thử lại' };
    }
    const full = await ctxFull(conv, ctx) || {};
    const convId = full.id || conv.id;
    const pageId = full.page_id || conv.pageId || String(conv.id).split('_')[0];
    const post = full.post || (full.post_id ? { id: full.post_id } : null);
    // CommentSender constructor: chat = chính bài viết của khách → "reply_post", không thì "reply_comment"
    const action = (post && !post.admin_creator && post.from && String(post.id) === String(convId))
      ? 'reply_post' : 'reply_comment';
    let target = null;
    if (action === 'reply_comment') {
      target = await fetchCommentTarget(full, pageId, convId, ctx);
      if (!target) {
        return { ok: false, sent: false, error: 'Không tìm thấy bình luận của khách để trả lời' };
      }
    }
    const body = buildCommentBody(action, target || {}, post, text, photo);
    const url = apiBase() + '/v1/pages/' + pageId
      + '/conversations/' + encodeURIComponent(convId)
      + '/messages?access_token=' + encodeURIComponent(token);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      let data = {};
      let parsed = true;
      try { data = await res.json(); } catch (e) { parsed = false; }
      if (res.ok && data && data.success) {
        return { ok: true, id: data.id || data.message_id || '', sendBy: 'api', sent: true };
      }
      if (res.status === 401 || res.status === 403) {
        capturedToken = null;
        return { ok: false, sent: false, error: 'Token hết hạn/không hợp lệ (' + res.status + ') — tải lại trang rồi thử lại' };
      }
      if ((res.ok && (!parsed || !data || data.success === undefined)) || res.status >= 500) {
        return { ok: false, sent: 'maybe', error: 'API không trả kết quả rõ (' + res.status + ')' };
      }
      return {
        ok: false,
        sent: false,
        error: (data && (data.message || data.error)) || ('HTTP ' + res.status),
        code: data && data.message_code,
      };
    } catch (e) {
      return { ok: false, sent: 'maybe', error: 'Lỗi mạng: ' + (e && e.message || e) };
    }
  }

  // Fallback qua extension — đúng CommentSender.executeByExtOnce (type SEND_COMMENT)
  async function sendCommentViaExtension(conv, text, photo, ctx) {
    ctx = ctx || {};
    const adapter = window.__ExtensionAdapter__;
    if (!adapter || typeof adapter.send !== 'function') {
      return { ok: false, error: 'Không thấy Extension Pancake', skipExt: true };
    }
    try {
      if (typeof adapter.checkConnection === 'function' && !adapter.checkConnection({ silent: true })) {
        return { ok: false, error: 'Extension Pancake chưa kết nối', skipExt: true };
      }
    } catch (e) { /* cứ thử gửi */ }
    const token = getToken();
    if (!token) return { ok: false, error: 'Không tìm thấy access_token' };
    const full = await ctxFull(conv, ctx) || {};
    const convId = full.id || conv.id;
    const pageId = full.page_id || conv.pageId || String(conv.id).split('_')[0];
    const post = full.post || (full.post_id ? { id: full.post_id } : null);
    if (!post || !post.id) return { ok: false, sent: false, error: 'Chat không có post_id để trả lời bình luận' };
    const target = await fetchCommentTarget(full, pageId, convId, ctx);
    if (!target) return { ok: false, sent: false, error: 'Không tìm thấy bình luận của khách để trả lời' };
    const meta = pageMeta(pageId);
    const payload = {
      type: 'SEND_COMMENT',
      pageId,
      fbPageId: meta.fbPageId,
      // đúng cách app rút id dạng số từ post/bình luận (executeByExtOnce): last(part khi tách "_")
      postId: String(post.id).split('_').pop(),
      commentId: String(target.parent_id || target.id || '').split('_').pop(),
      stickerId: null,
      message: text,
      mentions: null,
      platform: 'facebook',
      currentPageName: meta.name,
      conversationId: convId,
      accessToken: token,
    };
    if (photo && photo.url) payload.photoUrl = photo.url;
    try {
      const res = await adapter.send(payload, { timeout: 35000 });
      if (res && res.success) {
        return { ok: true, id: (res.data && (res.data.timestamp || res.data.id)) || '', sendBy: 'extension', sent: true };
      }
      if (res && res.success === false) {
        return { ok: false, sent: false, error: 'Extension không gửi được' };
      }
      return { ok: false, sent: 'maybe', error: 'Extension không phản hồi' };
    } catch (e) {
      return { ok: false, sent: 'maybe', error: 'Extension lỗi: ' + (e && e.message || e) };
    }
  }

  // Dựng request gửi inbox ĐÚNG app (dùng chung cho sendViaApi và chế độ nhanh)
  // Đối chiếu 13 request gửi THẬT của app trong tinnhan.har (2026-10-17, 11/13 thành công):
  //   POST .../conversations/{id}/messages   (URL KHÔNG kèm access_token — auth bằng COOKIE jwt)
  //   body: action=reply_inbox → [is_record_ctx_7_days=true nếu dr()] → message → [ảnh] →
  //         send_by_platform=web
  // is_record_ctx_7_days = cờ "cửa sổ 7 ngày quảng cáo" — app thêm đúng khi dr() (xem
  // buildRequestBody trong _app: (0,ev.dr)()&&(j.is_record_ctx_7_days=!0)). THIẾU cờ này là #551
  // oan cho mọi chat ngoài cửa sổ 24h; có cờ thì chat ngoài 24h từ quảng cáo ≤7 ngày vẫn gửi được.
  function buildInboxSend(conv, text, photo) {
    const token = getToken();
    if (!token) return { error: 'Không tìm thấy access_token — hãy tải lại trang Pancake rồi thử lại' };
    const pageId = conv.pageId || conv.id.split('_')[0];
    const url = apiBase() + '/v1/pages/' + pageId
      + '/conversations/' + encodeURIComponent(conv.id)
      + '/messages';
    const fd = new FormData();
    fd.append('action', 'reply_inbox');
    // ĐÚNG buildRequestBody của app: dr() đúng (khách NGOÀI 24h từ quảng cáo ≤7 ngày, page bật
    // ctx_7_days_enabled) → thêm is_record_ctx_7_days=true — THIẾU field này là #551 oan cho
    // các chat ngoài cửa sổ 24h (đối chiếu 13 request gửi thật của app trong tinnhan.har
    // 2026-10-17: field này có ở TẤT CẢ, 11/13 thành công). dr() sai → KHÔNG thêm (như curl cũ).
    try {
      const full7 = peekConv(conv) || conv;
      if (isRecordCtx7Days(full7)) fd.append('is_record_ctx_7_days', 'true');
    } catch (e) { /* thiếu dữ liệu → gửi như request thường */ }
    fd.append('message', text);
    if (photo && photo.fbId) {
      // đúng field + đúng THỨ TỰ request thật của app khi gửi ảnh (đã so khớp curl):
      // content_id → attachment_id → content_url → width → height
      if (photo.id) fd.append('content_id', photo.id);
      fd.append('attachment_id', photo.fbId);
      fd.append('content_url', photo.url);
      if (photo.w) fd.append('width', String(photo.w));
      if (photo.h) fd.append('height', String(photo.h));
    }
    fd.append('send_by_platform', 'web'); // request thật của app luôn có (cả text lẫn ảnh)
    return { url: url, fd: fd };
  }

  // ⚡ CHẾ ĐỘ NHANH: bắn request API NGAY, KHÔNG chờ server trả lời — báo "đã gửi" tức thì.
  // Response xem TRONG NỀN: OK → im lặng; THUA RÕ (4xx/success=false) → bù Socket/Ext trong nền;
  // KHÔNG RÕ (5xx/lỗi mạng) → chỉ báo "không rõ" — KHÔNG gửi lại để tránh trùng tin.
  function fireApiAndWatch(conv, text, photo) {
    const req = buildInboxSend(conv, text, photo);
    if (req.error) return { ok: false, sent: false, error: req.error };
    if (state.stopRequested) return { ok: false, sent: false, error: 'Đã dừng' };
    fetch(req.url, {
      method: 'POST',
      body: req.fd,
      headers: { Accept: 'application/json' },
      credentials: 'include',
    }).then(async (res) => {
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (res.ok && data && data.success) { markDelivered(conv.id); return; } // đã đến nơi — im lặng
      const msg = (data && (data.message || data.error)) || ('HTTP ' + res.status);
      if (res.status === 401 || res.status === 403) capturedToken = null;
      const nm = conv.name || conv.id;
      const certainFail = (res.status >= 400 && res.status < 500) || (res.ok && data && data.success === false);
      if (certainFail) {
        if (isThreadControlError(msg) && !batchSkipApi) {
          batchSkipApi = true; // học nhanh: API đang bị chặn (#10/#551…) → chat còn lại trong lô đi thẳng Socket/Ext
          logLine('⛔ API bị chặn (' + msg + ') — các chat còn lại trong lô sẽ đi thẳng Socket/Ext');
        }
        // KHÔNG bù ngay chuỗi Socket/Ext: bằng chứng v1.37.0 — ngay sau bắn dồn FB đang giữ
        // nhịp, bù ngay là "server báo gửi thất bại" hàng loạt, vừa chậm vừa sinh thêm vòng
        // gửi đi gửi lại. Đúng luật "kênh chắc thua PHẢI bù": bù ĐÚNG 1 lần sau nhịp (12s).
        // BÁO RÕ KẾT QUẢ THẬT — không bao giờ "báo gửi" xong im lặng khi request đã bị từ chối.
        logLine('⚠ ' + nm + ' — API từ chối (' + msg + ') — sẽ tự bù 1 lần sau nhịp.');
        scheduleBuRetry(conv, text, photo, nm, 'API từ chối (' + msg + ')');
      } else {
        logLine('⚠ ' + nm + ' — không rõ kết quả (' + msg + ') — KHÔNG gửi lại để tránh trùng');
      }
    }).catch(() => {
      logLine('⚠ ' + (conv.name || conv.id) + ' — không rõ kết quả (lỗi mạng) — KHÔNG gửi lại để tránh trùng');
    });
    return { ok: true, id: '', sendBy: 'api', sent: true, fired: true };
  }

  // Đúng request mà _app-...js gửi khi nhắn tin thường (executeByApi + buildRequestBody):
  //   POST /api/v1/pages/{page_id}/conversations/{conversation.id}/messages?access_token=...
  //   multipart/form-data: action=reply_inbox, message=<text>
  // Nếu server từ chối dạng "(#10) ... ứng dụng khác đang kiểm soát thread" (Facebook handover)
  // thì app tự fallback sang extension — mình làm đúng như vậy ở sendSmart().
  async function sendViaApi(conv, text, photo, ctx) {
    if (conv.type === 'comment') return sendCommentViaApi(conv, text, photo, ctx || {}); // chat bình luận → reply_comment
    const req = buildInboxSend(conv, text, photo);
    if (req.error) return { ok: false, error: req.error };
    try {
      const res = await fetch(req.url, {
        method: 'POST',
        body: req.fd,
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      let data = {};
      let parsed = true;
      try { data = await res.json(); } catch (e) { parsed = false; }
      if (res.ok && data && data.success) {
        return { ok: true, id: data.id || data.message_id || '', sendBy: 'api', sent: true };
      }
      if (res.status === 401 || res.status === 403) {
        capturedToken = null; // token cũ — lần sau tự lấy token mới
        return { ok: false, sent: false, error: 'Token hết hạn/không hợp lệ (' + res.status + ') — tải lại trang rồi thử lại' };
      }
      // 200 nhưng không đọc được kết quả, hoặc lỗi 5xx → KHÔNG rõ tin đã đi hay chưa
      if ((res.ok && (!parsed || !data || data.success === undefined)) || res.status >= 500) {
        return { ok: false, sent: 'maybe', error: 'API không trả kết quả rõ (' + res.status + ')' };
      }
      // server trả lời rõ ràng là không gửi được → chắc chắn chưa gửi
      return {
        ok: false,
        sent: false,
        error: (data && (data.message || data.error)) || ('HTTP ' + res.status),
        code: data && data.message_code,
      };
    } catch (e) {
      // lỗi mạng: request có thể đã tới server → KHÔNG rõ — không được thử kênh khác
      return { ok: false, sent: 'maybe', error: 'Lỗi mạng: ' + (e && e.message || e) };
    }
  }

  // ---- Ghi nhớ kênh gửi tốt cho từng chat (sessionStorage) ----
  const CH_KEY = 'ssb_channel_hints';
  let channelHints = {};
  try { channelHints = JSON.parse(sessionStorage.getItem(CH_KEY) || '{}') || {}; } catch (e) { channelHints = {}; }
  function markChannel(convId, ch) {
    channelHints[convId] = ch;
    try { sessionStorage.setItem(CH_KEY, JSON.stringify(channelHints)); } catch (e) { /* ignore */ }
  }
  let batchSkipApi = false; // API đã bị "(#10)" trong loạt gửi này → khỏi thử lại cho các chat sau

  function isThreadControlError(msg) {
    const m = String(msg || '');
    // CHẶN CẢ LÔ chỉ khi là chặn cấp page/hệ thống (rate limit, FB handover, thread control).
    // (#551 "Người này hiện không có mặt" là chặn của TỪNG NGƯỜI — chat khác vẫn gửi API bình thường;
    // trước đây 1 con #551 làm cả lô bị tước API → nhiều chat trong cửa sổ 24h mất oan.)
    return /\(#(10|613|80006)(?:,\d+)?\)/.test(m)
      || m.indexOf('kiểm soát thread') > -1
      || m.toLowerCase().indexOf('rate limit') > -1;
  }

  // Lấy conversation đầy đủ (thread_id, thread_key, from, updated_at…):
  // ưu tiên redux store của trang, sau đó GET /conversations/{id}
  async function getFullConversation(conv) {
    try {
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const list = st && st.conversations && st.conversations.data;
      if (Array.isArray(list)) {
        const found = list.find((c) => c && c.id === conv.id);
        if (found) return found;
      }
    } catch (e) { /* ignore */ }
    try {
      const token = getToken();
      if (!token) return null;
      const res = await fetch(apiBase() + '/v1/pages/' + (conv.pageId || conv.id.split('_')[0])
        + '/conversations/' + encodeURIComponent(conv.id)
        + '?access_token=' + encodeURIComponent(token),
        { headers: { Accept: 'application/json' }, credentials: 'include' });
      const j = await res.json().catch(() => null);
      if (j && res.ok) return j.conversation || (j.data && j.data.conversation) || (j.id ? j : (j.data && j.data.id ? j.data : null));
    } catch (e) { /* ignore */ }
    return null;
  }

  // Lấy conversation 1 lần cho MỌI kênh trong cùng lượt gửi (ctx dùng chung) — đỡ gọi lại nhiều lần
  async function ctxFull(conv, ctx) {
    if (!ctx.fullLoaded) {
      // dòng conv đã đủ dữ liệu (threadId + pageId + threadKey + updatedAt — đủ cho payload Ext)
      // → dùng thẳng, khỏi GET conversation; thiếu thì nạp đầy đủ (redux có sẵn là xong ngay)
      ctx.full = (conv.threadId && (conv.pageId || conv.id) && conv.threadKey && conv.updatedAt)
        ? conv : await getFullConversation(conv);
      ctx.fullLoaded = true;
    }
    return ctx.full || null;
  }

  function detectPlatform(pageId) {
    try {
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const pages = st && st.pages;
      if (!pages) return 'facebook';
      const map = pages.activatedMap || {};
      const arr = pages.activated || [];
      const p = map[pageId] || arr.find((x) => x && x.id === pageId);
      return (p && p.platform) || 'facebook';
    } catch (e) {
      return 'facebook';
    }
  }

  // Kết quả ĐẦU TIÊN khác null trong nhiều promise — giống helper oV trong _app
  function firstNonNull(promises) {
    return new Promise((resolve) => {
      let left = promises.length;
      let done = false;
      if (!left) { resolve(null); return; }
      promises.forEach((pr) => {
        Promise.resolve(pr).then((v) => {
          if (!done && v) { done = true; resolve(v); return; }
          if (!done && --left === 0) resolve(null);
        }, () => {
          if (!done && --left === 0) resolve(null);
        });
      });
    });
  }

  // PSID dự phòng: API đã trả sẵn from_psid (và from.id — cùng giá trị trong dữ liệu Pancake,
  // đúng psid mà read_watermarks dùng) — dùng khi WS/Ext không tìm ra, đỡ gửi hỏng oan.
  function psidFromFull(full, pageId) {
    try {
      if (!full) return null;
      const ok = (v) => {
        const p = String(v || '');
        return /^\d{5,}$/.test(p) && p !== String(pageId) ? p : null;
      };
      // KHÔNG nhận from.id: đó có thể là FBID chứ không phải PSID — gửi nhầm thì Socket/Ext đều bị từ chối
      return ok(full.from_psid) || ok(full.fromPsid);
    } catch (e) { return null; }
  }

  // Tìm globalId (PSID) của khách — CHẠY ĐUA đúng như concurrentlyGetGLobalId trong _app:
  // cache → song song [Extension GET_GLOBAL_ID_FOR_CONV, WebSocket __MqttHelper__.findGlobalId]
  // → ai trả kết quả trước thì dùng (WS thường có cache IndexedDB → trả gần như ngay)
  async function resolveGlobalId(full, threadId, cacheKey, convFromPsid, forceFind, ctx) {
    const key = (full && full.id) || cacheKey;
    const pageId = (full && full.page_id) || (full && full.pageId) || String(cacheKey || '').split('_')[0];
    if (!forceFind) {
      try {
        const g1 = window.__GlobalIdCacheTest__, g2 = window.__tempGlobalIdCache__;
        const cached = (g1 && g1.get(key)) || (g2 && g2.get(key));
        if (cached) return cached;
      } catch (e) { /* ignore */ }
    }
    // PSID đã có sẵn trong dữ liệu conv → dùng NGAY và KHÔNG ĐỤNG mạng. Chỉ dò tìm khi dòng conv
    // THIẾU PSID hoặc khi kênh gửi vừa từ chối PSID này (forceFind → dò lại chính chủ qua WS/Ext).
    const known = forceFind ? null
      : (psidFromFull(full, pageId) || psidFromFull({ from_psid: convFromPsid || '' }, pageId));
    if (known) {
      try { window.__tempGlobalIdCache__ && window.__tempGlobalIdCache__.set(key, known); } catch (e) { /* ignore */ }
      // id này là DOÁN từ from_psid — với một số khách globalId thật là FBID chứ không phải PSID
      // (bằng chứng event update_global_id trong tinnhan.har) → đánh dấu để sai là dò lại ngay
      if (ctx) ctx.gidFromPsid = true;
      return known;
    }
    if (ctx) ctx.gidFromPsid = false;
    // thiếu PSID → mới chạy đua dò tìm (đúng như concurrentlyGetGLobalId trong _app):
    // Ext findGlobalIdForConv và __MqttHelper__.findGlobalId chạy song song, ai ra trước dùng trước
    const tasks = [];
    if (typeof window.findGlobalIdForConv === 'function' && threadId) {
      tasks.push(window.findGlobalIdForConv({
        pageId: pageId, threadId: threadId, threadKey: (full && (full.thread_key || full.threadKey)) || '',
        isBusiness: true,
        conversationUpdatedTime: Date.parse(String((full && (full.updated_at || full.updatedAt)) || '') + 'Z'),
        customerName: (full && full.from && (full.from.username || full.from.name)) || (full && full.customerName) || '',
        convType: 'INBOX', postId: null, convId: null,
      }).catch(() => null));
    }
    const mqtt = window.__MqttHelper__;
    if (mqtt && typeof mqtt.findGlobalId === 'function' && pageId && threadId) {
      tasks.push(Promise.resolve()
        .then(() => mqtt.findGlobalId(pageId, threadId))
        .then((r) => (r && r.success && r.data) || null)
        .catch(() => null));
    }
    const gid = await firstNonNull(tasks);
    if (gid) {
      try { window.__tempGlobalIdCache__ && window.__tempGlobalIdCache__.set(key, gid); } catch (e) { /* ignore */ }
    }
    return gid || null;
  }

  // Gửi qua Facebook WebSocket — ĐÚNG đường "gửi bình thường" mà app/nhân viên vẫn dùng
  // (_app: executeBySocketFB → __MqttHelper__.sendMessage(pageId, globalId, {text}) → publish /ls_req)
  // id kiểu app (epoch_id/otid trong khung /ls_req): Date.now() ghép 22-bit ngẫu nhiên → thập phân.
  // Bắt chước đúng hàm sinh id của app (module 231748) — dùng BigInt cho gọn, có dự phòng nếu thiếu.
  function epochId() {
    try {
      const bin = Date.now().toString(2)
        + ('0000000000000000000000' + Math.floor(4294967295 * Math.random()).toString(2)).slice(-22);
      return BigInt('0b' + bin).toString();
    } catch (e) {
      return String(Date.now()) + String(Math.floor(Math.random() * 1e6));
    }
  }

  // Gửi TRỰC TIẾP khung /ls_req của app (label "46" gửi text + label "21" watermark) qua
  // helper.publish — BỎ BƯỚC CHỜ 1S bên trong helper.sendMessage. Vẫn chờ ACK của server
  // để phân loại chắc/thiếu y như đường gốc. Trả về: ok | rejected | noack | dead | legacy.
  async function socketPublishSend(helper, pageId, gid, text) {
    let sock = helper.SOCKETS && helper.SOCKETS[pageId];
    // LUÔN chờ lệnh làm nóng dở (kể cả khi sock.instance đã có): initSocket đang dựng lại kết nối
    // mà bắn vào lúc đó là server "báo gửi thất bại" oan — đúng lúc này hay xảy ra ngay sau bắn dồn.
    const warm = socketWarmPromises[pageId];
    if (warm) {
      await Promise.race([warm, sleep(15000)]);
      sock = helper.SOCKETS && helper.SOCKETS[pageId];
    }
    if ((!sock || !sock.instance) && typeof helper.initSocket === 'function') {
      // chờ xong vẫn thiếu → socket cũ đã chết → khởi động lại hẳn rồi mới bắn (initSocket tự
      // tái dùng khi kết nối còn đang chạy — đúng guard isRunning() của app)
      try { await Promise.race([Promise.resolve().then(() => helper.initSocket(pageId)), sleep(15000)]); }
      catch (e) { /* ignore */ }
      sock = helper.SOCKETS && helper.SOCKETS[pageId];
    }
    if (!sock || !sock.instance) return { kind: 'dead' };
    if (typeof helper.publish !== 'function' || typeof helper.findAllBlockActions !== 'function') {
      return { kind: 'legacy' }; // helper cũ — quay về sendMessage đầy đủ
    }
    sock.taskId = sock.taskId || 0;
    const frame = {
      epoch_id: epochId(),
      version_id: '9942677559150662',
      tasks: [
        {
          failure_count: null,
          label: '46',
          payload: JSON.stringify({
            mark_thread_read: 1, otid: epochId(), send_type: 1, source: 4456448,
            sync_group: 205, text: text, thread_id: gid,
          }),
          queue_name: gid,
          task_id: ++sock.taskId,
        },
        {
          failure_count: null,
          label: '21',
          payload: JSON.stringify({ last_read_watermark_ts: Date.now(), sync_group: 205, thread_id: gid }),
          queue_name: gid,
          task_id: ++sock.taskId,
        },
      ],
    };
    const g = await helper.publish(pageId, '/ls_req', frame, 3);
    if (!(g && g.payload)) return { kind: 'noack' };
    let resp = null;
    try { resp = JSON.parse(g.payload); } catch (e) { return { kind: 'noack' }; }
    // đúng luật app: chỉ khi server markOptimisticMessageFailed MÀ không có replaceOptimsiticMessage
    // thì mới là thất bại thật; còn lại (kể cả không có block action nào) = đã nhận
    const replaced = helper.findAllBlockActions(resp.step, 'replaceOptimsiticMessage') || [];
    const failed = helper.findAllBlockActions(resp.step, 'markOptimisticMessageFailed') || [];
    if (failed.length && !replaced.length) return { kind: 'rejected' };
    return { kind: 'ok' };
  }

  async function sendViaSocket(conv, text, ctx) {
    ctx = ctx || {};
    const helper = window.__MqttHelper__;
    if (!helper || (typeof helper.sendMessage !== 'function' && typeof helper.publish !== 'function')) {
      return { ok: false, error: 'Không thấy __MqttHelper__' };
    }
    const platform = detectPlatform(conv.pageId || conv.id.split('_')[0]);
    if (platform !== 'facebook') return { ok: false, error: 'Socket chỉ áp dụng cho Facebook' };
    const full = await ctxFull(conv, ctx);
    if (!full) return { ok: false, error: 'Không lấy được thông tin đoạn chat' };
    const pageId = full.page_id || conv.pageId;
    if (!ctx.threadResolved) {
      let threadId = full.thread_id || full.threadId; // dòng list để threadId (camel) — tránh lệch field
      if (!threadId && typeof window.__syncMissingThreadId__ === 'function') {
        try { threadId = await window.__syncMissingThreadId__(pageId, full.id || conv.id); } catch (e) { /* ignore */ }
      }
      ctx.threadId = threadId || null;
      ctx.threadResolved = true;
    }
    const threadId = ctx.threadId;
    if (!ctx.gidResolved) {
      ctx.gid = await resolveGlobalId(full, threadId, conv.id, conv.fromPsid, ctx.gidForceFind, ctx);
      ctx.gidResolved = true;
    }
    const gid = ctx.gid;
    if (!gid) return { ok: false, error: 'Không tìm thấy globalId' };
    try {
      const raw = await socketPublishSend(helper, pageId, gid, text);
      if (raw.kind === 'ok') return { ok: true, id: gid, sendBy: 'socket', sent: true };
      if (raw.kind === 'dead') return { ok: false, sent: false, error: 'Socket không kết nối' };
      if (raw.kind === 'rejected') return { ok: false, sent: false, error: 'Socket: server báo gửi thất bại' };
      if (raw.kind === 'noack') {
        // không có ACK: socket đã chết → frame chưa đi → chắc thua; socket sống → tin CÓ THỂ đã đi
        const sock = helper.SOCKETS && helper.SOCKETS[pageId];
        if (!(sock && sock.instance)) return { ok: false, sent: false, error: 'Socket không kết nối' };
        return { ok: false, sent: 'maybe', error: 'Socket không rõ kết quả (không có ACK)' };
      }
      // legacy — helper không có publish: đường sendMessage cũ (kèm bước chờ 1s của app)
      const res = await helper.sendMessage(pageId, gid, { text });
      if (res && res.success) return { ok: true, id: gid, sendBy: 'socket', sent: true };
      const reason = String((res && res.reason) || '');
      if (/no_socket_found|getGlobalIdFailed|markOptimisticMessageFailed/i.test(reason)) {
        return { ok: false, sent: false, error: 'Socket không gửi được (' + reason + ')' };
      }
      if (res && res.response) {
        return { ok: false, sent: false, error: 'Socket: server báo gửi thất bại' };
      }
      const sock = helper.SOCKETS && helper.SOCKETS[pageId];
      if (!(sock && sock.instance)) {
        return { ok: false, sent: false, error: 'Socket không kết nối' };
      }
      return { ok: false, sent: 'maybe', error: 'Socket không rõ kết quả' + (reason ? ' (' + reason + ')' : '') };
    } catch (e) {
      return { ok: false, sent: 'maybe', error: 'Socket lỗi: ' + (e && e.message || e) };
    }
  }

  // Gửi qua extension Pancake (đường app dùng khi API bị "(#10)" — executeByExtOnce, type REPLY_INBOX_PHOTO)
  async function sendViaExtension(conv, text, photo, ctx) {
    ctx = ctx || {};
    if (conv.type === 'comment') return sendCommentViaExtension(conv, text, photo, ctx); // chat bình luận → SEND_COMMENT
    const adapter = window.__ExtensionAdapter__;
    if (!adapter || typeof adapter.send !== 'function') {
      return { ok: false, error: 'Không thấy Extension Pancake', skipExt: true };
    }
    try {
      if (typeof adapter.checkConnection === 'function' && !adapter.checkConnection({ silent: true })) {
        return { ok: false, error: 'Extension Pancake chưa kết nối', skipExt: true };
      }
    } catch (e) { /* cứ thử gửi */ }

    const platform = detectPlatform(conv.pageId || conv.id.split('_')[0]);
    if (platform !== 'facebook') {
      return { ok: false, error: 'Extension chỉ áp dụng cho Facebook ở chế độ này', skipExt: true };
    }
    const full = await ctxFull(conv, ctx);
    if (!full) return { ok: false, error: 'Không lấy được thông tin đoạn chat' };

    // ảnh: upload attachment MỚI reusable=false (đúng executeByExtOnce) — KHÔNG dùng lại
    // attachment reusable=true (FB web từ chối). Upload chạy SONG SONG bước tìm thread/globalId.
    const photoPrep = photo
      ? uploadPhotoForPage(full.page_id || conv.pageId || String(conv.id).split('_')[0], photo, { reusable: false })
      : null;

    if (!ctx.threadResolved) {
      let threadId = full.thread_id || full.threadId; // dòng list để threadId (camel) — tránh lệch field
      if (!threadId && typeof window.__syncMissingThreadId__ === 'function') {
        try {
          threadId = await window.__syncMissingThreadId__(full.page_id || conv.pageId, full.id || conv.id);
        } catch (e) { /* ignore */ }
      }
      ctx.threadId = threadId || null;
      ctx.threadResolved = true;
    }
    const threadId = ctx.threadId;
    if (!threadId) return { ok: false, error: 'Không tìm thấy thread_id' };

    if (!ctx.gidResolved) {
      ctx.gid = await resolveGlobalId(full, threadId, conv.id, conv.fromPsid, ctx.gidForceFind, ctx);
      ctx.gidResolved = true;
    }
    const globalUserId = ctx.gid || null;
    if (!globalUserId) {
      // chắc chắn chưa gửi gì — bỏ Ext (gửi với PSID rỗng cũng thất bại), để kênh sau/API cuối thử
      return { ok: false, sent: false, error: 'Không có globalId — bỏ qua Ext' };
    }

    const token = getToken();
    let files;
    if (photo) {
      const up = await photoPrep;
      if (!up.ok) return { ok: false, sent: false, error: 'Không gắn được ảnh cho Extension (' + up.error + ')' };
      files = [up.fbId];
    }
    const payload = {
      pageId: full.page_id || conv.pageId,
      igPageId: null,
      accessToken: token,
      tryResizeImage: true,
      contentIds: photo && photo.id ? [photo.id] : [],
      type: 'REPLY_INBOX_PHOTO',
      message: text,
      attachmentType: photo ? 'PHOTO' : 'SEND_TEXT_ONLY',
      globalUserId,
      platform: 'facebook',
      replyMessage: null,
      threadId,
      convId: full.thread_key || full.threadKey || conv.threadKey || (threadId ? 't_' + threadId : null), // thread_key = 't_' + thread_id
      customerName: (full.from && (full.from.username || full.from.name)) || full.customerName || conv.customerName || '',
      isIGD: false,
      conversationUpdatedTime: (function () {
        const t = Date.parse(String(full.updated_at || full.updatedAt || conv.updatedAt || '') + 'Z');
        return isNaN(t) ? Date.now() : t; // thiếu mốc → dùng giờ — không gửi NaN cho extension
      })(),
      photoUrls: photo ? [photo.url] : [],
      isBusiness: false,
    };
    // đúng shape app: chỉ có files/photoUrl khi gửi ảnh (text-only: app để undefined → bỏ key)
    if (files) payload.files = files;
    if (photo) payload.photoUrl = photo.url;
    try {
      const res = await adapter.send(payload, { timeout: 35000 });
      if (res && res.success) {
        // HỌC THEO app (onSuccess → update_global_id): globalUserId extension trả về có thể ĐÚNG
        // hơn giá trị mình đoán (có khách globalId là FBID 1000… chứ không phải PSID) — cache lại
        // theo conv id để các lần gửi sau (socket/ext) dùng đúng id, không bị "server báo gửi thất bại"
        const gidBack = res.data && res.data.globalUserId;
        if (gidBack && typeof gidBack === 'string') {
          try {
            window.__tempGlobalIdCache__ && window.__tempGlobalIdCache__.set(conv.id, gidBack);
            if (ctx) { ctx.gid = gidBack; ctx.gidResolved = true; ctx.gidFromPsid = false; }
          } catch (e) { /* ignore */ }
        }
        return { ok: true, id: (res.data && (res.data.timestamp || res.data.convId)) || '', sendBy: 'extension', sent: true };
      }
      if (res && res.success === false) {
        // giữ nguyên lý do extension trả về (nếu có) để log lộ đúng nguyên nhân thua
        const d = res.data || {};
        let why = d.errorMessage || d.error || d.reason || d.code || '';
        if (why && typeof why !== 'string') {
          try { why = JSON.stringify(why); } catch (e2) { why = ''; } // không bao giờ lộ "[object Object]"
        }
        return { ok: false, sent: false, error: 'Extension không gửi được' + (why ? ' (' + why + ')' : '') }; // extension trả lời rõ: chưa gửi
      }
      // không có phản hồi (timeout/hủy) → extension có thể đã gửi → KHÔNG rõ
      return { ok: false, sent: 'maybe', error: 'Extension không phản hồi' };
    } catch (e) {
      return { ok: false, sent: 'maybe', error: 'Extension lỗi: ' + (e && e.message || e) };
    }
  }

  /* ============================ ẢNH KÈM THEO ============================ */
  // Đúng chuỗi app dùng khi gửi ảnh (đã xác minh từ bundle):
  //  1) POST /v1/contents?access_token=… (field "file")            → { content_url }  (như app upload avatar)
  //  2) POST /v1/pages/{p}/contents/facebook?is_reusable=true&async=false
  //       body urls=["content_url"]                                → { fb_ids }       (attachment Facebook)
  //  3) Gửi: API (attachment_id + content_url) hoặc Extension
  //       (REPLY_INBOX_PHOTO, attachmentType:"PHOTO", files:[fbId], photoUrl(s))

  async function uploadContentFile(file) {
    const token = getToken();
    if (!token) return { ok: false, error: 'Không có access token' };
    try {
      const fd = new FormData();
      fd.append('file', file, file.name || 'image.jpg');
      fd.append('name', file.name || ('image_' + Date.now() + '.jpg'));
      const res = await fetch(apiBase() + '/v1/contents?access_token=' + encodeURIComponent(token), {
        method: 'POST', body: fd, credentials: 'include', headers: { Accept: 'application/json' },
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.success && (j.content_url || j.url)) {
        return { ok: true, url: j.content_url || j.url, id: j.content_id || j.id || '' };
      }
      return { ok: false, error: (j && (j.message || j.error)) || ('HTTP ' + res.status) };
    } catch (e) {
      return { ok: false, error: 'Lỗi mạng: ' + (e && e.message || e) };
    }
  }

  // Đúng hàm N (upload gắn attachment) trong _app:
  //   POST /v1/pages/{p}/contents/facebook?access_token=…&is_reusable={reusable}&async=false
  //   body: content_ids=[contentId] (hoặc urls), thêm conv_id khi có
  //   → { fb_ids }  — app: đường API dùng reusable=true, đường Extension dùng reusable=false (mới 100%)
  async function uploadPhotoForPage(pageId, photo, opts) {
    const o = opts || {};
    const reusable = o.reusable !== false;
    const token = getToken();
    if (!token) return { ok: false, error: 'Không có access token' };
    try {
      // body JSON đúng request thật của app: {"content_ids":"[\"id\"]","conv_id":"..."}
      const body = {};
      if (photo.id) body.content_ids = JSON.stringify([photo.id]);
      else body.urls = JSON.stringify([photo.url]);
      if (o.convId) body.conv_id = String(o.convId);
      const res = await fetch(apiBase() + '/v1/pages/' + pageId
        + '/contents/facebook?access_token=' + encodeURIComponent(token)
        + '&is_reusable=' + (reusable ? 'true' : 'false') + '&async=false', {
        method: 'POST', body: JSON.stringify(body), credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.success && Array.isArray(j.fb_ids) && j.fb_ids.length) {
        return { ok: true, fbId: j.fb_ids[0] };
      }
      return { ok: false, error: (j && (j.message || j.error)) || ('HTTP ' + res.status) };
    } catch (e) {
      return { ok: false, error: 'Lỗi mạng: ' + (e && e.message || e) };
    }
  }

  // ===== HÀNG ĐỢI SOCKET/EXT — MỖI LẦN ĐÚNG 1 LỆNH =====
  // Gửi lô mà bắn Socket/Extension ĐỒNG LOẠT thì hỏng hàng loạt (Extension trả "không gửi được",
  // socket bị server "báo gửi thất bại") — đúng như thực tế: chọn riêng 1 con thì chạy, chọn cả lô thì lỗi.
  // Ghép từng bước Socket/Ext vào 1 hàng đợi: bước xong mới tới bước kế (kể cả của chat khác) —
  // giống hệt kịch bản "gửi riêng từng con" vốn chạy ngon. API vẫn bắn SONG SONG full speed.
  let busTail = Promise.resolve();
  function busEnqueue(fn) {
    const run = busTail.then(function () {
      if (state.stopRequested) return { ok: false, sent: false, error: 'Đã dừng' };
      return Promise.resolve().then(fn).catch((e) => ({
        ok: false, sent: false, error: 'Lỗi kênh: ' + (e && e.message || e),
      }));
    });
    busTail = run.then(function () {}, function () {});
    return run;
  }

  // API (nhanh) → Socket (đường gửi tay) → Extension
  // CHỈ gửi hàng loạt — KHÔNG còn cơ chế gửi từng con qua giao diện.
  // Chống TRÙNG TIN: kênh nào báo "không rõ kết quả" (tin có thể đã đi) → DỪNG ngay,
  // không thử kênh khác, không gửi thêm. Lỗi là lỗi — báo trong log, không gửi lại, không kiểm tra lại.
  async function sendOne(conv, text, photo, opts) {
    opts = opts || {};
    // ⚡ CHẾ ĐỘ NHANH: chat thường → bắn API không chờ. Nhưng nếu ĐOÁN TRƯỚC API chắc thua
    // (đúng luật app SEND_MESSAGE_API_TIME_WINDOW=86400 — text + ngoài cửa sổ 24h + !dr() → API "(#551)"),
    // hoặc lô này API đang bị chặn, hoặc chat đã biết kênh tốt → đi thẳng Socket/Ext, khỏi bắn API uổng.
    if (opts.quick && !opts.skipApi && conv.type !== 'comment') {
      const full = peekConv(conv) || conv;
      const rawIdle = (full && full.last_customer_interactive_at) || conv.lastAt || '';
      // thiếu/không parse được mốc → ĐỂ API thử trước: sai dữ liệu (list cũ, mốc stale)
      // không được phép làm chat trong cửa sổ 24h bị bỏ qua API mà gửi tay vẫn chạy
      let idleLong = false;
      if (rawIdle) {
        const t = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(rawIdle) ? rawIdle : rawIdle + 'Z');
        if (!isNaN(t)) idleLong = (Date.now() - t) > 86400000;
      }
      const hint = channelHints[conv.id];
      // TEXT: LUÔN API-trước (request cookie-auth = y hệt gửi tay, HAR 200 chứng minh) —
      // hint/dự đoán KHÔNG được ép text vào vòng Socket/Ext (chậm, hàng đợi Extension xếp hàng,
      // mà gửi tay vẫn chạy được bằng chính API này).
      // ẢNH: giữ hint/dự đoán đi thẳng Ext (chưa có bằng chứng ảnh cũng qua được API).
      const goDirect = batchSkipApi
        || (photo && hint && hint !== 'api')
        || (idleLong && photo && !isRecordCtx7Days(full));
      if (goDirect) {
        const directOpts = batchSkipApi ? { skipApi: true } : { directChain: true };
        sendOne(conv, text, photo, directOpts).then((r) => {
          if (r.ok) { markDelivered(conv.id); return; } // gửi được — im lặng (đã báo "đã gửi" trước đó)
          const nm2 = conv.name || conv.id;
          if (r.uncertain) logLine('⚠ ' + nm2 + ' — ' + r.error + ' (không rõ — không gửi thêm)');
          else logLine('❌ ' + nm2 + ' — ' + r.error);
          if (!r.ok && !r.uncertain && isRetryableLoss(r.error)) {
            scheduleBuRetry(conv, text, photo, nm2, 'gửi thẳng chưa được');
          }
        });
        return { ok: true, id: '', sendBy: 'direct', sent: true, fired: true };
      }
      return fireApiAndWatch(conv, text, photo);
    }
    // ngữ cảnh dùng chung cho các kênh của CÙNG 1 chat: conversation, threadId, globalId, bình luận…
    // mỗi thứ chỉ tải/giải quyết 1 lần (trước đây mỗi kênh tự gọi lại → chậm)
    const ctx = {};
    const channels = {
      api: async () => {
        const r = await sendViaApi(conv, text, photo, ctx);
        if (!r.ok && r.sent !== 'maybe' && isThreadControlError(r.error)) batchSkipApi = true;
        return r;
      },
      socket: () => sendViaSocket(conv, text, ctx),
      ext: () => sendViaExtension(conv, text, photo, ctx),
    };
    // ảnh: socket không hỗ trợ → api → ext
    const order = photo ? ['api', 'ext']
      : (conv.type === 'comment' ? ['api', 'ext'] : ['api', 'socket', 'ext']); // bình luận: không có thread messenger
    const hint = channelHints[conv.id];
    let seq = (hint && order.indexOf(hint) > -1)
      ? [hint].concat(order.filter((x) => x !== hint))
      : order.slice();
    if (batchSkipApi) seq = seq.filter((x) => x !== 'api');
    if (opts.skipApi) seq = seq.filter((x) => x !== 'api'); // bước bù nền: api đã thử rồi
    if (opts.directChain) {
      // đường gửi thẳng: Socket/Ext trước — API là CỨU CÁCH CUỐI, chỉ được thử khi các kênh
      // trước đều THUA RÕ (loop chỉ đi tiếp khi chắc chắn chưa gửi → không lo trùng tin)
      seq = seq.filter((x) => x !== 'api');
      seq.push('api');
    }

    const tried = [];
    for (let i = 0; i < seq.length; i++) {
      const ch = seq[i];
      if (state.stopRequested) break;
      // API: bắn song song như thường (fetch thuần — không đụng Extension/Socket).
      // Socket/Ext: đi qua hàng đợi — mỗi lần đúng 1 lệnh, không bắn dồn.
      const r = (ch === 'api') ? await channels[ch]() : await busEnqueue(() => channels[ch]());
      if (r.ok) {
        markChannel(conv.id, ch);
        return { ok: true, id: r.id || '', sendBy: r.sendBy || ch, sent: true };
      }
      tried.push((ch === 'ext' ? 'Ext' : ch) + ': ' + (r.error || 'fail'));
      // "không rõ" = tin CÓ THỂ đã đi — thử tiếp kênh khác sẽ gửi TRÙNG → dừng ngay
      if (r.sent === 'maybe') {
        return { ok: false, uncertain: true, sent: 'maybe', error: tried.join(' | ') };
      }
      // CHỈ dò lại PSID khi lỗi đúng nghĩa "không có/không đúng người nhận" (globalId/thread_id).
      // 'server báo gửi thất bại'/'không gửi được' là TỪ CHỐI CỦA KÊNH (cửa sổ/…) — dò PSID chỉ
      // tốn thêm RPC Extension chậm mà không cứu được — trước đây từng làm bước bù chậm như rùa.
      // (v1.38.0 từng nới điều kiện này cho "server báo gửi thất bại" — nhưng gid đoán from_psid
      //  là đa số → MỌI chat bù đều dò lại globalId hàng chục giây → lô gửi chậm như rùa. Đã bỏ.)
      if (conv.fromPsid && /globalId|thread_id/i.test(r.error || '')) {
        ctx.gidForceFind = true;
        ctx.gidResolved = false;
      }
      if (r.error && r.error.indexOf('Token') === 0) return r; // token hỏng — dừng hẳn
    }
    return { ok: false, sent: false, error: tried.join(' | ') };
  }

  // Làm nóng Socket TRƯỚC khi gửi: lần dùng Socket đầu tiên trong phiên (nhất là ngay sau F5)
  // phải trả phí kết nối + đồng bộ thread map ~10s (initSocket). Làm nóng ngay lúc bắn lô —
  // chạy song song các bắn API — nên khi nào cần bù Socket thì chỉ còn ~1–2s của sendMessage.
  const socketWarmPromises = {}; // pageId → Promise kết nối socket (đang chạy dở)

  function warmUpSockets(targets) {
    try {
      const h = window.__MqttHelper__;
      if (!h || typeof h.initSocket !== 'function') return;
      const seen = {};
      (targets || []).forEach((c) => {
        const pid = c.pageId || String(c.id || '').split('_')[0];
        if (!pid || seen[pid]) return;
        seen[pid] = true;
        // KHÔNG dựa vào sock.instance để bỏ qua: socket chết mà instance vẫn còn thì bắn là thua.
        // initSocket của app TỰ trả về ngay khi kết nối còn đang chạy (guard isRunning()) — gọi là đủ.
        if (socketWarmPromises[pid]) return; // đang kết nối dở — khỏi làm trùng
        socketWarmPromises[pid] = Promise.resolve()
          .then(() => h.initSocket(pid))
          .catch(() => null); /* nóng socket là việc phụ — không được làm hỏng lô gửi */
      });
    } catch (e) { /* ignore */ }
  }

  /* ===== BÙ VÒNG 2 — chống mất tin khi server nghẽn ngay sau khi bắn dồn =====
     Bằng chứng từ log: bắn lô dồn (8–21 API thành công trong 1 giây) rồi bù socket NGAY là
     server "báo gửi thất bại" hàng loạt (FB đang giữ nhịp gửi của tài khoản) — CÙNG chat đó
     bù lại sau ~10–13 giây là THẮNG ngay với đúng frame đó. Nên khi kênh THỪA NHẬN thua
     (chắc chắn tin CHƯA đến nơi) thì bù vòng 2 sau nhịp — đúng luật "kênh chắc thua PHẢI bù
     tiếp, không im lặng bỏ sót". Mỗi chat tối đa 1 lần; 'maybe'/không rõ → TUYỆT ĐỐI không
     (chống trùng tin). */
  const BU_RETRY_MS = 12000;
  const BU_SPREAD_MS = 1200; // rải nhịp giữa các lần bù — FB giữ nhịp nếu bắn dồn 8–21/s (bằng chứng v1.37.0)
  const buRetryDone = {}; // convId → đã bù trong lượt này
  let buRetrySeq = 0;
  let runSeq = 0; // mỗi lượt gửi 1 số — bù của lượt cũ tự hủy khi có lượt mới (chống gửi lẫn/lặp)
  const deliveredIds = {}; // convId → ĐÃ có kênh báo thành công trong lượt này — tuyệt đối không gửi lại

  function markDelivered(convId) { deliveredIds[convId] = true; }

  function isRetryableLoss(err) {
    // CHỈ các lỗi kênh xác nhận "chưa gửi" — không đụng 'không rõ/maybe', token, dữ liệu thiếu
    return /server báo gửi thất bại|Extension không gửi được|Socket không kết nối|Không thấy Extension|Extension Pancake chưa kết nối/.test(String(err || ''));
  }

  // BÙ ĐÚNG 1 LẦN, 1 KÊNH (text → Socket, ảnh/bình luận → Ext), sau nhịp ~12s, rải đều.
  // KHÔNG chuỗi "thử hết lối này tới lối khác" — trước đây mỗi chat lặp 4–5 lần trong 30–60s.
  function scheduleBuRetry(conv, text, photo, name, why) {
    if (!conv || buRetryDone[conv.id]) return; // mỗi chat đúng 1 lần trong lượt
    if (deliveredIds[conv.id]) {
      // đã có kênh XÁC NHẬN thành công thật — không gửi lại (chống trùng). Có log để không im lặng.
      logLine('✓ ' + name + ' — tin đã đến nơi (xác nhận) — không bù.');
      return;
    }
    buRetryDone[conv.id] = true;
    const myRun = runSeq;
    const delay = BU_RETRY_MS + (buRetrySeq++) * BU_SPREAD_MS;
    logLine('⏳ ' + name + ' — ' + why + ' — bù đúng 1 lần sau ' + Math.round(delay / 1000) + 's…');
    setTimeout(() => {
      if (myRun !== runSeq) return; // có lượt gửi mới — bù của lượt cũ bỏ (tránh gửi lẫn 2 lượt)
      if (state.stopRequested) {
        logLine('⏸ ' + name + ' — bỏ bù (đang dừng).');
        return;
      }
      if (deliveredIds[conv.id]) return; // trong lúc chờ, tin đã đến nơi qua đường khác — thôi
      const ch = (photo || conv.type === 'comment') ? 'ext' : 'socket';
      busEnqueue(() => (ch === 'ext'
        ? sendViaExtension(conv, text, photo, {})
        : sendViaSocket(conv, text, {}))).then((r) => {
        if (r && r.ok) {
          markDelivered(conv.id);
          logLine('✅ ' + name + ' — bù THÀNH CÔNG qua ' + (ch === 'ext' ? 'Extension' : 'Socket'));
        } else if (r && r.sent === 'maybe') {
          logLine('⚠ ' + name + ' — bù không rõ kết quả — KHÔNG gửi thêm (chống trùng)');
        } else {
          logLine('❌ ' + name + ' — bù không được: ' + ((r && r.error) || 'lỗi không rõ')
            + ' — đã bù đúng 1 lần theo luật, không lặp lại');
        }
      }).catch((e) => {
        logLine('❌ ' + name + ' — bù lỗi: ' + (e && e.message || e));
      });
    }, delay);
  }

  // Nhóm chat theo NỘI DUNG sẽ gửi: chat thuộc câu nào → ĐÚNG chữ của câu đó;
  // chat lẻ (không thuộc câu nào) → câu đang gõ trên ô textarea. Trả về [{text, list}].
  function buildSendGroups(matches, savedLists, typedText) {
    const cauById = {};
    (savedLists || []).forEach((l) => { cauById[l.id] = l; });
    const cauTextOf = (m) => {
      const l = (m && m.listId) ? cauById[m.listId] : null;
      return (l && l.text && String(l.text).trim()) ? String(l.text) : '';
    };
    const map = new Map();
    (matches || []).forEach((m) => {
      const t = cauTextOf(m) || typedText;
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(m);
    });
    return Array.from(map.entries()).map((en) => ({ text: en[0], list: en[1] }));
  }

  async function sendToAll() {
    if (state.sending) return; // chặn bấm đúp / gọi đúp → gửi TRÙNG
    // LƯU Ý: panel nằm trong shadow DOM → phải lấy phần tử qua shadow.getElementById,
    // document.querySelector sẽ không thấy (đây là nguyên nhân lỗi "Hãy nhập nội dung câu cần gửi")
    const msgEl = shadow && shadow.getElementById('ssb-msg');
    const typedText = (msgEl && msgEl.value || '').trim();
    const imgState = state.image || null;
    let targets = state.matches.filter((m) => m.checked);
    if (!targets.length) {
      alert('Chưa có đoạn chat nào được chọn.\nHãy chọn snippet (nút "Lấy snippet từ chat đang chọn")\nhoặc chọn chuỗi bằng 2 lần Alt+Click (đầu → cuối).');
      return;
    }
    // loại dòng trùng id — 1 chat chỉ được gửi 1 lần
    {
      const seenIds = new Set();
      const uniq = [];
      targets.forEach((m) => {
        if (!seenIds.has(m.id)) { seenIds.add(m.id); uniq.push(m); }
      });
      if (uniq.length !== targets.length) {
        logLine('⚠ Loại ' + (targets.length - uniq.length) + ' dòng trùng lặp trong danh sách gửi');
      }
      targets = uniq;
    }
    // nội dung sẽ gửi: câu đã tích → chữ của TỪNG CÂU; chat lẻ → ô đang gõ
    let sendGroups = buildSendGroups(targets, state.savedLists, typedText);
    const textsAll = sendGroups.map((g) => g.text).filter((t) => t && t.trim());
    if (!textsAll.length && !imgState) { alert('Hãy nhập nội dung câu cần gửi (hoặc chọn ảnh).'); return; }
    const names = targets.slice(0, MAX_NAME_LIST).map((m) => m.name || m.id).join(', ')
      + (targets.length > MAX_NAME_LIST ? ', …' : '');
    const nComment = targets.filter((m) => m.type === 'comment').length;
    const warnComment = nComment
      ? '\n\n⚠ Trong đó ' + nComment + ' chat loại BÌNH LUẬN — sẽ gửi dưới dạng TRẢ LỜI BÌNH LUẬN (công khai dưới bài viết)!'
      : '';
    const imgNote = imgState ? '\n\n📷 Kèm ảnh: ' + (imgState.name || 'ảnh') : '';
    const textNote = textsAll.length > 1
      ? '\n\n📝 ' + textsAll.length + ' nội dung — mỗi câu được gửi đúng chữ đã lưu: '
        + textsAll.map((t) => '“' + clip(t, 40) + '”').join(', ')
      : '';
    if (!confirm('Gửi ' + (textsAll.length > 1 ? textsAll.length + ' nội dung' : (textsAll.length ? '1 câu' : 'ảnh'))
      + ' tới ' + targets.length + ' đoạn chat đã chọn?\n\n'
      + (textsAll.length === 1 ? '“' + clip(textsAll[0] || '(chỉ gửi ảnh)', 120) + '”' : '(mỗi câu đúng nội dung đã lưu)')
      + textNote + imgNote + '\n\nNhận: ' + names + warnComment)) return;

    // ĐÁNH DẤU ĐANG GỬI NGAY từ trước bước lọc: bước lọc tag/tải ảnh có thể chờ API —
    // không chặn đúp ở đây thì bấm lần 2 chạy song song lần 1 (log hiện 2 dòng lọc)
    state.sending = true;
    state.stopRequested = false;
    batchSkipApi = false;
    // trạng thái theo LƯỢT gửi: chat đã đến nơi trong lượt này không bao giờ bị gửi lại;
    // bù của lượt trước đang chờ sẽ tự hủy (runSeq) — không gửi lẫn vào lượt mới
    runSeq++;
    buRetrySeq = 0;
    Object.keys(buRetryDone).forEach((k) => { delete buRetryDone[k]; });
    Object.keys(deliveredIds).forEach((k) => { delete deliveredIds[k]; });
    render();

    // LỌC TRƯỚC KHI BẮN: tag "chốt"/"chặn" (tải lại tag 1 lượt) + chat có icon điện thoại (has_phone)
    {
      const ban = await filterBannedTagTargets(targets);
      const nm = (arr) => arr.slice(0, 20).map((m) => m.name || m.id).join(', ') + (arr.length > 20 ? ', …' : '');
      if (ban.skippedTag.length) {
        logLine('🧹 Bỏ qua ' + ban.skippedTag.length + ' chat THẬT SỰ đang gắn tag cấm: '
          + ban.skippedTag.slice(0, 20).map((x) => (x.m.name || x.m.id) + ' (tag "' + x.why + '")').join(', ')
          + (ban.skippedTag.length > 20 ? ', …' : ''));
      } else {
        logLine('✅ Không chat nào bị bỏ qua vì tag — không ai trong lô gắn tag "chốt"/"chặn".');
      }
      if (ban.skippedPhone.length) {
        logLine('📞 Bỏ qua ' + ban.skippedPhone.length + ' chat có icon điện thoại (sale đang chăm): ' + nm(ban.skippedPhone));
      }
      if (ban.skippedTag.length || ban.skippedPhone.length) {
        targets = ban.kept;
      }
      if (!targets.length) {
        logLine('🧹 Không còn chat nào sau khi lọc tag — không có gì để gửi.');
        state.sending = false;
        render();
        return;
      }
    }

    // CHỐT danh sách câu sẽ TIÊU THỤ ngay từ đầu lượt: gửi xong (kể cả lỗi giữa chừng) sẽ xóa
    // ĐÚNG các câu này — không phụ lệch việc giữa chừng bấm tích/bỏ tích câu khác.
    const consumeIds = new Set(state.listSel || []);

    // Chuẩn bị ảnh (nếu có): upload 1 lần → gắn attachment cho từng page
    let photo = null;
    const fbIdByPage = {};
    if (imgState && imgState.file) {
      logLine('☁️ Đang tải ảnh lên Pancake…');
      const up = await uploadContentFile(imgState.file);
      if (!up.ok) {
        logLine('⛔ Không tải được ảnh (' + up.error + ') — HỦY gửi để tránh gửi thiếu ảnh.');
        state.sending = false;
        render();
        return;
      }
      photo = { url: up.url, id: up.id, fbId: '', w: imgState.w || 0, h: imgState.h || 0 };
      logLine('☁️ Ảnh đã tải lên — đang gắn attachment cho từng page…');
      const pageIds = [];
      targets.forEach((c) => {
        const p = c.pageId || String(c.id || '').split('_')[0];
        if (p && pageIds.indexOf(p) === -1) pageIds.push(p);
      });
      for (let i = 0; i < pageIds.length; i++) {
        if (state.stopRequested) break;
        const up2 = await uploadPhotoForPage(pageIds[i], photo);
        if (up2.ok) {
          fbIdByPage[pageIds[i]] = up2.fbId;
          logLine('☁️ Page ' + pageIds[i] + ': gắn ảnh OK');
        } else {
          logLine('⚠ Page ' + pageIds[i] + ': không gắn được ảnh (' + up2.error + ') — chat page này sẽ báo lỗi');
        }
      }
    }

    // Gửi theo lượt: mỗi lượt = "Số tin mỗi lượt" (mặc định 200), giữa các lượt nghỉ "N ms" (mặc định 500)
    const waveEl = shadow && shadow.getElementById('ssb-wave');
    const gapEl = shadow && shadow.getElementById('ssb-gap');
    const WAVE_SIZE = Math.max(1, Math.min(5000, parseInt((waveEl && waveEl.value) || '5000', 10) || 5000));
    const gapRaw = parseInt((gapEl && gapEl.value) || '500', 10);
    const WAVE_GAP = isNaN(gapRaw) ? 0 : Math.max(0, Math.min(60000, gapRaw));
    // gửi theo từng nhóm nội dung (câu khác câu → chữ khác chữ)
    sendGroups = buildSendGroups(targets, state.savedLists, typedText);
    if (!imgState) {
      const emptyGs = sendGroups.filter((g) => !g.text.trim());
      if (emptyGs.length) {
        const nEmpty = emptyGs.reduce((n2, g) => n2 + g.list.length, 0);
        logLine('⚠ Bỏ ' + nEmpty + ' chat chưa có nội dung (câu rỗng + ô cần gửi trống) — không gửi chữ trống.');
        sendGroups = sendGroups.filter((g) => g.text.trim());
      }
    }
    const totalAll = targets.length;
    const useWaves = totalAll > WAVE_SIZE;
    logLine(useWaves
      ? '🚀 Bắt đầu gửi ' + totalAll + ' chat THEO LƯỢT: mỗi lượt ' + WAVE_SIZE + ' tin, cách nhau ' + WAVE_GAP + 'ms…'
      : '🚀 Bắt đầu gửi ' + totalAll + ' chat (1 lượt — ' + WAVE_SIZE + ' tin/lượt)…');

    let ok = 0, fail = 0, done = 0, unsure = 0, firedN = 0;
    const quickEl0 = shadow && shadow.getElementById('ssb-quick');
    const quickOn = !!(quickEl0 && quickEl0.checked);

    const sendOneAndLog = async (c, gtext) => {
      // CHỐT PHÚT CHÓT — soi lại tag/icon NGAY TRƯỚC khi bắn từng chat: tag cấm có thể vừa
      // được gắn SAU bước lọc trước, và đây là lớp an toàn cuối cho mọi lỗ dữ liệu
      const lateBan = rowBanTagFromDom(c) || convBanTagFromData(c, {});
      if (lateBan) {
        done++;
        logLine('🧹 [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — mang tag "' + lateBan
          + '" lúc gửi — BỎ QUA (không gửi)');
        setProgress(done, totalAll);
        return { ok: false, sent: false, skipped: true };
      }
      if (convHasPhone(c)) {
        done++;
        logLine('📞 [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — có icon điện thoại lúc gửi — BỎ QUA (không gửi)');
        setProgress(done, totalAll);
        return { ok: false, sent: false, skipped: true };
      }
      let r;
      if (photo) {
        const p = c.pageId || String(c.id).split('_')[0];
        const fbId = fbIdByPage[p] || '';
        if (!fbId) {
          done++;
          fail++;
          logLine('❌ [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — không có attachment ảnh cho page này');
          setProgress(done, totalAll);
          return { ok: false, sent: false, error: 'Không có attachment ảnh' };
        }
        r = await sendOne(c, gtext, { url: photo.url, id: photo.id, fbId, w: photo.w, h: photo.h }, { quick: quickOn });
      } else {
        r = await sendOne(c, gtext, null, { quick: quickOn });
      }
      const via = r.ok ? (r.sendBy === 'direct' ? ' — gửi thẳng Socket/Ext'
        : r.sendBy === 'socket' ? ' — qua Socket'
        : r.sendBy === 'extension' ? ' — qua Extension' : '') : '';
      done++;
      if (r.ok) {
        ok++;
        // fired = chỉ ĐÃ BẮN request — CHƯA xác nhận server nhận. Đánh dấu "đã đến nơi" cho
        // kết quả fired sẽ chặn nhầm bước bù nền → "báo gửi nhưng không gửi gì" (bug v1.39.0).
        // Chỉ đánh dấu khi kênh XÁC NHẬN thành công thật (kể cả xác nhận nền — fireApiAndWatch).
        if (!r.fired) markDelivered(c.id);
        if (r.fired) firedN++;
        logLine('✅ [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — đã gửi' + via
          + (r.fired ? ' (đang xác nhận nền — nếu bị từ chối sẽ tự bù và báo)' : ''));
      } else if (r.uncertain) {
        unsure++;
        logLine('⚠ [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — ' + r.error
          + ' — không rõ tin đã đi chưa (không gửi thêm để tránh trùng)');
      } else {
        fail++;
        logLine('❌ [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — ' + r.error);
        if (!r.uncertain && isRetryableLoss(r.error)) {
          const p2 = c.pageId || String(c.id).split('_')[0];
          scheduleBuRetry(c, gtext, photo
            ? { url: photo.url, id: photo.id, fbId: fbIdByPage[p2] || '', w: photo.w, h: photo.h }
            : null, c.name || c.id, 'gửi chưa được');
        }
      }
      setProgress(done, totalAll);
      return r;
    };

    // 1 lượt = bắn song song toàn bộ số tin trong lượt
    const sendBatch = async (gtext, batch) => {
      await runPool(batch, async (c) => {
        if (state.stopRequested) return null;
        const r = await sendOneAndLog(c, gtext);
        if (!r.ok && r.error && r.error.indexOf('Token') === 0) {
          logLine('⛔ Dừng sớm vì token không còn hợp lệ.');
          state.stopRequested = true;
        }
        return r;
      }, Math.max(1, batch.length));
    };

    const runWaves = async (gtext, list) => {
      const totalWaves = Math.ceil(list.length / WAVE_SIZE);
      for (let i2 = 0; i2 < list.length && !state.stopRequested; i2 += WAVE_SIZE) {
        await sendBatch(gtext, list.slice(i2, i2 + WAVE_SIZE));
        const waveNo = Math.ceil(Math.min(i2 + WAVE_SIZE, list.length) / WAVE_SIZE);
        if (i2 + WAVE_SIZE < list.length && !state.stopRequested) {
          logLine('🌊 Lượt ' + waveNo + '/' + totalWaves + ' xong (' + done + ' tin) — nghỉ ' + WAVE_GAP + 'ms rồi lượt tiếp…');
          await sleep(WAVE_GAP);
        }
      }
    };

    let sendErr = null;
    try {
      try { warmUpSockets(targets); } catch (e) { /* làm nóng lỗi không được làm hỏng lô */ }
      for (let gi = 0; gi < sendGroups.length && !state.stopRequested; gi++) {
        const g = sendGroups[gi];
        if (sendGroups.length > 1) {
          logLine('📤 [' + (gi + 1) + '/' + sendGroups.length + '] nội dung “' + clip(g.text, 50) + '” → ' + g.list.length + ' chat');
        }
        if (useWaves) await runWaves(g.text, g.list);
        else await sendBatch(g.text, g.list);
      }
    } catch (e) {
      sendErr = e;
      logLine('⚠ Gửi lỗi giữa chừng (' + (e && e.message || e) + ') — vẫn xóa câu đã gửi + bỏ chọn để không gửi trùng.');
    }

    state.sending = false;
    if (state.stopRequested && done < totalAll) {
      logLine('⏸ Đã dừng sớm sau ' + done + '/' + totalAll + ' chat.');
    }
    if (!sendErr) {
      logLine('🏁 Hoàn tất: ' + ok + ' thành công, ' + fail + ' lỗi.'
        + (unsure ? ' ' + unsure + ' tin không rõ kết quả (không gửi thêm).' : '')
        + (firedN ? ' ⚡ ' + firedN + ' tin bắn nhanh (không chờ server xác nhận).' : ''));
    }
    // CÂU ĐÃ CHỐT TIÊU THỤ từ đầu lượt → dùng xong TỰ XÓA (mỗi câu chỉ gửi 1 lần — tránh gửi trùng).
    // Chạy cả khi gửi lỗi giữa chừng: ít nhất đã bắn dở — giữ lại là dễ gửi trùng.
    if (consumeIds.size) {
      const ids = Array.from(consumeIds);
      const delNames = state.savedLists.filter((l) => ids.indexOf(l.id) > -1).map((l) => l.name);
      state.savedLists = state.savedLists.filter((l) => ids.indexOf(l.id) === -1);
      state.listSel = new Set();
      state.loadedName = null;
      persistSavedLists();
      renderSavedLists();
      if (delNames.length) {
        logLine('🗑 Đã gửi xong — tự xóa ' + delNames.length + ' câu: ' + delNames.join(', '));
      }
    }
    // Gửi xong → TỰ BỎ CHỌN các đoạn chat đã đánh dấu (giống nút "Xóa"): dấu chọn đã "tiêu" vào
    // lượt gửi này, để sẵn sàng chọn lượt mới — và bấm chạy lại không bao giờ dính dấu cũ (chống trùng).
    if (state.matches.length) {
      clearSelection();
      logLine('🧹 Đã tự bỏ chọn các chat vừa gửi.');
    }
    render();
  }

  /* ============================ GIAO DIỆN (SHADOW DOM) ============================ */

  let shadow = null;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
      .ssb-m-match { background: rgba(34,197,94,.16) !important; box-shadow: inset 3px 0 0 0 #22c55e !important; outline: 2px solid #22c55e !important; outline-offset: -2px !important; border-radius: 6px; }
      .ssb-m-target { background: rgba(59,130,246,.22) !important; box-shadow: inset 3px 0 0 0 #3b82f6 !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; border-radius: 6px; }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ===== CỬA SỔ PHÓNG TO (list/log) — kéo tiêu đề để di chuyển, kéo góc dưới-phải để đổi cỡ =====
     Bảng gốc được ĐƯA VÀO cửa sổ nổi (mọi nút/kéo thả bên trong vẫn chạy nguyên), thu nhỏ = trả
     bảng về đúng chỗ cũ trong panel. Vị trí + cỡ lưu localStorage — giữ qua F5. */
  const floatWins = {}; // key → { win, content, ph, cleanup }

  function toggleFloat(key, contentEl, title, btnEl, openLabel, closeLabel, def) {
    const existing = floatWins[key];
    if (existing) {
      // THU NHỎ: trả nội dung về chỗ cũ + gỡ cửa sổ + tháo listener kéo/đổi cỡ
      existing.ph.parentNode.insertBefore(existing.content, existing.ph);
      existing.ph.parentNode.removeChild(existing.ph);
      existing.cleanup();
      existing.win.remove();
      delete floatWins[key];
      if (btnEl) btnEl.textContent = openLabel;
      return false;
    }
    if (!contentEl || !contentEl.parentNode) return false;
    // PHÓNG TO: đánh dấu chỗ cũ rồi đưa bảng vào cửa sổ nổi
    const ph = document.createComment('ssb-ph-' + key);
    contentEl.parentNode.insertBefore(ph, contentEl);
    const win = document.createElement('div');
    win.className = 'floatwin';
    const headEl = document.createElement('div');
    headEl.className = 'fw-head';
    headEl.title = 'Kéo để di chuyển cửa sổ';
    const titleEl = document.createElement('span');
    titleEl.className = 'fw-title';
    titleEl.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'minibtn fw-close';
    closeBtn.textContent = '✕ Thu nhỏ';
    headEl.appendChild(titleEl);
    headEl.appendChild(closeBtn);
    const bodyEl = document.createElement('div');
    bodyEl.className = 'fw-body';
    bodyEl.appendChild(contentEl);
    const rsEl = document.createElement('div');
    rsEl.className = 'rs';
    rsEl.title = 'Kéo góc này để đổi cỡ — đúp chuột để về mặc định';
    win.appendChild(headEl);
    win.appendChild(bodyEl);
    win.appendChild(rsEl);
    shadow.appendChild(win);

    // vị trí/cỡ: đã chỉnh thì giữ qua F5, chưa thì mặc định (lúc mở mới tính theo màn hình)
    let geo = null;
    try { geo = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { /* ignore */ }
    const w = (geo && geo.w) || def.w;
    const h = (geo && geo.h) || def.h;
    win.style.width = w + 'px';
    win.style.height = h + 'px';
    win.style.left = Math.round((geo && typeof geo.left === 'number') ? geo.left : def.left()) + 'px';
    win.style.top = Math.round((geo && typeof geo.top === 'number') ? geo.top : def.top()) + 'px';

    const save = () => {
      try {
        // đọc từ style (giá trị ta tự set cho position:fixed — không phụ thuộc offset* của trình duyệt);
        // isNaN chứ KHÔNG phải ||default — 0px là hợp lệ, không được nuốt
        const px = (v, fb) => { const n = parseInt(v, 10); return isNaN(n) ? fb : n; };
        localStorage.setItem(key, JSON.stringify({
          left: px(win.style.left, 0), top: px(win.style.top, 0),
          w: px(win.style.width, def.w), h: px(win.style.height, def.h),
        }));
      } catch (e) { /* ignore */ }
    };
    // kéo tiêu đề = DI CHUYỂN, kéo góc dưới-phải = ĐỔI CỠ — giữ cửa sổ ló ≥40px trong màn hình
    let dg = null, rs = null;
    headEl.addEventListener('mousedown', (e) => {
      if (e.target && e.target.closest && e.target.closest('button')) return; // bấm nút ≠ kéo
      dg = { x: e.clientX, y: e.clientY, left: win.offsetLeft, top: win.offsetTop };
      e.preventDefault();
    });
    rsEl.addEventListener('mousedown', (e) => {
      rs = { x: e.clientX, y: e.clientY, w: win.offsetWidth, h: win.offsetHeight };
      e.preventDefault();
    });
    rsEl.addEventListener('dblclick', () => {
      win.style.width = def.w + 'px';
      win.style.height = def.h + 'px';
      win.style.left = Math.round(def.left()) + 'px';
      win.style.top = Math.round(def.top()) + 'px';
      save();
    });
    const onMove = (e) => {
      if (dg) {
        const left = Math.min(Math.max(0, dg.left + e.clientX - dg.x), Math.max(0, window.innerWidth - 60));
        const top = Math.min(Math.max(0, dg.top + e.clientY - dg.y), Math.max(0, window.innerHeight - 40));
        win.style.left = left + 'px';
        win.style.top = top + 'px';
      }
      if (rs) {
        win.style.width = Math.max(280, Math.min(window.innerWidth - 12, rs.w + e.clientX - rs.x)) + 'px';
        win.style.height = Math.max(180, Math.min(window.innerHeight - 12, rs.h + e.clientY - rs.y)) + 'px';
      }
    };
    const onUp = () => {
      if (dg || rs) save();
      dg = null;
      rs = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    closeBtn.addEventListener('click', () => {
      toggleFloat(key, contentEl, title, btnEl, openLabel, closeLabel, def);
    });
    floatWins[key] = { win, content: contentEl, ph, cleanup };
    if (btnEl) btnEl.textContent = closeLabel;
    return true;
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;
    ensureStyle();
    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483646;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
        .wrap { width: 340px; background: #0f172a; color: #e2e8f0; border: 1px solid #334155;
                border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45); overflow: hidden; font-size: 12px;
                position: relative; display: flex; flex-direction: column; }
        .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #1e293b; cursor: move; }
        .title { font-weight: 700; font-size: 13px; flex: 1; color: #f8fafc; }
        .badge { font-size: 10px; padding: 2px 8px; border-radius: 999px; cursor: pointer; border: none; }
        .badge.on  { background: #16a34a; color: white; }
        .badge.off { background: #64748b; color: white; }
        .minibtn { background: #334155; color: #e2e8f0; border: none; border-radius: 6px;
                   padding: 3px 8px; cursor: pointer; font-size: 11px; }
        .minibtn:hover { background: #475569; }
        .body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
                max-height: 62vh; overflow: auto; flex: 1 1 auto; min-height: 0; }
        .label { color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
        .snippet-box { background: #1e293b; border: 1px solid #334155; border-radius: 8px;
                       padding: 8px; color: #a7f3d0; word-break: break-word; max-height: 64px; overflow: auto; }
        .row { display: flex; gap: 6px; flex-wrap: wrap; }
        button.b { border: none; border-radius: 8px; padding: 7px 10px; cursor: pointer;
                   font-size: 11px; font-weight: 600; }
        .b-blue  { background: #2563eb; color: #fff; } .b-blue:hover  { background: #1d4ed8; }
        .b-green { background: #16a34a; color: #fff; } .b-green:hover { background: #15803d; }
        .b-gray  { background: #334155; color: #e2e8f0; } .b-gray:hover { background: #475569; }
        .b-red   { background: #dc2626; color: #fff; } .b-red:hover   { background: #b91c1c; }
        button:disabled { opacity: .45; cursor: not-allowed; }
        textarea { width: 100%; min-height: 64px; resize: vertical; border-radius: 8px; border: 1px solid #334155;
                   background: #0b1220; color: #f1f5f9; padding: 8px; font-size: 12px; outline: none; }
        textarea:focus { border-color: #2563eb; }
        input[type=number] { width: 84px; background: #0b1220; color: #f1f5f9; border: 1px solid #334155;
                             border-radius: 6px; padding: 5px 6px; font-size: 11px; }
        select { background: #0b1220; color: #f1f5f9; border: 1px solid #334155;
                 border-radius: 6px; padding: 5px 6px; font-size: 11px; cursor: pointer; }
        .list { border: 1px solid #334155; border-radius: 8px; max-height: 180px; overflow: auto; background: #0b1220; }
        .item { display: flex; gap: 6px; align-items: flex-start; padding: 6px 8px; border-bottom: 1px solid #1e293b; }
        .item:last-child { border-bottom: none; }
        .item input { margin-top: 2px; }
        .item .nm { color: #f8fafc; font-weight: 600; font-size: 11px; }
        .item .sn { color: #7dd3fc; font-size: 10px; word-break: break-word; }
        .item .tm { color: #64748b; font-size: 10px; margin-left: auto; white-space: nowrap; }
        .prog { height: 6px; border-radius: 999px; background: #1e293b; overflow: hidden; }
        .prog > i { display: block; height: 100%; width: 0%; background: #22c55e; transition: width .25s; }
        .log { background: #0b1220; border: 1px solid #334155; border-radius: 8px; padding: 8px;
               max-height: 150px; overflow: auto; font-size: 10.5px; line-height: 1.55; color: #cbd5e1;
               white-space: pre-wrap; word-break: break-word; }
        /* ===== cửa sổ PHÓNG TO (list/log): kéo tiêu đề để di chuyển, kéo góc dưới-phải để đổi cỡ ===== */
        .floatwin { position: fixed; z-index: 2147483647; background: #0f172a; color: #e2e8f0;
                    border: 1px solid #334155; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.55);
                    display: flex; flex-direction: column; overflow: hidden; font-size: 12px; }
        .fw-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #1e293b;
                   cursor: move; user-select: none; flex: 0 0 auto; }
        .fw-title { font-weight: 700; font-size: 12px; flex: 1; color: #f8fafc; }
        .fw-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 8px; }
        .fw-body .log { flex: 1 1 auto; max-height: none; height: 100%; font-size: 12px; }
        .fw-body #ssb-sec-sl { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
        .fw-body #ssb-sec-sl .saved-lists { flex: 1 1 auto; max-height: none; min-height: 0; }
        /* hộp thoại SỬA CÂU (tên + nội dung nhiều dòng) */
        .edit-ov { position: fixed; inset: 0; background: rgba(2,6,23,.55); z-index: 2147483647;
                   display: flex; align-items: center; justify-content: center; }
        .edit-card { background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 12px;
                     width: min(520px, 92vw); padding: 14px; display: flex; flex-direction: column; gap: 8px;
                     box-shadow: 0 12px 40px rgba(0,0,0,.55); }
        .edit-title { font-weight: 700; font-size: 13px; color: #f8fafc; }
        .edit-card input[type=text] { width: 100%; background: #0b1220; color: #f1f5f9; border: 1px solid #334155;
                                      border-radius: 6px; padding: 6px 8px; font-size: 12px; }
        .edit-card textarea { min-height: 120px; }
        /* tay nắm KÉO THẢ ĐỔI CỠ panel (góc dưới-phải; đúp chuột = về mặc định) */
        .rs { position: absolute; right: 0; bottom: 0; width: 20px; height: 20px; cursor: nwse-resize;
              background: linear-gradient(135deg, transparent 55%, #475569 55%, #475569 66%,
                          transparent 66%, transparent 76%, #475569 76%, #475569 87%, transparent 87%);
              border-bottom-right-radius: 12px; z-index: 5; }
        .rs:hover { background: linear-gradient(135deg, transparent 55%, #7dd3fc 55%, #7dd3fc 66%,
                    transparent 66%, transparent 76%, #7dd3fc 76%, #7dd3fc 87%, transparent 87%); }
        /* panel đã kéo cỡ → danh sách chat + log giãn ra theo */
        .wrap.sized .body { max-height: none; }
        .wrap.sized #ssb-sec-sl { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 90px; }
        .wrap.sized #ssb-sec-sl .saved-lists { flex: 1 1 auto; max-height: none; min-height: 60px; }
        .wrap.sized .log { flex: 1 1 auto; max-height: none; min-height: 60px; }
        .sl-cb { accent-color: #22c55e; margin: 0; cursor: pointer; }
        .hint { color: #64748b; font-size: 10px; line-height: 1.5; }
        .empty { color: #64748b; padding: 10px; text-align: center; }
        .count { color: #38bdf8; font-weight: 700; }
        #ssb-bubble { display: none; background: transparent; border: none; padding: 0; cursor: grab;
                      line-height: 0; filter: drop-shadow(0 6px 14px rgba(88,101,242,.45));
                      transition: transform .15s ease; }
        #ssb-bubble:hover { transform: scale(1.1) rotate(-4deg); }
        #ssb-bubble:active { transform: scale(.96); cursor: grabbing; }
        #ssb-bubble svg { width: 40px; height: 40px; display: block; }
        .title .logo { width: 17px; height: 17px; vertical-align: -3px; margin-right: 3px; }
        .saved-lists { border: 1px solid #334155; border-radius: 8px; max-height: 132px; overflow: auto; background: #0b1220; }
        .sl-row { display: flex; gap: 6px; align-items: center; padding: 5px 8px; cursor: pointer; border-bottom: 1px solid #1e293b; }
        .sl-row:last-child { border-bottom: none; }
        .sl-row:hover { background: #132033; }
        .sl-row.active { background: #173052; }
        .sl-row.dragging { opacity: .45; }
        .sl-handle { cursor: grab; color: #64748b; user-select: none; font-size: 13px; line-height: 1; }
        .sl-handle:hover { color: #7dd3fc; }
        .sl-name { flex: 1; color: #f8fafc; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sl-n { color: #64748b; }
        .sl-btn { border: none; background: transparent; cursor: pointer; color: #94a3b8; font-size: 12px; padding: 2px 5px; border-radius: 5px; line-height: 1; }
        .sl-btn:hover { background: #1e293b; color: #f8fafc; }
      </style>
      <div class="wrap" id="ssb-wrap">
        <div class="head" id="ssb-head">
          <span class="title"><svg class="logo" viewBox="0 0 50 52" width="17" height="17" xmlns="http://www.w3.org/2000/svg"><path d="M10 2 L14 11" stroke="#5865F2" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M40 2 L36 11" stroke="#5865F2" stroke-width="5" stroke-linecap="round" fill="none"/><rect x="0" y="12" width="50" height="40" rx="6" fill="#5865F2"/><rect x="12" y="31" width="12" height="4" rx="2" fill="#fff"/><rect x="26" y="31" width="12" height="4" rx="2" fill="#fff"/></svg>BOTFAKE <span style="color:#64748b;font-weight:400;font-size:11px">v1.42.0</span></span>
          <button class="badge on" id="ssb-toggle" title="Bật/tắt tính năng">BẬT</button>
          <button class="minibtn" id="ssb-close" title="Tắt panel (F5 hoặc Alt+Shift+B để hiện lại)">✕</button>
          <button class="minibtn" id="ssb-min" title="Thu nhỏ">—</button>
        </div>
        <div class="body" id="ssb-body">
          <div class="row" style="align-items:center;gap:6px">
            <button class="b b-green" id="ssb-send" style="flex:1">▶ Chạy</button>
            <button class="b b-red" id="ssb-stop" disabled style="flex:1">⏹ Dừng</button>
          </div>
          <div>
            <div class="label">1) Đang chọn</div>
            <div class="snippet-box" id="ssb-target">Chưa chọn — <b>Alt+Click 2 lần</b> (đầu → cuối chuỗi) hoặc lấy snippet từ chat đang chọn</div>
            <div class="row" style="margin-top:6px">
              <button class="b b-blue" id="ssb-use-selected">Lấy snippet từ chat đang chọn</button>
              <button class="b b-gray" id="ssb-pick">Chọn chuỗi (2 nhấp)</button>
              <button class="b b-gray" id="ssb-to-end">⬇ Từ đây xuống cuối</button>
              <button class="b b-gray" id="ssb-clear">Xóa</button>
            </div>
          </div>
          <div class="row" style="margin:2px 0 4px;align-items:center">
            <button class="b b-gray" id="ssb-scan">⚡ Tải danh sách</button>
            <span class="hint">đã chọn: <span class="count" id="ssb-count">0</span></span>
          </div>
          <div>
            <div class="label">2) Câu cần gửi</div>
            <textarea id="ssb-msg" placeholder="Nhập 1 câu sẽ gửi cho tất cả đoạn chat ở trên…"></textarea>
            <div class="row" style="align-items:center">
              <input type="file" id="ssb-img" accept="image/*" style="display:none">
              <button class="b b-gray" id="ssb-img-pick">📷 Chọn ảnh (tùy chọn)</button>
              <span class="hint" id="ssb-img-info">Chưa chọn — copy ảnh rồi Ctrl+V để dán</span>
              <button class="b b-gray" id="ssb-img-clear" style="display:none">✕ Bỏ ảnh</button>
            </div>
            <div class="row" style="align-items:center">
              <span class="hint">Mỗi lượt:</span>
              <input type="number" id="ssb-wave" value="5000" min="1" step="50" style="width:72px" title="Số tin mỗi lượt">
              <span class="hint">tin — nghỉ</span>
              <input type="number" id="ssb-gap" value="0" min="0" step="50" style="width:72px" title="Số ms nghỉ giữa các lượt">
              <span class="hint">ms giữa các lượt</span>
              <label class="hint" style="display:flex;align-items:center;gap:4px;cursor:pointer" title="Bắn API không chờ server xác nhận — nhanh hơn hẳn; chat bị API từ chối rõ ràng sẽ tự bù Socket/Ext trong nền">
                <input type="checkbox" id="ssb-quick" checked style="accent-color:#22c55e;margin:0"> ⚡ Gửi nhanh
              </label>
            </div>
          </div>
          <div id="ssb-sec-sl">
            <div class="row" style="align-items:center;justify-content:space-between">
              <span class="label">LIST CÂU GỬI</span>
              <button class="minibtn" id="ssb-slzoom" title="Phóng to / thu nhỏ bảng list câu gửi — kéo tiêu đề để di chuyển, kéo góc dưới-phải để đổi cỡ">⛶ Phóng to</button>
            </div>
            <div class="row" style="margin:4px 0;align-items:center">
              <button class="b b-gray" id="ssb-sl-new" title="Lưu CÂU CẦN GỬI đang gõ + các chat đã chọn thành 1 câu — gửi xong tự xóa">＋ Tạo câu gửi</button>
              <span class="hint" id="ssb-sl-info">0 câu</span>
            </div>
            <div class="saved-lists" id="ssb-sl-box"><div class="empty">Chưa có list nào — chọn chat ở mục 1–2 rồi bấm “＋ Tạo list”</div></div>
          </div>
          <div class="row" style="align-items:center;justify-content:space-between">
            <span class="label">LOG</span>
            <button class="minibtn" id="ssb-logzoom" title="Phóng to / thu nhỏ bảng log — kéo tiêu đề để di chuyển, kéo góc dưới-phải để đổi cỡ">⛶ Phóng to log</button>
          </div>
          <div class="prog"><i id="ssb-bar"></i></div>
          <div class="log" id="ssb-log"></div>
        </div>
        <div class="rs" id="ssb-rs" title="Kéo góc này để đổi cỡ panel — đúp chuột để về mặc định"></div>
      </div>
      <button id="ssb-bubble" type="button" style="display:none" title="Mở panel BOTFAKE (bấm để mở lại)"><svg viewBox="0 0 50 52" width="40" height="40" xmlns="http://www.w3.org/2000/svg"><path d="M10 2 L14 11" stroke="#5865F2" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M40 2 L36 11" stroke="#5865F2" stroke-width="5" stroke-linecap="round" fill="none"/><rect x="0" y="12" width="50" height="40" rx="6" fill="#5865F2"/><rect x="12" y="31" width="12" height="4" rx="2" fill="#fff"/><rect x="26" y="31" width="12" height="4" rx="2" fill="#fff"/></svg></button>
    `;
    (document.body || document.documentElement).appendChild(host);
    wireEvents(shadow);
    render();
    watchList(); // tự tô lại màu khi virtual list render lại dòng
  }

  function wireEvents(root) {
    const on = (id, ev, fn) => {
      const el = root.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };
    on('ssb-toggle', 'click', () => {
      state.enabled = !state.enabled;
      highlightRows(); // bật: tô lại / tắt: gỡ hết màu
      render();
    });
    on('ssb-min', 'click', () => {
      // thu nhỏ = biến panel thành BÓNG LOGO (con quỷ botfake) ở góc màn hình
      const wrapEl = root.getElementById('ssb-wrap');
      const bubble = root.getElementById('ssb-bubble');
      if (wrapEl) wrapEl.style.display = 'none';
      if (bubble) bubble.style.display = 'block';
    });
    on('ssb-bubble', 'click', () => {
      if (justDragged) return; // vừa KÉO bóng xong → không mở panel
      // bấm bóng logo → mở lại panel đầy đủ
      const wrapEl = root.getElementById('ssb-wrap');
      const bubble = root.getElementById('ssb-bubble');
      if (wrapEl) wrapEl.style.display = '';
      if (bubble) bubble.style.display = 'none';
    });
    // phóng to bảng LOG / bảng LIST → cửa sổ nổi kéo thả + đổi cỡ (xem toggleFloat)
    on('ssb-logzoom', 'click', () => {
      const el = root.getElementById('ssb-log');
      const btn = root.getElementById('ssb-logzoom');
      if (!el) return;
      toggleFloat('ssb_win_log', el, 'LOG', btn, '⛶ Phóng to log', '🗕 Thu nhỏ log', {
        w: 640, h: 480,
        left: () => 24,
        top: () => Math.round(window.innerHeight * 0.1),
      });
    });
    on('ssb-slzoom', 'click', () => {
      const el = root.getElementById('ssb-sec-sl');
      const btn = root.getElementById('ssb-slzoom');
      if (!el) return;
      toggleFloat('ssb_win_list', el, 'LIST CÂU GỬI', btn, '⛶ Phóng to', '🗕 Thu nhỏ', {
        w: 560, h: 460,
        left: () => Math.max(24, Math.round(window.innerWidth * 0.3)),
        top: () => Math.round(window.innerHeight * 0.08),
      });
    });
    on('ssb-close', 'click', () => {
      const host = document.getElementById(PANEL_ID);
      if (host) host.style.display = 'none'; // F5 hoặc Alt+Shift+B để hiện lại
    });
    // chọn ảnh kèm theo
    const imgInput = root.getElementById('ssb-img');
    const imgInfo = root.getElementById('ssb-img-info');
    const imgClearBtn = root.getElementById('ssb-img-clear');
    const setImg = (file) => {
      if (state.image && state.image.url) { try { URL.revokeObjectURL(state.image.url); } catch (e) { /* ignore */ } }
      state.image = file ? { file, name: file.name || 'ảnh', url: URL.createObjectURL(file), w: 0, h: 0 } : null;
      // đọc kích thước ảnh — request thật của app gửi kèm width/height
      if (file && state.image && typeof createImageBitmap === 'function') {
        createImageBitmap(file).then((bm) => {
          if (state.image && state.image.file === file) { state.image.w = bm.width; state.image.h = bm.height; }
          if (bm.close) bm.close();
        }).catch(() => { /* không đọc được thì gửi thiếu width/height */ });
      }
      if (imgInfo) {
        imgInfo.textContent = file
          ? '📷 ' + (file.name || 'ảnh') + ' (' + Math.round((file.size || 0) / 1024) + ' KB)'
          : 'Chưa chọn ảnh';
      }
      if (imgClearBtn) imgClearBtn.style.display = file ? '' : 'none';
    };
    on('ssb-img-pick', 'click', () => { if (imgInput) imgInput.click(); });
    if (imgInput) {
      imgInput.addEventListener('change', () => {
        setImg((imgInput.files && imgInput.files[0]) || null);
      });
    }
    on('ssb-img-clear', 'click', () => {
      if (imgInput) imgInput.value = '';
      setImg(null);
    });
    // Ctrl+V: copy ảnh (screenshot, ảnh trên web…) rồi dán thẳng vào trang
    document.addEventListener('paste', (e) => {
      try {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        // đang gõ trong ô nhập của app (composer/comment…) → để app tự xử lý, không cướp paste
        const t = e.target;
        const editable = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
        if (editable && !(t && t.id === PANEL_ID)) return;
        let file = null;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it && it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) {
            file = it.getAsFile();
            if (file) break;
          }
        }
        if (!file) return; // clipboard không có ảnh → paste chữ bình thường
        e.preventDefault();
        if (!file.name) {
          // bitmap copy (screenshot) thường không có tên file
          try { file = new File([file], 'clipboard.png', { type: file.type || 'image/png' }); } catch (e2) { /* giữ file gốc */ }
        }
        setImg(file);
        logLine('📷 Đã dán ảnh từ clipboard: ' + (file.name || 'ảnh'));
      } catch (err) { /* ignore */ }
    });
    on('ssb-use-selected', 'click', () => {
      const info = selectedRowInfo();
      if (!info) { logLine('⚠ Không có chat nào đang được chọn trong danh sách'); render(); return; }
      setTarget(info, 'chat đang chọn');
    });
    on('ssb-pick', 'click', () => {
      state.pickMode = !state.pickMode;
      logLine(state.pickMode
        ? '👉 Chế độ chọn chuỗi: nhấp dòng ĐẦU, rồi nhấp tiếp dòng CUỐI (Esc để hủy)'
        : 'Đã tắt chế độ chọn chuỗi');
      render();
    });
    on('ssb-to-end', 'click', async () => {
      // Chọn TẤT CẢ chat từ chat đang mở (trong app) trở xuống cuối danh sách
      const info = selectedRowInfo();
      if (!info) {
        logLine('⚠ Không có chat nào đang được chọn — hãy bấm mở chat đó trong danh sách trước');
        render();
        return;
      }
      const btn = root.getElementById('ssb-to-end');
      if (btn) btn.disabled = true;
      try {
        // chưa tải danh sách → tải để "xuống cuối" là xuống tận cuối
        if (!state.allRows || !state.allRows.size) {
          logLine('⚡ Chưa tải danh sách — đang tải để chọn tới tận cuối…');
          await scanFullList();
        }
        const rows = sourceRows();
        const idx = rows.findIndex((r) => r.id === info.id);
        if (idx < 0) {
          logLine('⚠ Không tìm thấy chat đang chọn trong danh sách — bấm "⚡ Tải danh sách" rồi làm lại');
          return;
        }
        const last = rows[rows.length - 1];
        state.mode = 'range';
        state.target = null;
        state.rangeStart = {
          id: info.id, name: info.name, snippet: info.snippet,
          snippetRaw: info.snippetRaw, time: info.time,
        };
        state.rangeEnd = {
          id: last.id, name: last.name, snippet: last.snippet,
          snippetRaw: last.snippetRaw, time: last.time,
        };
        computeMatches();
        logLine('⬇ CHỌN TỪ ĐÂY XUỐNG CUỐI: ' + (info.name || info.id) + ' → cuối danh sách — '
          + state.matches.length + ' chat trong lựa chọn');
      } finally {
        if (btn) btn.disabled = false;
        render();
      }
    });
    on('ssb-clear', 'click', () => {
      clearSelection();
      logLine('Đã xóa lựa chọn');
      render();
    });
    on('ssb-scan', 'click', async () => {
      const btn = root.getElementById('ssb-scan');
      btn.disabled = true;
      await scanFullList();
      btn.disabled = false;
      render();
    });
    // ===== LIST CÂU GỬI =====
    on('ssb-sl-new', 'click', () => {
      const sel = state.matches.filter((m) => m.checked);
      const msgEl2 = root.getElementById('ssb-msg');
      const cauText = (msgEl2 && msgEl2.value || '');
      if (!sel.length) {
        alert('Chưa có chat nào được chọn để lưu.\nHãy chọn snippet/chuỗi (mục 1–2) và tick chọn chat rồi thử lại.');
        return;
      }
      const def = 'Câu ' + (state.savedLists.length + 1);
      const name = (prompt('Tên câu:', def) || '').trim() || def;
      const l = {
        id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name,
        text: cauText, // CÂU CẦN GỬI đang gõ lúc tạo → gắn liền với câu này (sửa được bằng nút ✎)
        items: sel.map((m) => ({
          id: m.id,
          pageId: m.pageId || String(m.id).split('_')[0] || '',
          name: m.name || '', snippet: m.snippet || '', snippetRaw: m.snippetRaw || '',
          time: m.time || '', type: m.type || '', platform: m.platform || '',
          lastAt: m.lastAt || '', fromPsid: m.fromPsid || '',
          pageId: m.pageId || '', threadId: m.threadId || '', threadKey: m.threadKey || '',
          customerName: m.customerName || '', updatedAt: m.updatedAt || '',
          hasPhone: m.hasPhone === true,
        })),
      };
      state.savedLists.push(l);
      persistSavedLists();
      renderSavedLists();
      // câu vừa tạo được GẮN với lượt gửi hiện tại — gửi xong TỰ XÓA (mỗi câu chỉ gửi 1 lần)
      state.listSel.add(l.id);
      rebuildFromLists();
      logLine('💾 Đã tạo câu “' + name + '” (' + l.items.length + ' chat'
        + (l.text ? ', kèm nội dung' : ', chưa có nội dung') + ') — gắn với lượt gửi này, gửi xong tự xóa');
    });
    const slBox = root.getElementById('ssb-sl-box');
    if (slBox) {
      let slDragId = null;
      slBox.addEventListener('click', (e) => {
        const row = e.target.closest && e.target.closest('.sl-row');
        if (!row) return;
        const id = row.getAttribute('data-id');
        const l = state.savedLists.find((x) => x.id === id);
        if (!l) return;
        if (e.target.closest && e.target.closest('.sl-handle')) return; // bấm ⠿ để kéo ≠ tích/bỏ tích
        const btn = e.target.closest('.sl-btn');
        if (btn) {
          const act = btn.getAttribute('data-act');
          if (act === 'edit') {
            openCauEditor(l); // sửa TÊN + NỘI DUNG của câu
          } else if (act === 'del') {
            if (!confirm('Xóa câu “' + l.name + '” (' + l.items.length + ' chat)?')) return;
            const wasSel = state.listSel.has(l.id);
            state.savedLists = state.savedLists.filter((x) => x.id !== id);
            if (wasSel) { state.listSel.delete(id); rebuildFromLists(); }
            persistSavedLists();
            renderSavedLists();
            logLine('🗑 Đã xóa câu “' + l.name + '”');
          }
          return;
        }
        // bấm vào dòng (hoặc ô tích) → tích/bỏ tích câu — chọn được NHIỀU câu để gửi cùng lúc
        if (state.listSel.has(id)) state.listSel.delete(id);
        else state.listSel.add(id);
        rebuildFromLists();
        renderSavedLists();
      });
      slBox.addEventListener('mousedown', (e) => {
        const h = e.target.closest && e.target.closest('.sl-handle');
        if (h) e.preventDefault(); // kéo handle không bị chọn chữ
      });
      slBox.addEventListener('dragstart', (e) => {
        const h = e.target.closest && e.target.closest('.sl-handle');
        const row = h && h.closest('.sl-row');
        if (!row) return;
        slDragId = row.getAttribute('data-id');
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', slDragId); } catch (err) { /* ignore */ }
      });
      slBox.addEventListener('dragover', (e) => {
        if (!slDragId) return;
        e.preventDefault();
        const row = e.target.closest && e.target.closest('.sl-row');
        const dragging = slBox.querySelector('.sl-row.dragging');
        if (!row || !dragging || row === dragging) return;
        const rect = row.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        slBox.insertBefore(dragging, after ? row.nextSibling : row);
      });
      slBox.addEventListener('drop', (e) => { if (slDragId) e.preventDefault(); });
      slBox.addEventListener('dragend', () => {
        if (!slDragId) return;
        slDragId = null;
        // chốt thứ tự theo DOM sau khi kéo
        const byId = new Map(state.savedLists.map((l) => [l.id, l]));
        const order = [];
        slBox.querySelectorAll('.sl-row').forEach((r) => {
          const l = byId.get(r.getAttribute('data-id'));
          if (l && order.indexOf(l) === -1) order.push(l);
        });
        state.savedLists.forEach((l) => { if (order.indexOf(l) === -1) order.push(l); });
        state.savedLists = order;
        persistSavedLists();
        renderSavedLists();
      });
    }
    renderSavedLists();
    // ===== KÉO THẢ ĐỔI CỠ PANEL (tay nắm góc dưới-phải; đúp chuột = về mặc định) =====
    {
      const rsEl = root.getElementById('ssb-rs');
      const wrapEl = root.getElementById('ssb-wrap');
      const applySize = (w, h, save) => {
        wrapEl.classList.add('sized');
        wrapEl.style.width = w + 'px';
        wrapEl.style.height = h + 'px';
        if (save) {
          try { localStorage.setItem('ssb_panel_size', JSON.stringify({ w: w, h: h })); } catch (e) { /* ignore */ }
        }
      };
      if (rsEl && wrapEl) {
        try {
          const saved = JSON.parse(localStorage.getItem('ssb_panel_size') || 'null');
          if (saved && saved.w && saved.h) applySize(saved.w, saved.h, false);
        } catch (e) { /* ignore */ }
        let rsDrag = null;
        rsEl.addEventListener('mousedown', (e) => {
          rsDrag = { x: e.clientX, y: e.clientY, w: wrapEl.offsetWidth, h: wrapEl.offsetHeight };
          e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
          if (!rsDrag) return;
          const w = Math.max(300, Math.min(window.innerWidth - 24, rsDrag.w + e.clientX - rsDrag.x));
          const h = Math.max(260, Math.min(window.innerHeight - 24, rsDrag.h + e.clientY - rsDrag.y));
          applySize(w, h, false);
        });
        window.addEventListener('mouseup', () => {
          if (!rsDrag) return;
          rsDrag = null;
          try {
            localStorage.setItem('ssb_panel_size',
              JSON.stringify({ w: wrapEl.offsetWidth, h: wrapEl.offsetHeight }));
          } catch (e) { /* ignore */ }
        });
        rsEl.addEventListener('dblclick', () => {
          wrapEl.classList.remove('sized');
          wrapEl.style.width = '';
          wrapEl.style.height = '';
          try { localStorage.removeItem('ssb_panel_size'); } catch (e) { /* ignore */ }
        });
      }
    }
    // thiết lập gửi: nạp giá trị đã lưu (giữ qua F5) + ghi lại khi chỉnh
    {
      const waveEl = root.getElementById('ssb-wave');
      const gapEl = root.getElementById('ssb-gap');
      const quickEl = root.getElementById('ssb-quick');
      try {
        const w = localStorage.getItem('ssb_wave_size_v2');
        if (w && waveEl) waveEl.value = w;
        const g = localStorage.getItem('ssb_wave_gap_v2');
        if (g !== null && g !== '' && gapEl) gapEl.value = g;
        const q = localStorage.getItem('ssb_quick');
        if (q !== null && q !== '' && quickEl) quickEl.checked = q !== '0';
      } catch (e) { /* ignore */ }
      if (waveEl) waveEl.addEventListener('change', () => {
        try { localStorage.setItem('ssb_wave_size_v2', String(waveEl.value)); } catch (e) { /* ignore */ }
      });
      if (gapEl) gapEl.addEventListener('change', () => {
        try { localStorage.setItem('ssb_wave_gap_v2', String(gapEl.value)); } catch (e) { /* ignore */ }
      });
      if (quickEl) quickEl.addEventListener('change', () => {
        try { localStorage.setItem('ssb_quick', quickEl.checked ? '1' : '0'); } catch (e) { /* ignore */ }
      });
    }
    // làm nóng Socket NGAY khi mở panel — kịp kết nối trước khi user bấm Gửi
    // (kể cả khi gửi vùi thì socket cũng đã sẵn, không còn cảnh 'Socket không kết nối')
    try {
      const st0 = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const pagesArr = (st0 && st0.pages && st0.pages.activated) || [];
      warmUpSockets(pagesArr.map((x) => ({ pageId: x && x.id })));
    } catch (e) { /* ignore */ }
    on('ssb-send', 'click', () => { sendToAll(); });
    on('ssb-stop', 'click', () => {
      state.stopRequested = true;
      logLine('⏸ Yêu cầu dừng…');
    });

    // kéo thả panel (header) VÀ bong bóng logo — di chuyển >4px mới tính là KÉO
    // (để bấm vào bóng vẫn mở panel, kéo bóng chỉ dời chỗ)
    const head = root.getElementById('ssb-head');
    const bubbleEl = root.getElementById('ssb-bubble');
    const wrap = root.getElementById('ssb-wrap');
    let drag = null;
    let justDragged = false;
    const startDrag = (e) => {
      const hostEl = document.getElementById(PANEL_ID);
      const rect = hostEl.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, r: rect, moved: false };
      e.preventDefault();
    };
    head.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      startDrag(e);
    });
    if (bubbleEl) bubbleEl.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
      if (!drag.moved) return;
      const hostEl = document.getElementById(PANEL_ID);
      if (!hostEl) return;
      hostEl.style.right = 'auto';
      hostEl.style.bottom = 'auto';
      // giữ panel/bóng luôn ló ≥40px trong màn hình (không kéo mất hẳn ra ngoài)
      const left = Math.min(Math.max(0, drag.r.left + e.clientX - drag.x), Math.max(0, window.innerWidth - 40));
      const top = Math.min(Math.max(0, drag.r.top + e.clientY - drag.y), Math.max(0, window.innerHeight - 40));
      hostEl.style.left = left + 'px';
      hostEl.style.top = top + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (drag && drag.moved) {
        justDragged = true; // nuốt click ngay sau khi kéo — không mở panel khi dời bóng
        setTimeout(() => { justDragged = false; }, 150);
      }
      drag = null;
    });
    void wrap;
  }

  function logLine(s) {
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
      + ':' + String(t.getSeconds()).padStart(2, '0');
    state.log.push('[' + hh + '] ' + s);
    if (state.log.length > 300) state.log.shift();
    const el = shadow && shadow.getElementById('ssb-log');
    if (el) {
      el.textContent = state.log.join('\n');
      el.scrollTop = el.scrollHeight;
    } else {
      console.log('[SSB]', s);
    }
  }

  function setProgress(done, total) {
    const bar = shadow && shadow.getElementById('ssb-bar');
    if (bar) bar.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
  }

  function render() {
    if (!shadow) return;
    const tgl = shadow.getElementById('ssb-toggle');
    if (tgl) {
      tgl.textContent = state.enabled ? 'BẬT' : 'TẮT';
      tgl.className = 'badge ' + (state.enabled ? 'on' : 'off');
    }
    const tgt = shadow.getElementById('ssb-target');
    if (tgt) {
      if (state.mode === 'range' && state.rangeStart && state.rangeEnd) {
        tgt.innerHTML = '🔗 Chuỗi: <b>' + esc(state.rangeStart.name || '?') + '</b> (' + esc(state.rangeStart.time || '') + ')'
          + ' → <b>' + esc(state.rangeEnd.name || '?') + '</b> (' + esc(state.rangeEnd.time || '') + ')'
          + '<br>' + state.matches.length + ' chat trong chuỗi';
      } else if (state.mode === 'range' && state.rangeStart) {
        tgt.innerHTML = '🅰 Đã đặt ĐẦU CHUỖI: <b>' + esc(state.rangeStart.name || '?') + '</b> · ' + esc(state.rangeStart.time || '')
          + '<br>Giữ Alt và nhấp tiếp dòng <b>CUỐI chuỗi</b>…';
      } else if (state.target) {
        tgt.innerHTML = '🎯 Snippet: <b>' + esc(state.target.name || '?') + '</b> · ' + esc(state.target.time || '') + '<br>'
          + esc(state.target.snippetRaw || state.target.snippet);
      } else if (state.mode === 'saved' && state.loadedName) {
        tgt.innerHTML = '📚 Câu: <b>' + esc(state.loadedName) + '</b><br>' + state.matches.length
          + ' chat trong câu — sẵn sàng gửi';
      } else {
        tgt.innerHTML = 'Chưa chọn — <b>Alt+Click 2 lần</b> (đầu → cuối chuỗi) hoặc lấy snippet từ chat đang chọn';
      }
    }
    const cnt = shadow.getElementById('ssb-count');
    if (cnt) cnt.textContent = String(state.matches.length);

    const list = shadow.getElementById('ssb-list');
    if (list) {
      // Với chuỗi hàng nghìn chat: chỉ dựng lại HTML danh sách khi ĐỔI danh sách/tick —
      // không build lại mỗi lần render (tiến độ gửi cập nhật liên tục sẽ gây đơ).
      const listKey = state.matches.map((m) => m.id + '~' + (m.checked ? 1 : 0)).join('|');
      if (listKey !== state.listKey) {
        state.listKey = listKey;
        if (!state.matches.length) {
          list.innerHTML = '<div class="empty">Trống</div>';
        } else {
          list.innerHTML = state.matches.map((m, i) => `
          <label class="item">
            <input type="checkbox" data-i="${i}" ${m.checked ? 'checked' : ''}>
            <span style="flex:1">
              <span class="nm">${esc(m.name || m.id)}${
                m.mark === 'start' ? ' <span style="color:#3b82f6">(đầu chuỗi)</span>'
                : m.mark === 'end' ? ' <span style="color:#3b82f6">(cuối chuỗi)</span>'
                : m.mark === 'target' ? ' <span style="color:#3b82f6">(nguồn snippet)</span>' : ''
              }${
                m.type === 'comment' ? ' <span style="color:#f59e0b" title="Bình luận bài viết — gửi bằng TRẢ LỜI BÌNH LUẬN công khai; mặc định bỏ tick">[bình luận]</span>'
                : (m.type === 'inbox' ? '' : ' <span style="color:#64748b" title="Không xác định loại">[?]</span>')
              }</span><br>
              <span class="sn">${esc(clip(m.snippetRaw || m.snippet, 90))}</span>
            </span>
            <span class="tm">${esc(m.time || '')}</span>
          </label>`).join('');
          list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
            cb.addEventListener('change', () => {
              const i = parseInt(cb.getAttribute('data-i'), 10);
              if (state.matches[i]) state.matches[i].checked = cb.checked;
            });
          });
        }
      }
    }
    const send = shadow.getElementById('ssb-send');
    const stop = shadow.getElementById('ssb-stop');
    if (send) send.disabled = state.sending;
    if (stop) stop.disabled = !state.sending;

    const el = shadow.getElementById('ssb-log');
    if (el) {
      el.textContent = state.log.join('\n');
      el.scrollTop = el.scrollHeight;
    }
    scheduleHighlight(); // mọi thay đổi trạng thái → vẽ lại màu trên danh sách
  }

  /* ============================ SỰ KIỆN TOÀN CỤC ============================ */

  function onDocClick(e) {
    if (!state.enabled) return;
    const item = e.target && e.target.closest && e.target.closest('.conversation-list-item');
    if (!item) return;
    const isAlt = e.altKey;
    if (!isAlt && !state.pickMode) return; // click thường = mở chat như bình thường
    const info = rowInfo(item);
    if (!info) return;
    e.preventDefault();
    e.stopPropagation();
    state.pickMode = false;
    // Alt+Click lần 1 = đầu chuỗi, lần 2 = cuối chuỗi → chọn tất cả ở giữa; lần 3 = bắt đầu chuỗi mới
    if (state.mode === 'range' && state.rangeStart && !state.rangeEnd) {
      completeRange(info).catch((err) => logLine('⚠ Lỗi khi tạo chuỗi: ' + err));
    } else {
      setRangeStart(info);
    }
    render();
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && (state.pickMode || (state.rangeStart && !state.rangeEnd))) {
      state.pickMode = false;
      if (state.rangeStart && !state.rangeEnd) {
        state.rangeStart = null;
        state.mode = null;
        highlightRows();
        logLine('Đã hủy chọn chuỗi');
      } else {
        logLine('Đã tắt chế độ chọn');
      }
      render();
      return;
    }
    if (e.altKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      const host = document.getElementById(PANEL_ID);
      if (host) {
        const showing = host.style.display === 'none';
        host.style.display = showing ? '' : 'none';
        if (showing && shadow) {
          const wrapEl = shadow.getElementById('ssb-wrap');
          const bubble = shadow.getElementById('ssb-bubble');
          if (wrapEl) wrapEl.style.display = '';
          if (bubble) bubble.style.display = 'none';
        }
      }
    }
    if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      const info = selectedRowInfo();
      if (info) setTarget(info, 'Alt+Shift+D');
    }
  }

  /* ============================ KHỞI ĐỘNG ============================ */

  hookNetwork();

  function init() {
    buildPanel();
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKeydown, true);
    logLine('Sẵn sàng. Alt+Click 2 lần (đầu → cuối chuỗi) để chọn chuỗi chat, hoặc dùng nút lấy snippet.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Gỡ lỗi cho người nâng cao: window.__SSB__
  window.__SSB__ = {
    state,
    getToken,
    sendOne,
    sendViaApi,
    sendViaSocket,
    sendViaExtension,
    scanFullList,
    visibleRows,
    computeMatches,
    clearSelection,
    setTargetByIndex(i) {
      const rows = visibleRows();
      if (rows[i]) setTarget(rows[i], 'debug');
    },
    setRangeByIndexes(i, j) {
      const rows = visibleRows();
      if (rows[i] && rows[j]) {
        setRangeStart(rows[i]);
        completeRange(rows[j]);
      }
    },
  };
})();
