// ==UserScript==
// @name         Hỗ trợ trả lời Sale (Draggable Bubble - v5.5)
// @namespace    http://tampermonkey.net/
// @version      6.4.0
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
// @grant        GM_deleteValue
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
 *   (Nay mỗi câu có CÂU TẮT — gõ ngay trong ô soạn tin Pancake là câu tự nhảy vào.)
 * - THÊM câu tắt (shortcut) dạng  //cn  (HAI gạch chéo) — gõ ngay trong ô soạn tin Pancake:
 *     gõ "//cn" → hiện danh sách gợi ý ngay trên ô nhập → Enter/Tab (hoặc bấm gợi ý)
 *     → câu trả lời được CHÈN vào đúng vị trí con trỏ, giữ nguyên chữ đang gõ dở;
 *     bấm Enter lần nữa là gửi (script không tự gửi, không tự Enter).
 * - v6.4.0: Câu nhiều tin KHÔNG cần Enter từng tin nữa: bạn Enter MỘT LẦN (gửi tin 1) là script
 *   tự điền + tự gửi tiếp các tin còn lại, cách nhau "Giãn cách" (mặc định 1200ms, chỉnh trong
 *   panel). Cách gửi: bấm đúng nút Gửi của Pancake trong khung soạn tin (tìm theo title/class
 *   chứa "gửi"/"send"), không thấy thì phát phím Enter tổng hợp; nếu vẫn không ăn thì dừng an toàn
 *   và để các tin còn lại cho bạn Enter tay. Nút ✕ cạnh ô soạn tin = DỪNG ngay.
 *   Muốn kiểu cũ (Enter từng tin) → panel: "Câu nhiều tin: Thủ công".
 * - v6.3.0: BỎ thông báo toast khi chọn/chèn câu (chỉ còn cảnh báo lỗi), và mỗi câu tắt có thể
 *   gồm NHIỀU TIN: các tin cách nhau bằng 1 DÒNG TRỐNG trong ô nội dung. Khi dùng, tin 1 được
 *   điền ngay; bạn Enter (hoặc bấm nút Gửi) → app gửi tin 1, ô trống → script tự điền tin 2,
 *   chờ bạn Enter tiếp… Nhãn "Tin 1/3" hiện cạnh ô soạn tin (✕ để bỏ các tin còn lại).
 * - v6.2.0: CHỈ kích hoạt khi câu tắt bắt đầu bằng "//" (một gạch "/" vẫn là bảng câu nhanh
 *   gốc của Pancake), và DANH SÁCH VỀ TRẮNG — bỏ hết câu mẫu/câu đã lưu của bản cũ để
 *   người dùng tự thêm câu của mình (dữ liệu cũ được in ra console để sao lưu nếu cần).
 * - Panel: danh mục + câu tắt, có ô tìm kiếm, hiện chip "//câu_tắt" để biết gõ gì.
 * - Chế độ Chỉnh sửa: thêm/sửa/xóa danh mục & câu tắt bằng form trong panel (không dùng prompt),
 *   kéo thả ⠿ để sắp xếp, chặn trùng câu tắt.
 * - Tự động di trú dữ liệu cũ (localStorage/GM 'sqr_data_v5') sang dữ liệu mới.
 */

(function () {
  'use strict';

  if (window.top !== window.self) return; // chỉ chạy ở trang chính

  /* ============================ HẰNG SỐ ============================ */

  const APP_VERSION = '6.4.0';
  const KEY_DATA = 'tln_data_v2';          // v6.2.0: dữ liệu trắng (người dùng tự thêm), kích hoạt bằng "//"
  const KEY_DATA_OLD = 'tln_data_v1';      // dữ liệu của v6.0/6.1 (bị bỏ khi nâng cấp)
  const CLEAR_FLAG = 'tln_cleared_v2';     // đánh dấu đã dọn dữ liệu mẫu một lần
  const KEY_POS = 'tln_pos_v1';
  const KEY_LEGACY = 'sqr_data_v5';      // dữ liệu của bản v5.5 (để di trú)
  const KEY_LEGACY_POS = 'sqr_btn_pos';
  const KEY_SETTINGS = 'tln_settings_v1';
  const KEY_SUGGEST_POS = 'tln_suggest_pos_v1';
  const KEY_NATIVE_HIDE = 'tln_native_popup_hide_v1';

  const PANCAKE_COMPOSER_ID = 'replyBoxComposer'; // html2.txt / html3.txt / _app forcusReplyCompose()
  const MAX_SUGGEST = 8;
  const SHORTCUT_MAX = 32;

  /* ============================ DỮ LIỆU MẶC ĐỊNH ============================ */

  // v6.2.0: KHÔNG còn câu mẫu — danh sách trắng, người dùng tự thêm câu tắt của mình.
  const DEFAULT_DATA = [];

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
        else if (k === 'value') {
          // textarea: setAttribute('value') KHÔNG có tác dụng → phải gán .value
          if (tagOf(el) === 'textarea') el.value = v;
          else el.setAttribute('value', v);
        }
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
      if (typeof GM_getValue === 'function') {
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

  /**
   * Tách nội dung 1 câu tắt thành NHIỀU TIN (v6.3.0).
   * Mỗi dòng trống (1 hoặc nhiều dòng trống) = ranh giới giữa 2 tin; xuống dòng đơn trong
   * cùng một tin được giữ nguyên (Pancake vẫn gửi được tin nhiều dòng).
   *   "Dạ em chào ạ\n\nDạ bên em freeship…"  →  ["Dạ em chào ạ", "Dạ bên em freeship…"]
   */
  function splitMessages(text) {
    return String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .split(/\n[ \t]*\n+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
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
          .map((it) => {
            const raw = String(it.text).replace(/\r\n?/g, '\n').trim();
            const parts = splitMessages(raw);
            // 1 tin → giữ nguyên cả đoạn (kể cả xuống dòng đơn); nhiều tin → mỗi tin 1 phần
            return {
              shortcut: uniqueShortcut(it.shortcut, it._seed),
              text: parts.length === 1 ? raw : parts.join('\n\n'),
              parts,
            };
          }),
      }));
  }

  function removeSavedKey(key) {
    try { if (typeof GM_deleteValue === 'function') GM_deleteValue(key); } catch (e) { /* ignore */ }
    try { if (typeof GM_setValue === 'function') GM_setValue(key, null); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function loadData() {
    // v6.2.0: dọn MỘT LẦN dữ liệu của bản cũ (câu mẫu + câu đã lưu ở v6.0/6.1 + dữ liệu v5.5)
    // để danh sách về trắng hoàn toàn. Người dùng có thể khôi phục bằng cách chép lại
    // JSON đã sao lưu trong console (xem log khi chạy).
    const cleared = gmGet(CLEAR_FLAG, false) === true;
    const oldData = gmGet(KEY_DATA_OLD, null);

    if (!cleared) {
      if (Array.isArray(oldData) && oldData.length) {
        console.log('[TRALOINHANH] Sao lưu dữ liệu cũ của bạn trước khi dọn (chép lại nếu cần):',
          JSON.stringify(oldData));
      }
      removeSavedKey(KEY_DATA_OLD);
      removeSavedKey(KEY_LEGACY);
      gmSet(KEY_DATA, []);
      gmSet(CLEAR_FLAG, true);
      return [];
    }

    // Người dùng đã chủ động dọn → nếu file cũ còn sót thì chỉ đọc dữ liệu mới, không hồi sinh câu cũ
    const saved = gmGet(KEY_DATA, null);
    if (Array.isArray(saved) && saved.length) {
      const data = normalizeData(saved);
      if (data.length) return data;
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
    .tln-item-parts { font-size: 10px; color: #7c3aed; font-weight: 700; margin-top: 2px; }
    .tln-sg-parts { flex-shrink: 0; font-size: 10px; font-weight: 700; color: #7c3aed; background: #ede9fe; border: 1px solid #ddd6fe; border-radius: 5px; padding: 1px 4px; margin-top: 1px; }
    /* Khi đang có câu chờ gửi tiếp: ô soạn tin sáng nhẹ + nhãn đếm tin */
    .tln-waiting { box-shadow: 0 0 0 2px #8b5cf6 inset !important; }
    #tln-waiting {
      position: fixed; display: none; align-items: center; gap: 6px;
      background: #7c3aed; color: #fff; font-size: 10.5px; font-weight: 700;
      padding: 3px 8px; border-radius: 12px; box-shadow: 0 3px 10px rgba(0,0,0,.2);
      pointer-events: auto; z-index: 2147483647; white-space: nowrap; user-select: none;
    }
    #tln-waiting.show { display: flex; }
    #tln-waiting button {
      width: 15px; height: 15px; border-radius: 50%; border: none; cursor: pointer;
      background: rgba(255,255,255,.25); color: #fff; font-size: 10px; line-height: 1;
      display: flex; align-items: center; justify-content: center; padding: 0;
    }
    #tln-waiting button:hover { background: rgba(255,255,255,.45); }
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
    .tln-num {
      width: 58px; font-size: 10.5px; color: #334155; border: 1px solid #cbd5e1; border-radius: 5px;
      padding: 1px 4px; background: #fff; outline: none;
    }
    .tln-select {
      font-size: 10.5px; color: #334155; border: 1px solid #cbd5e1; border-radius: 5px;
      padding: 1px 4px; background: #fff; cursor: pointer; outline: none; max-width: 148px;
    }

    /* --- Gợi ý câu tắt nổi trên ô soạn tin --- */
    #tln-suggest {
      position: fixed; width: 330px; max-width: calc(100vw - 20px);
      background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
      box-shadow: 0 10px 28px rgba(0,0,0,.22); overflow: hidden; display: none;
      pointer-events: auto; z-index: 2147483647;
    }
    #tln-suggest.show { display: block; }
    .tln-sg-head {
      padding: 6px 8px 6px 10px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0;
      font-size: 10.5px; font-weight: 700; color: #475569; display: flex;
      justify-content: space-between; align-items: center; gap: 8px;
      cursor: grab; user-select: none; touch-action: none;
    }
    .tln-sg-head:active { cursor: grabbing; }
    .tln-sg-head-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; color: #94a3b8; }
    .tln-sg-reset {
      width: 18px; height: 18px; border-radius: 4px; border: 1px solid #cbd5e1; background: #fff;
      color: #475569; font-size: 11px; line-height: 1; cursor: pointer; padding: 0;
    }
    .tln-sg-reset:hover { background: #e2e8f0; color: #1d4ed8; }
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
    const s = gmGet(KEY_SETTINGS, null) || {};
    return {
      // mặc định: gõ đúng câu tắt + dấu cách là chèn luôn
      autoExpand: s.autoExpand !== false,
      // nơi đặt bảng gợi ý: 'above' (trên ô soạn tin) | 'below' | 'free' (kéo tay)
      place: ['above', 'below', 'free'].indexOf(s.place) > -1 ? s.place : 'above',
      // ẩn bảng câu nhanh "/" gốc của Pancake khi bảng của script đang mở (đỡ bị che)
      hideNative: s.hideNative !== false,
      // v6.4.0: 'auto' = Enter 1 lần rồi script tự đẩy hết các tin còn lại
      //          'manual' = mỗi tin bạn Enter một lần (kiểu cũ)
      chain: s.chain === 'manual' ? 'manual' : 'auto',
      // giãn cách giữa 2 tin khi tự đẩy (ms) — tránh bị Facebook chặn spam
      gapMs: Math.max(300, Math.min(10000, Number(s.gapMs) || 1200)),
    };
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

  // Vị trí bảng gợi ý: tự động (trên/dưới ô soạn tin) hoặc do người dùng kéo (lưu lại)
  const suggestPos = { custom: gmGet(KEY_SUGGEST_POS, null) };

  /* ============================ TOAST ============================ */

  let toastTimer = null;
  /** variant: 'error' | 'info' — dùng cho thông báo cần thiết (vd đang chờ gửi tiếp) */
  function showToast(msg, variant) {
    toast.textContent = msg;
    toast.classList.toggle('err', variant === 'error');
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

  /* ============================ NHÃN "CÒN N TIN CHỜ GỬI" ============================ */

  const waitBadge = h('div', { id: 'tln-waiting' });
  const waitText = h('span', { text: '' });
  const waitCancel = h('button', { text: '✕', title: 'Dừng tự gửi / bỏ các tin còn lại' });
  waitBadge.appendChild(h('span', { text: '⏳' }));
  waitBadge.appendChild(waitText);
  waitBadge.appendChild(waitCancel);
  shadow.appendChild(waitBadge);
  waitBadge.addEventListener('mousedown', (e) => e.stopPropagation());
  waitCancel.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (pendingSend && pendingSend.running) {
      pendingSend.stop = true;              // vòng lặp sẽ dừng ngay nhịp kế tiếp
      waitText.textContent = 'Đang dừng…';
    } else {
      clearPending();
    }
  });

  function flushWaitBadge() {
    if (!pendingSend) {
      waitBadge.classList.remove('show');
      waitText.textContent = '';
      highlightWaitingInput(false);
      return;
    }
    const total = partsTotal();
    const cur = Math.min(pendingSend.index, total);
    let label;
    if (settings.chain === 'manual') {
      label = 'Tin ' + cur + '/' + total + ' — Enter để gửi tin này';
    } else if (!pendingSend.running) {
      label = total + ' tin — Enter (gửi tin 1) là script tự gửi tiếp cả ' + total + ' tin';
    } else {
      label = 'Đang tự gửi ' + Math.min(cur, total) + '/' + total + ' tin…';
    }
    waitText.textContent = label;
    waitBadge.classList.add('show');
    positionWaitBadge();
    highlightWaitingInput(true);
  }

  function positionWaitBadge() {
    const el = pendingSend && pendingSend.el;
    if (!el || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    const w = waitBadge.offsetWidth || 200;
    const h2 = waitBadge.offsetHeight || 20;
    waitBadge.style.left = clamp(r.right - w, 6, Math.max(6, window.innerWidth - w - 6)) + 'px';
    waitBadge.style.top = clamp(r.top - h2 - 4, 6, Math.max(6, window.innerHeight - h2 - 6)) + 'px';
  }

  function highlightWaitingInput(on) {
    const el = pendingSend && pendingSend.el;
    if (!el) return;
    try { el.classList.toggle('tln-waiting', !!on); } catch (e) { /* ignore */ }
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

  /* ============================ ĐỌC TOKEN "//xx" TẠI CON TRỎ ============================ */

  // v6.2.0: CHỈ kích hoạt khi câu tắt bắt đầu bằng HAI gạch chéo "//".
  //  - "//"        → mở bảng chọn (gợi ý toàn bộ câu tắt)
  //  - "//cn"      → lọc theo "cn"
  //  - "/cn"       → KHÔNG làm gì (để dành cho bảng câu nhanh "/" gốc của Pancake)
  // "//" phải đứng đầu ô hoặc sau khoảng trắng/ký tự mở; "abc//cn", "https://x//y" → không kích hoạt.
  // Token = "//" + chữ (không dấu, không khoảng trắng, tối đa 32 ký tự).
  const TOKEN_RE = /(?:^|[\s([{"'“”‘’<>⟦])\/\/([^\s/]{0,32})$/;

  function parseToken(before, caretPos) {
    const m = before.match(TOKEN_RE);
    if (!m) return null;
    const token = m[1] || '';
    const start = caretPos - token.length - 2; // 2 = "//"
    if (start < 0) return null;
    // "//" phải đứng đầu ô hoặc sau khoảng trắng/ký tự mở ("abc//cn", "///cn" → không kích hoạt)
    if (start > 0 && !/[\s([{"'“”‘’<>⟦]/.test(before.charAt(start - 1))) return null;
    return { token, start, end: caretPos };
  }

  /** Trả về { kind, el, token, start, end } của câu tắt "//xx" đang gõ ở con trỏ, hoặc null. */
  function tokenAt(el) {
    if (!isEditableEl(el)) return null;
    const caret = readCaret(el);
    if (!caret) return null;

    if (caret.kind === 'value') {
      if (caret.start !== caret.end) return null; // đang bôi đen → không gợi ý
      const info = parseToken(caret.text.slice(0, caret.start), caret.start);
      if (!info) return null;
      return { kind: 'value', el, token: info.token, start: info.start, end: info.end, caret: caret.start };
    }

    // contenteditable
    const offs = editableCaretOffsets(el);
    if (!offs || offs.start !== offs.end) return null;
    const info = parseToken(caret.text.slice(0, offs.start), offs.start);
    if (!info) return null;
    return { kind: 'editable', el, token: info.token, start: info.start, end: info.end, caret: offs.start };
  }

  /* ============================ NHIỀU TIN CHO 1 CÂU TẮT (tự gửi liên tiếp) ============================ */

  // Một câu tắt có thể gồm 2–5 tin. Mặc định (v6.4.0): bạn chèn câu, bấm Enter MỘT LẦN để gửi
  // tin đầu — script tự điền + tự gửi tiếp các tin còn lại, cách nhau `settings.gapMs`.
  //  • Cách gửi từng tin: bấm đúng nút Gửi của Pancake trong khung soạn tin (tìm theo title/
  //    class chứa "gửi"/"send"); không thấy nút thì phát phím Enter tổng hợp lên ô soạn tin.
  //  • Không nhảy tin khi tin trước CHƯA đi khỏi ô soạn tin (tránh gửi sót/chèn đè).
  //  • Nếu nút Gửi không tìm thấy và Enter không ăn sau 2 lần thử → dừng, để bạn Enter tay.
  //  • Chế độ "Thủ công" (settings.chain='manual') = kiểu cũ: mỗi tin bạn Enter một lần.
  let pendingSend = null; // { parts, index, el, running, stop, waitSince, tries, deadline, sentCount }
  let pendingTimer = null;

  const PENDING_POLL_MS = 120;
  const PENDING_GAP_MAX_MS = 15000;
  const ENTER_RETRY_GAP_MS = 1800;

  function composerText(el) {
    if (!el || !el.isConnected) return '';
    const tag = tagOf(el);
    if (tag === 'input' || tag === 'textarea') return String(el.value || '');
    const plain = (el.innerText != null ? el.innerText : el.textContent) || '';
    return plain.replace(/\u200b/g, '');
  }

  function composerIsEmpty(el) {
    if (!el || !el.isConnected) return false;
    if (composerText(el).trim() !== '') return false;
    if (tagOf(el) !== 'input' && tagOf(el) !== 'textarea') {
      if (/<img|data:image/i.test(el.innerHTML || '')) return false;
    }
    return true;
  }

  /** Ứng viên nút GỬI của Pancake trong khung soạn tin (repo không có class/id của nút này). */
  function findSendCandidates(el) {
    const out = [];
    if (!el || !el.isConnected) return out;
    let scope = null;
    try { scope = el.closest('.reply-box-container'); } catch (e) { scope = null; }
    if (!scope) {
      scope = el.parentElement;
      for (let i = 0; i < 6 && scope && scope.parentElement; i++) scope = scope.parentElement;
    }
    if (!scope) return out;

    const nodes = scope.querySelectorAll('button, [role="button"], span, div, i, a, svg');
    const bad = /(photo|image|file|attach|emoji|sticker|product|order|invoice|upload|gift|quick|note|tag|trash|delete|clear|deselect|record|voice|call|video|badge)/i;
    let best = null;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const cls = String(node.className && node.className.baseVal != null ? node.className.baseVal : node.className || '');
      const id = String(node.id || '');
      const title = String((node.getAttribute && (node.getAttribute('title') || node.getAttribute('aria-label') || node.getAttribute('data-tip') || node.getAttribute('data-original-title'))) || '');
      const hay = cls + ' ' + id + ' ' + title;
      if (bad.test(hay)) continue;
      if (/\bsend\b|send-|send_|icon-send|\bgui\b|gửi|paper-?plane/i.test(hay)) best = node;
    }
    if (!best) return out;

    // chính phần tử đó trước, rồi lần lượt tổ tiên (một số app gắn handler ở khung cha)
    out.push(best);
    let cur = best;
    for (let i = 0; i < 4 && cur.parentElement && cur.parentElement !== scope; i++) {
      cur = cur.parentElement;
      out.push(cur);
    }
    return out;
  }

  function fireEnter(el) {
    try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    const mk = (type) => new KeyboardEvent(type, {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    });
    el.dispatchEvent(mk('keydown'));
    el.dispatchEvent(mk('keypress'));
    el.dispatchEvent(mk('keyup'));
  }

  /** Gửi tin ĐANG nằm trong ô soạn tin (bấm nút Gửi, hoặc phát phím Enter). */
  function triggerSend(el) {
    const cands = findSendCandidates(el);
    const idx = (pendingSend && pendingSend.sendTry) || 0;
    if (cands.length && idx < cands.length) {
      const btn = cands[idx];
      try {
        const r = btn.getBoundingClientRect();
        const opts = {
          bubbles: true, cancelable: true, view: window,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        };
        btn.dispatchEvent(new MouseEvent('mousedown', opts));
        btn.dispatchEvent(new MouseEvent('mouseup', opts));
        btn.dispatchEvent(new MouseEvent('click', opts));
        return 'button';
      } catch (e) { /* thử Enter */ }
    }
    fireEnter(el);
    return 'enter';
  }

  function partsTotal() {
    return pendingSend ? pendingSend.parts.length : 0;
  }

  /** Điền tin kế tiếp vào ô soạn tin (không gửi). */
  function fillNextPart() {
    if (!pendingSend) return false;
    const el = pendingSend.el;
    const next = pendingSend.parts[pendingSend.index];
    if (next == null) return false;
    pendingSend.index += 1;
    pendingSend.waitSince = 0;
    pendingSend.tries = 0;
    pendingSend.sendTry = 0;
    pendingSend.filledAt = Date.now();
    replaceRangeIn(el, 0, 0, next);
    try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    try {
      const tag = tagOf(el);
      if (tag === 'input' || tag === 'textarea') {
        const endCaret = String(el.value || '').length;
        el.setSelectionRange(endCaret, endCaret);
      }
    } catch (e) { /* ignore */ }
    return true;
  }

  /**
   * Vòng điều khiển chuỗi nhiều tin (chỉ chạy sau khi người dùng Enter/Gửi tin đầu):
   *  • tự động:  tin trước đi khỏi ô soạn tin → chờ đủ "Giãn cách" → điền tin kế tiếp → TỰ GỬI
   *  • thủ công: điền tin kế tiếp rồi chờ người dùng Enter
   */
  function ensurePendingLoop() {
    if (pendingTimer || !pendingSend) return;
    const tick = () => {
      pendingTimer = null;
      if (!pendingSend || !pendingSend.running) return;
      const el = pendingSend.el;
      if (!el || !el.isConnected) { clearPending(); return; }
      if (pendingSend.stop) { finishPending('Đã dừng gửi các tin còn lại.'); return; }

      const manual = settings.chain === 'manual';
      const empty = composerIsEmpty(el);

      if (empty) {
        // tin trước đã gửi xong
        pendingSend.waitSince = 0;
        pendingSend.tries = 0;
        pendingSend.sendTry = 0;

        if (pendingSend.index < pendingSend.parts.length) {
          fillNextPart();
          if (manual) {
            pendingSend.waitSince = Date.now();   // chờ người dùng Enter
          } else {
            pendingSend.pendingAuto = true;       // sẽ tự gửi sau "Giãn cách"
            pendingSend.autoAt = Date.now() + settings.gapMs;
          }
          flushWaitBadge();
        } else {
          finishPending(null);                    // hết tin
          return;
        }
      } else if (!manual) {
        if (pendingSend.pendingAuto) {
          if (Date.now() >= pendingSend.autoAt) {
            pendingSend.pendingAuto = false;
            triggerSend(el);                      // bấm nút Gửi (hoặc phím Enter)
            pendingSend.waitSince = Date.now();
            pendingSend.deadline = Date.now() + PENDING_GAP_MAX_MS;
          }
        } else {
          // đã ra lệnh gửi mà ô vẫn còn chữ → thử lại (đổi ứng viên nút Gửi)
          if (!pendingSend.waitSince) pendingSend.waitSince = Date.now();
          const waited = Date.now() - pendingSend.waitSince;
          if (waited > ENTER_RETRY_GAP_MS) {
            if (pendingSend.tries < 3) {
              pendingSend.tries += 1;
              pendingSend.sendTry = (pendingSend.sendTry || 0) + 1;
              pendingSend.waitSince = Date.now();
              triggerSend(el);
            } else {
              finishPending('Không bấm được nút Gửi — tin kế tiếp đã điền sẵn, bạn bấm Enter/Gửi để tiếp tục.');
              return;
            }
          } else if (Date.now() > (pendingSend.deadline || 0)) {
            finishPending('Đã dừng (chờ quá lâu).');
            return;
          }
        }
      }
      // chế độ thủ công: ô đang có chữ → chờ người dùng Enter, không timeout

      if (pendingSend) pendingTimer = setTimeout(tick, PENDING_POLL_MS);
    };
    pendingTimer = setTimeout(tick, PENDING_POLL_MS);
  }

  /** Kết thúc chuỗi (gửi hết / dừng / lỗi). */
  function finishPending(msg) {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    highlightWaitingInput(false);
    pendingSend = null;
    flushWaitBadge();
    if (msg) showToast(msg, 'info');
  }

  function clearPending() {
    finishPending(null);
  }

  /**
   * Chèn tin đầu tiên của câu tắt; nếu có nhiều tin thì đặt chờ + tự gửi tiếp (chế độ auto).
   * Không hiện toast khi chọn câu (theo yêu cầu).
   */
  function applyShortcut(item, targetEl, range) {
    const parts = (Array.isArray(item.parts) && item.parts.length)
      ? item.parts.slice()
      : splitMessages(item.text || '');
    if (!parts.length) return false;

    const el = targetEl && targetEl.isConnected ? targetEl : pickTargetInput();
    if (!el) {
      copyText(parts[0]);
      return false;
    }

    let start = range ? range.start : null;
    let end = range ? range.end : null;

    // Không có token: nếu ô đang chỉ chứa đúng "//xx" (vừa gõ dở) thì thay cả nội dung
    if (start == null) {
      const cur = composerText(el);
      if (/^\s*\/\/[^\s/]*\s*$/.test(cur)) { start = 0; end = cur.length; }
    }

    let ok;
    if (start != null && (tagOf(el) === 'input' || tagOf(el) === 'textarea' || range)) {
      ok = replaceRangeIn(el, start, end, parts[0]) >= 0;
    } else {
      ok = insertAtCaret(el, parts[0]);
    }
    if (!ok) return false;

    try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }

    if (parts.length > 1) {
      pendingSend = {
        parts,
        index: 1,
        el,
        running: false,      // bật khi bạn Enter lần đầu (gửi tin 1)
        stop: false,
        waitSince: 0,
        tries: 0,
        deadline: 0,
      };
      flushWaitBadge();
    } else {
      clearPending();
    }
    return true;
  }

  /* ============================ BẢNG GỢI Ý ============================ */

  /** Kéo bảng gợi ý ra chỗ khác (lưu lại) — bấm đúp vào tiêu đề để về vị trí tự động. */
  function clearSuggestCustomPos() {
    suggest.style.transform = '';
    suggest.style.removeProperty('--tln-dx');
    suggestPos.custom = null;
    gmSet(KEY_SUGGEST_POS, null);
  }

  /**
   * Ẩn/hiện bảng câu nhanh "/" GỐC của Pancake (bảng có dòng "Nhấn Enter hoặc Click chuột…").
   * Script không biết chắc class của bảng đó (html*.txt chưa bắt được trạng thái mở) nên dùng
   * :has() theo đúng CÂU CHỮ của bảng — an toàn, không đụng thành phần khác; nếu trình duyệt
   * không hỗ trợ :has() thì bỏ qua, chỉ còn tính năng kéo bảng của script.
   */
  function buildNativeHideCss(show) {
    const who = ':is(.suggestion-wrap, .suggestion-container, .quick-reply-list, '
      + '.quick-reply-container, .quick-reply-popover, .qr-list, .composer-popover)';
    const text = ':is(:has(.suggestion-element), :has(.shortcut-tag), :has(#qr_autocomplete), '
      + ':has([class*="suggestion"]))';
    if (!show) return ''; // chỉ cần ẩn khi bảng CỦA SCRIPT mở (bảng gốc vẫn dùng bình thường khi gõ "/")
    return '/* ẩn bảng câu nhanh gốc của Pancake khi bảng gợi ý của script đang mở */\n'
      + who + text + ', .suggestion-element, .suggestion-wrap, .suggestion-container {'
      + ' display: none !important; visibility: hidden !important; }';
  }

  function hideNativePopup(on) {
    let el = document.getElementById('tln-native-hide');
    if (!on) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = 'tln-native-hide';
      document.head.appendChild(el);
    }
    el.textContent = buildNativeHideCss(true);
  }

  function hideSuggest() {
    picker.open = false;
    picker.index = -1;
    picker.token = null;
    picker.list = [];
    suggest.classList.remove('show');
    if (settings.hideNative) hideNativePopup(false);
  }

  function renderSuggest() {
    suggest.innerHTML = '';
    if (!picker.open || !picker.list.length) {
      suggest.classList.remove('show');
      return;
    }
    const head = h('div', { class: 'tln-sg-head', title: 'Kéo để dời bảng · bấm đúp để về vị trí tự động' });
    head.appendChild(h('span', {
      text: picker.token ? '⠿ Câu tắt khớp “//' + picker.token + '”' : '⠿ Câu tắt (gõ // rồi chữ tắt)',
    }));
    const headRight = h('span', { class: 'tln-sg-head-right' });
    headRight.appendChild(h('span', { text: picker.list.length }));
    const resetBtn = h('button', {
      class: 'tln-sg-reset',
      text: '⤢',
      title: 'Về vị trí tự động (trên/dưới ô soạn tin)',
      onmousedown: (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearSuggestCustomPos();
        positionSuggest();
        showToast('Bảng gợi ý về vị trí tự động');
      },
    });
    headRight.appendChild(resetBtn);
    head.appendChild(headRight);
    suggest.appendChild(head);
    makeSuggestDraggable(head);

    const list = h('div', { class: 'tln-sg-list' });
    picker.list.forEach((rec, i) => {
      const row = h('div', {
        class: 'tln-sg' + (i === picker.index ? ' active' : ''),
        onmousedown: (e) => { e.preventDefault(); e.stopPropagation(); chooseSuggest(i); },
      });
      row.appendChild(h('span', { class: 'tln-chip', text: '//' + rec.key, title: 'Gõ //' + rec.key }));

      row.appendChild(h('span', { class: 'tln-sg-text', text: rec.item.text }));
      const nParts = (rec.item.parts || []).length;
      if (nParts > 1) {
        row.appendChild(h('span', {
          class: 'tln-sg-parts', text: nParts + ' tin',
          title: 'Enter gửi tin 1, script tự điền tin 2…',
        }));
      }
      list.appendChild(row);
    });
    suggest.appendChild(list);
    suggest.appendChild(h('div', {
      class: 'tln-sg-hint',
      text: 'Enter / Tab (hoặc cách ra) để chèn  ·  ↑↓ chọn  ·  Esc đóng',
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
    const w = suggest.offsetWidth || 330;
    const hgt = suggest.offsetHeight || 200;
    const maxLeft = Math.max(6, window.innerWidth - w - 6);
    const maxTop = Math.max(6, window.innerHeight - hgt - 6);

    // Người dùng đã kéo bảng đi chỗ khác → giữ nguyên chỗ đó
    if (settings.place === 'free' && suggestPos.custom) {
      suggest.style.left = clamp(suggestPos.custom.left, 6, maxLeft) + 'px';
      suggest.style.top = clamp(suggestPos.custom.top, 6, maxTop) + 'px';
      return;
    }

    const r = info.el.getBoundingClientRect();
    const left = clamp(r.left, 6, maxLeft);
    let top = (settings.place === 'below') ? r.bottom + 6 : r.top - hgt - 6;
    if (top < 6 || top + hgt > window.innerHeight - 6) {
      // không đủ chỗ phía trên → xuống dưới, và ngược lại
      const below = r.bottom + 6;
      const above = r.top - hgt - 6;
      top = (settings.place === 'below')
        ? (below + hgt <= window.innerHeight - 6 ? below : above)
        : (above >= 6 ? above : below);
    }
    suggest.style.left = left + 'px';
    suggest.style.top = clamp(top, 6, maxTop) + 'px';
  }

  /** Kéo bảng gợi ý bằng tiêu đề (chuột hoặc cảm ứng). */
  function makeSuggestDraggable(handle) {
    let dragging2 = false;
    let sx = 0, sy = 0, bl = 0, bt = 0, moved2 = false;

    const start = (e) => {
      if (e.button != null && e.button !== 0) return;
      const p = point(e);
      const rect = suggest.getBoundingClientRect();
      dragging2 = true;
      moved2 = false;
      sx = p.x; sy = p.y; bl = rect.left; bt = rect.top;
    };

    const move = (e) => {
      if (!dragging2) return;
      const p = point(e);
      const dx = p.x - sx;
      const dy = p.y - sy;
      if (!moved2 && Math.hypot(dx, dy) < 4) return;
      moved2 = true;
      settings.place = 'free';
      suggestPos.custom = {
        left: clamp(bl + dx, 6, Math.max(6, window.innerWidth - suggest.offsetWidth - 6)),
        top: clamp(bt + dy, 6, Math.max(6, window.innerHeight - suggest.offsetHeight - 6)),
      };
      suggest.style.left = suggestPos.custom.left + 'px';
      suggest.style.top = suggestPos.custom.top + 'px';
      if (e.cancelable && e.type === 'touchmove') e.preventDefault();
    };

    const end = () => {
      if (!dragging2) return;
      dragging2 = false;
      if (moved2) {
        gmSet(KEY_SUGGEST_POS, suggestPos.custom);
        saveSettings();
        if (isOpenPanel) render(); // cập nhật ô chọn vị trí trong panel
        showToast('Đã ghim vị trí bảng gợi ý (⤢ để về tự động)');
      }
    };

    handle.addEventListener('mousedown', start);
    handle.addEventListener('touchstart', start, { passive: true });
    handle.addEventListener('dblclick', () => {
      clearSuggestCustomPos();
      positionSuggest();
    });
    document.addEventListener('mousemove', move, true);
    document.addEventListener('touchmove', move, { passive: false, capture: true });
    document.addEventListener('mouseup', end, true);
    document.addEventListener('touchend', end, true);
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
    // không có chữ tắt (mới gõ "//") → chọn sẵn dòng đầu để Enter/Tab chèn luôn
    picker.index = info.token ? (exactIdx >= 0 ? exactIdx : 0) : 0;

    if (settings.hideNative) hideNativePopup(true);
    renderSuggest();
  }

  function chooseSuggest(i) {
    const rec = picker.list[i];
    const info = picker.info;
    if (!rec || !info) return;
    expandShortcut(info, rec);
  }

  /** Chèn nội dung câu vào đúng chỗ đang gõ token (thay luôn token "//xx"). */
  function expandShortcut(info, rec, suffix) {
    const el = info.el;
    if (!el || !el.isConnected) { hideSuggest(); return; }
    hideSuggest();
    const ok = applyShortcut(rec.item, el, { start: info.start, end: info.end });
    if (!ok) {
      showToast('Không chèn được vào ô nhập', 'error');
      return;
    }
    // Gõ "//cn " (auto-expand) → giữ lại khoảng trắng sau tin — chỉ khi câu chỉ có 1 tin
    const isMulti = (rec.item.parts || []).length > 1;
    if (suffix && !isMulti) {
      try {
        const tag = tagOf(el);
        if (tag === 'input' || tag === 'textarea') {
          const pos = el.selectionStart;
          const v = el.value || '';
          el.value = v.slice(0, pos) + suffix + v.slice(pos);
          el.setSelectionRange(pos + 1, pos + 1);
        }
      } catch (e) { /* ignore */ }
    }
    try {
      const tag = tagOf(el);
      if (tag === 'input' || tag === 'textarea') el.setSelectionRange(el.selectionStart, el.selectionStart);
    } catch (e) { /* ignore */ }
    // KHÔNG hiện toast khi chọn câu (theo yêu cầu)
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
      // Gõ đúng câu tắt rồi cách ra ("//cn ") → chèn luôn, dấu cách vừa gõ thành khoảng trắng sau câu
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

    // Enter khi ĐANG MỞ gợi ý nhưng chưa chọn dòng nào (mới gõ "//") → không chen ngang
    if (picker.open && picker.index >= 0 && picker.list.length) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      chooseSuggest(picker.index);
      return;
    }

    // Enter = GỬI TIN ĐẦU. Nếu câu tắt còn tin sau:
    //  • chế độ tự động → app gửi tin 1 xong là script tự điền + tự gửi tiếp (không cần Enter nữa)
    //  • chế độ thủ công → chỉ điền tin kế tiếp, chờ bạn Enter
    if (key === 'Enter' && pendingSend && !pendingSend.running) {
      pendingSend.running = true;
      pendingSend.waitSince = Date.now();
      pendingSend.tries = 0;
      pendingSend.sendTry = 0;
      pendingSend.deadline = Date.now() + PENDING_GAP_MAX_MS;
      flushWaitBadge();
      ensurePendingLoop();
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


    // Câu nhiều tin CHỜ SẴN (chưa Enter lần đầu), người dùng xoá sạch & không gõ gì thêm → bỏ chờ.
    // Nếu chế độ tự động đang chạy thì KHÔNG huỷ (app vừa gửi tin → ô trống là điều kiện để điền tiếp).
    if (pendingSend && pendingSend.el === el && !pendingSend.running && composerIsEmpty(el)) {
      setTimeout(() => {
        if (pendingSend && pendingSend.el === el && !pendingSend.running && composerIsEmpty(el)) clearPending();
      }, 400);
    }

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

  // Bấm nút GỬI của Pancake (thay cho Enter) cũng bắt đầu chuỗi tự gửi
  document.addEventListener('click', (e) => {
    if (!pendingSend || pendingSend.running) return;
    if (isOurs(e.target)) return;
    let node = e.target;
    let hit = false;
    for (let i = 0; i < 4 && node && node.nodeType === 1; i++) {
      const cls = String(node.className && node.className.baseVal != null ? node.className.baseVal : node.className || '');
      const hint = (node.getAttribute && (node.getAttribute('title') || node.getAttribute('aria-label') || '')) || '';
      // bỏ qua nút phụ (ảnh, file, emoji, sản phẩm…) — chỉ nhận nút gửi
      const hay = cls + ' ' + String(node.id || '') + ' ' + hint;
      if (!/(photo|image|file|attach|emoji|sticker|product|invoice|upload|select|badge)/i.test(hay)
          && (/\bsend\b|send-|icon-send|gửi|paper-?plane/i.test(hay))) { hit = true; break; }
      node = node.parentElement;
    }
    if (hit) {
      pendingSend.running = true;
      pendingSend.waitSince = Date.now();
      pendingSend.tries = 0;
      pendingSend.sendTry = 0;
      pendingSend.deadline = Date.now() + PENDING_GAP_MAX_MS;
      flushWaitBadge();
      ensurePendingLoop();
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

  // Ghi nhớ ô nhập đang dùng (đổi sang ô khác thì huỷ phần tin đang chờ)
  function trackInput(e) {
    const el = e.target;
    if (isOurs(el)) return;
    if (isEditableEl(el)) {
      if (pendingSend && el !== pendingSend.el) clearPending();
      lastActiveInput = el;
      // đang gõ ở ô khác (ô tìm kiếm, ô lọc…) → đóng bảng gợi ý ngay
      if (!isSuggestScope(el)) hideSuggest();
    }
  }
  document.addEventListener('focusin', trackInput, true);
  document.addEventListener('mousedown', trackInput, true);

  // Cuộn / đổi kích thước → vị trí gợi ý đi theo ô nhập
  window.addEventListener('resize', () => {
    currentPos = applyBtnPosition(currentPos.top, currentPos.left);
    if (isOpenPanel) updatePanelPosition();
    if (picker.open) positionSuggest();
    if (pendingSend) positionWaitBadge();
  });
  document.addEventListener('scroll', () => {
    if (picker.open) positionSuggest();
    if (pendingSend) positionWaitBadge();
  }, true);

  // Ô soạn tin bị gỡ khỏi DOM (đổi chat) → huỷ phần chờ
  setInterval(() => {
    if (pendingSend && (!pendingSend.el || !pendingSend.el.isConnected)) clearPending();
    else if (pendingSend) positionWaitBadge();
  }, 1500);

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

    row.appendChild(h('span', { class: 'tln-chip', text: '//' + key, title: 'Gõ //' + key + ' trong ô soạn tin rồi Enter' }));

    const box = h('div', { class: 'tln-item-box' });
    box.appendChild(h('span', { class: 'tln-item-text', text: item.text, title: item.text }));
    const partsN = (item.parts || []).length;
    if (partsN > 1) {
      box.appendChild(h('span', {
        class: 'tln-item-parts',
        text: partsN + ' tin — Enter gửi tin 1, tự điền tin 2…',
      }));
    }
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
          showToast('Đã xóa câu //' + key);
        },
      }));
    } else {
      actions.appendChild(h('button', {
        class: 'tln-icon', text: '📋', title: 'Sao chép câu',
        onclick: (e) => { e.stopPropagation(); copyText(item.text); },
      }));
      row.addEventListener('click', () => insertFromPanel(item));
    }

    row.appendChild(actions);
    return row;
  }

  function insertFromPanel(item) {
    const target = pickTargetInput();
    if (target && applyShortcut(item, target, null)) return;
    // Không có ô nhập → sao chép tin đầu tiên
    copyText((item.parts && item.parts[0]) || item.text);
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
        const hay = (normShortcut(item.shortcut) + ' ' + (item.text || '') + ' ' + (item.parts || []).join(' ')).toLowerCase();
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
          : 'Chưa có câu tắt nào. Bấm “✏️ Chỉnh sửa” → “+ Thêm danh mục mới” rồi “+ Thêm câu tắt” (ví dụ câu tắt: cn → gõ //cn trong ô soạn tin).',
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
    footer.appendChild(h('b', { text: '//câu_tắt' }));
    footer.appendChild(h('span', { text: ' (HAI gạch chéo) + chữ tắt trong ô soạn tin → Enter/Tab (hoặc cách ra) để chèn câu — Enter lần nữa để gửi.' }));
    footer.appendChild(h('br'));

    // Cách gửi câu nhiều tin
    const chainWrap = h('label', { class: 'tln-auto' });
    chainWrap.appendChild(h('span', { text: 'Câu nhiều tin:' }));
    const chainSel = h('select', { class: 'tln-select' });
    [{ v: 'auto', t: 'Tự gửi liên tiếp (Enter 1 lần)' }, { v: 'manual', t: 'Thủ công (Enter từng tin)' }]
      .forEach((o) => {
        const opt = h('option', { value: o.v, text: o.t });
        if (settings.chain === o.v) opt.selected = true;
        chainSel.appendChild(opt);
      });
    chainSel.addEventListener('change', () => {
      settings.chain = chainSel.value === 'manual' ? 'manual' : 'auto';
      saveSettings();
      flushWaitBadge();
      showToast(settings.chain === 'manual'
        ? 'Chế độ thủ công: mỗi tin bạn Enter một lần'
        : 'Chế độ tự động: Enter tin đầu là gửi tiếp hết');
    });
    chainWrap.appendChild(chainSel);
    footer.appendChild(chainWrap);

    // Giãn cách giữa 2 tin
    const gapWrap = h('label', { class: 'tln-auto' });
    gapWrap.appendChild(h('span', { text: 'Giãn cách:' }));
    const gapInput = h('input', {
      class: 'tln-num', type: 'number', min: '300', max: '10000', step: '100',
      value: String(settings.gapMs),
    });
    gapInput.addEventListener('change', () => {
      const v = Math.max(300, Math.min(10000, Number(gapInput.value) || 1200));
      gapInput.value = String(v);
      settings.gapMs = v;
      saveSettings();
    });
    gapWrap.appendChild(gapInput);
    gapWrap.appendChild(h('span', { text: 'ms/tin' }));
    footer.appendChild(gapWrap);

    // Vị trí bảng gợi ý
    const posWrap = h('label', { class: 'tln-auto' });
    posWrap.appendChild(h('span', { text: 'Bảng gợi ý:' }));
    const posSel = h('select', { class: 'tln-select' });
    const posOptions = [
      { v: 'above', t: 'Trên ô soạn tin' },
      { v: 'below', t: 'Dưới ô soạn tin' },
      { v: 'free', t: 'Chỗ đã kéo (tự do)' },
    ];
    posOptions.forEach((o) => {
      const opt = h('option', { value: o.v, text: o.t });
      if (settings.place === o.v) opt.selected = true;
      posSel.appendChild(opt);
    });
    posSel.addEventListener('change', () => {
      settings.place = posSel.value;
      if (settings.place !== 'free') clearSuggestCustomPos();
      saveSettings();
      if (picker.open) positionSuggest();
      showToast('Vị trí bảng gợi ý: ' + posSel.options[posSel.selectedIndex].text.toLowerCase());
    });
    posWrap.appendChild(posSel);
    footer.appendChild(posWrap);

    // Ẩn bảng câu nhanh "/" gốc của Pancake khi bảng của script mở
    const nativeWrap = h('label', { class: 'tln-auto' });
    const nativeChk = h('input', { type: 'checkbox' });
    nativeChk.checked = !!settings.hideNative;
    nativeChk.addEventListener('change', () => {
      settings.hideNative = nativeChk.checked;
      saveSettings();
      if (!settings.hideNative) hideNativePopup(false);
      else if (picker.open) hideNativePopup(true);
      showToast(settings.hideNative ? 'Đã ẩn bảng "/" gốc khi đang mở bảng gợi ý' : 'Không ẩn bảng "/" gốc nữa');
    });
    nativeWrap.appendChild(nativeChk);
    nativeWrap.appendChild(h('span', { text: 'Ẩn bảng "/" gốc của Pancake khi bảng gợi ý mở' }));
    footer.appendChild(nativeWrap);

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
          label: 'CÂU TẮT (gõ // + chữ tắt trong ô soạn tin)',
          value: item.shortcut || '',
          placeholder: 'vd: cn',
          hint: 'Chỉ chữ/số/._- (không dấu, không khoảng trắng). Trong ô soạn tin gõ //cn rồi Enter (hoặc cách ra).',
        },
        {
          key: 'text',
          label: 'NỘI DUNG — mỗi DÒNG TRỐNG ngăn cách 1 TIN',
          value: (item.parts && item.parts.length > 1) ? item.parts.join('\n\n') : (item.text || ''),
          placeholder: 'Tin 1: Dạ em chào anh/chị ạ!\n\nTin 2: Bên em đang freeship toàn quốc…\n\nTin 3: Anh/chị chốt giúp em nhé!',
          multiline: true,
          hint: '1 tin = 1 lần gửi. Enter gửi tin 1 rồi script tự điền tin 2 vào ô chat, chờ bạn Enter tiếp.',
        },
      ],
      onSubmit: (v, fail) => {
        const key = normShortcut(v.shortcut);
        if (!key) return fail('Chưa nhập câu tắt.', 'shortcut');
        if (/[^a-z0-9._-]/.test(key)) return fail('Câu tắt chỉ gồm chữ/số/._- (không dấu, không khoảng trắng).', 'shortcut');
        if (shortcutTaken(key, isEdit ? { catIdx: opts.catIdx, itemIdx: opts.itemIdx } : null)) {
          return fail('Câu tắt “//' + key + '” đã được dùng ở câu khác.', 'shortcut');
        }
        const parts = splitMessages(v.text);
        if (!parts.length) return fail('Chưa nhập nội dung câu trả lời.', 'text');
        // 1 tin → giữ nguyên đoạn (kể cả xuống dòng đơn); nhiều tin → mỗi tin 1 phần
        const text = parts.length === 1
          ? String(v.text).replace(/\r\n?/g, '\n').trim()
          : parts.join('\n\n');
        const entry = { shortcut: key, text, parts };

        if (isEdit) {
          categories[opts.catIdx].items[opts.itemIdx] = entry;
        } else {
          categories[opts.catIdx].items.push(entry);
          openCats.add(categories[opts.catIdx].id);
        }
        saveData();
        render();
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

  flushWaitBadge(); // hiện lại nhãn "còn tin chờ gửi" nếu có

  /* ============================ KHỞI ĐỘNG ============================ */

  // Mở sẵn danh mục đầu tiên cho dễ nhìn
  if (categories.length) openCats.add(categories[0].id);

  console.log('[TRALOINHANH] v' + APP_VERSION + ' đã chạy — gõ //chữ_tắt trong ô soạn tin rồi Enter (một gạch "/" vẫn là bảng câu nhanh của Pancake).');
})();
