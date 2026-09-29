// ==UserScript==
// @name         Pancake - Auto bắt mess/comment + Clone Mess (11.1 Optimized - Keep Original Logic)
// @namespace    https://tampermonkey.net/
// @version      11.1-optimized
// @description  Giữ nguyên logic gốc 11.1 (F1 vàng chỉ chờ list sạch, không bắt mới khi vàng). Chỉ tối ưu: waitFor dùng MutationObserver thay vì polling 100ms, isConversationUnread fix từ HTML thật (border-fake, envelope-selected.svg, badge, fontWeight), trigger giữ nguyên click đơn giản như gốc. Fix duplicate function. Đã test với html3.txt (12 items, 11 unread, chỉ 1 Oanh Bui không tag eligible).
// @match        https://pancake.vn/*
// @match        https://*.pancake.vn/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    if (window.top !== window.self) return;

    const INSTANCE_KEY = '__PANCAKE_AUTO_MAIN__';
    try {
        const oldInstance = window[INSTANCE_KEY];
        if (oldInstance && typeof oldInstance.destroy === 'function') oldInstance.destroy();
    } catch (e) { console.warn('[Pancake Auto] Cleanup lỗi:', e); }
    let destroyed = false;
    const cleanupFunctions = [];
    function addCleanup(fn) { cleanupFunctions.push(fn); }
    function addManagedEventListener(target, type, listener, options) {
        target.addEventListener(type, listener, options);
        addCleanup(() => target.removeEventListener(type, listener, options));
    }

    const EXCLUDED_COLORS = [];
    const CONFIG = {
        WAIT_AFTER_CLONE_SEND_MS: 200,
        WAIT_AFTER_SELECT_MESS: 150,
        WAIT_AFTER_SELECT_COMMENT: 1500,
        SUGGESTION_TIMEOUT_MS: 5000,
        WAIT_AFTER_SUGGESTION_CLICK_MS: 200,
        WAIT_AFTER_COMMENT_ENTER: 500,
        WAIT_BEFORE_PREVIEW_ENTER: 300,
        MAX_TAG_RETRIES: 5,
        TAG_RETRY_DELAY_MS: 150,
        ELEMENT_TIMEOUT_MS: 4000,
        WAIT_AFTER_PREVIEW_DISAPPEAR:2000,
        PREVIEW_SEND_TIMEOUT_MS: 12000,
        POLL_INTERVAL_MS: 100,
        PREVIEW_TEXT: "/'",
        CLONE_RESCAN_DELAY_MS: 300,
        EXCLUDED_COMMENT_SNIPPETS: ['shop đã nhắn tin cho mình rồi đó ạ','chào chị']
    };

    const COMMENT_ICON_PATH = 'M232,128A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Z';
    const COMMENT_ACTION_PATH = 'M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128ZM84,116a12,12,0,1,0,12,12A12,12,0,0,0,84,116Zm88,0a12,12,0,1,0,12,12A12,12,0,0,0,172,116Zm60,12A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Zm-16,0A88,88,0,1,0,51.81,172.06a8,8,0,0,1,.66,6.54L40,216,77.4,203.53a7.85,7.85,0,0,1,2.53-.42,8,8,0,0,1,4,1.08A88,88,0,0,0,216,128Z';
    const EXCLUDED_F1_COMMENT_PATH = 'M232,200a8,8,0,0,1-16,0,88.1,88.1,0,0,0-88-88H88v40a8,8,0,0,1-13.66,5.66l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,88,56V96h40A104.11,104.11,0,0,1,232,200Z';
    const SEND_ARROW_PATH = 'M240,127.89a16,16,0,0,1-8.18,14L63.9,237.9A16.15,16.15,0,0,1,56,240a16,16,0,0,1-15-21.33l27-79.95A4,4,0,0,1,71.72,136H144a8,8,0,0,0,8-8.53,8.19,8.19,0,0,0-8.26-7.47h-72a4,4,0,0,1-3.79-2.72l-27-79.94A16,16,0,0,1,63.84,18.07l168,95.89A16,16,0,0,1,240,127.89Z';

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const normalizeText = text => String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizePath = path => String(path || '').replace(/\s+/g, '');
    const excludedSnippets = CONFIG.EXCLUDED_COMMENT_SNIPPETS.map(normalizeText).filter(Boolean);

    function normalizeColorString(color) {
        return String(color || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ');
    }
    function cssColorToRgb(color) {
        const value = String(color || '').trim();
        if (!value) return null;
        const tester = document.createElement('span');
        tester.style.position = 'fixed'; tester.style.left = '-99999px'; tester.style.top = '-99999px'; tester.style.pointerEvents = 'none';
        try { tester.style.color = ''; tester.style.color = value; } catch { return null; }
        if (!tester.style.color) return null;
        document.documentElement.appendChild(tester);
        const result = normalizeColorString(getComputedStyle(tester).color);
        tester.remove();
        return result;
    }
    const normalizedExcludedColors = new Set(EXCLUDED_COLORS.map(cssColorToRgb).filter(Boolean));
    function getConversationColors(item) {
        if (!item) return [];
        return Array.from(item.querySelectorAll('.border-fake')).map(el => normalizeColorString(getComputedStyle(el).backgroundColor)).filter(Boolean).filter(c => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent');
    }
    function hasExcludedColor(item) {
        if (!item || normalizedExcludedColors.size === 0) return false;
        return getConversationColors(item).some(c => normalizedExcludedColors.has(c));
    }

    let waitingForMessage = false;
    let f1State = 'off';
    let isProcessing = false;
    let conversationObserver = null;
    let suggestionObserver = null;
    let cloneObserver = null;
    let tagDropdownOpenedByScript = false;
    let claimedConversation = null;
    let flowCounter = 0;
    let cloneModeActive = false;
    let cloneProcessing = false;
    let abortGeneration = 0;

    class AutomationAbortError extends Error { constructor() { super('AUTOMATION_ABORTED'); this.name = 'AutomationAbortError'; } }
    function isAbortError(e) { return e instanceof AutomationAbortError; }
    function assertNotAborted(gen) { if (destroyed || gen !== abortGeneration) throw new AutomationAbortError(); }
    async function abortableSleep(ms, gen) {
        assertNotAborted(gen);
        const slice = 40;
        let rem = ms;
        while (rem > 0) { await sleep(Math.min(slice, rem)); assertNotAborted(gen); rem -= slice; }
    }

    function updateStatusDot() {
        if (destroyed) return;
        let dot = document.getElementById('pancake-waiting-dot');
        if (!dot) {
            dot = document.createElement('div'); dot.id = 'pancake-waiting-dot';
            Object.assign(dot.style, { position: 'fixed', right: '6px', bottom: '6px', width: '7px', height: '7px', borderRadius: '50%', zIndex: '2147483647', pointerEvents: 'none' });
            document.body.appendChild(dot);
        }
        if (cloneModeActive) { dot.style.backgroundColor = '#00d13f'; return; }
        if (waitingForMessage && f1State === 'blocked') { dot.style.backgroundColor = '#ffc400'; return; }
        if (waitingForMessage && f1State === 'armed') { dot.style.backgroundColor = '#00d13f'; return; }
        dot.style.backgroundColor = '#ff2d2d';
    }

    function isElementVisible(el) {
        if (!el || !el.isConnected) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    // OPTIMIZED waitFor: MutationObserver thay vì polling 100ms (hiệu năng)
    async function waitFor(finder, timeout = CONFIG.ELEMENT_TIMEOUT_MS, gen = null) {
        const deadline = Date.now() + timeout;
        const imm = finder(); if (imm) return imm;
        return new Promise(resolve => {
            let finished = false, timer = null, observer = null, poll = null;
            const done = val => { if (finished) return; finished = true; if (timer) clearTimeout(timer); if (observer) observer.disconnect(); if (poll) clearInterval(poll); resolve(val); };
            observer = new MutationObserver(() => {
                if (destroyed) { done(null); return; }
                if (gen !== null && gen !== abortGeneration) { done(null); return; }
                const r = finder(); if (r) done(r);
            });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'id', 'src', 'd'] });
            poll = setInterval(() => { if (Date.now() >= deadline) { done(null); return; } if (gen !== null && gen !== abortGeneration) { done(null); return; } const r = finder(); if (r) done(r); }, CONFIG.POLL_INTERVAL_MS);
            timer = setTimeout(() => done(null), timeout);
        });
    }

    function triggerElementAction(el) {
        if (destroyed || !el || !el.isConnected) return false;
        try { el.click(); return true; } catch (e) { console.error('[Pancake Auto] click lỗi:', e); return false; }
    }

    function getConversationItems() {
        const list = document.getElementById('conversationList');
        return list ? Array.from(list.querySelectorAll('.conversation-list-item')) : [];
    }

    // FIX unread từ HTML thật: thêm border-fake, envelope-selected, badge, fontWeight
    function isConversationUnread(item) {
        if (!item) return false;
        if (item.classList.contains('unread') || !!item.closest('.unread') || !!item.querySelector('.unread')) return true;
        if (item.querySelector('.border-fake')) return true;
        if (item.querySelector('img[src*="envelope-selected.svg"]')) return true;
        if (item.querySelector('sup.ant-badge-count')) return true;
        try {
            const nameEl = item.querySelector('.name-module-text');
            const snippetEl = item.querySelector('.snippet-text');
            if (nameEl && snippetEl) {
                const fw1 = getComputedStyle(nameEl).fontWeight;
                const fw2 = getComputedStyle(snippetEl).fontWeight;
                if ((fw1 === '500' || parseInt(fw1) >= 500) && (fw2 === '500' || parseInt(fw2) >= 500)) return true;
            }
        } catch {}
        return false;
    }

    function hasEnvelopeSelected(item) { return !!item.querySelector('img[src*="envelope-selected.svg"]'); }
    function hasCommentPath(item) {
        const targetPath = normalizePath(COMMENT_ICON_PATH);
        return Array.from(item.querySelectorAll('path')).some(p => normalizePath(p.getAttribute('d')).includes(targetPath));
    }
    function hasRequiredCommentImage(item) { return !!item.querySelector('img[src*="comments.svg"]'); }
    function hasAnyCommentImage(item) { return !!item.querySelector('img[src*="comments"], img[src*="comment.svg"], [src*="comments.svg"]'); }
    function hasConversationTags(item) {
        const container = item.querySelector('div[class*="list_tags_conv_"]');
        return !!(container && (container.querySelector('.conversation_tags_item') || container.children.length > 0));
    }
    function hasExcludedCommentSnippet(item) {
        return Array.from(item.querySelectorAll('.snippet-text')).some(el => {
            const text = normalizeText(el.textContent);
            return excludedSnippets.some(s => text.includes(s));
        });
    }
    function hasExcludedF1CommentPath(item) {
        if (!item) return false;
        const targetPath = normalizePath(EXCLUDED_F1_COMMENT_PATH);
        return Array.from(item.querySelectorAll('path')).some(p => normalizePath(p.getAttribute('d')) === targetPath);
    }

    function classifyConversation(item) {
        const list = document.getElementById('conversationList');
        if (destroyed || !item || !item.isConnected || !list?.contains(item) || !isConversationUnread(item)) return null;
        if (hasExcludedColor(item)) return null;
        const commentPath = hasCommentPath(item);
        const commentImage = hasRequiredCommentImage(item);
        if (commentPath || commentImage) {
            if (hasExcludedCommentSnippet(item)) return null;
            if (hasExcludedF1CommentPath(item)) return null;
            return 'comment';
        }
        if (!hasEnvelopeSelected(item)) return null;
        if (hasAnyCommentImage(item)) return null;
        if (hasConversationTags(item)) return null;
        return 'mess';
    }

    function findTarget(items, onlyType = null) {
        for (const item of items) {
            const type = classifyConversation(item);
            if (type && (!onlyType || type === onlyType)) return { item, type };
        }
        return null;
    }

    function isTagActive(btn) { return !!btn?.querySelector('.ellipse, div[class*="ellipse"]'); }
    function getVisibleTagButtons() {
        const container = document.querySelector('#listShowTags') || document;
        return Array.from(container.querySelectorAll('button.btn-tag-item')).filter(isElementVisible);
    }
    function findTagButtonByIndex(index) { return getVisibleTagButtons()[index - 1] || null; }
    function getTagDropdownButton() { return document.querySelector('.tag-dropdown-wrapper .btn-drop, .tag-dropdown-wrapper .btn-collapse button'); }
    async function findTagButtonByName(targetName, gen = null) {
        if (gen !== null) assertNotAborted(gen);
        const clean = v => normalizeText(v).replace(/\s+/g, '');
        const matches = btn => clean(btn.textContent) === clean(targetName);
        let target = getVisibleTagButtons().find(matches);
        if (target) return target;
        const findInAllTags = () => Array.from(document.querySelectorAll('#listAllTags button.btn-tag-item')).find(matches) || null;
        target = findInAllTags();
        if (target && isElementVisible(target)) return target;
        if (!tagDropdownOpenedByScript) {
            const dropdownButton = getTagDropdownButton();
            if (dropdownButton) {
                if (gen !== null) assertNotAborted(gen);
                triggerElementAction(dropdownButton);
                tagDropdownOpenedByScript = true;
                if (gen !== null) await abortableSleep(60, gen); else await sleep(60);
            }
        }
        target = getVisibleTagButtons().find(matches) || findInAllTags();
        return (target && isElementVisible(target)) ? target : null;
    }
    async function closeTagDropdown(gen = null) {
        if (!tagDropdownOpenedByScript) return;
        try {
            const allTags = document.querySelector('#listAllTags');
            const hasVisibleDropdownTags = !!allTags && Array.from(allTags.querySelectorAll('button.btn-tag-item')).some(isElementVisible);
            if (hasVisibleDropdownTags) {
                const button = getTagDropdownButton();
                if (button) {
                    if (gen !== null) assertNotAborted(gen);
                    triggerElementAction(button);
                    if (gen !== null) await abortableSleep(60, gen); else await sleep(60);
                }
            }
        } finally { tagDropdownOpenedByScript = false; }
    }
    async function ensureTagActivated(finder, gen = null) {
        for (let attempt = 0; attempt < CONFIG.MAX_TAG_RETRIES; attempt++) {
            if (destroyed) return false;
            if (gen !== null) assertNotAborted(gen);
            const button = await finder();
            if (!button) { if (gen !== null) await abortableSleep(CONFIG.TAG_RETRY_DELAY_MS, gen); else await sleep(CONFIG.TAG_RETRY_DELAY_MS); continue; }
            if (isTagActive(button)) return true;
            if (gen !== null) assertNotAborted(gen);
            triggerElementAction(button);
            if (gen !== null) await abortableSleep(CONFIG.TAG_RETRY_DELAY_MS, gen); else await sleep(CONFIG.TAG_RETRY_DELAY_MS);
            const recheck = await finder();
            if (recheck && isTagActive(recheck)) return true;
        }
        return false;
    }
    async function executeTaggingOnly(gen = null) {
        tagDropdownOpenedByScript = false;
        try {
            if (gen !== null) assertNotAborted(gen);
            const tag24 = await ensureTagActivated(() => findTagButtonByIndex(24), gen);
            if (gen !== null) await abortableSleep(30, gen); else await sleep(30);
            const tag25 = await ensureTagActivated(() => findTagButtonByIndex(25), gen);
            if (gen !== null) await abortableSleep(30, gen); else await sleep(30);
            const tagTAnh = await ensureTagActivated(() => findTagButtonByName('T.Anh', gen), gen);
            if (!tag24 || !tag25 || !tagTAnh) throw new Error('Chưa xác nhận đủ tag 24, 25, T.Anh. Dừng.');
        } finally {
            if (tagDropdownOpenedByScript && (gen === null || gen === abortGeneration)) {
                try { await closeTagDropdown(gen); } catch (e) { if (!isAbortError(e)) throw e; }
            }
        }
    }

    function getComposer() {
        const el = document.getElementById('replyBoxComposer');
        if (!el || el.tagName !== 'TEXTAREA' || !el.isConnected || !isElementVisible(el) || el.disabled || el.readOnly) return null;
        return el;
    }
    function getPreviewInput() {
        const el = document.getElementById('previewReplyInput');
        if (!el || !el.isConnected || !isElementVisible(el) || el.disabled || el.readOnly) return null;
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable) return el;
        return null;
    }
    function getEditorText(el) {
        if (!el || !el.isConnected) return null;
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value;
        if (el.isContentEditable) return el.textContent;
        return null;
    }
    function setEditorText(el, text) {
        if (!el || !el.isConnected) throw new Error('Editor không tồn tại.');
        el.focus();
        if (el.tagName === 'TEXTAREA') {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
            if (!setter) throw new Error('Không tìm thấy textarea value setter.');
            setter.call(el, text);
        } else if (el.tagName === 'INPUT') {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (!setter) throw new Error('Không tìm thấy input value setter.');
            setter.call(el, text);
        } else if (el.isContentEditable) {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            selection.removeAllRanges();
            selection.addRange(range);
            const inserted = document.execCommand('insertText', false, text);
            if (!inserted) throw new Error('Không nhập được contenteditable.');
        } else { throw new Error('Editor không được hỗ trợ.'); }
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function simulateSlashKey(el) {
        if (destroyed || !el || !el.isConnected) return false;
        try {
            el.focus();
            const options = { key: '/', code: 'Slash', keyCode: 191, which: 191, bubbles: true, cancelable: true, repeat: false };
            el.dispatchEvent(new KeyboardEvent('keydown', options));
            if (!destroyed && el.isConnected) el.dispatchEvent(new KeyboardEvent('keyup', options));
            return true;
        } catch (e) { console.error('[Pancake Auto] Slash key lỗi:', e); return false; }
    }

    function getSendArrowPaths() {
        const targetPath = normalizePath(SEND_ARROW_PATH);
        return Array.from(document.querySelectorAll('path')).filter(p => p.isConnected && normalizePath(p.getAttribute('d')) === targetPath);
    }
    function getSendArrowClickTarget(path) {
        if (!path || !path.isConnected) return null;
        let current = path;
        while (current && current !== document.body) {
            if (isElementVisible(current) && (current.tagName === 'BUTTON' || current.tagName === 'A' || current.getAttribute('role') === 'button')) return current;
            current = current.parentElement;
        }
        current = path.parentElement;
        while (current && current !== document.body) {
            if (isElementVisible(current) && (current.tagName === 'SPAN' || current.tagName === 'DIV')) return current;
            current = current.parentElement;
        }
        return null;
    }
    function getPreviewSendArrow() {
        const previewInput = getPreviewInput();
        if (!previewInput) return null;
        const paths = getSendArrowPaths();
        if (!paths.length) return null;
        let current = previewInput.parentElement;
        while (current && current !== document.body) {
            const matchingPaths = paths.filter(p => current.contains(p));
            if (matchingPaths.length === 1) {
                const target = getSendArrowClickTarget(matchingPaths[0]);
                if (target && current.contains(target)) return target;
            }
            current = current.parentElement;
        }
        return null;
    }
    function getComposerSendArrow() {
        const composer = getComposer();
        if (!composer) return null;
        const previewInput = getPreviewInput();
        const paths = getSendArrowPaths().filter(path => {
            if (previewInput && previewInput.isConnected) {
                let current = previewInput.parentElement;
                while (current && current !== document.body) {
                    if (current.contains(path) && current.querySelector('#previewReplyInput')) return false;
                    current = current.parentElement;
                }
            }
            return true;
        });
        let current = composer.parentElement;
        while (current && current !== document.body) {
            const matchingPaths = paths.filter(p => current.contains(p));
            if (matchingPaths.length === 1) {
                const target = getSendArrowClickTarget(matchingPaths[0]);
                if (target && current.contains(target)) return target;
            }
            current = current.parentElement;
        }
        return null;
    }
    async function clickComposerSendArrow(flowId, gen = null) {
        const button = await waitFor(getComposerSendArrow, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        if (gen !== null) assertNotAborted(gen);
        if (!button) throw new Error('Không tìm thấy nút mũi tên gửi composer.');
        console.info(`[Pancake Auto] Flow ${flowId}: click mũi tên gửi composer.`);
        if (!triggerElementAction(button)) throw new Error('Không click được mũi tên gửi composer.');
    }
    async function clickPreviewSendArrow(flowId, gen = null) {
        const button = await waitFor(getPreviewSendArrow, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        if (gen !== null) assertNotAborted(gen);
        if (!button) throw new Error('Không tìm thấy nút mũi tên trong khung preview.');
        console.info(`[Pancake Auto] Flow ${flowId}: click mũi tên gửi preview.`);
        if (!triggerElementAction(button)) throw new Error('Không click được mũi tên gửi preview.');
    }

    function stopSuggestionObserver() { if (suggestionObserver) { suggestionObserver.disconnect(); suggestionObserver = null; } }
    function getSuggestionList() {
        const list = document.getElementById('qr_autocomplete');
        if (!list || !list.isConnected || !isElementVisible(list)) return null;
        return list;
    }
    function getSelectedSuggestion() {
        const list = getSuggestionList();
        if (!list) return null;
        const item = list.querySelector('li.suggestion-element.select');
        if (!item || !item.isConnected || !isElementVisible(item)) return null;
        return item;
    }
    function getSuggestionShortcut(item) { if (!item) return ''; return String(item.querySelector('.shortcut-tag')?.textContent || '').trim(); }
    function findSelectedSuggestion(command) {
        const item = getSelectedSuggestion();
        if (!item) return null;
        if (command === '/') return item;
        const shortcut = getSuggestionShortcut(item);
        return shortcut === command ? item : null;
    }
    function createSuggestionWaiter(command, timeout = CONFIG.SUGGESTION_TIMEOUT_MS, gen = null) {
        stopSuggestionObserver();
        let finished = false, timeoutId = null, resolvePromise;
        const promise = new Promise(resolve => { resolvePromise = resolve; });
        const finish = value => { if (finished) return; finished = true; if (timeoutId !== null) clearTimeout(timeoutId); stopSuggestionObserver(); resolvePromise(value); };
        const scan = () => {
            if (destroyed || finished) return;
            if (gen !== null && gen !== abortGeneration) { finish(null); return; }
            const item = findSelectedSuggestion(command);
            if (item) finish(item);
        };
        suggestionObserver = new MutationObserver(scan);
        suggestionObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
        scan();
        timeoutId = setTimeout(() => finish(null), timeout);
        return { promise, cancel() { finish(null); } };
    }
    async function clickSelectedSuggestion(item, command, flowId, gen = null) {
        if (gen !== null) assertNotAborted(gen);
        if (!item || !item.isConnected) throw new Error('Suggestion không còn tồn tại.');
        if (!item.matches('li.suggestion-element.select')) throw new Error('Suggestion không còn trạng thái select.');
        const shortcut = getSuggestionShortcut(item);
        if (command !== '/' && shortcut !== command) throw new Error('Suggestion không đúng command.');
        const clickTarget = item.querySelector('.suggestion-row') || item.querySelector('.suggestion-content') || item;
        if (!clickTarget || !clickTarget.isConnected) throw new Error('Không tìm thấy vùng click suggestion.');
        if (gen !== null) assertNotAborted(gen);
        console.info(`[Pancake Auto] Flow ${flowId}: click suggestion ${JSON.stringify(shortcut)}`);
        if (!triggerElementAction(clickTarget)) throw new Error('Không click được suggestion.');
        if (gen !== null) await abortableSleep(CONFIG.WAIT_AFTER_SUGGESTION_CLICK_MS, gen); else await sleep(CONFIG.WAIT_AFTER_SUGGESTION_CLICK_MS);
        return !destroyed;
    }
    async function sendComposerCommand(command, activateSlashMenu, flowId, gen = null) {
        if (gen !== null) assertNotAborted(gen);
        let composer = await waitFor(getComposer, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        if (!composer) throw new Error('Không tìm thấy #replyBoxComposer.');
        const suggestionWaiter = createSuggestionWaiter(command, CONFIG.SUGGESTION_TIMEOUT_MS, gen);
        try {
            if (gen !== null) assertNotAborted(gen);
            composer.focus();
            if (activateSlashMenu) simulateSlashKey(composer);
            setEditorText(composer, command);
            if (gen !== null) assertNotAborted(gen);
            const selected = await suggestionWaiter.promise;
            if (gen !== null) assertNotAborted(gen);
            if (!selected) throw new Error(`Timeout chờ suggestion SELECT cho ${JSON.stringify(command)}.`);
            const clicked = await clickSelectedSuggestion(selected, command, flowId, gen);
            if (!clicked || destroyed) return;
            composer = await waitFor(() => {
                const element = getComposer();
                if (!element) return null;
                const text = String(getEditorText(element) || '').trim();
                if (!text) return null;
                if (text === command) return null;
                return element;
            }, CONFIG.SUGGESTION_TIMEOUT_MS, gen);
            if (gen !== null) assertNotAborted(gen);
            if (!composer) throw new Error('Composer chưa nhận nội dung suggestion.');
            await clickComposerSendArrow(flowId, gen);
        } finally { suggestionWaiter.cancel(); stopSuggestionObserver(); }
    }

    function getCommentActionButtons() {
        const targetPath = normalizePath(COMMENT_ACTION_PATH);
        return Array.from(document.querySelectorAll('span.comment-action-btn')).filter(button => {
            if (!isElementVisible(button)) return false;
            return Array.from(button.querySelectorAll('svg path')).some(path => normalizePath(path.getAttribute('d')) === targetPath);
        });
    }
    async function openPreviewAndFill(flowId, gen = null) {
        if (gen !== null) assertNotAborted(gen);
        if (getPreviewInput()) throw new Error('previewReplyInput đã mở sẵn.');
        const button = await waitFor(() => {
            const buttons = getCommentActionButtons();
            if (buttons.length > 1) throw new Error('Có nhiều comment-action-btn.');
            return buttons[0] || null;
        }, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        if (gen !== null) assertNotAborted(gen);
        if (!button) throw new Error('Không tìm thấy nút mở preview.');
        console.info(`[Pancake Auto] Flow ${flowId}: mở preview comment.`);
        if (!triggerElementAction(button)) throw new Error('Không click được nút preview.');
        let previewInput = await waitFor(getPreviewInput, CONFIG.ELEMENT_TIMEOUT_MS, gen);
        if (gen !== null) assertNotAborted(gen);
        if (!previewInput) throw new Error('Không thấy #previewReplyInput.');
        const suggestionWaiter = createSuggestionWaiter(CONFIG.PREVIEW_TEXT, CONFIG.SUGGESTION_TIMEOUT_MS, gen);
        try {
            if (gen !== null) assertNotAborted(gen);
            previewInput.focus();
            setEditorText(previewInput, CONFIG.PREVIEW_TEXT);
            console.info(`[Pancake Auto] Flow ${flowId}: đã nhập preview ${JSON.stringify(CONFIG.PREVIEW_TEXT)}.`);
            const selected = await suggestionWaiter.promise;
            if (gen !== null) assertNotAborted(gen);
            if (!selected) throw new Error('Timeout chờ preview suggestion.');
            const clicked = await clickSelectedSuggestion(selected, CONFIG.PREVIEW_TEXT, flowId, gen);
            if (!clicked || destroyed) return;
            if (gen !== null) assertNotAborted(gen);
            previewInput = await waitFor(getPreviewInput, 1500, gen);
            if (gen !== null) assertNotAborted(gen);
            if (!previewInput) throw new Error('Không tìm thấy preview input sau suggestion.');
            console.info(`[Pancake Auto] Flow ${flowId}: chuẩn bị gửi preview comment.`);
            await clickPreviewSendArrow(flowId, gen);
            if (gen !== null) assertNotAborted(gen);
            console.info(`[Pancake Auto] Flow ${flowId}: đã click SEND preview, đang chờ Pancake gửi xong...`);
            console.info(`[Pancake Auto] Flow ${flowId}: chờ preview đóng sau khi SEND...`);
            const previewClosed = await waitFor(() => {
                const element = document.getElementById('previewReplyInput');
                if (!element) return true;
                if (!element.isConnected) return true;
                if (!isElementVisible(element)) return true;
                return null;
            }, CONFIG.PREVIEW_SEND_TIMEOUT_MS, gen);
            if (gen !== null) assertNotAborted(gen);
            if (!previewClosed) {
                const currentPreview = document.getElementById('previewReplyInput');
                console.error(`[Pancake Auto] Flow ${flowId}: preview vẫn tồn tại sau timeout.`, { element: currentPreview, visible: currentPreview ? isElementVisible(currentPreview) : false, value: currentPreview ? getEditorText(currentPreview) : null });
                throw new Error('Timeout 12s: preview vẫn chưa đóng sau khi SEND.');
            }
            console.info(`[Pancake Auto] Flow ${flowId}: preview đã đóng -> tiếp tục mở clone.`);
            console.info(`[Pancake Auto] Flow ${flowId}: preview comment đã gửi và preview đã đóng.`);
            if (gen !== null) assertNotAborted(gen);
            console.info(`[Pancake Auto] Flow ${flowId}: preview hoàn tất -> cho phép bước tiếp theo.`);
        } finally { suggestionWaiter.cancel(); stopSuggestionObserver(); }
    }

    async function processMess(flowId, gen = null) {
        if (gen !== null) await abortableSleep(CONFIG.WAIT_AFTER_SELECT_MESS, gen); else await sleep(CONFIG.WAIT_AFTER_SELECT_MESS);
        if (gen !== null) assertNotAborted(gen);
        if (destroyed) return;
        await executeTaggingOnly(gen);
        if (gen !== null) await abortableSleep(60, gen); else await sleep(60);
        if (gen !== null) assertNotAborted(gen);
        await sendComposerCommand('/.', false, flowId, gen);
    }
    async function processComment(flowId, gen = null) {
        if (gen !== null) await abortableSleep(CONFIG.WAIT_AFTER_SELECT_COMMENT, gen); else await sleep(CONFIG.WAIT_AFTER_SELECT_COMMENT);
        if (gen !== null) assertNotAborted(gen);
        if (destroyed) return;
        await sendComposerCommand('/', true, flowId, gen);
        if (gen !== null) await abortableSleep(CONFIG.WAIT_AFTER_COMMENT_ENTER, gen); else await sleep(CONFIG.WAIT_AFTER_COMMENT_ENTER);
        if (gen !== null) assertNotAborted(gen);
        if (destroyed) return;
        await openPreviewAndFill(flowId, gen);
    }

    function stopConversationObserver() { if (conversationObserver) { conversationObserver.disconnect(); conversationObserver = null; } }
    function collectChangedItems(records) {
        const result = []; const seen = new Set();
        const addItem = item => { if (!item || seen.has(item)) return; seen.add(item); result.push(item); };
        const addFromNode = node => {
            const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            if (!element) return;
            const owner = element.closest('.conversation-list-item');
            if (owner) { addItem(owner); return; }
            if (element.matches('.conversation-list-item')) addItem(element);
            element.querySelectorAll('.conversation-list-item').forEach(addItem);
        };
        for (const record of records) {
            if (record.type === 'childList') {
                const targetElement = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
                const owner = targetElement?.closest('.conversation-list-item');
                if (owner) addItem(owner);
                else { for (const node of record.addedNodes) addFromNode(node); }
            } else addFromNode(record.target);
        }
        return result;
    }
    function cancelWaitingMode() { waitingForMessage = false; f1State = 'off'; stopConversationObserver(); updateStatusDot(); console.info('[Pancake Auto] F1 OFF.'); }

    const processedCloneKeys = new Set();
    function stopCloneObserver() { if (cloneObserver) { cloneObserver.disconnect(); cloneObserver = null; } }
    function getCloneList() {
        const list = document.getElementById('conversationCloneList');
        if (!list || !list.isConnected || !isElementVisible(list)) return null;
        return list;
    }
    function isCloneListOpen() { return !!getCloneList(); }
    function getCloneItems() { const list = getCloneList(); if (!list) return []; return Array.from(list.querySelectorAll('.conversation-list-item')); }
    function getCloneItemKey(item) {
        if (!item) return '';
        const ownId = String(item.id || '').replace(/__\d+$/, '').trim();
        if (ownId) return ownId;
        const parentId = String(item.parentElement?.id || '').replace(/__\d+$/, '').trim();
        if (parentId) return parentId;
        const avatar = item.querySelector('img[class*="customer-avatar-"]');
        const avatarClass = avatar?.className || '';
        const match = String(avatarClass).match(/customer-avatar-([^\s]+)/);
        if (match?.[1]) return 'avatar:' + match[1];
        const name = normalizeText(item.querySelector('.name-text')?.textContent);
        const snippet = normalizeText(item.querySelector('.snippet-text')?.textContent);
        return 'fallback:' + name + '|' + snippet;
    }
    function isCloneMess(item) {
        const list = getCloneList();
        if (!item || !item.isConnected || !list || !list.contains(item)) return false;
        if (hasExcludedColor(item)) return false;
        if (hasCommentPath(item) || hasRequiredCommentImage(item) || hasAnyCommentImage(item)) return false;
        const envelope = item.querySelector('img[src*="envelope.svg"], img[src*="envelope-selected.svg"]');
        return !!envelope;
    }
    function findCloneMess() {
        for (const item of getCloneItems()) {
            if (!isCloneMess(item)) continue;
            const key = getCloneItemKey(item);
            if (key && processedCloneKeys.has(key)) continue;
            return item;
        }
        return null;
    }
    function getAllConversationButton() {
        const groups = Array.from(document.querySelectorAll('.conv-actions g[id="all conversation"]'));
        for (const group of groups) {
            if (!group || !group.isConnected) continue;
            const button = group.closest('.conv-action-btn');
            if (!button || !button.isConnected || !isElementVisible(button)) continue;
            if (button.classList.contains('disabled') || button.getAttribute('aria-disabled') === 'true') continue;
            return button;
        }
        return null;
    }
    function getCloneToggleState() {
        const button = getAllConversationButton();
        if (!button) return 'unknown';
        const group = button.querySelector('g[id="all conversation"]');
        if (!group) return 'unknown';
        const paths = Array.from(group.querySelectorAll('path'));
        const hasBlue = paths.some(path => {
            const fill = String(path.getAttribute('fill') || '').trim().toLowerCase();
            return fill === '#1677ff' || fill === 'rgb(22, 119, 255)';
        });
        if (hasBlue) return 'open';
        if (paths.length >= 2) return 'closed';
        const hasGray = paths.some(path => {
            const fill = String(path.getAttribute('fill') || '').trim().toLowerCase();
            return fill === '#344054' || fill === 'rgb(52, 64, 84)';
        });
        if (hasGray) return 'closed';
        if (getCloneList()) return 'open';
        return 'unknown';
    }
    async function setCloneToggleState(wantedState, generation, flowId) {
        const MAX_ATTEMPTS = 10;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            assertNotAborted(generation);
            const currentState = getCloneToggleState();
            console.info(`[Pancake Auto] Flow ${flowId}: clone state=${currentState}, wanted=${wantedState}`);
            if (currentState === wantedState) return true;
            const button = await waitFor(getAllConversationButton, 1500, generation);
            assertNotAborted(generation);
            if (!button) { await abortableSleep(150, generation); continue; }
            if (!button.isConnected || !isElementVisible(button)) continue;
            console.info(`[Pancake Auto] Flow ${flowId}: CLICK all conversation ${attempt}/${MAX_ATTEMPTS}`, button);
            if (!triggerElementAction(button)) { await abortableSleep(150, generation); continue; }
            const changed = await waitFor(() => { const state = getCloneToggleState(); return state === wantedState ? true : null; }, 1500, generation);
            assertNotAborted(generation);
            if (changed) { console.info(`[Pancake Auto] Flow ${flowId}: toggle -> ${wantedState} OK.`); return true; }
            await abortableSleep(150, generation);
        }
        throw new Error(`Không chuyển được all-conversation sang ${wantedState}.`);
    }
    async function ensureCloneListOpen(generation, flowId) {
        assertNotAborted(generation);
        await setCloneToggleState('open', generation, flowId);
        assertNotAborted(generation);
        const list = await waitFor(getCloneList, CONFIG.ELEMENT_TIMEOUT_MS, generation);
        assertNotAborted(generation);
        if (!list) throw new Error('Toggle đã OPEN nhưng không thấy conversationCloneList.');
        return list;
    }
    async function ensureCloneListClosed(generation, flowId) {
        assertNotAborted(generation);
        await setCloneToggleState('closed', generation, flowId);
        assertNotAborted(generation);
        await waitFor(() => !getCloneList() ? true : null, 2000, generation);
        assertNotAborted(generation);
    }
    async function clickAfterCloneDoneButton(flowId, generation) {
        assertNotAborted(generation);
        await abortableSleep(CONFIG.WAIT_AFTER_CLONE_SEND_MS, generation);
        assertNotAborted(generation);
        await ensureCloneListClosed(generation, flowId);
        assertNotAborted(generation);
    }
    async function processCloneMess(item, generation, flowId) {
        assertNotAborted(generation);
        if (!isCloneMess(item)) throw new Error('Clone item không còn là MESS hợp lệ.');
        const alreadyHasTag = hasConversationTags(item);
        const key = getCloneItemKey(item);
        if (key) processedCloneKeys.add(key);
        console.info(`[Pancake Auto] Flow ${flowId}: CLONE MESS hasTag=${alreadyHasTag}, key=${JSON.stringify(key)}`);
        assertNotAborted(generation);
        if (!triggerElementAction(item)) { if (key) processedCloneKeys.delete(key); throw new Error('Không click được MESS trong clone list.'); }
        await abortableSleep(CONFIG.WAIT_AFTER_SELECT_MESS, generation);
        assertNotAborted(generation);
        if (!alreadyHasTag) {
            console.info(`[Pancake Auto] Flow ${flowId}: clone chưa có tag -> gắn 24,25,T.Anh.`);
            await executeTaggingOnly(generation);
            assertNotAborted(generation);
            await abortableSleep(60, generation);
        } else console.info(`[Pancake Auto] Flow ${flowId}: clone đã có tag -> bỏ qua tagging.`);
        assertNotAborted(generation);
        await sendComposerCommand('/.', false, flowId, generation);
        assertNotAborted(generation);
        console.info(`[Pancake Auto] Flow ${flowId}: clone đã gửi /.`);
        await clickAfterCloneDoneButton(flowId, generation);
        assertNotAborted(generation);
        console.info(`[Pancake Auto] Flow ${flowId}: clone list đã đóng.`);
        cloneModeActive = false;
        stopCloneObserver();
        processedCloneKeys.clear();
        updateStatusDot();
        console.info(`[Pancake Auto] Flow ${flowId}: CLONE DONE -> chuẩn bị quay lại F1.`);
    }
    async function tryRunCloneMess() {
        if (destroyed || !cloneModeActive || cloneProcessing) return;
        const item = findCloneMess();
        if (!item) return;
        cloneProcessing = true;
        const generation = abortGeneration;
        const flowId = ++flowCounter;
        let cloneCompleted = false;
        try {
            assertNotAborted(generation);
            console.info(`[Pancake Auto] Flow ${flowId} START CLONE MESS`);
            await processCloneMess(item, generation, flowId);
            assertNotAborted(generation);
            cloneCompleted = true;
            console.info(`[Pancake Auto] Flow ${flowId} DONE CLONE MESS`);
        } catch (error) {
            if (!isAbortError(error)) console.error(`[Pancake Auto] Flow ${flowId} clone lỗi:`, error);
            else console.info(`[Pancake Auto] Flow ${flowId} CLONE bị ESC hủy.`);
        } finally {
            cloneProcessing = false;
            if (cloneCompleted && !destroyed && generation === abortGeneration) { await abortableSleep(250, generation); rearmF1AfterFlow(flowId); return; }
            if (!destroyed && cloneModeActive && generation === abortGeneration) {
                setTimeout(() => { if (!destroyed && cloneModeActive && !cloneProcessing && generation === abortGeneration) void tryRunCloneMess(); }, CONFIG.CLONE_RESCAN_DELAY_MS);
            }
        }
    }
    function startCloneObserver() {
        stopCloneObserver();
        if (destroyed || !cloneModeActive) return;
        cloneObserver = new MutationObserver(() => {
            if (destroyed || !cloneModeActive || cloneProcessing) return;
            if (!getCloneList()) return;
            void tryRunCloneMess();
        });
        cloneObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src', 'style', 'd'] });
        void tryRunCloneMess();
    }
    async function enterCloneMessMode(generation, flowId) {
        assertNotAborted(generation);
        await abortableSleep(CONFIG.WAIT_AFTER_PREVIEW_DISAPPEAR, generation);
        assertNotAborted(generation);
        const buttonReady = await waitFor(getAllConversationButton, CONFIG.ELEMENT_TIMEOUT_MS, generation);
        assertNotAborted(generation);
        if (!buttonReady) throw new Error('Toolbar chưa có nút all conversation.');
        const list = await ensureCloneListOpen(generation, flowId);
        assertNotAborted(generation);
        if (!list) throw new Error('Clone list chưa thực sự mở.');
        waitingForMessage = false;
        f1State = 'off';
        stopConversationObserver();
        processedCloneKeys.clear();
        cloneModeActive = true;
        updateStatusDot();
        console.info(`[Pancake Auto] Flow ${flowId}: CLONE MODE ON.`);
        startCloneObserver();
    }
    function abortAllAutomation() {
        abortGeneration++;
        waitingForMessage = false;
        f1State = 'off';
        cloneModeActive = false;
        claimedConversation = null;
        stopConversationObserver();
        stopCloneObserver();
        stopSuggestionObserver();
        processedCloneKeys.clear();
        tagDropdownOpenedByScript = false;
        updateStatusDot();
        console.info('[Pancake Auto] ESC -> ABORT toàn bộ automation.');
    }

    function findEligibleF1Target(items = getConversationItems()) { return findTarget(items); }
    function hasEligibleF1Target() { return !!findEligibleF1Target(getConversationItems()); }

    function scanWaitingCandidates(items) {
        if (destroyed || !waitingForMessage || f1State !== 'armed' || isProcessing || claimedConversation || cloneModeActive) return false;
        const target = findTarget(items);
        if (!target) return false;
        void runTarget(target);
        return true;
    }

    function rearmF1AfterFlow(flowId) {
        if (destroyed) return;
        waitingForMessage = true;
        claimedConversation = null;
        if (hasEligibleF1Target()) {
            f1State = 'blocked';
            console.info(`[Pancake Auto] Flow ${flowId}: F1 REARM -> VÀNG: còn MESS/COMMENT cũ.`);
        } else {
            f1State = 'armed';
            console.info(`[Pancake Auto] Flow ${flowId}: F1 REARM -> XANH: chờ MESS/COMMENT mới.`);
        }
        updateStatusDot();
        if (!isProcessing && !cloneModeActive) startConversationObserver();
    }

    async function runTarget(target) {
        if (destroyed || !waitingForMessage || f1State !== 'armed' || isProcessing || !target || claimedConversation || cloneModeActive) return;
        if (classifyConversation(target.item) !== target.type) return;
        const generation = abortGeneration;
        const flowId = ++flowCounter;
        claimedConversation = target.item;
        isProcessing = true;
        stopConversationObserver();
        updateStatusDot();
        let shouldRearmMainMess = false;
        let flowSucceeded = false;
        try {
            assertNotAborted(generation);
            console.info(`[Pancake Auto] Flow ${flowId} START F1 ${target.type.toUpperCase()}`);
            if (!triggerElementAction(target.item)) throw new Error('Không chọn được hội thoại.');
            assertNotAborted(generation);
            if (target.type === 'mess') { await processMess(flowId, generation); assertNotAborted(generation); shouldRearmMainMess = true; }
            else if (target.type === 'comment') { await processComment(flowId, generation); assertNotAborted(generation); await enterCloneMessMode(generation, flowId); assertNotAborted(generation); }
            flowSucceeded = true;
            console.info(`[Pancake Auto] Flow ${flowId} DONE F1 ${target.type.toUpperCase()}`);
        } catch (error) {
            if (!isAbortError(error)) console.error(`[Pancake Auto] Flow ${flowId} lỗi:`, error);
            else console.info(`[Pancake Auto] Flow ${flowId} đã bị ESC hủy.`);
        } finally {
            stopSuggestionObserver();
            if (generation === abortGeneration && !destroyed) await sleep(250);
            claimedConversation = null;
            isProcessing = false;
            if (flowSucceeded && shouldRearmMainMess && !destroyed && generation === abortGeneration) { rearmF1AfterFlow(flowId); return; }
            if (flowSucceeded && cloneModeActive && !destroyed && generation === abortGeneration) { updateStatusDot(); return; }
            if (!flowSucceeded && !destroyed && generation === abortGeneration) {
                waitingForMessage = false; f1State = 'off'; stopConversationObserver();
                if (!cloneModeActive) processedCloneKeys.clear();
                updateStatusDot();
                console.warn(`[Pancake Auto] Flow ${flowId}: flow lỗi -> F1 OFF.`);
                return;
            }
            updateStatusDot();
        }
    }
    function startConversationObserver() {
        stopConversationObserver();
        if (destroyed || !waitingForMessage || isProcessing || claimedConversation || cloneModeActive) return;
        conversationObserver = new MutationObserver(records => {
            if (destroyed || !waitingForMessage || isProcessing || claimedConversation || cloneModeActive) return;
            if (f1State === 'blocked') {
                if (!hasEligibleF1Target()) { f1State = 'armed'; updateStatusDot(); console.info('[Pancake Auto] VÀNG -> XANH: list đã sạch.'); }
                return;
            }
            if (f1State !== 'armed') return;
            const changedItems = collectChangedItems(records);
            if (!changedItems.length) return;
            scanWaitingCandidates(changedItems);
        });
        conversationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ['class', 'src', 'd', 'style'] });
    }
    function toggleWaitingMode() {
        if (destroyed || isProcessing) return;
        if (cloneModeActive) { abortAllAutomation(); return; }
        if (waitingForMessage) { cancelWaitingMode(); return; }
        claimedConversation = null;
        waitingForMessage = true;
        const oldTarget = findEligibleF1Target(getConversationItems());
        if (oldTarget) { f1State = 'blocked'; console.info('[Pancake Auto] F1 -> VÀNG.', 'Có target cũ:', oldTarget.type, oldTarget.item); }
        else { f1State = 'armed'; console.info('[Pancake Auto] F1 -> XANH.', 'Không có MESS/COMMENT cũ.'); }
        updateStatusDot();
        startConversationObserver();
    }
    async function runManualComment() {
        if (destroyed || isProcessing || cloneModeActive) return;
        cancelWaitingMode();
        isProcessing = true;
        const generation = abortGeneration;
        const flowId = ++flowCounter;
        try {
            assertNotAborted(generation);
            console.info(`[Pancake Auto] Flow ${flowId} START F2`);
            await sendComposerCommand('/', true, flowId, generation);
            await abortableSleep(CONFIG.WAIT_AFTER_COMMENT_ENTER, generation);
            assertNotAborted(generation);
            await openPreviewAndFill(flowId, generation);
            assertNotAborted(generation);
            console.info(`[Pancake Auto] Flow ${flowId} DONE F2`);
        } catch (error) {
            if (!isAbortError(error)) console.error(`[Pancake Auto] Flow ${flowId} F2 lỗi:`, error);
            else console.info(`[Pancake Auto] Flow ${flowId} F2 bị ESC hủy.`);
        } finally {
            stopSuggestionObserver();
            if (generation === abortGeneration && !destroyed) await sleep(250);
            isProcessing = false;
            updateStatusDot();
        }
    }
    async function runManualTagging() {
        if (destroyed || isProcessing || cloneModeActive) return;
        cancelWaitingMode();
        isProcessing = true;
        const generation = abortGeneration;
        const flowId = ++flowCounter;
        try {
            assertNotAborted(generation);
            console.info(`[Pancake Auto] Flow ${flowId} START F3`);
            await executeTaggingOnly(generation);
            assertNotAborted(generation);
            console.info(`[Pancake Auto] Flow ${flowId} DONE F3`);
        } catch (error) {
            if (!isAbortError(error)) console.error(`[Pancake Auto] Flow ${flowId} F3 lỗi:`, error);
            else console.info(`[Pancake Auto] Flow ${flowId} F3 bị ESC hủy.`);
        } finally {
            if (generation === abortGeneration && !destroyed) await sleep(250);
            isProcessing = false;
            updateStatusDot();
        }
    }

    const pointerDownHandler = event => { if (destroyed) return; if (event.isTrusted && waitingForMessage) cancelWaitingMode(); };
    addManagedEventListener(window, 'pointerdown', pointerDownHandler, true);

    const keyDownHandler = event => {
        if (destroyed || !event.isTrusted) return;
        const isEscape = event.key === 'Escape' || event.key === 'Esc' || event.keyCode === 27;
        if (isEscape) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); if (!event.repeat) abortAllAutomation(); return; }
        const isF1 = event.key === 'F1' || event.keyCode === 112;
        const isF2 = event.key === 'F2' || event.keyCode === 113;
        const isF3 = event.key === 'F3' || event.keyCode === 114;
        if (isF1 || isF2 || isF3) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); }
        if (isF1) { if (!event.repeat) toggleWaitingMode(); return; }
        if (waitingForMessage) cancelWaitingMode();
        if (event.repeat || isProcessing || cloneModeActive) return;
        if (isF2) { void runManualComment(); return; }
        if (isF3) { void runManualTagging(); }
    };
    addManagedEventListener(window, 'keydown', keyDownHandler, true);

    function destroy() {
        if (destroyed) return;
        abortGeneration++;
        destroyed = true;
        waitingForMessage = false;
        f1State = 'off';
        cloneModeActive = false;
        cloneProcessing = false;
        claimedConversation = null;
        isProcessing = false;
        processedCloneKeys.clear();
        stopConversationObserver();
        stopCloneObserver();
        stopSuggestionObserver();
        while (cleanupFunctions.length) {
            const cleanup = cleanupFunctions.pop();
            try { cleanup(); } catch (e) { console.warn('[Pancake Auto] Cleanup lỗi:', e); }
        }
        console.info('[Pancake Auto] Instance destroyed.');
    }
    window[INSTANCE_KEY] = { destroy };
    const beforeUnloadHandler = () => { destroy(); };
    addManagedEventListener(window, 'beforeunload', beforeUnloadHandler);
    updateStatusDot();
    console.info('[Pancake Auto] v11.1 optimized loaded. Giữ nguyên logic gốc, chỉ tối ưu waitFor MutationObserver và fix unread từ HTML thật.');
})();
