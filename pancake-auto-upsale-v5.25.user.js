// ==UserScript==
// @name         Pancake Auto Upsale V5.25 (giữ khung danh sách)
// @namespace    http://tampermonkey.net/
// @version      5.25.0
// @description  V5.24.1 + giữ khung danh sách: dấu đỏ luôn nằm đúng khách đang gửi, không bị "đẩy" khi Pancake xếp lại danh sách sau mỗi tin. Selectors verified against Pancake dashboard source.
// @match        *://*.pancake.vn/*
// @grant        GM_getClipboard
// @run-at       document-end
// @noframes
// ==/UserScript==

/*
 * ============================================================
 *  V5.25 — NỀN LÀ V5.24.1, CHỈ THÊM PHẦN "GIỮ KHUNG DANH SÁCH"
 *
 *  Vì sao cần: sau MỖI tin gửi, Pancake đưa hội thoại vừa trả lời lên
 *  ĐẦU NHÓM của nó (source: function eg() trong _app-9331d46f21a84eb1.v6.js
 *  — xoá phần tử khỏi mảng bằng eb() rồi splice vào vị trí
 *  `findIndex(e => e.seen && r.updated_at >= e.updated_at)`), còn danh sách
 *  thì sắp theo ev(): ghim → chưa đọc → đã đọc, trong mỗi nhóm là
 *  updated_at GIẢM DẦN (ey()).
 *
 *  Danh sách là virtual list: nó giữ nguyên offset pixel
 *  (`transform: translateY(Npx)` trên .rc-virtual-list-holder-inner).
 *  ⇒ một hội thoại bị rút khỏi chỗ đang xem và chèn lên phía TRÊN khung
 *  nhìn ⇒ mọi dòng phía trên bị đẩy xuống đúng 1 dòng, còn dấu đỏ (toạ độ
 *  màn hình cố định) thì trỏ sang hội thoại ở TRÊN — tức khách vừa gửi rồi.
 *
 *  Cách chữa (2 lớp, không đổi cách chọn khách của V5.24.1):
 *    1. 📌 GHIM KHUNG: sau mỗi lần Pancake xếp lại, cuộn bù đúng phần bị
 *       lệch để khách kế tiếp nằm lại ĐÚNG dấu đỏ. Chỉ bù khi lệch ≤ 2,5
 *       dòng (lệch xa hơn thì không giật khung, xem lớp 2).
 *    2. DẤU ĐỎ NÓI THẬT: dấu đỏ + viền đỏ được vẽ lên chính row sắp gửi.
 *       Nếu không cuộn bù được (hoặc lệch quá xa) thì dấu đỏ đi theo row đó,
 *       không còn đứng yên một chỗ trỏ sai khách.
 *
 *  Phần còn lại giữ nguyên V5.24.1: lọc snippet, câu dừng, quét chủ động,
 *  Auto Enter, thống kê từng pha, hotkey, panel.
 *
 *  Nguồn gốc từng selector (đối chiếu html.txt / html2.txt / html3.txt):
 *
 *  #conversationList.rc-virtual-list.infinite-conv-list
 *     └ .rc-virtual-list-holder  (height 651|902, overflow-y:hidden)
 *         └ div[style="height:...px;position:relative;overflow:hidden"]
 *              └ .rc-virtual-list-holder-inner (transform: translateY(Npx))
 *                   └ <div id="{pageId}_{peerId}">          ← REAL ID
 *                        └ <div id="...__{rowIndex}"
 *                               class="media conversation-list-item [unread]
 *                                      [selected] [is-pinned] [last-pinned]">
 *                             ├ .name-module > .name-text / .time-modul
 *                             └ .snippet-wrap > .snippet-line > .snippet-text
 *
 *  #reply_box … textarea#replyBoxComposer   (ô soạn, gửi bằng Enter)
 *  .chat-menu > .selected-customer > #pageCustomer > .customer-name
 *
 *  LƯU Ý: row bị tái sử dụng khi cuộn (virtual list) ⇒ không cache node row.
 *  Row đang mở mang class "selected" (không phải "active").
 * ============================================================
 */

(function () {
    'use strict';

    const VERSION = '5.25.0';

    /* =========================================================
     * SELECTORS — tất cả lấy từ HTML thật, không đoán
     * =======================================================*/

    const SEL = {
        listRoot:   '#conversationList',
        row:        '.conversation-list-item',
        snippet:    '.snippet-text',
        name:       '.name-text',
        headerName: '#pageCustomer .customer-name'
    };

    const RE_ROW_ID  = /^(\d+_\d+)__\d+$/;   // "...__52" — rowIndex đổi khi cuộn
    const RE_REAL_ID = /^\d+_\d+$/;          // {pageId}_{peerId} | COMMENT: {postId}_{peerId}

    /* Thời gian chờ (ms) */
    const T = {
        selected:     0,      // 0 = không chờ mở hội thoại (nhanh nhất)
        composer:  3000,      // chờ #replyBoxComposer
        observer:  3000,      // watchdog chờ khách kế
        pollFast:   100,
        pollMid:    200,
        pollSlow:   300,
        minGap:      16,
        gapMid:      60,
        gapSlow:    120,
        scan:         1,
        pasteHold: 2000,      // dán lại cho tới khi composer GIỮ được nội dung
        sendConfirm: 600,     // chờ Pancake xoá composer = đã gửi
        sendConfirmSlow: 0,   // chờ thêm (0 = tắt)
        /* V5.25 — giữ khung danh sách */
        pinMaxRows: 2.5,      // lệch quá bấy nhiêu dòng thì KHÔNG cuộn bù (khỏi giật)
        pinTries:   3,        // số vòng đo–cuộn–đo lại
        pinChunk: 120,        // px mỗi lần phát wheel (app xử lý mượt hơn)
        pinDead:    8         // sai số còn lại được coi là "đã đúng chỗ"
    };

    function pollDelay(elapsed) {
        if (elapsed < 400) return T.pollFast;
        if (elapsed < 1200) return T.pollMid;
        return T.pollSlow;
    }

    function checkGap(elapsed) {
        if (elapsed < 200) return T.minGap;
        if (elapsed < 1200) return T.gapMid;
        return T.gapSlow;
    }

    /* =========================================================
     * STATE
     * =======================================================*/

    let isRunning = false;
    let isWaitingForEnter = false;
    let tabHiddenDuringStep = false;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) tabHiddenDuringStep = true;
    }, true);

    let initialSnippet = null;
    let cachedText = '';

    let autoEnter = false;
    let bypassSnippet = false;
    let scanEnabled = true;
    let hotkeyEnabled = false;

    let runToken = 0;
    let lastConversationId = '';

    const handledIds = new Set();
    let unsentIds = [];
    let slowSends = 0;

    let lastCtx = null;
    let cachedComposer = null;
    let activePicker = null;
    let stopSnippet = '';
    let clickPos = null;

    /* V5.25 — row đang được đánh dấu (sắp gửi) + số px đã cuộn bù trong lượt */
    let markedRow = null;
    let pinTotalPx = 0;
    let pinLogged = false;

    let stats = { sent: 0, cycles: 0, totalMs: 0, sendMs: 0, waitMs: 0, min: 0, max: 0 };
    let upNoticed = false;
    let pendingSend = null;
    let stepStart = 0;
    let sentAt = 0;
    let lastWaitMs = 0;
    let lastSendMs = 0;

    function resetStats() {
        stats = { sent: 0, cycles: 0, totalMs: 0, sendMs: 0, waitMs: 0, min: 0, max: 0 };
        pendingSend = null;
        phaseSum = null;
        unsentIds = [];
        slowSends = 0;
        upNoticed = false;
        pinTotalPx = 0;
        pinLogged = false;
        renderStats();
    }

    function recordSend(sendMs) {
        stats.sent++;
        stats.sendMs += sendMs;
        pendingSend = sendMs;
        renderStats();
    }

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

    /* ===== Đo từng đoạn trong pha dán ===== */
    let phaseMs = null;
    let phaseAt = 0;
    let pasteTries = 0;

    function phaseReset() {
        phaseAt = performance.now();
        phaseMs = { click: 0, composer: 0, paste: 0, nhịp: 0, enter: 0, confirm: 0 };
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
            + (pinTotalPx
                ? `\n   📌 giữ khung ${Math.round(pinTotalPx)} px (${(pinTotalPx / Math.max(1, rowHeight())).toFixed(1)} dòng bị Pancake đẩy, đã bù lại)`
                : '')
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

    /* Observer */
    let listObserver = null;
    let observerState = null;
    let lastCheckAt = 0;

    /* =========================================================
     * STORAGE (giữ key cũ để không mất cài đặt)
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

    function nextTick(max = 24) {
        return new Promise(resolve => {
            let done = false;
            const finish = () => { if (done) return; done = true; resolve(); };
            try { requestAnimationFrame(finish); } catch (err) {}
            setTimeout(finish, max);
        });
    }

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

    const DEFAULT_SPEED = { transition: 0, snippet: 0, conversation: 0, autoEnter: 0, observer: 3000, gate: 0, enter: 1, upBottom: 1 };
    const speed = { ...DEFAULT_SPEED, ...(store.get(K.speed, {}) || {}) };

    const PINNED = { transition: 0, snippet: 0, conversation: 0, autoEnter: 0, observer: 3000, gate: 0 };

    const D = {
        transition:   PINNED.transition,
        snippet:      PINNED.snippet,
        conversation: PINNED.conversation,
        autoEnter:    PINNED.autoEnter,
        observer:     PINNED.observer,
        gate:         PINNED.gate,          // 0 = tắt chốt .selected trước Enter
        enter:        Math.min(3, Math.max(1, clampInt(speed.enter, 1))),
        upBottom:     speed.upBottom === 0 ? 0 : 1,
        /* V5.25 — giữ khung danh sách (bật mặc định) */
        pinView:      savedPinFlag()
    };

    function savedPinFlag() {
        const ui = store.get(K.ui, null);
        if (ui && typeof ui === 'object' && Object.prototype.hasOwnProperty.call(ui, 'pinView')) {
            return ui.pinView !== false;
        }
        return true;
    }

    function saveSpeed() {
        store.set(K.speed, D);
    }

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
        if (dirty) store.set(K.speed, saved);
    })();

    /* =========================================================
     * DOM LOOKUP — theo source
     * =======================================================*/

    function getRowFrom(element) {
        if (!element || !element.closest) return null;
        const row = element.closest(SEL.row);
        if (!row) return null;
        return row.closest(SEL.listRoot) ? row : null;
    }

    function getRealId(row) {
        if (!row) return '';
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

    let cachedList = null;
    function getList() {
        if (cachedList && cachedList.isConnected) return cachedList;
        cachedList = document.getElementById('conversationList');
        return cachedList && cachedList.isConnected ? cachedList : null;
    }

    function getListInner() {
        const list = getList();
        return list ? list.querySelector('.rc-virtual-list-holder-inner') : null;
    }

    function getSelectedRow() {
        const list = getList();
        return list ? list.querySelector(SEL.row + '.selected') : null;
    }

    const getHeaderName = () => {
        const el = document.querySelector(SEL.headerName);
        return el ? normalizeText(el.textContent || '') : '';
    };

    function getComposer() {
        if (cachedComposer && cachedComposer.isConnected) return cachedComposer;
        cachedComposer = document.getElementById('replyBoxComposer');
        return cachedComposer && cachedComposer.isConnected ? cachedComposer : null;
    }

    /* =========================================================
     * SNAPSHOT TẠI DẤU ĐỎ
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
     * QUÉT CHỦ ĐỘNG (V5.6)
     * Sau Enter, khách kế đã nằm sẵn trong DOM ngay dưới row vừa gửi.
     * =======================================================*/

    function listRows() {
        const list = getList();
        return list ? list.querySelectorAll(SEL.row) : null;
    }

    /** Row theo REAL ID (virtual list tái sử dụng node ⇒ luôn phải tìm lại). */
    function rowById(id) {
        const rows = listRows();
        if (!rows || !id) return null;
        for (let i = 0; i < rows.length; i++) {
            if (getRealId(rows[i]) === id) return rows[i];
        }
        return null;
    }

    function findRowAfter(afterId) {
        const rows = listRows();
        if (!rows || !afterId) return null;
        for (let i = 0; i < rows.length - 1; i++) {
            if (getRealId(rows[i]) === afterId) {
                const next = rows[i + 1];
                return next && next.isConnected ? next : null;
            }
        }
        return null;
    }

    function snapshotFromRow(row) {
        if (!row || !row.isConnected) return null;
        const box = row.getBoundingClientRect();
        return {
            row,
            found: row,
            id: getRealId(row),
            snippet: getSnippet(row),
            name: getName(row),
            x: Math.round(box.left + box.width / 2),
            y: Math.round(box.top + box.height / 2)
        };
    }

    function indexOfRow(id) {
        const rows = listRows();
        if (!rows || !id) return -1;
        for (let i = 0; i < rows.length; i++) {
            if (getRealId(rows[i]) === id) return i;
        }
        return -1;
    }

    /**
     * Row đầu tiên CHƯA XỬ LÝ, tính TỪ vị trí `from` TRỞ ĐI — không quay ngược
     * lên trên (V5.10 từng quét từ index 0 và click loạn lên trên đầu danh sách).
     */
    /** Row có snippet được phép gửi (bypass, hoặc đúng mẫu của lượt chạy). */
    const runSnippetOk = snippet =>
        bypassSnippet || !initialSnippet || snippet === initialSnippet;

    /**
     * Còn row NÀO chưa gửi, cùng snippet mẫu, nằm NGANG HOẶC DƯỚI dấu đỏ?
     *
     * Vì sao cần: Pancake đưa hội thoại vừa gửi lên đầu nhóm nên sau mỗi tin
     * dấu đỏ trỏ vào row ở TRÊN (khách đã gửi, hoặc khách khác snippet). Nhìn
     * thấy row đó rồi kết luận "hết khách" là dừng oan.
     */
    function hasMatchingInView() {
        const rows = listRows();
        if (!rows) return false;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row.isConnected) continue;
            const id = getRealId(row);
            if (!id || handledIds.has(id)) continue;
            if (!runSnippetOk(getSnippet(row))) continue;
            if (clickPos) {
                const box = row.getBoundingClientRect();
                if (box.bottom <= clickPos.y) continue;   // nằm phía TRÊN dấu đỏ
            }
            return true;
        }
        return false;
    }

    function firstUnhandledRowFrom(from = 0) {
        const rows = listRows();
        if (!rows) return null;

        const filterOn = !bypassSnippet && initialSnippet;

        for (let i = Math.max(0, from); i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row.isConnected) continue;
            const id = getRealId(row);
            if (!id || id === lastConversationId || handledIds.has(id)) continue;
            if (filterOn && getSnippet(row) !== initialSnippet) continue;
            return row;
        }
        return null;
    }

    function scanNextRow() {
        /*
         * V5.25 — nhánh "row đang ở dấu đỏ" PHẢI kiểm tra snippet.
         *
         * V5.24.1 nhận row ở dấu đỏ vô điều kiện, rồi executeStep mới so
         * snippet và DỪNG. Nhưng sau mỗi tin gửi, Pancake đẩy hội thoại vừa
         * gửi lên đầu nhóm ⇒ dấu đỏ trỏ vào row nằm NGAY TRÊN khách kế tiếp
         * (khách đã gửi hoặc khách khác snippet) ⇒ script dừng sớm dù dãy
         * còn khách. Bỏ qua row đó, quét tiếp xuống dưới.
         */
        const at = getSnapshot();
        if (at && at.id && at.id !== lastConversationId && !handledIds.has(at.id)
            && runSnippetOk(at.snippet)) return at;

        const after = snapshotFromRow(findRowAfter(lastConversationId));
        if (after && after.id && after.id !== lastConversationId
            && !handledIds.has(after.id)
            && runSnippetOk(after.snippet)) return after;

        let from = indexOfRow(lastConversationId);
        if (from < 0 && at && at.id) from = indexOfRow(at.id);
        if (from < 0) return null;

        const any = snapshotFromRow(firstUnhandledRowFrom(from));
        if (any && any.id && !handledIds.has(any.id)) return any;

        /* Lùi lên ĐÚNG 1 row khi ở cuối bảng (V5.18) — chỉ 1 row, không quét ngược. */
        if (D.upBottom && from > 0) {
            const rows = listRows();
            const up = rows[from - 1];
            if (up && up.isConnected) {
                const upId = getRealId(up);
                if (upId && upId !== lastConversationId && !handledIds.has(upId)) {
                    const filtering = !bypassSnippet && initialSnippet;
                    if (!filtering || getSnippet(up) === initialSnippet) {
                        if (!upNoticed) {
                            upNoticed = true;
                            console.log('[Pancake Auto] Hết row bên dưới (đang ở cuối bảng)'
                                + ' → lùi lên TỪNG row một, mỗi bước đúng 1 row.');
                        }
                        return snapshotFromRow(up);
                    }
                }
            }
        }

        return null;
    }

    /* =========================================================
     * V5.25 — GIỮ KHUNG DANH SÁCH
     *
     * Bối cảnh (đã đối chiếu source):
     *   ev()  sắp: ghim → chưa đọc → đã đọc, mỗi nhóm updated_at giảm dần.
     *   eg()  sau khi gửi: rút hội thoại khỏi mảng (eb) rồi splice vào
     *         ĐẦU NHÓM của nó (`findIndex(e => e.seen && r.updated_at >= e.updated_at)`).
     *   List là virtual list, giữ nguyên translateY ⇒ hội thoại biến khỏi chỗ
     *   đang xem và hiện lại phía TRÊN khung nhìn ⇒ mọi row phía trên bị đẩy
     *   xuống 1 dòng và dấu đỏ trỏ sang row ở trên (đã gửi rồi).
     *
     * Chữa: đo row sắp gửi, cuộn bù đúng phần lệch để nó nằm lại ở dấu đỏ.
     * Cuộn bằng wheel — đúng đường mà chuột người dùng đi, nên app chấp nhận.
     * =======================================================*/

    function getListHolder() {
        const list = getList();
        return list ? list.querySelector('.rc-virtual-list-holder') : null;
    }

    function getListInnerEl() {
        return getListInner();
    }

    /** Cao 1 row (px) — dùng để giới hạn số dòng được phép bù. */
    function rowHeight(row) {
        const h = row && row.getBoundingClientRect
            ? row.getBoundingClientRect().height
            : 0;
        return h > 10 ? h : 44;
    }

    /** Phát wheel theo từng khối ≤ T.pinChunk px. deltaY > 0 = cuộn xuống. */
    function wheelBy(px) {
        const holder = getListHolder();
        if (!holder || !px) return false;
        const box = holder.getBoundingClientRect();
        const x = Math.round(box.left + box.width / 2);
        const y = Math.round(box.top + box.height / 2);
        const total = Math.abs(px);
        const dir = px < 0 ? -1 : 1;
        let sent = 0;
        while (sent < total) {
            const d = Math.min(T.pinChunk, total - sent) * dir;
            try {
                holder.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: d, deltaMode: 0, bubbles: true, cancelable: true,
                    clientX: x, clientY: y, view: window
                }));
            } catch (err) {
                return false;
            }
            sent += Math.abs(d);
        }
        return true;
    }

    /**
     * Kéo row `id` về đúng dấu đỏ (theo trục dọc).
     * Trả true nếu row đã nằm ở dấu đỏ (hoặc không cần/không được phép bù).
     */
    async function pinViewport(id, token) {
        if (!D.pinView || !clickPos || !id) return false;

        const probe = rowById(id);
        if (!probe) return false;
        const limit = Math.max(24, rowHeight(probe) * T.pinMaxRows);

        for (let pass = 0; pass < T.pinTries; pass++) {
            const row = rowById(id);
            if (!row) return false;

            const box = row.getBoundingClientRect();
            const wantTop = clickPos.y - box.height / 2;
            const delta = Math.round(box.top - wantTop);

            if (Math.abs(delta) <= T.pinDead) return true;
            /* Lệch quá xa (dãy bị cắt, danh sách nhảy trang...) ⇒ không giật khung. */
            if (Math.abs(delta) > limit) return false;

            if (!wheelBy(delta)) return false;
            pinTotalPx += Math.abs(delta);

            if (!pinLogged) {
                pinLogged = true;
                console.info(
                    '[Pancake Auto] 📌 Pancake xếp lại danh sách sau khi gửi: hội thoại vừa gửi'
                    + ' nhảy lên đầu nhóm của nó ⇒ các row phía trên bị đẩy xuống.'
                    + ' Script cuộn bù để khách kế tiếp nằm lại đúng dấu đỏ.'
                );
            }

            await nextTick(60);
            if (!isRunning || (token !== undefined && token !== runToken)) return false;
        }

        const row = rowById(id);
        if (!row) return false;
        const box = row.getBoundingClientRect();
        return Math.abs(box.top - (clickPos.y - box.height / 2)) <= Math.max(T.pinDead, rowHeight(row) * 0.5);
    }

    /** Dấu đỏ + viền đỏ lên row sắp gửi (dấu đỏ không còn trỏ sai khách). */
    function markTarget(row) {
        clearMark();
        if (!row || !row.isConnected) return;
        markedRow = row;
        try { row.classList.add('pk-target'); } catch (err) {}
        updateMarker();
    }

    function clearMark() {
        if (markedRow) {
            try { markedRow.classList.remove('pk-target'); } catch (err) {}
            markedRow = null;
        }
        updateMarker();
    }

    /**
     * Cập nhật lại vị trí dấu đỏ khi row bị xếp lại (observer gọi).
     * Gộp tối đa 1 lần/50ms: mỗi lần đọc rect là 1 lần ép layout, mà Pancake
     * có thể mutate danh sách liên tục lúc đang xếp lại.
     */
    let lastMarkerAt = 0;
    function refreshMarker() {
        if (!markedRow) return;
        const now = performance.now();
        if (now - lastMarkerAt < 50) return;
        lastMarkerAt = now;
        if (!markedRow.isConnected) { markedRow = null; updateMarker(); return; }
        updateMarker();
    }

    /* =========================================================
     * POLLING HELPER
     * =======================================================*/

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

    /* =========================================================
     * UI
     * =======================================================*/

    const CSS = `
#pk-root{position:fixed;bottom:25px;right:25px;z-index:2147483647;
  font-family:Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;user-select:none}
#pk-panel{width:255px;display:flex;flex-direction:column;gap:8px;padding:12px;
  background:rgba(26,26,30,.96);color:#fff;border:1px solid #444;border-radius:10px;
  box-shadow:0 8px 24px rgba(0,0,0,.5);font-size:12px;
  max-height:calc(100vh - 30px);overflow-y:auto;box-sizing:border-box}
#pk-header{display:flex;justify-content:space-between;align-items:center;cursor:move;
  font-weight:700;border-bottom:1px solid #444;padding-bottom:6px}
#pk-min{cursor:pointer;color:#aaa;padding:0 5px}
.pk-card{background:#151515;border:1px solid #444;border-radius:6px;padding:7px;
  display:flex;flex-direction:column;gap:6px}
.pk-card.red{border-color:#5c2a2a}
.pk-title{text-align:center;font-size:11px;font-weight:700}
.pk-title.red{color:#ff7875}
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
.pk-btn.on-amber{background:#d48806;color:#fff;border-color:#faad14}
.pk-btn.purple{background:#722ed1;color:#fff;border-color:#9254de}
.pk-btn.danger{background:#222;color:#ff7875}
.pk-btn:disabled{opacity:.5;cursor:not-allowed}
#pk-run{width:100%;background:#1677ff;color:#fff;font-weight:700;border:0;
  border-radius:5px;padding:8px;cursor:pointer;font-size:12px}
#pk-hotkey{width:75px;background:#080808;color:#fff;border:1px solid #555;
  border-radius:4px;padding:4px}
#pk-text{box-sizing:border-box;width:100%;background:#111;color:#fff;
  border:1px solid #555;border-radius:4px;padding:6px}
#pk-pos{text-align:center;font-size:10px;color:#888}
#pk-id{text-align:center;font-size:9px;color:#777;word-break:break-all}
#pk-observer{text-align:center;font-size:9px;color:#777}
#pk-hotkey-hint{text-align:center;font-size:10px;color:#777}
#pk-status{min-height:16px;text-align:center;font-size:11px;color:#aaa;word-break:break-word}
#pk-stats{text-align:center;font-size:9px;color:#5f5f5f}
#pk-stop-snippet{color:#777;text-align:center;font-size:10px;word-break:break-word;
  max-height:42px;overflow:hidden}
#pk-bubble{display:none;width:42px;height:42px;border-radius:50%;background:#1677ff;
  color:#fff;font-size:20px;align-items:center;justify-content:center;cursor:move;
  box-shadow:0 4px 15px rgba(0,0,0,.4);position:relative}
#pk-marker{position:fixed;width:14px;height:14px;border-radius:50%;background:#ff4d4f;
  border:2px solid #fff;box-shadow:0 0 10px rgba(255,77,79,.9);pointer-events:none;
  z-index:2147483646;transform:translate(-50%,-50%);display:none}
#pk-bubble-badge{position:absolute;top:-4px;right:-4px;width:20px;height:20px;
  border-radius:50%;background:#faad14;color:#1a1a1e;border:2px solid #1a1a1e;
  display:none;align-items:center;justify-content:center;
  font-size:11px;line-height:1;font-weight:700;pointer-events:none;
  box-shadow:0 1px 4px rgba(0,0,0,.6)}
/* V5.25 — row sắp gửi: dấu đỏ không còn là điểm mù */
.conversation-list-item.pk-target{
  outline:2px solid #ff4d4f;outline-offset:-2px;
  box-shadow:inset 0 0 0 2px rgba(255,77,79,.30);
  background-color:rgba(255,77,79,.10)!important}
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
          <span>🤖 Auto UPSALE V5.25</span>
          <span id="pk-min">─</span>
        </div>

        <div class="pk-card">
          <div class="pk-title">⚙ Tuỳ chọn</div>
          ${speedRow('pk-enter-count',   'Số Enter',         D.enter)}
          ${speedRow('pk-up-bottom',     'Lùi lên ở cuối',   D.upBottom)}
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

        <div class="pk-row" style="gap:5px">
          <button id="pk-auto-enter" class="pk-btn flex"></button>
          <button id="pk-bypass" class="pk-btn flex"></button>
        </div>
        <div class="pk-row" style="gap:4px">
          <button id="pk-scan" class="pk-btn flex"></button>
        </div>
        <div class="pk-row" style="gap:4px">
          <button id="pk-pin" class="pk-btn flex"></button>
        </div>

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

      <div id="pk-bubble">🤖<span id="pk-bubble-badge" title="Đang BỎ LỌC snippet — gửi cho MỌI đoạn chat">⏭</span></div>
    `;

    const marker = document.createElement('div');
    marker.id = 'pk-marker';

    document.body.appendChild(root);
    document.body.appendChild(marker);

    /* Dùng [id="..."] thay vì #id (tránh fast-path id của toàn document). */
    const $ = id => root.querySelector(`[id="${id}"]`);

    const panel        = $('pk-panel');
    const bubble       = $('pk-bubble');
    const bubbleBadge  = $('pk-bubble-badge');
    const btnRun       = $('pk-run');
    const btnPick      = $('pk-pick');
    const btnClear     = $('pk-clear');
    const btnAutoEnter = $('pk-auto-enter');
    const btnBypass    = $('pk-bypass');
    const btnScan      = $('pk-scan');
    const btnPin       = $('pk-pin');
    const btnHotkey    = $('pk-hotkey-enable');
    const btnStopPick  = $('pk-stop-pick');
    const btnStopClear = $('pk-stop-clear');
    const inputText    = $('pk-text');
    const selectHotkey = $('pk-hotkey');
    const txtPos       = $('pk-pos');
    const txtId        = $('pk-id');
    const txtObserver  = $('pk-observer');
    const txtStatus    = $('pk-status');
    const txtHotkeyHint= $('pk-hotkey-hint');
    const txtStop      = $('pk-stop-snippet');
    const txtStats     = $('pk-stats');
    const inputs       = {
        enter:    $('pk-enter-count'),
        upBottom: $('pk-up-bottom')
    };

    /* =========================================================
     * UI STATE
     * =======================================================*/

    let savedUI = store.get(K.ui, {}) || {};
    let activationHotkey = savedUI.hotkey === 'F4' ? 'F4' : 'Tab';

    autoEnter     = savedUI.autoEnter === true;
    bypassSnippet = savedUI.bypassSnippet === true;
    scanEnabled   = savedUI.scanEnabled !== false;
    hotkeyEnabled = false;
    stopSnippet   = normalizeText(store.get(K.stop, '') || '');
    clickPos      = store.get(K.pos, null);

    function setStatus(text, color = '#aaa') {
        txtStatus.textContent = text;
        txtStatus.style.color = color;
    }

    /**
     * V5.25 — dấu đỏ KHÔNG còn là một điểm mù.
     *   • đang có row sắp gửi  → vẽ đúng tâm row đó
     *   • không có             → vẽ ở toạ độ người dùng chấm (như V5.24.1)
     *   • row sắp gửi bị cuộn ra khỏi khung danh sách → ẩn (thà ẩn còn hơn trỏ sai)
     */
    function updateMarker() {
        if (markedRow && !markedRow.isConnected) markedRow = null;

        if (markedRow) {
            const row = markedRow.getBoundingClientRect();
            const holder = getListHolder();
            const hb = holder ? holder.getBoundingClientRect() : null;
            const cx = row.left + row.width / 2;
            const cy = row.top + row.height / 2;

            if (hb && (cy < hb.top + 2 || cy > hb.bottom - 2)) {
                marker.style.display = 'none';
                return;
            }
            marker.style.display = 'block';
            marker.style.left = Math.round(cx) + 'px';
            marker.style.top  = Math.round(cy) + 'px';
            return;
        }

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

    function updateBubbleBadge() {
        if (!bubbleBadge) return;
        const minimized = panel.style.display === 'none';
        bubbleBadge.style.display = (minimized && bypassSnippet === true) ? 'flex' : 'none';
    }

    function syncUI() {
        btnHotkey.textContent = hotkeyEnabled ? '🔓 Kích hoạt Hotkey: ON' : '🔒 Kích hoạt Hotkey: OFF';
        btnHotkey.className = 'pk-btn wide' + (hotkeyEnabled ? ' on-green' : '');

        btnAutoEnter.textContent = autoEnter ? '⚡ Auto Enter: ON' : '⚡ Auto Enter: OFF';
        btnAutoEnter.className = 'pk-btn flex' + (autoEnter ? ' on-green' : '');

        btnBypass.textContent = bypassSnippet ? '⏭ Bỏ lọc: ON' : '⏭ Bỏ lọc: OFF';
        btnBypass.className = 'pk-btn flex' + (bypassSnippet ? ' on-amber' : '');

        btnScan.textContent = scanEnabled ? '🔎 Quét chủ động: ON' : '🔎 Quét chủ động: OFF';
        btnScan.className = 'pk-btn flex' + (scanEnabled ? ' on-green' : '');

        btnPin.textContent = D.pinView ? '📌 Ghim khung: ON' : '📌 Ghim khung: OFF';
        btnPin.className = 'pk-btn flex' + (D.pinView ? ' on-green' : '');
        btnPin.title = 'Pancake đưa hội thoại vừa gửi lên đầu nhóm ⇒ khung bị đẩy xuống.'
            + ' Bật: script cuộn bù để khách kế nằm lại đúng dấu đỏ.';

        updateBubbleBadge();

        selectHotkey.value = activationHotkey;
        txtHotkeyHint.textContent = `${activationHotkey.toUpperCase()} = Bắt đầu / Dừng`;

        if (clickPos) {
            txtPos.textContent = `Tọa độ: (${clickPos.x}, ${clickPos.y})`;
            txtPos.style.color = '#52c41a';
        } else {
            txtPos.textContent = 'Chưa chọn tọa độ';
            txtPos.style.color = '#888';
        }

        updateStopUI();
    }

    let saveUITimer = null;

    function saveUI() {
        const rect = root.getBoundingClientRect();
        store.set(K.ui, {
            text: inputText.value,
            autoEnter,
            bypassSnippet,
            scanEnabled,
            pinView: D.pinView,
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

        const minimized = savedUI.minimized === true;
        panel.style.display = minimized ? 'none' : 'flex';
        bubble.style.display = minimized ? 'flex' : 'none';

        const p = savedUI.position;
        if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) {
            root.style.right = 'auto';
            root.style.bottom = 'auto';
            root.style.left = p.left + 'px';
            root.style.top = p.top + 'px';
        }
        updateBubbleBadge();
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
    btnBypass.onclick = () => { bypassSnippet = !bypassSnippet; syncUI(); saveUI(); };
    btnScan.onclick = () => { scanEnabled = !scanEnabled; syncUI(); saveUI(); };
    btnPin.onclick = () => { D.pinView = !D.pinView; syncUI(); saveUI(); };

    selectHotkey.onchange = () => {
        activationHotkey = selectHotkey.value === 'F4' ? 'F4' : 'Tab';
        syncUI();
        saveUI();
    };

    inputText.addEventListener('input', scheduleSaveUI);

    $('pk-min').onclick = () => {
        panel.style.display = 'none';
        bubble.style.display = 'flex';
        syncUI();
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
        syncUI();
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
     * GHI TEXT VÀO COMPOSER (<textarea> do React điều khiển)
     * =======================================================*/

    function setComposerValue(element, text) {
        if (!element || !text) return false;

        try {
            element.focus();

            if (element instanceof HTMLTextAreaElement) {
                const setter = Object.getOwnPropertyDescriptor(
                    HTMLTextAreaElement.prototype, 'value'
                )?.set;

                /* React theo dõi value bằng inputValueTracking: gán đúng giá trị
                   ĐANG CÓ thì React không bắn onChange ⇒ Pancake không biết có
                   nội dung ⇒ lần render sau đè mất. Xoá trước rồi mới gán. */
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
     * ENTER
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
     * DIRECT ROW OBSERVER
     * =======================================================*/

    function cleanupObserver() {
        if (listObserver) {
            listObserver.disconnect();
            try { listObserver.takeRecords(); } catch (err) {}
            listObserver = null;
        }
        if (observerState) {
            if (observerState.timeoutId) clearTimeout(observerState.timeoutId);
            if (observerState.pollId) clearInterval(observerState.pollId);
            if (observerState.checkTimer) clearTimeout(observerState.checkTimer);
        }
        observerState = null;

        txtObserver.textContent = '👁 Direct Observer: OFF';
        txtObserver.style.color = '#777';
    }

    function resolveObserver(snapshot) {
        const state = observerState;
        if (!state || state.resolved) return;

        state.resolved = true;
        cleanupObserver();

        if (snapshot) {
            txtObserver.textContent = '👁 Direct Observer: HIT';
            txtObserver.style.color = '#52c41a';
        } else {
            txtObserver.textContent = '👁 Direct Observer: TIMEOUT';
            txtObserver.style.color = '#faad14';
        }

        const resolve = state.resolve;
        state.resolve = null;
        if (resolve) resolve(snapshot);
    }

    function scheduleCheck() {
        const state = observerState;
        if (!state || !state.active || state.resolved) return;
        if (state.checkTimer) return;

        const elapsed = state.startedAt ? performance.now() - state.startedAt : 0;
        const wait = Math.max(0, checkGap(elapsed) - (performance.now() - lastCheckAt));
        state.checkTimer = setTimeout(() => {
            const current = observerState;
            if (!current) return;
            current.checkTimer = null;
            checkObserverTarget();
        }, wait);
    }

    function checkObserverTarget() {
        const state = observerState;
        if (!state || !state.active || state.resolved) return;
        if (!isRunning || state.token !== runToken) return;

        lastCheckAt = performance.now();

        const snapshot = getSnapshot();
        if (!snapshot || !snapshot.id) return;
        if (snapshot.id === state.oldId) return;
        if (handledIds.has(snapshot.id)) return;

        resolveObserver(snapshot);
    }

    function armListObserver(row, conversationId, token) {
        cleanupObserver();

        if (!row || !conversationId || !isRunning || token !== runToken) return false;

        const inner = getListInner()
            || row.closest(SEL.listRoot)?.querySelector('.rc-virtual-list-holder-inner');

        if (!inner) {
            console.warn('[Pancake Auto] Không tìm thấy .rc-virtual-list-holder-inner');
            return false;
        }

        observerState = {
            token, oldId: conversationId,
            active: false, resolved: false, resolve: null,
            timeoutId: null, pollId: null, checkTimer: null, startedAt: 0
        };

        listObserver = new MutationObserver(() => {
            const state = observerState;
            /* V5.25 — danh sách đang xếp lại: giữ dấu đỏ bám đúng row sắp gửi */
            refreshMarker();
            if (!state || !state.active || state.resolved) return;
            if (!isRunning || state.token !== runToken) return;
            scheduleCheck();
        });

        try {
            listObserver.observe(inner, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['id', 'class', 'style']
            });

            txtObserver.textContent = '👁 Direct Observer: ARMED';
            txtObserver.style.color = '#52c41a';
            return true;
        } catch (err) {
            console.error('[Pancake Auto] Observer attach:', err);
            cleanupObserver();
            return false;
        }
    }

    function activateListObserver(token) {
        const state = observerState;
        if (!state || state.token !== token || token !== runToken) return;
        if (state.resolved || !isRunning) return;

        state.active = true;
        txtObserver.textContent = '👁 Direct Observer: WATCHING';
        txtObserver.style.color = '#52c41a';

        checkObserverTarget();
    }

    function waitForNextConversation(token, timeout = D.observer) {
        return new Promise(resolve => {
            const state = observerState;
            if (!state || state.token !== token || token !== runToken || !isRunning) {
                resolve(null);
                return;
            }

            state.resolve = resolve;
            state.active = true;

            txtObserver.textContent = '👁 Direct Observer: WATCHING';
            txtObserver.style.color = '#52c41a';

            checkObserverTarget();
            if (state.resolved) return;

            state.startedAt = performance.now();
            const tick = () => {
                const current = observerState;
                if (!current || current.resolved || current.token !== token) return;
                if (!isRunning) return;
                scheduleCheck();
                current.pollId = setTimeout(
                    tick, pollDelay(performance.now() - (current.startedAt || 0))
                );
            };
            if (T.pollFast > 0) state.pollId = setTimeout(tick, T.pollFast);

            if (timeout > 0) {
                state.timeoutId = setTimeout(() => {
                    const current = observerState;
                    if (!current || current.resolved || current.token !== token) return;
                    checkObserverTarget();
                    if (current.resolved) return;
                    resolveObserver(null);
                }, timeout);
            }
        });
    }

    async function waitForNextRow(token) {
        if (D.transition > 0) {
            await sleep(D.transition);
            if (!isRunning || token !== runToken) return null;
        }

        setStatus('👁 Chờ conversation kế tiếp...', '#faad14');

        let snapshot = await waitForNextConversation(token);
        if (!snapshot || !isRunning || token !== runToken) return null;

        lastWaitMs = performance.now() - sentAt;

        if (D.snippet > 0) {
            await sleep(D.snippet);
            if (!isRunning || token !== runToken) return null;

            const latest = getSnapshot();
            if (latest) snapshot = latest;
        }
        return snapshot;
    }

    /* =========================================================
     * CHỜ HỘI THOẠI ĐƯỢC MỞ ĐÚNG (.selected)
     * =======================================================*/

    async function waitForConversationOpen(snapshot, token, gate = T.selected) {
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
            console.warn(
                '[Pancake Auto] Tên không khớp:', { row: targetName, header: headerName }
            );
            setStatus(`⚠ Tên lệch: ${headerName}`, '#faad14');
        }

        return { ok: true };
    }

    async function getComposerAfterClick(token) {
        if (D.conversation > 0) await sleep(D.conversation);

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

    /* =========================================================
     * DÁN VÀ GIỮ NỘI DUNG
     * =======================================================*/

    const sameText = (a, b) =>
        a === b ||
        String(a).replace(/\r\n?/g, '\n') === String(b).replace(/\r\n?/g, '\n');

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
            if (fresh && fresh !== box) box = fresh;

            setComposerValue(box, text);
            held = box.isConnected && sameText(box.value, text);
        }
        return { ok: held, composer: box, tries };
    }

    /* =========================================================
     * EXECUTE STEP
     * =======================================================*/

    async function executeStep(afterEnter = false, token = runToken) {
        if (!isRunning || token !== runToken || !clickPos) return;

        tabHiddenDuringStep = false;
        stepStart = performance.now();

        let snapshot = null;
        let scanned  = false;

        if (!afterEnter) {
            snapshot = getSnapshot();
        } else {
            if (scanEnabled) {
                snapshot = scanNextRow();
                scanned  = !!snapshot;
            }
            if (!snapshot) snapshot = await waitForNextRow(token);
        }

        stepStart = performance.now();

        if (afterEnter) {
            if (scanned) lastWaitMs = sentAt ? performance.now() - sentAt : 0;
            if (lastWaitMs) {
                recordWait(lastWaitMs);
                lastWaitMs = 0;
            }
        }

        phaseReset();

        if (!isRunning || token !== runToken) return;

        if (!snapshot && afterEnter && scanEnabled) {
            /* Hết giờ chờ mà chưa có khách mới: quét lại ĐÚNG 1 LẦN (V5.17). */
            const retry = scanNextRow();
            if (retry && retry.id && retry.id !== lastConversationId
                && !handledIds.has(retry.id)) snapshot = retry;
        }

        if (!snapshot) {
            if (!hasMatchingInView()) {
                return stop('Dừng: snippet không trùng mẫu (đã hết khách cùng snippet trong khung nhìn)');
            }
            return stop('Không bắt được conversation mới');
        }
        if (!snapshot.id) return stop('Không xác định được REAL conversation ID');
        if (snapshot.snippet === null) return stop('Snippet chưa sẵn sàng');

        const currentSnippet = snapshot.snippet;

        /* ---- Câu dừng: ưu tiên cao nhất ---- */
        if (stopSnippet && currentSnippet === stopSnippet) {
            return stop(`🛑 Đã gặp câu dừng: ${stopSnippet}`);
        }

        /* ---- Lọc snippet theo mẫu ---- */
        if (initialSnippet === null) {
            initialSnippet = currentSnippet;
        } else if (!bypassSnippet && currentSnippet !== initialSnippet) {
            return stop('Dừng: snippet không trùng mẫu');
        }

        /* ---- Chặn xử lý lại 1 ID ---- */
        if (lastConversationId && snapshot.id === lastConversationId) {
            return stop('Chặn xử lý lại cùng conversation');
        }
        lastConversationId = snapshot.id;

        /* =====================================================
         * V5.25 — GHIM KHUNG TRƯỚC KHI CLICK
         *
         * Pancake vừa đưa hội thoại của khách TRƯỚC lên đầu nhóm ⇒ khung
         * danh sách bị đẩy xuống 1 dòng ⇒ khách kế tiếp lệch khỏi dấu đỏ.
         * Đo rồi cuộn bù để khách kế nằm lại đúng dấu đỏ.
         * ===================================================== */
        if (D.pinView && afterEnter) {
            await pinViewport(snapshot.id, token);
            if (!isRunning || token !== runToken) return;
        }

        /* Virtual list TÁI SỬ DỤNG node: sau khi cuộn/đổi danh sách, row cầm
           trong tay có thể đã bị gán cho hội thoại KHÁC. Phải tìm lại theo ID
           và kiểm tra lại snippet NGAY TRƯỚC khi click — đây là chốt chống
           "chạy bừa" quan trọng nhất của V5.25. */
        {
            const live = rowById(snapshot.id);
            if (!live) {
                clearMark();
                return stop('Không tìm thấy lại row của khách trong khung nhìn — dừng để không gửi nhầm');
            }
            if (getSnippet(live) !== snapshot.snippet) {
                clearMark();
                return stop('Danh sách đổi giữa lúc gửi — dừng để không gửi nhầm khách');
            }
            snapshot = snapshotFromRow(live);
        }

        /* V5.25 — chốt ID vào danh sách đã xử lý SAU khi đã xác minh lại row. */
        if (handledIds.size > 20000) handledIds.delete(handledIds.values().next().value);
        handledIds.add(snapshot.id);

        const row = snapshot.row;
        if (!row || !row.isConnected) return stop('Conversation row không còn tồn tại');

        const clickX = Number.isFinite(snapshot.x) ? snapshot.x : clickPos.x;
        const clickY = Number.isFinite(snapshot.y) ? snapshot.y : clickPos.y;

        /* Dấu đỏ + viền đỏ lên đúng khách sắp gửi */
        markTarget(row);

        /* Critical path: NEW ID → CLICK */
        if (!fullClick(row, clickX, clickY)) {
            clearMark();
            return stop('Không click được conversation');
        }

        phaseMark('click');

        updateIdStatus(snapshot);
        setStatus('Đã bắt ID → đang mở conversation...', '#52c41a');

        if (!scanEnabled) {
            const opened = await waitForConversationOpen(snapshot, token, T.selected);
            if (!isRunning || token !== runToken) return;
            if (!opened.ok) return stop(opened.reason);
        }

        if (!armListObserver(row, snapshot.id, token)) {
            return stop('Không gắn được Direct Observer');
        }

        /* ---- Composer ---- */
        let composer = await getComposerAfterClick(token);
        if (!isRunning || token !== runToken) return;
        if (!composer) return stop('Không tìm thấy #replyBoxComposer');
        phaseMark('composer');

        /* ---- Nội dung ---- */
        const text = await getSendText();
        if (!isRunning || token !== runToken) return;

        lastCtx = {
            id:        snapshot.id,
            ten:       snapshot.name,
            snippet:   snapshot.snippet,
            mauSnip:   initialSnippet,
            boLocSnip: bypassSnippet,
            quiChuong: scanEnabled,
            ghimKhung: D.pinView,
            chot:      D.gate,
            doDaiText: text ? text.length : 0,
            textDau:   text ? text.slice(0, 60) : ''
        };

        if (!text) return stop('Không có nội dung gửi');

        let pasted = await pasteAndHold(composer, text, token);
        if (!isRunning || token !== runToken) return;
        if (!pasted.ok) {
            logPasteFail('Composer không giữ nội dung (dán lần 1)', pasted.composer, text, pasted.tries);
            return stop('Composer không giữ nội dung (React đã reset)');
        }
        composer = pasted.composer;
        pasteTries = pasted.tries || 0;
        phaseMark('paste');

        /* ---- Chốt an toàn trước Enter (chỉ khi bật + D.gate > 0) ---- */
        if (scanEnabled && D.gate > 0) {
            const opened = await waitForConversationOpen(snapshot, token, D.gate);
            if (!isRunning || token !== runToken) return;
            if (!opened.ok) return stop(opened.reason);

            if (!composer.isConnected || composer.value !== text) {
                pasted = await pasteAndHold(composer, text, token);
                if (!isRunning || token !== runToken) return;
                if (!pasted.ok) {
                    logPasteFail('Mất nội dung sau chốt (dán lần 2, gate=' + D.gate + ')',
                        pasted.composer, text, pasted.tries);
                    return stop('Composer không giữ nội dung (React đã reset)');
                }
                composer = pasted.composer;
            }
        }

        isWaitingForEnter = true;

        /* ---- Chờ ENTER thủ công ---- */
        if (!autoEnter) {
            setStatus('Đã dán. Hãy ấn ENTER', '#1677ff');
            return;
        }

        /* ---- Tự gửi ---- */
        setStatus('⚡ Đang gửi...', '#52c41a');

        if (D.autoEnter > 0) await sleep(D.autoEnter);
        else await nextTick();

        if (!isRunning || token !== runToken || !isWaitingForEnter) return;

        phaseMark('nhịp');

        activateListObserver(token);

        /* ---- Chốt lại node composer NGAY TRƯỚC ENTER (V5.21) ---- */
        const liveComposer = getComposer();
        let target = (liveComposer && liveComposer.isConnected) ? liveComposer : composer;

        if (!target.isConnected) {
            return stop('Composer không còn trong DOM trước Enter (tab vừa hiện lại?)');
        }

        if (target !== composer || !sameText(target.value, text)) {
            const re = await pasteAndHold(target, text, token);
            if (!isRunning || token !== runToken) return;
            if (!re.ok) {
                logPasteFail('Mất nội dung trước Enter (composer bị thay)',
                    re.composer, text, re.tries);
                return stop('Composer không giữ nội dung (tab vừa hiện lại?)');
            }
            target = re.composer;
        }
        composer = target;

        composer.focus();
        isWaitingForEnter = false;

        composer.dispatchEvent(makeEnterEvent('keydown'));
        composer.dispatchEvent(makeEnterEvent('keyup'));

        sentAt = performance.now();
        phaseMark('enter');
        lastSendMs = sentAt - stepStart;
        recordSend(lastSendMs);
        phaseAccumulate();

        /* V5.25 — khách này xong: bỏ đánh dấu, dấu đỏ về lại toạ độ đã chấm.
           Khách kế tiếp sẽ được đánh dấu lại ngay đầu vòng sau. */
        clearMark();

        for (let i = 1; i < D.enter; i++) {
            await nextTick();
            if (!isRunning || token !== runToken) return;

            const fresh = getComposer();
            const node = fresh && fresh.isConnected ? fresh : composer;
            node.dispatchEvent(makeEnterEvent('keydown'));
            node.dispatchEvent(makeEnterEvent('keyup'));
        }

        {
            const t0 = performance.now();
            /* KHÔNG BAO GIỜ bấm lại Enter ở đây: composer dùng chung, không phân
               biệt được "chưa gửi" với "đang gửi" ⇒ gửi trùng còn tệ hơn mất tin. */
            const okFast = await waitForSent(token, T.sendConfirm);
            if (!isRunning || token !== runToken) return;

            let ok = okFast;
            if (!okFast) {
                setStatus('⏳ Pancake đang gửi (đường chậm)…', '#faad14');
                ok = await waitForSent(token, T.sendConfirmSlow);
                if (!isRunning || token !== runToken) return;
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
                    `[Pancake Auto] ⚠ CHƯA THẤY GỬI sau `
                    + `${(performance.now() - t0).toFixed(0)} ms`
                    + `${tabHiddenDuringStep ? ' (tab vừa bị ẩn)' : ''}`
                    + ` — khách ${snapshot.name || '?'} (${snapshot.id})`
                    + ` — Pancake chưa xóa composer ⇒ tin có thể CHƯA ĐI`
                );
            }
        }

        executeStep(true, token).catch(err => {
            console.error('[Pancake Auto] Execute error:', err);
            if (isRunning && token === runToken) stop('Script lỗi - xem Console');
        });
    }

    function handleEnterDetected(token = runToken) {
        if (!isRunning || !isWaitingForEnter || token !== runToken) return;

        isWaitingForEnter = false;
        clearMark();
        activateListObserver(token);

        executeStep(true, token).catch(err => {
            console.error('[Pancake Auto] Execute error:', err);
            if (isRunning && token === runToken) stop('Script lỗi - xem Console');
        });
    }

    /* =========================================================
     * ENTER THẬT TỪ BÀN PHÍM (isTrusted)
     * =======================================================*/

    window.addEventListener('keydown', event => {
        if (!event.isTrusted) return;
        if (!isRunning || !isWaitingForEnter) return;
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;

        const composer = getComposer();
        const target = event.target;
        if (!composer || !(target === composer || composer.contains?.(target))) return;

        activateListObserver(runToken);
        handleEnterDetected(runToken);
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

        removePicker();
        cleanupObserver();
        clearMark();

        cachedComposer = null;
        cachedList = null;
        initialSnippet = null;
        lastConversationId = '';
        handledIds.clear();
        unsentIds = [];
        slowSends = 0;

        btnRun.textContent = '▶ Bắt đầu';
        btnRun.style.background = '#1677ff';
        bubble.style.background = '#1677ff';

        setStatus(
            reason || 'Đã dừng',
            reason.startsWith('🛑') ? '#ff4d4f' : reason ? '#faad14' : '#aaa'
        );
    }

    async function start() {
        if (isRunning) return;

        if (!clickPos) {
            alert('Hãy chấm vị trí conversation trước.');
            return;
        }

        removePicker();
        cleanupObserver();
        clearMark();
        cachedComposer = null;

        isRunning = true;
        isWaitingForEnter = false;
        initialSnippet = null;
        lastConversationId = '';
        handledIds.clear();
        unsentIds = [];
        slowSends = 0;
        cachedText = '';
        resetStats();

        const token = ++runToken;

        btnRun.textContent = '⏹ Dừng lại';
        btnRun.style.background = '#ff4d4f';
        bubble.style.background = '#ff4d4f';

        setStatus('⚡ Direct Row Observer đang chạy...', '#52c41a');

        const initial = getSnapshot();
        if (!initial) return stop('Không tìm thấy conversation tại dấu đỏ');
        if (!initial.id) return stop('Không đọc được REAL conversation ID tại dấu đỏ');
        if (initial.snippet === null) return stop('Không đọc được .snippet-text');

        if (stopSnippet && initial.snippet === stopSnippet) {
            return stop(`🛑 Đã gặp câu dừng: ${stopSnippet}`);
        }

        updateIdStatus(initial);

        if (!inputText.value.trim()) await getSendText();
        if (!isRunning || token !== runToken) return;

        try {
            await executeStep(false, token);
        } catch (err) {
            console.error('[Pancake Auto] Start error:', err);
            if (isRunning && token === runToken) stop('Script lỗi - xem Console');
        }
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
        cleanupObserver();
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

    console.info(`[Pancake Auto] V${VERSION} sẵn sàng`);

    if (clickPos) setTimeout(() => updateIdStatus(getSnapshot()), 0);
})();
