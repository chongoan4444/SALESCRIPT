// ==UserScript==
// @name         Pancake F7 - Filter Chặn siêu nhanh (Optimized 2.7 - Fix click lặp)
// @namespace    tm-pancake-f7
// @version      2.7.0
// @description  F7: Mail -> Call X -> Hôm nay -> Loại trừ thẻ Chặn. Fix click lặp: chỉ click 1 candidate duy nhất mỗi attempt cho lịch (div.filter-by-time-icon), bỏ descendant search tránh click nhầm close, chống click lặp 300ms, tăng AFTER_CLICK_MS lên 60ms, clickAndWait chỉ click 1 lần. Giữ HTML success sidebar-selected + case-insensitive Chặn.
// @match        https://pancake.vn/*
// @match        https://*.pancake.vn/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';
    if (window.top !== window.self) return;

    // =========================================================
    // CONFIG - DỰA TRÊN 12.x + FIX CALENDAR
    // =========================================================
    const CONFIG = {
        POLL_FALLBACK_MS: 40,
        ELEMENT_TIMEOUT_MS: 5000,
        AFTER_CLICK_MS: 60, // tăng từ 25 lên 60 để React kịp render, tránh hụt
        AFTER_CALENDAR_MS: 180,
        CALENDAR_RETRY: 4,
        CALENDAR_VERIFY_MS: 1000,
    };

    const MAIL_PATH = 'm40 15.8v17.8q0 1.4-1 2.5';
    const CALL_X_PATH = 'M146.34,98.34,164.69,80';

    let running = false;
    let abortGeneration = 0;
    let destroyed = false;
    let lastClickedEl = null;
    let lastClickTime = 0;

    // =========================================================
    // UTILS - TỪ 12.x
    // =========================================================
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function isAbortError(err) { return err && err.__abort; }
    function assertNotAborted(gen) {
        if (gen !== abortGeneration || destroyed) {
            const e = new Error('Aborted');
            e.__abort = true;
            throw e;
        }
    }

    function isElementVisible(el) {
        if (!el || !el.isConnected) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') return false;
        if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) return true;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function normalizedText(el) {
        return (el?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    // waitFor dùng MutationObserver như 12.x - nhanh hơn poll 15ms
    function waitFor(getter, timeout = CONFIG.ELEMENT_TIMEOUT_MS, generation = null) {
        return new Promise(resolve => {
            const start = performance.now();
            let finished = false;
            let observer = null;
            let timeoutId = null;

            const cleanup = () => {
                if (observer) { observer.disconnect(); observer = null; }
                if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
            };

            const check = () => {
                if (finished) return;
                if (generation !== null && generation !== abortGeneration) { finished = true; cleanup(); resolve(null); return; }
                if (destroyed) { finished = true; cleanup(); resolve(null); return; }
                try {
                    const el = getter();
                    if (el && isElementVisible(el)) {
                        finished = true;
                        cleanup();
                        resolve(el);
                        return;
                    }
                } catch (_) {}
                if (performance.now() - start >= timeout) {
                    finished = true;
                    cleanup();
                    resolve(null);
                }
            };

            observer = new MutationObserver(check);
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'd'] });
            timeoutId = setTimeout(check, timeout);
            // Fallback poll nhẹ 40ms thay vì 15ms để đỡ CPU, nhưng observer đã bắt hầu hết
            const interval = setInterval(() => {
                if (finished) { clearInterval(interval); return; }
                check();
            }, CONFIG.POLL_FALLBACK_MS);
            check();
        });
    }

    // triggerElementAction từ 12.x - hỗ trợ React + tìm sâu hơn
    function findReactOnClick(el) {
        if (!el) return null;
        try {
            const keys = Object.keys(el);
            for (const k of keys) {
                if (k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$') || k.startsWith('__reactFiber$')) {
                    const props = el[k];
                    if (!props) continue;
                    if (typeof props.onClick === 'function') return { el, fn: props.onClick };
                    const nested = props.memoizedProps || props.pendingProps;
                    if (nested && typeof nested.onClick === 'function') return { el, fn: nested.onClick };
                    if (props.children && typeof props.children.props?.onClick === 'function') return { el, fn: props.children.props.onClick };
                }
            }
        } catch (_) {}
        return null;
    }

    function triggerElementAction(element) {
        if (!element || !element.isConnected) return false;

        const now = Date.now();
        if (lastClickedEl === element && now - lastClickTime < 300) {
            console.warn('[F7] Skip click lặp cùng element trong 300ms', element);
            return true;
        }

        // 1. Thử React handler trên chính element và 6 parent
        try {
            let cur = element;
            for (let i = 0; i < 6 && cur; i++) {
                const found = findReactOnClick(cur);
                if (found) {
                    found.fn({ preventDefault: () => {}, stopPropagation: () => {}, target: found.el, currentTarget: found.el, bubbles: true });
                    lastClickedEl = element;
                    lastClickTime = now;
                    return true;
                }
                cur = cur.parentElement;
            }
        } catch (_) {}

        // 2. BỎ tìm trong con để tránh click nhầm nút close (filter-by-time-close) bên trong li.filter-by-time
        // Chỉ tìm parent chain, không tìm descendants

        try {
            element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch (_) {}

        // 3. Native events
        try {
            element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, pointerType: 'mouse', isPrimary: true }));
        } catch (_) {}
        try {
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
        try {
            element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window, pointerType: 'mouse', isPrimary: true }));
        } catch (_) {}
        try {
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
        try {
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            element.click();
            lastClickedEl = element;
            lastClickTime = now;
            return true;
        } catch (_) {
            return false;
        }
    }

    // Thử click tất cả candidates trong container cho tới khi popover mở
    function triggerBestClick(candidates) {
        for (const cand of candidates) {
            if (!cand || !cand.isConnected) continue;
            if (!isElementVisible(cand)) continue;
            console.log('[F7] Trying click candidate', cand);
            if (triggerElementAction(cand)) return cand;
        }
        return null;
    }

    function findByText(text, selectors = 'button,div,span,[role="option"]', root = document) {
        const candidates = [...root.querySelectorAll(selectors)].filter(isElementVisible).filter(el => normalizedText(el) === text);
        if (!candidates.length) return null;
        return candidates.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (ra.width * ra.height) - (rb.width * rb.height);
        })[0];
    }

    // Case-insensitive + không phân biệt hoa thường cho tiếng Việt
    function normalizedTextLower(el) {
        return (el?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function findByTextInsensitive(targetText, selectors = 'button,div,span,[role="option"]', root = document) {
        const target = String(targetText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const candidates = [...root.querySelectorAll(selectors)].filter(isElementVisible).filter(el => normalizedTextLower(el) === target);
        if (!candidates.length) return null;
        return candidates.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (ra.width * ra.height) - (rb.width * rb.height);
        })[0];
    }

    // Click đơn giản - chỉ 1 lần, không retry theo visibility (tránh click lặp)
    async function clickAndWait(getter, name, delay = CONFIG.AFTER_CLICK_MS, generation) {
        const el = await waitFor(getter, CONFIG.ELEMENT_TIMEOUT_MS, generation);
        if (generation !== undefined) assertNotAborted(generation);
        if (!el) throw new Error(`Không tìm thấy: ${name}`);
        console.log(`[F7] ${name}`, el);
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
        if (!triggerElementAction(el)) throw new Error(`Không click được: ${name}`);
        if (delay) await sleep(delay);
        return el;
    }

    async function clickAndWaitWithVerify(getter, name, verifyFn, delay = CONFIG.AFTER_CLICK_MS, generation) {
        const el = await waitFor(getter, CONFIG.ELEMENT_TIMEOUT_MS, generation);
        if (generation !== undefined) assertNotAborted(generation);
        if (!el) throw new Error(`Không tìm thấy: ${name}`);
        console.log(`[F7] ${name}`, el);

        for (let attempt = 1; attempt <= 3; attempt++) {
            assertNotAborted(generation);
            try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
            const clicked = triggerElementAction(el);
            if (!clicked) {
                console.warn(`[F7] ${name} attempt ${attempt} trigger fail`);
                await sleep(80);
                continue;
            }
            await sleep(delay);

            if (verifyFn) {
                const start = performance.now();
                while (performance.now() - start < 600) {
                    if (verifyFn()) {
                        console.log(`[F7] ${name} verify ok sau attempt ${attempt}`);
                        return el;
                    }
                    await sleep(50);
                }
                console.warn(`[F7] ${name} attempt ${attempt} verify fail, retry...`);
            } else {
                return el;
            }
        }
        // Dù verify fail vẫn trả về để tiếp tục, tránh kẹt
        console.warn(`[F7] ${name} verify fail sau 3 lần, tiếp tục`);
        return el;
    }

    // =========================================================
    // GETTERS - DỰA TRÊN SELECTOR THỰC TẾ PANCAKE
    // =========================================================
    // Sidebar icon: .sidebar path với d startsWith - đã xác minh từ HTML thật
    function getMail() {
        const paths = document.querySelectorAll('.sidebar path');
        for (const p of paths) {
            const d = p.getAttribute('d') || '';
            if (d.startsWith(MAIL_PATH)) {
                const li = p.closest('li');
                if (li && isElementVisible(li)) return li;
            }
        }
        return null;
    }

    function getCallX() {
        const paths = document.querySelectorAll('.sidebar path');
        for (const p of paths) {
            const d = p.getAttribute('d') || '';
            if (d.startsWith(CALL_X_PATH)) {
                const li = p.closest('li');
                if (li && isElementVisible(li)) return li;
            }
        }
        return null;
    }

    function getCalendarIcon() {
        // HTML thật khi click thành công: <li class="filter-by-time"><div class="filter-by-time-icon sidebar-selected pancake-date-range-picker"><img ...></div>
        // Nên clickable chính là div.filter-by-time-icon, không phải li
        const selectors = [
            'li.filter-by-time > div.filter-by-time-icon.pancake-date-range-picker',
            'div.filter-by-time-icon.pancake-date-range-picker',
            '.sidebar .filter-by-time-icon.pancake-date-range-picker',
            'li.filter-by-time div.filter-by-time-icon',
            'li.filter-by-time',
            '.sidebar li.filter-by-time',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        const all = document.querySelectorAll('.sidebar [title*="thời gian"], .sidebar [title*="Thời gian"]');
        for (const el of all) return el;
        return null;
    }

    function isCalendarSelected() {
        // HTML thành công: div.filter-by-time-icon.sidebar-selected
        const selected = document.querySelector('li.filter-by-time > div.filter-by-time-icon.sidebar-selected, div.filter-by-time-icon.sidebar-selected.pancake-date-range-picker');
        return !!selected;
    }

    function getCalendarClickableCandidates() {
        const icon = getCalendarIcon();
        if (!icon) return [];

        const li = icon.closest('li.filter-by-time') || document.querySelector('li.filter-by-time');
        const candidatesSet = new Set();
        const add = el => { if (el && el.isConnected) candidatesSet.add(el); };

        // Ưu tiên cao nhất: div.filter-by-time-icon chính nó
        const preciseIcon = document.querySelector('li.filter-by-time > div.filter-by-time-icon.pancake-date-range-picker') || icon;
        add(preciseIcon);

        // Thêm img bên trong
        const img = preciseIcon.querySelector ? preciseIcon.querySelector('img.custom-svg-icon') : null;
        if (img) add(img);

        // Thêm parent chain từ icon lên li
        let cur = preciseIcon.parentElement;
        for (let i = 0; i < 4 && cur; i++) {
            add(cur);
            if (cur === li) break;
            cur = cur.parentElement;
        }

        if (li) {
            add(li);
            // Thêm các div con trong li
            const inside = li.querySelectorAll('div.filter-by-time-icon, div.pancake-date-range-picker, div.filter-by-time-close, button, [role="button"]');
            for (const el of inside) add(el);
        }

        // Thêm tất cả element có class filter-by-time-icon trong sidebar
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            const sidebarIcons = sidebar.querySelectorAll('.filter-by-time-icon, .pancake-date-range-picker');
            for (const el of sidebarIcons) add(el);
        }

        let candidates = Array.from(candidatesSet);
        // Sort: ưu tiên div.filter-by-time-icon có React handler
        candidates.sort((a, b) => {
            const aIsIcon = a.classList?.contains('filter-by-time-icon') ? 1 : 0;
            const bIsIcon = b.classList?.contains('filter-by-time-icon') ? 1 : 0;
            if (aIsIcon !== bIsIcon) return bIsIcon - aIsIcon;

            const aHas = !!findReactOnClick(a);
            const bHas = !!findReactOnClick(b);
            if (aHas && !bHas) return -1;
            if (!aHas && bHas) return 1;

            // Ưu tiên DIV hơn LI
            if (a.tagName === 'DIV' && b.tagName !== 'DIV') return -1;
            if (b.tagName === 'DIV' && a.tagName !== 'DIV') return 1;
            return 0;
        });

        if (candidates.length) {
            console.log(`[F7] Calendar candidates ${candidates.length}`, candidates.slice(0,5).map(c => `${c.tagName}.${(c.className?.toString?.()||'').slice(0,80)} hasClick=${!!findReactOnClick(c)}`));
        }
        return candidates;
    }

    function getCalendarClickable() {
        const cands = getCalendarClickableCandidates();
        return cands[0] || null;
    }

    function getCalendar() {
        return getCalendarClickable();
    }

    // HTML thật user cung cấp: <div class="ant-popover pancake-date-range-picker-popup ...">
    function getDateRangePopup() {
        const popup = document.querySelector('.ant-popover.pancake-date-range-picker-popup');
        if (popup && isElementVisible(popup)) return popup;
        const panel = document.querySelector('.pancake-date-range-picker-panel');
        if (panel && isElementVisible(panel)) return panel.closest('.ant-popover') || panel;
        return null;
    }

    function isCalendarPopoverOpen() {
        // Dựa trên HTML thành công bạn gửi: khi click thành công thì div.filter-by-time-icon có class sidebar-selected
        // và popover .pancake-date-range-picker-popup xuất hiện
        if (isCalendarSelected()) return true;
        return !!getDateRangePopup();
    }

    // HTML thật: <div class="ant-segmented filter-by-time-segmented"> <div title="Thời gian tạo">
    function getCreatedTime() {
        const popup = getDateRangePopup();
        const root = popup || document;

        // Ưu tiên selector chính xác từ HTML thật
        const byTitleExact = root.querySelector('.ant-segmented-item-label[title="Thời gian tạo"]');
        if (byTitleExact && isElementVisible(byTitleExact)) return byTitleExact;

        const byTitleAny = [...root.querySelectorAll('[title="Thời gian tạo"]')].find(isElementVisible);
        if (byTitleAny) return byTitleAny;

        // Fallback: tìm label chứa
        const segmented = root.querySelector('.filter-by-time-segmented');
        if (segmented) {
            const item = [...segmented.querySelectorAll('.ant-segmented-item-label')].find(el => normalizedText(el) === 'Thời gian tạo' && isElementVisible(el));
            if (item) return item;
        }

        return findByText('Thời gian tạo', '.ant-segmented-item-label, [title="Thời gian tạo"], div, span', root);
    }

    function isCreatedTimeSelected() {
        const el = getCreatedTime();
        if (!el) return false;
        // Check parent label có class selected không - từ HTML: label.ant-segmented-item.ant-segmented-item-selected
        const label = el.closest('label.ant-segmented-item');
        if (label && label.classList.contains('ant-segmented-item-selected')) return true;
        // Hoặc check aria-selected
        if (el.getAttribute('aria-selected') === 'true') return true;
        return false;
    }

    // HTML thật: <div class="preset-item">Hôm nay</div> nằm trong .pancake-date-range-picker-panel__side
    function getToday() {
        const popup = getDateRangePopup();
        const root = popup || document;

        // Ưu tiên selector chính xác
        const presetItems = [...root.querySelectorAll('.pancake-date-range-picker-panel .preset-item')].filter(isElementVisible);
        const todayExact = presetItems.find(el => normalizedText(el) === 'Hôm nay');
        if (todayExact) return todayExact;

        // Fallback: tìm trong popup
        if (popup) {
            const anyToday = [...popup.querySelectorAll('.preset-item')].filter(isElementVisible).find(el => normalizedText(el) === 'Hôm nay');
            if (anyToday) return anyToday;
        }

        return findByText('Hôm nay', '.preset-item, button,div,span,[role="option"],[role="menuitem"],li', root);
    }

    // Nút Lọc trong popup - từ HTML: <button ...><span>Lọc</span></button> trong .footer-buttons__right
    function getDateFilterApplyButton() {
        const popup = getDateRangePopup();
        if (!popup) return null;
        const btn = [...popup.querySelectorAll('button')].find(el => isElementVisible(el) && normalizedText(el) === 'Lọc');
        if (btn) return btn;
        // Fallback: tìm trong footer
        const footer = popup.querySelector('.footer-buttons__right');
        if (footer) {
            const b = [...footer.querySelectorAll('button')].find(el => isElementVisible(el));
            if (b) return b;
        }
        return null;
    }

    // Click calendar với retry + verify - FIX CLICK LẶP: chỉ click 1 candidate duy nhất mỗi attempt
    async function clickCalendarWithRetry(generation) {
        if (isCalendarPopoverOpen()) {
            console.log('[F7] Calendar popover đã mở sẵn (sidebar-selected), bỏ qua click 3/9');
            return getCalendarClickable();
        }

        for (let attempt = 1; attempt <= CONFIG.CALENDAR_RETRY; attempt++) {
            assertNotAborted(generation);

            let candidates = getCalendarClickableCandidates();
            if (!candidates.length) {
                await sleep(200);
                candidates = getCalendarClickableCandidates();
            }

            if (!candidates || !candidates.length) throw new Error('Không tìm thấy: 3/9 Lịch (calendar icon)');

            // FIX: chỉ lấy candidate tốt nhất (div.filter-by-time-icon), không click lặp nhiều cái trong 1 attempt
            const best = candidates[0];
            console.log(`[F7] 3/9 Lịch - attempt ${attempt}/${CONFIG.CALENDAR_RETRY} - click duy nhất:`, best.tagName, (best.className?.toString?.()||'').slice(0,120), `hasReact=${!!findReactOnClick(best)}`);

            try { best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
            triggerElementAction(best);

            const verifyStart = performance.now();
            let opened = false;
            while (performance.now() - verifyStart < CONFIG.CALENDAR_VERIFY_MS) {
                if (generation !== abortGeneration) { const e = new Error('Aborted'); e.__abort = true; throw e; }
                if (isCalendarPopoverOpen()) { opened = true; break; }
                await sleep(50);
            }

            if (opened) {
                const hasSelected = isCalendarSelected();
                const hasPopup = !!getDateRangePopup();
                console.log(`[F7] 3/9 Lịch - mở thành công sau attempt ${attempt} - selected=${hasSelected} popup=${hasPopup}`);
                await sleep(CONFIG.AFTER_CALENDAR_MS);
                return best;
            }

            console.warn(`[F7] 3/9 Lịch - attempt ${attempt} không mở được (không có sidebar-selected + không có popup), retry sau ${250*attempt}ms...`);
            await sleep(250 * attempt);
        }

        throw new Error('Không mở được popover lịch sau 4 lần thử - đã thử click div.filter-by-time-icon.pancake-date-range-picker');
    }

    // Click "Thời gian tạo" với verify selected
    async function clickCreatedTimeWithRetry(generation) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            assertNotAborted(generation);
            const el = await waitFor(getCreatedTime, CONFIG.ELEMENT_TIMEOUT_MS, generation);
            if (!el) throw new Error('Không tìm thấy: 4/9 Thời gian tạo');

            if (isCreatedTimeSelected()) {
                console.log('[F7] 4/9 Thời gian tạo đã được chọn sẵn');
                return el;
            }

            console.log(`[F7] 4/9 Thời gian tạo - attempt ${attempt}`, el);
            triggerElementAction(el);
            await sleep(CONFIG.AFTER_CLICK_MS + 50);

            if (isCreatedTimeSelected()) {
                console.log(`[F7] 4/9 Thời gian tạo - chọn thành công sau attempt ${attempt}`);
                return el;
            }
        }
        // Dù chưa selected vẫn tiếp tục, có thể đã là default
        console.warn('[F7] 4/9 Thời gian tạo - không verify được selected, tiếp tục');
        return getCreatedTime();
    }

    // Click "Hôm nay" với verify
    async function clickTodayWithRetry(generation) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            assertNotAborted(generation);
            const el = await waitFor(getToday, CONFIG.ELEMENT_TIMEOUT_MS, generation);
            if (!el) throw new Error('Không tìm thấy: 5/9 Hôm nay');

            console.log(`[F7] 5/9 Hôm nay - attempt ${attempt}`, el);
            try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
            triggerElementAction(el);
            await sleep(CONFIG.AFTER_CLICK_MS + 80);

            // Sau khi click Hôm nay, check xem popup còn mở không - nếu còn thì cần click nút Lọc
            const popupStillOpen = isCalendarPopoverOpen();
            if (!popupStillOpen) {
                console.log('[F7] 5/9 Hôm nay - popup đóng, coi như đã áp dụng');
                return el;
            }

            // Nếu popup vẫn mở, thử click nút Lọc để áp dụng
            const applyBtn = getDateFilterApplyButton();
            if (applyBtn) {
                console.log('[F7] 5/9 Hôm nay - popup vẫn mở, click nút Lọc để áp dụng', applyBtn);
                triggerElementAction(applyBtn);
                await sleep(150);
                // Chờ popup đóng
                const start = performance.now();
                while (performance.now() - start < 1000) {
                    if (!isCalendarPopoverOpen()) break;
                    await sleep(50);
                }
            }

            return el;
        }
    }

    // Đã có getToday ở trên, xóa duplicate này

    function getFilterButton() {
        const root = document.getElementById('conversationCol');
        if (!root) return null;
        // Không phân biệt hoa thường cho "Lọc theo"
        const btn = [...root.querySelectorAll('button')].find(el => isElementVisible(el) && normalizedTextLower(el) === 'lọc theo');
        if (btn) return btn;
        return findByTextInsensitive('Lọc theo', 'button', root) || null;
    }

    function getExcludeTag() {
        // .option-tag-filter-item - không phân biệt hoa thường
        const all = [...document.querySelectorAll('.option-tag-filter-item')].filter(isElementVisible);
        const specific = all.find(el => normalizedTextLower(el) === 'loại trừ thẻ');
        if (specific) return specific;
        return findByTextInsensitive('Loại trừ thẻ', '.option-tag-filter-item, button,div,span,[role="option"]') || findByText('Loại trừ thẻ');
    }

    // FIX: không phân biệt hoa thường cho "Chặn" + chống click hụt
    function getBlockTag() {
        // .tag-filter-item là item tag trong popover - ưu tiên, case-insensitive
        const allItems = [...document.querySelectorAll('.tag-filter-item')].filter(isElementVisible);
        const specific = allItems.find(el => normalizedTextLower(el) === 'chặn');
        if (specific) return specific;

        // Thử tìm với contains "chặn" (phòng trường hợp có icon hoặc badge kèm)
        const contains = allItems.find(el => normalizedTextLower(el).includes('chặn'));
        if (contains) return contains;

        // Fallback: quét trong ant-popover / dropdown, không phân biệt hoa thường
        const fallback = findByTextInsensitive('Chặn', '.ant-popover div,.ant-popover span,.ant-dropdown div,.ant-dropdown span, [role="option"], li, .tag-filter-item');
        if (fallback) return fallback;

        return findByText('Chặn', '.ant-popover div,.ant-popover span,.ant-dropdown div,.ant-dropdown span, [role="option"], li');
    }

    function getFinalBlockButton() {
        const root = document.getElementById('conversationCol');
        if (!root) return null;
        // Case-insensitive cho nút Chặn cuối
        const btn = [...root.querySelectorAll('button')].find(el => isElementVisible(el) && normalizedTextLower(el) === 'chặn');
        if (btn) return btn;
        // Fallback contains
        const contains = [...root.querySelectorAll('button')].find(el => isElementVisible(el) && normalizedTextLower(el).includes('chặn'));
        if (contains) return contains;
        return findByTextInsensitive('Chặn', 'button', root) || null;
    }

    // Click Chặn với retry + verify - chống hụt nhẹ
    async function clickBlockTagWithRetry(generation) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            assertNotAborted(generation);
            const el = await waitFor(getBlockTag, CONFIG.ELEMENT_TIMEOUT_MS, generation);
            if (!el) throw new Error('Không tìm thấy: 8/9 Chặn (tag)');

            console.log(`[F7] 8/9 Chặn (tag) - attempt ${attempt} - ${normalizedText(el)} - hasReact=${!!findReactOnClick(el)}`, el);

            try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
            const clicked = triggerElementAction(el);
            if (!clicked) {
                console.warn(`[F7] 8/9 Chặn attempt ${attempt} click fail`);
                await sleep(80);
                continue;
            }
            await sleep(CONFIG.AFTER_CLICK_MS + 50);

            // Verify: sau khi click tag Chặn, nút Chặn cuối (9/9) phải xuất hiện hoặc tag Chặn phải có dấu hiệu selected
            const verifyStart = performance.now();
            while (performance.now() - verifyStart < 600) {
                const finalBtn = getFinalBlockButton();
                if (finalBtn && isElementVisible(finalBtn)) {
                    console.log(`[F7] 8/9 Chặn verify ok - final button xuất hiện sau attempt ${attempt}`);
                    return el;
                }
                // Hoặc check xem tag có class selected không
                if (el.closest && el.closest('.selected, .active, [aria-selected="true"]')) {
                    return el;
                }
                await sleep(50);
            }
            console.warn(`[F7] 8/9 Chặn attempt ${attempt} chưa thấy final button, retry...`);
        }
        console.warn('[F7] 8/9 Chặn verify fail sau 3 lần, tiếp tục');
        return getBlockTag();
    }

    async function clickFinalBlockWithRetry(generation) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            assertNotAborted(generation);
            const el = await waitFor(getFinalBlockButton, CONFIG.ELEMENT_TIMEOUT_MS, generation);
            if (!el) throw new Error('Không tìm thấy: 9/9 Chặn (áp dụng)');

            console.log(`[F7] 9/9 Chặn (áp dụng) - attempt ${attempt} - ${normalizedText(el)} - hasReact=${!!findReactOnClick(el)}`, el);

            try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
            const clicked = triggerElementAction(el);
            if (!clicked) {
                console.warn(`[F7] 9/9 Chặn attempt ${attempt} click fail`);
                await sleep(80);
                continue;
            }
            await sleep(100);

            // Verify: sau khi click áp dụng, popover/tag list phải đóng
            const start = performance.now();
            while (performance.now() - start < 800) {
                const stillVisible = getBlockTag();
                // Nếu tag list đã đóng thì coi như thành công
                if (!stillVisible || !isElementVisible(stillVisible)) {
                    console.log(`[F7] 9/9 Chặn áp dụng thành công sau attempt ${attempt} - popover đóng`);
                    return el;
                }
                await sleep(50);
            }
            // Dù popover chưa đóng vẫn coi như đã click, tránh kẹt
            console.log(`[F7] 9/9 Chặn đã click attempt ${attempt}, tiếp tục dù popover chưa đóng`);
            return el;
        }
    }

    // =========================================================
    // WORKFLOW
    // =========================================================
    async function runWorkflow() {
        if (running) {
            console.log('[F7] Workflow đang chạy.');
            return;
        }
        running = true;
        const generation = abortGeneration;
        const start = performance.now();

        try {
            console.log('[F7] ===== START =====');

            await clickAndWait(getMail, '1/9 Mail', CONFIG.AFTER_CLICK_MS, generation);
            assertNotAborted(generation);

            await clickAndWait(getCallX, '2/9 Cuộc gọi X', CONFIG.AFTER_CLICK_MS, generation);
            assertNotAborted(generation);

            // FIX CALENDAR: dùng retry + verify .pancake-date-range-picker-popup từ HTML thật
            await clickCalendarWithRetry(generation);
            assertNotAborted(generation);

            await clickCreatedTimeWithRetry(generation);
            assertNotAborted(generation);

            await clickTodayWithRetry(generation);
            assertNotAborted(generation);

            await clickAndWait(getFilterButton, '6/9 Lọc theo', CONFIG.AFTER_CLICK_MS, generation);
            assertNotAborted(generation);

            await clickAndWaitWithVerify(getExcludeTag, '7/9 Loại trừ thẻ', () => !!getBlockTag(), CONFIG.AFTER_CLICK_MS, generation);
            assertNotAborted(generation);

            await clickBlockTagWithRetry(generation);
            assertNotAborted(generation);

            await clickFinalBlockWithRetry(generation);
            assertNotAborted(generation);

            console.log(`[F7] ===== DONE ${(performance.now() - start).toFixed(0)}ms =====`);
        } catch (err) {
            if (isAbortError(err)) {
                console.info('[F7] Bị ESC hủy.');
            } else {
                console.error('[F7] Workflow lỗi:', err);
            }
        } finally {
            if (generation === abortGeneration) running = false;
        }
    }

    // =========================================================
    // KEY HANDLER - GIỮ CAPTURE + ESC ABORT NHƯ 12.x
    // =========================================================
    window.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (running) {
                abortGeneration++;
                running = false;
                console.info('[F7] ESC -> ABORT');
            }
            return;
        }
        if (e.key !== 'F7' && e.keyCode !== 118) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (e.repeat) return;

        runWorkflow();
    }, true);

    console.log('[Pancake F7 Optimized 2.7 - Fix click lặp] Ready - nhấn F7 để chạy. ESC để hủy.');
})();
