// ==UserScript==
// @name         Pancake Auto kết hợp V7
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  Gộp Upsale cơ bản dán + Enter và Upsale photo Quick Reply/Send, có nút chuyển chế độ
// @match        *://*.pancake.vn/*
// @run-at       document-end
// @grant        GM_getClipboard
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    /*
     * V7 is based on the DOM captured in this repository:
     *
     * #conversationList.rc-virtual-list.infinite-conv-list
     *   .rc-virtual-list-holder-inner
     *     <div id="{pageId}_{conversationId}">
     *       <div id="{pageId}_{conversationId}__{rowIndex}"
     *            class="media conversation-list-item">
     *         .snippet-text
     *
     * The outer id is the stable REAL ID. The __rowIndex suffix belongs to
     * the virtual list and must not be used as an identity.
     */

    const VERSION = '7.0';
    const UI_ROOT_ID = 'pk-combined-root-v7';

    // Do not inject a second copy when Tampermonkey evaluates the script twice.
    if (document.getElementById(UI_ROOT_ID)) return;

    const SEL = {
        list: '#conversationList',
        listInner: '#conversationList .rc-virtual-list-holder-inner',
        row: '.conversation-list-item',
        snippet: '.snippet-text',
        name: '.name-text',
        headerName: '#pageCustomer .customer-name',
        composer: '#replyBoxComposer',
        replyContainer: '.reply-box-container',
        quickButton: 'span.new-reply-box-btn.pancake-antd-tooltip'
    };

    const RE_ROW_ID = /^(\d+_\d+)__\d+$/;
    const RE_REAL_ID = /^\d+_\d+$/;

    // Exact Quick Reply icon verified in html3.txt.
    const QUICK_REPLY_PATH =
        'M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm32,128H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Zm0-32H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Z';

    // Exact Send icon retained from the working 2-point script.
    const SEND_BUTTON_PATH =
        'M240,127.89a16,16,0,0,1-8.18,14L63.9,237.9A16.15,16.15,0,0,1,56,240a16,16,0,0,1-15-21.33l27-79.95A4,4,0,0,1,71.72,136H144a8,8,0,0,0,8-8.53,8.19,8.19,0,0,0-8.26-7.47h-72a4,4,0,0,1-3.79-2.72l-27-79.94A16,16,0,0,1,63.84,18.07l168,95.89A16,16,0,0,1,240,127.89Z';

    const NORMALIZED_QUICK_REPLY_PATH = normalizeSvgPath(QUICK_REPLY_PATH);
    const NORMALIZED_SEND_PATH = normalizeSvgPath(SEND_BUTTON_PATH);

    const POSITION_STORAGE_KEY = 'pancake_qr_positions_v53';
    const UI_STORAGE_KEY = 'pancake_qr_ui_v53';

    // Không còn ô chỉnh tốc độ: toàn bộ pha phụ chạy event-driven ở 0 ms.
    const TRANSITION_DELAY = 0;
    const CONVERSATION_DELAY = 0;
    const QUICK_BUTTON_DELAY = 0;
    const POPOVER_DELAY = 0;
    const POINT2_DELAY = 0;
    const COMPOSER_DELAY = 0;
    const SEND_DELAY = 0;

    const OBSERVER_TIMEOUT = 6000;
    const SELECTED_TIMEOUT = 2500;
    const HIDDEN_SEND_CONFIRM_TIMEOUT = 600;
    const POLL_FAST = 100;
    const POLL_MID = 200;
    const POLL_SLOW = 300;
    const CHECK_GAP_FAST = 16;
    const CHECK_GAP_MID = 60;
    const CHECK_GAP_SLOW = 120;

    let isRunning = false;
    let runToken = 0;
    let isPicking = false;
    let activePicker = null;

    let clickPos1 = null;
    let clickPos2 = null;
    let initialSnippet = null;
    let lastConversationId = '';
    let handledIds = new Set();

    let mode = 'twoPoint';
    let bypassSnippet = false;
    // Hai cơ chế bảo vệ luôn bật, không còn nút tắt trên giao diện.
    const scanEnabled = true;
    const selectedGuard = true;
    let hotkeyEnabled = false;
    let activationHotkey = 'Tab';

    // Upsale cơ bản luôn tự động gửi bằng Enter.
    let stopSnippet = '';
    let enterCount = 1;
    let sendText = '';
    let cachedClipboardText = '';

    let cachedList = null;
    let cachedListInner = null;
    let cachedComposer = null;
    let listObserver = null;
    let observerState = null;
    let lastObserverCheckAt = 0;
    const uiWaiters = new Set();

    let stats = {
        sent: 0,
        cycles: 0,
        sendMs: 0,
        waitMs: 0,
        pendingSendAt: 0
    };

    let tabHiddenDuringStep = false;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) tabHiddenDuringStep = true;
    }, true);

    function normalizeSvgPath(path) {
        return String(path || '').replace(/\s+/g, '').trim();
    }

    function normalizeText(text) {
        return String(text ?? '')
            .replace(/\u200B/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function readJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const value = JSON.parse(raw);
            return value === null || value === undefined ? fallback : value;
        } catch (err) {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {}
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
    }

    /* rAF is paused in a background tab; the timeout keeps the state machine moving. */
    function nextTick(max = 24) {
        return new Promise(resolve => {
            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                resolve();
            };
            try { requestAnimationFrame(finish); } catch (err) {}
            setTimeout(finish, max);
        });
    }

    function tokenValid(token) {
        return isRunning && token === runToken;
    }

    function loadSettings() {
        const savedUI = readJSON(UI_STORAGE_KEY, {}) || {};
        mode = savedUI.mode === 'upSale' ? 'upSale' : 'twoPoint';
        bypassSnippet = savedUI.bypassSnippet === true;
        activationHotkey = savedUI.hotkey === 'F4' ? 'F4' : 'Tab';
        stopSnippet = normalizeText(savedUI.stopSnippet || '');
        enterCount = Math.min(3, Math.max(1, parseInt(savedUI.enterCount, 10) || 1));
        sendText = typeof savedUI.sendText === 'string' ? savedUI.sendText : '';

        const positions = readJSON(POSITION_STORAGE_KEY, {}) || {};
        clickPos1 = positions.clickPos1 || null;
        clickPos2 = positions.clickPos2 || null;

        return savedUI;
    }

    const savedUI = loadSettings();

    function savePositions() {
        writeJSON(POSITION_STORAGE_KEY, { clickPos1, clickPos2 });
    }

    // =========================================================
    // UI
    // =========================================================

    const root = document.createElement('div');
    root.id = UI_ROOT_ID;
    Object.assign(root.style, {
        position: 'fixed',
        bottom: '25px',
        right: '25px',
        zIndex: '2147483647',
        fontFamily: 'Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        userSelect: 'none'
    });

    const CSS = `
        #${UI_ROOT_ID} .pk7-panel{width:280px;display:flex;flex-direction:column;gap:8px;padding:12px;background:rgba(26,26,30,.97);color:#fff;border:1px solid #444;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.5);font-size:12px;max-height:calc(100vh - 30px);overflow:auto;box-sizing:border-box}
        #${UI_ROOT_ID} .pk7-header{display:flex;justify-content:space-between;align-items:center;cursor:move;font-weight:700;border-bottom:1px solid #444;padding-bottom:6px}
        #${UI_ROOT_ID} .pk7-card{background:#151515;border:1px solid #444;border-radius:6px;padding:7px;display:flex;flex-direction:column;gap:6px}
        #${UI_ROOT_ID} .pk7-title{text-align:center;font-size:11px;font-weight:700}
        #${UI_ROOT_ID} .pk7-row{display:flex;justify-content:space-between;align-items:center;gap:6px}
        #${UI_ROOT_ID} .pk7-label{color:#aaa;font-size:10px}
        #${UI_ROOT_ID} .pk7-num{width:62px;box-sizing:border-box;background:#080808;color:#fff;border:1px solid #555;border-radius:4px;text-align:center;padding:3px}
        #${UI_ROOT_ID} .pk7-btn{padding:7px 4px;border-radius:4px;cursor:pointer;font-size:11px;background:#333;color:#bbb;border:1px solid #555}
        #${UI_ROOT_ID} .pk7-btn.flex{flex:1}
        #${UI_ROOT_ID} .pk7-btn.wide{width:100%}
        #${UI_ROOT_ID} .pk7-btn.red{background:#5c2223;color:#fff;border-color:#ff7875}
        #${UI_ROOT_ID} .pk7-btn.blue{background:#15395b;color:#fff;border-color:#69b1ff}
        #${UI_ROOT_ID} .pk7-btn.green{background:#389e0d;color:#fff;border-color:#52c41a}
        #${UI_ROOT_ID} .pk7-btn.amber{background:#389e0d;color:#fff;border-color:#52c41a}
        #${UI_ROOT_ID} .pk7-btn.danger{background:#222;color:#ff7875}
        #${UI_ROOT_ID} .pk7-btn:disabled{opacity:.5;cursor:not-allowed}
        #${UI_ROOT_ID} .pk7-select{width:78px;background:#080808;color:#fff;border:1px solid #555;border-radius:4px;padding:4px}
        #${UI_ROOT_ID} .pk7-pos{text-align:center;font-size:10px;color:#888}
        #${UI_ROOT_ID} .pk7-id{text-align:center;font-size:9px;color:#777;word-break:break-all}
        #${UI_ROOT_ID} .pk7-snippet{text-align:center;font-size:9px;color:#777;word-break:break-word;max-height:38px;overflow:hidden}
        #${UI_ROOT_ID} .pk7-status{min-height:18px;text-align:center;font-size:11px;color:#aaa;word-break:break-word}
        #${UI_ROOT_ID} .pk7-observer,#${UI_ROOT_ID} .pk7-stats{text-align:center;color:#777;font-size:9px}
        #${UI_ROOT_ID} .pk7-run{width:100%;background:#1677ff;color:#fff;font-weight:700;border:0;border-radius:5px;padding:8px;cursor:pointer}
        #${UI_ROOT_ID} .pk7-bubble{display:none;width:44px;height:44px;border-radius:50%;background:#1677ff;color:#fff;font-size:20px;align-items:center;justify-content:center;cursor:move;box-shadow:0 4px 15px rgba(0,0,0,.4)}
    `;

    root.innerHTML = `
        <style>${CSS}</style>
        <div data-pk7-id="panel" class="pk7-panel">
            <div data-pk7-id="header" class="pk7-header">
                <span>🤖 Auto kết hợp V${VERSION}</span>
                <span data-pk7-id="min" style="cursor:pointer;color:#aaa;padding:0 5px">─</span>
            </div>

            <button data-pk7-id="mode" class="pk7-btn wide"></button>

            <div data-pk7-id="twoPointCard" class="pk7-card">
                <div class="pk7-title">🎯 Upsale photo (2 điểm)</div>
                <div class="pk7-row" style="gap:5px">
                    <button data-pk7-id="pick1" class="pk7-btn flex red">🔴 Chấm 1</button>
                    <button data-pk7-id="pick2" class="pk7-btn flex blue">🔵 Chấm 2</button>
                </div>
                <div class="pk7-row" style="gap:5px">
                    <button data-pk7-id="clear1" class="pk7-btn flex danger">✕ Xóa 1</button>
                    <button data-pk7-id="clear2" class="pk7-btn flex danger">✕ Xóa 2</button>
                </div>
                <div data-pk7-id="pos1" class="pk7-pos"></div>
                <div data-pk7-id="pos2" class="pk7-pos"></div>
            </div>

            <div data-pk7-id="upSaleCard" class="pk7-card">
                <div class="pk7-title">⚡ Upsale cơ bản</div>
                <input data-pk7-id="sendText" type="text" placeholder="Nội dung gửi (trống = clipboard)" style="box-sizing:border-box;width:100%;background:#111;color:#fff;border:1px solid #555;border-radius:4px;padding:6px">
                <div class="pk7-row" style="gap:5px">
                    <span class="pk7-label">⚡ Auto Enter: luôn bật</span>
                    <label class="pk7-label" style="display:flex;align-items:center;gap:4px">
                        <span>Số Enter</span>
                        <input data-pk7-id="enterCount" type="number" min="1" max="3" step="1" class="pk7-num" style="width:48px">
                    </label>
                </div>
                <div class="pk7-row" style="gap:4px">
                    <button data-pk7-id="stopPick" class="pk7-btn flex amber">🎯 Câu dừng</button>
                    <button data-pk7-id="stopClear" class="pk7-btn danger">✕</button>
                </div>
                <div data-pk7-id="stopText" class="pk7-snippet">Chưa có câu dừng</div>
            </div>

            <div class="pk7-row" style="padding:7px;background:#151515;border:1px solid #444;border-radius:6px">
                <span>⌨ Start / Stop</span>
                <select data-pk7-id="hotkey" class="pk7-select">
                    <option value="Tab">Tab</option>
                    <option value="F4">F4</option>
                </select>
            </div>

            <button data-pk7-id="hotkeyEnable" class="pk7-btn wide"></button>
            <button data-pk7-id="bypass" class="pk7-btn wide"></button>
            <div data-pk7-id="id" class="pk7-id">ID: chưa kiểm tra</div>
            <div data-pk7-id="snippet" class="pk7-snippet">Snippet: -</div>
            <div data-pk7-id="observer" class="pk7-observer">👁 Direct Observer: OFF</div>
            <button data-pk7-id="run" class="pk7-run">▶ Bắt đầu</button>
            <div data-pk7-id="hotkeyHint" class="pk7-observer"></div>
            <div data-pk7-id="status" class="pk7-status">Sẵn sàng</div>
            <div data-pk7-id="stats" class="pk7-stats">📊 Chưa có dữ liệu</div>
        </div>
        <div data-pk7-id="bubble" class="pk7-bubble">🤖</div>
    `;

    document.body.appendChild(root);

    const $ = name => root.querySelector(`[data-pk7-id="${name}"]`);
    const panel = $('panel');
    const bubble = $('bubble');
    const btnRun = $('run');
    const btnPick1 = $('pick1');
    const btnPick2 = $('pick2');
    const btnClear1 = $('clear1');
    const btnClear2 = $('clear2');
    const btnMode = $('mode');
    const twoPointCard = $('twoPointCard');
    const upSaleCard = $('upSaleCard');
    const inputSendText = $('sendText');
    const inputEnterCount = $('enterCount');
    const btnStopPick = $('stopPick');
    const btnStopClear = $('stopClear');
    const txtStop = $('stopText');
    const btnHotkeyEnable = $('hotkeyEnable');
    const btnBypass = $('bypass');
    const selectHotkey = $('hotkey');
    const txtPos1 = $('pos1');
    const txtPos2 = $('pos2');
    const txtId = $('id');
    const txtSnippet = $('snippet');
    const txtObserver = $('observer');
    const txtStatus = $('status');
    const txtStats = $('stats');
    const txtHotkeyHint = $('hotkeyHint');

    const marker1 = document.createElement('div');
    const marker2 = document.createElement('div');

    function styleMarker(marker, color) {
        Object.assign(marker.style, {
            position: 'fixed', width: '14px', height: '14px', borderRadius: '50%',
            background: color, border: '2px solid #fff',
            boxShadow: `0 0 10px ${color}`, pointerEvents: 'none',
            zIndex: '2147483646', transform: 'translate(-50%,-50%)',
            display: 'none'
        });
        document.body.appendChild(marker);
    }

    // Dấu chấm đơn giản giống bản V5 gốc: đỏ = Chấm 1, xanh = Chấm 2.
    styleMarker(marker1, '#ff4d4f');
    styleMarker(marker2, '#1677ff');

    function setStatus(text, color = '#aaa') {
        txtStatus.textContent = text;
        txtStatus.style.color = color;
    }

    function updateMarkers() {
        const update = (marker, pos) => {
            if (!pos) {
                marker.style.display = 'none';
                return;
            }
            marker.style.display = 'flex';
            marker.style.left = `${pos.x}px`;
            marker.style.top = `${pos.y}px`;
        };
        update(marker1, clickPos1);
        update(marker2, mode === 'twoPoint' ? clickPos2 : null);
    }

    function saveUI() {
        const rect = root.getBoundingClientRect();
        writeJSON(UI_STORAGE_KEY, {
            mode,
            bypassSnippet,
            hotkey: activationHotkey,
            stopSnippet,
            enterCount,
            sendText,
            minimized: panel.style.display === 'none',
            position: {
                left: Math.round(rect.left),
                top: Math.round(rect.top)
            }
        });
    }

    function keepInViewport() {
        const rect = root.getBoundingClientRect();
        const left = Math.max(0, Math.min(rect.left, Math.max(0, window.innerWidth - 50)));
        const top = Math.max(0, Math.min(rect.top, Math.max(0, window.innerHeight - 50)));
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.style.left = `${Math.round(left)}px`;
        root.style.top = `${Math.round(top)}px`;
    }

    function restoreUI(savedUI) {
        const minimized = savedUI?.minimized === true;
        panel.style.display = minimized ? 'none' : 'flex';
        bubble.style.display = minimized ? 'flex' : 'none';

        const pos = savedUI?.position;
        if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
            root.style.right = 'auto';
            root.style.bottom = 'auto';
            root.style.left = `${pos.left}px`;
            root.style.top = `${pos.top}px`;
        }
        setTimeout(keepInViewport, 0);
    }

    function updateIdStatus(snapshot) {
        if (!snapshot || !snapshot.id) {
            txtId.textContent = 'ID: không xác định';
            txtId.style.color = '#ff7875';
            txtSnippet.textContent = 'Snippet: -';
            txtSnippet.style.color = '#ff7875';
            return;
        }
        txtId.textContent = `REAL ID: ${snapshot.id}`;
        txtId.style.color = '#52c41a';
        txtSnippet.textContent = `Snippet: ${snapshot.snippet ?? '[chưa có]'}`;
        txtSnippet.style.color = snapshot.snippet === null ? '#ff7875' : '#888';
    }

    function syncUI() {
        const isTwoPoint = mode === 'twoPoint';
        btnMode.textContent = isTwoPoint
            ? '🔁 Đang dùng: Upsale photo → chuyển sang Upsale cơ bản'
            : '🔁 Đang dùng: Upsale cơ bản → chuyển sang Upsale photo';
        btnMode.className = `pk7-btn wide${isTwoPoint ? ' blue' : ' amber'}`;
        // Chấm 1 dùng chung cho cả hai cơ chế; chỉ ẩn phần Chấm 2 ở Upsale.
        twoPointCard.style.display = 'flex';
        btnPick2.style.display = isTwoPoint ? '' : 'none';
        btnClear2.style.display = isTwoPoint ? '' : 'none';
        txtPos2.style.display = isTwoPoint ? '' : 'none';
        upSaleCard.style.display = isTwoPoint ? 'none' : 'flex';
        inputSendText.value = sendText;
        inputEnterCount.value = String(enterCount);
        if (stopSnippet) {
            txtStop.textContent = `🛑 ${stopSnippet}`;
            txtStop.style.color = '#ff7875';
        } else {
            txtStop.textContent = 'Chưa có câu dừng';
            txtStop.style.color = '#777';
        }

        btnHotkeyEnable.textContent = hotkeyEnabled
            ? '🔓 Kích hoạt Hotkey: ON'
            : '🔒 Kích hoạt Hotkey: OFF';
        btnHotkeyEnable.className = `pk7-btn wide${hotkeyEnabled ? ' green' : ''}`;

        btnBypass.textContent = bypassSnippet ? '⏭ Bỏ lọc snippet: ON' : '🔒 Lọc snippet: ON';
        btnBypass.className = `pk7-btn wide${bypassSnippet ? ' amber' : ''}`;

        selectHotkey.value = activationHotkey;
        txtHotkeyHint.textContent = `${activationHotkey.toUpperCase()} = Bắt đầu / Dừng • ${hotkeyEnabled ? 'ON' : 'OFF'}`;

        if (clickPos1) {
            txtPos1.textContent = `🔴 Chấm 1: (${clickPos1.x}, ${clickPos1.y})`;
            txtPos1.style.color = '#ff7875';
        } else {
            txtPos1.textContent = '🔴 Chấm 1: chưa chọn';
            txtPos1.style.color = '#888';
        }
        if (clickPos2) {
            txtPos2.textContent = `🔵 Chấm 2: (${clickPos2.x}, ${clickPos2.y})`;
            txtPos2.style.color = '#69b1ff';
        } else {
            txtPos2.textContent = '🔵 Chấm 2: chưa chọn';
            txtPos2.style.color = '#888';
        }
        updateMarkers();
    }

    let suppressBubbleClick = false;

    function makeDraggable(handle) {
        let moved = false;
        handle.addEventListener('mousedown', event => {
            if (event.button !== 0 || event.target === $('min')) return;

            const rect = root.getBoundingClientRect();
            const sx = event.clientX;
            const sy = event.clientY;
            const sl = rect.left;
            const st = rect.top;
            moved = false;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
            event.preventDefault();

            const move = e => {
                const dx = e.clientX - sx;
                const dy = e.clientY - sy;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
                root.style.left = `${sl + dx}px`;
                root.style.top = `${st + dy}px`;
                keepInViewport();
            };
            const up = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', up);
                keepInViewport();
                if (handle === bubble && moved) suppressBubbleClick = true;
                saveUI();
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
        });
    }

    $('min').onclick = () => {
        panel.style.display = 'none';
        bubble.style.display = 'flex';
        saveUI();
    };

    bubble.onclick = event => {
        if (suppressBubbleClick) {
            suppressBubbleClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        panel.style.display = 'flex';
        bubble.style.display = 'none';
        keepInViewport();
        saveUI();
    };

    makeDraggable($('header'));
    makeDraggable(bubble);
    window.addEventListener('resize', keepInViewport);

    // =========================================================
    // SOURCE-BASED DOM LOOKUP
    // =========================================================

    function getList() {
        if (cachedList && cachedList.isConnected) return cachedList;
        cachedList = document.querySelector(SEL.list);
        cachedListInner = null;
        return cachedList && cachedList.isConnected ? cachedList : null;
    }

    function getListInner() {
        const list = getList();
        if (!list) return null;
        if (cachedListInner && cachedListInner.isConnected && list.contains(cachedListInner)) {
            return cachedListInner;
        }
        cachedListInner = list.querySelector('.rc-virtual-list-holder-inner');
        return cachedListInner;
    }

    function getRowFrom(element) {
        if (!element?.closest) return null;
        const row = element.closest(SEL.row);
        const list = getList();
        return row && list?.contains(row) ? row : null;
    }

    function getRealId(row) {
        if (!row) return '';

        const rowMatch = RE_ROW_ID.exec(row.id || '');
        if (rowMatch) return rowMatch[1];

        let node = row.parentElement;
        for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
            const id = node.id || '';
            if (RE_REAL_ID.test(id)) return id;
        }
        return '';
    }

    function getSnippet(row) {
        if (!row) return null;
        const element = row.querySelector(SEL.snippet);
        return element ? normalizeText(element.textContent || '') : null;
    }

    function getName(row) {
        if (!row) return '';
        const element = row.querySelector(SEL.name);
        return element ? normalizeText(element.textContent || '') : '';
    }

    function findRenderedRowById(id) {
        if (!id) return null;
        const inner = getListInner();
        if (!inner) return null;
        const rows = inner.querySelectorAll(SEL.row);
        for (const row of rows) {
            if (getRealId(row) === id) return row;
        }
        return null;
    }

    function listRows() {
        const inner = getListInner();
        return inner ? inner.querySelectorAll(SEL.row) : null;
    }

    function isRenderableRow(row) {
        if (!row?.isConnected) return false;
        const rect = row.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function elementFromSavedPoint(pos) {
        if (!pos) return null;

        const oldPointerEvents = root.style.pointerEvents;
        const oldMarker1 = marker1.style.display;
        const oldMarker2 = marker2.style.display;
        root.style.pointerEvents = 'none';
        marker1.style.display = 'none';
        marker2.style.display = 'none';

        let element = null;
        try { element = document.elementFromPoint(pos.x, pos.y); } catch (err) {}

        root.style.pointerEvents = oldPointerEvents;
        marker1.style.display = oldMarker1;
        marker2.style.display = oldMarker2;
        updateMarkers();
        return element;
    }

    function snapshotAt(x, y) {
        const element = elementFromSavedPoint({ x, y });
        const row = getRowFrom(element);
        if (!row) return null;
        return {
            row,
            found: element,
            id: getRealId(row),
            snippet: getSnippet(row),
            name: getName(row),
            x,
            y
        };
    }

    function getSnapshot() {
        return clickPos1 ? snapshotAt(clickPos1.x, clickPos1.y) : null;
    }

    function snapshotFromRow(row) {
        if (!isRenderableRow(row)) return null;
        const rect = row.getBoundingClientRect();
        return {
            row,
            found: row,
            id: getRealId(row),
            snippet: getSnippet(row),
            name: getName(row),
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2)
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

    function firstUnhandledRowFrom(startIndex) {
        const rows = listRows();
        if (!rows) return null;
        for (let i = Math.max(0, startIndex); i < rows.length; i++) {
            const row = rows[i];
            const id = getRealId(row);
            if (!id || id === lastConversationId || handledIds.has(id)) continue;
            if (!isRenderableRow(row)) continue;
            // Do not skip a visible mismatching snippet: processConversation will stop safely.
            if (getSnippet(row) === null) continue;
            return row;
        }
        return null;
    }

    /**
     * Fast path after Send. The virtual list already has the next visible rows;
     * there is no reason to wait for the red coordinate to change first.
     */
    function scanNextSnapshot() {
        const atPoint = getSnapshot();
        if (atPoint && atPoint.id && atPoint.id !== lastConversationId
            && !handledIds.has(atPoint.id) && atPoint.snippet !== null) {
            return atPoint;
        }

        const rows = listRows();
        if (!rows || !lastConversationId) return null;

        const currentIndex = indexOfRow(lastConversationId);
        if (currentIndex >= 0 && currentIndex + 1 < rows.length) {
            const after = snapshotFromRow(rows[currentIndex + 1]);
            if (after && after.id && after.id !== lastConversationId
                && !handledIds.has(after.id) && after.snippet !== null) {
                return after;
            }
        }

        // The row may have been moved out of the virtual window. Never scan from 0;
        // only continue downwards from the known row position.
        if (currentIndex >= 0) {
            const next = snapshotFromRow(firstUnhandledRowFrom(currentIndex + 1));
            if (next) return next;
        }
        return null;
    }

    // =========================================================
    // VISIBILITY + CLICK HELPERS
    // =========================================================

    function isVisible(element) {
        if (!element?.isConnected) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || 1) !== 0
            && style.pointerEvents !== 'none';
    }

    function fullClick(element, x, y) {
        if (!element?.isConnected) return false;
        const common = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            button: 0,
            view: window
        };
        try {
            if (typeof PointerEvent === 'function') {
                element.dispatchEvent(new PointerEvent('pointerdown', {
                    ...common, buttons: 1, pointerId: 1,
                    pointerType: 'mouse', isPrimary: true
                }));
            }
            element.dispatchEvent(new MouseEvent('mousedown', { ...common, buttons: 1 }));
            if (typeof PointerEvent === 'function') {
                element.dispatchEvent(new PointerEvent('pointerup', {
                    ...common, buttons: 0, pointerId: 1,
                    pointerType: 'mouse', isPrimary: true
                }));
            }
            element.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }));
            element.dispatchEvent(new MouseEvent('click', common));
            return true;
        } catch (err) {
            try {
                element.click();
                return true;
            } catch (err2) {
                return false;
            }
        }
    }

    function clickCenter(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return fullClick(element, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    // =========================================================
    // QUICK REPLY + POPOVER
    // =========================================================

    function getComposer() {
        if (cachedComposer && cachedComposer.isConnected && cachedComposer.id === 'replyBoxComposer') {
            return cachedComposer;
        }
        cachedComposer = document.querySelector(SEL.composer);
        return cachedComposer && cachedComposer.isConnected ? cachedComposer : null;
    }

    function getReplyContainer() {
        const composer = getComposer();
        return composer?.closest(SEL.replyContainer) || null;
    }

    function isExactQuickReplyButton(element) {
        if (!element?.matches?.(SEL.quickButton)) return false;
        const path = element.querySelector('svg[viewBox="0 0 256 256"] path');
        return !!path && normalizeSvgPath(path.getAttribute('d')) === NORMALIZED_QUICK_REPLY_PATH;
    }

    function findQuickReplyButton() {
        const container = getReplyContainer();
        const scopes = container ? [container, document] : [document];

        for (const scope of scopes) {
            const list = scope.querySelectorAll(SEL.quickButton);
            for (const element of list) {
                if (isVisible(element) && isExactQuickReplyButton(element)) return element;
            }
        }
        return null;
    }

    function findQuickReplyPopover() {
        const list = document.querySelectorAll(
            '.ant-popover.popover_quick_reply, .ant-popover.popover_qr_filtered'
        );
        for (const element of list) {
            if (isVisible(element)) return element;
        }
        return null;
    }

    function pointInsideRect(pos, rect) {
        return !!pos && !!rect
            && pos.x >= rect.left && pos.x <= rect.right
            && pos.y >= rect.top && pos.y <= rect.bottom;
    }

    function getSendClickableElement(path) {
        if (!path) return null;

        const semantic = path.closest?.('button,[role="button"],.ant-btn');
        if (semantic && isVisible(semantic)) return semantic;

        let current = path.closest?.('svg') || path;
        for (let depth = 0; current && current !== document.body && depth < 6; depth++, current = current.parentElement) {
            if (!isVisible(current)) continue;
            const style = getComputedStyle(current);
            if (style.cursor === 'pointer' || current.onclick
                || current.getAttribute('role') === 'button') {
                return current;
            }
        }
        return path.closest?.('svg') || path;
    }

    function findExactSendButton() {
        const container = getReplyContainer();
        const scopes = container ? [container, document] : [document];

        for (const scope of scopes) {
            const paths = scope.querySelectorAll('svg path');
            for (const path of paths) {
                if (normalizeSvgPath(path.getAttribute('d')) !== NORMALIZED_SEND_PATH) continue;
                const clickable = getSendClickableElement(path);
                if (!clickable || !isVisible(clickable)) continue;
                if (clickable.disabled === true
                    || clickable.getAttribute?.('disabled') !== null
                    || clickable.getAttribute?.('aria-disabled') === 'true') continue;
                return clickable;
            }
        }
        return null;
    }

    function getComposerText(element) {
        if (!element) return '';
        if ('value' in element) return normalizeText(element.value);
        return normalizeText(element.innerText || element.textContent || '');
    }

    // =========================================================
    // EVENT-DRIVEN DOM WAITERS
    // =========================================================

    function disconnectUIObservers() {
        for (const waiter of Array.from(uiWaiters)) {
            try { waiter.observer?.disconnect(); } catch (err) {}
            if (waiter.timeoutId) clearTimeout(waiter.timeoutId);
            uiWaiters.delete(waiter);
            try { waiter.resolve?.(null); } catch (err) {}
        }
    }

    function waitDOMCondition(callback, options = {}) {
        const token = options.token ?? runToken;
        const timeout = options.timeout ?? 7000;
        const rootNode = options.root || document.body;

        return new Promise(resolve => {
            if (!tokenValid(token)) {
                resolve(null);
                return;
            }

            const waiter = { observer: null, timeoutId: null, resolve, done: false };
            const finish = value => {
                if (waiter.done) return;
                waiter.done = true;
                try { waiter.observer?.disconnect(); } catch (err) {}
                if (waiter.timeoutId) clearTimeout(waiter.timeoutId);
                uiWaiters.delete(waiter);
                resolve(value);
            };

            const check = () => {
                if (!tokenValid(token)) {
                    finish(null);
                    return;
                }
                try {
                    const result = callback();
                    if (result) finish(result);
                } catch (err) {}
            };

            try {
                waiter.observer = new MutationObserver(check);
                waiter.observer.observe(rootNode, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                    attributes: true,
                    attributeFilter: [
                        'class', 'style', 'id', 'aria-hidden',
                        'aria-disabled', 'disabled', 'value'
                    ]
                });
            } catch (err) {
                finish(null);
                return;
            }

            uiWaiters.add(waiter);
            check();
            if (!waiter.done && timeout > 0) {
                waiter.timeoutId = setTimeout(() => finish(null), timeout);
            }
        });
    }

    function waitPopoverGone(popover, token) {
        if (!popover || !popover.isConnected || !isVisible(popover)) return Promise.resolve(true);
        return waitDOMCondition(() => {
            return !popover.isConnected || !isVisible(popover) ? true : null;
        }, { token, timeout: 7000 });
    }

    // =========================================================
    // DIRECT ROW OBSERVER + ACTIVE SCAN
    // =========================================================

    function checkGap(elapsed) {
        if (elapsed < 200) return CHECK_GAP_FAST;
        if (elapsed < 1200) return CHECK_GAP_MID;
        return CHECK_GAP_SLOW;
    }

    function pollDelay(elapsed) {
        if (elapsed < 400) return POLL_FAST;
        if (elapsed < 1200) return POLL_MID;
        return POLL_SLOW;
    }

    function cleanupListObserver(resolveValue = null) {
        const state = observerState;
        if (listObserver) {
            listObserver.disconnect();
            try { listObserver.takeRecords(); } catch (err) {}
            listObserver = null;
        }
        if (state) {
            if (state.timeoutId) clearTimeout(state.timeoutId);
            if (state.pollId) clearTimeout(state.pollId);
            if (state.checkTimer) clearTimeout(state.checkTimer);
            const resolve = state.resolve;
            state.resolve = null;
            observerState = null;
            if (resolve && resolveValue !== undefined) resolve(resolveValue);
        } else {
            observerState = null;
        }
        txtObserver.textContent = '👁 Direct Observer: OFF';
        txtObserver.style.color = '#777';
    }

    function resolveListObserver(snapshot, reason = '') {
        const state = observerState;
        if (!state || state.resolved) return;
        state.resolved = true;
        const resolve = state.resolve;
        state.resolve = null;

        if (listObserver) {
            listObserver.disconnect();
            try { listObserver.takeRecords(); } catch (err) {}
            listObserver = null;
        }
        if (state.timeoutId) clearTimeout(state.timeoutId);
        if (state.pollId) clearTimeout(state.pollId);
        if (state.checkTimer) clearTimeout(state.checkTimer);
        observerState = null;

        txtObserver.textContent = snapshot
            ? '👁 Direct Observer: HIT'
            : '👁 Direct Observer: TIMEOUT';
        txtObserver.style.color = snapshot ? '#52c41a' : '#faad14';
        if (reason) console.debug('[Pancake QR] Observer:', reason, snapshot?.id || 'none');
        if (resolve) resolve(snapshot || null);
    }

    function checkObserverTarget() {
        const state = observerState;
        if (!state || !state.active || state.resolved || !state.allowResolve) return;
        if (!tokenValid(state.token)) return;

        let snapshot = null;
        if (scanEnabled) snapshot = scanNextSnapshot();
        if (!snapshot) snapshot = getSnapshot();
        if (!snapshot || !snapshot.id || snapshot.id === state.oldId) return;
        if (handledIds.has(snapshot.id) || snapshot.snippet === null) return;

        resolveListObserver(snapshot, scanEnabled ? 'direct-row-scan' : 'coordinate-change');
    }

    function scheduleObserverCheck() {
        const state = observerState;
        if (!state || !state.active || state.resolved || !state.allowResolve) return;
        if (state.checkTimer) return;

        const now = performance.now();
        const elapsed = state.startedAt ? now - state.startedAt : 0;
        const wait = Math.max(0, checkGap(elapsed) - (now - lastObserverCheckAt));
        state.checkTimer = setTimeout(() => {
            const current = observerState;
            if (!current) return;
            current.checkTimer = null;
            lastObserverCheckAt = performance.now();
            checkObserverTarget();
        }, wait);
    }

    function armListObserver(conversationId, token) {
        cleanupListObserver();
        const inner = getListInner();
        if (!inner || !conversationId || !tokenValid(token)) return false;

        observerState = {
            token,
            oldId: conversationId,
            active: false,
            allowResolve: false,
            resolved: false,
            resolve: null,
            timeoutId: null,
            pollId: null,
            checkTimer: null,
            startedAt: 0
        };

        listObserver = new MutationObserver(() => {
            const state = observerState;
            if (!state || !state.active || !state.allowResolve || state.resolved) return;
            if (!tokenValid(state.token)) return;
            scheduleObserverCheck();
        });

        try {
            listObserver.observe(inner, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['id', 'class']
            });
            txtObserver.textContent = '👁 Direct Observer: ARMED';
            txtObserver.style.color = '#52c41a';
            return true;
        } catch (err) {
            cleanupListObserver();
            return false;
        }
    }

    function activateListObserver(token) {
        const state = observerState;
        if (!state || state.token !== token || !tokenValid(token)) return;
        state.active = true;
        state.allowResolve = true;
        state.startedAt = performance.now();
        txtObserver.textContent = '👁 Direct Observer: WATCHING';
        txtObserver.style.color = '#52c41a';
        checkObserverTarget();
    }

    function waitForNextConversation(token, timeout = OBSERVER_TIMEOUT) {
        return new Promise(resolve => {
            const state = observerState;
            if (!state || state.token !== token || !tokenValid(token)) {
                resolve(null);
                return;
            }

            state.active = true;
            state.allowResolve = false;
            state.resolve = resolve;
            state.startedAt = performance.now();
            txtObserver.textContent = '👁 Direct Observer: WATCHING';
            txtObserver.style.color = '#52c41a';

            // The check is deliberately blocked until Send has been clicked.
            const tick = () => {
                const current = observerState;
                if (!current || current.resolved || current.token !== token || !tokenValid(token)) return;
                scheduleObserverCheck();
                current.pollId = setTimeout(tick, pollDelay(performance.now() - current.startedAt));
            };
            state.pollId = setTimeout(tick, POLL_FAST);

            if (timeout > 0) {
                state.timeoutId = setTimeout(() => {
                    const current = observerState;
                    if (!current || current.resolved || current.token !== token) return;
                    checkObserverTarget();
                    if (!current.resolved) resolveListObserver(null, 'timeout');
                }, timeout);
            }
        });
    }

    function releaseNextConversationWait(token) {
        const state = observerState;
        if (!state || state.token !== token || !tokenValid(token)) return;
        state.allowResolve = true;
        state.active = true;
        checkObserverTarget();
    }

    // =========================================================
    // SELECTED GUARD + COMPOSER/SEND WAIT
    // =========================================================

    function waitForSelected(snapshot, token) {
        if (!selectedGuard) return Promise.resolve(true);
        const targetId = snapshot?.id;
        if (!targetId) return Promise.resolve(false);

        const matches = () => {
            const list = getList();
            const selected = list?.querySelector(`${SEL.row}.selected`);
            return !!selected && getRealId(selected) === targetId;
        };

        return waitDOMCondition(matches, {
            token,
            timeout: SELECTED_TIMEOUT,
            root: getList() || document.body
        }).then(value => !!value);
    }

    function waitComposerAndSend(token) {
        return waitDOMCondition(() => {
            const composer = getComposer();
            if (!composer || !isVisible(composer)) return null;
            const text = getComposerText(composer);
            if (!text) return null;
            const sendButton = findExactSendButton();
            if (!sendButton) return null;
            return { composer, text, sendButton };
        }, { token, timeout: 8000 });
    }

    /*
     * Sending is asynchronous in Pancake (socket/API/extension). Normally we
     * keep the zero-delay path. If the tab was backgrounded during this step,
     * Chrome can delay the socket work; do not switch conversation while the
     * old composer still contains the message.
     */
    async function waitForHiddenSendConfirmation(token) {
        const until = performance.now() + HIDDEN_SEND_CONFIRM_TIMEOUT;
        while (tokenValid(token) && performance.now() < until) {
            const composer = getComposer();
            if (!composer || !getComposerText(composer)) return true;
            await nextTick();
        }
        return false;
    }

    // =========================================================
    // PICKERS
    // =========================================================

    function removePicker() {
        if (activePicker) {
            window.removeEventListener('click', activePicker, true);
            activePicker = null;
        }
        isPicking = false;
    }

    function startPicking(number) {
        removePicker();
        isPicking = number;
        setStatus(
            number === 1
                ? '🔴 Click conversation cho Chấm 1...'
                : '🔵 Mở bảng Quick Reply rồi click mẫu cho Chấm 2...',
            number === 1 ? '#ff7875' : '#69b1ff'
        );

        activePicker = event => {
            if (root.contains(event.target)) return;

            if (number === 1 && !getRowFrom(event.target)) {
                setStatus('Hãy click đúng conversation trong danh sách.', '#ff7875');
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            const pos = {
                x: Math.round(event.clientX),
                y: Math.round(event.clientY)
            };
            if (number === 1) clickPos1 = pos;
            else clickPos2 = pos;

            savePositions();
            updateMarkers();
            syncUI();
            removePicker();
            setStatus(`Đã lưu Chấm ${number}`, '#52c41a');

            if (number === 1) updateIdStatus(getSnapshot());
        };
        window.addEventListener('click', activePicker, true);
    }

    function startStopPicker() {
        removePicker();
        setStatus('🛑 Click conversation có snippet muốn dừng...', '#faad14');
        activePicker = event => {
            if (root.contains(event.target)) return;
            const row = getRowFrom(event.target);
            if (!row) {
                setStatus('Hãy click đúng conversation để lấy câu dừng.', '#ff7875');
                return;
            }
            const snippet = getSnippet(row);
            if (snippet === null) {
                setStatus('Conversation chưa có .snippet-text.', '#ff7875');
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            stopSnippet = snippet;
            saveUI();
            syncUI();
            removePicker();
            setStatus('🛑 Đã lưu câu dừng', '#52c41a');
        };
        window.addEventListener('click', activePicker, true);
    }

    btnPick1.onclick = () => startPicking(1);
    btnPick2.onclick = () => startPicking(2);
    btnStopPick.onclick = startStopPicker;
    btnStopClear.onclick = () => {
        stopSnippet = '';
        saveUI();
        syncUI();
        setStatus('Đã xóa câu dừng');
    };

    btnClear1.onclick = () => {
        clickPos1 = null;
        savePositions();
        updateIdStatus(null);
        syncUI();
    };

    btnClear2.onclick = () => {
        clickPos2 = null;
        savePositions();
        syncUI();
    };

    // =========================================================
    // UPSALE V5: COMPOSER + ENTER
    // =========================================================

    function sameText(a, b) {
        return String(a ?? '').replace(/\r\n?/g, '\n')
            === String(b ?? '').replace(/\r\n?/g, '\n');
    }

    function setComposerValue(element, text) {
        if (!element || !text) return false;
        try {
            element.focus();
            if ('value' in element) {
                const prototype = element instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
                if (element.value === text) {
                    if (setter) setter.call(element, '');
                    else element.value = '';
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                }
                if (setter) setter.call(element, text);
                else element.value = text;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            return false;
        } catch (err) {
            console.error('[Pancake Combined] setComposerValue:', err);
            return false;
        }
    }

    async function getUpsaleText() {
        if (sendText.trim()) return sendText.trim();
        if (cachedClipboardText) return cachedClipboardText;
        try {
            cachedClipboardText = (await navigator.clipboard.readText()) || '';
        } catch (err) {
            try {
                cachedClipboardText = (typeof GM_getClipboard === 'function'
                    ? await GM_getClipboard()
                    : '') || '';
            } catch (err2) {
                cachedClipboardText = '';
            }
        }
        return cachedClipboardText.trim();
    }

    async function pasteAndHold(startComposer, text, token) {
        if (!startComposer || !setComposerValue(startComposer, text)) {
            return { ok: false, composer: startComposer, tries: 0 };
        }
        let composer = startComposer;
        let tries = 0;
        let held = composer.isConnected && sameText(composer.value, text);
        const until = performance.now() + 2000;

        while (!held && tokenValid(token) && performance.now() < until) {
            tries++;
            await nextTick();
            if (!tokenValid(token)) return { ok: false, composer, tries };
            const fresh = getComposer();
            if (fresh && fresh !== composer) composer = fresh;
            setComposerValue(composer, text);
            held = composer.isConnected && sameText(composer.value, text);
        }
        return { ok: held, composer, tries };
    }

    function makeEnterEvent(type) {
        const event = new KeyboardEvent(type, {
            key: 'Enter', code: 'Enter', bubbles: true,
            cancelable: true, composed: true
        });
        try {
            Object.defineProperty(event, 'keyCode', { get: () => 13 });
            Object.defineProperty(event, 'which', { get: () => 13 });
        } catch (err) {}
        return event;
    }

    async function sendUpsaleAndWait(composer, text, token) {
        // Upsale cơ bản luôn tự động gửi bằng Enter.
        const nextConversationPromise = waitForNextConversation(token, OBSERVER_TIMEOUT);
        let target = getComposer() || composer;
        if (!target?.isConnected) {
            stop('Composer biến mất trước khi Enter');
            return null;
        }
        if (!sameText(target.value, text)) {
            const repasted = await pasteAndHold(target, text, token);
            if (!repasted.ok) {
                stop('Composer không giữ nội dung trước Enter');
                return null;
            }
            target = repasted.composer;
        }

        target.focus();
        target.dispatchEvent(makeEnterEvent('keydown'));
        target.dispatchEvent(makeEnterEvent('keyup'));

        for (let i = 1; i < enterCount; i++) {
            await nextTick();
            if (!tokenValid(token)) return null;
            const fresh = getComposer() || target;
            fresh.dispatchEvent(makeEnterEvent('keydown'));
            fresh.dispatchEvent(makeEnterEvent('keyup'));
        }

        stats.sent++;
        stats.sendMs += 0;
        stats.pendingSendAt = performance.now();
        renderStats();

        if (tabHiddenDuringStep) {
            setStatus('⏳ Tab vừa ẩn → xác nhận Pancake đã gửi...', '#faad14');
            const confirmed = await waitForHiddenSendConfirmation(token);
            if (!tokenValid(token)) return null;
            if (!confirmed) {
                stop('Tab vừa ẩn nhưng composer chưa được Pancake xóa sau Enter');
                return null;
            }
        }

        releaseNextConversationWait(token);
        setStatus('👁 Đã gửi → bắt conversation kế tiếp...', '#faad14');
        const next = await nextConversationPromise;
        if (!tokenValid(token)) return null;
        if (!next) {
            stop('Đã Enter nhưng không bắt được conversation kế tiếp');
            return null;
        }

        const waitMs = stats.pendingSendAt
            ? performance.now() - stats.pendingSendAt
            : 0;
        stats.pendingSendAt = 0;
        stats.cycles++;
        stats.waitMs += waitMs;
        renderStats();
        return next;
    }

    async function processUpsaleConversation(snapshot, token) {
        if (!tokenValid(token)) return null;
        tabHiddenDuringStep = false;
        if (!snapshot) {
            stop('Không tìm thấy conversation tại Chấm 1');
            return null;
        }
        if (!snapshot.id) {
            stop('Không xác định được REAL conversation ID');
            return null;
        }
        if (snapshot.snippet === null) {
            stop('Snippet chưa sẵn sàng');
            return null;
        }
        updateIdStatus(snapshot);

        if (stopSnippet && snapshot.snippet === stopSnippet) {
            stop(`🛑 Đã gặp câu dừng: ${stopSnippet}`);
            return null;
        }
        if (initialSnippet === null) {
            initialSnippet = snapshot.snippet;
        } else if (!bypassSnippet && snapshot.snippet !== initialSnippet) {
            stop('Dừng: snippet không trùng mẫu');
            return null;
        }
        if (lastConversationId && snapshot.id === lastConversationId) {
            stop('Chặn xử lý lại cùng conversation');
            return null;
        }

        lastConversationId = snapshot.id;
        handledIds.add(snapshot.id);
        if (handledIds.size > 20000) handledIds.delete(handledIds.values().next().value);
        if (!snapshot.row?.isConnected) {
            stop('Conversation row không còn tồn tại');
            return null;
        }
        if (!armListObserver(snapshot.id, token)) {
            stop('Không gắn được Direct Observer');
            return null;
        }

        const clickX = Number.isFinite(snapshot.x) ? snapshot.x : clickPos1.x;
        const clickY = Number.isFinite(snapshot.y) ? snapshot.y : clickPos1.y;
        setStatus('🔴 Click Chấm 1 → mở conversation...', '#ff7875');
        if (!fullClick(snapshot.row, clickX, clickY)) {
            stop('Không click được conversation');
            return null;
        }

        if (selectedGuard) {
            setStatus('🛡 Chờ conversation được đánh dấu .selected...', '#faad14');
            if (!await waitForSelected(snapshot, token)) {
                stop('Conversation không khớp .selected sau khi click');
                return null;
            }
        }

        const composer = await waitDOMCondition(() => {
            const current = getComposer();
            return current && isVisible(current) ? current : null;
        }, { token, timeout: 3000 });
        if (!tokenValid(token)) return null;
        if (!composer) {
            stop('Không tìm thấy #replyBoxComposer');
            return null;
        }

        const text = await getUpsaleText();
        if (!tokenValid(token)) return null;
        if (!text) {
            stop('Không có nội dung gửi: nhập nội dung hoặc cấp quyền clipboard');
            return null;
        }

        setStatus('✍ Đang dán nội dung Upsale...', '#faad14');
        const pasted = await pasteAndHold(composer, text, token);
        if (!tokenValid(token)) return null;
        if (!pasted.ok) {
            stop('Composer không giữ nội dung (React đã reset)');
            return null;
        }

        setStatus('⚡ Upsale cơ bản đang tự động gửi bằng Enter...', '#52c41a');
        await nextTick();
        if (!tokenValid(token)) return null;
        return sendUpsaleAndWait(pasted.composer, text, token);
    }

    // =========================================================
    // PROCESS ONE CONVERSATION
    // =========================================================

    async function processConversation(snapshot, token) {
        if (!tokenValid(token)) return null;
        tabHiddenDuringStep = false;
        if (!snapshot) {
            stop('Không tìm thấy conversation tại Chấm 1');
            return null;
        }
        if (!snapshot.id) {
            stop('Không xác định được REAL conversation ID');
            return null;
        }
        if (snapshot.snippet === null) {
            stop('Snippet chưa sẵn sàng');
            return null;
        }

        updateIdStatus(snapshot);
        const currentSnippet = snapshot.snippet;

        if (initialSnippet === null) {
            initialSnippet = currentSnippet;
        } else if (!bypassSnippet && currentSnippet !== initialSnippet) {
            stop('Dừng: snippet không trùng mẫu');
            return null;
        }

        if (lastConversationId && snapshot.id === lastConversationId) {
            stop('Chặn xử lý lại cùng conversation');
            return null;
        }

        lastConversationId = snapshot.id;
        handledIds.add(snapshot.id);
        if (handledIds.size > 20000) {
            handledIds.delete(handledIds.values().next().value);
        }

        if (!clickPos2) {
            stop('Chưa tạo Chấm 2');
            return null;
        }
        if (!snapshot.row?.isConnected) {
            stop('Conversation row không còn tồn tại');
            return null;
        }

        // Arm before clicking. Mutations while opening are captured, but cannot
        // resolve the next-conversation promise until Send is actually clicked.
        if (!armListObserver(snapshot.id, token)) {
            stop('Không gắn được Direct Observer');
            return null;
        }

        setStatus('🔴 Click Chấm 1 → mở conversation...', '#ff7875');
        const clickX = Number.isFinite(snapshot.x) ? snapshot.x : clickPos1.x;
        const clickY = Number.isFinite(snapshot.y) ? snapshot.y : clickPos1.y;
        if (!fullClick(snapshot.row, clickX, clickY)) {
            stop('Không click được conversation');
            return null;
        }

        if (CONVERSATION_DELAY > 0) {
            await sleep(CONVERSATION_DELAY);
            if (!tokenValid(token)) return null;
        }

        if (selectedGuard) {
            setStatus('🛡 Chờ conversation được đánh dấu .selected...', '#faad14');
            if (!await waitForSelected(snapshot, token)) {
                stop('Conversation không khớp .selected sau khi click');
                return null;
            }
        }

        setStatus('👁 Chờ đúng nút Mẫu trả lời nhanh...', '#faad14');
        let quickButton = await waitDOMCondition(
            () => findQuickReplyButton(),
            { token, timeout: 7000 }
        );
        if (!tokenValid(token)) return null;
        if (!quickButton) {
            stop('Không tìm thấy đúng nút Mẫu trả lời nhanh');
            return null;
        }

        if (QUICK_BUTTON_DELAY > 0) {
            await sleep(QUICK_BUTTON_DELAY);
            if (!tokenValid(token)) return null;
        }

        quickButton = findQuickReplyButton();
        if (!quickButton) {
            stop('Nút Mẫu trả lời nhanh biến mất trước khi click');
            return null;
        }

        setStatus('💬 Click nút Mẫu trả lời nhanh...', '#52c41a');
        if (!clickCenter(quickButton)) {
            stop('Không click được nút Mẫu trả lời nhanh');
            return null;
        }

        setStatus('👁 Chờ bảng Mẫu trả lời nhanh...', '#faad14');
        const popover = await waitDOMCondition(
            () => findQuickReplyPopover(),
            { token, timeout: 7000 }
        );
        if (!tokenValid(token)) return null;
        if (!popover) {
            stop('Bảng Mẫu trả lời nhanh không xuất hiện');
            return null;
        }

        if (POPOVER_DELAY > 0) {
            await sleep(POPOVER_DELAY);
            if (!tokenValid(token)) return null;
        }

        const popRect = popover.getBoundingClientRect();
        if (!pointInsideRect(clickPos2, popRect)) {
            stop('Chấm 2 nằm ngoài bảng Mẫu trả lời nhanh');
            return null;
        }

        if (POINT2_DELAY > 0) {
            await sleep(POINT2_DELAY);
            if (!tokenValid(token)) return null;
        }

        let target2 = elementFromSavedPoint(clickPos2);
        if (!target2) {
            stop('Không tìm thấy element tại Chấm 2');
            return null;
        }
        const qrRow = target2.closest?.('.qr-box-element');
        if (qrRow) target2 = qrRow;
        if (!popover.contains(target2)) {
            stop('Chấm 2 không thuộc bảng Mẫu trả lời nhanh');
            return null;
        }

        const popoverGonePromise = waitPopoverGone(popover, token);
        setStatus('🔵 Click Chấm 2 → chọn mẫu...', '#69b1ff');
        if (!fullClick(target2, clickPos2.x, clickPos2.y)) {
            stop('Không click được Chấm 2');
            return null;
        }

        setStatus('👁 Chờ bảng Quick Reply đóng...', '#faad14');
        if (!await popoverGonePromise) {
            stop('Bảng Quick Reply không đóng sau Chấm 2');
            return null;
        }

        if (COMPOSER_DELAY > 0) {
            await sleep(COMPOSER_DELAY);
            if (!tokenValid(token)) return null;
        }

        setStatus('👁 Chờ nội dung + đúng nút Gửi...', '#faad14');
        const ready = await waitComposerAndSend(token);
        if (!tokenValid(token)) return null;
        if (!ready) {
            stop('Không thấy nội dung hoặc đúng nút Gửi');
            return null;
        }

        if (SEND_DELAY > 0) {
            setStatus(`⏱ Chờ ${SEND_DELAY}ms trước khi Gửi...`, '#faad14');
            await sleep(SEND_DELAY);
        } else {
            await nextTick();
        }
        if (!tokenValid(token)) return null;

        const composer = getComposer();
        if (!composer || !getComposerText(composer)) {
            stop('Composer bị rỗng trước khi Gửi');
            return null;
        }

        const sendButton = findExactSendButton();
        if (!sendButton) {
            stop('Nút Gửi biến mất trước khi click');
            return null;
        }

        // Register the promise before the click so a very fast list mutation is not missed.
        const nextConversationPromise = waitForNextConversation(token, OBSERVER_TIMEOUT);

        setStatus('📤 Click đúng nút Gửi...', '#52c41a');
        const sendStarted = performance.now();
        if (!clickCenter(sendButton)) {
            stop('Không click được nút Gửi');
            return null;
        }
        stats.sent++;
        stats.sendMs += performance.now() - sendStarted;
        stats.pendingSendAt = performance.now();
        renderStats();

        if (tabHiddenDuringStep) {
            setStatus('⏳ Tab vừa ẩn → xác nhận Pancake đã gửi...', '#faad14');
            const confirmed = await waitForHiddenSendConfirmation(token);
            if (!tokenValid(token)) return null;
            if (!confirmed) {
                stop('Tab vừa ẩn nhưng composer chưa được Pancake xóa sau khi Gửi');
                return null;
            }
        }

        // Only now may observer/scan resolve the next row.
        releaseNextConversationWait(token);

        setStatus('👁 Đã Gửi → bắt conversation kế tiếp...', '#faad14');
        let nextSnapshot = await nextConversationPromise;
        if (!tokenValid(token)) return null;
        if (!nextSnapshot) {
            stop('Đã click Gửi nhưng không bắt được conversation kế tiếp');
            return null;
        }

        const waitMs = stats.pendingSendAt
            ? performance.now() - stats.pendingSendAt
            : 0;
        stats.pendingSendAt = 0;
        stats.cycles++;
        stats.waitMs += waitMs;
        renderStats();

        if (TRANSITION_DELAY > 0) {
            await sleep(TRANSITION_DELAY);
            if (!tokenValid(token)) return null;
            const refreshedRow = findRenderedRowById(nextSnapshot.id);
            const refreshed = snapshotFromRow(refreshedRow);
            if (refreshed && refreshed.snippet !== null) nextSnapshot = refreshed;
        }

        return nextSnapshot;
    }

    function renderStats() {
        if (!stats.sent) {
            txtStats.textContent = '📊 Chưa có dữ liệu';
            return;
        }
        const divisor = Math.max(1, stats.cycles);
        const avgSend = stats.sendMs / Math.max(1, stats.sent);
        const avgWait = stats.waitMs / divisor;
        txtStats.textContent = `📊 ${stats.sent} tin · dán/gửi ${avgSend.toFixed(0)}ms · chờ kế ${avgWait.toFixed(0)}ms`;
    }

    // =========================================================
    // MAIN LOOP + STOP/START
    // =========================================================

    async function mainLoop(token, firstSnapshot = null) {
        let snapshot = firstSnapshot || getSnapshot();
        while (tokenValid(token)) {
            const next = mode === 'twoPoint'
                ? await processConversation(snapshot, token)
                : await processUpsaleConversation(snapshot, token);
            if (!tokenValid(token) || !next) return;
            snapshot = next;
        }
    }

    function stop(reason = '') {
        isRunning = false;
        runToken++;
        removePicker();
        cleanupListObserver(null);
        disconnectUIObservers();
        cachedComposer = null;
        cachedList = null;
        cachedListInner = null;
        initialSnippet = null;
        lastConversationId = '';
        handledIds.clear();
        stats.pendingSendAt = 0;

        btnRun.textContent = '▶ Bắt đầu';
        btnRun.style.background = '#1677ff';
        bubble.style.background = '#1677ff';
        setStatus(reason || 'Đã dừng', reason ? '#faad14' : '#aaa');
        console.info('[Pancake QR] STOP:', reason || 'manual');
    }

    async function start() {
        if (isRunning) return;
        if (!clickPos1) {
            alert('Hãy tạo Chấm 1 tại conversation trước.');
            return;
        }
        if (mode === 'twoPoint' && !clickPos2) {
            alert('Chế độ Upsale photo cần tạo Chấm 2 tại mẫu Quick Reply trước.');
            return;
        }

        removePicker();
        cleanupListObserver(null);
        disconnectUIObservers();
        cachedComposer = null;
        cachedList = null;
        cachedListInner = null;
        cachedClipboardText = '';

        const initial = getSnapshot();
        if (!initial || !initial.id) {
            updateIdStatus(initial);
            setStatus('Không đọc được REAL conversation ID tại Chấm 1', '#ff7875');
            return;
        }
        if (initial.snippet === null) {
            updateIdStatus(initial);
            setStatus('Không đọc được .snippet-text tại Chấm 1', '#ff7875');
            return;
        }

        isRunning = true;
        initialSnippet = null;
        lastConversationId = '';
        handledIds.clear();
        stats = { sent: 0, cycles: 0, sendMs: 0, waitMs: 0, pendingSendAt: 0 };
        renderStats();
        const token = ++runToken;

        btnRun.textContent = '⏹ Dừng lại';
        btnRun.style.background = '#ff4d4f';
        bubble.style.background = '#ff4d4f';
        updateIdStatus(initial);
        setStatus(
            mode === 'twoPoint'
                ? '🤖 Upsale photo: Quick Reply + Send đang chạy...'
                : '🤖 Upsale cơ bản: dán nội dung + Enter đang chạy...',
            '#52c41a'
        );

        try {
            await mainLoop(token, initial);
        } catch (err) {
            console.error('[Pancake QR] MAIN ERROR:', err);
            if (tokenValid(token)) stop('Script lỗi - xem Console');
        }
    }

    btnMode.onclick = () => {
        if (isRunning) {
            setStatus('Hãy dừng script trước khi đổi cơ chế.', '#faad14');
            return;
        }
        mode = mode === 'twoPoint' ? 'upSale' : 'twoPoint';
        syncUI();
        saveUI();
        setStatus(
            mode === 'twoPoint'
                ? 'Đã chuyển sang chế độ Upsale photo.'
                : 'Đã chuyển sang chế độ Upsale cơ bản.',
            '#52c41a'
        );
    };

    inputSendText.addEventListener('input', () => {
        sendText = inputSendText.value;
        saveUI();
    });

    inputEnterCount.addEventListener('change', () => {
        enterCount = Math.min(3, Math.max(1, parseInt(inputEnterCount.value, 10) || 1));
        inputEnterCount.value = String(enterCount);
        saveUI();
    });

    btnBypass.onclick = () => {
        bypassSnippet = !bypassSnippet;
        syncUI();
        saveUI();
    };

    btnHotkeyEnable.onclick = () => {
        hotkeyEnabled = !hotkeyEnabled;
        syncUI();
    };

    selectHotkey.onchange = () => {
        activationHotkey = selectHotkey.value === 'F4' ? 'F4' : 'Tab';
        syncUI();
        saveUI();
    };

    btnRun.onclick = () => (isRunning ? stop() : start());

    window.addEventListener('keydown', event => {
        if (!hotkeyEnabled) return;
        if (root.contains(event.target)) return;
        const match = activationHotkey === 'Tab'
            ? event.key === 'Tab' || event.code === 'Tab'
            : event.key === 'F4' || event.code === 'F4';
        if (!match || event.altKey || event.ctrlKey || event.metaKey
            || event.shiftKey || event.isComposing || event.repeat) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (isRunning) stop(`Đã dừng bằng ${activationHotkey.toUpperCase()}`);
        else start();
    }, true);

    window.addEventListener('pagehide', () => {
        removePicker();
        cleanupListObserver(null);
        disconnectUIObservers();
        savePositions();
        saveUI();
    });

    // =========================================================
    // INIT
    // =========================================================

    restoreUI(savedUI);
    selectHotkey.value = activationHotkey;
    syncUI();
    updateMarkers();

    if (clickPos1) setTimeout(() => updateIdStatus(getSnapshot()), 0);
    console.info(`[Pancake QR] V${VERSION} sẵn sàng`);
})();
