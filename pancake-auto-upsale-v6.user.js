// ==UserScript==
// @name         Pancake Auto Upsale V6 (Dãy cùng snippet · Gửi hết khách bên dưới)
// @namespace    http://tampermonkey.net/
// @version      6.1
// @description  2 chế độ. (1) DÃY: chỉ gửi hội thoại LIỀN NHAU và có .snippet-text GIỐNG HỆT hội thoại ở dấu đỏ. (2) BÊN DƯỚI: gửi hết mọi hội thoại còn class "unread" (khách đã trả lời) từ dấu đỏ trở xuống, tự cuộn danh sách, dừng khi gặp hội thoại đã đọc đầu tiên. Selector đối chiếu từ html.txt / html2.txt / html3.txt + _app-*.v6.js + pancake.vn2.har.
// @match        *://*.pancake.vn/*
// @grant        GM_getClipboard
// @run-at       document-end
// @noframes
// ==/UserScript==

/*
 * ============================================================
 *  V6 — GỬI THEO "DÃY" (contiguous run khớp snippet)
 *
 *  Yêu cầu: "chạy thay vì chạy bừa bãi, hãy xem các đoạn chat có snippet
 *  giống đoạn chat ở vị trí chấm đỏ và gửi tin nhắn vào tất cả các đoạn chat
 *  đó (các đoạn chat đó nằm gần nhau thành 1 dãy với đoạn chat ở vị trí
 *  chấm đỏ)".
 *
 *  Cách V5 nhắm sai chỗ (đã bỏ hẳn trong V6):
 *    • scanNextRow() ưu tiên "row kế tiếp sau khách vừa gửi" và
 *      "row đầu tiên chưa xử lý tính từ vị trí đang xử lý" — hai nhánh này
 *      KHÔNG kiểm tra snippet ⇒ khi danh sách xô lệch (khách vừa gửi nhảy
 *      xuống dưới khối chưa đọc, khách mới nhảy lên đầu) nó vẫn click tiếp,
 *      kể cả khi row đó là một đoạn chat KHÁC ⇒ "chạy bừa bãi".
 *
 *  V6 khóa mục tiêu bằng 2 chốt, MỌI row được click đều phải qua đủ 2 chốt:
 *    (1) `.snippet-text` của row PHẢI BẰNG CHÍNH XÁC snippet của khách ở dấu
 *        đỏ (sau khi chuẩn hoá khoảng trắng).
 *    (2) row PHẢI NỐI LIỀN dãy đang xử lý — tức trong danh sách ĐANG RENDER
 *        nó nằm ngay trên/dưới một row đã được xác nhận thuộc dãy.
 *  ⇒ Không bao giờ click ra ngoài dãy chứa khách ở dấu đỏ.
 *
 *  ------------------------------------------------------------
 *  V6.1 — THÊM CHẾ ĐỘ "GỬI HẾT KHÁCH BÊN DƯỚI" (chạy nhanh)
 *
 *  Mục tiêu: mọi hội thoại còn class `unread` (khách đã trả lời, shop chưa
 *  trả lời) nằm TỪ DẤU ĐỎ TRỞ XUỐNG — KHÔNG xét snippet. Dừng khi row gần
 *  nhất còn chưa gửi ở dưới dấu đỏ đã là hội thoại ĐÃ ĐỌC (hết khối khách đã
 *  trả lời) hoặc khi không cuộn được nữa (hết danh sách).
 *
 *  Vì sao phải cuộn bằng sự kiện `wheel`: Pancake KHÔNG cuộn bằng scrollTop —
 *  .rc-virtual-list-holder có `overflow-y:hidden`, React đặt cửa sổ hiển thị
 *  bằng `transform: translateY(...)` trên .rc-virtual-list-holder-inner
 *  (html2.txt: translateY(3870px) · html3.txt: translateY(0px)). Wheel là thứ
 *  app nghe (rc-virtual-list), nên script bắn wheel rồi chờ cửa sổ render đổi.
 *
 *  Dấu hiệu "khách đã trả lời": class `unread` trên .conversation-list-item
 *  (html3.txt: 11/12 row có · html.txt & html2.txt: 0 row) + badge đỏ
 *  sup.ant-badge-count[title="số tin"].
 *
 *  Tốc độ: "Chờ xác nhận" mặc định TẮT (không chờ Pancake xoá ô soạn), và bỏ
 *  nhịp rAF trước Enter (chỉ nhường 1 macrotask) ⇒ mỗi khách còn: click → dán
 *  → Enter. Đổi lại: nếu Pancake chậm, tin có thể chưa đi mà script đã sang
 *  khách kế — script sẽ cảnh báo trong Console (xem `unsentIds`).
 *
 *  ------------------------------------------------------------
 *  SELECTOR — đối chiếu với source thật trong repo (không đoán)
 *
 *  #conversationList  (html.txt: 9 row · html2.txt: 10 row · html3.txt: 12 row)
 *    class="rc-virtual-list infinite-conv-list" width="310"
 *    └ .rc-virtual-list-holder                (height 651/902px, overflow-y:hidden)
 *        └ div[style="height:...;position:relative;overflow:hidden"]   (khung tổng)
 *            └ .rc-virtual-list-holder-inner   ← MutationObserver gắn ở đây
 *                └ div[id="{pageId}_{peerId}"][offsetx="0"]      ← REAL ID (ỔN ĐỊNH)
 *                      └ div.media.conversation-list-item
 *                        id="{pageId}_{peerId}__{index}"         ← index ảo hoá
 *                        [+ "selected"] [+ "unread"] [+ "is-pinned"/"last-pinned"]
 *                        ├ .media-left.render-avatar-cus
 *                        │    └ .ant-badge.pancake-antd-badge … img.customer-avatar-{peerId}
 *                        │    └ sup.ant-scroll-number.ant-badge-count[title="{count}"]  (chỉ row chưa đọc)
 *                        └ .media-body.body-conver-item
 *                             ├ .name-module > .name-module-text > .name-text   (tên khách)
 *                             ├ .time-modul                                     (giờ)
 *                             ├ .snippet-wrap > .snippet-line > .snippet-text   ← MẤU CHỐT CỦA V6
 *                             └ .tag-wrap … > div.list_tags_conv_{pageId}_{peerId}
 *
 *  Vì sao so snippet bằng === là chính xác:
 *    • `pancake.vn2.har` (GET /api/v1/conversations, payload base64) cho thấy
 *      trường `snippet` do SERVER cắt sẵn: ví dụ
 *        "Chị cho em xin chiều cao + cân nặng em chọn size phù hợp cho ..."
 *      dài đúng 64 ký tự (61 ký tự + "...").
 *    • html.txt row 2 và html3.txt row 4 hiển thị NGUYÊN VĂN chuỗi đó trong
 *      .snippet-text ⇒ DOM không cắt thêm bằng CSS, text = snippet của server.
 *    • Còn `truncateText` trong bundle (_app-9331d46f21a84eb1.v6.js) mặc định
 *      chỉ 16 ký tự nên nó KHÔNG phải thứ render ra danh sách — đừng dùng nó
 *      để suy ra độ dài snippet.
 *
 *  Vì sao dãy luôn nằm trong tầm nhìn khi script chạy (nguồn: bundle, hàm
 *  `ev` (sắp xếp) và `eg` (chèn khi có tin mới)):
 *    • Thứ tự danh sách = [ghim] → [chưa đọc, updated_at giảm dần] →
 *      [đã đọc, updated_at giảm dần]   (unread_first bật mặc định: URL thật
 *      trong POST.txt có `unread_first=true`).
 *    • Gửi xong, hội thoại có seen=true và updated_at=now ⇒ `eg()` chèn nó
 *      vào ĐẦU khối đã đọc, tức nằm DƯỚI toàn bộ khối chưa đọc.
 *    • ⇒ mỗi lần gửi, khối khách chưa trả lời tự trượt LÊN một row và một
 *      khách mới lộ ra ở đáy khung nhìn. Vì vậy chỉ cần quét trong cửa sổ
 *      đang render là đủ, KHÔNG cần tự cuộn danh sách (script không cuộn).
 * ============================================================
 */

(function () {
    'use strict';

    const VERSION = '6.1';

    /* =========================================================
     * SELECTORS — tất cả lấy từ HTML thật
     * =======================================================*/

    const SEL = {
        listRoot:   '#conversationList',
        listInner:  '.rc-virtual-list-holder-inner',
        listHolder: '.rc-virtual-list-holder',        // node có height cố định + overflow-y:hidden
        row:        '.conversation-list-item',
        rowUnread:  '.conversation-list-item.unread', // khách đã trả lời, shop chưa trả lời
        selected:   '.conversation-list-item.selected',
        snippet:    '.snippet-text',
        name:       '.name-text',
        headerName: '#pageCustomer .customer-name'   // html3: span.copyable-text.customer-name
    };

    /*
     * id của ROW = "{realId}__{index}"; index là số thứ tự trong cửa sổ ảo hoá
     * (html2: __45…__54 vì đang cuộn ở giữa danh sách, html3: __0…__11) nên nó
     * ĐỔI khi cuộn/xếp lại. ID thật nằm ở div bọc ngoài và không đổi.
     */
    const RE_ROW_ID  = /^(\d+_\d+)__\d+$/;
    const RE_REAL_ID = /^\d+_\d+$/;   // INBOX: {page_id}_{peer_id} — COMMENT: {post_id}_{peer_id}

    /* Thời gian chờ (ms) */
    const T = {
        composer:  3000,   // chờ #replyBoxComposer xuất hiện
        observer:  3000,   // chờ row kế tiếp của dãy (MutationObserver + poll)
        pollFast:  100,    // nhịp poll dự phòng: nhanh lúc đầu…
        pollMid:   200,    // …thưa dần…
        pollSlow:  300,    // …rồi thưa hẳn (đỡ tốn CPU)
        minGap:    16,     // gộp nhiều mutation thành 1 lần kiểm tra
        pasteHold: 2000,   // dán lại cho tới khi composer GIỮ được nội dung
        sendConfirm: 600,  // chờ Pancake xóa composer = đã gửi xong
        sendConfirmSlow: 0,// chờ thêm khi đi đường chậm (api → extension → socket)
        confirmFast: 150,  // mức "Nhanh" của Chờ xác nhận
        waitShort:  600,   // chờ ngắn trước khi thử cuộn danh sách (chế độ Dãy)
        scrollStep: 0.9,   // cuộn 1 nhịp = 90% khoảng cách từ dấu đỏ tới đáy vùng nhìn (xem scrollDownOnce)
        scrollWait: 900,   // chờ React render lại sau khi cuộn
        maxRunBelow: 5000, // chốt an toàn (kỹ thuật) cho chế độ GỬI HẾT BÊN DƯỚI
        maxRun:    500     // chốt an toàn: tối đa số khách gửi trong 1 dãy
    };

    function pollDelay(elapsed) {
        if (elapsed < 400) return T.pollFast;
        if (elapsed < 1200) return T.pollMid;
        return T.pollSlow;
    }

    /* =========================================================
     * STATE
     * =======================================================*/

    let isRunning = false;
    let isWaitingForEnter = false;
    let manualResolve = null;          // chế độ Auto Enter = OFF: chờ Enter thật

    /** V5.22 — tab có bị ẩn trong lúc xử lý 1 khách (chỉ để dự phòng chẩn đoán). */
    let tabHiddenDuringStep = false;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) tabHiddenDuringStep = true;
    }, true);

    let cachedText = '';
    let autoEnter = false;
    let hotkeyEnabled = false;         // luôn OFF sau reload

    let runToken = 0;

    /* ---------- CHẾ ĐỘ GỬI ----------
     * 'run'   = Dãy cùng snippet (mặc định — an toàn nhất)
     * 'below' = Gửi hết khách đã trả lời (unread) từ dấu đỏ trở xuống
     */
    let sendMode = 'run';
    const isBelowMode = () => sendMode === 'below';

    /* ---------- DÃY (đơn vị làm việc của V6) ---------- */

    let runSnippet  = '';              // snippet của khách Ở DẤU ĐỎ — mẫu của dãy
    let runAnchorId = '';              // REAL ID của khách ở dấu đỏ
    const runIds    = new Set();       // REAL ID mọi row ĐÃ XÁC NHẬN thuộc dãy
    let runBottomSeen = false;         // đã thấy row KHÔNG khớp nằm ngay dưới dãy
    let runStopId   = '';              // REAL ID của row chặn dưới đó (nếu có)

    /* Mọi ID đã bấm gửi trong lượt chạy — chốt chống gửi lặp. */
    const handledIds = new Set();
    /** ID những khách đã bấm Enter nhưng KHÔNG thấy Pancake xóa composer. */
    let unsentIds = [];
    let slowSends = 0;

    let lastCtx = null;                // bối cảnh khách đang xử lý (để chẩn đoán)

    let cachedComposer = null;
    let cachedList = null;

    let activePicker = null;
    let stopSnippet = '';
    let clickPos = null;

    /* Thống kê thời gian mỗi khách */
    let stats = { sent: 0, cycles: 0, totalMs: 0, sendMs: 0, waitMs: 0, min: 0, max: 0 };
    let pendingSend = null;
    let stepStart = 0;
    let sentAt = 0;
    let pastedAt = 0;      // lúc dán xong (mốc cho chế độ Enter thủ công)
    let prevSentId = '';   // khách vừa bấm Enter ở lượt trước (để cảnh báo tin chưa đi)

    function resetStats() {
        stats = { sent: 0, cycles: 0, totalMs: 0, sendMs: 0, waitMs: 0, min: 0, max: 0 };
        pendingSend = null;
        phaseSum = null;
        unsentIds = [];
        slowSends = 0;
        prevSentId = '';
        renderStats();
    }

    function resetRun() {
        runSnippet = '';
        runAnchorId = '';
        runIds.clear();
        runBottomSeen = false;
        runStopId = '';
    }

    /** Pha 1 — vừa bấm Enter xong. */
    function recordSend(sendMs) {
        stats.sent++;
        stats.sendMs += sendMs;
        pendingSend = sendMs;
        renderStats();
        updateRunUI();
    }

    /** Pha 2 — bắt được khách kế: ghép với pha 1 thành 1 chu kỳ. */
    function recordWait(waitMs) {
        if (pendingSend === null) return;
        const total = pendingSend + waitMs;
        pendingSend = null;

        stats.cycles++;
        stats.waitMs += waitMs;
        stats.totalMs += total;
        if (!stats.min || total < stats.min) stats.min = total;
        if (total > stats.max) stats.max = total;

        renderStats();
        console.info(
            `[Pancake Auto] #${stats.cycles} dán ${(total - waitMs).toFixed(0)}ms · chờ ${waitMs.toFixed(0)}ms`
            + phaseText()
        );
    }

    function renderStats() {
        const el = txtStats || document.querySelector('#pk-root [id="pk-stats"]');
        if (!el) return;
        if (!stats.sent) { el.textContent = '📊 Chưa có dữ liệu'; return; }
        const n = stats.cycles || 1;
        const avg = (stats.sendMs + stats.waitMs) / n;
        const avgSend = stats.sendMs / n;
        const avgWait = stats.waitMs / n;
        el.textContent = `📊 ${stats.sent} tin · TB ${(avg / 1000).toFixed(2)}s`
            + ` (dán ${avgSend.toFixed(0)}ms · chờ ${avgWait.toFixed(0)}ms)`
            + (stats.cycles ? ` · ${(stats.min / 1000).toFixed(2)}–${(stats.max / 1000).toFixed(2)}s` : '');
    }

    /* Đo từng đoạn trong pha dán */
    let phaseMs  = null;
    let phaseAt  = 0;
    let pasteTries = 0;

    function phaseReset() {
        phaseAt  = performance.now();
        phaseMs  = { click: 0, composer: 0, paste: 0, nhịp: 0, enter: 0, confirm: 0 };
        pasteTries = 0;
    }

    function phaseMark(key) {
        if (!phaseMs) return;
        const now = performance.now();
        phaseMs[key] = Math.round(now - phaseAt);
        phaseAt = now;
    }

    let phaseSum = null;

    function phaseAccumulate() {
        if (!phaseMs) return;
        if (!phaseSum) phaseSum = { click: 0, composer: 0, paste: 0, nhịp: 0, enter: 0, confirm: 0, tries: 0, n: 0 };
        for (const k of ['click', 'composer', 'paste', 'nhịp', 'enter', 'confirm']) phaseSum[k] += phaseMs[k];
        phaseSum.tries += pasteTries;
        phaseSum.n++;
    }

    function phaseSummary() {
        if (!phaseSum || !phaseSum.n) return;
        const n = phaseSum.n;
        const ms = k => (phaseSum[k] / n).toFixed(0);
        console.info(
            `[Pancake Auto] TỔNG ${n} khách — trung bình mỗi khách:\n` +
            `   click    ${ms('click')} ms   (React mở hội thoại)\n` +
            `   composer ${ms('composer')} ms\n` +
            `   paste    ${ms('paste')} ms   (dán lại ${(phaseSum.tries / n).toFixed(1)} lần/khách)\n` +
            `   nhịp     ${ms('nhịp')} ms   (chờ trước Enter)\n` +
            `   enter    ${ms('enter')} ms   (React gửi)\n` +
            `   xác nhận ${ms('confirm')} ms   (chờ Pancake xóa composer = đã gửi)`
            + (slowSends
                ? `\n   ⏳ ${slowSends}/${n} khách phải đi đường chậm (api → extension/socket)`
                : '')
            + (unsentIds.length
                ? `\n   ⚠ ${unsentIds.length} khách KHÔNG THẤY GỬI: ${unsentIds.join(', ')}`
                : '')
        );
    }

    function phaseText() {
        if (!phaseMs) return '';
        return ` · click ${phaseMs.click} · composer ${phaseMs.composer}`
             + ` · paste ${phaseMs.paste}(${pasteTries} lần)`
             + ` · nhịp ${phaseMs.nhịp} · enter ${phaseMs.enter}`
             + ` · xác nhận ${phaseMs.confirm}`;
    }

    /* =========================================================
     * STORAGE
     * =======================================================*/

    const K = {
        pos:   'pancake_auto_pos_v7',
        ui:    'pancake_auto_ui_v7',
        speed: 'pancake_auto_speed_v7',
        stop:  'pancake_auto_stop_snippet_v1'
    };

    const store = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) return fallback;
                const parsed = JSON.parse(raw);
                return parsed === null || parsed === undefined ? fallback : parsed;
            } catch (err) {
                return fallback;
            }
        },
        set(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {}
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch (err) {}
        }
    };

    /* =========================================================
     * HELPERS
     * =======================================================*/

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /**
     * Chờ 1 nhịp render nhưng KHÔNG bao giờ kẹt: rAF bị dừng khi tab chạy nền,
     * nên race rAF với setTimeout(24ms).
     */
    function nextTick(max = 24) {
        return new Promise(resolve => {
            let done = false;
            const finish = () => { if (done) return; done = true; resolve(); };
            try { requestAnimationFrame(finish); } catch (err) {}
            setTimeout(finish, max);
        });
    }

    /** Chờ Pancake XÓA composer = tin đã gửi xong. */
    async function waitForSent(token, timeout = T.sendConfirm) {
        const until = performance.now() + timeout;
        while (performance.now() < until) {
            if (!isRunning || token !== runToken) return false;
            const box = getComposer();
            if (!box || !String(box.value || '').length) return true;
            await nextTick();
        }
        return false;
    }

    const normalizeText = text => String(text ?? '').replace(/\s+/g, ' ').trim();

    const clampInt = (value, min = 0) => {
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? Math.max(min, n) : min;
    };

    /* =========================================================
     * SPEED SETTINGS
     * =======================================================*/

    const DEFAULT_SPEED = { autoEnter: 0, observer: 3000, gate: 0, enter: 1, upBottom: 1, confirm: 'off' };
    const speed = { ...DEFAULT_SPEED, ...(store.get(K.speed, {}) || {}) };

    const PINNED = { autoEnter: 0, observer: 3000, gate: 0 };

    const D = {
        autoEnter: PINNED.autoEnter,     // "Dán → Gửi" — đã bỏ ô chỉnh
        observer:  PINNED.observer,      // timeout chờ row kế tiếp của dãy
        /*
         * CHỐT AN TOÀN trước Enter — mặc định 0 = TẮT.
         *   > 0: chờ tới khi row có class .selected khớp REAL ID rồi mới Enter.
         */
        gate:      PINNED.gate,
        /*
         * Số lần bấm Enter sau khi dán (1–3). Chỉ đổi khi bạn BẬT tuỳ chọn
         * "Enter 2 lần để chuyển sang tin chưa đọc kế tiếp" trong Pancake.
         */
        enter:     Math.min(3, Math.max(1, clampInt(speed.enter, 1))),
        /*
         * LÙI LÊN TRONG DÃY (mặc định 1 = BẬT).
         * V6 chỉ lùi lên khi row ngay TRÊN row đầu dãy (đang render) CÓ CÙNG
         * snippet ⇒ tức là dãy còn dài thêm về phía trên. Đây KHÔNG phải kiểu
         * "lùi lên ở cuối bảng" của V5.10 (quét từ index 0 = đỉnh cửa sổ ảo
         * hoá) — V6 không bao giờ quét ra ngoài dãy.
         */
        upBottom:  speed.upBottom === 0 ? 0 : 1,
        /*
         * CHỜ XÁC NHẬN GỬI — sau khi bấm Enter có chờ Pancake xoá ô soạn không.
         *   'off'  = KHÔNG chờ (mặc định, nhanh nhất — đổi lại: Pancake chậm thì
         *            tin có thể chưa đi mà script đã sang khách kế)
         *   'fast' = chờ tối đa 150 ms
         *   'full' = chờ 600 ms, chưa thấy thì thử thêm "đường chậm" (bản V5)
         */
        confirm:   ['off', 'fast', 'full'].includes(speed.confirm) ? speed.confirm : 'off'
    };

    function saveSpeed() {
        store.set(K.speed, D);
    }

    /* Dọn các khoá delay đã bị bỏ khỏi giao diện (delay vô hình). */
    (function purgeDeadDelays() {
        const saved = store.get(K.speed, null);
        if (!saved || typeof saved !== 'object') return;
        let dirty = false;
        Object.keys(PINNED).forEach(k => {
            if (Object.prototype.hasOwnProperty.call(saved, k) && saved[k] !== PINNED[k]) {
                delete saved[k];
                dirty = true;
            }
        });
        /* V5 từng lưu các khoá này; V6 không dùng nữa. */
        ['transition', 'snippet', 'conversation'].forEach(k => {
            if (Object.prototype.hasOwnProperty.call(saved, k)) {
                delete saved[k];
                dirty = true;
            }
        });
        if (dirty) store.set(K.speed, saved);
    })();

    /* =========================================================
     * DOM LOOKUP
     * =======================================================*/

    /** #conversationList (chính là div.rc-virtual-list) — node ổn định, cache lại. */
    function getList() {
        if (cachedList && cachedList.isConnected) return cachedList;
        const el = document.getElementById('conversationList');
        cachedList = el && el.isConnected ? el : null;
        return cachedList;
    }

    /** .rc-virtual-list-holder-inner — nơi React gắn/gỡ row. */
    function getListInner() {
        const list = getList();
        return list ? list.querySelector(SEL.listInner) : null;
    }

    function listRows() {
        const list = getList();
        return list ? list.querySelectorAll(SEL.row) : null;
    }

    /** Row (.conversation-list-item) chứa element, có guard nằm trong #conversationList. */
    function getRowFrom(element) {
        if (!element || !element.closest) return null;
        const row = element.closest(SEL.row);
        if (!row) return null;
        return row.closest(SEL.listRoot) ? row : null;
    }

    /**
     * REAL ID — lấy từ div BỌC ngoài row (ổn định), không lấy id của row
     * (id row có hậu tố __{index ảo hoá}).
     */
    function getRealId(row) {
        if (!row) return '';

        const parent = row.parentElement;
        if (parent && RE_REAL_ID.test(parent.id || '')) return parent.id;

        const m = RE_ROW_ID.exec(row.id || '');
        if (m) return m[1];

        let node = row.parentElement;
        for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
            const id = node.id || '';
            if (RE_REAL_ID.test(id)) return id;
        }
        return '';
    }

    const getSnippet = row => {
        const el = row && row.querySelector(SEL.snippet);
        return el ? normalizeText(el.textContent || '') : null;
    };

    const getName = row => {
        const el = row && row.querySelector(SEL.name);
        return el ? normalizeText(el.textContent || '') : '';
    };

    /** Row đang được mở — source: .conversation-list-item.selected */
    function getSelectedRow() {
        const list = getList();
        return list ? list.querySelector(SEL.selected) : null;
    }

    /** Tên khách đang mở — source: #pageCustomer .customer-name */
    const getHeaderName = () => {
        const el = document.querySelector(SEL.headerName);
        return el ? normalizeText(el.textContent || '') : '';
    };

    /** Ô soạn — source: <textarea id="replyBoxComposer"> */
    function getComposer() {
        if (cachedComposer && cachedComposer.isConnected) return cachedComposer;
        cachedComposer = document.getElementById('replyBoxComposer');
        return cachedComposer && cachedComposer.isConnected ? cachedComposer : null;
    }

    /* =========================================================
     * DẤU ĐỎ — chỉ dùng để CHỌN KHÁCH MẪU
     * =======================================================*/

    function getSnapshotAt(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el || root.contains(el)) return null;

        const row = getRowFrom(el);
        if (!row) return null;

        return { row, found: el, id: getRealId(row), snippet: getSnippet(row), name: getName(row), x, y };
    }

    const getSnapshot = () => (clickPos ? getSnapshotAt(clickPos.x, clickPos.y) : null);

    /* =========================================================
     * DÃY — TOÀN BỘ LOGIC NHẮM MỤC TIÊU CỦA V6
     *
     * Một row chỉ được coi là "trong dãy" khi hội đủ:
     *   • đọc được REAL ID, và
     *   • .snippet-text === runSnippet (snippet của khách ở dấu đỏ), và
     *   • nối liền (index ±1) với một row đã thuộc dãy — có thể là row đã
     *     xác nhận trước đó, hoặc chính khách ở dấu đỏ.
     *
     * Hệ quả: dãy = dãy LIỀN NHAU lớn nhất chứa khách ở dấu đỏ, tất cả cùng
     * snippet. Không có cách nào click sang một đoạn chat khác.
     * =======================================================*/

    /** So khớp snippet (đã chuẩn hoá khoảng trắng ở getSnippet). */
    const sameSnippet = (a, b) => a !== null && b !== null && a !== '' && a === b;

    /** Ảnh chụp các row ĐANG RENDER, theo đúng thứ tự trong danh sách. */
    function rowItems() {
        const rows = listRows();
        const out = [];
        if (!rows) return out;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row.isConnected) continue;
            const id = getRealId(row);
            if (!id) continue;
            out.push({ row, id, snippet: getSnippet(row), name: getName(row) });
        }
        return out;
    }

    const isMember   = item => !!item && runIds.has(item.id);
    const isLive     = item => !!item && sameSnippet(item.snippet, runSnippet);
    /** Thành viên còn "sống" = vẫn đang mang đúng snippet ⇒ vẫn đang nằm nguyên trong dãy. */
    const isBridge   = item => isMember(item) && isLive(item);

    /**
     * Cập nhật dãy từ danh sách đang render.
     *   (1) mở rộng XUÔI: row khớp snippet nối liền row ngay TRÊN đã là thành viên
     *   (2) mở rộng NGƯỢC: chỉ khi bật "Lùi lên trong dãy"
     *   (3) ghi nhận ĐÁY dãy: thành viên sống cuối cùng mà row ngay dưới nó
     *       (đang render) KHÔNG thuộc dãy ⇒ dãy đã hết ở đó.
     *
     * Chỉ thành viên sống mới được làm "cầu" để nối thêm row: hội thoại đã gửi
     * xong bị Pancake đẩy XUỐNG dưới khối chưa đọc (xem hàm `eg` trong bundle),
     * nếu lấy nó làm cầu thì sẽ nối nhầm sang đoạn chat ở khu vực đó.
     */
    function refreshRun(items) {
        let added = 0;

        for (let i = 1; i < items.length; i++) {
            if (isMember(items[i]) || !isLive(items[i])) continue;
            if (isBridge(items[i - 1])) { runIds.add(items[i].id); added++; }
        }

        if (D.upBottom) {
            for (let i = items.length - 2; i >= 0; i--) {
                if (isMember(items[i]) || !isLive(items[i])) continue;
                if (isBridge(items[i + 1])) { runIds.add(items[i].id); added++; }
            }
        }

        for (let i = items.length - 1; i >= 0; i--) {
            if (!isBridge(items[i])) continue;
            const below = items[i + 1];
            /* below là row KHÔNG thuộc dãy ⇒ đây là đáy thật của dãy. */
            if (below && !isMember(below)) {
                runBottomSeen = true;
                runStopId = below.id;
            }
            break;   // chỉ xét thành viên sống CUỐI CÙNG
        }

        if (added) updateRunUI();
        return added;
    }

    /** Số khách thuộc dãy nhưng CHƯA bấm gửi. */
    function pendingRunCount() {
        let n = 0;
        runIds.forEach(id => { if (!handledIds.has(id)) n++; });
        return n;
    }

    /**
     * Row mục tiêu kế tiếp = row ĐẦU TIÊN (trên→dưới) đang render, thuộc dãy,
     * còn sống và chưa gửi. Không bao giờ trả row ngoài dãy.
     */
    function pickRunTarget() {
        const items = rowItems();
        if (!items.length) return null;
        refreshRun(items);

        for (const item of items) {
            if (!isBridge(item)) continue;            // ngoài dãy / snippet đã đổi
            if (handledIds.has(item.id)) continue;    // đã gửi trong lượt này
            const box = item.row.getBoundingClientRect();
            if (!box.height) continue;                // row đang bị ẩn
            return item;
        }
        return null;
    }

    /** Dãy đã xong: không còn ai để gửi và đã nhìn thấy đáy dãy. */
    const runFinished = () => runBottomSeen && pendingRunCount() === 0;

    /**
     * Chờ row kế tiếp của dãy xuất hiện.
     *   • MutationObserver trên .rc-virtual-list-holder-inner: React thêm/xoá
     *     node hoặc tái sử dụng node (đổi id/class) → kiểm tra lại ngay,
     *     gộp bằng T.minGap.
     *   • Poll dự phòng nhịp thưa dần (pollDelay).
     *   • timeout = D.observer; hết giờ mà vẫn không có ⇒ trả null (dãy hết).
     */
    function waitForRunTarget(token, timeout = D.observer) {
        return new Promise(resolve => {
            let settled = false;
            let observer = null, pollId = null, timeoutId = null, gateId = null;
            let lastCheck = 0;

            const cleanup = () => {
                if (observer) { observer.disconnect(); try { observer.takeRecords(); } catch (err) {} observer = null; }
                if (pollId) { clearTimeout(pollId); pollId = null; }
                if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
                if (gateId) { clearTimeout(gateId); gateId = null; }
                txtObserver.textContent = '';
                txtObserver.style.color = '#777';
            };
            const finish = target => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(target);
            };

            const check = () => {
                if (settled) return;
                if (!isRunning || token !== runToken) return finish(null);
                lastCheck = performance.now();
                const target = pickRunTarget();
                if (target) return finish(target);
                if (runFinished()) return finish(null);   // đáy dãy đã thấy, hết khách
            };

            const inner = getListInner();
            if (inner) {
                try {
                    observer = new MutationObserver(() => {
                        if (settled || gateId) return;
                        const wait = Math.max(0, T.minGap - (performance.now() - lastCheck));
                        gateId = setTimeout(() => { gateId = null; check(); }, wait);
                    });
                    observer.observe(inner, {
                        childList: true,
                        subtree: true,
                        attributes: true,
                        attributeFilter: ['id', 'class']
                    });
                } catch (err) { observer = null; }
            }

            txtObserver.textContent = '👁 Đang chờ khách kế trong dãy…';
            txtObserver.style.color = '#faad14';

            check();
            if (settled) return;

            const started = performance.now();
            const tick = () => {
                if (settled) return;
                check();
                if (settled) return;
                pollId = setTimeout(tick, pollDelay(performance.now() - started));
            };
            if (T.pollFast > 0) pollId = setTimeout(tick, T.pollFast);

            if (timeout > 0) {
                timeoutId = setTimeout(() => {
                    check();
                    if (settled) return;
                    finish(null);
                }, timeout);
            }
        });
    }

    /* =========================================================
     * CHẾ ĐỘ "GỬI HẾT KHÁCH BÊN DƯỚI" (theo dấu đỏ)
     *
     * Khác chế độ dãy: KHÔNG xét snippet. Mục tiêu = mọi hội thoại còn class
     * `unread` (khách đã trả lời mà shop chưa trả lời) nằm TỪ DẤU ĐỎ TRỞ XUỐNG,
     * cho tới khi gặp hội thoại ĐÃ ĐỌC đầu tiên (hết khối khách đã trả lời)
     * hoặc không cuộn được nữa (hết danh sách).
     *
     * Vì sao bám TOẠ ĐỘ dấu đỏ thay vì chỉ số row: Pancake xếp lại danh sách
     * sau mỗi lần gửi (hội thoại vừa gửi rời khỏi chỗ cũ, các row khác trôi
     * vào — hàm eg()/ev() trong _app-*.v6.js) nên chỉ số row đổi liên tục,
     * còn dấu đỏ là mốc đứng yên trên màn hình.
     * =======================================================*/

    /** Node cuộn của danh sách (#conversationList > .rc-virtual-list-holder). */
    function getListHolder() {
        const list = getList();
        return list ? list.querySelector(SEL.listHolder) : null;
    }

    /** Vị trí cuộn hiện tại — Pancake cuộn bằng transform: translateY(...) của holder-inner. */
    function listOffset() {
        const inner = getListInner();
        if (!inner) return null;
        const inline = (inner.style && inner.style.transform) || '';
        const m = /translateY\(\s*(-?[\d.]+)px\s*\)/.exec(inline);
        if (m) return parseFloat(m[1]);
        try {
            const computed = getComputedStyle(inner).transform || '';
            const mm = /matrix\([^)]*,\s*(-?[\d.]+)\s*\)\s*$/.exec(computed);
            if (mm) return parseFloat(mm[1]);
        } catch (err) {}
        return null;
    }

    /** "Dấu vân tay" cửa sổ đang render — để biết danh sách vừa cuộn/render lại. */
    function listKey() {
        const items = rowItems();
        if (!items.length) return 'empty';
        return `${listOffset()}|${items.length}|${items[0].id}|${items[items.length - 1].id}`;
    }

    /**
     * Row còn "unread" = khách đã trả lời mà shop chưa trả lời.
     * Nguồn: html3.txt — 11/12 row có class "unread" (row còn lại là row GHIM
     * đang mở); html.txt (9 row) và html2.txt (10 row): không row nào có.
     * Badge đỏ sup.ant-badge-count[title="N"] xuất hiện/ẩn cùng lúc với class
     * này, nhưng code CHỈ dựa vào class — badge nằm trong .media-left nên khi
     * React chưa render xong badge dễ thiếu hơn class.
     */
    const isUnreadRow = row => !!(row && row.classList && row.classList.contains('unread'));

    /**
     * Cuộn danh sách bằng sự kiện wheel. Pancake dùng .rc-virtual-list-holder
     * với overflow-y:hidden nên scrollTop KHÔNG có tác dụng — phải bắn wheel
     * (rc-virtual-list nghe wheel rồi tự cập nhật translateY).
     */
    function wheelScroll(px) {
        const holder = getListHolder();
        if (!holder || !px) return false;

        const target = holder.querySelector(SEL.row) || holder;
        let sent = 0;
        while (sent < px) {
            const delta = Math.min(120, px - sent);   // nhiều nhát nhỏ, không nhảy cóc
            let ev = null;
            try {
                ev = new WheelEvent('wheel', {
                    deltaY: delta, deltaMode: 0, bubbles: true, cancelable: true, composed: true
                });
            } catch (err) {
                try { ev = new Event('wheel', { bubbles: true, cancelable: true }); } catch (err2) { ev = null; }
                if (ev) { try { ev.deltaY = delta; ev.deltaMode = 0; } catch (err3) {} }
            }
            if (!ev) return false;
            try { target.dispatchEvent(ev); } catch (err) { return false; }
            sent += delta;
        }
        return true;
    }

    /** Chờ danh sách render lại (dấu vân tay đổi) — tối đa `timeout` ms. */
    async function waitListChange(before, timeout = T.scrollWait) {
        const until = performance.now() + timeout;
        while (performance.now() < until) {
            if (listKey() !== before) return true;
            await sleep(20);
        }
        return listKey() !== before;
    }

    /** Cuộn xuống 1 nhịp để lộ thêm row. true = cửa sổ render ĐÃ đổi. */
    async function scrollDownOnce() {
        const holder = getListHolder();
        if (!holder) return false;

        const items = rowItems();
        if (!items.length) return false;

        const holderBox = holder.getBoundingClientRect();
        const dotY = clickPos ? clickPos.y : holderBox.top;

        /*
         * CHỈ cuộn trong khoảng từ dấu đỏ tới đáy vùng nhìn.
         * Cuộn xuống D px làm mọi row đang nằm dưới dấu đỏ trôi lên D px; row
         * nào trôi qua khỏi dấu đỏ sẽ bị bỏ sót. Vùng [dấu đỏ → đáy vùng nhìn]
         * thì mình ĐÃ quét hết (toàn row đã gửi, vì vòng lặp luôn gửi row đầu
         * tiên ở dưới dấu đỏ trước), còn vùng dưới đáy vùng nhìn thì CHƯA đọc
         * được ⇒ giữ D ≤ (đáy vùng nhìn − dấu đỏ) để không row nào bị bỏ sót.
         */
        const safe = Math.floor(Math.max(0, holderBox.bottom - dotY) * T.scrollStep);
        const rowH = Math.round(items[0].row.getBoundingClientRect().height) || 72;
        const step = Math.max(rowH * 0.5, safe, 8);

        const before = listKey();
        if (wheelScroll(step) && await waitListChange(before)) return true;

        /* Dự phòng: nếu vì lý do nào đó holder cuộn được thật bằng scrollTop. */
        const top0 = holder.scrollTop || 0;
        try { holder.scrollTop = top0 + step; } catch (err) {}
        if ((holder.scrollTop || 0) !== top0 && await waitListChange(before, 600)) return true;

        return false;
    }

    /**
     * Mục tiêu kế tiếp ở chế độ bên dưới: row ĐẦU TIÊN (trên→dưới) nằm từ dấu
     * đỏ trở xuống, chưa gửi trong lượt này. Kèm cờ `unread` để vòng lặp biết
     * đã chạm đáy khối khách đã trả lời hay chưa.
     */
    function pickBelowTarget() {
        if (!clickPos) return null;
        const items = rowItems();
        if (!items.length) return null;

        const dotY = clickPos.y;
        for (const item of items) {
            const box = item.row.getBoundingClientRect();
            if (!box.height) continue;          // row đang bị ẩn
            if (box.bottom <= dotY) continue;   // nằm TRÊN dấu đỏ ⇒ không phải "bên dưới"
            if (handledIds.has(item.id)) continue;
            return { ...item, unread: isUnreadRow(item.row) };
        }
        return null;
    }

    /* =========================================================
     * UI
     * =======================================================*/

    const CSS = `
#pk-root{position:fixed;bottom:25px;right:25px;z-index:2147483647;
  font-family:Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;user-select:none}
#pk-panel{width:262px;display:flex;flex-direction:column;gap:8px;padding:12px;
  background:rgba(26,26,30,.96);color:#fff;border:1px solid #444;border-radius:10px;
  box-shadow:0 8px 24px rgba(0,0,0,.5);font-size:12px;
  max-height:calc(100vh - 30px);overflow-y:auto;box-sizing:border-box}
#pk-header{display:flex;justify-content:space-between;align-items:center;cursor:move;
  font-weight:700;border-bottom:1px solid #444;padding-bottom:6px}
#pk-min{cursor:pointer;color:#aaa;padding:0 5px}
.pk-card{background:#151515;border:1px solid #444;border-radius:6px;padding:7px;
  display:flex;flex-direction:column;gap:6px}
.pk-card.red{border-color:#5c2a2a}
.pk-card.green{border-color:#2a4a2a}
.pk-title{text-align:center;font-size:11px;font-weight:700}
.pk-title.red{color:#ff7875}
.pk-title.green{color:#95de64}
.pk-row{display:flex;justify-content:space-between;align-items:center;gap:6px}
.pk-label{color:#aaa;font-size:10px}
.pk-num{width:58px;background:#080808;color:#fff;border:1px solid #555;border-radius:4px;
  text-align:center;padding:3px}
.pk-hint{color:#777;text-align:center;font-size:9px}
.pk-btn{padding:7px;border-radius:4px;cursor:pointer;font-size:11px;
  background:#333;color:#bbb;border:1px solid #555}
.pk-btn.wide{width:100%}
.pk-btn.flex{flex:1}
.pk-btn.on-green{background:#389e0d;color:#fff;border-color:#52c41a}
.pk-btn.purple{background:#722ed1;color:#fff;border-color:#9254de}
.pk-btn.danger{background:#222;color:#ff7875}
.pk-btn:disabled{opacity:.5;cursor:not-allowed}
#pk-run{width:100%;background:#1677ff;color:#fff;font-weight:700;border:0;
  border-radius:5px;padding:8px;cursor:pointer;font-size:12px}
#pk-hotkey{width:75px;background:#080808;color:#fff;border:1px solid #555;
  border-radius:4px;padding:4px}
#pk-mode,#pk-confirm{background:#080808;color:#fff;border:1px solid #555;
  border-radius:4px;padding:4px;font-size:11px;max-width:158px}
.pk-hint b{color:#ffd591}
#pk-text{box-sizing:border-box;width:100%;background:#111;color:#fff;
  border:1px solid #555;border-radius:4px;padding:6px}
#pk-pos{text-align:center;font-size:10px;color:#888}
#pk-id{text-align:center;font-size:9px;color:#777;word-break:break-all}
#pk-observer{text-align:center;font-size:9px;color:#777}
#pk-hotkey-hint{text-align:center;font-size:10px;color:#777}
#pk-status{min-height:16px;text-align:center;font-size:11px;color:#aaa;word-break:break-word}
#pk-stats{text-align:center;font-size:9px;color:#5f5f5f}
#pk-run-info{text-align:center;font-size:10px;color:#52c41a}
#pk-run-snippet{color:#8c8c8c;text-align:center;font-size:9px;word-break:break-word;
  max-height:30px;overflow:hidden}
#pk-stop-snippet{color:#777;text-align:center;font-size:10px;word-break:break-word;
  max-height:42px;overflow:hidden}
#pk-bubble{display:none;width:42px;height:42px;border-radius:50%;background:#1677ff;
  color:#fff;font-size:20px;align-items:center;justify-content:center;cursor:move;
  box-shadow:0 4px 15px rgba(0,0,0,.4)}
#pk-marker{position:fixed;width:14px;height:14px;border-radius:50%;background:#ff4d4f;
  border:2px solid #fff;box-shadow:0 0 10px rgba(255,77,79,.9);pointer-events:none;
  z-index:2147483646;transform:translate(-50%,-50%);display:none}
`;

    const speedRow = (id, label, value) => `
      <div class="pk-row">
        <span class="pk-label">${label}</span>
        <input id="${id}" type="number" min="0" step="1" value="${value}" class="pk-num">
      </div>`;

    const root = document.createElement('div');
    root.id = 'pk-root';
    root.innerHTML = `
      <style>${CSS}</style>
      <div id="pk-panel">
        <div id="pk-header">
          <span>🤖 Auto UPSALE V6.0</span>
          <span id="pk-min">─</span>
        </div>

        <div class="pk-card green">
          <div class="pk-title green" id="pk-mode-title">🎯 Dãy gửi (theo snippet)</div>
          <div class="pk-row">
            <span class="pk-label">Chế độ gửi</span>
            <select id="pk-mode">
              <option value="run">Dãy cùng snippet</option>
              <option value="below">Hết khách bên dưới</option>
            </select>
          </div>
          <div id="pk-run-info">Chưa xác định — chấm vị trí rồi bấm Bắt đầu</div>
          <div id="pk-run-snippet"></div>
        </div>

        <div class="pk-card">
          <div class="pk-title">⚙ Tuỳ chọn</div>
          <div class="pk-row">
            <span class="pk-label">Chờ xác nhận gửi</span>
            <select id="pk-confirm">
              <option value="off">Tắt — nhanh nhất</option>
              <option value="fast">Nhanh — 150 ms</option>
              <option value="full">Chắc — 600 ms</option>
            </select>
          </div>
          ${speedRow('pk-enter-count', 'Số Enter', D.enter)}
          ${speedRow('pk-up-bottom',   'Lùi lên trong dãy', D.upBottom)}
          <div class="pk-hint"><b>Dãy cùng snippet:</b> chỉ gửi hội thoại LIỀN NHAU + snippet giống hệt đoạn ở dấu đỏ (tự cuộn nếu dãy dài hơn màn hình).
<b>Hết khách bên dưới:</b> gửi mọi hội thoại còn “unread” (khách đã trả lời) từ dấu đỏ trở xuống; tự cuộn; dừng khi gặp hội thoại ĐÃ ĐỌC đầu tiên.
Chờ xác nhận: Tắt = nhanh nhất (Pancake chậm thì có thể mất tin — script cảnh báo ở Console) · Nhanh/Chắc = chờ Pancake xoá ô soạn rồi mới sang khách kế.
Số Enter: 1 = mặc định · 2 = khớp tuỳ chọn "Enter 2 lần chuyển tin kế" của Pancake (cẩn thận: có thể gửi thêm tin trống).
Lùi lên trong dãy (chỉ chế độ Dãy): 1 = row ngay trên dãy mà CÙNG snippet thì gộp vào · 0 = chỉ tiến xuống.</div>
        </div>

        <div class="pk-card pk-row">
          <span>⌨ Start / Stop</span>
          <select id="pk-hotkey">
            <option value="Tab">Tab</option>
            <option value="F4">F4</option>
          </select>
        </div>

        <button id="pk-hotkey-enable" class="pk-btn wide"></button>

        <input id="pk-text" type="text" placeholder="Nội dung gửi (trống = clipboard)">

        <div class="pk-row" style="gap:4px">
          <button id="pk-pick" class="pk-btn flex">🎯 Chấm vị trí</button>
          <button id="pk-clear" class="pk-btn danger">✕</button>
        </div>

        <button id="pk-auto-enter" class="pk-btn wide"></button>

        <div class="pk-card red">
          <div class="pk-title red">🛑 Câu dừng</div>
          <div class="pk-row" style="gap:4px">
            <button id="pk-stop-pick" class="pk-btn flex purple">🎯 Thêm câu dừng</button>
            <button id="pk-stop-clear" class="pk-btn danger">✕ Hủy</button>
          </div>
          <div id="pk-stop-snippet">Chưa có câu dừng</div>
        </div>

        <div id="pk-pos"></div>
        <div id="pk-id"></div>
        <div id="pk-observer"></div>

        <button id="pk-run">▶ Bắt đầu</button>

        <div id="pk-hotkey-hint"></div>
        <div id="pk-status">Sẵn sàng</div>
        <div id="pk-stats">📊 Chưa có dữ liệu</div>
      </div>

      <div id="pk-bubble">🤖</div>
    `;

    const marker = document.createElement('div');
    marker.id = 'pk-marker';

    document.body.appendChild(root);
    document.body.appendChild(marker);

    /* Dùng [id="..."] thay vì #id: tránh fast-path id của toàn document khi có
       phần tử trùng id ở ngoài panel (VD bản V5 còn chạy song song). */
    const $ = id => root.querySelector(`[id="${id}"]`);

    const panel         = $('pk-panel');
    const bubble        = $('pk-bubble');
    const btnRun        = $('pk-run');
    const btnPick       = $('pk-pick');
    const btnClear      = $('pk-clear');
    const btnAutoEnter  = $('pk-auto-enter');
    const btnHotkey     = $('pk-hotkey-enable');
    const btnStopPick   = $('pk-stop-pick');
    const btnStopClear  = $('pk-stop-clear');
    const inputText     = $('pk-text');
    const selectHotkey  = $('pk-hotkey');
    const selectMode    = $('pk-mode');
    const selectConfirm = $('pk-confirm');
    const txtModeTitle  = $('pk-mode-title');
    const txtPos        = $('pk-pos');
    const txtId         = $('pk-id');
    const txtObserver   = $('pk-observer');
    const txtStatus     = $('pk-status');
    const txtHotkeyHint = $('pk-hotkey-hint');
    const txtStop       = $('pk-stop-snippet');
    const txtStats      = $('pk-stats');
    const txtRunInfo    = $('pk-run-info');
    const txtRunSnippet = $('pk-run-snippet');
    const inputs        = {
        enter:    $('pk-enter-count'),
        upBottom: $('pk-up-bottom')
    };

    /* =========================================================
     * UI STATE
     * =======================================================*/

    let savedUI = store.get(K.ui, {}) || {};
    let activationHotkey = savedUI.hotkey === 'F4' ? 'F4' : 'Tab';

    autoEnter     = savedUI.autoEnter === true;
    hotkeyEnabled = false;
    stopSnippet   = normalizeText(store.get(K.stop, '') || '');
    clickPos      = store.get(K.pos, null);

    function setStatus(text, color = '#aaa') {
        txtStatus.textContent = text;
        txtStatus.style.color = color;
    }

    function updateMarker() {
        if (!clickPos) { marker.style.display = 'none'; return; }
        marker.style.display = 'block';
        marker.style.left = clickPos.x + 'px';
        marker.style.top  = clickPos.y + 'px';
    }

    function updateIdStatus(snapshot) {
        if (!snapshot || !snapshot.id) {
            txtId.textContent = 'ID: không xác định';
            txtId.style.color = '#ff7875';
            return;
        }
        txtId.textContent = 'REAL ID: ' + snapshot.id;
        txtId.style.color = '#52c41a';
    }

    /** Hiển thị dãy đang nhắm: số khách + snippet mẫu (để người dùng đối chiếu). */
    function updateRunUI() {
        txtModeTitle.textContent = isBelowMode()
            ? '🎯 Gửi hết khách bên dưới (unread)'
            : '🎯 Dãy gửi (theo snippet)';

        if (isBelowMode()) {
            txtRunInfo.textContent = runAnchorId
                ? `Bên dưới dấu đỏ · đã gửi ${stats.sent} khách`
                : 'Chưa xác định — chấm vị trí rồi bấm Bắt đầu';
            txtRunInfo.style.color = runAnchorId ? '#52c41a' : '#777';
            txtRunSnippet.textContent = runAnchorId
                ? 'Chỉ gửi khách còn “unread” (khách đã trả lời) từ dấu đỏ trở xuống'
                : '';
            txtRunSnippet.title = '';
            return;
        }

        if (!runSnippet) {
            txtRunInfo.textContent = 'Chưa xác định — chấm vị trí rồi bấm Bắt đầu';
            txtRunInfo.style.color = '#777';
            txtRunSnippet.textContent = '';
            return;
        }
        txtRunInfo.textContent = `Dãy: ${runIds.size} khách · đã gửi ${stats.sent}`
            + (runBottomSeen ? ' · đã tới đáy dãy' : '');
        txtRunInfo.style.color = '#52c41a';
        txtRunSnippet.textContent = '“' + runSnippet + '”';
        txtRunSnippet.title = runSnippet;
    }

    function updateStopUI() {
        if (stopSnippet) {
            txtStop.textContent = '🛑 ' + stopSnippet;
            txtStop.style.color = '#ff7875';
            txtStop.title = stopSnippet;
            btnStopClear.disabled = false;
        } else {
            txtStop.textContent = 'Chưa có câu dừng';
            txtStop.style.color = '#777';
            txtStop.title = '';
            btnStopClear.disabled = true;
        }
    }

    function syncUI() {
        btnHotkey.textContent = hotkeyEnabled ? '🔓 Kích hoạt Hotkey: ON' : '🔒 Kích hoạt Hotkey: OFF';
        btnHotkey.className = 'pk-btn wide' + (hotkeyEnabled ? ' on-green' : '');

        btnAutoEnter.textContent = autoEnter ? '⚡ Auto Enter: ON' : '⚡ Auto Enter: OFF';
        btnAutoEnter.className = 'pk-btn wide' + (autoEnter ? ' on-green' : '');

        selectMode.value    = sendMode;
        selectConfirm.value = D.confirm;
        selectHotkey.value  = activationHotkey;
        txtHotkeyHint.textContent = `${activationHotkey.toUpperCase()} = Bắt đầu / Dừng`;

        if (clickPos) {
            txtPos.textContent = `Tọa độ: (${clickPos.x}, ${clickPos.y})`;
            txtPos.style.color = '#52c41a';
        } else {
            txtPos.textContent = 'Chưa chọn tọa độ';
            txtPos.style.color = '#888';
        }

        updateStopUI();
        updateRunUI();
    }

    let saveUITimer = null;

    function saveUI() {
        const rect = root.getBoundingClientRect();
        store.set(K.ui, {
            text: inputText.value,
            autoEnter,
            mode: sendMode,
            hotkey: activationHotkey,
            minimized: panel.style.display === 'none',
            position: { left: Math.round(rect.left), top: Math.round(rect.top) }
        });
    }

    function scheduleSaveUI() {
        clearTimeout(saveUITimer);
        saveUITimer = setTimeout(saveUI, 250);
    }

    function keepInViewport() {
        const rect = root.getBoundingClientRect();
        const left = Math.max(0, Math.min(rect.left, Math.max(0, window.innerWidth - 50)));
        const top  = Math.max(0, Math.min(rect.top,  Math.max(0, window.innerHeight - 50)));
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.style.left = Math.round(left) + 'px';
        root.style.top  = Math.round(top) + 'px';
    }

    function restoreUI() {
        inputText.value = typeof savedUI.text === 'string' ? savedUI.text : '';
        sendMode = savedUI.mode === 'below' ? 'below' : 'run';

        const minimized = savedUI.minimized === true;
        panel.style.display = minimized ? 'none' : 'flex';
        bubble.style.display = minimized ? 'flex' : 'none';

        const p = savedUI.position;
        if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) {
            root.style.right = 'auto';
            root.style.bottom = 'auto';
            root.style.left = p.left + 'px';
            root.style.top  = p.top + 'px';
        }
        requestAnimationFrame(keepInViewport);
    }

    /* =========================================================
     * EVENTS
     * =======================================================*/

    Object.values(inputs).forEach(input => {
        input.addEventListener('change', () => {
            D.enter    = Math.min(3, Math.max(1, clampInt(inputs.enter.value, 1)));
            D.upBottom = inputs.upBottom.value === '0' ? 0 : 1;
            saveSpeed();
        });
    });

    btnHotkey.onclick = () => { hotkeyEnabled = !hotkeyEnabled; syncUI(); };

    btnAutoEnter.onclick = () => { autoEnter = !autoEnter; syncUI(); saveUI(); };

    selectHotkey.onchange = () => {
        activationHotkey = selectHotkey.value === 'F4' ? 'F4' : 'Tab';
        syncUI();
        saveUI();
    };

    selectMode.onchange = () => {
        /* Đổi chế độ giữa chừng thì dừng lượt đang chạy — tránh trộn 2 kiểu
           nhắm mục tiêu trong cùng một lượt. */
        const next = selectMode.value === 'below' ? 'below' : 'run';
        if (next === sendMode) return;
        if (isRunning) stop('Đã dừng — bạn vừa đổi chế độ gửi');
        sendMode = next;
        syncUI();
        saveUI();
    };

    selectConfirm.onchange = () => {
        D.confirm = ['off', 'fast', 'full'].includes(selectConfirm.value) ? selectConfirm.value : 'off';
        saveSpeed();
        syncUI();
    };

    inputText.addEventListener('input', scheduleSaveUI);

    $('pk-min').onclick = () => {
        panel.style.display = 'none';
        bubble.style.display = 'flex';
        saveUI();
    };

    let hasMoved = false;
    let suppressBubbleClick = false;

    bubble.onclick = event => {
        if (suppressBubbleClick) {
            suppressBubbleClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        bubble.style.display = 'none';
        panel.style.display = 'flex';
        keepInViewport();
        saveUI();
    };

    function makeDraggable(handle) {
        handle.addEventListener('mousedown', event => {
            if (event.button !== 0 || event.target.id === 'pk-min') return;

            const rect = root.getBoundingClientRect();
            const startX = event.clientX, startY = event.clientY;
            const startLeft = rect.left, startTop = rect.top;

            hasMoved = false;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
            event.preventDefault();

            const move = e => {
                const dx = e.clientX - startX, dy = e.clientY - startY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
                root.style.left = (startLeft + dx) + 'px';
                root.style.top  = (startTop + dy) + 'px';
                keepInViewport();
            };

            const up = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', up);
                keepInViewport();
                if (handle === bubble && hasMoved) suppressBubbleClick = true;
                saveUI();
            };

            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
        });
    }

    makeDraggable($('pk-header'));
    makeDraggable(bubble);
    window.addEventListener('resize', keepInViewport);

    /* =========================================================
     * PICKERS
     * =======================================================*/

    function removePicker() {
        if (activePicker) {
            window.removeEventListener('click', activePicker, true);
            activePicker = null;
        }
    }

    function startPicker(mode) {
        removePicker();

        const onPick = mode === 'pos'
            ? (row, event) => {
                clickPos = { x: Math.round(event.clientX), y: Math.round(event.clientY) };
                store.set(K.pos, clickPos);
                updateMarker();
                syncUI();
                updateIdStatus(getSnapshot());
                return 'Đã lưu tọa độ';
            }
            : row => {
                const snippet = getSnippet(row);
                if (!snippet) {
                    setStatus('Không đọc được snippet.', '#ff7875');
                    return null;
                }
                stopSnippet = snippet;
                if (stopSnippet) store.set(K.stop, stopSnippet); else store.remove(K.stop);
                updateStopUI();
                return '🛑 Đã lưu câu dừng';
            };

        const hint = mode === 'pos'
            ? 'Click vào conversation...'
            : '🛑 Click conversation có câu muốn dừng...';

        setStatus(hint, '#faad14');

        activePicker = event => {
            if (root.contains(event.target)) return;

            const row = getRowFrom(event.target);
            if (!row) {
                setStatus('Không phải conversation. Hãy chấm lại.', '#ff7875');
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const message = onPick(row, event);
            if (message) setStatus(message, '#52c41a');
            removePicker();
        };

        window.addEventListener('click', activePicker, true);
    }

    btnPick.onclick = () => startPicker('pos');
    btnStopPick.onclick = () => startPicker('stop');

    btnStopClear.onclick = () => {
        stopSnippet = '';
        store.remove(K.stop);
        updateStopUI();
        setStatus('Đã hủy câu dừng');
    };

    btnClear.onclick = () => {
        clickPos = null;
        store.remove(K.pos);
        txtId.textContent = 'ID: chưa kiểm tra';
        txtId.style.color = '#777';
        updateMarker();
        syncUI();
    };

    /* =========================================================
     * CLICK — đủ chuỗi sự kiện để React nhận
     * =======================================================*/

    function fullClick(element, x, y) {
        if (!element || !element.isConnected) return false;

        const common = {
            bubbles: true, cancelable: true, composed: true,
            clientX: x, clientY: y, button: 0, view: window
        };

        try {
            const pointer = (type, buttons) => element.dispatchEvent(new PointerEvent(type, {
                ...common, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true
            }));
            const mouse = (type, buttons) => element.dispatchEvent(new MouseEvent(type, { ...common, buttons }));

            pointer('pointerdown', 1);
            mouse('mousedown', 1);
            pointer('pointerup', 0);
            mouse('mouseup', 0);
            element.dispatchEvent(new MouseEvent('click', { ...common }));
            return true;
        } catch (err) {
            try { element.click(); return true; } catch (err2) { return false; }
        }
    }

    /* =========================================================
     * GHI TEXT VÀO COMPOSER
     * #replyBoxComposer là <textarea> do React điều khiển
     * ⇒ phải set qua native setter rồi bắn event 'input'.
     * =======================================================*/

    function setComposerValue(element, text) {
        if (!element || !text) return false;

        try {
            element.focus();

            if (element instanceof HTMLTextAreaElement) {
                const setter = Object.getOwnPropertyDescriptor(
                    HTMLTextAreaElement.prototype, 'value'
                )?.set;

                /*
                 * Bẫy React: nếu value mới GIỐNG HỆT value đang có, React bỏ qua
                 * onChange → Pancake không biết có nội dung → lần render sau nó
                 * đè composer bằng state cũ ⇒ mất text. Xử lý: xóa về rỗng (kèm
                 * 1 event input để React cập nhật tracker) rồi mới gán text.
                 */
                if (element.value === text) {
                    console.info(
                        '[Pancake Auto] Composer đã sẵn đúng nội dung (draft cũ?) '
                        + '→ xóa rồi gán lại để React chịu bắn onChange'
                    );
                    if (setter) setter.call(element, '');
                    else element.value = '';
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                }

                if (setter) setter.call(element, text);
                else element.value = text;

                element.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }

            if (element.isContentEditable) {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(element);
                selection.removeAllRanges();
                selection.addRange(range);

                if (document.execCommand('insertText', false, text)) return true;

                element.textContent = text;
                element.dispatchEvent(new InputEvent('input', {
                    bubbles: true, inputType: 'insertText', data: text
                }));
                return true;
            }

            return false;
        } catch (err) {
            console.error('[Pancake Auto] setComposerValue:', err);
            return false;
        }
    }

    /** Nội dung gửi: ô text trong panel, nếu trống thì đọc clipboard 1 lần/run. */
    async function getSendText() {
        const direct = inputText.value.trim();
        if (direct) return direct;
        if (cachedText) return cachedText;

        try {
            cachedText = (await navigator.clipboard.readText()) || '';
        } catch (err) {
            try {
                cachedText = (typeof GM_getClipboard === 'function' ? await GM_getClipboard() : '') || '';
            } catch (err2) {
                cachedText = '';
            }
        }
        return cachedText;
    }

    /* =========================================================
     * ENTER — tự đặt keyCode/which phòng site đọc
     * =======================================================*/

    function makeEnterEvent(type) {
        const event = new KeyboardEvent(type, {
            key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true
        });
        try {
            Object.defineProperty(event, 'keyCode', { get: () => 13 });
            Object.defineProperty(event, 'which',   { get: () => 13 });
        } catch (err) {}
        return event;
    }

    /* =========================================================
     * CHỜ HỘI THOẠI ĐƯỢC MỞ ĐÚNG (chốt an toàn, mặc định TẮT)
     *
     * Row đang mở mang class .selected (html2.txt row __51:
     *   <div class="media conversation-list-item selected" id="…__51">).
     * Dùng khi D.gate > 0: chờ tới khi row .selected khớp REAL ID mục tiêu.
     * =======================================================*/

    async function waitForConversationOpen(snapshot, token, gate) {
        const targetId = snapshot.id;
        const targetName = snapshot.name;

        if (gate <= 0) return { ok: true, skipped: true };

        const matches = () => {
            const selected = getSelectedRow();
            return !!selected && getRealId(selected) === targetId;
        };

        const ok = await new Promise(resolve => {
            const list = getList();
            let settled = false;
            let observer = null;
            let pollId = null;
            let timeoutId = null;

            const finish = value => {
                if (settled) return;
                settled = true;
                if (observer) observer.disconnect();
                if (pollId) clearInterval(pollId);
                if (timeoutId) clearTimeout(timeoutId);
                resolve(value);
            };

            const verify = () => {
                if (!isRunning || token !== runToken) return finish(false);
                if (matches()) finish(true);
            };

            if (matches()) return finish(true);

            try {
                observer = new MutationObserver(verify);
                observer.observe(list || document.body, {
                    subtree: !!list,
                    attributes: true,
                    attributeFilter: ['class', 'id']
                });
            } catch (err) { observer = null; }

            pollId = setInterval(verify, 50);
            timeoutId = setTimeout(() => finish(false), gate);
        });

        if (!ok) return { ok: false, reason: 'Hội thoại không mở (không khớp .selected)' };

        const headerName = getHeaderName();
        if (targetName && headerName && headerName !== targetName) {
            console.warn('[Pancake Auto] Tên không khớp:', { row: targetName, header: headerName });
            setStatus(`⚠ Tên lệch: ${headerName}`, '#faad14');
        }

        return { ok: true };
    }

    async function getComposerAfterClick(token) {
        if (!isRunning || token !== runToken) return null;

        let composer = getComposer();
        if (composer) return composer;

        await nextTick();
        if (!isRunning || token !== runToken) return null;

        composer = getComposer();
        if (composer) return composer;

        return waitUntil(() => {
            const current = getComposer();
            return current && current.isConnected ? current : null;
        }, { timeout: T.composer, interval: 16, token });
    }

    async function waitUntil(callback, { timeout = 500, interval = 16, token = runToken } = {}) {
        const started = performance.now();
        while (isRunning && token === runToken && performance.now() - started < timeout) {
            try {
                const result = callback();
                if (result) return result;
            } catch (err) {}
            await sleep(interval);
        }
        return null;
    }

    /** So khớp "đủ tốt" cho nội dung gửi (textarea tự chuẩn hoá CRLF → LF). */
    const sameText = (a, b) =>
        a === b ||
        String(a).replace(/\r\n?/g, '\n') === String(b).replace(/\r\n?/g, '\n');

    /** In CHUỖI để người dùng copy được ngay từ console. */
    function logPasteFail(label, box, text, tries) {
        const val = box ? String(box.value ?? '') : '(không có node)';
        const exp = String(text ?? '');
        let khac = 'y hệt';
        if (val !== exp) {
            if (val.length !== exp.length) khac = `khác ĐỘ DÀI (${val.length} vs ${exp.length})`;
            else {
                for (let i = 0; i < Math.max(val.length, exp.length); i++) {
                    if (val[i] !== exp[i]) {
                        khac = `khác tại ký tự ${i}: composer ${JSON.stringify(val.slice(i, i + 12))}` +
                               ` vs text ${JSON.stringify(exp.slice(i, i + 12))}`;
                        break;
                    }
                }
            }
        }
        console.warn(
            `[Pancake Auto] ${label}\n` +
            `   thử lại      : ${tries} lần trong ${T.pasteHold} ms\n` +
            `   connected    : ${box ? box.isConnected : '-'}\n` +
            `   disabled/ro  : ${box ? box.disabled : '-'} / ${box ? box.readOnly : '-'}\n` +
            `   maxLength    : ${box ? box.maxLength : '-'}\n` +
            `   độ dài       : composer ${val.length} vs text ${exp.length}\n` +
            `   khác nhau    : ${khac}\n` +
            `   composer đầu : ${JSON.stringify(val.slice(0, 120))}\n` +
            `   text đầu     : ${JSON.stringify(exp.slice(0, 120))}`
        );
    }

    /**
     * Dán và GIỮ nội dung qua các lần React re-render (dán lại tối đa
     * T.pasteHold ms; vòng lặp kiểm tra trước rồi mới await nên bình thường
     * không tốn thời gian).
     */
    async function pasteAndHold(startComposer, text, token) {
        if (!startComposer || !setComposerValue(startComposer, text)) {
            return { ok: false, composer: startComposer, tries: 0 };
        }

        let box   = startComposer;
        let tries = 0;
        let held  = box.isConnected && sameText(box.value, text);
        const holdUntil = performance.now() + T.pasteHold;

        while (!held && performance.now() < holdUntil) {
            tries++;
            await nextTick();
            if (!isRunning || token !== runToken) return { ok: false, composer: box, tries };

            const fresh = getComposer();
            if (fresh && fresh !== box) box = fresh;   // React thay node composer

            setComposerValue(box, text);
            held = box.isConnected && sameText(box.value, text);
        }
        return { ok: held, composer: box, tries };
    }

    /* =========================================================
     * GỬI 1 KHÁCH
     *
     * `target` do pickRunTarget() trả về — đã qua 2 chốt (snippet + nối liền
     * dãy). Hàm này KHÔNG tự đi tìm khách: mọi việc nhắm mục tiêu nằm ở
     * pickRunTarget()/waitForRunTarget().
     * =======================================================*/

    async function sendTo(target, token) {
        tabHiddenDuringStep = false;
        stepStart = performance.now();

        const snapshot = {
            row:     target.row,
            id:      target.id,
            snippet: target.snippet,
            name:    target.name
        };

        if (!snapshot.row || !snapshot.row.isConnected) { stop('Row không còn tồn tại'); return false; }
        if (!snapshot.id) { stop('Không xác định được REAL conversation ID'); return false; }
        if (!isBelowMode() && snapshot.snippet === null) { stop('Snippet chưa sẵn sàng'); return false; }

        /* ---- Câu dừng: ưu tiên cao nhất ---- */
        if (stopSnippet && sameSnippet(snapshot.snippet, stopSnippet)) {
            stop(`🛑 Đã gặp câu dừng: ${stopSnippet}`);
            return false;
        }

        /* ---- Chốt an toàn (khác nhau theo chế độ) ----
         *  • Chế độ DÃY   : row phải là thành viên đã xác nhận của dãy.
         *  • Chế độ DƯỚI  : row phải CÒN "unread" (khách đã trả lời) — kiểm lại
         *    ngay trước khi click, vì React có thể vừa render lại.
         */
        if (isBelowMode()) {
            if (!isUnreadRow(snapshot.row)) {
                stop('Row mục tiêu không còn "unread" (khách đã được xử lý?)');
                return false;
            }
        } else if (!runIds.has(snapshot.id)) {
            stop('Row mục tiêu không thuộc dãy (đã bị xếp lại?)');
            return false;
        }


        /*
         * Chốt lại DANH TÍNH row ngay trước khi click: React có thể đã tráo node
         * trong lúc ta chờ. Nếu không còn đúng khách thì bỏ lượt này (CHƯA đánh
         * dấu đã gửi) rồi để vòng lặp chọn lại.
         */
        if (getRealId(target.row) !== snapshot.id) {
            console.warn('[Pancake Auto] Row bị tráo trước khi click — chọn lại.');
            await nextTick();
            return true;
        }

        /* ---- Chặn gửi lặp: đánh dấu TRƯỚC khi click ---- */
        if (handledIds.size > 20000) handledIds.delete(handledIds.values().next().value);
        handledIds.add(snapshot.id);
        updateRunUI();

        const box = target.row.getBoundingClientRect();
        const clickX = Math.round(box.left + box.width / 2);
        const clickY = Math.round(box.top + box.height / 2);

        phaseReset();
        if (!fullClick(target.row, clickX, clickY)) {
            stop('Không click được conversation');
            return false;
        }
        phaseMark('click');

        updateIdStatus(snapshot);
        setStatus(
            isBelowMode()
                ? `Đã bắt ID → đang mở (khách ${stats.sent + 1})...`
                : `Đã bắt ID → đang mở (${stats.sent + 1}/${runIds.size})...`,
            '#52c41a'
        );

        /* ---- Composer ---- */
        let composer = await getComposerAfterClick(token);
        if (!isRunning || token !== runToken) return false;
        if (!composer) { stop('Không tìm thấy #replyBoxComposer'); return false; }
        phaseMark('composer');

        /* ---- Nội dung ---- */
        const text = await getSendText();
        if (!isRunning || token !== runToken) return false;

        lastCtx = {
            id:        snapshot.id,
            ten:       snapshot.name,
            snippet:   snapshot.snippet,
            mauSnippet: runSnippet,
            soKhachDaGui: stats.sent,
            doDaiText: text ? text.length : 0,
            textDau:   text ? text.slice(0, 60) : ''
        };

        if (!text) { stop('Không có nội dung gửi'); return false; }

        /* ---- Dán (dán ngay rồi GIỮ qua các lần React render) ---- */
        let pasted = await pasteAndHold(composer, text, token);
        if (!isRunning || token !== runToken) return false;
        if (!pasted.ok) {
            logPasteFail('Composer không giữ nội dung (dán lần 1)', pasted.composer, text, pasted.tries);
            stop('Composer không giữ nội dung (React đã reset)');
            return false;
        }
        composer = pasted.composer;
        pasteTries = pasted.tries || 0;
        phaseMark('paste');
        pastedAt = performance.now();   // mốc kết thúc pha dán (dùng cho chế độ Enter thủ công)

        /* ---- CHỐT AN TOÀN TRƯỚC ENTER (chỉ khi D.gate > 0) ---- */
        if (D.gate > 0) {
            const opened = await waitForConversationOpen(snapshot, token, D.gate);
            if (!isRunning || token !== runToken) return false;
            if (!opened.ok) { stop(opened.reason); return false; }

            if (!composer.isConnected || composer.value !== text) {
                pasted = await pasteAndHold(composer, text, token);
                if (!isRunning || token !== runToken) return false;
                if (!pasted.ok) {
                    logPasteFail('Mất nội dung sau chốt (dán lần 2, gate=' + D.gate + ')',
                        pasted.composer, text, pasted.tries);
                    stop('Composer không giữ nội dung (React đã reset)');
                    return false;
                }
                composer = pasted.composer;
            }
        }

        /*
         * Đánh dấu "đang chờ gửi". Cờ này PHẢI bật trước cả hai nhánh, vì
         * nhánh tự gửi phía dưới có kiểm tra lại nó sau await.
         */
        isWaitingForEnter = true;

        /* ---- Enter thủ công ---- */
        if (!autoEnter) {
            setStatus('Đã dán. Hãy ấn ENTER', '#1677ff');
            await new Promise(resolve => { manualResolve = resolve; });
            manualResolve = null;
            if (!isRunning || token !== runToken) return false;

            sentAt = performance.now();
            phaseMark('enter');
            prevSentId = snapshot.id;
            /* Chế độ thủ công: thời gian "dán" chỉ tính tới lúc dán xong, KHÔNG
               tính thời gian người dùng ngồi gõ/nhìn màn hình. */
            recordSend((pastedAt || sentAt) - stepStart);
            phaseAccumulate();
            return true;
        }

        /* ---- Tự gửi ---- */
        setStatus('⚡ Đang gửi...', '#52c41a');

        if (D.autoEnter > 0) await sleep(D.autoEnter);
        else if (D.confirm === 'off') await sleep(0);   // nhanh nhất: chỉ nhường 1 macrotask
        else await nextTick();

        if (!isRunning || token !== runToken || !isWaitingForEnter) return false;
        phaseMark('nhịp');

        /*
         * Chốt lại node composer NGAY TRƯỚC ENTER (V5.21): giữa lúc dán và lúc
         * Enter có await nextTick(); nếu tab bị ẩn, Chrome kẹp setTimeout và
         * Pancake có thể đã thay node #replyBoxComposer ⇒ Enter bắn vào node đã
         * detach thì React (listener ở root container) không nhận được.
         */
        const liveComposer = getComposer();
        let targetBox = (liveComposer && liveComposer.isConnected) ? liveComposer : composer;

        if (!targetBox.isConnected) {
            stop('Composer không còn trong DOM trước Enter (tab vừa hiện lại?)');
            return false;
        }

        if (targetBox !== composer || !sameText(targetBox.value, text)) {
            const re = await pasteAndHold(targetBox, text, token);
            if (!isRunning || token !== runToken) return false;
            if (!re.ok) {
                logPasteFail('Mất nội dung trước Enter (composer bị thay)',
                    re.composer, text, re.tries);
                stop('Composer không giữ nội dung (tab vừa hiện lại?)');
                return false;
            }
            targetBox = re.composer;
        }
        composer = targetBox;

        composer.focus();
        isWaitingForEnter = false;     // Enter này do script bắn, không tính là Enter thật

        composer.dispatchEvent(makeEnterEvent('keydown'));
        composer.dispatchEvent(makeEnterEvent('keyup'));
        prevSentId = snapshot.id;

        sentAt = performance.now();
        phaseMark('enter');
        recordSend(sentAt - stepStart);

        /* Thêm (Số Enter − 1) lần nữa — mỗi lần lấy lại node. */
        for (let i = 1; i < D.enter; i++) {
            await nextTick();
            if (!isRunning || token !== runToken) return false;

            const fresh = getComposer();
            const box2 = fresh && fresh.isConnected ? fresh : composer;
            box2.dispatchEvent(makeEnterEvent('keydown'));
            box2.dispatchEvent(makeEnterEvent('keyup'));
        }

        /*
         * XÁC NHẬN GỬI: chờ Pancake xóa composer. KHÔNG BAO GIỜ bấm lại Enter
         * (composer dùng chung: "chưa gửi" và "đang gửi" không phân biệt được,
         * bấm lại có thể làm khách nhận 2 tin — gửi trùng tệ hơn mất tin).
         */
        if (D.confirm === 'off') {
            /* Không chờ: đi tiếp ngay. Cảnh báo tin-trước-chưa-đi nằm ở đầu
               sendTo() của lượt kế. */
            phaseMark('confirm');
        } else {
            const t0 = performance.now();
            const okFast = await waitForSent(token, D.confirm === 'fast' ? T.confirmFast : T.sendConfirm);
            if (!isRunning || token !== runToken) return false;

            let ok = okFast;
            if (!okFast && D.confirm === 'full') {
                setStatus('⏳ Pancake đang gửi (đường chậm)…', '#faad14');
                ok = await waitForSent(token, T.sendConfirmSlow);
                if (!isRunning || token !== runToken) return false;
                if (ok) slowSends++;
            }
            phaseMark('confirm');

            if (ok && !okFast) {
                console.info(
                    `[Pancake Auto] Gửi chậm (api → extension/socket): `
                    + `${(performance.now() - t0).toFixed(0)} ms`
                    + `${tabHiddenDuringStep ? ' (tab vừa bị ẩn)' : ''}`
                    + ` — khách ${snapshot.name || '?'} (${snapshot.id})`
                );
            }

            if (!ok) {
                unsentIds.push(snapshot.id);
                console.warn(
                    `[Pancake Auto] ⚠ CHƯA THẤY GỬI sau ${(performance.now() - t0).toFixed(0)} ms`
                    + `${tabHiddenDuringStep ? ' (tab vừa bị ẩn)' : ''}`
                    + ` — khách ${snapshot.name || '?'} (${snapshot.id})`
                    + ` — Pancake chưa xóa composer ⇒ tin có thể CHƯA ĐI`
                );
            }
        }

        /* Gộp số đo CẢ pha dán lẫn pha xác nhận vào thống kê. */
        phaseAccumulate();

        return true;
    }

    /* =========================================================
     * VÒNG LẶP CHÍNH — chỉ chạy trong dãy
     * =======================================================*/

    function doneReason() {
        if (runStopId) {
            console.info('[Pancake Auto] Đáy dãy: row ngay dưới khách cuối cùng là', runStopId);
        }
        return `✅ Hết dãy — đã gửi ${stats.sent} khách có snippet trùng mẫu`
            + (runIds.size ? ` (dãy ${runIds.size} khách)` : '');
    }

    async function runLoop(token) {
        while (isRunning && token === runToken) {
            /* Chốt an toàn chống chạy mãi */
            if (stats.sent >= T.maxRun) {
                return stop(`Đã gửi ${stats.sent} khách — chạm trần an toàn ${T.maxRun}, dừng lại.`);
            }

            let target = pickRunTarget();

            if (!target) {
                if (runFinished()) return stop(doneReason());

                setStatus('👁 Chờ khách kế trong dãy...', '#faad14');
                target = await waitForRunTarget(token, T.waitShort);
                if (!isRunning || token !== runToken) return;

                if (!target && !runFinished()) {
                    /* Vẫn chưa thấy ⇒ dãy có thể còn dài hơn tầm nhìn: cuộn
                       xuống để lộ thêm row (Pancake không cuộn bằng scrollTop). */
                    setStatus('👁 Dãy còn dài hơn tầm nhìn — cuộn xuống...', '#faad14');
                    const moved = await scrollDownOnce();
                    if (!isRunning || token !== runToken) return;
                    if (moved) continue;                       // vòng lặp tự tính lại
                    target = await waitForRunTarget(token);    // chờ nốt như bản cũ
                    if (!isRunning || token !== runToken) return;
                }

                if (!target) return stop(doneReason());
            }

            /* Pha CHỜ của khách vừa gửi = từ lúc Enter xong tới lúc bắt được
               khách kế. recordWait() ghép nó với pha dán thành 1 chu kỳ. */
            if (sentAt) {
                recordWait(Math.max(0, performance.now() - sentAt));
                sentAt = 0;
            }

            const ok = await sendTo(target, token);
            if (!ok) {
                /* sendTo() trả false: hoặc đã stop() (có lý do ở panel), hoặc bị
                   bỏ dở vì token đổi. Nếu vẫn "đang chạy" thì đây là lỗi lạ —
                   dừng hẳn để không thành script treo. */
                if (isRunning && token === runToken) stop('Bỏ dở giữa lượt gửi — xem Console');
                return;
            }
        }
    }

    /* =========================================================
     * VÒNG LẶP CHẾ ĐỘ "GỬI HẾT KHÁCH BÊN DƯỚI"
     *
     * Mỗi vòng: lấy row ĐẦU TIÊN từ dấu đỏ trở xuống còn chưa gửi.
     *   • row đó còn "unread"  ⇒ gửi.
     *   • row đó đã đọc        ⇒ hết khối khách đã trả lời ⇒ DỪNG.
     *   • không còn row nào ở dưới trong cửa sổ render ⇒ cuộn xuống tìm tiếp;
     *     cuộn không được nữa ⇒ hết danh sách ⇒ DỪNG.
     * =======================================================*/

    async function runLoopBelow(token) {
        while (isRunning && token === runToken) {
            if (stats.sent >= T.maxRunBelow) {
                return stop(`Đã gửi ${stats.sent} khách — chạm trần an toàn ${T.maxRunBelow}, dừng lại.`);
            }

            let target = pickBelowTarget();

            if (!target) {
                /* React có thể đang render lại sau khi gửi — chờ 1 nhịp rồi thử lại
                   trước khi cuộn (cuộn sớm quá sẽ thừa). */
                await nextTick();
                if (!isRunning || token !== runToken) return;
                target = pickBelowTarget();
            }

            if (!target) {
                setStatus('👁 Hết row trong tầm nhìn — cuộn xuống tìm tiếp...', '#faad14');
                const moved = await scrollDownOnce();
                if (!isRunning || token !== runToken) return;
                if (!moved) {
                    return stop(`✅ Hết danh sách — đã gửi ${stats.sent} khách bên dưới dấu đỏ`);
                }
                continue;
            }

            if (!target.unread) {
                /* Row gần nhất ở dưới dấu đỏ mà chưa gửi đã là hội thoại ĐÃ ĐỌC.
                   Danh sách Pancake xếp: ghim → chưa đọc → đã đọc, nên tới đây là
                   hết khối khách đã trả lời. Kiểm tra lại 1 nhịp cho chắc. */
                await nextTick();
                if (!isRunning || token !== runToken) return;
                const again = pickBelowTarget();
                if (again && !again.unread) {
                    console.info('[Pancake Auto] Hết khối khách đã trả lời — row đã đọc đầu tiên bên dưới dấu đỏ:', again.id);
                    return stop(`✅ Hết khách đã trả lời — đã gửi ${stats.sent} khách bên dưới dấu đỏ`);
                }
                continue;
            }

            if (sentAt) {
                recordWait(Math.max(0, performance.now() - sentAt));
                sentAt = 0;
            }

            const ok = await sendTo(target, token);
            if (!ok) {
                if (isRunning && token === runToken) stop('Bỏ dở giữa lượt gửi — xem Console');
                return;
            }
        }
    }

    /* =========================================================
     * ENTER THẬT TỪ BÀN PHÍM
     * =======================================================*/

    window.addEventListener('keydown', event => {
        if (!event.isTrusted) return;                 // bỏ Enter do script dispatch
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;

        /* Chế độ Auto Enter = OFF: Enter thật là "nút gửi" → mở khóa vòng lặp.
           Chỉ nhận khi con trỏ đang thực sự nằm trong ô soạn (không phải Enter
           ở ô tìm kiếm / hộp thoại khác). */
        if (!isRunning || !isWaitingForEnter || !manualResolve) return;

        const composer = getComposer();
        const el = event.target;
        const inComposer = !!composer && (el === composer || (composer.contains && composer.contains(el)));
        if (!inComposer) return;

        const resolve = manualResolve;
        manualResolve = null;
        resolve();
    }, true);

    /* =========================================================
     * STOP / START
     * =======================================================*/

    function stop(reason = '') {
        phaseSummary();
        if (reason) {
            console.info('[Pancake Auto] Dừng:', reason,
                lastCtx ? { ...lastCtx } : '(chưa có khách nào)');
        }
        lastCtx = null;
        isRunning = false;
        isWaitingForEnter = false;
        runToken++;

        if (manualResolve) { const r = manualResolve; manualResolve = null; r(); }

        removePicker();

        cachedComposer = null;
        cachedList = null;
        handledIds.clear();
        unsentIds = [];
        slowSends = 0;
        prevSentId = '';

        btnRun.textContent = '▶ Bắt đầu';
        btnRun.style.background = '#1677ff';
        bubble.style.background = '#1677ff';

        txtObserver.textContent = '';
        updateRunUI();

        /* Chạy nhanh nhất (không chờ xác nhận): rà lại 1 lần cho chắc — chờ
           400 ms rồi xem ô soạn còn nội dung không. Có ⇒ tin cuối chưa đi. */
        if (D.confirm === 'off' && prevSentId) {
            const lastId = prevSentId;
            setTimeout(() => {
                const box = getComposer();
                const leftover = box ? String(box.value || '').trim() : '';
                if (!leftover) return;
                if (!unsentIds.includes(lastId)) unsentIds.push(lastId);
                console.warn(
                    `[Pancake Auto] ⚠ Không chờ xác nhận: ô soạn vẫn còn nội dung sau khi dừng — tin cuối (${lastId})`
                    + ` có thể CHƯA đi: ${JSON.stringify(leftover.slice(0, 60))}`
                    + ' · bật "Chờ xác nhận: Nhanh/Chắc" nếu hay gặp.'
                );
            }, 400);
        }

        setStatus(
            reason || 'Đã dừng',
            reason.startsWith('🛑') ? '#ff4d4f' : reason.startsWith('✅') ? '#52c41a'
                : reason ? '#faad14' : '#aaa'
        );
    }

    async function start() {
        if (isRunning) return;

        if (!clickPos) {
            alert('Hãy chấm vị trí conversation trước.');
            return;
        }

        removePicker();
        cachedComposer = null;

        isRunning = true;
        isWaitingForEnter = false;
        manualResolve = null;
        cachedText = '';
        resetRun();
        resetStats();

        const token = ++runToken;

        btnRun.textContent = '⏹ Dừng lại';
        btnRun.style.background = '#ff4d4f';
        bubble.style.background = '#ff4d4f';
        setStatus(isBelowMode() ? '🎯 Đang xác định vùng bên dưới dấu đỏ...' : '🎯 Đang xác định dãy...', '#52c41a');

        /* ---- CHẾ ĐỘ BÊN DƯỚI: chỉ cần row ở dấu đỏ, KHÔNG xét snippet ---- */
        if (isBelowMode()) {
            const anchorBelow = getSnapshot();
            if (!anchorBelow) return stop('Không tìm thấy conversation tại dấu đỏ');
            if (!anchorBelow.id) return stop('Không đọc được REAL conversation ID tại dấu đỏ');

            if (stopSnippet && sameSnippet(anchorBelow.snippet, stopSnippet)) {
                return stop(`🛑 Đã gặp câu dừng: ${stopSnippet}`);
            }

            runSnippet  = '';               // chế độ này không dùng snippet
            runAnchorId = anchorBelow.id;
            updateIdStatus({ id: anchorBelow.id });
            updateRunUI();

            console.info(
                `[Pancake Auto] Chế độ GỬI HẾT BÊN DƯỚI · dấu đỏ tại ${anchorBelow.id}`
                + ` · row ở dấu đỏ: ${isUnreadRow(anchorBelow.row) ? 'CHƯA trả lời (sẽ gửi)' : 'đã đọc (bỏ qua)'}`
                + ` · chỉ gửi khách còn "unread" từ dấu đỏ trở xuống`
            );

            if (!inputText.value.trim()) await getSendText();
            if (!isRunning || token !== runToken) return;

            setStatus('🎯 Chế độ gửi hết khách bên dưới — bắt đầu...', '#52c41a');

            runLoopBelow(token).catch(err => {
                console.error('[Pancake Auto] Run error:', err);
                if (isRunning && token === runToken) stop('Script lỗi - xem Console');
            });
            return;
        }

        /* ---- (1) Khách ở dấu đỏ = MẪU của dãy ---- */
        const anchor = getSnapshot();
        if (!anchor) return stop('Không tìm thấy conversation tại dấu đỏ');
        if (!anchor.id) return stop('Không đọc được REAL conversation ID tại dấu đỏ');
        if (anchor.snippet === null) return stop('Không đọc được .snippet-text tại dấu đỏ');

        if (stopSnippet && sameSnippet(anchor.snippet, stopSnippet)) {
            return stop(`🛑 Đã gặp câu dừng: ${stopSnippet}`);
        }

        runSnippet  = anchor.snippet;
        runAnchorId = anchor.id;
        runIds.add(anchor.id);
        runBottomSeen = false;
        runStopId = '';

        /* ---- (2) Mở rộng dãy: các row LIỀN NHAU cùng snippet ---- */
        refreshRun(rowItems());
        updateIdStatus({ id: anchor.id });
        updateRunUI();

        console.info(
            `[Pancake Auto] Dãy xác định: ${runIds.size} khách`
            + ` · neo (khách ở dấu đỏ): ${runAnchorId}`
            + ` · snippet mẫu: ${JSON.stringify(runSnippet)}`
            + (runBottomSeen ? ' · đã thấy đáy dãy' : ' · đáy dãy còn ngoài tầm nhìn')
        );

        /* ---- (3) Nội dung: đọc clipboard 1 lần nếu ô text trống ---- */
        if (!inputText.value.trim()) await getSendText();
        if (!isRunning || token !== runToken) return;

        if (runIds.size === 1) {
            setStatus('⚠ Dãy chỉ có 1 khách (không thấy row liền kề cùng snippet) — vẫn gửi', '#faad14');
        } else {
            setStatus(`🎯 Dãy ${runIds.size} khách — bắt đầu gửi...`, '#52c41a');
        }

        runLoop(token).catch(err => {
            console.error('[Pancake Auto] Run error:', err);
            if (isRunning && token === runToken) stop('Script lỗi - xem Console');
        });
    }

    btnRun.onclick = () => (isRunning ? stop() : start());

    /* =========================================================
     * HOTKEY
     * =======================================================*/

    window.addEventListener('keydown', event => {
        if (!hotkeyEnabled) return;
        if (event.key !== activationHotkey) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
        if (root.contains(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (event.repeat) return;

        if (isRunning) stop(`Đã dừng bằng ${activationHotkey.toUpperCase()}`);
        else start();
    }, true);

    /* =========================================================
     * PAGE HIDE
     * =======================================================*/

    window.addEventListener('pagehide', () => {
        clearTimeout(saveUITimer);
        saveUITimer = null;
        saveUI();
        saveSpeed();
    });

    /* =========================================================
     * INIT
     * =======================================================*/

    updateMarker();
    restoreUI();
    syncUI();

    console.info(`[Pancake Auto] V${VERSION} sẵn sàng — 2 chế độ: DÃY (snippet) · GỬI HẾT KHÁCH BÊN DƯỚI (unread)`);

    if (clickPos) setTimeout(() => updateIdStatus(getSnapshot()), 0);
})();
