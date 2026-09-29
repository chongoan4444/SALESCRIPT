// ==UserScript==
// @name         Pancake hỗ trợ lên đơn (13.1 - Tối giản + Giảm giá chính xác)
// @namespace    http://tampermonkey.net/
// @version      13.1
// @description  Tự động điền mã SP + size, tự điền địa chỉ, tự tính & điền ô Giảm giá có VÒNG LẶP KIỂM CHỨNG (đọc lại Thành tiền để phát hiện sai và sửa). Dò form đơn 4 tầng (chịu được UI đổi), lọc theo vị trí thật để không đọc nhầm pane ẩn. Giao diện tối giản: 1 nút BẬT/TẮT + 1 nút TẠM DỪNG + bảng chẩn đoán (Ctrl+Shift+D).
// @match        https://pancake.vn/*
// @match        https://*.pancake.vn/*
// @match        https://pages.fm/*
// @match        https://*.pages.fm/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // =================================================================
    // 13.1 — sửa "script không thấy điền gì":
    //   • Dò khu form đơn theo 4 tầng (pane đang mở → ứng viên bất kỳ → hộp
    //     chứa ô Giảm giá → vùng cuộn), không bám cứng #customerCol nữa.
    //   • Lọc HIỂN THỊ ở chính dòng/ô cần dùng (pane ẩn bị dịch ra ngoài nên
    //     phần tử con thừa hưởng vị trí đó ⇒ tự bị loại).
    //   • Tự điền mã SP khi ô tìm kiếm còn trống (không cần bấm vào ô).
    //   • Nhận từ khoá tổng đơn rộng hơn: "tổng 320k", "chốt 320k", "bill 320k",
    //     "thanh toán 320k"; nhãn "Thành tiền:" có dấu hai chấm vẫn nhận.
    //   • Bảng chẩn đoán Ctrl+Shift+D + nút trong ⚙: biết script đang "thấy" gì.
    // =================================================================


    // =================================================================
    // 0. CĂN CỨ DOM (đã đối chiếu kho nguồn trong repo)
    // -----------------------------------------------------------------
    // ĐÃ KIỂM CHỨNG từ html.txt / html2.txt / html3.txt:
    //   • Cột phải: #customerCol > .tab-label-track > #quick-create-order-tab ("Tạo đơn")
    //   • Khung trượt: .react-swipeable-view-container > div[data-swipeable="true"]
    //       - pane đang mở: aria-hidden="false"
    //       - pane "Tạo đơn": .swipeable-view-order.swipeable-view-content
    //       - pane KHÔNG mở VẪN NẰM TRONG DOM (chỉ bị dịch ra ngoài màn hình)
    //       => BẮT BUỘC lọc theo vị trí màn hình, nếu không sẽ đọc nhầm giá của
    //          pane "Thông tin" (danh sách đơn cũ) => giảm giá SAI.
    //   • Khung chat: #message-col-list > .message-list.media-list-conversation
    //       - mỗi tin: .inbox-message-ele (khách: .media-message-from-customer)
    //       - nội dung: .message-text-ele
    //   • Hội thoại đang mở: #conversationList .conversation-list-item.selected
    //       (thẻ cha có id = <pageId>_<convId>)
    //   • Danh sách tag: #listShowTags > .row_tag_list (3 hàng) > button.btn-tag-item
    //       - hàng 3, item 4 = MÃ SẢN PHẨM (thực tế trong html3.txt là "M20")
    //   • i18n: discountAmount="Giảm giá", finalPrice="Thành tiền",
    //           typeToSearch="Tìm kiếm sản phẩm", shippingFee="Phí vận chuyển"
    //   • antd v5 InputNumber: input.ant-input-number-input
    //     (+ class bọc .pancake-antd-input-number có trong _app-*.v6.js)
    //
    // KHÔNG có trong repo (giữ theo DOM thật của bạn, luôn có fallback theo nhãn):
    //   .flex-between.row-content-payment | .text-final-price | #shippingAddress
    // =================================================================


    // =================================================================
    // 1. CONFIG
    // =================================================================

    const CONFIG = {
        // --- selector đã kiểm chứng -------------------------------------
        customerCol: '#customerCol',
        swipePane: '#customerCol [data-swipeable="true"], .swipeable-view-order',
        selectedConv: '#conversationList .conversation-list-item.selected',
        messageCol: '#message-col-list',
        messageText: '.message-text-ele',
        tagList: '#listShowTags',
        productCodeTag:
            '#listShowTags .row_tag_list:nth-child(3) .btn-tag-item:nth-child(4)',

        // --- selector theo DOM thật (luôn có fallback) ------------------
        productSearch:
            'input[type="search"][placeholder="Tìm kiếm sản phẩm"]',
        productSearchLoose:
            'input[type="search"][placeholder*="Tìm kiếm"], input[type="search"]',
        address: '#shippingAddress',
        paymentRow: '.flex-between.row-content-payment',
        anyRow: '.flex-between, .row-content-payment, .ant-row, .row-content, tr',
        finalPriceClass: '.text-final-price',
        inputNumber: 'input.ant-input-number-input',

        // --- nhãn dòng tiền (khớp CHÍNH XÁC để tránh "Giảm giá theo combo") ---
        labels: {
            discount: ['giảm giá', 'giảm giá đơn hàng', 'chiết khấu đơn hàng', 'chiết khấu'],
            final: ['thành tiền', 'tổng thanh toán', 'tổng tiền thanh toán', 'tổng cộng', 'tổng tiền'],
            goods: ['tổng tiền hàng', 'tiền hàng', 'tổng giá trị đơn hàng', 'tổng giá trị hàng'],
            shipping: ['phí vận chuyển', 'phí ship', 'vận chuyển']
        },

        // --- thời gian ------------------------------------------------
        scanInterval: 900,          // nhịp quét
        minTickGap: 300,            // chống dồn tick
        chatDebounce: 250,          // gộp mutation
        formStableMs: 700,          // form mở xong bao lâu mới được ghi
        stableTicks: 2,             // số lần "cần giảm" lặp lại trước khi ghi lần đầu
        maxAttempts: 3,             // số lần ghi tối đa cho 1 đơn
        verifyMs: 420,              // chờ app nhận giá trị
        settleMs: 900,              // chờ Thành tiền cập nhật
        writeCooldown: 600,         // nghỉ tối thiểu giữa 2 lần ghi
        maxRecentLines: 200         // tổng đơn cũ hơn ngần này dòng thì không tự ghi (0 = không giới hạn)
    };

    const DEFAULTS = {
        enabled: true,       // BẬT/TẮT toàn bộ tự động điền
        paused: false,       // nút TẠM DỪNG
        step: 10000,         // làm tròn số đẹp cho lần ghi đầu
        tolerance: 5000,     // sai số chấp nhận
        maxDiscount: 2000000,
        maxRatio: 70,        // % tối đa của giá trị đơn
        maxAge: 200,         // bỏ qua tổng đơn cũ hơn N dòng (0 = không giới hạn)
        debug: false,
        left: null,
        top: null
    };

    const LS_KEY = 'pancake_len_don_13';


    // =================================================================
    // 2. STATE
    // =================================================================

    const S = {
        cfg: loadCfg(),

        lines: [],
        chatSig: '',
        size: '',
        sizeOrder: '',
        address: '',
        addressFilled: '',

        target: null,          // { value, line, age, assumed }

        convKey: '',
        sig: '',
        formOpen: false,
        formAt: 0,

        needSeen: { value: null, count: 0 },
        attempts: 0,
        manual: false,         // người dùng đã sửa tay ô Giảm giá
        manualValue: null,     // giá trị họ nhập
        lockDetail: '',        // lý do khoá đơn (giữ lại để hiển thị)
        lastFilledCode: '',
        lastWriteAt: 0,
        lastTickAt: 0,
        status: { code: 'off', text: 'Đang tắt', detail: '' },
        rootDesc: ''
    };

    const W = {                // chu trình ghi + kiểm chứng ô Giảm giá
        phase: 'idle',         // idle | verify | settle
        value: null,
        beforeFinal: null,
        beforeD: null,
        deadline: 0,
        usedFallback: false
    };


    // =================================================================
    // 3. UTIL
    // =================================================================

    function norm(v) {
        return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    }

    function normLabel(v) {
        return norm(v).toLowerCase();
    }

    function log() {
        if (!S.cfg.debug) return;
        try { console.log('[Lên đơn 13.0]', ...arguments); } catch (_) {}
    }

    function warn() {
        try { console.warn('[Lên đơn 13.0]', ...arguments); } catch (_) {}
    }

    function money(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return '0';
        return Math.round(n).toLocaleString('vi-VN');
    }

    function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const st = window.getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden';
    }

    // Pane "Tạo đơn" khi không mở VẪN có kích thước, chỉ bị dịch ra ngoài màn hình
    // => isVisible() KHÔNG đủ, phải kiểm tra giao với màn hình.
    function isOnScreen(el) {
        if (!isVisible(el)) return false;
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        return r.right > 8 && r.left < vw - 8;
    }

    function q(root, sel) {
        try { return (root || document).querySelector(sel); } catch (_) { return null; }
    }

    function qa(root, sel) {
        try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (_) { return []; }
    }

    function setNativeValue(input, value) {
        if (!input) return;
        const proto = input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(input, String(value));
        else input.value = String(value);
    }

    function fireInput(input, value, inputType) {
        if (!input) return;
        try {
            input.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                composed: true,
                inputType: inputType || 'insertText',
                data: String(value)
            }));
        } catch (_) {
            input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    function fireEnter(input) {
        ['keydown', 'keyup'].forEach(type => {
            try {
                input.dispatchEvent(new KeyboardEvent(type, {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                    bubbles: true, composed: true
                }));
            } catch (_) {}
        });
    }

    function loadCfg() {
        const cfg = Object.assign({}, DEFAULTS);
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) Object.assign(cfg, JSON.parse(raw) || {});
        } catch (_) {}
        return cfg;
    }

    function saveCfg() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(S.cfg)); } catch (_) {}
    }


    // =================================================================
    // 4. ĐỌC TIỀN (chuẩn VN: 320k, 320.000đ, 1tr2, 320 nghìn, 320)
    // =================================================================

    function parseNum(raw) {
        const s = String(raw);
        const hasDot = s.indexOf('.') !== -1;
        const hasComma = s.indexOf(',') !== -1;
        if (!hasDot && !hasComma) {
            const n = Number(s);
            return Number.isFinite(n) ? n : NaN;
        }
        if (hasDot && hasComma) {
            const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
            const grp = dec === '.' ? ',' : '.';
            const n = Number(s.split(grp).join('').replace(dec, '.'));
            return Number.isFinite(n) ? n : NaN;
        }
        const sep = hasDot ? '.' : ',';
        const parts = s.split(sep);
        const grouping = parts.length > 1 && parts.slice(1).every(p => p.length === 3);
        const n = grouping ? Number(parts.join('')) : Number(parts.join('.'));
        return Number.isFinite(n) ? n : NaN;
    }

    // [{ value, unit, raw, index, assumed }]
    function moneyTokens(text) {
        const out = [];
        if (text == null) return out;
        const s = String(text);
        const re = /\d[\d.,]*/g;
        let m;
        while ((m = re.exec(s)) !== null) {
            const raw = m[0];
            const start = m.index;
            const end = start + raw.length;
            const before = s.slice(Math.max(0, start - 2), start);
            const after1 = s.charAt(end);
            if (/[/:]$/.test(before)) continue;          // 29/9, 08:14
            if (after1 === '/' || after1 === ':') continue;
            const tail = s.slice(end, end + 14);
            if (/^\s*%/.test(tail)) continue;            // 10%

            let unit = '';
            let mult = 1;
            let used = 0;
            let um = tail.match(/^\s*(k|nghìn|ngàn|ngan)(?![a-zà-ỹ])/i);
            if (um) { unit = 'k'; mult = 1000; used = um[0].length; }
            if (!unit) {
                um = tail.match(/^\s*(triệu|trieu|tr)(?![a-zà-ỹ])/i);
                if (um) { unit = 'tr'; mult = 1000000; used = um[0].length; }
            }
            if (!unit) {
                // "đ" không thuộc \w => KHÔNG dùng \b (lỗi cũ: "320.000đ" bị bỏ qua hoàn toàn)
                um = tail.match(/^\s*(vnđ|vnd|đồng|đ)(?![a-zà-ỹ])/i);
                if (um) { unit = 'đ'; mult = 1; used = um[0].length; }
            }

            let extra = 0;
            if (unit) {
                const fm = tail.slice(used).match(/^(\d)(?!\d)/);
                if (fm) extra = Number(fm[1]) * (mult / 10);   // 1k5 -> 1500 ; 1tr2 -> 1.200.000
            }

            const n = parseNum(raw);
            if (!Number.isFinite(n)) continue;

            let value = 0;
            let assumed = false;
            if (unit === 'k' || unit === 'tr') value = n * mult + extra;
            else if (unit === 'đ') value = n;
            else if (/[.,]/.test(raw)) value = n;               // 320.000
            else if (raw.length >= 4) value = n;                // 160000
            else if (n >= 10 && n <= 2000) { value = n * 1000; assumed = true; } // "320" -> 320k
            else value = n;

            if (assumed) {
                const ctx = s.slice(Math.max(0, start - 14), start);
                if (/(size|sz|kg|kí|cân|cm|tuổi|tháng|ngày|giờ|sl|số|mã|%|\/)/i.test(ctx)) continue;
            }
            if (!unit && /^(0|84)\d{8,}$/.test(raw.replace(/[^\d]/g, ''))) continue;  // SĐT
            if (!unit && raw.replace(/[^\d]/g, '').length >= 9) continue;            // mã dài
            if (value < 500 || value > 5000000000) continue;

            out.push({ value: Math.round(value), unit, raw, index: start, assumed });
        }
        return out;
    }

    function parseInputNumber(v) {
        const s = String(v == null ? '' : v).trim();
        const digits = s.replace(/[^\d]/g, '');
        if (!digits) return 0;
        const n = Number(digits);
        if (!Number.isFinite(n)) return 0;
        return s.charAt(0) === '-' ? -n : n;
    }

    function digitsValue(text) {
        const s = String(text == null ? '' : text).replace(/[^\d]/g, '');
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) && n > 0 ? n : null;
    }


    // =================================================================
    // 5. ĐỌC CHAT
    // =================================================================

    function readChatLines() {
        const col = q(document, CONFIG.messageCol) ||
            q(document, '.message-list.media-list-conversation');
        if (!col) return [];

        const nodes = qa(col, CONFIG.messageText);
        const out = [];
        for (let i = 0; i < nodes.length; i++) {
            // textContent (không ép layout như innerText) cho nhịp quét nhẹ
            const t = norm(nodes[i].textContent || '');
            if (!t || t.length > 300) continue;
            const prev = out.length ? out[out.length - 1] : '';
            if (prev && prev.indexOf(t) !== -1) continue;           // node lồng nhau
            if (prev && t.indexOf(prev) !== -1) { out[out.length - 1] = t; continue; }
            out.push(t);
        }
        return out;
    }

    function normalizeSize(v) {
        const s = String(v || '').toUpperCase().replace(/\s+/g, '');
        if (!s) return '';
        if (s === 'XXL') return '2XL';
        if (s === 'XXXL') return '3XL';
        return s;
    }

    function sizeFromLine(line) {
        if (!line) return '';
        let m = line.match(/\b(?:size|sz)\s*[:\-]?\s*(5xl|4xl|3xl|2xl|xxxl|xxl|xl|xs|l|m|s|f)\b/i);
        if (m) return normalizeSize(m[1]);
        // size nhiều ký tự: không phân biệt hoa/thường
        m = line.match(/(?:^|[\s,;|/\-])(5xl|4xl|3xl|2xl|xxxl|xxl|xl|xs)(?=$|[\s,;|/\-])/i);
        if (m) return normalizeSize(m[1]);
        // size 1 ký tự: chỉ nhận khi VIẾT HOA (tránh nhận nhầm "m", "s" trong câu)
        m = line.match(/(?:^|[\s,;|/\-])(S|M|L|F)(?=$|[\s,;|/\-])/);
        if (m) return normalizeSize(m[1]);
        return '';
    }

    const PHONE_RE = /(?:0|\+84)(?:3[2-9]|5[689]|7[06-9]|8[1-589]|9[0-46-9])[\s.-]*\d{3}[\s.-]*\d{4}/;
    const ADDR_RE = /(ấp|thôn|xóm|bản|tổ\s*\d+|xã|phường|quận|huyện|tỉnh|tp\b|thành phố|đường|số nhà|khu phố|đối diện|gần\s*(?:chợ|cây xăng|trường)|ngõ|hẻm|kdc|chung cư)/i;
    const ORDER_RE = /(tổng|chốt|thành\s*tiền|thanh\s*toán|còn\s*lại|bill)/i;

    function isFeeContext(text, index) {
        const ctx = String(text).slice(Math.max(0, index - 16), index);
        return /(ship|phí|vận chuyển|cọc|đặt cọc|giảm|bớt|trừ)/i.test(ctx);
    }

    // Tổng đơn: ưu tiên đoạn SAU từ khoá, bỏ số thuộc phí ship / tiền cọc.
    function extractTotal(line, nextLine) {
        if (!line) return null;
        const kw = /(tổng\s*(?:đơn|tiền|thanh\s*toán|cộng)|chốt\s*(?:đơn|tiền|nhé|nha)?|thành\s*tiền|còn\s*lại)/gi;
        let last = null;
        let m;
        while ((m = kw.exec(line)) !== null) last = m;

        const pick = (text) => {
            let toks = moneyTokens(text);
            if (!toks.length) return null;
            toks = toks.filter(t => !isFeeContext(text, t.index));
            if (!toks.length) return null;
            // "160k = 320k" -> lấy số sau dấu bằng
            if (line.indexOf('=') !== -1) return toks[toks.length - 1];
            // "160k + 160k" -> cộng lại
            if (line.indexOf('+') !== -1 && toks.length > 1) {
                const sum = toks.reduce((a, b) => a + b.value, 0);
                return {
                    value: sum, unit: '', raw: String(sum),
                    index: toks[0].index, assumed: toks.some(t => t.assumed)
                };
            }
            return toks[0];
        };

        if (last) {
            const t = pick(line.slice(last.index + last[0].length));
            if (t) return t;
        }
        if (nextLine) {
            const t = pick(nextLine);
            if (t) return t;
        }
        return pick(line);
    }

    function scanChat() {
        const lines = readChatLines();
        const sig = lines.join('\u0001');
        const changed = sig !== S.chatSig;
        if (changed) {
            S.chatSig = sig;
            S.lines = lines;
        } else if (S.lines.length) {
            return;
        }
        if (!lines.length) { S.target = null; S.address = ''; S.size = ''; return; }

        // ---- size mới nhất trong chat ----
        let size = '';
        for (let i = 0; i < lines.length; i++) {
            const s = sizeFromLine(lines[i]);
            if (s) size = s;
        }
        S.size = size;

        // ---- địa chỉ: dòng GIỐNG ĐỊA CHỈ cuối cùng (ghép tối đa 2 dòng liền nhau) ----
        let addr = '';
        let addrIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (ORDER_RE.test(line)) continue;
            if (PHONE_RE.test(line) && line.length < 16) continue;   // dòng chỉ có SĐT
            if (ADDR_RE.test(line)) { addr = line; addrIdx = i; }
        }
        if (addrIdx > 0 && addr.length < 26) {
            const prev = lines[addrIdx - 1];
            if (prev && ADDR_RE.test(prev) && !ORDER_RE.test(prev) && !PHONE_RE.test(prev)) {
                addr = prev + ', ' + addr;
            }
        }
        S.address = addr;

        // ---- tổng đơn: dòng cuối cùng có tổng hợp lệ ----
        let target = null;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (!ORDER_RE.test(lines[i])) continue;
            const total = extractTotal(lines[i], lines[i + 1]);
            if (total && total.value > 0) {
                target = {
                    value: total.value,
                    line: lines[i],
                    assumed: !!total.assumed,
                    age: lines.length - 1 - i
                };
                S.sizeOrder = sizeFromLine(lines[i]) || '';
                break;
            }
        }
        if (!target) S.sizeOrder = '';
        S.target = target;

        log('chat', { lines: lines.length, size: S.size, address: S.address, target: S.target });
    }


    // =================================================================
    // 6. TÌM FORM ĐƠN — nhiều tầng, chịu được UI đổi
    // -----------------------------------------------------------------
    // Bản 12.1 tìm ô tiền bằng cách tự dò <div> cuộn lớn nhất rồi quét chữ,
    // nên chạy được cả khi khu "Tạo đơn" nằm ở nơi khác. Bản này phải làm
    // được như vậy: dò theo nhiều tầng, tầng nào ra KẾT QUẢ DÙNG ĐƯỢC thì lấy.
    // =================================================================

    const FORM_MARK =
        'input[type="search"], input.ant-input-number-input, #shippingAddress';

    function formInfoOf(el) {
        if (!el) return null;
        const search = el.querySelector('input[type="search"]');
        const num = el.querySelector('input.ant-input-number-input, input[role="spinbutton"]');
        const addr = el.querySelector('#shippingAddress');
        const score = (search ? 3 : 0) + (addr ? 3 : 0) + (num ? 2 : 0);
        if (!score) return null;
        return { el: el, search: search, num: num, addr: addr, score: score };
    }

    // Pane này có ĐANG ĐƯỢC NHÌN THẤY thật không?
    // Pane không mở vẫn có kích thước (chỉ bị dịch ra ngoài) nên phải kiểm tra:
    //   - giao với màn hình
    //   - nằm trong hộp #customerCol (pane bị cắt ra ngoài cột = pane ẩn)
    function paneVisible(p, strict) {
        if (isVisible(p)) {
            const r = p.getBoundingClientRect();
            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            if (r.right > 8 && r.left < vw - 8) {
                const col = q(document, CONFIG.customerCol);
                if (col) {
                    const c = col.getBoundingClientRect();
                    if (c.width > 20) {
                        const overlap = Math.min(r.right, c.right) - Math.max(r.left, c.left);
                        if (overlap >= r.width * 0.6) return true;
                    } else {
                        return true;   // chưa đo được #customerCol -> không chặn
                    }
                } else {
                    return true;       // không có #customerCol -> không chặn
                }
            }
        }
        return strict ? false : isOnScreen(p);
    }

    // Khu đơn nằm TRONG cột phải mà bị trượt ra ngoài = khu ẩn -> không được ghi.
    // Ngoài cột phải (modal / nơi khác) thì chỉ cần đang hiện.
    function insideCustomerCol(el) {
        const col = q(document, CONFIG.customerCol);
        return !!(col && el && col.contains(el));
    }

    function usableRoot(el) {
        if (!el) return false;
        return insideCustomerCol(el) ? paneVisible(el, true) : paneVisible(el, false);
    }

    // Dùng cho MỌI phần tử con (dòng tiền, ô nhập, nút): pane ẩn bị dịch ra ngoài
    // thì phần tử con thừa hưởng đúng vị trí đó -> tự bị loại.
    function shown(el) {
        return usableRoot(el);
    }

    // Tầng cuối: quét MỌI ứng viên trên trang, chọn cái ĐANG HIỆN và có nhiều
    // dấu hiệu form đơn nhất. Không phụ thuộc #customerCol / .swipeable-view-order.
    function pickVisibleCandidate(nodes) {
        let best = null;
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (!el || !el.querySelector) continue;
            if (document.getElementById('pld-bar') &&
                (el.id === 'pld-bar' || el.id === 'pld-panel' ||
                 el.closest('#pld-bar, #pld-panel'))) continue;
            if (!usableRoot(el)) continue;
            const info = formInfoOf(el);
            if (!info) continue;
            let score = info.score;
            if (el.closest('#customerCol')) score += 2;
            if (el.classList && el.classList.contains('swipeable-view-order')) score += 2;
            if (score > (best ? best.score : -1)) best = { el, score, search: info.search, num: info.num, addr: info.addr };
        }
        return best;
    }

    // Tầng 3: đi từ ô "Giảm giá" đang hiện lên tới khối chứa cả khu thanh toán
    function boxTopFor(root) {
        const row = q(root, CONFIG.paymentRow);
        if (!row) return null;
        return row.parentElement || row;
    }

    const boxCache = { at: 0, box: null };

    function findPaymentBox() {
        const now = Date.now();
        if (now - boxCache.at < 300) return boxCache.box;

        const rows = qa(document, CONFIG.paymentRow);
        const readBox = (box) => {
            if (!box) return null;
            const f = readForm(box);
            if (f.discount && f.discount.input) return box;
            return null;
        };

        let box = null;
        for (let i = 0; i < rows.length; i++) {
            const cand = rows[i].parentElement;
            if (!cand) continue;
            if (!usableRoot(cand)) continue;
            box = readBox(cand);
            if (box) break;
        }

        // nhãn "Giảm giá" chính xác + input number trong cùng khối
        if (!box) {
            const leaves = qa(document, 'span, div, label, p, td, th').filter(el => !el.children.length);
            for (let i = 0; i < leaves.length; i++) {
                const m = labelMatches(leaves[i].textContent, CONFIG.labels.discount);
                if (!m) continue;
                let el = leaves[i];
                for (let up = 0; up < 4 && el; up++) {
                    el = el.parentElement;
                    if (!el || !el.querySelector) continue;
                    if (el.querySelector(CONFIG.inputNumber)) {
                        const cand = el.parentElement || el;
                        if (usableRoot(cand)) { box = readBox(cand); if (box) break; }
                    }
                }
                if (box) break;
            }
        }

        boxCache.at = now;
        boxCache.box = box;
        return box;
    }

    // Tầng 4 (chế độ dễ tính): tự dò vùng cuộn lớn như bản 12.1
    let looseRoot = { at: 0, el: null };

    function findLooseOrderRoot() {
        const now = Date.now();
        if (now - looseRoot.at < 1000) return looseRoot.el;

        const widget = document.getElementById('pld-bar');
        const divs = qa(document, 'div');
        const scrolls = [];
        for (let i = 0; i < divs.length; i++) {
            const el = divs[i];
            if (el.id === 'pld-bar' || el.id === 'pld-panel') continue;
            if (widget && widget.contains(el)) continue;
            if (!el.querySelector(CONFIG.inputNumber)) continue;
            const st = window.getComputedStyle(el);
            if (st.overflowY !== 'auto' && st.overflowY !== 'scroll') continue;
            const r = el.getBoundingClientRect();
            if (r.width < 240 || r.height < 260) continue;
            if (!usableRoot(el)) continue;
            scrolls.push(el);
        }
        scrolls.sort((a, b) => (b.getBoundingClientRect().height - a.getBoundingClientRect().height));
        looseRoot = { at: now, el: scrolls[0] || null };
        return looseRoot.el;
    }

    function findOrderFormRoot() {
        // 1) pane đang mở có form đơn
        const panes = qa(document, CONFIG.swipePane);
        const open = panes.filter(p => paneVisible(p, true)).map(formInfoOf).filter(Boolean);
        if (open.length) {
            open.sort((a, b) => b.score - a.score);
            const el = open[0].el;
            const inner = el.querySelector('.swipeable-view-order, .swipeable-view-content');
            return inner || el;
        }

        // 2) ứng viên bất kỳ đang hiện, nhiều dấu hiệu form đơn nhất
        const cands = qa(document,
            'form, .swipeable-view-order, [class*="order" i], [id*="order" i], .ant-drawer-body, .ant-modal-content');
        const picked = pickVisibleCandidate(cands);
        if (picked) {
            return picked.el.closest('.swipeable-view-order, .swipeable-view-content, form') || picked.el;
        }

        // 3) đi từ khối chứa ô "Giảm giá"
        const box = findPaymentBox();
        if (box) return box;

        // 4) dò vùng cuộn (giống bản 12.1) — cuối cùng mới dùng
        return findLooseOrderRoot();
    }

    function getAddressInput(root) {
        const direct0 = q(document, CONFIG.address);
        if (direct0 && usableRoot(direct0)) return direct0;

        const scope = root || findOrderFormRoot() || document;
        const direct = q(scope, CONFIG.address);
        if (direct && usableRoot(direct)) return direct;
        const cands = qa(scope, 'input[type="text"], input:not([type]), textarea').filter(shown);
        return cands.filter(el => /address|địa chỉ|dia chi/i.test(
            (el.id || '') + ' ' + (el.name || '') + ' ' + (el.placeholder || '')
        ))[0] || null;
    }


    // =================================================================
    // 7. ĐỌC DÒNG TIỀN TRONG FORM
    // =================================================================

    let leafCache = { root: null, els: null, at: 0 };

    function leavesOf(root) {
        if (!root) return [];
        const now = Date.now();
        if (leafCache.root === root && now - leafCache.at < 500) return leafCache.els;
        const els = qa(root, 'span, div, label, p, td, th').filter(el => !el.children.length);
        leafCache = { root, els, at: now };
        return els;
    }

    function allLabels() {
        return [].concat(
            CONFIG.labels.discount, CONFIG.labels.final,
            CONFIG.labels.goods, CONFIG.labels.shipping
        );
    }

    function labelMatches(text, list) {
        const t = normLabel(text);
        if (!t) return null;
        for (let i = 0; i < list.length; i++) {
            const l = list[i];
            if (t === l) return { label: l, inline: '' };
            // "giảm giá: 60.000 đ" (nhãn dính số) -> chỉ nhận khi phần còn lại là số tiền
            if (t.indexOf(l + ':') === 0 || t.indexOf(l + ' ') === 0) {
                const rest = t.slice(l.length).replace(/^[:\s]+/, '');
                if (rest === '') return { label: l, inline: '' };   // "Thành tiền:"
                if (/^[\d.,\s]*(đ|vnđ|vnd|đồng)?$/.test(rest) && /\d/.test(rest)) {
                    return { label: l, inline: rest };
                }
            }
        }
        return null;
    }

    function rowOf(el) {
        return el.closest(CONFIG.anyRow) || el.parentElement || null;
    }

    function rowLabel(row) {
        if (!row) return null;
        const direct = Array.prototype.slice.call(row.children || [])
            .filter(c => c.matches && c.matches('span.text-color-default'))[0];
        if (direct) return { text: normLabel(direct.textContent), el: direct };

        const leaves = qa(row, 'span, div, label, p, td, th').filter(el => !el.children.length && norm(el.textContent));
        const known = allLabels();
        const hit = leaves.filter(el => labelMatches(el.textContent, known))[0];
        if (hit) return { text: normLabel(hit.textContent), el: hit };

        const first = leaves[0];
        return first ? { text: normLabel(first.textContent), el: first } : null;
    }

    // Thu thập mọi dòng có nhãn khớp (1 lượt quét cho mỗi nhãn cần dùng)
    function collectRows(root, list) {
        const out = [];
        if (!root) return out;
        const seen = [];
        const push = (row, lab, labelEl) => {
            if (!row || seen.indexOf(row) !== -1) return;
            seen.push(row);
            out.push({ row, label: lab, labelEl });
        };

        qa(root, CONFIG.paymentRow).forEach(row => {
            if (!shown(row)) return;
            const lab = rowLabel(row);
            const m = lab ? labelMatches(lab.text, list) : null;
            if (m) push(row, m.label, lab.el);
        });

        const leaves = leavesOf(root);
        for (let i = 0; i < leaves.length; i++) {
            const el = leaves[i];
            const m = labelMatches(el.textContent, list);
            if (!m) continue;
            const row = rowOf(el);
            if (!row || !shown(el) || !shown(row)) continue;
            if (!/\d/.test(row.textContent || '') && !row.querySelector('input')) continue;
            push(row, m.label, el);
        }
        return out;
    }

    function readRowMoney(row) {
        if (!row) return null;
        const fp = row.querySelector(CONFIG.finalPriceClass);
        if (fp) {
            const v = digitsValue(fp.textContent);
            if (v) return v;
        }
        const input = row.querySelector('input.ant-input-number-input, input[role="spinbutton"]');
        if (input) {
            const v = parseInputNumber(input.value || input.getAttribute('aria-valuenow') || '');
            if (v) return v;
        }
        const toks = moneyTokens(row.textContent || '');
        if (!toks.length) return null;
        const withUnit = toks.filter(t => t.unit);
        if (withUnit.length) return withUnit[0].value;
        return toks.reduce((a, b) => (b.value > a.value ? b : a), toks[0]).value;
    }

    // Chỉ gọi với row đã xác nhận nhãn CHÍNH XÁC "Giảm giá" nên các fallback dưới đây an toàn.
    function findDiscountInputIn(row) {
        if (!row) return null;
        const sels = [
            'input.ant-input-number-input[role="spinbutton"]',
            '.pancake-antd-input-number input',
            '.box-input-number-wrapper input',
            'input.ant-input-number-input',
            'input[role="spinbutton"]',
            'input[type="number"]',
            'input[inputmode="numeric"]',
            'input[type="text"]',
            'input:not([type])'
        ];
        for (let i = 0; i < sels.length; i++) {
            const el = qa(row, sels[i]).filter(e => !e.disabled && !e.readOnly && shown(e))[0];
            if (el) return el;
        }
        return null;
    }

    // Đọc trạng thái tiền của form đang mở.
    // Quan trọng: mọi dòng đều phải nằm trong/ gần "hộp thanh toán" của ô Giảm giá,
    // tránh bắt nhầm "Thành tiền" của TỪNG SẢN PHẨM (nằm phía trên).
    function readForm(root) {
        const out = { root, discount: null, finalPrice: null, goods: null, shipping: null, finalEl: null };
        if (!root) return out;

        // ---------- Giảm giá ----------
        const dRows = collectRows(root, CONFIG.labels.discount);
        let dRow = null;
        for (let i = 0; i < dRows.length; i++) {
            const cand = dRows[i];
            const input = findDiscountInputIn(cand.row);
            const score =
                (input ? 4 : 0) +
                (cand.row.querySelector(CONFIG.finalPriceClass) ? 2 : 0) +
                (/row-content-payment/.test(cand.row.className || '') ? 1 : 0);
            if (!dRow || score >= dRow.score) dRow = { row: cand.row, labelEl: cand.labelEl, input, score };
        }
        if (dRow) {
            const value = dRow.input
                ? parseInputNumber(dRow.input.value || dRow.input.getAttribute('aria-valuenow') || '')
                : (readRowMoney(dRow.row) || 0);
            out.discount = { row: dRow.row, input: dRow.input, value };
        }

        // hộp thanh toán = cha của dòng Giảm giá (chứa các dòng tiền còn lại)
        const box = out.discount && out.discount.row ? out.discount.row.parentElement : null;

        // ---------- Thành tiền ----------
        const fRows = collectRows(root, CONFIG.labels.final);
        let best = null;
        for (let i = 0; i < fRows.length; i++) {
            const row = fRows[i].row;
            const v = readRowMoney(row);
            if (!v) continue;
            let score = 0;
            if (box && row.parentElement === box) score += 10;       // cùng hộp với Giảm giá
            if (out.discount && out.discount.row) {
                // nằm SAU dòng Giảm giá (dòng tổng luôn ở dưới)
                const pos = out.discount.row.compareDocumentPosition(row);
                if (pos & Node.DOCUMENT_POSITION_FOLLOWING) score += 5;
                else score -= 5;
            }
            if (row.querySelector(CONFIG.finalPriceClass)) score += 3;
            if (/row-content-payment/.test(row.className || '')) score += 1;
            if (!best || score >= best.score) best = { row, value: v, score };
        }
        if (best) {
            out.finalPrice = best.value;
            out.finalEl = best.row.querySelector(CONFIG.finalPriceClass) || best.row;
        } else {
            // fallback 1: .text-final-price trong pane đang mở
            const list = qa(root, CONFIG.finalPriceClass).filter(shown);
            for (let i = list.length - 1; i >= 0; i--) {
                const v = digitsValue(list[i].textContent);
                if (v) { out.finalPrice = v; out.finalEl = list[i]; break; }
            }
            // fallback 2: dòng ngay dưới ô Giảm giá trong cùng hộp
            if (out.finalPrice == null && box && out.discount && out.discount.row) {
                const rows = Array.prototype.slice.call(box.children || []);
                const idx = rows.indexOf(out.discount.row);
                for (let i = idx + 1; i < rows.length && i <= idx + 3; i++) {
                    const v = readRowMoney(rows[i]);
                    if (v) { out.finalPrice = v; out.finalEl = rows[i]; break; }
                }
            }
        }

        // ---------- thông tin thêm (chỉ để hiển thị) ----------
        const g = collectRows(root, CONFIG.labels.goods)[0];
        if (g) out.goods = readRowMoney(g.row);
        const sh = collectRows(root, CONFIG.labels.shipping)[0];
        if (sh) out.shipping = readRowMoney(sh.row);

        return out;
    }

    function isDiscountInput(el) {
        if (!el || !el.matches || !el.matches(CONFIG.inputNumber)) return false;
        const row = rowOf(el);
        if (!row) return false;
        const lab = rowLabel(row);
        const text = lab ? lab.text : '';
        return !!labelMatches(text, CONFIG.labels.discount);
    }


    // =================================================================
    // 8. GHI Ô GIẢM GIÁ (có kiểm chứng)
    // =================================================================

    function writeDiscount(input, value) {
        if (!input) return false;
        const str = String(Math.round(value));
        try { input.setAttribute('aria-valuenow', str); } catch (_) {}
        setNativeValue(input, str);
        fireInput(input, str, 'insertReplacementText');
        fireEnter(input);
        return true;
    }

    // Chỉ dùng khi KHÔNG có ô nào đang được focus (tránh cướp chỗ gõ của bạn)
    function canFocusFallback() {
        const a = document.activeElement;
        return !a || a === document.body || a === document.documentElement;
    }

    function focusFallbackWrite(input, value) {
        if (!input) return;
        const str = String(Math.round(value));
        try { input.focus({ preventScroll: true }); } catch (_) { try { input.focus(); } catch (_) {} }
        try { input.select(); } catch (_) {}
        setNativeValue(input, str);
        fireInput(input, str, 'insertText');
        try {
            if (document.execCommand) document.execCommand('insertText', false, str);
        } catch (_) {}
        fireEnter(input);
        try { input.blur(); } catch (_) {}
    }

    function setStatus(code, text, detail) {
        S.status = { code, text, detail: detail || '' };
    }

    function roundToStep(v, step) {
        if (!step || step <= 1) return Math.round(v);
        return Math.round(v / step) * step;
    }

    function nearly(a, b, tol) {
        return Math.abs(Number(a) - Number(b)) <= (tol == null ? 1 : tol);
    }


    // =================================================================
    // 9. BỘ ĐIỀU KHIỂN GIẢM GIÁ (vòng lặp: ghi -> đọc lại -> sửa sai)
    // =================================================================

    function orderSignature() {
        return [
            S.convKey,
            S.target ? S.target.value : 0,
            getProductCodeWithSize()
        ].join('|');
    }

    // Mở lại form đơn -> xoá khoá cũ để đơn mới vẫn được tự động điền
    function softReset() {
        W.phase = 'idle';
        W.usedFallback = false;
        S.needSeen = { value: null, count: 0 };
        if (S.attempts >= 99) { S.attempts = 0; S.lockDetail = ''; }
    }

    function resetForNewOrder() {
        W.phase = 'idle';
        W.value = null;
        W.beforeFinal = null;
        W.beforeD = null;
        W.usedFallback = false;
        S.attempts = 0;
        S.manual = false;
        S.manualValue = null;
        S.lockDetail = '';
        S.needSeen = { value: null, count: 0 };
    }

    function autoDiscount(root) {
        const now = Date.now();
        const sig = orderSignature();
        if (sig !== S.sig) {
            S.sig = sig;
            resetForNewOrder();
        }

        const form = readForm(root);

        if (S.manual) {
            const cur = form.discount ? form.discount.value : null;
            if (cur === null) return;
            if (cur === 0) {                       // bạn đã xoá trắng -> trả quyền lại
                S.manual = false;
                S.manualValue = null;
            } else if (S.manualValue != null && cur !== S.manualValue) {
                S.manual = false;                  // ai đó/app đổi giá trị -> cho phép chạy lại
                S.manualValue = null;
            } else {
                setStatus('manual', 'Bạn đã sửa tay · ' + money(cur),
                    'Giữ nguyên số bạn nhập. Bấm ⚙ → "Bỏ khoá sửa tay" nếu muốn script tự tính lại.');
                return;
            }
        }

        // ---------- chu trình ghi đang chạy ----------
        if (W.phase !== 'idle') {
            if (now < W.deadline) return;

            if (W.phase === 'verify') {
                const cur = form.discount && form.discount.input
                    ? parseInputNumber(form.discount.input.value)
                    : null;
                if (cur === null || !nearly(cur, W.value, 1)) {
                    if (!W.usedFallback && canFocusFallback()) {
                        W.usedFallback = true;
                        focusFallbackWrite(form.discount && form.discount.input, W.value);
                        W.deadline = now + CONFIG.verifyMs;
                        setStatus('writing', 'Ghi lại ' + money(W.value), 'Ô giảm giá chưa nhận giá trị, đang thử cách 2.');
                        return;
                    }
                    setStatus('writefail', 'Không ghi được ô giảm giá',
                        'Ô Giảm giá không nhận giá trị (bị khoá / app chặn nhập tự động).');
                    W.phase = 'idle';
                    S.lockDetail = 'Ô Giảm giá không nhận giá trị đã ghi (bị khoá hoặc app chặn).';
                    S.attempts = 99;
                    return;
                }
                W.phase = 'settle';
                W.deadline = now + CONFIG.settleMs;
                return;
            }

            if (W.phase === 'settle') {
                W.phase = 'idle';
                evaluateWrite(form);
                return;
            }
            return;
        }

        // ---------- điều kiện ----------
        if (!S.target) {
            setStatus('notarget', 'Chưa có tổng đơn', 'Chưa thấy "tổng đơn / chốt đơn" trong chat.');
            return;
        }
        if (S.cfg.maxAge > 0 && S.target.age > S.cfg.maxAge) {
            setStatus('stale', 'Tổng đơn đã cũ',
                'Tổng đơn nằm cách ' + S.target.age + ' dòng nên KHÔNG tự ghi (tránh giảm sai). Hãy chốt lại tổng đơn.');
            return;
        }
        if (!form.discount) {
            setStatus('noinput', 'Chưa thấy ô Giảm giá', 'Chưa tìm thấy dòng có nhãn chính xác "Giảm giá".');
            return;
        }
        if (!form.discount.input) {
            setStatus('noinput2', 'Dòng Giảm giá không có ô nhập', 'Kiểm tra lại form đơn.');
            return;
        }
        if (!Number.isFinite(form.finalPrice)) {
            setStatus('nofinal', 'Chưa thấy Thành tiền', 'Không đọc được "Thành tiền" của đơn.');
            return;
        }
        if (S.attempts >= 99) {
            setStatus('locked', 'Đã khoá đơn này',
                (S.lockDetail ? S.lockDetail + ' ' : '') +
                'Đơn này không ghi nữa — đổi tổng đơn, bấm ⚙ "Bỏ khoá" hoặc tải lại trang.');
            return;
        }
        if (now - S.lastWriteAt < CONFIG.writeCooldown) return;
        if (document.activeElement === form.discount.input) {
            setStatus('editing', 'Đang gõ ô giảm giá…', 'Bạn đang nhập — không ghi đè.');
            return;
        }
        if (now - S.formAt < CONFIG.formStableMs) return;

        const T = S.target.value;
        const F = form.finalPrice;
        const D = form.discount.value || 0;
        const base = F + D;               // giá trị đơn trước khi trừ phần giảm giá của ô này
        const need = base - T;

        log('giá', { T, F, D, base, need, attempts: S.attempts });

        if (Math.abs(need) <= S.cfg.tolerance) {
            S.needSeen = { value: null, count: 0 };
            setStatus('ok', money(F) + ' ✓',
                'Thành tiền khớp tổng đơn (lệch ' + money(need) + ' → trong mức cho phép ' + money(S.cfg.tolerance) + ').');
            return;
        }

        if (need < 0) {
            S.needSeen = { value: null, count: 0 };
            setStatus('waiting', 'Chờ thêm SP · ' + money(base),
                'Giá trị đơn ' + money(base) + ' < tổng đơn ' + money(T) +
                ' → đang chờ thêm sản phẩm, CHƯA giảm giá.' +
                (form.goods ? ' (Tiền hàng: ' + money(form.goods) + ')' : ''));
            return;
        }

        if (need > S.cfg.maxDiscount) {
            setStatus('danger', 'Lệch quá lớn',
                'Cần giảm ' + money(need) + ' > mức tối đa ' + money(S.cfg.maxDiscount) + '. Kiểm tra lại đơn.');
            return;
        }
        if (base > 0 && need / base > S.cfg.maxRatio / 100) {
            setStatus('danger', 'Tỉ lệ quá lớn',
                'Cần giảm ' + Math.round(need / base * 100) + '% giá trị đơn. Kiểm tra lại đơn.');
            return;
        }
        if (need > base) {
            setStatus('danger', 'Số giảm vượt giá trị đơn', 'Dừng để tránh âm tiền.');
            return;
        }

        // giá phải đứng yên vài nhịp mới ghi lần đầu (tránh đọc lúc app đang tính lại)
        if (S.attempts === 0) {
            const key = Math.round(need / 500);
            if (S.needSeen.value === key) S.needSeen.count++;
            else S.needSeen = { value: key, count: 1 };
            if (S.needSeen.count < CONFIG.stableTicks) {
                setStatus('settling', 'Đang quan sát',
                    'Cần giảm ' + money(need) + ' — chờ giá ổn định rồi mới ghi.');
                return;
            }
        }

        let value = S.attempts === 0 ? roundToStep(need, S.cfg.step) : Math.round(need);
        if (value < 0) value = 0;
        if (value > base) value = base;

        if (nearly(D, value, 1)) {
            setStatus('ok', money(F) + ' ✓', 'Ô Giảm giá đã đúng giá trị cần thiết.');
            return;
        }

        W.phase = 'verify';
        W.value = value;
        W.beforeFinal = F;
        W.beforeD = D;
        W.usedFallback = false;
        W.deadline = now + CONFIG.verifyMs;
        S.attempts++;
        S.lastWriteAt = now;

        writeDiscount(form.discount.input, value);
        setStatus('writing', 'Ghi ' + money(value) + ' → ' + money(T),
            'Đặt Giảm giá = ' + money(value) + ' để Thành tiền = ' + money(T) + '.');
    }

    function evaluateWrite(form) {
        const T = S.target ? S.target.value : null;
        const F = form.finalPrice;
        if (!Number.isFinite(F) || T == null) return;

        const err = F - T;
        log('kiểm chứng', { F, T, err, attempts: S.attempts });

        if (Math.abs(err) <= S.cfg.tolerance) {
            setStatus('applied', money(F) + ' ✓',
                'Đã giảm xong: Thành tiền ' + money(F) + ' = tổng đơn ' + money(T) + ' (lệch ' + money(err) + ').');
            return;
        }

        // ghi xong mà Thành tiền không nhúc nhích -> ghi sai chỗ / ô vô tác dụng
        if (W.beforeFinal != null && Math.abs(F - W.beforeFinal) < 500 &&
            Math.abs((W.value || 0) - (W.beforeD || 0)) >= 1000) {
            setStatus('noeffect', 'Giảm giá không tác động Thành tiền',
                'Đã ghi ' + money(W.value) + ' nhưng Thành tiền không đổi → dừng để tránh sai.');
            S.lockDetail = 'Ô Giảm giá đã ghi ' + money(W.value) + ' nhưng Thành tiền không đổi.';
            S.attempts = 99;
            return;
        }

        if (S.attempts >= CONFIG.maxAttempts) {
            setStatus('failed', 'Lệch ' + money(err),
                'Đã thử ' + S.attempts + ' lần: Thành tiền ' + money(F) +
                ' vẫn lệch tổng đơn ' + money(T) + '. Kiểm tra tay.');
            S.lockDetail = 'Đã thử ' + S.attempts + ' lần: Thành tiền ' + money(F) +
                ' vẫn lệch tổng đơn ' + money(T) + '.';
            S.attempts = 99;
            return;
        }

        setStatus('adjust', 'Chỉnh lại (lệch ' + money(err) + ')',
            'Thành tiền ' + money(F) + ' lệch ' + money(err) + ' → sẽ chỉnh tiếp.');
        // tick sau: need = base - T = D + err  → tự hiệu chỉnh
    }


    // =================================================================
    // 10. TỰ ĐIỀN MÃ SẢN PHẨM + SIZE
    // =================================================================

    function isLikelyCode(t) {
        const s = norm(t);
        if (!s || s.length > 12) return false;
        if (/[/\\]/.test(s)) return false;
        return /\d/.test(s) && /[A-Za-zÀ-ỹ]/.test(s);
    }

    let codeCache = { value: '', at: 0 };

    // Đã kiểm chứng: #listShowTags hàng 3 item 4 là tag mã SP (VD "M20")
    function getProductCode() {
        if (Date.now() - codeCache.at < 2000) return codeCache.value;

        let value = '';
        const fixed = q(document, CONFIG.productCodeTag);
        const fixedText = stripSizeSuffix(fixed ? norm(fixed.textContent) : '');
        if (fixedText && fixedText.length <= 12 && /\d/.test(fixedText)) {
            value = fixedText;
        } else {
            const list = q(document, CONFIG.tagList);
            if (list) {
                const tags = qa(list, '.btn-tag-item')
                    .map(b => stripSizeSuffix(norm(b.textContent)))
                    .filter(isLikelyCode);
                if (tags.length) value = tags[tags.length - 1];
            }
        }
        codeCache = { value, at: Date.now() };
        return value;
    }

    // Tag có thể ghi kèm size ("M20 L") -> bỏ size vì script tự ghép size
    function stripSizeSuffix(text) {
        const s = norm(text);
        const m = s.match(/^(.*?)[\s\-]+(5xl|4xl|3xl|2xl|xxl|xxxl|xl|xs|s|m|l|f)$/i);
        if (m && m[1] && /\d/.test(m[1])) return norm(m[1]);
        return s;
    }

    function getProductCodeWithSize() {
        const base = getProductCode();
        if (!base) return '';
        const size = S.sizeOrder || S.size;
        return size ? (base + ' ' + size) : base;
    }

    function isProductSearch(el) {
        if (!el || !el.matches) return false;
        try { return el.matches(CONFIG.productSearchLoose); } catch (_) { return false; }
    }

    // Điền sẵn mã khi ô tìm kiếm còn TRỐNG (bản 12.1 cũng điền sẵn, không cần bấm)
    function prefillProductSearch(root) {
        const input = qa(root || document, CONFIG.productSearchLoose).filter(shown)[0];
        if (!input) return;
        if (document.activeElement === input) return;
        fillProductSearch(input);
    }

    function fillProductSearch(input) {
        if (!S.cfg.enabled || S.cfg.paused) return;
        if (!input || !shown(input)) return;

        const code = getProductCodeWithSize();
        if (!code) return;

        const cur = norm(input.value);
        if (cur === code) return;
        if (cur && cur !== norm(S.lastFilledCode)) return;   // bạn đang gõ nội dung khác

        S.lastFilledCode = code;
        setNativeValue(input, code);
        fireInput(input, code, 'insertText');
        try { input.setSelectionRange(code.length, code.length); } catch (_) {}
        log('điền mã SP', code);
    }


    // =================================================================
    // 11. TỰ ĐIỀN ĐỊA CHỈ
    // =================================================================

    function autoFillAddress(root) {
        if (!S.cfg.enabled || S.cfg.paused) return;
        if (!S.address) return;

        const input = getAddressInput(root);
        if (!input) return;

        const want = norm(S.address);
        const cur = norm(input.value);

        if (cur === want) { S.addressFilled = want; return; }
        if (cur && cur !== norm(S.addressFilled)) return;   // bạn đã nhập tay -> tôn trọng
        if (S.addressFilled === want) return;
        if (document.activeElement === input) return;
        if (Date.now() - S.formAt < 600) return;

        setNativeValue(input, S.address);
        fireInput(input, S.address, 'insertText');
        S.addressFilled = want;
        log('điền địa chỉ', S.address);
    }


    // =================================================================
    // 11b. CHẨN ĐOÁN (để biết script "không thấy" cái gì)
    // =================================================================

    function describeEl(el) {
        if (!el) return 'KHÔNG tìm thấy';
        const cls = String(el.className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
        return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
    }

    function diagnose() {
        const L = [];
        const cands = qa(document, CONFIG.swipePane);
        const opens = cands.filter(e => paneVisible(e, true));

        L.push('URL: ' + String(location.href).slice(0, 110));
        L.push('');
        L.push('— KHUNG ĐƠN —');
        L.push('#customerCol: ' + (q(document, CONFIG.customerCol) ? 'CÓ' : 'KHÔNG'));
        L.push('pane [data-swipeable] / .swipeable-view-order: ' +
            cands.length + ' / ' + qa(document, '.swipeable-view-order').length +
            ' (đang hiện: ' + opens.length + ')');
        if (opens.length) L.push('  pane đang hiện: ' + opens.map(describeEl).join(', '));

        const roots = ['form', '[class*="order" i]', '.ant-drawer-body', '.ant-modal-content'];
        const vi = pickVisibleCandidate(qa(document, roots.join(', ')));
        L.push('Ứng viên form đang hiện tốt nhất: ' + (vi ? describeEl(vi.el) + ' (điểm ' + vi.score + ')' : 'KHÔNG'));

        const root = findOrderFormRoot();
        L.push('Khu form đơn dùng được: ' + describeEl(root));
        const f = readForm(root);
        L.push('  · ô Giảm giá: ' + (f.discount && f.discount.input ? 'CÓ' : 'KHÔNG') +
            ' | giá trị hiện tại: ' + (f.discount ? money(f.discount.value) : '—'));
        L.push('  · Thành tiền: ' + (Number.isFinite(f.finalPrice) ? money(f.finalPrice) + ' đ' : 'KHÔNG đọc được') +
            (f.finalEl ? '  (' + describeEl(f.finalEl) + ')' : ''));
        L.push('  · Tổng tiền hàng: ' + (f.goods != null ? money(f.goods) : '—') +
            ' | Phí vận chuyển: ' + (f.shipping != null ? money(f.shipping) : '—'));

        const search = qa(document, CONFIG.productSearchLoose).filter(isVisible);
        L.push('Ô tìm kiếm SP: ' + qa(document, 'input[type="search"]').length +
            ' (đang hiện: ' + search.length + ') | giá trị: ' + (search[0] ? norm(search[0].value) || 'trống' : '—'));
        const addrEl = getAddressInput(root);
        L.push('Ô địa chỉ (#shippingAddress): ' + (q(document, CONFIG.address) ? 'CÓ' : 'KHÔNG') +
            ' | đang hiện: ' + (addrEl ? 'CÓ' : 'KHÔNG') + ' | giá trị: ' + (addrEl ? norm(addrEl.value) || 'trống' : '—'));
        L.push('Ô nhập số (ant-input-number-input) toàn trang: ' + qa(document, CONFIG.inputNumber).length);

        const dLabels = qa(document, 'span, div, label, p, td, th')
            .filter(el => !el.children.length && labelMatches(el.textContent, CONFIG.labels.discount));
        L.push('Nhãn "Giảm giá" (đúng chữ) toàn trang: ' + dLabels.length +
            (dLabels.length ? ' — vd: ' + dLabels.slice(0, 3).map(el => describeEl(el)).join(', ') : ''));

        L.push('');
        L.push('— CHAT —');
        L.push('ô chat #message-col-list: ' + (q(document, CONFIG.messageCol) ? 'CÓ' : 'KHÔNG') +
            ' | ' + S.lines.length + ' dòng đọc được');
        L.push('Tổng đơn: ' + (S.target
            ? money(S.target.value) + ' đ (cách ' + S.target.age + ' dòng)' + (S.target.assumed ? ' [đoán đơn vị]' : '')
            : 'KHÔNG thấy'));
        if (S.target) L.push('  dòng: "' + S.target.line + '"');
        L.push('Size: ' + (S.size || '—') + ' | mã SP: ' + (getProductCode() || '—') +
            ' | mã + size: ' + (getProductCodeWithSize() || '—'));
        L.push('Địa chỉ nhận diện: ' + (S.address || '—'));
        L.push('');
        L.push('— TRẠNG THÁI —');
        L.push('Bật: ' + (S.cfg.enabled ? 'CÓ' : 'KHÔNG') + ' | Tạm dừng: ' + (S.cfg.paused ? 'CÓ' : 'KHÔNG'));
        L.push(S.status.text + (S.status.detail ? ' — ' + S.status.detail : ''));
        L.push('sai số: ' + money(S.cfg.tolerance) + ' | bước: ' + money(S.cfg.step) +
            ' | giảm tối đa: ' + money(S.cfg.maxDiscount) +
            ' | tỉ lệ: ' + S.cfg.maxRatio + '% | tuổi tổng đơn tối đa: ' +
            (S.cfg.maxAge ? S.cfg.maxAge + ' dòng' : 'không giới hạn'));
        return L.join('\n');
    }


    // =================================================================
    // 12. GIAO DIỆN TỐI GIẢN (1 nút BẬT/TẮT + 1 nút TẠM DỪNG)
    // =================================================================

    const UI = {};

    function uiStyle() {
        return [
            '#pld-bar{position:fixed;z-index:2147483000;display:flex;align-items:center;gap:6px;',
            'background:#0f172a;color:#e5e7eb;border-radius:999px;padding:5px 8px;',
            'font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
            'box-shadow:0 6px 18px rgba(0,0,0,.35);user-select:none;cursor:move;opacity:.95}',
            '#pld-bar button{border:0;border-radius:999px;padding:4px 8px;font:700 11px/1 inherit;',
            'cursor:pointer;color:#0f172a;background:#e2e8f0}',
            '#pld-bar button:hover{filter:brightness(1.08)}',
            '#pld-bar #pld-toggle{background:#22c55e;color:#052e16;min-width:44px}',
            '#pld-bar #pld-toggle.off{background:#94a3b8;color:#1e293b}',
            '#pld-bar #pld-pause{background:#fbbf24;color:#4a2c00}',
            '#pld-bar #pld-pause.on{background:#f97316;color:#3b1a00}',
            '#pld-bar #pld-gear{background:#334155;color:#cbd5e1}',
            '#pld-dot{width:9px;height:9px;border-radius:50%;background:#94a3b8;flex:0 0 auto}',
            '#pld-text{max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '#pld-panel{position:fixed;z-index:2147483000;display:none;width:252px;',
            'background:#0b1220;color:#e5e7eb;border:1px solid #1e293b;border-radius:12px;padding:10px;',
            'font:500 12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
            'box-shadow:0 10px 30px rgba(0,0,0,.45)}',
            '#pld-panel.open{display:block}',
            '#pld-panel .pld-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 0}',
            '#pld-panel label{color:#94a3b8}',
            '#pld-panel input[type=number],#pld-panel select{width:104px;background:#111c2e;color:#e5e7eb;',
            'border:1px solid #1e293b;border-radius:6px;padding:2px 6px;font:inherit}',
            '#pld-panel button{width:100%;margin-top:6px;border:0;border-radius:8px;padding:6px;',
            'background:#334155;color:#e2e8f0;font:600 12px/1 inherit;cursor:pointer}',
            '#pld-panel .pld-note{color:#64748b;font-size:11px;margin-top:6px}',
            '#pld-diag{position:fixed;z-index:2147483001;display:none;width:430px;max-width:92vw;',
            'background:#0b1220;color:#e5e7eb;border:1px solid #1e293b;border-radius:12px;padding:10px;',
            'font:500 12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
            'box-shadow:0 12px 34px rgba(0,0,0,.5)}',
            '#pld-diag.open{display:block}',
            '#pld-diag .pld-dd-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-weight:700;color:#7dd3fc}',
            '#pld-diag .pld-dd-head button{margin-left:auto;border:0;border-radius:6px;padding:3px 8px;',
            'background:#334155;color:#e2e8f0;font:600 11px/1 inherit;cursor:pointer}',
            '#pld-diag .pld-dd-head button+button{margin-left:0}',
            '#pld-diag pre{margin:0;max-height:52vh;overflow:auto;white-space:pre-wrap;word-break:break-word;',
            'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cbd5e1}'
        ].join('');
    }

    function initUI() {
        if (document.getElementById('pld-bar')) return;
        if (!document.body) { setTimeout(initUI, 500); return; }

        const style = document.createElement('style');
        style.id = 'pld-style';
        style.textContent = uiStyle();
        (document.head || document.documentElement).appendChild(style);

        const bar = document.createElement('div');
        bar.id = 'pld-bar';
        bar.innerHTML =
            '<span id="pld-dot"></span>' +
            '<span id="pld-text">Lên đơn 13.0</span>' +
            '<button id="pld-toggle" title="Bật / Tắt toàn bộ tự động điền">BẬT</button>' +
            '<button id="pld-pause" title="Tạm dừng / Tiếp tục tự động điền">⏸</button>' +
            '<button id="pld-gear" title="Cài đặt">⚙</button>';
        document.body.appendChild(bar);

        const panel = document.createElement('div');
        panel.id = 'pld-panel';
        panel.innerHTML =
            '<div class="pld-row"><label>Bước giảm giá</label>' +
            '<select id="pld-step"><option value="1000">1.000</option>' +
            '<option value="5000">5.000</option><option value="10000">10.000</option></select></div>' +
            '<div class="pld-row"><label>Sai số cho phép</label>' +
            '<select id="pld-tol"><option value="1000">1.000</option><option value="2000">2.000</option>' +
            '<option value="5000">5.000</option><option value="10000">10.000</option></select></div>' +
            '<div class="pld-row"><label>Giảm tối đa</label>' +
            '<input id="pld-max" type="number" step="10000" min="0"></div>' +
            '<div class="pld-row"><label>Tỉ lệ tối đa (%)</label>' +
            '<input id="pld-ratio" type="number" step="5" min="1" max="100"></div>' +
            '<div class="pld-row"><label>Bỏ qua tổng đơn cũ hơn</label>' +
            '<select id="pld-age"><option value="40">40 dòng</option><option value="80">80 dòng</option>' +
            '<option value="200">200 dòng</option><option value="0">Không giới hạn</option></select></div>' +
            '<div class="pld-row"><label><input type="checkbox" id="pld-debug"> Ghi log</label><span></span></div>' +
            '<button id="pld-rearm">Bỏ khoá "sửa tay" cho đơn này</button>' +
            '<button id="pld-diagbtn">Chẩn đoán (Ctrl+Shift+D)</button>' +
            '<div class="pld-note">Tự động điền: mã SP + size → ô tìm kiếm, địa chỉ, ô Giảm giá.</div>';
        document.body.appendChild(panel);

        const diag = document.createElement('div');
        diag.id = 'pld-diag';
        diag.innerHTML =
            '<div class="pld-dd-head"><span>Chẩn đoán tự động điền</span>' +
            '<button id="pld-ddcopy">Copy</button><button id="pld-ddclose">✕</button></div>' +
            '<pre id="pld-ddtext"></pre>';
        document.body.appendChild(diag);

        UI.bar = bar;
        UI.panel = panel;
        UI.diag = diag;
        UI.diagText = diag.querySelector('#pld-ddtext');
        UI.dot = bar.querySelector('#pld-dot');
        UI.text = bar.querySelector('#pld-text');
        UI.toggle = bar.querySelector('#pld-toggle');
        UI.pause = bar.querySelector('#pld-pause');
        UI.gear = bar.querySelector('#pld-gear');

        const step = panel.querySelector('#pld-step');
        const tol = panel.querySelector('#pld-tol');
        const max = panel.querySelector('#pld-max');
        const ratio = panel.querySelector('#pld-ratio');
        const age = panel.querySelector('#pld-age');
        const debug = panel.querySelector('#pld-debug');

        const syncPanel = () => {
            step.value = String(S.cfg.step);
            tol.value = String(S.cfg.tolerance);
            max.value = String(S.cfg.maxDiscount);
            ratio.value = String(S.cfg.maxRatio);
            age.value = String(S.cfg.maxAge);
            debug.checked = !!S.cfg.debug;
        };
        syncPanel();

        step.addEventListener('change', () => { S.cfg.step = Number(step.value) || 10000; saveCfg(); });
        tol.addEventListener('change', () => { S.cfg.tolerance = Number(tol.value) || 5000; saveCfg(); });
        max.addEventListener('change', () => { S.cfg.maxDiscount = Math.max(0, Number(max.value) || 0); saveCfg(); });
        ratio.addEventListener('change', () => {
            S.cfg.maxRatio = Math.min(100, Math.max(1, Number(ratio.value) || 70));
            syncPanel(); saveCfg();
        });
        age.addEventListener('change', () => { S.cfg.maxAge = Number(age.value) || 0; saveCfg(); });
        debug.addEventListener('change', () => { S.cfg.debug = !!debug.checked; saveCfg(); });

        panel.querySelector('#pld-rearm').addEventListener('click', () => {
            resetForNewOrder();
            setStatus('idle', 'Đã bỏ khoá', 'Có thể tự động ghi lại cho đơn này.');
            renderUI();
        });

        UI.toggle.addEventListener('click', () => {
            S.cfg.enabled = !S.cfg.enabled;
            if (S.cfg.enabled) resetForNewOrder();
            saveCfg();
            renderUI();
        });

        UI.pause.addEventListener('click', () => {
            S.cfg.paused = !S.cfg.paused;
            saveCfg();
            renderUI();
        });

        UI.gear.addEventListener('click', () => {
            panel.classList.toggle('open');
            if (panel.classList.contains('open')) { closeDiag(); positionPanel(); }
        });

        panel.querySelector('#pld-diagbtn').addEventListener('click', openDiag);
        diag.querySelector('#pld-ddclose').addEventListener('click', closeDiag);
        diag.querySelector('#pld-ddcopy').addEventListener('click', () => {
            const text = UI.diagText ? UI.diagText.textContent : '';
            try {
                if (navigator.clipboard) navigator.clipboard.writeText(text);
            } catch (_) {}
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            } catch (_) {}
        });

        // ----- kéo thả -----
        let drag = null;
        bar.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const r = bar.getBoundingClientRect();
            drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!drag) return;
            const w = bar.offsetWidth, h = bar.offsetHeight;
            let left = drag.left + (e.clientX - drag.x);
            let top = drag.top + (e.clientY - drag.y);
            left = Math.max(4, Math.min(window.innerWidth - w - 4, left));
            top = Math.max(4, Math.min(window.innerHeight - h - 4, top));
            drag.moved = true;
            bar.style.left = left + 'px';
            bar.style.top = top + 'px';
            bar.style.right = 'auto';
            bar.style.bottom = 'auto';
            positionPanel();
        });
        document.addEventListener('mouseup', () => {
            if (drag && drag.moved) {
                S.cfg.left = parseInt(bar.style.left, 10) || 0;
                S.cfg.top = parseInt(bar.style.top, 10) || 0;
                saveCfg();
            }
            drag = null;
        });

        if (S.cfg.left != null && S.cfg.top != null) {
            const left = Math.max(4, Math.min(window.innerWidth - 60, S.cfg.left));
            const top = Math.max(4, Math.min(window.innerHeight - 40, S.cfg.top));
            bar.style.left = left + 'px';
            bar.style.top = top + 'px';
        } else {
            bar.style.right = '16px';
            bar.style.bottom = '16px';
        }

        positionPanel();
        renderUI();
    }

    function openDiag() {
        if (!UI.diag) return;
        let text = '';
        try { text = diagnose(); } catch (e) { text = 'Lỗi chẩn đoán: ' + e; }
        UI.diagText.textContent = text;
        UI.diag.classList.add('open');
        if (UI.panel) UI.panel.classList.remove('open');
        try { console.log('[Lên đơn 13.0] CHẨN ĐOÁN\n' + text); } catch (_) {}
        const r = (UI.bar || UI.diag).getBoundingClientRect();
        const w = UI.diag.offsetWidth || 430;
        const h = UI.diag.offsetHeight || 400;
        let left = Math.min(Math.max(8, r.left - w + (UI.bar ? UI.bar.offsetWidth : 0)), window.innerWidth - w - 8);
        let top = r.top - h - 10;
        if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 10);
        UI.diag.style.left = Math.max(8, left) + 'px';
        UI.diag.style.top = Math.max(8, top) + 'px';
    }

    function closeDiag() {
        if (UI.diag) UI.diag.classList.remove('open');
    }

    function positionPanel() {
        if (!UI.bar || !UI.panel) return;
        const r = UI.bar.getBoundingClientRect();
        const ph = UI.panel.offsetHeight || 260;
        let top = r.top - ph - 8;
        if (top < 8) top = r.bottom + 8;
        let left = r.left;
        left = Math.max(8, Math.min(window.innerWidth - (UI.panel.offsetWidth || 252) - 8, left));
        UI.panel.style.left = left + 'px';
        UI.panel.style.top = top + 'px';
    }

    const DOT = {
        off: '#94a3b8', paused: '#f59e0b', idle: '#64748b', ok: '#22c55e',
        applied: '#22c55e', writing: '#a855f7', adjust: '#f97316',
        waiting: '#3b82f6', settling: '#38bdf8', notarget: '#64748b',
        noinput: '#f97316', noinput2: '#f97316', nofinal: '#f97316',
        danger: '#ef4444', failed: '#ef4444', writefail: '#ef4444',
        noeffect: '#ef4444', stale: '#f59e0b', manual: '#eab308',
        locked: '#ef4444', editing: '#38bdf8'
    };

    function renderUI() {
        if (!UI.bar) return;

        if (!S.cfg.enabled) {
            UI.toggle.textContent = 'TẮT';
            UI.toggle.classList.add('off');
            UI.text.textContent = 'Tự động điền đang TẮT';
            UI.dot.style.background = DOT.off;
            UI.pause.classList.remove('on');
            UI.pause.textContent = '⏸';
            updateTip('Đang tắt');
            return;
        }

        UI.toggle.textContent = 'BẬT';
        UI.toggle.classList.remove('off');
        UI.pause.textContent = S.cfg.paused ? '▶' : '⏸';
        UI.pause.classList.toggle('on', !!S.cfg.paused);

        let code = S.status.code;
        let text = S.status.text;
        if (S.cfg.paused) { code = 'paused'; text = 'Tạm dừng'; }
        else if (code === 'idle' || code === 'off' || !code) {
            if (!S.formOpen) { code = 'idle'; text = 'Chưa mở form đơn'; }
            else if (!S.target) { code = 'notarget'; text = 'Chưa có tổng đơn'; }
        }

        UI.dot.style.background = DOT[code] || '#94a3b8';
        UI.text.textContent = text || 'Lên đơn 13.0';
        updateTip(text);
    }

    function updateTip(text) {
        if (!UI.bar) return;
        UI.bar.title =
            'Trạng thái: ' + (text || '') +
            (S.status.detail ? '\n' + S.status.detail : '') +
            '\nTổng đơn: ' + (S.target
                ? money(S.target.value) + ' đ' + (S.target.assumed ? ' (đoán đơn vị)' : '')
                : '—') +
            '\nMã SP + size: ' + (getProductCodeWithSize() || '—') +
            '\nĐịa chỉ: ' + (S.address || '—');
    }


    // =================================================================
    // 13. TICK
    // =================================================================

    function getConversationKey() {
        const item = q(document, CONFIG.selectedConv);
        if (item) {
            const holder = item.closest('[id]');
            if (holder && holder.id) return holder.id;
            const name = q(item, '.name-text');
            if (name) return norm(name.textContent).slice(0, 40);
        }
        return '';
    }

    function tick() {
        const now = Date.now();
        if (now - S.lastTickAt < CONFIG.minTickGap) return;
        S.lastTickAt = now;

        try {
            scanChat();

            const prevConv = S.convKey;
            S.convKey = getConversationKey();
            if (S.convKey !== prevConv) {
                S.lastFilledCode = '';
                S.addressFilled = '';
            }

            const root = findOrderFormRoot();
            if (root && !S.formOpen) {
                S.formAt = Date.now();
                softReset();
            }
            S.formOpen = !!root;

            const desc = describeEl(root);
            if (S.cfg.debug && desc !== S.rootDesc) {
                S.rootDesc = desc;
                log('khu form đơn:', desc);
            }

            if (!S.cfg.enabled) {
                setStatus('off', 'Đang tắt', '');
                if (W.phase !== 'idle') W.phase = 'idle';
            } else if (S.cfg.paused) {
                setStatus('paused', 'Tạm dừng', '');
                if (W.phase !== 'idle') W.phase = 'idle';
            } else if (!root) {
                setStatus('idle', 'Chưa mở form đơn', 'Mở tab "Tạo đơn" ở cột phải để script tự điền.');
                if (W.phase !== 'idle') W.phase = 'idle';
            } else {
                prefillProductSearch(root);
                autoFillAddress(root);
                autoDiscount(root);
            }
        } catch (e) {
            warn('tick lỗi:', e);
        }

        renderUI();
    }

    function scheduleTick() {
        clearTimeout(scheduleTick.timer);
        scheduleTick.timer = setTimeout(tick, CONFIG.chatDebounce);
    }

    function startObserver() {
        if (!document.body) { setTimeout(startObserver, 400); return; }
        const targets = [q(document, CONFIG.messageCol), q(document, CONFIG.customerCol)];
        const list = targets.filter(Boolean);
        if (!list.length) list.push(document.body);

        list.forEach(target => {
            const ob = new MutationObserver(scheduleTick);
            ob.observe(target, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['value', 'aria-valuenow', 'aria-hidden', 'class', 'style']
            });
        });
    }


    // =================================================================
    // 14. SỰ KIỆN
    // =================================================================

    // click / focus vào ô tìm kiếm sản phẩm -> tự điền mã SP + size
    document.addEventListener('click', (e) => {
        if (isProductSearch(e.target)) fillProductSearch(e.target);
    }, true);

    document.addEventListener('focusin', (e) => {
        if (isProductSearch(e.target)) fillProductSearch(e.target);
    }, true);

    // phát hiện NGƯỜI DÙNG sửa tay ô Giảm giá (event thật: isTrusted = true)
    function onUserEditDiscount(e) {
        if (!e.isTrusted) return;
        const t = e.target;
        if (!isDiscountInput(t)) return;

        const parsed = parseInputNumber(t.value);
        if (parsed === 0) {
            S.manual = false;
            S.manualValue = null;
            setStatus('idle', 'Ô giảm giá trống', 'Bạn đã xoá tay — script sẽ tự tính lại.');
        } else {
            S.manual = true;
            S.manualValue = parsed;
            S.attempts = 0;
            W.phase = 'idle';
            setStatus('manual', 'Bạn đã sửa tay · ' + money(parsed),
                'Giữ nguyên số bạn nhập cho đơn này. Bấm ⚙ → "Bỏ khoá sửa tay" nếu muốn script ghi lại.');
        }
        renderUI();
    }

    document.addEventListener('keydown', onUserEditDiscount, true);
    document.addEventListener('input', onUserEditDiscount, true);

    // Ctrl+Shift+D: mở bảng chẩn đoán (biết script đang "thấy" gì)
    document.addEventListener('keydown', (e) => {
        if (!e.ctrlKey || !e.shiftKey) return;
        if (String(e.key).toLowerCase() !== 'd') return;
        e.preventDefault();
        openDiag();
    }, true);


    // =================================================================
    // 15. KHỞI ĐỘNG
    // =================================================================

    try { initUI(); } catch (e) { warn('initUI lỗi:', e); }
    try { startObserver(); } catch (e) { warn('startObserver lỗi:', e); }
    setInterval(tick, CONFIG.scanInterval);
    setTimeout(tick, 800);

    // Nếu chưa từng tạo được giao diện, thử lại vài lần (trang render chậm)
    let bootTry = 0;
    const bootTimer = setInterval(() => {
        bootTry++;
        if (document.getElementById('pld-bar')) { clearInterval(bootTimer); return; }
        try { initUI(); } catch (_) {}
        if (bootTry > 40) clearInterval(bootTimer);
    }, 500);

})();
