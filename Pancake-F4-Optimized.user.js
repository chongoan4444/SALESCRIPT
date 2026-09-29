// ==UserScript==
// @name         Pancake - Tự động chốt (F4 - Siêu Nhanh - Optimized 12.x)
// @namespace    https://tampermonkey.net/
// @version      4.0
// @description  F4: Tắt tag ngày (dd/mm đang chọn) -> Tắt tag 24 (nếu đang chọn) -> Bật tag "T.Anh chốt". Tối ưu từ logic 12.4: dùng #listShowTags/#listAllTags, check .ellipse selected, trigger React onClick, chỉ click khi cần.
// @match        https://pancake.vn/*
// @match        https://*.pancake.vn/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    if (window.top !== window.self) return;

    // =========================================================
    // CONFIG & SELECTOR - DỰA TRÊN SOURCE THỰC TẾ 12.x
    // =========================================================
    const DATE_TAG_REGEX = /^\d{1,2}\/\d{1,2}$/;
    const TAG_ELLIPSE_SELECTOR = '.ellipse';
    const TAG_BUTTON_SELECTOR = 'button.btn-tag-item';
    const TAGS_SHOW_CONTAINER_ID = 'listShowTags';
    const TAGS_ALL_CONTAINER_ID = 'listAllTags';
    const TARGET_TAG_VARIANTS = ['t.anh chốt', 't.anhchốt', 'tanh chốt', 'tanhchot'];

    let isProcessing = false;

    function isElementVisible(el) {
        if (!el || !el.isConnected) return false;
        if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) return true;
        const style = window.getComputedStyle(el);
        return style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function getTagsContainers() {
        const show = document.getElementById(TAGS_SHOW_CONTAINER_ID);
        const all = document.getElementById(TAGS_ALL_CONTAINER_ID);
        const containers = [];
        if (show && show.isConnected) containers.push(show);
        if (all && all.isConnected) containers.push(all);
        return containers;
    }

    function getAllTagButtons() {
        const containers = getTagsContainers();
        if (!containers.length) {
            // Fallback: quét toàn document nếu không có container (giữ ổn định)
            return Array.from(document.querySelectorAll(TAG_BUTTON_SELECTOR)).filter(b => b.isConnected && isElementVisible(b));
        }
        const buttons = [];
        for (const c of containers) {
            const list = c.querySelectorAll(TAG_BUTTON_SELECTOR);
            for (const b of list) {
                if (b.isConnected && isElementVisible(b)) buttons.push(b);
            }
        }
        return buttons;
    }

    function getButtonText(btn) {
        return String(btn.textContent || '').trim();
    }

    function normalizeTagText(text) {
        return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\s+/g, '');
    }

    function normalizeForCompare(text) {
        return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s+/g, '');
    }

    function hasEllipse(btn) {
        return !!btn.querySelector(TAG_ELLIPSE_SELECTOR);
    }

    function isDateTag(text) {
        const clean = String(text || '').replace(/\s+/g, '').trim();
        return DATE_TAG_REGEX.test(clean);
    }

    function isTargetTag(text) {
        const norm = normalizeForCompare(text);
        return TARGET_TAG_VARIANTS.some(v => norm === v.replace(/\s+/g, ''));
    }

    // Kích hoạt click tối ưu từ 12.x: thử React Props -> pointerdown -> click
    function triggerElementAction(element) {
        if (!element || !element.isConnected) return false;
        // Thử lấy React handler từ các key __reactProps, __reactEventHandlers, __reactFiber
        try {
            const keys = Object.keys(element);
            for (const k of keys) {
                if (k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$') || k.startsWith('__reactFiber$')) {
                    const props = element[k];
                    if (!props) continue;
                    // props trực tiếp có onClick
                    if (typeof props.onClick === 'function') {
                        props.onClick({ preventDefault: () => {}, stopPropagation: () => {}, target: element, currentTarget: element, bubbles: true });
                        return true;
                    }
                    // props.children.props.onClick hoặc memoizedProps
                    const nested = props.memoizedProps || props.pendingProps || props;
                    if (nested && typeof nested.onClick === 'function') {
                        nested.onClick({ preventDefault: () => {}, stopPropagation: () => {}, target: element, currentTarget: element, bubbles: true });
                        return true;
                    }
                }
            }
            // Thử tìm trên parent (nhiều button bọc span)
            let cur = element;
            for (let i = 0; i < 3 && cur; i++) {
                const rk = Object.keys(cur).find(key => key.startsWith('__reactProps$'));
                if (rk && cur[rk] && typeof cur[rk].onClick === 'function') {
                    cur[rk].onClick({ preventDefault: () => {}, stopPropagation: () => {}, target: cur, currentTarget: cur, bubbles: true });
                    return true;
                }
                cur = cur.parentElement;
            }
        } catch (_) {}

        try {
            element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
        try {
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
        try {
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return true;
        } catch (_) {
            return false;
        }
    }

    // =========================================================
    // CORE - TỐI ƯU TỪ 12.x + LOGIC GỐC F4
    // =========================================================
    function executeTagSwapRoutine() {
        const buttons = getAllTagButtons();
        if (!buttons.length) {
            console.warn('[Pancake F4] Không tìm thấy button tag nào.');
            return;
        }

        let dateTagBtn = null;
        let tag24Btn = null;
        let targetTagBtn = null;
        let visibleIndex = 0;

        // 1 lượt quét duy nhất - O(n)
        for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const text = getButtonText(btn);
            const norm = normalizeTagText(text);
            if (!text) continue;

            visibleIndex++;

            // Tìm tag ngày đang được chọn (có .ellipse + regex dd/mm)
            if (!dateTagBtn && hasEllipse(btn) && isDateTag(text)) {
                dateTagBtn = btn;
            }

            // Tìm tag 24 theo thứ tự hiển thị ngoài (visibleIndex === 24)
            if (!tag24Btn && visibleIndex === 24) {
                tag24Btn = btn;
            }

            // Tìm tag "T.Anh chốt" - chuẩn hóa để bắt mọi biến thể
            if (!targetTagBtn && isTargetTag(text)) {
                targetTagBtn = btn;
            }

            // Early exit nếu đủ 3
            if (dateTagBtn && tag24Btn && targetTagBtn) break;
        }

        // Log để debug
        console.info(`[Pancake F4] Quét ${buttons.length} tags | date=${dateTagBtn ? getButtonText(dateTagBtn) : 'không có'} | 24=${tag24Btn ? getButtonText(tag24Btn) : 'không có'} | T.Anh=${targetTagBtn ? getButtonText(targetTagBtn) : 'không có'}`);

        // Chỉ click khi cần - tránh toggle sai:
        // - dateTag: chỉ tắt nếu đang có .ellipse (đang chọn)
        // - tag24: chỉ tắt nếu đang có .ellipse
        // - T.Anh chốt: chỉ bật nếu CHƯA có .ellipse
        let clicked = 0;

        if (dateTagBtn && hasEllipse(dateTagBtn)) {
            console.info(`[Pancake F4] Tắt tag ngày: ${getButtonText(dateTagBtn)}`);
            if (triggerElementAction(dateTagBtn)) clicked++;
        }

        if (tag24Btn && hasEllipse(tag24Btn)) {
            console.info(`[Pancake F4] Tắt tag 24: ${getButtonText(tag24Btn)}`);
            if (triggerElementAction(tag24Btn)) clicked++;
        }

        if (targetTagBtn && !hasEllipse(targetTagBtn)) {
            console.info(`[Pancake F4] Bật tag T.Anh chốt: ${getButtonText(targetTagBtn)}`);
            if (triggerElementAction(targetTagBtn)) clicked++;
        }

        if (clicked === 0) {
            console.info('[Pancake F4] Không cần click - trạng thái tag đã đúng.');
        }
    }

    // =========================================================
    // KEY HANDLER - GIỮ NGUYÊN CAPTURE + STOP IMMEDIATE
    // =========================================================
    window.addEventListener('keydown', (event) => {
        if (event.key === 'F4' || event.keyCode === 115) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            if (event.repeat || isProcessing) return;

            isProcessing = true;
            try {
                // Thực thi tức thì, không await, không delay
                executeTagSwapRoutine();
            } catch (err) {
                console.error('[Pancake F4] Lỗi:', err);
            } finally {
                setTimeout(() => {
                    isProcessing = false;
                }, 100);
            }
        }
    }, true);

    console.info('[Pancake F4 Optimized 4.0] Ready - Bấm F4 để tắt ngày + tắt 24 + bật T.Anh chốt.');
})();
