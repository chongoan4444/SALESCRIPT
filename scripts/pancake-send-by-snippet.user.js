// ==UserScript==
// @name         BOTFAKE
// @namespace    salescript
// @version      1.78.0
// @description  BOTFAKE — chọn chuỗi chat (Alt+Click 2 đầu) hoặc theo snippet trong Pancake rồi gửi cùng 1 câu (kèm 1 hoặc nhiều ảnh nếu muốn) cho tất cả.
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
    scanning: false,        // đang tải danh sách
    scanStopRequested: false, // bấm nút Tải lần nữa để dừng & dùng ngay số chat đã tải
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
        try { grabTokenFromUrl(String(url || '')); } catch (e) { /* ignore */ }
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

  // Nguồn dòng để khớp: ưu tiên kết quả quét toàn bộ (state.allRows), nếu chưa quét thì các dòng đang render
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
        + ' — ' + n + ' chat trong chuỗi');
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

  const LOG_KEY = 'ssb_log';           // nhật ký gửi — giữ qua F5
  const UI_KEY = 'ssb_ui_state';       // tick câu + ô nội dung đang gõ — giữ qua F5
  const SL_BAK = SL_KEY + '_bak';      // bản dự phòng câu — chống mất dữ liệu

  function loadSavedLists() {
    try {
      const raw = localStorage.getItem(SL_KEY);
      let arr;
      if (raw === null) {
        // key chính KHÔNG CÒN (bất thường) → khôi phục từ bản dự phòng
        arr = JSON.parse(localStorage.getItem(SL_BAK) || '[]');
      } else {
        arr = JSON.parse(raw || '[]');
        if (!Array.isArray(arr)) throw new Error('dữ liệu hỏng');
      }
      if (!Array.isArray(arr)) return [];
      // câu cũ (lưu trước khi có text) → nội dung rỗng — vẫn gửi được bằng ô đang gõ
      return arr.filter((l) => l && l.id && Array.isArray(l.items))
        .map((l) => ({ ...l, text: String(l.text || '') }));
    } catch (e) {
      // dữ liệu chính hỏng → thử bản dự phòng trước khi bỏ cuộc
      try {
        const bak = JSON.parse(localStorage.getItem(SL_BAK) || '[]');
        if (Array.isArray(bak) && bak.length) {
          logLine('💾 Dữ liệu câu bị hỏng — đã khôi phục ' + bak.length + ' câu từ bản dự phòng.');
          return bak.filter((l) => l && l.id && Array.isArray(l.items))
            .map((l) => ({ ...l, text: String(l.text || '') }));
        }
      } catch (e2) { /* ignore */ }
      return [];
    }
  }

  function persistSavedLists() {
    try {
      const prev = localStorage.getItem(SL_KEY);
      if (prev && prev !== '[]') localStorage.setItem(SL_BAK, prev); // giữ 1 bản trước — chống mất dữ liệu
      localStorage.setItem(SL_KEY, JSON.stringify(state.savedLists));
      return true;
    } catch (e) {
      logLine('⚠ Không lưu được câu vào localStorage: ' + (e && e.message || e));
      return false;
    }
  }

  // Ghi trạng thái làm việc (câu đang tick + ô nội dung đang gõ) — F5 xong làm việc tiếp
  function persistUiState() {
    try {
      const msgEl = shadow && shadow.getElementById('ssb-msg');
      localStorage.setItem(UI_KEY, JSON.stringify({
        sel: Array.from(state.listSel || []),
        msg: (msgEl && msgEl.value) || '',
      }));
    } catch (e) { /* ignore — lưu trạng thái là việc phụ */ }
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
    persistUiState(); // tick câu / danh sách đổi → giữ qua F5
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
      customerId: String(cust.id || c.customer_id || ''), // uuid khách — ensureConvCtx gọi GET …/messages cần
      globalId: String(cust.global_id || c.global_id || ''), // global_id thật nếu có sẵn trong list
      seen: !!c.seen,
      isPinned: !!c.is_pinned,
      updatedTs: c.updated_at ? Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(c.updated_at) ? c.updated_at : c.updated_at + 'Z') : 0,
      customers: Array.isArray(c.customers) ? c.customers.map((x) => ({
        id: x && x.id, fb_id: x && x.fb_id, name: x && x.name,
        global_id: x && x.global_id, ad_clicks: x && x.ad_clicks,
      })) : [],
      order,
    };
  }

  function cacheGidFromConvObj(c) {
    try {
      if (!c || typeof window.__botfakeSaveGid__ !== 'function') return;
      const cid = String(c.id || '');
      const pid = String(c.page_id || c.pageId || cid.split('_')[0] || '');
      const tid = String(c.thread_id || c.threadId || '');
      const cust0 = (Array.isArray(c.customers) && c.customers[0]) || {};
      const gid = String(cust0.global_id || c.global_id || c.globalId || '');
      if (gid && cid) window.__botfakeSaveGid__(cid, pid, tid, gid);
      if (Array.isArray(c.customers) && pid) {
        c.customers.forEach((u) => {
          if (u && u.fb_id && u.global_id) {
            window.__botfakeSaveGid__(pid + '_' + u.fb_id, pid, tid, String(u.global_id));
          }
        });
      }
    } catch (e) { /* ignore */ }
  }

  function buildFormDataFromObj(obj) {
    const fd = new FormData();
    if (!obj || typeof obj !== 'object') return fd;
    Object.keys(obj).forEach((k) => {
      const val = obj[k];
      if (val !== null && typeof val === 'object' && !(val instanceof File)) {
        Object.keys(val).forEach((sub) => {
          fd.append(k + '[' + sub + ']', String(val[sub]));
        });
      } else if (val !== undefined) {
        fd.append(k, String(val));
      }
    });
    return fd;
  }

  // GET/POST an toàn cho tải danh sách: tự thử lại khi bị rate-limit (429)/5xx/lỗi mạng; trả lỗi kèm chi tiết
  async function fetchJson(url, tries, reqOpts) {
    const max = tries || 3;
    const isPost = !!(reqOpts && String(reqOpts.method || '').toUpperCase() === 'POST');
    let lastErr = '';
    for (let t = 1; t <= max; t++) {
      let abortTimer = null;
      try {
        // fetch trần KHÔNG tự hết hạn — kết nối treo là await treo theo → chặn toàn bộ lượt gửi
        const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
        if (ctl) abortTimer = setTimeout(() => ctl.abort(), 15000);
        const r = await fetch(url, {
          method: isPost ? 'POST' : 'GET',
          body: (isPost && reqOpts.bodyObj) ? buildFormDataFromObj(reqOpts.bodyObj) : undefined,
          credentials: 'include', cache: 'no-store',
          signal: ctl ? ctl.signal : undefined,
        });
        if (abortTimer) { clearTimeout(abortTimer); abortTimer = null; }
        if (r.status === 429 || r.status >= 500) {
          lastErr = 'HTTP ' + r.status;
          // Đường tải danh sách (noRetry429): trả về NGAY để cổng điều tốc trung tâm hạ nhịp —
          // tuyệt đối không tự thử lại tại đây (ôm suất chờ nhiều giây chính là nguyên nhân v1.77 siêu chậm).
          if (r.status === 429 && reqOpts && reqOpts.noRetry429) return { ok: false, error: lastErr };
          if (t < max) { await sleep(r.status === 429 ? (1100 * t + Math.floor(Math.random() * 500)) : 400 * t); continue; }
          return { ok: false, error: lastErr };
        }
        if (!r.ok) {
          const body = (typeof r.text === 'function' ? (await r.text() || '') : '').slice(0, 140);
          return { ok: false, error: 'HTTP ' + r.status + (body ? ' · ' + body : '') };
        }
        if (typeof r.text !== 'function' && typeof r.json === 'function') {
          const d = await r.json().catch(() => null);
          return d ? { ok: true, data: d } : { ok: false, error: 'Phản hồi không phải JSON' };
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
        lastErr = (e && e.name === 'AbortError') ? 'quá ' + Math.round(((reqOpts && reqOpts.timeoutMs) || 15000) / 1000) + 's chưa phản hồi' : 'Lỗi mạng: ' + (e && e.message || e);
        if (t < max) { await sleep(400 * t); continue; }
        return { ok: false, error: lastErr };
      }
    }
    return { ok: false, error: lastErr || 'Không tải được' };
  }

  // Đọc tham số danh sách GIỐNG HỆT app (buildConversationsRequest — module 907775 @1402744 trong _app):
  //   pageIdOrPageIds = pages.multiplePageMode ? pages.multiplePageIds : pages.currentPageId
  //   endpoint        = multiplePageMode ? '/api/v1/conversations' : '/api/v1/pages/{pageId}/conversations'
  //   method          = 'POST' (multipart FormData) khi có lọc `type` hoặc >20 pages (khớp pancake.vn2.har #10..#21)
  const LIST_SPECIAL_TYPES = ['NOT_PRIVATE_REPLY', 'LIVESTREAM_MARKED_ORDER', 'IS_LIVESTREAM_POST_ON',
    'IS_LIVESTREAM_POST_OFF', 'PERSONAL_MESSAGE', 'GROUP_MESSAGE', 'BIZAI_GENERATING',
    'BIZAI_NOT_GENERATING', 'BIZAI_TRANSFERRED', 'STRANGER_MESSAGE'];

  function buildListRequest(pageCount, cursor, currentCount, token, opts) {
    const st = window.__pancakeReduxStore__.getState();
    const pgs = st.pages || {};
    const auth = st.auth || {};
    const cs = st.conversations || {};
    const singlePageId = (opts && opts.singlePageId) ? String(opts.singlePageId) : '';
    const multi = !!pgs.multiplePageMode;
    const ids = singlePageId
      ? [singlePageId]
      : (multi
        ? (Array.isArray(pgs.multiplePageIds) ? pgs.multiplePageIds : [])
        : (pgs.currentPageId ? [pgs.currentPageId] : []));
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
    let types = ftype.filter((e) => LIST_SPECIAL_TYPES.indexOf(e) === -1);
    const filteredWebs = Array.isArray(cs.filteredWebs) ? cs.filteredWebs : [];
    const filteredAdIds = cs.filteredAdIds || null;
    const isInitial = !currentCount && !cursor;
    const q = new URLSearchParams();
    let method = 'GET';
    const bodyObj = {};
    const useMultiEndpoint = multi || ids.length > 1 || !!(opts && opts.forceMultiEndpoint);

    if (isInitial) {
      const hasWeb = types.some((e) => String(e).indexOf('WEB') > -1) && filteredWebs.length > 0;
      const hasAds = types.some((e) => String(e).indexOf('ADS') > -1) && !!filteredAdIds;
      if (hasWeb) types = types.filter((e) => String(e).indexOf('WEB') === -1);
      if (hasAds) types = types.filter((e) => String(e).indexOf('ADS') === -1);
      if (useMultiEndpoint) {
        if (ids.length <= 20) {
          ids.forEach((p) => q.append('pages[' + p + ']', '0'));
        } else {
          const pgMap = {};
          ids.forEach((p) => { pgMap[p] = 0; });
          bodyObj.pages = pgMap;
          method = 'POST';
        }
      }
      if (hasAds) q.append('ad_id', JSON.stringify(filteredAdIds));
      if (hasWeb) q.append('source_urls', JSON.stringify(filteredWebs.map((e) => (e && e.source) || e)));
      if (types.length) {
        bodyObj.type = types.toString();
        method = 'POST';
      }
    } else {
      q.append('current_count', String(currentCount || 60));
      if (cursor) q.append('next_cursor', cursor);
      if (filteredAdIds) q.append('ad_id', JSON.stringify(filteredAdIds));
      if (filteredWebs.length) q.append('source_urls', JSON.stringify(filteredWebs));
      if (types.length) {
        bodyObj.type = types.toString();
        method = 'POST';
      }
      if (useMultiEndpoint) {
        if (ids.length > 20) {
          const pgMap = {};
          ids.forEach((p) => { pgMap[p] = (pageCount && pageCount[p]) || 0; });
          bodyObj.pages = pgMap;
          method = 'POST';
        } else {
          ids.forEach((p) => q.append('pages[' + p + ']', String((pageCount && pageCount[p]) || 0)));
        }
      }
    }
    if (!types.length && ftype.indexOf('NOT_PRIVATE_REPLY') > -1 && ftype.indexOf('COMMENT') > -1) {
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
    q.append('unread_first', unreadFirst ? 'true' : 'false');
    q.append('mode', String(mode));
    q.append('tags', JSON.stringify(tagsVal));
    q.append('except_tags', JSON.stringify(exceptIds));
    q.append('access_token', token);
    q.append('cursor_mode', 'true');
    q.append('from_platform', 'web');
    const endpointPath = useMultiEndpoint
      ? '/api/v1/conversations'
      : ('/api/v1/pages/' + encodeURIComponent(ids[0]) + '/conversations');
    return {
      ids,
      url: location.origin + endpointPath + '?' + q.toString(),
      method,
      bodyObj: Object.keys(bodyObj).length ? bodyObj : null,
    };
  }

  // Giải mã & mã hóa next_cursor chuẩn Erlang External Term Format (:erlang.term_to_binary) của Pancake
  // (đã xác minh 100% khớp từng byte với pancake.vn2.har #10: [seen_flag, updated_at_ms, "{page_id}:{conv_id}"])
  function parseErlangCursor(b64) {
    try {
      if (!b64 || typeof b64 !== 'string') return null;
      const bin = atob(b64);
      const len = bin.length;
      if (len < 24) return null;
      if (bin.charCodeAt(0) !== 0x83 || bin.charCodeAt(1) !== 0x6c || bin.charCodeAt(5) !== 0x03) return null;
      if (bin.charCodeAt(6) !== 0x61) return null;
      const seenByte = bin.charCodeAt(7) & 0xff;
      if (bin.charCodeAt(8) !== 0x6e || bin.charCodeAt(9) !== 0x06 || bin.charCodeAt(10) !== 0x00) return null;
      let tsMs = 0;
      let mult = 1;
      for (let i = 0; i < 6; i++) {
        tsMs += (bin.charCodeAt(11 + i) & 0xff) * mult;
        mult *= 256;
      }
      if (bin.charCodeAt(17) !== 0x6d) return null;
      const strLen = (((bin.charCodeAt(18) & 0xff) << 24) >>> 0)
        + ((bin.charCodeAt(19) & 0xff) << 16)
        + ((bin.charCodeAt(20) & 0xff) << 8)
        + (bin.charCodeAt(21) & 0xff);
      if (22 + strLen + 1 !== len || bin.charCodeAt(len - 1) !== 0x6a) return null;
      const keyStr = bin.slice(22, 22 + strLen);
      return { seenByte, tsMs, keyStr };
    } catch (e) {
      return null;
    }
  }

  function encodeErlangCursor(seenByte, tsMs, keyStr) {
    try {
      const s = String(keyStr || '');
      const strLen = s.length;
      const bytes = new Uint8Array(22 + strLen + 1);
      bytes[0] = 0x83;
      bytes[1] = 0x6c;
      bytes[2] = 0; bytes[3] = 0; bytes[4] = 0; bytes[5] = 3;
      bytes[6] = 0x61;
      bytes[7] = seenByte & 0xff;
      bytes[8] = 0x6e;
      bytes[9] = 6;
      bytes[10] = 0;
      let v = Math.max(0, Math.floor(tsMs));
      for (let i = 0; i < 6; i++) {
        bytes[11 + i] = v % 256;
        v = Math.floor(v / 256);
      }
      bytes[17] = 0x6d;
      bytes[18] = (strLen >>> 24) & 0xff;
      bytes[19] = (strLen >>> 16) & 0xff;
      bytes[20] = (strLen >>> 8) & 0xff;
      bytes[21] = strLen & 0xff;
      for (let i = 0; i < strLen; i++) bytes[22 + i] = s.charCodeAt(i) & 0xff;
      bytes[22 + strLen] = 0x6a;
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    } catch (e) {
      return null;
    }
  }

  function estimatePageSpanMs(convs, fallbackMs) {
    if (!Array.isArray(convs) || convs.length < 2) return fallbackMs || 600000;
    const unpinned = convs.filter((c) => c && !c.is_pinned && !c.isPinned);
    const list = unpinned.length >= 2 ? unpinned : convs;
    const last = list[list.length - 1];
    const lastSeen = !!(last && last.seen);
    const sameSeen = list.filter((c) => !!c.seen === lastSeen);
    const arr = sameSeen.length >= 2 ? sameSeen : list;
    const tFirst = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(arr[0].updated_at || '') ? arr[0].updated_at : (arr[0].updated_at + 'Z'));
    const tLast = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(arr[arr.length - 1].updated_at || '') ? arr[arr.length - 1].updated_at : (arr[arr.length - 1].updated_at + 'Z'));
    if (!isNaN(tFirst) && !isNaN(tLast) && tFirst > tLast) {
      return Math.max(5000, tFirst - tLast);
    }
    return fallbackMs || 600000;
  }

  // 🚀 TẢI DANH SÁCH SIÊU TỐC v1.67.0 — 3 cơ chế tùy tình huống, tất cả đều KHÔNG HỞ DỮ LIỆU:
  //   A) NHIỀU PAGE (multiplePageMode / >1 page): tách mỗi page thành 1 CHUỖI CURSOR RIÊNG chạy SONG SONG
  //      (endpoint /pages/{pageId}/conversations của chính app trong _app buildConversationsRequest khi
  //      pageIdOrPageIds không phải mảng) — tối đa 10 chuỗi cùng lúc. Mỗi chuỗi đi tuần tự theo next_cursor
  //      THẬT của server nên không bao giờ hở/thiếu chat. Xong thì gộp + sắp xếp lại ĐÚNG thứ tự app
  //      (đã đối chiếu pancake.vn2.har #4: ghim trên cùng → chưa đọc → đã đọc, trong nhóm theo updated_at giảm dần).
  //   B) 1 PAGE: luồng gốc seg0 đi tuần tự từ đầu (dữ liệu mới tinh 100%) + tối đa 10 luồng phụ chạy ĐỘC LẬP
  //      (không chờ nhau theo vòng) ở các mốc thời gian phía trước theo cursor Erlang ETF tự tổng hợp;
  //      hễ seg0 chạm đầu 1 đoạn phụ là KHÂU cả đoạn vào và nhảy cursor qua đoạn đó — bỏ qua được
  //      hàng loạt request tuần tự. Luồng phụ nào treo cũng không chặn được luồng gốc.
  //   C) Lọc tag lúc gửi (forceTags / maxPages): tuần tự như cũ (chỉ cần 1 trang).
  //   Cả A & B đều DỪNG NGAY khi chuỗi 2 đầu (range) đã đủ 2 đầu hoặc user bấm dừng.
  async function loadListViaApi(onProgress, opts) {
    const token = getToken();
    if (!token) return { ok: false, error: 'Không lấy được access token' };
    const startedAt = Date.now();
    const plainMode = !opts || (!opts.forceTags && !opts.maxPages);

    const isRangeSatisfied = (idSet) => {
      if (!plainMode) return false;
      if (state.mode === 'range' && state.rangeStart && state.rangeEnd) {
        return idSet.has(state.rangeStart.id) && idSet.has(state.rangeEnd.id);
      }
      return false;
    };
    const stopped = () => state.scanStopRequested;

    // 🧯 CỔNG ĐIỀU TỐC TẢI DANH SÁCH (v1.77.0): log console cho thấy server Pancake trả 429
    // (Too Many Requests) hàng loạt khi mở 21 chuỗi cùng lúc — request bị từ chối phải thử lại
    // nên tổng thời gian còn LÂU hơn. Cổng này: tối đa 8 request danh sách đang bay; hễ gặp 429
    // thì hạ trần (tối thiểu 3) + đóng băng chung 1,5s cho MỌI chuỗi; chạy êm 24 request liên
    // tiếp thì nâng dần (tối đa 12). Các luồng phụ vẫn sinh đủ 20 để phủ dữ liệu, chỉ request
    // thật mới phải qua cổng.
    const listGate = { inFlight: 0, limit: 6, cooldownUntil: 0, okStreak: 0, hit429: 0 };
    const gateAcquire = async () => {
      for (;;) {
        if (stopped()) return false;
        if (listGate.inFlight < listGate.limit && Date.now() >= listGate.cooldownUntil) {
          listGate.inFlight++;
          return true;
        }
        await sleep(60);
      }
    };
    const gateRelease = (was429) => {
      listGate.inFlight = Math.max(0, listGate.inFlight - 1);
      if (was429) {
        listGate.hit429++;
        listGate.okStreak = 0;
        listGate.limit = Math.max(2, listGate.limit - 1); // hạ NHẸ tay (v1.77 hạ -2 + ôm suất thử lại gây siêu chậm)
        listGate.cooldownUntil = Date.now() + 2500;
      } else {
        listGate.okStreak++;
        if (listGate.okStreak >= 16 && listGate.limit < 10) { listGate.limit++; listGate.okStreak = 0; }
      }
    };

    const fetchPage = async (pageCount, cursor, currentCount, extra) => {
      const eo = Object.assign({}, opts || {}, extra || {});
      const req = buildListRequest(pageCount, cursor, currentCount, token, eo.forceMulti || eo.singlePageId ? eo : opts);
      if (!req.ids.length) return { ok: false, error: 'Không xác định được page đang xem' };
      if (!(await gateAcquire())) return { ok: false, error: 'stopped' };
      let res = null;
      try {
        res = await fetchJson(req.url, eo.tries || 3, { method: req.method, bodyObj: req.bodyObj, timeoutMs: eo.timeoutMs || 12000, noRetry429: true });
      } finally {
        gateRelease(!!(res && !res.ok && /429/.test(res.error || '')));
      }
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'fetch lỗi' };
      const j = res.data || {};
      if (j.success === false) return { ok: false, error: j.message || j.error || 'success=false' };
      return { ok: true, data: j, ids: req.ids, unreadFirst: req.unreadFirst };
    };

    const pushConvs = (seg, convs) => {
      let added = 0;
      (convs || []).forEach((c) => {
        const id = String((c && c.id) || '');
        if (!id || seg.set.has(id)) return;
        cacheGidFromConvObj(c);
        seg.set.add(id);
        seg.items.push(convApiRow(c, seg.items.length));
        added++;
      });
      return added;
    };

    // ---------- C) TUẦN TỰ (lọc tag / giới hạn trang) ----------
    const loadSequential = async () => {
      const seg = { items: [], set: new Set(), cursor: null, pageCount: {} };
      let guard = 0;
      let forceMulti = false;
      while (guard++ < 1500 && !stopped()) {
        const res = await fetchPage(seg.pageCount, seg.cursor, seg.items.length, { forceMulti });
        if (!res.ok) {
          if (guard === 1 && !forceMulti) { forceMulti = true; guard--; continue; }
          return guard === 1 ? { ok: false, error: 'API danh sách lỗi trang 1: ' + res.error } : { ok: true, rows: seg.items };
        }
        const j = res.data || {};
        const convs = j.conversations || [];
        const added = pushConvs(seg, convs);
        if (j.pages_with_current_count) seg.pageCount = Object.assign({}, seg.pageCount, j.pages_with_current_count);
        seg.cursor = (convs.length && j.next_cursor) ? j.next_cursor : null;
        if (onProgress) onProgress(seg.items.length, seg.items);
        if (!seg.cursor || !convs.length || !added || (opts && opts.maxPages && guard >= opts.maxPages)) break;
      }
      return { ok: true, rows: seg.items };
    };

    if (!plainMode) return loadSequential();

    // Đọc danh sách page + unread_first từ request mẫu (chưa bắn mạng)
    let probeIds = [];
    let unreadFirst = true;
    try {
      const probe = buildListRequest({}, null, 0, token, opts);
      probeIds = probe.ids || [];
      unreadFirst = probe.unreadFirst !== false;
    } catch (e) { /* dùng đường tuần tự bên dưới */ }

    // ---------- A) NHIỀU PAGE → MỖI PAGE 1 CHUỖI SONG SONG ----------
    if (probeIds.length >= 2) {
      const perPage = new Map(); // pageId -> rows[]
      const allSet = new Set();
      let total = 0;
      let firstPageErrors = 0;
      let midErrors = 0;
      let stopAll = false;
      const queue = probeIds.slice();
      const chain = async (pid) => {
        const seg = { items: [], set: new Set(), cursor: null, pageCount: {}, started: false };
        perPage.set(pid, seg.items);
        let guard = 0;
        while (guard++ < 1500 && !stopAll && !stopped()) {
          const res = await fetchPage({}, seg.cursor, seg.items.length, { singlePageId: pid, tries: seg.started ? 2 : 3, timeoutMs: 12000 });
          if (!res.ok) {
            if (/429/.test(res.error || '') && (seg.retry429 = (seg.retry429 || 0) + 1) <= 12) { await sleep(1200 + Math.random() * 800); continue; }
            if (!seg.started) firstPageErrors++; else midErrors++; return;
          }
          seg.started = true;
          const j = res.data || {};
          const convs = j.conversations || [];
          const before = seg.items.length;
          (convs || []).forEach((c) => {
            const id = String((c && c.id) || '');
            if (!id || seg.set.has(id) || allSet.has(id)) return;
            cacheGidFromConvObj(c);
            seg.set.add(id); allSet.add(id);
            seg.items.push(convApiRow(c, 0));
          });
          total += seg.items.length - before;
          seg.cursor = (convs.length && j.next_cursor) ? j.next_cursor : null;
          if (onProgress) onProgress(total, null);
          if (!seg.cursor || !convs.length || seg.items.length === before) return;
          if (isRangeSatisfied(allSet)) { stopAll = true; return; }
        }
      };
      const POOL = Math.min(24, queue.length); // v1.76.0: HTTP/2+H3 — chạy gần như mọi page cùng lúc
      const workers = [];
      for (let w = 0; w < POOL; w++) {
        workers.push((async () => { while (queue.length && !stopAll && !stopped()) { const pid = queue.shift(); await chain(pid); } })());
      }
      await Promise.all(workers);
      // Page nào lỗi trang đầu (endpoint lẻ không được) → bù bằng đường chung tuần tự nếu mất quá nhiều
      if (!total || firstPageErrors >= Math.ceil(probeIds.length / 2) || midErrors > 0) {
        logLine('⚠ Tải song song theo page không khả thi — chuyển về tải đa luồng chung…');
        return loadSequentialOrStitch();
      }
      const rows = [];
      perPage.forEach((arr) => { arr.forEach((r) => rows.push(r)); });
      // Thứ tự app (HAR #4): ghim ↑ → chưa đọc ↑ → đã đọc, trong nhóm updated_at giảm dần
      rows.sort((a, b) => {
        if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
        if (unreadFirst && !!a.seen !== !!b.seen) return a.seen ? 1 : -1;
        return (b.updatedTs || 0) - (a.updatedTs || 0);
      });
      rows.forEach((r, i) => { r.order = i; });
      logLine('⚡⚡ Tải song song ' + probeIds.length + ' page: ' + rows.length + ' chat trong ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's'
        + ' (~' + Math.round(rows.length / Math.max(1, (Date.now() - startedAt) / 1000)) + ' chat/giây)'
        + (listGate.hit429 ? ' · ⚠ dính 429×' + listGate.hit429 + ' (đã tự điều tốc)' : ''));
      if (onProgress) onProgress(rows.length, rows);
      return { ok: true, rows };
    }

    return loadSequentialOrStitch();

    // ---------- B) 1 PAGE → LUỒNG GỐC + LUỒNG PHỤ ĐỘC LẬP, KHÂU ĐOẠN ----------
    async function loadSequentialOrStitch() {
      let forceMultiEndpoint = false;
      let p1;
      try {
        p1 = await fetchPage({}, null, 0, {});
        if (!p1.ok) {
          const retryMulti = await fetchPage({}, null, 0, { forceMulti: true });
          if (retryMulti.ok) { p1 = retryMulti; forceMultiEndpoint = true; }
        }
      } catch (e) {
        return { ok: false, error: 'Không đọc được bộ lọc của app: ' + (e && e.message || e) };
      }
      if (!p1 || !p1.ok) return { ok: false, error: 'API danh sách lỗi trang 1: ' + ((p1 && p1.error) || 'Không tải được') };

      const seg0 = {
        items: [], set: new Set(),
        cursor: (p1.data && p1.data.next_cursor) || null,
        pageCount: Object.assign({}, (p1.data && p1.data.pages_with_current_count) || {}),
        spanMs: estimatePageSpanMs((p1.data && p1.data.conversations) || [], 600000),
      };
      pushConvs(seg0, (p1.data && p1.data.conversations) || []);
      if (onProgress) onProgress(seg0.items.length, seg0.items);
      if (!seg0.cursor || stopped() || isRangeSatisfied(seg0.set)) return { ok: true, rows: seg0.items };

      const parsed0 = parseErlangCursor(seg0.cursor);
      if (!parsed0) {
        // Cursor lạ → tuần tự từ trang 2
        let guard = 1;
        while (guard++ < 1500 && !stopped()) {
          const before = seg0.items.length;
          const res = await fetchPage(seg0.pageCount, seg0.cursor, seg0.items.length, { forceMulti: forceMultiEndpoint });
          if (!res.ok) break;
          const j = res.data || {};
          pushConvs(seg0, j.conversations || []);
          if (j.pages_with_current_count) seg0.pageCount = Object.assign({}, seg0.pageCount, j.pages_with_current_count);
          seg0.cursor = (j.conversations && j.conversations.length && j.next_cursor) ? j.next_cursor : null;
          if (onProgress) onProgress(seg0.items.length, seg0.items);
          if (!seg0.cursor || seg0.items.length === before || isRangeSatisfied(seg0.set)) break;
        }
        return { ok: true, rows: seg0.items };
      }

      // v1.76.0: 20 luồng phụ (thay vì 10), mỗi luồng bắt đầu cách nhau ~1 trang (1 span)
      // → tổng 21 chuỗi cursor chạy song song trên cùng 1 page.
      const STRIDES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
      const samplePageId = parsed0.keyStr.split(':')[0] || String((p1.ids && p1.ids[0]) || '');
      const dummyKeyStr = samplePageId + ':' + samplePageId + '_99999999999999999999';
      const segments = [];
      let helpersDone = false;
      let strideIdx = 0;

      const stitch = () => {
        let changed = true;
        while (changed) {
          changed = false;
          for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.absorbed || !seg.items.length) continue;
            if (seg0.set.has(seg.items[0].id)) {
              for (let k = 0; k < seg.items.length; k++) {
                const r = seg.items[k];
                if (!seg0.set.has(r.id)) { seg0.set.add(r.id); r.order = seg0.items.length; seg0.items.push(r); }
              }
              if (seg.cursorReal) {
                const p0 = seg0.cursor ? parseErlangCursor(seg0.cursor) : null;
                const pS = seg.cursor ? parseErlangCursor(seg.cursor) : null;
                if (!seg.cursor || (p0 && pS && (pS.seenByte > p0.seenByte || (pS.seenByte === p0.seenByte && pS.tsMs < p0.tsMs)))) {
                  seg0.cursor = seg.cursor;
                  seg0.spanMs = seg.spanMs || seg0.spanMs;
                  seg0.pageCount = Object.assign({}, seg0.pageCount, seg.pageCount);
                }
              }
              seg.absorbed = true;
              changed = true;
            }
          }
          // đoạn phụ chạm nhau → nối lại để seg0 khâu 1 lần được đoạn dài hơn
          for (let i = 0; i < segments.length; i++) {
            const sa = segments[i];
            if (sa.absorbed || !sa.items.length) continue;
            for (let j = 0; j < segments.length; j++) {
              if (i === j) continue;
              const sb = segments[j];
              if (sb.absorbed || !sb.items.length) continue;
              if (sa.set.has(sb.items[0].id)) {
                for (let k = 0; k < sb.items.length; k++) {
                  const r = sb.items[k];
                  if (!sa.set.has(r.id)) { sa.set.add(r.id); sa.items.push(r); }
                }
                if (sb.cursorReal) {
                  const pA = sa.cursor ? parseErlangCursor(sa.cursor) : null;
                  const pB = sb.cursor ? parseErlangCursor(sb.cursor) : null;
                  if (!sb.cursor || (pA && pB && (pB.seenByte > pA.seenByte || (pB.seenByte === pA.seenByte && pB.tsMs < pA.tsMs)))) {
                    sa.cursor = sb.cursor; sa.spanMs = sb.spanMs || sa.spanMs;
                    sa.pageCount = Object.assign({}, sa.pageCount, sb.pageCount);
                  }
                }
                sb.absorbed = true;
                changed = true;
              }
            }
          }
        }
      };

      const spawnHelper = () => {
        const base = seg0.cursor ? parseErlangCursor(seg0.cursor) : null;
        if (!base || helpersDone) return;
        const mult = STRIDES[strideIdx++ % STRIDES.length];
        const seg = {
          items: [], set: new Set(),
          cursor: encodeErlangCursor(base.seenByte, base.tsMs - Math.round(Math.max(5000, seg0.spanMs || 600000) * mult), dummyKeyStr),
          pageCount: Object.assign({}, seg0.pageCount),
          spanMs: seg0.spanMs, estCount: seg0.items.length + Math.round(60 * mult),
          absorbed: false, cursorReal: false,
        };
        if (!seg.cursor) return;
        segments.push(seg);
        (async () => {
          // Luồng phụ chạy ĐỘC LẬP: cứ đi tiếp về phía cũ, khâu được lúc nào hay lúc đó;
          // treo/lỗi thì tự chết, tuyệt đối không chặn luồng gốc (không còn Promise.all theo vòng).
          while (!helpersDone && !stopped() && !seg.absorbed && seg.cursor) {
            const res = await fetchPage(seg.pageCount, seg.cursor, seg.estCount + seg.items.length, { forceMulti: forceMultiEndpoint, tries: 2, timeoutMs: 10000 });
            if (!res.ok) {
              if (/429/.test(res.error || '') && (seg.retry429 = (seg.retry429 || 0) + 1) <= 12) { await sleep(1200 + Math.random() * 800); continue; }
              return;
            }
            const j = res.data || {};
            const convs = j.conversations || [];
            if (!convs.length) { seg.cursor = null; return; }
            pushConvs(seg, convs);
            if (convs.length >= 2) seg.spanMs = estimatePageSpanMs(convs, seg.spanMs);
            if (j.pages_with_current_count) seg.pageCount = Object.assign({}, seg.pageCount, j.pages_with_current_count);
            seg.cursor = j.next_cursor || null;
            seg.cursorReal = true;
            stitch();
            if (onProgress) onProgress(seg0.items.length, seg0.items);
            if (isRangeSatisfied(seg0.set)) { helpersDone = true; return; }
          }
        })().catch(() => {});
      };

      for (let h = 0; h < STRIDES.length; h++) spawnHelper();

      // Luồng gốc: đi tuần tự, khâu đoạn nào dùng đoạn đó, xong là dừng hết luồng phụ
      let guard = 0;
      while (guard++ < 1500 && seg0.cursor && !stopped()) {
        const before = seg0.items.length;
        const res = await fetchPage(seg0.pageCount, seg0.cursor, seg0.items.length, { forceMulti: forceMultiEndpoint, tries: 3, timeoutMs: 12000 });
        if (!res.ok) {
          // 429 không được cắt đứt danh sách: nghỉ cho server hạ nhiệt rồi tải tiếp ĐÚNG cursor này
          if (/429/.test(res.error || '') && (seg0.retry429 = (seg0.retry429 || 0) + 1) <= 12) { await sleep(1500); continue; }
          break;
        }
        const j = res.data || {};
        const convs = j.conversations || [];
        pushConvs(seg0, convs);
        if (convs.length >= 2) seg0.spanMs = estimatePageSpanMs(convs, seg0.spanMs);
        if (j.pages_with_current_count) seg0.pageCount = Object.assign({}, seg0.pageCount, j.pages_with_current_count);
        seg0.cursor = (convs.length && j.next_cursor) ? j.next_cursor : null;
        stitch();
        if (onProgress) onProgress(seg0.items.length, seg0.items);
        if (seg0.items.length === before || !seg0.cursor || isRangeSatisfied(seg0.set)) break;
        // Bổ sung luồng phụ thay những luồng đã khâu/chết, luôn giữ ~10 luồng chạy phía trước
        const alive = segments.filter((s) => !s.absorbed && s.cursor).length;
        for (let s = alive; s < STRIDES.length; s++) spawnHelper();
      }
      helpersDone = true;
      logLine('⚡⚡ Tải đa luồng 1 page: ' + seg0.items.length + ' chat trong ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's'
        + ' (~' + Math.round(seg0.items.length / Math.max(1, (Date.now() - startedAt) / 1000)) + ' chat/giây)'
        + (listGate.hit429 ? ' · ⚠ dính 429×' + listGate.hit429 + ' (đã tự điều tốc)' : ''));
      return { ok: true, rows: seg0.items };
    }
  }


  /* ============================ LỌC TAG "CHỐT"/"CHẶN" LÚC GỬI ============================
     Trong lúc chờ gửi, sale có thể đã gắn tag "…chốt" (đã chốt đơn — KHÔNG được gửi tiếp)
     hoặc tag "chặn". Lúc bấm Gửi: tải lại tag MỘT LƯỢT (API lọc sẵn theo tag) rồi bỏ qua. */

  // Bảng Map O(1) tra cứu nhanh conversation trong Redux store (tránh .find() O(N²) khi gửi 30.000 chat)
  let reduxDataArrRef = null, reduxDataMap = null;
  let reduxCloneArrRef = null, reduxCloneMap = null;
  function getReduxConvById(id, listIdx) {
    if (!id) return null;
    const sid = String(id);
    try {
      const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
      const cs = st && st.conversations;
      if (!cs) return null;
      if (listIdx !== 1 && Array.isArray(cs.data)) {
        if (cs.data !== reduxDataArrRef) {
          reduxDataArrRef = cs.data;
          reduxDataMap = new Map();
          for (let i = 0; i < cs.data.length; i++) {
            const c = cs.data[i];
            if (c && c.id !== undefined) reduxDataMap.set(String(c.id), c);
          }
        }
        const hit = reduxDataMap.get(sid);
        if (hit) return hit;
      }
      if (listIdx !== 0 && Array.isArray(cs.filteredConversationsCloneList)) {
        if (cs.filteredConversationsCloneList !== reduxCloneArrRef) {
          reduxCloneArrRef = cs.filteredConversationsCloneList;
          reduxCloneMap = new Map();
          for (let i = 0; i < cs.filteredConversationsCloneList.length; i++) {
            const c = cs.filteredConversationsCloneList[i];
            if (c && c.id !== undefined) reduxCloneMap.set(String(c.id), c);
          }
        }
        const hit2 = reduxCloneMap.get(sid);
        if (hit2) return hit2;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

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
      for (let i = 0; i < 2; i++) {
        const hit = getReduxConvById(m && m.id, i);
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
      for (let i = 0; i < 2; i++) {
        const hit = getReduxConvById(m && m.id, i);
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

  // 🛡 BAN GUARD (v1.69.0): tập hợp TOÀN BỘ id chat đang dính tag cấm, nạp từ API lọc theo tag
  // (server tự lọc — không phụ thuộc dòng chat có đang hiển thị hay redux đã nạp hay chưa).
  // Được làm mới trước lượt gửi VÀ quét lại giữa lượt (mỗi 3.000 tin) để bắt cả tag vừa gắn trong lúc gửi.
  const banGuard = { nameById: {}, convIds: new Set(), tagIds: [] };
  let banSweepRunning = false;
  async function sweepBannedConvIds() {
    if (!banGuard.tagIds.length || banSweepRunning) return { added: 0, nameOf: {} };
    banSweepRunning = true;
    try {
      const res = await Promise.race([
        loadListViaApi(null, { forceTags: banGuard.tagIds.slice(), maxPages: 300 }),
        sleep(25000).then(() => ({ ok: false, error: 'quá 25s' })),
      ]);
      if (!res || !res.ok) return { added: 0, nameOf: {} };
      let added = 0;
      const nameOf = {};
      (res.rows || []).forEach((r) => {
        if (!r || !r.id) return;
        // server đã lọc theo tag; nếu dòng có tags thì đối chiếu lại cho chắc
        const hit = (r.tags || []).map(String).find((t) => banGuard.nameById[t]);
        if (hit) nameOf[r.id] = banGuard.nameById[hit];
        if ((hit || !(r.tags || []).length) && !banGuard.convIds.has(r.id)) {
          banGuard.convIds.add(r.id);
          added++;
        }
      });
      return { added, nameOf };
    } catch (e) { return { added: 0, nameOf: {} }; } finally { banSweepRunning = false; }
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
      // Page nào redux CHƯA nạp bảng tag → tự gọi GET /pages/{id}/settings (đúng request app gọi
      // trong _app @331980, trả settings.tags) để lấy đủ bảng tag, tránh mù lọc hoàn toàn cho page đó.
      const pagesNoDefs = Object.keys(seenPage).filter((pid) => {
        let defs = defsByPage[pid];
        if (!Array.isArray(defs) && Array.isArray(defsByPage)) defs = defsByPage;
        return !(defs || []).some((t) => tagBanName(String((t && (t.text || t.name || t.title || t.label)) || '')));
      });
      const tagOf = {}; // convId → TÊN tag cấm mà nó mang (để log cho user soi)
      // 🚀 BẮN NGAY (v1.75.0): KHÔNG await quét tag nữa — lượt gửi bắt đầu tức thì với 2 lớp lọc
      // đồng bộ có sẵn (tag trên dòng chat + filledTags/dữ liệu app). Việc tải bảng tag còn thiếu
      // + quét TOÀN BỘ chat dính tag cấm qua API chạy NỀN: nạp tới đâu, chốt chặn trước từng tin
      // (sendOneAndLog late-gate, check banGuard.convIds) chặn tới đó + quét lại mỗi 3.000 tin.
      banGuard.nameById = banNameById;
      banGuard.tagIds = Array.from(banIds);
      banGuard.convIds = new Set();
      const bgBanPrep = (async () => {
        for (let pi = 0; pi < pagesNoDefs.length; pi++) {
          try {
            const pid2 = pagesNoDefs[pi];
            const sres = await fetchJson(apiBase() + '/v1/pages/' + encodeURIComponent(pid2)
              + '/settings?access_token=' + encodeURIComponent(getToken() || '')
              + '&separate_pos=true&separate_qr=true', 2, { timeoutMs: 8000 });
            const stags = (sres && sres.ok && sres.data && sres.data.settings && sres.data.settings.tags) || [];
            stags.forEach((t) => {
              const nm = String((t && (t.text || t.name || t.title || t.label)) || '');
              if (tagBanName(nm)) {
                banIds.add(t.id);
                banNameById[String(t.id)] = nm;
                if (banNames.indexOf(nm) < 0) banNames.push(nm);
              }
            });
          } catch (e) { /* thiếu bảng tag của 1 page không được làm hỏng lượt gửi */ }
        }
        banGuard.nameById = banNameById;
        banGuard.tagIds = Array.from(banIds);
        if (!banIds.size) {
          logLine('⚠ Không có bảng tag của trang — soi tag theo DÒNG CHAT + dữ liệu app (filledTags).');
          return;
        }
        const preview = banNames.slice(0, 3).map((x) => '"' + x + '"').join(', ')
          + (banNames.length > 3 ? '… +' + (banNames.length - 3) + ' tag' : '');
        logLine('🔎 Quét nền tag cấm: trang có ' + banNames.length + ' tag cấm (' + preview
          + ') — đang quét TOÀN BỘ chat dính các tag này qua API (vẫn bắn ngay, chat nào bị phát hiện sẽ bị chặn ở chốt trước từng tin)…');
        const sweep0 = await sweepBannedConvIds();
        Object.keys(sweep0.nameOf || {}).forEach((cid) => { tagOf[cid] = sweep0.nameOf[cid]; });
        logLine('🛡 Đã nạp ' + banGuard.convIds.size + ' chat đang dính tag cấm — từ đây các chat này sẽ bị bỏ qua 100%.');
      })();
      bgBanPrep.catch(() => {});
      // BẰNG CHỨNG ĐỦ 3 LỚP cho từng chat — lớp nào bắt được trước thì dùng, log kèm tên tag:
      //   1) tag hiển thị TRÊN DÒNG CHAT (DOM) — mắt thấy gì dùng nấy
      //   2) dữ liệu app: filledTags (app tự map tên) / tags id + bảng tag trang
      //   3) kết quả tải lại tag theo API (tagOf) — kiểm tra cả khi server lơ tham số lọc
      targets.forEach((m) => {
        const why = (banGuard.convIds.has(m.id) ? (tagOf[m.id] || 'tag cấm (API)') : null)
          || rowBanTagFromDom(m) || convBanTagFromData(m, banNameById) || tagOf[m.id] || null;
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
  // Khi người dùng bấm "⚡ Tải danh sách": PHẢI XÓA SẠCH DANH SÁCH CŨ (state.allRows = null)
  // rồi tải lại danh sách mới hoàn toàn từ đầu. Nếu đang tải dở mà bấm lần 2 → dừng ngay & dùng số chat đã tải!
  async function scanFullList() {
    if (state.scanning) {
      state.scanStopRequested = true;
      logLine('⏹ Đã yêu cầu dừng tải danh sách — dùng ngay số chat vừa tải!');
      return;
    }
    const scroller = getScroller();
    if (!scroller) {
      logLine('⚠ Không tìm thấy khung danh sách đoạn chat (#conversationList)');
      return;
    }
    const btn = shadow && shadow.getElementById('ssb-scan');
    const setBtn = (t) => { if (btn) btn.textContent = t; };

    state.scanning = true;
    state.scanStopRequested = false;

    try {
      // XÓA SẠCH DANH SÁCH CŨ TRƯỚC KHI TẢI LẠI — tránh giữ lại dữ liệu/thứ tự cũ gây lỗi
      state.allRows = null;
      if (state.mode !== 'saved') {
        state.matches = [];
      }
      highlightRows();
      render();

      // 1) TẢI ĐA LUỒNG QUA API — siêu nhanh, không cuộn, cập nhật live từng chặng
      logLine('⚡ Đã xóa danh sách cũ — đang tải lại danh sách mới đa luồng qua API (bấm nút lần nữa nếu muốn dừng & dùng ngay)…');
      setBtn('⏹ Dừng tải (0 chat)');
      let lastLiveSync = 0;
      let lastSyncedLen = 0;
      const syncLiveRows = (rowsArr) => {
        if (!Array.isArray(rowsArr) || !rowsArr.length) return;
        const now = Date.now();
        if (now - lastLiveSync < 400) return;
        lastLiveSync = now;
        // NỐI THÊM PHẦN MỚI (incremental): seg0.items chỉ NỐI DÀI ở đuôi nên chỉ việc
        // thêm các dòng từ vị trí đã đồng bộ — không dựng lại Map toàn bộ sau mỗi chặng
        // (trước đây danh sách 20–30k chat bị dựng lại từ đầu mỗi 220ms → chậm dần theo độ dài).
        if (!state.allRows || rowsArr.length < lastSyncedLen) {
          state.allRows = new Map();
          lastSyncedLen = 0;
        }
        for (let i = lastSyncedLen; i < rowsArr.length; i++) {
          const r = rowsArr[i];
          r.order = i;
          state.allRows.set(r.id, r);
        }
        lastSyncedLen = rowsArr.length;
        // v1.76.0: chỉ cập nhật số đếm O(1) — computeMatches() để dành chạy 1 lần khi tải xong,
        // tránh nghẽn main-thread làm chậm giải mã JSON của các request danh sách đang bay.
        const cntEl = shadow && shadow.getElementById('ssb-count');
        if (cntEl) cntEl.textContent = String(state.allRows.size);
      };

      const api = await loadListViaApi((n, rowsArr) => {
        setBtn('⏹ Dừng tải (' + n + ' chat)');
        syncLiveRows(rowsArr);
      });
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

      // 2) QUÉT GIAO DIỆN (dự phòng tốc độ cao) — luôn khớp đúng những gì đang thấy trên màn hình
      const savedTop = scroller.scrollTop;
      const found = new Map();
      let guard = 0;
      logLine('⚡ Đang quét danh sách trên giao diện…');

      const collect = () => {
        let added = 0;
        visibleRows().forEach((r) => {
          if (!found.has(r.id)) {
            const rdx = getReduxConvById(r.id, 0);
            const extra = rdx ? convApiRow(rdx, found.size) : {};
            found.set(r.id, { ...extra, ...r }); // thứ tự Map = thứ tự trên→dưới
            added++;
          }
        });
        return added;
      };

      scroller.scrollTop = 0;
      await sleep(60);
      collect();
      setBtn('⏹ Dừng tải (' + found.size + ' chat)');

      const step = Math.max(320, Math.round(scroller.clientHeight * 1.5));
      let noNewStreak = 0;
      while (guard++ < 5000 && !state.scanStopRequested) {
        const prevTop = scroller.scrollTop;
        scroller.scrollTop = prevTop + step;
        let atBottom = false;
        if (scroller.scrollTop === prevTop) {
          try {
            scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: step, bubbles: true, cancelable: true }));
          } catch (e) { /* ignore */ }
          await sleep(60);
          atBottom = scroller.scrollTop === prevTop;
        }
        await sleep(45);
        const added = collect();
        if (state.mode === 'range' && state.rangeStart && state.rangeEnd && found.has(state.rangeStart.id) && found.has(state.rangeEnd.id)) {
          break;
        }
        if (atBottom) {
          const t0 = Date.now();
          while (Date.now() - t0 < 260 && !state.scanStopRequested) {
            await sleep(65);
            if (collect() > 0) { setBtn('⏹ Dừng tải (' + found.size + ' chat)'); }
          }
          break;
        }
        if (added === 0) {
          noNewStreak++;
          if (noNewStreak >= 2) {
            await sleep(140);
            collect();
            noNewStreak = 0;
          }
        } else {
          noNewStreak = 0;
        }
        if (guard % 6 === 0) setBtn('⏹ Dừng tải (' + found.size + ' chat)');
      }

      scroller.scrollTop = savedTop;
      await sleep(60);

      visibleRows().forEach((r) => {
        if (found.has(r.id)) found.set(r.id, { ...found.get(r.id), ...r });
      });
      let ord = 0;
      found.forEach((v) => { v.order = ord++; });
      state.allRows = found;
      setBtn('⚡ Tải danh sách (' + found.size + ' chat)');
      logLine('⚡ Tải xong: ' + found.size + ' chat trong danh sách');
      computeMatches();
      render();
    } finally {
      state.scanning = false;
      state.scanStopRequested = false;
      if (btn && state.allRows) {
        setBtn('⚡ Tải danh sách (' + state.allRows.size + ' chat)');
      } else if (btn) {
        setBtn('⚡ Tải danh sách');
      }
    }
  }

  /* ============================ GỬI TIN (API → EXTENSION → GIAO DIỆN) ============================ */

  // Đọc conversation từ redux store của trang (hoặc bảng allRows đã tải qua API) — có đủ
  // last_customer_interactive_at, customers, customerId, threadId, threadKey, updatedAt…
  function peekConv(conv) {
    try {
      if (conv && conv.id) {
        const hit = getReduxConvById(conv.id, 0);
        if (hit) return hit;
        if (state && state.allRows && state.allRows.has(conv.id)) {
          return state.allRows.get(conv.id);
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ---- DỮ LIỆU CHAT: NẠP ĐÚNG NGUỒN CỦA APP (HAR tinnhan.har + tinnhan1.har) ----
  // GET /v1/pages/{p}/conversations/{id}/messages?customer_id=…&user_view=true&is_new_api=true
  // &separate_pos=true — request app gọi MỖI LẦN MỞ CHAT — trả về:
  //   - customers[0].ad_clicks + ad_clicks map → dr() quyết cờ is_record_ctx_7_days;
  //   - global_id (đúng ID KHÁCH — nhiều khách ≠ PSID! tinnhan1.har: "61576542790011",
  //     "100025260544548"… — app gửi Ext/Socket bằng id NÀY, không phải from_psid).
  // LIST chat KHÔNG có 2 thứ này → gửi hàng loạt mà không nạp = thiếu cờ (#10 oan) + bắn nhầm id
  // (Ext "không gửi được", Socket "server báo gửi thất bại") — đúng 2 triệu chứng trong log.
  const convCtxCache = {}; // convId → { ad_clicks, gid, fetched }

  function adClicksFromPayload(j) {
    if (!j) return null;
    const custs = j.customers || (j.data && j.data.customers) || [];
    const c0 = Array.isArray(custs) ? custs[0] : null;
    if (c0 && Array.isArray(c0.ad_clicks) && c0.ad_clicks.length) return c0.ad_clicks;
    const map = j.ad_clicks || (j.data && j.data.ad_clicks);
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      const ks = Object.keys(map);
      for (let i = 0; i < ks.length; i++) {
        const v = map[ks[i]];
        if (Array.isArray(v) && v.length) return v;
      }
    }
    return null;
  }

  // global_id THẬT từ payload tải chat (ưu tiên customers[].global_id — khớp @298730 trong _app)
  function gidFromPayload(j) {
    if (!j) return '';
    const custs = j.customers || (j.data && j.data.customers) || j.conv_customers || [];
    if (Array.isArray(custs)) {
      for (let i = 0; i < custs.length; i++) {
        if (custs[i] && custs[i].global_id) return String(custs[i].global_id);
      }
    }
    if (j.global_id) return String(j.global_id);
    if (j.page_customer && j.page_customer.global_id) return String(j.page_customer.global_id);
    return '';
  }

  // Tính thời gian (ms) kể từ tương tác cuối của KHÁCH (last_customer_interactive_at / lastAt).
  // Khớp chuẩn dr() trong _app: cửa sổ 24h của Facebook chỉ tính theo tin nhắn cuối của KHÁCH
  // (last_customer_interactive_at), TUYỆT ĐỐI không tính theo updated_at khi <24h (vì nhân viên gắn tag
  // hoặc gửi tin cũng làm updated_at mới lên, từng gây ra 169 lần bắn nhầm vào API bị chặn ngoài 24h!).
  function getConvIdleMs(conv, full) {
    const f = full || conv || {};
    const c = conv || f || {};
    const rawCustIdle = f.last_customer_interactive_at || f.lastAt || c.lastAt || '';
    if (rawCustIdle) {
      const t = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(rawCustIdle) ? rawCustIdle : rawCustIdle + 'Z');
      if (!isNaN(t)) return Date.now() - t;
    }
    // Nếu object hội thoại có updated_at/inserted_at từ API nhưng last_customer_interactive_at === null
    // → khách chưa từng nhắn lại hoặc đã quá hạn từ lâu → chắc chắn ngoài 24h!
    const rawUpd = f.updated_at || f.updatedAt || c.updatedAt || f.inserted_at || '';
    if (rawUpd) {
      const tUpd = Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(rawUpd) ? rawUpd : rawUpd + 'Z');
      if (!isNaN(tUpd)) return Math.max(Date.now() - tUpd, 2 * 86400000);
    }
    const tm = String(c.time || f.time || '').trim();
    if (tm && (/\/|\bTh\s*\d|\bCN\b|\b20\d{2}\b/i.test(tm))) {
      const m = /(\d{1,2})\/(\d{1,2})$/.exec(tm);
      if (m) {
        const now = new Date();
        if (Number(m[1]) === now.getDate() && Number(m[2]) === (now.getMonth() + 1)) return 3600000;
      }
      return 2 * 86400000;
    }
    return NaN;
  }

  // nạp dữ liệu chat (ad_clicks + global_id) đúng request app khi mở chat. force=true → nạp ngay
  // cả khi chat có vẻ trong 24h (khi Ext/Socket cần global_id). Cache theo chat — CHỈ gọi mạng khi thật sự cần.
  async function ensureConvCtx(conv, opts) {
    const o = opts || {};
    const cid = conv && conv.id;
    if (!cid) {
      convCtxCache.__empty = convCtxCache.__empty || { ad_clicks: null, gid: '', fetched: true };
      return convCtxCache.__empty;
    }
    let entry = convCtxCache[cid];
    if (entry && entry.fetched) return entry; // đã nạp thành công qua mạng — không gọi lại
    entry = entry || { ad_clicks: null, gid: '', fetched: false, inflight: null };
    const full = peekConv(conv) || conv;
    // 1) có sẵn trong dữ liệu conv (bản ghi đầy đủ / dòng list) — khỏi gọi mạng
    if (!entry.ad_clicks) {
      entry.ad_clicks = adClicksFromPayload(full) || (full.customers && full.customers[0]
        && Array.isArray(full.customers[0].ad_clicks) && full.customers[0].ad_clicks.length
        ? full.customers[0].ad_clicks : null);
    }
    const pid = full.page_id || full.pageId || (conv && conv.pageId) || String(cid).split('_')[0];
    const tid = String(full.thread_id || full.threadId || (conv && (conv.thread_id || conv.threadId)) || '');
    if (!entry.gid) {
      entry.gid = String(gidFromPayload(full) || full.globalId || (conv && conv.globalId)
        || (full.customers && full.customers[0] && full.customers[0].global_id) || '');
    }
    if (!entry.gid) {
      try {
        const g1 = window.__GlobalIdCacheTest__, g2 = window.__tempGlobalIdCache__;
        const tKey = (pid && tid) ? (pid + '_' + tid) : '';
        entry.gid = String((g1 && g1.get(cid)) || (g2 && g2.get(cid))
          || (tKey && ((g1 && g1.get(tKey)) || (g2 && g2.get(tKey)))) || '');
      } catch (e) { /* ignore */ }
    }
    if (!entry.gid && pid && tid) {
      try {
        const mh = window.__MqttHelper__;
        const sk = mh && mh.SOCKETS && mh.SOCKETS[pid];
        const ip = sk && sk.context && sk.context.initPageData;
        const mGid = ip && ((ip.threadMapping && ip.threadMapping[tid])
          || (ip.threadMappingStoreV2 && ip.threadMappingStoreV2[tid]));
        if (mGid) {
          entry.gid = String(mGid);
          if (typeof window.__botfakeSaveGid__ === 'function') {
            window.__botfakeSaveGid__(cid, pid, tid, entry.gid);
          }
        }
      } catch (e) { /* ignore */ }
    }
    if (entry.gid && entry.ad_clicks && entry.ad_clicks.length) {
      entry.fetched = true; convCtxCache[cid] = entry; return entry; // đủ cả 2 — khỏi gọi mạng
    }
    // 2) Kiểm tra mốc thời gian tương tác cuối (idle):
    //    - Đang trong 24h (< 1 ngày) và chưa force: đi thẳng API, không cần gọi GET /messages.
    //    - Đã quá 7 ngày (> 7 ngày) hoặc page tắt ctx_7_days_enabled: cờ 7 ngày quảng cáo chắc chắn false;
    //      lúc này nếu chưa force (hoặc đã có sẵn entry.gid từ cache/WebSocket) thì trả về ngay trong 0ms!
    const idleMs = getConvIdleMs(conv, full);
    if (!o.force && !isNaN(idleMs) && idleMs < 86400000) {
      convCtxCache[cid] = entry; return entry;
    }
    let mayNeed7Days = true;
    if (!isNaN(idleMs) && idleMs > 7 * 86400000) {
      mayNeed7Days = false;
    } else {
      try {
        const st = window.__pancakeReduxStore__ && window.__pancakeReduxStore__.getState();
        const pgs = st && st.pages;
        const p = pgs && ((pgs.activatedMap && pgs.activatedMap[pid])
          || (Array.isArray(pgs.activated) && pgs.activated.find((x) => x && x.id === pid)));
        if (p && (!p.platform_extra_info || !p.platform_extra_info.ctx_7_days_enabled)) {
          mayNeed7Days = false;
        }
      } catch (e) { /* ignore */ }
    }
    if (entry.gid && (!mayNeed7Days || (entry.ad_clicks && entry.ad_clicks.length))) {
      convCtxCache[cid] = entry; return entry;
    }
    if (!o.force && !mayNeed7Days) {
      convCtxCache[cid] = entry; return entry;
    }
    // 3) nạp đúng request app gọi khi mở chat (lấy customerId từ cả row convApiRow lẫn full.customers)
    const custId = String(full.customerId || (conv && conv.customerId)
      || (full.customers && full.customers[0] && full.customers[0].id)
      || (conv && conv.customers && conv.customers[0] && conv.customers[0].id) || '');
    if (!custId && !o.force) { convCtxCache[cid] = entry; return entry; }
    if (entry.inflight) return entry.inflight;
    convCtxCache[cid] = entry;
    entry.inflight = ctxFetchLane(async () => {
      try {
        const url = apiBase() + '/v1/pages/' + pid
          + '/conversations/' + encodeURIComponent(cid)
          + '/messages?customer_id=' + encodeURIComponent(custId)
          + '&user_view=true&is_new_api=true&separate_pos=true';
        const res = await fetchJson(url, 3);
        if (res.ok && res.data && res.data.success !== false) {
          const j = res.data;
          entry.ad_clicks = entry.ad_clicks || adClicksFromPayload(j) || null;
          entry.gid = entry.gid || gidFromPayload(j) || '';
          // Khớp 100% @298730 trong _app: n.customers.forEach(t => t.fb_id && t.global_id && b.Z.set(e + "_" + t.fb_id, t.global_id))
          if (Array.isArray(j.customers)) {
            j.customers.forEach((t) => {
              if (t && t.fb_id && t.global_id && typeof window.__botfakeSaveGid__ === 'function') {
                window.__botfakeSaveGid__(pid + '_' + t.fb_id, pid, tid, String(t.global_id));
              }
            });
          }
          if (entry.gid) {
            try {
              if (typeof window.__botfakeSaveGid__ === 'function') {
                window.__botfakeSaveGid__(cid, pid, tid, String(entry.gid));
              }
              window.__GlobalIdCacheTest__ && window.__GlobalIdCacheTest__.set(cid, String(entry.gid));
              window.__tempGlobalIdCache__ && window.__tempGlobalIdCache__.set(cid, String(entry.gid));
            } catch (e2) { /* ignore */ }
          }
          // CHỈ đánh dấu fetched=true khi request thành công (tránh lỗi 429/mạng làm mất vĩnh viễn gid của 3.000 chat sau)
          entry.fetched = true;
        }
      } catch (e) { /* mạng lỗi — chưa set fetched=true để lần force sau còn thử lại */ }
      entry.inflight = null;
      return entry;
    });
    return entry.inflight;
  }

  // Cờ is_record_ctx_7_days — đúng điều kiện hàm dr() trong _app (gửi ngoài cửa sổ 24h
  // cho khách từ quảng cáo trong 7 ngày, page phải bật platform_extra_info.ctx_7_days_enabled):
  //  1) nền tảng fb/ig/wa + khách ≥1 ngày không tương tác (hoặc không rõ thời điểm)
  //  2) page bật ctx_7_days_enabled
  //  3) khách có ad_clicks (click quảng cáo) mới nhất ≤7 ngày
  // KHÔNG ngoại lệ: thiếu dữ liệu ad_clicks → không bật cờ (không bịa thêm — app cũng vậy).
  // Nguồn ad_clicks: cache từ ensureAdClicks (đúng đường app) → store messages.customers → dữ liệu chat.
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
      // đúng dr(): chỉ fb/ig/wa (thiếu field platform → để yên, không loại oan)
      const plat = p.platform || p.currentPlatform || st.currentPlatform || '';
      if (plat && ['facebook', 'instagram_official', 'whatsapp_official'].indexOf(plat) < 0) return false;
      let clicks = null;
      // 1) cache từ ensureConvCtx — nguồn app dùng khi tải chat (HAR)
      const cc = convCtxCache[full.id || full.convId || ''];
      if (cc && Array.isArray(cc.ad_clicks) && cc.ad_clicks.length) clicks = cc.ad_clicks;
      const mc = st.messages && st.messages.customers;
      const custId = (full.customers && full.customers[0] && full.customers[0].id) || (full.from && full.from.id);
      const custFb = full.from && full.from.id;
      if (!clicks && Array.isArray(mc)) {
        const c = mc.find((x) => x && (x.id === custId || x.id === custFb || x.fb_id === custFb));
        if (c && Array.isArray(c.ad_clicks)) clicks = c.ad_clicks;
      }
      if (!clicks && full.customers && full.customers[0] && Array.isArray(full.customers[0].ad_clicks)) {
        clicks = full.customers[0].ad_clicks;
      }
      if (!clicks) {
        const fromPayload = adClicksFromPayload(full);
        if (fromPayload) clicks = fromPayload;
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
        return { ok: true, id: (res.data && (res.data.timestamp || res.data.id)) || '' };
      }
      return { ok: false, sent: 'maybe', error: 'Extension không phản hồi' };
    } catch (e) {
      return { ok: false, sent: 'maybe', error: 'Extension lỗi: ' + (e && e.message || e) };
    }
  }

  function normalizePhotoItems(photo) {
    if (!photo) return [];
    if (Array.isArray(photo.items) && photo.items.length) return photo.items;
    if (photo.url || photo.id || photo.fbId) {
      return [{
        url: photo.url || '',
        id: photo.id || '',
        fbId: photo.fbId || (Array.isArray(photo.fbIds) && photo.fbIds[0]) || '',
        w: photo.w || 0,
        h: photo.h || 0,
      }];
    }
    return [];
  }

  function hasValidApiPhoto(photo) {
    if (!photo) return true;
    const items = normalizePhotoItems(photo);
    if (!items.length) return false;
    if (Array.isArray(photo.fbIds) && photo.fbIds.length >= items.length && photo.fbIds.every(Boolean)) return true;
    return items.every((x) => !!(x && x.fbId));
  }

  // Dựng request gửi inbox ĐÚNG app (dùng chung cho sendViaApi và chế độ nhanh)
  // Đối chiếu 13 request gửi THẬT của app trong tinnhan.har & executeByApi (@946500) + buildRequestBody (@951000) trong _app:
  //   • Gửi chữ hoặc 1 ảnh: multipart/form-data (action=reply_inbox, [is_record_ctx_7_days], message, content_id, attachment_id, content_url, width, height, send_by_platform=web)
  //   • Gửi >= 2 ảnh (đa ảnh): application/json ({ action: 'reply_inbox', [is_record_ctx_7_days], message, content_ids, attachment_ids, content_urls, dimensions, send_by_platform: 'web' })
  function buildInboxSend(conv, text, photo) {
    const token = getToken();
    if (!token) return { error: 'Không tìm thấy access_token — hãy tải lại trang Pancake rồi thử lại' };
    const pageId = conv.pageId || conv.id.split('_')[0];
    const url = apiBase() + '/v1/pages/' + pageId
      + '/conversations/' + encodeURIComponent(conv.id)
      + '/messages';
    let ctx7 = false;
    try {
      const full7 = peekConv(conv) || conv;
      if (isRecordCtx7Days(full7)) ctx7 = true;
    } catch (e) { /* thiếu dữ liệu → gửi như request thường */ }

    const items = normalizePhotoItems(photo);
    if (items.length > 1) {
      const fbIds = (Array.isArray(photo.fbIds) && photo.fbIds.length >= items.length)
        ? photo.fbIds.slice(0, items.length)
        : items.map((x) => x.fbId || '');
      const jsonBody = {
        action: 'reply_inbox',
        message: text == null ? '' : text,
        content_ids: items.map((x) => x.id || ''),
        attachment_ids: fbIds,
        content_urls: items.map((x) => x.url || ''),
        dimensions: items.map((x) => ({ width: Number(x.w) || 0, height: Number(x.h) || 0 })),
        send_by_platform: 'web',
      };
      if (ctx7) jsonBody.is_record_ctx_7_days = true;
      return { url: url, isJson: true, jsonBody: jsonBody };
    }

    const fd = new FormData();
    fd.append('action', 'reply_inbox');
    if (ctx7) fd.append('is_record_ctx_7_days', 'true');
    fd.append('message', text);
    const p0 = items[0] || photo;
    const fbId0 = (p0 && p0.fbId) || (photo && photo.fbId) || (photo && Array.isArray(photo.fbIds) && photo.fbIds[0]) || '';
    if (p0 && fbId0) {
      // đúng field + đúng THỨ TỰ request thật của app khi gửi 1 ảnh (đã so khớp curl):
      // content_id → attachment_id → content_url → width → height
      if (p0.id) fd.append('content_id', p0.id);
      fd.append('attachment_id', fbId0);
      fd.append('content_url', p0.url);
      if (p0.w) fd.append('width', String(p0.w));
      if (p0.h) fd.append('height', String(p0.h));
    }
    fd.append('send_by_platform', 'web'); // request thật của app luôn có (cả text lẫn ảnh)
    return { url: url, fd: fd, isJson: false };
  }

  // ⚡ CHẾ ĐỘ NHANH: bắn request API qua cổng điều tiết apiSendLane (64 luồng HTTP song song),
  // KHÔNG chờ server trả lời ở vòng ngoài — báo "đã gửi" tức thì, tránh đổ 7.000 fetch() cùng 1ms
  // làm nghẽn mạng Chrome. Nếu gặp HTTP 429 (rate-limit tạm thời, tin chắc chắn chưa xử lý) thì
  // tự động thử lại 1 lần sau 600ms.
  // Response xem TRONG NỀN: OK → im lặng; THUA RÕ (4xx/success=false) → bù Ext/Socket trong nền;
  // KHÔNG RÕ (5xx/lỗi mạng) → chỉ báo "không rõ" — KHÔNG gửi lại để tránh trùng tin.
  function fireApiAndWatch(conv, text, photo) {
    if (photo && !hasValidApiPhoto(photo)) return { ok: false, sent: false, error: 'Không có attachment ảnh cho API' };
    const req = buildInboxSend(conv, text, photo);
    if (req.error) return { ok: false, sent: false, error: req.error };
    if (state.stopRequested) return { ok: false, sent: false, error: 'Đã dừng' };
    const myRun = runSeq;
    apiSendLane(async () => {
      if (myRun !== runSeq || state.stopRequested) return;
      const makeFetchOpts = (rObj) => (rObj.isJson
        ? { method: 'POST', body: JSON.stringify(rObj.jsonBody), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, credentials: 'include' }
        : { method: 'POST', body: rObj.fd, headers: { Accept: 'application/json' }, credentials: 'include' });
      let res = await fetch(req.url, makeFetchOpts(req));
      if (res && res.status === 429 && myRun === runSeq && !state.stopRequested) {
        await sleep(600);
        const req2 = buildInboxSend(conv, text, photo);
        if (!req2.error) {
          res = await fetch(req2.url, makeFetchOpts(req2));
        }
      }
      if (myRun !== runSeq) return;
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (res.ok && data && data.success) { markDelivered(conv.id, 'api'); postSendSideEffects(conv); return; } // đã đến nơi — im lặng
      const msg = (data && (data.message || data.error)) || ('HTTP ' + res.status);
      if (res.status === 401 || res.status === 403) capturedToken = null;
      const nm = conv.name || conv.id;
      const certainFail = (res.status >= 400 && res.status < 500) || (res.ok && data && data.success === false);
      if (certainFail) {
        // "(#10)…ngoài khoảng thời gian…"/"(#551)" KHÔNG phải "mọi kênh đều thua": app vẫn fallback
        // Extension/Socket và gửi ĐƯỢC (log 07:36 — Thanh Binh bù THÀNH CÔNG qua Extension ngay sau
        // "(#10)"; HAR có update_global_id chạy sau cả "(#551)"). → PHẢI bù qua kênh chưa thử.
        const win = isWindowClosedError(msg);
        if (win) windowBlocked++;
        if (isThreadControlError(msg) && !batchSkipApi) {
          batchSkipApi = true; // học nhanh: API bị chặn cấp page (#10 app khác giữ thread, #613…) → chat còn lại trong lô đi thẳng Socket/Ext
          logLine('⛔ API bị chặn (' + msg + ') — các chat còn lại trong lô sẽ đi thẳng Socket/Ext');
        }
        // BÁO RÕ KẾT QUẢ THẬT — không bao giờ "báo gửi" xong im lặng khi request đã bị từ chối.
        // Bù ĐÚNG 1 lần/kênh qua kênh CHƯA thử (Ext → Socket — đúng plan của app).
        logLine('⚠ ' + nm + ' — API từ chối (' + clip(msg, 90) + ')'
          + (win ? ' — ngoài cửa sổ 24h, bù kênh khác' : ''));
        scheduleBuRetry(conv, text, photo, nm, 'API từ chối (' + clip(msg, 90) + ')', ['api']);
      } else {
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
        logLine('⚠ ' + nm + ' — không rõ kết quả (' + msg + ') — KHÔNG gửi lại để tránh trùng');
      }
    }).catch(() => {
      if (myRun !== runSeq) return;
      if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
      logLine('⚠ ' + (conv.name || conv.id) + ' — không rõ kết quả (lỗi mạng) — KHÔNG gửi lại để tránh trùng');
    });
    return { ok: true, id: '', sendBy: 'api', sent: true, fired: true };
  }

  // Đúng request mà _app-...js gửi khi nhắn tin thường (executeByApi + buildRequestBody):
  //   POST /api/v1/pages/{page_id}/conversations/{conversation.id}/messages?access_token=...
  //   multipart/form-data (1 ảnh / text) hoặc JSON (>= 2 ảnh): action=reply_inbox, message=<text>
  async function sendViaApi(conv, text, photo, ctx) {
    if (conv.type === 'comment') return sendCommentViaApi(conv, text, photo, ctx || {}); // chat bình luận → reply_comment
    if (photo && !hasValidApiPhoto(photo)) return { ok: false, sent: false, error: 'Không có attachment ảnh cho API' };
    const req = buildInboxSend(conv, text, photo);
    if (req.error) return { ok: false, sent: false, error: req.error };
    try {
      const makeFetchOpts = (rObj) => (rObj.isJson
        ? { method: 'POST', body: JSON.stringify(rObj.jsonBody), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, credentials: 'include' }
        : { method: 'POST', body: rObj.fd, headers: { Accept: 'application/json' }, credentials: 'include' });
      let res = await fetch(req.url, makeFetchOpts(req));
      if (res && res.status === 429 && !state.stopRequested) {
        await sleep(600);
        const req2 = buildInboxSend(conv, text, photo);
        if (!req2.error) {
          res = await fetch(req2.url, makeFetchOpts(req2));
        }
      }
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
  let channelHintSaveTimer = null;
  try { channelHints = JSON.parse(sessionStorage.getItem(CH_KEY) || '{}') || {}; } catch (e) { channelHints = {}; }
  function markChannel(convId, ch) {
    channelHints[convId] = ch;
    if (!channelHintSaveTimer) {
      channelHintSaveTimer = setTimeout(() => {
        channelHintSaveTimer = null;
        try { sessionStorage.setItem(CH_KEY, JSON.stringify(channelHints)); } catch (e) { /* ignore */ }
      }, 400);
    }
  }
  let batchSkipApi = false; // API bị chặn CẤP PAGE (#10 app khác giữ thread, #613, rate limit…) → chat sau đi thẳng Socket/Ext

  // NGOÀI CỬA SỔ 24H — API từ chối "(#551) Người này hiện không có mặt" / "(#10)…ngoài khoảng
  // thời gian cho phép…". ĐÂY KHÔNG PHẢI "mọi kênh đều thua": app vẫn fallback Extension và Ext
  // GỬI ĐƯỢC (Thanh Binh — log 07:36; HAR có update_global_id sau cả "(#551)"). Lỗi này là của
  // TỪNG NGƯỜI (chat khác vẫn bình thường) → không chặn cả lô; và PHẢI bù sang kênh chưa thử.
  // Khác biệt thật sự: thiếu cờ is_record_ctx_7_days (dr()) mới sinh "(#10)" oan — xem ensureAdClicks.
  function isWindowClosedError(msg) {
    const m = String(msg || '');
    return m.indexOf('(#551)') > -1
      || m.indexOf('Người này hiện không có mặt') > -1
      || m.indexOf('ngoài khoảng thời gian cho phép') > -1;
  }

  // Rút bằng chứng từ chuỗi lỗi (có thể là "Ext: … | api: (#10)…") — log gọn, đúng nghĩa
  function windowSig(msg) {
    const m = String(msg || '');
    if (m.indexOf('(#551)') > -1) return '(#551) Người này hiện không có mặt';
    if (m.indexOf('ngoài khoảng thời gian cho phép') > -1) return '(#10) ngoài khoảng thời gian cho phép';
    return '(chính sách cửa sổ 24h)';
  }

  function isThreadControlError(msg) {
    const m = String(msg || '');
    // CHẶN CẢ LÔ chỉ khi là chặn cấp page/hệ thống (rate limit, FB handover, thread control).
    // (#551 "Người này hiện không có mặt" là chặn của TỪNG NGƯỜI — chat khác vẫn gửi API bình thường;
    // trước đây 1 con #551 làm cả lô bị tước API → nhiều chat trong cửa sổ 24h mất oan.)
    // "(#10)…ngoài khoảng thời gian cho phép…" (cửa sổ 24h) cũng là của TỪNG NGƯỜI — không chặn lô.
    if (isWindowClosedError(m)) return false;
    return /\(#(10|613|80006)(?:,\d+)?\)/.test(m)
      || m.indexOf('kiểm soát thread') > -1
      || m.toLowerCase().indexOf('rate limit') > -1;
  }

  // Lấy conversation đầy đủ (thread_id, thread_key, from, updated_at…):
  // ưu tiên redux store của trang + state.allRows (O(1) Map), sau đó GET /conversations/{id}
  async function getFullConversation(conv) {
    try {
      const found = peekConv(conv);
      if (found && (found.thread_id || found.threadId)) return found;
    } catch (e) { /* ignore */ }
    try {
      const token = getToken();
      if (!token) return peekConv(conv);
      const res = await fetch(apiBase() + '/v1/pages/' + (conv.pageId || conv.id.split('_')[0])
        + '/conversations/' + encodeURIComponent(conv.id)
        + '?access_token=' + encodeURIComponent(token),
        { headers: { Accept: 'application/json' }, credentials: 'include' });
      const j = await res.json().catch(() => null);
      if (j && res.ok) return j.conversation || (j.data && j.data.conversation) || (j.id ? j : (j.data && j.data.id ? j.data : peekConv(conv)));
    } catch (e) { /* ignore */ }
    return peekConv(conv);
  }

  // Lấy conversation 1 lần cho MỌI kênh trong cùng lượt gửi (ctx dùng chung) — đỡ gọi lại nhiều lần
  async function ctxFull(conv, ctx) {
    if (!ctx.fullLoaded) {
      // dòng conv đã đủ dữ liệu (threadId + pageId + threadKey + updatedAt — đủ cho payload Ext)
      // → dùng thẳng, khỏi GET conversation; thiếu thì nạp đầy đủ (redux/allRows có sẵn là xong ngay)
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

  // Kiểm tra ĐỒNG BỘ (0ms, không await) xem đã có sẵn global_id thật trong RAM/Cache/WebSocket chưa:
  // dùng để tách làn Cao Tốc (Socket Fast-Path 0ms) khỏi làn Dò Tìm (Slow Discovery) khi gửi 30.000 tin!
  function peekFastGlobalId(conv, full, badGid) {
    try {
      const f = full || conv || {};
      const key = String(f.id || (conv && conv.id) || '');
      const pageId = String(f.page_id || f.pageId || (conv && (conv.pageId || conv.page_id)) || key.split('_')[0] || '');
      const threadId = String(f.thread_id || f.threadId || (conv && (conv.threadId || conv.thread_id)) || '');
      const tKey = (pageId && threadId) ? (pageId + '_' + threadId) : '';
      const g1 = window.__GlobalIdCacheTest__, g2 = window.__tempGlobalIdCache__;
      const cc = key && convCtxCache[key];
      const cached = (key && ((g1 && g1.get(key)) || (g2 && g2.get(key)) || persistentGidMap[key] || (cc && cc.gid)))
        || (tKey && ((g1 && g1.get(tKey)) || (g2 && g2.get(tKey)) || persistentGidMap[tKey]));
      if (cached && String(cached) !== badGid) return String(cached);
      const rawGData = gidFromPayload(f) || f.globalId || (conv && conv.globalId)
        || (f.customers && f.customers[0] && f.customers[0].global_id) || '';
      if (rawGData && String(rawGData) !== badGid) {
        if (typeof window.__botfakeSaveGid__ === 'function') {
          window.__botfakeSaveGid__(key, pageId, threadId, String(rawGData));
        }
        return String(rawGData);
      }
      if (threadId && pageId) {
        const mh = window.__MqttHelper__;
        const sk = mh && mh.SOCKETS && mh.SOCKETS[pageId];
        const ip = sk && sk.context && sk.context.initPageData;
        const mGid = ip && ((ip.threadMapping && ip.threadMapping[threadId])
          || (ip.threadMappingStoreV2 && ip.threadMappingStoreV2[threadId]));
        if (mGid && String(mGid) !== badGid) {
          if (typeof window.__botfakeSaveGid__ === 'function') {
            window.__botfakeSaveGid__(key, pageId, threadId, String(mGid));
          }
          return String(mGid);
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  let extNullStreak = 0;

  // Tìm globalId của khách theo kiến trúc Đa Tầng Không Chặn Đầu (Two-Pass Non-Blocking Pipeline v1.63.0):
  //   • Bước 1 (0ms): RAM / localStorage / IndexedDB / WebSocket threadMappingStoreV2.
  //   • Bước 1B (~100–200ms): Server Pancake HTTP GET /messages (khớp @298730 trong _app: n.customers[].global_id,
  //     chạy song song trên ctxFetchLane, đồng thời đánh thức WebSocket loadThread).
  //   • Bước 1C (Nếu đang ở Làn Nhanh ctx.fastOnly === true mà cả Bước 1 & 1B đều trả null):
  //     Đánh dấu ctx.deferredToExt = true và trả về null NGAY LẬP TỨC (0ms) để đẩy chat sang hồ nền Extension
  //     (extBacklogQueue), TUYỆT ĐỐI KHÔNG giữ chân worker của Làn Nhanh!
  //   • Bước 2 + 3 (Chạy trong hồ nền extBacklogQueue): Đua song song WebSocket PENDING_MESSAGES + Extension,
  //     kèm mạch ngắt thông minh (extNullStreak) và TUYỆT ĐỐI không trả về from_psid sai để bắn mù vào Socket!
  async function resolveGlobalId(full, threadId, cacheKey, convFromPsid, forceFind, ctx) {
    const key = (full && full.id) || cacheKey;
    const pageId = (full && full.page_id) || (full && full.pageId) || String(cacheKey || '').split('_')[0];
    const tKey = (pageId && threadId) ? (pageId + '_' + threadId) : '';
    const saveCache = (val) => {
      const s = String(val || '');
      if (!s) return;
      try {
        if (window.__GlobalIdCacheTest__) {
          if (key) window.__GlobalIdCacheTest__.set(key, s);
          if (tKey) window.__GlobalIdCacheTest__.set(tKey, s);
        }
        if (window.__tempGlobalIdCache__) {
          if (key) window.__tempGlobalIdCache__.set(key, s);
          if (tKey) window.__tempGlobalIdCache__.set(tKey, s);
        }
        if (typeof window.__botfakeSaveGid__ === 'function') {
          window.__botfakeSaveGid__(key, pageId, threadId, s);
        }
      } catch (e) { /* ignore */ }
    };
    const badGid = (forceFind && ctx && ctx.gid && !ctx.gidFromPsid) ? String(ctx.gid) : '';
    const mqtt = window.__MqttHelper__;
    if (mqtt && pageId && typeof mqtt.wakingUpLoadThread === 'function') {
      try { mqtt.wakingUpLoadThread(pageId); } catch (e0) { /* ignore */ }
    }
    // 1) Kiểm tra 0ms trong RAM (Cache + full.global_id + MqttHelper.threadMappingStoreV2)
    const fastGid = peekFastGlobalId(full, full, badGid);
    if (fastGid) {
      saveCache(fastGid);
      if (ctx) {
        ctx.gidFromPsid = false;
        ctx.gidFromServerOrCache = true;
      }
      return String(fastGid);
    }
    // 1B) Nạp global_id từ Server Pancake HTTP GET /messages (khớp @298730 trong _app: n.customers[].global_id):
    //     Chỉ đánh dấu httpCtxTried = true khi request thực sự thành công (cc.fetched === true), để nếu lần 1
    //     mạng bận thì khi xuống Làn 2 vẫn thử lại lấy được global_id!
    if (!ctx || !ctx.httpCtxTried) {
      try {
        const cc = await ensureConvCtx(full || { id: key, pageId: pageId, threadId: threadId }, { force: true });
        if (ctx && cc && cc.fetched) ctx.httpCtxTried = true;
        const srvGid = (cc && cc.gid && String(cc.gid) !== badGid)
          ? String(cc.gid)
          : peekFastGlobalId(full, full, badGid);
        if (srvGid) {
          saveCache(srvGid);
          if (ctx) {
            ctx.gidFromPsid = false;
            ctx.gidFromServerOrCache = true;
          }
          return String(srvGid);
        }
      } catch (e1) { /* ignore */ }
    }
    // 1C) Nếu đang chạy trong Làn Nhanh (ctx.fastOnly === true) mà cả Cache, WebSocket lẫn Server Pancake
    //     đều chưa có global_id (tức là buộc phải chờ Extension findGlobalIdForConv):
    //     Đánh dấu deferredToExt = true và trả về null NGAY LẬP TỨC (0ms) để đẩy sang extBacklogQueue,
    //     giải phóng worker của Làn Nhanh đi bắn ngay các chat tiếp theo (301..20.000)!
    if (ctx && ctx.fastOnly) {
      ctx.deferredToExt = true;
      return null;
    }
    const isLargeBatch = !!(batchStats && batchStats.total > 50);
    // Khớp 100% với this.concurrentlyGetGLobalIdExecuted (@961019 trong _app):
    // Nếu trong cùng ctx của chat này đã từng chạy trọn vẹn bước dò tìm mạng/Extension 1 lần rồi
    // mà không ra, KHÔNG chạy lại HTTP/Extension lần thứ 2!
    if (ctx && ctx.gidDiscoveryRan) {
      if (ctx.noGidConfirmedByExt || isLargeBatch) return null;
      if (!ctx.psidTried) {
        const guess2 = psidFromFull(full, pageId) || psidFromFull({ from_psid: convFromPsid || '' }, pageId);
        if (guess2 && String(guess2) !== badGid) {
          ctx.gidFromPsid = true;
          ctx.psidTried = true;
          return guess2;
        }
      }
      return null;
    }
    if (ctx) ctx.gidDiscoveryRan = true;

    // 2 + 3) KHỚP 100% concurrentlyGetGLobalId (@961661) TRONG _app-9331d46f21a84eb1.v6.js:
    //   • Chạy đua SONG SONG giữa WebSocket loadThread (PENDING_MESSAGES) và Extension (gidExtLane 16 luồng).
    let settled = false;
    let wsTimer = null;
    let wsPoll = null;
    let wsResolveRef = null;
    const pKey = (pageId && threadId) ? ('find_global_id_|' + pageId + '_|' + threadId) : '';
    const cleanupRace = () => {
      settled = true;
      if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
      if (wsPoll) { clearInterval(wsPoll); wsPoll = null; }
      try {
        if (mqtt && mqtt.PENDING_MESSAGES && pKey) delete mqtt.PENDING_MESSAGES[pKey];
      } catch (e0) { /* ignore */ }
    };
    const custName = (full && full.from && (full.from.name || full.from.username))
      || (full && (full.customerName || full.name)) || '';
    const rawUpd = String((full && (full.updated_at || full.updatedAt)) || '');
    const updMs = rawUpd ? Date.parse(/[zZ+]|\+\d{2}:?\d{2}$/.test(rawUpd) ? rawUpd : rawUpd + 'Z') : Date.now();
    const hasExtFinder = typeof window.findGlobalIdForConv === 'function'
      || !!(window.__ExtensionAdapter__ && typeof window.__ExtensionAdapter__.send === 'function');

    // Giải phóng nhánh WebSocket NGAY LẬP TỨC ở 0ms khi nhánh Extension đã kết thúc (tránh giữ chân worker)
    const cutWsShort = () => {
      if (!settled && wsResolveRef) {
        if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
        if (wsPoll) { clearInterval(wsPoll); wsPoll = null; }
        try { if (mqtt && mqtt.PENDING_MESSAGES && pKey) delete mqtt.PENDING_MESSAGES[pKey]; } catch (e2) { /* ignore */ }
        const late = peekFastGlobalId(full, full, badGid);
        if (late) { saveCache(late); cleanupRace(); wsResolveRef(String(late)); }
        else wsResolveRef(null);
      }
    };

    const wsWaitMs = 1500;
    const extWaitMs = 10000;
    const raceTasks = [];

    // Nhánh 1: WebSocket PENDING_MESSAGES + wakingUpLoadThread + wsPoll 60ms (bắt ngay global_id ở <60ms khi loadThread về,
    // chấm dứt triệt để hiện tượng đứng hình 4.5–6 giây đợi wsTimer nổ như ở log 07:27:35→07:27:41!)
    if (mqtt && pageId && threadId) {
      const sk = mqtt.SOCKETS && mqtt.SOCKETS[pageId];
      if (sk && mqtt.PENDING_MESSAGES && typeof mqtt.wakingUpLoadThread === 'function') {
        raceTasks.push(new Promise((resolve) => {
          wsResolveRef = resolve;
          const nowGid = peekFastGlobalId(full, full, badGid);
          if (nowGid) {
            saveCache(nowGid);
            if (ctx) ctx.gidFromServerOrCache = true;
            cleanupRace();
            resolve(String(nowGid));
            return;
          }
          wsPoll = setInterval(() => {
            if (settled) { if (wsPoll) { clearInterval(wsPoll); wsPoll = null; } return; }
            const hitGid = peekFastGlobalId(full, full, badGid);
            if (hitGid) {
              saveCache(hitGid);
              if (ctx) ctx.gidFromServerOrCache = true;
              cleanupRace();
              resolve(String(hitGid));
            }
          }, 60);
          wsTimer = setTimeout(() => {
            wsTimer = null;
            if (wsPoll) { clearInterval(wsPoll); wsPoll = null; }
            try { delete mqtt.PENDING_MESSAGES[pKey]; } catch (e2) { /* ignore */ }
            const lateGid = peekFastGlobalId(full, full, badGid);
            if (lateGid) {
              saveCache(lateGid);
              if (ctx) ctx.gidFromServerOrCache = true;
              cleanupRace();
              resolve(String(lateGid));
              return;
            }
            resolve(null);
          }, wsWaitMs);
          mqtt.PENDING_MESSAGES[pKey] = {
            callback: (r) => {
              const val = (r && r.success && r.data && String(r.data) !== badGid) ? String(r.data) : null;
              if (val) {
                saveCache(val);
                if (ctx) ctx.gidFromServerOrCache = true;
              }
              cleanupRace();
              resolve(val);
            },
            clearTimeout: wsTimer,
          };
          try { mqtt.wakingUpLoadThread(pageId); } catch (e2) { /* ignore */ }
        }));
      } else if (typeof mqtt.findGlobalId === 'function') {
        raceTasks.push(new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), wsWaitMs);
          Promise.resolve()
            .then(() => mqtt.findGlobalId(pageId, threadId))
            .then((r) => {
              clearTimeout(timer);
              const val = (r && r.success && r.data && String(r.data) !== badGid) ? String(r.data) : null;
              if (val) { saveCache(val); if (ctx) ctx.gidFromServerOrCache = true; cleanupRace(); }
              resolve(val);
            })
            .catch(() => { clearTimeout(timer); resolve(null); });
        }));
      }
    }

    // Nhánh 2: Extension GET_GLOBAL_ID_FOR_CONV (8 luồng song song qua gidExtLane)
    if (hasExtFinder && threadId) {
      raceTasks.push(gidExtLane(() => new Promise((resolve) => {
        if (settled || state.stopRequested) { cutWsShort(); resolve(null); return; }
        // Kiểm tra lại ngay khi tới lượt trong gidExtLane: nếu WebSocket loadThread đã cuộn tới
        // và nạp xong global_id vào threadMappingStoreV2 trong lúc xếp hàng → lấy luôn ở 0ms, khỏi gọi Extension!
        const hitNow = peekFastGlobalId(full, full, badGid);
        if (hitNow) {
          extNullStreak = 0;
          saveCache(hitNow);
          if (ctx) ctx.gidFromServerOrCache = true;
          cleanupRace();
          resolve(String(hitNow));
          return;
        }
        const timer = setTimeout(() => {
          // LƯU Ý QUAN TRỌNG: Khi bị timeout (Extension đang bận xử lý các lệnh khác),
          // TUYỆT ĐỐI KHÔNG gán ctx.extFinderReturnedNull = true (để chat vẫn còn cơ hội gửi qua
          // sendViaExtension bằng threadId y hệt khi gửi tay, không bị báo oan là khách khóa nick!).
          cutWsShort();
          resolve(null);
        }, extWaitMs);
        const finishExt = (val, confirmedNull) => {
          clearTimeout(timer);
          if (val && String(val) !== badGid) {
            extNullStreak = 0;
            saveCache(val);
            cleanupRace();
            resolve(String(val));
          } else {
            if (confirmedNull) {
              extNullStreak++;
              if (isLargeBatch && ctx) ctx.extFinderReturnedNull = true;
            }
            cutWsShort();
            resolve(null);
          }
        };
        const tryMessengerLink = () => {
          const adapter = window.__ExtensionAdapter__;
          if (settled || !adapter || typeof adapter.send !== 'function') { finishExt(null, false); return; }
          Promise.resolve().then(() => adapter.send({
            type: 'MAKE_MESSENGER_LINK',
            pageId: pageId,
            convId: key,
            threadId: threadId,
            uiVersion: 6,
            globalId: null,
            conversationUpdatedTime: isNaN(updMs) ? Date.now() : updMs,
            customerName: custName,
            platform: 'facebook',
          }, { timeout: 5000 })).then((mlRes) => {
            if (mlRes && mlRes.success && mlRes.data) {
              let mlGid = mlRes.data.globalId || '';
              if (!mlGid && mlRes.data.link) {
                try {
                  const qStr = String(mlRes.data.link).split('?')[1] || String(mlRes.data.link);
                  const sel = new URLSearchParams(qStr).get('selected_item_id');
                  if (sel && /^\d+$/.test(sel)) mlGid = sel;
                } catch (e3) { /* ignore */ }
              }
              if (mlGid && String(mlGid) !== badGid) { finishExt(mlGid, false); return; }
            }
            finishExt(null, !!(mlRes && mlRes.timedOut !== true));
          }).catch(() => finishExt(null, false));
        };
        if (typeof window.findGlobalIdForConv === 'function') {
          Promise.resolve().then(() => window.findGlobalIdForConv({
            pageId: pageId,
            threadId: threadId,
            threadKey: (full && (full.thread_key || full.threadKey)) || ('t_' + threadId),
            isBusiness: true,
            conversationUpdatedTime: isNaN(updMs) ? Date.now() : updMs,
            customerName: custName,
            convType: 'INBOX', postId: null, convId: null,
          })).then((v) => {
            if (v && String(v) !== badGid) {
              finishExt(v, false);
            } else if (isLargeBatch) {
              // Chính findGlobalIdForConv của Extension đã chạy xong và trả về null → xác nhận khách khóa nick
              finishExt(null, true);
            } else {
              tryMessengerLink();
            }
          }).catch(() => {
            if (isLargeBatch) {
              finishExt(null, false);
            } else {
              tryMessengerLink();
            }
          });
        } else {
          tryMessengerLink();
        }
      })));
    } else if (!hasExtFinder) {
      // Dự phòng nếu không có Extension: thử lấy từ ensureConvCtx
      raceTasks.push((async () => {
        try {
          const cc = await ensureConvCtx(full || { id: key, pageId: pageId }, { force: true });
          if (cc && cc.gid && String(cc.gid) !== badGid) {
            saveCache(cc.gid);
            if (ctx) ctx.gidFromServerOrCache = true;
            cleanupRace();
            return String(cc.gid);
          }
        } catch (e) { /* ignore */ }
        cutWsShort();
        return null;
      })());
    }

    const gid = raceTasks.length ? await firstNonNull(raceTasks) : null;
    cleanupRace();
    if (gid && String(gid) !== badGid) {
      saveCache(gid);
      if (ctx) {
        ctx.gidFromPsid = false;
        ctx.extFinderReturnedNull = false;
      }
      return String(gid);
    }
    // Khi chính Extension (findGlobalIdForConv) đã chạy xong và xác nhận không tìm thấy global_id
    // trên Facebook (ctx.extFinderReturnedNull === true) hoặc trình duyệt không có Extension trên lô lớn:
    // đánh dấu noGidConfirmedByExt = true để dừng ngay.
    // Ngược lại, nếu Extension chỉ bị timeout tạm thời (extFinderReturnedNull !== true) thì giữ
    // noGidConfirmedByExt = false để sendViaExtension vẫn gửi được bằng threadId (nhưng vẫn trả về null
    // trên isLargeBatch để TUYỆT ĐỐI không bắn from_psid sai vào Socket!).
    if (ctx && (ctx.extFinderReturnedNull || (!hasExtFinder && isLargeBatch))) {
      ctx.noGidConfirmedByExt = true;
      return null;
    }
    if (isLargeBatch) {
      return null;
    }
    // 4) CUỐI CÙNG (chỉ cho lô nhỏ <=50 chat) mới đoán from_psid cho kênh dự phòng
    if (!ctx || !ctx.psidTried) {
      const guess = psidFromFull(full, pageId) || psidFromFull({ from_psid: convFromPsid || '' }, pageId);
      if (guess && String(guess) !== badGid) {
        if (ctx) {
          ctx.gidFromPsid = true;
          ctx.psidTried = true;
        }
        return guess;
      }
    }
    return null;
  }

  // Gửi qua Facebook WebSocket — ĐÚNG đường "gửi bình thường" mà app/nhân viên vẫn dùng
  // (_app: executeBySocketFB @974800 → __MqttHelper__.sendMessage @831250 → publish /ls_req)
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

  const socketNoAckStreak = {};
  const socketRejectStreak = {};
  const socketReconnectPromises = {};
  const socketLastPublishAt = {};
  const SOCKET_MIN_PACE_MS = 2; // Giãn nhịp vi mô 2ms giữa 2 khung /ls_req trên cùng 1 page (500 tin/s, chống FB MQTT burst-reject mà không giảm tốc!)

  async function paceSocketPublish(pageId) {
    const pid = String(pageId || '');
    if (!pid) return;
    const now = Date.now();
    const nextAt = Math.max(now, (socketLastPublishAt[pid] || 0) + SOCKET_MIN_PACE_MS);
    socketLastPublishAt[pid] = nextAt;
    const waitMs = nextAt - now;
    if (waitMs > 0) await sleep(waitMs);
  }

  function isSocketAlive(sock) {
    try {
      if (!sock || !sock.instance) return false;
      if (sock.instance.$10 && typeof sock.instance.$10.isRunning === 'function') {
        return !!sock.instance.$10.isRunning();
      }
      return true;
    } catch (e) { return false; }
  }

  async function ensureAliveSocket(helper, pageId, forceReconnect) {
    let sock = helper.SOCKETS && helper.SOCKETS[pageId];
    if (!forceReconnect && isSocketAlive(sock)) return sock;
    if (socketReconnectPromises[pageId]) {
      await Promise.race([socketReconnectPromises[pageId], sleep(12000)]);
      return helper.SOCKETS && helper.SOCKETS[pageId];
    }
    if (typeof helper.initSocket === 'function') {
      socketReconnectPromises[pageId] = (async () => {
        try {
          if (sock && sock.instance && typeof sock.instance.shutdown === 'function') {
            try { sock.instance.shutdown(); } catch (e0) { /* ignore */ }
          }
          if (helper.SOCKETS) delete helper.SOCKETS[pageId];
          await Promise.race([Promise.resolve().then(() => helper.initSocket(pageId)), sleep(12000)]);
          socketNoAckStreak[pageId] = 0;
        } catch (e) { /* ignore */ }
        socketReconnectPromises[pageId] = null;
      })();
      await socketReconnectPromises[pageId];
    }
    return helper.SOCKETS && helper.SOCKETS[pageId];
  }

  // Gửi TRỰC TIẾP khung /ls_req của app qua helper.publish — BỎ BƯỚC CHỜ 1S bên trong helper.sendMessage.
  // Hỗ trợ đầy đủ cả ẢNH (task label "46" với attachment_fbids, send_type: 3, source: 0) lẫn TEXT
  // (task label "46" với send_type: 1, source: 4456448) + watermark label "21", khớp 100% với
  // ef.Z.sendMessage (@831250) trong _app-9331d46f21a84eb1.v6.js!
  async function socketPublishSend(helper, pageId, gid, text, attFbIds, firedCb) {
    let sock = helper.SOCKETS && helper.SOCKETS[pageId];
    const warm = socketWarmPromises[pageId];
    if (warm) {
      await Promise.race([warm, sleep(12000)]);
      sock = helper.SOCKETS && helper.SOCKETS[pageId];
    }
    if (!isSocketAlive(sock) || (socketNoAckStreak[pageId] || 0) >= 3) {
      sock = await ensureAliveSocket(helper, pageId, (socketNoAckStreak[pageId] || 0) >= 3);
    }
    if (!isSocketAlive(sock)) return { kind: 'dead' };
    if (typeof helper.publish !== 'function' || typeof helper.findAllBlockActions !== 'function') {
      return { kind: 'legacy' }; // helper cũ — quay về sendMessage đầy đủ
    }
    sock.taskId = sock.taskId || 0;
    const hasPhoto = Array.isArray(attFbIds) && attFbIds.length > 0;
    const hasText = !!(text && String(text).length > 0);
    const tasks = [];
    if (hasPhoto) {
      tasks.push({
        failure_count: null,
        label: '46',
        payload: JSON.stringify({
          attachment_fbids: attFbIds,
          mark_thread_read: 0,
          otid: epochId(),
          send_type: 3,
          source: 0,
          sync_group: 205,
          text: null,
          thread_id: gid,
        }),
        queue_name: gid,
        task_id: ++sock.taskId,
      });
    }
    if (hasText || !hasPhoto) {
      tasks.push({
        failure_count: null,
        label: '46',
        payload: JSON.stringify({
          mark_thread_read: 1,
          otid: epochId(),
          send_type: 1,
          source: 4456448,
          sync_group: 205,
          text: text || '',
          thread_id: gid,
        }),
        queue_name: gid,
        task_id: ++sock.taskId,
      });
    }
    tasks.push({
      failure_count: null,
      label: '21',
      payload: JSON.stringify({ last_read_watermark_ts: Date.now(), sync_group: 205, thread_id: gid }),
      queue_name: gid,
      task_id: ++sock.taskId,
    });
    const frame = {
      epoch_id: epochId(),
      version_id: '9942677559150662',
      tasks: tasks,
    };
    await paceSocketPublish(pageId);
    const nextReqId = (typeof sock.requestId === 'number') ? (sock.requestId + 1) : null;
    const publishPromise = new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try {
          if (nextReqId !== null && helper.PENDING_MESSAGES) {
            const k = pageId + '_' + nextReqId;
            if (helper.PENDING_MESSAGES[k]) {
              clearTimeout(helper.PENDING_MESSAGES[k].clearTimeout);
              delete helper.PENDING_MESSAGES[k];
            }
          }
        } catch (e0) { /* ignore */ }
        resolve({ success: false, data: null, timedOut: true });
      }, 15000);
      Promise.resolve()
        .then(() => helper.publish(pageId, '/ls_req', frame, 3))
        .then((res) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(res);
        })
        .catch(() => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(null);
        });
    });
    // Phân loại kết quả từ gói /ls_resp của FB (dùng chung cho cả đường chờ ACK lẫn đường bắn-nhả)
    const classify = (g) => {
      if (!(g && g.payload)) {
        socketNoAckStreak[pageId] = (socketNoAckStreak[pageId] || 0) + 1;
        if (!isSocketAlive(helper.SOCKETS && helper.SOCKETS[pageId])) return { kind: 'dead' };
        return { kind: 'noack' };
      }
      socketNoAckStreak[pageId] = 0;
      let resp = null;
      try { resp = JSON.parse(g.payload); } catch (e) { return { kind: 'noack' }; }
      const replaced = helper.findAllBlockActions(resp.step, 'replaceOptimsiticMessage') || [];
      const failed = helper.findAllBlockActions(resp.step, 'markOptimisticMessageFailed') || [];
      if (failed.length && !replaced.length) return { kind: 'rejected' };
      // QUAN TRỌNG: Khi gửi CẢ ẢNH LẪN CHỮ (2 task label "46"), nếu chữ đi được (replaced.length > 0)
      // nhưng ảnh bị từ chối (failed.length > 0), TUYỆT ĐỐI không được trả về 'ok' (sẽ làm mất ảnh mà chỉ có chữ!),
      // mà phải báo 'photo_failed_text_ok' để sendViaSocket upload fbId mới và bắn bù riêng phần ảnh!
      if (hasPhoto && hasText && failed.length > 0 && replaced.length > 0) {
        return { kind: 'photo_failed_text_ok' };
      }
      return { kind: 'ok' };
    };
    // 🔥 NẤC 2 (v1.71.0): bắn xong NHẢ NGAY — không giữ worker chờ ACK của FB (vốn mất ~2,8s/tin).
    // Kết quả thật được classify ở nền khi /ls_resp về và gọi firedCb đúng 1 lần.
    if (typeof firedCb === 'function') {
      publishPromise
        .then((g) => { try { firedCb(classify(g)); } catch (e) { firedCb({ kind: 'noack' }); } })
        .catch(() => firedCb({ kind: 'noack' }));
      return { kind: 'fired' };
    }
    const g = await publishPromise;
    return classify(g);
  }

  const updatedGidConvSet = new Set();
  // Hồ dự trữ fbId (is_reusable=false) CHƯA TỪNG TIÊU THỤ theo từng fanpage trong cùng lượt gửi:
  // Khi chuẩn bị song song (resolveGlobalId + uploadOneTimePhoto) mà phát hiện chat đã khóa nick trước khi bắn,
  // fbId chưa dùng sẽ được cất vào spareFbIdPool[pageId] để chat sống tiếp theo lấy dùng ngay ở 0ms!
  const spareFbIdPool = {};
  // 🔒 KHÓA CHỐNG TRÙNG (v1.72.0): các chat đã BẮN Socket ở chế độ bắn-nhả mà ACK chưa chốt.
  // Khi chat còn trong tập này: không kênh nào được bắn thêm cho chat đó (kể cả bù Extension) —
  // chỉ khi FB XÁC NHẬN TỪ CHỐI (rejected) thì mới được bù. Chặn đứng mọi đường bắn chồng gây lặp câu.
  const sockFiredPending = new Set();

  function recycleUnusedFbId(pageId, ctx) {
    if (!ctx || !ctx.nonReusableFbId || !pageId) return;
    const pid = String(pageId);
    const unused = String(ctx.nonReusableFbId);
    ctx.nonReusableFbId = null;
    if (!spareFbIdPool[pid]) spareFbIdPool[pid] = [];
    if (spareFbIdPool[pid].indexOf(unused) < 0) {
      spareFbIdPool[pid].push(unused);
    }
  }

  // Mỗi cuộc hội thoại gửi kèm ảnh qua Socket hoặc Extension BẮT BUỘC phải có 1 fbId (is_reusable=false)
  // riêng biệt của cuộc hội thoại đó (đúng executeBySocketFB @976000 & executeByExtOnce @964800 trong _app).
  // Tuyệt đối KHÔNG dùng lại fbId (is_reusable=false) ĐÃ BẮN của cuộc hội thoại A cho cuộc hội thoại B.
  // Nhưng nếu fbId vừa tạo ra mà CHƯA TỪNG BẮN (nằm trong spareFbIdPool[pageId]), lấy dùng ngay ở 0ms!
  function uploadOneTimePhoto(pageId, photo, convId, ctx, forceFresh) {
    if (!photo) return Promise.resolve(null);
    if (!forceFresh && ctx && ctx.nonReusableFbId) {
      return Promise.resolve({ ok: true, fbId: ctx.nonReusableFbId });
    }
    const pid = String(pageId || '');
    if (pid && spareFbIdPool[pid] && spareFbIdPool[pid].length > 0) {
      const pooledFbId = spareFbIdPool[pid].pop();
      if (pooledFbId) {
        if (ctx) ctx.nonReusableFbId = pooledFbId;
        return Promise.resolve({ ok: true, fbId: pooledFbId });
      }
    }
    return photoUploadLane(() => uploadPhotoForPage(pageId, photo, { reusable: false, convId: convId }))
      .then((up) => {
        if (up && up.ok && up.fbId && ctx) {
          ctx.nonReusableFbId = up.fbId;
        }
        return up;
      })
      .catch((e) => ({ ok: false, error: String(e && e.message || e) }));
  }

  async function sendViaSocket(conv, text, photo, ctx) {
    if (photo && !ctx && typeof photo === 'object' && !photo.url && !photo.id) {
      // tương thích ngược nếu nơi nào gọi sendViaSocket(conv, text, ctx)
      ctx = photo;
      photo = null;
    }
    ctx = ctx || {};
    if (conv.type === 'comment') return { ok: false, sent: false, error: 'Socket chỉ áp dụng cho inbox' };
    const helper = window.__MqttHelper__;
    if (!helper || (typeof helper.sendMessage !== 'function' && typeof helper.publish !== 'function')) {
      return { ok: false, sent: false, error: 'Không thấy __MqttHelper__' };
    }
    const platform = detectPlatform(conv.pageId || conv.id.split('_')[0]);
    if (platform !== 'facebook') return { ok: false, sent: false, error: 'Socket chỉ áp dụng cho Facebook' };
    const full = await ctxFull(conv, ctx);
    if (!full) return { ok: false, sent: false, error: 'Không lấy được thông tin đoạn chat' };
    const pageId = full.page_id || conv.pageId || String(conv.id).split('_')[0];

    // 1) Giải quyết threadId & globalId TRƯỚC KHI upload ảnh (đúng thứ tự executeBySocketFB @976000 trong _app):
    //    Nếu chat không tìm được globalId thì dừng ngay, không lãng phí 1 lần upload ảnh reusable=false!
    if (!ctx.threadResolved) {
      let threadId = full.thread_id || full.threadId;
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
    let gid = ctx.gid;
    // Luôn ưu tiên đối chiếu global_id mới nhất từ WebSocket threadMappingStoreV2 ngay từ trước lần bắn đầu tiên
    // (đảm bảo nếu có khách sống nằm lẫn trong cục khách chặn mà cache cũ lệch id thì vẫn lấy đúng global_id mới nhất!)
    if (threadId && pageId) {
      try {
        const sk = helper.SOCKETS && helper.SOCKETS[pageId];
        const ip = sk && sk.context && sk.context.initPageData;
        const wsGid = ip && ((ip.threadMapping && ip.threadMapping[threadId])
          || (ip.threadMappingStoreV2 && ip.threadMappingStoreV2[threadId]));
        if (wsGid && String(wsGid) !== String(gid)) {
          gid = String(wsGid);
          ctx.gid = gid;
          ctx.gidFromPsid = false;
        }
      } catch (e0) { /* ignore */ }
    }
    // Khớp 100% executeBySocketFB (@976000 trong _app): Socket MQTT Lightspeed CHỈ nhận global_id THẬT,
    // TUYỆT ĐỐI không nhận from_psid phỏng đoán (bắn from_psid vào /ls_req sẽ bị FB MQTT treo không trả ACK!).
    if (!gid || (ctx && ctx.gidFromPsid)) {
      recycleUnusedFbId(pageId, ctx);
      return { ok: false, sent: false, error: 'Không tìm thấy globalId thật cho Socket' };
    }
    // Lưu ngay global_id thật vào cache bền vững (kể cả khi khách đã chặn page), để ở các lần gửi sau
    // cục khách đã chặn này có sẵn fastGid0 ở 0ms mà không phải gọi lại GET /messages hay đợi loadThread!
    try {
      if (typeof window.__botfakeSaveGid__ === 'function') {
        window.__botfakeSaveGid__(conv.id, pageId, threadId, gid);
      }
    } catch (e0) { /* ignore */ }

    // 2) CƠ CHẾ LƯỚT SIÊU TỐC QUA "CỤC KHÁCH ĐÃ CHẶN PAGE" (Cluster-Skip Probe v1.66.0):
    //    • Bình thường (socketRejectStreak < 3): upload attachment ảnh riêng (reusable=false) rồi bắn gộp [Ảnh + Chữ].
    //    • Khi gặp chuỗi >= 3 khách liên tiếp bị từ chối (socketRejectStreak[pageId] >= 3 — tức là đang đi vào
    //      "cục khách đã chặn page" như dải 130..287) và tin nhắn có cả chữ lẫn ảnh:
    //      TẠM NGỪNG gọi HTTP POST /contents/facebook upload ảnh trước! Bắn gói Chữ qua WebSocket trước (~30ms,
    //      0 HTTP request upload ảnh!):
    //        - Nếu khách đã chặn (99.9% trong cục): FB trả rejected sau 30ms → báo lỗi ngay mà KHÔNG TỐN 1 lần upload ảnh nào!
    //        - Nếu gặp khách còn sống nằm lẫn trong cục: gói Chữ đi thành công (ok) → reset streak = 0 và lập tức
    //          upload ảnh bắn tiếp phần Ảnh ngay lập tức (khách sống vẫn nhận đủ 100% cả chữ lẫn ảnh)!
    const hasTextMsg = !!(text && String(text).trim().length > 0);
    const inBlockedCluster = !!(photo && hasTextMsg && !ctx.nonReusableFbId && (socketRejectStreak[pageId] || 0) >= 3);
    let attFbIds = null;
    if (photo && !inBlockedCluster) {
      const up = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, false);
      if (!up || !up.ok || !up.fbId) {
        return { ok: false, sent: false, error: 'Không gắn được ảnh cho Socket (' + ((up && up.error) || 'lỗi upload') + ')' };
      }
      attFbIds = [up.fbId];
    }

    const recordSocketGidSuccess = () => {
      if (gid && (!ctx || !ctx.gidFromPsid)) {
        try {
          if (typeof window.__botfakeSaveGid__ === 'function') {
            window.__botfakeSaveGid__(conv.id, pageId, threadId, gid);
          }
          const fId = (full.from && full.from.id) || conv.fromPsid || '';
          if (pageId && fId && !updatedGidConvSet.has(conv.id) && !(ctx && ctx.gidFromServerOrCache)) {
            updatedGidConvSet.add(conv.id);
            sideEffectLane(() => fetch(apiBase() + '/v1/pages/' + pageId + '/customers/' + encodeURIComponent(fId) + '/update_global_id?', {
              method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ global_id: gid, conversation_id: conv.id, source: 'send_inbox', version: 1 }),
            }).catch(() => null));
          }
        } catch (e) { /* ignore */ }
      }
    };

    try {
      const pageLane = getPageSocketLane(pageId);
      // settleSocketResult: TOÀN BỘ xử lý sau khi có kết quả publish (retry khi bị từ chối, bù ảnh,
      // phân loại lỗi…) — dùng chung cho đường chờ ACK (lô nhỏ) và đường bắn-nhả (lô lớn, chạy nền).
      const settleSocketResult = async (rawIn) => {
      let raw = rawIn;
      // Tiêu thụ xong fbId của lần bắn này: nếu có bắn lại phải lấy fbId mới tinh
      if (photo && !inBlockedCluster) ctx.nonReusableFbId = null;

      // Nếu đang ở chế độ thăm dò trong cục khách chặn (inBlockedCluster) mà gói Chữ đi THÀNH CÔNG (gặp khách sống!):
      // Reset ngay socketRejectStreak = 0 và lập tức upload ảnh + bắn bù RIÊNG PHẦN ẢNH (text = '') cho khách này!
      if (inBlockedCluster && raw && raw.kind === 'ok' && photo) {
        socketRejectStreak[pageId] = 0;
        let probePhotoUp = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, false);
        if (probePhotoUp && probePhotoUp.ok && probePhotoUp.fbId) {
          ctx.nonReusableFbId = null;
          let sendPhotoRes = await pageLane(() => socketPublishSend(helper, pageId, gid, '', [probePhotoUp.fbId]));
          if (sendPhotoRes && sendPhotoRes.kind === 'ok') {
            recordSocketGidSuccess();
            return { ok: true, id: gid, sendBy: 'socket', sent: true };
          }
          // Nếu gói Ảnh bắn sát ngay sau gói Chữ trên cùng thread bị nhịp trễ, nghỉ 80ms và thử lại 1 lần với fbId mới
          await sleep(80);
          probePhotoUp = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, true);
          if (probePhotoUp && probePhotoUp.ok && probePhotoUp.fbId) {
            ctx.nonReusableFbId = null;
            sendPhotoRes = await pageLane(() => socketPublishSend(helper, pageId, gid, '', [probePhotoUp.fbId]));
            if (sendPhotoRes && sendPhotoRes.kind === 'ok') {
              recordSocketGidSuccess();
              return { ok: true, id: gid, sendBy: 'socket', sent: true };
            }
          }
        }
        const extPhotoFallback = await sendViaExtension(conv, '', photo, ctx);
        if (extPhotoFallback && extPhotoFallback.ok) {
          recordSocketGidSuccess();
          return { ok: true, id: gid, sendBy: 'socket', sent: true };
        }
        return { ok: false, sent: 'maybe', error: 'Socket: đã gửi được chữ nhưng FB từ chối ảnh đính kèm' };
      }

      // Trường hợp đặc biệt: chữ đã đi thành công nhưng task ảnh bị markOptimisticMessageFailed
      // → TUYỆT ĐỐI không gửi lại chữ (tránh trùng chữ), mà upload 1 fbId mới và bắn bù RIÊNG PHẦN ẢNH (text = '')!
      if (raw && raw.kind === 'photo_failed_text_ok' && photo) {
        socketRejectStreak[pageId] = 0;
        const freshPhotoUp = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, true);
        if (freshPhotoUp && freshPhotoUp.ok && freshPhotoUp.fbId) {
          ctx.nonReusableFbId = null;
          const retryPhotoOnly = await pageLane(() => socketPublishSend(helper, pageId, gid, '', [freshPhotoUp.fbId]));
          if (retryPhotoOnly && retryPhotoOnly.kind === 'ok') {
            recordSocketGidSuccess();
            return { ok: true, id: gid, sendBy: 'socket', sent: true };
          }
        }
        // Nếu Socket vẫn không gửi được ảnh, nhờ Extension gửi bù RIÊNG PHẦN ẢNH (message: '')
        const extPhotoOnly = await sendViaExtension(conv, '', photo, ctx);
        if (extPhotoOnly && extPhotoOnly.ok) {
          recordSocketGidSuccess();
          return { ok: true, id: gid, sendBy: 'socket', sent: true };
        }
        return { ok: false, sent: 'maybe', error: 'Socket: đã gửi được chữ nhưng FB từ chối ảnh đính kèm' };
      }

      // CHỐNG BỎ SÓT TIN DO FACEBOOK MQTT BURST-REJECT MÀ KHÔNG LÀM CHẬM VÙNG KHÁCH KHÓA NICK (v1.65.0):
      //   • Khi đang gửi ở vùng các chat sống (socketRejectStreak[pageId] <= 4): nếu bị rejected lần đầu,
      //     nghỉ nhẹ 100ms rồi lấy fbId mới (ưu tiên 0ms từ spareFbIdPool) và bắn thử lại 1 lần ngay trên Socket
      //     (cứu 100% các chat sống chẳng may dính burst như ở v1.61.0!).
      //   • Khi gặp cả một dải hàng trăm khách đã khóa nick liên tiếp (socketRejectStreak[pageId] > 4, như dải
      //     130..287 trong log): tự động bỏ qua retry lần 2 để không phải upload ảnh lần 2 và bắn Socket lần 2
      //     cho hàng trăm khách đã khóa nick (nhanh gấp đôi ở vùng chat lỗi!).
      if (raw && raw.kind === 'rejected') {
        socketRejectStreak[pageId] = (socketRejectStreak[pageId] || 0) + 1;
      } else if (raw && raw.kind === 'ok') {
        socketRejectStreak[pageId] = 0;
      }
      if (raw && raw.kind === 'rejected' && (!ctx || !ctx.gidFromPsid) && !ctx.socketRetriedOnce && (socketRejectStreak[pageId] || 0) <= 4) {
        // Chat đã được kênh khác xác nhận đến nơi trong lúc chờ ACK → dừng, không bắn lại (chống trùng)
        if (deliveredIds[conv.id]) return { ok: true, id: gid, sendBy: 'socket', sent: true };
        ctx.socketRetriedOnce = true;
        await sleep(100);
        // Kiểm tra xem trong 100ms đó WebSocket threadMappingStoreV2 có nạp được global_id mới hơn không
        if (threadId && pageId) {
          try {
            const sk2 = helper.SOCKETS && helper.SOCKETS[pageId];
            const ip2 = sk2 && sk2.context && sk2.context.initPageData;
            const wsGid2 = ip2 && ((ip2.threadMapping && ip2.threadMapping[threadId])
              || (ip2.threadMappingStoreV2 && ip2.threadMappingStoreV2[threadId]));
            if (wsGid2 && String(wsGid2) !== String(gid)) {
              gid = String(wsGid2);
              ctx.gid = gid;
            }
          } catch (e0) { /* ignore */ }
        }
        if (photo) {
          const freshUp = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, true);
          if (!freshUp || !freshUp.ok || !freshUp.fbId) {
            return { ok: false, sent: false, error: 'Socket: server báo gửi thất bại' };
          }
          ctx.nonReusableFbId = null;
          attFbIds = [freshUp.fbId];
        }
        raw = await pageLane(() => socketPublishSend(helper, pageId, gid, text, attFbIds));
        if (raw && raw.kind === 'ok') {
          socketRejectStreak[pageId] = 0;
        }
        if (raw && raw.kind === 'photo_failed_text_ok' && photo) {
          socketRejectStreak[pageId] = 0;
          const extPhotoOnly2 = await sendViaExtension(conv, '', photo, ctx);
          if (extPhotoOnly2 && extPhotoOnly2.ok) {
            recordSocketGidSuccess();
            return { ok: true, id: gid, sendBy: 'socket', sent: true };
          }
          return { ok: false, sent: 'maybe', error: 'Socket: đã gửi được chữ nhưng FB từ chối ảnh đính kèm' };
        }
      }
      if (raw && raw.ok === false && raw.sent === false && raw.error) {
        return { ok: false, sent: false, error: raw.error };
      }
      if (raw.kind === 'ok') {
        recordSocketGidSuccess();
        return { ok: true, id: gid, sendBy: 'socket', sent: true };
      }
      if (raw.kind === 'dead') return { ok: false, sent: false, error: 'Socket không kết nối' };
      if (raw.kind === 'rejected') {
        // Khi chat ĐÃ CÓ global_id thật (!ctx.gidFromPsid) và ĐÃ THỬ ĐỦ 2 LẦN qua Socket cách xa nhau
        // (lần 1 ở Làn 1 + lần 2 ở Hồ Nền sau khi hết burst) mà Facebook WebSocket vẫn trả về
        // markOptimisticMessageFailed: 100% khách hiện không có mặt / đã khóa nick (fbErrorCode 1545041)!
        const isConfirmedUnavailable = ((!ctx || !ctx.gidFromPsid) && batchStats && batchStats.total > 50)
          || !!(ctx && ctx.socketRetriedOnce); // đã bắn lại 1 lần vẫn bị từ chối = FB xác nhận khách không nhận tin
        return {
          ok: false,
          sent: false,
          recipientUnavailable: !!isConfirmedUnavailable,
          error: isConfirmedUnavailable
            ? 'Socket: FB từ chối nhận tin (khách hiện không có mặt / đã khóa nick)'
            : 'Socket: server báo gửi thất bại',
        };
      }
      if (raw.kind === 'noack') {
        // không có ACK: socket đã chết → frame chưa đi → chắc thua; socket sống → tin CÓ THỂ đã đi
        const sock = helper.SOCKETS && helper.SOCKETS[pageId];
        if (!(sock && sock.instance)) return { ok: false, sent: false, error: 'Socket không kết nối' };
        return { ok: false, sent: 'maybe', error: 'Socket không rõ kết quả (không có ACK)' };
      }
      // legacy — helper không có publish: đường sendMessage cũ (kèm bước chờ 1s của app)
      const res = await pageLane(() => helper.sendMessage(pageId, gid, attFbIds ? { text, attachmentFbIds: attFbIds } : { text }));
      if (res && res.success) {
        recordSocketGidSuccess();
        return { ok: true, id: gid, sendBy: 'socket', sent: true };
      }
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
      };
      // 🔥 NẤC 2 (v1.71.0): bắn-nhả cho lô lớn — publish xong trả kết quả ngay cho worker đi bắn tiếp;
      // ACK thật của FB về sau sẽ chạy settleSocketResult ở nền: thành công → markDelivered (im lặng,
      // tổng hợp tự cập nhật), bị từ chối → bù kênh khác đúng 1 lần qua scheduleBuRetry, không rõ → ⚠.
      if (ctx.sockFired) {
        if (sockFiredPending.has(conv.id)) {
          // Đã bắn rồi và đang chờ ACK — tuyệt đối không bắn lần 2 (chống trùng tận gốc)
          return { ok: true, id: gid, sendBy: 'socket', sent: true, fired: true };
        }
        sockFiredPending.add(conv.id);
        const myRun = runSeq;
        const finalizeSockBg = (res) => {
          sockFiredPending.delete(conv.id);
          if (myRun !== runSeq) return;
          const nm = conv.name || conv.id;
          if (res && res.ok) { markDelivered(conv.id, 'socket'); postSendSideEffects(conv); return; }
          if (res && (res.uncertain || res.sent === 'maybe')) {
            if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
            logLine('⚠ ' + nm + ' — ' + (res.error || 'Socket không rõ kết quả') + ' (xác nhận nền — không gửi thêm để tránh trùng)');
            return;
          }
          if (res && !res.recipientUnavailable && isRetryableLoss(res.error || '')) {
            logLine('❌ ' + nm + ' — ' + (res.error || 'Socket thất bại') + ' (xác nhận nền — sẽ bù kênh khác)');
            scheduleBuRetry(conv, text, photo, nm, 'Socket bị từ chối (xác nhận nền)', ['socket']);
          } else {
            if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
            logLine('❌ ' + nm + ' — ' + ((res && res.error) || 'Socket thất bại') + ' (xác nhận nền)');
          }
        };
        const settleAndFinalize = (rawKind) => {
          if (myRun !== runSeq) return;
          settleSocketResult(rawKind)
            .then((res) => { if (myRun === runSeq) finalizeSockBg(res); })
            .catch(() => { sockFiredPending.delete(conv.id); });
        };
        pageLane(() => socketPublishSend(helper, pageId, gid, text, attFbIds, settleAndFinalize))
          .then((imm) => {
            if (!imm || imm.kind === 'fired') return;
            settleAndFinalize(imm.kind ? imm : { kind: 'noack' });
          })
          .catch(() => settleAndFinalize({ kind: 'noack' }));
        if (photo && !inBlockedCluster) ctx.nonReusableFbId = null;
        return { ok: true, id: gid, sendBy: 'socket', sent: true, fired: true };
      }
      const rawSync = await pageLane(() => socketPublishSend(helper, pageId, gid, text, attFbIds));
      return settleSocketResult(rawSync);
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
    const pageId = full.page_id || conv.pageId || String(conv.id).split('_')[0];

    if (!ctx.threadResolved) {
      let threadId = full.thread_id || full.threadId;
      if (!threadId && typeof window.__syncMissingThreadId__ === 'function') {
        try {
          threadId = await window.__syncMissingThreadId__(pageId, full.id || conv.id);
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
    // SỬA GỐC v1.73.0: findGlobalIdForConv trong bundle (@903213) trả null cho RẤT NHIỀU trường hợp
    // (Extension mất kết nối, adapter trả success=false, không có data.globalId, hoặc exception),
    // KHÔNG chỉ khi khách khóa nick. Vì vậy "chưa dò được global_id" không còn được coi là bằng
    // chứng khách chết: vẫn gọi REPLY_INBOX_PHOTO đúng 1 lần bằng thread_id + globalUserId=null.
    // Chỉ khi chính lệnh GỬI Extension trả thất bại rõ ràng mới xét kênh/API dự phòng ở sendOne.
    const rawGlobalId = ctx.gid || null;
    const globalUserId = (ctx && ctx.gidFromPsid && threadId) ? null : rawGlobalId;
    if (!globalUserId && !threadId) {
      return { ok: false, sent: false, error: 'Không có globalId/thread_id — bỏ qua Ext' };
    }

    const token = getToken();
    let files;
    if (photo) {
      const up = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, false);
      if (!up || !up.ok || !up.fbId) {
        return { ok: false, sent: false, error: 'Không gắn được ảnh cho Extension (' + ((up && up.error) || 'lỗi upload') + ')' };
      }
      // Tiêu thụ fbId cho lần bắn Extension này
      ctx.nonReusableFbId = null;
      files = [up.fbId];
    }
    const payload = {
      pageId: pageId,
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
      // Tách bước chuẩn bị HTTP (ctxFull + uploadPhotoForPage + resolveGlobalId chạy ở extPrepLane)
      // khỏi bước bắn Extension thật (extSendLane): khi vào adapter.send là đã có sẵn
      // 100% payload (globalUserId + files=[fbId]), không giữ slot Extension trong lúc chờ HTTP!
      const res = await extSendLane(() => adapter.send(payload, { timeout: 35000 }));
      if (res && res.ok === false && res.sent === false && res.error) {
        return { ok: false, sent: false, error: res.error };
      }
      if (res && res.success) {
        // HỌC THEO app (onSuccess → update_global_id): globalUserId extension trả về có thể ĐÚNG
        // hơn giá trị mình đoán (có khách globalId là FBID 1000… chứ không phải PSID) — cache lại
        // theo conv id + báo update_global_id lên server để các lần gửi sau có sẵn trong DB
        const gidBack = (res.data && res.data.globalUserId) || globalUserId;
        if (gidBack && typeof gidBack === 'string' && (!ctx || !ctx.gidFromPsid || (res.data && res.data.globalUserId))) {
          try {
            const pId = pageId;
            if (typeof window.__botfakeSaveGid__ === 'function') {
              window.__botfakeSaveGid__(conv.id, pId, threadId, gidBack);
            }
            window.__GlobalIdCacheTest__ && window.__GlobalIdCacheTest__.set(conv.id, gidBack);
            window.__tempGlobalIdCache__ && window.__tempGlobalIdCache__.set(conv.id, gidBack);
            if (ctx) { ctx.gid = gidBack; ctx.gidResolved = true; ctx.gidFromPsid = false; }
            const fId = (full.from && full.from.id) || conv.fromPsid || '';
            if (pId && fId && !updatedGidConvSet.has(conv.id)) {
              updatedGidConvSet.add(conv.id);
              sideEffectLane(() => fetch(apiBase() + '/v1/pages/' + pId + '/customers/' + encodeURIComponent(fId) + '/update_global_id?', {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ global_id: gidBack, conversation_id: conv.id, source: 'send_inbox', version: 1 }),
              }).catch(() => null));
            }
          } catch (e) { /* ignore */ }
        }
        return { ok: true, id: (res.data && (res.data.timestamp || res.data.convId)) || '', sendBy: 'extension', sent: true };
      }
      if (res && res.success === false) {
        // Trong __ExtensionAdapter__.send (@715835), khi setTimeout hết giờ nó trả về { success: false, data: null }
        const d = res.data || {};
        let why = d.errorMessage || d.error || d.reason || d.code || '';
        if (why && typeof why !== 'string') {
          try { why = JSON.stringify(why); } catch (e2) { why = ''; } // không bao giờ lộ "[object Object]"
        }
        const errStr = 'Extension không gửi được' + (why ? ' (' + why + ')' : '');
        // Chỉ kết luận khách khóa nick thật (deadUser) khi đã gửi bằng globalUserId thật (khác null, !ctx.gidFromPsid)
        const deadUser = !!globalUserId && (!ctx || !ctx.gidFromPsid)
          && /1545041|Người này hiện không có mặt|Không tìm thấy người dùng/i.test(String(why || ''));
        return { ok: false, sent: false, recipientUnavailable: deadUser, error: errStr };
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

  // Đúng hàm N + E (upload gắn attachment + fallback UPLOAD_INBOX_PHOTO) trong _app (@881600–883500):
  //   1) POST /v1/pages/{p}/contents/facebook?access_token=…&is_reusable={reusable}&async=false
  //      body: content_ids=[contentId] (hoặc urls), thêm conv_id khi có → { fb_ids }
  //      (tự động retry khi gặp HTTP 429 / 5xx hoặc lỗi mạng tạm thời)
  //   2) Nếu API /contents/facebook lỗi và có photo.url + Extension Pancake:
  //      fallback sang adapter.send({ type: "UPLOAD_INBOX_PHOTO", pageId, photoUrl: url + "?random=" + r, name, platform })
  //      → { success: true, data: { fbId } } (khớp 100% hàm E tại @883200 trong _app!)
  async function uploadPhotoForPage(pageId, photo, opts) {
    const o = opts || {};
    const reusable = o.reusable !== false;
    const token = getToken();
    if (!token) return { ok: false, error: 'Không có access token' };
    const body = {};
    if (photo.id) body.content_ids = JSON.stringify([photo.id]);
    else body.urls = JSON.stringify([photo.url]);
    if (o.convId) body.conv_id = String(o.convId);
    const url = apiBase() + '/v1/pages/' + pageId
      + '/contents/facebook?access_token=' + encodeURIComponent(token)
      + '&is_reusable=' + (reusable ? 'true' : 'false') + '&async=false';
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST', body: JSON.stringify(body), credentials: 'include',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        });
        const j = await res.json().catch(() => null);
        if (res.ok && j && j.success && Array.isArray(j.fb_ids) && j.fb_ids.length) {
          return { ok: true, fbId: j.fb_ids[0] };
        }
        lastErr = (j && (j.message || j.error)) || ('HTTP ' + res.status);
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await sleep(350 * attempt);
          continue;
        }
        break;
      } catch (e) {
        lastErr = 'Lỗi mạng: ' + (e && e.message || e);
        if (attempt < 3) { await sleep(350 * attempt); continue; }
      }
    }
    // Fallback sang UPLOAD_INBOX_PHOTO qua Extension Pancake (đúng hàm E tại @883200 trong _app)
    const adapter = window.__ExtensionAdapter__;
    if (photo && photo.url && adapter && typeof adapter.send === 'function') {
      try {
        const sep = photo.url.indexOf('?') > -1 ? '&' : '?';
        const extRes = await extSendLane(() => adapter.send({
          type: 'UPLOAD_INBOX_PHOTO',
          pageId: pageId,
          photoUrl: photo.url + sep + 'random=' + Math.random(),
          name: 'image_' + Date.now() + '.jpg',
          platform: detectPlatform(pageId) || 'facebook',
        }, { timeout: 25000 }));
        if (extRes && extRes.success && extRes.data && extRes.data.fbId) {
          return { ok: true, fbId: extRes.data.fbId };
        }
      } catch (e2) { /* ignore */ }
    }
    return { ok: false, error: lastErr || 'Upload ảnh thất bại' };
  }

  // ---- SAU KHI GỬI THÀNH CÔNG — 3 request app LUÔN gọi (HAR tinnhan1.har + file "post"):
  // fill_admin_name (ghép tên nhân viên vào chat — per conversation, điều tiết qua sideEffectLane),
  // check_inbox + contents/touch (per page, chốt 1 lần cuối lô). Bắn nền KHÔNG chờ!
  function postSendSideEffects(conv, opts) {
    const o = opts || {};
    try {
      const pageId = (conv && (conv.pageId || conv.page_id)) || String((conv && conv.id) || '').split('_')[0];
      const cid = conv && conv.id;
      if (!pageId) return;
      if (cid && o.perConv !== false) {
        sideEffectLane(() => fetch(apiBase() + '/v1/pages/' + pageId + '/conversations/' + encodeURIComponent(cid)
          + '/messages/fill_admin_name?', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ timestamp: Date.now(), need_remove_lock_crawl_fb_messages: false }),
        }).catch(() => null));
      }
      if (o.perPage) {
        fetch(apiBase() + '/v1/pages/' + pageId + '/check_inbox?', {
          method: 'POST', headers: { Accept: 'application/json' }, credentials: 'include',
        }).catch(() => null);
        fetch(apiBase() + '/v1/pages/' + pageId + '/contents/touch?', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ content_ids: [] }),
        }).catch(() => null);
      }
    } catch (e) { /* việc phụ — không được làm hỏng lô gửi */ }
  }

  // ===== HỆ THỐNG PHÂN LUỒNG ĐA TẦNG (SMART DUAL-ENGINE & CONCURRENCY LANES CHO 30.000 MESS) =====
  //  • apiSendLane (48 luồng): điều tiết POST /messages của fireApiAndWatch (~300 tin/s).
  //  • ctxFetchLane (64 luồng): điều tiết GET /messages của ensureConvCtx (~350–400 chat/s).
  //  • photoUploadLane (64 luồng): điều tiết POST /contents/facebook (reusable=false) riêng cho từng chat (~250–300 ảnh/s).
  //  • gidExtLane (6 luồng): điều tiết GET_GLOBAL_ID_FOR_CONV (chỉ gọi khi HTTP + WS không có global_id).
  //  • extPrepLane (128 luồng): chuẩn bị chung cho các chat CHƯA có sẵn global_id trong RAM.
  //  • extSendLane (6 luồng): bắn REPLY_INBOX_PHOTO qua Extension khi đã cầm đủ payload.
  //  • getPageSocketLane (24 luồng/page): điều tiết số frame /ls_req in-flight trên mỗi kết nối WebSocket
  //    của từng fanpage (tránh vượt ngưỡng burst của edge-chat.facebook.com gây markOptimisticMessageFailed).
  //  • sideEffectLane (4 luồng): điều tiết các request phụ nền (fill_admin_name, update_global_id).
  const API_SEND_PARALLEL = 48;
  const CTX_FETCH_PARALLEL = 96;
  const PHOTO_UPLOAD_PARALLEL = 96;
  const GID_EXT_PARALLEL = 24;
  const PREP_PARALLEL_EXT = 160;  // số chat chưa có global_id chuẩn bị HTTP/WS song song (không bị chặn bởi gidExtLane)
  const BUS_PARALLEL_EXT = 6;     // số lệnh adapter.send (REPLY_INBOX_PHOTO) chạy song song
  const BUS_PARALLEL_SOCKET = 64; // số frame Socket (/ls_req) in-flight trên mỗi kết nối WebSocket (kèm giãn nhịp 2ms chống burst; vẫn giữ retry + socketRejectStreak bảo vệ)
  const SIDE_EFFECT_PARALLEL = 4; // số request nền (fill_admin_name / update_global_id) chạy song song
  function makeLane(parallel) {
    let active = 0;
    const waiters = [];
    const enqueue = function (fn) {
      return new Promise((resolve) => {
        const start = () => {
          if (state.stopRequested) { resolve({ ok: false, sent: false, error: 'Đã dừng' }); return; }
          active++;
          Promise.resolve()
            .then(fn)
            .catch((e) => ({ ok: false, sent: false, error: 'Lỗi kênh: ' + (e && e.message || e) }))
            .then((r) => {
              active--;
              const next = waiters.shift();
              if (next) next(); // giữ thứ tự FIFO cho các lệnh đang chờ
              resolve(r);
            });
        };
        if (active < parallel && !waiters.length) start();
        else waiters.push(start);
      });
    };
    enqueue.busy = () => active >= parallel || waiters.length > 0;
    enqueue.activeCount = () => active;
    enqueue.waitingCount = () => waiters.length;
    return enqueue;
  }
  const apiSendLane = makeLane(API_SEND_PARALLEL);
  const ctxFetchLane = makeLane(CTX_FETCH_PARALLEL);
  const photoUploadLane = makeLane(PHOTO_UPLOAD_PARALLEL);
  const gidExtLane = makeLane(GID_EXT_PARALLEL);
  const extPrepLane = makeLane(PREP_PARALLEL_EXT);
  const extSendLane = makeLane(BUS_PARALLEL_EXT);
  const extLane = extPrepLane;
  const socketLane = makeLane(BUS_PARALLEL_SOCKET);
  const pageSocketLanes = {};
  function getPageSocketLane(pageId) {
    const pid = String(pageId || '');
    if (!pid) return socketLane;
    if (!pageSocketLanes[pid]) pageSocketLanes[pid] = makeLane(BUS_PARALLEL_SOCKET);
    return pageSocketLanes[pid];
  }
  const sideEffectLane = makeLane(SIDE_EFFECT_PARALLEL);
  function busEnqueue(fn) {
    return extPrepLane(fn);
  }

  function isPageSocketReady(pageId) {
    try {
      const h = window.__MqttHelper__;
      const sk = h && h.SOCKETS && h.SOCKETS[pageId];
      return isSocketAlive(sk);
    } catch (e) { return false; }
  }

  // Chuẩn bị chung ngữ cảnh (full, threadId, globalId, nonReusableFbId) TRƯỚC KHI chọn kênh bắn:
  //   • Ở Làn 1 (ctx.fastOnly): chạy SONG SONG (Promise.all) cả resolveGlobalId (GET /messages ~150ms)
  //     và uploadOneTimePhoto (POST /contents/facebook ~350ms) để cắt giảm 30% thời gian chờ HTTP!
  //     Nếu chat chưa có globalId trên Server Pancake (deferredToExt), fbId vừa tạo được cất ngay vào
  //     spareFbIdPool[pageId] để chat sống kế tiếp dùng ở 0ms (tuyệt đối không lãng phí!).
  //   • Ở Làn 2 (!ctx.fastOnly): giải quyết globalId trước, chỉ upload ảnh khi chat có thể gửi được.
  async function prepareDirectCtx(conv, photo, ctx) {
    ctx = ctx || {};
    if (!conv || conv.type === 'comment') return ctx;
    const full = await ctxFull(conv, ctx);
    if (!full) return ctx;
    const pageId = full.page_id || full.pageId || conv.pageId || String(conv.id || '').split('_')[0];
    if (!ctx.threadResolved) {
      let threadId = full.thread_id || full.threadId || conv.threadId || '';
      if (!threadId && !ctx.fastOnly && typeof window.__syncMissingThreadId__ === 'function') {
        try { threadId = await window.__syncMissingThreadId__(pageId, full.id || conv.id); } catch (e) { /* ignore */ }
      }
      if (!threadId && ctx.fastOnly) {
        ctx.deferredToExt = true;
        return ctx;
      }
      ctx.threadId = threadId || null;
      ctx.threadResolved = true;
    }
    const skipPhotoForBlockedCluster = !!(ctx.hasTextMsg && (socketRejectStreak[pageId] || 0) >= 3 && isPageSocketReady(pageId));
    if (!ctx.gidResolved && ctx.threadId) {
      if (ctx.fastOnly && photo && !ctx.nonReusableFbId && !skipPhotoForBlockedCluster) {
        const [gidRes, upRes] = await Promise.all([
          resolveGlobalId(full, ctx.threadId, conv.id, conv.fromPsid, ctx.gidForceFind, ctx),
          uploadOneTimePhoto(pageId, photo, conv.id, ctx, false),
        ]);
        ctx.gid = gidRes;
        if (upRes && upRes.ok && upRes.fbId) ctx.nonReusableFbId = upRes.fbId;
        if (ctx.deferredToExt) {
          // Chưa dùng ở Làn 1 → nhường ngay fbId này vào spareFbIdPool[pageId] cho chat sống tiếp theo dùng ở 0ms!
          recycleUnusedFbId(pageId, ctx);
          return ctx;
        }
        ctx.gidResolved = true;
      } else {
        ctx.gid = await resolveGlobalId(full, ctx.threadId, conv.id, conv.fromPsid, ctx.gidForceFind, ctx);
        if (ctx.deferredToExt) {
          recycleUnusedFbId(pageId, ctx);
          return ctx;
        }
        ctx.gidResolved = true;
      }
    }
    // Nếu không tìm thấy cả globalId thật lẫn xác nhận hội thoại từ Extension → không tốn công upload ảnh
    const canSend = !!((ctx.gid && !ctx.gidFromPsid) || (ctx.threadId && !ctx.noGidConfirmedByExt));
    if (!canSend) {
      recycleUnusedFbId(pageId, ctx);
      return ctx;
    }
    const skipNow = !!(ctx.hasTextMsg && (socketRejectStreak[pageId] || 0) >= 3 && ctx.gid && !ctx.gidFromPsid && isPageSocketReady(pageId));
    if (photo && !ctx.nonReusableFbId && canSend && !skipNow) {
      const up = await uploadOneTimePhoto(pageId, photo, conv.id, ctx, false);
      if (up && up.ok && up.fbId) ctx.nonReusableFbId = up.fbId;
    }
    return ctx;
  }

  function pickBestDirectOrder(conv, pageId, ctx, baseSeq) {
    const seq = (baseSeq || ['ext', 'socket', 'api']).slice();
    if (!conv || conv.type === 'comment') return seq;
    const hasSock = seq.indexOf('socket') > -1;
    const hasExt = seq.indexOf('ext') > -1;
    if (!hasSock || !hasExt) return seq;
    const hint = channelHints[conv.id];
    const sockReady = isPageSocketReady(pageId);
    const hasRealGid = !!(ctx && ctx.gid && !ctx.gidFromPsid);
    // Khớp 100% với __sendBySocketCacheFB__ trong _app (@927067 & @937200):
    // CHỈ ưu tiên bắn qua Socket trước khi WebSocket đang kết nối (sockReady) VÀ ĐÃ CÓ global_id THẬT (hasRealGid)!
    // Tuyệt đối không ưu tiên Socket khi chưa có global_id thật (vì Socket không nhận from_psid).
    const preferSocket = sockReady && hasRealGid && (hint === 'socket' || hasRealGid);
    const first = preferSocket ? 'socket' : 'ext';
    const second = preferSocket ? 'ext' : 'socket';
    const rest = seq.filter((x) => x !== 'socket' && x !== 'ext');
    return [first, second].concat(rest);
  }

  // API (nhanh) → Extension ⇄ Socket (Smart Dual-Engine cho cả text lẫn ảnh)
  // CHỈ gửi hàng loạt — KHÔNG còn cơ chế gửi từng con qua giao diện.
  // Chống TRÙNG TIN: kênh nào báo "không rõ kết quả" (tin có thể đã đi) → DỪNG ngay,
  // không thử kênh khác, không gửi thêm. Lỗi là lỗi — báo trong log, không gửi lại, không kiểm tra lại.
  async function sendOne(conv, text, photo, opts) {
    opts = opts || {};
    // ⚡ CHẾ ĐỘ NHANH — ĐÚNG PLAN CỦA APP (_app @936800, @945200):
    //   • TEXT hoặc ẢNH ngoài cửa sổ 24h + !dr(): đi thẳng Extension ⇄ Socket trước (bắn API trước
    //     100% bị FB từ chối (#551)/(#10)). Việc chọn ưu tiên Socket hay Extension được quyết định ĐỘNG
    //     ngay tại thời điểm chuẩn bị xong ctx, kết hợp làn Cao Tốc (0ms Fast-Path) khi đã có sẵn global_id!
    //   • Chat trong cửa sổ 24h hoặc có cờ dr() (quảng cáo ≤7 ngày): bắn API trước như thường.
    if (opts.quick && !opts.skipApi && conv.type !== 'comment') {
      const full = peekConv(conv) || conv;
      const hint = channelHints[conv.id];
      const idleDiff = getConvIdleMs(conv, full);
      const idleLong = !isNaN(idleDiff) && idleDiff > 86400000;
      const textOutWin = !photo && idleLong && !isRecordCtx7Days(full);
      const photoOutWin = !!photo && idleLong && !isRecordCtx7Days(full);
      const noApiPhoto = !!(photo && !photo.fbId);
      const goDirect = batchSkipApi
        || noApiPhoto
        || (photo && hint && hint !== 'api')
        || textOutWin
        || photoOutWin;
      if (goDirect) {
        let directOpts;
        if (textOutWin || photoOutWin || noApiPhoto) {
          // Với chat đã ngoài cửa sổ 24h (!isRecordCtx7Days) khi chạy lô lớn (>50 chat):
          // không gọi lại Graph API ở cuối (vì 100% bị FB trả #551/#10, tốn hàng trăm request HTTP vô ích!)
          const skipFutileApi = batchSkipApi || noApiPhoto || ((textOutWin || photoOutWin) && batchStats && batchStats.total > 50);
          const baseOutPlan = ['ext', 'socket', 'api'].filter((x) => !(skipFutileApi && x === 'api'));
          directOpts = {
            plan: baseOutPlan,
            dynamicDirect: true,
            fastOnly: !!opts.fastOnly,
            deferredCtx: opts.deferredCtx || null,
            sockFired: !!opts.sockFired,
          };
        } else if (batchSkipApi) {
          directOpts = {
            skipApi: true,
            dynamicDirect: true,
            fastOnly: !!opts.fastOnly,
            deferredCtx: opts.deferredCtx || null,
            sockFired: !!opts.sockFired,
          };
        } else {
          directOpts = {
            directChain: true,
            dynamicDirect: true,
            fastOnly: !!opts.fastOnly,
            deferredCtx: opts.deferredCtx || null,
            sockFired: !!opts.sockFired,
          };
        }
        if (opts.awaitDirect) {
          return sendOne(conv, text, photo, directOpts);
        }
        const myRun = runSeq;
        sendOne(conv, text, photo, directOpts).then((r) => {
          if (myRun !== runSeq) return;
          const nm2 = conv.name || conv.id;
          if (r.ok) {
            if (r.fired) return; // bắn-nhả: xác nhận nền tự ghi nhận khi ACK về — không chốt sớm
            markDelivered(conv.id, r.sendBy || 'ext');
            postSendSideEffects(conv);
            logLine('✅ ' + nm2 + ' — gửi THÀNH CÔNG qua '
              + (r.sendBy === 'socket' ? 'Socket' : r.sendBy === 'extension' ? 'Extension' : 'API'));
            return;
          }
          if (r.uncertain) {
            if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
            logLine('⚠ ' + nm2 + ' — ' + r.error + ' (không rõ — không gửi thêm)');
          } else {
            if (r.windowClosed) windowBlocked++;
            logLine('❌ ' + nm2 + ' — ' + r.error);
          }
          // cửa sổ 24h VẪN bù kênh khác (Thanh Binh); khách khóa nick (recipientUnavailable) hoặc hết kênh → tự bỏ
          if (!r.ok && !r.uncertain && !r.recipientUnavailable && isRetryableLoss(r.error)) {
            scheduleBuRetry(conv, text, photo, nm2, 'gửi thẳng chưa được', r.tried || []);
          } else if (!r.ok && !r.uncertain) {
            if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
          }
        });
        return { ok: true, id: '', sendBy: 'direct', sent: true, fired: true };
      }
      return fireApiAndWatch(conv, text, photo);
    }
    // ngữ cảnh dùng chung cho các kênh của CÙNG 1 chat: conversation, threadId, globalId, nonReusableFbId…
    const ctx = (opts.deferredCtx && typeof opts.deferredCtx === 'object') ? opts.deferredCtx : {};
    ctx.fastOnly = !!opts.fastOnly;
    ctx.sockFired = !!opts.sockFired;
    ctx.hasTextMsg = !!(text && String(text).trim().length > 0);
    ctx.deferredToExt = false;
    if (!ctx.fastOnly && ctx.gidResolved && !ctx.gid) {
      ctx.gidResolved = false;
    }
    const channels = {
      api: async () => {
        const r = await sendViaApi(conv, text, photo, ctx);
        if (!r.ok && r.sent !== 'maybe' && isThreadControlError(r.error)) batchSkipApi = true;
        return r;
      },
      socket: () => sendViaSocket(conv, text, photo, ctx),
      ext: () => sendViaExtension(conv, text, photo, ctx),
    };
    const order = (conv.type === 'comment') ? ['api', 'ext'] : ['api', 'ext', 'socket'];
    let seq;
    if (opts.plan && opts.plan.length) {
      seq = opts.plan.slice();
    } else {
      const hint = channelHints[conv.id];
      seq = (hint && order.indexOf(hint) > -1)
        ? [hint].concat(order.filter((x) => x !== hint))
        : order.slice();
      if (batchSkipApi || (photo && !photo.fbId && conv.type !== 'comment')) {
        seq = seq.filter((x) => x !== 'api');
      }
      if (opts.skipApi) seq = seq.filter((x) => x !== 'api');
      if (opts.directChain) {
        seq = seq.filter((x) => x !== 'api');
        if (!batchSkipApi && !(photo && !photo.fbId)) seq.push('api');
      }
    }

    // 🚀 LÀN CAO TỐC 0ms (ULTRA-TURBO FAST-PATH CHO CẢ TEXT VÀ ẢNH):
    // Nếu là luồng gửi thẳng ngoài 24h (dynamicDirect):
    //   • Kiểm tra đồng bộ 0ms xem chat này đã có sẵn global_id thật trong RAM/Cache/WebSocket chưa (peekFastGlobalId).
    //   • Nếu ĐÃ CÓ SẴN global_id thật (kể cả khi gửi kèm ảnh!): điền thẳng vào ctx ở 0ms và BỎ QUA HOÀN TOÀN extPrepLane!
    //   • Nếu chưa có trong RAM: vào prepareDirectCtx (chạy song song resolveGlobalId + uploadOneTimePhoto ở Làn 1).
    const peeked0 = peekConv(conv) || conv;
    const pid0 = (peeked0 && (peeked0.page_id || peeked0.pageId)) || conv.pageId || String(conv.id || '').split('_')[0];
    if (opts.dynamicDirect && conv.type !== 'comment' && (seq[0] === 'ext' || seq[0] === 'socket')) {
      const fastGid0 = peekFastGlobalId(conv, peeked0, '');
      const tid0 = (peeked0 && (peeked0.thread_id || peeked0.threadId)) || conv.threadId || '';
      if (fastGid0 && (tid0 || isPageSocketReady(pid0))) {
        ctx.full = peeked0;
        ctx.fullLoaded = true;
        if (tid0) {
          ctx.threadId = String(tid0);
          ctx.threadResolved = true;
        }
        ctx.gid = String(fastGid0);
        ctx.gidResolved = true;
        ctx.gidFromPsid = false;
        ctx.gidFromServerOrCache = true;
      } else {
        await extPrepLane(() => prepareDirectCtx(conv, photo, ctx));
        if (ctx.deferredToExt) {
          return { ok: false, sent: false, deferredToExt: true, deferredCtx: ctx };
        }
        if (ctx.noGidConfirmedByExt && (!ctx.gid || ctx.gidFromPsid)) {
          // Chưa hề có tin nào được bắn cho chat này, nên cứu hộ ở đây không thể gây trùng:
          // thử Extension bằng thread_id trước, sau đó API bằng conversation_id (đúng fallback
          // của luồng gửi tay trong _app: extension -> socket -> api). Không còn chốt oan
          // "khách đã khóa nick" chỉ vì bước DÒ global_id trả null.
          ctx.noGidConfirmedByExt = false;
          ctx.extThreadOnlyRescue = true;
          ctx.gid = null;
          ctx.gidFromPsid = false;
          ctx.gidResolved = true;
          const canApiRescue = !batchSkipApi && seq.indexOf('api') < 0 && !(photo && !photo.fbId);
          if (canApiRescue) seq.push('api');
          logLine('🛟 ' + (conv.name || conv.id)
            + ' — chưa dò được global_id; chưa kết luận khách khóa nick, sẽ thử Extension theo thread_id'
            + (canApiRescue ? ' và API theo conversation_id như đường gửi tay' : ''));
        }
      }
      const pid = (ctx.full && (ctx.full.page_id || ctx.full.pageId)) || pid0;
      seq = pickBestDirectOrder(conv, pid, ctx, seq);
    }

    const tried = Array.isArray(ctx.triedErrors) ? ctx.triedErrors.slice() : [];
    const triedCh = Array.isArray(ctx.triedChannels) ? ctx.triedChannels.slice() : [];
    if (triedCh.length) {
      seq = seq.filter((x) => triedCh.indexOf(x) < 0);
    }
    for (let i = 0; i < seq.length; i++) {
      const ch = seq[i];
      if (state.stopRequested) break;
      // Trong Làn Nhanh (ctx.fastOnly === true): không giữ chân worker để đứng chờ Extension (extSendLane),
      // mà đẩy sang hồ nền extBacklogQueue xử lý nốt!
      if (ctx.fastOnly && ch === 'ext') {
        ctx.triedErrors = tried.slice();
        ctx.triedChannels = triedCh.slice();
        return { ok: false, sent: false, deferredToExt: true, deferredCtx: ctx };
      }
      const r = (ch === 'api')
        ? await channels[ch]()
        : (ctx.fullLoaded && ctx.gidResolved
          ? await channels[ch]()
          : await busEnqueue(() => channels[ch](), ch));
      if (r && r.deferredToExt) {
        ctx.triedErrors = tried.slice();
        ctx.triedChannels = triedCh.slice();
        return { ok: false, sent: false, deferredToExt: true, deferredCtx: ctx };
      }
      if (r.ok) {
        markChannel(conv.id, ch);
        return { ok: true, id: r.id || '', sendBy: r.sendBy || ch, sent: true, fired: !!r.fired };
      }
      triedCh.push(ch);
      tried.push((ch === 'ext' ? 'Ext' : ch) + ': ' + (r.error || 'fail'));
      // "không rõ" = tin CÓ THỂ đã đi — thử tiếp kênh khác sẽ gửi TRÙNG → dừng ngay
      if (r.sent === 'maybe') {
        recycleUnusedFbId(pid0, ctx);
        return { ok: false, uncertain: true, sent: 'maybe', tried: triedCh.slice(), error: tried.join(' | ') };
      }
      // Khách đã khóa nick/chặn page được chính Extension xác nhận bằng global_id thật
      // (fbErrorCode 1545041) hoặc (#100) không tìm thấy người dùng → dừng luôn
      if (r.recipientUnavailable || /\(#100\)|Không tìm thấy người dùng phù hợp/i.test(r.error || '')) {
        recycleUnusedFbId(pid0, ctx);
        return { ok: false, sent: false, recipientUnavailable: true, tried: triedCh.slice(), error: tried.join(' | ') };
      }
      // Nếu vừa dùng from_psid phỏng đoán (ctx.gidFromPsid === true) hoặc lỗi thiếu globalId/thread_id:
      // bắt buộc mở khóa ctx.gidResolved = false để kênh kế tiếp dò lại global_id thật (nhỡ WebSocket
      // hoặc Extension vừa nạp xong), tuyệt đối không bắn tiếp bằng from_psid sai!
      if ((ctx && ctx.gidFromPsid) || (conv.fromPsid && /globalId|thread_id/i.test(r.error || ''))) {
        ctx.gidForceFind = true;
        ctx.gidResolved = false;
        ctx.gidFromPsid = false;
        ctx.gid = null;
      }
      if (r.error && r.error.indexOf('Token') === 0) {
        recycleUnusedFbId(pid0, ctx);
        return r; // token hỏng — dừng hẳn
      }
    }
    recycleUnusedFbId(pid0, ctx);
    return { ok: false, sent: false, tried: triedCh.slice(), error: tried.join(' | ') };
  }

  // ===== CACHE BỀN VỮNG GLOBAL_ID (LOCALSTORAGE + INDEXEDDB "fb_meta_data") & VÁ MQTTHELPER =====
  // 1) Lưu mọi global_id THẬT (!gidFromPsid) vào localStorage (ssb_global_id_cache_v1) + nạp toàn bộ
  //    IndexedDB "fb_meta_data" (2 bảng "global_user_ids" & "global_user_ids_2" của Pancake @814000)
  //    vào RAM ngay khi chạy → sau F5 vẫn có sẵn global_id của hàng nghìn chat ở 0ms!
  // 2) Vá trực tiếp lỗi nội tại của window.__MqttHelper__ trong bundle Pancake (@822420–828800):
  //    - triggerLoadMoreThreads(e, t) của Pancake truyền nhầm `t` (Object) thay vì `t.step` (Array)
  //      vào findBlockAction(t, "setBusinessThreadInfo") → luôn trả null → mỗi trang loadThread (~15
  //      chat) bị ngủ cứng hết setTimeout 5.000ms (5s/trang = 3 chat/s, mất 59s cho 12 trang đầu ở
  //      log 10:15:26→10:16:25 và >8 phút cho 1.500 chat!). Vá truyền đúng `t.step` + kiểm tra đủ
  //      setBusinessThreadInfo / deleteThenInsertThread / updateFilteredThreadsRanges → giải phóng
  //      loading_thread_{pageId} ngay khi gói WS về (~80ms/trang thay vì 5.000ms/trang — nhanh gấp 60x).
  //    - initLoadThread / resolveSearchGlobalIdTask giới hạn maxLoadThreadCount = 10 (15 trang ~ 225
  //      chat) và tự gán -1 dừng sớm → nâng lên 500 trang (7.500+ chat) suốt phiên gửi.
  const GID_LS_KEY = 'ssb_global_id_cache_v1';
  const persistentGidMap = {};
  try {
    const rawGids = JSON.parse(localStorage.getItem(GID_LS_KEY) || '{}');
    if (rawGids && typeof rawGids === 'object') Object.assign(persistentGidMap, rawGids);
  } catch (e) { /* ignore */ }

  let gidSaveTimer = null;
  function flushPersistentGids() {
    gidSaveTimer = null;
    try { localStorage.setItem(GID_LS_KEY, JSON.stringify(persistentGidMap)); } catch (e) { /* ignore */ }
  }

  function putGidToMemCaches(key, val) {
    if (!key || !val) return;
    const s = String(val);
    persistentGidMap[key] = s;
    try {
      if (!window.__tempGlobalIdCache__) {
        const m = new Map();
        window.__tempGlobalIdCache__ = { get: (k) => m.get(k), set: (k, v) => m.set(k, v) };
      }
      window.__tempGlobalIdCache__.set(key, s);
      if (window.__GlobalIdCacheTest__ && typeof window.__GlobalIdCacheTest__.set === 'function') {
        window.__GlobalIdCacheTest__.set(key, s);
      }
    } catch (e) { /* ignore */ }
  }

  // Khôi phục sẵn các global_id từ localStorage vào RAM ngay lúc nạp script
  try {
    if (!window.__tempGlobalIdCache__) {
      const m0 = new Map();
      window.__tempGlobalIdCache__ = { get: (k) => m0.get(k), set: (k, v) => m0.set(k, v) };
    }
    Object.keys(persistentGidMap).forEach((k) => putGidToMemCaches(k, persistentGidMap[k]));
  } catch (e) { /* ignore */ }

  window.__botfakeSaveGid__ = function (convId, pageId, threadId, gid) {
    if (!gid) return;
    const s = String(gid);
    if (convId) putGidToMemCaches(String(convId), s);
    if (pageId && threadId) putGidToMemCaches(String(pageId) + '_' + String(threadId), s);
    if (!gidSaveTimer) gidSaveTimer = setTimeout(flushPersistentGids, 400);
    try {
      const fbStore = window.__FBMetaDataStore__;
      if (fbStore && typeof fbStore.insertGlobalId === 'function' && pageId && threadId) {
        fbStore.insertGlobalId(String(pageId), String(threadId), s, 'global_user_ids_2');
      }
    } catch (e) { /* ignore */ }
  };

  let idbPreloaded = false;
  function preloadPersistentGlobalIds() {
    try {
      Object.keys(persistentGidMap).forEach((k) => putGidToMemCaches(k, persistentGidMap[k]));
    } catch (e) { /* ignore */ }
    if (idbPreloaded || typeof indexedDB === 'undefined') return;
    idbPreloaded = true;
    try {
      const req = indexedDB.open('fb_meta_data');
      req.onsuccess = (ev) => {
        try {
          const db = ev && ev.target && ev.target.result;
          if (!db) return;
          ['global_user_ids', 'global_user_ids_2'].forEach((storeName) => {
            try {
              if (!db.objectStoreNames || !db.objectStoreNames.contains(storeName)) return;
              const tx = db.transaction(storeName, 'readonly');
              const st = tx.objectStore(storeName);
              const allReq = st.getAll();
              allReq.onsuccess = () => {
                const rows = allReq.result || [];
                rows.forEach((r) => {
                  if (r && r.pageId && r.threadId && r.globalId) {
                    putGidToMemCaches(String(r.pageId) + '_' + String(r.threadId), String(r.globalId));
                  }
                });
              };
            } catch (e2) { /* ignore */ }
          });
        } catch (e1) { /* ignore */ }
      };
    } catch (e) { /* ignore */ }
  }
  preloadPersistentGlobalIds();

  function syncSocketMappingsToCache(helper, pageId) {
    try {
      const sk = helper && helper.SOCKETS && helper.SOCKETS[pageId];
      const ip = sk && sk.context && sk.context.initPageData;
      if (!ip) return;
      // Khởi tạo sẵn cả threadMapping & threadMappingStoreV2 là {} để chặn đứng lỗi TypeError
      // tại o.context.initPageData.threadMapping[c] trong resolveSearchGlobalIdTask (@823506 của _app)!
      if (!ip.threadMapping || typeof ip.threadMapping !== 'object') ip.threadMapping = {};
      if (!ip.threadMappingStoreV2 || typeof ip.threadMappingStoreV2 !== 'object') ip.threadMappingStoreV2 = {};
      [ip.threadMapping, ip.threadMappingStoreV2].forEach((mp) => {
        if (!mp || typeof mp !== 'object') return;
        Object.keys(mp).forEach((tid) => {
          if (tid && mp[tid]) putGidToMemCaches(String(pageId) + '_' + String(tid), String(mp[tid]));
        });
      });
      // Đánh thức NGAY LẬP TỨC (0ms) mọi PENDING_MESSAGES['find_global_id_|{pageId}_|{tid}'] đang chờ,
      // không bao giờ để bị treo 4.5s chờ wsTimer nổ khi origResolve của _app gặp lỗi!
      if (helper.PENDING_MESSAGES && typeof helper.PENDING_MESSAGES === 'object') {
        const prefix = 'find_global_id_|' + String(pageId) + '_|';
        Object.keys(helper.PENDING_MESSAGES).forEach((k) => {
          if (!k || k.indexOf(prefix) !== 0) return;
          const tid = k.slice(prefix.length);
          if (!tid || tid === '__botfake_keepalive__') return;
          const foundGid = ip.threadMapping[tid] || ip.threadMappingStoreV2[tid] || persistentGidMap[String(pageId) + '_' + tid];
          if (foundGid) {
            const pm = helper.PENDING_MESSAGES[k];
            delete helper.PENDING_MESSAGES[k];
            if (pm) {
              if (pm.clearTimeout) clearTimeout(pm.clearTimeout);
              if (typeof pm.callback === 'function') {
                try { pm.callback({ success: true, data: String(foundGid) }); } catch (e2) { /* ignore */ }
              }
            }
          }
        });
      }
    } catch (e) { /* ignore */ }
  }

  function patchMqttHelper(helper) {
    if (!helper || typeof helper !== 'object' || helper.__botfakePatched) return;
    helper.__botfakePatched = true;
    try {
      // 1) Vá triggerLoadMoreThreads (@822420): truyền đúng parsed.step (Array) thay vì parsed (Object)
      helper.triggerLoadMoreThreads = function (pageId, parsed) {
        try {
          syncSocketMappingsToCache(this, pageId);
          const step = (parsed && parsed.step) ? parsed.step : parsed;
          const hasData = step && typeof this.findBlockAction === 'function' && (
            this.findBlockAction(step, 'setBusinessThreadInfo')
            || this.findBlockAction(step, 'deleteThenInsertThread')
            || this.findBlockAction(step, 'updateFilteredThreadsRanges')
          );
          const key = 'loading_thread_' + pageId;
          if (hasData && this.PENDING_MESSAGES && this.PENDING_MESSAGES[key]) {
            clearTimeout(this.PENDING_MESSAGES[key].clearTimeout);
            const cb = this.PENDING_MESSAGES[key].callback;
            delete this.PENDING_MESSAGES[key];
            if (typeof cb === 'function') cb(parsed);
          }
        } catch (e) { /* ignore */ }
      };
      // 2) Bọc initLoadThread (@828800) & loadThread (@827500): nâng giới hạn từ 10 trang (~150 chat) lên 5000 trang (~75.000 chat)
      //    và đảm bảo sock.lastApplyCursor luôn có .get('205') để loadThread không bao giờ văng lỗi
      if (typeof helper.initLoadThread === 'function') {
        const origInitLoad = helper.initLoadThread;
        helper.initLoadThread = function (sock) {
          const r = origInitLoad.apply(this, arguments);
          if (sock && typeof sock === 'object') {
            sock.maxLoadThreadCount = Math.max(sock.maxLoadThreadCount || 0, 5000);
          }
          return r;
        };
      }
      if (typeof helper.loadThread === 'function') {
        const origLoadThread = helper.loadThread;
        helper.loadThread = function (pageId) {
          try {
            const sock = this.SOCKETS && this.SOCKETS[pageId];
            if (sock && (!sock.lastApplyCursor || typeof sock.lastApplyCursor.get !== 'function')) {
              sock.lastApplyCursor = new Map([['205', null]]);
            }
          } catch (e0) { /* ignore */ }
          return origLoadThread.apply(this, arguments);
        };
      }
      // 3) Vá lỗi thứ 4 trong loadThread (@827500): _app gửi task với queue_name === 'trq' (label: '313' / '145')
      //    và truyền nhầm reference_thread_key: a.filterThreadParams.referenceActivityTimestamp thay vì referenceThreadKey.
      //    LƯU Ý QUAN TRỌNG: KHÔNG mở khóa loading_thread_{pageId} ngay khi pubPromise (Gói 1 ACK) resolve!
      //    Vì Gói 1 chỉ là ACK của task 313, chưa chứa updateFilteredThreadsRanges & deleteThenInsertThread (nằm ở Gói 2
      //    push về sau đó ~30ms). Nếu mở khóa sớm ở Gói 1, loadThread sẽ gửi tiếp với CÙNG referenceActivityTimestamp cũ
      //    và bị kẹt ở 300 mess đầu! Việc mở khóa loading_thread_{pageId} phải do triggerLoadMoreThreads / resolveSearchGlobalIdTask
      //    thực hiện đúng lúc Gói 2 (chứa updateFilteredThreadsRanges / deleteThenInsertThread / setBusinessThreadInfo) về tới!
      if (typeof helper.publish === 'function') {
        const origPublish = helper.publish;
        helper.publish = function (pageId, topic, frame, qos) {
          try {
            if (topic === '/ls_req' && frame && Array.isArray(frame.tasks) && frame.tasks.length === 1) {
              const t0 = frame.tasks[0];
              if (t0 && (t0.queue_name === 'trq' || t0.label === '313' || t0.label === '145') && typeof t0.payload === 'string') {
                const sock = this.SOCKETS && this.SOCKETS[pageId];
                const fp = sock && sock.filterThreadParams;
                if (fp && fp.referenceThreadKey !== undefined && fp.referenceThreadKey !== fp.referenceActivityTimestamp) {
                  const pl = JSON.parse(t0.payload);
                  if (pl && pl.reference_thread_key === fp.referenceActivityTimestamp) {
                    pl.reference_thread_key = fp.referenceThreadKey;
                    t0.payload = JSON.stringify(pl);
                  }
                }
                // Rút ngắn timeout dự phòng của loading_thread_{pageId} từ 5000ms xuống 1200ms (phòng khi đã hết trang cuối)
                const key = 'loading_thread_' + pageId;
                const pm = this.PENDING_MESSAGES && this.PENDING_MESSAGES[key];
                if (pm && pm.clearTimeout) {
                  clearTimeout(pm.clearTimeout);
                  const self = this;
                  pm.clearTimeout = setTimeout(() => {
                    try {
                      if (self.PENDING_MESSAGES && self.PENDING_MESSAGES[key]) {
                        const cb = self.PENDING_MESSAGES[key].callback;
                        delete self.PENDING_MESSAGES[key];
                        if (typeof cb === 'function') cb({ success: false, data: null });
                      }
                    } catch (e3) { /* ignore */ }
                  }, 1200);
                }
              }
            }
          } catch (e0) { /* ignore */ }
          return origPublish.apply(this, arguments);
        };
      }
      // 4) Bọc resolveSearchGlobalIdTask (@823506):
      //    - Khởi tạo sẵn o.context.initPageData.threadMapping = {} TRƯỚC khi origResolve chạy (chặn đứng lỗi
      //      TypeError: Cannot read properties of undefined tại o.context.initPageData.threadMapping[c] trong _app
      //      vốn là nguyên nhân làm treo các chat đợi wsTimer 4.5s!).
      //    - Đồng bộ ngay globalId mới vào cache RAM + đánh thức PENDING_MESSAGES ở 0ms!
      if (typeof helper.resolveSearchGlobalIdTask === 'function') {
        const origResolve = helper.resolveSearchGlobalIdTask;
        helper.resolveSearchGlobalIdTask = function (pageId, parsed) {
          try {
            const sk0 = this.SOCKETS && this.SOCKETS[pageId];
            if (sk0 && sk0.context && sk0.context.initPageData) {
              if (!sk0.context.initPageData.threadMapping) sk0.context.initPageData.threadMapping = {};
              if (!sk0.context.initPageData.threadMappingStoreV2) sk0.context.initPageData.threadMappingStoreV2 = {};
            }
            if (this.PENDING_MESSAGES && (state.sending || batchStats.active)) {
              const kaKey = 'find_global_id_|' + pageId + '_|__botfake_keepalive__';
              if (!this.PENDING_MESSAGES[kaKey]) {
                this.PENDING_MESSAGES[kaKey] = { callback: function () {}, clearTimeout: null };
              }
            } else if (this.PENDING_MESSAGES) {
              delete this.PENDING_MESSAGES['find_global_id_|' + pageId + '_|__botfake_keepalive__'];
            }
          } catch (e0) { /* ignore */ }
          const r = origResolve.apply(this, arguments);
          try {
            syncSocketMappingsToCache(this, pageId);
            const sock = this.SOCKETS && this.SOCKETS[pageId];
            if (sock && (state.sending || batchStats.active)) {
              sock.maxLoadThreadCount = Math.max(sock.maxLoadThreadCount || 0, 5000);
            }
            this.triggerLoadMoreThreads(pageId, parsed);
          } catch (e) { /* ignore */ }
          return r;
        };
      }
    } catch (e) { /* ignore */ }
  }

  // Làm nóng Socket TRƯỚC khi gửi: lần dùng Socket đầu tiên trong phiên (nhất là ngay sau F5)
  // phải trả phí kết nối + đồng bộ thread map ~10s (initSocket). Làm nóng ngay lúc bắn lô —
  // chạy song song các bắn API — nên khi nào cần bù Socket thì chỉ còn ~1–2s của sendMessage.
  const socketWarmPromises = {}; // pageId → Promise kết nối socket (đang chạy dở)
  const batchGidFetchedPages = {}; // pageId → đã gọi BATCH_GET_GLOBAL_ID (@897543) trong phiên
  const batchGidPromises = {}; // pageId → Promise BATCH_GET_GLOBAL_ID đang chạy

  function warmUpSockets(targets) {
    try {
      preloadPersistentGlobalIds();
      const h = window.__MqttHelper__;
      const adapter = window.__ExtensionAdapter__;
      if (h) patchMqttHelper(h);
      const seen = {};
      (targets || []).forEach((c) => {
        const pid = c.pageId || String(c.id || '').split('_')[0];
        if (!pid || seen[pid]) return;
        seen[pid] = true;
        // 1) Gọi BATCH_GET_GLOBAL_ID (@897543 trong _app) 1 lần/page để nạp hàng loạt { threadId, globalId }
        //    từ IndexedDB của Extension vào cache RAM + localStorage chỉ bằng 1 lệnh duy nhất!
        if (adapter && typeof adapter.send === 'function' && !batchGidFetchedPages[pid]) {
          batchGidFetchedPages[pid] = true;
          batchGidPromises[pid] = Promise.resolve().then(() => adapter.send({
            type: 'BATCH_GET_GLOBAL_ID',
            pageId: pid,
          }, { timeout: 15000 })).then((res) => {
            delete batchGidPromises[pid];
            const list = res && res.success && res.data && res.data.threadsWithGlobalId;
            if (Array.isArray(list)) {
              list.forEach((it) => {
                if (it && it.threadId && it.globalId && typeof window.__botfakeSaveGid__ === 'function') {
                  window.__botfakeSaveGid__(String(pid) + '_' + String(it.threadId), pid, it.threadId, String(it.globalId));
                }
              });
            }
          }).catch(() => { delete batchGidPromises[pid]; return null; });
        }
        if (!h || typeof h.initSocket !== 'function') return;
        syncSocketMappingsToCache(h, pid);
        try {
          if (h.PENDING_MESSAGES && (state.sending || batchStats.active)) {
            const kaKey = 'find_global_id_|' + pid + '_|__botfake_keepalive__';
            if (!h.PENDING_MESSAGES[kaKey]) {
              h.PENDING_MESSAGES[kaKey] = { callback: function () {}, clearTimeout: null };
            }
          }
          if (h.SOCKETS && h.SOCKETS[pid]) {
            h.SOCKETS[pid].maxLoadThreadCount = Math.max(h.SOCKETS[pid].maxLoadThreadCount || 0, 5000);
            if (h.SOCKETS[pid].instance && typeof h.wakingUpLoadThread === 'function') {
              h.wakingUpLoadThread(pid);
            }
          }
        } catch (e0) { /* ignore */ }
        // KHÔNG dựa vào sock.instance để bỏ qua: socket chết mà instance vẫn còn thì bắn là thua.
        // initSocket của app TỰ trả về ngay khi kết nối còn đang chạy (guard isRunning()) — gọi là đủ.
        if (socketWarmPromises[pid]) return; // đang kết nối dở — khỏi làm trùng
        socketWarmPromises[pid] = Promise.resolve()
          .then(() => h.initSocket(pid))
          .then((res) => {
            delete socketWarmPromises[pid];
            syncSocketMappingsToCache(h, pid);
            // Chủ động kích hoạt cuộn tải trước threadMappingStoreV2 ở nền (đã vá ~60–80ms/trang)
            try {
              if (h.SOCKETS && h.SOCKETS[pid]) {
                h.SOCKETS[pid].maxLoadThreadCount = Math.max(h.SOCKETS[pid].maxLoadThreadCount || 0, 5000);
              }
              if (typeof h.wakingUpLoadThread === 'function' && h.SOCKETS && h.SOCKETS[pid]) {
                h.wakingUpLoadThread(pid);
              }
            } catch (e2) { /* ignore */ }
            return res;
          })
          .catch(() => { delete socketWarmPromises[pid]; return null; });
      });
    } catch (e) { /* ignore */ }
  }

  // Chờ BATCH_GET_GLOBAL_ID nạp xong vào RAM trước khi phân loại fastList/discoveryList trong sendBatch
  async function waitInitialGidWarmup(targets, maxWaitMs) {
    try {
      const prs = [];
      const seen = {};
      (targets || []).forEach((c) => {
        const pid = (c && c.pageId) || String((c && c.id) || '').split('_')[0];
        if (!pid || seen[pid]) return;
        seen[pid] = true;
        if (batchGidPromises[pid]) prs.push(batchGidPromises[pid]);
      });
      if (prs.length) {
        await Promise.race([Promise.all(prs), sleep(maxWaitMs || 1500)]);
      }
      const h = window.__MqttHelper__;
      if (h) {
        Object.keys(seen).forEach((pid) => syncSocketMappingsToCache(h, pid));
      }
    } catch (e) { /* ignore */ }
  }

  /* ===== BÙ VÒNG 2 — chống mất tin khi server nghẽn ngay sau khi bắn dồn ===== */
  const BU_RETRY_EXT_MS = 50;   // Ext: bù TỨC THÌ (50ms) — không chờ 1s
  const BU_RETRY_MS = 1000;     // Socket: kênh dự phòng cuối (1s)
  const BU_SPREAD_MS = 50;      // rải nhẹ 50ms — hàng đợi Socket/Ext vốn đã tự điều tiết
  const buRetryDone = {}; // convId → đã bù trong lượt này
  let buRetrySeq = 0;
  let runSeq = 0; // mỗi lượt gửi 1 số — bù của lượt cũ tự hủy khi có lượt mới (chống gửi lẫn/lặp)
  const deliveredIds = {}; // convId → ĐÃ có kênh báo thành công trong lượt này ('api'|'ext'|'socket') — tuyệt đối không gửi lại
  const finalFailedIds = {}; // convId → đã thất bại hẳn (hết kênh hoặc khách khóa nick)
  const uncertainIds = {};   // convId → không rõ kết quả ('maybe')
  const skippedLateIds = {}; // convId → bỏ qua lúc gửi (tag cấm / icon điện thoại vừa gắn)
  // Bộ đếm O(1) chống O(N²) khi chạy 20.000–30.000 tin (không gọi Object.keys() 60.000 lần)
  const summaryCounters = { okApi: 0, okExt: 0, okSocket: 0, fail: 0, unsure: 0, skipLate: 0 };
  let summaryUiTimer = null;
  let windowBlocked = 0; // số lần API từ chối "(#10)/(#551)… ngoài cửa sổ 24h" trong lượt (đều được bù kênh khác)
  const SUMMARY_LS_KEY = 'ssb_last_summary_v1';
  const batchStats = {
    active: false,
    total: 0,
    skippedPre: 0,
    startedAt: 0,
    loopFinished: false,
    finalLogged: false,
  };

  function getBatchSummaryCounts() {
    const okApi = summaryCounters.okApi;
    const okExt = summaryCounters.okExt;
    const okSocket = summaryCounters.okSocket;
    const okTotal = okApi + okExt + okSocket;
    const failTotal = summaryCounters.fail;
    const unsureTotal = summaryCounters.unsure;
    const skipLateTotal = summaryCounters.skipLate;
    const settled = okTotal + failTotal + unsureTotal + skipLateTotal;
    const pending = Math.max(0, (batchStats.total || 0) - settled);
    return {
      total: batchStats.total || 0,
      okTotal, okApi, okExt, okSocket,
      failTotal, unsureTotal,
      skipTotal: (batchStats.skippedPre || 0) + skipLateTotal,
      settled, pending,
    };
  }

  function flushBatchSummaryUI() {
    summaryUiTimer = null;
    try {
      if (!batchStats.active && !batchStats.total) return;
      const c = getBatchSummaryCounts();
      const pct = c.total ? ((c.okTotal / c.total) * 100).toFixed(1) : '0.0';
      const elapsedSec = batchStats.startedAt ? Math.max(1, Math.round((Date.now() - batchStats.startedAt) / 1000)) : 0;
      const byCh = [];
      if (c.okApi) byCh.push('API: ' + c.okApi);
      if (c.okExt) byCh.push('Ext: ' + c.okExt);
      if (c.okSocket) byCh.push('Socket: ' + c.okSocket);
      const chStr = byCh.length ? ' [' + byCh.join(' · ') + ']' : '';
      const isDoneAll = batchStats.loopFinished && (c.pending === 0 || state.stopRequested);
      const html = (isDoneAll ? '🏁 <b>TỔNG HỢP:</b> ' : '📊 <b>Đang gửi:</b> ')
        + '<span style="color:#4ade80;font-weight:700">✅ Thành công: ' + c.okTotal + '/' + c.total + ' (' + pct + '%)' + chStr + '</span>'
        + (c.pending > 0 && !state.stopRequested ? ' · <span style="color:#38bdf8">⏳ Đang xử lý: ' + c.pending + '</span>' : '')
        + (c.failTotal > 0 ? ' · <span style="color:#f87171">❌ Lỗi: ' + c.failTotal + '</span>' : (isDoneAll ? ' · ❌ Lỗi: 0' : ''))
        + (c.unsureTotal > 0 ? ' · <span style="color:#fbbf24">⚠ Không rõ: ' + c.unsureTotal + '</span>' : '')
        + (c.skipTotal > 0 ? ' · <span style="color:#94a3b8">🧹 Bỏ qua: ' + c.skipTotal + '</span>' : '')
        + (elapsedSec > 0 ? ' · <span style="color:#94a3b8">⏱ ' + elapsedSec + 's</span>' : '');
      const sumEl = shadow && shadow.getElementById('ssb-summary');
      if (sumEl) {
        sumEl.style.display = '';
        sumEl.innerHTML = html;
      }
      if (c.total > 0) setProgress(c.settled, c.total);
      if (isDoneAll || c.total <= 200) {
        try { localStorage.setItem(SUMMARY_LS_KEY, html); } catch (e) { /* ignore */ }
      }
      if (isDoneAll && !batchStats.finalLogged && c.total > 0) {
        batchStats.finalLogged = true;
        try { localStorage.setItem(SUMMARY_LS_KEY, html); } catch (e) { /* ignore */ }
        logLine('📊 TỔNG HỢP CHỐT LƯỢT GỬI: ✅ Đã gửi thành công ' + c.okTotal + '/' + c.total
          + ' tin (' + pct + '%)' + chStr
          + ' | ❌ Lỗi: ' + c.failTotal
          + (c.unsureTotal ? ' | ⚠ Không rõ: ' + c.unsureTotal : '')
          + (c.skipTotal ? ' | 🧹 Bỏ qua: ' + c.skipTotal : '')
          + ' | ⏱ Tổng thời gian: ' + elapsedSec + 's');
      }
    } catch (e) { /* ignore */ }
  }

  function updateBatchSummaryUI() {
    const c = getBatchSummaryCounts();
    const isDoneAll = batchStats.loopFinished && (c.pending === 0 || state.stopRequested);
    // Khi chạy lô lớn (>200 chat) và chưa kết thúc: throttle cập nhật DOM 80ms/lần để không treo UI Chrome
    if (!isDoneAll && c.total > 200) {
      if (!summaryUiTimer) summaryUiTimer = setTimeout(flushBatchSummaryUI, 80);
      return;
    }
    if (summaryUiTimer) { clearTimeout(summaryUiTimer); summaryUiTimer = null; }
    flushBatchSummaryUI();
  }

  function markDelivered(convId, via) {
    if (!convId) return;
    const ch = (via === 'ext' || via === 'extension') ? 'ext' : (via === 'socket' ? 'socket' : 'api');
    const prev = deliveredIds[convId];
    if (prev === ch) { updateBatchSummaryUI(); return; }
    if (prev === 'ext') summaryCounters.okExt = Math.max(0, summaryCounters.okExt - 1);
    else if (prev === 'socket') summaryCounters.okSocket = Math.max(0, summaryCounters.okSocket - 1);
    else if (prev === 'api') summaryCounters.okApi = Math.max(0, summaryCounters.okApi - 1);
    if (finalFailedIds[convId]) { delete finalFailedIds[convId]; summaryCounters.fail = Math.max(0, summaryCounters.fail - 1); }
    if (uncertainIds[convId]) { delete uncertainIds[convId]; summaryCounters.unsure = Math.max(0, summaryCounters.unsure - 1); }
    deliveredIds[convId] = ch;
    if (ch === 'ext') summaryCounters.okExt++;
    else if (ch === 'socket') summaryCounters.okSocket++;
    else summaryCounters.okApi++;
    updateBatchSummaryUI();
  }

  window.__botfakeTrackStatus__ = function (convId, kind) {
    if (!convId || deliveredIds[convId]) return;
    if (kind === 'fail') {
      if (!finalFailedIds[convId]) { finalFailedIds[convId] = true; summaryCounters.fail++; }
    } else if (kind === 'uncertain') {
      if (!uncertainIds[convId]) { uncertainIds[convId] = true; summaryCounters.unsure++; }
    } else if (kind === 'skip') {
      if (!skippedLateIds[convId]) { skippedLateIds[convId] = true; summaryCounters.skipLate++; }
    }
    updateBatchSummaryUI();
  };

  function isRetryableLoss(err) {
    const s = String(err || '');
    // (#100) Không tìm thấy người dùng phù hợp = tài khoản FB không tồn tại → không kênh nào gửi được
    if (/\(#100\)|Không tìm thấy người dùng phù hợp/i.test(s)) return false;
    // "(#10)/(#551)… ngoài cửa sổ…" → kênh KHÁC vẫn có thể gửi được (Ext cứu — Thanh Binh,
    // log 07:36; tinnhan.har [59]/[64] → [72]/[75]) → bù sang kênh chưa thử.
    if (isWindowClosedError(s)) return true;
    // CHỈ các lỗi kênh xác nhận "chưa gửi" — không đụng 'không rõ/maybe', token, dữ liệu thiếu
    return /server báo gửi thất bại|Extension không gửi được|Socket không kết nối|Không thấy Extension|Extension Pancake chưa kết nối/.test(s);
  }

  // BÙ — mỗi kênh ĐÚNG 1 LẦN/chat (đúng luật "bù tối đa 1 lần/1 kênh"): kênh vừa thua KHÔNG được
  // thử lại, nhưng kênh CHƯA thử vẫn PHẢI thử tiếp (chuỗi như plan của app: api → extension ⇄ socket).
  // Cả Extension lẫn Socket đều hỗ trợ gửi cả chữ lẫn ảnh (cho chat inbox). Bình luận (comment) chỉ
  // hỗ trợ API/Extension. 'maybe'/đã đến nơi → DỪNG tuyệt đối (chống trùng).
  function scheduleBuRetry(conv, text, photo, name, why, tried) {
    if (!conv) return;
    if (sockFiredPending.has(conv.id)) {
      // Socket đã bắn và ACK chưa chốt — bù kênh khác lúc này có thể gây TRÙNG câu. Chờ xác nhận nền chốt.
      logLine('⏳ ' + name + ' — đang chờ xác nhận Socket (bắn-nhả) — không bù chồng để tránh trùng');
      return;
    }
    if (deliveredIds[conv.id]) {
      // đã có kênh XÁC NHẬN thành công thật — không gửi lại (chống trùng). Có log để không im lặng.
      logLine('✓ ' + name + ' — tin đã đến nơi (xác nhận) — không bù.');
      return;
    }
    const triedCh = (tried || []).slice();
    const done = buRetryDone[conv.id] || (buRetryDone[conv.id] = []); // kênh ĐÃ bù trong lượt
    const hasExt = !!(window.__ExtensionAdapter__ && typeof window.__ExtensionAdapter__.send === 'function');
    const baseCandidates = (conv.type === 'comment')
      ? ['ext']
      : (hasExt ? ['ext', 'socket'] : ['socket']);
    const remaining = baseCandidates.filter((c) => triedCh.indexOf(c) < 0 && done.indexOf(c) < 0);
    if (!remaining.length) {
      const seen = {};
      const names = triedCh.concat(done).filter((x) => (seen[x] ? false : (seen[x] = true)));
      if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
      logLine('❌ ' + name + ' — đã thử hết kênh (' + (names.join(', ') || 'không rõ') + ')'
        + (conv.type === 'comment' ? ' — bình luận chỉ API/Extension gửi được (Socket không hỗ trợ)' : '')
        + ' — không bù nữa (mỗi kênh đúng 1 lần)');
      return;
    }
    const myRun = runSeq;
    // Chỉ bật gidForceFind khi đã từng thử 'ext' hoặc 'socket' mà thất bại; nếu mới chỉ thử 'api'
    // (API từ chối ngoài 24h) thì global_id trong cache/GET /messages vẫn hoàn toàn hợp lệ!
    const hadDirectFail = triedCh.indexOf('ext') > -1 || triedCh.indexOf('socket') > -1 || done.length > 0;
    const delay = hadDirectFail ? (150 + Math.min(buRetrySeq++, 6) * BU_SPREAD_MS) : BU_RETRY_EXT_MS;
    logLine('⏳ ' + name + ' — ' + why + ' — đang bù'
      + (remaining.length > 1 ? ' (Socket/Extension)' : (' qua ' + (remaining[0] === 'ext' ? 'Extension' : 'Socket'))) + '…');
    setTimeout(() => {
      if (myRun !== runSeq) return; // có lượt gửi mới — bù của lượt cũ bỏ (tránh gửi lẫn 2 lượt)
      if (state.stopRequested) {
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
        logLine('⏸ ' + name + ' — bỏ bù (đang dừng).');
        return;
      }
      if (deliveredIds[conv.id]) return; // trong lúc chờ, tin đã đến nơi qua đường khác — thôi
      const buCtx = { gidForceFind: hadDirectFail };
      busEnqueue(async () => {
        await prepareDirectCtx(conv, photo, buCtx);
        const pid = (buCtx.full && (buCtx.full.page_id || buCtx.full.pageId)) || conv.pageId || String(conv.id || '').split('_')[0];
        const ordered = (remaining.length > 1)
          ? pickBestDirectOrder(conv, pid, buCtx, remaining)
          : remaining.slice();
        const ch = ordered.find((c) => triedCh.indexOf(c) < 0 && done.indexOf(c) < 0) || remaining[0];
        done.push(ch);
        const r = (ch === 'ext')
          ? await sendViaExtension(conv, text, photo, buCtx)
          : await sendViaSocket(conv, text, photo, buCtx);
        return { ch, r };
      }).then((out) => {
        if (!out || !out.ch) return;
        const ch = out.ch;
        const r = out.r;
        if (r && r.ok) {
          markDelivered(conv.id, ch);
          postSendSideEffects(conv);
          markChannel(conv.id, ch); // lần gửi sau vào thẳng kênh vừa thắng
          logLine('✅ ' + name + ' — bù THÀNH CÔNG qua ' + (ch === 'ext' ? 'Extension' : 'Socket'));
        } else if (r && r.sent === 'maybe') {
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'uncertain');
          logLine('⚠ ' + name + ' — bù không rõ kết quả — KHÔNG gửi thêm (chống trùng)');
        } else if (r && r.recipientUnavailable) {
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
          logLine('❌ ' + name + ' — bù ' + (ch === 'ext' ? 'Extension' : 'Socket') + ' không được: '
            + clip((r && r.error) || 'lỗi không rõ', 90) + ' — khách hiện không nhận được tin (không thử tiếp kênh khác)');
        } else {
          logLine('❌ ' + name + ' — bù ' + (ch === 'ext' ? 'Extension' : 'Socket') + ' không được: '
            + clip((r && r.error) || 'lỗi không rõ', 90) + ' — sang kênh kế nếu còn');
          // CHUỖI BÙ: kênh kế CHƯA thử (mỗi kênh đúng 1 lần — không lặp kênh vừa thua)
          scheduleBuRetry(conv, text, photo, name,
            'bù ' + (ch === 'ext' ? 'Extension' : 'Socket') + ' không được', triedCh.concat([ch]));
        }
      }).catch((e) => {
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(conv.id, 'fail');
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
    windowBlocked = 0;
    // trạng thái theo LƯỢT gửi: chat đã đến nơi trong lượt này không bao giờ bị gửi lại;
    // bù của lượt trước đang chờ sẽ tự hủy (runSeq) — không gửi lẫn vào lượt mới
    runSeq++;
    buRetrySeq = 0;
    Object.keys(buRetryDone).forEach((k) => { delete buRetryDone[k]; });
    Object.keys(deliveredIds).forEach((k) => { delete deliveredIds[k]; });
    sockFiredPending.clear();
    Object.keys(finalFailedIds).forEach((k) => { delete finalFailedIds[k]; });
    Object.keys(uncertainIds).forEach((k) => { delete uncertainIds[k]; });
    Object.keys(skippedLateIds).forEach((k) => { delete skippedLateIds[k]; });
    Object.keys(spareFbIdPool).forEach((k) => { delete spareFbIdPool[k]; });
    Object.keys(socketRejectStreak).forEach((k) => { delete socketRejectStreak[k]; });
    summaryCounters.okApi = 0;
    summaryCounters.okExt = 0;
    summaryCounters.okSocket = 0;
    summaryCounters.fail = 0;
    summaryCounters.unsure = 0;
    summaryCounters.skipLate = 0;
    batchStats.active = true;
    batchStats.total = 0;
    batchStats.skippedPre = 0;
    batchStats.startedAt = Date.now();
    batchStats.loopFinished = false;
    batchStats.finalLogged = false;
    render();
    // Khởi động warmUpSockets + BATCH_GET_GLOBAL_ID NGAY TỪ ĐẦU (chạy song song với lọc tag + upload ảnh)
    try { warmUpSockets(targets); } catch (e) { /* ignore */ }

    // LỌC TRƯỚC KHI BẮN: tag "chốt"/"chặn" (tải lại tag 1 lượt) + chat có icon điện thoại (has_phone)
    {
      const ban = await filterBannedTagTargets(targets);
      batchStats.skippedPre = ban.skippedTag.length + ban.skippedPhone.length;
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
        batchStats.active = false;
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
        batchStats.active = false;
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

    // Gửi theo lượt: hỗ trợ tới 50.000 tin/lượt cho quy mô 20.000–30.000 tin nhắn
    const waveEl = shadow && shadow.getElementById('ssb-wave');
    const gapEl = shadow && shadow.getElementById('ssb-gap');
    const WAVE_SIZE = Math.max(1, Math.min(100000, parseInt((waveEl && waveEl.value) || '30000', 10) || 30000));
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
    const totalAll = sendGroups.reduce((n2, g) => n2 + g.list.length, 0);
    batchStats.total = totalAll;
    batchStats.startedAt = Date.now();
    updateBatchSummaryUI();
    const useWaves = totalAll > WAVE_SIZE;
    logLine(useWaves
      ? '🚀 Bắt đầu gửi ' + totalAll + ' chat THEO LƯỢT: mỗi lượt ' + WAVE_SIZE + ' tin, cách nhau ' + WAVE_GAP + 'ms…'
      : '🚀 Bắt đầu gửi ' + totalAll + ' chat (1 lượt — ' + WAVE_SIZE + ' tin/lượt)…');

    let ok = 0, fail = 0, done = 0, unsure = 0, firedN = 0;
    let lastSpeedLogAt = Date.now();
    let lastBanSweepDone = 0;
    const quickEl0 = shadow && shadow.getElementById('ssb-quick');
    const quickOn = !!(quickEl0 && quickEl0.checked);

    const sendOneAndLog = async (c, gtext, itemOpts) => {
      const isDeferredPass = !!(itemOpts && itemOpts.deferredCtx);
      if (!isDeferredPass) {
        // CHỐT PHÚT CHÓT — soi lại tag/icon NGAY TRƯỚC khi bắn từng chat: tag cấm có thể vừa
        // được gắn SAU bước lọc trước, và đây là lớp an toàn cuối cho mọi lỗ dữ liệu
        const lateBan = (banGuard.convIds.has(c.id) ? 'tag cấm (API)' : null)
          || rowBanTagFromDom(c) || convBanTagFromData(c, banGuard.nameById);
        if (lateBan) {
          done++;
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'skip');
          logLine('🧹 [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — mang tag "' + lateBan
            + '" lúc gửi — BỎ QUA (không gửi)');
          setProgress(done, totalAll);
          return { ok: false, sent: false, skipped: true };
        }
        if (convHasPhone(c)) {
          done++;
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'skip');
          logLine('📞 [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — có icon điện thoại lúc gửi — BỎ QUA (không gửi)');
          setProgress(done, totalAll);
          return { ok: false, sent: false, skipped: true };
        }
      }
      // 🚀 Tối ưu quyết định cho 20.000–30.000 tin:
      // Nếu đang bật Chế độ nhanh (quickOn) và chat ngoài 24h ĐÃ CÓ SẴN global_id thật trong RAM/WebSocket
      // hoặc Socket đang mở → bỏ qua pre-ctx ở ngoài (để resolveGlobalId bên trong tự gọi ensureConvCtx khi cần).
      let skipPreCtx = isDeferredPass;
      if (!skipPreCtx && quickOn && c.type !== 'comment') {
        const full0 = peekConv(c) || c;
        const pid0 = (full0 && (full0.page_id || full0.pageId)) || c.pageId || String(c.id || '').split('_')[0];
        const idleDiff0 = getConvIdleMs(c, full0);
        const isIdleLong0 = !isNaN(idleDiff0) && idleDiff0 > 86400000;
        if (!isIdleLong0 || idleDiff0 > 7 * 86400000 || isPageSocketReady(pid0) || peekFastGlobalId(c, full0, '')) {
          skipPreCtx = true;
        }
      }
      if (!skipPreCtx) {
        await ensureConvCtx(c);
      }
      const sendOpts = {
        quick: quickOn,
        awaitDirect: true,
        fastOnly: !!(itemOpts && itemOpts.fastOnly),
        deferredCtx: (itemOpts && itemOpts.deferredCtx) || null,
        // 🔥 Nấc 2 chỉ bật cho lô lớn (>50 tin): bắn-nhả qua Socket + xác nhận nền.
        // Lô nhỏ vẫn chờ ACK trực tiếp để báo kết quả tức thì như cũ.
        sockFired: totalAll > 50,
      };
      let r;
      if (photo) {
        const p = c.pageId || String(c.id).split('_')[0];
        const fbId = fbIdByPage[p] || '';
        if (!fbId && c.type === 'comment') {
          done++;
          fail++;
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'fail');
          logLine('❌ [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — không có attachment ảnh cho page này');
          setProgress(done, totalAll);
          return { ok: false, sent: false, error: 'Không có attachment ảnh' };
        }
        r = await sendOne(c, gtext, { url: photo.url, id: photo.id, fbId, w: photo.w, h: photo.h }, sendOpts);
      } else {
        r = await sendOne(c, gtext, null, sendOpts);
      }
      // Nếu đang ở Làn Nhanh (fastOnly) mà chat này cần hỏi Extension / gửi qua Extension → đẩy sang hồ nền
      // extBacklogQueue mà chưa tăng done, giúp worker của Làn Nhanh giải phóng ngay ở 0ms!
      if (r && r.deferredToExt) {
        return r;
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
        if (!r.fired) { markDelivered(c.id, r.sendBy || 'api'); postSendSideEffects(c); }
        if (r.fired) firedN++;
        logLine('✅ [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — đã gửi' + via
          + (r.fired ? ' (đang xác nhận nền — nếu bị từ chối sẽ tự bù và báo)' : ''));
      } else if (r.uncertain) {
        unsure++;
        if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'uncertain');
        logLine('⚠ [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — ' + r.error
          + ' — không rõ tin đã đi chưa (không gửi thêm để tránh trùng)');
      } else {
        fail++;
        if (r.windowClosed) windowBlocked++;
        logLine('❌ [' + done + '/' + totalAll + '] ' + (c.name || c.id) + ' — ' + r.error);
        // cửa sổ 24h VẪN bù kênh khác (Thanh Binh); kênh đã thử hết → scheduleBuRetry tự bỏ
        if (!r.uncertain && !r.recipientUnavailable && isRetryableLoss(r.error)) {
          const p2 = c.pageId || String(c.id).split('_')[0];
          scheduleBuRetry(c, gtext, photo
            ? { url: photo.url, id: photo.id, fbId: fbIdByPage[p2] || '', w: photo.w, h: photo.h }
            : null, c.name || c.id, 'gửi chưa được', r.tried || []);
        } else {
          if (window && typeof window.__botfakeTrackStatus__ === 'function') window.__botfakeTrackStatus__(c.id, 'fail');
        }
      }
      updateBatchSummaryUI();
      // 📊 ĐỒNG HỒ TỐC ĐỘ (mỗi 30s): tin/phút thực tế + dự kiến thời gian còn lại cho lô lớn
      if (totalAll > 200 && Date.now() - lastSpeedLogAt >= 30000) {
        lastSpeedLogAt = Date.now();
        const elapsedS = Math.max(1, (Date.now() - batchStats.startedAt) / 1000);
        const rate = done / elapsedS; // tin/giây từ đầu lượt
        const remainS = rate > 0 ? Math.round((totalAll - done) / rate) : 0;
        const fmtDur = (sec) => sec >= 3600 ? (sec / 3600).toFixed(1) + ' giờ' : Math.max(1, Math.round(sec / 60)) + ' phút';
        logLine('📊 Đã xử lý ' + done + '/' + totalAll + ' · tốc độ ' + (rate * 60).toFixed(0) + ' tin/phút'
          + ' · dự kiến còn ~' + fmtDur(remainS) + ' nữa');
        // 🛡 Quét lại tag cấm giữa lượt (mỗi 3.000 tin, chạy nền không chặn gửi):
        // bắt các chat VỪA bị gắn tag "chốt"/"chặn" trong lúc lượt gửi đang chạy
        if (banGuard.tagIds.length && done - lastBanSweepDone >= 3000) {
          lastBanSweepDone = done;
          sweepBannedConvIds().then((sw) => {
            if (sw && sw.added) logLine('🛡 Quét lại tag giữa lượt: thêm ' + sw.added + ' chat vừa dính tag cấm (tổng ' + banGuard.convIds.size + ') — sẽ bỏ qua từ đây.');
          });
        }
      }
      return r;
    };

    // 🚀 KIẾN TRÚC ĐA TẦNG KHÔNG CHẶN ĐẦU (TWO-PASS NON-BLOCKING PIPELINE v1.61.0 CHO 20.000–30.000 TIN):
    //   • Làn 1 (fastHttpSocketPool — 96 worker song song, fastOnly=true):
    //     Quét xuyên suốt từ chat 1 đến hết danh sách (2.356 / 5.089 / 20.000 chat) mà KHÔNG BAO GIỜ đứng chờ Extension!
    //     Mọi chat lấy được global_id từ RAM / WebSocket / Server Pancake (GET /messages) đều được upload ảnh
    //     và bắn thẳng qua Socket/API ngay lập tức. Chat nào thiếu global_id trên Server Pancake (cần hỏi Extension)
    //     được đẩy sang extBacklogQueue trong 0ms để worker của Làn 1 lập tức bắn tiếp các chat phía sau (301..20.000)!
    //   • Làn 2 (extBacklogWorkers — 16 worker chạy song song ở nền ngay từ giây thứ 0):
    //     Âm thầm rút các chat từ extBacklogQueue để hỏi Extension / WebSocket loadThread mà không bao giờ
    //     chiếm mất bất kỳ ghế nào của Làn 1!
    const FAST_HTTP_SOCKET_POOL = 160;
    const EXT_BACKLOG_WORKERS = 48;
    let gtextRef = '';
    const sendBatch = async (gtext, batch) => {
      gtextRef = gtext;
      extNullStreak = 0;
      // Đánh thức WebSocket loadThread ngay đầu lượt cho mọi page có trong batch
      try {
        const mh = window.__MqttHelper__;
        if (mh && typeof mh.wakingUpLoadThread === 'function') {
          const seenP = new Set();
          for (let i = 0; i < batch.length; i++) {
            const p0 = batch[i].pageId || String(batch[i].id || '').split('_')[0];
            if (p0 && !seenP.has(p0)) {
              seenP.add(p0);
              try { mh.wakingUpLoadThread(p0); } catch (e0) { /* ignore */ }
            }
          }
        }
      } catch (e) { /* ignore */ }

      const extBacklogQueue = [];
      const extWaiters = [];
      let fastScanFinished = false;

      const pushToExtBacklog = (item) => {
        if (extWaiters.length > 0) {
          const w = extWaiters.shift();
          w(item);
        } else {
          extBacklogQueue.push(item);
        }
      };

      const popFromExtBacklog = () => {
        if (extBacklogQueue.length > 0) {
          return Promise.resolve(extBacklogQueue.shift());
        }
        if (fastScanFinished || state.stopRequested) {
          return Promise.resolve(null);
        }
        return new Promise((resolve) => {
          extWaiters.push(resolve);
        });
      };

      const runExtBacklogWorker = async () => {
        while (!state.stopRequested) {
          const item = await popFromExtBacklog();
          if (!item || state.stopRequested) break;
          const r = await sendOneAndLog(item.c, gtextRef, {
            fastOnly: false,
            deferredCtx: item.deferredCtx || null,
          });
          if (r && !r.ok && r.error && r.error.indexOf('Token') === 0) {
            logLine('⛔ Dừng sớm vì token không còn hợp lệ.');
            state.stopRequested = true;
            break;
          }
        }
      };

      // ⚡ GID PREFETCH (v1.70.0): pipeline chạy nền SONG SONG với làn gửi, đi trước để nạp sẵn
      // ngữ cảnh + global_id (GET /messages, có dedupe inflight trong ensureConvCtx) cho các chat
      // phía sau — tới lượt worker gửi thì gid đã có sẵn trong cache (0ms), không phải đứng chờ HTTP.
      // Không await: prefetch chậm hơn làn gửi cũng vô hại (toàn cache hit), nhanh hơn thì làn gửi bứt tốc.
      runPool(batch, async (c) => {
        if (state.stopRequested) return;
        try { await ensureConvCtx(c, { force: true }); } catch (e) { /* ignore */ }
      }, 48).catch(() => {});

      const extWorkers = [];
      const nExtWorkers = Math.min(EXT_BACKLOG_WORKERS, Math.max(1, batch.length));
      for (let w = 0; w < nExtWorkers; w++) {
        extWorkers.push(runExtBacklogWorker());
      }

      const runFastItem = async (c) => {
        if (state.stopRequested) return null;
        const r = await sendOneAndLog(c, gtextRef, { fastOnly: true });
        if (r && r.deferredToExt) {
          pushToExtBacklog({ c, deferredCtx: r.deferredCtx || null });
          return r;
        }
        if (r && !r.ok && r.error && r.error.indexOf('Token') === 0) {
          logLine('⛔ Dừng sớm vì token không còn hợp lệ.');
          state.stopRequested = true;
        }
        return r;
      };

      try {
        await runPool(batch, runFastItem, Math.min(FAST_HTTP_SOCKET_POOL, batch.length));
      } finally {
        fastScanFinished = true;
        while (extWaiters.length > 0) {
          const w = extWaiters.shift();
          w(null);
        }
      }
      await Promise.all(extWorkers);
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
      try {
        warmUpSockets(targets);
        await waitInitialGidWarmup(targets, 1500);
      } catch (e) { /* làm nóng lỗi không được làm hỏng lô */ }
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
    batchStats.loopFinished = true;
    if (state.stopRequested && done < totalAll) {
      logLine('⏸ Đã dừng sớm sau ' + done + '/' + totalAll + ' chat.');
    }
    if (!sendErr) {
      // chốt per page: check_inbox + contents/touch (app gọi sau gửi — HAR/file "post")
      try {
        const seenPg = {};
        targets.forEach((c) => {
          const pg = (c.pageId || String(c.id || '').split('_')[0]) || '';
          if (pg && !seenPg[pg]) { seenPg[pg] = true; postSendSideEffects({ pageId: pg }, { perConv: false, perPage: true }); }
        });
      } catch (e) { /* ignore */ }
      const sumNow = getBatchSummaryCounts();
      logLine('🏁 Hoàn tất vòng phát lệnh: đã xác nhận ' + sumNow.okTotal + '/' + totalAll + ' thành công'
        + (sumNow.pending > 0 ? ' (còn ' + sumNow.pending + ' tin đang xác nhận/bù nền — bảng TỔNG HỢP sẽ tự chốt khi xong hết)' : '')
        + ', ' + sumNow.failTotal + ' lỗi.'
        + (sumNow.unsureTotal ? ' ' + sumNow.unsureTotal + ' tin không rõ kết quả (không gửi thêm).' : '')
        + (windowBlocked ? ' 🚫 ' + windowBlocked + ' lần API bị chặn ngoài cửa sổ 24h (đã bù kênh khác).' : '')
        + (sumNow.pending > 0
          ? ' ⏱ Đã phát lệnh xong trong ' + (((Date.now() - batchStats.startedAt) / 1000).toFixed(0)) + 's — tốc độ chốt xem ở dòng TỔNG HỢP cuối cùng.'
          : ' ⏱ Tổng thời gian: ' + (((Date.now() - batchStats.startedAt) / 60000).toFixed(1)) + ' phút'
            + ' (trung bình ' + (totalAll / Math.max(1, (Date.now() - batchStats.startedAt) / 1000) * 60).toFixed(0) + ' tin/phút).'));
    }
    updateBatchSummaryUI();
    // CÂU ĐÃ CHỐT TIÊU THỤ từ đầu lượt → dùng xong TỰ XÓA (mỗi câu chỉ gửi 1 lần — tránh gửi trùng).
    // Chạy cả khi gửi lỗi giữa chừng: ít nhất đã bắn dở — giữ lại là dễ gửi trùng.
    // NHƯNG lô fail TOÀN BỘ (0 tin được bắn/xác nhận) → GIỮ NGUYÊN câu: xóa lúc này là mất
    // dữ liệu oan (đã xảy ra khi request lỗi mà câu vẫn bị nuốt — user mất câu đã soạn).
    if (consumeIds.size && ok > 0) {
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
    } else if (consumeIds.size) {
      logLine('💾 Lô gửi KHÔNG có tin nào được bắn — GIỮ NGUYÊN ' + consumeIds.size
        + ' câu đã chọn (không mất dữ liệu — sửa lỗi rồi gửi lại).');
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
        .summary-box { background: #132033; border: 1px solid #334155; border-radius: 8px; padding: 6px 8px;
                       font-size: 11px; line-height: 1.45; color: #e2e8f0; display: none; word-break: break-word; }
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
          <span class="title"><svg class="logo" viewBox="0 0 50 52" width="17" height="17" xmlns="http://www.w3.org/2000/svg"><path d="M10 2 L14 11" stroke="#5865F2" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M40 2 L36 11" stroke="#5865F2" stroke-width="5" stroke-linecap="round" fill="none"/><rect x="0" y="12" width="50" height="40" rx="6" fill="#5865F2"/><rect x="12" y="31" width="12" height="4" rx="2" fill="#fff"/><rect x="26" y="31" width="12" height="4" rx="2" fill="#fff"/></svg>BOTFAKE <span style="color:#64748b;font-weight:400;font-size:11px">v1.60.0</span></span>
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
              <input type="number" id="ssb-wave" value="30000" min="1" max="100000" step="500" style="width:72px" title="Số tin mỗi lượt (tối đa 100.000)">
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
          <div class="summary-box" id="ssb-summary"></div>
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
        if (!state.allRows || !state.allRows.size) {
          logLine('⚡ Chưa tải danh sách — tự tải qua API để lấy tới cuối…');
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
          threadId: m.threadId || '', threadKey: m.threadKey || '',
          customerName: m.customerName || '', updatedAt: m.updatedAt || '',
          customerId: m.customerId || (m.customers && m.customers[0] && m.customers[0].id) || '',
          globalId: m.globalId || (m.customers && m.customers[0] && m.customers[0].global_id) || '',
          customers: Array.isArray(m.customers) ? m.customers : undefined,
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
    // ===== KHÔI PHỤC SAU F5: câu đang tick + ô nội dung đang gõ + nhật ký — dữ liệu không mất =====
    try {
      const ui = JSON.parse(localStorage.getItem(UI_KEY) || 'null');
      if (ui && Array.isArray(ui.sel)) {
        const msgEl3 = root.getElementById('ssb-msg');
        if (msgEl3 && ui.msg) msgEl3.value = String(ui.msg); // khôi phục chữ đang gõ trước
        state.listSel = new Set(ui.sel.filter((id) => state.savedLists.some((l) => l.id === id)));
        if (state.listSel.size) rebuildFromLists(); // tích 1 câu → ô gõ nạp theo nội dung câu (đúng UX)
      }
      const oldLog = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      if (Array.isArray(oldLog) && oldLog.length) {
        state.log = oldLog.slice(-300);
        const elLog = root.getElementById('ssb-log');
        if (elLog) elLog.textContent = state.log.join('\n');
      }
      const oldSum = localStorage.getItem(SUMMARY_LS_KEY) || '';
      if (oldSum) {
        const elSum = root.getElementById('ssb-summary');
        if (elSum) { elSum.style.display = ''; elSum.innerHTML = oldSum; }
      }
    } catch (e) { /* ignore — hỏng dữ liệu phụ thì làm việc mới */ }
    // ô nội dung đang gõ: lưu dần — F5 không mất chữ đã gõ dở
    {
      const msgElD = root.getElementById('ssb-msg');
      if (msgElD) {
        let tD = null;
        msgElD.addEventListener('input', () => {
          if (tD) clearTimeout(tD);
          tD = setTimeout(persistUiState, 400);
        });
      }
    }
    renderSavedLists();
    if (state.savedLists.length) {
      logLine('💾 Đã nạp ' + state.savedLists.length + ' câu · '
        + state.savedLists.reduce((nn, l) => nn + l.items.length, 0) + ' chat đã lưu (giữ qua F5)'
        + (state.listSel && state.listSel.size ? ' — đang chọn ' + state.listSel.size + ' câu' : ''));
    }
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

  let logFlushTimer = null;
  function flushLogUI() {
    logFlushTimer = null;
    try { localStorage.setItem(LOG_KEY, JSON.stringify(state.log)); } catch (e) { /* ignore */ }
    const el = shadow && shadow.getElementById('ssb-log');
    if (el) {
      el.textContent = state.log.join('\n');
      el.scrollTop = el.scrollHeight;
    }
  }

  function logLine(s) {
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
      + ':' + String(t.getSeconds()).padStart(2, '0');
    state.log.push('[' + hh + '] ' + s);
    if (state.log.length > 300) state.log.shift();
    const el = shadow && shadow.getElementById('ssb-log');
    if (!el) {
      try { localStorage.setItem(LOG_KEY, JSON.stringify(state.log)); } catch (e) { /* ignore */ }
      console.log('[SSB]', s);
      return;
    }
    // Khi chạy lô lớn (>200 chat) và đang bắn: throttle cập nhật DOM #ssb-log & localStorage 80ms/lần
    // (tránh 30.000 lần Forced Synchronous Reflow scrollHeight + IPC Disk Write gây đơ trình duyệt!)
    if (state.sending && batchStats.total > 200) {
      if (!logFlushTimer) logFlushTimer = setTimeout(flushLogUI, 80);
      return;
    }
    if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
    flushLogUI();
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
    getBatchSummaryCounts,
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
