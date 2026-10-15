// ==UserScript==
// @name         Pancake – Gửi 1 câu cho các đoạn chat cùng snippet
// @namespace    salescript
// @version      1.6.0
// @description  Chọn chuỗi chat (Alt+Click 2 đầu) hoặc chọn theo snippet trong danh sách Pancake rồi gửi cùng 1 câu cho tất cả.
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
  const DEF_DELAY = 300;                // ms giữa 2 lần gửi (chỉ dùng ở chế độ tuần tự)
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
    sending: false,
    stopRequested: false,
    pickMode: false,
    log: [],
  };

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

  function computeMatches() {
    const before = new Map(state.matches.map((m) => [m.id, m]));
    const list = [];
    const push = (r) => {
      const old = before.get(r.id);
      list.push({
        ...r,
        checked: old ? old.checked : (r.type !== 'comment'), // bình luận: mặc định bỏ tick (reply_inbox không áp dụng)
        isTarget: !!markOf(r),
        mark: markOf(r),
      });
    };
    if (state.mode === 'snippet' && state.target) {
      sourceRows().forEach((r) => {
        if (r.snippet && r.snippet === state.target.snippet) push(r);
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
    highlightRows();
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
    const savedTop = scroller.scrollTop;
    const found = new Map();
    let guard = 0;
    logLine('⚡ Đang tải danh sách đoạn chat…');

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
    const setBtn = (t) => { if (btn) btn.textContent = t; };

    scroller.scrollTop = 0;
    await sleep(150);
    collect();
    setBtn('⏳ ' + found.size + ' chat…');

    const step = Math.max(220, Math.round(scroller.clientHeight * 0.9));
    let noNewStreak = 0;
    while (guard++ < 300) {
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
      await sleep(110); // chờ render + app kích hoạt tải thêm (infinite scroll)
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

  // Đúng request mà _app-...js gửi khi nhắn tin thường (executeByApi + buildRequestBody):
  //   POST /api/v1/pages/{page_id}/conversations/{conversation.id}/messages?access_token=...
  //   multipart/form-data: action=reply_inbox, message=<text>
  // Nếu server từ chối dạng "(#10) ... ứng dụng khác đang kiểm soát thread" (Facebook handover)
  // thì app tự fallback sang extension — mình làm đúng như vậy ở sendSmart().
  async function sendViaApi(conv, text) {
    const token = getToken();
    if (!token) {
      return { ok: false, error: 'Không tìm thấy access_token — hãy tải lại trang Pancake rồi thử lại' };
    }
    const pageId = conv.pageId || conv.id.split('_')[0];
    const url = apiBase() + '/v1/pages/' + pageId
      + '/conversations/' + encodeURIComponent(conv.id)
      + '/messages?access_token=' + encodeURIComponent(token);
    const fd = new FormData();
    fd.append('action', 'reply_inbox');
    fd.append('message', text);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: fd,
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      let data = {};
      try { data = await res.json(); } catch (e) { /* non-json */ }
      if (res.ok && data && data.success) {
        return { ok: true, id: data.id || data.message_id || '', sendBy: 'api' };
      }
      if (res.status === 401 || res.status === 403) {
        capturedToken = null; // token cũ — lần sau tự lấy token mới
        return { ok: false, error: 'Token hết hạn/không hợp lệ (' + res.status + ') — tải lại trang rồi thử lại' };
      }
      return {
        ok: false,
        error: (data && (data.message || data.error)) || ('HTTP ' + res.status),
        code: data && data.message_code,
      };
    } catch (e) {
      return { ok: false, error: 'Lỗi mạng: ' + (e && e.message || e) };
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
    return /\(#(551|2022|10|100|1_reduce_data|-1|613|80006)(?:,\d+)?\)/.test(m)
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

  // Tìm globalId (PSID) của khách — đúng đường app: cache → findGlobalIdForConv (extension GET_GLOBAL_ID_FOR_CONV)
  async function resolveGlobalId(full, threadId, cacheKey) {
    const key = (full && full.id) || cacheKey;
    try {
      const g1 = window.__GlobalIdCacheTest__, g2 = window.__tempGlobalIdCache__;
      const cached = (g1 && g1.get(key)) || (g2 && g2.get(key));
      if (cached) return cached;
    } catch (e) { /* ignore */ }
    if (typeof window.findGlobalIdForConv === 'function' && threadId) {
      try {
        const gid = await window.findGlobalIdForConv({
          pageId: full.page_id,
          threadId,
          threadKey: full.thread_key || null,
          isBusiness: false,
          conversationUpdatedTime: Date.parse(String(full.updated_at || '') + 'Z'),
          customerName: (full.from && (full.from.username || full.from.name)) || '',
          convType: 'INBOX',
          postId: null,
          convId: null,
        });
        if (gid) {
          try { window.__tempGlobalIdCache__ && window.__tempGlobalIdCache__.set(key, gid); } catch (e) { /* ignore */ }
          return gid;
        }
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  // Gửi qua Facebook WebSocket — ĐÚNG đường "gửi bình thường" mà app/nhân viên vẫn dùng
  // (_app: executeBySocketFB → __MqttHelper__.sendMessage(pageId, globalId, {text}) → publish /ls_req)
  async function sendViaSocket(conv, text) {
    const helper = window.__MqttHelper__;
    if (!helper || typeof helper.sendMessage !== 'function') {
      return { ok: false, error: 'Không thấy __MqttHelper__' };
    }
    const platform = detectPlatform(conv.pageId || conv.id.split('_')[0]);
    if (platform !== 'facebook') return { ok: false, error: 'Socket chỉ áp dụng cho Facebook' };
    const full = await getFullConversation(conv);
    if (!full) return { ok: false, error: 'Không lấy được thông tin đoạn chat' };
    const pageId = full.page_id || conv.pageId;
    let threadId = full.thread_id;
    if (!threadId && typeof window.__syncMissingThreadId__ === 'function') {
      try { threadId = await window.__syncMissingThreadId__(pageId, full.id || conv.id); } catch (e) { /* ignore */ }
    }
    const gid = await resolveGlobalId(full, threadId, conv.id);
    if (!gid) return { ok: false, error: 'Không tìm thấy globalId' };
    try {
      const res = await helper.sendMessage(pageId, gid, { text });
      if (res && res.success) return { ok: true, id: gid, sendBy: 'socket' };
      return { ok: false, error: 'Socket không gửi được' + (res && res.reason ? ' (' + res.reason + ')' : '') };
    } catch (e) {
      return { ok: false, error: 'Socket lỗi: ' + (e && e.message || e) };
    }
  }

  // Gửi qua extension Pancake (đường app dùng khi API bị "(#10)" — executeByExtOnce, type REPLY_INBOX_PHOTO)
  async function sendViaExtension(conv, text) {
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
    const full = await getFullConversation(conv);
    if (!full) return { ok: false, error: 'Không lấy được thông tin đoạn chat' };

    let threadId = full.thread_id;
    if (!threadId && typeof window.__syncMissingThreadId__ === 'function') {
      try {
        threadId = await window.__syncMissingThreadId__(full.page_id || conv.pageId, full.id || conv.id);
      } catch (e) { /* ignore */ }
    }
    if (!threadId) return { ok: false, error: 'Không tìm thấy thread_id' };

    const gid = await resolveGlobalId(full, threadId, conv.id);
    const globalUserId = gid || null;

    const token = getToken();
    const payload = {
      pageId: full.page_id || conv.pageId,
      igPageId: null,
      accessToken: token,
      tryResizeImage: true,
      contentIds: [],
      type: 'REPLY_INBOX_PHOTO',
      message: text,
      attachmentType: 'SEND_TEXT_ONLY',
      globalUserId,
      platform: 'facebook',
      replyMessage: null,
      files: null,
      threadId,
      convId: full.thread_key || null,
      customerName: (full.from && (full.from.username || full.from.name)) || '',
      photoUrl: null,
      isIGD: false,
      conversationUpdatedTime: Date.parse(String(full.updated_at || '') + 'Z'),
      photoUrls: [],
      isBusiness: false,
    };
    try {
      const res = await adapter.send(payload, { timeout: 35000 });
      if (res && res.success) {
        return { ok: true, id: (res.data && (res.data.timestamp || res.data.convId)) || '', sendBy: 'extension' };
      }
      return { ok: false, error: 'Extension không gửi được' };
    } catch (e) {
      return { ok: false, error: 'Extension lỗi: ' + (e && e.message || e) };
    }
  }

  function waitFor(fn, timeout) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        let v = null;
        try { v = fn(); } catch (e) { /* ignore */ }
        if (v) return resolve(v);
        if (Date.now() - t0 >= timeout) return resolve(null);
        setTimeout(tick, 90);
      };
      tick();
    });
  }

  function findRowEl(convId) {
    return document.getElementById(convId)
      || document.querySelector('[id^="' + convId + '__"]')
      || null;
  }

  async function scrollToRow(convId) {
    let el = findRowEl(convId);
    if (el) return el;
    const scroller = getScroller();
    if (!scroller) return null;

    // Nhảy thẳng tới vị trí ước lượng từ thứ tự đã quét (không cuộn từ đầu — rất chậm)
    const info = state.allRows && state.allRows.get ? state.allRows.get(convId) : null;
    if (info && state.allRows.size > 1 && scroller.scrollHeight > scroller.clientHeight) {
      const ratio = info.order / (state.allRows.size - 1);
      scroller.scrollTop = Math.round(ratio * (scroller.scrollHeight - scroller.clientHeight));
      await sleep(240);
      el = findRowEl(convId);
      if (el) return el;
    }

    // Quét quanh vị trí ước lượng (giới hạn ±12 bước — không cuộn khắp danh sách)
    const step = Math.max(180, Math.round(scroller.clientHeight * 0.75));
    const scan = async (down, maxSteps) => {
      let g = 0;
      while (g++ < maxSteps) {
        const prev = scroller.scrollTop;
        scroller.scrollTop = down ? prev + step : Math.max(0, prev - step);
        if (scroller.scrollTop === prev) {
          try {
            scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: down ? step : -step, bubbles: true, cancelable: true }));
          } catch (e) { /* ignore */ }
          await sleep(200);
          if (scroller.scrollTop === prev) return findRowEl(convId); // hết biên
        } else {
          await sleep(140);
        }
        const e2 = findRowEl(convId);
        if (e2) return e2;
      }
      return findRowEl(convId);
    };
    const jumpBack = scroller.scrollTop;
    el = await scan(true, 12);
    if (!el) {
      scroller.scrollTop = jumpBack;
      await sleep(140);
      el = await scan(false, 12);
    }
    return el || null;
  }

  // Gửi qua giao diện thật: mở chat → điền #replyBoxComposer → Enter
  // (đúng chuỗi thao tác mà người dùng vẫn làm — app tự dùng đường socket/extension bên trong)
  async function sendViaUI(conv, text) {
    if (state.stopRequested) return { ok: false, error: 'Đã dừng' };
    const rowWrap = await scrollToRow(conv.id);
    if (!rowWrap) return { ok: false, error: 'Không tìm thấy dòng chat trong danh sách' };
    const item = (rowWrap.classList && rowWrap.classList.contains('conversation-list-item'))
      ? rowWrap
      : (rowWrap.querySelector && rowWrap.querySelector('.conversation-list-item')) || rowWrap;
    item.click();
    const ta = await waitFor(() => {
      const t = document.getElementById('replyBoxComposer');
      return t && t.isConnected ? t : null;
    }, 6000);
    if (!ta) return { ok: false, error: 'Không mở được khung chat' };
    await sleep(180);

    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    if (ta.value.trim() !== text.trim()) {
      return { ok: false, error: 'UI: không điền được nội dung vào ô chat' };
    }

    const pressEnter = () => {
      ['keydown', 'keypress', 'keyup'].forEach((type) => {
        const ev = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
        try {
          Object.defineProperty(ev, 'keyCode', { get: () => 13 });
          Object.defineProperty(ev, 'which', { get: () => 13 });
        } catch (e) { /* ignore */ }
        ta.dispatchEvent(ev);
      });
    };
    pressEnter();
    // app xóa ô chat sau khi gửi — nếu vẫn còn chữ thì thử Enter lần nữa
    let sent = await waitFor(() => {
      const t = document.getElementById('replyBoxComposer');
      return !t || !t.value.trim() || t.value.trim() !== text.trim();
    }, 8000);
    if (!sent) {
      pressEnter();
      sent = await waitFor(() => {
        const t = document.getElementById('replyBoxComposer');
        return !t || !t.value.trim() || t.value.trim() !== text.trim();
      }, 8000);
    }
    if (!sent) return { ok: false, error: 'UI: ô chat không gửi đi' };
    return { ok: true, id: '', sendBy: 'ui' };
  }

  // UI chỉ mở được 1 chat mỗi lần → xếp hàng tuần tự
  let uiLock = Promise.resolve();
  function sendViaUIQueued(conv, text) {
    const run = uiLock.then(() => sendViaUI(conv, text));
    uiLock = run.then(() => {}, () => {});
    return run;
  }

  // API (nhanh) → Socket (đường gửi tay) → Extension → Giao diện
  // Có nhớ kênh tốt cho từng chat + bỏ API ngay khi biết thread đang bị "(#10)" kiểm soát
  async function sendOne(conv, text) {
    const channels = {
      api: async () => {
        const r = await sendViaApi(conv, text);
        if (!r.ok && isThreadControlError(r.error)) batchSkipApi = true;
        return r;
      },
      socket: () => sendViaSocket(conv, text),
      ext: () => sendViaExtension(conv, text),
      ui: () => sendViaUIQueued(conv, text),
    };
    const order = ['api', 'socket', 'ext', 'ui'];
    const hint = channelHints[conv.id];
    let seq = (hint && order.indexOf(hint) > -1)
      ? [hint].concat(order.filter((x) => x !== hint))
      : order.slice();
    if (batchSkipApi) seq = seq.filter((x) => x !== 'api');

    const tried = [];
    for (let i = 0; i < seq.length; i++) {
      const ch = seq[i];
      if (state.stopRequested) break;
      const r = await channels[ch]();
      if (r.ok) {
        markChannel(conv.id, ch);
        return { ok: true, id: r.id || '', sendBy: r.sendBy || ch };
      }
      tried.push((ch === 'ext' ? 'Ext' : ch) + ': ' + (r.error || 'fail'));
      if (r.error && r.error.indexOf('Token') === 0) return r; // token hỏng — dừng hẳn
    }
    return { ok: false, error: tried.join(' | ') };
  }

  async function sendToAll() {
    // LƯU Ý: panel nằm trong shadow DOM → phải lấy phần tử qua shadow.getElementById,
    // document.querySelector sẽ không thấy (đây là nguyên nhân lỗi "Hãy nhập nội dung câu cần gửi")
    const msgEl = shadow && shadow.getElementById('ssb-msg');
    const text = (msgEl && msgEl.value || '').trim();
    if (!text) { alert('Hãy nhập nội dung câu cần gửi.'); return; }
    const targets = state.matches.filter((m) => m.checked);
    if (!targets.length) {
      alert('Chưa có đoạn chat nào được chọn.\nHãy chọn snippet (nút "Lấy snippet từ chat đang chọn")\nhoặc chọn chuỗi bằng 2 lần Alt+Click (đầu → cuối).');
      return;
    }
    const names = targets.slice(0, MAX_NAME_LIST).map((m) => m.name || m.id).join(', ')
      + (targets.length > MAX_NAME_LIST ? ', …' : '');
    const nComment = targets.filter((m) => m.type === 'comment').length;
    const warnComment = nComment
      ? '\n\n⚠ Trong đó ' + nComment + ' chat loại BÌNH LUẬN — API reply_inbox có thể không áp dụng cho các chat này!'
      : '';
    if (!confirm('Gửi 1 câu tới ' + targets.length + ' đoạn chat đã chọn?\n\n“'
      + clip(text, 120) + '”\n\nNhận: ' + names + warnComment)) return;

    state.sending = true;
    state.stopRequested = false;
    batchSkipApi = false;
    render();

    const modeEl = shadow && shadow.getElementById('ssb-mode');
    const mode = (modeEl && modeEl.value) || 'all';
    const delayEl = shadow && shadow.getElementById('ssb-delay');
    const delay = Math.max(0, Math.min(20000, parseInt((delayEl && delayEl.value) || DEF_DELAY, 10)));
    const modeName = mode === 'all' ? 'gửi tất cả cùng lúc'
      : mode === 'pool5' ? 'song song 5 luồng'
      : 'tuần tự, giãn cách ' + (isNaN(delay) ? DEF_DELAY : delay) + 'ms';
    logLine('🚀 Bắt đầu gửi cho ' + targets.length + ' đoạn chat (' + modeName + ')…');

    let ok = 0, fail = 0, done = 0;

    const sendOneAndLog = async (c) => {
      const r = await sendOne(c, text);
      done++;
      if (r.ok) {
        ok++;
        const via = r.sendBy === 'socket' ? ' — qua Socket'
          : r.sendBy === 'extension' ? ' — qua Extension'
          : r.sendBy === 'ui' ? ' — qua giao diện' : '';
        logLine('✅ [' + done + '/' + targets.length + '] ' + (c.name || c.id) + ' — đã gửi' + via);
      } else {
        fail++;
        logLine('❌ [' + done + '/' + targets.length + '] ' + (c.name || c.id) + ' — ' + r.error);
      }
      setProgress(done, targets.length);
      return r;
    };

    if (mode === 'seq') {
      for (let i = 0; i < targets.length; i++) {
        if (state.stopRequested) break;
        const r = await sendOneAndLog(targets[i]);
        if (!r.ok && r.error && r.error.indexOf('Token') === 0) {
          logLine('⛔ Dừng sớm vì token không còn hợp lệ.');
          state.stopRequested = true;
          break;
        }
        if (i < targets.length - 1 && !state.stopRequested) await sleep(isNaN(delay) ? DEF_DELAY : delay);
      }
    } else {
      const limit = mode === 'all' ? Math.max(1, targets.length) : 5;
      await runPool(targets, async (c) => {
        if (state.stopRequested) return null;
        const r = await sendOneAndLog(c);
        if (!r.ok && r.error && r.error.indexOf('Token') === 0) {
          logLine('⛔ Dừng sớm vì token không còn hợp lệ.');
          state.stopRequested = true; // chặn các request chưa bắn
        }
        return r;
      }, limit);
    }

    state.sending = false;
    if (state.stopRequested && done < targets.length) {
      logLine('⏸ Đã dừng sớm sau ' + done + '/' + targets.length + ' chat.');
    }
    logLine('🏁 Hoàn tất: ' + ok + ' thành công, ' + fail + ' lỗi.');
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
                border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45); overflow: hidden; font-size: 12px; }
        .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #1e293b; cursor: move; }
        .title { font-weight: 700; font-size: 13px; flex: 1; color: #f8fafc; }
        .badge { font-size: 10px; padding: 2px 8px; border-radius: 999px; cursor: pointer; border: none; }
        .badge.on  { background: #16a34a; color: white; }
        .badge.off { background: #64748b; color: white; }
        .minibtn { background: #334155; color: #e2e8f0; border: none; border-radius: 6px;
                   padding: 3px 8px; cursor: pointer; font-size: 11px; }
        .minibtn:hover { background: #475569; }
        .body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
                max-height: 62vh; overflow: auto; }
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
        .hint { color: #64748b; font-size: 10px; line-height: 1.5; }
        .empty { color: #64748b; padding: 10px; text-align: center; }
        .count { color: #38bdf8; font-weight: 700; }
      </style>
      <div class="wrap" id="ssb-wrap">
        <div class="head" id="ssb-head">
          <span class="title">💬 Gửi 1 câu theo snippet</span>
          <button class="badge on" id="ssb-toggle" title="Bật/tắt tính năng">BẬT</button>
          <button class="minibtn" id="ssb-min" title="Thu nhỏ">—</button>
        </div>
        <div class="body" id="ssb-body">
          <div>
            <div class="label">1) Đang chọn</div>
            <div class="snippet-box" id="ssb-target">Chưa chọn — <b>Alt+Click 2 lần</b> (đầu → cuối chuỗi) hoặc lấy snippet từ chat đang chọn</div>
            <div class="row" style="margin-top:6px">
              <button class="b b-blue" id="ssb-use-selected">Lấy snippet từ chat đang chọn</button>
              <button class="b b-gray" id="ssb-pick">Chọn chuỗi (2 nhấp)</button>
              <button class="b b-gray" id="ssb-clear">Xóa</button>
            </div>
          </div>
          <div>
            <div class="label">2) Đoạn chat sẽ gửi (<span class="count" id="ssb-count">0</span>)</div>
            <div class="row" style="margin:4px 0">
              <button class="b b-gray" id="ssb-scan">⚡ Tải danh sách</button>
              <button class="b b-gray" id="ssb-rescan">Quét dòng đang thấy</button>
              <button class="b b-gray" id="ssb-all">Chọn tất cả</button>
              <button class="b b-gray" id="ssb-none">Bỏ chọn</button>
            </div>
            <div class="list" id="ssb-list"><div class="empty">Trống</div></div>
          </div>
          <div>
            <div class="label">3) Câu cần gửi</div>
            <textarea id="ssb-msg" placeholder="Nhập 1 câu sẽ gửi cho tất cả đoạn chat ở trên…"></textarea>
            <div class="row" style="align-items:center">
              <span class="hint">Tốc độ:</span>
              <select id="ssb-mode" title="Chế độ gửi">
                <option value="all">🚀 Gửi tất cả cùng lúc</option>
                <option value="pool5">⚡ Song song 5 luồng</option>
                <option value="seq">🐢 Tuần tự (giãn cách)</option>
              </select>
              <span class="hint" id="ssb-delay-label" style="display:none">Giãn cách (ms):</span>
              <input type="number" id="ssb-delay" value="${DEF_DELAY}" min="0" step="100" style="display:none">
            </div>
            <div class="row" style="align-items:center">
              <button class="b b-green" id="ssb-send" style="margin-left:auto">Gửi 1 câu cho tất cả</button>
              <button class="b b-red" id="ssb-stop" disabled>Dừng</button>
            </div>
          </div>
          <div class="prog"><i id="ssb-bar"></i></div>
          <div class="log" id="ssb-log"></div>
          <div class="hint">
            • <b>Alt+Click lần 1</b> = đầu chuỗi → <b>giữ Alt + nhấp lần 2</b> = cuối chuỗi: chọn tất cả chat ở giữa (chuỗi chọn). Nhấp lần 3 = bắt đầu chuỗi mới.<br>
            • Bấm <b>“⚡ Tải danh sách”</b> khi cần quét toàn bộ chat (siêu nhanh) — script <b>không bao giờ tự cuộn</b> khi bạn không bấm; nên bấm1 lần để chọn chuỗi/so khớp chính xác khắp danh sách.<br>
            • Hoặc bấm <b>“Lấy snippet từ chat đang chọn”</b> để gửi cho các chat cùng snippet.<br>
            • Dòng viền <b style="color:#22c55e">xanh lá</b> = sẽ được gửi; <b style="color:#3b82f6">xanh dương</b> = đầu/cuối chuỗi hoặc nguồn snippet.<br>
            • Chat gắn nhãn <b style="color:#f59e0b">[bình luận]</b> mặc định bỏ tick (reply_inbox không áp dụng cho bình luận).<br>
            • Gửi qua API <code style="color:#94a3b8">POST /v1/pages/.../messages</code> (action=reply_inbox) — đúng request website tự dùng, không cần mở từng chat.<br>
            • Nếu API bị chặn <code style="color:#94a3b8">(#10) app khác kiểm soát thread</code> → tự gửi tiếp qua <b>Socket</b> (đúng đường gửi tay của app), rồi <b>Extension</b>, rồi <b>giao diện</b> — log ghi rõ kênh đã gửi. Kênh tốt được ghi nhớ cho lần sau.<br>
            • Tốc độ mặc định <b>“Gửi tất cả cùng lúc”</b> (1 phát); nếu bị báo spam/429 hãy chuyển sang “Song song 5 luồng” hoặc “Tuần tự”.
          </div>
        </div>
      </div>
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
      const body = root.getElementById('ssb-body');
      body.style.display = body.style.display === 'none' ? 'flex' : 'none';
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
    on('ssb-rescan', 'click', () => {
      computeMatches();
      logLine('🔄 Đã quét lại các dòng đang hiển thị: ' + state.matches.length + ' chat trong lựa chọn');
      render();
    });
    on('ssb-all', 'click', () => {
      state.matches.forEach((m) => { m.checked = true; });
      render();
    });
    on('ssb-none', 'click', () => {
      state.matches.forEach((m) => { m.checked = false; });
      render();
    });
    on('ssb-send', 'click', () => { sendToAll(); });
    on('ssb-stop', 'click', () => {
      state.stopRequested = true;
      logLine('⏸ Yêu cầu dừng…');
    });
    on('ssb-mode', 'change', () => {
      const m = (root.getElementById('ssb-mode') || {}).value;
      const dl = root.getElementById('ssb-delay');
      const lbl = root.getElementById('ssb-delay-label');
      if (dl) dl.style.display = m === 'seq' ? '' : 'none';
      if (lbl) lbl.style.display = m === 'seq' ? '' : 'none';
    });

    // kéo thả panel
    const head = root.getElementById('ssb-head');
    const wrap = root.getElementById('ssb-wrap');
    let drag = null;
    head.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const hostEl = document.getElementById(PANEL_ID);
      const rect = hostEl.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, r: rect };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const hostEl = document.getElementById(PANEL_ID);
      hostEl.style.right = 'auto';
      hostEl.style.bottom = 'auto';
      hostEl.style.left = Math.max(0, drag.r.left + e.clientX - drag.x) + 'px';
      hostEl.style.top = Math.max(0, drag.r.top + e.clientY - drag.y) + 'px';
    });
    window.addEventListener('mouseup', () => { drag = null; });
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
      } else {
        tgt.innerHTML = 'Chưa chọn — <b>Alt+Click 2 lần</b> (đầu → cuối chuỗi) hoặc lấy snippet từ chat đang chọn';
      }
    }
    const cnt = shadow.getElementById('ssb-count');
    if (cnt) cnt.textContent = String(state.matches.length);

    const list = shadow.getElementById('ssb-list');
    if (list) {
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
                m.type === 'comment' ? ' <span style="color:#f59e0b" title="Bình luận bài viết — reply_inbox có thể không áp dụng; mặc định bỏ tick">[bình luận]</span>'
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
      if (host) host.style.display = host.style.display === 'none' ? '' : 'none';
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
    sendViaUI,
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
