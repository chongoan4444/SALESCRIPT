// ==UserScript==
// @name         Hỗ trợ trả lời Sale (Draggable Bubble - v5.5)
// @namespace    http://tampermonkey.net/
// @version      6.0.0
// @description  Trợ lý trả lời nhanh cho Sale: gõ câu tắt dạng /cn trong ô soạn tin Pancake → câu trả lời tự nhảy vào ô, Enter là gửi. Bong bóng nổi kéo thả, quản lý danh mục & câu tắt ngay trên trang.
// @author       SALESCRIPT
// @match        https://pancake.vn/*
// @match        https://pages.fm/*
// @match        https://pancake.ph/*
// @match        https://pancake.id/*
// @match        https://pancake.in/*
// @match        https://pancake.biz/*
// @match        https://socialos.vip/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @run-at       document-end
// @noframes
// ==/UserScript==

/*
 * NGUỒN THAM CHIẾU TRONG REPO (xem AGENTS.md / README.md):
 * - html2.txt, html3.txt: ô soạn tin của Pancake là
 *     <div class="reply-box-container"> → <div class="reply-box__text-area">
 *       → <textarea id="replyBoxComposer" placeholder="Trả lời từ …">
 *   ⇒ KHÔNG dùng contenteditable cho composer; chèn câu bằng native value setter +
 *     dispatch 'input' (đúng cách React của app nhận thay đổi) — giữ nguyên selection & caret.
 * - _app-9331d46f21a84eb1.v6.js:
 *     + forcusReplyCompose(): document.getElementById("replyBoxComposer") rồi .focus()
 *       ⇒ id này là điểm vào ổn định để focus/điền câu trả lời.
 *   (Các ô bình luận có thể là contenteditable ⇒ script vẫn hỗ trợ dự phòng.)
 *
 * GHI CHÚ: @name + @namespace giữ NGUYÊN như bản v5.5 để Tampermonkey nhận đây là
 * BẢN CẬP NHẬT (dán đè lên script cũ là xong, không bị cài thành 2 script). Bản thật
 * nằm ở @version = 6.0.0 (góc panel cũng hiện v6.0.0).
 *
 * THAY ĐỔI SO VỚI v5.5:
 * - BỎ hoàn toàn cơ chế "mô tả câu / nhãn" (label) + bấm vào câu trong panel để ghi đè ô nhập.
 *   (Nay mỗi câu có CÂU TẮT dạng /cn — gõ ngay trong ô soạn tin Pancake là câu tự nhảy vào.)
 * - THÊM câu tắt (shortcut) dạng  /cn  — gõ ngay trong ô soạn tin Pancake:
 *     gõ "/cn" → hiện danh sách gợi ý ngay trên ô nhập → Enter/Tab (hoặc bấm gợi ý)
 *     → câu trả lời được CHÈN vào đúng vị trí con trỏ, giữ nguyên chữ đang gõ dở;
 *     bấm Enter lần nữa là gửi (script không tự gửi, không tự Enter).
 * - Panel: danh mục + câu tắt, có ô tìm kiếm, hiện chip "/câu_tắt" để biết gõ gì.
 * - Chế độ Chỉnh sửa: thêm/sửa/xóa danh mục & câu tắt bằng form trong panel (không dùng prompt),
 *   kéo thả ⠿ để sắp xếp, chặn trùng câu tắt.
 * - Tự động di trú dữ liệu cũ (localStorage/GM 'sqr_data_v5') sang dữ liệu mới.
 */

(function () {
  'use strict';

  if (window.top !== window.self) return; // chỉ chạy ở trang chính

  /* ============================ HẰNG SỐ ============================ */

  const APP_VERSION = '6.0.0';
  const KEY_DATA = 'tln_data_v1';
  const KEY_POS = 'tln_pos_v1';
  const KEY_LEGACY = 'sqr_data_v5';      // dữ liệu của bản v5.5 (để di trú)
  const KEY_LEGACY_POS = 'sqr_btn_pos';
  const KEY_SETTINGS = 'tln_settings_v1';

  const PANCAKE_COMPOSER_ID = 'replyBoxComposer'; // html2.txt / html3.txt / _app forcusReplyCompose()
  const MAX_SUGGEST = 8;
  const SHORTCUT_MAX = 32;

  /* ============================ DỮ LIỆU MẶC ĐỊNH ============================ */

  const DEFAULT_DATA = [
    {
      id: 'cat_chao',
      title: 'Chào hỏi & Tư vấn',
      items: [
        { shortcut: 'chao', text: 'Dạ em chào anh/chị, em có thể hỗ trợ gì cho mình ạ?' },
        { shortcut: 'sanhang', text: 'Dạ chào bạn, shop sẵn hàng mẫu này ạ!' },
      ],
    },
    {
      id: 'cat_macthu',
      title: 'Mặc thử mới lấy',
      items: [
        { shortcut: 'dongkiem', text: 'Dạ bên em có hỗ trợ đồng kiểm khi nhận hàng, mình mặc thử ưng ý mới thanh toán ạ.' },
      ],
    },
    {
      id: 'cat_lo',
      title: 'Khách sợ mặc lộ',
      items: [
        { shortcut: 'khonglo', text: 'Chất vải này dày dặn, đứng phom và có lớp lót bên trong nên hoàn toàn không lo bị lộ đâu ạ.' },
      ],
    },
    {
      id: 'cat_gia',
      title: 'Chênh lệch giá với shop khác',
      items: [
        { shortcut: 'hangchuan', text: 'Dạ sản phẩm bên em là hàng chuẩn may kĩ, form chuẩn và bảo hành đổi trả, không phải hàng gia công đại trà ạ.' },
      ],
    },
  ];

  /* ============================ TIỆN ÍCH ============================ */

  /** Chuẩn hóa câu tắt: bỏ "/" đầu, bỏ khoảng trắng, lowercase. */
  function normShortcut(s) {
    return String(s == null ? '' : s)
      .trim()
      .replace(/^\/+/, '')
      .replace(/\s+/g, '')
      .toLowerCase()
      .slice(0, SHORTCUT_MAX);
  }

  /** Bỏ dấu tiếng Việt để tự sinh câu tắt khi di trú dữ liệu cũ. */
  function slugify(s) {
    const out = String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // bỏ dấu tiếng Việt
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
    return out ? out.slice(0, 16) : '';
  }

  const clamp = (v, min, max) => Math.max(min, Math.min(v, max));

  function h(tag, props, children) {
    const el = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        const v = props[k];
        if (v == null) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'draggable') el.draggable = !!v;
        else if (/^on[a-z]+$/.test(k) && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
    }
    (children || []).forEach((c) => {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  /* ============================ LƯU TRỮ ============================ */

  function gmGet(key, fallback) {
    try {
      if (typeof GM_getValue !== 'undefined') {
        const v = GM_getValue(key, null);
        if (v != null) return v;
      }
    } catch (e) { /* ignore */ }
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return fallback;
  }

  function gmSet(key, value) {
    try {
      if (typeof GM_setValue !== 'undefined') GM_setValue(key, value);
    } catch (e) { /* ignore */ }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* ignore */ }
  }

  /** Chuẩn hóa dữ liệu: bỏ label (v5.5), bảo đảm mọi câu đều có shortcut hợp lệ & không trùng. */
  function normalizeData(data) {
    if (!Array.isArray(data)) return [];
    const used = new Set();
    const uniqueShortcut = (raw, seed) => {
      // câu tắt phải là ASCII (gõ nhanh, không dấu): lấy câu tắt sẵn có, nếu không hợp lệ
      // thì tự sinh từ nhãn/nội dung cũ, cuối cùng mới dùng "cauN".
      let base = slugify(raw) || slugify(seed);
      if (!base) base = 'cau';
      let key = base;
      let n = 2;
      while (used.has(key)) key = base + n++;
      used.add(key);
      return key;
    };
    return data
      .filter((cat) => cat && typeof cat === 'object')
      .map((cat, ci) => ({
        id: String(cat.id || 'cat_' + (ci + 1)),
        title: String(cat.title || 'Danh mục'),
        items: (Array.isArray(cat.items) ? cat.items : [])
          .map((item) => {
            if (typeof item === 'string') return { text: item, _seed: item };
            if (!item || typeof item !== 'object') return null;
            return {
              shortcut: item.shortcut || item.short || item.label || '',
              text: String(item.text || item.message || ''),
              _seed: item.text || item.label || '',
            };
          })
          .filter((it) => it && String(it.text).trim())
          .map((it) => ({ shortcut: uniqueShortcut(it.shortcut, it._seed), text: String(it.text).trim() })),
      }));
  }

  function loadData() {
    const saved = gmGet(KEY_DATA, null);
    if (Array.isArray(saved) && saved.length) {
      const data = normalizeData(saved);
      if (data.length) return data;
    }
    // Di trú dữ liệu của bản v5.5 (danh mục + câu, chưa có câu tắt)
    const legacy = gmGet(KEY_LEGACY, null);
    if (Array.isArray(legacy) && legacy.length) {
      const migrated = normalizeData(legacy);
      if (migrated.length) {
        gmSet(KEY_DATA, migrated);
        return migrated;
      }
    }
    return normalizeData(DEFAULT_DATA);
  }

  function saveData() {
    gmSet(KEY_DATA, categories);
  }

  function loadPosition() {
    const pos = gmGet(KEY_POS, null) || gmGet(KEY_LEGACY_POS, null);
    if (pos && typeof pos.top === 'number' && typeof pos.left === 'number') return pos;
    return { top: window.innerHeight - 70, left: window.innerWidth - 66 };
  }

  function savePosition(pos) {
    gmSet(KEY_POS, pos);
  }

  function copyText(text) {
    try {
      if (typeof GM_setClipboard !== 'undefined') {
        GM_setClipboard(text);
        return;
      }
    } catch (e) { /* ignore */ }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) { /* ignore */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { /* ignore */ }
  }

  /* ============================ Ô NHẬP LIỆU: NHẬN DIỆN / ĐỌC / GHI ============================ */

  function tagOf(el) {
    return el && el.tagName ? el.tagName.toLowerCase() : '';
  }

  function isEditableEl(el) {
    if (!el || !el.nodeType || el.nodeType !== 1) return false;
    if (isOurs(el)) return false;
    const tag = tagOf(el);
    if (tag === 'textarea') return !el.disabled && !el.readOnly;
    if (tag === 'input') {
      const type = String(el.type || 'text').toLowerCase();
      return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'date', 'datetime-local', 'month', 'week', 'time', 'hidden'].includes(type);
    }
    const ce = el.getAttribute && el.getAttribute('contenteditable');
    return ce === 'true' || ce === '' || ce === 'plaintext-only' || el.isContentEditable === true;
  }

  /** Có phải vùng soạn thảo rich-text (contenteditable) — không dựa riêng vào isContentEditable. */
  function isRichEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable === true) return true;
    try {
      return el.isContentEditable === true || !!el.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
    } catch (e) {
      return false;
    }
  }

  /** Vùng con trỏ hiện tại của một ô nhập (dạng offset ký tự) hoặc null. */
  function readCaret(el) {
    const tag = tagOf(el);
    if (tag === 'input' || tag === 'textarea') {
      const text = el.value || '';
      let start = el.selectionStart;
      let end = el.selectionEnd;
      if (typeof start !== 'number') start = text.length;
      if (typeof end !== 'number') end = start;
      return { kind: 'value', el, text, start, end };
    }
    if (isRichEditable(el)) {
      return { kind: 'editable', el, text: el.textContent || '', start: 0, end: 0 };
    }
    return null;
  }

  /* ---- contenteditable: chuyển offset ký tự ⇄ DOM Range ---- */

  function offsetFromNode(root, node, offset) {
    let total = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      if (n === node) return total + offset;
      total += n.nodeValue.length;
    }
    return total;
  }

  function rangeFromOffsets(root, start, end) {
    let total = 0;
    let startNode = null;
    let startOff = 0;
    let endNode = null;
    let endOff = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      const len = n.nodeValue.length;
      if (!startNode && start <= total + len) {
        startNode = n;
        startOff = start - total;
      }
      if (!endNode && end <= total + len) {
        endNode = n;
        endOff = end - total;
      }
      total += len;
      if (startNode && endNode) break;
    }
    if (!startNode) return null;
    if (!endNode) {
      endNode = startNode;
      endOff = startOff;
    }
    try {
      const range = document.createRange();
      range.setStart(startNode, clamp(startOff, 0, startNode.nodeValue.length));
      range.setEnd(endNode, clamp(endOff, 0, endNode.nodeValue.length));
      return range;
    } catch (e) {
      return null;
    }
  }

  function editableCaretOffsets(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return null;
    return {
      start: offsetFromNode(el, range.startContainer, range.startOffset),
      end: offsetFromNode(el, range.endContainer, range.endOffset),
    };
  }

  function setNativeValue(el, value) {
    const tag = tagOf(el);
    const proto = tag === 'input' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    try {
      const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
      if (setter) setter.call(el, value);
      else el.value = value;
    } catch (e) {
      el.value = value;
    }
  }

  /**
   * Thay đoạn [start, end) của ô nhập bằng `text`.
   * Trả về vị trí con trỏ sau khi chèn (offset) hoặc -1 nếu thất bại.
   */
  function replaceRangeIn(el, start, end, text) {
    if (!el || !el.isConnected) return -1;
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* ignore */ } }
    const tag = tagOf(el);

    if (tag === 'input' || tag === 'textarea') {
      const old = el.value || '';
      const s = clamp(start, 0, old.length);
      const e = clamp(end, s, old.length);
      const next = old.slice(0, s) + text + old.slice(e);
      setNativeValue(el, next);
      const caret = s + text.length;
      try { el.setSelectionRange(caret, caret); } catch (err) { /* ignore */ }
      try {
        const ev = new Event('input', { bubbles: true });
        ev.inputType = 'insertText';
        el.dispatchEvent(ev);
      } catch (err) { /* ignore */ }
      return caret;
    }

    if (isRichEditable(el)) {
      // Chọn đúng đoạn cần thay rồi để trình duyệt tự chèn (giữ undo stack của app)
      const range = rangeFromOffsets(el, start, end);
      if (range) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        try {
          if (document.execCommand('insertText', false, text)) {
            return start + text.length;
          }
        } catch (err) { /* ignore */ }
      }
      // Dự phòng (không tạo được Range): ghép chuỗi rồi ghi lại, KHÔNG xóa chữ xung quanh
      const cur = el.textContent || '';
      const s = clamp(start, 0, cur.length);
      const e = clamp(end, s, cur.length);
      el.textContent = cur.slice(0, s) + text + cur.slice(e);
      const caret = s + text.length;
      try {
        const r2 = rangeFromOffsets(el, caret, caret);
        if (r2) {
          const sel2 = window.getSelection();
          sel2.removeAllRanges();
          sel2.addRange(r2);
        }
      } catch (err) { /* ignore */ }
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) { /* ignore */ }
      return caret;
    }
    return -1;
  }

  /** Chèn câu vào ô nhập tại con trỏ (thay vùng đang bôi đen nếu có). */
  function insertAtCaret(el, text) {
    if (!isEditableEl(el)) return false;
    const tag = tagOf(el);
    if (tag === 'input' || tag === 'textarea') {
      const v = el.value || '';
      let start = typeof el.selectionStart === 'number' ? el.selectionStart : v.length;
      let end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
      return replaceRangeIn(el, start, end, text) >= 0;
    }
    const off = editableCaretOffsets(el);
    const len = (el.textContent || '').length;
    const start = off ? off.start : len;
    const end = off ? off.end : len;
    return replaceRangeIn(el, start, end, text) >= 0;
  }

  /* ============================ SHADOW DOM ============================ */

  const host = document.createElement('div');
  host.id = 'tln-shadow-host';
  host.style.cssText = 'position:fixed !important;top:0 !important;left:0 !important;width:0 !important;height:0 !important;pointer-events:none !important;z-index:2147483647 !important;';
  (document.body || document.documentElement).appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  function isOurs(node) {
    try {
      if (!node) return false;
      if (node === host) return true;
      const path = (typeof node.composedPath === 'function') ? node.composedPath() : [];
      if (path.indexOf(host) > -1) return true;
      return host.contains(node);
    } catch (e) {
      return false;
    }
  }

  /* ============================ CSS ============================ */

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }

    #tln-btn {
      position: fixed; width: 44px; height: 44px; border-radius: 50%;
      background: #2563eb; color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 21px; cursor: grab; user-select: none; touch-action: none;
      box-shadow: 0 4px 14px rgba(0,0,0,.3); border: 2px solid #fff;
      pointer-events: auto; transition: transform .1s ease, box-shadow .1s ease;
    }
    #tln-btn:active { cursor: grabbing; transform: scale(.95); }

    #tln-panel {
      position: fixed; width: 366px; height: 500px; max-height: calc(100vh - 20px);
      background: #fff; border: 2px solid #2563eb; border-radius: 12px;
      box-shadow: 0 10px 34px rgba(0,0,0,.3); display: none; flex-direction: column;
      overflow: hidden; pointer-events: auto; z-index: 2147483646;
    }
    #tln-panel.show { display: flex; }

    .tln-header {
      height: 46px; min-height: 46px; padding: 0 10px 0 12px; background: #f1f5f9;
      border-bottom: 1px solid #cbd5e1; display: flex; align-items: center;
      justify-content: space-between; gap: 8px; flex-shrink: 0;
    }
    .tln-title { font-weight: 700; font-size: 13px; color: #0f172a; white-space: nowrap; }
    .tln-title small { font-weight: 600; color: #64748b; font-size: 10px; margin-left: 6px; }
    .tln-header-right { display: flex; align-items: center; gap: 6px; }

    button.tln-mode {
      font-size: 11px; padding: 5px 9px; border-radius: 6px; border: 1px solid #cbd5e1;
      cursor: pointer; font-weight: 600; background: #fff; white-space: nowrap;
    }
    button.tln-mode.work { background: #dcfce7; color: #15803d; border-color: #86efac; }
    button.tln-mode.edit { background: #fef3c7; color: #b45309; border-color: #fcd34d; }
    button.tln-x {
      width: 26px; height: 26px; border-radius: 6px; border: 1px solid #cbd5e1;
      background: #fff; color: #475569; cursor: pointer; font-size: 13px; line-height: 1;
    }
    button.tln-x:hover { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }

    .tln-search-wrap { padding: 8px 10px 0; flex-shrink: 0; }
    .tln-search {
      width: 100%; height: 30px; padding: 0 10px; font-size: 12px; color: #0f172a;
      border: 1px solid #cbd5e1; border-radius: 8px; outline: none; background: #f8fafc;
    }
    .tln-search:focus { border-color: #2563eb; background: #fff; }

    .tln-body { flex: 1; padding: 8px 10px 10px; overflow-y: auto; overflow-x: hidden; background: #fff; }
    .tln-empty { padding: 26px 10px; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.6; }

    .tln-cat { margin-bottom: 8px; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #fff; }
    .tln-cat.dragging { opacity: .35; }
    .tln-cat.drag-over-top { border-top: 3px solid #2563eb; }
    .tln-cat.drag-over-bottom { border-bottom: 3px solid #2563eb; }

    .tln-cat-header {
      padding: 9px 10px; background: #f8fafc; display: flex; align-items: center;
      justify-content: space-between; gap: 6px; cursor: pointer; user-select: none;
    }
    .tln-cat-header:hover { background: #f1f5f9; }
    .tln-cat-left { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; }
    .tln-cat-title { font-weight: 700; font-size: 12.5px; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tln-count { font-size: 10px; font-weight: 700; color: #64748b; background: #e2e8f0; border-radius: 9px; padding: 1px 6px; flex-shrink: 0; }
    .tln-arrow { color: #64748b; font-size: 11px; flex-shrink: 0; }
    .tln-cat-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

    .tln-items { display: none; border-top: 1px solid #eef2f7; }
    .tln-items.open { display: block; }

    .tln-item {
      display: flex; align-items: flex-start; gap: 7px; padding: 8px 10px;
      border-bottom: 1px solid #f1f5f9; background: #fff; cursor: pointer; line-height: 1.4;
    }
    .tln-item:last-child { border-bottom: none; }
    .tln-item:hover { background: #eff6ff; }
    .tln-item.dragging { opacity: .35; }
    .tln-item.drag-over-top { border-top: 2px solid #2563eb; }
    .tln-item.drag-over-bottom { border-bottom: 2px solid #2563eb; }

    .tln-chip {
      flex-shrink: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px; font-weight: 700; color: #1d4ed8; background: #dbeafe;
      border: 1px solid #bfdbfe; border-radius: 5px; padding: 1px 5px; margin-top: 1px;
      max-width: 104px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .tln-item-box { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .tln-item-text { font-size: 12px; color: #334155; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .tln-item-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }

    .tln-icon {
      background: transparent; border: none; cursor: pointer; font-size: 12px;
      padding: 2px 3px; border-radius: 4px; line-height: 1; opacity: .75;
    }
    .tln-icon:hover { background: #e2e8f0; opacity: 1; }
    .tln-handle {
      cursor: grab; color: #94a3b8; font-size: 14px; line-height: 1; user-select: none;
      padding: 1px 2px; flex-shrink: 0; margin-top: 1px;
    }
    .tln-handle:active { cursor: grabbing; }

    .tln-add-row {
      width: 100%; margin-top: 6px; padding: 8px; border: 1px dashed #cbd5e1;
      background: #f8fafc; color: #334155; border-radius: 7px; cursor: pointer;
      font-weight: 600; font-size: 12px;
    }
    .tln-add-row:hover { background: #eef2f7; border-color: #94a3b8; }
    .tln-add-item { border: none; border-top: 1px dashed #dbe3ec; border-radius: 0; background: #fbfdff; color: #2563eb; text-align: left; padding: 8px 10px; }
    .tln-add-item:hover { background: #eff6ff; }

    .tln-footer {
      flex-shrink: 0; padding: 7px 12px; background: #f8fafc; border-top: 1px solid #e2e8f0;
      font-size: 10.5px; color: #64748b; line-height: 1.45;
    }
    .tln-footer b { color: #1d4ed8; }
    .tln-auto { display: flex; align-items: center; gap: 5px; cursor: pointer; margin-top: 4px; font-size: 10.5px; }
    .tln-auto input { width: 12px; height: 12px; cursor: pointer; margin: 0; }

    /* --- Gợi ý câu tắt nổi trên ô soạn tin --- */
    #tln-suggest {
      position: fixed; width: 330px; max-width: calc(100vw - 20px);
      background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
      box-shadow: 0 10px 28px rgba(0,0,0,.22); overflow: hidden; display: none;
      pointer-events: auto; z-index: 2147483647;
    }
    #tln-suggest.show { display: block; }
    .tln-sg-head {
      padding: 6px 10px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0;
      font-size: 10.5px; font-weight: 700; color: #475569; display: flex; justify-content: space-between; gap: 8px;
    }
    .tln-sg-list { max-height: 246px; overflow-y: auto; }
    .tln-sg {
      display: flex; align-items: flex-start; gap: 7px; padding: 7px 10px; cursor: pointer;
      border-bottom: 1px solid #f4f7fb;
    }
    .tln-sg:last-child { border-bottom: none; }
    .tln-sg.active, .tln-sg:hover { background: #eff6ff; }
    .tln-sg-text { flex: 1; min-width: 0; font-size: 12px; color: #334155; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .tln-sg-hint { padding: 5px 10px; font-size: 10px; color: #94a3b8; background: #f8fafc; border-top: 1px solid #f1f5f9; }

    /* --- Toast --- */
    #tln-toast {
      position: fixed; background: #10b981; color: #fff; padding: 6px 14px;
      border-radius: 20px; font-size: 12px; font-weight: 600; display: none;
      box-shadow: 0 4px 12px rgba(0,0,0,.2); white-space: nowrap; pointer-events: none;
      z-index: 2147483647; max-width: 320px; overflow: hidden; text-overflow: ellipsis;
    }
    #tln-toast.err { background: #ef4444; }

    /* --- Modal nhập liệu --- */
    .tln-modal-mask {
      position: absolute; inset: 0; background: rgba(15,23,42,.45); display: flex;
      align-items: center; justify-content: center; padding: 12px; z-index: 5;
      pointer-events: auto;
    }
    .tln-modal {
      width: 100%; background: #fff; border-radius: 10px; box-shadow: 0 12px 30px rgba(0,0,0,.3);
      display: flex; flex-direction: column; max-height: 100%; overflow: hidden;
    }
    .tln-modal-head { padding: 10px 12px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-size: 12.5px; font-weight: 700; color: #0f172a; }
    .tln-modal-body { padding: 10px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 9px; }
    .tln-field { display: flex; flex-direction: column; gap: 4px; }
    .tln-field label { font-size: 10.5px; font-weight: 700; color: #475569; }
    .tln-field input, .tln-field textarea {
      width: 100%; font-size: 12px; color: #0f172a; border: 1px solid #cbd5e1;
      border-radius: 7px; padding: 6px 8px; outline: none; background: #fff; font-family: inherit;
    }
    .tln-field input:focus, .tln-field textarea:focus { border-color: #2563eb; }
    .tln-field textarea { min-height: 92px; resize: vertical; line-height: 1.5; }
    .tln-field .tln-hint { font-size: 10px; color: #94a3b8; }
    .tln-field.err input { border-color: #ef4444; }
    .tln-err-msg { font-size: 10.5px; color: #dc2626; font-weight: 600; display: none; }
    .tln-err-msg.show { display: block; }
    .tln-modal-foot { padding: 9px 12px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 7px; background: #f8fafc; }
    .tln-btn { font-size: 12px; font-weight: 600; padding: 6px 13px; border-radius: 7px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; color: #334155; }
    .tln-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .tln-btn.primary:hover { background: #1d4ed8; }
    .tln-btn.danger { background: #ef4444; border-color: #ef4444; color: #fff; }
    .tln-btn:hover { filter: brightness(.97); }
  `;
  shadow.appendChild(h('style', { text: CSS }));

  /* ============================ PHẦN TỬ UI ============================ */

  const btn = h('div', { id: 'tln-btn', title: 'Trả lời nhanh (Alt+Shift+S)', text: '💬' });
  const panel = h('div', { id: 'tln-panel' });
  const toast = h('div', { id: 'tln-toast' });
  const suggest = h('div', { id: 'tln-suggest' });
  shadow.appendChild(btn);
  shadow.appendChild(panel);
  shadow.appendChild(toast);
  shadow.appendChild(suggest);

  /* ============================ CÀI ĐẶT ============================ */

  function loadSettings() {
    const s = gmGet(KEY_SETTINGS, null);
    return { autoExpand: !(s && s.autoExpand === false) }; // mặc định: gõ đúng câu tắt + dấu cách là chèn luôn
  }
  function saveSettings() {
    gmSet(KEY_SETTINGS, settings);
  }

  /* ============================ TRẠNG THÁI ============================ */

  const settings = loadSettings();
  let categories = loadData();
  let isEditMode = false;
  let isOpenPanel = false;
  let lastActiveInput = null;
  const openCats = new Set();     // id danh mục đang mở
  let searchTerm = '';
  let draggedCatIdx = null;
  let draggedItem = null;         // { catIdx, itemIdx }

  const picker = { open: false, list: [], index: -1, token: null, info: null };

  /* ============================ TOAST ============================ */

  let toastTimer = null;
  function showToast(msg, isErr) {
    toast.textContent = msg;
    toast.classList.toggle('err', !!isErr);
    toast.style.display = 'block';
    if (isOpenPanel) updatePanelPosition();
    else positionToastNearButton();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 1800);
  }

  function positionToastNearButton() {
    const r = btn.getBoundingClientRect();
    toast.style.left = clamp(r.left - 120, 8, Math.max(8, window.innerWidth - 250)) + 'px';
    toast.style.top = clamp(r.top - 40, 8, window.innerHeight - 40) + 'px';
  }

  /* ============================ VỊ TRÍ BONG BÓNG & PANEL ============================ */

  let currentPos = loadPosition();

  function applyBtnPosition(top, left) {
    const boundedTop = clamp(top, 6, Math.max(6, window.innerHeight - 50));
    const boundedLeft = clamp(left, 6, Math.max(6, window.innerWidth - 50));
    btn.style.top = boundedTop + 'px';
    btn.style.left = boundedLeft + 'px';
    return { top: boundedTop, left: boundedLeft };
  }
  currentPos = applyBtnPosition(currentPos.top, currentPos.left);

  function updatePanelPosition() {
    const r = btn.getBoundingClientRect();
    const pw = panel.offsetWidth || 366;
    const ph = panel.offsetHeight || 500;
    const margin = 10;

    let left = r.right + margin;
    if (left + pw > window.innerWidth - 6) left = r.left - pw - margin;
    left = clamp(left, 6, Math.max(6, window.innerWidth - pw - 6));

    let top = r.top;
    if (top + ph > window.innerHeight - 6) top = window.innerHeight - ph - 8;
    top = clamp(top, 6, Math.max(6, window.innerHeight - ph - 6));

    panel.style.left = left + 'px';
    panel.style.top = top + 'px';

    toast.style.left = clamp(left, 8, Math.max(8, window.innerWidth - 250)) + 'px';
    toast.style.top = clamp(top - 38, 8, window.innerHeight - 38) + 'px';
  }

  /* ============================ KÉO THẢ BONG BÓNG ============================ */

  let dragging = false;
  let moved = false;
  let startX = 0, startY = 0, baseLeft = 0, baseTop = 0;

  function point(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function onDragStart(e) {
    dragging = true;
    moved = false;
    const p = point(e);
    startX = p.x; startY = p.y;
    const r = btn.getBoundingClientRect();
    baseLeft = r.left; baseTop = r.top;
  }

  function onDragMove(e) {
    if (!dragging) return;
    const p = point(e);
    const dx = p.x - startX;
    const dy = p.y - startY;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    moved = true;
    currentPos = applyBtnPosition(baseTop + dy, baseLeft + dx);
    if (isOpenPanel) updatePanelPosition();
    if (e.cancelable && e.type === 'touchmove') e.preventDefault();
  }

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    if (moved) savePosition(currentPos);
  }

  btn.addEventListener('mousedown', onDragStart);
  btn.addEventListener('touchstart', onDragStart, { passive: true });
  document.addEventListener('mousemove', onDragMove, true);
  document.addEventListener('touchmove', onDragMove, { passive: false, capture: true });
  document.addEventListener('mouseup', onDragEnd, true);
  document.addEventListener('touchend', onDragEnd, true);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (moved) { moved = false; return; } // vừa kéo thì không mở panel
    togglePanel();
  });

  function togglePanel() {
    isOpenPanel = !isOpenPanel;
    if (isOpenPanel) {
      render();
      panel.classList.add('show');
      updatePanelPosition();
    } else {
      panel.classList.remove('show');
      hideModal();
    }
  }

  /* ============================ TÌM CÂU TẮT ============================ */

  function allItems() {
    const out = [];
    categories.forEach((cat, catIdx) => {
      (cat.items || []).forEach((item, itemIdx) => {
        out.push({ item, cat, catIdx, itemIdx, key: normShortcut(item.shortcut) });
      });
    });
    return out;
  }

  function findExact(key) {
    const k = normShortcut(key);
    if (!k) return null;
    const list = allItems();
    for (let i = 0; i < list.length; i++) {
      if (list[i].key === k) return list[i];
    }
    return null;
  }

  function findSuggestions(prefix) {
    const p = normShortcut(prefix);
    const list = allItems();
    if (!p) {
      // mới gõ "/" → hiện các câu tắt ngắn nhất / danh sách đầu
      return list.slice(0, MAX_SUGGEST);
    }
    const exact = [];
    const starts = [];
    const contains = [];
    list.forEach((rec) => {
      if (rec.key === p) exact.push(rec);
      else if (rec.key.indexOf(p) === 0) starts.push(rec);
      else if (rec.key.indexOf(p) > 0) contains.push(rec);
    });
    return exact.concat(starts, contains).slice(0, MAX_SUGGEST);
  }

  /**
   * Chỉ bung gợi ý ở ô soạn tin — không bung khi gõ "/" trong ô tìm kiếm, ô lọc…
   * (html2.txt: ô soạn tin là textarea#replyBoxComposer trong .reply-box__text-area)
   */
  function isSuggestScope(el) {
    if (!isEditableEl(el)) return false;
    const tag = tagOf(el);
    if (tag === 'textarea') return true;
    if (isRichEditable(el)) return true;
    if (el.id === PANCAKE_COMPOSER_ID) return true;
    try {
      if (el.closest && el.closest('.reply-box-container, .reply-box__text-area')) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /* ============================ ĐỌC TOKEN "/xx" TẠI CON TRỎ ============================ */

  const TOKEN_RE = /(?:^|[\s([{"'“”‘’<>⟦])?\/([^\s/]{0,32})$/;

  /** Trả về { el, token, start, end, caretKind } của câu tắt đang gõ ở con trỏ. */
  function tokenAt(el) {
    if (!isEditableEl(el)) return null;
    const caret = readCaret(el);
    if (!caret) return null;
    const tag = tagOf(el);

    if (caret.kind === 'value') {
      if (caret.start !== caret.end) return null; // đang bôi đen → không gợi ý
      const before = caret.text.slice(0, caret.start);
      const m = before.match(TOKEN_RE);
      if (!m) return null;
      const token = m[1] || '';
      const start = caret.start - token.length - 1;
      if (start < 0) return null;
      // phải là "/" đứng đầu hoặc sau khoảng trắng/ký tự mở
      if (start > 0 && !/[\s([{"'“”‘’<>⟦]/.test(before.charAt(start - 1))) return null;
      return { kind: 'value', el, token, start, end: caret.start, caret: caret.start };
    }

    // contenteditable
    const offs = editableCaretOffsets(el);
    if (!offs || offs.start !== offs.end) return null;
    const before = caret.text.slice(0, offs.start);
    const m = before.match(TOKEN_RE);
    if (!m) return null;
    const token = m[1] || '';
    const start = offs.start - token.length - 1;
    if (start < 0) return null;
    if (start > 0 && !/[\s([{"'“”‘’<>⟦]/.test(before.charAt(start - 1))) return null;
    return { kind: 'editable', el, token, start, end: offs.start, caret: offs.start };
  }

  /* ============================ BẢNG GỢI Ý ============================ */

  function hideSuggest() {
    picker.open = false;
    picker.index = -1;
    picker.token = null;
    picker.list = [];
    suggest.classList.remove('show');
  }

  function renderSuggest() {
    suggest.innerHTML = '';
    if (!picker.open || !picker.list.length) {
      suggest.classList.remove('show');
      return;
    }
    const head = h('div', { class: 'tln-sg-head' });
    head.appendChild(h('span', { text: 'Câu tắt khớp “/' + (picker.token || '') + '”' }));
    head.appendChild(h('span', { text: picker.list.length + ' kết quả' }));
    suggest.appendChild(head);

    const list = h('div', { class: 'tln-sg-list' });
    picker.list.forEach((rec, i) => {
      const row = h('div', {
        class: 'tln-sg' + (i === picker.index ? ' active' : ''),
        onmousedown: (e) => { e.preventDefault(); e.stopPropagation(); chooseSuggest(i); },
      });
      row.appendChild(h('span', { class: 'tln-chip', text: '/' + rec.key, title: '/' + rec.key }));
      row.appendChild(h('span', { class: 'tln-sg-text', text: rec.item.text }));
      list.appendChild(row);
    });
    suggest.appendChild(list);
    suggest.appendChild(h('div', {
      class: 'tln-sg-hint',
      text: 'Enter / Tab để chèn  ·  ↑↓ chọn  ·  Esc đóng',
    }));

    suggest.classList.add('show');
    positionSuggest();
  }

  function positionSuggest() {
    const info = picker.info;
    if (!info || !info.el || !info.el.isConnected) {
      suggest.classList.remove('show');
      return;
    }
    const r = info.el.getBoundingClientRect();
    const w = suggest.offsetWidth || 330;
    const hgt = suggest.offsetHeight || 200;
    let left = clamp(r.left, 6, Math.max(6, window.innerWidth - w - 6));
    let top = r.top - hgt - 6;
    if (top < 6) top = clamp(r.bottom + 6, 6, Math.max(6, window.innerHeight - hgt - 6));
    suggest.style.left = left + 'px';
    suggest.style.top = top + 'px';
  }

  function refreshSuggest(el) {
    if (!el) return hideSuggest();
    const info = tokenAt(el);
    if (!info) return hideSuggest();
    const list = findSuggestions(info.token);
    if (!list.length) return hideSuggest();

    picker.info = info;
    picker.list = list;
    picker.token = info.token;
    picker.open = true;

    const exactIdx = list.findIndex((r) => r.key === normShortcut(info.token));
    picker.index = info.token ? (exactIdx >= 0 ? exactIdx : 0) : -1;

    renderSuggest();
  }

  function chooseSuggest(i) {
    const rec = picker.list[i];
    const info = picker.info;
    if (!rec || !info) return;
    expandShortcut(info, rec);
  }

  /** Chèn nội dung câu vào đúng chỗ đang gõ token, thay luôn token. */
  function expandShortcut(info, rec, suffix) {
    const el = info.el;
    if (!el || !el.isConnected) { hideSuggest(); return; }
    const caretAfter = replaceRangeIn(el, info.start, info.end, rec.item.text + (suffix || ''));
    hideSuggest();
    if (caretAfter < 0) {
      showToast('Không chèn được vào ô nhập', true);
      return;
    }
    try {
      if (tagOf(el) === 'input' || tagOf(el) === 'textarea') el.setSelectionRange(caretAfter, caretAfter);
    } catch (e) { /* ignore */ }
    showToast('Đã chèn câu /' + rec.key + ' — Enter để gửi');
  }

  /* ============================ BẮT SỰ KIỆN BÀN PHÍM ============================ */

  // Enter / Tab / ↑↓ / Esc khi đang gợi ý
  document.addEventListener('keydown', (e) => {
    if (e.isComposing) return;             // đang gõ tiếng Việt bằng IME thì để IME xử lý
    const target = e.target;
    if (isOurs(target)) return;
    if (!isSuggestScope(target)) return;

    const key = e.key;

    if (key === 'Escape' && picker.open) {
      hideSuggest();
      return;
    }

    if ((key === 'ArrowDown' || key === 'ArrowUp') && picker.open && picker.list.length) {
      e.preventDefault();
      e.stopPropagation();
      const delta = key === 'ArrowDown' ? 1 : -1;
      if (picker.index < 0) picker.index = 0;
      else picker.index = (picker.index + delta + picker.list.length) % picker.list.length;
      renderSuggest();
      return;
    }

    if (key === ' ' && settings.autoExpand) {
      // Gõ đúng câu tắt rồi cách ra ("/cn ") → chèn luôn, dấu cách vừa gõ thành khoảng trắng sau câu
      const spInfo = tokenAt(target);
      if (spInfo && spInfo.token) {
        const spRec = findExact(spInfo.token);
        if (spRec) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          expandShortcut(spInfo, spRec, ' ');
          return;
        }
      }
    }

    if (key !== 'Enter' && key !== 'Tab') return;

    // Enter khi ĐANG MỞ gợi ý nhưng chưa chọn dòng nào (mới gõ "/") → không chen ngang
    if (picker.open && picker.index >= 0 && picker.list.length) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      chooseSuggest(picker.index);
      return;
    }

    // Gợi ý đã đóng / chưa kịp mở: nếu token hiện tại khớp CHÍNH XÁC thì vẫn chèn
    const info = tokenAt(target);
    if (!info) return;
    const rec = findExact(info.token);
    if (!rec) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    expandShortcut(info, rec);
  }, true);

  // Gõ phím → cập nhật gợi ý
  function onInput(e) {
    const el = e.target;
    if (isOurs(el)) return;
    if (!isEditableEl(el)) return;
    lastActiveInput = el;
    if (isSuggestScope(el)) refreshSuggest(el);
  }
  document.addEventListener('input', onInput, true);

  document.addEventListener('keyup', (e) => {
    const el = e.target;
    if (isOurs(el) || !isSuggestScope(el)) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Backspace', 'Delete'].indexOf(e.key) > -1) {
      refreshSuggest(el);
    }
  }, true);

  // Bấm chuột trong ô soạn tin (đổi vị trí con trỏ) → tính lại token tại con trỏ mới
  document.addEventListener('click', (e) => {
    const el = e.target;
    if (isOurs(el) || !isSuggestScope(el)) return;
    setTimeout(() => { if (el === document.activeElement) refreshSuggest(el); }, 0);
  }, true);

  // Rời ô soạn tin thì đóng gợi ý
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (isOurs(el) || !isSuggestScope(el)) return;
    setTimeout(() => {
      const a = document.activeElement;
      if (!a || a !== el) hideSuggest();
    }, 120);
  }, true);

  // Ghi nhớ ô nhập đang dùng
  function trackInput(e) {
    const el = e.target;
    if (isOurs(el)) return;
    if (isEditableEl(el)) lastActiveInput = el;
  }
  document.addEventListener('focusin', trackInput, true);
  document.addEventListener('mousedown', trackInput, true);

  // Cuộn / đổi kích thước → vị trí gợi ý đi theo ô nhập
  window.addEventListener('resize', () => {
    currentPos = applyBtnPosition(currentPos.top, currentPos.left);
    if (isOpenPanel) updatePanelPosition();
    if (picker.open) positionSuggest();
  });
  document.addEventListener('scroll', () => { if (picker.open) positionSuggest(); }, true);

  /* ============================ RENDER PANEL ============================ */

  function itemRow(rec) {
    const { item, catIdx, itemIdx, key } = rec;
    const row = h('div', { class: 'tln-item' });

    if (isEditMode) {
      const handle = h('span', { class: 'tln-handle', text: '⠿', title: 'Kéo để đổi vị trí câu', draggable: 'true' });
      handle.addEventListener('dragstart', (e) => {
        draggedItem = { catIdx, itemIdx };
        row.classList.add('dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'tln-item'); } catch (err) { /* ignore */ }
      });
      handle.addEventListener('dragend', () => {
        draggedItem = null;
        shadow.querySelectorAll('.tln-item').forEach((el) => el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom'));
        render();
      });
      row.appendChild(handle);
    }

    row.appendChild(h('span', { class: 'tln-chip', text: '/' + key, title: 'Gõ /' + key + ' trong ô soạn tin rồi Enter' }));

    const box = h('div', { class: 'tln-item-box' });
    box.appendChild(h('span', { class: 'tln-item-text', text: item.text, title: item.text }));
    row.appendChild(box);

    const actions = h('div', { class: 'tln-item-actions' });

    if (isEditMode) {
      row.addEventListener('dragover', (e) => {
        if (!draggedItem || draggedItem.catIdx !== catIdx || draggedItem.itemIdx === itemIdx) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) { /* ignore */ }
        const rect = row.getBoundingClientRect();
        const above = (e.clientY - rect.top) < rect.height / 2;
        row.classList.toggle('drag-over-top', above);
        row.classList.toggle('drag-over-bottom', !above);
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over-top', 'drag-over-bottom'));
      row.addEventListener('drop', (e) => {
        if (!draggedItem || draggedItem.catIdx !== catIdx) return;
        e.preventDefault();
        row.classList.remove('drag-over-top', 'drag-over-bottom');
        const rect = row.getBoundingClientRect();
        const above = (e.clientY - rect.top) < rect.height / 2;
        const from = draggedItem.itemIdx;
        let to = itemIdx;
        if (from === to) return;
        const arr = categories[catIdx].items;
        const moved2 = arr.splice(from, 1)[0];
        if (from < to) to -= 1;
        if (!above) to += 1;
        arr.splice(clamp(to, 0, arr.length), 0, moved2);
        draggedItem = null;
        saveData();
        render();
      });

      actions.appendChild(h('button', {
        class: 'tln-icon', text: '✏️', title: 'Sửa câu',
        onclick: (e) => { e.stopPropagation(); openItemForm({ mode: 'edit', catIdx, itemIdx }); },
      }));
      actions.appendChild(h('button', {
        class: 'tln-icon', text: '🗑️', title: 'Xóa câu',
        onclick: (e) => {
          e.stopPropagation();
          const arr = categories[catIdx].items;
          arr.splice(itemIdx, 1);
          saveData();
          render();
          showToast('Đã xóa câu /' + key);
        },
      }));
    } else {
      actions.appendChild(h('button', {
        class: 'tln-icon', text: '📋', title: 'Sao chép câu',
        onclick: (e) => { e.stopPropagation(); copyText(item.text); showToast('Đã sao chép câu /' + key); },
      }));
      row.addEventListener('click', () => insertFromPanel(item, key));
    }

    row.appendChild(actions);
    return row;
  }

  function insertFromPanel(item, key) {
    const target = pickTargetInput();
    if (target && insertAtCaret(target, item.text)) {
      try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      showToast('Đã chèn /' + key + ' vào ô trả lời — Enter để gửi');
    } else {
      copyText(item.text);
      showToast('Đã sao chép /' + key + ' (chưa chọn ô nhập)');
    }
  }

  function pickTargetInput() {
    if (isEditableEl(lastActiveInput) && lastActiveInput.isConnected) return lastActiveInput;
    // Ưu tiên ô soạn tin Pancake (html2.txt / html3.txt / _app forcusReplyCompose)
    const composer = document.getElementById(PANCAKE_COMPOSER_ID);
    if (isEditableEl(composer)) return composer;
    const active = document.activeElement;
    if (isEditableEl(active)) return active;
    return null;
  }

  function catBlock(cat, catIdx) {
    const catEl = h('div', { class: 'tln-cat' });
    const isOpen = (searchTerm || isEditMode) ? true : openCats.has(cat.id);
    const count = (cat.items || []).length;

    const header = h('div', { class: 'tln-cat-header' });
    const left = h('div', { class: 'tln-cat-left' });

    if (isEditMode) {
      const handle = h('span', { class: 'tln-handle', text: '⠿', title: 'Kéo để sắp xếp danh mục', draggable: 'true' });
      handle.addEventListener('dragstart', (e) => {
        draggedCatIdx = catIdx;
        catEl.classList.add('dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'tln-cat'); } catch (err) { /* ignore */ }
      });
      handle.addEventListener('dragend', () => {
        draggedCatIdx = null;
        shadow.querySelectorAll('.tln-cat').forEach((el) => el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom'));
        render();
      });
      left.appendChild(handle);
    }

    left.appendChild(h('span', { class: 'tln-cat-title', text: cat.title || 'Danh mục' }));
    left.appendChild(h('span', { class: 'tln-count', text: String(count) }));
    if (!isEditMode) left.appendChild(h('span', { class: 'tln-arrow', text: isOpen ? '▾' : '▸' }));
    header.appendChild(left);

    const right = h('div', { class: 'tln-cat-right' });
    if (isEditMode) {
      right.appendChild(h('button', {
        class: 'tln-icon', text: '✏️', title: 'Đổi tên danh mục',
        onclick: (e) => { e.stopPropagation(); openCatForm({ mode: 'edit', catIdx }); },
      }));
      right.appendChild(h('button', {
        class: 'tln-icon', text: '🗑️', title: 'Xóa danh mục',
        onclick: (e) => {
          e.stopPropagation();
          const n = (categories[catIdx].items || []).length;
          if (!window.confirm('Xóa danh mục “' + (categories[catIdx].title || '') + '”' + (n ? ' cùng ' + n + ' câu?' : '?'))) return;
          categories.splice(catIdx, 1);
          saveData();
          render();
          showToast('Đã xóa danh mục');
        },
      }));
    }
    header.appendChild(right);

    header.addEventListener('click', () => {
      if (isEditMode) return; // ở chế độ sửa, bấm tiêu đề không mở/đóng
      if (openCats.has(cat.id)) openCats.delete(cat.id);
      else openCats.add(cat.id);
      render();
    });

    if (isEditMode) {
      catEl.addEventListener('dragover', (e) => {
        if (draggedCatIdx === null || draggedCatIdx === catIdx) return;
        if (draggedItem) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (err) { /* ignore */ }
        const rect = catEl.getBoundingClientRect();
        const above = (e.clientY - rect.top) < rect.height / 2;
        catEl.classList.toggle('drag-over-top', above);
        catEl.classList.toggle('drag-over-bottom', !above);
      });
      catEl.addEventListener('dragleave', (e) => {
        if (catEl.contains(e.relatedTarget)) return;
        catEl.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      catEl.addEventListener('drop', (e) => {
        if (draggedCatIdx === null || draggedCatIdx === catIdx) return;
        e.preventDefault();
        catEl.classList.remove('drag-over-top', 'drag-over-bottom');
        const rect = catEl.getBoundingClientRect();
        const above = (e.clientY - rect.top) < rect.height / 2;
        const from = draggedCatIdx;
        let to = catIdx;
        const movedCat = categories.splice(from, 1)[0];
        if (from < to) to -= 1;
        if (!above) to += 1;
        categories.splice(clamp(to, 0, categories.length), 0, movedCat);
        draggedCatIdx = null;
        saveData();
        render();
      });
    }

    catEl.appendChild(header);

    // Lọc theo từ khóa (câu tắt + nội dung)
    const term = searchTerm.toLowerCase();
    const matched = [];
    (cat.items || []).forEach((item, itemIdx) => {
      if (term) {
        const hay = (normShortcut(item.shortcut) + ' ' + (item.text || '')).toLowerCase();
        if (hay.indexOf(term) === -1) return;
      }
      matched.push({ item, cat, catIdx, itemIdx, key: normShortcut(item.shortcut) });
    });
    if (term && !matched.length) return null;   // tìm kiếm: ẩn cả danh mục không khớp

    const itemsWrap = h('div', { class: 'tln-items' + (isOpen ? ' open' : '') });
    matched.forEach((rec) => itemsWrap.appendChild(itemRow(rec)));

    if (isEditMode && !term) {
      itemsWrap.appendChild(h('button', {
        class: 'tln-add-row tln-add-item',
        text: '+ Thêm câu tắt cho danh mục này',
        onclick: (e) => { e.stopPropagation(); openItemForm({ mode: 'add', catIdx }); },
      }));
    }

    catEl.appendChild(itemsWrap);
    return catEl;
  }

  function render() {
    const oldBody = panel.querySelector('.tln-body');
    const scrollTop = oldBody ? oldBody.scrollTop : 0;
    const searchFocus = panel.querySelector('.tln-search') === shadow.activeElement;

    panel.innerHTML = '';

    // Header
    const header = h('div', { class: 'tln-header' });
    const title = h('div', { class: 'tln-title', text: 'Trả lời nhanh' });
    title.appendChild(h('small', { text: 'v' + APP_VERSION }));
    header.appendChild(title);

    const headerRight = h('div', { class: 'tln-header-right' });
    headerRight.appendChild(h('button', {
      class: 'tln-mode ' + (isEditMode ? 'edit' : 'work'),
      text: isEditMode ? '✏️ Chỉnh sửa' : '⚡ Làm việc',
      title: 'Chuyển chế độ Làm việc / Chỉnh sửa',
      onclick: () => { isEditMode = !isEditMode; render(); },
    }));
    headerRight.appendChild(h('button', {
      class: 'tln-x', text: '✕', title: 'Đóng (Alt+Shift+S để mở lại)',
      onclick: () => togglePanel(),
    }));
    header.appendChild(headerRight);
    panel.appendChild(header);

    // Ô tìm kiếm
    const searchWrap = h('div', { class: 'tln-search-wrap' });
    const searchInput = h('input', {
      class: 'tln-search', type: 'text', placeholder: 'Tìm câu tắt / nội dung…', value: searchTerm,
    });
    searchInput.addEventListener('input', () => {
      searchTerm = searchInput.value.trim();
      render();
    });
    searchWrap.appendChild(searchInput);
    panel.appendChild(searchWrap);

    // Body
    const body = h('div', { class: 'tln-body' });
    let rendered = 0;
    categories.forEach((cat, catIdx) => {
      const block = catBlock(cat, catIdx);
      if (block) { body.appendChild(block); rendered++; }
    });

    if (!rendered) {
      body.appendChild(h('div', {
        class: 'tln-empty',
        text: searchTerm
          ? 'Không có câu nào khớp “' + searchTerm + '”.'
          : 'Chưa có câu tắt nào. Bấm “✏️ Chỉnh sửa” để thêm danh mục & câu tắt.',
      }));
    }

    if (isEditMode) {
      body.appendChild(h('button', {
        class: 'tln-add-row', text: '+ Thêm danh mục mới',
        onclick: () => openCatForm({ mode: 'add' }),
      }));
    }
    panel.appendChild(body);

    // Footer
    const footer = h('div', { class: 'tln-footer' });
    footer.appendChild(h('span', { text: 'Gõ ' }));
    footer.appendChild(h('b', { text: '/câu_tắt' }));
    footer.appendChild(h('span', { text: ' trong ô soạn tin rồi Enter/Tab (hoặc cách ra) để chèn — Enter lần nữa để gửi.' }));
    footer.appendChild(h('br'));
    const autoWrap = h('label', { class: 'tln-auto' });
    const autoChk = h('input', { type: 'checkbox' });
    autoChk.checked = !!settings.autoExpand;
    autoChk.addEventListener('change', () => {
      settings.autoExpand = autoChk.checked;
      saveSettings();
      showToast(settings.autoExpand ? 'Đã bật chèn ngay khi cách ra' : 'Đã tắt chèn ngay khi cách ra');
    });
    autoWrap.appendChild(autoChk);
    autoWrap.appendChild(h('span', { text: 'Chèn ngay khi gõ xong câu tắt + dấu cách' }));
    footer.appendChild(autoWrap);
    panel.appendChild(footer);

    body.scrollTop = scrollTop;
    if (searchFocus) {
      searchInput.focus();
      try { searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length); } catch (e) { /* ignore */ }
    }
    if (isOpenPanel) updatePanelPosition();
  }

  /* ============================ FORM THÊM / SỬA ============================ */

  let modalEl = null;

  function hideModal() {
    if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    modalEl = null;
  }

  /**
   * fields: [{ key, label, value, placeholder, hint, multiline, required }]
   */
  function openForm(opts) {
    hideModal();
    const mask = h('div', { class: 'tln-modal-mask' });
    const modal = h('div', { class: 'tln-modal' });
    modal.appendChild(h('div', { class: 'tln-modal-head', text: opts.title }));

    const bodyEl = h('div', { class: 'tln-modal-body' });
    const inputs = {};
    const errMsg = h('div', { class: 'tln-err-msg' });

    opts.fields.forEach((f) => {
      const field = h('div', { class: 'tln-field' });
      field.appendChild(h('label', { text: f.label }));
      const common = {
        value: f.value == null ? '' : String(f.value),
        placeholder: f.placeholder || '',
      };
      const input = f.multiline
        ? h('textarea', common)
        : h('input', Object.assign({ type: 'text' }, common));
      inputs[f.key] = input;
      field.appendChild(input);
      if (f.hint) field.appendChild(h('span', { class: 'tln-hint', text: f.hint }));
      bodyEl.appendChild(field);
    });
    bodyEl.appendChild(errMsg);
    modal.appendChild(bodyEl);

    const foot = h('div', { class: 'tln-modal-foot' });
    const cancel = h('button', { class: 'tln-btn', text: 'Hủy' });
    const ok = h('button', { class: 'tln-btn primary', text: opts.okText || 'Lưu' });
    foot.appendChild(cancel);
    foot.appendChild(ok);
    modal.appendChild(foot);

    mask.appendChild(modal);
    panel.appendChild(mask);
    modalEl = mask;

    const close = () => hideModal();
    cancel.addEventListener('click', close);
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });

    const submit = () => {
      const values = {};
      Object.keys(inputs).forEach((k) => { values[k] = (inputs[k].value || '').trim(); });
      let failed = false;
      const result = opts.onSubmit(values, (msg, fieldKey) => {
        failed = true;
        errMsg.textContent = msg;
        errMsg.classList.add('show');
        if (fieldKey && inputs[fieldKey]) {
          inputs[fieldKey].parentNode.classList.add('err');
          inputs[fieldKey].focus();
        }
        return false;
      });
      if (failed || result === false) return; // dữ liệu chưa hợp lệ → giữ form mở
      close();
    };

    ok.addEventListener('click', submit);
    Object.keys(inputs).forEach((k) => {
      inputs[k].addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !inputs[k].tagName.match(/TEXTAREA/i)) { e.preventDefault(); submit(); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
        e.stopPropagation();
      });
      inputs[k].addEventListener('input', () => {
        inputs[k].parentNode.classList.remove('err');
        errMsg.classList.remove('show');
      });
    });

    setTimeout(() => {
      const first = inputs[opts.fields[0].key];
      if (first) { try { first.focus(); } catch (e) { /* ignore */ } }
    }, 30);
  }

  function shortcutTaken(key, ignore) {
    const rec = findExact(key);
    if (!rec) return false;
    if (!ignore) return true;
    return !(rec.catIdx === ignore.catIdx && rec.itemIdx === ignore.itemIdx);
  }

  function openItemForm(opts) {
    const isEdit = opts.mode === 'edit';
    const cat = categories[opts.catIdx];
    if (!cat) return;
    const item = isEdit ? cat.items[opts.itemIdx] : { shortcut: '', text: '' };
    if (!item) return;

    openForm({
      title: (isEdit ? 'Sửa câu tắt' : 'Thêm câu tắt') + ' — ' + (cat.title || 'Danh mục'),
      okText: isEdit ? 'Lưu thay đổi' : 'Thêm câu',
      fields: [
        {
          key: 'shortcut',
          label: 'CÂU TẮT (gõ trong ô soạn tin)',
          value: item.shortcut || '',
          placeholder: 'vd: cn',
          hint: 'Chỉ chữ/số/gạch, không dấu, không khoảng trắng. Trong ô soạn tin bạn gõ /cn rồi Enter.',
        },
        {
          key: 'text',
          label: 'NỘI DUNG CÂU TRẢ LỜI',
          value: item.text || '',
          placeholder: 'Nội dung đầy đủ sẽ được chèn vào ô soạn tin…',
          multiline: true,
        },
      ],
      onSubmit: (v, fail) => {
        const key = normShortcut(v.shortcut);
        if (!key) return fail('Chưa nhập câu tắt.', 'shortcut');
        if (/[^a-z0-9._-]/.test(key)) return fail('Câu tắt chỉ gồm chữ/số/._- (không dấu, không khoảng trắng).', 'shortcut');
        if (shortcutTaken(key, isEdit ? { catIdx: opts.catIdx, itemIdx: opts.itemIdx } : null)) {
          return fail('Câu tắt “/' + key + '” đã được dùng ở câu khác.', 'shortcut');
        }
        if (!v.text) return fail('Chưa nhập nội dung câu trả lời.', 'text');

        if (isEdit) {
          categories[opts.catIdx].items[opts.itemIdx] = { shortcut: key, text: v.text };
        } else {
          categories[opts.catIdx].items.push({ shortcut: key, text: v.text });
          openCats.add(categories[opts.catIdx].id);
        }
        saveData();
        render();
        showToast((isEdit ? 'Đã lưu câu /' : 'Đã thêm câu /') + key);
      },
    });
  }

  function openCatForm(opts) {
    const isEdit = opts.mode === 'edit';
    const cat = isEdit ? categories[opts.catIdx] : null;
    openForm({
      title: isEdit ? 'Đổi tên danh mục' : 'Thêm danh mục mới',
      okText: isEdit ? 'Lưu' : 'Tạo danh mục',
      fields: [{
        key: 'title',
        label: 'TÊN DANH MỤC',
        value: cat ? cat.title : '',
        placeholder: 'vd: Khách hỏi phí ship',
      }],
      onSubmit: (v, fail) => {
        if (!v.title) return fail('Chưa nhập tên danh mục.', 'title');
        if (isEdit) {
          categories[opts.catIdx].title = v.title;
        } else {
          const id = 'cat_' + Date.now();
          categories.push({ id, title: v.title, items: [] });
          openCats.add(id);
        }
        saveData();
        render();
        showToast(isEdit ? 'Đã đổi tên danh mục' : 'Đã thêm danh mục');
      },
    });
  }

  /* ============================ PHÍM TẮT TOÀN CỤC ============================ */

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'S' || e.key === 's' || e.code === 'KeyS')) {
      e.preventDefault();
      togglePanel();
      return;
    }
    if (e.key === 'Escape') {
      if (modalEl) { hideModal(); return; }
      hideSuggest();
    }
  }, true);

  /* ============================ KHỞI ĐỘNG ============================ */

  // Mở sẵn danh mục đầu tiên cho dễ nhìn
  if (categories.length) openCats.add(categories[0].id);

  console.log('[TRALOINHANH] v' + APP_VERSION + ' đã chạy — gõ /câu_tắt trong ô soạn tin rồi Enter.');
})();
